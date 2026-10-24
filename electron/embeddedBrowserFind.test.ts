import { describe, expect, it } from "vitest";
import {
  createWindow,
  emitWebContentsEvent,
  findInPageMock,
  getZoomFactorMock,
  loadUrlMock,
  setZoomFactorMock,
  webContentsState,
  resetMocks,
  stopFindInPageMock,
} from "./embeddedBrowserHost.testFixtures";
import { ElectronEmbeddedBrowserHost } from "./embeddedBrowserHost";

describe("embedded browser find sessions", () => {
  it("starts a native session for each edited query and continues it for next/previous", async () => {
    resetMocks();
    const host = new ElectronEmbeddedBrowserHost();
    const window = createWindow();
    await host.invoke(window as never, "embedded_browser_view_mount", {
      viewId: "find-tab",
      url: "https://example.com/",
    });
    try {
      for (const text of ["Browser", "Browsere", "Browser"]) {
        await host.invoke(
          window as never,
          "embedded_browser_view_find_in_page",
          {
            viewId: "find-tab",
            text,
            forward: true,
            findNext: false,
          },
        );
        expect(findInPageMock).toHaveBeenLastCalledWith(text, {
          forward: true,
          findNext: true,
        });
      }
      for (const forward of [true, false]) {
        await host.invoke(
          window as never,
          "embedded_browser_view_find_in_page",
          {
            viewId: "find-tab",
            text: "Browser",
            forward,
            findNext: true,
          },
        );
        expect(findInPageMock).toHaveBeenLastCalledWith("Browser", {
          forward,
          findNext: false,
        });
      }
    } finally {
      host.dispose();
    }
  });

  it("keeps the latest request result and clears the same native session", async () => {
    resetMocks();
    const host = new ElectronEmbeddedBrowserHost();
    const window = createWindow();
    await host.invoke(window as never, "embedded_browser_view_mount", {
      viewId: "find-tab",
      url: "https://example.com/",
    });
    const find = (text: string, requestId: number) => {
      findInPageMock.mockReturnValueOnce(requestId);
      return host.invoke(
        window as never,
        "embedded_browser_view_find_in_page",
        {
          viewId: "find-tab",
          text,
          findNext: false,
        },
      );
    };
    const result = (requestId: number, matches: number) =>
      emitWebContentsEvent(
        "found-in-page",
        {},
        {
          requestId,
          matches,
          activeMatchOrdinal: matches ? 1 : 0,
          finalUpdate: true,
        },
      );
    try {
      await find("Browsere", 8);
      await find("Browser", 9);
      result(9, 2);
      result(8, 0);
      expect(host.resolveNativeView("find-tab")?.state.find).toEqual({
        text: "Browser",
        matches: 2,
        activeMatchOrdinal: 1,
        finalUpdate: true,
      });
      await host.invoke(
        window as never,
        "embedded_browser_view_stop_find_in_page",
        {
          viewId: "find-tab",
        },
      );
      expect(stopFindInPageMock).toHaveBeenCalledExactlyOnceWith(
        "clearSelection",
      );
      expect(host.resolveNativeView("find-tab")?.state.find).toEqual({
        text: "",
        matches: 0,
        activeMatchOrdinal: 0,
        finalUpdate: true,
      });
    } finally {
      host.dispose();
    }
  });
  it("同步 favicon、加载进度、页内查找和单标签缩放状态", async () => {
    resetMocks();
    const emitted: Array<{ event: string; payload?: unknown }> = [];
    webContentsState.url = "";
    webContentsState.isLoading = true;
    loadUrlMock.mockReturnValue(new Promise(() => undefined));
    setZoomFactorMock.mockImplementation((nextZoom: number) => {
      getZoomFactorMock.mockReturnValue(nextZoom);
    });
    const host = new ElectronEmbeddedBrowserHost((event, payload) => {
      emitted.push({ event, payload });
    });
    const window = createWindow();

    await expect(
      host.invoke(window as never, "embedded_browser_view_mount", {
        viewId: "browser-1",
        url: "https://example.com",
      }),
    ).resolves.toMatchObject({
      viewId: "browser-1",
      loadProgress: 0.1,
      zoomFactor: 1,
    });

    emitWebContentsEvent("page-favicon-updated", {}, [
      "https://example.com/favicon.ico",
    ]);
    await host.invoke(window as never, "embedded_browser_view_find_in_page", {
      viewId: "browser-1",
      text: "Example",
    });
    expect(findInPageMock).toHaveBeenCalledWith("Example", {
      forward: true,
      findNext: true,
    });
    emitWebContentsEvent(
      "found-in-page",
      {},
      {
        requestId: 7,
        activeMatchOrdinal: 2,
        matches: 5,
        finalUpdate: true,
      },
    );

    await host.invoke(window as never, "embedded_browser_view_set_zoom", {
      viewId: "browser-1",
      zoomFactor: 1.25,
    });
    await host.invoke(
      window as never,
      "embedded_browser_view_stop_find_in_page",
      {
        viewId: "browser-1",
      },
    );

    expect(setZoomFactorMock).toHaveBeenCalledWith(1.25);
    expect(stopFindInPageMock).toHaveBeenCalledWith("clearSelection");
    expect(
      emitted.some(
        (item) =>
          item.event === "embedded-browser-view-state" &&
          (item.payload as { faviconUrl?: string }).faviconUrl ===
            "https://example.com/favicon.ico",
      ),
    ).toBe(true);
    expect(
      emitted.some(
        (item) =>
          item.event === "embedded-browser-view-state" &&
          (item.payload as { find?: { matches?: number } }).find?.matches === 5,
      ),
    ).toBe(true);
    expect(
      emitted.find(
        (item) =>
          item.event === "embedded-browser-view-state" &&
          (item.payload as { zoomFactor?: number }).zoomFactor === 1.25,
      ),
    ).toBeTruthy();
  });
});
