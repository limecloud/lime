// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserAnnotationEditorHost, browserAnnotationEditorUrl, type BrowserAnnotationEditorHostEvent } from "./browserAnnotationEditorHost";
import { BrowserOverlayHost } from "./browserOverlayHost";
import { BROWSER_ANNOTATION_EDITOR_CHANNEL, BROWSER_ANNOTATION_EDITOR_UPDATE, type BrowserAnnotationEditorPresentation } from "../src/lib/api/browserAnnotationEditorTypes";
import type { BrowserAnnotationIdentity } from "../src/lib/api/browserAnnotationTypes";

interface TestContents extends EventEmitter {
  id: number;
  mainFrame: object;
  isDestroyed: () => boolean;
  getURL: () => string;
  focus: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
}
interface TestView {
  webContents: TestContents;
  options: { webPreferences: { preload: string; additionalArguments: string[]; sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean } };
  setBounds: ReturnType<typeof vi.fn>;
}
const native = vi.hoisted(() => ({ views: [] as TestView[], ipc: undefined as EventEmitter | undefined, nextLoad: undefined as Promise<void> | undefined }));

vi.mock("./electronRuntime", async () => {
  const { EventEmitter } = await import("node:events");
  native.ipc = new EventEmitter();
  return { ipcMain: native.ipc, WebContentsView: class {
    options: TestView["options"];
    webContents: TestContents;
    constructor(options: TestView["options"]) {
      this.options = options;
      let destroyed = false;
      let url = "";
      this.webContents = Object.assign(new EventEmitter(), {
        id: native.views.length + 100, mainFrame: {}, isDestroyed: () => destroyed, getURL: () => url, focus: vi.fn(),
        setWindowOpenHandler: vi.fn(), send: vi.fn(),
        loadURL: vi.fn((destination: string) => { url = destination; return native.nextLoad ?? Promise.resolve(); }),
        close: vi.fn(() => { destroyed = true; this.webContents.emit("destroyed"); }),
      });
      native.views.push(this);
    }
    setBounds = vi.fn();
    setBackgroundColor = vi.fn();
  } };
});

function presentation(editorId = "editor-1"): BrowserAnnotationEditorPresentation {
  return { editorId, annotationId: "annotation-1", draftId: "draft-1", body: "", revision: 0, appearance: "light", screenshotStatus: "captured",
    labels: { title: "Comment", placeholder: "Write a comment", save: "Save", send: "Send", close: "Close", element: "Element", region: "Region", captureFailed: "Capture failed", sending: "Sending", sendFailed: "Send failed" },
    selection: { kind: "element", pageUrl: "https://example.test/", pageTitle: "Example", frameUrl: "https://example.test/", framePath: "main",
      targetRect: { x: 600, y: 400, width: 80, height: 80 }, viewportSize: { width: 700, height: 500 }, scrollPosition: { x: 0, y: 0 }, devicePixelRatio: 2,
      targetSelector: "#target", targetPath: "main > button", targetRole: "button", targetText: "Example", markerViewportPoint: { x: 680, y: 480 } },
  };
}

function fixture(overlay = false, windowId = 1) {
  let focused = true;
  const owner = Object.assign(new EventEmitter(), { id: windowId + 10, isDestroyed: () => false, getURL: () => "http://localhost:1420/index.html#/thread/1", focus: vi.fn() });
  const page = Object.assign(new EventEmitter(), { id: windowId + 20, isDestroyed: () => false, focus: vi.fn() });
  const visible = new Set<TestView>();
  const window = Object.assign(new EventEmitter(), { id: windowId, webContents: owner, isDestroyed: () => false, isFocused: () => focused,
    getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }), contentView: {
      addChildView: vi.fn((view: TestView) => { visible.add(view); }), removeChildView: vi.fn((view: TestView) => { visible.delete(view); }),
    } });
  const identity: BrowserAnnotationIdentity = { browserSessionId: "session-1", threadId: "thread-1", tabId: "tab-1", viewId: "view-1", windowId, ownerWebContentsId: owner.id, webContentsId: page.id, pageRevision: 7 };
  const events: BrowserAnnotationEditorHostEvent[] = [];
  const host = overlay
    ? new BrowserOverlayHost(() => {}, { onAnnotationEvent: event => events.push(event), annotationPreloadPath: "/isolated/browserAnnotationEditor.cjs" })
    : new BrowserAnnotationEditorHost(event => events.push(event), { preloadPath: "/isolated/browserAnnotationEditor.cjs" });
  const show = (value = presentation()) => host instanceof BrowserOverlayHost
    ? host.showAnnotation(window as never, "view-1", value, page as never, { x: 100, y: 80, width: 700, height: 500 }, identity)
    : host.show(window as never, "view-1", value, page as never, { x: 100, y: 80, width: 700, height: 500 }, identity);
  return { host, owner, page, window, identity, events, visible, show, blur: () => { focused = false; window.emit("blur"); } };
}

function message(view: TestView, fields: Record<string, unknown>, senderFrame = view.webContents.mainFrame, sender = view.webContents) {
  const args = view.options.webPreferences.additionalArguments;
  const argument = (key: string) => args.find(value => value.startsWith(`--${key}=`))!.split("=")[1];
  native.ipc!.emit(BROWSER_ANNOTATION_EDITOR_CHANNEL, { sender, senderFrame }, {
    token: argument("browser-annotation-token"), editorId: argument("browser-annotation-id"), generation: Number(argument("browser-annotation-generation")), ...fields,
  });
}

function flush(view: TestView, body: string, revision: number) {
  const request = view.webContents.send.mock.calls.filter(([channel, value]) => channel === BROWSER_ANNOTATION_EDITOR_UPDATE && value.kind === "flush").at(-1)?.[1];
  expect(request).toBeDefined();
  message(view, { kind: "flushed", flushId: request.flushId, body, revision });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); native.views.length = 0; native.nextLoad = undefined; native.ipc?.removeAllListeners(); });

describe("trusted browser annotation editor", () => {
  it("derives only the fixed local entry and rejects remote or credentialed owners", () => {
    expect(browserAnnotationEditorUrl("http://127.0.0.1:1420/path?token=secret#route")).toBe("http://127.0.0.1:1420/browser-annotation.html");
    expect(browserAnnotationEditorUrl("file:///Applications/Lime.app/Contents/Resources/dist/index.html#/thread")).toBe("file:///Applications/Lime.app/Contents/Resources/dist/browser-annotation.html");
    for (const url of ["https://example.test/index.html", "data:text/html,local", "file://remote/share/index.html", "http://user:password@localhost:1420/"]) expect(() => browserAnnotationEditorUrl(url)).toThrow();
  });

  it("places a compact sandboxed native view within the window and refuses child navigation", async () => {
    const f = fixture();
    expect(await f.show()).toEqual({ editorId: "editor-1", generation: 1, visible: true });
    const view = native.views[0];
    expect(view.webContents.loadURL).toHaveBeenCalledExactlyOnceWith("http://localhost:1420/browser-annotation.html");
    expect(view.options.webPreferences).toMatchObject({ preload: "/isolated/browserAnnotationEditor.cjs", sandbox: true, contextIsolation: true, nodeIntegration: false });
    const bounds = view.setBounds.mock.calls[0][0];
    expect(bounds).toMatchObject({ width: 360, height: 264 });
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(800);
    expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(600);
    expect(view.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: "deny" });
    for (const name of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
      const event = { preventDefault: vi.fn() }; view.webContents.emit(name, event); expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    view.webContents.emit("frame-created", {}, { frame: { parent: {} } });
    expect(f.visible.size).toBe(0);
    flush(view, "", 0);
    expect(view.webContents.close).toHaveBeenCalledOnce();
    f.host.dispose();
  });

  it("checks exact sender, frame, nonce, generation and monotonic body revision", async () => {
    const f = fixture(); await f.show(); const view = native.views[0];
    const change = { kind: "action", action: "change", body: "First", revision: 1 };
    message(view, { ...change, token: "forged" });
    message(view, { ...change, generation: 0 });
    message(view, { ...change, editorId: "other" });
    message(view, change, {});
    message(view, change, view.webContents.mainFrame, { id: view.webContents.id } as TestContents);
    expect(f.events).toEqual([]);
    message(view, change);
    message(view, change);
    message(view, { ...change, body: "Changed without revision" });
    message(view, { ...change, revision: 0 });
    message(view, { ...change, revision: Number.NaN });
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({ action: "change", body: "First", revision: 1, pageRevision: 7 });
    f.host.hide("view-1"); flush(view, "First", 1); f.host.dispose();
  });

  it("locks duplicate send and close while pending, and only a matching failure permits retry", async () => {
    const f = fixture(); await f.show(); const view = native.views[0]; const host = f.host as BrowserAnnotationEditorHost;
    const send = { kind: "action", action: "send", body: "Comment", revision: 1 };
    message(view, send); message(view, send);
    message(view, { ...send, action: "save" }); message(view, { ...send, action: "close" });
    expect(f.visible.size).toBe(1); expect(f.events.filter(event => event.action === "send")).toHaveLength(1);
    expect(() => host.update("view-1", { editorId: "editor-1", generation: 0, pending: false, error: true })).toThrow("stale");
    message(view, send); expect(f.events).toHaveLength(1);
    host.update("view-1", { editorId: "editor-1", generation: 1, pending: false, error: true });
    message(view, send); expect(f.events.filter(event => event.action === "send")).toHaveLength(2);
    host.update("view-1", { editorId: "editor-1", generation: 1, pending: false, error: false });
    message(view, send); expect(f.events.filter(event => event.action === "send")).toHaveLength(2);
    f.host.hide("view-1"); flush(view, "Comment", 1); f.host.dispose();
  });

  it("removes presentation immediately, then flushes only a draft against the captured identity", async () => {
    const f = fixture(); await f.show(); const view = native.views[0];
    message(view, { kind: "action", action: "change", body: "Known", revision: 1 });
    f.identity.pageRevision = 99;
    f.page.emit("did-start-navigation", {}, "https://other.test/", false, true);
    expect(f.visible.size).toBe(0); expect(view.webContents.close).not.toHaveBeenCalled();
    message(view, { kind: "action", action: "send", body: "Must not send", revision: 2 });
    message(view, { kind: "flushed", flushId: "forged", body: "Must not save", revision: 2 });
    expect(f.events.map(event => event.action)).toEqual(["change"]);
    flush(view, "Latest canonical draft", 2);
    expect(f.events.at(-1)).toMatchObject({ action: "close", body: "Latest canonical draft", revision: 2, pageRevision: 7, threadId: "thread-1" });
    expect(view.webContents.close).toHaveBeenCalledOnce();
    flush(view, "Too late", 3); expect(f.events).toHaveLength(2);
    f.host.dispose();
  });

  it.each(["blur", "resize", "closed"])("preserves the acknowledged draft when %s cannot finish the flush", async name => {
    const f = fixture(); await f.show(); const view = native.views[0];
    message(view, { kind: "action", action: "change", body: "Acknowledged", revision: 1 });
    if (name === "blur") f.blur(); else f.window.emit(name);
    vi.advanceTimersByTime(249); expect(view.webContents.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(view.webContents.close).toHaveBeenCalledOnce();
    expect(f.events.at(-1)).toMatchObject({ action: "close", body: "Acknowledged", revision: 1 });
    expect(f.window.listenerCount("blur")).toBe(0); expect(f.page.listenerCount("did-start-navigation")).toBe(0);
    f.host.dispose(); expect(native.ipc!.listenerCount(BROWSER_ANNOTATION_EDITOR_CHANNEL)).toBe(0);
  });

  it("keeps one menu or editor visible and does not restack a draining editor", async () => {
    const f = fixture(true); const host = f.host as BrowserOverlayHost;
    await host.show(f.window as never, "view-1", { menuId: "menu-1", anchor: { x: 10, y: 10, width: 20, height: 20 }, items: [{ id: "print", label: "Print" }] }, f.page as never);
    const menu = native.views[0];
    await f.show(); expect(menu.webContents.close).toHaveBeenCalledOnce(); expect(f.visible.size).toBe(1);
    const editor = native.views[1];
    host.restack(1); expect(f.visible.has(editor)).toBe(true);
    await host.show(f.window as never, "view-1", { menuId: "menu-2", anchor: { x: 10, y: 10, width: 20, height: 20 }, items: [{ id: "print", label: "Print" }] }, f.page as never);
    expect(f.visible.size).toBe(1); expect(f.visible.has(editor)).toBe(false);
    host.restack(1); expect(f.visible.has(editor)).toBe(false);
    flush(editor, "Saved on replacement", 1);
    expect(native.views[2].webContents.close).not.toHaveBeenCalled();
    host.dispose();
  });

  it("isolates windows and a late load failure from a replacement generation", async () => {
    const f = fixture(); const other = fixture(false, 2);
    let reject!: (error: Error) => void;
    native.nextLoad = new Promise<void>((_resolve, fail) => { reject = fail; });
    const old = f.show(); const rejected = expect(old).rejects.toThrow("old load");
    native.nextLoad = undefined;
    expect(await f.show(presentation("editor-2"))).toEqual({ editorId: "editor-2", generation: 2, visible: true });
    await other.show(); reject(new Error("old load")); await rejected;
    expect(native.views[1].webContents.close).not.toHaveBeenCalled();
    f.host.hide("view-1"); flush(native.views[1], "", 0);
    expect(native.views[2].webContents.close).not.toHaveBeenCalled();
    f.host.dispose(); other.host.dispose();
  });

  it("retains the narrow listener only until disposed editors finish their bounded draft flush", async () => {
    const f = fixture(); await f.show(); const view = native.views[0];
    f.host.dispose(); expect(native.ipc!.listenerCount(BROWSER_ANNOTATION_EDITOR_CHANNEL)).toBe(1);
    flush(view, "Final draft", 1);
    expect(f.events.at(-1)).toMatchObject({ action: "close", body: "Final draft" });
    expect(native.ipc!.listenerCount(BROWSER_ANNOTATION_EDITOR_CHANNEL)).toBe(0);
    await expect(f.show()).rejects.toThrow("unavailable");
  });

  it("ignores a late exact-close for a replaced editor while keeping the successor visible", async () => {
    const f = fixture(true); const host = f.host as BrowserOverlayHost;
    const first = await f.show(); const old = native.views[0];
    const next = await f.show(presentation("editor-2")); const successor = native.views[1];
    expect(host.closeAnnotation("view-1", first)).toBe(false);
    expect(f.visible.has(successor)).toBe(true);
    flush(old, "Original draft", 1);
    expect(host.closeAnnotation("view-1", next)).toBe(true);
    expect(host.closeAnnotation("view-1", next)).toBe(false);
    flush(successor, "Successor draft", 1);
    expect(f.events.map(event => [event.editorId, event.body])).toEqual([["editor-1", "Original draft"], ["editor-2", "Successor draft"]]);
    host.dispose();
  });

  it("rejects malformed presentations and mismatched page ownership before creating a view", async () => {
    const f = fixture();
    await expect(f.show({ ...presentation(), unexpected: "capability" } as never)).rejects.toThrow("unsupported");
    f.identity.webContentsId = 999;
    await expect(f.show()).rejects.toThrow("identity");
    expect(native.views).toHaveLength(0);
    f.host.dispose();
  });
});
