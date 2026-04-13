#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const RUNNER_PATH = "scripts/harness-eval-runner.mjs";
const OBSERVABILITY_GAP_SUITE_TAG = "observability-gap";
const OBSERVABILITY_FAILURE_OUTCOMES = new Set([
  "artifactValidator:issues_present",
  "artifactValidator:fallback_used",
  "browserVerification:failure",
  "browserVerification:unknown",
  "guiSmoke:failed",
]);
const RECOVERED_VERIFICATION_OUTCOMES = new Set([
  "artifactValidator:repaired",
  "browserVerification:success",
  "guiSmoke:passed",
  "guiSmoke:clean",
]);

function parseArgs(argv) {
  const result = {
    format: "text",
    help: false,
    historyDir: "",
    inputs: [],
    manifest: "",
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

    if (arg === "--manifest" && argv[index + 1]) {
      result.manifest = String(argv[index + 1]).trim();
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
  node scripts/harness-eval-trend-report.mjs --manifest "./tmp/harness-evals.manifest.json"
  node scripts/harness-eval-trend-report.mjs --input "./tmp/harness-eval-summary.json"
  node scripts/harness-eval-trend-report.mjs --history-dir "./artifacts/history"
  node scripts/harness-eval-trend-report.mjs --output-json "./tmp/harness-eval-trend.json" --output-markdown "./tmp/harness-eval-trend.md"

选项:
  --manifest PATH        透传给 harness eval runner，覆盖默认 manifest
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

function buildCurrentSummary(repoRoot, workspaceRoot, manifestPath) {
  const nodeCommand = process.execPath;
  const runnerPath = resolvePath(repoRoot, RUNNER_PATH);
  const args = [runnerPath, "--format", "json", "--workspace-root", workspaceRoot];
  if (manifestPath) {
    args.push("--manifest", manifestPath);
  }
  const output = execFileSync(
    nodeCommand,
    args,
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

function listAllCases(summary) {
  const suites = Array.isArray(summary?.suites) ? summary.suites : [];
  return suites.flatMap((suite) => (Array.isArray(suite?.cases) ? suite.cases : []));
}

function getBreakdownEntries(summary, key) {
  return Array.isArray(summary?.breakdowns?.[key]) ? summary.breakdowns[key] : [];
}

function getBreakdownCaseCount(summary, key, namesSet) {
  return getBreakdownEntries(summary, key).reduce((total, entry) => {
    const name = String(entry?.name ?? "");
    if (!namesSet.has(name)) {
      return total;
    }
    return total + normalizeNumber(entry?.caseCount);
  }, 0);
}

function buildObservabilityGapTotals(summary) {
  const rawTotals =
    summary?.totals && typeof summary.totals === "object" ? summary.totals : {};
  let total = normalizeNumber(rawTotals.observabilityGapCaseCount);
  let current = normalizeNumber(rawTotals.currentObservabilityGapCaseCount);
  let degraded = normalizeNumber(rawTotals.degradedObservabilityGapCaseCount);
  const allCases = listAllCases(summary);

  if (allCases.length === 0) {
    if (current === 0 && degraded === 0 && total > 0) {
      current = total;
    }
    return {
      total: total || current + degraded,
      current,
      degraded,
    };
  }

  let derivedCurrent = 0;
  let derivedDegraded = 0;
  for (const entry of allCases) {
    if (normalizeNumber(entry?.observabilityGapCount) <= 0) {
      continue;
    }
    const tags = Array.isArray(entry?.tags) ? entry.tags : [];
    if (tags.includes(OBSERVABILITY_GAP_SUITE_TAG)) {
      derivedDegraded += 1;
    } else {
      derivedCurrent += 1;
    }
  }

  const derivedTotal = derivedCurrent + derivedDegraded;
  if (derivedTotal === 0) {
    return {
      total: total || current + degraded,
      current,
      degraded,
    };
  }

  return {
    total: derivedTotal,
    current: derivedCurrent,
    degraded: derivedDegraded,
  };
}

function buildNormalizedTotals(summary) {
  const rawTotals =
    summary?.totals && typeof summary.totals === "object" ? summary.totals : {};
  const gapTotals = buildObservabilityGapTotals(summary);
  const currentRecoveredVerificationEntries =
    getCurrentRecoveredVerificationEntries(summary);
  return {
    suiteCount: normalizeNumber(rawTotals.suiteCount),
    caseCount: normalizeNumber(rawTotals.caseCount),
    readyCount: normalizeNumber(rawTotals.readyCount),
    invalidCount: normalizeNumber(rawTotals.invalidCount),
    pendingRequestCaseCount: normalizeNumber(rawTotals.pendingRequestCaseCount),
    needsHumanReviewCount: normalizeNumber(rawTotals.needsHumanReviewCount),
    reviewDecisionRecordedCount: normalizeNumber(
      rawTotals.reviewDecisionRecordedCount,
    ),
    observabilityGapCaseCount: gapTotals.total,
    currentObservabilityGapCaseCount: gapTotals.current,
    degradedObservabilityGapCaseCount: gapTotals.degraded,
    currentRecoveredVerificationCaseCount:
      currentRecoveredVerificationEntries.length > 0
        ? currentRecoveredVerificationEntries.reduce(
            (total, entry) => total + normalizeNumber(entry?.caseCount),
            0,
          )
        : normalizeNumber(rawTotals.currentRecoveredVerificationCaseCount),
  };
}

function computeReadyRate(summary) {
  const totals = buildNormalizedTotals(summary);
  const caseCount = totals.caseCount;
  if (caseCount <= 0) {
    return 0;
  }
  return totals.readyCount / caseCount;
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
  const entries = getBreakdownEntries(summary, key);
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

function getCurrentRecoveredVerificationEntries(summary) {
  const explicitEntries = getBreakdownEntries(
    summary,
    "currentRecoveredObservabilityVerificationOutcomes",
  );
  if (explicitEntries.length > 0) {
    return explicitEntries;
  }

  return getBreakdownEntries(
    summary,
    "currentObservabilityVerificationOutcomes",
  ).filter((entry) => RECOVERED_VERIFICATION_OUTCOMES.has(entry.name));
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

function buildFilteredBreakdownDeltas(baseline, latest, key, predicate) {
  return buildBreakdownDeltas(baseline, latest, key).filter((entry) =>
    predicate(entry),
  );
}

function buildCurrentRecoveredVerificationDeltas(baseline, latest) {
  const baselineExplicitEntries = getBreakdownEntries(
    baseline,
    "currentRecoveredObservabilityVerificationOutcomes",
  );
  const latestExplicitEntries = getBreakdownEntries(
    latest,
    "currentRecoveredObservabilityVerificationOutcomes",
  );

  if (baselineExplicitEntries.length > 0 || latestExplicitEntries.length > 0) {
    return buildBreakdownDeltas(
      baseline,
      latest,
      "currentRecoveredObservabilityVerificationOutcomes",
    );
  }

  return buildFilteredBreakdownDeltas(
    baseline,
    latest,
    "currentObservabilityVerificationOutcomes",
    (entry) => RECOVERED_VERIFICATION_OUTCOMES.has(entry.name),
  );
}

function buildStatusSignals(baseline, latest, sampleCount) {
  const signals = [];

  if (sampleCount < 2) {
    signals.push("样本数不足 2，当前仅形成 trend seed，还不能判断长期退化。");
    return signals;
  }

  const readyRateDelta = computeReadyRate(latest) - computeReadyRate(baseline);
  const baselineTotals = buildNormalizedTotals(baseline);
  const latestTotals = buildNormalizedTotals(latest);
  const invalidDelta = latestTotals.invalidCount - baselineTotals.invalidCount;
  const pendingDelta =
    latestTotals.pendingRequestCaseCount - baselineTotals.pendingRequestCaseCount;
  const currentObservabilityGapDelta =
    latestTotals.currentObservabilityGapCaseCount -
    baselineTotals.currentObservabilityGapCaseCount;
  const currentRecoveredVerificationDelta =
    latestTotals.currentRecoveredVerificationCaseCount -
    baselineTotals.currentRecoveredVerificationCaseCount;

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

  if (currentObservabilityGapDelta > 0) {
    signals.push(
      `current observability gap case 增加 ${currentObservabilityGapDelta}，说明主线样本开始带缺口，需先补 evidence / analysis / replay 的证据覆盖。`,
    );
  }

  if (currentRecoveredVerificationDelta > 0) {
    signals.push(
      `current recovered verification case 增加 ${currentRecoveredVerificationDelta}，说明主线路径正在累积正向守卫。`,
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

  const verificationOutcomeDeltas = buildBreakdownDeltas(
    baseline,
    latest,
    "observabilityVerificationOutcomes",
  );
  const increasedVerificationFailure = verificationOutcomeDeltas.find(
    (entry) =>
      OBSERVABILITY_FAILURE_OUTCOMES.has(entry.name) &&
      entry.delta.caseCount > 0,
  );
  if (increasedVerificationFailure) {
    signals.push(
      `verification outcome \`${increasedVerificationFailure.name}\` 新增 ${increasedVerificationFailure.delta.caseCount} 个 case。`,
    );
  }

  const currentRecoveredVerificationDeltas =
    buildCurrentRecoveredVerificationDeltas(baseline, latest);
  for (const entry of currentRecoveredVerificationDeltas.filter(
    (candidate) => candidate.delta.caseCount < 0,
  )) {
    signals.push(
      `current recovered verification baseline \`${entry.name}\` 减少 ${Math.abs(entry.delta.caseCount)}，说明正向守卫可能回退。`,
    );
  }
  for (const entry of currentRecoveredVerificationDeltas.filter(
    (candidate) => candidate.delta.caseCount > 0,
  )) {
    signals.push(
      `current recovered verification baseline \`${entry.name}\` 新增 ${entry.delta.caseCount}，说明主线路径正在形成正向基线。`,
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
  const baselineTotals = buildNormalizedTotals(baseline);
  const latestTotals = buildNormalizedTotals(latest);
  const readyRateDelta = computeReadyRate(latest) - computeReadyRate(baseline);

  return {
    reportVersion: "v1",
    generatedAt: new Date().toISOString(),
    repoRoot,
    sampleCount: sortedSamples.length,
    baseline: {
      generatedAt: baseline.generatedAt,
      sourcePath: baselineEntry.sourcePath,
      totals: baselineTotals,
    },
    latest: {
      generatedAt: latest.generatedAt,
      sourcePath: latestEntry.sourcePath,
      totals: latestTotals,
    },
    delta: {
      suiteCount: latestTotals.suiteCount - baselineTotals.suiteCount,
      caseCount: latestTotals.caseCount - baselineTotals.caseCount,
      readyCount: latestTotals.readyCount - baselineTotals.readyCount,
      invalidCount: latestTotals.invalidCount - baselineTotals.invalidCount,
      pendingRequestCaseCount:
        latestTotals.pendingRequestCaseCount -
        baselineTotals.pendingRequestCaseCount,
      needsHumanReviewCount:
        latestTotals.needsHumanReviewCount -
        baselineTotals.needsHumanReviewCount,
      reviewDecisionRecordedCount:
        latestTotals.reviewDecisionRecordedCount -
        baselineTotals.reviewDecisionRecordedCount,
      observabilityGapCaseCount:
        latestTotals.observabilityGapCaseCount -
        baselineTotals.observabilityGapCaseCount,
      currentObservabilityGapCaseCount:
        latestTotals.currentObservabilityGapCaseCount -
        baselineTotals.currentObservabilityGapCaseCount,
      degradedObservabilityGapCaseCount:
        latestTotals.degradedObservabilityGapCaseCount -
        baselineTotals.degradedObservabilityGapCaseCount,
      currentRecoveredVerificationCaseCount:
        latestTotals.currentRecoveredVerificationCaseCount -
        baselineTotals.currentRecoveredVerificationCaseCount,
      readyRate: readyRateDelta,
    },
    signals: buildStatusSignals(baseline, latest, sortedSamples.length),
    samples: sortedSamples.map((entry) => ({
      generatedAt: entry.summary.generatedAt,
      sourcePath: entry.sourcePath,
      totals: buildNormalizedTotals(entry.summary),
    })),
    suiteDeltas: buildSuiteDeltas(baseline, latest),
    classificationDeltas: {
      suiteTags: buildBreakdownDeltas(baseline, latest, "suiteTags"),
      failureModes: buildBreakdownDeltas(baseline, latest, "failureModes"),
      reviewDecisionStatuses: buildBreakdownDeltas(
        baseline,
        latest,
        "reviewDecisionStatuses",
      ),
      reviewRiskLevels: buildBreakdownDeltas(
        baseline,
        latest,
        "reviewRiskLevels",
      ),
      observabilitySignals: buildBreakdownDeltas(
        baseline,
        latest,
        "observabilitySignals",
      ),
      observabilityVerificationOutcomes: buildBreakdownDeltas(
        baseline,
        latest,
        "observabilityVerificationOutcomes",
      ),
      currentRecoveredObservabilityVerificationOutcomes:
        buildCurrentRecoveredVerificationDeltas(baseline, latest),
      currentObservabilityVerificationOutcomes: buildBreakdownDeltas(
        baseline,
        latest,
        "currentObservabilityVerificationOutcomes",
      ),
      degradedObservabilityVerificationOutcomes: buildBreakdownDeltas(
        baseline,
        latest,
        "degradedObservabilityVerificationOutcomes",
      ),
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
    `[harness-eval-trend] delta reviewDecisionRecordedCount: ${report.delta.reviewDecisionRecordedCount}`,
    `[harness-eval-trend] delta observabilityGapCaseCount: ${report.delta.observabilityGapCaseCount}`,
    `[harness-eval-trend] delta currentObservabilityGapCaseCount: ${report.delta.currentObservabilityGapCaseCount}`,
    `[harness-eval-trend] delta degradedObservabilityGapCaseCount: ${report.delta.degradedObservabilityGapCaseCount}`,
    `[harness-eval-trend] delta currentRecoveredVerificationCaseCount: ${report.delta.currentRecoveredVerificationCaseCount}`,
    `[harness-eval-trend] latest currentObservabilityGapCaseCount: ${report.latest.totals.currentObservabilityGapCaseCount}`,
    `[harness-eval-trend] latest degradedObservabilityGapCaseCount: ${report.latest.totals.degradedObservabilityGapCaseCount}`,
    `[harness-eval-trend] latest currentRecoveredVerificationCaseCount: ${report.latest.totals.currentRecoveredVerificationCaseCount}`,
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

  const topReviewDecisionDeltas =
    report.classificationDeltas.reviewDecisionStatuses.slice(0, 5);
  if (topReviewDecisionDeltas.length > 0) {
    lines.push("[harness-eval-trend] review decision deltas:");
    for (const entry of topReviewDecisionDeltas) {
      lines.push(
        `  - ${entry.name}: delta_case=${entry.delta.caseCount}, delta_invalid=${entry.delta.invalidCount}`,
      );
    }
  }

  const topObservabilityDeltas =
    report.classificationDeltas.observabilitySignals.slice(0, 5);
  if (topObservabilityDeltas.length > 0) {
    lines.push("[harness-eval-trend] observability signal deltas:");
    for (const entry of topObservabilityDeltas) {
      lines.push(
        `  - ${entry.name}: delta_case=${entry.delta.caseCount}, latest_case=${entry.latest.caseCount}, latest_invalid=${entry.latest.invalidCount}`,
      );
    }
  }

  const topVerificationOutcomeDeltas =
    report.classificationDeltas.observabilityVerificationOutcomes.slice(0, 5);
  if (topVerificationOutcomeDeltas.length > 0) {
    lines.push("[harness-eval-trend] observability verification outcome deltas:");
    for (const entry of topVerificationOutcomeDeltas) {
      lines.push(
        `  - ${entry.name}: delta_case=${entry.delta.caseCount}, latest_case=${entry.latest.caseCount}, latest_invalid=${entry.latest.invalidCount}`,
      );
    }
  }

  const topCurrentRecoveredVerificationDeltas =
    report.classificationDeltas.currentRecoveredObservabilityVerificationOutcomes.slice(
      0,
      5,
    );
  if (topCurrentRecoveredVerificationDeltas.length > 0) {
    lines.push("[harness-eval-trend] current recovered verification baseline deltas:");
    for (const entry of topCurrentRecoveredVerificationDeltas) {
      lines.push(
        `  - ${entry.name}: baseline_case=${entry.baseline.caseCount}, latest_case=${entry.latest.caseCount}, delta_case=${entry.delta.caseCount}`,
      );
    }
  }

  lines.push("[harness-eval-trend] observability gap roles:");
  lines.push(
    `  - total: baseline=${report.baseline.totals.observabilityGapCaseCount}, latest=${report.latest.totals.observabilityGapCaseCount}, delta=${report.delta.observabilityGapCaseCount}`,
  );
  lines.push(
    `  - current: baseline=${report.baseline.totals.currentObservabilityGapCaseCount}, latest=${report.latest.totals.currentObservabilityGapCaseCount}, delta=${report.delta.currentObservabilityGapCaseCount}`,
  );
  lines.push(
    `  - degraded: baseline=${report.baseline.totals.degradedObservabilityGapCaseCount}, latest=${report.latest.totals.degradedObservabilityGapCaseCount}, delta=${report.delta.degradedObservabilityGapCaseCount}`,
  );

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
    `- 已记录人工审核变化：${report.delta.reviewDecisionRecordedCount}`,
    `- observability gap case 变化：${report.delta.observabilityGapCaseCount}`,
    `- current observability gap case 变化：${report.delta.currentObservabilityGapCaseCount}`,
    `- degraded observability gap case 变化：${report.delta.degradedObservabilityGapCaseCount}`,
    `- current recovered verification case 变化：${report.delta.currentRecoveredVerificationCaseCount}`,
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

  if (report.classificationDeltas.reviewDecisionStatuses.length > 0) {
    lines.push("");
    lines.push("## 人工审核状态变化");
    lines.push("");
    lines.push("| 审核状态 | baseline case | latest case | delta case | delta invalid |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const entry of report.classificationDeltas.reviewDecisionStatuses) {
      lines.push(
        `| ${entry.name} | ${entry.baseline.caseCount} | ${entry.latest.caseCount} | ${entry.delta.caseCount} | ${entry.delta.invalidCount} |`,
      );
    }
  }

  if (report.classificationDeltas.reviewRiskLevels.length > 0) {
    lines.push("");
    lines.push("## 风险等级变化");
    lines.push("");
    lines.push("| 风险等级 | baseline case | latest case | delta case | delta invalid |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const entry of report.classificationDeltas.reviewRiskLevels) {
      lines.push(
        `| ${entry.name} | ${entry.baseline.caseCount} | ${entry.latest.caseCount} | ${entry.delta.caseCount} | ${entry.delta.invalidCount} |`,
      );
    }
  }

  if (report.classificationDeltas.observabilitySignals.length > 0) {
    lines.push("");
    lines.push("## Observability Coverage 变化");
    lines.push("");
    lines.push("| Signal | baseline case | latest case | delta case | delta invalid |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const entry of report.classificationDeltas.observabilitySignals) {
      lines.push(
        `| ${entry.name} | ${entry.baseline.caseCount} | ${entry.latest.caseCount} | ${entry.delta.caseCount} | ${entry.delta.invalidCount} |`,
      );
    }
  }

  if (report.classificationDeltas.observabilityVerificationOutcomes.length > 0) {
    lines.push("");
    lines.push("## Observability Verification Outcome 变化");
    lines.push("");
    lines.push("| Outcome | baseline case | latest case | delta case | delta invalid |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const entry of report.classificationDeltas.observabilityVerificationOutcomes) {
      lines.push(
        `| ${entry.name} | ${entry.baseline.caseCount} | ${entry.latest.caseCount} | ${entry.delta.caseCount} | ${entry.delta.invalidCount} |`,
      );
    }
  }

  if (
    report.classificationDeltas.currentRecoveredObservabilityVerificationOutcomes
      .length > 0
  ) {
    lines.push("");
    lines.push("## Current Recovered Baseline 变化");
    lines.push("");
    lines.push("| Outcome | baseline case | latest case | delta case |");
    lines.push("| --- | --- | --- | --- |");
    for (const entry of report.classificationDeltas.currentRecoveredObservabilityVerificationOutcomes) {
      lines.push(
        `| ${entry.name} | ${entry.baseline.caseCount} | ${entry.latest.caseCount} | ${entry.delta.caseCount} |`,
      );
    }
  }

  lines.push("");
  lines.push("## Observability Gap 角色变化");
  lines.push("");
  lines.push("| 角色 | baseline case | latest case | delta case |");
  lines.push("| --- | --- | --- | --- |");
  lines.push(
    `| total | ${report.baseline.totals.observabilityGapCaseCount} | ${report.latest.totals.observabilityGapCaseCount} | ${report.delta.observabilityGapCaseCount} |`,
  );
  lines.push(
    `| current | ${report.baseline.totals.currentObservabilityGapCaseCount} | ${report.latest.totals.currentObservabilityGapCaseCount} | ${report.delta.currentObservabilityGapCaseCount} |`,
  );
  lines.push(
    `| degraded | ${report.baseline.totals.degradedObservabilityGapCaseCount} | ${report.latest.totals.degradedObservabilityGapCaseCount} | ${report.delta.degradedObservabilityGapCaseCount} |`,
  );

  lines.push("");
  lines.push("## 时间线样本");
  lines.push("");
  lines.push(
    "| 时间 | 来源 | case | ready | invalid | pending_request | current_gap | degraded_gap |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const sample of report.samples) {
    lines.push(
      `| ${sample.generatedAt} | \`${sample.sourcePath}\` | ${sample.totals.caseCount} | ${sample.totals.readyCount} | ${sample.totals.invalidCount} | ${sample.totals.pendingRequestCaseCount} | ${sample.totals.currentObservabilityGapCaseCount} | ${sample.totals.degradedObservabilityGapCaseCount} |`,
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
      options.manifest,
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
