// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createHarness, mount } from "./browserTabHost.testHarness";
import type { BrowserTabState } from "./browserTabHost";

describe("navigation recovery mount races", () => {
  it("does not replace a live page mounted while reading the recovery file", async () => {
    let finish!: (value: unknown) => void;
    const navigation = {
      read: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
      restore: vi.fn(async () => true),
      capture: vi.fn(),
      clear: vi.fn(async () => undefined),
      flush: vi.fn(async () => undefined),
    };
    const h = createHarness({ navigation: navigation as never });
    const restoring = mount(h, { restoreNavigation: true });
    await vi.waitFor(() => expect(navigation.read).toHaveBeenCalledOnce());
    const live = (await mount(h, {
      url: "https://example.com/current",
    })) as BrowserTabState;
    await h.host.invoke(h.window as never, "browser_tab_navigate", {
      tabId: "tab-1",
      url: "https://example.com/current",
    });
    finish({
      entries: [{ url: "https://example.com/", title: "Old" }],
      index: 0,
    });
    const restored = await restoring;
    expect(navigation.restore).not.toHaveBeenCalled();
    expect(restored).toMatchObject({
      webContentsId: live.webContentsId,
      url: "https://example.com/current",
    });
  });
  it("does not mount a tab that was closed while its recovery record was loading", async () => {
    let finish!: (value: unknown) => void;
    const navigation = {
      read: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
      restore: vi.fn(async () => true),
      capture: vi.fn(),
      clear: vi.fn(async () => undefined),
      flush: vi.fn(async () => undefined),
    };
    const h = createHarness({ navigation: navigation as never });
    const restoring = mount(h, { restoreNavigation: true });
    const rejected = expect(restoring).rejects.toThrow("owner became stale");
    await vi.waitFor(() => expect(navigation.read).toHaveBeenCalledOnce());
    await h.host.invoke(h.window as never, "browser_tab_close", {
      tabId: "tab-1",
    });
    finish({
      entries: [{ url: "https://example.com/", title: "Old" }],
      index: 0,
    });
    await rejected;
    expect(h.views.size).toBe(0);
    expect(navigation.restore).not.toHaveBeenCalled();
  });
});
