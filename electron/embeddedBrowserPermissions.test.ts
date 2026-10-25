import { EventEmitter } from "node:events";
import type { Session, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { installEmbeddedBrowserPermissionHandling } from "./embeddedBrowserPermissions";

function fixture(
  options: Partial<
    Parameters<typeof installEmbeddedBrowserPermissionHandling>[1]
  > = {},
) {
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
      onPermissionCancelled: (id) => {
        pending.get(id)?.(false);
        pending.delete(id);
      },
      ...options,
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
    return {
      callback,
      decide: (allowed: boolean) =>
        pending.get(emit.mock.calls.at(-1)?.[1].requestId)?.(allowed),
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
  return {
    wc,
    frame,
    events,
    grants,
    request,
    check,
    checker,
    handler,
    emit,
    pending,
  };
}

describe("persistent protected content and automatic download decisions", () => {
  it.each(["allow", "block", "ask"] as const)(
    "routes protected content %s through native mediaKeySystem authority",
    async (setting) => {
      const f = fixture({
        sitePermissionDecision: () => setting,
        resolveSitePermissionDecision: async () => setting,
        canUseSavedPermissions: () => true,
      });
      expect(f.check("mediaKeySystem")).toBe(setting === "allow");
      const r = f.request("mediaKeySystem");
      await vi.waitFor(() =>
        setting === "ask"
          ? expect(f.emit).toHaveBeenCalled()
          : expect(r.callback).toHaveBeenCalled(),
      );
      if (setting === "ask") r.decide(true);
      expect(r.callback).toHaveBeenCalledExactlyOnceWith(setting !== "block");
    },
  );

  it("shares one prompt across simultaneous files and retains the sibling after one cancellation", async () => {
    const f = fixture({ resolveSitePermissionDecision: async () => "ask" });
    expect(await f.grants.requestAutomaticDownload(f.wc)).toBe(true);
    const cancelled = new AbortController();
    const second = f.grants.requestAutomaticDownload(f.wc, cancelled.signal);
    const third = f.grants.requestAutomaticDownload(f.wc);
    await vi.waitFor(() => expect(f.pending.size).toBe(1));
    expect(f.emit).toHaveBeenCalledOnce();
    cancelled.abort();
    expect(await second).toBe(false);
    expect(f.pending.size).toBe(1);
    [...f.pending.values()][0](true);
    expect(await third).toBe(true);
    expect(await f.grants.requestAutomaticDownload(f.wc)).toBe(true);
    expect(f.emit).toHaveBeenCalledOnce();
  });

  it("removes an abandoned prompt without creating a grant or permanently denying later files", async () => {
    const f = fixture({ resolveSitePermissionDecision: async () => "ask" });
    await f.grants.requestAutomaticDownload(f.wc);
    const cancelled = new AbortController();
    const waiting = f.grants.requestAutomaticDownload(f.wc, cancelled.signal);
    await vi.waitFor(() => expect(f.pending.size).toBe(1));
    const late = [...f.pending.values()][0];
    cancelled.abort();
    expect(await waiting).toBe(false);
    expect(f.pending.size).toBe(0);
    expect(late(true)).toBe(false);
    const next = f.grants.requestAutomaticDownload(f.wc);
    await vi.waitFor(() => expect(f.pending.size).toBe(1));
    [...f.pending.values()][0](true);
    expect(await next).toBe(true);
  });

  it("does not grant an Agent from a saved allow rule", async () => {
    const f = fixture({
      resolveSitePermissionDecision: async () => "allow",
      canUseSavedPermissions: () => false,
    });
    await f.grants.requestAutomaticDownload(f.wc);
    const waiting = f.grants.requestAutomaticDownload(f.wc);
    await vi.waitFor(() => expect(f.pending.size).toBe(1));
    expect(f.emit).toHaveBeenCalledWith(
      "embedded-browser-view-permission-request",
      expect.objectContaining({
        permission: "automatic-downloads",
        decision: "pending",
      }),
    );
    [...f.pending.values()][0](false);
    expect(await waiting).toBe(false);
    expect(await f.grants.requestAutomaticDownload(f.wc)).toBe(false);
    expect(f.emit).toHaveBeenCalledOnce();
  });

  it("keeps the first-file slot consumed through subframe and settings changes, and resets only at main commit", async () => {
    const f = fixture({ resolveSitePermissionDecision: async () => "block" });
    expect(await f.grants.requestAutomaticDownload(f.wc)).toBe(true);
    f.events.emit("frame-created");
    f.events.emit("did-start-navigation", {}, f.frame.url, false, false);
    f.grants.revoke();
    expect(await f.grants.requestAutomaticDownload(f.wc)).toBe(false);
    f.events.emit("did-navigate");
    expect(await f.grants.requestAutomaticDownload(f.wc)).toBe(true);
  });

  it("refuses to attribute a child-frame download to the main origin", async () => {
    const f = fixture({ resolveSitePermissionDecision: async () => "allow" });
    await f.grants.requestAutomaticDownload(f.wc);
    f.frame.framesInSubtree.push({
      ...f.frame,
      url: "https://other.example/",
      routingId: 2,
    });
    expect(await f.grants.requestAutomaticDownload(f.wc)).toBe(false);
    expect(f.emit).not.toHaveBeenCalled();
  });

  it("rejects a late approval after navigation", async () => {
    const f = fixture({ resolveSitePermissionDecision: async () => "ask" });
    await f.grants.requestAutomaticDownload(f.wc);
    const waiting = f.grants.requestAutomaticDownload(f.wc);
    await vi.waitFor(() => expect(f.pending.size).toBe(1));
    f.events.emit("did-start-navigation");
    [...f.pending.values()][0](true);
    expect(await waiting).toBe(false);
  });
});

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

  it.each([
    "geolocation",
    "notifications",
    "clipboard-read",
    "clipboard-sanitized-write",
  ] as const)(
    "uses the saved %s rule for native requests and checks",
    async (permission) => {
      let decision: "ask" | "allow" | "block" = "allow";
      const f = fixture({
        sitePermissionDecision: () => decision,
        resolveSitePermissionDecision: async () => decision,
      });
      expect(f.check(permission)).toBe(true);
      const allowed = f.request(permission);
      await vi.waitFor(() =>
        expect(allowed.callback).toHaveBeenCalledExactlyOnceWith(true),
      );
      decision = "block";
      expect(f.check(permission)).toBe(false);
      const blocked = f.request(permission);
      await vi.waitFor(() =>
        expect(blocked.callback).toHaveBeenCalledExactlyOnceWith(false),
      );
      expect(f.emit.mock.calls.at(-1)?.[1].decision).toBe("blocked");
    },
  );

  it.each(["clipboard-read", "clipboard-sanitized-write"])(
    "maps %s to clipboard without giving the Agent the user's saved allowance",
    async (permission) => {
      const decision = vi.fn(
        (_origin: string, _key: string) => "allow" as const,
      );
      const f = fixture({
        sitePermissionDecision: decision,
        resolveSitePermissionDecision: async (origin, key) =>
          decision(origin, key),
        canUseSavedPermissions: () => false,
      });
      expect(f.check(permission)).toBe(false);
      const request = f.request(permission);
      await vi.waitFor(() =>
        expect(f.emit.mock.calls.at(-1)?.[1].decision).toBe("pending"),
      );
      expect(decision).toHaveBeenCalledWith("https://example.com", "clipboard");
      expect(request.callback).not.toHaveBeenCalled();
      request.decide(true);
      expect(f.check(permission)).toBe(true);
      expect(
        f.check(
          permission === "clipboard-read"
            ? "clipboard-sanitized-write"
            : "clipboard-read",
        ),
      ).toBe(false);
      f.grants.revoke("view");
      expect(f.check(permission)).toBe(false);
    },
  );

  it.each(["did-start-navigation", "render-process-gone", "revoke"])(
    "rejects a late saved allow after %s, even at the same URL",
    async (event) => {
      let resolve!: (setting: "allow") => void;
      const f = fixture({
        resolveSitePermissionDecision: () =>
          new Promise((done) => {
            resolve = done;
          }),
      });
      const request = f.request("media", { mediaTypes: ["video"] });
      if (event === "revoke") f.grants.revoke("view");
      else f.events.emit(event);
      resolve("allow");
      await vi.waitFor(() =>
        expect(request.callback).toHaveBeenCalledExactlyOnceWith(false),
      );
    },
  );

  it("does not use a media hint to authorize an unrelated permission", () => {
    const f = fixture({ sitePermissionDecision: () => "allow" });
    expect(f.check("midi", { mediaType: "video" })).toBe(false);
  });

  it("does not turn a user's saved allow into an Agent permission grant", async () => {
    const f = fixture({
      sitePermissionDecision: () => "allow",
      resolveSitePermissionDecision: async () => "allow",
      canUseSavedPermissions: () => false,
    });
    expect(f.check("notifications")).toBe(false);
    const request = f.request("notifications");
    await vi.waitFor(() =>
      expect(f.emit.mock.calls.at(-1)?.[1].decision).toBe("pending"),
    );
    expect(request.callback).not.toHaveBeenCalled();
    request.decide(false);
    expect(request.callback).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.check("notifications")).toBe(false);
  });

  it("keeps an explicit ask on the document prompt path and honors a subsequent block", async () => {
    let decision: "ask" | "allow" | "block" = "ask";
    const f = fixture({
      sitePermissionDecision: () => decision,
      resolveSitePermissionDecision: async () => decision,
    });
    const request = f.request("notifications");
    await vi.waitFor(() =>
      expect(f.emit.mock.calls.at(-1)?.[1].decision).toBe("pending"),
    );
    expect(request.callback).not.toHaveBeenCalled();
    request.decide(true);
    expect(request.callback).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.check("notifications")).toBe(true);
    decision = "block";
    f.grants.revoke("view");
    expect(f.check("notifications")).toBe(false);
  });

  it("does not create a stale prompt after permission settings changed during the read", async () => {
    let resolve!: (setting: "ask") => void;
    const f = fixture({
      resolveSitePermissionDecision: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const request = f.request("notifications");
    f.grants.revoke("view");
    resolve("ask");
    await vi.waitFor(() =>
      expect(request.callback).toHaveBeenCalledExactlyOnceWith(false),
    );
    expect(f.emit).not.toHaveBeenCalled();
  });
});
