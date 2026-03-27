#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULTS = {
  appUrl: "http://127.0.0.1:1420/",
  healthUrl: "http://127.0.0.1:3030/health",
  timeoutMs: 180_000,
  intervalMs: 1_000,
  reuseRunning: false,
  sampleProjectName: "Lime Smoke Workspace",
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const state = {
  child: null,
  cleanedUp: false,
};

function printHelp() {
  console.log(`
Lime GUI 冒烟入口

用途:
  启动或复用 headless Tauri 环境，串联 GUI 壳、DevBridge 与默认 workspace 的最小回归校验。

用法:
  npm run verify:gui-smoke
  npm run verify:gui-smoke -- --reuse-running
  npm run verify:gui-smoke -- --timeout-ms 180000

选项:
  --app-url <url>             前端地址，默认 http://127.0.0.1:1420/
  --health-url <url>          DevBridge 健康检查地址，默认 http://127.0.0.1:3030/health
  --timeout-ms <ms>           等待 headless / bridge / smoke 的超时，默认 180000
  --interval-ms <ms>          轮询间隔，默认 1000
  --sample-project-name <s>   workspace 路径校验使用的示例项目名
  --reuse-running             复用已启动的 headless Tauri，不主动拉起
  -h, --help                  显示帮助
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

    if (arg === "--sample-project-name" && argv[index + 1]) {
      options.sampleProjectName = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--reuse-running") {
      options.reuseRunning = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000) {
    throw new Error("--timeout-ms 必须是 >= 1000 的数字");
  }

  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 100) {
    throw new Error("--interval-ms 必须是 >= 100 的数字");
  }

  if (!options.appUrl) {
    throw new Error("--app-url 不能为空");
  }

  if (!options.healthUrl) {
    throw new Error("--health-url 不能为空");
  }

  if (!options.sampleProjectName) {
    throw new Error("--sample-project-name 不能为空");
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

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

function runCommand(command, args, label) {
  console.log(`\n[verify:gui-smoke] > ${formatCommand(command, args)}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    const error = new Error(`[verify:gui-smoke] ${label} 失败`);
    error.exitCode = result.status;
    throw error;
  }
}

function startHeadlessTauri() {
  console.log("[verify:gui-smoke] 启动 headless Tauri 环境...");
  state.child = spawn(npmCommand, ["run", "tauri:dev:headless"], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
    detached: process.platform !== "win32",
  });
}

async function stopHeadlessTauri() {
  const child = state.child;
  if (!child || state.cleanedUp) {
    return;
  }

  state.cleanedUp = true;
  console.log("[verify:gui-smoke] 停止 headless Tauri 环境...");

  if (typeof child.pid !== "number") {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      return;
    }
  }

  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (child.exitCode !== null || child.signalCode) {
      return;
    }
    await sleep(200);
  }

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
}

async function waitForAppShell(options) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < options.timeoutMs) {
    try {
      const response = await fetch(options.appUrl, { method: "GET" });
      const html = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      assert(
        html.includes("<title>Lime</title>") ||
          html.includes('<div id="root"></div>') ||
          html.includes('<div id="root"></div'),
        "前端首页返回成功，但未检测到 Lime 根页面标记",
      );

      console.log(
        `[verify:gui-smoke] 前端壳已就绪: ${options.appUrl} (${Date.now() - startedAt}ms)`,
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
    `[verify:gui-smoke] 前端壳未就绪: ${options.appUrl}。最后错误: ${detail}`,
  );
}

async function isUrlReady(url, timeoutMs) {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveStartupMode(options) {
  if (options.reuseRunning) {
    return {
      shouldStart: false,
      reusedExisting: true,
    };
  }

  const existingAppShell = await isUrlReady(options.appUrl, 1_500);
  if (!existingAppShell) {
    return {
      shouldStart: true,
      reusedExisting: false,
    };
  }

  const existingBridge = await isUrlReady(options.healthUrl, 1_500);
  if (existingBridge) {
    console.log(
      "[verify:gui-smoke] 检测到已有 headless 环境，自动复用现有前端与 DevBridge。",
    );
    return {
      shouldStart: false,
      reusedExisting: true,
    };
  }

  throw new Error(
    `[verify:gui-smoke] 检测到已有前端 dev server 正在占用 ${options.appUrl}，但 DevBridge 尚未就绪（${options.healthUrl}）。请先关闭现有 dev server，或启动完整 headless 环境后使用 --reuse-running。`,
  );
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node 运行时不支持 fetch，请使用 Node 18+");
  }

  const options = parseArgs(process.argv.slice(2));
  const startupMode = await resolveStartupMode(options);
  const startedByScript = startupMode.shouldStart;

  const handleSignal = async (signal) => {
    try {
      await stopHeadlessTauri();
    } finally {
      process.kill(process.pid, signal);
    }
  };

  process.once("SIGINT", () => {
    void handleSignal("SIGINT");
  });
  process.once("SIGTERM", () => {
    void handleSignal("SIGTERM");
  });

  try {
    if (startedByScript) {
      startHeadlessTauri();
      await sleep(1_500);
    } else if (startupMode.reusedExisting) {
      console.log("[verify:gui-smoke] 复用已运行的 headless Tauri 环境。");
    }

    runCommand(
      npmCommand,
      [
        "run",
        "bridge:health",
        "--",
        "--url",
        options.healthUrl,
        "--timeout-ms",
        String(options.timeoutMs),
        "--interval-ms",
        String(options.intervalMs),
      ],
      "bridge:health",
    );

    await waitForAppShell(options);

    runCommand(
      npmCommand,
      [
        "run",
        "smoke:workspace-ready",
        "--",
        "--timeout-ms",
        String(options.timeoutMs),
        "--interval-ms",
        String(options.intervalMs),
        "--sample-project-name",
        options.sampleProjectName,
      ],
      "smoke:workspace-ready",
    );

    runCommand(
      npmCommand,
      [
        "run",
        "smoke:browser-runtime",
        "--",
        "--timeout-ms",
        String(options.timeoutMs),
        "--interval-ms",
        String(options.intervalMs),
      ],
      "smoke:browser-runtime",
    );

    runCommand(
      npmCommand,
      [
        "run",
        "smoke:site-adapters",
        "--",
        "--timeout-ms",
        String(options.timeoutMs),
        "--interval-ms",
        String(options.intervalMs),
      ],
      "smoke:site-adapters",
    );

    console.log("\n[verify:gui-smoke] 通过");
  } finally {
    if (startedByScript) {
      await stopHeadlessTauri();
    }
  }
}

main().catch((error) => {
  const exitCode =
    typeof error?.exitCode === "number" && error.exitCode > 0
      ? error.exitCode
      : 1;
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(exitCode);
});
