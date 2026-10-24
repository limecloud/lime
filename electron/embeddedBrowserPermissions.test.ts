import { EventEmitter } from "node:events";
import type { Session, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { installEmbeddedBrowserPermissionHandling } from "./embeddedBrowserPermissions";

function fixture() {
  const events = new EventEmitter();
  const frame = {
    url: "https://example.com/",
    processId: 1,
    routingId: 1,
    detached: false,
    framesInSubtree: [] as unknown[],
  };
  frame.framesInSubtree = [frame];
  const wc = Object.assign(events, {
    id: 1,
    isDestroyed: () => false,
    mainFrame: frame,
    getURL: () => frame.url,
  }) as unknown as WebContents;
  const session = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  };
  const pending = new Map<string, (allowed: boolean) => boolean>();
  const emit = vi.fn();
  const grants = installEmbeddedBrowserPermissionHandling(
    session as unknown as Session,
    {
      findEntryByWebContents: (candidate) =>
        candidate === wc ? { viewId: "view", webContents: wc } : null,
      deferPermissionRequest: true,
      onPendingPermission: (id, _view, callback) => pending.set(id, callback),
    },
    emit,
  );
  const handler = session.setPermissionRequestHandler.mock
    .calls[0][0] as NonNullable<
    Parameters<Session["setPermissionRequestHandler"]>[0]
  >;
  const checker = session.setPermissionCheckHandler.mock
    .calls[0][0] as NonNullable<
    Parameters<Session["setPermissionCheckHandler"]>[0]
  >;
  const request = (
    permission = "midi",
    details: Record<string, unknown> = {},
  ) => {
    const callback = vi.fn();
    handler(wc, permission as "midi", callback, {
      isMainFrame: true,
      requestingUrl: frame.url,
      ...details,
    });
    const id = emit.mock.calls.at(-1)?.[1].requestId;
    return {
      callback,
      decide: (allowed: boolean) => pending.get(id)?.(allowed),
    };
  };
  const check = (
    permission = "midi",
    details: Record<string, unknown> = {},
    origin = "https://example.com",
  ) =>
    checker(wc, permission as "midi", origin, {
      isMainFrame: true,
      requestingUrl: frame.url,
      ...details,
    });
  return { wc, frame, events, grants, request, check, checker, handler, emit };
}

describe("embedded Session permission request/check agreement", () => {
  it("starts denied, waits for the owner, then checks only the approved document and origin", () => {
    const f = fixture();
    expect(f.check()).toBe(false);
    const request = f.request();
    expect(request.callback).not.toHaveBeenCalled();
    expect(f.check()).toBe(false);
    request.decide(true);
    expect(request.callback).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.check()).toBe(true);
    expect(f.check("geolocation")).toBe(false);
    expect(f.check("midi", {}, "https://foreign.example")).toBe(false);
    expect(
      f.checker(null, "midi", "https://example.com", { isMainFrame: true }),
    ).toBe(false);
    expect(
      f.checker({} as WebContents, "midi", "https://example.com", {
        isMainFrame: true,
      }),
    ).toBe(false);
  });

  it("denial and repeated decisions never mint a grant or call native twice", () => {
    const f = fixture();
    const r = f.request();
    r.decide(false);
    r.decide(true);
    expect(r.callback).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.check()).toBe(false);
  });

  it.each([
    "did-start-navigation",
    "did-frame-navigate",
    "frame-created",
    "render-process-gone",
    "destroyed",
  ])(
    "revokes an existing grant and rejects an in-flight decision on %s",
    (event) => {
      const f = fixture();
      f.request().decide(true);
      const pending = f.request("geolocation");
      f.events.emit(event);
      pending.decide(true);
      expect(f.check()).toBe(false);
      expect(pending.callback).toHaveBeenCalledExactlyOnceWith(false);
    },
  );

  it("does not transfer an old grant when a same-URL document replaces the frame", () => {
    const f = fixture();
    f.request().decide(true);
    f.wc.mainFrame.framesInSubtree.splice(0, 1, {
      ...f.frame,
      routingId: 99,
    } as never);
    expect(f.check()).toBe(false);
  });

  it("revokes pending and granted state on a host control change", () => {
    const f = fixture();
    f.request().decide(true);
    const r = f.request();
    f.grants.revoke("other");
    expect(f.check()).toBe(true);
    f.grants.revoke("view");
    expect(r.decide(true)).toBe(false);
    expect(r.callback).toHaveBeenCalledWith(false);
    expect(f.check()).toBe(false);
  });

  it("separates camera, microphone, and MIDI system exclusive access", () => {
    const f = fixture();
    f.request("media", { mediaTypes: ["audio"] }).decide(true);
    expect(f.check("media", { mediaType: "audio" })).toBe(true);
    expect(f.check("media", { mediaType: "video" })).toBe(false);
    f.request("media", { mediaTypes: ["video"] }).decide(true);
    expect(f.check("media", { mediaType: "video" })).toBe(true);
    expect(f.check("media", { mediaType: "audio" })).toBe(true);
    expect(f.check("media", { mediaType: "unknown" })).toBe(false);
    f.request().decide(true);
    expect(f.check("midiSysex")).toBe(false);
  });

  it("binds subframe grants to the unique native requesting frame", () => {
    const f = fixture();
    const child = {
      ...f.frame,
      url: "https://frame.example/page",
      routingId: 2,
    };
    f.frame.framesInSubtree.push(child);
    f.request("midi", { isMainFrame: false, requestingUrl: child.url }).decide(
      true,
    );
    expect(
      f.check(
        "midi",
        { isMainFrame: false, requestingUrl: undefined },
        "https://frame.example",
      ),
    ).toBe(true);
    expect(f.check()).toBe(false);
    f.frame.framesInSubtree.push({ ...child, routingId: 3 });
    expect(
      f.check(
        "midi",
        { isMainFrame: false, requestingUrl: undefined },
        "https://frame.example",
      ),
    ).toBe(false);
    f.frame.framesInSubtree.splice(1);
    expect(
      f.check("midi", { isMainFrame: false }, "https://frame.example"),
    ).toBe(false);
  });

  it("rejects opaque, mismatched or ambiguous native requesting frames before deferring", () => {
    for (const details of [
      { requestingUrl: "data:text/html,x" },
      { requestingUrl: "https://foreign.example/" },
      { isMainFrame: false },
      { securityOrigin: "https://foreign.example" },
    ]) {
      const f = fixture();
      const r = f.request("midi", details);
      expect(r.callback).toHaveBeenCalledExactlyOnceWith(false);
      expect(f.emit.mock.calls[0][1].decision).toBe("blocked");
    }
  });
});
