#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 60_000;
const CREATED_AT = "2026-05-08T00:00:00.000Z";
const VERIFIER_PATH = fileURLToPath(
  new URL(
    "./verify-layered-design-model-slot-http-json-executor.mjs",
    import.meta.url,
  ),
);
const FIXTURE_PATH = fileURLToPath(
  new URL("./layered-design-model-slot-http-json-fixture.mjs", import.meta.url),
);

const CONTRACTS = {
  subject_matting: {
    factSource: "LayeredDesignDocument.assets",
    requiredResultFields: ["imageSrc", "maskSrc", "hasAlpha"],
    requiredParamKeys: [
      "foregroundPixelCount",
      "detectedForegroundPixelCount",
      "ellipseFallbackApplied",
      "totalPixelCount",
    ],
    reviewFindingIds: ["subject_model_slot_quality_metadata_missing"],
  },
  clean_plate: {
    factSource: "LayeredDesignDocument.assets",
    requiredResultFields: ["src"],
    requiredParamKeys: [
      "filledPixelCount",
      "totalSubjectPixelCount",
      "maskApplied",
    ],
    reviewFindingIds: ["clean_plate_model_slot_quality_metadata_missing"],
  },
  text_ocr: {
    factSource: "LayeredDesignDocument.extraction.candidates",
    requiredResultFields: ["text", "boundingBox", "confidence"],
    requiredParamKeys: [],
    reviewFindingIds: [],
  },
};

function printHelp() {
  console.log(`
Layered Design Model Slot HTTP JSON Benchmark

用途:
  对 HTTP JSON executor endpoint 运行 synthetic verifier 或本地样本 manifest benchmark，并输出 evidence JSON。

用法:
  node scripts/benchmark-layered-design-model-slot-http-json-executor.mjs --endpoint-url <url>

选项:
  --endpoint-url <url>       待测 HTTP JSON executor endpoint
  --sample-manifest <path>   可选真实/本地样本 manifest；不传时运行内置 synthetic verifier profiles
  --output <path>            可选 benchmark evidence JSON 输出路径
  --timeout-ms <ms>          每个请求超时，默认 ${DEFAULT_TIMEOUT_MS}
  --self-test                启动 standalone fixture 后运行 benchmark
  -h, --help                 显示帮助
`);
}

function parseArgs(argv) {
  const options = {
    endpointUrl: "",
    sampleManifestPath: "",
    outputPath: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
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
    if (arg === "--endpoint-url") {
      options.endpointUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--sample-manifest") {
      options.sampleManifestPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    throw new Error(`未知参数: ${arg}`);
  }

  if (!options.selfTest && !options.endpointUrl) {
    throw new Error("必须传入 --endpoint-url，或使用 --self-test");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000) {
    throw new Error("--timeout-ms 必须是 >= 1000 的数字");
  }

  return options;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasRequiredValue(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key) && record[key] != null;
}

function validateRecordAgainstContract(record, contract) {
  const params = isRecord(record.params) ? record.params : {};
  const missingResultFields = contract.requiredResultFields.filter(
    (key) => !hasRequiredValue(record, key),
  );
  const missingParamKeys = contract.requiredParamKeys.filter(
    (key) => !hasRequiredValue(params, key),
  );

  return {
    status:
      missingResultFields.length > 0
        ? "missing_required_fields"
        : missingParamKeys.length > 0
          ? "missing_required_params"
          : "satisfied",
    missingResultFields,
    missingParamKeys,
  };
}

function validateResponse(request, responseJson) {
  if (!isRecord(responseJson)) {
    throw new Error(`${request.kind} response 必须是 JSON object`);
  }
  if (responseJson.kind !== request.kind) {
    throw new Error(
      `${request.kind} response kind 不一致: ${String(responseJson.kind)}`,
    );
  }

  const contract = request.context.qualityContract;
  const result = responseJson.result;
  if (request.kind === "text_ocr") {
    if (!Array.isArray(result) || result.length === 0) {
      throw new Error("text_ocr result 必须是非空数组");
    }
    const validations = result.map((block) => {
      if (!isRecord(block)) {
        throw new Error("text_ocr result block 必须是 object");
      }

      return validateRecordAgainstContract(block, contract);
    });
    const failed = validations.find((item) => item.status !== "satisfied");
    return failed ?? { status: "satisfied", missingResultFields: [], missingParamKeys: [] };
  }

  if (!isRecord(result)) {
    throw new Error(`${request.kind} result 必须是 object`);
  }

  return validateRecordAgainstContract(result, contract);
}

function readPngDataUrlFromFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
  return {
    src: `data:${mimeType};base64,${buffer.toString("base64")}`,
    mimeType,
  };
}

function readSampleImage(sample, manifestDirectory) {
  const image = isRecord(sample.image) ? sample.image : {};
  if (typeof image.src === "string" && image.src.startsWith("data:")) {
    return {
      src: image.src,
      mimeType: typeof image.mimeType === "string" ? image.mimeType : "image/png",
    };
  }
  if (typeof image.path === "string" && image.path) {
    const absolutePath = path.isAbsolute(image.path)
      ? image.path
      : path.resolve(manifestDirectory, image.path);
    return readPngDataUrlFromFile(absolutePath);
  }

  throw new Error(`sample ${sample.id} 缺少 image.src data URL 或 image.path`);
}

function readNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function readRect(value, fallback) {
  return isRecord(value)
    ? {
        x: readNumber(value.x, fallback.x),
        y: readNumber(value.y, fallback.y),
        width: readNumber(value.width, fallback.width),
        height: readNumber(value.height, fallback.height),
      }
    : fallback;
}

function createContext(kind, sample) {
  return {
    slotId: `${sample.id}-${kind}-slot`,
    slotKind: kind,
    providerLabel: `Benchmark ${kind}`,
    modelId: `benchmark-${kind}-v1`,
    execution: "remote_model",
    attempt: 1,
    maxAttempts: 1,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    fallbackStrategy: "return_null",
    providerId: "http-json-executor-benchmark",
    metadata: {
      sampleId: sample.id,
      sampleLabel: sample.label,
      slotKind: kind,
      providerId: "http-json-executor-benchmark",
    },
    qualityContract: CONTRACTS[kind],
  };
}

function createSampleRequestsFromManifest(manifestPath) {
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifestDirectory = path.dirname(absoluteManifestPath);
  const manifest = JSON.parse(fs.readFileSync(absoluteManifestPath, "utf8"));
  if (!Array.isArray(manifest.samples) || manifest.samples.length === 0) {
    throw new Error("sample manifest 必须包含非空 samples 数组");
  }

  return manifest.samples.flatMap((sample, index) => {
    if (!isRecord(sample)) {
      throw new Error(`sample[${index}] 必须是 object`);
    }
    const sampleId = typeof sample.id === "string" && sample.id ? sample.id : `sample-${index + 1}`;
    const sampleLabel = typeof sample.label === "string" && sample.label ? sample.label : sampleId;
    const imageData = readSampleImage({ ...sample, id: sampleId }, manifestDirectory);
    const width = readNumber(sample.width ?? sample.image?.width, 360);
    const height = readNumber(sample.height ?? sample.image?.height, 560);
    const subjectRect = readRect(sample.subjectRect, {
      x: Math.round(width * 0.2),
      y: Math.round(height * 0.25),
      width: Math.round(width * 0.6),
      height: Math.round(height * 0.55),
    });
    const textRect = readRect(sample.textRect, {
      x: Math.round(width * 0.1),
      y: Math.round(height * 0.06),
      width: Math.round(width * 0.62),
      height: Math.round(height * 0.12),
    });
    const benchmarkSample = {
      id: sampleId,
      label: sampleLabel,
    };
    const image = {
      src: imageData.src,
      width,
      height,
      mimeType: imageData.mimeType,
      metadata: {
        sampleId,
        sampleLabel,
        benchmarkSource: "sample_manifest",
      },
    };
    const subject = {
      id: `${sampleId}-subject`,
      name: `${sampleLabel} 主体`,
      rect: subjectRect,
      confidence: 0.9,
      zIndex: 10,
      crop: {
        src: imageData.src,
        width: subjectRect.width,
        height: subjectRect.height,
        mimeType: imageData.mimeType,
      },
    };

    return [
      {
        kind: "subject_matting",
        input: { image, createdAt: CREATED_AT, subject },
        context: createContext("subject_matting", benchmarkSample),
      },
      {
        kind: "clean_plate",
        input: {
          image,
          createdAt: CREATED_AT,
          subject: { ...subject, maskSrc: imageData.src },
        },
        context: createContext("clean_plate", benchmarkSample),
      },
      {
        kind: "text_ocr",
        input: {
          image,
          candidate: {
            id: `${sampleId}-text`,
            name: `${sampleLabel} 文本`,
            role: "text",
            rect: textRect,
            asset: {
              id: `${sampleId}-text-asset`,
              kind: "text_raster",
              src: imageData.src,
              width: textRect.width,
              height: textRect.height,
              hasAlpha: true,
              createdAt: CREATED_AT,
            },
          },
        },
        context: createContext("text_ocr", benchmarkSample),
      },
    ];
  });
}

async function postJsonWithTimeout(endpointUrl, request, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `${request.context.metadata.sampleId}/${request.kind} HTTP ${response.status} ${response.statusText}`,
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runManifestBenchmark(endpointUrl, manifestPath, timeoutMs) {
  const requests = createSampleRequestsFromManifest(manifestPath);
  const results = [];

  for (const request of requests) {
    const responseJson = await postJsonWithTimeout(endpointUrl, request, timeoutMs);
    const validation = validateResponse(request, responseJson);
    if (validation.status !== "satisfied") {
      throw new Error(
        `${request.context.metadata.sampleId}/${request.kind} 未满足 qualityContract: ${JSON.stringify(
          validation,
        )}`,
      );
    }
    results.push({
      sampleId: request.context.metadata.sampleId,
      kind: request.kind,
      slotId: request.context.slotId,
      modelId: request.context.modelId,
      validation,
    });
  }

  return {
    mode: "sample_manifest",
    sampleManifestPath: path.resolve(manifestPath),
    checkedSamples: [...new Set(results.map((result) => result.sampleId))],
    checkedKinds: [...new Set(results.map((result) => result.kind))],
    checkedRequestCount: results.length,
    results,
  };
}

async function runSyntheticBenchmark(endpointUrl, timeoutMs) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      VERIFIER_PATH,
      "--endpoint-url",
      endpointUrl,
      "--timeout-ms",
      String(timeoutMs),
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  const verifier = JSON.parse(stdout);

  return {
    mode: "synthetic_verifier_profiles",
    checkedSamples: verifier.checkedProfiles,
    checkedKinds: verifier.checkedKinds,
    checkedRequestCount: verifier.checkedRequestCount,
    verifier,
  };
}

async function startSelfTestFixture() {
  const child = spawn(process.execPath, [FIXTURE_PATH], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderrChunks = [];
  let stdoutBuffer = "";

  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `fixture 启动超时: ${Buffer.concat(stderrChunks).toString("utf8")}`,
        ),
      );
    }, DEFAULT_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const resolveReady = (value) => {
      cleanup();
      resolve(value);
    };
    const rejectReady = (error) => {
      cleanup();
      reject(error);
    };
    const onStderr = (chunk) => stderrChunks.push(Buffer.from(chunk));
    const onError = (error) => rejectReady(error);
    const onExit = (code, signal) => {
      rejectReady(
        new Error(
          `fixture 提前退出 code=${code} signal=${signal} stderr=${Buffer.concat(
            stderrChunks,
          ).toString("utf8")}`,
        ),
      );
    };
    const onStdout = (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line) {
          const payload = JSON.parse(line);
          if (payload.type === "ready" && payload.endpointUrl) {
            resolveReady(payload);
            return;
          }
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
    child.once("error", onError);
  });

  return {
    endpointUrl: ready.endpointUrl,
    close: async () => {
      if (ready.shutdownUrl) {
        await fetch(ready.shutdownUrl, { method: "POST" }).catch(() => null);
      }
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          child.kill("SIGTERM");
          resolve();
        }, 2_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    },
  };
}

function buildBenchmarkReport(endpointUrl, benchmark) {
  const syntheticOnly = benchmark.mode === "synthetic_verifier_profiles";
  return {
    schemaVersion: "layered-design-model-slot-benchmark@1",
    createdAt: new Date().toISOString(),
    endpointUrl,
    benchmark,
    completionGate: {
      status: syntheticOnly ? "synthetic_only" : "sample_manifest_completed",
      missing: syntheticOnly
        ? [
            "real_sample_manifest",
            "human_review_or_complex_sample_quality_evidence",
            "export_manifest_evidence_attachment",
          ]
        : ["human_review_or_complex_sample_quality_evidence", "export_manifest_evidence_attachment"],
    },
  };
}

function writeReport(report, outputPath) {
  if (!outputPath) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const absoluteOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
  fs.writeFileSync(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, outputPath: absoluteOutputPath }, null, 2));
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node 运行时不支持 fetch，请使用 Node 18+");
  }

  const options = parseArgs(process.argv.slice(2));
  const fixture = options.selfTest ? await startSelfTestFixture() : null;
  const endpointUrl = fixture?.endpointUrl ?? options.endpointUrl;

  try {
    const benchmark = options.sampleManifestPath
      ? await runManifestBenchmark(
          endpointUrl,
          options.sampleManifestPath,
          options.timeoutMs,
        )
      : await runSyntheticBenchmark(endpointUrl, options.timeoutMs);
    const report = buildBenchmarkReport(endpointUrl, benchmark);
    writeReport(report, options.outputPath);
  } finally {
    await fixture?.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
