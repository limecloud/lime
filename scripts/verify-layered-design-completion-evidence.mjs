#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = "layered-design-completion-evidence@1";
const HUMAN_REVIEW_SCHEMA_VERSION = "layered-design-real-sample-review@1";
const DESIGN_TOOL_SCHEMA_VERSION =
  "layered-design-design-tool-interoperability@1";
const BENCHMARK_SCHEMA_VERSION = "layered-design-model-slot-benchmark@1";
const GPT_IMAGE_LIVE_SCHEMA_VERSION = "layered-design-gpt-image-live-evidence@1";
const REQUIRED_KINDS = ["subject_matting", "clean_plate", "text_ocr"];
const DEFAULT_MINIMUM_SAMPLES = 5;
const DEFAULT_MINIMUM_SAMPLE_SCORE = 8;
const DEFAULT_MINIMUM_PASSED_TOOLS = 1;
const PSD_VERIFIER_PATH = fileURLToPath(
  new URL("./verify-layered-design-psd-export.mjs", import.meta.url),
);

function printHelp() {
  console.log(`
Layered Design Completion Evidence Verifier

用途:
  验证完整类 Lovart 目标的外部事实 evidence 是否齐全：真实 benchmark、人工复核、导出 evidence、外部设计工具打开证据、GPT Image live 生成回写证据。

用法:
  node scripts/verify-layered-design-completion-evidence.mjs --evidence <completion-evidence.json>

选项:
  --evidence <path>   completion evidence 索引 JSON
  --self-test         生成临时通过/失败样例，验证本 verifier 自身
  -h, --help          显示帮助
`);
}

function parseArgs(argv) {
  const options = {
    evidencePath: "",
    selfTest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--self-test") {
      options.selfTest = true;
      continue;
    }
    if (arg === "--evidence") {
      options.evidencePath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    throw new Error(`未知参数: ${arg}`);
  }

  if (!options.selfTest && !options.evidencePath) {
    throw new Error("必须传入 --evidence，或使用 --self-test");
  }

  return options;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];
}

function resolvePath(baseDir, value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} 缺失`);
  return path.resolve(baseDir, value);
}

function resolveExistingPath(baseDir, value, label) {
  const resolved = resolvePath(baseDir, value, label);
  assert(fs.existsSync(resolved), `${label} 不存在: ${resolved}`);
  return resolved;
}

function hasAllItems(values, required) {
  return required.every((item) => values.includes(item));
}

function validateBenchmarkReport(benchmarkPath, requirements) {
  const report = readJson(benchmarkPath);
  const benchmark = isRecord(report.benchmark) ? report.benchmark : undefined;
  const completionGate = isRecord(report.completionGate)
    ? report.completionGate
    : undefined;
  const checkedSamples = readStringArray(benchmark?.checkedSamples);
  const checkedKinds = readStringArray(benchmark?.checkedKinds);
  const requiredKinds = requirements.requiredKinds;
  const minimumSamples = requirements.minimumSamples;

  assert(
    report.schemaVersion === BENCHMARK_SCHEMA_VERSION,
    `benchmark schemaVersion 不匹配: ${report.schemaVersion}`,
  );
  assert(benchmark?.mode === "sample_manifest", "benchmark 必须来自真实 sample_manifest");
  assert(
    completionGate?.status === "sample_manifest_completed",
    `benchmark completionGate 不是 sample_manifest_completed: ${completionGate?.status}`,
  );
  assert(
    checkedSamples.length >= minimumSamples,
    `benchmark 样本数不足: ${checkedSamples.length} < ${minimumSamples}`,
  );
  assert(
    hasAllItems(checkedKinds, requiredKinds),
    `benchmark checkedKinds 缺少必需 kind: ${requiredKinds.join(", ")}`,
  );
  assert(
    Number.isFinite(benchmark.checkedRequestCount) &&
      benchmark.checkedRequestCount >= checkedSamples.length * requiredKinds.length,
    `benchmark checkedRequestCount 不足: ${benchmark.checkedRequestCount}`,
  );

  return {
    report,
    checkedSamples,
    checkedKinds,
    checkedRequestCount: benchmark.checkedRequestCount,
  };
}

function scoreTotal(scores) {
  return [
    scores.subjectMatting,
    scores.cleanPlate,
    scores.ocrTextLayer,
    scores.layerSeparation,
    scores.exportEvidence,
  ].reduce((total, score) => total + score, 0);
}

function validateScoreShape(sample) {
  const scores = isRecord(sample.scores) ? sample.scores : undefined;
  assert(scores, `人工复核样本缺少 scores: ${sample.id}`);
  for (const key of [
    "subjectMatting",
    "cleanPlate",
    "ocrTextLayer",
    "layerSeparation",
    "exportEvidence",
  ]) {
    assert(
      Number.isInteger(scores[key]) && scores[key] >= 0 && scores[key] <= 2,
      `人工复核 ${sample.id}.${key} 必须是 0/1/2`,
    );
  }
  return scores;
}

function validateHumanReview(reviewPath, benchmark, requirements) {
  const review = readJson(reviewPath);
  const samples = Array.isArray(review.samples) ? review.samples : [];
  const byId = new Map(samples.map((sample) => [sample.id, sample]));
  const acceptedSamples = [];
  const failures = [];

  assert(
    review.schemaVersion === HUMAN_REVIEW_SCHEMA_VERSION,
    `人工复核 schemaVersion 不匹配: ${review.schemaVersion}`,
  );

  for (const sampleId of benchmark.checkedSamples) {
    const sample = byId.get(sampleId);
    if (!sample) {
      failures.push(`${sampleId}: 缺少人工复核记录`);
      continue;
    }
    const scores = validateScoreShape(sample);
    const total = scoreTotal(scores);
    const hasCriticalZero =
      scores.subjectMatting === 0 || scores.cleanPlate === 0 || scores.ocrTextLayer === 0;
    const accepted = sample.decision === "accepted";
    if (total < requirements.minimumSampleScore) {
      failures.push(`${sampleId}: 总分 ${total} < ${requirements.minimumSampleScore}`);
    }
    if (hasCriticalZero) {
      failures.push(`${sampleId}: subject/clean/OCR 关键维度存在 0 分`);
    }
    if (!accepted) {
      failures.push(`${sampleId}: decision 必须是 accepted`);
    }
    if (total >= requirements.minimumSampleScore && !hasCriticalZero && accepted) {
      acceptedSamples.push(sampleId);
    }
  }

  assert(failures.length === 0, `人工复核未通过: ${failures.join("; ")}`);

  return {
    reviewedAt: review.reviewedAt,
    acceptedSamples,
    sampleCount: samples.length,
  };
}

function normalizeModelSlotBenchmarkSummary(benchmark) {
  return {
    schemaVersion: benchmark.report.schemaVersion,
    mode: benchmark.report.benchmark.mode,
    checkedSamples: benchmark.checkedSamples,
    checkedKinds: benchmark.checkedKinds,
    checkedRequestCount: benchmark.checkedRequestCount,
    completionGate: benchmark.report.completionGate,
  };
}

function validateExportEvidence(exportDirectoryPath, benchmark) {
  const exportManifestPath = path.join(exportDirectoryPath, "export-manifest.json");
  const psdLikeManifestPath = path.join(exportDirectoryPath, "psd-like-manifest.json");
  const trialPsdPath = path.join(exportDirectoryPath, "trial.psd");
  const exportManifest = readJson(exportManifestPath);
  const benchmarkSummary = exportManifest.evidence?.modelSlotBenchmark;

  assert(fs.existsSync(exportManifestPath), `缺少 export-manifest.json: ${exportManifestPath}`);
  assert(fs.existsSync(psdLikeManifestPath), `缺少 psd-like-manifest.json: ${psdLikeManifestPath}`);
  assert(fs.existsSync(trialPsdPath), `缺少 trial.psd: ${trialPsdPath}`);
  assert(benchmarkSummary, "export-manifest.json 缺少 evidence.modelSlotBenchmark");
  assert(
    benchmarkSummary.completionGate?.status === "sample_manifest_completed",
    "export-manifest benchmark gate 必须是 sample_manifest_completed",
  );
  assert(
    benchmarkSummary.sampleManifestProvided === true,
    "export-manifest benchmark 必须标记 sampleManifestProvided=true",
  );
  assert(
    hasAllItems(readStringArray(benchmarkSummary.checkedSamples), benchmark.checkedSamples),
    "export-manifest benchmark checkedSamples 未覆盖 benchmark report",
  );
  assert(
    hasAllItems(readStringArray(benchmarkSummary.checkedKinds), benchmark.checkedKinds),
    "export-manifest benchmark checkedKinds 未覆盖 benchmark report",
  );

  const verifierOutput = execFileSync(process.execPath, [
    PSD_VERIFIER_PATH,
    "--psd",
    trialPsdPath,
    "--psd-like-manifest",
    psdLikeManifestPath,
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const verifierSummary = JSON.parse(verifierOutput);
  assert(
    verifierSummary.psd?.layerCount > 0,
    "trial.psd 结构验证通过但图层数为 0，不能作为外部互操作 evidence",
  );

  return {
    exportManifestPath,
    psdLikeManifestPath,
    trialPsdPath,
    modelSlotBenchmark: normalizeModelSlotBenchmarkSummary(benchmark),
    psdLayerCount: verifierSummary.psd.layerCount,
    psdLayerNames: verifierSummary.psd.layerNames,
  };
}

function validateDesignToolEvidence(evidencePath, exportEvidence, requirements) {
  const baseDir = path.dirname(evidencePath);
  const evidence = readJson(evidencePath);
  const tools = Array.isArray(evidence.tools) ? evidence.tools : [];
  const requiredChecks = [
    "opensFile",
    "layerListVisible",
    "layerCountMatchesManifest",
    "layerNamesMatchManifest",
    "visibilityMatchesManifest",
    "transparentPixelsVisible",
    "textLayersIdentifiable",
  ];
  const passedTools = [];

  assert(
    evidence.schemaVersion === DESIGN_TOOL_SCHEMA_VERSION,
    `外部设计工具 evidence schemaVersion 不匹配: ${evidence.schemaVersion}`,
  );
  if (typeof evidence.trialPsdPath === "string") {
    const trialPsdPath = path.resolve(baseDir, evidence.trialPsdPath);
    assert(
      path.resolve(trialPsdPath) === path.resolve(exportEvidence.trialPsdPath),
      "外部设计工具 evidence 的 trialPsdPath 与 export evidence 不一致",
    );
  }

  for (const item of tools) {
    const checks = isRecord(item.checks) ? item.checks : undefined;
    const files = readStringArray(item.evidenceFiles);
    const allChecksPassed = checks && requiredChecks.every((key) => checks[key] === true);
    const allFilesExist = files.length > 0 && files.every((file) => fs.existsSync(path.resolve(baseDir, file)));
    if (item.status === "passed" && allChecksPassed && allFilesExist) {
      passedTools.push({
        tool: item.tool,
        toolVersion: item.toolVersion,
        openedAt: item.openedAt,
        evidenceFiles: files.map((file) => path.resolve(baseDir, file)),
      });
    }
  }

  assert(
    passedTools.length >= requirements.minimumPassedTools,
    `外部设计工具通过数不足: ${passedTools.length} < ${requirements.minimumPassedTools}`,
  );

  return {
    passedTools,
    toolCount: tools.length,
  };
}

function validateGptImageLiveEvidence(evidencePath) {
  const baseDir = path.dirname(evidencePath);
  const evidence = readJson(evidencePath);
  const checks = isRecord(evidence.checks) ? evidence.checks : undefined;
  const task = isRecord(evidence.task) ? evidence.task : undefined;
  const models = isRecord(evidence.models) ? evidence.models : undefined;
  const result = isRecord(evidence.result) ? evidence.result : undefined;
  const document = isRecord(evidence.document) ? evidence.document : undefined;

  assert(
    evidence.schema === GPT_IMAGE_LIVE_SCHEMA_VERSION,
    `GPT Image live evidence schema 不匹配: ${evidence.schema}`,
  );
  assert(evidence.mode === "live", `GPT Image live evidence 必须是 live 模式: ${evidence.mode}`);

  for (const key of [
    "noLegacyPosterRoute",
    "executorModeResponses",
    "imageDataUrl",
    "generatedAssetApplied",
    "targetLayerUpdated",
  ]) {
    assert(checks?.[key] === true, `GPT Image live evidence 检查未通过: ${key}`);
  }

  assert(
    models?.executorMode === "responses_image_generation" &&
      task?.executorMode === "responses_image_generation",
    "GPT Image live evidence 必须走 responses_image_generation executor",
  );
  assert(
    task?.entrySource === "layered_design_canvas",
    `GPT Image live evidence entrySource 不匹配: ${task?.entrySource}`,
  );
  assert(
    task?.modalityContractKey === "image_generation" &&
      task?.routingSlot === "image_generation_model",
    "GPT Image live evidence 必须保留 image_generation contract 与 routing slot",
  );
  assert(
    Number.isInteger(result?.imageCount) && result.imageCount >= 1,
    `GPT Image live evidence imageCount 无效: ${result?.imageCount}`,
  );
  assert(
    Number.isInteger(result?.imageBytes) && result.imageBytes > 0,
    `GPT Image live evidence imageBytes 无效: ${result?.imageBytes}`,
  );
  assert(
    Number.isInteger(result?.eventCount) && result.eventCount > 0,
    `GPT Image live evidence eventCount 无效: ${result?.eventCount}`,
  );
  assert(
    Number.isInteger(result?.outputItemCount) && result.outputItemCount > 0,
    `GPT Image live evidence outputItemCount 无效: ${result?.outputItemCount}`,
  );
  assert(
    typeof result?.imageOutputPath === "string" &&
      result.imageOutputPath.trim().length > 0,
    "GPT Image live evidence 缺少 imageOutputPath，不能作为最终验收图片证据",
  );

  const imageOutputPath = path.resolve(baseDir, result.imageOutputPath);
  assert(fs.existsSync(imageOutputPath), `GPT Image live PNG evidence 不存在: ${imageOutputPath}`);

  assert(
    typeof document?.generatedAssetId === "string" &&
      document.generatedAssetId === document.targetLayerAssetId,
    "GPT Image live evidence 未证明生成资产已绑定到目标图层",
  );
  assert(
    document?.generatedAssetSource === "responses_image_generation" &&
      document?.generatedAssetExecutorMode === "responses_image_generation",
    "GPT Image live evidence 未保留 GeneratedDesignAsset Responses 执行元数据",
  );

  return {
    evidencePath,
    mode: evidence.mode,
    imageModel: models?.imageModel,
    outerModel: models?.outerModel,
    executorMode: models?.executorMode,
    imageBytes: result.imageBytes,
    imageOutputPath,
    targetLayerId: document?.targetLayerId,
    generatedAssetId: document?.generatedAssetId,
  };
}

function normalizeRequirements(rawRequirements) {
  const requirements = isRecord(rawRequirements) ? rawRequirements : {};
  const requiredKinds = readStringArray(requirements.requiredKinds);
  return {
    minimumSamples: Number.isInteger(requirements.minimumSamples)
      ? requirements.minimumSamples
      : DEFAULT_MINIMUM_SAMPLES,
    minimumSampleScore: Number.isInteger(requirements.minimumSampleScore)
      ? requirements.minimumSampleScore
      : DEFAULT_MINIMUM_SAMPLE_SCORE,
    minimumPassedTools: Number.isInteger(requirements.minimumPassedTools)
      ? requirements.minimumPassedTools
      : DEFAULT_MINIMUM_PASSED_TOOLS,
    requiredKinds: requiredKinds.length > 0 ? requiredKinds : REQUIRED_KINDS,
  };
}

function validateCompletionEvidenceFile(evidencePath) {
  const resolvedEvidencePath = path.resolve(evidencePath);
  const baseDir = path.dirname(resolvedEvidencePath);
  const evidence = readJson(resolvedEvidencePath);
  const requirements = normalizeRequirements(evidence.requirements);

  assert(
    evidence.schemaVersion === SCHEMA_VERSION,
    `completion evidence schemaVersion 不匹配: ${evidence.schemaVersion}`,
  );

  const benchmarkPath = resolveExistingPath(
    baseDir,
    evidence.benchmarkReportPath,
    "benchmarkReportPath",
  );
  const humanReviewPath = resolveExistingPath(
    baseDir,
    evidence.humanReviewReportPath,
    "humanReviewReportPath",
  );
  const exportDirectoryPath = resolveExistingPath(
    baseDir,
    evidence.exportDirectoryPath,
    "exportDirectoryPath",
  );
  const designToolEvidencePath = resolveExistingPath(
    baseDir,
    evidence.designToolEvidencePath,
    "designToolEvidencePath",
  );
  const gptImageLiveEvidencePath = resolveExistingPath(
    baseDir,
    evidence.gptImageLiveEvidencePath,
    "gptImageLiveEvidencePath",
  );

  const benchmark = validateBenchmarkReport(benchmarkPath, requirements);
  const humanReview = validateHumanReview(
    humanReviewPath,
    benchmark,
    requirements,
  );
  const exportEvidence = validateExportEvidence(exportDirectoryPath, benchmark);
  const designToolInterop = validateDesignToolEvidence(
    designToolEvidencePath,
    exportEvidence,
    requirements,
  );
  const gptImageLive = validateGptImageLiveEvidence(gptImageLiveEvidencePath);

  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    evidencePath: resolvedEvidencePath,
    benchmark: {
      reportPath: benchmarkPath,
      checkedSamples: benchmark.checkedSamples,
      checkedKinds: benchmark.checkedKinds,
      checkedRequestCount: benchmark.checkedRequestCount,
    },
    humanReview,
    exportEvidence,
    designToolInterop,
    gptImageLive,
    completionGate: {
      status: "external_evidence_completed",
      missing: [],
    },
  };
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
}

function i16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16BE(value, 0);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function i32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}

function ascii(value) {
  return Buffer.from(value, "ascii");
}

function utf16be(value) {
  const chars = [];
  for (const char of value) {
    chars.push(u16(char.charCodeAt(0)));
  }
  return Buffer.concat(chars);
}

function padToMultiple(buffer, multiple) {
  const remainder = buffer.length % multiple;
  if (remainder === 0) {
    return buffer;
  }
  return Buffer.concat([buffer, Buffer.alloc(multiple - remainder)]);
}

function createMinimalPsdWithLayer(layerName) {
  const header = Buffer.concat([
    ascii("8BPS"),
    u16(1),
    Buffer.alloc(6),
    u16(3),
    u32(12),
    u32(12),
    u16(8),
    u16(3),
  ]);
  const layerNameBytes = Buffer.from(layerName, "utf8");
  const pascalName = padToMultiple(
    Buffer.concat([Buffer.from([Math.min(layerNameBytes.length, 31)]), layerNameBytes.slice(0, 31)]),
    4,
  );
  const unicodeName = Buffer.concat([
    ascii("8BIM"),
    ascii("luni"),
    u32(4 + layerName.length * 2),
    u32(layerName.length),
    utf16be(layerName),
  ]);
  const extra = Buffer.concat([u32(0), u32(0), pascalName, padToMultiple(unicodeName, 2)]);
  const layerRecord = Buffer.concat([
    i32(0),
    i32(0),
    i32(12),
    i32(12),
    u16(0),
    ascii("8BIM"),
    ascii("norm"),
    Buffer.from([255, 0, 0, 0]),
    u32(extra.length),
    extra,
  ]);
  const layerInfo = Buffer.concat([i16(1), layerRecord]);
  const layerMaskSection = Buffer.concat([u32(layerInfo.length), layerInfo, u32(0)]);

  return Buffer.concat([
    header,
    u32(0),
    u32(0),
    u32(layerMaskSection.length),
    layerMaskSection,
    u16(0),
  ]);
}

function createSelfTestFiles(rootDir) {
  const sampleIds = [
    "real-poster-multi-subject-001",
    "real-poster-transparent-object-002",
    "real-poster-art-text-logo-003",
    "real-poster-dark-neon-004",
    "real-poster-dense-product-card-005",
  ];
  const benchmarkReport = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    createdAt: "2026-05-08T00:00:00.000Z",
    benchmark: {
      mode: "sample_manifest",
      checkedSamples: sampleIds,
      checkedKinds: REQUIRED_KINDS,
      checkedRequestCount: sampleIds.length * REQUIRED_KINDS.length,
      sampleManifestPath: "real-samples.json",
    },
    completionGate: {
      status: "sample_manifest_completed",
      missing: [],
    },
  };
  const benchmarkSummary = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    createdAt: benchmarkReport.createdAt,
    mode: "sample_manifest",
    checkedSamples: sampleIds,
    checkedKinds: REQUIRED_KINDS,
    checkedRequestCount: sampleIds.length * REQUIRED_KINDS.length,
    completionGate: benchmarkReport.completionGate,
    syntheticOnly: false,
    sampleManifestProvided: true,
  };
  const review = {
    schemaVersion: HUMAN_REVIEW_SCHEMA_VERSION,
    reviewedAt: "2026-05-08T00:05:00.000Z",
    benchmarkReport: "model-slot-benchmark.real.json",
    samples: sampleIds.map((id) => ({
      id,
      scores: {
        subjectMatting: 2,
        cleanPlate: 2,
        ocrTextLayer: 2,
        layerSeparation: 2,
        exportEvidence: 2,
      },
      decision: "accepted",
      notes: "self-test fixture",
    })),
  };
  const exportDir = path.join(rootDir, "real-sample.layered-design");
  fs.mkdirSync(exportDir, { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "model-slot-benchmark.real.json"),
    JSON.stringify(benchmarkReport, null, 2),
  );
  fs.writeFileSync(
    path.join(rootDir, "real-samples.human-review.json"),
    JSON.stringify(review, null, 2),
  );
  fs.writeFileSync(
    path.join(exportDir, "export-manifest.json"),
    JSON.stringify(
      {
        schemaVersion: "layered-design-export@1",
        evidence: { modelSlotBenchmark: benchmarkSummary },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(exportDir, "psd-like-manifest.json"),
    JSON.stringify(
      {
        compatibility: { truePsd: false },
        layers: [{ name: "主体候选", type: "image" }],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(exportDir, "trial.psd"),
    createMinimalPsdWithLayer("主体候选"),
  );
  fs.writeFileSync(path.join(rootDir, "photopea-layer-panel.png"), "self-test");
  fs.writeFileSync(
    path.join(rootDir, "design-tool-interoperability.json"),
    JSON.stringify(
      {
        schemaVersion: DESIGN_TOOL_SCHEMA_VERSION,
        createdAt: "2026-05-08T00:10:00.000Z",
        trialPsdPath: "real-sample.layered-design/trial.psd",
        tools: [
          {
            tool: "photopea",
            toolVersion: "self-test",
            openedAt: "2026-05-08T00:10:00.000Z",
            status: "passed",
            checks: {
              opensFile: true,
              layerListVisible: true,
              layerCountMatchesManifest: true,
              layerNamesMatchManifest: true,
              visibilityMatchesManifest: true,
              transparentPixelsVisible: true,
              textLayersIdentifiable: true,
            },
            evidenceFiles: ["photopea-layer-panel.png"],
          },
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(rootDir, "gpt-image-live.png"), "self-test-png");
  const gptImageLiveEvidence = {
    schema: GPT_IMAGE_LIVE_SCHEMA_VERSION,
    mode: "live",
    generatedAt: "2026-05-08T00:12:00.000Z",
    gateway: {
      baseUrlHash: "selftest",
      responsesPath: "/v1/responses",
    },
    models: {
      imageModel: "gpt-images-2",
      outerModel: "gpt-5.5",
      executorMode: "responses_image_generation",
    },
    task: {
      entrySource: "layered_design_canvas",
      providerId: "openai-responses",
      model: "gpt-images-2",
      executorMode: "responses_image_generation",
      outerModel: "gpt-5.5",
      routingSlot: "image_generation_model",
      modalityContractKey: "image_generation",
      targetOutputId: "asset_subject",
      targetOutputRefId: "layer_subject",
    },
    result: {
      imageCount: 1,
      imageItemId: "ig_self_test",
      eventCount: 2,
      outputItemCount: 1,
      imageBytes: 13,
      imageOutputPath: "gpt-image-live.png",
    },
    document: {
      documentId: "self-test-design",
      targetLayerId: "layer_subject",
      targetLayerAssetId: "asset_subject",
      generatedAssetId: "asset_subject",
      generatedAssetSource: "responses_image_generation",
      generatedAssetExecutorMode: "responses_image_generation",
    },
    checks: {
      noLegacyPosterRoute: true,
      executorModeResponses: true,
      imageDataUrl: true,
      generatedAssetApplied: true,
      targetLayerUpdated: true,
    },
  };
  fs.writeFileSync(
    path.join(rootDir, "gpt-image-live.json"),
    JSON.stringify(gptImageLiveEvidence, null, 2),
  );
  fs.writeFileSync(
    path.join(rootDir, "completion-evidence.json"),
    JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        createdAt: "2026-05-08T00:15:00.000Z",
        benchmarkReportPath: "model-slot-benchmark.real.json",
        humanReviewReportPath: "real-samples.human-review.json",
        exportDirectoryPath: "real-sample.layered-design",
        designToolEvidencePath: "design-tool-interoperability.json",
        gptImageLiveEvidencePath: "gpt-image-live.json",
        requirements: {
          minimumSamples: DEFAULT_MINIMUM_SAMPLES,
          minimumSampleScore: DEFAULT_MINIMUM_SAMPLE_SCORE,
          minimumPassedTools: DEFAULT_MINIMUM_PASSED_TOOLS,
          requiredKinds: REQUIRED_KINDS,
        },
      },
      null,
      2,
    ),
  );

  return {
    evidencePath: path.join(rootDir, "completion-evidence.json"),
    reviewPath: path.join(rootDir, "real-samples.human-review.json"),
    gptImageLivePath: path.join(rootDir, "gpt-image-live.json"),
    gptImageLiveEvidence,
  };
}

function runSelfTest() {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "lime-layered-design-completion-evidence-"),
  );
  const {
    evidencePath,
    reviewPath,
    gptImageLivePath,
    gptImageLiveEvidence,
  } = createSelfTestFiles(rootDir);
  const summary = validateCompletionEvidenceFile(evidencePath);
  assert(summary.ok === true, "self-test 通过样例未返回 ok=true");
  assert(
    summary.benchmark.checkedSamples.length === DEFAULT_MINIMUM_SAMPLES,
    "self-test benchmark 样本数异常",
  );
  assert(
    summary.gptImageLive.executorMode === "responses_image_generation",
    "self-test GPT Image live executor 异常",
  );

  const invalidGptImageLiveEvidence = structuredClone(gptImageLiveEvidence);
  invalidGptImageLiveEvidence.checks.targetLayerUpdated = false;
  fs.writeFileSync(
    gptImageLivePath,
    JSON.stringify(invalidGptImageLiveEvidence, null, 2),
  );
  let gptImageFailedAsExpected = false;
  try {
    validateCompletionEvidenceFile(evidencePath);
  } catch (error) {
    gptImageFailedAsExpected = String(error.message).includes(
      "GPT Image live evidence 检查未通过",
    );
  }
  assert(gptImageFailedAsExpected, "self-test GPT Image 失败样例没有被拒绝");
  fs.writeFileSync(
    gptImageLivePath,
    JSON.stringify(gptImageLiveEvidence, null, 2),
  );

  const review = readJson(reviewPath);
  review.samples[0].scores.subjectMatting = 0;
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));
  let failedAsExpected = false;
  try {
    validateCompletionEvidenceFile(evidencePath);
  } catch (error) {
    failedAsExpected = String(error.message).includes("关键维度存在 0 分");
  }
  assert(failedAsExpected, "self-test 失败样例没有被拒绝");

  console.log(
    JSON.stringify(
      {
        ok: true,
        selfTest: true,
        evidencePath,
        checkedSamples: summary.benchmark.checkedSamples.length,
        passedTools: summary.designToolInterop.passedTools.map((tool) => tool.tool),
        gptImageLive: {
          imageModel: summary.gptImageLive.imageModel,
          executorMode: summary.gptImageLive.executorMode,
          imageBytes: summary.gptImageLive.imageBytes,
        },
      },
      null,
      2,
    ),
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
    return;
  }

  console.log(
    JSON.stringify(validateCompletionEvidenceFile(options.evidencePath), null, 2),
  );
}

main();
