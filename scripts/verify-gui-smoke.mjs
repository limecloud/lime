#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const LIME_SKIP_STARTUP_WINDOW_REVEAL = "LIME_SKIP_STARTUP_WINDOW_REVEAL";
const LIME_DISABLE_SINGLE_INSTANCE = "LIME_DISABLE_SINGLE_INSTANCE";
const LIME_WEB_BRIDGE_REUSE_EXISTING_ONLY =
  "LIME_WEB_BRIDGE_REUSE_EXISTING_ONLY";
const LIME_WEB_BRIDGE_URL = "LIME_WEB_BRIDGE_URL";
const DEFAULT_HEALTH_URL = "http://127.0.0.1:3030/health";
const ROOT_MARKERS = ["<title>Lime</title>", '<div id="root"></div>'];
const SHARED_TAURI_TARGET_DIR = path.join(rootDir, "src-tauri", "target");
const ISOLATED_GUI_SMOKE_TARGET_DIR = path.join(
  os.tmpdir(),
  "lime-gui-smoke-target",
);
const GUI_SMOKE_TARGET_REBUILD_PREFIX = "rebuild";
const GUI_SMOKE_TEMP_CONFIG_BASENAME_PREFIX = "lime-gui-smoke-tauri-";
const GUI_SMOKE_COLD_TIMEOUT_MS = 1_800_000;
const GUI_SMOKE_WARM_TIMEOUT_MS = 600_000;
const GUI_SMOKE_BRIDGE_HEARTBEAT_MS = 30_000;
const GUI_SMOKE_COMPILE_GRACE_MS = 900_000;
const GUI_SMOKE_MAX_COMPILE_GRACE_EXTENSIONS = 2;
const GUI_SMOKE_BOOT_GRACE_MS = 60_000;
const GUI_SMOKE_CHILD_EXIT_GRACE_MS = 30_000;
const INVOKE_TIMEOUT_CEILING_MS = 180_000;
const INVOKE_RETRY_COUNT = 10;
const INVOKE_RETRY_DELAY_MS = 1_000;
const HEADLESS_TAURI_CONFIG_PATH = path.join(
  rootDir,
  "src-tauri",
  "tauri.conf.headless.json",
);
const tauriCommand =
  process.platform === "win32"
    ? path.join(rootDir, "node_modules", ".bin", "tauri.cmd")
    : path.join(rootDir, "node_modules", ".bin", "tauri");

const state = {
  child: null,
  cleanedUp: false,
  tempConfigPath: null,
};

function resolveTargetBinaryPath(targetDir) {
  const appBinaryName = process.platform === "win32" ? "lime.exe" : "lime";
  return path.join(targetDir, "debug", appBinaryName);
}

function listTargetLockHolderCommands(targetDir) {
  if (process.platform === "win32") {
    return [];
  }

  const lockPath = path.join(targetDir, "debug", ".cargo-lock");
  const pidOutput = runQuietCommand("lsof", ["-t", "--", lockPath]);
  if (!pidOutput) {
    return [];
  }

  const pids = [
    ...new Set(
      pidOutput
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];

  return pids
    .map((pid) => runQuietCommand("ps", ["-p", pid, "-o", "command="]))
    .filter(Boolean);
}

function resolvePreferredCargoTargetDir() {
  const sharedTargetLockHolders = listTargetLockHolderCommands(
    SHARED_TAURI_TARGET_DIR,
  );
  if (sharedTargetLockHolders.length === 0) {
    return SHARED_TAURI_TARGET_DIR;
  }

  return ISOLATED_GUI_SMOKE_TARGET_DIR;
}

function resolveDefaultTimeoutMs(cargoTargetDir) {
  const binaryPath = resolveTargetBinaryPath(cargoTargetDir);
  return fs.existsSync(binaryPath)
    ? GUI_SMOKE_WARM_TIMEOUT_MS
    : GUI_SMOKE_COLD_TIMEOUT_MS;
}

function listSqliteBuildOutputDirs(targetDir) {
  const buildDir = path.join(targetDir, "debug", "build");
  if (!fs.existsSync(buildDir)) {
    return [];
  }

  return fs
    .readdirSync(buildDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith("libsqlite3-sys-"),
    )
    .map((entry) => path.join(buildDir, entry.name, "out"))
    .filter((outDir) => fs.existsSync(outDir) && fs.statSync(outDir).isDirectory())
    .sort();
}

function listCorruptedSqliteBindingOutputs(targetDir) {
  return listSqliteBuildOutputDirs(targetDir)
    .filter((outDir) => !fs.existsSync(path.join(outDir, "bindgen.rs")))
    .map((outDir) => ({
      outDir,
      relativeOutDir: path.relative(targetDir, outDir) || outDir,
    }));
}

function allocateFreshCargoTargetDir(targetDir) {
  const parentDir = path.dirname(targetDir);
  const baseName = path.basename(targetDir);
  const suffix = `${GUI_SMOKE_TARGET_REBUILD_PREFIX}-${Date.now()}-${process.pid}`;
  return path.join(parentDir, `${baseName}-${suffix}`);
}

function normalizeCargoTargetDir(parsedOptions) {
  const normalizedOptions = {
    ...parsedOptions,
    cargoTargetDir: path.resolve(parsedOptions.cargoTargetDir),
    cargoTargetDirRequested: path.resolve(parsedOptions.cargoTargetDir),
    cargoTargetDirFallbackReason: "",
    corruptedSqliteBindingOutputs: [],
  };
  const corruptedOutputs = listCorruptedSqliteBindingOutputs(
    normalizedOptions.cargoTargetDir,
  );

  if (corruptedOutputs.length > 0) {
    normalizedOptions.cargoTargetDir = allocateFreshCargoTargetDir(
      normalizedOptions.cargoTargetDir,
    );
    normalizedOptions.cargoTargetDirFallbackReason =
      "detected-corrupted-sqlite-bindings";
    normalizedOptions.corruptedSqliteBindingOutputs = corruptedOutputs;
  }

  if (!normalizedOptions.timeoutExplicit) {
    normalizedOptions.timeoutMs = resolveDefaultTimeoutMs(
      normalizedOptions.cargoTargetDir,
    );
  }

  return normalizedOptions;
}

const DEFAULTS = {
  appUrl: "http://127.0.0.1:1420/",
  healthUrl: DEFAULT_HEALTH_URL,
  invokeUrl: "http://127.0.0.1:3030/invoke",
  cargoTargetDir: resolvePreferredCargoTargetDir(),
  intervalMs: 1_000,
  reuseRunning: false,
  sampleProjectName: "Lime Smoke Workspace",
};
DEFAULTS.timeoutMs = resolveDefaultTimeoutMs(DEFAULTS.cargoTargetDir);

function resolveInvokeUrl(healthUrl) {
  try {
    const url = new URL(healthUrl);
    url.pathname = "/invoke";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "http://127.0.0.1:3030/invoke";
  }
}

function printHelp() {
  console.log(`
Lime GUI 冒烟入口

用途:
  启动或复用 headless Tauri 环境，串联 GUI 壳、DevBridge 与默认 workspace 的最小回归校验。

用法:
  npm run verify:gui-smoke
  npm run verify:gui-smoke -- --reuse-running
  npm run verify:gui-smoke -- --timeout-ms 600000

选项:
  --app-url <url>             前端地址，默认 http://127.0.0.1:1420/
  --health-url <url>          DevBridge 健康检查地址，默认 http://127.0.0.1:3030/health
  --invoke-url <url>          DevBridge invoke 地址，默认随 health-url 推导 /invoke
  --timeout-ms <ms>           等待 headless / bridge / smoke 的超时，默认冷启动 1800000 / 热启动 600000
  --interval-ms <ms>          轮询间隔，默认 1000
  --sample-project-name <s>   workspace 路径校验使用的示例项目名
  --cargo-target-dir <dir>    指定 Cargo target 目录；默认优先复用 src-tauri/target，无锁时共享，否则回退独立 GUI smoke target
  --reuse-running             复用已启动的 headless Tauri，不主动拉起
  -h, --help                  显示帮助
`);
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, timeoutExplicit: false };
  let invokeUrlExplicit = false;

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
      invokeUrlExplicit = true;
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms" && argv[index + 1]) {
      options.timeoutMs = Number(argv[index + 1]);
      options.timeoutExplicit = true;
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

    if (arg === "--cargo-target-dir" && argv[index + 1]) {
      options.cargoTargetDir = String(argv[index + 1]).trim();
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

  if (!invokeUrlExplicit) {
    options.invokeUrl = resolveInvokeUrl(options.healthUrl);
  }
  if (!options.invokeUrl) {
    throw new Error("--invoke-url 不能为空");
  }

  if (!options.sampleProjectName) {
    throw new Error("--sample-project-name 不能为空");
  }

  if (!options.cargoTargetDir) {
    throw new Error("--cargo-target-dir 不能为空");
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientInvokeError(error) {
  return (
    error?.name === "TimeoutError" ||
    (error instanceof TypeError && error.message === "fetch failed")
  );
}

async function invokeBridgeCommand(options, cmd, args) {
  const invokeTimeoutMs = Math.min(options.timeoutMs, INVOKE_TIMEOUT_CEILING_MS);
  const requestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ cmd, args }),
    signal: AbortSignal.timeout(invokeTimeoutMs),
  };

  for (let attempt = 1; attempt <= INVOKE_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(options.invokeUrl, requestInit);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const payload = await response.json();
      if (payload?.error) {
        throw new Error(String(payload.error));
      }
      return payload?.result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!isTransientInvokeError(error) || attempt >= INVOKE_RETRY_COUNT) {
        if (error?.name === "TimeoutError") {
          throw new Error(
            `[verify:gui-smoke] ${cmd} 超时，${invokeTimeoutMs}ms 内未收到 DevBridge 响应`,
          );
        }
        throw new Error(`[verify:gui-smoke] ${cmd} 请求失败: ${detail}`);
      }

      console.warn(
        `[verify:gui-smoke] ${cmd} 第 ${attempt} 次请求失败，${INVOKE_RETRY_DELAY_MS}ms 后重试: ${detail}`,
      );
      await sleep(INVOKE_RETRY_DELAY_MS);
    }
  }

  throw new Error(`[verify:gui-smoke] ${cmd} 请求失败: unknown error`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isLimeDevShell(html) {
  return ROOT_MARKERS.some((marker) => html.includes(marker));
}

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function buildNoopBeforeDevCommand() {
  return `"${process.execPath}" -e "process.exit(0)"`;
}

function runCommand(command, args, label, timeoutMs) {
  console.log(`\n[verify:gui-smoke] > ${formatCommand(command, args)}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
    timeout: timeoutMs,
  });

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      const error = new Error(
        `[verify:gui-smoke] ${label} 超时（>${timeoutMs}ms）`,
      );
      error.exitCode = 124;
      throw error;
    }
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    const error = new Error(`[verify:gui-smoke] ${label} 失败`);
    error.exitCode = result.status;
    throw error;
  }
}

function createHeadlessTauriConfig(options, startupMode) {
  const rawConfig = fs.readFileSync(HEADLESS_TAURI_CONFIG_PATH, "utf8");
  const config = JSON.parse(rawConfig);

  config.build = {
    ...(config.build || {}),
    devUrl: trimTrailingSlash(options.appUrl),
  };

  if (startupMode.reuseExistingAppShell) {
    config.build.beforeDevCommand = buildNoopBeforeDevCommand();
  }

  const tempConfigPath = path.join(
    os.tmpdir(),
    `lime-gui-smoke-tauri-${process.pid}.json`,
  );
  fs.writeFileSync(tempConfigPath, JSON.stringify(config, null, 2));
  state.tempConfigPath = tempConfigPath;
  return tempConfigPath;
}

function resolveUrlPort(url) {
  try {
    return new URL(url).port || (url.startsWith("https:") ? "443" : "80");
  } catch {
    return "";
  }
}

function runQuietCommand(command, args) {
  try {
    return spawnSync(command, args, {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      encoding: "utf8",
    }).stdout.trim();
  } catch {
    return "";
  }
}

function listProcessTable() {
  if (process.platform === "win32") {
    return [];
  }

  const output = runQuietCommand("ps", ["-axo", "pid=,ppid=,pgid=,command="]);
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) {
        return null;
      }

      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        pgid: Number(match[3]),
        command: match[4],
      };
    })
    .filter(Boolean);
}

function listProcessStats() {
  if (process.platform === "win32") {
    return [];
  }

  const output = runQuietCommand("ps", [
    "-axo",
    "pid=,ppid=,pgid=,%cpu=,%mem=,etime=,stat=,command=",
  ]);
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(
        /^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(\S+)\s+(.*)$/,
      );
      if (!match) {
        return null;
      }

      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        pgid: Number(match[3]),
        cpu: Number(match[4]),
        mem: Number(match[5]),
        etime: match[6],
        stat: match[7],
        command: match[8],
      };
    })
    .filter(Boolean);
}

function isGuiSmokeVerifierCommand(command) {
  return (
    command.includes("scripts/verify-gui-smoke.mjs") ||
    command.includes("npm run verify:gui-smoke")
  );
}

function isGuiSmokeTauriCommand(command) {
  return (
    command.includes("tauri dev") &&
    command.includes(GUI_SMOKE_TEMP_CONFIG_BASENAME_PREFIX)
  );
}

function summarizeGuiSmokeProcessCommand(command) {
  if (command.includes("/bin/rustc")) {
    return "rustc";
  }

  if (command.includes("cargo run --no-default-features")) {
    return "cargo";
  }

  if (command.includes("tauri dev")) {
    return "tauri";
  }

  if (command.includes("start-web-bridge-dev.mjs")) {
    return "web-bridge";
  }

  if (command.includes("npm run dev:web-bridge")) {
    return "npm:dev:web-bridge";
  }

  if (command.includes("npm exec vite") || command.includes("/bin/vite")) {
    return "vite";
  }

  return command.split(/\s+/)[0]?.split("/").pop() || "process";
}

function resolveGuiSmokeProcessGroupId(startedByScript) {
  if (startedByScript && typeof state.child?.pid === "number") {
    return state.child.pid;
  }

  const snapshot = inspectGuiSmokeTauriProcesses();
  const firstActive = snapshot.active[0];
  return firstActive ? firstActive.pgid || firstActive.pid : null;
}

function listGuiSmokeGroupProcesses(startedByScript) {
  const targetGroupId = resolveGuiSmokeProcessGroupId(startedByScript);
  if (!Number.isInteger(targetGroupId) || targetGroupId < 1) {
    return [];
  }

  return listProcessStats().filter((item) => item.pgid === targetGroupId);
}

function isZombieProcess(item) {
  return typeof item?.stat === "string" && item.stat.includes("Z");
}

function listActiveGuiSmokeGroupProcesses(startedByScript) {
  return listGuiSmokeGroupProcesses(startedByScript).filter(
    (item) => !isZombieProcess(item),
  );
}

function hasActiveGuiSmokeProcesses(startedByScript) {
  return listActiveGuiSmokeGroupProcesses(startedByScript).length > 0;
}

function hasActiveGuiSmokeCompile(startedByScript) {
  return listActiveGuiSmokeGroupProcesses(startedByScript).some(
    (item) =>
      item.command.includes("/bin/rustc") ||
      item.command.includes("cargo run --no-default-features"),
  );
}

function describeGuiSmokeHeartbeat(startedByScript) {
  const interestingProcesses = listActiveGuiSmokeGroupProcesses(startedByScript)
    .filter(
      (item) =>
        item.command.includes("tauri dev") ||
        item.command.includes("cargo run --no-default-features") ||
        item.command.includes("/bin/rustc") ||
        item.command.includes("start-web-bridge-dev.mjs") ||
        item.command.includes("npm run dev:web-bridge") ||
        item.command.includes("npm exec vite") ||
        item.command.includes("/bin/vite"),
    )
    .sort((left, right) => right.cpu - left.cpu || left.pid - right.pid)
    .slice(0, 5);

  if (interestingProcesses.length === 0) {
    return "";
  }

  return interestingProcesses
    .map((item) => {
      const cpu = Number.isFinite(item.cpu) ? item.cpu.toFixed(1) : "0.0";
      return `${summarizeGuiSmokeProcessCommand(item.command)} pid=${item.pid} etime=${item.etime} cpu=${cpu}% stat=${item.stat}`;
    })
    .join(" | ");
}

function inspectGuiSmokeTauriProcesses() {
  const processTable = listProcessTable();
  const processByPid = new Map(processTable.map((item) => [item.pid, item]));
  const active = [];
  const stale = [];

  for (const item of processTable) {
    if (!isGuiSmokeTauriCommand(item.command)) {
      continue;
    }

    if (item.pid === process.pid) {
      continue;
    }

    const parent = processByPid.get(item.ppid);
    if (!parent || !isGuiSmokeVerifierCommand(parent.command)) {
      stale.push(item);
      continue;
    }

    active.push(item);
  }

  return { active, stale };
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcessTree(pid, signal) {
  if (!Number.isInteger(pid) || pid < 1) {
    return;
  }

  if (process.platform === "win32") {
    if (signal === "SIGKILL") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
      return;
    }

    spawnSync("taskkill", ["/pid", String(pid), "/T"], {
      stdio: "ignore",
    });
    return;
  }

  const target = `-${pid}`;
  spawnSync("kill", [`-${signal}`, target], {
    stdio: "ignore",
  });
}

async function stopProcessTree(pid, label) {
  if (!Number.isInteger(pid) || pid < 1) {
    return;
  }

  console.log(`[verify:gui-smoke] 清理残留 ${label} 进程组: ${pid}`);
  signalProcessTree(pid, "SIGTERM");

  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await sleep(200);
  }

  signalProcessTree(pid, "SIGKILL");
}

async function cleanupStaleGuiSmokeProcesses() {
  const snapshot = inspectGuiSmokeTauriProcesses();
  if (snapshot.stale.length === 0) {
    return 0;
  }

  for (const item of snapshot.stale) {
    const groupPid = item.pgid || item.pid;
    await stopProcessTree(groupPid, `GUI smoke Tauri(PID=${item.pid})`);
  }

  return snapshot.stale.length;
}

async function cleanupStaleGuiSmokeChromeProfiles(
  options,
  { label, required, skipIfBridgeUnavailable = false },
) {
  if (
    skipIfBridgeUnavailable &&
    !(await isUrlReady(options.healthUrl, Math.min(options.intervalMs, 1_500)))
  ) {
    console.warn(`[verify:gui-smoke] ${label}: DevBridge 未就绪，跳过。`);
    return null;
  }

  try {
    const result = await invokeBridgeCommand(
      options,
      "cleanup_gui_smoke_chrome_profiles",
    );
    const matchedProfiles = Array.isArray(result?.matched_profiles)
      ? result.matched_profiles
      : [];
    const removedProfiles = Array.isArray(result?.removed_profiles)
      ? result.removed_profiles
      : [];
    const skippedProfiles = Array.isArray(result?.skipped_profiles)
      ? result.skipped_profiles
      : [];
    const terminatedProcessCount = Number.isFinite(
      result?.terminated_process_count,
    )
      ? Number(result.terminated_process_count)
      : 0;

    if (matchedProfiles.length === 0) {
      return result;
    }

    console.log(
      `[verify:gui-smoke] ${label}: 匹配 ${matchedProfiles.length} 个 smoke Chrome profiles，删除 ${removedProfiles.length} 个目录，结束 ${terminatedProcessCount} 个残留进程。`,
    );
    if (skippedProfiles.length > 0) {
      console.warn(
        `[verify:gui-smoke] ${label}: 仍有 ${skippedProfiles.length} 个 profile 未删掉：${skippedProfiles.join(", ")}`,
      );
    }
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (required) {
      throw error;
    }
    console.warn(`[verify:gui-smoke] ${label}: ${detail}`);
    return null;
  }
}

function listListeningCommandsForPort(port) {
  if (!port || process.platform === "win32") {
    return [];
  }

  const pidOutput = runQuietCommand("lsof", [
    "-nP",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
    "-t",
  ]);
  if (!pidOutput) {
    return [];
  }

  const pids = [
    ...new Set(
      pidOutput
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  return pids
    .map((pid) => runQuietCommand("ps", ["-p", pid, "-o", "command="]))
    .filter(Boolean);
}

function isLikelyLimeFrontendListener(command) {
  return (
    command.includes(rootDir) &&
    (command.includes("vite") ||
      command.includes("npm run dev") ||
      command.includes("tauri dev"))
  );
}

function startHeadlessTauri(options, startupMode) {
  console.log("[verify:gui-smoke] 启动 headless Tauri 环境...");
  runCommand(
    npmCommand,
    ["run", "generate:agent-runtime-clients"],
    "generate:agent-runtime-clients",
    options.timeoutMs,
  );
  runCommand(
    npmCommand,
    ["run", "generate:extension-site-adapters"],
    "generate:extension-site-adapters",
    options.timeoutMs,
  );
  const tauriConfigPath = createHeadlessTauriConfig(options, startupMode);

  state.child = spawn(
    tauriCommand,
    ["dev", "--no-watch", "--config", tauriConfigPath],
    {
      cwd: rootDir,
      stdio: "inherit",
      env: {
        ...process.env,
        CARGO_TARGET_DIR: options.cargoTargetDir,
        [LIME_SKIP_STARTUP_WINDOW_REVEAL]: "1",
        [LIME_DISABLE_SINGLE_INSTANCE]: "1",
        [LIME_WEB_BRIDGE_URL]: options.appUrl,
        ...(startupMode.reuseExistingAppShell
          ? {
              [LIME_WEB_BRIDGE_REUSE_EXISTING_ONLY]: "1",
            }
          : {}),
      },
      detached: process.platform !== "win32",
    },
  );
}

async function stopHeadlessTauri() {
  const child = state.child;
  if (state.cleanedUp) {
    return;
  }

  state.cleanedUp = true;
  if (child) {
    console.log("[verify:gui-smoke] 停止 headless Tauri 环境...");
  }

  if (typeof child?.pid === "number") {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      }

      for (let attempt = 0; attempt < 25; attempt += 1) {
        if (child.exitCode !== null || child.signalCode) {
          break;
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
  }

  try {
    if (state.tempConfigPath) {
      fs.unlinkSync(state.tempConfigPath);
    }
  } catch {
    // ignore
  }

  state.tempConfigPath = null;
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
        isLimeDevShell(html) || html.includes('<div id="root"></div'),
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

function describeChildExit(child) {
  if (!child) {
    return "unknown";
  }

  const parts = [];
  if (typeof child.exitCode === "number") {
    parts.push(`exitCode=${child.exitCode}`);
  }
  if (child.signalCode) {
    parts.push(`signal=${child.signalCode}`);
  }
  return parts.length > 0 ? parts.join(" ") : "unknown";
}

async function waitForBridgeHealth(options, startedByScript) {
  const startedAt = Date.now();
  let deadlineAt = startedAt + options.timeoutMs;
  let compileGraceCount = 0;
  let bootGraceUsed = false;
  let childExitObservedAt = null;
  let lastExitedChildLogAt = 0;
  let lastError = null;
  let lastHeartbeatAt = startedAt;

  console.log(`[bridge:health] 开始检查: ${options.healthUrl}`);

  while (true) {
    if (
      startedByScript &&
      state.child &&
      (typeof state.child.exitCode === "number" || state.child.signalCode)
    ) {
      const now = Date.now();
      if (childExitObservedAt === null) {
        childExitObservedAt = now;
      }

      const exitDetail = describeChildExit(state.child);
      const activeProcessCount = listActiveGuiSmokeGroupProcesses(
        startedByScript,
      ).length;
      const heartbeat = describeGuiSmokeHeartbeat(startedByScript);

      if (activeProcessCount > 0) {
        if (now - lastExitedChildLogAt >= GUI_SMOKE_BRIDGE_HEARTBEAT_MS) {
          lastExitedChildLogAt = now;
          console.log(
            `[bridge:health] headless Tauri 父进程已退出（${exitDetail}），但进程组仍有 ${activeProcessCount} 个活跃进程，继续等待 DevBridge${heartbeat ? `；进程组: ${heartbeat}` : ""}`,
          );
        }
      } else if (
        now - childExitObservedAt >= GUI_SMOKE_CHILD_EXIT_GRACE_MS
      ) {
        const lastDetail =
          lastError instanceof Error
            ? `；最近一次健康检查错误: ${lastError.message}`
            : "";
        throw new Error(
          `[verify:gui-smoke] headless Tauri 在 DevBridge 就绪前提前退出（${exitDetail}），且 ${GUI_SMOKE_CHILD_EXIT_GRACE_MS}ms 内未检测到仍在运行的 GUI smoke 进程组${lastDetail}`,
        );
      } else if (now - lastExitedChildLogAt >= GUI_SMOKE_BRIDGE_HEARTBEAT_MS) {
        lastExitedChildLogAt = now;
        console.log(
          `[bridge:health] headless Tauri 父进程已退出（${exitDetail}），等待最多 ${GUI_SMOKE_CHILD_EXIT_GRACE_MS}ms 确认是否还有后续启动链。`,
        );
      }
    }

    try {
      const response = await fetch(options.healthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(Math.min(options.intervalMs, 1_500)),
      });
      const text = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }

      const elapsed = Date.now() - startedAt;
      const status =
        payload && typeof payload === "object" ? payload.status : undefined;
      console.log(
        `[bridge:health] 就绪: ${options.healthUrl} (${elapsed}ms)${status ? ` status=${status}` : ""}`,
      );
      return;
    } catch (error) {
      lastError = error;
      const heartbeatAt = Date.now();
      if (heartbeatAt >= deadlineAt) {
        const heartbeat = describeGuiSmokeHeartbeat(startedByScript);
        if (
          compileGraceCount < GUI_SMOKE_MAX_COMPILE_GRACE_EXTENSIONS &&
          hasActiveGuiSmokeCompile(startedByScript)
        ) {
          compileGraceCount += 1;
          deadlineAt = heartbeatAt + GUI_SMOKE_COMPILE_GRACE_MS;
          console.log(
            `[bridge:health] 检测到 GUI smoke 仍在编译，第 ${compileGraceCount} 次额外延长 ${GUI_SMOKE_COMPILE_GRACE_MS}ms 等待 DevBridge${heartbeat ? `；进程组: ${heartbeat}` : ""}`,
          );
          continue;
        }

        if (
          !bootGraceUsed &&
          startedByScript &&
          ((state.child &&
            state.child.exitCode === null &&
            !state.child.signalCode) ||
            hasActiveGuiSmokeProcesses(startedByScript))
        ) {
          bootGraceUsed = true;
          deadlineAt = heartbeatAt + GUI_SMOKE_BOOT_GRACE_MS;
          console.log(
            `[bridge:health] 编译链已结束，额外延长 ${GUI_SMOKE_BOOT_GRACE_MS}ms 等待 headless Tauri 拉起 DevBridge${heartbeat ? `；进程组: ${heartbeat}` : ""}`,
          );
          continue;
        }

        break;
      }

      if (heartbeatAt - lastHeartbeatAt >= GUI_SMOKE_BRIDGE_HEARTBEAT_MS) {
        lastHeartbeatAt = heartbeatAt;
        const detail =
          error instanceof Error
            ? error.message
            : String(error || "unknown error");
        const heartbeat = describeGuiSmokeHeartbeat(startedByScript);
        console.log(
          `[bridge:health] 等待中: ${options.healthUrl} (${heartbeatAt - startedAt}ms)；最近错误: ${detail}${heartbeat ? `；进程组: ${heartbeat}` : ""}`,
        );
      }
      await sleep(options.intervalMs);
    }
  }

  const detail =
    lastError instanceof Error
      ? lastError.message
      : String(lastError || "unknown error");
  throw new Error(
    `[bridge:health] 超时未就绪: ${options.healthUrl}。最后错误: ${detail}`,
  );
}

async function probeAppShell(url, timeoutMs) {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const html = await response.text();

    return {
      reachable: response.ok,
      status: response.status,
      statusText: response.statusText,
      isLimeDevShell: response.ok && isLimeDevShell(html),
    };
  } catch {
    return {
      reachable: false,
      status: null,
      statusText: "",
      isLimeDevShell: false,
    };
  }
}

async function resolveStartupMode(options) {
  if (options.reuseRunning) {
    return {
      shouldStart: false,
      reusedExisting: true,
      reuseExistingAppShell: false,
    };
  }

  const staleProcessCount = await cleanupStaleGuiSmokeProcesses();
  if (staleProcessCount > 0) {
    console.log(
      `[verify:gui-smoke] 已清理 ${staleProcessCount} 条残留 GUI smoke headless 链路。`,
    );
  }

  const guiSmokeProcesses = inspectGuiSmokeTauriProcesses();
  const existingAppShell = await probeAppShell(options.appUrl, 1_500);
  if (existingAppShell.reachable && !existingAppShell.isLimeDevShell) {
    const statusLabel =
      `${existingAppShell.status || "unknown"} ${existingAppShell.statusText || ""}`.trim();
    throw new Error(
      `[verify:gui-smoke] ${options.appUrl} 已被其他服务占用，且返回内容不是 Lime 前端壳（${statusLabel}）。请先关闭占用进程后重试。`,
    );
  }

  if (!existingAppShell.isLimeDevShell) {
    const existingListeners = listListeningCommandsForPort(
      resolveUrlPort(options.appUrl),
    );
    const hasLimeFrontendListener = existingListeners.some(
      isLikelyLimeFrontendListener,
    );

    if (guiSmokeProcesses.active.length > 0) {
      const pidList = guiSmokeProcesses.active
        .map((item) => item.pid)
        .join(", ");
      console.log(
        `[verify:gui-smoke] 检测到已有 GUI smoke headless 进程正在启动（PID: ${pidList}）；本次将直接复用现有链路并等待 DevBridge。`,
      );
      return {
        shouldStart: false,
        reusedExisting: true,
        reuseExistingAppShell: hasLimeFrontendListener,
      };
    }

    if (hasLimeFrontendListener) {
      console.log(
        `[verify:gui-smoke] 检测到 ${options.appUrl} 已由当前仓库的前端启动链监听，但页面尚未完全就绪；将复用现有前端启动链，只拉起 headless Tauri 与 DevBridge。`,
      );
      return {
        shouldStart: true,
        reusedExisting: false,
        reuseExistingAppShell: true,
      };
    }

    if (existingListeners.length > 0) {
      throw new Error(
        `[verify:gui-smoke] ${options.appUrl} 已被其他进程占用，且当前无法确认为 Lime 前端壳。请先关闭占用进程后重试。`,
      );
    }

    return {
      shouldStart: true,
      reusedExisting: false,
      reuseExistingAppShell: false,
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
      reuseExistingAppShell: true,
    };
  }

  if (guiSmokeProcesses.active.length > 0) {
    const pidList = guiSmokeProcesses.active.map((item) => item.pid).join(", ");
    console.log(
      `[verify:gui-smoke] 检测到已有 GUI smoke headless 进程正在启动（PID: ${pidList}）；本次将直接复用现有前端与 headless 链路。`,
    );
    return {
      shouldStart: false,
      reusedExisting: true,
      reuseExistingAppShell: true,
    };
  }

  console.log(
    `[verify:gui-smoke] 检测到已有前端 dev server 正在占用 ${options.appUrl}，但 DevBridge 尚未就绪；将继续拉起 headless Tauri，并复用现有前端壳。`,
  );
  return {
    shouldStart: true,
    reusedExisting: false,
    reuseExistingAppShell: true,
  };
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node 运行时不支持 fetch，请使用 Node 18+");
  }

  const parsedOptions = parseArgs(process.argv.slice(2));
  const options = normalizeCargoTargetDir(parsedOptions);
  const startupMode = await resolveStartupMode(options);
  const startedByScript = startupMode.shouldStart;

  if (options.cargoTargetDirFallbackReason) {
    const corruptedDirList = options.corruptedSqliteBindingOutputs
      .map((item) => item.relativeOutDir)
      .join(", ");
    console.warn(
      `[verify:gui-smoke] 检测到损坏的 sqlite 构建缓存（缺少 bindgen.rs）：${corruptedDirList}`,
    );
    console.warn(
      `[verify:gui-smoke] 为避免复用旧半成品 target，Cargo target 已切换到新的独立目录：${options.cargoTargetDir}`,
    );
  }
  console.log(`[verify:gui-smoke] Cargo target: ${options.cargoTargetDir}`);

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
      startHeadlessTauri(options, startupMode);
      await sleep(1_500);
    } else if (startupMode.reusedExisting) {
      console.log("[verify:gui-smoke] 复用已运行的 headless Tauri 环境。");
    }

    await waitForBridgeHealth(options, startedByScript);

    await waitForAppShell(options);

    await cleanupStaleGuiSmokeChromeProfiles(options, {
      label: "预清理历史残留 smoke Chrome profiles",
      required: true,
    });

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
      options.timeoutMs + 5_000,
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
        "--headless",
      ],
      "smoke:browser-runtime",
      options.timeoutMs + 5_000,
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
      options.timeoutMs + 5_000,
    );

    runCommand(
      npmCommand,
      ["run", "smoke:agent-service-skill-entry"],
      "smoke:agent-service-skill-entry",
      options.timeoutMs + 30_000,
    );

    runCommand(
      npmCommand,
      ["run", "smoke:agent-runtime-tool-surface"],
      "smoke:agent-runtime-tool-surface",
      options.timeoutMs + 30_000,
    );

    runCommand(
      npmCommand,
      ["run", "smoke:agent-runtime-tool-surface-page"],
      "smoke:agent-runtime-tool-surface-page",
      options.timeoutMs + 30_000,
    );

    await cleanupStaleGuiSmokeChromeProfiles(options, {
      label: "收尾清理本轮 smoke Chrome profiles",
      required: true,
    });

    console.log("\n[verify:gui-smoke] 通过");
  } finally {
    await cleanupStaleGuiSmokeChromeProfiles(options, {
      label: "兜底清理 smoke Chrome profiles",
      required: false,
      skipIfBridgeUnavailable: true,
    });
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
