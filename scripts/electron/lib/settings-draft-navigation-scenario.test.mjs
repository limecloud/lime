import { describe, expect, it } from "vitest";
import {
  SETTINGS_DRAFT_FIXTURE_SOURCES,
  observeSettingsDraftReadback,
  settingsDraftNativeChecks,
  settingsDraftNavigationChecks,
  summarizeSettingsDraftProof,
} from "./settings-draft-navigation-scenario.mjs";

const observation = {
  electron: true,
  fallback: false,
  command: "app_server_handle_json_lines",
  transport: "electron-ipc",
  status: "success",
  method: "mcpServer/list",
  requestId: "isolated-request",
  responseId: "isolated-request",
  params: { private: "must-not-survive" },
};
const readback = {
  method: "mcpServer/list",
  transport: "electron-ipc",
  currentPreload: true,
  matchingRequestResponse: true,
};

describe("settings draft native proof boundary", () => {
  it("retains only current response identity booleans", () => {
    const proof = observeSettingsDraftReadback(
      { ipcObservation: observation, result: { private: "must-not-survive" } },
      "mcpServer/list",
    );
    expect(proof).toEqual(readback);
    expect(JSON.stringify(proof)).not.toContain("isolated-request");
    expect(JSON.stringify(proof)).not.toContain("must-not-survive");
  });

  it.each([
    { responseId: "another-request" },
    { requestId: "", responseId: "" },
    { electron: false },
    { fallback: true },
    { transport: "renderer-mock" },
    { status: "error" },
    { command: "legacy" },
    { method: "config/batchWrite" },
  ])("rejects noncanonical readback identity %j", (patch) => {
    expect(() =>
      observeSettingsDraftReadback(
        { ipcObservation: { ...observation, ...patch } },
        "mcpServer/list",
      ),
    ).toThrow(/current preload IPC/);
  });

  it("rejects absent facts and fewer than three verified readbacks", () => {
    expect(
      settingsDraftNavigationChecks("mcp", {}).every(([, value]) => !value),
    ).toBe(true);
    expect(
      settingsDraftNavigationChecks("mcp", {
        readbacks: [{ ...readback, method: "mcpServer/list" }],
      }),
    ).toContainEqual(["mcpDraft.currentReadbackIdentity", false]);
    expect(() => settingsDraftNavigationChecks("other", {})).toThrow(
      /known draft/,
    );
  });

  it("removes unknown credential-bearing keys from proof serialization", () => {
    const proof = summarizeSettingsDraftProof("mcp", {
      secret: "must-not-survive",
      readbacks: [
        { ...readback, params: "must-not-survive", requestId: "private-id" },
      ],
    });
    expect(proof).not.toHaveProperty("secret");
    expect(proof.readbacks).toEqual([readback]);
    expect(JSON.stringify(proof)).not.toMatch(/must-not-survive|private-id/);
  });

  it("rejects normal-exit substitutions, stale builds, source drift and omission", () => {
    const before = SETTINGS_DRAFT_FIXTURE_SOURCES.map((file) => ({
      file,
      sha256: "a".repeat(64),
    }));
    const facts = {
      normalMainExits: [
        {
          exited: true,
          exitCode: 0,
          signal: null,
          mode: "normal",
          forcedCleanup: false,
        },
      ],
      buildFreshness: { before: { ready: true }, after: { ready: true } },
      sourceManifest: { before, after: structuredClone(before) },
    };
    expect(
      settingsDraftNativeChecks(facts, 1).every(([, value]) => value),
    ).toBe(true);
    for (const patch of [
      { forcedCleanup: true },
      { exitCode: 1 },
      { signal: "SIGKILL" },
      { mode: "forced" },
      { exited: false },
    ]) {
      expect(
        settingsDraftNativeChecks(
          {
            ...facts,
            normalMainExits: [{ ...facts.normalMainExits[0], ...patch }],
          },
          1,
        ),
      ).toContainEqual(["normalMainExits", false]);
    }
    expect(settingsDraftNativeChecks(facts, 3)).toContainEqual([
      "normalMainExits",
      false,
    ]);
    expect(
      settingsDraftNativeChecks(
        {
          ...facts,
          buildFreshness: { before: { ready: true }, after: { ready: false } },
        },
        1,
      ),
    ).toContainEqual(["buildFreshnessBeforeAfter", false]);
    expect(
      settingsDraftNativeChecks(
        { ...facts, sourceManifest: { before, after: before.slice(1) } },
        1,
      ),
    ).toContainEqual(["declaredSourcesStable", false]);
    const changed = structuredClone(before);
    changed[0].sha256 = "b".repeat(64);
    expect(
      settingsDraftNativeChecks(
        { ...facts, sourceManifest: { before, after: changed } },
        1,
      ),
    ).toContainEqual(["declaredSourcesStable", false]);
    expect(
      before.some((item) =>
        item.file.endsWith("settings-draft-navigation-scenario.mjs"),
      ),
    ).toBe(true);
  });
});
