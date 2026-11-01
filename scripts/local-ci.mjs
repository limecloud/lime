#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { withNativeSystemPath } from "./lib/native-executable-env.mjs";
import { resolveRustyV8CargoEnv } from "./lib/rusty-v8-artifacts.mjs";
import { planQualityTasks, resolveDiffBase } from "./quality-task-planner.mjs";
import { findFirstResumableBatchIndex } from "./run-vitest-smart.mjs";
import { withRustTestConfig } from "./run-rust-layer.mjs";

const options = parseArgs(process.argv.slice(2));
const rootDir = process.cwd();

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const cargoCommand = process.platform === "win32" ? "cargo.exe" : "cargo";
const BRIDGE_REASON_LABELS = {
  bridge_contracts: "bridge/contracts",
  bridge_runtime: "DevBridge / mock / bridge runtime",
  fallback_full_suite: "兜底全量",
  full_suite: "full 模式",
  harness_cleanup_contract: "harness cleanup contract",
  workflow_full_suite: "workflow 全量",
};

const I18N_HARDCODED_SCAN_PREFIXES = [
  "src/components/",
  "src/features/",
  "src/pages/",
];
const I18N_HARDCODED_SCAN_FILES = new Set(["src/App.tsx", "src/main.tsx"]);
const I18N_HARDCODED_SCAN_FILE_PATTERNS = [
  /\.(test|spec)\.[^.]+$/,
  /\.testFixtures\.[^.]+$/,
];

function parseArgs(argv) {
  const result = {
    full: false,
    staged: false,
    base: "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--full") {
      result.full = true;
      continue;
    }
    if (arg === "--staged") {
      result.staged = true;
      continue;
    }
    if (arg === "--base" && argv[index + 1]) {
      result.base = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    }
  }

  return result;
}

function printHelp() {
  console.log(`
Lime 本地校验入口

用法:
  npm run verify:local
  npm run verify:local -- --staged
  npm run verify:local -- --base origin/main
  npm run verify:local:full

选项:
  --full      忽略改动检测，执行全量本地校验
  --staged    仅基于已暂存文件判断要跑的检查
  --base REF  基于指定基线计算改动文件
  -h, --help  显示帮助
`);
}

function runCommand(command, args) {
  console.log(`\n[local-ci] > ${command} ${args.join(" ")}`);
  const baseEnv = withNativeSystemPath(process.env);
  const env =
    command === cargoCommand
      ? { ...baseEnv, ...resolveRustyV8CargoEnv({ env: baseEnv }) }
      : baseEnv;
  const run = (testEnv) =>
    spawnSync(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      env: testEnv,
    });
  const result =
    command === cargoCommand && args[0] === "test"
      ? withRustTestConfig(env, run)
      : run(env);

  const status = commandExitStatus(result);
  if (status !== 0) {
    process.exit(status);
  }
}

export function commandExitStatus(result) {
  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    throw new Error(`[local-ci] 子进程被信号 ${result.signal} 中断，校验未完成。`);
  }
  if (typeof result.status !== "number") {
    throw new Error("[local-ci] 子进程未返回退出状态，校验未完成。");
  }
  return result.status;
}

export function frontendTestArgs(state) {
  if (state == null) {
    return ["test"];
  }
  if (
    state.schema_version !== 1 ||
    state.runner !== "vitest-smart" ||
    !Array.isArray(state.batches)
  ) {
    throw new Error("[local-ci] Vitest 续跑状态无效，请检查状态文件。");
  }
  return findFirstResumableBatchIndex(state) >= 0
    ? ["test", "--", "--resume"]
    : ["test"];
}

function runFrontendTests() {
  const stateFile = path.resolve(
    rootDir,
    process.env.LIME_VITEST_SMART_STATE ||
      ".lime/test/vitest-smart-last-run.json",
  );
  const state = fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
    : null;
  runCommand(npmCommand, frontendTestArgs(state));
}

function printSummary(changedFiles, tasks) {
  console.log("[local-ci] 模式:", options.full ? "full" : "smart");
  if (!options.full) {
    console.log("[local-ci] 检测到改动文件数:", changedFiles.length);
    if (changedFiles.length > 0) {
      const preview = changedFiles.slice(0, 12);
      for (const file of preview) {
        console.log(`[local-ci] - ${file}`);
      }
      if (changedFiles.length > preview.length) {
        console.log(
          `[local-ci] ... 其余 ${changedFiles.length - preview.length} 个文件省略`,
        );
      }
    }
  }

  if (tasks.docsOnly) {
    console.log("[local-ci] 当前仅检测到文档改动，跳过本地代码校验。");
  }

  if (!tasks.docsOnly) {
    console.log("[local-ci] 计划执行:");
  }
  if (tasks.integrity) {
    console.log("[local-ci] - 一致性校验");
  }
  if (tasks.i18n) {
    console.log("[local-ci] - i18n 资源结构校验");
  }
  if (tasks.i18nHardcoded) {
    console.log("[local-ci] - i18n 用户可见硬编码扫描");
  }
  if (tasks.i18nUnused) {
    console.log("[local-ci] - i18n 未引用 key 检查");
  }
  if (tasks.frontend) {
    console.log("[local-ci] - 前端校验");
  }
  if (tasks.bridge) {
    const bridgeReasonLabels = Array.isArray(tasks.bridgeReasons)
      ? tasks.bridgeReasons
          .map((reason) => BRIDGE_REASON_LABELS[reason] ?? reason)
          .filter(Boolean)
      : [];
    console.log(
      bridgeReasonLabels.length > 0
        ? `[local-ci] - bridge 校验（${bridgeReasonLabels.join(" / ")}）`
        : "[local-ci] - bridge 校验",
    );
  }
  if (tasks.guiSmoke) {
    console.log("[local-ci] - GUI 冒烟");
  }
  if (tasks.rust) {
    console.log(
      shouldUseRustChangedScope(changedFiles, tasks)
        ? "[local-ci] - Rust 校验（changed scope）"
        : "[local-ci] - Rust 校验（workspace/full）",
    );
  }
  if (tasks.fallback) {
    console.log("[local-ci] - 未检测到改动，执行全量兜底校验");
  }
  if (
    Array.isArray(tasks.recommendedCommands) &&
    tasks.recommendedCommands.length > 0
  ) {
    console.log("[local-ci] 推荐额外重验:");
    for (const command of tasks.recommendedCommands) {
      console.log(`[local-ci] - ${command}`);
    }
  }
}

function runSelectedTasks(changedFiles, tasks) {
  if (tasks.docsOnly) {
    return;
  }

  if (tasks.integrity) {
    runCommand(npmCommand, ["run", "verify:app-version"]);
  }

  if (tasks.i18n) {
    runCommand(npmCommand, ["run", "i18n:check"]);
  }
  if (tasks.i18nUnused) {
    runCommand(npmCommand, ["run", "i18n:unused", "--", "--check"]);
  }

  if (tasks.frontend) {
    runCommand(npmCommand, ["run", "lint"]);
    if (tasks.i18nHardcoded) {
      const scanFiles = collectI18nHardcodedScanFiles(changedFiles);
      if (scanFiles.length > 0) {
        runCommand(npmCommand, [
          "run",
          "i18n:scan",
          "--",
          "--files",
          ...scanFiles,
        ]);
      }
    }
    runCommand(npmCommand, ["run", "typecheck"]);
    runFrontendTests();
  }

  if (tasks.bridge) {
    if (!tasks.frontend) {
      runCommand(npmCommand, ["run", "test:bridge"]);
    }
    runCommand(npmCommand, ["run", "test:contracts"]);
  }

  if (tasks.rust) {
    runRustValidation(changedFiles, tasks);
  }

  if (tasks.guiSmoke) {
    runCommand(npmCommand, ["run", "verify:gui-smoke"]);
  }
}

function isRustPath(file) {
  return String(file || "").startsWith("lime-rs");
}

function shouldUseRustChangedScope(changedFiles, tasks) {
  return (
    !options.full &&
    !tasks.fallback &&
    !tasks.workflow &&
    changedFiles.some(isRustPath)
  );
}

function runRustValidation(changedFiles, tasks) {
  if (!shouldUseRustChangedScope(changedFiles, tasks)) {
    runCommand(cargoCommand, ["test", "--manifest-path", "lime-rs/Cargo.toml"]);
    if (options.full) {
      runCommand(cargoCommand, [
        "clippy",
        "--manifest-path",
        "lime-rs/Cargo.toml",
      ]);
    }
    return;
  }

  const rustPaths = Array.from(new Set(changedFiles.filter(isRustPath)));
  if (options.staged) {
    runCommand(npmCommand, ["run", "test:rust:related", "--", ...rustPaths]);
    return;
  }

  const diffBase = resolveDiffBase({ base: options.base, cwd: rootDir });
  const args = ["run", "test:rust:changed"];
  if (diffBase) {
    args.push("--", `--changed=${diffBase}`);
  }
  runCommand(npmCommand, args);
}

function main() {
  if (options.help) {
    printHelp();
    return;
  }

  const { changedFiles, tasks } = planQualityTasks({
    base: options.base,
    cwd: rootDir,
    full: options.full,
    staged: options.staged,
  });
  printSummary(changedFiles, tasks);
  runSelectedTasks(changedFiles, tasks);
  console.log("\n[local-ci] 本地校验完成。");
}

function collectI18nHardcodedScanFiles(changedFiles) {
  return Array.from(new Set(changedFiles))
    .map((file) => String(file).trim())
    .filter(Boolean)
    .filter((file) => {
      if (!/\.(ts|tsx|js|jsx)$/.test(file)) {
        return false;
      }
      if (I18N_HARDCODED_SCAN_FILES.has(file)) {
        return true;
      }
      if (
        I18N_HARDCODED_SCAN_FILE_PATTERNS.some((pattern) => pattern.test(file))
      ) {
        return false;
      }
      return I18N_HARDCODED_SCAN_PREFIXES.some((prefix) =>
        file.startsWith(prefix),
      );
    });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
