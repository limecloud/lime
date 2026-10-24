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
import { focusBrowserTabPage, isBrowserTabHostAvailable } from "./browserTab";

describe("Browser page focus typed gateway", () => {
  beforeEach(() => {
    invoke.mockReset();
    supports.mockReset().mockReturnValue(true);
  });

  it("passes only the exact native target through the current command and validates state", async () => {
    const state = browserState();
    invoke.mockResolvedValue(state);
    expect(await focusBrowserTabPage(state)).toBe(state);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("browser_tab_focus_page", {
      tabId: state.tabId,
      viewId: state.viewId,
      webContentsId: state.webContentsId,
    });
    invoke.mockResolvedValue({ ...state, webContentsId: null });
    await expect(focusBrowserTabPage(state)).rejects.toThrow();
  });

  it("requires the focus command and propagates native errors", async () => {
    supports.mockImplementation(
      (command) => command !== "browser_tab_focus_page",
    );
    expect(isBrowserTabHostAvailable()).toBe(false);
    invoke.mockRejectedValue(new Error("stale native view"));
    await expect(focusBrowserTabPage(browserState())).rejects.toThrow(
      "stale native view",
    );
  });
});
