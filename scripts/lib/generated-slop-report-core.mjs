import {
  getCommandStatus,
  getImportStatus,
  getTextCountStatus,
  getTextStatus,
} from "./legacy-surface-report-summary.mjs";

const PRIORITY_RANK = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

const CLASSIFICATION_WEIGHT = {
  current: 0,
  compat: 25,
  deprecated: 35,
  "dead-candidate": 45,
};

const STATUS_WEIGHT = {
  "违规": 200,
  "受控": 40,
  "零引用": 0,
  "已删除": 0,
};

function normalizeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function isObject(value) {
  return value != null && typeof value === "object";
}

function flattenCommandReferenceGroups(referenceGroups) {
  if (referenceGroups instanceof Map) {
    return [...referenceGroups.values()].flat();
  }

  if (isObject(referenceGroups)) {
    return Object.values(referenceGroups).flatMap((entry) =>
      Array.isArray(entry) ? entry : [],
    );
  }

  return [];
}

function toReferenceGroupMap(referenceGroups) {
  if (referenceGroups instanceof Map) {
    return referenceGroups;
  }

  if (isObject(referenceGroups)) {
    return new Map(
      Object.entries(referenceGroups).map(([key, value]) => [
        key,
        Array.isArray(value) ? value : [],
      ]),
    );
  }

  return new Map();
}

function getTextCountOccurrenceCount(result) {
  const runtimeMatches = Array.isArray(result?.runtimeMatches)
    ? result.runtimeMatches
    : [];

  return runtimeMatches.reduce(
    (total, entry) =>
      total +
      (Array.isArray(entry?.counts)
        ? entry.counts.reduce(
            (innerTotal, item) => innerTotal + normalizeNumber(item?.count),
            0,
          )
        : 0),
    0,
  );
}

function getClassificationWeight(classification) {
  return CLASSIFICATION_WEIGHT[classification] ?? 10;
}

function getStatusWeight(status) {
  return STATUS_WEIGHT[status] ?? 0;
}

function buildGovernanceSurfaceEntry({
  sourceType,
  result,
  status,
  referenceCount,
  testReferenceCount,
  occurrenceCount,
}) {
  const classification = normalizeString(result?.classification, "unknown");
  const violationCount = Array.isArray(result?.violations)
    ? result.violations.length
    : 0;
  const active = status !== "零引用" && status !== "已删除";
  const score = active
    ? getStatusWeight(status) +
      getClassificationWeight(classification) +
      violationCount * 200 +
      referenceCount * 5 +
      occurrenceCount
    : 0;

  return {
    id: normalizeString(result?.id, `${sourceType}-surface`),
    sourceType,
    classification,
    description: normalizeString(result?.description, "(无描述)"),
    status,
    active,
    referenceCount,
    testReferenceCount,
    occurrenceCount,
    violationCount,
    score,
  };
}

function buildGovernanceSurfaceEntries(governanceReport) {
  const importResults = Array.isArray(governanceReport?.importResults)
    ? governanceReport.importResults
    : [];
  const commandResults = Array.isArray(governanceReport?.commandResults)
    ? governanceReport.commandResults
    : [];
  const frontendTextResults = Array.isArray(governanceReport?.frontendTextResults)
    ? governanceReport.frontendTextResults
    : [];
  const rustTextResults = Array.isArray(governanceReport?.rustTextResults)
    ? governanceReport.rustTextResults
    : [];
  const rustTextCountResults = Array.isArray(
    governanceReport?.rustTextCountResults,
  )
    ? governanceReport.rustTextCountResults
    : [];

  const importEntries = importResults.map((result) =>
    buildGovernanceSurfaceEntry({
      sourceType: "import",
      result,
      status: getImportStatus(result),
      referenceCount: Array.isArray(result?.references) ? result.references.length : 0,
      testReferenceCount: Array.isArray(result?.testReferences)
        ? result.testReferences.length
        : 0,
      occurrenceCount: 0,
    }),
  );

  const commandEntries = commandResults.map((result) =>
    buildGovernanceSurfaceEntry({
      sourceType: "command",
      result,
      status: getCommandStatus({
        ...result,
        referencesByCommand: toReferenceGroupMap(result?.referencesByCommand),
      }),
      referenceCount: [
        ...new Set(flattenCommandReferenceGroups(result?.referencesByCommand)),
      ].length,
      testReferenceCount: [
        ...new Set(flattenCommandReferenceGroups(result?.testReferencesByCommand)),
      ].length,
      occurrenceCount: 0,
    }),
  );

  const frontendTextEntries = frontendTextResults.map((result) =>
    buildGovernanceSurfaceEntry({
      sourceType: "frontend-text",
      result,
      status: getTextStatus(result),
      referenceCount: Array.isArray(result?.references) ? result.references.length : 0,
      testReferenceCount: Array.isArray(result?.testReferences)
        ? result.testReferences.length
        : 0,
      occurrenceCount: 0,
    }),
  );

  const rustTextEntries = rustTextResults.map((result) =>
    buildGovernanceSurfaceEntry({
      sourceType: "rust-text",
      result,
      status: getTextStatus(result),
      referenceCount: Array.isArray(result?.references) ? result.references.length : 0,
      testReferenceCount: Array.isArray(result?.testReferences)
        ? result.testReferences.length
        : 0,
      occurrenceCount: 0,
    }),
  );

  const rustTextCountEntries = rustTextCountResults.map((result) =>
    buildGovernanceSurfaceEntry({
      sourceType: "rust-text-count",
      result,
      status: getTextCountStatus(result),
      referenceCount: Array.isArray(result?.runtimeMatches)
        ? result.runtimeMatches.length
        : 0,
      testReferenceCount: Array.isArray(result?.testMatches)
        ? result.testMatches.length
        : 0,
      occurrenceCount: getTextCountOccurrenceCount(result),
    }),
  );

  return [
    ...importEntries,
    ...commandEntries,
    ...frontendTextEntries,
    ...rustTextEntries,
    ...rustTextCountEntries,
  ].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (right.referenceCount !== left.referenceCount) {
      return right.referenceCount - left.referenceCount;
    }

    return left.id.localeCompare(right.id);
  });
}

function buildTrendFocusEntries(entries, sampleCount) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];

  return normalizedEntries
    .map((entry) => {
      const latest = isObject(entry?.latest) ? entry.latest : {};
      const delta = isObject(entry?.delta) ? entry.delta : {};
      const baseline = isObject(entry?.baseline) ? entry.baseline : {};
      const positiveDeltaInvalid = Math.max(0, normalizeNumber(delta.invalidCount));
      const positiveDeltaPending = Math.max(
        0,
        normalizeNumber(delta.pendingRequestCaseCount),
      );
      const positiveDeltaReview = Math.max(
        0,
        normalizeNumber(delta.needsHumanReviewCount),
      );
      const latestInvalid = normalizeNumber(latest.invalidCount);
      const latestPending = normalizeNumber(latest.pendingRequestCaseCount);
      const latestReview = normalizeNumber(latest.needsHumanReviewCount);
      const latestCase = normalizeNumber(latest.caseCount);
      const latestReady = normalizeNumber(latest.readyCount);
      const score =
        positiveDeltaInvalid * 120 +
        positiveDeltaPending * 80 +
        positiveDeltaReview * 50 +
        latestInvalid * 40 +
        latestPending * 25 +
        latestReview * 15 +
        latestCase;

      let state = "stable";
      if (sampleCount < 2 && score > 0) {
        state = "seed-risk";
      } else if (
        positiveDeltaInvalid > 0 ||
        positiveDeltaPending > 0 ||
        positiveDeltaReview > 0
      ) {
        state = "regressing";
      } else if (latestInvalid > 0 || latestPending > 0 || latestReview > 0) {
        state = "present";
      }

      return {
        name: normalizeString(entry?.name, "(unknown)"),
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
          readyCount: latestReady,
          invalidCount: latestInvalid,
          pendingRequestCaseCount: latestPending,
          needsHumanReviewCount: latestReview,
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
    .filter((entry) => entry.score > 0 || entry.latest.caseCount > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.name.localeCompare(right.name);
    });
}

function buildGovernanceSummary(governanceReport, surfaces) {
  const summary = isObject(governanceReport?.summary) ? governanceReport.summary : {};
  const activeByClassification = {
    current: 0,
    compat: 0,
    deprecated: 0,
    "dead-candidate": 0,
    other: 0,
  };

  for (const surface of surfaces) {
    if (!surface.active) {
      continue;
    }

    if (surface.classification in activeByClassification) {
      activeByClassification[surface.classification] += 1;
    } else {
      activeByClassification.other += 1;
    }
  }

  return {
    monitorCount: surfaces.length,
    activeSurfaceCount: surfaces.filter((surface) => surface.active).length,
    activeByClassification,
    violationCount: Array.isArray(summary.violations) ? summary.violations.length : 0,
    classificationDriftCount: Array.isArray(summary.classificationDriftCandidates)
      ? summary.classificationDriftCandidates.length
      : 0,
    zeroReferenceCandidateCount: Array.isArray(summary.zeroReferenceCandidates)
      ? summary.zeroReferenceCandidates.length
      : 0,
  };
}

function buildTrendSummary(trendReport) {
  const delta = isObject(trendReport?.delta) ? trendReport.delta : {};
  const latestTotals = isObject(trendReport?.latest?.totals)
    ? trendReport.latest.totals
    : {};
  const baselineTotals = isObject(trendReport?.baseline?.totals)
    ? trendReport.baseline.totals
    : {};
  const latestObservabilityGapCaseCount = normalizeNumber(
    latestTotals.observabilityGapCaseCount,
  );
  const baselineObservabilityGapCaseCount = normalizeNumber(
    baselineTotals.observabilityGapCaseCount,
  );
  const latestDegradedObservabilityGapCaseCount = normalizeNumber(
    latestTotals.degradedObservabilityGapCaseCount,
  );
  const baselineDegradedObservabilityGapCaseCount = normalizeNumber(
    baselineTotals.degradedObservabilityGapCaseCount,
  );
  const latestCurrentObservabilityGapCaseCount =
    latestTotals.currentObservabilityGapCaseCount != null
      ? normalizeNumber(latestTotals.currentObservabilityGapCaseCount)
      : Math.max(
          0,
          latestObservabilityGapCaseCount - latestDegradedObservabilityGapCaseCount,
        );
  const baselineCurrentObservabilityGapCaseCount =
    baselineTotals.currentObservabilityGapCaseCount != null
      ? normalizeNumber(baselineTotals.currentObservabilityGapCaseCount)
      : Math.max(
          0,
          baselineObservabilityGapCaseCount -
            baselineDegradedObservabilityGapCaseCount,
        );
  const latestNeedsReviewCount = normalizeNumber(
    latestTotals.needsHumanReviewCount,
  );
  const latestReviewDecisionRecordedCount = normalizeNumber(
    latestTotals.reviewDecisionRecordedCount,
  );
  return {
    sampleCount: normalizeNumber(trendReport?.sampleCount),
    isSeed: normalizeNumber(trendReport?.sampleCount) < 2,
    invalidDelta: normalizeNumber(delta.invalidCount),
    pendingDelta: normalizeNumber(delta.pendingRequestCaseCount),
    needsReviewDelta: normalizeNumber(delta.needsHumanReviewCount),
    reviewDecisionRecordedDelta:
      delta.reviewDecisionRecordedCount != null
        ? normalizeNumber(delta.reviewDecisionRecordedCount)
        : latestReviewDecisionRecordedCount -
          normalizeNumber(baselineTotals.reviewDecisionRecordedCount),
    latestNeedsReviewCount,
    latestReviewDecisionRecordedCount,
    reviewDecisionBacklogCount: Math.max(
      0,
      latestNeedsReviewCount - latestReviewDecisionRecordedCount,
    ),
    observabilityGapCaseDelta: normalizeNumber(delta.observabilityGapCaseCount),
    latestObservabilityGapCaseCount,
    currentObservabilityGapCaseDelta:
      delta.currentObservabilityGapCaseCount != null
        ? normalizeNumber(delta.currentObservabilityGapCaseCount)
        : latestCurrentObservabilityGapCaseCount -
          baselineCurrentObservabilityGapCaseCount,
    latestCurrentObservabilityGapCaseCount,
    degradedObservabilityGapCaseDelta:
      delta.degradedObservabilityGapCaseCount != null
        ? normalizeNumber(delta.degradedObservabilityGapCaseCount)
        : latestDegradedObservabilityGapCaseCount -
          baselineDegradedObservabilityGapCaseCount,
    latestDegradedObservabilityGapCaseCount,
    readyRateDelta: normalizeNumber(delta.readyRate),
    signals: Array.isArray(trendReport?.signals) ? trendReport.signals : [],
  };
}

function splitObservabilitySignalName(name) {
  const normalized = normalizeString(name);
  if (!normalized.includes(":")) {
    return {
      signal: normalized,
      status: "",
    };
  }

  const separatorIndex = normalized.indexOf(":");
  return {
    signal: normalized.slice(0, separatorIndex),
    status: normalized.slice(separatorIndex + 1),
  };
}

function getObservabilityStatusWeight(status) {
  switch (status) {
    case "missing":
      return 120;
    case "missing_signal_coverage":
      return 110;
    case "unlinked":
      return 95;
    case "known_gap":
      return 85;
    case "partial":
      return 70;
    default:
      return 50;
  }
}

function buildObservabilityFocusEntries(entries, sampleCount) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];

  return normalizedEntries
    .map((entry) => {
      const latest = isObject(entry?.latest) ? entry.latest : {};
      const delta = isObject(entry?.delta) ? entry.delta : {};
      const baseline = isObject(entry?.baseline) ? entry.baseline : {};
      const parsed = splitObservabilitySignalName(entry?.name);
      const positiveDeltaCase = Math.max(0, normalizeNumber(delta.caseCount));
      const latestCase = normalizeNumber(latest.caseCount);
      const score =
        positiveDeltaCase * 120 +
        latestCase * getObservabilityStatusWeight(parsed.status);

      let state = "stable";
      if (sampleCount < 2 && latestCase > 0) {
        state = "seed-risk";
      } else if (positiveDeltaCase > 0) {
        state = "regressing";
      } else if (latestCase > 0) {
        state = "present";
      }

      return {
        name: normalizeString(entry?.name, "(unknown)"),
        signal: parsed.signal || "(unknown)",
        status: parsed.status || "unknown",
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
          needsHumanReviewCount: normalizeNumber(
            latest.needsHumanReviewCount,
          ),
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
    .filter((entry) => entry.status && entry.status !== "exported")
    .filter((entry) => entry.score > 0 || entry.latest.caseCount > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.name.localeCompare(right.name);
    });
}

const OBSERVABILITY_VERIFICATION_FAILURE_OUTCOMES = new Set([
  "issues_present",
  "fallback_used",
  "failure",
  "unknown",
  "failed",
]);

const OBSERVABILITY_VERIFICATION_RECOVERED_OUTCOMES = new Set([
  "repaired",
  "success",
  "passed",
  "clean",
]);

function isObservabilityVerificationFailureOutcome(outcome) {
  return OBSERVABILITY_VERIFICATION_FAILURE_OUTCOMES.has(
    normalizeString(outcome),
  );
}

function isObservabilityVerificationRecoveredOutcome(outcome) {
  return OBSERVABILITY_VERIFICATION_RECOVERED_OUTCOMES.has(
    normalizeString(outcome),
  );
}

const BLOCKING_VERIFICATION_FAILURES = new Set([
  "browserVerification:failure",
  "guiSmoke:failed",
]);

function getObservabilityVerificationOutcomeRole(signal, outcome) {
  const normalizedSignal = normalizeString(signal);
  const normalizedOutcome = normalizeString(outcome);
  const fingerprint = `${normalizedSignal}:${normalizedOutcome}`;

  if (BLOCKING_VERIFICATION_FAILURES.has(fingerprint)) {
    return "blocking_failure";
  }

  if (isObservabilityVerificationFailureOutcome(normalizedOutcome)) {
    return "advisory_failure";
  }

  if (isObservabilityVerificationRecoveredOutcome(normalizedOutcome)) {
    return "recovered";
  }

  return "other";
}

function getObservabilityVerificationOutcomeWeight(outcome) {
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

function buildObservabilityVerificationFocusEntries(entries, sampleCount) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];

  return normalizedEntries
    .map((entry) => {
      const latest = isObject(entry?.latest) ? entry.latest : {};
      const delta = isObject(entry?.delta) ? entry.delta : {};
      const baseline = isObject(entry?.baseline) ? entry.baseline : {};
      const parsed = splitObservabilitySignalName(entry?.name);
      const positiveDeltaCase = Math.max(0, normalizeNumber(delta.caseCount));
      const latestCase = normalizeNumber(latest.caseCount);
      const weight = getObservabilityVerificationOutcomeWeight(parsed.status);
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
        name: normalizeString(entry?.name, "(unknown)"),
        signal: parsed.signal || "(unknown)",
        outcome: parsed.status || "unknown",
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
          needsHumanReviewCount: normalizeNumber(
            latest.needsHumanReviewCount,
          ),
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
          isObservabilityVerificationFailureOutcome(entry.outcome)),
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.name.localeCompare(right.name);
    });
}

function buildVerificationOutcomeEntriesFromDeltas(entries) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];

  return normalizedEntries
    .map((entry) => {
      const latest = isObject(entry?.latest) ? entry.latest : {};
      const delta = isObject(entry?.delta) ? entry.delta : {};
      const baseline = isObject(entry?.baseline) ? entry.baseline : {};
      const parsed = splitObservabilitySignalName(entry?.name);
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
        name: normalizeString(entry?.name, "(unknown)"),
        signal: parsed.signal || "(unknown)",
        outcome: parsed.status || "unknown",
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
          needsHumanReviewCount: normalizeNumber(
            latest.needsHumanReviewCount,
          ),
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

function buildVerificationOutcomeSummary(focusEntries) {
  const entries = Array.isArray(focusEntries) ? focusEntries : [];
  const blockingFailureEntries = entries.filter(
    (entry) =>
      getObservabilityVerificationOutcomeRole(entry?.signal, entry?.outcome) ===
      "blocking_failure",
  );
  const advisoryFailureEntries = entries.filter(
    (entry) =>
      getObservabilityVerificationOutcomeRole(entry?.signal, entry?.outcome) ===
      "advisory_failure",
  );
  const failureEntries = [...blockingFailureEntries, ...advisoryFailureEntries];
  const recoveredEntries = entries.filter(
    (entry) =>
      getObservabilityVerificationOutcomeRole(entry?.signal, entry?.outcome) ===
      "recovered",
  );

  return {
    focusCount: entries.length,
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

function buildDocFreshnessSummary(docFreshnessReport) {
  const summary = isObject(docFreshnessReport?.summary)
    ? docFreshnessReport.summary
    : {};

  return {
    monitoredDocumentCount: normalizeNumber(summary.monitoredDocumentCount),
    existingDocumentCount: normalizeNumber(summary.existingDocumentCount),
    issueCount: normalizeNumber(summary.issueCount),
    missingDocumentCount: normalizeNumber(summary.missingDocumentCount),
    missingRequiredReferenceCount: normalizeNumber(
      summary.missingRequiredReferenceCount,
    ),
    brokenMarkdownLinkCount: normalizeNumber(summary.brokenMarkdownLinkCount),
    brokenCodePathReferenceCount: normalizeNumber(
      summary.brokenCodePathReferenceCount,
    ),
    deletedSurfaceReferenceCount: normalizeNumber(
      summary.deletedSurfaceReferenceCount,
    ),
  };
}

function buildDocFreshnessFocus(docFreshnessReport) {
  const issues = Array.isArray(docFreshnessReport?.issues)
    ? docFreshnessReport.issues
    : [];

  const issueCounts = new Map();
  const documentCounts = new Map();

  for (const issue of issues) {
    const kind = normalizeString(issue?.kind, "unknown");
    const documentPath = normalizeString(issue?.documentPath, "(unknown)");
    issueCounts.set(kind, normalizeNumber(issueCounts.get(kind)) + 1);
    documentCounts.set(
      documentPath,
      normalizeNumber(documentCounts.get(documentPath)) + 1,
    );
  }

  return {
    issueKinds: [...issueCounts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind))
      .slice(0, 5),
    documents: [...documentCounts.entries()]
      .map(([documentPath, issueCount]) => ({ documentPath, issueCount }))
      .sort(
        (left, right) =>
          right.issueCount - left.issueCount ||
          left.documentPath.localeCompare(right.documentPath),
      )
      .slice(0, 5),
  };
}

function maybePushRecommendation(recommendations, action) {
  if (recommendations.some((entry) => entry.id === action.id)) {
    return;
  }
  const normalizedAction = {
    ...action,
    focusVerificationFailureOutcomes: dedupeNonEmptyStrings(
      Array.isArray(action?.focusVerificationFailureOutcomes)
        ? action.focusVerificationFailureOutcomes
        : [],
    ),
    focusVerificationRecoveredOutcomes: dedupeNonEmptyStrings(
      Array.isArray(action?.focusVerificationRecoveredOutcomes)
        ? action.focusVerificationRecoveredOutcomes
        : [],
    ),
  };
  delete normalizedAction.focusObservabilityVerificationOutcomes;
  recommendations.push(normalizedAction);
}

function dedupeNonEmptyStrings(values) {
  const normalizedValues = Array.isArray(values) ? values : [];
  return [...new Set(normalizedValues.map((value) => normalizeString(value)).filter(Boolean))];
}

function assertStringArrayField(value, label, recommendationId) {
  if (!Array.isArray(value)) {
    throw new Error(
      `cleanup recommendation ${recommendationId} 的 ${label} 必须是字符串数组。`,
    );
  }

  if (
    value.some(
      (entry) =>
        typeof entry !== "string" || normalizeString(entry).length === 0,
    )
  ) {
    throw new Error(
      `cleanup recommendation ${recommendationId} 的 ${label} 只能包含非空字符串。`,
    );
  }
}

export function assertGeneratedSlopReportContract(report) {
  const recommendations = Array.isArray(report?.recommendations)
    ? report.recommendations
    : [];

  recommendations.forEach((action, index) => {
    if (!isObject(action)) {
      throw new Error(`cleanup recommendation #${index + 1} 必须是对象。`);
    }

    const recommendationId = normalizeString(action?.id, `#${index + 1}`);

    if (
      Object.prototype.hasOwnProperty.call(
        action,
        "focusObservabilityVerificationOutcomes",
      )
    ) {
      throw new Error(
        `cleanup recommendation ${recommendationId} 不允许继续使用 focusObservabilityVerificationOutcomes；请改用 focusVerificationFailureOutcomes / focusVerificationRecoveredOutcomes。`,
      );
    }

    assertStringArrayField(
      action?.focusFailureModes,
      "focusFailureModes",
      recommendationId,
    );
    assertStringArrayField(
      action?.focusSuiteTags,
      "focusSuiteTags",
      recommendationId,
    );
    assertStringArrayField(
      action?.focusReviewDecisionStatuses,
      "focusReviewDecisionStatuses",
      recommendationId,
    );
    assertStringArrayField(
      action?.focusReviewRiskLevels,
      "focusReviewRiskLevels",
      recommendationId,
    );
    assertStringArrayField(
      action?.focusVerificationFailureOutcomes,
      "focusVerificationFailureOutcomes",
      recommendationId,
    );
    assertStringArrayField(
      action?.focusVerificationRecoveredOutcomes,
      "focusVerificationRecoveredOutcomes",
      recommendationId,
    );
    assertStringArrayField(
      action?.focusSurfaceIds,
      "focusSurfaceIds",
      recommendationId,
    );
    assertStringArrayField(action?.commands, "commands", recommendationId);
    assertStringArrayField(
      action?.backlogTools,
      "backlogTools",
      recommendationId,
    );
    assertStringArrayField(action?.rationale, "rationale", recommendationId);
  });

  const verificationFailureFocus = Array.isArray(
    report?.focus?.observabilityVerificationOutcomes,
  )
    ? report.focus.observabilityVerificationOutcomes
    : [];

  if (
    verificationFailureFocus.some(
      (entry) =>
        getObservabilityVerificationOutcomeRole(entry?.signal, entry?.outcome) ===
        "recovered",
    )
  ) {
    throw new Error(
      "cleanup report 的 focus.observabilityVerificationOutcomes 只允许 failure outcome，不允许 recovered outcome 混入。",
    );
  }

  return report;
}

function hasObservabilityVerificationOutcome(entries, signal, outcome) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const normalizedSignal = normalizeString(signal);
  const normalizedOutcome = normalizeString(outcome);

  return normalizedEntries.some(
    (entry) =>
      normalizeString(entry?.signal) === normalizedSignal &&
      normalizeString(entry?.outcome) === normalizedOutcome,
  );
}

function buildCurrentBlockingVerificationFollowUp(
  focusCurrentObservabilityVerificationOutcomes,
) {
  const hasCurrentGuiSmokeFailure = hasObservabilityVerificationOutcome(
    focusCurrentObservabilityVerificationOutcomes,
    "guiSmoke",
    "failed",
  );
  const hasCurrentBrowserVerificationFailure =
    hasObservabilityVerificationOutcome(
      focusCurrentObservabilityVerificationOutcomes,
      "browserVerification",
      "failure",
    );
  const commands = ["npm run harness:eval", "npm run harness:eval:trend"];
  const backlogTools = [];
  const rationale = [];

  if (hasCurrentGuiSmokeFailure) {
    commands.push("npm run verify:gui-smoke");
    rationale.push(
      "current 样本已出现 guiSmoke:failed，先恢复 GUI 壳 / DevBridge / Workspace 主路径的最小可启动性。",
    );
    backlogTools.push(
      "优先收敛 GUI 壳 / DevBridge / Workspace 主路径，再复跑 `npm run verify:gui-smoke`。",
    );
  }

  if (hasCurrentBrowserVerificationFailure) {
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

function buildCurrentAdvisoryVerificationFollowUp(
  focusCurrentObservabilityVerificationOutcomes,
) {
  const hasArtifactValidatorIssuesPresent = hasObservabilityVerificationOutcome(
    focusCurrentObservabilityVerificationOutcomes,
    "artifactValidator",
    "issues_present",
  );
  const hasArtifactValidatorFallbackUsed = hasObservabilityVerificationOutcome(
    focusCurrentObservabilityVerificationOutcomes,
    "artifactValidator",
    "fallback_used",
  );
  const hasBrowserVerificationUnknown = hasObservabilityVerificationOutcome(
    focusCurrentObservabilityVerificationOutcomes,
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

function buildCurrentRecoveredVerificationFollowUp(
  focusCurrentRecoveredObservabilityVerificationOutcomes,
) {
  const hasArtifactValidatorRepaired = hasObservabilityVerificationOutcome(
    focusCurrentRecoveredObservabilityVerificationOutcomes,
    "artifactValidator",
    "repaired",
  );
  const hasBrowserVerificationSuccess = hasObservabilityVerificationOutcome(
    focusCurrentRecoveredObservabilityVerificationOutcomes,
    "browserVerification",
    "success",
  );
  const hasGuiSmokePassed = hasObservabilityVerificationOutcome(
    focusCurrentRecoveredObservabilityVerificationOutcomes,
    "guiSmoke",
    "passed",
  );
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

function buildRecommendations({
  trendSummary,
  verificationOutcomeSummary,
  focusFailureModes,
  focusSuiteTags,
  focusReviewDecisionStatuses,
  focusReviewRiskLevels,
  focusObservabilitySignals,
  focusVerificationFailureOutcomes,
  focusCurrentObservabilityVerificationOutcomes,
  focusCurrentRecoveredObservabilityVerificationOutcomes,
  focusDegradedObservabilityVerificationOutcomes,
  docFreshnessSummary,
  docFreshnessFocus,
  governanceSummary,
  governanceSurfaces,
}) {
  const recommendations = [];
  const topFailureModes = focusFailureModes
    .slice(0, 3)
    .map((entry) => entry.name);
  const topSuiteTags = focusSuiteTags.slice(0, 3).map((entry) => entry.name);
  const topReviewDecisionStatuses = focusReviewDecisionStatuses
    .slice(0, 3)
    .map((entry) => entry.name);
  const topReviewRiskLevels = focusReviewRiskLevels
    .slice(0, 3)
    .map((entry) => entry.name);
  const topObservabilitySignals = focusObservabilitySignals
    .slice(0, 3)
    .map((entry) => `${entry.signal} (${entry.status})`);
  const topVerificationFailureOutcomes = focusVerificationFailureOutcomes
    .slice(0, 3)
    .map((entry) => `${entry.signal} (${entry.outcome})`);
  const topCurrentVerificationFailureOutcomes =
    focusCurrentObservabilityVerificationOutcomes
    .slice(0, 3)
    .map((entry) => `${entry.signal} (${entry.outcome})`);
  const topCurrentRecoveredVerificationOutcomes =
    focusCurrentRecoveredObservabilityVerificationOutcomes
      .slice(0, 3)
      .map((entry) => `${entry.signal} (${entry.outcome})`);
  const topDegradedVerificationFailureOutcomes =
    focusDegradedObservabilityVerificationOutcomes
      .slice(0, 3)
      .map((entry) => `${entry.signal} (${entry.outcome})`);
  const topRecommendedVerificationFailureOutcomes =
    topCurrentVerificationFailureOutcomes.length > 0
      ? topCurrentVerificationFailureOutcomes
      : topVerificationFailureOutcomes;
  const topGovernanceSurfaceIds = governanceSurfaces
    .filter((entry) => entry.active && entry.classification !== "current")
    .slice(0, 3)
    .map((entry) => entry.id);
  const currentVerificationSummary =
    verificationOutcomeSummary?.current ?? buildVerificationOutcomeSummary([]);
  const degradedVerificationSummary =
    verificationOutcomeSummary?.degraded ?? buildVerificationOutcomeSummary([]);
  const currentBlockingVerificationFollowUp =
    buildCurrentBlockingVerificationFollowUp(
      focusCurrentObservabilityVerificationOutcomes,
    );
  const currentAdvisoryVerificationFollowUp =
    buildCurrentAdvisoryVerificationFollowUp(
      focusCurrentObservabilityVerificationOutcomes,
    );
  const currentRecoveredVerificationFollowUp =
    buildCurrentRecoveredVerificationFollowUp(
      focusCurrentRecoveredObservabilityVerificationOutcomes,
    );

  if (governanceSummary.violationCount > 0) {
    maybePushRecommendation(recommendations, {
      id: "contracts-and-boundary-guards",
      priority: "P0",
      title: "先修命令/治理边界违规，再继续扩主线",
      rationale: [
        `当前 governance report 发现 ${governanceSummary.violationCount} 条边界违规。`,
        "这类问题会让 current / compat / deprecated 边界重新漂移，必须先封老路。",
      ],
      commands: ["npm run governance:legacy-report", "npm run test:contracts"],
      backlogTools: [],
      focusFailureModes: topFailureModes,
      focusSuiteTags: topSuiteTags,
      focusReviewDecisionStatuses: topReviewDecisionStatuses,
      focusReviewRiskLevels: topReviewRiskLevels,
      focusVerificationFailureOutcomes:
        topRecommendedVerificationFailureOutcomes,
      focusSurfaceIds: topGovernanceSurfaceIds,
    });
  }

  if (trendSummary.isSeed) {
    maybePushRecommendation(recommendations, {
      id: "promote-high-value-replay",
      priority: "P1",
      title: "提升高价值 Replay 样本，结束 trend seed 状态",
      rationale: [
        `当前 trend 样本数只有 ${trendSummary.sampleCount}，还不能判断长期退化。`,
        "先把最近一次高价值失败提升为 repo current 样本，再谈趋势治理。",
      ],
      commands: [
        "npm run harness:eval:promote -- --session-id \"<session-id>\" --slug \"<slug>\"",
        "npm run harness:eval:trend",
      ],
      backlogTools: [],
      focusFailureModes: topFailureModes,
      focusSuiteTags: topSuiteTags,
      focusReviewDecisionStatuses: topReviewDecisionStatuses,
      focusReviewRiskLevels: topReviewRiskLevels,
      focusVerificationFailureOutcomes:
        topRecommendedVerificationFailureOutcomes,
      focusSurfaceIds: [],
    });
  }

  const hasTrendPressure =
    trendSummary.invalidDelta > 0 ||
    trendSummary.pendingDelta > 0 ||
    trendSummary.needsReviewDelta > 0 ||
    currentVerificationSummary.blockingFailureCaseCount > 0 ||
    focusFailureModes.some((entry) => entry.state !== "stable");

  if (hasTrendPressure) {
    maybePushRecommendation(recommendations, {
      id: "replay-and-smoke-follow-up",
      priority:
        currentVerificationSummary.blockingFailureCaseCount > 0 ? "P0" : "P1",
      title: "把高风险 failure mode 回挂到 replay / smoke 验证",
      rationale: [
        `当前 failure mode 焦点：${topFailureModes.join("、") || "暂无"}。`,
        "先用 replay / eval 固化失败，再按受影响主路径补最小 smoke，而不是直接凭印象清理。",
        topCurrentVerificationFailureOutcomes.length > 0
          ? `当前 current verification failure outcome 焦点：${topCurrentVerificationFailureOutcomes.join("、")}。`
          : "当前没有额外的 verification failure outcome 焦点。",
        ...currentBlockingVerificationFollowUp.rationale,
        currentVerificationSummary.blockingFailureCaseCount > 0
          ? `其中 current blocking verification failure 共 ${currentVerificationSummary.blockingFailureCaseCount} 个 case：${currentVerificationSummary.topBlockingFailureOutcomes.join("、") || "暂无"}。`
          : "当前没有额外的 blocking verification failure。",
        degradedVerificationSummary.blockingFailureCaseCount > 0
          ? `另有 ${degradedVerificationSummary.blockingFailureCaseCount} 个 degraded blocking verification failure 样本作为诊断基线，不直接抬高主线优先级。`
          : "当前没有额外的 degraded blocking verification baseline。",
      ],
      commands: currentBlockingVerificationFollowUp.commands,
      backlogTools: currentBlockingVerificationFollowUp.backlogTools,
      focusFailureModes: topFailureModes,
      focusSuiteTags: topSuiteTags,
      focusReviewDecisionStatuses: topReviewDecisionStatuses,
      focusReviewRiskLevels: topReviewRiskLevels,
      focusVerificationFailureOutcomes:
        topRecommendedVerificationFailureOutcomes,
      focusSurfaceIds: [],
    });
  }

  const hasReviewDecisionPressure =
    trendSummary.reviewDecisionBacklogCount > 0 ||
    focusReviewDecisionStatuses.some(
      (entry) =>
        entry.latest.caseCount > 0 &&
        (entry.name === "pending_review" ||
          entry.name === "needs_more_evidence" ||
          entry.state !== "stable"),
    ) ||
    focusReviewRiskLevels.some(
      (entry) =>
        entry.latest.caseCount > 0 &&
        (entry.name === "high" || entry.name === "medium"),
    );

  if (hasReviewDecisionPressure) {
    maybePushRecommendation(recommendations, {
      id: "review-decision-follow-up",
      priority:
        trendSummary.reviewDecisionBacklogCount > 0 ||
        topReviewRiskLevels.includes("high")
          ? "P1"
          : "P2",
      title: "把人工审核状态与风险等级回挂到回归动作",
      rationale: [
        trendSummary.reviewDecisionBacklogCount > 0
          ? `当前仍有 ${trendSummary.reviewDecisionBacklogCount} 个需要人工审核的 case 尚未留下最终 decision。`
          : `当前人工审核状态焦点：${topReviewDecisionStatuses.join("、") || "暂无"}。`,
        `当前风险等级焦点：${topReviewRiskLevels.join("、") || "暂无"}。高风险或补证据状态应优先回挂到 replay / contracts / smoke 主链。`,
      ],
      commands: [
        "npm run harness:eval",
        "npm run harness:eval:trend",
        "npm run harness:cleanup-report",
      ],
      backlogTools:
        topReviewDecisionStatuses.includes("needs_more_evidence") ||
        trendSummary.reviewDecisionBacklogCount > 0
          ? [
              "补 evidence pack / analysis handoff / replay 证据字段，缩短 review-decision 从 pending_review 或 needs_more_evidence 回到可执行回归的路径",
            ]
          : [],
      focusFailureModes: topFailureModes,
      focusSuiteTags: topSuiteTags,
      focusReviewDecisionStatuses: topReviewDecisionStatuses,
      focusReviewRiskLevels: topReviewRiskLevels,
      focusVerificationFailureOutcomes:
        topRecommendedVerificationFailureOutcomes,
      focusSurfaceIds: [],
    });
  }

  const hasObservabilityPressure =
    trendSummary.latestCurrentObservabilityGapCaseCount > 0 ||
    trendSummary.currentObservabilityGapCaseDelta > 0 ||
    currentVerificationSummary.advisoryFailureCaseCount > 0;

  if (hasObservabilityPressure) {
    maybePushRecommendation(recommendations, {
      id: "observability-evidence-follow-up",
      priority:
        topObservabilitySignals.some(
          (entry) =>
            entry.includes("observabilitySummary (missing)") ||
            entry.includes("requestTelemetry (known_gap)"),
        ) ||
        trendSummary.currentObservabilityGapCaseDelta > 0 ||
        currentVerificationSummary.advisoryFailureCaseCount > 0
          ? "P1"
          : "P2",
      title: "先补 observability 证据覆盖，再扩大外部分析与回归",
      rationale: [
        trendSummary.latestCurrentObservabilityGapCaseCount > 0
          ? `当前仍有 ${trendSummary.latestCurrentObservabilityGapCaseCount} 个 current case 带着 observability 证据缺口进入 replay/eval。`
          : "当前 trend 已检测到 observability coverage 漂移，需先修证据而不是空谈根因分析。",
        trendSummary.latestDegradedObservabilityGapCaseCount > 0
          ? `另有 ${trendSummary.latestDegradedObservabilityGapCaseCount} 个 degraded gap 样本作为诊断基线保留，它们不应直接被当成主线回归。`
          : "当前没有额外保留的 degraded observability gap 样本。",
        `当前缺口焦点：${topObservabilitySignals.join("、") || "暂无"}。这些缺口会直接降低 analysis handoff、人工审核和 cleanup report 的判断质量。`,
        topCurrentVerificationFailureOutcomes.length > 0
          ? `当前 current verification failure outcome 焦点：${topCurrentVerificationFailureOutcomes.join("、")}。可用它们直接定位先补 artifact/browser/gui 哪一层。`
          : "当前没有额外的 verification failure outcome 焦点。",
        ...currentAdvisoryVerificationFollowUp.rationale,
        currentVerificationSummary.advisoryFailureCaseCount > 0
          ? `当前 current advisory verification failure 共 ${currentVerificationSummary.advisoryFailureCaseCount} 个 case：${currentVerificationSummary.topAdvisoryFailureOutcomes.join("、") || "暂无"}。`
          : "当前没有额外的 advisory verification failure。",
        topDegradedVerificationFailureOutcomes.length > 0
          ? `当前保留的 degraded verification baseline：${topDegradedVerificationFailureOutcomes.join("、")}。`
          : "当前没有额外的 degraded verification baseline。",
      ],
      commands: [
        "npm run harness:eval",
        "npm run harness:eval:trend",
        "npm run harness:cleanup-report",
      ],
      backlogTools: [
        "优先补 request telemetry 关联键、artifact validator outcome、browser/gui smoke 结果到 evidence pack / analysis handoff / replay。",
        ...(topCurrentVerificationFailureOutcomes.length > 0
          ? [
              `先对齐 current verification failure outcome：${topCurrentVerificationFailureOutcomes.join("、")}。`,
            ]
          : []),
        ...currentAdvisoryVerificationFollowUp.backlogTools,
      ],
      focusFailureModes: topFailureModes,
      focusSuiteTags: topSuiteTags,
      focusReviewDecisionStatuses: topReviewDecisionStatuses,
      focusReviewRiskLevels: topReviewRiskLevels,
      focusVerificationFailureOutcomes:
        topRecommendedVerificationFailureOutcomes,
      focusSurfaceIds: [],
    });
  }

  const hasGovernancePressure =
    governanceSummary.activeByClassification.compat > 0 ||
    governanceSummary.activeByClassification.deprecated > 0 ||
    governanceSummary.activeByClassification["dead-candidate"] > 0 ||
    governanceSummary.classificationDriftCount > 0 ||
    governanceSummary.zeroReferenceCandidateCount > 0;

  if (hasGovernancePressure) {
    maybePushRecommendation(recommendations, {
      id: "governance-cleanup-priority",
      priority:
        governanceSummary.activeByClassification["dead-candidate"] > 0 ||
        governanceSummary.activeByClassification.deprecated > 0
          ? "P1"
          : "P2",
      title: "按治理分类清理 compat / deprecated / dead-candidate 表面",
      rationale: [
        `当前活跃 legacy surface：compat ${governanceSummary.activeByClassification.compat}、deprecated ${governanceSummary.activeByClassification.deprecated}、dead-candidate ${governanceSummary.activeByClassification["dead-candidate"]}。`,
        "这一步是证据驱动的人类治理，不是 Lime 内部自动清理。",
      ],
      commands: ["npm run governance:legacy-report"],
      backlogTools: [],
      focusFailureModes: topFailureModes,
      focusSuiteTags: topSuiteTags,
      focusReviewDecisionStatuses: topReviewDecisionStatuses,
      focusReviewRiskLevels: topReviewRiskLevels,
      focusVerificationFailureOutcomes:
        topRecommendedVerificationFailureOutcomes,
      focusSurfaceIds: topGovernanceSurfaceIds,
    });
  }

  if (currentVerificationSummary.recoveredCaseCount > 0) {
    maybePushRecommendation(recommendations, {
      id: "recovered-baseline-follow-up",
      priority:
        currentVerificationSummary.blockingFailureCaseCount === 0 &&
        currentVerificationSummary.advisoryFailureCaseCount === 0
          ? "P2"
          : "P3",
      title: "把 recovered verification outcome 固化成 current 正向基线",
      rationale: [
        topCurrentRecoveredVerificationOutcomes.length > 0
          ? `当前 current recovered outcome 焦点：${topCurrentRecoveredVerificationOutcomes.join("、")}。`
          : `当前 current recovered outcome 共 ${currentVerificationSummary.recoveredCaseCount} 个 case。`,
        ...currentRecoveredVerificationFollowUp.rationale,
        "恢复成功的 outcome 不应只停留在统计卡里，还应继续回挂到 replay / smoke / evidence 主链，作为后续回退判断的正向对照。",
      ],
      commands: currentRecoveredVerificationFollowUp.commands,
      backlogTools: currentRecoveredVerificationFollowUp.backlogTools,
      focusFailureModes: topFailureModes,
      focusSuiteTags: topSuiteTags,
      focusReviewDecisionStatuses: topReviewDecisionStatuses,
      focusReviewRiskLevels: topReviewRiskLevels,
      focusVerificationRecoveredOutcomes:
        topCurrentRecoveredVerificationOutcomes.length > 0
          ? topCurrentRecoveredVerificationOutcomes
          : [],
      focusSurfaceIds: [],
    });
  }

  const shouldReviewDocs =
    docFreshnessSummary.issueCount > 0 ||
    trendSummary.isSeed ||
    governanceSummary.classificationDriftCount > 0 ||
    governanceSummary.activeByClassification.compat > 0 ||
    governanceSummary.activeByClassification.deprecated > 0 ||
    trendSummary.signals.some((signal) => signal.includes("字段漂移"));

  if (shouldReviewDocs) {
    const topDocPaths = docFreshnessFocus.documents
      .slice(0, 3)
      .map((entry) => entry.documentPath);
    maybePushRecommendation(recommendations, {
      id: "doc-freshness-review",
      priority: docFreshnessSummary.issueCount > 0 ? "P1" : "P2",
      title: "回看 Harness 文档与事实源是否过期",
      rationale: [
        "当 replay/trend 与治理边界同时在演进时，文档漂移会把分析和修复重新推回聊天窗口。",
        docFreshnessSummary.issueCount > 0
          ? `当前 doc freshness 发现 ${docFreshnessSummary.issueCount} 个问题，应先修回链和失效引用。`
          : "当前仓库已经有自动化 doc freshness 检查，可先扫描高频 Harness 文档的回链和已删除表面引用。",
      ],
      commands: ["npm run harness:doc-freshness"],
      backlogTools: [],
      focusFailureModes: topFailureModes,
      focusSuiteTags: topSuiteTags,
      focusReviewDecisionStatuses: topReviewDecisionStatuses,
      focusReviewRiskLevels: topReviewRiskLevels,
      focusVerificationFailureOutcomes:
        topRecommendedVerificationFailureOutcomes,
      focusSurfaceIds:
        topDocPaths.length > 0 ? topDocPaths : topGovernanceSurfaceIds,
    });
  }

  return recommendations.sort((left, right) => {
    const priorityDiff =
      (PRIORITY_RANK[left.priority] ?? 99) -
      (PRIORITY_RANK[right.priority] ?? 99);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return left.id.localeCompare(right.id);
  });
}

export function buildGeneratedSlopReport({
  repoRoot,
  trendReport,
  docFreshnessReport,
  governanceReport,
  sources = {},
}) {
  const trendSummary = buildTrendSummary(trendReport);
  const docFreshnessSummary = buildDocFreshnessSummary(docFreshnessReport);
  const docFreshnessFocus = buildDocFreshnessFocus(docFreshnessReport);
  const focusFailureModes = buildTrendFocusEntries(
    trendReport?.classificationDeltas?.failureModes,
    trendSummary.sampleCount,
  );
  const focusSuiteTags = buildTrendFocusEntries(
    trendReport?.classificationDeltas?.suiteTags,
    trendSummary.sampleCount,
  );
  const focusReviewDecisionStatuses = buildTrendFocusEntries(
    trendReport?.classificationDeltas?.reviewDecisionStatuses,
    trendSummary.sampleCount,
  );
  const focusReviewRiskLevels = buildTrendFocusEntries(
    trendReport?.classificationDeltas?.reviewRiskLevels,
    trendSummary.sampleCount,
  );
  const focusObservabilitySignals = buildObservabilityFocusEntries(
    trendReport?.classificationDeltas?.observabilitySignals,
    trendSummary.sampleCount,
  );
  const rawObservabilityVerificationOutcomes =
    buildObservabilityVerificationFocusEntries(
      trendReport?.classificationDeltas?.observabilityVerificationOutcomes,
      trendSummary.sampleCount,
    );
  const explicitRecoveredObservabilityVerificationOutcomes =
    buildVerificationOutcomeEntriesFromDeltas(
      trendReport?.classificationDeltas?.observabilityVerificationOutcomes,
    ).filter(
      (entry) =>
        getObservabilityVerificationOutcomeRole(entry?.signal, entry?.outcome) ===
        "recovered",
    );
  const focusVerificationFailureOutcomes =
    rawObservabilityVerificationOutcomes.filter(
      (entry) =>
        getObservabilityVerificationOutcomeRole(entry?.signal, entry?.outcome) !==
        "recovered",
    );
  const rawCurrentObservabilityVerificationOutcomes =
    buildObservabilityVerificationFocusEntries(
      trendReport?.classificationDeltas?.currentObservabilityVerificationOutcomes,
      trendSummary.sampleCount,
    );
  const explicitCurrentRecoveredObservabilityVerificationOutcomes =
    buildVerificationOutcomeEntriesFromDeltas(
      trendReport?.classificationDeltas?.currentRecoveredObservabilityVerificationOutcomes,
    );
  const focusCurrentObservabilityVerificationOutcomes =
    rawCurrentObservabilityVerificationOutcomes.filter(
      (entry) =>
        getObservabilityVerificationOutcomeRole(entry?.signal, entry?.outcome) !==
        "recovered",
    );
  const focusCurrentRecoveredObservabilityVerificationOutcomes =
    explicitCurrentRecoveredObservabilityVerificationOutcomes.length > 0
      ? explicitCurrentRecoveredObservabilityVerificationOutcomes
      : rawCurrentObservabilityVerificationOutcomes.filter(
          (entry) =>
            getObservabilityVerificationOutcomeRole(
              entry?.signal,
              entry?.outcome,
            ) === "recovered",
        );
  const rawDegradedObservabilityVerificationOutcomes =
    buildObservabilityVerificationFocusEntries(
      trendReport?.classificationDeltas?.degradedObservabilityVerificationOutcomes,
      trendSummary.sampleCount,
    );
  const focusDegradedObservabilityVerificationOutcomes =
    rawDegradedObservabilityVerificationOutcomes.filter(
      (entry) =>
        getObservabilityVerificationOutcomeRole(entry?.signal, entry?.outcome) !==
        "recovered",
    );
  const mergedVerificationFailureOutcomes =
    focusVerificationFailureOutcomes.length > 0
      ? focusVerificationFailureOutcomes
      : [
          ...focusCurrentObservabilityVerificationOutcomes,
          ...focusDegradedObservabilityVerificationOutcomes,
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
    explicitRecoveredObservabilityVerificationOutcomes.length > 0
      ? explicitRecoveredObservabilityVerificationOutcomes
      : mergedVerificationFailureOutcomes.filter(
          (entry) =>
            getObservabilityVerificationOutcomeRole(
              entry?.signal,
              entry?.outcome,
            ) === "recovered",
        ),
  );
  const verificationOutcomeSummary = {
    ...verificationFailureSummary,
    recoveredFocusCount: recoveredVerificationSummary.recoveredFocusCount,
    recoveredCaseCount: recoveredVerificationSummary.recoveredCaseCount,
    topRecoveredOutcomes: recoveredVerificationSummary.topRecoveredOutcomes,
  };
  const currentVerificationFailureSummary = buildVerificationOutcomeSummary(
    focusCurrentObservabilityVerificationOutcomes,
  );
  const currentRecoveredVerificationSummary = buildVerificationOutcomeSummary(
    focusCurrentRecoveredObservabilityVerificationOutcomes,
  );
  const currentVerificationOutcomeSummary = {
    ...currentVerificationFailureSummary,
    recoveredFocusCount: currentRecoveredVerificationSummary.recoveredFocusCount,
    recoveredCaseCount: currentRecoveredVerificationSummary.recoveredCaseCount,
    topRecoveredOutcomes: currentRecoveredVerificationSummary.topRecoveredOutcomes,
  };
  const degradedVerificationOutcomeSummary = buildVerificationOutcomeSummary(
    focusDegradedObservabilityVerificationOutcomes,
  );
  const currentRecoveredVerificationOutcomes =
    focusCurrentRecoveredObservabilityVerificationOutcomes
      .slice(0, 3)
      .map((entry) => `${entry.signal} (${entry.outcome})`);
  const combinedVerificationOutcomeSummary = {
    ...verificationOutcomeSummary,
    current: currentVerificationOutcomeSummary,
    degraded: degradedVerificationOutcomeSummary,
  };
  const governanceSurfaces = buildGovernanceSurfaceEntries(governanceReport);
  const governanceSummary = buildGovernanceSummary(
    governanceReport,
    governanceSurfaces,
  );
  const recommendations = buildRecommendations({
    trendSummary,
    verificationOutcomeSummary: combinedVerificationOutcomeSummary,
    focusFailureModes,
    focusSuiteTags,
    focusReviewDecisionStatuses,
    focusReviewRiskLevels,
    focusObservabilitySignals,
    focusVerificationFailureOutcomes: mergedVerificationFailureOutcomes,
    focusCurrentObservabilityVerificationOutcomes,
    focusCurrentRecoveredObservabilityVerificationOutcomes,
    focusDegradedObservabilityVerificationOutcomes,
    docFreshnessSummary,
    docFreshnessFocus,
    governanceSummary,
    governanceSurfaces,
  });

  const report = {
    reportVersion: "v1",
    generatedAt: new Date().toISOString(),
    repoRoot: normalizeString(repoRoot),
    sources: {
      trend: {
        kind: normalizeString(sources?.trend?.kind, "generated"),
        path: normalizeString(sources?.trend?.path),
      },
      docFreshness: {
        kind: normalizeString(sources?.docFreshness?.kind, "generated"),
        path: normalizeString(sources?.docFreshness?.path),
      },
      governance: {
        kind: normalizeString(sources?.governance?.kind, "generated"),
        path: normalizeString(sources?.governance?.path),
      },
    },
    summary: {
      trend: trendSummary,
      verificationOutcomes: combinedVerificationOutcomeSummary,
      docFreshness: docFreshnessSummary,
      governance: governanceSummary,
    },
    signals: [
      ...trendSummary.signals,
      docFreshnessSummary.issueCount > 0
        ? `doc freshness 发现 ${docFreshnessSummary.issueCount} 个问题。`
        : "当前高频 Harness 文档回链与路径引用保持新鲜。",
      governanceSummary.violationCount > 0
        ? `governance 边界违规 ${governanceSummary.violationCount} 条。`
        : "当前没有新的 governance 边界违规。",
      governanceSummary.activeByClassification.compat > 0
        ? `compat 活跃 surface ${governanceSummary.activeByClassification.compat} 个。`
        : "当前没有活跃 compat surface。",
      governanceSummary.activeByClassification.deprecated > 0
        ? `deprecated 活跃 surface ${governanceSummary.activeByClassification.deprecated} 个。`
        : "当前没有活跃 deprecated surface。",
      trendSummary.reviewDecisionBacklogCount > 0
        ? `仍有 ${trendSummary.reviewDecisionBacklogCount} 个需要人工审核的 case 尚未记录最终 decision。`
        : "当前没有待补录的人工审核 backlog。",
      trendSummary.latestCurrentObservabilityGapCaseCount > 0
        ? `当前仍有 ${trendSummary.latestCurrentObservabilityGapCaseCount} 个 current case 缺 observability 证据。`
        : "当前 current 样本没有额外的 observability 证据缺口。",
      trendSummary.latestDegradedObservabilityGapCaseCount > 0
        ? `当前保留 ${trendSummary.latestDegradedObservabilityGapCaseCount} 个 degraded observability gap 样本作为诊断基线。`
        : "当前没有额外保留的 degraded observability gap 样本。",
      focusVerificationFailureOutcomes.length > 0
        ? `当前 verification failure outcome 焦点：${focusVerificationFailureOutcomes
            .slice(0, 3)
            .map((entry) => `${entry.signal} (${entry.outcome})`)
            .join("、")}。`
        : "当前没有额外的 verification failure outcome 焦点。",
      verificationOutcomeSummary.failureCaseCount > 0
        ? `当前 verification failure 聚焦 ${verificationOutcomeSummary.failureFocusCount} 类 outcome，共 ${verificationOutcomeSummary.failureCaseCount} 个 case。`
        : "当前没有额外的 verification failure case。",
      currentVerificationOutcomeSummary.blockingFailureCaseCount > 0
        ? `当前 current 样本里有 ${currentVerificationOutcomeSummary.blockingFailureCaseCount} 个 blocking verification failure。`
        : "当前没有额外的 blocking verification failure。",
      currentVerificationOutcomeSummary.advisoryFailureCaseCount > 0
        ? `当前 current 样本里有 ${currentVerificationOutcomeSummary.advisoryFailureCaseCount} 个 advisory verification failure。`
        : "当前没有额外的 advisory verification failure。",
      currentVerificationOutcomeSummary.recoveredCaseCount > 0
        ? `当前 current recovered verification baseline：${currentRecoveredVerificationOutcomes.join("、") || "暂无"}。`
        : "当前没有额外的 current recovered verification baseline。",
      degradedVerificationOutcomeSummary.blockingFailureCaseCount > 0
        ? `当前保留 ${degradedVerificationOutcomeSummary.blockingFailureCaseCount} 个 degraded blocking verification failure 样本作为诊断基线。`
        : "当前没有额外的 degraded blocking verification baseline。",
      verificationOutcomeSummary.recoveredCaseCount > 0
        ? `当前 verification recovered 聚焦 ${verificationOutcomeSummary.recoveredFocusCount} 类 outcome，共 ${verificationOutcomeSummary.recoveredCaseCount} 个 case。`
        : "当前没有额外的 verification recovered case。",
    ],
    focus: {
      failureModes: focusFailureModes.slice(0, 5),
      suiteTags: focusSuiteTags.slice(0, 5),
      reviewDecisionStatuses: focusReviewDecisionStatuses.slice(0, 5),
      reviewRiskLevels: focusReviewRiskLevels.slice(0, 5),
      observabilitySignals: focusObservabilitySignals.slice(0, 5),
      observabilityVerificationOutcomes:
        mergedVerificationFailureOutcomes.slice(0, 5),
      currentObservabilityVerificationOutcomes:
        focusCurrentObservabilityVerificationOutcomes.slice(0, 5),
      currentRecoveredObservabilityVerificationOutcomes:
        focusCurrentRecoveredObservabilityVerificationOutcomes.slice(0, 5),
      degradedObservabilityVerificationOutcomes:
        focusDegradedObservabilityVerificationOutcomes.slice(0, 5),
      docFreshness: docFreshnessFocus,
      governanceSurfaces: governanceSurfaces
        .filter((entry) => entry.active && entry.classification !== "current")
        .slice(0, 5),
    },
    recommendations,
  };

  return assertGeneratedSlopReportContract(report);
}

export function renderGeneratedSlopText(report) {
  const lines = [
    "[harness-cleanup] generated slop report",
    `[harness-cleanup] trend source: ${report.sources.trend.kind}${report.sources.trend.path ? ` (${report.sources.trend.path})` : ""}`,
    `[harness-cleanup] doc freshness source: ${report.sources.docFreshness.kind}${report.sources.docFreshness.path ? ` (${report.sources.docFreshness.path})` : ""}`,
    `[harness-cleanup] governance source: ${report.sources.governance.kind}${report.sources.governance.path ? ` (${report.sources.governance.path})` : ""}`,
    `[harness-cleanup] trend samples: ${report.summary.trend.sampleCount}`,
    `[harness-cleanup] trend seed: ${report.summary.trend.isSeed ? "yes" : "no"}`,
    `[harness-cleanup] delta invalid: ${report.summary.trend.invalidDelta}`,
    `[harness-cleanup] delta pending_request: ${report.summary.trend.pendingDelta}`,
    `[harness-cleanup] delta review_decision_recorded: ${report.summary.trend.reviewDecisionRecordedDelta}`,
    `[harness-cleanup] review backlog: ${report.summary.trend.reviewDecisionBacklogCount}`,
    `[harness-cleanup] observability gap cases: ${report.summary.trend.latestObservabilityGapCaseCount}`,
    `[harness-cleanup] current observability gap cases: ${report.summary.trend.latestCurrentObservabilityGapCaseCount}`,
    `[harness-cleanup] degraded observability gap cases: ${report.summary.trend.latestDegradedObservabilityGapCaseCount}`,
    `[harness-cleanup] verification failure cases: ${report.summary.verificationOutcomes.failureCaseCount}`,
    `[harness-cleanup] current verification blocking failure cases: ${report.summary.verificationOutcomes.current?.blockingFailureCaseCount ?? 0}`,
    `[harness-cleanup] current verification advisory failure cases: ${report.summary.verificationOutcomes.current?.advisoryFailureCaseCount ?? 0}`,
    `[harness-cleanup] degraded verification blocking failure cases: ${report.summary.verificationOutcomes.degraded?.blockingFailureCaseCount ?? 0}`,
    `[harness-cleanup] verification recovered cases: ${report.summary.verificationOutcomes.recoveredCaseCount}`,
    `[harness-cleanup] doc freshness issues: ${report.summary.docFreshness.issueCount}`,
    `[harness-cleanup] active compat/deprecated/dead-candidate: ${report.summary.governance.activeByClassification.compat}/${report.summary.governance.activeByClassification.deprecated}/${report.summary.governance.activeByClassification["dead-candidate"]}`,
    `[harness-cleanup] governance violations: ${report.summary.governance.violationCount}`,
  ];

  for (const signal of report.signals) {
    lines.push(`[harness-cleanup] signal: ${signal}`);
  }

  if (report.focus.failureModes.length > 0) {
    lines.push("[harness-cleanup] top failure modes:");
    for (const entry of report.focus.failureModes) {
      lines.push(
        `  - ${entry.name}: state=${entry.state}, latest_pending=${entry.latest.pendingRequestCaseCount}, latest_invalid=${entry.latest.invalidCount}, score=${entry.score}`,
      );
    }
  }

  if (report.focus.governanceSurfaces.length > 0) {
    lines.push("[harness-cleanup] top governance surfaces:");
    for (const entry of report.focus.governanceSurfaces) {
      lines.push(
        `  - ${entry.id}: ${entry.classification}/${entry.status}, refs=${entry.referenceCount}, violations=${entry.violationCount}`,
      );
    }
  }

  if (report.focus.reviewDecisionStatuses.length > 0) {
    lines.push("[harness-cleanup] top review decision statuses:");
    for (const entry of report.focus.reviewDecisionStatuses) {
      lines.push(
        `  - ${entry.name}: state=${entry.state}, latest_case=${entry.latest.caseCount}, delta_case=${entry.delta.caseCount}, score=${entry.score}`,
      );
    }
  }

  if (report.focus.reviewRiskLevels.length > 0) {
    lines.push("[harness-cleanup] top review risk levels:");
    for (const entry of report.focus.reviewRiskLevels) {
      lines.push(
        `  - ${entry.name}: state=${entry.state}, latest_case=${entry.latest.caseCount}, delta_case=${entry.delta.caseCount}, score=${entry.score}`,
      );
    }
  }

  if (report.focus.observabilitySignals.length > 0) {
    lines.push("[harness-cleanup] top observability gaps:");
    for (const entry of report.focus.observabilitySignals) {
      lines.push(
        `  - ${entry.signal} (${entry.status}): state=${entry.state}, latest_case=${entry.latest.caseCount}, delta_case=${entry.delta.caseCount}, score=${entry.score}`,
      );
    }
  }

  if (report.focus.observabilityVerificationOutcomes.length > 0) {
    lines.push("[harness-cleanup] top observability verification outcomes:");
    for (const entry of report.focus.observabilityVerificationOutcomes) {
      lines.push(
        `  - ${entry.signal} (${entry.outcome}): state=${entry.state}, latest_case=${entry.latest.caseCount}, delta_case=${entry.delta.caseCount}, score=${entry.score}`,
      );
    }
  }

  lines.push("[harness-cleanup] observability gap role summary:");
  lines.push(
    `  - current: latest=${report.summary.trend.latestCurrentObservabilityGapCaseCount}, delta=${report.summary.trend.currentObservabilityGapCaseDelta}`,
  );
  lines.push(
    `  - degraded: latest=${report.summary.trend.latestDegradedObservabilityGapCaseCount}, delta=${report.summary.trend.degradedObservabilityGapCaseDelta}`,
  );

  if (report.focus.docFreshness.issueKinds.length > 0) {
    lines.push("[harness-cleanup] doc freshness issues:");
    for (const entry of report.focus.docFreshness.issueKinds) {
      lines.push(`  - ${entry.kind}: count=${entry.count}`);
    }
  }

  if (report.recommendations.length > 0) {
    lines.push("[harness-cleanup] recommendations:");
    for (const action of report.recommendations) {
      lines.push(`  - [${action.priority}] ${action.title}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderGeneratedSlopMarkdown(report) {
  const lines = [
    "# Lime Harness Cleanup / Slop Report",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- trend 来源：${report.sources.trend.kind}${report.sources.trend.path ? `（\`${report.sources.trend.path}\`）` : ""}`,
    `- doc freshness 来源：${report.sources.docFreshness.kind}${report.sources.docFreshness.path ? `（\`${report.sources.docFreshness.path}\`）` : ""}`,
    `- governance 来源：${report.sources.governance.kind}${report.sources.governance.path ? `（\`${report.sources.governance.path}\`）` : ""}`,
    "",
    "## 摘要",
    "",
    `- trend 样本数：${report.summary.trend.sampleCount}`,
    `- trend 是否仍为 seed：${report.summary.trend.isSeed ? "是" : "否"}`,
    `- invalid delta：${report.summary.trend.invalidDelta}`,
    `- pending request delta：${report.summary.trend.pendingDelta}`,
    `- 已记录人工审核 delta：${report.summary.trend.reviewDecisionRecordedDelta}`,
    `- 待补录人工审核 backlog：${report.summary.trend.reviewDecisionBacklogCount}`,
    `- observability gap case：${report.summary.trend.latestObservabilityGapCaseCount}`,
    `- current observability gap case：${report.summary.trend.latestCurrentObservabilityGapCaseCount}`,
    `- degraded observability gap case：${report.summary.trend.latestDegradedObservabilityGapCaseCount}`,
    `- verification failure case：${report.summary.verificationOutcomes.failureCaseCount}`,
    `- current verification blocking failure case：${report.summary.verificationOutcomes.current?.blockingFailureCaseCount ?? 0}`,
    `- current verification advisory failure case：${report.summary.verificationOutcomes.current?.advisoryFailureCaseCount ?? 0}`,
    `- degraded verification blocking failure case：${report.summary.verificationOutcomes.degraded?.blockingFailureCaseCount ?? 0}`,
    `- verification recovered case：${report.summary.verificationOutcomes.recoveredCaseCount}`,
    `- doc freshness 问题数：${report.summary.docFreshness.issueCount}`,
    `- governance 违规数：${report.summary.governance.violationCount}`,
    `- compat 活跃 surface：${report.summary.governance.activeByClassification.compat}`,
    `- deprecated 活跃 surface：${report.summary.governance.activeByClassification.deprecated}`,
    `- dead-candidate 活跃 surface：${report.summary.governance.activeByClassification["dead-candidate"]}`,
    "",
    "## 信号",
    "",
  ];

  for (const signal of report.signals) {
    lines.push(`- ${signal}`);
  }

  lines.push("");
  lines.push("## Observability Gap 角色");
  lines.push("");
  lines.push("| 角色 | latest case | delta case |");
  lines.push("| --- | --- | --- |");
  lines.push(
    `| current | ${report.summary.trend.latestCurrentObservabilityGapCaseCount} | ${report.summary.trend.currentObservabilityGapCaseDelta} |`,
  );
  lines.push(
    `| degraded | ${report.summary.trend.latestDegradedObservabilityGapCaseCount} | ${report.summary.trend.degradedObservabilityGapCaseDelta} |`,
  );

  if (report.focus.failureModes.length > 0) {
    lines.push("");
    lines.push("## Failure Mode 焦点");
    lines.push("");
    lines.push(
      "| Failure Mode | 状态 | latest case | latest invalid | latest pending_request | delta invalid | score |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const entry of report.focus.failureModes) {
      lines.push(
        `| ${entry.name} | ${entry.state} | ${entry.latest.caseCount} | ${entry.latest.invalidCount} | ${entry.latest.pendingRequestCaseCount} | ${entry.delta.invalidCount} | ${entry.score} |`,
      );
    }
  }

  if (report.focus.docFreshness.issueKinds.length > 0) {
    lines.push("");
    lines.push("## Doc Freshness 焦点");
    lines.push("");
    lines.push("| Issue Kind | Count |");
    lines.push("| --- | --- |");
    for (const entry of report.focus.docFreshness.issueKinds) {
      lines.push(`| ${entry.kind} | ${entry.count} |`);
    }
  }

  if (report.focus.governanceSurfaces.length > 0) {
    lines.push("");
    lines.push("## Governance 焦点");
    lines.push("");
    lines.push(
      "| Surface | 分类 | 状态 | 引用数 | 违规数 | 来源类型 |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const entry of report.focus.governanceSurfaces) {
      lines.push(
        `| ${entry.id} | ${entry.classification} | ${entry.status} | ${entry.referenceCount} | ${entry.violationCount} | ${entry.sourceType} |`,
      );
    }
  }

  if (report.focus.reviewDecisionStatuses.length > 0) {
    lines.push("");
    lines.push("## 人工审核状态焦点");
    lines.push("");
    lines.push(
      "| 审核状态 | 状态 | latest case | latest invalid | delta case | score |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const entry of report.focus.reviewDecisionStatuses) {
      lines.push(
        `| ${entry.name} | ${entry.state} | ${entry.latest.caseCount} | ${entry.latest.invalidCount} | ${entry.delta.caseCount} | ${entry.score} |`,
      );
    }
  }

  if (report.focus.reviewRiskLevels.length > 0) {
    lines.push("");
    lines.push("## 风险等级焦点");
    lines.push("");
    lines.push(
      "| 风险等级 | 状态 | latest case | latest invalid | delta case | score |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const entry of report.focus.reviewRiskLevels) {
      lines.push(
        `| ${entry.name} | ${entry.state} | ${entry.latest.caseCount} | ${entry.latest.invalidCount} | ${entry.delta.caseCount} | ${entry.score} |`,
      );
    }
  }

  if (report.focus.observabilitySignals.length > 0) {
    lines.push("");
    lines.push("## Observability 证据缺口");
    lines.push("");
    lines.push(
      "| Signal | 状态 | latest case | delta case | score |",
    );
    lines.push("| --- | --- | --- | --- | --- |");
    for (const entry of report.focus.observabilitySignals) {
      lines.push(
        `| ${entry.signal} | ${entry.status} | ${entry.latest.caseCount} | ${entry.delta.caseCount} | ${entry.score} |`,
      );
    }
  }

  if (report.focus.observabilityVerificationOutcomes.length > 0) {
    lines.push("");
    lines.push("## Observability Verification 焦点");
    lines.push("");
    lines.push(
      "| Signal | Outcome | latest case | delta case | score |",
    );
    lines.push("| --- | --- | --- | --- | --- |");
    for (const entry of report.focus.observabilityVerificationOutcomes) {
      lines.push(
        `| ${entry.signal} | ${entry.outcome} | ${entry.latest.caseCount} | ${entry.delta.caseCount} | ${entry.score} |`,
      );
    }
  }

  if (report.recommendations.length > 0) {
    lines.push("");
    lines.push("## 推荐动作");
    lines.push("");
    for (const action of report.recommendations) {
      lines.push(`### ${action.priority} · ${action.title}`);
      lines.push("");
      for (const rationale of action.rationale) {
        lines.push(`- ${rationale}`);
      }
      if (action.focusFailureModes.length > 0) {
        lines.push(`- 关注 failure mode：${action.focusFailureModes.join("、")}`);
      }
      if (action.focusSuiteTags.length > 0) {
        lines.push(`- 关注 suite tag：${action.focusSuiteTags.join("、")}`);
      }
      if (action.focusReviewDecisionStatuses.length > 0) {
        lines.push(
          `- 关注人工审核状态：${action.focusReviewDecisionStatuses.join("、")}`,
        );
      }
      if (action.focusReviewRiskLevels.length > 0) {
        lines.push(
          `- 关注风险等级：${action.focusReviewRiskLevels.join("、")}`,
        );
      }
      if (action.focusVerificationFailureOutcomes.length > 0) {
        lines.push(
          `- 关注 verification failure outcome：${action.focusVerificationFailureOutcomes.join("、")}`,
        );
      }
      if (action.focusVerificationRecoveredOutcomes.length > 0) {
        lines.push(
          `- 关注 verification recovered outcome：${action.focusVerificationRecoveredOutcomes.join("、")}`,
        );
      }
      if (action.focusSurfaceIds.length > 0) {
        lines.push(`- 关注 surface：${action.focusSurfaceIds.join("、")}`);
      }
      if (action.commands.length > 0) {
        lines.push("- 可直接执行的命令：");
        for (const command of action.commands) {
          lines.push(`  - \`${command}\``);
        }
      }
      if (action.backlogTools.length > 0) {
        lines.push("- 待补工具 / 条件动作：");
        for (const item of action.backlogTools) {
          lines.push(`  - ${item}`);
        }
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}
