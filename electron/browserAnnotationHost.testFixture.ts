// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, expect, vi } from "vitest";
import {
  BrowserAnnotationHost,
  type BrowserAnnotationTarget,
} from "./browserAnnotationHost";
import {
  BROWSER_ANNOTATION_PAGE_COMMAND,
  BROWSER_ANNOTATION_PAGE_EVENT,
  type BrowserAnnotationCommand,
} from "./browserAnnotationModel";
import type {
  BrowserAnnotationCaptureResult,
  BrowserAnnotationSelection,
  BrowserAnnotationSession,
} from "../src/lib/api/browserAnnotationTypes";

const native = vi.hoisted(() => ({
  ipc: undefined as EventEmitter | undefined,
}));
export const nativeEvents = () => native.ipc!;
vi.mock("./electronRuntime", async () => {
  const { EventEmitter } = await import("node:events");
  native.ipc = new EventEmitter();
  return { ipcMain: native.ipc };
});

export function image(width = 1600, height = 1200) {
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
export function selection(
  kind: "element" | "region" = "element",
): BrowserAnnotationSelection {
  return {
    kind,
    pageUrl: "https://page.test/",
    pageTitle: "Page",
    frameUrl: "https://page.test/",
    framePath: [],
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
export function fixture(mode: "always" | "necessary" = "always") {
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
  const owner = Object.assign(new EventEmitter(), {
    id: 21,
    focus: vi.fn(),
    isDestroyed: () => false,
  });
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
    annotationAllowed: true,
    view,
    window,
  };
  const events: { event: string; payload: unknown }[] = [];
  const onAnchor = vi.fn();
  const host = new BrowserAnnotationHost({
    onAnchor,
    resolveTarget: (tabId) =>
      tabId === "tab-1" ? (target as unknown as BrowserAnnotationTarget) : null,
    emit: (event, payload) => events.push({ event, payload }),
    screenshotMode: () => mode,
    timeoutMs: 10,
  });
  hosts.push(host);
  const invoke = (
    command: BrowserAnnotationCommand,
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
    onAnchor,
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
    show: () => {
      visible = true;
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
