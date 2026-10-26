import type {
  OnBeforeRequestListenerDetails,
  Session,
  WebContents,
} from "electron";
import { describe, expect, it, vi } from "vitest";
import { BrowserPermissionRequests } from "./browserPermissionRequests";
import { allowsEmbeddedBrowserImage } from "./embeddedBrowserImages";

function fixture(refreshNetwork?: () => Promise<void>) {
  const main = {
    url: "https://page.example/",
    origin: "https://page.example",
    detached: false,
  };
  const child = {
    url: "https://frame.example/",
    origin: "https://frame.example",
    detached: false,
  };
  const contents = {
    isDestroyed: () => false,
    mainFrame: { ...main, framesInSubtree: [main, child] },
  } as unknown as WebContents;
  const rules = new Map([
    [main.origin, "block"],
    [child.origin, "allow"],
  ]);
  const decision = vi.fn((origin: string) =>
    rules.get(origin) === "allow" ? ("allow" as const) : ("block" as const),
  );
  let networkAllowed = true;
  const onBeforeRequest = vi.fn();
  const onHeadersReceived = vi.fn();
  const owner = new BrowserPermissionRequests({
    viewId: () => "view",
    allows: () => true,
    blocked: () => {},
    networkAllows: () => networkAllowed,
    resourceAllows: (details) =>
      allowsEmbeddedBrowserImage(details, contents, decision),
    imageAllows: (url) => decision(new URL(url).origin) === "allow",
    refreshNetwork,
  });
  owner.install({
    webRequest: { onBeforeRequest, onHeadersReceived },
  } as unknown as Session);
  const listener = onBeforeRequest.mock.calls[0][1];
  const request = (frame: unknown, resourceType = "image") => {
    const callback = vi.fn();
    listener(
      {
        url: "https://cdn.example/pixel.png",
        webContentsId: 9,
        frame,
        resourceType,
      },
      callback,
    );
    return callback;
  };
  const headers = (resourceType: string, url: string, responseHeaders = {}) => {
    const callback = vi.fn();
    onHeadersReceived.mock.calls[0][1](
      { resourceType, url, responseHeaders },
      callback,
    );
    return callback;
  };
  return {
    main,
    child,
    rules,
    decision,
    request,
    headers,
    denyNetwork: () => {
      networkAllowed = false;
    },
  };
}

describe("site images in the shared native Session request gate", () => {
  it("intersects image restrictions with existing CSP while preserving other headers", () => {
    const f = fixture();
    const original = {
      "content-security-policy": ["script-src 'self'"],
      "x-content-type-options": ["nosniff"],
    };
    expect(
      f.headers("mainFrame", f.main.url, original),
    ).toHaveBeenCalledExactlyOnceWith({
      responseHeaders: {
        ...original,
        "content-security-policy": ["script-src 'self'", "img-src 'none'"],
      },
    });
    expect(original["content-security-policy"]).toEqual(["script-src 'self'"]);
    expect(
      f.headers("subFrame", f.child.url, original),
    ).toHaveBeenCalledExactlyOnceWith({});
    expect(
      f.headers("xhr", f.main.url, original),
    ).toHaveBeenCalledExactlyOnceWith({});
  });

  it("restricts inline images if persisted settings cannot be read", () => {
    const f = fixture();
    f.decision.mockImplementation(() => {
      throw new Error("settings unavailable");
    });
    expect(f.headers("subFrame", f.child.url)).toHaveBeenCalledExactlyOnceWith({
      responseHeaders: { "Content-Security-Policy": ["img-src 'none'"] },
    });
  });
  it("uses the requesting frame's rule for cross-origin CDN images without blocking scripts", () => {
    const f = fixture();
    expect(f.request(f.main)).toHaveBeenCalledExactlyOnceWith({ cancel: true });
    expect(f.request(f.child)).toHaveBeenCalledExactlyOnceWith({
      cancel: false,
    });
    expect(f.request(f.main, "script")).toHaveBeenCalledExactlyOnceWith({
      cancel: false,
    });
    expect(f.decision.mock.calls.map(([origin]) => origin)).toEqual([
      f.main.origin,
      f.child.origin,
    ]);
    f.rules.set(f.main.origin, "allow");
    expect(f.request(f.main)).toHaveBeenCalledExactlyOnceWith({
      cancel: false,
    });
  });

  it("never widens an enterprise denial with a site allow", () => {
    const f = fixture();
    f.denyNetwork();
    expect(f.request(f.child)).toHaveBeenCalledExactlyOnceWith({
      cancel: true,
    });
    expect(f.decision).not.toHaveBeenCalled();
  });

  it("uses native inherited origins and rejects opaque, foreign and missing frames", () => {
    const f = fixture();
    f.child.url = "about:srcdoc";
    expect(f.request(f.child)).toHaveBeenCalledExactlyOnceWith({
      cancel: false,
    });
    f.child.origin = "null";
    expect(f.request(f.child)).toHaveBeenCalledExactlyOnceWith({
      cancel: true,
    });
    expect(f.request({ ...f.main })).toHaveBeenCalledExactlyOnceWith({
      cancel: true,
    });
    expect(f.request(null)).toHaveBeenCalledExactlyOnceWith({ cancel: true });
    f.main.detached = true;
    expect(f.request(f.main)).toHaveBeenCalledExactlyOnceWith({ cancel: true });
  });

  it("keeps sandboxed image preferences separate from privileged device grants", () => {
    const f = fixture();
    f.child.origin = "null";
    expect(f.request(f.child)).toHaveBeenCalledExactlyOnceWith({
      cancel: false,
    });
    f.child.url = "about:srcdoc";
    Object.assign(f.child, { parent: f.main });
    expect(f.request(f.child)).toHaveBeenCalledExactlyOnceWith({
      cancel: true,
    });
    f.rules.set(f.main.origin, "allow");
    expect(f.request(f.child)).toHaveBeenCalledExactlyOnceWith({
      cancel: false,
    });
  });

  it("denies requests whose native document changed while authority was refreshed", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((yes) => {
      resolve = yes;
    });
    const f = fixture(() => pending);
    const callback = f.request(f.child);
    f.child.url = "https://frame.example/new-document";
    resolve();
    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledExactlyOnceWith({ cancel: true }),
    );
    expect(f.decision).not.toHaveBeenCalled();
  });

  it("keeps destroyed contents and unreadable site rules closed", () => {
    const f = fixture();
    f.decision.mockImplementation(() => {
      throw new Error("corrupt site settings");
    });
    expect(f.request(f.child)).toHaveBeenCalledExactlyOnceWith({
      cancel: true,
    });
    expect(
      allowsEmbeddedBrowserImage(
        {
          resourceType: "image",
          frame: f.child,
        } as unknown as OnBeforeRequestListenerDetails,
        { isDestroyed: () => true } as unknown as WebContents,
        () => "allow",
      ),
    ).toBe(false);
  });
});
