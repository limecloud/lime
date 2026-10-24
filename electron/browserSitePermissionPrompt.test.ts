import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness, mount } from "./browserTabHost.testHarness";
import { BrowserSitePermissionPrompt } from "./browserSitePermissionPrompt";
import { sitePermissionText } from "./browserSitePermissionText";
import type { BrowserMenuPresentation } from "./browserOverlayModel";

const overlay = vi.hoisted(() => ({
  show: vi.fn(),
  emit: null as null | ((event: Record<string, unknown>) => void),
}));
vi.mock("./browserOverlayHost", () => ({
  BrowserOverlayHost: class {
    constructor(emit: typeof overlay.emit) {
      overlay.emit = emit;
    }
    show = overlay.show;
    hide = vi.fn();
    hideMenu = vi.fn();
    hideWindow = vi.fn();
    restack = vi.fn();
    dispose = vi.fn();
  },
}));

describe("user site permissions on the canonical BrowserTabHost", () => {
  beforeEach(() => overlay.show.mockReset());
  it("asks the user without requiring an Agent turn", async () => {
    overlay.show.mockResolvedValue({ visible: true, generation: 1 });
    const harness = createHarness();
    const mounted = (await mount(harness)) as { viewId: string };
    harness.host.observeEmbeddedEvent(
      "embedded-browser-view-permission-request",
      {
        viewId: mounted.viewId,
        requestId: "permission-user",
        permission: "midi",
        url: "https://example.com/",
        requestingUrl: "https://example.com/",
        embeddingOrigin: null,
        isMainFrame: true,
        decision: "pending",
      },
    );
    await Promise.resolve();
    expect(harness.embeddedHost.resolvePermission).not.toHaveBeenCalled();
    expect(overlay.show).toHaveBeenCalledOnce();
    expect(
      harness.events.some(
        (entry) => entry.event === "browser-tab-permission-request",
      ),
    ).toBe(false);
    const presentation = overlay.show.mock.calls.at(-1)?.[2];
    expect(presentation.confirmation.description).toContain(
      "https://example.com",
    );
    overlay.emit?.({
      viewId: mounted.viewId,
      menuId: presentation.menuId,
      generation: 1,
      itemId: "confirm",
      reason: "action",
    });
    expect(harness.embeddedHost.resolvePermission).toHaveBeenCalledWith(
      "permission-user",
      true,
      mounted.viewId,
    );
  });

  it("retains document grants across ordinary title/loading projections", async () => {
    const harness = createHarness();
    const mounted = (await mount(harness)) as { viewId: string };
    harness.embeddedHost.revokePermissionGrants.mockClear();
    harness.host.observeEmbeddedEvent("embedded-browser-view-state", {
      viewId: mounted.viewId,
      title: "Updated title",
      url: "https://example.com/",
      isLoading: true,
      zoomFactor: 1,
      find: null,
      error: null,
      canGoBack: false,
      canGoForward: false,
    });
    expect(harness.embeddedHost.revokePermissionGrants).not.toHaveBeenCalled();
    await harness.host.executeTool({
      tool: "releaseTab",
      arguments: { tabId: "tab-1" },
      callId: "release",
      threadId: "thread-1",
      turnId: "turn",
      ownerWebContentsId: 41,
    });
    expect(harness.embeddedHost.revokePermissionGrants).toHaveBeenCalledWith(
      mounted.viewId,
    );
  });

  it("keeps Agent requests on the existing turn-scoped grant approval", async () => {
    const harness = createHarness();
    const mounted = (await mount(harness)) as { viewId: string };
    await harness.host.executeTool({
      tool: "claimTab",
      arguments: {
        tabId: "tab-1",
        pageRevision: 0,
        title: "Example",
        url: "https://example.com/",
      },
      callId: "claim",
      threadId: "thread-1",
      turnId: "turn-1",
      ownerWebContentsId: 41,
    });
    harness.host.observeEmbeddedEvent(
      "embedded-browser-view-permission-request",
      {
        viewId: mounted.viewId,
        requestId: "agent-midi",
        permission: "midi",
        isMainFrame: true,
        url: "https://example.com/",
        requestingUrl: "https://example.com/",
        decision: "pending",
      },
    );
    expect(overlay.show).not.toHaveBeenCalled();
    expect(harness.embeddedHost.resolvePermission).not.toHaveBeenCalled();
    const result = await harness.host.executeTool({
      tool: "grantPermission",
      arguments: {
        tabId: "tab-1",
        requestId: "agent-midi",
        permission: "midi",
      },
      callId: "grant",
      threadId: "thread-1",
      turnId: "turn-1",
      ownerWebContentsId: 41,
    });
    expect(result.status).toBe("approval_required");
    harness.embeddedHost.revokePermissionGrants.mockClear();
    harness.host.turnEnded("thread-1", "turn-1");
    expect(harness.embeddedHost.revokePermissionGrants).toHaveBeenCalledWith(
      mounted.viewId,
    );
  });

  it("revokes a user prompt on settings changes without granting it", async () => {
    const harness = createHarness();
    overlay.show.mockResolvedValue({ visible: true, generation: 1 });
    const mounted = (await mount(harness)) as { viewId: string };
    harness.host.observeEmbeddedEvent(
      "embedded-browser-view-permission-request",
      {
        viewId: mounted.viewId,
        requestId: "pending-user",
        permission: "midi",
        isMainFrame: true,
        url: "https://example.com/",
        requestingUrl: "https://example.com/",
        decision: "pending",
      },
    );
    const { effectiveBrowserSettings } =
      await import("../src/lib/api/browserSettingsTypes");
    harness.host.setSettings(effectiveBrowserSettings({ enabled: false }));
    expect(harness.embeddedHost.resolvePermission).toHaveBeenCalledWith(
      "pending-user",
      false,
      mounted.viewId,
    );
    overlay.show.mockClear();
    harness.host.observeEmbeddedEvent(
      "embedded-browser-view-permission-request",
      {
        viewId: mounted.viewId,
        requestId: "disabled-user",
        permission: "midi",
        isMainFrame: true,
        url: "https://example.com/",
        requestingUrl: "https://example.com/",
        decision: "pending",
      },
    );
    expect(overlay.show).not.toHaveBeenCalled();
    expect(harness.embeddedHost.resolvePermission).toHaveBeenCalledWith(
      "disabled-user",
      false,
      mounted.viewId,
    );
  });
});

function promptFixture() {
  const completions: (() => void)[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const frame = {
    url: "https://example.com/",
    detached: false,
    processId: 1,
    routingId: 1,
    get framesInSubtree(): unknown[] {
      return [this];
    },
  };
  const wc = {
    isDestroyed: () => false,
    mainFrame: frame,
    getURL: () => frame.url,
    on: (event: string, fn: () => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(fn);
      listeners.set(event, set);
    },
    off: (event: string, fn: () => void) => listeners.get(event)?.delete(fn),
  };
  let visible = true;
  const view = { webContents: wc, getVisible: () => visible };
  const target = {
    selected: true,
    controlOwner: "user",
    activeTurnId: null as string | null,
    pageRevision: 1,
    window: { isDestroyed: () => false, contentView: { children: [view] } },
    view,
  };
  const overlay = {
    show: vi.fn(
      (
        _window: unknown,
        _viewId: string,
        presentation: BrowserMenuPresentation,
        _wc: unknown,
      ) =>
        new Promise<{ visible: boolean; generation: number; menuId: string }>(
          (resolve) => {
            const generation = 4 + completions.length;
            completions.push(() =>
              resolve({
                visible: true,
                generation,
                menuId: presentation.menuId,
              }),
            );
          },
        ),
    ),
    hideMenu: vi.fn(),
  };
  const resolve = vi.fn(() => true);
  const prompt = new BrowserSitePermissionPrompt({
    overlay: overlay as never,
    target: () => target as never,
    resolve,
  });
  const request = (
    requestId = "request",
    overrides: Record<string, unknown> = {},
  ) =>
    prompt.request("view", {
      requestId,
      permission: "midi",
      isMainFrame: true,
      url: frame.url,
      requestingUrl: frame.url,
      embeddingOrigin: null,
      ...overrides,
    });
  const action = (
    itemId = "confirm",
    generation = 3 + completions.length,
    menuId = overlay.show.mock.calls.at(-1)?.[2]?.menuId,
  ) =>
    prompt.handle({
      viewId: "view",
      menuId: menuId!,
      generation,
      itemId,
      reason: "action",
    });
  const emit = (event: string) => {
    for (const fn of listeners.get(event) ?? []) fn();
  };
  return {
    target,
    overlay,
    resolve,
    prompt,
    request,
    action,
    emit,
    frame,
    complete: (index = completions.length - 1) => completions[index](),
    hide: () => {
      visible = false;
    },
  };
}

describe("trusted user permission prompt lifecycle", () => {
  it.each(["cancel", "confirm"])(
    "settles %s exactly once before a late show receipt",
    async (item) => {
      const f = promptFixture();
      f.request();
      const menuId = f.overlay.show.mock.calls[0][2].menuId;
      f.action(item);
      f.action(item);
      f.prompt.handle({
        viewId: "view",
        menuId,
        generation: 4,
        reason: "action",
      });
      f.complete();
      await Promise.resolve();
      expect(f.resolve).toHaveBeenCalledExactlyOnceWith(
        "request",
        item === "confirm",
        "view",
      );
    },
  );

  it.each([
    "escape",
    "outside",
    "replaced",
    "owner",
    "hidden",
    "navigation",
  ] as const)("denies on %s", (reason) => {
    const f = promptFixture();
    f.request();
    f.prompt.handle({
      viewId: "view",
      menuId: f.overlay.show.mock.calls[0][2].menuId,
      generation: 4,
      reason,
    });
    expect(f.resolve).toHaveBeenCalledExactlyOnceWith("request", false, "view");
  });

  it.each([
    "did-start-navigation",
    "did-frame-navigate",
    "frame-created",
    "render-process-gone",
    "destroyed",
  ])("denies immediately on native %s", (event) => {
    const f = promptFixture();
    f.request();
    f.emit(event);
    f.action();
    expect(f.resolve).toHaveBeenCalledExactlyOnceWith("request", false, "view");
  });

  it.each([
    "selected",
    "agent",
    "turn",
    "revision",
    "hidden",
    "detached",
    "url",
  ])("rejects a changed %s at decision time", (change) => {
    const f = promptFixture();
    f.request();
    if (change === "selected") f.target.selected = false;
    if (change === "agent") f.target.controlOwner = "agent";
    if (change === "turn") f.target.activeTurnId = "turn";
    if (change === "revision") f.target.pageRevision++;
    if (change === "hidden") f.hide();
    if (change === "detached") f.target.window.contentView.children = [];
    if (change === "url") f.frame.url = "https://other.example/";
    f.action();
    expect(f.resolve).toHaveBeenCalledExactlyOnceWith("request", false, "view");
  });

  it("does not let a replaced prompt or its late receipt settle the new request", async () => {
    const f = promptFixture();
    f.request("old");
    const old = f.overlay.show.mock.calls[0][2].menuId;
    f.request("new");
    f.action("confirm", 4, old);
    expect(f.resolve).toHaveBeenCalledExactlyOnceWith("old", false, "view");
    f.complete(0);
    await Promise.resolve();
    expect(f.overlay.hideMenu).toHaveBeenLastCalledWith("view", {
      menuId: old,
      generation: 4,
    });
    f.action();
    expect(f.resolve.mock.calls).toEqual([
      ["old", false, "view"],
      ["new", true, "view"],
    ]);
  });

  it("rejects mismatched native sources, opaque URLs, unknown permissions and unspecified media", () => {
    for (const override of [
      { requestingUrl: "https://foreign.example/" },
      { url: "https://foreign.example/" },
      { embeddingOrigin: "https://foreign.example" },
      { requestingUrl: "data:text/html,x" },
      { permission: "unknown" },
      { permission: "media" },
    ]) {
      const f = promptFixture();
      expect(f.request("bad", override)).toBe(false);
      expect(f.overlay.show).not.toHaveBeenCalled();
      expect(f.resolve).toHaveBeenCalledWith("bad", false, "view");
    }
  });

  it("supports five locales with separate camera and microphone disclosure", () => {
    for (const locale of ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"]) {
      const audio = sitePermissionText(locale, "media", ["audio"])!;
      const video = sitePermissionText(locale, "media", ["video"])!;
      const both = sitePermissionText(locale, "media", ["audio", "video"])!;
      expect(audio.permission).not.toBe(video.permission);
      expect(both.permission).toContain(audio.permission);
      expect(both.permission).toContain(video.permission);
      expect(audio.allow).not.toBe(audio.deny);
    }
    expect(sitePermissionText("unsupported", "midi")?.title).toBe(
      sitePermissionText("en-US", "midi")?.title,
    );
    expect(sitePermissionText("toString", "midi")?.title).toBe(
      sitePermissionText("en-US", "midi")?.title,
    );
  });

  it("rejects stale overlay generations after the native show receipt", async () => {
    const f = promptFixture();
    f.request();
    f.complete();
    await Promise.resolve();
    f.action("confirm", 3);
    expect(f.resolve).not.toHaveBeenCalled();
    f.action("confirm", 4);
    expect(f.resolve).toHaveBeenCalledWith("request", true, "view");
  });

  it("denies a failed native overlay load", async () => {
    const f = promptFixture();
    f.overlay.show.mockRejectedValueOnce(new Error("load failed"));
    f.request();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.resolve).toHaveBeenCalledExactlyOnceWith("request", false, "view");
  });
});
