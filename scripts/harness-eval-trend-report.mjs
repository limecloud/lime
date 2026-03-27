#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const RUNNER_PATH = "scripts/harness-eval-runner.mjs";

function parseArgs(argv) {
  const result = {
    format: "text",
    help: false,
    historyDir: "",
    inputs: [],
    outputJson: "",
    outputMarkdown: "",
    workspaceRoot: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--input" && argv[index + 1]) {
      result.inputs.push(String(argv[index + 1]).trim());
      index += 1;
      continue;
    }

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

    if (arg === "--output-markdown" && argv[index + 1]) {
      result.outputMarkdown = String(argv[index + 1]).trim();
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
Lime Harness Eval Trend Report

用法:
  node scripts/harness-eval-trend-report.mjs
  node scripts/harness-eval-trend-report.mjs --input "./tmp/harness-eval-summary.json"
  node scripts/harness-eval-trend-report.mjs --history-dir "./artifacts/history"
  node scripts/harness-eval-trend-report.mjs --output-json "./tmp/harness-eval-trend.json" --output-markdown "./tmp/harness-eval-trend.md"

选项:
  --input PATH           显式加入一个或多个 harness eval summary JSON
  --history-dir PATH     扫描目录下的历史 summary JSON
  --workspace-root PATH  未提供输入时，用该工作区生成当前 summary
  --format FMT           标准输出格式：text | json | markdown
  --output-json PATH     将 JSON 趋势报告写入指定路径
  --output-markdown PATH 将 Markdown 趋势报告写入指定路径
  -h, --help             显示帮助
`);
}

function resolvePath(baseDir, relativePath) {
  return path.resolve(baseDir, relativePath);
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectJsonFiles(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath)) {
    return [];
  }

  const files = [];
  const pending = [rootPath];

  while (pending.length > 0) {
    const current = pending.pop();
    const stat = fs.statSync(current);

    if (stat.isDirectory()) {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        pending.push(path.join(current, entry.name));
      }
      continue;
    }

    if (stat.isFile() && current.endsWith(".json")) {
      files.push(current);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function isHarnessEvalSummary(candidate) {
  return (
    candidate != null &&
    typeof candidate === "object" &&
    typeof candidate.generatedAt === "string" &&
    candidate.totals != null &&
    typeof candidate.totals.caseCount === "number" &&
    typeof candidate.totals.readyCount === "number" &&
    typeof candidate.totals.invalidCount === "number"
  );
}

function buildCurrentSummary(repoRoot, workspaceRoot) {
  const nodeCommand = process.execPath;
  const runnerPath = resolvePath(repoRoot, RUNNER_PATH);
  const output = execFileSync(
    nodeCommand,
    [runnerPath, "--format", "json", "--workspace-root", workspaceRoot],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  return JSON.parse(output);
}

function normalizeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function computeReadyRate(summary) {
  const caseCount = normalizeNumber(summary?.totals?.caseCount);
  if (caseCount <= 0) {
    return 0;
  }
  return normalizeNumber(summary?.totals?.readyCount) / caseCount;
}

function getSuiteMap(summary) {
  const suites = Array.isArray(summary?.suites) ? summary.suites : [];
  return new Map(
    suites.map((suite) => [
      String(suite.id ?? ""),
      {
        id: String(suite.id ?? ""),
        title: String(suite.title ?? ""),
        caseCount: normalizeNumber(suite?.stats?.caseCount),
        readyCount: normalizeNumber(suite?.stats?.readyCount),
        invalidCount: normalizeNumber(suite?.stats?.invalidCount),
      },
    ]),
  );
}

function getBreakdownMap(summary, key) {
  const entries = Array.isArray(summary?.breakdowns?.[key])
    ? summary.breakdowns[key]
    : [];
  return new Map(
    entries.map((entry) => [
      String(entry.name ?? ""),
      {
        name: String(entry.name ?? ""),
        caseCount: normalizeNumber(entry.caseCount),
        readyCount: normalizeNumber(entry.readyCount),
        invalidCount: normalizeNumber(entry.invalidCount),
        pendingRequestCaseCount: normalizeNumber(entry.pendingRequestCaseCount),
        needsHumanReviewCount: normalizeNumber(entry.needsHumanReviewCount),
      },
    ]),
  );
}

function buildSuiteDeltas(baseline, latest) {
  const baselineSuites = getSuiteMap(baseline);
  const latestSuites = getSuiteMap(latest);
  const suiteIds = new Set([...baselineSuites.keys(), ...latestSuites.keys()]);

  return Array.from(suiteIds)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .map((suiteId) => {
      const baselineSuite = baselineSuites.get(suiteId) ?? {
        id: suiteId,
        title: suiteId,
        caseCount: 0,
        readyCount: 0,
        invalidCount: 0,
      };
      const latestSuite = latestSuites.get(suiteId) ?? {
        id: suiteId,
        title: baselineSuite.title,
        caseCount: 0,
        readyCount: 0,
        invalidCount: 0,
      };

      return {
        id: suiteId,
        title: latestSuite.title || baselineSuite.title || suiteId,
        baseline: baselineSuite,
        latest: latestSuite,
        delta: {
          caseCount: latestSuite.caseCount - baselineSuite.caseCount,
          readyCount: latestSuite.readyCount - baselineSuite.readyCount,
          invalidCount: latestSuite.invalidCount - baselineSuite.invalidCount,
        },
      };
    });
}

function buildBreakdownDeltas(baseline, latest, key) {
  const baselineMap = getBreakdownMap(baseline, key);
  const latestMap = getBreakdownMap(latest, key);
  const names = new Set([...baselineMap.keys(), ...latestMap.keys()]);

  return Array.from(names)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const baselineEntry = baselineMap.get(name) ?? {
        name,
        caseCount: 0,
        readyCount: 0,
        invalidCount: 0,
        pendingRequestCaseCount: 0,
        needsHumanReviewCount: 0,
      };
      const latestEntry = latestMap.get(name) ?? {
        name,
        caseCount: 0,
        readyCount: 0,
        invalidCount: 0,
        pendingRequestCaseCount: 0,
        needsHumanReviewCount: 0,
      };

      return {
        name,
        baseline: baselineEntry,
        latest: latestEntry,
        delta: {
          caseCount: latestEntry.caseCount - baselineEntry.caseCount,
          readyCount: latestEntry.readyCount - baselineEntry.readyCount,
          invalidCount: latestEntry.invalidCount - baselineEntry.invalidCount,
          pendingRequestCaseCount:
            latestEntry.pendingRequestCaseCount -
            baselineEntry.pendingRequestCaseCount,
          needsHumanReviewCount:
            latestEntry.needsHumanReviewCount -
            baselineEntry.needsHumanReviewCount,
        },
      };
    })
    .sort((left, right) => {
      const invalidDeltaDiff =
        Math.abs(right.delta.invalidCount) - Math.abs(left.delta.invalidCount);
      if (invalidDeltaDiff !== 0) {
        return invalidDeltaDiff;
      }
      const caseDeltaDiff =
        Math.abs(right.delta.caseCount) - Math.abs(left.delta.caseCount);
      if (caseDeltaDiff !== 0) {
        return caseDeltaDiff;
      }
      return left.name.localeCompare(right.name);
    });
}

function buildStatusSignals(baseline, latest, sampleCount) {
  const signals = [];

  if (sampleCount < 2) {
    signals.push("样本数不足 2，当前仅形成 trend seed，还不能判断长期退化。");
    return signals;
  }

  const readyRateDelta = computeReadyRate(latest) - computeReadyRate(baseline);
  const invalidDelta =
    normalizeNumber(latest?.totals?.invalidCount) -
    normalizeNumber(baseline?.totals?.invalidCount);
  const pendingDelta =
    normalizeNumber(latest?.totals?.pendingRequestCaseCount) -
    normalizeNumber(baseline?.totals?.pendingRequestCaseCount);

  if (invalidDelta > 0) {
    signals.push(`invalid case 增加 ${invalidDelta}，存在回归候选。`);
  }

  if (readyRateDelta < 0) {
    signals.push(
      `ready rate 下降 ${(Math.abs(readyRateDelta) * 100).toFixed(1)}%，需检查最近样本或字段漂移。`,
    );
  }

  if (pendingDelta > 0) {
    signals.push(
      `pending request case 增加 ${pendingDelta}，需确认是否属于真实阻塞还是样本结构变化。`,
    );
  }

  const failureModeDeltas = buildBreakdownDeltas(
    baseline,
    latest,
    "failureModes",
  );
  const increasedInvalidFailureMode = failureModeDeltas.find(
    (entry) => entry.delta.invalidCount > 0,
  );
  if (increasedInvalidFailureMode) {
    signals.push(
      `failure mode \`${increasedInvalidFailureMode.name}\` 的 invalid case 增加 ${increasedInvalidFailureMode.delta.invalidCount}。`,
    );
  }

  if (signals.length === 0) {
    signals.push("当前没有检测到明显退化信号。");
  }

  return signals;
}

function buildTrendReport(samples, repoRoot) {
  const sortedSamples = [...samples].sort((left, right) => {
    const leftTime = Date.parse(left.summary.generatedAt);
    const rightTime = Date.parse(right.summary.generatedAt);
    if (
      Number.isFinite(leftTime) &&
      Number.isFinite(rightTime) &&
      leftTime !== rightTime
    ) {
      return leftTime - rightTime;
    }
    return left.summary.generatedAt.localeCompare(right.summary.generatedAt);
  });

  const baselineEntry = sortedSamples[0];
  const latestEntry = sortedSamples[sortedSamples.length - 1];
  const baseline = baselineEntry.summary;
  const latest = latestEntry.summary;
  const readyRateDelta = computeReadyRate(latest) - computeReadyRate(baseline);

  return {
    reportVersion: "v1",
    generatedAt: new Date().toISOString(),
    repoRoot,
    sampleCount: sortedSamples.length,
    baseline: {
      generatedAt: baseline.generatedAt,
      sourcePath: baselineEntry.sourcePath,
      totals: baseline.totals,
    },
    latest: {
      generatedAt: latest.generatedAt,
      sourcePath: latestEntry.sourcePath,
      totals: latest.totals,
    },
    delta: {
      suiteCount:
        normalizeNumber(latest?.totals?.suiteCount) -
        normalizeNumber(baseline?.totals?.suiteCount),
      caseCount:
        normalizeNumber(latest?.totals?.caseCount) -
        normalizeNumber(baseline?.totals?.caseCount),
      readyCount:
        normalizeNumber(latest?.totals?.readyCount) -
        normalizeNumber(baseline?.totals?.readyCount),
      invalidCount:
        normalizeNumber(latest?.totals?.invalidCount) -
        normalizeNumber(baseline?.totals?.invalidCount),
      pendingRequestCaseCount:
        normalizeNumber(latest?.totals?.pendingRequestCaseCount) -
        normalizeNumber(baseline?.totals?.pendingRequestCaseCount),
      needsHumanReviewCount:
        normalizeNumber(latest?.totals?.needsHumanReviewCount) -
        normalizeNumber(baseline?.totals?.needsHumanReviewCount),
      readyRate: readyRateDelta,
    },
    signals: buildStatusSignals(baseline, latest, sortedSamples.length),
    samples: sortedSamples.map((entry) => ({
      generatedAt: entry.summary.generatedAt,
      sourcePath: entry.sourcePath,
      totals: entry.summary.totals,
    })),
    suiteDeltas: buildSuiteDeltas(baseline, latest),
    classificationDeltas: {
      suiteTags: buildBreakdownDeltas(baseline, latest, "suiteTags"),
      failureModes: buildBreakdownDeltas(baseline, latest, "failureModes"),
    },
  };
}

function renderText(report) {
  const lines = [
    `[harness-eval-trend] samples: ${report.sampleCount}`,
    `[harness-eval-trend] baseline: ${report.baseline.generatedAt}`,
    `[harness-eval-trend] latest  : ${report.latest.generatedAt}`,
    `[harness-eval-trend] delta caseCount: ${report.delta.caseCount}`,
    `[harness-eval-trend] delta readyCount: ${report.delta.readyCount}`,
    `[harness-eval-trend] delta invalidCount: ${report.delta.invalidCount}`,
    `[harness-eval-trend] delta pendingRequestCaseCount: ${report.delta.pendingRequestCaseCount}`,
    `[harness-eval-trend] delta readyRate: ${(report.delta.readyRate * 100).toFixed(1)}%`,
  ];

  for (const signal of report.signals) {
    lines.push(`[harness-eval-trend] signal: ${signal}`);
  }

  const topFailureModeDeltas = report.classificationDeltas.failureModes.slice(
    0,
    5,
  );
  if (topFailureModeDeltas.length > 0) {
    lines.push("[harness-eval-trend] top failure mode deltas:");
    for (const entry of topFailureModeDeltas) {
      lines.push(
        `  - ${entry.name}: delta_case=${entry.delta.caseCount}, delta_invalid=${entry.delta.invalidCount}, delta_pending=${entry.delta.pendingRequestCaseCount}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderMarkdown(report) {
  const lines = [
    "# Lime Harness Eval Trend",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 样本数：${report.sampleCount}`,
    `- baseline：${report.baseline.generatedAt}`,
    `- latest：${report.latest.generatedAt}`,
    "",
    "## 核心变化",
    "",
    `- suite 数变化：${report.delta.suiteCount}`,
    `- case 数变化：${report.delta.caseCount}`,
    `- ready 数变化：${report.delta.readyCount}`,
    `- invalid 数变化：${report.delta.invalidCount}`,
    `- pending request case 变化：${report.delta.pendingRequestCaseCount}`,
    `- needs review case 变化：${report.delta.needsHumanReviewCount}`,
    `- ready rate 变化：${(report.delta.readyRate * 100).toFixed(1)}%`,
    "",
    "## 信号",
    "",
  ];

  for (const signal of report.signals) {
    lines.push(`- ${signal}`);
  }

  if (report.classificationDeltas.failureModes.length > 0) {
    lines.push("");
    lines.push("## Failure Mode 变化");
    lines.push("");
    lines.push(
      "| Failure Mode | baseline case | latest case | delta case | delta invalid | delta pending_request |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const entry of report.classificationDeltas.failureModes) {
      lines.push(
        `| ${entry.name} | ${entry.baseline.caseCount} | ${entry.latest.caseCount} | ${entry.delta.caseCount} | ${entry.delta.invalidCount} | ${entry.delta.pendingRequestCaseCount} |`,
      );
    }
  }

  if (report.classificationDeltas.suiteTags.length > 0) {
    lines.push("");
    lines.push("## Suite Tag 变化");
    lines.push("");
    lines.push(
      "| Suite Tag | baseline case | latest case | delta case | delta invalid |",
    );
    lines.push("| --- | --- | --- | --- | --- |");
    for (const entry of report.classificationDeltas.suiteTags) {
      lines.push(
        `| ${entry.name} | ${entry.baseline.caseCount} | ${entry.latest.caseCount} | ${entry.delta.caseCount} | ${entry.delta.invalidCount} |`,
      );
    }
  }

  lines.push("");
  lines.push("## 时间线样本");
  lines.push("");
  lines.push("| 时间 | 来源 | case | ready | invalid | pending_request |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const sample of report.samples) {
    lines.push(
      `| ${sample.generatedAt} | \`${sample.sourcePath}\` | ${sample.totals.caseCount} | ${sample.totals.readyCount} | ${sample.totals.invalidCount} | ${sample.totals.pendingRequestCaseCount} |`,
    );
  }

  lines.push("");
  lines.push("## Suite 变化");
  lines.push("");
  lines.push(
    "| Suite | baseline ready/total | latest ready/total | invalid delta |",
  );
  lines.push("| --- | --- | --- | --- |");
  for (const suite of report.suiteDeltas) {
    lines.push(
      `| ${suite.title} | ${suite.baseline.readyCount}/${suite.baseline.caseCount} | ${suite.latest.readyCount}/${suite.latest.caseCount} | ${suite.delta.invalidCount} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function loadSamples(options, repoRoot) {
  const sampleEntries = [];
  const seenFingerprints = new Set();

  const candidateFiles = [];
  for (const input of options.inputs) {
    candidateFiles.push(resolvePath(repoRoot, input));
  }
  if (options.historyDir) {
    candidateFiles.push(
      ...collectJsonFiles(resolvePath(repoRoot, options.historyDir)),
    );
  }

  for (const filePath of candidateFiles) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    let parsed;
    try {
      parsed = readJsonFile(filePath);
    } catch {
      continue;
    }

    if (!isHarnessEvalSummary(parsed)) {
      continue;
    }

    const fingerprint = JSON.stringify([
      parsed.generatedAt,
      parsed.totals.caseCount,
      parsed.totals.readyCount,
      parsed.totals.invalidCount,
      parsed.totals.pendingRequestCaseCount,
    ]);
    if (seenFingerprints.has(fingerprint)) {
      continue;
    }
    seenFingerprints.add(fingerprint);

    sampleEntries.push({
      sourcePath: path.relative(repoRoot, filePath) || ".",
      summary: parsed,
    });
  }

  if (sampleEntries.length === 0) {
    const currentSummary = buildCurrentSummary(
      repoRoot,
      path.resolve(options.workspaceRoot),
    );
    sampleEntries.push({
      sourcePath: "(generated-current-summary)",
      summary: currentSummary,
    });
  }

  return sampleEntries;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const repoRoot = process.cwd();
  const samples = loadSamples(options, repoRoot);
  const report = buildTrendReport(samples, repoRoot);
  const jsonOutput = `${JSON.stringify(report, null, 2)}\n`;
  const markdownOutput = renderMarkdown(report);
  const textOutput = renderText(report);

  if (options.outputJson) {
    const outputPath = resolvePath(repoRoot, options.outputJson);
    ensureParentDirectory(outputPath);
    fs.writeFileSync(outputPath, jsonOutput, "utf8");
  }

  if (options.outputMarkdown) {
    const outputPath = resolvePath(repoRoot, options.outputMarkdown);
    ensureParentDirectory(outputPath);
    fs.writeFileSync(outputPath, markdownOutput, "utf8");
  }

  if (options.format === "json") {
    process.stdout.write(jsonOutput);
    return;
  }

  if (options.format === "markdown") {
    process.stdout.write(markdownOutput);
    return;
  }

  process.stdout.write(textOutput);
}

main();
