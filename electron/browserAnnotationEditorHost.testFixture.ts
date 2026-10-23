// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, vi } from "vitest";
import {
  BrowserAnnotationEditorHost,
  type BrowserAnnotationEditorHostEvent,
} from "./browserAnnotationEditorHost";
import { BrowserOverlayHost } from "./browserOverlayHost";
import {
  BROWSER_ANNOTATION_EDITOR_CHANNEL,
  BROWSER_ANNOTATION_EDITOR_UPDATE,
  type BrowserAnnotationEditorPresentation,
} from "../src/lib/api/browserAnnotationEditorTypes";
import type { BrowserAnnotationIdentity } from "../src/lib/api/browserAnnotationTypes";

export interface TestContents extends EventEmitter {
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
export interface TestView {
  webContents: TestContents;
  options: {
    webPreferences: {
      preload: string;
      additionalArguments: string[];
      sandbox: boolean;
      contextIsolation: boolean;
      nodeIntegration: boolean;
    };
  };
  setBounds: ReturnType<typeof vi.fn>;
}
const native = vi.hoisted(() => ({
  views: [] as TestView[],
  ipc: undefined as EventEmitter | undefined,
  nextLoad: undefined as Promise<void> | undefined,
}));

vi.mock("./electronRuntime", async () => {
  const { EventEmitter } = await import("node:events");
  native.ipc = new EventEmitter();
  return {
    ipcMain: native.ipc,
    WebContentsView: class {
      options: TestView["options"];
      webContents: TestContents;
      constructor(options: TestView["options"]) {
        this.options = options;
        let destroyed = false;
        let url = "";
        this.webContents = Object.assign(new EventEmitter(), {
          id: native.views.length + 100,
          mainFrame: {},
          isDestroyed: () => destroyed,
          getURL: () => url,
          focus: vi.fn(),
          setWindowOpenHandler: vi.fn(),
          send: vi.fn(),
          loadURL: vi.fn((destination: string) => {
            url = destination;
            return native.nextLoad ?? Promise.resolve();
          }),
          close: vi.fn(() => {
            destroyed = true;
            this.webContents.emit("destroyed");
          }),
        });
        native.views.push(this);
      }
      setBounds = vi.fn();
      setBackgroundColor = vi.fn();
    },
  };
});

export function presentation(
  editorId = "editor-1",
): BrowserAnnotationEditorPresentation {
  return {
    editorId,
    annotationId: "annotation-1",
    draftId: "draft-1",
    body: "",
    attachedImages: [],
    revision: 0,
    appearance: "light",
    screenshotStatus: "captured",
    labels: {
      title: "Comment",
      placeholder: "Write a comment",
      save: "Save",
      send: "Send",
      close: "Close",
      element: "Element",
      region: "Region",
      text: "Text",
      captureFailed: "Capture failed",
      sending: "Sending",
      sendFailed: "Send failed",
      imageAttachment: "Image attachment",
      previewImage: "Preview image",
      removeImage: "Remove image",
      closePreview: "Close preview",
      attachmentFailed: "Could not add image",
      attachmentLoading: "Reading image",
    },
    selection: {
      kind: "element",
      pageUrl: "https://example.test/",
      pageTitle: "Example",
      frameUrl: "https://example.test/",
      framePath: [],
      targetRect: { x: 600, y: 400, width: 80, height: 80 },
      viewportSize: { width: 700, height: 500 },
      scrollPosition: { x: 0, y: 0 },
      devicePixelRatio: 2,
      targetSelector: "#target",
      targetPath: "main > button",
      targetRole: "button",
      targetText: "Example",
      markerViewportPoint: { x: 680, y: 480 },
    },
  };
}

export function fixture(overlay = false, windowId = 1) {
  let focused = true;
  const owner = Object.assign(new EventEmitter(), {
    id: windowId + 10,
    isDestroyed: () => false,
    getURL: () => "http://localhost:1420/index.html#/thread/1",
    focus: vi.fn(),
  });
  const page = Object.assign(new EventEmitter(), {
    id: windowId + 20,
    isDestroyed: () => false,
    focus: vi.fn(),
  });
  const visible = new Set<TestView>();
  const window = Object.assign(new EventEmitter(), {
    id: windowId,
    webContents: owner,
    isDestroyed: () => false,
    isFocused: () => focused,
    getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    contentView: {
      addChildView: vi.fn((view: TestView) => {
        visible.add(view);
      }),
      removeChildView: vi.fn((view: TestView) => {
        visible.delete(view);
      }),
    },
  });
  const identity: BrowserAnnotationIdentity = {
    browserSessionId: "session-1",
    threadId: "thread-1",
    tabId: "tab-1",
    viewId: "view-1",
    windowId,
    ownerWebContentsId: owner.id,
    webContentsId: page.id,
    pageRevision: 7,
  };
  const events: BrowserAnnotationEditorHostEvent[] = [];
  const host = overlay
    ? new BrowserOverlayHost(() => {}, {
        onAnnotationEvent: (event) => events.push(event),
        annotationPreloadPath: "/isolated/browserAnnotationEditor.cjs",
      })
    : new BrowserAnnotationEditorHost((event) => events.push(event), {
        preloadPath: "/isolated/browserAnnotationEditor.cjs",
      });
  const show = (value = presentation()) =>
    host instanceof BrowserOverlayHost
      ? host.showAnnotation(
          window as never,
          "view-1",
          value,
          page as never,
          { x: 100, y: 80, width: 700, height: 500 },
          identity,
        )
      : host.show(
          window as never,
          "view-1",
          value,
          page as never,
          { x: 100, y: 80, width: 700, height: 500 },
          identity,
        );
  return {
    host,
    owner,
    page,
    window,
    identity,
    events,
    visible,
    show,
    blur: () => {
      focused = false;
      window.emit("blur");
    },
  };
}

export function message(
  view: TestView,
  fields: Record<string, unknown>,
  senderFrame = view.webContents.mainFrame,
  sender = view.webContents,
) {
  const args = view.options.webPreferences.additionalArguments;
  const argument = (key: string) =>
    args.find((value) => value.startsWith(`--${key}=`))!.split("=")[1];
  native.ipc!.emit(
    BROWSER_ANNOTATION_EDITOR_CHANNEL,
    { sender, senderFrame },
    {
      token: argument("browser-annotation-token"),
      editorId: argument("browser-annotation-id"),
      generation: Number(argument("browser-annotation-generation")),
      ...(fields.kind === "action" || fields.kind === "flushed"
        ? { attachedImages: [] }
        : {}),
      ...fields,
    },
  );
}

export function flush(view: TestView, body: string, revision: number) {
  const request = view.webContents.send.mock.calls
    .filter(
      ([channel, value]) =>
        channel === BROWSER_ANNOTATION_EDITOR_UPDATE && value.kind === "flush",
    )
    .at(-1)?.[1];
  expect(request).toBeDefined();
  message(view, { kind: "flushed", flushId: request.flushId, body, revision });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  native.views.length = 0;
  native.nextLoad = undefined;
  native.ipc?.removeAllListeners();
});

export { native };
