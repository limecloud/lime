// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  fixture,
  image,
  nativeEvents,
  selection,
} from "./browserAnnotationHost.testFixture";
import {
  BROWSER_ANNOTATION_PAGE_COMMAND,
  BROWSER_ANNOTATION_PAGE_EVENT,
} from "./browserAnnotationModel";
import type {
  BrowserAnnotationSelection,
  BrowserAnnotationSession,
} from "../src/lib/api/browserAnnotationTypes";
describe("Browser annotation native authority", () => {
  it("pauses saved markers while hidden and restores the same document with a fresh read-only token", async () => {
    const f = fixture();
    const session = await f.start();
    const source = selection();
    f.message({ type: "selection", selection: source });
    const capture = f.capture(session.annotationId);
    f.ready(source);
    const original = await capture;
    const old = f.frame.send.mock.calls.at(-1)![1];
    f.hide();
    f.host.revalidateView("view-1");
    const hidden = f.frame.send.mock.calls.at(-1)![1];
    expect(hidden).toMatchObject({ type: "hide-marker", token: old.token });
    expect(hidden.nextToken).not.toBe(old.token);
    f.message({ ...old, type: "activate" });
    f.message({ ...old, token: hidden.nextToken, type: "activate" });
    expect(
      f.events.filter((event) => event.event.endsWith("activate")),
    ).toEqual([]);
    await expect(f.capture(session.annotationId)).rejects.toThrow(
      "unavailable",
    );
    f.show();
    f.message({ ...old, token: hidden.nextToken, type: "marker-restored" });
    f.message({ ...old, token: hidden.nextToken, type: "activate" });
    expect(
      f.events.filter((event) => event.event.endsWith("activate")),
    ).toEqual([]);
    f.host.revalidateView("view-1");
    const restored = f.frame.send.mock.calls.at(-1)![1];
    expect(restored).toMatchObject({
      type: "restore-marker",
      token: hidden.nextToken,
      documentToken: "document-1",
    });
    for (const wrong of [
      { token: old.token },
      { documentToken: "new-document" },
      { pageRevision: 0 },
    ])
      f.message({ ...restored, type: "marker-restored", ...wrong });
    f.message({ ...restored, type: "marker-restored" }, { senderFrame: {} });
    f.message({ ...restored, type: "activate" });
    expect(
      f.events.filter((event) => event.event.endsWith("activate")),
    ).toEqual([]);
    f.message({ ...restored, type: "marker-restored" });
    f.message({ ...restored, type: "activate" });
    expect(f.events.at(-1)).toEqual({
      event: "browser-tab-annotation-activate",
      payload: { ...session, presentationPageRevision: session.pageRevision },
    });
    expect(original.selection).toEqual(source);
    expect(f.webContents.capturePage).toHaveBeenCalledTimes(1);
    await expect(f.capture(session.annotationId)).rejects.toThrow(
      "unavailable",
    );
    expect(f.webContents.listenerCount("did-start-navigation")).toBe(1);
    vi.useFakeTimers();
    f.hide();
    f.host.revalidateView("view-1");
    f.show();
    f.host.revalidateView("view-1");
    const interrupted = f.frame.send.mock.calls.at(-1)![1];
    f.hide();
    f.host.revalidateView("view-1");
    const pausedAgain = f.frame.send.mock.calls.at(-1)![1];
    expect(pausedAgain.nextToken).not.toBe(interrupted.token);
    await vi.advanceTimersByTimeAsync(11);
    f.message({ ...interrupted, type: "marker-restored" });
    expect(
      f.events.filter((event) => event.event.endsWith("cancelled")),
    ).toEqual([]);
    f.show();
    f.host.revalidateView("view-1");
    const resumedAgain = f.frame.send.mock.calls.at(-1)![1];
    expect(resumedAgain.token).toBe(pausedAgain.nextToken);
    f.message({ ...resumedAgain, type: "marker-restored" });
    f.message({ ...resumedAgain, type: "activate" });
    expect(
      f.events.filter((event) => event.event.endsWith("activate")),
    ).toHaveLength(2);
  });

  it("preserves saved markers on tab switching but retires them on revision changes, deletion or restore timeout", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const session = await f.start();
    const source = selection();
    f.message({ type: "selection", selection: source });
    const capture = f.capture(session.annotationId);
    f.ready(source);
    await capture;
    f.host.cancelWindow(f.window.id, "tab-switch");
    expect(
      f.events.filter((event) => event.event.endsWith("cancelled")),
    ).toEqual([]);
    f.target.identity.pageRevision += 1;
    f.host.revalidateView("view-1");
    expect(f.events.at(-1)).toMatchObject({
      payload: { reason: "page-changed" },
    });
    const next = await f.start();
    f.message({ type: "selection", selection: source });
    const nextCapture = f.capture(next.annotationId);
    f.ready(source);
    await nextCapture;
    f.host.cancelWindow(f.window.id, "tab-switch");
    await f.invoke("browser_tab_cancel_annotation", {
      tabId: "tab-1",
      annotationId: next.annotationId,
    });
    expect(f.events.at(-1)).toMatchObject({
      payload: { annotationId: next.annotationId, reason: "cancelled" },
    });
    const final = await f.start();
    f.message({ type: "selection", selection: source });
    const finalCapture = f.capture(final.annotationId);
    f.ready(source);
    await finalCapture;
    f.host.cancelWindow(f.window.id, "tab-switch");
    f.host.revalidateView("view-1");
    await vi.advanceTimersByTimeAsync(11);
    expect(f.events.at(-1)).toMatchObject({
      payload: {
        annotationId: final.annotationId,
        reason: "marker-restore-timeout",
      },
    });
    expect(f.window.listenerCount("resize")).toBe(0);
  });
  it("keeps captured anchors separate from a new picker and validates live layout without changing capture", async () => {
    const f = fixture();
    const session = await f.start();
    const source = selection();
    f.message({ type: "selection", selection: source });
    const capture = f.capture(session.annotationId);
    f.ready(source);
    const result = await capture;
    const credentials = f.frame.send.mock.calls.at(-1)![1];
    await expect(f.capture(session.annotationId)).rejects.toThrow(
      "unavailable",
    );
    const second = await f.start();
    expect(f.webContents.listenerCount("did-start-navigation")).toBe(1);
    expect(f.window.listenerCount("resize")).toBe(1);
    expect(
      f.events.filter((event) => event.event.endsWith("cancelled")),
    ).toEqual([]);
    const anchor = {
      viewportSize: { width: 700, height: 600 },
      targetRect: { x: 80, y: 20, width: 200, height: 80 },
    };
    f.resize();
    for (const wrong of [
      { token: "wrong" },
      { documentToken: "old" },
      { pageRevision: 0 },
    ])
      f.message({ ...credentials, type: "anchor", anchor, ...wrong });
    f.message({ ...credentials, type: "anchor", anchor }, { senderFrame: {} });
    expect(f.onAnchor).not.toHaveBeenCalled();
    f.message({ ...credentials, type: "anchor", anchor });
    expect(f.onAnchor).toHaveBeenCalledWith(
      session,
      anchor,
      f.view.getBounds(),
    );
    f.onAnchor.mockClear();
    f.host.revalidateView("view-1");
    expect(f.onAnchor).toHaveBeenCalledWith(
      session,
      anchor,
      f.view.getBounds(),
    );
    expect(result.selection).toEqual(source);
    f.message({ ...credentials, type: "activate" });
    expect(f.events.at(-1)).toEqual({
      event: "browser-tab-annotation-activate",
      payload: { ...session, presentationPageRevision: session.pageRevision },
    });
    await f.invoke("browser_tab_cancel_annotation", {
      tabId: "tab-1",
      annotationId: session.annotationId,
    });
    f.message({ ...credentials, type: "activate" });
    expect(f.events.at(-1)).toMatchObject({
      event: "browser-tab-annotation-cancelled",
      payload: { annotationId: session.annotationId },
    });
    f.message({ type: "selection", selection: source });
    // Revalidation already revoked the picking session; its delayed page input cannot revive it.
    expect(f.events).toContainEqual(
      expect.objectContaining({
        event: "browser-tab-annotation-cancelled",
        payload: expect.objectContaining({ annotationId: second.annotationId }),
      }),
    );
  });
  it("upgrades the element picker to text and preserves validated text metadata through capture", async () => {
    const f = fixture("necessary");
    const session = await f.start();
    const source: BrowserAnnotationSelection = {
      ...selection(),
      kind: "text",
      targetText: "a😀b",
      targetRole: "text",
      textLocator: {
        kind: "dom",
        selector: "#text",
        shadowHosts: [],
        direction: "forward",
        rangeText: "a😀b",
        startOffset: 1,
        endOffset: 5,
      },
      selectionRects: [{ x: 100, y: 150, width: 50, height: 20 }],
    };
    f.message({ type: "selection", selection: source, token: "forged" });
    expect(f.events).toEqual([]);
    f.message({ type: "selection", selection: source });
    expect(f.events.at(-1)).toMatchObject({
      event: "browser-tab-annotation-selection",
      payload: {
        kind: "text",
        annotationId: session.annotationId,
        selection: source,
      },
    });
    const captured = f.capture(session.annotationId);
    f.ready(source);
    expect(await captured).toMatchObject({
      screenshotStatus: "captured",
      selection: source,
      screenshot: { kind: "crop" },
    });
  });
  it("fails closed when the page preload cannot acknowledge a begin", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const session = (await f.invoke("browser_tab_begin_annotation", {
      tabId: "tab-1",
      kind: "element",
    })) as BrowserAnnotationSession;
    await vi.advanceTimersByTimeAsync(11);
    expect(f.events.at(-1)).toMatchObject({
      event: "browser-tab-annotation-cancelled",
      payload: {
        annotationId: session.annotationId,
        reason: "page-preload-timeout",
      },
    });
    await expect(f.capture(session.annotationId)).rejects.toThrow(
      "unavailable",
    );
  });
  it("accepts only the exact page sender, main frame, session token, document and revision", async () => {
    const f = fixture();
    const session = await f.start();
    const source = selection();
    for (const payload of [
      { token: "forged" },
      { annotationId: "old" },
      { pageRevision: 1 },
      { documentToken: "other-document" },
    ])
      f.message({ type: "selection", selection: source, ...payload });
    f.message({ type: "selection", selection: source }, { senderFrame: {} });
    f.message(
      { type: "selection", selection: source },
      { sender: { id: 31, mainFrame: f.frame } },
    );
    f.message({
      type: "selection",
      selection: {
        ...source,
        targetRect: { ...source.targetRect, width: Infinity },
      },
    });
    expect(f.events).toEqual([]);
    f.message({
      type: "selection",
      selection: {
        ...source,
        pageUrl: "https://forged.test",
        frameUrl: "https://forged.test",
        pageTitle: "forged",
      },
    });
    expect(f.events).toEqual([
      {
        event: "browser-tab-annotation-selection",
        payload: { ...session, selection: source },
      },
    ]);
    await expect(
      f.invoke("browser_tab_capture_annotation", {
        tabId: "tab-1",
        annotationId: session.annotationId,
        rect: source.targetRect,
      }),
    ).rejects.toThrow("Unknown");
  });

  it("requires the selected, visible attached native page and the owning window", async () => {
    const f = fixture();
    f.target.selected = false;
    await expect(f.start()).rejects.toThrow("selected");
    f.target.selected = true;
    f.window.contentView.children = [];
    await expect(f.start()).rejects.toThrow("attached");
    f.window.contentView.children = [f.view];
    f.hide();
    await expect(f.start()).rejects.toThrow("visible");
    await expect(
      f.host.invoke(
        { ...f.window, id: 99 } as never,
        "browser_tab_begin_annotation",
        { tabId: "tab-1", kind: "element" },
      ),
    ).rejects.toThrow("owner");
  });

  it.each(["did-start-navigation", "destroyed", "render-process-gone"])(
    "cancels on %s and removes per-session listeners",
    async (event) => {
      const f = fixture();
      const session = await f.start();
      f.webContents.emit(event, {}, "https://next.test", false, true);
      expect(f.events.at(-1)).toMatchObject({
        event: "browser-tab-annotation-cancelled",
        payload: { annotationId: session.annotationId },
      });
      expect(f.webContents.listenerCount("did-start-navigation")).toBe(0);
      expect(f.owner.listenerCount("did-start-navigation")).toBe(0);
    },
  );

  it("resumes only the current document on native view or window blur and retires its listeners", async () => {
    const f = fixture();
    const first = await f.start();
    const obsolete = f.webContents.listeners("blur")[0];
    for (const owner of [f.webContents, f.window]) {
      f.frame.send.mockClear();
      f.events.length = 0;
      owner.emit("blur");
      expect(f.frame.send).toHaveBeenCalledWith(
        BROWSER_ANNOTATION_PAGE_COMMAND,
        {
          type: "resume",
          annotationId: first.annotationId,
          token: expect.any(String),
          documentToken: "document-1",
          pageRevision: first.pageRevision,
        },
      );
      expect(f.events).toEqual([
        {
          event: "browser-tab-annotation-input-state",
          payload: { ...first, suspended: false, addModifierPressed: false },
        },
      ]);
    }
    await f.start();
    f.frame.send.mockClear();
    obsolete();
    expect(f.frame.send).not.toHaveBeenCalled();
    f.target.identity.pageRevision += 1;
    f.window.emit("blur");
    expect(f.frame.send).not.toHaveBeenCalled();
    f.host.revalidateView("view-1");
    expect(f.window.listenerCount("blur")).toBe(0);
    expect(f.webContents.listenerCount("blur")).toBe(0);
  });

  it("revalidates viewport, route revision and tab visibility without trusting a cached target", async () => {
    const f = fixture();
    await f.start();
    f.resize();
    f.host.revalidateView("view-1");
    expect(f.events.at(-1)?.event).toBe("browser-tab-annotation-cancelled");
    await f.start();
    f.target.identity.pageRevision += 1;
    f.host.revalidateView("view-1");
    expect(
      f.events.filter((event) => event.event.endsWith("cancelled")),
    ).toHaveLength(2);
    await f.start();
    f.target.selected = false;
    f.host.revalidateView("view-1");
    expect(
      f.events.filter((event) => event.event.endsWith("cancelled")),
    ).toHaveLength(3);
  });

  it("ignores an obsolete cancel request and cancels only the requested current session", async () => {
    const f = fixture();
    const first = await f.start();
    const second = await f.start();
    expect(
      await f.invoke("browser_tab_cancel_annotation", {
        tabId: "tab-1",
        annotationId: first.annotationId,
      }),
    ).toEqual({ annotationId: first.annotationId, cancelled: false });
    expect(
      await f.invoke("browser_tab_cancel_annotation", {
        tabId: "tab-1",
        annotationId: second.annotationId,
      }),
    ).toEqual({ annotationId: second.annotationId, cancelled: true });
    f.host.dispose();
    expect(nativeEvents().listenerCount(BROWSER_ANNOTATION_PAGE_EVENT)).toBe(0);
  });
});

describe("Browser annotation screenshot handshake", () => {
  it("allows the element tool to produce a region selection, and captures using that actual kind", async () => {
    const f = fixture("necessary");
    const session = await f.start("element");
    const source = selection("region");
    f.message({ type: "selection", selection: source });
    expect(f.events.at(-1)).toMatchObject({
      event: "browser-tab-annotation-selection",
      payload: {
        annotationId: session.annotationId,
        kind: "region",
        selection: { kind: "region" },
      },
    });
    const capture = f.capture(session.annotationId);
    f.ready(source);
    expect(await capture).toMatchObject({
      screenshotStatus: "captured",
      screenshot: { kind: "crop" },
    });
    const second = await f.start("region");
    f.message({ type: "selection", selection: selection("element") });
    expect(f.events.at(-1)).not.toMatchObject({
      event: "browser-tab-annotation-selection",
      payload: { annotationId: second.annotationId },
    });
  });
  it.each(["always", "necessary"] as const)(
    "captures element viewport in %s mode and limits the longest image edge",
    async (mode) => {
      const f = fixture(mode);
      const session = await f.start();
      const source = selection();
      f.message({ type: "selection", selection: source });
      const capture = f.capture(session.annotationId);
      f.ready(source);
      expect(await capture).toMatchObject({
        screenshotStatus: "captured",
        failureReason: null,
        screenshot: { kind: "viewport", width: 1280, height: 960 },
      });
      expect(f.screenshot.crop).not.toHaveBeenCalled();
      expect(f.frame.send.mock.calls.at(-1)?.[1]).toMatchObject({
        type: "retain",
      });
    },
  );

  it("crops region + marker using captured image scale, independent of claimed devicePixelRatio", async () => {
    const f = fixture("necessary");
    const session = await f.start("region");
    const source = selection("region");
    f.message({ type: "selection", selection: source });
    const capture = f.capture(session.annotationId);
    f.ready(source);
    const result = await capture;
    expect(result).toMatchObject({
      screenshotStatus: "captured",
      screenshot: {
        kind: "crop",
        width: 488,
        height: 248,
        cropRect: { x: 72, y: 122, width: 244, height: 124 },
      },
    });
    expect(f.screenshot.crop).toHaveBeenCalledWith({
      x: 144,
      y: 244,
      width: 488,
      height: 248,
    });
  });

  it("returns an explicit ready timeout with null screenshot and releases the picker into a retained anchor", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const session = await f.start();
    f.message({ type: "selection", selection: selection() });
    const capture = f.capture(session.annotationId);
    await vi.advanceTimersByTimeAsync(11);
    expect(await capture).toMatchObject({
      screenshot: null,
      screenshotStatus: "timeout",
      failureReason: "page-ready-timeout",
    });
    expect(f.webContents.capturePage).not.toHaveBeenCalled();
    expect(f.frame.send.mock.calls.at(-1)?.[1].type).toBe("retain");
  });

  it("bounds native capture time and ignores a late ready request from another capture", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const session = await f.start();
    const source = selection();
    f.message({ type: "selection", selection: source });
    f.webContents.capturePage.mockReturnValueOnce(new Promise(() => undefined));
    const capture = f.capture(session.annotationId);
    f.message({
      type: "ready",
      requestId: "another-capture",
      status: "ready",
      selection: source,
    });
    expect(f.webContents.capturePage).not.toHaveBeenCalled();
    f.ready(source);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(51);
    expect(await capture).toMatchObject({
      screenshot: null,
      screenshotStatus: "timeout",
      failureReason: "capture-timeout",
    });
    expect(f.frame.send.mock.calls.at(-1)?.[1].type).toBe("retain");
  });

  it("rejects a changed ready geometry and retains a failed capture without granting recapture authority", async () => {
    const f = fixture();
    const session = await f.start();
    const source = selection();
    f.message({ type: "selection", selection: source });
    const stale = f.capture(session.annotationId);
    f.ready({ ...source, targetRect: { ...source.targetRect, x: 102 } });
    expect(await stale).toMatchObject({
      screenshot: null,
      screenshotStatus: "stale",
    });
    expect(f.webContents.capturePage).not.toHaveBeenCalled();
    f.webContents.capturePage.mockRejectedValueOnce(
      new Error("GPU unavailable"),
    );
    const failed = f.capture(session.annotationId);
    f.ready(source);
    expect(await failed).toMatchObject({
      screenshot: null,
      screenshotStatus: "failed",
      failureReason: "capture-failed",
    });
    await expect(f.capture(session.annotationId)).rejects.toThrow(
      "unavailable",
    );
    const next = await f.start();
    f.message({ type: "selection", selection: source });
    const retried = f.capture(next.annotationId);
    f.ready(source);
    expect((await retried).screenshotStatus).toBe("captured");
  });

  it("discards a late capture without cancelling its replacement annotation", async () => {
    const f = fixture();
    const first = await f.start();
    const source = selection();
    f.message({ type: "selection", selection: source });
    let resolve!: (value: ReturnType<typeof image>) => void;
    f.webContents.capturePage.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const captured = f.capture(first.annotationId);
    f.ready(source);
    await Promise.resolve();
    const replacement = await f.start();
    resolve(image());
    expect(await captured).toMatchObject({
      screenshot: null,
      screenshotStatus: "stale",
    });
    f.message({ type: "selection", selection: source });
    expect(f.events.at(-1)).toMatchObject({
      event: "browser-tab-annotation-selection",
      payload: { annotationId: replacement.annotationId },
    });
  });
});
