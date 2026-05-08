#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const HTTP_JSON_EXECUTOR_VERIFIER_PATH = fileURLToPath(
  new URL(
    "./verify-layered-design-model-slot-http-json-executor.mjs",
    import.meta.url,
  ),
);
const HTTP_JSON_EXECUTOR_FIXTURE_PATH = fileURLToPath(
  new URL("./layered-design-model-slot-http-json-fixture.mjs", import.meta.url),
);

const DEFAULTS = {
  appUrl: "http://127.0.0.1:1420/",
  healthUrl: "http://127.0.0.1:3030/health",
  invokeUrl: "http://127.0.0.1:3030/invoke",
  timeoutMs: 180_000,
  intervalMs: 1_000,
  analyzer: "default",
  projectRoundtrip: true,
};

const ACTION_TIMEOUT_MS = 45_000;
const POST_HEALTH_SETTLE_MS = 1_000;
const WORKER_REFINED_TEXT = "WORKER REFINED TEXT";
const WORKER_OCR_TEXT = "WORKER OCR TEXT";
const WORKER_REFINED_SUBJECT_META = "subject / 置信度 93%";
const WORKER_DEFAULT_SUBJECT_META = "subject / 置信度 94%";
const WORKER_MATTING_SUBJECT_META = "subject / 置信度 94%";
const WORKER_OCR_PRIORITY_TEXT =
  "OCR priority: Smoke failing OCR provider -> Smoke empty OCR provider -> Smoke OCR priority browser Worker provider";
const WORKER_CLEAN_PLATE_SOURCE =
  "背景修补来源：Simple browser clean plate provider / simple_neighbor_inpaint_v1";
const WORKER_POSTPROCESS_ALPHA_HOLE_TEXT = "主体 alpha 孔洞已修复";
const WORKER_POSTPROCESS_CLEAN_PLATE_HALO_TEXT =
  "clean plate 边缘残影已修补";
const NATIVE_SUBJECT_META = "subject / 置信度 74%";
const NATIVE_HIGH_RISK_LEVEL_TEXT = "拆层质量：高风险";
const NATIVE_ELLIPSE_FALLBACK_TEXT = "主体 mask 使用兜底椭圆";
const NATIVE_HIGH_RISK_BLOCK_TEXT = "高风险拆层已阻止直接进入编辑";
const WORKER_MODEL_SLOT_TEXT = "WORKER OCR TEXT";
const WORKER_MODEL_SLOT_SUBJECT_META = "subject / 置信度 94%";
const WORKER_MODEL_SLOT_CLEAN_PLATE_SOURCE =
  "背景修补来源：Simple browser clean plate provider / simple_neighbor_inpaint_v1";
const WORKER_MODEL_SLOT_JSON_EXECUTOR_FIXTURE =
  "Analyzer model slots provider JSON executor fixture";
const WORKER_MODEL_SLOT_HTTP_JSON_EXECUTOR_FIXTURE =
  "Analyzer model slots HTTP JSON executor sidecar fixture";
const WORKER_MODEL_SLOT_NATIVE_OCR_JSON_EXECUTOR_FIXTURE =
  "Analyzer model slots native OCR JSON executor fixture";
const WORKER_MODEL_SLOT_NATIVE_OCR_PRIORITY =
  "OCR priority: Tauri native OCR -> Worker OCR provider via model slot JSON executor";
const WORKER_MODEL_SLOT_EXPORT_RELATIVE_PATH =
  ".lime/layered-designs/design-canvas-smoke.layered-design";
const EXTRACTION_QUALITY_EXPORT_RELATIVE_PATH =
  ".lime/layered-designs/smoke-flat-image.layered-design";
const WORKER_MODEL_SLOT_QUALITY_CONTRACT_EXPECTATIONS = {
  subject_matting: {
    slotId: "smoke-subject-matting-slot",
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
    slotId: "smoke-clean-plate-slot",
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
    slotId: "smoke-ocr-slot",
    factSource: "LayeredDesignDocument.extraction.candidates",
    requiredResultFields: ["text", "boundingBox", "confidence"],
    requiredParamKeys: [],
    reviewFindingIds: [],
  },
};
const ANALYZER_MODES = new Set([
  "default",
  "worker",
  "worker-refined",
  "worker-matting",
  "worker-ocr",
  "worker-ocr-priority",
  "worker-clean-plate",
  "worker-model-slots",
  "worker-model-slots-http-json",
  "worker-model-slots-native-ocr",
  "native",
]);

const ANALYZER_BADGE_TEXT = {
  default: "默认 analyzer",
  native: "Native analyzer 已启用",
  worker: "Worker analyzer 已启用",
  "worker-refined": "Worker refined analyzer 已启用",
  "worker-matting": "Worker subject matting analyzer 已启用",
  "worker-ocr": "Worker OCR analyzer 已启用",
  "worker-ocr-priority": "Worker OCR priority analyzer 已启用",
  "worker-clean-plate": "Worker clean plate analyzer 已启用",
  "worker-model-slots": "Worker model slots analyzer 已启用",
  "worker-model-slots-http-json":
    "Worker model slots HTTP JSON analyzer 已启用",
  "worker-model-slots-native-ocr":
    "Worker model slots native OCR analyzer 已启用",
};

const ANALYZER_RESULT_TEXT = {
  default: "Worker local heuristic analyzer",
  native: "Tauri native heuristic analyzer",
  worker: "Worker local heuristic analyzer",
  "worker-refined": "Worker local heuristic analyzer",
  "worker-matting": "Worker local heuristic analyzer",
  "worker-ocr": "Worker local heuristic analyzer",
  "worker-ocr-priority": "Worker local heuristic analyzer",
  "worker-clean-plate": "Worker local heuristic analyzer",
  "worker-model-slots": "Worker local heuristic analyzer",
  "worker-model-slots-http-json": "Worker local heuristic analyzer",
  "worker-model-slots-native-ocr": "Worker local heuristic analyzer",
};

const ANALYZER_EXTRA_CHECK = {
  default: {
    subjectCandidateName: /[☑☐]\s*主体候选/,
    subjectMeta: WORKER_DEFAULT_SUBJECT_META,
    cleanPlateSource: WORKER_CLEAN_PLATE_SOURCE,
    qualityTexts: [
      WORKER_POSTPROCESS_ALPHA_HOLE_TEXT,
      WORKER_POSTPROCESS_CLEAN_PLATE_HALO_TEXT,
    ],
  },
  worker: {
    subjectCandidateName: /[☑☐]\s*主体候选/,
    subjectMeta: WORKER_DEFAULT_SUBJECT_META,
    cleanPlateSource: WORKER_CLEAN_PLATE_SOURCE,
    qualityTexts: [
      WORKER_POSTPROCESS_ALPHA_HOLE_TEXT,
      WORKER_POSTPROCESS_CLEAN_PLATE_HALO_TEXT,
    ],
  },
  native: {
    subjectCandidateName: /[☑☐]\s*主体候选/,
    subjectMeta: NATIVE_SUBJECT_META,
    highRiskQualityTexts: [
      NATIVE_HIGH_RISK_LEVEL_TEXT,
      NATIVE_ELLIPSE_FALLBACK_TEXT,
      "检测前景覆盖约 0%",
      NATIVE_HIGH_RISK_BLOCK_TEXT,
    ],
    highRiskManifestFindingIds: ["subject_mask_ellipse_fallback"],
  },
  "worker-refined": {
    subjectCandidateName: /[☑☐]\s*主体候选/,
    subjectMeta: WORKER_REFINED_SUBJECT_META,
    textCandidateName: /[☑☐]\s*标题文字候选/,
    text: WORKER_REFINED_TEXT,
  },
  "worker-matting": {
    subjectCandidateName: /[☑☐]\s*主体候选/,
    subjectMeta: WORKER_MATTING_SUBJECT_META,
  },
  "worker-ocr": {
    textCandidateName: /[☑☐]\s*标题文字候选/,
    text: WORKER_OCR_TEXT,
  },
  "worker-ocr-priority": {
    priorityText: WORKER_OCR_PRIORITY_TEXT,
    textCandidateName: /[☑☐]\s*标题文字候选/,
    text: WORKER_OCR_TEXT,
  },
  "worker-clean-plate": {
    cleanPlateSource: WORKER_CLEAN_PLATE_SOURCE,
  },
  "worker-model-slots": {
    fixtureText: WORKER_MODEL_SLOT_JSON_EXECUTOR_FIXTURE,
    subjectCandidateName: /[☑☐]\s*主体候选/,
    subjectMeta: WORKER_MODEL_SLOT_SUBJECT_META,
    textCandidateName: /[☑☐]\s*标题文字候选/,
    text: WORKER_MODEL_SLOT_TEXT,
    cleanPlateSource: WORKER_MODEL_SLOT_CLEAN_PLATE_SOURCE,
    capabilityText: "3 项 / 均生产可用",
    modelSlotQualityContracts: true,
    modelSlotQualityManifest: true,
    modelSlotExecutionTexts: [
      "模型执行",
      "主体抠图：smoke-subject-matting-slot-v1 / attempt 1/1 / succeeded",
      "背景修补：smoke-clean-plate-slot-v1 / attempt 1/1 / succeeded",
      "OCR TextLayer：smoke-ocr-slot-v1 / attempt 1/1 / succeeded",
    ],
  },
  "worker-model-slots-http-json": {
    fixtureText: WORKER_MODEL_SLOT_HTTP_JSON_EXECUTOR_FIXTURE,
    subjectCandidateName: /[☑☐]\s*主体候选/,
    subjectMeta: WORKER_MODEL_SLOT_SUBJECT_META,
    textCandidateName: /[☑☐]\s*标题文字候选/,
    text: WORKER_MODEL_SLOT_TEXT,
    cleanPlateSource: WORKER_MODEL_SLOT_CLEAN_PLATE_SOURCE,
    capabilityText: "3 项 / 均生产可用",
    modelSlotQualityContracts: false,
    modelSlotQualityManifest: true,
    modelSlotExecutionTexts: [
      "模型执行",
      "主体抠图：smoke-subject-matting-slot-v1 / attempt 1/1 / succeeded",
      "背景修补：smoke-clean-plate-slot-v1 / attempt 1/1 / succeeded",
      "OCR TextLayer：smoke-ocr-slot-v1 / attempt 1/1 / succeeded",
    ],
  },
  "worker-model-slots-native-ocr": {
    fixtureText: WORKER_MODEL_SLOT_NATIVE_OCR_JSON_EXECUTOR_FIXTURE,
    priorityText: WORKER_MODEL_SLOT_NATIVE_OCR_PRIORITY,
    subjectCandidateName: /[☑☐]\s*主体候选/,
    subjectMeta: WORKER_MODEL_SLOT_SUBJECT_META,
    textCandidateName: /[☑☐]\s*标题文字候选/,
    text: WORKER_MODEL_SLOT_TEXT,
    cleanPlateSource: WORKER_MODEL_SLOT_CLEAN_PLATE_SOURCE,
    capabilityText: "3 项 / 均生产可用",
    modelSlotQualityContracts: true,
    modelSlotQualityManifest: true,
    modelSlotExecutionTexts: [
      "模型执行",
      "主体抠图：smoke-subject-matting-slot-v1 / attempt 1/1 / succeeded",
      "背景修补：smoke-clean-plate-slot-v1 / attempt 1/1 / succeeded",
      "OCR TextLayer：smoke-ocr-slot-v1 / attempt 1/1 / succeeded",
    ],
  },
};

function printHelp() {
  console.log(`
Lime Design Canvas Smoke

用途:
  通过真实 Lime 页面验证 canvas:design Artifact 能进入 LayeredDesignDocument
  图层设计画布，并能完成基础图层选择与移动交互。

用法:
  npm run smoke:design-canvas

选项:
  --app-url <url>          前端地址，默认 http://127.0.0.1:1420/
  --health-url <url>       DevBridge 健康检查地址，默认 http://127.0.0.1:3030/health
  --invoke-url <url>       DevBridge invoke 地址，默认 http://127.0.0.1:3030/invoke
  --timeout-ms <ms>        总超时，默认 180000
  --interval-ms <ms>       轮询间隔，默认 1000
  --analyzer <mode>        analyzer 注入模式：default / worker / worker-refined / worker-matting / worker-ocr / worker-ocr-priority / worker-clean-plate / worker-model-slots / worker-model-slots-http-json / worker-model-slots-native-ocr / native，默认 default（产品默认 worker-first）
  --project-roundtrip      上传拆层前验证 prompt seed 工程保存与重新打开（默认开启）
  --skip-project-roundtrip 跳过工程保存/重新打开，仅用于定位非持久化链路问题
  -h, --help               显示帮助
`);
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--app-url" && argv[index + 1]) {
      options.appUrl = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--health-url" && argv[index + 1]) {
      options.healthUrl = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--invoke-url" && argv[index + 1]) {
      options.invokeUrl = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms" && argv[index + 1]) {
      options.timeoutMs = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--interval-ms" && argv[index + 1]) {
      options.intervalMs = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--analyzer" && argv[index + 1]) {
      options.analyzer = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--project-roundtrip") {
      options.projectRoundtrip = true;
      continue;
    }

    if (arg === "--skip-project-roundtrip") {
      options.projectRoundtrip = false;
      continue;
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 30_000) {
    throw new Error("--timeout-ms 必须是 >= 30000 的数字");
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 100) {
    throw new Error("--interval-ms 必须是 >= 100 的数字");
  }
  if (!options.appUrl || !options.healthUrl || !options.invokeUrl) {
    throw new Error("--app-url、--health-url、--invoke-url 均不能为空");
  }
  if (!ANALYZER_MODES.has(options.analyzer)) {
    throw new Error(
      "--analyzer 必须是 worker、worker-refined、worker-matting、worker-ocr、worker-ocr-priority、worker-clean-plate、worker-model-slots、worker-model-slots-http-json、worker-model-slots-native-ocr、native 或 default",
    );
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSameStringArray(actual, expected, message) {
  assert(
    Array.isArray(actual),
    `${message}: actual is not an array (${JSON.stringify(actual)})`,
  );
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(
      actual,
    )}`,
  );
}

async function startModelSlotHttpJsonExecutorSidecar() {
  const child = spawn(process.execPath, [HTTP_JSON_EXECUTOR_FIXTURE_PATH], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderrChunks = [];
  let stdoutBuffer = "";

  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `HTTP JSON fixture 启动超时: ${Buffer.concat(stderrChunks).toString(
            "utf8",
          )}`,
        ),
      );
    }, ACTION_TIMEOUT_MS);

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
    const onStderr = (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    };
    const onError = (error) => rejectReady(error);
    const onExit = (code, signal) => {
      rejectReady(
        new Error(
          `HTTP JSON fixture 提前退出 code=${code} signal=${signal} stderr=${Buffer.concat(
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
    url: ready.endpointUrl,
    requestsUrl: ready.requestsUrl,
    shutdownUrl: ready.shutdownUrl,
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

async function verifyModelSlotHttpJsonExecutorSidecar(sidecar) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      HTTP_JSON_EXECUTOR_VERIFIER_PATH,
      "--endpoint-url",
      sidecar.url,
      "--timeout-ms",
      String(ACTION_TIMEOUT_MS),
    ],
    {
      maxBuffer: 1024 * 1024,
    },
  );
  const summary = JSON.parse(stdout);
  const expectedProfiles = [
    "coffee-pop-up",
    "dark-game-poster",
    "product-card",
  ];
  const expectedKinds = ["subject_matting", "clean_plate", "text_ocr"];
  assert(
    summary?.ok === true &&
      Array.isArray(summary.checkedProfiles) &&
      expectedProfiles.every((profile) =>
        summary.checkedProfiles.includes(profile),
      ) &&
      Array.isArray(summary.checkedKinds) &&
      expectedKinds.every((kind) => summary.checkedKinds.includes(kind)) &&
      summary.checkedRequestCount >=
        expectedProfiles.length * expectedKinds.length,
    `HTTP JSON executor verifier summary 不完整: ${stdout}`,
  );
}

async function readModelSlotHttpJsonExecutorSidecarRequests(sidecar) {
  assert(sidecar.requestsUrl, "HTTP JSON fixture 缺少 requestsUrl");
  const response = await fetch(sidecar.requestsUrl);
  assert(
    response.ok,
    `HTTP JSON fixture requests 读取失败: ${response.status} ${response.statusText}`,
  );
  const payload = await response.json();
  return Array.isArray(payload?.requests) ? payload.requests : [];
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createSmokeFlatImagePngBuffer(width = 360, height = 560) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA

  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0;

    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      const inHeadline = y > height * 0.06 && y < height * 0.14;
      const inSubject =
        x > width * 0.18 &&
        x < width * 0.82 &&
        y > height * 0.24 &&
        y < height * 0.82;
      const inSubjectInteriorHole =
        Math.abs(x - width * 0.5) <= 2 &&
        Math.abs(y - height * 0.5) <= 2;
      const inSubjectConnectedHalo =
        x > width * 0.18 &&
        x < width * 0.18 + 5 &&
        y > height * 0.36 &&
        y < height * 0.62;
      const inSubjectHalo =
        x > width * 0.18 - 2 &&
        x < width * 0.82 + 2 &&
        y > height * 0.24 - 2 &&
        y < height * 0.82 + 2 &&
        !inSubject;
      const inAccent = x > width * 0.86 && y > height * 0.86;
      const subjectRed = 130;
      const subjectGreen = 150;
      const subjectBlue = 170;
      const haloRed = 205;
      const haloGreen = 215;
      const haloBlue = 215;

      raw[offset] = inSubject
        ? inSubjectInteriorHole
          ? 238
          : inSubjectConnectedHalo
            ? haloRed
            : subjectRed
        : inSubjectHalo
          ? haloRed
          : inHeadline
            ? 18
            : inAccent
              ? 245
              : 238;
      raw[offset + 1] = inSubject
        ? inSubjectInteriorHole
          ? 242
          : inSubjectConnectedHalo
            ? haloGreen
            : subjectGreen
        : inSubjectHalo
          ? haloGreen
          : inHeadline
            ? 24
            : inAccent
              ? 163
              : 242;
      raw[offset + 2] = inSubject
        ? inSubjectInteriorHole
          ? 234
          : inSubjectConnectedHalo
            ? haloBlue
            : subjectBlue
        : inSubjectHalo
          ? haloBlue
          : inHeadline
            ? 42
            : inAccent
              ? 72
              : 234;
      raw[offset + 3] = 255;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function logStage(label) {
  console.log(`[smoke:design-canvas] stage=${label}`);
}

function pickStringField(target, ...keys) {
  if (!target || typeof target !== "object") {
    return "";
  }

  for (const key of keys) {
    const value = target[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

async function waitForHealth(options) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < options.timeoutMs) {
    try {
      const response = await fetch(options.healthUrl, { method: "GET" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      console.log(
        `[smoke:design-canvas] DevBridge 已就绪 (${Date.now() - startedAt}ms)${
          payload?.status ? ` status=${payload.status}` : ""
        }`,
      );
      return;
    } catch (error) {
      lastError = error;
      await sleep(options.intervalMs);
    }
  }

  const detail =
    lastError instanceof Error
      ? lastError.message
      : String(lastError || "unknown error");
  throw new Error(
    `[smoke:design-canvas] DevBridge 未就绪，请先启动 npm run tauri:dev:headless。最后错误: ${detail}`,
  );
}

async function invoke(options, cmd, args) {
  const response = await fetch(options.invokeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ cmd, args }),
    signal: AbortSignal.timeout(Math.min(options.timeoutMs, 180_000)),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    throw new Error(String(payload.error));
  }

  return payload?.result;
}

async function resolveDefaultWorkspace(options) {
  const defaultProject = await invoke(options, "get_or_create_default_project");
  assert(
    defaultProject && typeof defaultProject === "object",
    "get_or_create_default_project 返回为空",
  );

  const projectId = pickStringField(defaultProject, "id");
  assert(projectId, "默认 workspace 缺少 id");

  const ensuredWorkspace = await invoke(options, "workspace_ensure_ready", {
    id: projectId,
  });
  const rootPath =
    pickStringField(ensuredWorkspace, "rootPath", "root_path") ||
    pickStringField(defaultProject, "rootPath", "root_path");
  assert(rootPath, "默认 workspace 缺少 rootPath");

  return {
    projectId,
    rootPath,
  };
}

async function assertWorkerModelSlotsManifest(page, workspace) {
  assert(workspace.rootPath, "worker-model-slots manifest 断言缺少 workspace rootPath");

  const manifest = await readProjectExportManifest(
    page,
    workspace,
    WORKER_MODEL_SLOT_EXPORT_RELATIVE_PATH,
  );
  const slots = Array.isArray(manifest?.analyzerModelSlots)
    ? manifest.analyzerModelSlots
    : [];
  const slotIds = slots.map((slot) => String(slot?.config?.id ?? ""));

  assert(
    slotIds.includes("smoke-subject-matting-slot") &&
      slotIds.includes("smoke-clean-plate-slot") &&
      slotIds.includes("smoke-ocr-slot"),
    `worker-model-slots manifest 缺少 analyzerModelSlots: ${JSON.stringify(
      slotIds,
    )}`,
  );
  assert(
    slots.every((slot) => slot?.readiness?.valid === true),
    `worker-model-slots manifest readiness 未全部通过: ${JSON.stringify(
      slots.map((slot) => slot?.readiness),
    )}`,
  );
}

async function assertWorkerModelSlotQualityContracts(page) {
  const contracts = await page.evaluate(
    () => globalThis.__limeDesignCanvasSmokeModelSlotQualityContracts ?? [],
  );

  assert(
    Array.isArray(contracts),
    `worker-model-slots qualityContract 记录不是数组: ${JSON.stringify(
      contracts,
    )}`,
  );

  for (const [kind, expected] of Object.entries(
    WORKER_MODEL_SLOT_QUALITY_CONTRACT_EXPECTATIONS,
  )) {
    const contract = contracts.find(
      (item) => item?.kind === kind && item?.slotId === expected.slotId,
    );
    assert(
      contract,
      `worker-model-slots 缺少 ${kind} qualityContract: ${JSON.stringify(
        contracts,
      )}`,
    );
    assert(
      contract.factSource === expected.factSource,
      `worker-model-slots ${kind} qualityContract factSource 不一致: ${JSON.stringify(
        contract,
      )}`,
    );
    assertSameStringArray(
      contract.requiredResultFields,
      expected.requiredResultFields,
      `worker-model-slots ${kind} qualityContract result 字段`,
    );
    assertSameStringArray(
      contract.requiredParamKeys,
      expected.requiredParamKeys,
      `worker-model-slots ${kind} qualityContract params 字段`,
    );
    assertSameStringArray(
      contract.reviewFindingIds,
      expected.reviewFindingIds,
      `worker-model-slots ${kind} qualityContract review findings`,
    );
  }
}

function assertWorkerModelSlotHttpJsonSidecarRequests(requests) {
  for (const [kind, expected] of Object.entries(
    WORKER_MODEL_SLOT_QUALITY_CONTRACT_EXPECTATIONS,
  )) {
    const request = requests.find(
      (item) => item?.kind === kind && item?.context?.slotId === expected.slotId,
    );
    assert(
      request,
      `worker-model-slots-http-json sidecar 缺少 ${kind} 请求: ${JSON.stringify(
        requests,
      )}`,
    );
    assert(
      request.context.qualityContract?.factSource === expected.factSource,
      `worker-model-slots-http-json ${kind} qualityContract factSource 不一致`,
    );
    assertSameStringArray(
      request.context.qualityContract?.requiredResultFields,
      expected.requiredResultFields,
      `worker-model-slots-http-json ${kind} qualityContract result 字段`,
    );
    assertSameStringArray(
      request.context.qualityContract?.requiredParamKeys,
      expected.requiredParamKeys,
      `worker-model-slots-http-json ${kind} qualityContract params 字段`,
    );
    assertSameStringArray(
      request.context.qualityContract?.reviewFindingIds,
      expected.reviewFindingIds,
      `worker-model-slots-http-json ${kind} qualityContract review findings`,
    );
  }
}

async function readProjectExportOutput(
  page,
  workspace,
  exportDirectoryRelativePath,
) {
  assert(workspace.rootPath, "工程导出读回断言缺少 workspace rootPath");

  return await page.evaluate(
    async ({ projectRootPath, exportDirectoryRelativePath }) => {
      const { readLayeredDesignProjectExport } = await import(
        "/src/lib/api/layeredDesignProject.ts"
      );
      return readLayeredDesignProjectExport({
        projectRootPath,
        exportDirectoryRelativePath,
      });
    },
    {
      projectRootPath: workspace.rootPath,
      exportDirectoryRelativePath,
    },
  );
}

async function readProjectExportManifest(
  page,
  workspace,
  exportDirectoryRelativePath,
) {
  const output = await readProjectExportOutput(
    page,
    workspace,
    exportDirectoryRelativePath,
  );
  const manifestJson = pickStringField(output, "manifestJson", "manifest_json");
  assert(
    manifestJson,
    `工程导出缺少 manifestJson: ${exportDirectoryRelativePath}`,
  );

  return JSON.parse(manifestJson);
}

async function assertExtractionQualityManifest(page, workspace) {
  const output = await readProjectExportOutput(
    page,
    workspace,
    EXTRACTION_QUALITY_EXPORT_RELATIVE_PATH,
  );
  const manifestJson = pickStringField(output, "manifestJson", "manifest_json");
  assert(
    manifestJson,
    `工程导出缺少 manifestJson: ${EXTRACTION_QUALITY_EXPORT_RELATIVE_PATH}`,
  );
  const manifest = JSON.parse(manifestJson);
  const quality = manifest?.analysis?.extractionQuality;
  const findingIds = Array.isArray(quality?.findings)
    ? quality.findings.map((finding) => String(finding?.id ?? ""))
    : [];

  assert(
    quality?.level === "review",
    `拆层导出 manifest 缺少 review 级质量评估: ${JSON.stringify(quality)}`,
  );
  assert(
    findingIds.includes("subject_alpha_holes_repaired") &&
      findingIds.includes("clean_plate_halo_repaired"),
    `拆层导出 manifest 缺少后处理 finding: ${JSON.stringify(findingIds)}`,
  );

  const psdLikeManifestJson = pickStringField(
    output,
    "psdLikeManifestJson",
    "psd_like_manifest_json",
  );
  assert(
    psdLikeManifestJson,
    `工程导出缺少 psdLikeManifestJson: ${EXTRACTION_QUALITY_EXPORT_RELATIVE_PATH}`,
  );
  const psdLikeManifest = JSON.parse(psdLikeManifestJson);
  const psdLikeQuality = psdLikeManifest?.quality?.extractionQuality;
  const psdLikeFindingIds = Array.isArray(psdLikeQuality?.findings)
    ? psdLikeQuality.findings.map((finding) => String(finding?.id ?? ""))
    : [];

  assert(
    psdLikeManifest?.quality?.source?.factSource ===
      "LayeredDesignDocument.extraction" &&
      psdLikeManifest?.quality?.source?.exportManifestFile ===
        "export-manifest.json",
    `PSD-like manifest 缺少质量事实源: ${JSON.stringify(
      psdLikeManifest?.quality?.source,
    )}`,
  );
  assert(
    psdLikeQuality?.level === quality.level,
    `PSD-like manifest 质量等级不一致: ${JSON.stringify(psdLikeQuality)}`,
  );
  assert(
    psdLikeFindingIds.includes("subject_alpha_holes_repaired") &&
      psdLikeFindingIds.includes("clean_plate_halo_repaired"),
    `PSD-like manifest 缺少后处理 finding: ${JSON.stringify(
      psdLikeFindingIds,
    )}`,
  );
  assert(
    JSON.stringify(psdLikeQuality) === JSON.stringify(quality),
    "PSD-like manifest 与 export manifest 的 extractionQuality 不一致",
  );
}

async function assertWorkerModelSlotsExtractionQualityManifest(page, workspace) {
  const output = await readProjectExportOutput(
    page,
    workspace,
    EXTRACTION_QUALITY_EXPORT_RELATIVE_PATH,
  );
  const designJson = pickStringField(output, "designJson", "design_json");
  assert(
    designJson,
    `工程导出缺少 designJson: ${EXTRACTION_QUALITY_EXPORT_RELATIVE_PATH}`,
  );
  const design = JSON.parse(designJson);
  const qualityValidationEvidence = [
    ...(Array.isArray(design?.assets)
      ? design.assets.map((asset) => ({
          source: "asset",
          id: asset?.id,
          execution: asset?.params?.modelSlotExecution,
          validation: asset?.params?.qualityContractValidation,
        }))
      : []),
    ...(Array.isArray(design?.layers)
      ? design.layers.map((layer) => ({
          source: "layer",
          id: layer?.id,
          execution: layer?.params?.modelSlotExecution,
          validation: layer?.params?.qualityContractValidation,
        }))
      : []),
  ].filter((item) => item.validation);

  for (const [kind, expected] of Object.entries(
    WORKER_MODEL_SLOT_QUALITY_CONTRACT_EXPECTATIONS,
  )) {
    const evidence = qualityValidationEvidence.find(
      (item) => item?.execution?.slotId === expected.slotId,
    );
    assert(
      evidence?.validation?.status === "satisfied",
      `worker-model-slots ${kind} qualityContractValidation 未满足: ${JSON.stringify(
        qualityValidationEvidence,
      )}`,
    );
    assertSameStringArray(
      evidence.validation.missingResultFields,
      [],
      `worker-model-slots ${kind} qualityContractValidation missing result`,
    );
    assertSameStringArray(
      evidence.validation.missingParamKeys,
      [],
      `worker-model-slots ${kind} qualityContractValidation missing params`,
    );
  }

  const manifestJson = pickStringField(output, "manifestJson", "manifest_json");
  assert(
    manifestJson,
    `工程导出缺少 manifestJson: ${EXTRACTION_QUALITY_EXPORT_RELATIVE_PATH}`,
  );
  const manifest = JSON.parse(manifestJson);
  const quality = manifest?.analysis?.extractionQuality;
  const findingIds = Array.isArray(quality?.findings)
    ? quality.findings.map((finding) => String(finding?.id ?? ""))
    : [];

  assert(
    quality?.level === "ready" || quality?.level === "review",
    `worker-model-slots 拆层导出 manifest 缺少可编辑质量评估: ${JSON.stringify(
      quality,
    )}`,
  );
  assert(
    !findingIds.includes("subject_model_slot_quality_metadata_missing") &&
      !findingIds.includes("clean_plate_model_slot_quality_metadata_missing"),
    `worker-model-slots 仍缺生产质量元数据: ${JSON.stringify(findingIds)}`,
  );

  const executions = Array.isArray(manifest?.evidence?.modelSlotExecutions)
    ? manifest.evidence.modelSlotExecutions
    : [];
  const manifestQualityValidations = Array.isArray(
    manifest?.evidence?.modelSlotQualityValidations,
  )
    ? manifest.evidence.modelSlotQualityValidations
    : [];
  for (const [kind, expected] of Object.entries(
    WORKER_MODEL_SLOT_QUALITY_CONTRACT_EXPECTATIONS,
  )) {
    assert(
      executions.some(
        (execution) =>
          execution?.slotId === expected.slotId &&
          execution?.slotKind === kind &&
          execution?.status === "succeeded",
      ),
      `worker-model-slots manifest 缺少 ${kind} succeeded 执行证据: ${JSON.stringify(
        executions,
      )}`,
    );
    const validation = manifestQualityValidations.find(
      (item) => item?.slotId === expected.slotId && item?.slotKind === kind,
    );
    assert(
      validation?.status === "satisfied",
      `worker-model-slots manifest 缺少 ${kind} satisfied 质量契约验收: ${JSON.stringify(
        manifestQualityValidations,
      )}`,
    );
    assertSameStringArray(
      validation.missingResultFields,
      [],
      `worker-model-slots manifest ${kind} missing result`,
    );
    assertSameStringArray(
      validation.missingParamKeys,
      [],
      `worker-model-slots manifest ${kind} missing params`,
    );
  }

  const psdLikeManifestJson = pickStringField(
    output,
    "psdLikeManifestJson",
    "psd_like_manifest_json",
  );
  assert(
    psdLikeManifestJson,
    `工程导出缺少 psdLikeManifestJson: ${EXTRACTION_QUALITY_EXPORT_RELATIVE_PATH}`,
  );
  const psdLikeManifest = JSON.parse(psdLikeManifestJson);
  const psdLikeQuality = psdLikeManifest?.quality?.extractionQuality;
  assert(
    JSON.stringify(psdLikeQuality) === JSON.stringify(quality),
    "worker-model-slots PSD-like manifest 与 export manifest 的 extractionQuality 不一致",
  );
}

async function assertHighRiskExtractionQualityManifest(
  page,
  workspace,
  expectedFindingIds,
) {
  const output = await readProjectExportOutput(
    page,
    workspace,
    EXTRACTION_QUALITY_EXPORT_RELATIVE_PATH,
  );
  const manifestJson = pickStringField(output, "manifestJson", "manifest_json");
  assert(
    manifestJson,
    `工程导出缺少 manifestJson: ${EXTRACTION_QUALITY_EXPORT_RELATIVE_PATH}`,
  );
  const manifest = JSON.parse(manifestJson);
  const quality = manifest?.analysis?.extractionQuality;
  const findingIds = Array.isArray(quality?.findings)
    ? quality.findings.map((finding) => String(finding?.id ?? ""))
    : [];

  assert(
    quality?.level === "high_risk",
    `拆层导出 manifest 缺少 high_risk 质量评估: ${JSON.stringify(quality)}`,
  );
  for (const expectedFindingId of expectedFindingIds) {
    assert(
      findingIds.includes(expectedFindingId),
      `拆层导出 manifest 缺少 ${expectedFindingId}: ${JSON.stringify(
        findingIds,
      )}`,
    );
  }

  const psdLikeManifestJson = pickStringField(
    output,
    "psdLikeManifestJson",
    "psd_like_manifest_json",
  );
  assert(
    psdLikeManifestJson,
    `工程导出缺少 psdLikeManifestJson: ${EXTRACTION_QUALITY_EXPORT_RELATIVE_PATH}`,
  );
  const psdLikeManifest = JSON.parse(psdLikeManifestJson);
  const psdLikeQuality = psdLikeManifest?.quality?.extractionQuality;
  const psdLikeFindingIds = Array.isArray(psdLikeQuality?.findings)
    ? psdLikeQuality.findings.map((finding) => String(finding?.id ?? ""))
    : [];

  assert(
    psdLikeManifest?.quality?.source?.factSource ===
      "LayeredDesignDocument.extraction" &&
      psdLikeManifest?.quality?.source?.exportManifestFile ===
        "export-manifest.json",
    `PSD-like manifest 缺少质量事实源: ${JSON.stringify(
      psdLikeManifest?.quality?.source,
    )}`,
  );
  assert(
    psdLikeQuality?.level === quality.level,
    `PSD-like manifest 质量等级不一致: ${JSON.stringify(psdLikeQuality)}`,
  );
  for (const expectedFindingId of expectedFindingIds) {
    assert(
      psdLikeFindingIds.includes(expectedFindingId),
      `PSD-like manifest 缺少 ${expectedFindingId}: ${JSON.stringify(
        psdLikeFindingIds,
      )}`,
    );
  }
  assert(
    JSON.stringify(psdLikeQuality) === JSON.stringify(quality),
    "PSD-like manifest 与 export manifest 的 high_risk extractionQuality 不一致",
  );
}

async function assertButtonDisabled(page, buttonName) {
  const disabled = await page
    .getByRole("button", { name: buttonName, exact: true })
    .evaluate((button) => Boolean(button.disabled));
  assert(disabled, `${buttonName} 按钮应处于禁用状态`);
}

function buildSmokeUrl(options, workspace, sidecar) {
  const url = new URL("/design-canvas-smoke", options.appUrl);
  url.searchParams.set("projectRootPath", workspace.rootPath);
  url.searchParams.set("projectId", workspace.projectId);
  url.searchParams.set("analyzer", options.analyzer);
  if (sidecar?.url) {
    url.searchParams.set("modelSlotEndpointUrl", sidecar.url);
  }
  return url.toString();
}

async function waitForText(page, label, text) {
  try {
    await page.getByText(text).first().waitFor({
      state: "visible",
      timeout: ACTION_TIMEOUT_MS,
    });
  } catch (error) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    throw new Error(
      `[smoke:design-canvas] ${label} 等待失败，缺少文本 ${JSON.stringify(
        text,
      )}；页面文本片段: ${JSON.stringify(bodyText.slice(0, 1200))}`,
    );
  }
}

async function runPageFlow(options, smokeUrl) {
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `lime-design-canvas-smoke-${process.pid}-`),
  );
  const launchOptions = {
    headless: true,
    viewport: { width: 1440, height: 980 },
  };
  let context = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      channel: "chrome",
    });
  } catch (chromeError) {
    console.warn(
      `[smoke:design-canvas] Chrome channel 启动失败，尝试 Playwright 自带 Chromium: ${
        chromeError instanceof Error ? chromeError.message : String(chromeError)
      }`,
    );
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  }

  const page = context.pages()[0] ?? (await context.newPage());
  const consoleErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.stack || error.message);
  });

  try {
    logStage("open-design-canvas-page");
    await page.goto(smokeUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });

    logStage("wait-design-canvas");
    await page
      .locator('[data-testid="design-canvas-smoke-page"]')
      .waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
    await page
      .locator('[data-testid="design-canvas"]')
      .waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });

    await waitForText(page, "smoke 标题", "canvas:design 专属 GUI Smoke");
    await waitForText(page, "artifact 类型", "canvas:design");
    await waitForText(page, "事实源标记", "LayeredDesignDocument");
    await waitForText(
      page,
      "analyzer 标记",
      ANALYZER_BADGE_TEXT[options.analyzer],
    );
    await waitForText(page, "画布标题", "Smoke 图层设计海报");
    await waitForText(page, "图层栏", "图层");
    await waitForText(page, "属性栏", "属性");
    await waitForText(page, "生成入口", "生成全部图片层");
    await waitForText(page, "刷新入口", "刷新生成结果");
    await waitForText(page, "单层重生成入口", "重生成当前层");
    await waitForText(page, "导出入口", "导出设计工程");
    await waitForText(page, "工程恢复入口", "打开最近工程");

    logStage("interact-layer");
    await page.getByRole("button", { name: "选择图层 主标题" }).click({
      timeout: ACTION_TIMEOUT_MS,
    });
    await waitForText(page, "主标题选中", "主标题");
    await page.getByRole("button", { name: "右移", exact: true }).click({
      timeout: ACTION_TIMEOUT_MS,
    });
    await page.getByRole("button", { name: "隐藏", exact: true }).click({
      timeout: ACTION_TIMEOUT_MS,
    });
    await page.getByRole("button", { name: "显示", exact: true }).click({
      timeout: ACTION_TIMEOUT_MS,
    });

    if (options.projectRoundtrip) {
      logStage("project-roundtrip-save-open");
      await page.getByRole("button", { name: "导出设计工程", exact: true }).click({
        timeout: ACTION_TIMEOUT_MS,
      });
      await waitForText(page, "工程目录保存结果", "已保存图层设计工程");
      await waitForText(page, "工程目录保存路径", "design-canvas-smoke.layered-design");
      if (
        options.analyzer === "worker-model-slots" ||
        options.analyzer === "worker-model-slots-http-json" ||
        options.analyzer === "worker-model-slots-native-ocr"
      ) {
        const smokeUrlObject = new URL(smokeUrl);
        await assertWorkerModelSlotsManifest(page, {
          rootPath: smokeUrlObject.searchParams.get("projectRootPath") ?? "",
        });
      }

      await page.getByRole("button", { name: "打开最近工程", exact: true }).click({
        timeout: ACTION_TIMEOUT_MS,
      });
      await waitForText(page, "工程目录恢复结果", "已打开图层设计工程");
      await waitForText(page, "恢复后画布标题", "Smoke 图层设计海报");
      await waitForText(page, "恢复后图层栏", "主标题");
    }

    logStage("upload-flat-image-extraction");
    await page
      .locator('[data-testid="design-canvas-flat-image-input"]')
      .setInputFiles({
        name: "smoke-flat-image.png",
        mimeType: "image/png",
        buffer: createSmokeFlatImagePngBuffer(),
      });
    await waitForText(page, "上传扁平图结果", "已载入扁平图 draft");
    const expectedAnalyzerResult = ANALYZER_RESULT_TEXT[options.analyzer];
    if (expectedAnalyzerResult) {
      await waitForText(
        page,
        "analyzer 执行结果",
        expectedAnalyzerResult,
      );
    }
    const extraCheck = ANALYZER_EXTRA_CHECK[options.analyzer];
    if (extraCheck) {
      if (extraCheck.fixtureText) {
        await waitForText(
          page,
          "Worker model slots JSON executor fixture",
          extraCheck.fixtureText,
        );
      }
      if (extraCheck.priorityText) {
        await waitForText(
          page,
          "Worker OCR priority provider 标记",
          extraCheck.priorityText,
        );
      }
      if (extraCheck.qualityTexts) {
        for (const text of extraCheck.qualityTexts) {
          await waitForText(page, "Worker 后处理质量元数据", text);
        }
      }
      if (extraCheck.highRiskQualityTexts) {
        for (const text of extraCheck.highRiskQualityTexts) {
          await waitForText(page, "Native analyzer 高风险质量元数据", text);
        }
      }
      if (extraCheck.subjectCandidateName && extraCheck.subjectMeta) {
        await page
          .getByRole("button", { name: extraCheck.subjectCandidateName })
          .click({ timeout: ACTION_TIMEOUT_MS });
        await waitForText(
          page,
          "Worker subject matting 输出",
          extraCheck.subjectMeta,
        );
      }
      if (extraCheck.textCandidateName && extraCheck.text) {
        await page
          .getByRole("button", { name: extraCheck.textCandidateName })
          .click({ timeout: ACTION_TIMEOUT_MS });
        await waitForText(
          page,
          "Worker refined TextLayer 输出",
          extraCheck.text,
        );
      }
      if (extraCheck.cleanPlateSource) {
        await waitForText(
          page,
          "Worker clean plate provider 来源",
          extraCheck.cleanPlateSource,
        );
      }
      if (extraCheck.capabilityText) {
        await waitForText(
          page,
          "Worker model slots capability 矩阵",
          extraCheck.capabilityText,
        );
      }
      if (extraCheck.modelSlotExecutionTexts) {
        for (const text of extraCheck.modelSlotExecutionTexts) {
          await waitForText(page, "Worker model slots 执行证据", text);
        }
      }
      if (extraCheck.modelSlotQualityContracts) {
        await assertWorkerModelSlotQualityContracts(page);
      }
    }
    await waitForText(page, "拆层确认面板", "拆层确认");
    await waitForText(page, "进入编辑入口", "进入图层编辑");
    await waitForText(page, "候选图层", "候选图层");

    if (extraCheck?.qualityTexts || extraCheck?.highRiskManifestFindingIds) {
      await page.getByRole("button", { name: "恢复默认候选", exact: true }).click({
        timeout: ACTION_TIMEOUT_MS,
      });
      await page
        .getByRole("button", { name: /☑\s*主体候选/ })
        .waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
      if (extraCheck?.highRiskManifestFindingIds) {
        await waitForText(
          page,
          "Native analyzer 高风险阻止状态",
          NATIVE_HIGH_RISK_BLOCK_TEXT,
        );
      }
    }

    if (extraCheck?.highRiskManifestFindingIds) {
      await assertButtonDisabled(page, "进入图层编辑");

      if (options.projectRoundtrip) {
        logStage("high-risk-extraction-quality-export-manifest");
        await page.getByRole("button", { name: "导出设计工程", exact: true }).click({
          timeout: ACTION_TIMEOUT_MS,
        });
        await waitForText(page, "高风险拆层工程目录保存结果", "已保存图层设计工程");
        await waitForText(
          page,
          "高风险拆层工程目录保存路径",
          "smoke-flat-image.layered-design",
        );

        const smokeUrlObject = new URL(smokeUrl);
        await assertHighRiskExtractionQualityManifest(
          page,
          {
            rootPath: smokeUrlObject.searchParams.get("projectRootPath") ?? "",
          },
          extraCheck.highRiskManifestFindingIds,
        );
      }

      await page.getByRole("button", { name: "仅保留原图", exact: true }).click({
        timeout: ACTION_TIMEOUT_MS,
      });
    } else {
      await page.getByRole("button", { name: "进入图层编辑", exact: true }).click({
        timeout: ACTION_TIMEOUT_MS,
      });
    }
    await page
      .getByRole("button", { name: "进入图层编辑", exact: true })
      .waitFor({ state: "hidden", timeout: ACTION_TIMEOUT_MS });
    await waitForText(page, "确认后属性面板", "位置与尺寸");

    if (
      options.projectRoundtrip &&
      (extraCheck?.qualityTexts || extraCheck?.modelSlotQualityManifest)
    ) {
      logStage("extraction-quality-export-manifest");
      await page.getByRole("button", { name: "导出设计工程", exact: true }).click({
        timeout: ACTION_TIMEOUT_MS,
      });
      await waitForText(page, "拆层工程目录保存结果", "已保存图层设计工程");
      await waitForText(
        page,
        "拆层工程目录保存路径",
        "smoke-flat-image.layered-design",
      );

      const smokeUrlObject = new URL(smokeUrl);
      const workspace = {
        rootPath: smokeUrlObject.searchParams.get("projectRootPath") ?? "",
      };
      if (extraCheck?.qualityTexts) {
        await assertExtractionQualityManifest(page, workspace);
      }
      if (extraCheck?.modelSlotQualityManifest) {
        await assertWorkerModelSlotsExtractionQualityManifest(page, workspace);
      }
    }

    if (consoleErrors.length > 0) {
      throw new Error(
        `[smoke:design-canvas] 页面存在 ${consoleErrors.length} 条 console error: ${JSON.stringify(
          consoleErrors.slice(0, 5),
        )}`,
      );
    }
  } finally {
    await context.close().catch(() => undefined);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node 运行时不支持 fetch，请使用 Node 18+");
  }

  const options = parseArgs(process.argv.slice(2));

  logStage("wait-health");
  await waitForHealth(options);
  await sleep(POST_HEALTH_SETTLE_MS);

  logStage("resolve-default-workspace");
  const workspace = await resolveDefaultWorkspace(options);
  const sidecar =
    options.analyzer === "worker-model-slots-http-json"
      ? await startModelSlotHttpJsonExecutorSidecar()
      : null;

  try {
    if (sidecar) {
      logStage("verify-http-json-sidecar-contract");
      await verifyModelSlotHttpJsonExecutorSidecar(sidecar);
    }
    const smokeUrl = buildSmokeUrl(options, workspace, sidecar);

    await runPageFlow(options, smokeUrl);
    if (sidecar) {
      const requests = await readModelSlotHttpJsonExecutorSidecarRequests(
        sidecar,
      );
      assertWorkerModelSlotHttpJsonSidecarRequests(requests);
    }
  } finally {
    await sidecar?.close();
  }

  console.log(
    `[smoke:design-canvas] 通过 project=${workspace.projectId} root=${workspace.rootPath}`,
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : String(error || "unknown error"),
  );
  process.exit(1);
});
