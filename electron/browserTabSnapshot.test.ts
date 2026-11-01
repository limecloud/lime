import { describe, expect, it } from "vitest";
import { createHarness, mount } from "./browserTabHost.testHarness";
import { isBrowserTabCommand } from "./browserTabCommands";
import { resolveBrowserTabOwnerWindow } from "./browserTabSnapshot";

const scope = { browserSessionId: "browser-session-1", threadId: "thread-1" };

describe("Browser live tab snapshot", () => {
  it("reads through the exact renderer sender window", async () => {
    const h = createHarness();
    const primary = await mount(h);
    const window = resolveBrowserTabOwnerWindow(
      h.window,
      h.window.webContents.id,
    );
    expect(
      await h.host.invoke(window as never, "browser_tab_list", scope),
    ).toEqual([primary]);
  });

  it.each(["unknown sender", "child WebContents"])(
    "rejects %s without falling back to the main window or returning empty",
    async (kind) => {
      const h = createHarness();
      await mount(h);
      const window = resolveBrowserTabOwnerWindow(
        kind === "unknown sender" ? null : h.window,
        h.window.webContents.id + 1,
      );
      await expect(
        h.host.invoke(window as never, "browser_tab_list", scope),
      ).rejects.toThrow("owner window is unavailable");
      expect(h.views.size).toBe(1);
    },
  );

  it("registers the native command and reads all live identities without commands or events", async () => {
    const h = createHarness();
    const primary = await mount(h);
    const secondary = await mount(h, {
      tabId: "tab-2",
      url: "https://example.com/two",
    });
    const commands = h.embeddedHost.invoke.mock.calls.length;
    const events = h.events.length;
    expect(isBrowserTabCommand("browser_tab_list")).toBe(true);
    expect(
      await h.host.invoke(h.window as never, "browser_tab_list", scope),
    ).toEqual([{ ...(primary as object), selected: false }, secondary]);
    expect(h.embeddedHost.invoke).toHaveBeenCalledTimes(commands);
    expect(h.events).toHaveLength(events);
  });

  it("does not revive a closed primary", async () => {
    const h = createHarness();
    await mount(h);
    const secondary = await mount(h, { tabId: "tab-2" });
    await h.host.invoke(h.window as never, "browser_tab_close", {
      tabId: "tab-1",
    });
    expect(
      await h.host.invoke(h.window as never, "browser_tab_list", scope),
    ).toEqual([secondary]);
    expect(h.views.size).toBe(1);
  });

  it.each([
    ["session", { browserSessionId: "foreign-session" }],
    ["thread", { threadId: "foreign-thread" }],
    ["supplied window", { windowId: 999 }],
    ["supplied owner", { ownerWebContentsId: 999 }],
  ])(
    "rejects a mismatched %s instead of reporting empty",
    async (_name, overrides) => {
      const h = createHarness();
      await mount(h);
      await expect(
        h.host.invoke(h.window as never, "browser_tab_list", {
          ...scope,
          ...overrides,
        }),
      ).rejects.toThrow(/scope|actor/);
    },
  );

  it.each([
    { id: 8, webContents: { id: 41 } },
    { id: 7, webContents: { id: 42 } },
  ])("derives the actor from the real sender", async (actor) => {
    const h = createHarness();
    await mount(h);
    await expect(
      h.host.invoke(
        { ...h.window, ...actor } as never,
        "browser_tab_list",
        scope,
      ),
    ).rejects.toThrow(/scope/);
  });

  it("returns genuinely empty but propagates missing native resources", async () => {
    const h = createHarness();
    expect(
      await h.host.invoke(h.window as never, "browser_tab_list", scope),
    ).toEqual([]);
    await mount(h);
    h.views.clear();
    await expect(
      h.host.invoke(h.window as never, "browser_tab_list", scope),
    ).rejects.toThrow();
  });

  it("commits one selected identity before awaited bounds can expose an intermediate snapshot", async () => {
    const h = createHarness();
    await mount(h);
    await mount(h, { tabId: "tab-2" });
    let finish!: () => void;
    const blocking = new Promise<void>((resolve) => {
      finish = resolve;
    });
    h.embeddedHost.invoke.mockImplementationOnce(async () => {
      await blocking;
      return {};
    });
    const selecting = h.host.invoke(h.window as never, "browser_tab_select", {
      tabId: "tab-1",
    });
    const tabs = (await h.host.invoke(
      h.window as never,
      "browser_tab_list",
      scope,
    )) as Array<{ tabId: string; selected: boolean }>;
    expect(tabs.filter((tab) => tab.selected).map((tab) => tab.tabId)).toEqual([
      "tab-1",
    ]);
    finish();
    await selecting;
  });

  it("can create a selected tab invisibly until its current workspace restores bounds", async () => {
    const h = createHarness();
    await mount(h, { visible: false });
    expect(
      h.embeddedHost.invoke.mock.calls.map((call) => call[2]?.visible),
    ).toEqual([false, false]);
    const tabs = (await h.host.invoke(
      h.window as never,
      "browser_tab_list",
      scope,
    )) as Array<{ selected: boolean }>;
    expect(tabs[0].selected).toBe(true);
  });
});
