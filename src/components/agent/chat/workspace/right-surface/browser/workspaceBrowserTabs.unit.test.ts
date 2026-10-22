import { describe, expect, it } from "vitest";
import type { ThreadSidePanelTabs } from "../threadSidePanelTabs";
import { browserState } from "./browserWorkspace.testFixtures";
import { projectWorkspaceBrowserTabs } from "./workspaceBrowserTabs";

describe("canonical Browser tabs in the shared workspace", () => {
  const empty: ThreadSidePanelTabs = {
    tabs: [],
    activeTabId: null,
    open: false,
  };
  it("replaces the Browser placeholder in place and keeps canonical identities distinct", () => {
    const current: ThreadSidePanelTabs = {
      tabs: [
        { tabId: "files", kind: "files" },
        { tabId: "placeholder", kind: "browser" },
      ],
      activeTabId: "placeholder",
      open: true,
    };
    const first = browserState();
    const second = browserState({
      tabId: "second",
      viewId: "second-view",
      selected: false,
    });
    const next = projectWorkspaceBrowserTabs(current, [first, second]);
    expect(next.tabs.map((tab) => tab.tabId)).toEqual([
      "files",
      first.tabId,
      "second",
    ]);
    expect(next.activeTabId).toBe(first.tabId);
    expect(projectWorkspaceBrowserTabs(next, [first, second])).toBe(next);
  });
  it("background native pages do not open or select the workspace", () => {
    const next = projectWorkspaceBrowserTabs(empty, [
      browserState({ selected: false }),
    ]);
    expect(next.tabs).toHaveLength(1);
    expect(next.open).toBe(false);
    expect(next.activeTabId).toBeNull();
  });
  it("host selection follows Browser focus without stealing Files focus or undoing a user tab selection", () => {
    const first = browserState();
    const second = browserState({
      tabId: "second",
      viewId: "second-view",
      selected: false,
    });
    const initial = projectWorkspaceBrowserTabs(empty, [first, second]);
    const focused = { ...initial, activeTabId: first.tabId, open: true };
    const switched = [
      browserState({ selected: false }),
      { ...second, selected: true },
    ];
    expect(projectWorkspaceBrowserTabs(focused, switched).activeTabId).toBe(
      "second",
    );
    const selecting = { ...focused, activeTabId: "second" };
    expect(
      projectWorkspaceBrowserTabs(selecting, [first, second]).activeTabId,
    ).toBe("second");
    const files = {
      ...focused,
      tabs: [...focused.tabs, { tabId: "files", kind: "files" as const }],
      activeTabId: "files",
    };
    expect(projectWorkspaceBrowserTabs(files, switched).activeTabId).toBe(
      "files",
    );
  });
  it("closing the last native tab removes its workspace identity and selects the adjacent file", () => {
    const state = browserState();
    const initial = projectWorkspaceBrowserTabs(
      { ...empty, tabs: [{ tabId: "files", kind: "files" }] },
      [state],
    );
    const next = projectWorkspaceBrowserTabs(
      { ...initial, activeTabId: state.tabId, open: true },
      [],
    );
    expect(next.tabs.map((tab) => tab.tabId)).toEqual(["files"]);
    expect(next.activeTabId).toBe("files");
    expect(next.open).toBe(true);
  });
});
