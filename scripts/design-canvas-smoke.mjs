#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const DEFAULTS = {
  appUrl: "http://127.0.0.1:1420/",
  healthUrl: "http://127.0.0.1:3030/health",
  invokeUrl: "http://127.0.0.1:3030/invoke",
  timeoutMs: 180_000,
  intervalMs: 1_000,
};

const ACTION_TIMEOUT_MS = 45_000;
const POST_HEALTH_SETTLE_MS = 1_000;

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

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
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

function buildSmokeUrl(options, workspace) {
  const url = new URL("/design-canvas-smoke", options.appUrl);
  url.searchParams.set("projectRootPath", workspace.rootPath);
  url.searchParams.set("projectId", workspace.projectId);
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
    await waitForText(page, "画布标题", "Smoke 图层设计海报");
    await waitForText(page, "图层栏", "图层");
    await waitForText(page, "属性栏", "属性");
    await waitForText(page, "生成入口", "生成全部图片层");
    await waitForText(page, "刷新入口", "刷新生成结果");
    await waitForText(page, "单层重生成入口", "重生成当前层");
    await waitForText(page, "导出入口", "导出设计工程");

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
  const smokeUrl = buildSmokeUrl(options, workspace);

  await runPageFlow(options, smokeUrl);

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
