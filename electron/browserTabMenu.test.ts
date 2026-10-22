import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserOverlayEvent } from "./browserOverlayHost";
import { createHarness, mount } from "./browserTabHost.testHarness";

const overlay = vi.hoisted(() => ({ show: vi.fn(async () => ({ menuId: "more-1", generation: 3, visible: true })), update: vi.fn(), hide: vi.fn(), hideWindow: vi.fn(), restack: vi.fn(), emit: undefined as ((event: BrowserOverlayEvent) => void) | undefined,
  onCommand: undefined as ((viewId: string, command: string) => void) | undefined }));
vi.mock("./browserOverlayHost", () => ({ BrowserOverlayHost: class {
  show = overlay.show; update = overlay.update; hide = overlay.hide; hideWindow = overlay.hideWindow; restack = overlay.restack;
  constructor(emit: (event: BrowserOverlayEvent) => void, options: { onCommand?: (viewId: string, command: string) => void } = {}) {
    overlay.emit = emit;
    overlay.onCommand = options.onCommand;
  }
  dispose() {}
} }));
beforeEach(() => { vi.clearAllMocks(); });

describe("canonical tab menu route boundary", () => {
  it("routes overlay shortcuts through the underlying page identity and drops stale views", async () => {
    const h = createHarness();
    const mounted = await mount(h) as { viewId: string };
    const native = h.views.get(mounted.viewId)!;
    overlay.onCommand?.(mounted.viewId, "focus-address");
    expect(h.events.at(-1)).toMatchObject({ event: "browser-tab-command", payload: {
      command: "focus-address", viewId: mounted.viewId, webContentsId: native.webContents.id,
      ownerWebContentsId: 41, windowId: 7, threadId: "thread-1", browserSessionId: "browser-session-1", tabId: "tab-1",
    } });
    const eventCount = h.events.length;
    overlay.onCommand?.("stale-view", "focus-address");
    expect(h.events).toHaveLength(eventCount);
  });

  it("allows only the selected tab in the owner window and preserves complete identity on native events", async () => {
    const h = createHarness();
    const mounted = await mount(h) as { viewId: string };
    const native = h.views.get(mounted.viewId)!;
    Object.assign(native.webContents, { isFocused: () => true });
    const args = { tabId: "tab-1", menuId: "more-1", anchor: { x: 10, y: 20, width: 24, height: 24 }, items: [{ id: "print", label: "Print" }] };
    await expect(h.host.invoke({ ...h.window, id: 88 } as never, "browser_tab_show_menu", args)).rejects.toThrow("does not belong");
    await expect(h.host.invoke(h.window as never, "browser_tab_show_menu", { ...args, script: "alert(1)" })).rejects.toThrow("unsupported");
    expect(await h.host.invoke(h.window as never, "browser_tab_show_menu", args)).toEqual({ menuId: "more-1", generation: 3, visible: true });
    expect(overlay.show).toHaveBeenCalledWith(h.window, mounted.viewId, { menuId: args.menuId, anchor: args.anchor, items: args.items }, native.webContents);
    overlay.emit?.({ viewId: mounted.viewId, menuId: "more-1", generation: 3, itemId: "print", reason: "action" });
    expect(h.events.at(-1)).toMatchObject({ event: "browser-tab-menu-action", payload: { viewId: mounted.viewId, menuId: "more-1", generation: 3, itemId: "print", reason: "action", threadId: "thread-1", browserSessionId: "browser-session-1", tabId: "tab-1", windowId: 7, ownerWebContentsId: 41, webContentsId: native.webContents.id } });
    const count = h.events.length;
    overlay.emit?.({ viewId: "stale-view", menuId: "more-1", generation: 3, reason: "escape" });
    expect(h.events).toHaveLength(count);
    h.host.observeEmbeddedEvent("embedded-browser-view-navigation-started", { viewId: mounted.viewId, url: "https://next.example/" });
    expect(overlay.hide).toHaveBeenCalledWith(mounted.viewId, "navigation");
    await h.host.invoke(h.window as never, "browser_tab_update_menu", { tabId: "tab-1", menuId: "more-1", generation: 3, items: args.items });
    expect(overlay.update).toHaveBeenCalledWith(mounted.viewId, { menuId: "more-1", generation: 3, items: args.items });
    await mount(h, { tabId: "tab-2" });
    await expect(h.host.invoke(h.window as never, "browser_tab_show_menu", args)).rejects.toThrow("selected tab");
  });
});
