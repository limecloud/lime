import path from "node:path";

export const EXECUTION_POLICY_SCENARIO_ID = "execution-policy-allow-deny-error";
export const EXECUTION_POLICY_REQUIRED_CONFIG_METHODS = [
  "config/read",
  "config/batchWrite",
];

const APP_SERVER_COMMAND = "app_server_handle_json_lines";
const LEGACY_EXECUTION_POLICY_COMMANDS = [
  "get_execution_policy",
  "save_execution_policy",
  "update_execution_policy",
  "get_agent_execution_policy",
];
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function validateName(value, label) {
  const normalized = String(value ?? "").trim();
  if (!SAFE_NAME.test(normalized)) {
    throw new Error(`invalid Settings Execution Policy ${label}`);
  }
  return normalized;
}

export function parseSettingsExecutionPolicyFixtureArgs(
  argv,
  { defaults, cwd = process.cwd() } = {},
) {
  const options = { ...defaults, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--run-id" && next) {
      options.runId = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--evidence-dir" && next) {
      options.evidenceDir = path.resolve(next.trim());
      index += 1;
      continue;
    }
    if (arg === "--prefix" && next) {
      options.prefix = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms" && next) {
      options.timeoutMs = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--interval-ms" && next) {
      options.intervalMs = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--keep-temp") {
      options.keepTemp = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 30_000) {
    throw new Error("--timeout-ms must be >= 30000");
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 100) {
    throw new Error("--interval-ms must be >= 100");
  }
  options.runId = validateName(
    options.runId ||
      `standalone-settings-execution-policy-${new Date()
        .toISOString()
        .replace(/[-:.]/g, "")}-${process.pid}`,
    "run-id",
  );
  options.prefix = validateName(options.prefix, "prefix");
  if (!options.evidenceDir) {
    options.evidenceDir = path.join(
      cwd,
      ".lime",
      "qc",
      "project-gates",
      options.runId,
      "settings-execution-policy-allow-deny-error",
    );
  }
  return options;
}

function parseArray(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appServerMethods(entries) {
  return Array.from(
    new Set(
      entries.flatMap((entry) => {
        const lines = entry?.args_preview?.request?.lines;
        if (!Array.isArray(lines)) return [];
        return lines.flatMap((line) => {
          try {
            const request = JSON.parse(String(line));
            return typeof request?.method === "string" ? [request.method] : [];
          } catch {
            return [];
          }
        });
      }),
    ),
  );
}

export function summarizeSettingsExecutionPolicyTrace({
  traceRaws,
  errorRaws,
}) {
  const traceEntries = (
    Array.isArray(traceRaws) ? traceRaws : [traceRaws]
  ).flatMap(parseArray);
  const errorEntries = (
    Array.isArray(errorRaws) ? errorRaws : [errorRaws]
  ).flatMap(parseArray);
  const appServerEntries = traceEntries.filter(
    (entry) => entry?.command === APP_SERVER_COMMAND,
  );
  const appServerIpcEntries = appServerEntries.filter(
    (entry) => entry.transport === "electron-ipc",
  );
  const configMethods = appServerMethods(appServerIpcEntries).filter((method) =>
    EXECUTION_POLICY_REQUIRED_CONFIG_METHODS.includes(method),
  );
  const commands = new Set(traceEntries.map((entry) => entry?.command));
  return {
    appServerIpcHitCount: appServerIpcEntries.length,
    methods: appServerMethods(appServerIpcEntries),
    configMethods,
    missingConfigMethods: EXECUTION_POLICY_REQUIRED_CONFIG_METHODS.filter(
      (method) => !configMethods.includes(method),
    ),
    saveRequestCount: appServerIpcEntries.filter((entry) =>
      appServerMethods([entry]).includes("config/batchWrite"),
    ).length,
    unexpectedHostTraceErrorCount: appServerEntries.filter(
      (entry) => entry.status === "error",
    ).length,
    unexpectedInvokeErrorCount: errorEntries.length,
    legacyCommands: LEGACY_EXECUTION_POLICY_COMMANDS.filter((command) =>
      commands.has(command),
    ),
    mockFallbackHitCount: appServerEntries.filter(
      (entry) => entry.transport !== "electron-ipc",
    ).length,
  };
}

export function createSettingsExecutionPolicyEvidence({
  candidateRunId,
  startedAt,
  prefix,
}) {
  return {
    schemaVersion: 1,
    scenarioId: "SETTINGS-01-execution-policy-allow-deny-error",
    priority: "P0",
    proofLevel: "Gate B-F",
    claimBoundary:
      "Real Electron Execution Policy Settings lifecycle for persisted Plan and Bash warning inputs and Host save-error recovery. It verifies removal of retired sandbox switches, cold-restart readback, a real isolated config-path EISDIR save failure with safe GUI error and a separate same-boundary JSON-RPC IO probe, failed-draft retention and Save retry, restoration, and final cold-restart readback. It does not claim RuntimeCore execution of an allowed or denied tool or Configuration defaults controls. Evidence stores no config values, rules, prompts, paths, error text, or secrets.",
    candidateRunId: validateName(candidateRunId, "run-id"),
    testOnly: true,
    startedAt,
    result: "fail",
    failureClass: "settings-execution-policy-not-completed",
    nextAction:
      "Run the real Electron Execution Policy persistence and Host error-recovery fixture.",
    settingsScenarioProof: {
      scenarioId: EXECUTION_POLICY_SCENARIO_ID,
      complete: false,
    },
    assertions: {
      total: 1,
      passed: 0,
      failed: ["notCompleted"],
      details: {},
    },
    bridge: {
      electron: false,
      preloadInvoke: false,
      transport: null,
      command: APP_SERVER_COMMAND,
      appServerIpcHitCount: 0,
      methods: [],
    },
    errors: {
      consoleErrorCount: 0,
      pageErrorCount: 0,
      invokeErrorCount: 0,
      legacyCommandHitCount: 0,
      legacyCommands: [],
      mockFallbackHitCount: 0,
    },
    artifacts: {
      changedScreenshot: `${prefix}-changed.png`,
      restartScreenshot: `${prefix}-restart.png`,
      restoredScreenshot: `${prefix}-restored.png`,
      screenshot: `${prefix}-restored.png`,
      rawEvidence: `${prefix}-raw.json`,
      summary: `${prefix}-summary.json`,
    },
  };
}

export function applyPassingSettingsExecutionPolicyEvidence(summary, facts) {
  const { trace, consoleErrors, pageErrors } = facts;
  summary.teardowns = facts.teardowns ?? [];
  const normalMainExits =
    summary.teardowns.length === 3 &&
    new Set(summary.teardowns.map((result) => result.normalMainExit?.pid))
      .size === 3 &&
    summary.teardowns.every(
      (result) =>
        result.ok === true &&
        result.forcedCleanup === null &&
        result.normalMainExit?.mode === "normal" &&
        result.normalMainExit.exitCode === 0 &&
        result.normalMainExit.signal === null,
    );
  summary.bridge = {
    electron: facts.electronLaunchCount === 3,
    preloadInvoke: facts.preloadLaunchCount === 3,
    transport: trace.appServerIpcHitCount > 0 ? "electron-ipc" : null,
    command: APP_SERVER_COMMAND,
    appServerIpcHitCount: trace.appServerIpcHitCount,
    methods: trace.methods,
  };
  summary.save = {
    acknowledgementCount: facts.saveAcknowledgements,
    requestCount: trace.saveRequestCount,
  };
  summary.lifecycle = {
    isolatedUserData: facts.isolatedUserData === true,
    policyInputsChanged: facts.policyInputsChanged === true,
    planInputChanged: facts.planInputChanged === true,
    retiredSandboxControlsAbsent: facts.retiredSandboxControlsAbsent === true,
    warningBypassInput: facts.warningBypassInput === true,
    restartReadback: facts.restartReadback === true,
    expectedSaveFailureVisible: facts.expectedSaveFailureVisible === true,
    expectedSaveFailureRecovered: facts.expectedSaveFailureRecovered === true,
    restorationSaved: facts.restorationSaved === true,
    finalRestorationReadback: facts.finalRestorationReadback === true,
  };
  summary.expectedFailure = {
    method: "config/batchWrite",
    transport: "electron-ipc",
    cause: "isolated-config-path-is-directory",
    traceErrorCount: trace.unexpectedHostTraceErrorCount,
    invokeErrorCount: trace.unexpectedInvokeErrorCount,
    rpcErrorProof: facts.ioRpcProof,
    productErrorVisible: facts.expectedSaveFailureVisible === true,
  };
  summary.errors = {
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    invokeErrorCount: trace.unexpectedInvokeErrorCount,
    unexpectedHostTraceErrorCount: trace.unexpectedHostTraceErrorCount,
    legacyCommandHitCount: trace.legacyCommands.length,
    legacyCommands: trace.legacyCommands,
    mockFallbackHitCount: trace.mockFallbackHitCount,
  };
  const checks = [
    ["threeRealElectronLaunches", summary.bridge.electron],
    ["threePreloadInvokeBridges", summary.bridge.preloadInvoke],
    ["threeNormalMainExits", normalMainExits],
    ["appServerElectronIpc", summary.bridge.appServerIpcHitCount > 0],
    ["appServerCurrentMethod", summary.bridge.methods.length > 0],
    ["configElectronIpc", trace.appServerIpcHitCount > 0],
    ["configCurrentReadWrite", trace.missingConfigMethods.length === 0],
    ["threeAcknowledgedSaves", facts.saveAcknowledgements === 3],
    ["saveRequestsObserved", trace.saveRequestCount >= 3],
    ["isolatedUserData", summary.lifecycle.isolatedUserData],
    ["executionPolicyTabActive", facts.executionPolicyTabActive === true],
    ["policyControlsReady", facts.policyControlsReady === true],
    ["policyInputsChanged", summary.lifecycle.policyInputsChanged],
    ["planInputChanged", summary.lifecycle.planInputChanged],
    [
      "retiredSandboxControlsAbsent",
      summary.lifecycle.retiredSandboxControlsAbsent,
    ],
    ["warningBypassInput", summary.lifecycle.warningBypassInput],
    ["restartReadback", summary.lifecycle.restartReadback],
    [
      "expectedIoRpcError",
      facts.ioRpcProof?.method === "config/batchWrite" &&
        Number.isInteger(facts.ioRpcProof?.errorCode) &&
        facts.ioRpcProof.errorCode < 0 &&
        facts.ioRpcProof.ioCauseVerified === true,
    ],
    [
      "expectedSaveFailureVisible",
      summary.lifecycle.expectedSaveFailureVisible,
    ],
    [
      "expectedSaveFailureRecovered",
      summary.lifecycle.expectedSaveFailureRecovered,
    ],
    ["restorationSaved", summary.lifecycle.restorationSaved],
    ["finalRestorationReadback", summary.lifecycle.finalRestorationReadback],
    ["loadingCleared", facts.loadingVisible === false],
    ["unexpectedReadErrorHidden", facts.unexpectedErrorVisible === false],
    ["consoleErrorsZero", consoleErrors.length === 0],
    ["pageErrorsZero", pageErrors.length === 0],
    ["unexpectedInvokeErrorsZero", trace.unexpectedInvokeErrorCount === 0],
    [
      "unexpectedHostTraceErrorsZero",
      trace.unexpectedHostTraceErrorCount === 0,
    ],
    ["legacyCommandsZero", trace.legacyCommands.length === 0],
    ["mockFallbackZero", trace.mockFallbackHitCount === 0],
    ["changedScreenshotWritten", facts.changedScreenshotWritten === true],
    ["restartScreenshotWritten", facts.restartScreenshotWritten === true],
    ["restoredScreenshotWritten", facts.restoredScreenshotWritten === true],
  ];
  const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(
      `SETTINGS Execution Policy evidence failed: ${failed.join(", ")}`,
    );
  }
  summary.result = "pass";
  summary.completedAt = facts.completedAt;
  summary.settingsScenarioProof.complete = true;
  summary.assertions = {
    total: checks.length,
    passed: checks.length,
    failed: [],
    details: Object.fromEntries(checks),
  };
  delete summary.failureClass;
  delete summary.nextAction;
  return summary;
}

export function applyFailedSettingsExecutionPolicyEvidence(summary, error) {
  summary.result = "fail";
  summary.settingsScenarioProof.complete = false;
  summary.assertions = {
    total: 1,
    passed: 0,
    failed: ["scenarioFailed"],
    details: {},
  };
  summary.failureClass = "settings-execution-policy-fixture";
  summary.nextAction =
    "Fix the Execution Policy current persistence/error recovery path and rerun with a new prefix.";
  summary.error = String(error instanceof Error ? error.message : error).slice(
    0,
    500,
  );
  return summary;
}
