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
    readyRateDelta: normalizeNumber(delta.readyRate),
    signals: Array.isArray(trendReport?.signals) ? trendReport.signals : [],
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
  recommendations.push(action);
}

function buildRecommendations({
  trendSummary,
  focusFailureModes,
  focusSuiteTags,
  focusReviewDecisionStatuses,
  focusReviewRiskLevels,
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
  const topGovernanceSurfaceIds = governanceSurfaces
    .filter((entry) => entry.active && entry.classification !== "current")
    .slice(0, 3)
    .map((entry) => entry.id);

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
      focusSurfaceIds: [],
    });
  }

  const hasTrendPressure =
    trendSummary.invalidDelta > 0 ||
    trendSummary.pendingDelta > 0 ||
    trendSummary.needsReviewDelta > 0 ||
    focusFailureModes.some((entry) => entry.state !== "stable");

  if (hasTrendPressure) {
    maybePushRecommendation(recommendations, {
      id: "replay-and-smoke-follow-up",
      priority: "P1",
      title: "把高风险 failure mode 回挂到 replay / smoke 验证",
      rationale: [
        `当前 failure mode 焦点：${topFailureModes.join("、") || "暂无"}。`,
        "先用 replay / eval 固化失败，再按受影响主路径补最小 smoke，而不是直接凭印象清理。",
      ],
      commands: ["npm run harness:eval", "npm run harness:eval:trend"],
      backlogTools: ["按受影响主路径追加 `npm run verify:gui-smoke` 或专项 smoke"],
      focusFailureModes: topFailureModes,
      focusSuiteTags: topSuiteTags,
      focusReviewDecisionStatuses: topReviewDecisionStatuses,
      focusReviewRiskLevels: topReviewRiskLevels,
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
      focusSurfaceIds: topGovernanceSurfaceIds,
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
  const governanceSurfaces = buildGovernanceSurfaceEntries(governanceReport);
  const governanceSummary = buildGovernanceSummary(
    governanceReport,
    governanceSurfaces,
  );
  const recommendations = buildRecommendations({
    trendSummary,
    focusFailureModes,
    focusSuiteTags,
    focusReviewDecisionStatuses,
    focusReviewRiskLevels,
    docFreshnessSummary,
    docFreshnessFocus,
    governanceSummary,
    governanceSurfaces,
  });

  return {
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
    ],
    focus: {
      failureModes: focusFailureModes.slice(0, 5),
      suiteTags: focusSuiteTags.slice(0, 5),
      reviewDecisionStatuses: focusReviewDecisionStatuses.slice(0, 5),
      reviewRiskLevels: focusReviewRiskLevels.slice(0, 5),
      docFreshness: docFreshnessFocus,
      governanceSurfaces: governanceSurfaces
        .filter((entry) => entry.active && entry.classification !== "current")
        .slice(0, 5),
    },
    recommendations,
  };
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
