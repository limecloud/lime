#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const RUNNER_PATH = "scripts/harness-eval-runner.mjs";
const TREND_PATH = "scripts/harness-eval-trend-report.mjs";
const CLEANUP_PATH = "scripts/report-generated-slop.mjs";

function parseArgs(argv) {
  const result = {
    cleanupJson: "",
    cleanupMarkdown: "",
    format: "text",
    help: false,
    historyDir: "./artifacts/history",
    outputJson: "",
    retain: 30,
    skipCleanup: false,
    skipTrend: false,
    trendJson: "",
    trendMarkdown: "",
    workspaceRoot: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--history-dir" && argv[index + 1]) {
      result.historyDir = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--workspace-root" && argv[index + 1]) {
      result.workspaceRoot = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--retain" && argv[index + 1]) {
      result.retain = Number.parseInt(String(argv[index + 1]).trim(), 10);
      index += 1;
      continue;
    }

    if (arg === "--format" && argv[index + 1]) {
      result.format = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--output-json" && argv[index + 1]) {
      result.outputJson = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--trend-json" && argv[index + 1]) {
      result.trendJson = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--trend-markdown" && argv[index + 1]) {
      result.trendMarkdown = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--cleanup-json" && argv[index + 1]) {
      result.cleanupJson = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--cleanup-markdown" && argv[index + 1]) {
      result.cleanupMarkdown = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--skip-trend") {
      result.skipTrend = true;
      continue;
    }

    if (arg === "--skip-cleanup") {
      result.skipCleanup = true;
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
Lime Harness Eval History Record

用法:
  node scripts/harness-eval-history-record.mjs
  node scripts/harness-eval-history-record.mjs --workspace-root "/path/to/workspace"
  node scripts/harness-eval-history-record.mjs --history-dir "./artifacts/history" --output-json "./tmp/harness-history-record.json"

选项:
  --history-dir PATH        summary 历史目录，默认 ./artifacts/history
  --workspace-root PATH     生成当前 summary 时使用的工作区根目录
  --retain N               历史窗口保留数量，默认 30
  --trend-json PATH        trend JSON 输出路径
  --trend-markdown PATH    trend Markdown 输出路径
  --cleanup-json PATH      cleanup JSON 输出路径
  --cleanup-markdown PATH  cleanup Markdown 输出路径
  --skip-trend             只记录 summary，不生成 trend
  --skip-cleanup           只记录 summary / trend，不生成 cleanup
  --format FMT             标准输出格式：text | json
  --output-json PATH       将记录结果写入指定路径
  -h, --help              显示帮助
`);
}

function resolvePath(baseDir, targetPath) {
  return path.resolve(baseDir, targetPath);
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\./g, "");
}

function collectHistoryFiles(historyDir) {
  if (!fs.existsSync(historyDir)) {
    return [];
  }

  return fs
    .readdirSync(historyDir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(historyDir, entry))
    .sort((left, right) => left.localeCompare(right));
}

function buildCurrentSummary(repoRoot, workspaceRoot) {
  const runnerPath = resolvePath(repoRoot, RUNNER_PATH);
  const output = execFileSync(
    process.execPath,
    [runnerPath, "--format", "json", "--workspace-root", workspaceRoot],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  return JSON.parse(output);
}

function writeJsonFile(filePath, payload) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function trimHistoryFiles(historyDir, retain) {
  const files = collectHistoryFiles(historyDir).sort((left, right) =>
    right.localeCompare(left),
  );
  const removable = files.slice(Math.max(retain, 0));
  for (const filePath of removable) {
    fs.rmSync(filePath, { force: true });
  }
  return removable;
}

function buildDefaultArtifactPaths(historyDir) {
  const artifactsRoot = path.dirname(historyDir);
  return {
    trendJson: path.join(artifactsRoot, "harness-eval-trend.json"),
    trendMarkdown: path.join(artifactsRoot, "harness-eval-trend.md"),
    cleanupJson: path.join(artifactsRoot, "harness-cleanup-report.json"),
    cleanupMarkdown: path.join(artifactsRoot, "harness-cleanup-report.md"),
  };
}

function renderOutput(result, format) {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  const lines = [
    "[lime] harness eval history record",
    `[lime] history dir: ${result.historyDir}`,
    `[lime] recorded summary: ${result.recordedSummaryPath}`,
    `[lime] history count: ${result.historyCount}`,
    `[lime] trimmed files: ${result.trimmedPaths.length}`,
  ];

  if (result.trend) {
    lines.push(`[lime] trend sample count: ${result.trend.sampleCount}`);
    if (result.trend.outputJsonPath) {
      lines.push(`[lime] trend json: ${result.trend.outputJsonPath}`);
    }
  }

  if (result.cleanup) {
    lines.push(
      `[lime] cleanup trend samples: ${result.cleanup.trendSampleCount}`,
    );
    if (result.cleanup.outputJsonPath) {
      lines.push(`[lime] cleanup json: ${result.cleanup.outputJsonPath}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function runHistoryRecordCli() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const repoRoot = process.cwd();
  const historyDir = resolvePath(repoRoot, options.historyDir);
  fs.mkdirSync(historyDir, { recursive: true });

  const summary = buildCurrentSummary(repoRoot, options.workspaceRoot);
  const summaryFilePath = path.join(
    historyDir,
    `${timestampForFilename()}-harness-eval-summary.json`,
  );
  writeJsonFile(summaryFilePath, summary);
  const trimmedPaths = trimHistoryFiles(historyDir, options.retain);
  const historyCount = collectHistoryFiles(historyDir).length;
  const defaults = buildDefaultArtifactPaths(historyDir);

  const result = {
    recordedAt: new Date().toISOString(),
    historyDir,
    recordedSummaryPath: summaryFilePath,
    historyCount,
    trimmedPaths,
    trend: null,
    cleanup: null,
  };

  if (!options.skipTrend) {
    const trendJsonPath = resolvePath(
      repoRoot,
      options.trendJson || defaults.trendJson,
    );
    const trendMarkdownPath = resolvePath(
      repoRoot,
      options.trendMarkdown || defaults.trendMarkdown,
    );
    const trendScriptPath = resolvePath(repoRoot, TREND_PATH);
    const trendOutput = execFileSync(
      process.execPath,
      [
        trendScriptPath,
        "--format",
        "json",
        "--history-dir",
        historyDir,
        "--output-json",
        trendJsonPath,
        "--output-markdown",
        trendMarkdownPath,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    const trendReport = JSON.parse(trendOutput);
    result.trend = {
      sampleCount: trendReport.sampleCount,
      outputJsonPath: trendJsonPath,
      outputMarkdownPath: trendMarkdownPath,
    };
  }

  if (!options.skipCleanup) {
    const cleanupJsonPath = resolvePath(
      repoRoot,
      options.cleanupJson || defaults.cleanupJson,
    );
    const cleanupMarkdownPath = resolvePath(
      repoRoot,
      options.cleanupMarkdown || defaults.cleanupMarkdown,
    );
    const cleanupScriptPath = resolvePath(repoRoot, CLEANUP_PATH);
    const cleanupOutput = execFileSync(
      process.execPath,
      [
        cleanupScriptPath,
        "--format",
        "json",
        "--trend-history-dir",
        historyDir,
        "--output-json",
        cleanupJsonPath,
        "--output-markdown",
        cleanupMarkdownPath,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    const cleanupReport = JSON.parse(cleanupOutput);
    result.cleanup = {
      trendSampleCount: cleanupReport.summary?.trend?.sampleCount ?? 0,
      outputJsonPath: cleanupJsonPath,
      outputMarkdownPath: cleanupMarkdownPath,
    };
  }

  const rendered = renderOutput(result, options.format);
  if (options.outputJson) {
    const outputPath = resolvePath(repoRoot, options.outputJson);
    writeJsonFile(outputPath, result);
  }

  process.stdout.write(rendered);
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  runHistoryRecordCli();
}
