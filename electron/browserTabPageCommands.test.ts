import { describe, expect, it } from "vitest";
import { createHarness, mount } from "./browserTabHost.testHarness";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";

describe("Browser native page command boundary", () => {
  it("returns capture data only to the invoking owner and projects canonical state without screenshot bytes", async () => {
    const harness = createHarness();
    const mounted = (await mount(harness)) as { viewId: string };
    harness.embeddedHost.invoke.mockResolvedValueOnce({
      dataUrl: "data:image/png;base64,aGVsbG8=",
      width: 800,
      height: 600,
      copiedToClipboard: true,
    });
    const result = await harness.host.invoke(
      harness.window as never,
      "browser_tab_capture_screenshot",
      { tabId: "tab-1", copyToClipboard: true },
    );
    expect(result).toMatchObject({
      dataUrl: "data:image/png;base64,aGVsbG8=",
      state: {
        tabId: "tab-1",
        threadId: "thread-1",
        browserSessionId: "browser-session-1",
      },
    });
    expect(harness.embeddedHost.invoke).toHaveBeenLastCalledWith(
      harness.window,
      "embedded_browser_view_capture_screenshot",
      { tabId: "tab-1", viewId: mounted.viewId, copyToClipboard: true },
    );
    expect(
      harness.events
        .filter((event) => event.event === "browser-tab-state")
        .every((event) => !(event.payload as { dataUrl?: unknown }).dataUrl),
    ).toBe(true);
    await expect(
      harness.host.invoke(
        { ...harness.window, id: 88 } as never,
        "browser_tab_capture_screenshot",
        { tabId: "tab-1" },
      ),
    ).rejects.toThrow("does not belong");
  });

  it("releases Agent control without interrupting the turn before applying user device changes", async () => {
    const harness = createHarness();
    await mount(harness);
    await harness.host.executeTool({
      arguments: {
        tabId: "tab-1",
        pageRevision: 0,
        title: "Example",
        url: "https://example.com/",
      },
      callId: "claim",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "claimTab",
      turnId: "turn-1",
    });
    const interrupted: string[] = [];
    harness.host.setTurnInterruptHandler(async (threadId, turnId) => {
      interrupted.push(`${threadId}/${turnId}`);
    });
    const result = await harness.host.invoke(
      harness.window as never,
      "browser_tab_set_device",
      { tabId: "tab-1", device: null },
    );
    expect(result).toMatchObject({
      activeTurnId: null,
      controlOwner: "user",
      pageRevision: 1,
    });
    expect(interrupted).toEqual([]);
  });

  it.each([
    {
      command: "browser_tab_navigate",
      nativeCommand: "embedded_browser_view_navigate",
      args: { url: "https://example.com/user-navigation" },
    },
    {
      command: "browser_tab_set_zoom",
      nativeCommand: "embedded_browser_view_set_zoom",
      args: { zoomFactor: 1.25 },
    },
    {
      command: "browser_tab_print",
      nativeCommand: "embedded_browser_view_print",
      args: {},
    },
    {
      command: "browser_tab_reload",
      nativeCommand: "embedded_browser_view_reload",
      args: {},
    },
    {
      command: "browser_tab_set_audio_muted",
      nativeCommand: "embedded_browser_view_set_audio_muted",
      args: { muted: true },
    },
  ] as const)(
    "$command releases the page while keeping the same turn available for reclaim",
    async ({ command, nativeCommand, args }) => {
      const harness = createHarness();
      const mounted = (await mount(harness)) as { viewId: string };
      const native = harness.views.get(mounted.viewId)!;
      const identity = {
        ownerWebContentsId: 41,
        threadId: "thread-1",
        turnId: "turn-1",
      };
      await harness.host.executeTool({
        ...identity,
        tool: "claimTab",
        callId: "claim",
        arguments: {
          tabId: "tab-1",
          title: "Example",
          url: "https://example.com/",
          pageRevision: 0,
        },
      });
      await harness.host.executeTool({
        ...identity,
        tool: "observe",
        callId: "observe",
        arguments: { tabId: "tab-1" },
      });
      const interrupted: string[] = [];
      harness.host.setTurnInterruptHandler(async (threadId, turnId) => {
        interrupted.push(`${threadId}/${turnId}`);
      });
      const result = await harness.host.invoke(
        harness.window as never,
        command,
        { tabId: "tab-1", ...args },
      );
      expect(
        command === "browser_tab_print" ? result : { state: result },
      ).toMatchObject({
        state: {
          activeTurnId: null,
          controlOwner: "user",
          pageRevision: 1,
        },
      });
      expect(native.webContents.debugger.detach).toHaveBeenCalledOnce();
      expect(harness.embeddedHost.invoke).toHaveBeenLastCalledWith(
        harness.window,
        nativeCommand,
        { tabId: "tab-1", viewId: mounted.viewId, ...args },
      );
      expect(interrupted).toEqual([]);
      expect(
        await harness.host.executeTool({
          ...identity,
          tool: "claimTab",
          callId: "reclaim",
          arguments: {
            tabId: "tab-1",
            title: "Example",
            url: native.webContents.getURL(),
            pageRevision: 1,
          },
        }),
      ).toMatchObject({
        status: "completed",
        state: { activeTurnId: "turn-1", controlOwner: "agent" },
      });
      expect(interrupted).toEqual([]);
    },
  );

  it("adds canonical identity to native page shortcut events and drops stale native views", async () => {
    const harness = createHarness();
    const mounted = (await mount(harness)) as { viewId: string };
    harness.host.observeEmbeddedEvent("embedded-browser-view-command", {
      viewId: mounted.viewId,
      command: "focus-address",
    });
    expect(harness.events.at(-1)).toMatchObject({
      event: "browser-tab-command",
      payload: {
        command: "focus-address",
        tabId: "tab-1",
        threadId: "thread-1",
        browserSessionId: "browser-session-1",
        ownerWebContentsId: 41,
        windowId: 7,
      },
    });
    const count = harness.events.length;
    harness.host.observeEmbeddedEvent("embedded-browser-view-command", {
      viewId: "old-view",
      command: "find",
    });
    expect(harness.events).toHaveLength(count);
  });

  it("applies authoritative settings to Agent preflight, approved execution and native downloads", async () => {
    const harness = createHarness();
    const mounted = (await mount(harness)) as { viewId: string };
    await harness.host.executeTool({
      arguments: {
        tabId: "tab-1",
        pageRevision: 0,
        title: "Example",
        url: "https://example.com/",
      },
      callId: "claim",
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool: "claimTab",
      turnId: "turn-1",
    });
    const settings = effectiveBrowserSettings(
      {},
      {
        default_origin_policy: { downloads: "deny" },
        origins: { "blocked.example": { access: "deny" } },
      },
    );
    harness.host.setSettings(settings);
    expect(harness.embeddedHost.setSettings).toHaveBeenCalledWith(settings);
    const check = harness.embeddedHost.setAgentPermissionResolver.mock
      .calls[0]?.[0] as (
      viewId: string,
      url: string,
      action: string,
    ) => boolean;
    expect(check(mounted.viewId, "https://example.com/file", "download")).toBe(
      false,
    );
    await expect(
      harness.host.executeTool({
        arguments: { tabId: "tab-1", url: "https://blocked.example/" },
        callId: "goto",
        ownerWebContentsId: 41,
        threadId: "thread-1",
        tool: "goto",
        turnId: "turn-1",
      }),
    ).rejects.toThrow("denied for this site");
    harness.host.setSettings({ ...settings, enabled: false });
    await expect(
      harness.host.executeTool({
        arguments: {},
        callId: "tabs",
        ownerWebContentsId: 41,
        threadId: "thread-1",
        tool: "openTabs",
        turnId: "turn-1",
      }),
    ).rejects.toThrow("disabled in settings");
    // Turning off Agent control must preserve ordinary human browsing.
    expect(check(mounted.viewId, "https://example.com/file", "download")).toBe(
      true,
    );
  });

  it("adopts only App Server popup identity in the opener session and preserves background selection", async () => {
    const harness = createHarness();
    const opener = (await mount(harness)) as { viewId: string };
    const requested: unknown[] = [];
    harness.host.setPopupIdentityHandler(async (request) => {
      requested.push(request);
      return { browserSessionId: "browser-session-1", tabId: "server-popup-1" };
    });
    await harness.embeddedHost.invoke(
      harness.window,
      "embedded_browser_view_mount",
      { viewId: "popup-view-1", url: "https://popup.example/" },
    );
    const handler = harness.embeddedHost.setPopupHandler.mock.calls.at(
      -1,
    )?.[0] as (request: unknown) => Promise<void>;
    await handler({
      openerViewId: opener.viewId,
      viewId: "popup-view-1",
      url: "https://popup.example/",
      background: true,
    });
    expect(requested).toEqual([
      {
        browserSessionId: "browser-session-1",
        threadId: "thread-1",
        openerTabId: "tab-1",
        ownerWebContentsId: 41,
        url: "https://popup.example/",
        background: true,
      },
    ]);
    const result = await harness.host.invoke(
      harness.window as never,
      "browser_tab_list",
      { browserSessionId: "browser-session-1", threadId: "thread-1" },
    );
    expect(result).toMatchObject([
      { tabId: "tab-1", selected: true },
      { tabId: "server-popup-1", selected: false, viewId: "popup-view-1" },
    ]);
  });

  it("rejects a popup whose opener disappears while canonical identity is being allocated", async () => {
    const harness = createHarness();
    const opener = (await mount(harness)) as { viewId: string };
    let resolveIdentity!: (identity: {
      browserSessionId: string;
      tabId: string;
    }) => void;
    harness.host.setPopupIdentityHandler(
      () =>
        new Promise((resolve) => {
          resolveIdentity = resolve;
        }),
    );
    await harness.embeddedHost.invoke(
      harness.window,
      "embedded_browser_view_mount",
      { viewId: "popup-view-1", url: "https://popup.example/" },
    );
    const handler = harness.embeddedHost.setPopupHandler.mock.calls.at(
      -1,
    )?.[0] as (request: unknown) => Promise<void>;
    const adopt = handler({
      openerViewId: opener.viewId,
      viewId: "popup-view-1",
      url: "https://popup.example/",
      background: false,
    });
    await harness.host.invoke(harness.window as never, "browser_tab_close", {
      tabId: "tab-1",
    });
    resolveIdentity({
      browserSessionId: "browser-session-1",
      tabId: "server-popup-1",
    });
    await expect(adopt).rejects.toThrow("became stale");
  });

  it("rejects Agent execution when the authoritative settings read fails", async () => {
    const harness = createHarness();
    await mount(harness);
    harness.host.setSettingsProvider(async () => {
      throw new Error("App Server config unavailable");
    });
    await expect(
      harness.host.executeTool({
        arguments: {},
        callId: "tabs",
        ownerWebContentsId: 41,
        threadId: "thread-1",
        tool: "openTabs",
        turnId: "turn-1",
      }),
    ).rejects.toThrow("App Server config unavailable");
  });
});
