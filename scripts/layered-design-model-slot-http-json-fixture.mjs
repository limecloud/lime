#!/usr/bin/env node

import { execFile } from "node:child_process";
import http from "node:http";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";

const execFileAsync = promisify(execFile);
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 0;
const DEFAULT_PATH = "/model-slot";
const DEFAULT_TIMEOUT_MS = 45_000;
const WORKER_MODEL_SLOT_TEXT = "WORKER OCR TEXT";
const TRANSPARENT_PIXEL_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8I4WQAAAABJRU5ErkJggg==";
const HTTP_JSON_EXECUTOR_VERIFIER_PATH = fileURLToPath(
  new URL(
    "./verify-layered-design-model-slot-http-json-executor.mjs",
    import.meta.url,
  ),
);

const PROFILE_TEXT = {
  "coffee-pop-up": "COFFEE POP-UP",
  "dark-game-poster": "DARK GAME POSTER",
  "product-card": "PRODUCT CARD",
};

const PROFILE_CLEAN_PLATE_COLOR = {
  "coffee-pop-up": [238, 242, 234, 255],
  "dark-game-poster": [12, 18, 34, 255],
  "product-card": [250, 245, 232, 255],
};

function printHelp() {
  console.log(`
Layered Design Model Slot HTTP JSON Fixture

用途:
  启动一个独立本地 HTTP JSON executor fixture，用于验证真实服务接入形态。

用法:
  node scripts/layered-design-model-slot-http-json-fixture.mjs

选项:
  --host <host>       监听地址，默认 ${DEFAULT_HOST}
  --port <port>       监听端口，默认 ${DEFAULT_PORT}（随机端口）
  --path <path>       model slot endpoint path，默认 ${DEFAULT_PATH}
  --self-test         启动 fixture 后调用 verifier 自检并退出
  -h, --help          显示帮助
`);
}

function parseArgs(argv) {
  const options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    path: DEFAULT_PATH,
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
    if (arg === "--host") {
      options.host = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--port") {
      options.port = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--path") {
      options.path = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    throw new Error(`未知参数: ${arg}`);
  }

  if (!options.host) {
    throw new Error("--host 不能为空");
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error("--port 必须是 0 到 65535 之间的整数");
  }
  if (!options.path.startsWith("/")) {
    throw new Error("--path 必须以 / 开头");
  }

  return options;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function readProfileId(request) {
  return (
    request?.context?.metadata?.profileId ??
    request?.input?.image?.metadata?.profileId ??
    "smoke-flat-image"
  );
}

function readSubjectRect(request) {
  const rect = request?.input?.subject?.rect;
  return isRecord(rect)
    ? {
        x: readNumber(rect.x, 0),
        y: readNumber(rect.y, 0),
        width: readNumber(rect.width, 160),
        height: readNumber(rect.height, 220),
      }
    : { x: 0, y: 0, width: 160, height: 220 };
}

function readImageSize(request) {
  const image = request?.input?.image;
  return {
    width: readNumber(image?.width, 360),
    height: readNumber(image?.height, 560),
  };
}

function clampPngDimension(value) {
  return Math.min(1024, Math.max(1, readNumber(value, 1)));
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

function encodeRgbaPngDataUrl(widthInput, heightInput, pickPixel) {
  const width = clampPngDimension(widthInput);
  const height = clampPngDimension(heightInput);
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
      const [red, green, blue, alpha] = pickPixel(x, y, width, height);
      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
      raw[offset + 3] = alpha;
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

function createSubjectMatteDataUrl(width, height) {
  return encodeRgbaPngDataUrl(width, height, (x, y, currentWidth, currentHeight) => {
    const dx = (x + 0.5 - currentWidth / 2) / Math.max(1, currentWidth / 2);
    const dy = (y + 0.5 - currentHeight / 2) / Math.max(1, currentHeight / 2);
    const inside = dx * dx + dy * dy <= 0.82;
    return inside ? [132, 154, 172, 255] : [132, 154, 172, 0];
  });
}

function createSubjectMaskDataUrl(width, height) {
  return encodeRgbaPngDataUrl(width, height, (x, y, currentWidth, currentHeight) => {
    const dx = (x + 0.5 - currentWidth / 2) / Math.max(1, currentWidth / 2);
    const dy = (y + 0.5 - currentHeight / 2) / Math.max(1, currentHeight / 2);
    const inside = dx * dx + dy * dy <= 0.82;
    return inside ? [255, 255, 255, 255] : [0, 0, 0, 255];
  });
}

function createCleanPlateDataUrl(width, height, profileId) {
  const color = PROFILE_CLEAN_PLATE_COLOR[profileId] ?? [238, 242, 234, 255];
  return encodeRgbaPngDataUrl(width, height, () => color);
}

function createSubjectMattingResponse(request) {
  const rect = readSubjectRect(request);
  const area = rect.width * rect.height;
  const foregroundPixelCount = Math.max(1, Math.round(area * 0.74));

  return {
    kind: "subject_matting",
    result: {
      imageSrc: createSubjectMatteDataUrl(rect.width, rect.height),
      maskSrc: createSubjectMaskDataUrl(rect.width, rect.height),
      confidence: 0.94,
      hasAlpha: true,
      params: {
        provider: "Local HTTP JSON fixture subject matting",
        model: "fixture_ellipse_alpha_v1",
        foregroundPixelCount,
        detectedForegroundPixelCount: Math.max(1, foregroundPixelCount - 32),
        ellipseFallbackApplied: false,
        totalPixelCount: area,
        profileId: readProfileId(request),
      },
    },
  };
}

function createCleanPlateResponse(request) {
  const size = readImageSize(request);
  const rect = readSubjectRect(request);
  const profileId = readProfileId(request);
  const subjectArea = rect.width * rect.height;

  return {
    kind: "clean_plate",
    result: {
      src: createCleanPlateDataUrl(size.width, size.height, profileId),
      message:
        "Standalone HTTP JSON executor clean plate fixture；用于验证独立本地服务主链。",
      params: {
        provider: "Simple browser clean plate provider",
        model: "simple_neighbor_inpaint_v1",
        filledPixelCount: subjectArea,
        totalSubjectPixelCount: subjectArea,
        haloExpandedPixelCount: 0,
        maskApplied: true,
        profileId,
      },
    },
  };
}

function createTextOcrResponse(request) {
  const candidate = request?.input?.candidate;
  const rect = isRecord(candidate?.rect)
    ? candidate.rect
    : { x: 8, y: 10, width: 160, height: 36 };
  const profileId = readProfileId(request);

  return {
    kind: "text_ocr",
    result: [
      {
        text:
          profileId === "smoke-flat-image"
            ? WORKER_MODEL_SLOT_TEXT
            : PROFILE_TEXT[profileId] ?? WORKER_MODEL_SLOT_TEXT,
        boundingBox: {
          x: readNumber(rect.x, 8),
          y: readNumber(rect.y, 10),
          width: readNumber(rect.width, 160),
          height: readNumber(rect.height, 36),
        },
        confidence: 0.96,
        params: {
          provider: "Local HTTP JSON fixture OCR",
          model: "fixture_profile_text_v1",
          profileId,
        },
      },
    ],
  };
}

function createFixtureResponse(request) {
  if (request.kind === "subject_matting") {
    return createSubjectMattingResponse(request);
  }
  if (request.kind === "clean_plate") {
    return createCleanPlateResponse(request);
  }
  if (request.kind === "text_ocr") {
    return createTextOcrResponse(request);
  }

  return {
    kind: request.kind ?? "unknown",
    result: {
      imageSrc: TRANSPARENT_PIXEL_PNG_DATA_URL,
      params: { unsupportedKind: request.kind ?? null },
    },
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

function writeJsonResponse(response, statusCode, body) {
  response.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type,x-lime-smoke-analyzer",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

async function startFixtureServer(options) {
  const requests = [];
  let server = null;

  server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type,x-lime-smoke-analyzer",
      });
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === "/__requests") {
      writeJsonResponse(response, 200, { requests });
      return;
    }

    if (request.method === "POST" && request.url === "/__shutdown") {
      writeJsonResponse(response, 200, { ok: true });
      setImmediate(() => {
        server.close(() => process.exit(0));
      });
      return;
    }

    if (request.method !== "POST" || request.url !== options.path) {
      writeJsonResponse(response, 404, { error: "not_found" });
      return;
    }

    try {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body);
      requests.push(payload);
      writeJsonResponse(response, 200, createFixtureResponse(payload));
    } catch (error) {
      writeJsonResponse(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
  });

  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("fixture 未能监听端口");
  }

  const baseUrl = `http://${options.host}:${address.port}`;
  return {
    endpointUrl: `${baseUrl}${options.path}`,
    requestsUrl: `${baseUrl}/__requests`,
    shutdownUrl: `${baseUrl}/__shutdown`,
    requests,
    close: async () =>
      await new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function runSelfTest(options) {
  const fixture = await startFixtureServer(options);
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        HTTP_JSON_EXECUTOR_VERIFIER_PATH,
        "--endpoint-url",
        fixture.endpointUrl,
        "--timeout-ms",
        String(DEFAULT_TIMEOUT_MS),
      ],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    const verifier = JSON.parse(stdout);
    console.log(
      JSON.stringify(
        {
          ok: true,
          endpointUrl: fixture.endpointUrl,
          verifier,
          requestsSeen: fixture.requests.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await fixture.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    await runSelfTest(options);
    return;
  }

  const fixture = await startFixtureServer(options);
  console.log(
    JSON.stringify({
      type: "ready",
      endpointUrl: fixture.endpointUrl,
      requestsUrl: fixture.requestsUrl,
      shutdownUrl: fixture.shutdownUrl,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
