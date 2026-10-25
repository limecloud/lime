import { describe, expect, it, vi } from "vitest";
import type { Session } from "electron";
import {
  BrowserPermissionRequests,
  assertApplicationNetworkRevocationSupported,
} from "./browserPermissionRequests";
import { ApplicationNetworkPolicy } from "./applicationNetworkPolicy";

describe("application destination policy in the shared Session request owner", () => {
  it("checks all destinations, including worker requests without WebContents, before Agent navigation approval", async () => {
    const policy = new ApplicationNetworkPolicy();
    await policy.update(
      {
        application: {
          network: { enabled: true, domains: { "allowed.example": "allow" } },
        },
      },
      async () => {},
    );
    const onBeforeRequest = vi.fn();
    const session = { webRequest: { onBeforeRequest } } as unknown as Session;
    const allows = vi.fn(() => true);
    const blocked = vi.fn();
    const owner = new BrowserPermissionRequests({
      viewId: (id) => (id === 31 ? "view" : null),
      allows,
      blocked,
      networkAllows: (url: string) => policy.allows(url),
    });
    owner.install(session);
    const [filter, listener] = onBeforeRequest.mock.calls[0];
    expect(filter.urls).toEqual(
      expect.arrayContaining(["ws://*/*", "wss://*/*"]),
    );
    for (const resourceType of [
      "mainFrame",
      "subFrame",
      "script",
      "image",
      "stylesheet",
      "xhr",
      "webSocket",
      "other",
    ]) {
      for (const webContentsId of [31, -1, undefined]) {
        const callback = vi.fn();
        listener(
          {
            resourceType,
            webContentsId,
            url:
              resourceType === "webSocket"
                ? "wss://blocked.example/socket"
                : "https://blocked.example/resource",
          },
          callback,
        );
        expect(callback).toHaveBeenCalledExactlyOnceWith({ cancel: true });
      }
    }
    expect(allows).not.toHaveBeenCalled();
    const callback = vi.fn();
    listener(
      {
        resourceType: "script",
        webContentsId: 31,
        url: "https://allowed.example/script.js",
      },
      callback,
    );
    expect(callback).toHaveBeenCalledExactlyOnceWith({ cancel: false });
    owner.dispose();
  });

  it("shares fresh authority, uses the final policy and keeps workers blocked after disposal", async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const onBeforeRequest = vi.fn();
    const session = { webRequest: { onBeforeRequest } } as unknown as Session;
    let allowed = true;
    const refreshNetwork = vi.fn(() => pending);
    const owner = new BrowserPermissionRequests({
      viewId: () => null,
      allows: () => true,
      blocked: () => {},
      networkAllows: () => allowed,
      refreshNetwork,
    });
    owner.install(session);
    const listener = onBeforeRequest.mock.calls[0][1];
    const first = vi.fn();
    const second = vi.fn();
    listener({ resourceType: "xhr", url: "https://example.com/" }, first);
    listener({ resourceType: "webSocket", url: "wss://example.com/" }, second);
    await Promise.resolve();
    expect(refreshNetwork).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    allowed = false;
    complete();
    await vi.waitFor(() =>
      expect(first).toHaveBeenCalledExactlyOnceWith({ cancel: true }),
    );
    expect(second).toHaveBeenCalledExactlyOnceWith({ cancel: true });
    owner.dispose();
    const worker = vi.fn();
    listener({ resourceType: "xhr", url: "https://example.com/" }, worker);
    expect(worker).toHaveBeenCalledExactlyOnceWith({ cancel: true });
  });

  it("does not silently certify live policy replacement after a permitted WebSocket handshake", () => {
    const onBeforeRequest = vi.fn();
    const session = { webRequest: { onBeforeRequest } } as unknown as Session;
    const owner = new BrowserPermissionRequests({
      viewId: () => null,
      allows: () => true,
      blocked: () => {},
      networkAllows: () => true,
    });
    owner.install(session);
    expect(() =>
      assertApplicationNetworkRevocationSupported(session),
    ).not.toThrow();
    const callback = vi.fn();
    onBeforeRequest.mock.calls[0][1](
      { resourceType: "webSocket", url: "ws://example.com/socket" },
      callback,
    );
    expect(callback).toHaveBeenCalledExactlyOnceWith({ cancel: false });
    expect(() => assertApplicationNetworkRevocationSupported(session)).toThrow(
      "fresh native Session",
    );
    owner.dispose();
    expect(() => assertApplicationNetworkRevocationSupported(session)).toThrow(
      "fresh native Session",
    );
  });
});
