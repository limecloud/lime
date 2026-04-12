#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { renderHarnessDashboardHtml } from "./lib/harness-dashboard-core.mjs";

const RUNNER_PATH = "scripts/harness-eval-runner.mjs";
const TREND_PATH = "scripts/harness-eval-trend-report.mjs";
const CLEANUP_PATH = "scripts/report-generated-slop.mjs";
const RECOVERED_VERIFICATION_OUTCOMES = new Set([
  "repaired",
  "success",
  "passed",
  "clean",
]);

function parseArgs(argv) {
  const result = {
    cleanupJson: "",
    cleanupMarkdown: "",
    dashboardHtml: "",
    dashboardTitle: "Lime Harness Dashboard",
    format: "text",
    help: false,
    historyDir: "./.lime/harness/history",
    manifest: "",
    outputJson: "",
    retain: 30,
    skipCleanup: false,
    skipTrend: false,
    summaryJson: "",
    summaryMarkdown: "",
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

    if (arg === "--manifest" && argv[index + 1]) {
      result.manifest = String(argv[index + 1]).trim();
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

    if (arg === "--summary-json" && argv[index + 1]) {
      result.summaryJson = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--summary-markdown" && argv[index + 1]) {
      result.summaryMarkdown = String(argv[index + 1]).trim();
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

    if (arg === "--dashboard-html" && argv[index + 1]) {
      result.dashboardHtml = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--dashboard-title" && argv[index + 1]) {
      result.dashboardTitle = String(argv[index + 1]).trim();
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
  node scripts/harness-eval-history-record.mjs --history-dir "./.lime/harness/history" --output-json "./tmp/harness-history-record.json"

选项:
  --history-dir PATH        summary 历史目录，默认 ./.lime/harness/history
  --workspace-root PATH     生成当前 summary 时使用的工作区根目录
  --manifest PATH          透传给 harness eval runner，覆盖默认 manifest
  --retain N               历史窗口保留数量，默认 30
  --summary-json PATH      summary JSON 输出路径，默认写入 reports/harness-eval-summary.json
  --summary-markdown PATH  summary Markdown 输出路径，默认写入 reports/harness-eval-summary.md
  --trend-json PATH        trend JSON 输出路径，默认写入 reports/harness-eval-trend.json
  --trend-markdown PATH    trend Markdown 输出路径，默认写入 reports/harness-eval-trend.md
  --cleanup-json PATH      cleanup JSON 输出路径，默认写入 reports/harness-cleanup-report.json
  --cleanup-markdown PATH  cleanup Markdown 输出路径，默认写入 reports/harness-cleanup-report.md
  --dashboard-html PATH    dashboard HTML 输出路径，依赖 summary / trend / cleanup；默认写入 reports/harness-dashboard.html
  --dashboard-title TEXT   dashboard 页面标题
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

function writeTextFile(filePath, contents) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, contents, "utf8");
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

function runRunner(repoRoot, args) {
  const runnerPath = resolvePath(repoRoot, RUNNER_PATH);
  return execFileSync(process.execPath, [runnerPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function buildCurrentSummary(repoRoot, workspaceRoot, manifestPath) {
  const args = ["--format", "json", "--workspace-root", workspaceRoot];
  if (manifestPath) {
    args.push("--manifest", manifestPath);
  }
  const output = runRunner(repoRoot, args);
  return JSON.parse(output);
}

function buildCurrentSummaryMarkdown(repoRoot, workspaceRoot, manifestPath) {
  const args = ["--format", "markdown", "--workspace-root", workspaceRoot];
  if (manifestPath) {
    args.push("--manifest", manifestPath);
  }
  return runRunner(repoRoot, args);
}

function writeJsonFile(filePath, payload) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeUniqueHistorySummary(historyDir, payload) {
  ensureParentDirectory(historyDir);
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const baseName = `${timestampForFilename()}-harness-eval-summary`;

  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`;
    const filePath = path.join(historyDir, `${baseName}${suffix}.json`);

    try {
      fs.writeFileSync(filePath, json, { encoding: "utf8", flag: "wx" });
      return filePath;
    } catch (error) {
      if (error?.code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`无法在历史目录中创建唯一 summary 文件: ${historyDir}`);
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
  const historyParent = path.dirname(historyDir);
  const artifactsRoot =
    path.basename(historyDir) === "history"
      ? path.join(historyParent, "reports")
      : historyParent;
  return {
    summaryJson: path.join(artifactsRoot, "harness-eval-summary.json"),
    summaryMarkdown: path.join(artifactsRoot, "harness-eval-summary.md"),
    trendJson: path.join(artifactsRoot, "harness-eval-trend.json"),
    trendMarkdown: path.join(artifactsRoot, "harness-eval-trend.md"),
    cleanupJson: path.join(artifactsRoot, "harness-cleanup-report.json"),
    cleanupMarkdown: path.join(artifactsRoot, "harness-cleanup-report.md"),
    dashboardHtml: path.join(artifactsRoot, "harness-dashboard.html"),
  };
}

function toVerificationFailureOutcomeFocus(cleanupReport) {
  const currentEntries = Array.isArray(
    cleanupReport?.focus?.currentObservabilityVerificationOutcomes,
  )
    ? cleanupReport.focus.currentObservabilityVerificationOutcomes
    : [];
  const fallbackEntries = Array.isArray(
    cleanupReport?.focus?.observabilityVerificationOutcomes,
  )
    ? cleanupReport.focus.observabilityVerificationOutcomes
    : [];
  const entries =
    currentEntries.length > 0 ? currentEntries : fallbackEntries;

  return entries
    .map((entry) => {
      const signal = typeof entry?.signal === "string" ? entry.signal.trim() : "";
      const outcome =
        typeof entry?.outcome === "string" ? entry.outcome.trim() : "";
      return signal && outcome ? `${signal}:${outcome}` : "";
    })
    .filter(Boolean);
}

function toCurrentRecoveredBaselineFocus(cleanupReport) {
  const explicitRecoveredEntries = Array.isArray(
    cleanupReport?.focus?.currentRecoveredObservabilityVerificationOutcomes,
  )
    ? cleanupReport.focus.currentRecoveredObservabilityVerificationOutcomes
    : [];
  const currentEntries = Array.isArray(
    cleanupReport?.focus?.currentObservabilityVerificationOutcomes,
  )
    ? cleanupReport.focus.currentObservabilityVerificationOutcomes
    : [];
  const fallbackEntries = Array.isArray(
    cleanupReport?.focus?.observabilityVerificationOutcomes,
  )
    ? cleanupReport.focus.observabilityVerificationOutcomes
    : [];
  const entries =
    explicitRecoveredEntries.length > 0
      ? explicitRecoveredEntries
      : currentEntries.length > 0
        ? currentEntries
        : fallbackEntries;

  return entries
    .filter((entry) =>
      RECOVERED_VERIFICATION_OUTCOMES.has(
        typeof entry?.outcome === "string" ? entry.outcome.trim() : "",
      ),
    )
    .map((entry) => {
      const signal = typeof entry?.signal === "string" ? entry.signal.trim() : "";
      const outcome =
        typeof entry?.outcome === "string" ? entry.outcome.trim() : "";
      return signal && outcome ? `${signal}:${outcome}` : "";
    })
    .filter(Boolean);
}

function toVerificationOutcomeCounts(cleanupReport) {
  const summary =
    cleanupReport &&
    typeof cleanupReport === "object" &&
    cleanupReport.summary &&
    cleanupReport.summary.verificationOutcomes &&
    typeof cleanupReport.summary.verificationOutcomes === "object"
      ? cleanupReport.summary.verificationOutcomes
      : {};
  const currentSummary =
    summary &&
    typeof summary.current === "object" &&
    !Array.isArray(summary.current)
      ? summary.current
      : {};
  const degradedSummary =
    summary &&
    typeof summary.degraded === "object" &&
    !Array.isArray(summary.degraded)
      ? summary.degraded
      : {};

  return {
    failureCaseCount:
      typeof summary.failureCaseCount === "number" &&
      Number.isFinite(summary.failureCaseCount)
        ? summary.failureCaseCount
        : 0,
    blockingFailureCaseCount:
      typeof currentSummary.blockingFailureCaseCount === "number" &&
      Number.isFinite(currentSummary.blockingFailureCaseCount)
        ? currentSummary.blockingFailureCaseCount
        : 0,
    advisoryFailureCaseCount:
      typeof currentSummary.advisoryFailureCaseCount === "number" &&
      Number.isFinite(currentSummary.advisoryFailureCaseCount)
        ? currentSummary.advisoryFailureCaseCount
        : 0,
    recoveredCaseCount:
      typeof summary.recoveredCaseCount === "number" &&
      Number.isFinite(summary.recoveredCaseCount)
        ? summary.recoveredCaseCount
        : 0,
    currentRecoveredCaseCount:
      typeof currentSummary.recoveredCaseCount === "number" &&
      Number.isFinite(currentSummary.recoveredCaseCount)
        ? currentSummary.recoveredCaseCount
        : 0,
    degradedBlockingFailureCaseCount:
      typeof degradedSummary.blockingFailureCaseCount === "number" &&
      Number.isFinite(degradedSummary.blockingFailureCaseCount)
        ? degradedSummary.blockingFailureCaseCount
        : 0,
  };
}

function toTrendCurrentRecoveredBaselineFocus(trendReport) {
  const entries = Array.isArray(
    trendReport?.classificationDeltas?.currentRecoveredObservabilityVerificationOutcomes,
  )
    ? trendReport.classificationDeltas.currentRecoveredObservabilityVerificationOutcomes
    : [];

  return entries
    .filter((entry) => {
      const latestCaseCount =
        typeof entry?.latest?.caseCount === "number" &&
        Number.isFinite(entry.latest.caseCount)
          ? entry.latest.caseCount
          : 0;
      return latestCaseCount > 0;
    })
    .map((entry) =>
      typeof entry?.name === "string" ? entry.name.trim() : "",
    )
    .filter(Boolean)
    .slice(0, 3);
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

  if (result.summary) {
    if (result.summary.outputJsonPath) {
      lines.push(`[lime] summary json: ${result.summary.outputJsonPath}`);
    }
    if (result.summary.outputMarkdownPath) {
      lines.push(`[lime] summary markdown: ${result.summary.outputMarkdownPath}`);
    }
  }

  if (result.trend) {
    lines.push(`[lime] trend sample count: ${result.trend.sampleCount}`);
    lines.push(
      `[lime] trend current observability gap cases: ${result.trend.currentObservabilityGapCaseCount}`,
    );
    lines.push(
      `[lime] trend degraded observability gap cases: ${result.trend.degradedObservabilityGapCaseCount}`,
    );
    lines.push(
      `[lime] trend current recovered baseline cases: ${result.trend.currentRecoveredVerificationCaseCount}`,
    );
    if (result.trend.currentRecoveredBaselineFocus.length > 0) {
      lines.push(
        `[lime] trend current recovered baseline: ${result.trend.currentRecoveredBaselineFocus.join(", ")}`,
      );
    }
    if (result.trend.outputJsonPath) {
      lines.push(`[lime] trend json: ${result.trend.outputJsonPath}`);
    }
  }

  if (result.cleanup) {
    lines.push(
      `[lime] cleanup trend samples: ${result.cleanup.trendSampleCount}`,
    );
    lines.push(
      `[lime] cleanup current observability gap cases: ${result.cleanup.currentObservabilityGapCaseCount}`,
    );
    lines.push(
      `[lime] cleanup degraded observability gap cases: ${result.cleanup.degradedObservabilityGapCaseCount}`,
    );
    if (result.cleanup.verificationFailureOutcomeFocus.length > 0) {
      lines.push(
        `[lime] cleanup verification failure outcomes: ${result.cleanup.verificationFailureOutcomeFocus.join(", ")}`,
      );
    }
    lines.push(
      `[lime] cleanup verification failure cases: ${result.cleanup.verificationFailureCaseCount}`,
    );
    lines.push(
      `[lime] cleanup verification blocking failure cases: ${result.cleanup.verificationBlockingFailureCaseCount}`,
    );
    lines.push(
      `[lime] cleanup verification advisory failure cases: ${result.cleanup.verificationAdvisoryFailureCaseCount}`,
    );
    lines.push(
      `[lime] cleanup degraded blocking verification failure cases: ${result.cleanup.verificationDegradedBlockingFailureCaseCount}`,
    );
    lines.push(
      `[lime] cleanup verification recovered cases: ${result.cleanup.verificationRecoveredCaseCount}`,
    );
    lines.push(
      `[lime] cleanup current recovered baseline cases: ${result.cleanup.currentVerificationRecoveredCaseCount}`,
    );
    if (result.cleanup.currentRecoveredBaselineFocus.length > 0) {
      lines.push(
        `[lime] cleanup current recovered baseline: ${result.cleanup.currentRecoveredBaselineFocus.join(", ")}`,
      );
    }
    if (result.cleanup.outputJsonPath) {
      lines.push(`[lime] cleanup json: ${result.cleanup.outputJsonPath}`);
    }
  }

  if (result.dashboard?.outputHtmlPath) {
    lines.push(`[lime] dashboard html: ${result.dashboard.outputHtmlPath}`);
  }

  return `${lines.join("\n")}\n`;
}

function runHistoryRecordCli() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.dashboardHtml && (options.skipTrend || options.skipCleanup)) {
    throw new Error(
      "生成 dashboard 需要同时启用 trend 与 cleanup，请移除 --skip-trend / --skip-cleanup。",
    );
  }

  const repoRoot = process.cwd();
  const historyDir = resolvePath(repoRoot, options.historyDir);
  fs.mkdirSync(historyDir, { recursive: true });

  const effectiveManifest = options.manifest
    ? resolvePath(repoRoot, options.manifest)
    : "";
  const summary = buildCurrentSummary(
    repoRoot,
    options.workspaceRoot,
    effectiveManifest,
  );
  const summaryFilePath = writeUniqueHistorySummary(historyDir, summary);
  const trimmedPaths = trimHistoryFiles(historyDir, options.retain);
  const historyCount = collectHistoryFiles(historyDir).length;
  const defaults = buildDefaultArtifactPaths(historyDir);

  const result = {
    recordedAt: new Date().toISOString(),
    historyDir,
    recordedSummaryPath: summaryFilePath,
    historyCount,
    trimmedPaths,
    summary: null,
    trend: null,
    cleanup: null,
    dashboard: null,
  };
  let trendReport = null;
  let cleanupReport = null;

  const summaryJsonPath = resolvePath(
    repoRoot,
    options.summaryJson || defaults.summaryJson,
  );
  const summaryMarkdownPath = resolvePath(
    repoRoot,
    options.summaryMarkdown || defaults.summaryMarkdown,
  );

  writeJsonFile(summaryJsonPath, summary);
  const summaryMarkdown = buildCurrentSummaryMarkdown(
    repoRoot,
    options.workspaceRoot,
    effectiveManifest,
  );
  writeTextFile(summaryMarkdownPath, summaryMarkdown);
  result.summary = {
    outputJsonPath: summaryJsonPath,
    outputMarkdownPath: summaryMarkdownPath,
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
    trendReport = JSON.parse(trendOutput);
    const trendCurrentRecoveredBaselineFocus =
      toTrendCurrentRecoveredBaselineFocus(trendReport);
    result.trend = {
      sampleCount: trendReport.sampleCount,
      currentObservabilityGapCaseCount:
        trendReport.latest?.totals?.currentObservabilityGapCaseCount ?? 0,
      degradedObservabilityGapCaseCount:
        trendReport.latest?.totals?.degradedObservabilityGapCaseCount ?? 0,
      currentRecoveredVerificationCaseCount:
        trendReport.latest?.totals?.currentRecoveredVerificationCaseCount ?? 0,
      currentRecoveredBaselineFocus: trendCurrentRecoveredBaselineFocus,
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
    cleanupReport = JSON.parse(cleanupOutput);
    const verificationFailureOutcomeFocus =
      toVerificationFailureOutcomeFocus(cleanupReport);
    const currentRecoveredBaselineFocus =
      toCurrentRecoveredBaselineFocus(cleanupReport);
    const verificationOutcomeCounts =
      toVerificationOutcomeCounts(cleanupReport);
    result.cleanup = {
      trendSampleCount: cleanupReport.summary?.trend?.sampleCount ?? 0,
      currentObservabilityGapCaseCount:
        cleanupReport.summary?.trend?.latestCurrentObservabilityGapCaseCount ?? 0,
      degradedObservabilityGapCaseCount:
        cleanupReport.summary?.trend?.latestDegradedObservabilityGapCaseCount ?? 0,
      verificationFailureOutcomeFocus,
      verificationFailureCaseCount:
        verificationOutcomeCounts.failureCaseCount,
      verificationBlockingFailureCaseCount:
        verificationOutcomeCounts.blockingFailureCaseCount,
      verificationAdvisoryFailureCaseCount:
        verificationOutcomeCounts.advisoryFailureCaseCount,
      verificationDegradedBlockingFailureCaseCount:
        verificationOutcomeCounts.degradedBlockingFailureCaseCount,
      verificationRecoveredCaseCount:
        verificationOutcomeCounts.recoveredCaseCount,
      currentVerificationRecoveredCaseCount:
        verificationOutcomeCounts.currentRecoveredCaseCount,
      currentRecoveredBaselineFocus,
      outputJsonPath: cleanupJsonPath,
      outputMarkdownPath: cleanupMarkdownPath,
    };
  }

  const dashboardHtmlPath =
    options.skipTrend || options.skipCleanup
      ? ""
      : resolvePath(repoRoot, options.dashboardHtml || defaults.dashboardHtml);

  if (dashboardHtmlPath) {
    const dashboardHtml = renderHarnessDashboardHtml({
      summaryReport: summary,
      trendReport,
      cleanupReport,
      title: options.dashboardTitle,
    });
    writeTextFile(dashboardHtmlPath, dashboardHtml);
    result.dashboard = {
      outputHtmlPath: dashboardHtmlPath,
      title: options.dashboardTitle,
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
