import { describe, expect, it, vi } from "vitest";
import type {
  ElectronBrowserTabHost,
  BrowserPopupIdentityRequest,
} from "./browserTabHost";
import { BrowserAppServerBridge } from "./browserAppServerBridge";
import { DEFAULT_BROWSER_SETTINGS } from "../src/lib/api/browserSettingsTypes";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function setup() {
  const host = {
    setSettings: vi.fn(),
    setSettingsProvider: vi.fn(),
    setPopupIdentityHandler: vi.fn(),
  };
  const request = vi.fn();
  const bridge = new BrowserAppServerBridge(
    host as unknown as ElectronBrowserTabHost,
    request,
  );
  return { bridge, host, request };
}
const popup: BrowserPopupIdentityRequest = {
  browserSessionId: "browser-1",
  threadId: "thread-1",
  ownerWebContentsId: 41,
  openerTabId: "opener",
  url: "https://example.com/oauth",
  background: false,
};
const ownerInput = { surfaceKind: "browser", sessionId: "session-1" };
const identity = {
  requestId: "request-1",
  pending: {
    metadata: {
      browser: {
        browserSessionId: "browser-1",
        threadId: "thread-1",
        tabId: "popup",
      },
    },
  },
};

describe("Browser App Server bridge", () => {
  it("projects the current configuration language to history approval presentation", async () => {
    const { bridge, host, request } = setup();
    request.mockResolvedValue({
      config: { browser: DEFAULT_BROWSER_SETTINGS, language: "ja-JP" },
    });
    await bridge.refreshSettings();
    expect(host.setSettings).toHaveBeenCalledWith(
      DEFAULT_BROWSER_SETTINGS,
      "ja-JP",
    );
  });
  it("reads authoritative configuration and propagates failures to the execution provider", async () => {
    const { bridge, host, request } = setup();
    request.mockResolvedValueOnce({
      config: { browser: { ...DEFAULT_BROWSER_SETTINGS, enabled: false } },
    });
    expect((await bridge.refreshSettings()).enabled).toBe(false);
    expect(host.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    request.mockRejectedValueOnce(new Error("sidecar unavailable"));
    const provider = host.setSettingsProvider.mock
      .calls[0][0] as () => Promise<unknown>;
    await expect(provider()).rejects.toThrow("sidecar unavailable");
  });
  it("a later committed policy wins over an older pending read, including its returned execution value", async () => {
    const { bridge, host, request } = setup();
    const old = deferred<unknown>();
    const fresh = deferred<unknown>();
    request.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const reading = bridge.refreshSettings();
    const writing = bridge.observeResult("config/batchWrite", {}, {});
    fresh.resolve({
      config: { browser: { ...DEFAULT_BROWSER_SETTINGS, enabled: false } },
    });
    await writing;
    old.resolve({ config: { browser: DEFAULT_BROWSER_SETTINGS } });
    await expect(reading).rejects.toThrow("owner changed");
    expect(host.setSettings).toHaveBeenCalledTimes(1);
    expect(host.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });
  it("uses the confirmed session mapping and consumes the canonical popup request", async () => {
    const { bridge, request } = setup();
    await bridge.observeResult(
      "workspaceRightSurface/request",
      ownerInput,
      identity,
      41,
    );
    request
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce({ status: "consumed" });
    await expect(bridge.createPopupIdentity(popup)).resolves.toEqual({
      browserSessionId: "browser-1",
      tabId: "popup",
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      "workspaceRightSurface/request",
      expect.objectContaining({
        sessionId: "session-1",
        metadata: {
          browser: {
            action: "createTab",
            threadId: "thread-1",
            browserSessionId: "browser-1",
          },
        },
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "workspaceRightSurface/pending/consume",
      { requestId: "request-1" },
    );
  });
  it("rejects another window and invalidates the popup owner after sidecar loss", async () => {
    const { bridge, request } = setup();
    await bridge.observeResult(
      "workspaceRightSurface/request",
      ownerInput,
      identity,
      41,
    );
    await expect(
      bridge.createPopupIdentity({ ...popup, ownerWebContentsId: 42 }),
    ).rejects.toThrow("owner");
    bridge.reset();
    await expect(bridge.createPopupIdentity(popup)).rejects.toThrow("owner");
    expect(request).not.toHaveBeenCalled();
  });
  it("an Agent-created opener uses the canonical thread session without requiring a visible Browser pane", async () => {
    const { bridge, request } = setup();
    await bridge.observeResult(
      "thread/start",
      {},
      { thread: { id: "thread-1", sessionId: "session-agent" } },
      41,
    );
    request.mockResolvedValueOnce(identity).mockResolvedValueOnce({});
    await expect(bridge.createPopupIdentity(popup)).resolves.toEqual({
      browserSessionId: "browser-1",
      tabId: "popup",
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      "workspaceRightSurface/request",
      expect.objectContaining({ sessionId: "session-agent" }),
    );
  });
  it("consumes an invalid identity without attaching a native popup", async () => {
    const { bridge, request } = setup();
    await bridge.observeResult(
      "workspaceRightSurface/request",
      ownerInput,
      identity,
      41,
    );
    request
      .mockResolvedValueOnce({
        ...identity,
        pending: { metadata: { browser: { tabId: "wrong" } } },
      })
      .mockResolvedValueOnce({});
    await expect(bridge.createPopupIdentity(popup)).rejects.toThrow("stale");
    expect(request).toHaveBeenLastCalledWith(
      "workspaceRightSurface/pending/consume",
      { requestId: "request-1" },
    );
  });
});
