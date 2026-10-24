import { describe, expect, it, vi } from "vitest";
import { createHarness, mount } from "./browserTabHost.testHarness";

async function setup() {
  const harness = createHarness();
  const mounted = (await mount(harness)) as {
    viewId: string;
    webContentsId: number;
  };
  const native = harness.views.get(mounted.viewId)!;
  const focus = vi.fn();
  const getVisible = vi.fn(() => true);
  const ownerFocused = vi.fn(() => true);
  Object.assign(native.view, { getVisible });
  Object.assign(native.webContents, { focus });
  Object.assign(harness.window.webContents, { isFocused: ownerFocused });
  const target = {
    tabId: "tab-1",
    viewId: mounted.viewId,
    webContentsId: mounted.webContentsId,
  };
  return {
    ...harness,
    mounted,
    native,
    focus,
    getVisible,
    ownerFocused,
    target,
  };
}

describe("Browser page focus Desktop Host command", () => {
  it("focuses the selected attached page without taking Agent control or activating the window", async () => {
    const h = await setup();
    const claim = await h.host.executeTool({
      tool: "claimTab",
      callId: "claim",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      turnId: "turn-1",
      arguments: {
        tabId: "tab-1",
        title: "Example",
        url: "https://example.com/",
        pageRevision: 0,
      },
    });
    const result = await h.host.invoke(
      h.window as never,
      "browser_tab_focus_page",
      h.target,
    );
    expect(h.focus).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ...h.target,
      controlOwner: "agent",
      activeTurnId: "turn-1",
      pageRevision: 0,
    });
    expect(claim).toMatchObject({ status: "completed" });
    expect(h.native.webContents.debugger.detach).not.toHaveBeenCalled();
  });

  it.each(["hidden", "other-native-focus", "unselected", "detached"] as const)(
    "does not steal focus when the target is %s",
    async (reason) => {
      const h = await setup();
      if (reason === "hidden") h.getVisible.mockReturnValue(false);
      if (reason === "other-native-focus")
        h.ownerFocused.mockReturnValue(false);
      if (reason === "unselected") await mount(h, { tabId: "second" });
      if (reason === "detached")
        Object.defineProperty(h.window.contentView, "children", {
          get: () => [],
        });
      await h.host.invoke(
        h.window as never,
        "browser_tab_focus_page",
        h.target,
      );
      expect(h.focus).not.toHaveBeenCalled();
    },
  );

  it.each([
    { viewId: "old-view" },
    { webContentsId: 999 },
    { webContentsId: "100" },
    { viewId: "" },
  ])("rejects stale or malformed native identity %j", async (identity) => {
    const h = await setup();
    await expect(
      h.host.invoke(h.window as never, "browser_tab_focus_page", {
        ...h.target,
        ...identity,
      }),
    ).rejects.toThrow();
    expect(h.focus).not.toHaveBeenCalled();
  });

  it("rejects a different window owner", async () => {
    const h = await setup();
    await expect(
      h.host.invoke(
        { ...h.window, id: 88 } as never,
        "browser_tab_focus_page",
        h.target,
      ),
    ).rejects.toThrow("does not belong");
    expect(h.focus).not.toHaveBeenCalled();
  });
});
