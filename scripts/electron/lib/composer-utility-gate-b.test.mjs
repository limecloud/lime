import { describe, expect, it } from "vitest";
import {
  assertComposerUtilityEvidence,
  summarizeComposerUtilityEvidence,
} from "./composer-utility-gate-b.mjs";

function validEvidence() {
  return {
    bridge: {
      missingMethods: [],
      gitRequestsMatchRoot: true,
      mockFallbackHitCount: 0,
    },
    gui: {
      firstProject: true,
      secondProject: true,
      returnedProject: true,
      branchCreated: true,
      branchCheckedOut: true,
      coldRestore: true,
    },
    readback: { matchesGui: true },
    errors: { invokeErrorCount: 0 },
  };
}

describe("Composer Utility Gate B oracle", () => {
  function summarizeRequests(overrides = {}) {
    const rootPath = "/fixture/alpha";
    const traceRaw = JSON.stringify(
      [
        "projectGit/status",
        "project/git/branch/create",
        "projectGit/branch/checkout",
      ].map((method) => ({
        command: "app_server_handle_json_lines",
        transport: "electron-ipc",
        status: "success",
        args_preview: {
          request: {
            lines: [
              JSON.stringify({
                jsonrpc: "2.0",
                id: method,
                method,
                params: {
                  rootPath,
                  branch: "utility-gate-created",
                  ...overrides.params,
                },
              }),
            ],
          },
        },
        ...overrides.entry,
      })),
    );
    return summarizeComposerUtilityEvidence({
      traceRaw,
      errorRaw: null,
      rootPath,
      stages: validEvidence().gui,
      readbackBranch: "utility-gate-created",
    });
  }

  it("derives the complete contract from actual IPC line envelopes", () => {
    const evidence = summarizeRequests();
    expect(evidence.bridge.electronIpcHitCount).toBe(3);
    expect(() => assertComposerUtilityEvidence(evidence)).not.toThrow();
  });

  it.each([
    ["other workspace", { params: { rootPath: "/fixture/beta" } }],
    ["failed IPC", { entry: { status: "error" } }],
    ["browser mirror", { entry: { transport: "http" } }],
    ["other command", { entry: { command: "project_git_status" } }],
  ])("rejects actual trace drift: %s", (_name, overrides) => {
    expect(() =>
      assertComposerUtilityEvidence(summarizeRequests(overrides)),
    ).toThrow();
  });
  it("accepts the full GUI/IPC/Git/cold-restore contract", () => {
    expect(() => assertComposerUtilityEvidence(validEvidence())).not.toThrow();
  });
  it.each([
    [
      "missing current method",
      (e) => {
        e.bridge.missingMethods = ["projectGit/status"];
      },
    ],
    [
      "other root",
      (e) => {
        e.bridge.gitRequestsMatchRoot = false;
      },
    ],
    [
      "mock transport",
      (e) => {
        e.bridge.mockFallbackHitCount = 1;
      },
    ],
    [
      "readback drift",
      (e) => {
        e.readback.matchesGui = false;
      },
    ],
    [
      "invoke failure",
      (e) => {
        e.errors.invokeErrorCount = 1;
      },
    ],
    ...[
      "firstProject",
      "secondProject",
      "returnedProject",
      "branchCreated",
      "branchCheckedOut",
      "coldRestore",
    ].map((stage) => [
      stage,
      (e) => {
        e.gui[stage] = false;
      },
    ]),
  ])("rejects incomplete evidence: %s", (_name, mutate) => {
    const evidence = validEvidence();
    mutate(evidence);
    expect(() => assertComposerUtilityEvidence(evidence)).toThrow();
  });
});
