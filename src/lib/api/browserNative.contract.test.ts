import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureBrowserTabScreenshot,
  listenBrowserTabCommand,
  printBrowserTab,
  setBrowserTabAudioMuted,
  setBrowserTabDevice,
} from "./browserTab";
import {
  captureEmbeddedBrowserView,
  printEmbeddedBrowserView,
} from "./embeddedBrowser";

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(
    async (_event: string, _handler: (event: { payload: unknown }) => void) =>
      () =>
        undefined,
  ),
}));
vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: invoke, safeListen: listen }));

const state = {
  viewId: "view-1",
  url: "https://example.com/",
  title: "Example",
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  browserSessionId: "session-1",
  controlOwner: "user",
  origin: "user",
  ownerWebContentsId: 41,
  pageRevision: 0,
  selected: true,
  tabId: "tab-1",
  threadId: "thread-1",
  webContentsId: 100,
  windowId: 7,
};

describe("Browser native gateway contracts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps print cancellation and capture bytes associated with canonical state", async () => {
    invoke.mockResolvedValueOnce({
      printed: false,
      failureReason: "cancelled",
      state,
    });
    await expect(printBrowserTab("tab-1")).resolves.toEqual({
      printed: false,
      failureReason: "cancelled",
      state,
    });
    expect(invoke).toHaveBeenLastCalledWith("browser_tab_print", {
      tabId: "tab-1",
    });
    invoke.mockResolvedValueOnce({
      dataUrl: "data:image/png;base64,aGVsbG8=",
      width: 800,
      height: 600,
      copiedToClipboard: true,
      state,
    });
    await captureBrowserTabScreenshot("tab-1", true);
    expect(invoke).toHaveBeenLastCalledWith("browser_tab_capture_screenshot", {
      tabId: "tab-1",
      copyToClipboard: true,
    });
    invoke.mockResolvedValueOnce({
      dataUrl: "https://external.example/image.png",
      width: 800,
      height: 600,
      copiedToClipboard: false,
      state,
    });
    await expect(captureBrowserTabScreenshot("tab-1")).rejects.toThrow(
      "invalid PNG",
    );
  });

  it("routes native device/audio changes through the existing typed Browser gateway", async () => {
    invoke.mockResolvedValue(state);
    await setBrowserTabDevice("tab-1", {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      scale: 0.5,
      mobile: true,
    });
    expect(invoke).toHaveBeenLastCalledWith("browser_tab_set_device", {
      tabId: "tab-1",
      device: {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        scale: 0.5,
        mobile: true,
      },
    });
    await setBrowserTabAudioMuted("tab-1", true);
    expect(invoke).toHaveBeenLastCalledWith("browser_tab_set_audio_muted", {
      tabId: "tab-1",
      muted: true,
    });
  });

  it("rejects malformed print/capture replies at the Embedded boundary", async () => {
    invoke.mockResolvedValueOnce({ printed: "yes", failureReason: null });
    await expect(printEmbeddedBrowserView("view-1")).rejects.toThrow(
      "invalid result",
    );
    invoke.mockResolvedValueOnce({
      dataUrl: "data:image/png;base64,eA==",
      width: 0,
      height: 600,
      copiedToClipboard: false,
    });
    await expect(captureEmbeddedBrowserView("view-1")).rejects.toThrow(
      "invalid PNG",
    );
  });

  it("validates native shortcut identity and command before handing it to presentation", async () => {
    const received: unknown[] = [];
    await listenBrowserTabCommand((event) => received.push(event));
    const callback = listen.mock.calls[0]?.[1] as (event: {
      payload: unknown;
    }) => void;
    callback({ payload: { ...state, command: "focus-address" } });
    expect(received).toHaveLength(1);
    expect(() =>
      callback({ payload: { ...state, command: "arbitrary-script" } }),
    ).toThrow("invalid");
    expect(() =>
      callback({ payload: { viewId: "view-1", command: "find" } }),
    ).toThrow("身份");
  });
});
