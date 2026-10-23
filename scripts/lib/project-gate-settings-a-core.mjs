export const SETTINGS_GATE_A_VIEWPORTS = Object.freeze([
  { label: "desktop", width: 1440, height: 1000 },
  { label: "compact", width: 1024, height: 820 },
  { label: "narrow", width: 640, height: 780 },
]);

export const SETTINGS_GATE_A_LOCALES = Object.freeze([
  "zh-CN",
  "zh-TW",
  "en-US",
  "ja-JP",
  "ko-KR",
]);

export const SETTINGS_GATE_A_TABS = Object.freeze([
  "general",
  "appearance",
  "archived-conversations",
  "voice",
  "storage",
  "memory",
  "keyboard-shortcuts",
  "providers",
  "media-services",
  "browser-use",
  "environment",
  "git",
  "worktrees",
  "profile",
  "stats",
  "skills",
  "mcp-server",
  "web-search",
  "execution-policy",
  "developer",
  "about",
]);

export const SETTINGS_GATE_A_CRITICAL_TABS = Object.freeze([
  "general",
  "appearance",
  "providers",
  "mcp-server",
  "execution-policy",
  "about",
]);

export const SETTINGS_GATE_A_STATE_REQUIREMENTS = Object.freeze([
  {
    state: "loading",
    testId: "settings-archived-conversations-loading",
    role: "status",
    ariaBusy: true,
    retryVisible: false,
    fixtureOutcome: "pending",
  },
  {
    state: "empty",
    testId: "settings-archived-conversations-empty",
    role: "status",
    ariaBusy: false,
    retryVisible: false,
    fixtureOutcome: "empty-list",
  },
  {
    state: "error",
    testId: "settings-archived-conversations-error",
    role: "alert",
    ariaBusy: false,
    retryVisible: true,
    fixtureOutcome: "rpc-error",
  },
]);

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function validateSettingsGateARunId(runId) {
  if (!RUN_ID_PATTERN.test(runId ?? "")) {
    throw new Error("invalid project Gate run-id");
  }
  return runId;
}

function buildStateCoverage(stateObservations, screenshots) {
  const checks = Object.fromEntries(
    SETTINGS_GATE_A_STATE_REQUIREMENTS.map((requirement) => {
      const observation = stateObservations.find(
        (entry) => entry.state === requirement.state,
      );
      const passed = Boolean(
        observation &&
        observation.tab === "archived-conversations" &&
        observation.viewport === "desktop" &&
        observation.locale === "zh-CN" &&
        observation.fixtureMethod === "thread/list" &&
        observation.fixtureOutcome === requirement.fixtureOutcome &&
        observation.testOnly === true &&
        observation.testId === requirement.testId &&
        observation.visible === true &&
        observation.contentHasText === true &&
        observation.role === requirement.role &&
        observation.ariaBusy === requirement.ariaBusy &&
        observation.retryVisible === requirement.retryVisible &&
        observation.rawTranslationKeyCount === 0 &&
        observation.documentOverflow === false &&
        typeof observation.screenshot === "string" &&
        screenshots.includes(observation.screenshot),
      );
      return [requirement.state, passed];
    }),
  );
  const missing = SETTINGS_GATE_A_STATE_REQUIREMENTS.filter(
    (requirement) => !checks[requirement.state],
  ).map((requirement) => `${requirement.state} component-state evidence`);

  return {
    complete: missing.length === 0,
    missing,
    checks,
    observations: stateObservations,
  };
}

export function buildSettingsGateAEvidence({
  candidateRunId,
  startedAt,
  completedAt,
  observations,
  screenshots,
  consoleErrors = [],
  pageErrors = [],
  navigationRecovered = false,
  stateObservations = [],
}) {
  validateSettingsGateARunId(candidateRunId);
  const stateCoverage = buildStateCoverage(stateObservations, screenshots);
  const observationKeys = new Set(
    observations.map(
      (entry) => `${entry.viewport}:${entry.locale}:${entry.tab}`,
    ),
  );
  const baselineKeys = SETTINGS_GATE_A_VIEWPORTS.flatMap((viewport) =>
    SETTINGS_GATE_A_TABS.map((tab) => `${viewport.label}:zh-CN:${tab}`),
  );
  const localeKeys = SETTINGS_GATE_A_LOCALES.flatMap((locale) =>
    SETTINGS_GATE_A_CRITICAL_TABS.map((tab) => `desktop:${locale}:${tab}`),
  );
  const runtimeChecks = {
    baselineViewportMatrixComplete: baselineKeys.every((key) =>
      observationKeys.has(key),
    ),
    criticalLocaleMatrixComplete: localeKeys.every((key) =>
      observationKeys.has(key),
    ),
    settingsMounted: observations.every((entry) => entry.settingsMounted),
    activeTabBound: observations.every((entry) => entry.activeTabBound),
    contentVisible: observations.every((entry) => entry.contentVisible),
    contentHasText: observations.every((entry) => entry.contentHasText),
    documentLocaleBound: observations.every(
      (entry) => entry.documentLocaleBound,
    ),
    noRawTranslationKeys: observations.every(
      (entry) => entry.rawTranslationKeyCount === 0,
    ),
    noProblemText: observations.every((entry) => entry.problemTextCount === 0),
    noVisibleLoadingState: observations.every(
      (entry) => entry.visibleLoadingCount === 0,
    ),
    noViewportOverflow: observations.every((entry) => !entry.documentOverflow),
    navigationVisible: observations.every((entry) => entry.navigationVisible),
    noInvokeErrors: observations.every((entry) => entry.invokeErrorCount === 0),
    navigationRecovered,
    noConsoleErrors: consoleErrors.length === 0,
    noPageErrors: pageErrors.length === 0,
    screenshotsCaptured:
      screenshots.length >=
      SETTINGS_GATE_A_VIEWPORTS.length + SETTINGS_GATE_A_LOCALES.length - 1,
    componentStateCoverageComplete: stateCoverage.complete,
  };
  const failed = Object.entries(runtimeChecks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const runtimePass = failed.length === 0;
  const proofComplete = runtimePass && stateCoverage.complete === true;
  const missingScenarios = proofComplete
    ? []
    : Array.from(
        new Set([
          ...(stateCoverage.missing ?? []),
          ...(!runtimePass
            ? failed.filter((name) => name !== "componentStateCoverageComplete")
            : []),
        ]),
      );
  const assertions = {
    total: Object.keys(runtimeChecks).length,
    passed: Object.values(runtimeChecks).filter(Boolean).length,
    failed,
    details: runtimeChecks,
  };

  return {
    schemaVersion: 1,
    scenarioId: "SETTINGS-01-gate-a",
    priority: "P0",
    proofLevel: "Gate A",
    claimBoundary:
      "Browser/Renderer projection through the development DevBridge. No Electron main/preload/IPC, App Server runtime identity, live-provider, packaged-app, or platform claim.",
    candidateRunId,
    testOnly: true,
    startedAt,
    completedAt,
    result: runtimePass ? "pass" : "fail",
    failureClass: runtimePass ? null : "gate-a-renderer-projection",
    nextAction: runtimePass
      ? null
      : "Fix the failing Settings projection assertion and rerun the complete matrix.",
    surfaceProof: {
      surfaceId: "SETTINGS-01",
      proof: "gate-a",
      complete: proofComplete,
    },
    missingScenarios,
    coverage: {
      viewports: SETTINGS_GATE_A_VIEWPORTS,
      locales: SETTINGS_GATE_A_LOCALES,
      primaryTabs: SETTINGS_GATE_A_TABS,
      criticalLocaleTabs: SETTINGS_GATE_A_CRITICAL_TABS,
      observationCount: observations.length,
      stateCoverage,
    },
    assertions,
    errors: {
      console: consoleErrors,
      page: pageErrors,
    },
    observations,
    artifacts: {
      summary: "summary.json",
      screenshots,
    },
  };
}
