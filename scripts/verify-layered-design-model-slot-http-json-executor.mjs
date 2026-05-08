#!/usr/bin/env node

import http from "node:http";
import process from "node:process";
import zlib from "node:zlib";

const DEFAULT_TIMEOUT_MS = 60_000;
const CREATED_AT = "2026-05-08T00:00:00.000Z";
const SAMPLE_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8I4WQAAAABJRU5ErkJggg==";
const SYNTHETIC_POSTER_WIDTH = 360;
const SYNTHETIC_POSTER_HEIGHT = 560;
const SYNTHETIC_POSTER_PROFILES = [
  {
    id: "coffee-pop-up",
    label: "Coffee pop-up",
    backgroundTop: [238, 242, 234],
    backgroundBottom: [218, 228, 212],
    headlineColor: [18, 24, 42],
    subjectColor: [132, 154, 172],
    logoColor: [245, 163, 72],
    ctaColor: [22, 101, 52],
    accentColor: [255, 238, 194],
    subjectRect: { x: 72, y: 140, width: 216, height: 320 },
    headlineRect: { x: 36, y: 34, width: 220, height: 58 },
    logoRect: { x: 266, y: 30, width: 54, height: 58 },
    ctaRect: { x: 64, y: 472, width: 190, height: 52 },
    accentRect: { x: 40, y: 226, width: 276, height: 36 },
  },
  {
    id: "dark-game-poster",
    label: "Dark game poster",
    backgroundTop: [12, 18, 34],
    backgroundBottom: [40, 18, 54],
    headlineColor: [96, 226, 255],
    subjectColor: [222, 82, 92],
    logoColor: [250, 221, 82],
    ctaColor: [122, 71, 255],
    accentColor: [30, 66, 112],
    subjectRect: { x: 90, y: 150, width: 180, height: 318 },
    headlineRect: { x: 42, y: 44, width: 246, height: 66 },
    logoRect: { x: 278, y: 42, width: 44, height: 44 },
    ctaRect: { x: 84, y: 484, width: 202, height: 44 },
    accentRect: { x: 0, y: 312, width: 360, height: 24 },
  },
  {
    id: "product-card",
    label: "Product card",
    backgroundTop: [250, 245, 232],
    backgroundBottom: [236, 224, 204],
    headlineColor: [58, 42, 32],
    subjectColor: [86, 132, 118],
    logoColor: [208, 68, 48],
    ctaColor: [32, 88, 148],
    accentColor: [255, 209, 110],
    subjectRect: { x: 146, y: 132, width: 170, height: 276 },
    headlineRect: { x: 30, y: 42, width: 204, height: 56 },
    logoRect: { x: 38, y: 418, width: 64, height: 44 },
    ctaRect: { x: 34, y: 484, width: 248, height: 46 },
    accentRect: { x: 34, y: 164, width: 92, height: 182 },
  },
];

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
Layered Design Model Slot HTTP JSON Executor Verifier

用途:
  验证本地或远端模型服务是否实现 Lime AI 图层化设计 standard JSON executor contract。

用法:
  node scripts/verify-layered-design-model-slot-http-json-executor.mjs --endpoint-url <url>

选项:
  --endpoint-url <url>  HTTP JSON executor endpoint，接收 POST JSON request
  --timeout-ms <ms>    每个请求超时，默认 ${DEFAULT_TIMEOUT_MS}
  --self-test          启动内置 fixture endpoint 并验证 verifier 自身
  -h, --help           显示帮助
`);
}

function parseArgs(argv) {
  const options = {
    endpointUrl: "",
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

function createContext(kind, slotId, modelId, profile) {
  return {
    slotId,
    slotKind: kind,
    providerLabel: `Verifier ${kind}`,
    modelId,
    execution: "remote_model",
    attempt: 1,
    maxAttempts: 1,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    fallbackStrategy: "return_null",
    providerId: "http-json-executor-verifier",
    metadata: {
      slotId,
      slotKind: kind,
      modelId,
      providerId: "http-json-executor-verifier",
      profileId: profile.id,
      profileLabel: profile.label,
      sampleWidth: SYNTHETIC_POSTER_WIDTH,
      sampleHeight: SYNTHETIC_POSTER_HEIGHT,
    },
    qualityContract: CONTRACTS[kind],
  };
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

function isInsideRect(x, y, rect) {
  return (
    x >= rect.x &&
    x < rect.x + rect.width &&
    y >= rect.y &&
    y < rect.y + rect.height
  );
}

function blendColor(top, bottom, ratio) {
  return top.map((channel, index) =>
    Math.round(channel + (bottom[index] - channel) * ratio),
  );
}

function pickSyntheticPosterPixel(profile, x, y) {
  const heightRatio = y / Math.max(1, SYNTHETIC_POSTER_HEIGHT - 1);
  const diagonalAccent = (x + y) % 96 < 8;
  let color = blendColor(
    profile.backgroundTop,
    profile.backgroundBottom,
    heightRatio,
  );

  if (diagonalAccent) {
    color = blendColor(color, profile.accentColor, 0.18);
  }
  if (isInsideRect(x, y, profile.accentRect)) {
    color = profile.accentColor;
  }
  if (isInsideRect(x, y, profile.headlineRect)) {
    color = profile.headlineColor;
  }
  if (isInsideRect(x, y, profile.subjectRect)) {
    color = profile.subjectColor;
  }
  if (isInsideRect(x, y, profile.logoRect)) {
    color = profile.logoColor;
  }
  if (isInsideRect(x, y, profile.ctaRect)) {
    color = profile.ctaColor;
  }

  return color;
}

function createSyntheticPosterPngDataUrl(profile) {
  const width = SYNTHETIC_POSTER_WIDTH;
  const height = SYNTHETIC_POSTER_HEIGHT;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      const [red, green, blue] = pickSyntheticPosterPixel(profile, x, y);
      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
      raw[offset + 3] = 255;
    }
  }

  const compressed = zlib.deflateSync(raw);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);

  return `data:image/png;base64,${png.toString("base64")}`;
}

function createSampleRequests() {
  return SYNTHETIC_POSTER_PROFILES.flatMap((profile) => {
    const posterSrc = createSyntheticPosterPngDataUrl(profile);
    const image = {
      src: posterSrc,
      width: SYNTHETIC_POSTER_WIDTH,
      height: SYNTHETIC_POSTER_HEIGHT,
      mimeType: "image/png",
      metadata: {
        profileId: profile.id,
        profileLabel: profile.label,
      },
    };
    const subject = {
      id: `verifier-${profile.id}-subject`,
      name: `${profile.label} 主体`,
      rect: profile.subjectRect,
      confidence: 0.9,
      zIndex: 10,
      crop: {
        src: posterSrc,
        width: profile.subjectRect.width,
        height: profile.subjectRect.height,
        mimeType: "image/png",
        metadata: {
          profileId: profile.id,
        },
      },
    };

    return [
      {
        kind: "subject_matting",
        input: {
          image,
          createdAt: CREATED_AT,
          subject,
        },
        context: createContext(
          "subject_matting",
          `${profile.id}-subject-slot`,
          "verifier-matting-v1",
          profile,
        ),
      },
      {
        kind: "clean_plate",
        input: {
          image,
          createdAt: CREATED_AT,
          subject: {
            ...subject,
            maskSrc: SAMPLE_PNG_DATA_URL,
          },
        },
        context: createContext(
          "clean_plate",
          `${profile.id}-clean-slot`,
          "verifier-inpaint-v1",
          profile,
        ),
      },
      {
        kind: "text_ocr",
        input: {
          image,
          candidate: {
            id: `verifier-${profile.id}-headline`,
            name: `${profile.label} 标题`,
            role: "text",
            rect: profile.headlineRect,
            asset: {
              id: `verifier-${profile.id}-headline-asset`,
              kind: "text_raster",
              src: posterSrc,
              width: profile.headlineRect.width,
              height: profile.headlineRect.height,
              hasAlpha: true,
              createdAt: CREATED_AT,
              metadata: {
                profileId: profile.id,
              },
            },
          },
        },
        context: createContext(
          "text_ocr",
          `${profile.id}-ocr-slot`,
          "verifier-ocr-v1",
          profile,
        ),
      },
    ];
  });
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
        `${request.kind} HTTP ${response.status} ${response.statusText}`,
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function createFixtureResponse(request) {
  if (request.kind === "subject_matting") {
    return {
      kind: "subject_matting",
      result: {
        imageSrc: SAMPLE_PNG_DATA_URL,
        maskSrc: SAMPLE_PNG_DATA_URL,
        hasAlpha: true,
        confidence: 0.98,
        params: {
          foregroundPixelCount: 1_200,
          detectedForegroundPixelCount: 1_180,
          ellipseFallbackApplied: false,
          totalPixelCount: 1_600,
        },
      },
    };
  }
  if (request.kind === "clean_plate") {
    return {
      kind: "clean_plate",
      result: {
        src: SAMPLE_PNG_DATA_URL,
        params: {
          filledPixelCount: 1_100,
          totalSubjectPixelCount: 1_100,
          maskApplied: true,
        },
      },
    };
  }

  return {
    kind: "text_ocr",
    result: [
      {
        text: "VERIFIER OCR",
        boundingBox: { x: 1, y: 2, width: 24, height: 8 },
        confidence: 0.95,
      },
    ],
  };
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function startSelfTestFixtureServer() {
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    try {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(createFixtureResponse(payload)));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("self-test fixture 未能监听端口");
  }

  return {
    endpointUrl: `http://127.0.0.1:${address.port}/model-slot`,
    close: async () =>
      await new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function verifyEndpoint(endpointUrl, timeoutMs) {
  const results = [];
  for (const request of createSampleRequests()) {
    const responseJson = await postJsonWithTimeout(endpointUrl, request, timeoutMs);
    const validation = validateResponse(request, responseJson);
    const profileId = request.context.metadata.profileId;
    if (validation.status !== "satisfied") {
      throw new Error(
        `${profileId}/${request.kind} 未满足 qualityContract: ${JSON.stringify(
          validation,
        )}`,
      );
    }
    results.push({
      profileId,
      kind: request.kind,
      slotId: request.context.slotId,
      modelId: request.context.modelId,
      validation,
    });
  }

  return {
    ok: true,
    endpointUrl,
    checkedProfiles: [...new Set(results.map((result) => result.profileId))],
    checkedKinds: [...new Set(results.map((result) => result.kind))],
    checkedRequestCount: results.length,
    results,
  };
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node 运行时不支持 fetch，请使用 Node 18+");
  }

  const options = parseArgs(process.argv.slice(2));
  const fixture = options.selfTest ? await startSelfTestFixtureServer() : null;

  try {
    const summary = await verifyEndpoint(
      fixture?.endpointUrl ?? options.endpointUrl,
      options.timeoutMs,
    );
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await fixture?.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
