#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const DEFAULT_TIMEOUT_MS = 90_000;
const DESIGN_TOOL_SCHEMA_VERSION =
  "layered-design-design-tool-interoperability@1";

function printHelp() {
  console.log(`
Layered Design Photopea Open Verifier

用途:
  使用 Photopea Web 工具真实打开 trial.psd，并验证图层列表与 psd-like-manifest.json 对齐。

用法:
  node scripts/verify-layered-design-photopea-open.mjs \
    --psd <trial.psd> \
    --psd-like-manifest <psd-like-manifest.json> \
    --output <design-tool-interoperability.json>

选项:
  --psd <path>                 trial.psd 路径
  --psd-like-manifest <path>   psd-like-manifest.json 路径
  --output <path>              可选，写出 design-tool-interoperability evidence JSON
  --screenshot <path>          可选，保存 Photopea 打开后的截图
  --timeout-ms <ms>            每阶段超时，默认 ${DEFAULT_TIMEOUT_MS}
  -h, --help                   显示帮助
`);
}

function parseArgs(argv) {
  const options = {
    psdPath: "",
    psdLikeManifestPath: "",
    outputPath: "",
    screenshotPath: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--psd") {
      options.psdPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--psd-like-manifest") {
      options.psdLikeManifestPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--screenshot") {
      options.screenshotPath = argv[index + 1] ?? "";
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

  if (!options.psdPath) {
    throw new Error("必须传入 --psd");
  }
  if (!options.psdLikeManifestPath) {
    throw new Error("必须传入 --psd-like-manifest");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 10_000) {
    throw new Error("--timeout-ms 必须是 >= 10000 的数字");
  }

  return options;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function truncateTextForLayerName(text) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
}

function resolveExpectedManifestLayerName(layer) {
  const name = String(layer.name ?? "");
  const text = typeof layer.text?.text === "string" ? layer.text.text : "";
  if (layer.type !== "text" || !text) {
    return name;
  }
  const textPreview = truncateTextForLayerName(text);
  if (!textPreview || name.includes(textPreview)) {
    return name;
  }
  return `${name} · ${textPreview}`;
}

function readManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert(Array.isArray(manifest.layers), "psd-like manifest 缺少 layers 数组");
  return manifest;
}

async function createOuterPageServer() {
  const html = `<!doctype html><html><body style="margin:0"><iframe id="pp" src="https://www.photopea.com#{}" style="width:100vw;height:100vh;border:0"></iframe><script>window.__messages=[];window.addEventListener('message',function(e){window.__messages.push(e.data);});</script></body></html>`;
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch (chromeError) {
    console.warn(
      `[photopea-open] Chrome channel 启动失败，尝试 Playwright Chromium: ${
        chromeError instanceof Error ? chromeError.message : String(chromeError)
      }`,
    );
    return await chromium.launch({ headless: true });
  }
}

async function waitForDone(page, timeoutMs) {
  await page.waitForFunction(
    () => window.__messages.includes("done"),
    undefined,
    { timeout: timeoutMs },
  );
}

async function waitForPhotopeaResult(page, timeoutMs) {
  await page.waitForFunction(
    () =>
      window.__messages.some(
        (message) =>
          typeof message === "string" &&
          message.startsWith('{"type":"LIME_PHOTOPEA_OPEN"'),
      ),
    undefined,
    { timeout: timeoutMs },
  );
  const rawResult = await page.evaluate(() =>
    window.__messages.find(
      (message) =>
        typeof message === "string" &&
        message.startsWith('{"type":"LIME_PHOTOPEA_OPEN"'),
    ),
  );
  return JSON.parse(rawResult);
}

function createPhotopeaInspectionScript() {
  return `var doc=app.activeDocument;var out={type:'LIME_PHOTOPEA_OPEN',layerCount:doc.layers.length,layers:[]};for(var i=0;i<doc.layers.length;i++){var l=doc.layers[i];var bounds=[];try{for(var j=0;j<4;j++){bounds.push(l.bounds[j].value);}}catch(e){bounds=[];}out.layers.push({name:l.name,visible:l.visible,opacity:l.opacity,typename:l.typename,bounds:bounds});}app.echoToOE(JSON.stringify(out));`;
}

function arraysEqual(left, right) {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function hasTransparentCanvasAroundLayer(layer, canvasWidth, canvasHeight) {
  if (!Array.isArray(layer.bounds) || layer.bounds.length !== 4) {
    return false;
  }
  const [left, top, right, bottom] = layer.bounds;
  return left > 0 || top > 0 || right < canvasWidth || bottom < canvasHeight;
}

function createEvidence({
  psdPath,
  manifestPath,
  manifest,
  photopeaResult,
  screenshotPath,
}) {
  const manifestLayerNames = manifest.layers.map(resolveExpectedManifestLayerName);
  const manifestVisible = manifest.layers.map((layer) => layer.visible !== false);
  const expectedPanelLayerNames = [...manifestLayerNames].reverse();
  const expectedPanelVisible = [...manifestVisible].reverse();
  const photopeaLayerNames = photopeaResult.layers.map((layer) => layer.name);
  const photopeaVisible = photopeaResult.layers.map((layer) => layer.visible !== false);
  const textLayerNames = manifest.layers
    .filter((layer) => layer.type === "text")
    .map(resolveExpectedManifestLayerName);
  const canvasWidth = Number(manifest.canvas?.width ?? 0);
  const canvasHeight = Number(manifest.canvas?.height ?? 0);
  const checks = {
    opensFile: photopeaResult.layerCount > 0,
    layerListVisible: photopeaResult.layers.length > 0,
    layerCountMatchesManifest: photopeaResult.layerCount === manifest.layers.length,
    layerNamesMatchManifest: arraysEqual(photopeaLayerNames, expectedPanelLayerNames),
    visibilityMatchesManifest: arraysEqual(photopeaVisible, expectedPanelVisible),
    transparentPixelsVisible:
      canvasWidth > 0 &&
      canvasHeight > 0 &&
      photopeaResult.layers.some((layer) =>
        hasTransparentCanvasAroundLayer(layer, canvasWidth, canvasHeight),
      ),
    textLayersIdentifiable: textLayerNames.every((name) =>
      photopeaLayerNames.includes(name),
    ),
  };
  const status = Object.values(checks).every(Boolean) ? "passed" : "failed";

  return {
    schemaVersion: DESIGN_TOOL_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    sourceExportDirectory: path.dirname(psdPath),
    trialPsdPath: psdPath,
    psdLikeManifestPath: manifestPath,
    tools: [
      {
        tool: "photopea",
        toolVersion: "photopea-web-live-api",
        openedAt: new Date().toISOString(),
        status,
        checks,
        evidenceFiles: screenshotPath ? [screenshotPath] : [],
        observed: {
          layerCount: photopeaResult.layerCount,
          layerNames: photopeaLayerNames,
          layerPanelOrder: "top_to_bottom",
          layers: photopeaResult.layers,
        },
      },
    ],
  };
}

async function verifyPhotopeaOpen(options) {
  const psdPath = path.resolve(options.psdPath);
  const manifestPath = path.resolve(options.psdLikeManifestPath);
  const outputPath = options.outputPath ? path.resolve(options.outputPath) : "";
  const screenshotPath = options.screenshotPath
    ? path.resolve(options.screenshotPath)
    : outputPath
      ? path.join(path.dirname(outputPath), "photopea-layer-panel.png")
      : "";
  const manifest = readManifest(manifestPath);

  assert(fs.existsSync(psdPath), `trial.psd 不存在: ${psdPath}`);
  assert(fs.existsSync(manifestPath), `psd-like manifest 不存在: ${manifestPath}`);

  const server = await createOuterPageServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error(`[photopea-open:console] ${message.text()}`);
    }
  });

  try {
    const port = server.address().port;
    await page.goto(`http://127.0.0.1:${port}/`, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await waitForDone(page, options.timeoutMs);

    const psdBase64 = fs.readFileSync(psdPath).toString("base64");
    await page.evaluate((base64) => {
      window.__messages = [];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const buffer = bytes.buffer;
      document.getElementById("pp").contentWindow.postMessage(buffer, "*", [buffer]);
    }, psdBase64);
    await waitForDone(page, options.timeoutMs);

    await page.evaluate((script) => {
      window.__messages = [];
      document.getElementById("pp").contentWindow.postMessage(script, "*");
    }, createPhotopeaInspectionScript());
    const photopeaResult = await waitForPhotopeaResult(page, options.timeoutMs);

    if (screenshotPath) {
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: false });
    }

    const evidence = createEvidence({
      psdPath,
      manifestPath,
      manifest,
      photopeaResult,
      screenshotPath,
    });
    const tool = evidence.tools[0];

    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    }
    assert(
      tool.status === "passed",
      `Photopea 打开验证未通过: ${JSON.stringify(tool.checks)}`,
    );

    return evidence;
  } finally {
    await browser.close().catch(() => undefined);
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const evidence = await verifyPhotopeaOpen(options);
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
