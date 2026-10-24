import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserState } from "@/components/agent/chat/workspace/right-surface/browser/browserWorkspace.testFixtures";

const invoke = vi.hoisted(() => vi.fn());
const supports = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: invoke,
  safeListen: vi.fn(),
}));
vi.mock("@/lib/electron-host", () => ({
  getElectronHostBridge: () => ({ listen: () => undefined }),
  isElectronDevBridgeFallbackAvailable: () => false,
  isElectronHostCommandAvailable: supports,
}));
import { isBrowserTabHostAvailable, listBrowserTabs } from "./browserTab";

const scope = { browserSessionId: "browser-session-1", threadId: "thread-1" };
describe("Browser snapshot typed gateway", () => {
  beforeEach(() => {
    invoke.mockReset();
    supports.mockReset().mockReturnValue(true);
  });

  it("preserves every native identity and permits a nonempty snapshot without a selected tab", async () => {
    const tabs = [
      browserState({ selected: false }),
      browserState({
        selected: false,
        tabId: "second",
        viewId: "view-second",
        webContentsId: 102,
      }),
    ];
    invoke.mockResolvedValue(tabs);
    expect(await listBrowserTabs(scope)).toBe(tabs);
    expect(invoke).toHaveBeenCalledWith("browser_tab_list", scope);
  });
  it("requires the snapshot command in host availability", () => {
    supports.mockImplementation((command) => command !== "browser_tab_list");
    expect(isBrowserTabHostAvailable()).toBe(false);
  });
  it.each([-1, NaN, 0.5, "1"])(
    "rejects malformed navigation revision %s",
    async (navigationRevision) => {
      invoke.mockResolvedValue([
        browserState({ navigationRevision: navigationRevision as never }),
      ]);
      await expect(listBrowserTabs(scope)).rejects.toThrow();
    },
  );
  it.each([
    { scale: NaN, bounds: { x: 0, y: 0, width: 1, height: 1 } },
    { scale: -1, bounds: { x: 0, y: 0, width: 1, height: 1 } },
    { scale: 0.5, bounds: { x: 0.5, y: 0, width: 1, height: 1 } },
    { scale: 0.5, bounds: { x: 0, y: 0, width: -1, height: 1 } },
    { scale: 0.5, bounds: null },
  ])(
    "rejects malformed native device projection %j",
    async (deviceViewport) => {
      invoke.mockResolvedValue([
        browserState({ deviceViewport: deviceViewport as never }),
      ]);
      await expect(listBrowserTabs(scope)).rejects.toThrow();
    },
  );
  it("preserves the actual native viewport, including a hidden zero-sized projection", async () => {
    const tabs = [
      browserState({
        deviceViewport: {
          scale: 0,
          bounds: { x: 1, y: 2, width: 0, height: 0 },
        },
      }),
    ];
    invoke.mockResolvedValue(tabs);
    expect(await listBrowserTabs(scope)).toBe(tabs);
  });
  it("propagates host failure rather than substituting an empty list", async () => {
    invoke.mockRejectedValue(new Error("native missing"));
    await expect(listBrowserTabs(scope)).rejects.toThrow("native missing");
  });
  it("accepts genuine empty and rejects malformed envelopes", async () => {
    invoke.mockResolvedValueOnce([]).mockResolvedValueOnce({ tabs: [] });
    expect(await listBrowserTabs(scope)).toEqual([]);
    await expect(listBrowserTabs(scope)).rejects.toThrow("array");
  });
  it.each([
    { browserSessionId: "foreign-session" },
    { threadId: "foreign-thread" },
    { windowId: 8 },
    { ownerWebContentsId: 42 },
    { webContentsId: 0 },
    { viewId: "" },
    { tabId: "" },
    { selected: true },
  ])("rejects invalid or mixed identities: %j", async (overrides) => {
    invoke.mockResolvedValue([
      browserState(),
      browserState({
        tabId: "second",
        viewId: "view-second",
        webContentsId: 102,
        selected: false,
        ...overrides,
      }),
    ]);
    await expect(listBrowserTabs(scope)).rejects.toThrow();
  });
  it.each(["tabId", "viewId", "webContentsId"] as const)(
    "rejects duplicate %s",
    async (field) => {
      const first = browserState();
      invoke.mockResolvedValue([
        first,
        browserState({
          tabId: "second",
          viewId: "view-second",
          webContentsId: 102,
          selected: false,
          [field]: first[field],
        }),
      ]);
      await expect(listBrowserTabs(scope)).rejects.toThrow(/duplicate/);
    },
  );
});
