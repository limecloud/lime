import { afterEach, describe, expect, it } from "vitest";
import {
  assertRightSurfaceLifecycleEvidence,
  isRightSurfaceSelected,
  summarizeRightSurfaceLifecycleEvidence,
} from "./right-surface-lifecycle-gate-b.mjs";

describe("Right Surface active pane observation", () => {
  afterEach(() => document.body.replaceChildren());

  function renderPanes() {
    document.body.innerHTML = `
      <div data-testid="workspace-right-surface-tabs">
        <button data-testid="workspace-right-surface-tab-changes"
          aria-selected="false" aria-controls="changes-panel"></button>
        <button data-testid="workspace-right-surface-tab-browser"
          aria-selected="true" aria-controls="browser-panel"></button>
      </div>
      <div data-testid="workspace-right-surface-host" data-surface="browser">
        <div role="tabpanel" id="changes-panel" hidden></div>
        <div role="tabpanel" id="browser-panel"
          data-testid="workspace-right-surface-active-pane"></div>
      </div>`;
  }

  it("observes Browser after an earlier Changes pane remains mounted and hidden", () => {
    renderPanes();
    expect(isRightSurfaceSelected({ kind: "browser", both: true })).toBe(true);
    expect(isRightSurfaceSelected({ kind: "changes", both: true })).toBe(false);
  });

  it("observes the selected canonical Browser tab after an earlier Browser tab", () => {
    renderPanes();
    const selected = document.querySelector(
      '[data-testid="workspace-right-surface-tab-browser"]',
    );
    const earlier = selected.cloneNode(true);
    earlier.setAttribute("aria-selected", "false");
    earlier.setAttribute("aria-controls", "earlier-browser-panel");
    selected.before(earlier);
    expect(isRightSurfaceSelected({ kind: "browser", both: true })).toBe(true);
    selected.setAttribute("aria-controls", "earlier-browser-panel");
    expect(isRightSurfaceSelected({ kind: "browser", both: true })).toBe(false);
  });

  it.each(["hidden", "controls", "selection", "surface", "missing-tab"])(
    "rejects an invalid active pane association: %s",
    (defect) => {
      renderPanes();
      const active = document.getElementById("browser-panel");
      const selected = document.querySelector(
        '[data-testid="workspace-right-surface-tab-browser"]',
      );
      if (defect === "hidden") active.hidden = true;
      if (defect === "controls")
        selected.setAttribute("aria-controls", "changes-panel");
      if (defect === "selection")
        selected.setAttribute("aria-selected", "false");
      if (defect === "surface")
        active.parentElement.setAttribute("data-surface", "changes");
      if (defect === "missing-tab")
        document
          .querySelector('[data-testid="workspace-right-surface-tab-changes"]')
          .remove();
      expect(isRightSurfaceSelected({ kind: "browser", both: true })).toBe(
        false,
      );
    },
  );
});

function fixture() {
  const identity = {
    threadId: "thread-a",
    sessionId: "browser-a",
    tabId: "tab-a",
    webContentsId: 42,
    tabIds: ["tab-primary", "tab-a"],
  };
  const url = "http://127.0.0.1:4000/surface";
  const mount = {
    command: "browser_tab_mount",
    transport: "electron-ipc",
    status: "success",
  };
  return {
    traceRaw: JSON.stringify([
      { ...mount },
      { ...mount },
      { ...mount, command: "browser_tab_list" },
      { ...mount, command: "browser_tab_list" },
    ]),
    errorRaw: "[]",
    sessionId: "session-a",
    threadId: "thread-a",
    stages: {
      browserOpened: true,
      changesSelected: true,
      browserSelected: true,
      closedPrimaryRestored: true,
      browserClosed: true,
      changesClosed: true,
    },
    first: { ...identity },
    restored: { ...identity },
    nativeBefore: { alive: true, url },
    nativeAfter: { alive: true, url },
    url,
    requestObservation: {
      electron: true,
      fallback: false,
      command: "app_server_handle_json_lines",
      transport: "electron-ipc",
      status: "success",
      method: "workspaceRightSurface/request",
      requestId: "surface-request",
      responseId: "surface-request",
      params: {
        sessionId: "session-a",
        metadata: { browser: { launchUrl: url } },
      },
    },
  };
}

function verify(value) {
  return assertRightSurfaceLifecycleEvidence(
    summarizeRightSurfaceLifecycleEvidence(value),
  );
}

describe("Right Surface real Electron lifecycle oracle", () => {
  it("requires canonical request, native IPC, same resource and GUI select/close", () => {
    expect(() => verify(fixture())).not.toThrow();
  });
  it.each([
    "browserOpened",
    "changesSelected",
    "browserSelected",
    "closedPrimaryRestored",
    "browserClosed",
    "changesClosed",
  ])("rejects an unobserved GUI stage: %s", (stage) => {
    const value = fixture();
    value.stages[stage] = false;
    expect(() => verify(value)).toThrow(/stage/);
  });
  it.each(["threadId", "sessionId", "tabId", "webContentsId"])(
    "rejects resource replacement: %s",
    (key) => {
      const value = fixture();
      value.restored[key] = key === "webContentsId" ? 43 : "other";
      expect(() => verify(value)).toThrow(/resource/);
    },
  );
  it.each(["alive", "url"])("rejects stale native readback: %s", (key) => {
    const value = fixture();
    value.nativeAfter[key] = key === "alive" ? false : "http://other.invalid/";
    expect(() => verify(value)).toThrow(/resource/);
  });
  it.each([
    "missing",
    "transport",
    "status",
    "session",
    "url",
    "response",
    "electron",
    "fallback",
  ])("rejects wrong canonical request: %s", (defect) => {
    const value = fixture();
    const entry = value.requestObservation;
    if (defect === "missing") value.requestObservation = null;
    if (defect === "transport") entry.transport = "renderer-mock";
    if (defect === "status") entry.status = "error";
    if (defect === "session") entry.params.sessionId = "other";
    if (defect === "url")
      entry.params.metadata.browser.launchUrl = "http://other.invalid/";
    if (defect === "response") entry.responseId = "another-request";
    if (defect === "electron") entry.electron = false;
    if (defect === "fallback") entry.fallback = true;
    expect(() => verify(value)).toThrow(/App Server/);
  });
  it.each(["missing", "transport", "status"])(
    "rejects wrong native mount: %s",
    (defect) => {
      const value = fixture();
      const trace = JSON.parse(value.traceRaw);
      if (defect === "missing") trace.shift();
      if (defect === "transport") trace[0].transport = "renderer-mock";
      if (defect === "status") trace[0].status = "error";
      value.traceRaw = JSON.stringify(trace);
      expect(() => verify(value)).toThrow(/native Browser/);
    },
  );
  it.each(["missing", "transport", "status"])(
    "rejects wrong native snapshot: %s",
    (defect) => {
      const value = fixture();
      const trace = JSON.parse(value.traceRaw);
      if (defect === "missing") trace.splice(2, 1);
      if (defect === "transport") trace[2].transport = "renderer-mock";
      if (defect === "status") trace[2].status = "error";
      value.traceRaw = JSON.stringify(trace);
      expect(() => verify(value)).toThrow(/native Browser/);
    },
  );
  it("rejects lost or replaced live tabs", () => {
    for (const tabIds of [["tab-a"], ["other", "tab-a"], []]) {
      const value = fixture();
      value.restored.tabIds = tabIds;
      expect(() => verify(value)).toThrow(/resource/);
    }
  });
  it("rejects invoke errors", () => {
    const value = fixture();
    value.errorRaw = JSON.stringify([
      { command: "browser_tab_mount", status: "error" },
    ]);
    expect(() => verify(value)).toThrow(/invoke error/);
  });
});
