function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const VERIFICATION_FAILURE_OUTCOMES = new Set([
  "issues_present",
  "fallback_used",
  "failure",
  "unknown",
  "failed",
]);

const VERIFICATION_RECOVERED_OUTCOMES = new Set([
  "repaired",
  "success",
  "passed",
  "clean",
]);

const BLOCKING_VERIFICATION_FAILURES = new Set([
  "browserVerification:failure",
  "guiSmoke:failed",
]);

export function splitVerificationOutcomeName(name) {
  const normalizedName = normalizeString(name);
  if (!normalizedName) {
    return { name: "", signal: "", outcome: "" };
  }

  const separatorIndex = normalizedName.indexOf(":");
  if (separatorIndex < 0) {
    return {
      name: normalizedName,
      signal: normalizedName,
      outcome: "",
    };
  }

  return {
    name: normalizedName,
    signal: normalizedName.slice(0, separatorIndex).trim(),
    outcome: normalizedName.slice(separatorIndex + 1).trim(),
  };
}

export function isVerificationFailureOutcome(outcome) {
  return VERIFICATION_FAILURE_OUTCOMES.has(normalizeString(outcome));
}

export function isVerificationRecoveredOutcome(outcome) {
  return VERIFICATION_RECOVERED_OUTCOMES.has(normalizeString(outcome));
}

export function getVerificationOutcomeRole(signal, outcome) {
  const normalizedSignal = normalizeString(signal);
  const normalizedOutcome = normalizeString(outcome);
  const fingerprint = `${normalizedSignal}:${normalizedOutcome}`;

  if (BLOCKING_VERIFICATION_FAILURES.has(fingerprint)) {
    return "blocking_failure";
  }

  if (isVerificationFailureOutcome(normalizedOutcome)) {
    return "advisory_failure";
  }

  if (isVerificationRecoveredOutcome(normalizedOutcome)) {
    return "recovered";
  }

  return "other";
}

export function getVerificationOutcomeWeight(outcome) {
  switch (normalizeString(outcome)) {
    case "failed":
      return 140;
    case "failure":
      return 130;
    case "unknown":
      return 115;
    case "fallback_used":
      return 110;
    case "issues_present":
      return 100;
    case "repaired":
      return 70;
    default:
      return 0;
  }
}

function dedupeNonEmptyStrings(values) {
  const normalizedValues = Array.isArray(values) ? values : [];
  return [...new Set(normalizedValues.map((value) => normalizeString(value)).filter(Boolean))];
}

export function hasVerificationOutcome(entries, signal, outcome) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const normalizedSignal = normalizeString(signal);
  const normalizedOutcome = normalizeString(outcome);

  return normalizedEntries.some(
    (entry) =>
      normalizeString(entry?.signal) === normalizedSignal &&
      normalizeString(entry?.outcome) === normalizedOutcome,
  );
}

export function buildBlockingVerificationFollowUp(entries) {
  const hasGuiSmokeFailure = hasVerificationOutcome(entries, "guiSmoke", "failed");
  const hasBrowserVerificationFailure = hasVerificationOutcome(
    entries,
    "browserVerification",
    "failure",
  );
  const commands = ["npm run harness:eval", "npm run harness:eval:trend"];
  const backlogTools = [];
  const rationale = [];

  if (hasGuiSmokeFailure) {
    commands.push("npm run verify:gui-smoke");
    rationale.push(
      "current 样本已出现 guiSmoke:failed，先恢复 GUI 壳 / DevBridge / Workspace 主路径的最小可启动性。",
    );
    backlogTools.push(
      "优先收敛 GUI 壳 / DevBridge / Workspace 主路径，再复跑 `npm run verify:gui-smoke`。",
    );
  }

  if (hasBrowserVerificationFailure) {
    rationale.push(
      "current 样本已出现 browserVerification:failure，应先回看 browser replay / verification 失败样本，把失败断言回挂到受影响主路径。",
    );
    backlogTools.push(
      "回看 browser replay / browser verification 失败样本，并把失败断言回挂到受影响主路径。",
    );
  }

  if (backlogTools.length === 0) {
    backlogTools.push("按受影响主路径追加 `npm run verify:gui-smoke` 或专项 smoke");
  }

  return {
    commands: dedupeNonEmptyStrings(commands),
    backlogTools: dedupeNonEmptyStrings(backlogTools),
    rationale: dedupeNonEmptyStrings(rationale),
  };
}

export function buildAdvisoryVerificationFollowUp(entries) {
  const hasArtifactValidatorIssuesPresent = hasVerificationOutcome(
    entries,
    "artifactValidator",
    "issues_present",
  );
  const hasArtifactValidatorFallbackUsed = hasVerificationOutcome(
    entries,
    "artifactValidator",
    "fallback_used",
  );
  const hasBrowserVerificationUnknown = hasVerificationOutcome(
    entries,
    "browserVerification",
    "unknown",
  );
  const rationale = [];
  const backlogTools = [];

  if (hasArtifactValidatorIssuesPresent) {
    rationale.push(
      "current 样本已出现 artifactValidator:issues_present，应先回看 validator issue 明细，再收敛 artifact 导出字段。",
    );
    backlogTools.push(
      "回看 artifact validator issue 明细，并收敛 evidence pack / artifacts.json / analysis handoff 的 artifact 字段。",
    );
  }

  if (hasArtifactValidatorFallbackUsed) {
    rationale.push(
      "current 样本已出现 artifactValidator:fallback_used，说明 artifact 主路径仍不稳定，不能继续依赖 fallback 充当事实。",
    );
    backlogTools.push(
      "补齐 artifact 主路径导出与修复链，减少 fallback_used 持续留在 current 样本。",
    );
  }

  if (hasBrowserVerificationUnknown) {
    rationale.push(
      "current 样本已出现 browserVerification:unknown，需要先把浏览器验证结果收敛成明确 outcome，再继续扩大分析。",
    );
    backlogTools.push(
      "回看 browser verification 导出链，确保 evidence pack / replay / analysis handoff 写出明确 success 或 failure，而不是 unknown。",
    );
  }

  if (backlogTools.length === 0) {
    backlogTools.push(
      "先对齐 current verification outcome 到 artifact/browser/gui 主路径，再继续补 observability 证据。",
    );
  }

  return {
    rationale: dedupeNonEmptyStrings(rationale),
    backlogTools: dedupeNonEmptyStrings(backlogTools),
  };
}

export function buildRecoveredVerificationFollowUp(entries) {
  const hasArtifactValidatorRepaired = hasVerificationOutcome(
    entries,
    "artifactValidator",
    "repaired",
  );
  const hasBrowserVerificationSuccess = hasVerificationOutcome(
    entries,
    "browserVerification",
    "success",
  );
  const hasGuiSmokePassed = hasVerificationOutcome(entries, "guiSmoke", "passed");
  const commands = ["npm run harness:eval", "npm run harness:eval:trend"];
  const rationale = [];
  const backlogTools = [];

  if (hasArtifactValidatorRepaired) {
    rationale.push(
      "current 样本已出现 artifactValidator:repaired，说明 artifact 修复链已经回到可复用的主路径。",
    );
    backlogTools.push(
      "在 evidence pack / analysis handoff 里同时保留 artifact issue 与 repaired outcome，避免只剩修复结论而丢失修复上下文。",
    );
  }

  if (hasBrowserVerificationSuccess) {
    rationale.push(
      "current 样本已出现 browserVerification:success，可把浏览器验证成功样本固化成主路径正向基线。",
    );
    backlogTools.push(
      "把 browser verification 成功样本固定进 current replay 基线，后续 failure 或 unknown 直接对比这条正向路径。",
    );
  }

  if (hasGuiSmokePassed) {
    commands.push("npm run verify:gui-smoke");
    rationale.push(
      "current 样本已出现 guiSmoke:passed，可继续把 GUI smoke 通过链路当成桌面主路径的正向守卫。",
    );
    backlogTools.push(
      "主路径变更时优先复跑 `npm run verify:gui-smoke`，确认 GUI 壳 / DevBridge / Workspace 不从 passed 回退。",
    );
  }

  return {
    commands: dedupeNonEmptyStrings(commands),
    rationale: dedupeNonEmptyStrings(rationale),
    backlogTools: dedupeNonEmptyStrings(backlogTools),
  };
}

export function formatVerificationOutcomeName(entry) {
  if (typeof entry === "string") {
    return normalizeString(entry);
  }

  const explicitName = normalizeString(entry?.name);
  if (explicitName) {
    return explicitName;
  }

  const signal = normalizeString(entry?.signal);
  const outcome = normalizeString(entry?.outcome);
  return signal && outcome ? `${signal}:${outcome}` : "";
}

export function formatVerificationOutcomeCompactLabel(entry) {
  if (typeof entry === "string") {
    const parsed = splitVerificationOutcomeName(entry);
    if (parsed.signal && parsed.outcome) {
      return `${parsed.signal} (${parsed.outcome})`;
    }
    return normalizeString(entry);
  }

  const signal = normalizeString(entry?.signal);
  const outcome = normalizeString(entry?.outcome);
  if (signal && outcome) {
    return `${signal} (${outcome})`;
  }

  const parsed = splitVerificationOutcomeName(entry?.name);
  if (parsed.signal && parsed.outcome) {
    return `${parsed.signal} (${parsed.outcome})`;
  }

  return normalizeString(entry?.name);
}

export function formatVerificationOutcomeCompactLabels(entries, limit = 0) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const truncatedEntries =
    typeof limit === "number" && limit > 0
      ? normalizedEntries.slice(0, limit)
      : normalizedEntries;
  return truncatedEntries
    .map((entry) => formatVerificationOutcomeCompactLabel(entry))
    .filter(Boolean);
}

export function describeVerificationOutcome(entry) {
  const signal = normalizeString(entry?.signal, "unknown");
  const outcome = normalizeString(entry?.outcome, "unknown");

  if (signal === "artifactValidator" && outcome === "issues_present") {
    return "当前 evidence 已记录 artifact 校验问题，优先回看 validator issue 明细。";
  }
  if (signal === "artifactValidator" && outcome === "fallback_used") {
    return "当前 artifact 导出仍触发 fallback，说明产物结构或修复链未完全稳定。";
  }
  if (signal === "browserVerification" && outcome === "failure") {
    return "浏览器验证已有明确失败结果，优先回挂到 replay 或 smoke 断言。";
  }
  if (signal === "browserVerification" && outcome === "unknown") {
    return "浏览器验证结果仍不明确，需要先补 outcome 再继续扩分析。";
  }
  if (signal === "guiSmoke" && outcome === "failed") {
    return "GUI smoke 已明确失败，应优先收敛到受影响主路径。";
  }
  if (signal === "guiSmoke" && outcome === "passed") {
    return "GUI smoke 已通过，可继续把注意力放回 gap 与其它失败面。";
  }
  if (signal === "artifactValidator" && outcome === "repaired") {
    return "artifact validator 已执行修复，可结合 issues/fallback 判断是否还需继续治理。";
  }
  if (signal === "browserVerification" && outcome === "success") {
    return "浏览器验证已有成功样本，可作为 current 主线路径的正向基线。";
  }

  return "当前 verification outcome 已进入 cleanup 主线，可直接据此定位先修哪层。";
}

export function buildVerificationOutcomeEntriesFromDeltas(entries) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];

  return normalizedEntries
    .map((entry) => {
      const latest = entry != null && typeof entry === "object" ? entry.latest ?? {} : {};
      const delta = entry != null && typeof entry === "object" ? entry.delta ?? {} : {};
      const baseline =
        entry != null && typeof entry === "object" ? entry.baseline ?? {} : {};
      const parsed = splitVerificationOutcomeName(entry?.name);
      const latestCase = normalizeNumber(latest.caseCount);
      const deltaCase = normalizeNumber(delta.caseCount);

      let state = "stable";
      if (deltaCase > 0) {
        state = "expanding";
      } else if (deltaCase < 0) {
        state = "shrinking";
      } else if (latestCase > 0) {
        state = "present";
      }

      return {
        name: normalizeString(entry?.name) || "(unknown)",
        signal: parsed.signal || "(unknown)",
        outcome: parsed.outcome || "unknown",
        baseline: {
          caseCount: normalizeNumber(baseline.caseCount),
          readyCount: normalizeNumber(baseline.readyCount),
          invalidCount: normalizeNumber(baseline.invalidCount),
          pendingRequestCaseCount: normalizeNumber(
            baseline.pendingRequestCaseCount,
          ),
          needsHumanReviewCount: normalizeNumber(
            baseline.needsHumanReviewCount,
          ),
        },
        latest: {
          caseCount: latestCase,
          readyCount: normalizeNumber(latest.readyCount),
          invalidCount: normalizeNumber(latest.invalidCount),
          pendingRequestCaseCount: normalizeNumber(
            latest.pendingRequestCaseCount,
          ),
          needsHumanReviewCount: normalizeNumber(latest.needsHumanReviewCount),
        },
        delta: {
          caseCount: deltaCase,
          readyCount: normalizeNumber(delta.readyCount),
          invalidCount: normalizeNumber(delta.invalidCount),
          pendingRequestCaseCount: normalizeNumber(delta.pendingRequestCaseCount),
          needsHumanReviewCount: normalizeNumber(delta.needsHumanReviewCount),
        },
        state,
        score: latestCase * 10 + Math.abs(deltaCase) * 5,
      };
    })
    .filter((entry) => entry.latest.caseCount > 0 || entry.delta.caseCount !== 0)
    .sort((left, right) => {
      if (right.latest.caseCount !== left.latest.caseCount) {
        return right.latest.caseCount - left.latest.caseCount;
      }
      if (Math.abs(right.delta.caseCount) !== Math.abs(left.delta.caseCount)) {
        return Math.abs(right.delta.caseCount) - Math.abs(left.delta.caseCount);
      }
      return left.name.localeCompare(right.name);
    });
}

export function buildVerificationOutcomeEntriesFromBreakdowns(entries) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];

  return normalizedEntries
    .map((entry) => {
      const parsed = splitVerificationOutcomeName(entry?.name);
      const latestCase = normalizeNumber(entry?.caseCount);
      return {
        name: normalizeString(entry?.name) || "(unknown)",
        signal: parsed.signal || "(unknown)",
        outcome: parsed.outcome || "unknown",
        baseline: {
          caseCount: 0,
          readyCount: 0,
          invalidCount: 0,
          pendingRequestCaseCount: 0,
          needsHumanReviewCount: 0,
        },
        latest: {
          caseCount: latestCase,
          readyCount: normalizeNumber(entry?.readyCount),
          invalidCount: normalizeNumber(entry?.invalidCount),
          pendingRequestCaseCount: normalizeNumber(entry?.pendingRequestCaseCount),
          needsHumanReviewCount: normalizeNumber(entry?.needsHumanReviewCount),
        },
        delta: {
          caseCount: 0,
          readyCount: 0,
          invalidCount: 0,
          pendingRequestCaseCount: 0,
          needsHumanReviewCount: 0,
        },
        state: latestCase > 0 ? "present" : "stable",
        score: latestCase * 10,
      };
    })
    .filter((entry) => entry.latest.caseCount > 0)
    .sort((left, right) => {
      if (right.latest.caseCount !== left.latest.caseCount) {
        return right.latest.caseCount - left.latest.caseCount;
      }
      return left.name.localeCompare(right.name);
    });
}

export function buildVerificationOutcomeEntriesFromSummary(summary, key) {
  return buildVerificationOutcomeEntriesFromBreakdowns(summary?.breakdowns?.[key])
    .map((entry) => ({
      ...entry,
      latestCaseCount: normalizeNumber(entry?.latest?.caseCount),
    }))
    .filter((entry) => formatVerificationOutcomeName(entry) && entry.latestCaseCount > 0);
}

export function buildVerificationOutcomeEntriesFromTrend(trendReport, key) {
  return buildVerificationOutcomeEntriesFromDeltas(
    trendReport?.classificationDeltas?.[key],
  )
    .map((entry) => ({
      ...entry,
      latestCaseCount: normalizeNumber(entry?.latest?.caseCount),
      deltaCaseCount: normalizeNumber(entry?.delta?.caseCount),
    }))
    .filter((entry) => formatVerificationOutcomeName(entry) && entry.latestCaseCount > 0);
}

export function filterVerificationOutcomeEntriesByRoles(entries, roles) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const normalizedRoles = new Set(
    (Array.isArray(roles) ? roles : [roles]).map((role) => normalizeString(role)).filter(Boolean),
  );

  return normalizedEntries.filter((entry) =>
    normalizedRoles.has(getVerificationOutcomeRole(entry?.signal, entry?.outcome)),
  );
}

export function sumVerificationOutcomeCaseCountsByRoles(entries, roles) {
  return filterVerificationOutcomeEntriesByRoles(entries, roles).reduce(
    (total, entry) => total + normalizeNumber(entry?.latestCaseCount ?? entry?.latest?.caseCount),
    0,
  );
}

function toVerificationOutcomeNames(entries) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  return normalizedEntries.map((entry) => formatVerificationOutcomeName(entry)).filter(Boolean);
}

function pickFirstNonEmptyNames(groups) {
  for (const group of groups) {
    if (Array.isArray(group) && group.length > 0) {
      return group;
    }
  }
  return [];
}

function getCleanupVerificationFocusEntries(cleanupReport, key) {
  const entries = cleanupReport?.focus?.[key];
  return Array.isArray(entries) ? entries : [];
}

function withVerificationRole(entries, role) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  return normalizedEntries.map((entry) => ({ ...entry, role }));
}

function pickFirstNonEmptyEntries(groups) {
  for (const group of groups) {
    if (Array.isArray(group) && group.length > 0) {
      return group;
    }
  }
  return [];
}

export function deriveVerificationHistoryRecordFacts({
  summary,
  trendReport,
  cleanupReport,
}) {
  const trendCurrentEntries = filterVerificationOutcomeEntriesByRoles(
    buildVerificationOutcomeEntriesFromTrend(
      trendReport,
      "currentObservabilityVerificationOutcomes",
    ),
    ["blocking_failure", "advisory_failure"],
  );
  const trendFallbackEntries = filterVerificationOutcomeEntriesByRoles(
    buildVerificationOutcomeEntriesFromTrend(
      trendReport,
      "observabilityVerificationOutcomes",
    ),
    ["blocking_failure", "advisory_failure"],
  );
  const summaryCurrentEntries = filterVerificationOutcomeEntriesByRoles(
    buildVerificationOutcomeEntriesFromSummary(
      summary,
      "currentObservabilityVerificationOutcomes",
    ),
    ["blocking_failure", "advisory_failure"],
  );
  const summaryFallbackEntries = filterVerificationOutcomeEntriesByRoles(
    buildVerificationOutcomeEntriesFromSummary(
      summary,
      "observabilityVerificationOutcomes",
    ),
    ["blocking_failure", "advisory_failure"],
  );
  const cleanupCurrentEntries = getCleanupVerificationFocusEntries(
    cleanupReport,
    "currentObservabilityVerificationOutcomes",
  );
  const cleanupFallbackEntries = getCleanupVerificationFocusEntries(
    cleanupReport,
    "observabilityVerificationOutcomes",
  );

  const verificationFailureOutcomeFocus = pickFirstNonEmptyNames([
    toVerificationOutcomeNames(trendCurrentEntries),
    toVerificationOutcomeNames(trendFallbackEntries),
    toVerificationOutcomeNames(summaryCurrentEntries),
    toVerificationOutcomeNames(summaryFallbackEntries),
    toVerificationOutcomeNames(cleanupCurrentEntries),
    toVerificationOutcomeNames(cleanupFallbackEntries),
  ]);

  const explicitTrendRecoveredEntries = buildVerificationOutcomeEntriesFromTrend(
    trendReport,
    "currentRecoveredObservabilityVerificationOutcomes",
  );
  const fallbackTrendRecoveredEntries = filterVerificationOutcomeEntriesByRoles(
    buildVerificationOutcomeEntriesFromTrend(
      trendReport,
      "currentObservabilityVerificationOutcomes",
    ),
    "recovered",
  );
  const explicitSummaryRecoveredEntries = buildVerificationOutcomeEntriesFromSummary(
    summary,
    "currentRecoveredObservabilityVerificationOutcomes",
  );
  const fallbackSummaryRecoveredEntries = filterVerificationOutcomeEntriesByRoles(
    buildVerificationOutcomeEntriesFromSummary(
      summary,
      "currentObservabilityVerificationOutcomes",
    ),
    "recovered",
  );
  const cleanupExplicitRecoveredEntries = getCleanupVerificationFocusEntries(
    cleanupReport,
    "currentRecoveredObservabilityVerificationOutcomes",
  );

  const currentRecoveredBaselineFocus = pickFirstNonEmptyNames([
    toVerificationOutcomeNames(explicitTrendRecoveredEntries),
    toVerificationOutcomeNames(fallbackTrendRecoveredEntries),
    toVerificationOutcomeNames(explicitSummaryRecoveredEntries),
    toVerificationOutcomeNames(fallbackSummaryRecoveredEntries),
    toVerificationOutcomeNames(cleanupExplicitRecoveredEntries),
    toVerificationOutcomeNames(
      filterVerificationOutcomeEntriesByRoles(
        cleanupCurrentEntries.length > 0 ? cleanupCurrentEntries : cleanupFallbackEntries,
        "recovered",
      ),
    ),
  ]);

  const overallEntries = buildVerificationOutcomeEntriesFromSummary(
    summary,
    "observabilityVerificationOutcomes",
  );
  const currentEntries = buildVerificationOutcomeEntriesFromSummary(
    summary,
    "currentObservabilityVerificationOutcomes",
  );
  const degradedEntries = buildVerificationOutcomeEntriesFromSummary(
    summary,
    "degradedObservabilityVerificationOutcomes",
  );
  const explicitCurrentRecoveredEntries = buildVerificationOutcomeEntriesFromSummary(
    summary,
    "currentRecoveredObservabilityVerificationOutcomes",
  );

  const verificationOutcomeCounts =
    overallEntries.length > 0 ||
    currentEntries.length > 0 ||
    degradedEntries.length > 0 ||
    explicitCurrentRecoveredEntries.length > 0
      ? {
          failureCaseCount: sumVerificationOutcomeCaseCountsByRoles(
            overallEntries,
            ["blocking_failure", "advisory_failure"],
          ),
          blockingFailureCaseCount: sumVerificationOutcomeCaseCountsByRoles(
            currentEntries,
            "blocking_failure",
          ),
          advisoryFailureCaseCount: sumVerificationOutcomeCaseCountsByRoles(
            currentEntries,
            "advisory_failure",
          ),
          recoveredCaseCount: sumVerificationOutcomeCaseCountsByRoles(
            overallEntries,
            "recovered",
          ),
          currentRecoveredCaseCount:
            normalizeNumber(
              trendReport?.latest?.totals?.currentRecoveredVerificationCaseCount,
            ) ||
            normalizeNumber(summary?.totals?.currentRecoveredVerificationCaseCount) ||
            (explicitCurrentRecoveredEntries.length > 0
              ? explicitCurrentRecoveredEntries.reduce(
                  (total, entry) => total + normalizeNumber(entry.latestCaseCount),
                  0,
                )
              : sumVerificationOutcomeCaseCountsByRoles(currentEntries, "recovered")),
          degradedBlockingFailureCaseCount: sumVerificationOutcomeCaseCountsByRoles(
            degradedEntries,
            "blocking_failure",
          ),
        }
      : (() => {
          const cleanupSummary =
            cleanupReport &&
            typeof cleanupReport === "object" &&
            cleanupReport.summary &&
            cleanupReport.summary.verificationOutcomes &&
            typeof cleanupReport.summary.verificationOutcomes === "object"
              ? cleanupReport.summary.verificationOutcomes
              : {};
          const currentSummary =
            cleanupSummary &&
            typeof cleanupSummary.current === "object" &&
            !Array.isArray(cleanupSummary.current)
              ? cleanupSummary.current
              : {};
          const degradedSummary =
            cleanupSummary &&
            typeof cleanupSummary.degraded === "object" &&
            !Array.isArray(cleanupSummary.degraded)
              ? cleanupSummary.degraded
              : {};

          return {
            failureCaseCount: normalizeNumber(cleanupSummary.failureCaseCount),
            blockingFailureCaseCount: normalizeNumber(
              currentSummary.blockingFailureCaseCount,
            ),
            advisoryFailureCaseCount: normalizeNumber(
              currentSummary.advisoryFailureCaseCount,
            ),
            recoveredCaseCount: normalizeNumber(cleanupSummary.recoveredCaseCount),
            currentRecoveredCaseCount: normalizeNumber(
              currentSummary.recoveredCaseCount,
            ),
            degradedBlockingFailureCaseCount: normalizeNumber(
              degradedSummary.blockingFailureCaseCount,
            ),
          };
        })();

  return {
    verificationFailureOutcomeFocus,
    currentRecoveredBaselineFocus,
    verificationOutcomeCounts,
  };
}

export function deriveVerificationDashboardPresentation({
  summaryReport,
  trendReport,
  cleanupReport,
}) {
  const trendOverallRows = buildVerificationOutcomeEntriesFromTrend(
    trendReport,
    "observabilityVerificationOutcomes",
  );
  const trendCurrentRows = buildVerificationOutcomeEntriesFromTrend(
    trendReport,
    "currentObservabilityVerificationOutcomes",
  );
  const trendCurrentRecoveredRowsExplicit = buildVerificationOutcomeEntriesFromTrend(
    trendReport,
    "currentRecoveredObservabilityVerificationOutcomes",
  );
  const trendDegradedRows = buildVerificationOutcomeEntriesFromTrend(
    trendReport,
    "degradedObservabilityVerificationOutcomes",
  );

  const summaryOverallRows = buildVerificationOutcomeEntriesFromSummary(
    summaryReport,
    "observabilityVerificationOutcomes",
  );
  const summaryCurrentRows = buildVerificationOutcomeEntriesFromSummary(
    summaryReport,
    "currentObservabilityVerificationOutcomes",
  );
  const summaryCurrentRecoveredRowsExplicit =
    buildVerificationOutcomeEntriesFromSummary(
      summaryReport,
      "currentRecoveredObservabilityVerificationOutcomes",
    );
  const summaryDegradedRows = buildVerificationOutcomeEntriesFromSummary(
    summaryReport,
    "degradedObservabilityVerificationOutcomes",
  );

  const cleanupCurrentRows = getCleanupVerificationFocusEntries(
    cleanupReport,
    "currentObservabilityVerificationOutcomes",
  );
  const cleanupDegradedRows = getCleanupVerificationFocusEntries(
    cleanupReport,
    "degradedObservabilityVerificationOutcomes",
  );
  const cleanupFallbackRows = getCleanupVerificationFocusEntries(
    cleanupReport,
    "observabilityVerificationOutcomes",
  );
  const cleanupCurrentRecoveredRows = getCleanupVerificationFocusEntries(
    cleanupReport,
    "currentRecoveredObservabilityVerificationOutcomes",
  );

  const currentFailureRows = pickFirstNonEmptyEntries([
    withVerificationRole(
      filterVerificationOutcomeEntriesByRoles(
        trendCurrentRows,
        ["blocking_failure", "advisory_failure"],
      ),
      "current",
    ),
    withVerificationRole(
      filterVerificationOutcomeEntriesByRoles(
        summaryCurrentRows,
        ["blocking_failure", "advisory_failure"],
      ),
      "current",
    ),
    withVerificationRole(
      filterVerificationOutcomeEntriesByRoles(
        cleanupCurrentRows,
        ["blocking_failure", "advisory_failure"],
      ),
      "current",
    ),
  ]);
  const degradedFailureRows = pickFirstNonEmptyEntries([
    withVerificationRole(
      filterVerificationOutcomeEntriesByRoles(
        trendDegradedRows,
        ["blocking_failure", "advisory_failure"],
      ),
      "degraded",
    ),
    withVerificationRole(
      filterVerificationOutcomeEntriesByRoles(
        summaryDegradedRows,
        ["blocking_failure", "advisory_failure"],
      ),
      "degraded",
    ),
    withVerificationRole(
      filterVerificationOutcomeEntriesByRoles(
        cleanupDegradedRows,
        ["blocking_failure", "advisory_failure"],
      ),
      "degraded",
    ),
  ]);
  const fallbackFailureRows = pickFirstNonEmptyEntries([
    withVerificationRole(
      filterVerificationOutcomeEntriesByRoles(
        trendOverallRows,
        ["blocking_failure", "advisory_failure"],
      ),
      "mixed",
    ),
    withVerificationRole(
      filterVerificationOutcomeEntriesByRoles(
        summaryOverallRows,
        ["blocking_failure", "advisory_failure"],
      ),
      "mixed",
    ),
    withVerificationRole(
      filterVerificationOutcomeEntriesByRoles(
        cleanupFallbackRows,
        ["blocking_failure", "advisory_failure"],
      ),
      "mixed",
    ),
  ]);
  const currentRecoveredRows = pickFirstNonEmptyEntries([
    withVerificationRole(trendCurrentRecoveredRowsExplicit, "current"),
    withVerificationRole(summaryCurrentRecoveredRowsExplicit, "current"),
    withVerificationRole(
      filterVerificationOutcomeEntriesByRoles(trendCurrentRows, "recovered"),
      "current",
    ),
    withVerificationRole(
      filterVerificationOutcomeEntriesByRoles(summaryCurrentRows, "recovered"),
      "current",
    ),
    withVerificationRole(cleanupCurrentRecoveredRows, "current"),
    withVerificationRole(
      filterVerificationOutcomeEntriesByRoles(cleanupCurrentRows, "recovered"),
      "current",
    ),
    withVerificationRole(
      filterVerificationOutcomeEntriesByRoles(cleanupFallbackRows, "recovered"),
      "mixed",
    ),
  ]);

  const verificationFocusRows =
    currentFailureRows.length > 0 || degradedFailureRows.length > 0
      ? [...currentFailureRows, ...degradedFailureRows]
      : fallbackFailureRows;

  const overallSummaryEntries = pickFirstNonEmptyEntries([
    trendOverallRows,
    summaryOverallRows,
    [...currentFailureRows, ...degradedFailureRows, ...currentRecoveredRows],
  ]);
  const currentSummaryEntries = pickFirstNonEmptyEntries([
    trendCurrentRecoveredRowsExplicit.length > 0
      ? [
          ...filterVerificationOutcomeEntriesByRoles(
            trendCurrentRows,
            ["blocking_failure", "advisory_failure"],
          ),
          ...trendCurrentRecoveredRowsExplicit,
        ]
      : trendCurrentRows,
    summaryCurrentRecoveredRowsExplicit.length > 0
      ? [
          ...filterVerificationOutcomeEntriesByRoles(
            summaryCurrentRows,
            ["blocking_failure", "advisory_failure"],
          ),
          ...summaryCurrentRecoveredRowsExplicit,
        ]
      : summaryCurrentRows,
    cleanupCurrentRecoveredRows.length > 0
      ? [
          ...filterVerificationOutcomeEntriesByRoles(
            cleanupCurrentRows,
            ["blocking_failure", "advisory_failure"],
          ),
          ...cleanupCurrentRecoveredRows,
        ]
      : cleanupCurrentRows,
    [...currentFailureRows, ...currentRecoveredRows],
  ]);
  const degradedSummaryEntries = pickFirstNonEmptyEntries([
    trendDegradedRows,
    summaryDegradedRows,
    cleanupDegradedRows,
    degradedFailureRows,
  ]);

  const derivedVerificationSummary =
    overallSummaryEntries.length > 0 ||
    currentSummaryEntries.length > 0 ||
    degradedSummaryEntries.length > 0
      ? {
          ...buildVerificationOutcomeSummary(overallSummaryEntries),
          current: buildVerificationOutcomeSummary(currentSummaryEntries),
          degraded: buildVerificationOutcomeSummary(degradedSummaryEntries),
        }
      : null;

  const fallbackVerificationSummary =
    cleanupReport &&
    typeof cleanupReport === "object" &&
    cleanupReport.summary &&
    cleanupReport.summary.verificationOutcomes
      ? cleanupReport.summary.verificationOutcomes
      : {};

  return {
    verificationSummary: derivedVerificationSummary ?? fallbackVerificationSummary,
    verificationFocusRows,
    currentRecoveredRows,
    currentRecoveredSummaryLabel: currentRecoveredRows
      .slice(0, 3)
      .map((entry) => formatVerificationOutcomeCompactLabel(entry))
      .filter(Boolean)
      .join("、"),
  };
}

export function buildVerificationOutcomeSignalMessages({
  focusVerificationFailureOutcomes,
  verificationOutcomeSummary,
  currentVerificationOutcomeSummary,
  degradedVerificationOutcomeSummary,
  currentRecoveredVerificationOutcomes,
  labelLimit = 3,
}) {
  const failureLabels = formatVerificationOutcomeCompactLabels(
    focusVerificationFailureOutcomes,
    labelLimit,
  );
  const recoveredLabels = formatVerificationOutcomeCompactLabels(
    currentRecoveredVerificationOutcomes,
    labelLimit,
  );

  return [
    failureLabels.length > 0
      ? `当前 verification failure outcome 焦点：${failureLabels.join("、")}。`
      : "当前没有额外的 verification failure outcome 焦点。",
    normalizeNumber(verificationOutcomeSummary?.failureCaseCount) > 0
      ? `当前 verification failure 聚焦 ${normalizeNumber(verificationOutcomeSummary?.failureFocusCount)} 类 outcome，共 ${normalizeNumber(verificationOutcomeSummary?.failureCaseCount)} 个 case。`
      : "当前没有额外的 verification failure case。",
    normalizeNumber(currentVerificationOutcomeSummary?.blockingFailureCaseCount) > 0
      ? `当前 current 样本里有 ${normalizeNumber(currentVerificationOutcomeSummary?.blockingFailureCaseCount)} 个 blocking verification failure。`
      : "当前没有额外的 blocking verification failure。",
    normalizeNumber(currentVerificationOutcomeSummary?.advisoryFailureCaseCount) > 0
      ? `当前 current 样本里有 ${normalizeNumber(currentVerificationOutcomeSummary?.advisoryFailureCaseCount)} 个 advisory verification failure。`
      : "当前没有额外的 advisory verification failure。",
    normalizeNumber(currentVerificationOutcomeSummary?.recoveredCaseCount) > 0
      ? `当前 current recovered verification baseline：${recoveredLabels.join("、") || "暂无"}。`
      : "当前没有额外的 current recovered verification baseline。",
    normalizeNumber(degradedVerificationOutcomeSummary?.blockingFailureCaseCount) > 0
      ? `当前保留 ${normalizeNumber(degradedVerificationOutcomeSummary?.blockingFailureCaseCount)} 个 degraded blocking verification failure 样本作为诊断基线。`
      : "当前没有额外的 degraded blocking verification baseline。",
    normalizeNumber(verificationOutcomeSummary?.recoveredCaseCount) > 0
      ? `当前 verification recovered 聚焦 ${normalizeNumber(verificationOutcomeSummary?.recoveredFocusCount)} 类 outcome，共 ${normalizeNumber(verificationOutcomeSummary?.recoveredCaseCount)} 个 case。`
      : "当前没有额外的 verification recovered case。",
  ];
}

export function buildBlockingVerificationRecommendationRationale({
  topCurrentVerificationFailureOutcomes,
  currentVerificationSummary,
  degradedVerificationSummary,
}) {
  const currentFailureLabels = formatVerificationOutcomeCompactLabels(
    topCurrentVerificationFailureOutcomes,
    3,
  );

  return [
    currentFailureLabels.length > 0
      ? `当前 current verification failure outcome 焦点：${currentFailureLabels.join("、")}。`
      : "当前没有额外的 verification failure outcome 焦点。",
    normalizeNumber(currentVerificationSummary?.blockingFailureCaseCount) > 0
      ? `其中 current blocking verification failure 共 ${normalizeNumber(currentVerificationSummary?.blockingFailureCaseCount)} 个 case：${(Array.isArray(currentVerificationSummary?.topBlockingFailureOutcomes) ? currentVerificationSummary.topBlockingFailureOutcomes : []).join("、") || "暂无"}。`
      : "当前没有额外的 blocking verification failure。",
    normalizeNumber(degradedVerificationSummary?.blockingFailureCaseCount) > 0
      ? `另有 ${normalizeNumber(degradedVerificationSummary?.blockingFailureCaseCount)} 个 degraded blocking verification failure 样本作为诊断基线，不直接抬高主线优先级。`
      : "当前没有额外的 degraded blocking verification baseline。",
  ];
}

export function buildAdvisoryVerificationRecommendationRationale({
  topCurrentVerificationFailureOutcomes,
  topDegradedVerificationFailureOutcomes,
  currentVerificationSummary,
}) {
  const currentFailureLabels = formatVerificationOutcomeCompactLabels(
    topCurrentVerificationFailureOutcomes,
    3,
  );
  const degradedFailureLabels = formatVerificationOutcomeCompactLabels(
    topDegradedVerificationFailureOutcomes,
    3,
  );

  return [
    currentFailureLabels.length > 0
      ? `当前 current verification failure outcome 焦点：${currentFailureLabels.join("、")}。可用它们直接定位先补 artifact/browser/gui 哪一层。`
      : "当前没有额外的 verification failure outcome 焦点。",
    normalizeNumber(currentVerificationSummary?.advisoryFailureCaseCount) > 0
      ? `当前 current advisory verification failure 共 ${normalizeNumber(currentVerificationSummary?.advisoryFailureCaseCount)} 个 case：${(Array.isArray(currentVerificationSummary?.topAdvisoryFailureOutcomes) ? currentVerificationSummary.topAdvisoryFailureOutcomes : []).join("、") || "暂无"}。`
      : "当前没有额外的 advisory verification failure。",
    degradedFailureLabels.length > 0
      ? `当前保留的 degraded verification baseline：${degradedFailureLabels.join("、")}。`
      : "当前没有额外的 degraded verification baseline。",
  ];
}

export function buildRecoveredVerificationRecommendationRationale({
  topCurrentRecoveredVerificationOutcomes,
  currentVerificationSummary,
}) {
  const recoveredLabels = formatVerificationOutcomeCompactLabels(
    topCurrentRecoveredVerificationOutcomes,
    3,
  );

  return [
    recoveredLabels.length > 0
      ? `当前 current recovered outcome 焦点：${recoveredLabels.join("、")}。`
      : `当前 current recovered outcome 共 ${normalizeNumber(currentVerificationSummary?.recoveredCaseCount)} 个 case。`,
  ];
}

export function buildObservabilityRecommendationRationale({
  trendSummary,
  topObservabilitySignals,
  topCurrentVerificationFailureOutcomes,
  topDegradedVerificationFailureOutcomes,
  currentVerificationSummary,
}) {
  const observabilitySignalLabels = Array.isArray(topObservabilitySignals)
    ? topObservabilitySignals.map((entry) => normalizeString(entry)).filter(Boolean)
    : [];

  return [
    normalizeNumber(trendSummary?.latestCurrentObservabilityGapCaseCount) > 0
      ? `当前仍有 ${normalizeNumber(trendSummary?.latestCurrentObservabilityGapCaseCount)} 个 current case 带着 observability 证据缺口进入 replay/eval。`
      : "当前 trend 已检测到 observability coverage 漂移，需先修证据而不是空谈根因分析。",
    normalizeNumber(trendSummary?.latestDegradedObservabilityGapCaseCount) > 0
      ? `另有 ${normalizeNumber(trendSummary?.latestDegradedObservabilityGapCaseCount)} 个 degraded gap 样本作为诊断基线保留，它们不应直接被当成主线回归。`
      : "当前没有额外保留的 degraded observability gap 样本。",
    `当前缺口焦点：${observabilitySignalLabels.join("、") || "暂无"}。这些缺口会直接降低 analysis handoff、人工审核和 cleanup report 的判断质量。`,
    ...buildAdvisoryVerificationRecommendationRationale({
      topCurrentVerificationFailureOutcomes,
      topDegradedVerificationFailureOutcomes,
      currentVerificationSummary,
    }),
  ];
}

export function buildObservabilityRecommendationBacklog({
  topCurrentVerificationFailureOutcomes,
  advisoryFollowUpBacklogTools,
}) {
  const currentFailureLabels = formatVerificationOutcomeCompactLabels(
    topCurrentVerificationFailureOutcomes,
    3,
  );
  const followUpBacklogTools = Array.isArray(advisoryFollowUpBacklogTools)
    ? advisoryFollowUpBacklogTools.map((entry) => normalizeString(entry)).filter(Boolean)
    : [];

  return dedupeNonEmptyStrings([
    "优先补 request telemetry 关联键、artifact validator outcome、browser/gui smoke 结果到 evidence pack / analysis handoff / replay。",
    currentFailureLabels.length > 0
      ? `先对齐 current verification failure outcome：${currentFailureLabels.join("、")}。`
      : "",
    ...followUpBacklogTools,
  ]);
}

export function buildVerificationFocusEntriesFromDeltas(entries, sampleCount) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];

  return normalizedEntries
    .map((entry) => {
      const latest = entry != null && typeof entry === "object" ? entry.latest ?? {} : {};
      const delta = entry != null && typeof entry === "object" ? entry.delta ?? {} : {};
      const baseline =
        entry != null && typeof entry === "object" ? entry.baseline ?? {} : {};
      const parsed = splitVerificationOutcomeName(entry?.name);
      const positiveDeltaCase = Math.max(0, normalizeNumber(delta.caseCount));
      const latestCase = normalizeNumber(latest.caseCount);
      const weight = getVerificationOutcomeWeight(parsed.outcome);
      const score = positiveDeltaCase * 140 + latestCase * weight;

      let state = "stable";
      if (sampleCount < 2 && latestCase > 0 && weight > 0) {
        state = "seed-risk";
      } else if (positiveDeltaCase > 0 && weight > 0) {
        state = "regressing";
      } else if (latestCase > 0 && weight > 0) {
        state = "present";
      }

      return {
        name: normalizeString(entry?.name) || "(unknown)",
        signal: parsed.signal || "(unknown)",
        outcome: parsed.outcome || "unknown",
        baseline: {
          caseCount: normalizeNumber(baseline.caseCount),
          readyCount: normalizeNumber(baseline.readyCount),
          invalidCount: normalizeNumber(baseline.invalidCount),
          pendingRequestCaseCount: normalizeNumber(
            baseline.pendingRequestCaseCount,
          ),
          needsHumanReviewCount: normalizeNumber(
            baseline.needsHumanReviewCount,
          ),
        },
        latest: {
          caseCount: latestCase,
          readyCount: normalizeNumber(latest.readyCount),
          invalidCount: normalizeNumber(latest.invalidCount),
          pendingRequestCaseCount: normalizeNumber(
            latest.pendingRequestCaseCount,
          ),
          needsHumanReviewCount: normalizeNumber(latest.needsHumanReviewCount),
        },
        delta: {
          caseCount: normalizeNumber(delta.caseCount),
          readyCount: normalizeNumber(delta.readyCount),
          invalidCount: normalizeNumber(delta.invalidCount),
          pendingRequestCaseCount: normalizeNumber(delta.pendingRequestCaseCount),
          needsHumanReviewCount: normalizeNumber(delta.needsHumanReviewCount),
        },
        state,
        score,
      };
    })
    .filter(
      (entry) =>
        entry.score > 0 ||
        (entry.latest.caseCount > 0 &&
          isVerificationFailureOutcome(entry.outcome)),
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.name.localeCompare(right.name);
    });
}

export function buildVerificationOutcomeSummary(entries) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const blockingFailureEntries = normalizedEntries.filter(
    (entry) =>
      getVerificationOutcomeRole(entry?.signal, entry?.outcome) ===
      "blocking_failure",
  );
  const advisoryFailureEntries = normalizedEntries.filter(
    (entry) =>
      getVerificationOutcomeRole(entry?.signal, entry?.outcome) ===
      "advisory_failure",
  );
  const failureEntries = [...blockingFailureEntries, ...advisoryFailureEntries];
  const recoveredEntries = normalizedEntries.filter(
    (entry) =>
      getVerificationOutcomeRole(entry?.signal, entry?.outcome) === "recovered",
  );

  return {
    focusCount: normalizedEntries.length,
    failureFocusCount: failureEntries.length,
    recoveredFocusCount: recoveredEntries.length,
    blockingFailureFocusCount: blockingFailureEntries.length,
    advisoryFailureFocusCount: advisoryFailureEntries.length,
    failureCaseCount: failureEntries.reduce(
      (total, entry) => total + normalizeNumber(entry?.latest?.caseCount),
      0,
    ),
    blockingFailureCaseCount: blockingFailureEntries.reduce(
      (total, entry) => total + normalizeNumber(entry?.latest?.caseCount),
      0,
    ),
    advisoryFailureCaseCount: advisoryFailureEntries.reduce(
      (total, entry) => total + normalizeNumber(entry?.latest?.caseCount),
      0,
    ),
    recoveredCaseCount: recoveredEntries.reduce(
      (total, entry) => total + normalizeNumber(entry?.latest?.caseCount),
      0,
    ),
    topFailureOutcomes: failureEntries
      .slice(0, 3)
      .map((entry) => `${entry.signal}:${entry.outcome}`),
    topBlockingFailureOutcomes: blockingFailureEntries
      .slice(0, 3)
      .map((entry) => `${entry.signal}:${entry.outcome}`),
    topAdvisoryFailureOutcomes: advisoryFailureEntries
      .slice(0, 3)
      .map((entry) => `${entry.signal}:${entry.outcome}`),
    topRecoveredOutcomes: recoveredEntries
      .slice(0, 3)
      .map((entry) => `${entry.signal}:${entry.outcome}`),
  };
}

export function deriveVerificationOutcomePresentationFromTrend({
  trendReport,
  sampleCount = 0,
}) {
  const rawVerificationFocusEntries = buildVerificationFocusEntriesFromDeltas(
    trendReport?.classificationDeltas?.observabilityVerificationOutcomes,
    sampleCount,
  );
  const explicitRecoveredVerificationEntries =
    buildVerificationOutcomeEntriesFromDeltas(
      trendReport?.classificationDeltas?.observabilityVerificationOutcomes,
    ).filter(
      (entry) =>
        getVerificationOutcomeRole(entry?.signal, entry?.outcome) ===
        "recovered",
    );
  const focusVerificationFailureOutcomes =
    rawVerificationFocusEntries.filter(
      (entry) =>
        getVerificationOutcomeRole(entry?.signal, entry?.outcome) !==
        "recovered",
    );

  const rawCurrentVerificationFocusEntries =
    buildVerificationFocusEntriesFromDeltas(
      trendReport?.classificationDeltas?.currentObservabilityVerificationOutcomes,
      sampleCount,
    );
  const explicitCurrentRecoveredVerificationEntries =
    buildVerificationOutcomeEntriesFromDeltas(
      trendReport?.classificationDeltas
        ?.currentRecoveredObservabilityVerificationOutcomes,
    );
  const focusCurrentVerificationFailureOutcomes =
    rawCurrentVerificationFocusEntries.filter(
      (entry) =>
        getVerificationOutcomeRole(entry?.signal, entry?.outcome) !==
        "recovered",
    );
  const focusCurrentRecoveredVerificationOutcomes =
    explicitCurrentRecoveredVerificationEntries.length > 0
      ? explicitCurrentRecoveredVerificationEntries
      : rawCurrentVerificationFocusEntries.filter(
          (entry) =>
            getVerificationOutcomeRole(entry?.signal, entry?.outcome) ===
            "recovered",
        );

  const rawDegradedVerificationFocusEntries =
    buildVerificationFocusEntriesFromDeltas(
      trendReport?.classificationDeltas?.degradedObservabilityVerificationOutcomes,
      sampleCount,
    );
  const focusDegradedVerificationFailureOutcomes =
    rawDegradedVerificationFocusEntries.filter(
      (entry) =>
        getVerificationOutcomeRole(entry?.signal, entry?.outcome) !==
        "recovered",
    );

  const mergedVerificationFailureOutcomes =
    focusVerificationFailureOutcomes.length > 0
      ? focusVerificationFailureOutcomes
      : [
          ...focusCurrentVerificationFailureOutcomes,
          ...focusDegradedVerificationFailureOutcomes,
        ].sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }
          return left.name.localeCompare(right.name);
        });

  const verificationFailureSummary = buildVerificationOutcomeSummary(
    mergedVerificationFailureOutcomes,
  );
  const recoveredVerificationSummary = buildVerificationOutcomeSummary(
    explicitRecoveredVerificationEntries.length > 0
      ? explicitRecoveredVerificationEntries
      : mergedVerificationFailureOutcomes.filter(
          (entry) =>
            getVerificationOutcomeRole(entry?.signal, entry?.outcome) ===
            "recovered",
        ),
  );
  const verificationOutcomeSummary = {
    ...verificationFailureSummary,
    recoveredFocusCount: recoveredVerificationSummary.recoveredFocusCount,
    recoveredCaseCount: recoveredVerificationSummary.recoveredCaseCount,
    topRecoveredOutcomes: recoveredVerificationSummary.topRecoveredOutcomes,
  };

  const currentVerificationFailureSummary = buildVerificationOutcomeSummary(
    focusCurrentVerificationFailureOutcomes,
  );
  const currentRecoveredVerificationSummary = buildVerificationOutcomeSummary(
    focusCurrentRecoveredVerificationOutcomes,
  );
  const currentVerificationOutcomeSummary = {
    ...currentVerificationFailureSummary,
    recoveredFocusCount: currentRecoveredVerificationSummary.recoveredFocusCount,
    recoveredCaseCount: currentRecoveredVerificationSummary.recoveredCaseCount,
    topRecoveredOutcomes: currentRecoveredVerificationSummary.topRecoveredOutcomes,
  };

  const degradedVerificationOutcomeSummary = buildVerificationOutcomeSummary(
    focusDegradedVerificationFailureOutcomes,
  );

  return {
    rawVerificationFocusEntries,
    explicitRecoveredVerificationEntries,
    focusVerificationFailureOutcomes,
    rawCurrentVerificationFocusEntries,
    explicitCurrentRecoveredVerificationEntries,
    focusCurrentVerificationFailureOutcomes,
    focusCurrentRecoveredVerificationOutcomes,
    rawDegradedVerificationFocusEntries,
    focusDegradedVerificationFailureOutcomes,
    mergedVerificationFailureOutcomes,
    verificationOutcomeSummary: {
      ...verificationOutcomeSummary,
      current: currentVerificationOutcomeSummary,
      degraded: degradedVerificationOutcomeSummary,
    },
  };
}
