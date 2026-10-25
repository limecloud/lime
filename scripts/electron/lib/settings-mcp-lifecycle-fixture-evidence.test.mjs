import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MCP_LIFECYCLE_REQUIRED_METHODS,
  applyPassingSettingsMcpLifecycleEvidence,
  createSettingsMcpLifecycleEvidence,
  parseSettingsMcpLifecycleFixtureArgs,
  summarizeSettingsMcpLifecycleTrace,
} from "./settings-mcp-lifecycle-fixture-evidence.mjs";
import { SETTINGS_DRAFT_FIXTURE_SOURCES } from "./settings-draft-navigation-scenario.mjs";

const RUN_ID = "standalone-settings-b-test";

function traceRaw(transport = "electron-ipc", methods = undefined) {
  return JSON.stringify(
    (methods ?? MCP_LIFECYCLE_REQUIRED_METHODS).map((method) => ({
      command: "app_server_handle_json_lines",
      transport,
      status: "success",
      args_preview: {
        request: {
          lines: [
            JSON.stringify({ jsonrpc: "2.0", id: method, method, params: {} }),
          ],
        },
      },
    })),
  );
}

function passingFacts() {
  const sources = SETTINGS_DRAFT_FIXTURE_SOURCES.map((file) => ({
    file,
    sha256: "a".repeat(64),
  }));
  return {
    completedAt: "2026-07-17T00:03:00.000Z",
    electronLaunchCount: 3,
    preloadLaunchCount: 3,
    isolatedUserData: true,
    guiCreated: true,
    guiUpdated: true,
    restartReadback: true,
    guiDeleted: true,
    finalRestartAbsent: true,
    sameServerAcrossRestarts: true,
    trace: summarizeSettingsMcpLifecycleTrace(traceRaw()),
    consoleErrors: [],
    pageErrors: [],
    invokeErrorCount: 0,
    updatedScreenshotWritten: true,
    recoveredScreenshotWritten: true,
    finalScreenshotWritten: true,
    normalMainExits: Array.from({ length: 3 }, () => ({
      exited: true,
      exitCode: 0,
      signal: null,
      mode: "normal",
      forcedCleanup: false,
    })),
    buildFreshness: { before: { ready: true }, after: { ready: true } },
    sourceManifest: { before: sources, after: structuredClone(sources) },
    mcpDraft: {
      sectionKeep: true,
      sectionDiscard: true,
      keepDefaultFocus: true,
      unpersistedDraft: true,
      sameServerIdentity: true,
      cancelKeep: true,
      cancelDiscard: true,
      readbacks: Array.from({ length: 3 }, () => ({
        method: "mcpServer/list",
        transport: "electron-ipc",
        currentPreload: true,
        matchingRequestResponse: true,
      })),
    },
  };
}

describe("Settings MCP lifecycle Gate B evidence", () => {
  it("uses the same project Gate run root", () => {
    const options = parseSettingsMcpLifecycleFixtureArgs(["--run-id", RUN_ID], {
      defaults: {
        runId: null,
        evidenceDir: null,
        prefix: "settings-mcp-lifecycle-fixture",
        timeoutMs: 120_000,
        intervalMs: 250,
        keepTemp: false,
      },
      cwd: "/repo",
    });
    expect(options.evidenceDir).toBe(
      path.join(
        "/repo",
        ".lime",
        "qc",
        "project-gates",
        RUN_ID,
        "settings-mcp-lifecycle-recovery",
      ),
    );
  });

  it("requires current list/create/update/delete methods", () => {
    expect(summarizeSettingsMcpLifecycleTrace(traceRaw())).toMatchObject({
      methods: MCP_LIFECYCLE_REQUIRED_METHODS,
      missingMethods: [],
      legacyCommands: [],
      mockFallbackHitCount: 0,
    });
  });

  it("completes only after update, restart, delete, and final restart", () => {
    const summary = createSettingsMcpLifecycleEvidence({
      candidateRunId: RUN_ID,
      startedAt: "2026-07-17T00:00:00.000Z",
      prefix: "settings-mcp-lifecycle-fixture",
    });
    applyPassingSettingsMcpLifecycleEvidence(summary, passingFacts());
    expect(summary).toMatchObject({
      result: "pass",
      settingsScenarioProof: {
        scenarioId: "mcp-lifecycle-recovery",
        complete: true,
      },
    });
  });

  it("rejects mock transport and missing final absence", () => {
    const summary = createSettingsMcpLifecycleEvidence({
      candidateRunId: RUN_ID,
      startedAt: "2026-07-17T00:00:00.000Z",
      prefix: "settings-mcp-lifecycle-fixture",
    });
    expect(() =>
      applyPassingSettingsMcpLifecycleEvidence(summary, {
        ...passingFacts(),
        finalRestartAbsent: false,
        trace: summarizeSettingsMcpLifecycleTrace(
          traceRaw("renderer-mock", ["mcp_list_servers_with_status"]),
        ),
      }),
    ).toThrow(
      /appServerElectronIpc.*allCurrentMcpLifecycleMethods.*finalRestartAbsent.*mockFallbackZero/,
    );
  });

  it.each([
    "sectionKeep",
    "sectionDiscard",
    "keepDefaultFocus",
    "unpersistedDraft",
    "sameServerIdentity",
    "cancelKeep",
    "cancelDiscard",
  ])("rejects absent MCP draft evidence: %s", (key) => {
    const facts = passingFacts();
    delete facts.mcpDraft[key];
    expect(() =>
      applyPassingSettingsMcpLifecycleEvidence(
        createSettingsMcpLifecycleEvidence({
          candidateRunId: RUN_ID,
          startedAt: "2026-10-18",
          prefix: "fixture",
        }),
        facts,
      ),
    ).toThrow(`mcpDraft.${key}`);
  });

  it("rejects server identity replacement, short process lifecycle and readback mock", () => {
    const facts = passingFacts();
    facts.sameServerAcrossRestarts = false;
    facts.normalMainExits.pop();
    facts.mcpDraft.readbacks[0].transport = "renderer-mock";
    expect(() =>
      applyPassingSettingsMcpLifecycleEvidence(
        createSettingsMcpLifecycleEvidence({
          candidateRunId: RUN_ID,
          startedAt: "2026-10-18",
          prefix: "fixture",
        }),
        facts,
      ),
    ).toThrow(
      /sameServerAcrossRestarts.*currentReadbackIdentity.*normalMainExits/,
    );
  });
});
