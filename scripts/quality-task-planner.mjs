#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";

const DEFAULT_GIT_COMMAND = process.platform === "win32" ? "git.exe" : "git";

const IGNORED_PREFIXES = [
  ".turbo/",
  "coverage/",
  "dist/",
  "docs/.output/",
  "node_modules/",
  "target/",
  "target-site-e2e/",
];

const IGNORED_FILES = new Set([".DS_Store"]);

const FRONTEND_ROOT_FILES = new Set([
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.node.json",
  "eslint.config.js",
  "tailwind.config.js",
  "postcss.config.js",
  "index.html",
]);

const FRONTEND_TOOLING_FILES = new Set([
  "scripts/local-ci.mjs",
  "scripts/ai-code-verify.ts",
  "scripts/quality-task-planner.mjs",
  "scripts/quality-task-selector.mjs",
]);

const BRIDGE_FILES = new Set([
  "vite.config.ts",
  "scripts/check-command-contracts.mjs",
  "scripts/check-generated-slop-report.mjs",
  "scripts/check-dev-bridge-health.mjs",
  "scripts/harness-eval-history-record.mjs",
  "scripts/harness-eval-trend-report.mjs",
  "scripts/report-generated-slop.mjs",
  "scripts/social-workbench-e2e-smoke.mjs",
  "scripts/chrome-bridge-e2e.mjs",
  "scripts/verify-gui-smoke.mjs",
  "scripts/lib/generated-slop-report-core.mjs",
  "scripts/lib/harness-dashboard-core.mjs",
  "docs/aiprompts/playwright-e2e.md",
]);

const HARNESS_CLEANUP_CONTRACT_FILES = new Set([
  "scripts/check-generated-slop-report.mjs",
  "scripts/harness-eval-history-record.mjs",
  "scripts/harness-eval-trend-report.mjs",
  "scripts/report-generated-slop.mjs",
  "scripts/lib/generated-slop-report-core.mjs",
  "scripts/lib/harness-dashboard-core.mjs",
]);

const INTEGRITY_FILES = new Set([
  "package.json",
  "packages/lime-cli-npm/package.json",
  "src-tauri/Cargo.toml",
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.conf.headless.json",
  "scripts/check-app-version-consistency.mjs",
  "scripts/quality-task-planner.mjs",
  "scripts/quality-task-selector.mjs",
]);

const GUI_SMOKE_FILES = new Set([
  "src/App.tsx",
  "src/main.tsx",
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.conf.headless.json",
  "src-tauri/src/app/runner.rs",
  "src-tauri/src/commands/workspace_cmd.rs",
  "src-tauri/src/workspace_support.rs",
  "scripts/check-dev-bridge-health.mjs",
  "scripts/workspace-ready-smoke.mjs",
  "scripts/verify-gui-smoke.mjs",
]);

const GUI_SMOKE_PREFIXES = [
  "src/components/",
  "src/contexts/",
  "src/features/",
  "src/hooks/",
  "src/lib/dev-bridge/",
  "src/lib/navigation/",
  "src/lib/tauri/",
  "src/lib/tauri-mock/",
  "src/lib/workspace/",
  "src/pages/",
  "src/stores/",
  "src-tauri/src/app/",
  "src-tauri/src/dev_bridge/",
];

function gitOutput({ cwd, gitCommand, args }) {
  try {
    return execFileSync(gitCommand, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function splitLines(value) {
  if (!value) {
    return [];
  }

  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniquePaths(paths) {
  return Array.from(new Set(paths)).filter((file) => !isIgnoredPath(file));
}

function isIgnoredPath(file) {
  if (IGNORED_FILES.has(file)) {
    return true;
  }

  return IGNORED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function resolveDiffBase({ base = "", cwd, gitCommand = DEFAULT_GIT_COMMAND }) {
  if (base) {
    return base;
  }

  const upstream = gitOutput({
    cwd,
    gitCommand,
    args: ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
  });
  if (upstream) {
    return upstream;
  }

  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    const exists = gitOutput({
      cwd,
      gitCommand,
      args: ["rev-parse", "--verify", candidate],
    });
    if (exists) {
      return candidate;
    }
  }

  return "";
}

function collectChangedFiles({
  full = false,
  staged = false,
  base = "",
  cwd = process.cwd(),
  gitCommand = DEFAULT_GIT_COMMAND,
} = {}) {
  if (full) {
    return [];
  }

  if (staged) {
    return uniquePaths(
      splitLines(
        gitOutput({
          cwd,
          gitCommand,
          args: ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
        }),
      ),
    );
  }

  const diffBase = resolveDiffBase({ base, cwd, gitCommand });
  const candidates = [];

  if (diffBase) {
    candidates.push(
      ...splitLines(
        gitOutput({
          cwd,
          gitCommand,
          args: [
            "diff",
            "--name-only",
            "--diff-filter=ACMR",
            `${diffBase}...HEAD`,
          ],
        }),
      ),
    );
  }

  candidates.push(
    ...splitLines(
      gitOutput({
        cwd,
        gitCommand,
        args: ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"],
      }),
    ),
  );
  candidates.push(
    ...splitLines(
      gitOutput({
        cwd,
        gitCommand,
        args: ["ls-files", "--others", "--exclude-standard"],
      }),
    ),
  );

  return uniquePaths(candidates);
}

function isMarkdownLike(file) {
  return /\.(md|mdx)$/i.test(file);
}

function isWorkflowChange(file) {
  return file.startsWith(".github/workflows/");
}

function isDocsChange(file) {
  return file.startsWith("docs/") || isMarkdownLike(file);
}

function isDocsOnlyChange(files) {
  return files.length > 0 && files.every((file) => isDocsChange(file));
}

function isFrontendChange(file) {
  return (
    file.startsWith("src/") ||
    FRONTEND_ROOT_FILES.has(file) ||
    FRONTEND_TOOLING_FILES.has(file)
  );
}

function isRustChange(file) {
  return file.startsWith("src-tauri/");
}

function isBridgeChange(file) {
  return (
    file.startsWith("src/lib/dev-bridge/") ||
    file.startsWith("src/lib/tauri-mock/") ||
    BRIDGE_FILES.has(file)
  );
}

function isHarnessCleanupContractChange(file) {
  return HARNESS_CLEANUP_CONTRACT_FILES.has(file);
}

function collectBridgeReasons(changedFiles, { full = false, fallback = false, workflow = false } = {}) {
  if (full) {
    return ["full_suite"];
  }

  if (fallback) {
    return ["fallback_full_suite"];
  }

  if (workflow) {
    return ["workflow_full_suite"];
  }

  const reasons = [];

  if (changedFiles.some(isHarnessCleanupContractChange)) {
    reasons.push("harness_cleanup_contract");
  }

  if (
    changedFiles.some(
      (file) =>
        isBridgeChange(file) && !isHarnessCleanupContractChange(file),
    )
  ) {
    reasons.push("bridge_runtime");
  }

  if (reasons.length === 0 && changedFiles.some(isBridgeChange)) {
    reasons.push("bridge_contracts");
  }

  return reasons;
}

function isGuiSmokeChange(file) {
  return (
    GUI_SMOKE_FILES.has(file) ||
    GUI_SMOKE_PREFIXES.some((prefix) => file.startsWith(prefix))
  );
}

function isIntegrityChange(file) {
  return (
    INTEGRITY_FILES.has(file) ||
    isWorkflowChange(file) ||
    isFrontendChange(file) ||
    isRustChange(file)
  );
}

function detectTasks(changedFiles, { full = false } = {}) {
  if (full) {
    return {
      integrity: true,
      frontend: true,
      rust: true,
      bridge: true,
      bridgeReasons: collectBridgeReasons([], { full: true }),
      guiSmoke: true,
      docs: true,
      docsOnly: false,
      fallback: false,
      workflow: false,
    };
  }

  if (changedFiles.length === 0) {
    return {
      integrity: true,
      frontend: true,
      rust: true,
      bridge: true,
      bridgeReasons: collectBridgeReasons([], { fallback: true }),
      guiSmoke: true,
      docs: true,
      docsOnly: false,
      fallback: true,
      workflow: false,
    };
  }

  const workflow = changedFiles.some(isWorkflowChange);
  if (workflow) {
    return {
      integrity: true,
      frontend: true,
      rust: true,
      bridge: true,
      bridgeReasons: collectBridgeReasons([], { workflow: true }),
      guiSmoke: true,
      docs: true,
      docsOnly: false,
      fallback: false,
      workflow: true,
    };
  }

  if (isDocsOnlyChange(changedFiles)) {
    return {
      integrity: false,
      frontend: false,
      rust: false,
      bridge: false,
      bridgeReasons: [],
      guiSmoke: false,
      docs: true,
      docsOnly: true,
      fallback: false,
      workflow: false,
    };
  }

  const bridge = changedFiles.some(isBridgeChange);

  return {
    integrity: changedFiles.some(isIntegrityChange),
    frontend: changedFiles.some(isFrontendChange),
    rust: changedFiles.some(isRustChange),
    bridge,
    bridgeReasons: bridge ? collectBridgeReasons(changedFiles) : [],
    guiSmoke: changedFiles.some(isGuiSmokeChange),
    docs: changedFiles.some(isDocsChange),
    docsOnly: false,
    fallback: false,
    workflow: false,
  };
}

function planQualityTasks({
  full = false,
  staged = false,
  base = "",
  cwd = process.cwd(),
  gitCommand = DEFAULT_GIT_COMMAND,
} = {}) {
  const changedFiles = collectChangedFiles({
    full,
    staged,
    base,
    cwd,
    gitCommand,
  });

  const tasks = detectTasks(changedFiles, { full });

  return {
    changedFiles,
    tasks,
  };
}

export {
  collectBridgeReasons,
  collectChangedFiles,
  detectTasks,
  planQualityTasks,
  resolveDiffBase,
};
