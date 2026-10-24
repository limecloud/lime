import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyPassingSettingsExecutionPolicyEvidence,
  createSettingsExecutionPolicyEvidence,
  parseSettingsExecutionPolicyFixtureArgs,
  summarizeSettingsExecutionPolicyTrace,
} from "./settings-execution-policy-fixture-evidence.mjs";

const RUN_ID = "standalone-settings-b-test";

function appServerEntry(method) {
  return {
    command: "app_server_handle_json_lines",
    transport: "electron-ipc",
    status: "success",
    args_preview: {
      request: {
        lines: [JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} })],
      },
    },
  };
}

function traceRaw() {
  return JSON.stringify([
    appServerEntry("config/read"),
    appServerEntry("model/list"),
    appServerEntry("config/batchWrite"),
    appServerEntry("config/batchWrite"),
    appServerEntry("config/batchWrite"),
    appServerEntry("config/batchWrite"),
  ]);
}
function errorRaw() {
  return "[]";
}

function passingFacts() {
  return {
    teardowns: [1, 2, 3].map((pid) => ({
      ok: true,
      forcedCleanup: null,
      normalMainExit: { pid, mode: "normal", exitCode: 0, signal: null },
    })),
    saveAcknowledgements: 3,
    ioRpcProof: {
      method: "config/batchWrite",
      errorCode: -32603,
      ioCauseVerified: true,
    },
    completedAt: "2026-07-17T00:03:00.000Z",
    electronLaunchCount: 3,
    preloadLaunchCount: 3,
    isolatedUserData: true,
    executionPolicyTabActive: true,
    policyControlsReady: true,
    policyInputsChanged: true,
    planInputChanged: true,
    retiredSandboxControlsAbsent: true,
    warningBypassInput: true,
    restartReadback: true,
    expectedSaveFailureVisible: true,
    expectedSaveFailureRecovered: true,
    restorationSaved: true,
    finalRestorationReadback: true,
    loadingVisible: false,
    unexpectedErrorVisible: false,
    trace: summarizeSettingsExecutionPolicyTrace({
      traceRaws: [traceRaw()],
      errorRaws: [errorRaw()],
    }),
    consoleErrors: [],
    pageErrors: [],
    changedScreenshotWritten: true,
    restartScreenshotWritten: true,
    restoredScreenshotWritten: true,
  };
}

describe("Settings Execution Policy Gate B evidence", () => {
  it.each(["planInputChanged", "retiredSandboxControlsAbsent"])(
    "rejects missing current control evidence: %s",
    (field) => {
      const summary = createSettingsExecutionPolicyEvidence({
        candidateRunId: RUN_ID,
        startedAt: "2026-07-17T00:00:00.000Z",
        prefix: "settings-execution-policy-fixture",
      });
      const facts = passingFacts();
      facts[field] = false;
      expect(() =>
        applyPassingSettingsExecutionPolicyEvidence(summary, facts),
      ).toThrow(field);
      expect(summary.result).toBe("fail");
    },
  );
  it.each(["missing", "signalled", "forced"])(
    "rejects %s exit evidence despite successful form assertions",
    (kind) => {
      const summary = createSettingsExecutionPolicyEvidence({
        candidateRunId: RUN_ID,
        startedAt: "2026-07-17T00:00:00.000Z",
        prefix: "settings-execution-policy-fixture",
      });
      const facts = passingFacts();
      if (kind === "missing") facts.teardowns.pop();
      if (kind === "signalled")
        Object.assign(facts.teardowns[0].normalMainExit, {
          exitCode: null,
          signal: "SIGKILL",
        });
      if (kind === "forced")
        Object.assign(facts.teardowns[0], { forcedCleanup: { exited: true } });
      expect(() =>
        applyPassingSettingsExecutionPolicyEvidence(summary, facts),
      ).toThrow("threeNormalMainExits");
      expect(summary.result).toBe("fail");
    },
  );
  it("uses the same project Gate run root", () => {
    const options = parseSettingsExecutionPolicyFixtureArgs(
      ["--run-id", RUN_ID],
      {
        defaults: {
          runId: null,
          evidenceDir: null,
          prefix: "settings-execution-policy-fixture",
          timeoutMs: 120_000,
          intervalMs: 250,
          keepTemp: false,
        },
        cwd: "/repo",
      },
    );
    expect(options.evidenceDir).toBe(
      path.join(
        "/repo",
        ".lime",
        "qc",
        "project-gates",
        RUN_ID,
        "settings-execution-policy-allow-deny-error",
      ),
    );
  });

  it("counts only config write requests and does not infer RPC success from IPC success", () => {
    expect(
      summarizeSettingsExecutionPolicyTrace({
        traceRaws: [traceRaw()],
        errorRaws: [errorRaw()],
      }),
    ).toMatchObject({
      appServerIpcHitCount: 6,
      methods: ["config/read", "model/list", "config/batchWrite"],
      configMethods: ["config/read", "config/batchWrite"],
      missingConfigMethods: [],
      saveRequestCount: 4,
      unexpectedHostTraceErrorCount: 0,
      unexpectedInvokeErrorCount: 0,
      legacyCommands: [],
      mockFallbackHitCount: 0,
    });
  });

  it.each(["missing-ack", "missing-io-proof"])(
    "rejects %s despite successful IPC",
    (kind) => {
      const summary = createSettingsExecutionPolicyEvidence({
        candidateRunId: RUN_ID,
        startedAt: "2026-07-17T00:00:00.000Z",
        prefix: "settings-execution-policy-fixture",
      });
      const facts = passingFacts();
      if (kind === "missing-ack") facts.saveAcknowledgements = 2;
      else facts.ioRpcProof.ioCauseVerified = false;
      expect(() =>
        applyPassingSettingsExecutionPolicyEvidence(summary, facts),
      ).toThrow(
        kind === "missing-ack"
          ? "threeAcknowledgedSaves"
          : "expectedIoRpcError",
      );
      expect(summary.result).toBe("fail");
    },
  );

  it("completes only after persistence, expected error, recovery and restore", () => {
    const summary = createSettingsExecutionPolicyEvidence({
      candidateRunId: RUN_ID,
      startedAt: "2026-07-17T00:00:00.000Z",
      prefix: "settings-execution-policy-fixture",
    });
    applyPassingSettingsExecutionPolicyEvidence(summary, passingFacts());
    expect(summary.result).toBe("pass");
    expect(summary.settingsScenarioProof).toEqual({
      scenarioId: "execution-policy-allow-deny-error",
      complete: true,
    });
    expect(summary.save).toEqual({ acknowledgementCount: 3, requestCount: 4 });
    expect(summary).not.toHaveProperty("host");
    expect(summary.expectedFailure).not.toHaveProperty("error");
  });

  it("rejects unexpected invoke errors and missing final restoration", () => {
    const summary = createSettingsExecutionPolicyEvidence({
      candidateRunId: RUN_ID,
      startedAt: "2026-07-17T00:00:00.000Z",
      prefix: "settings-execution-policy-fixture",
    });
    const unexpectedError = JSON.stringify([
      ...JSON.parse(errorRaw()),
      {
        command: "app_server_handle_json_lines",
        transport: "electron-ipc",
        error: "unexpected",
      },
    ]);
    expect(() =>
      applyPassingSettingsExecutionPolicyEvidence(summary, {
        ...passingFacts(),
        finalRestorationReadback: false,
        trace: summarizeSettingsExecutionPolicyTrace({
          traceRaws: [traceRaw()],
          errorRaws: [unexpectedError],
        }),
      }),
    ).toThrow(/finalRestorationReadback.*unexpectedInvokeErrorsZero/);
  });
});
