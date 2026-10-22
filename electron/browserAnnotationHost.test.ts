// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserAnnotationHost,
  type BrowserAnnotationTarget,
} from "./browserAnnotationHost";
import {
  BROWSER_ANNOTATION_PAGE_COMMAND,
  BROWSER_ANNOTATION_PAGE_EVENT,
} from "./browserAnnotationModel";
import type {
  BrowserAnnotationCaptureResult,
  BrowserAnnotationSelection,
  BrowserAnnotationSession,
} from "../src/lib/api/browserAnnotationTypes";

const native = vi.hoisted(() => ({
  ipc: undefined as EventEmitter | undefined,
}));
vi.mock("./electronRuntime", async () => {
  const { EventEmitter } = await import("node:events");
  native.ipc = new EventEmitter();
  return { ipcMain: native.ipc };
});

function image(width = 1600, height = 1200) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    toDataURL: () => "data:image/png;base64,cGFnZQ==",
    crop: vi.fn((rect: { width: number; height: number }) =>
      image(rect.width, rect.height),
    ),
    resize: vi.fn((size: { width: number; height: number }) =>
      image(size.width, size.height),
    ),
  };
}
function selection(
  kind: "element" | "region" = "element",
): BrowserAnnotationSelection {
  return {
    kind,
    pageUrl: "https://page.test/",
    pageTitle: "Page",
    frameUrl: "https://page.test/",
    framePath: "main",
    targetRect: { x: 100, y: 150, width: 200, height: 80 },
    viewportSize: { width: 800, height: 600 },
    scrollPosition: { x: 0, y: 20 },
    devicePixelRatio: 3,
    targetSelector: kind === "element" ? "#target" : null,
    targetPath: null,
    targetRole: "button",
    targetText: "Save",
    markerViewportPoint: { x: 100, y: 150 },
  };
}
const hosts: BrowserAnnotationHost[] = [];
function fixture(mode: "always" | "necessary" = "always") {
  let visible = true;
  let bounds = { x: 10, y: 40, width: 800, height: 600 };
  const screenshot = image();
  const frame = { send: vi.fn() };
  const webContents = Object.assign(new EventEmitter(), {
    id: 31,
    mainFrame: frame,
    isDestroyed: () => false,
    isLoading: () => false,
    focus: vi.fn(),
    getURL: () => "https://page.test/",
    getTitle: () => "Page",
    capturePage: vi.fn(async () => screenshot),
  });
  const view = {
    webContents,
    getVisible: () => visible,
    getBounds: () => bounds,
  };
  const owner = Object.assign(new EventEmitter(), { id: 21 });
  const window = Object.assign(new EventEmitter(), {
    id: 11,
    webContents: owner,
    isDestroyed: () => false,
    contentView: { children: [view] },
  });
  const target = {
    identity: {
      browserSessionId: "browser-1",
      threadId: "thread-1",
      tabId: "tab-1",
      viewId: "view-1",
      ownerWebContentsId: 21,
      webContentsId: 31,
      windowId: 11,
      pageRevision: 2,
    },
    selected: true,
    view,
    window,
  };
  const events: { event: string; payload: unknown }[] = [];
  const host = new BrowserAnnotationHost({
    resolveTarget: (tabId) =>
      tabId === "tab-1" ? (target as unknown as BrowserAnnotationTarget) : null,
    emit: (event, payload) => events.push({ event, payload }),
    screenshotMode: () => mode,
    timeoutMs: 10,
  });
  hosts.push(host);
  const invoke = (
    command:
      | "browser_tab_begin_annotation"
      | "browser_tab_cancel_annotation"
      | "browser_tab_capture_annotation",
    args: Record<string, unknown>,
  ) => host.invoke(window as never, command, args);
  let begin: Record<string, unknown>;
  const message = (
    payload: Record<string, unknown>,
    event: Record<string, unknown> = {},
  ) =>
    native.ipc!.emit(
      BROWSER_ANNOTATION_PAGE_EVENT,
      { sender: webContents, senderFrame: frame, ...event },
      { ...begin, documentToken: "document-1", ...payload },
    );
  const start = async (kind: "element" | "region" = "element") => {
    const session = (await invoke("browser_tab_begin_annotation", {
      tabId: "tab-1",
      kind,
    })) as BrowserAnnotationSession;
    const call = frame.send.mock.calls.at(-1)!;
    expect(call[0]).toBe(BROWSER_ANNOTATION_PAGE_COMMAND);
    begin = call[1];
    message({ type: "began" });
    return session;
  };
  const capture = (annotationId: string) =>
    invoke("browser_tab_capture_annotation", {
      tabId: "tab-1",
      annotationId,
    }) as Promise<BrowserAnnotationCaptureResult>;
  const ready = (source: BrowserAnnotationSelection) => {
    const prepare = [...frame.send.mock.calls]
      .reverse()
      .find((call) => call[1].type === "prepare")![1];
    message({
      type: "ready",
      requestId: prepare.requestId,
      status: "ready",
      selection: source,
    });
  };
  return {
    host,
    target,
    window,
    owner,
    view,
    webContents,
    frame,
    screenshot,
    events,
    invoke,
    start,
    message,
    ready,
    capture,
    hide: () => {
      visible = false;
    },
    resize: () => {
      bounds = { ...bounds, width: 700 };
    },
  };
}
afterEach(() => {
  hosts.splice(0).forEach((host) => host.dispose());
  vi.useRealTimers();
});

describe("Browser annotation native authority", () => {
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
    expect(native.ipc!.listenerCount(BROWSER_ANNOTATION_PAGE_EVENT)).toBe(0);
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
        type: "clear",
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

  it("returns an explicit ready timeout with null screenshot and always clears page screenshot state", async () => {
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
    expect(f.frame.send.mock.calls.at(-1)?.[1].type).toBe("clear");
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
    expect(f.frame.send.mock.calls.at(-1)?.[1].type).toBe("clear");
  });

  it("rejects a changed ready geometry and supports retry after a native capture failure", async () => {
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
    const retried = f.capture(session.annotationId);
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
