#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const vitestEntrypoint = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
const cliArgs = process.argv.slice(2);
const defaultBatchSize = Number.parseInt(
  process.env.LIME_VITEST_BATCH_SIZE || "16",
  10,
);
const batchSize =
  Number.isFinite(defaultBatchSize) && defaultBatchSize > 0
    ? defaultBatchSize
    : 16;
const serialTestFiles = new Set([
  "scripts/lib/harness-eval-history-record.test.ts",
  "scripts/lib/harness-eval-history-window.test.ts",
  "src/components/agent/chat/index.test.tsx",
  "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx",
  "src/components/workspace/WorkbenchPage.test.tsx",
  "src/components/plugins/PluginManager.test.tsx",
  "src/components/agent/chat/components/HarnessStatusPanel.test.tsx",
  "src/components/agent/chat/components/ThemeWorkbenchSidebar.test.tsx",
  "src/components/agent/chat/components/TeamWorkspaceBoard.test.tsx",
  "src/components/settings-v2/system/automation/index.test.tsx",
]);
const ignoredTestPathSegments = [
  "/node_modules/",
  "/tmp/lime-pnpm-frozen-node_modules/",
];

function normalizeTestPath(file) {
  return path.resolve(file).replaceAll("\\", "/");
}

function shouldIgnoreCollectedTestFile(file) {
  const normalized = normalizeTestPath(file);
  return ignoredTestPathSegments.some((segment) =>
    normalized.includes(segment),
  );
}

function runVitest(args, label) {
  if (label) {
    console.log(`[vitest-smart] ${label}`);
  }

  const result = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=8192",
      vitestEntrypoint,
      "--run",
      "--silent=passed-only",
      "--disableConsoleIntercept",
      "--poolOptions.forks.singleFork",
      ...args,
    ],
    {
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

function collectTestFiles() {
  const result = spawnSync(
    process.execPath,
    [vitestEntrypoint, "list", "--filesOnly", "--json"],
    {
      stdio: ["inherit", "pipe", "inherit"],
      env: process.env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  const parsed = JSON.parse(result.stdout || "[]");
  return parsed
    .map((entry) => (typeof entry === "string" ? entry : entry?.file))
    .filter(
      (entry) =>
        typeof entry === "string" &&
        entry.length > 0 &&
        !shouldIgnoreCollectedTestFile(entry),
    );
}

function chunkFiles(files, size) {
  const chunks = [];
  for (let index = 0; index < files.length; index += size) {
    chunks.push(files.slice(index, index + size));
  }
  return chunks;
}

function buildBatches(files) {
  const repoRoot = process.cwd();
  const serialBatches = [];
  const regularFiles = [];

  for (const file of files) {
    const relativePath = path.relative(repoRoot, file).replaceAll("\\", "/");
    if (serialTestFiles.has(relativePath)) {
      serialBatches.push([file]);
      continue;
    }
    regularFiles.push(file);
  }

  return [...serialBatches, ...chunkFiles(regularFiles, batchSize)];
}

function main() {
  if (cliArgs.length > 0) {
    runVitest(cliArgs);
    return;
  }

  const files = collectTestFiles();
  const batches = buildBatches(files);

  for (let index = 0; index < batches.length; index += 1) {
    runVitest(
      [
        "--maxWorkers",
        "1",
        "--minWorkers",
        "1",
        "--no-file-parallelism",
        ...batches[index],
      ],
      `运行批次 ${index + 1}/${batches.length}`,
    );
  }
}

main();
