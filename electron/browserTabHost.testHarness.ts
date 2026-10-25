import {
  effectiveBrowserSettings,
  type BrowserSettings,
} from "../src/lib/api/browserSettingsTypes";
import { vi } from "vitest";
import process from "node:process";
import os from "node:os";
import { ElectronBrowserTabHost, type BrowserToolCall } from "./browserTabHost";
import type { BrowserHistoryHost } from "./browserHistoryHost";
export { isBrowserTabCommand } from "./browserTabHost";

const {
  clipboardReadTextMock,
  clipboardWriteTextMock,
  shellOpenPathMock,
  shellShowItemInFolderMock,
} = vi.hoisted(() => ({
  clipboardReadTextMock: vi.fn(() => "clipboard-before"),
  clipboardWriteTextMock: vi.fn(),
  shellOpenPathMock: vi.fn(async () => ""),
  shellShowItemInFolderMock: vi.fn(),
}));
export {
  clipboardReadTextMock,
  clipboardWriteTextMock,
  shellOpenPathMock,
  shellShowItemInFolderMock,
};

vi.mock("./electronRuntime", async () => {
  const actual =
    await vi.importActual<typeof import("./electronRuntime")>(
      "./electronRuntime",
    );
  return {
    ...actual,
    app: { ...actual.app, getPath: () => os.tmpdir() },
    clipboard: {
      ...actual.clipboard,
      readText: clipboardReadTextMock,
      writeText: clipboardWriteTextMock,
    },
    shell: {
      ...actual.shell,
      openPath: shellOpenPathMock,
      showItemInFolder: shellShowItemInFolderMock,
    },
  };
});

export function createHarness(options: { history?: BrowserHistoryHost } = {}) {
  clipboardReadTextMock.mockClear();
  clipboardWriteTextMock.mockClear();
  shellOpenPathMock.mockClear();
  shellShowItemInFolderMock.mockClear();
  let nextWebContentsId = 100;
  const views = new Map<string, ReturnType<typeof createNativeView>>();
  const events: Array<{ event: string; payload: unknown }> = [];
  const artifactWriter = vi.fn(async (params: Record<string, unknown>) => ({
    artifactRef: (params.artifact as Record<string, unknown>).artifactRef,
    persistedAt: "2026-08-23T00:00:00.000Z",
    sidecar: {
      relativePath: "sessions/test/runtime-artifacts/download.json",
      bytes: 42,
      sha256: "a".repeat(64),
      contentStatus: "available",
    },
  }));
  const embeddedHost = {
    setSettings: vi.fn(),
    setApplicationNetworkRequirements: vi.fn(async () => {}),
    setNetworkRequirementsProvider: vi.fn(),
    setNetworkRequirementsChangedHandler:
      vi.fn<(handler: (() => void) | null) => void>(),
    setPopupHandler: vi.fn(),
    setAgentPermissionResolver: vi.fn(),
    setSitePermissionDecisionHandler: vi.fn<
      (
        handler: {
          canUseSavedPermissions: (viewId: string) => boolean;
        } | null,
      ) => void
    >(),
    setDownloadPermissionResolver: vi.fn(),
    takeBlockedNavigation: vi.fn(() => null),
    resolvePopupOpener: vi.fn(() => null),
    invoke: vi.fn(async (window, command: string, args) => {
      const viewId = String(args?.viewId ?? "");
      if (command === "embedded_browser_view_destroy") {
        views.delete(viewId);
        return {};
      }
      let native = views.get(viewId);
      if (command === "embedded_browser_view_mount") {
        native ??= createNativeView(
          window,
          viewId,
          nextWebContentsId++,
          String(args?.url ?? ""),
        );
        views.set(viewId, native);
      }
      if (!native) {
        throw new Error(`missing native view: ${viewId}`);
      }
      if (command === "embedded_browser_view_navigate") {
        native.webContents.url = String(args?.url);
      }
      if (
        args?.bounds &&
        (command === "embedded_browser_view_mount" ||
          command === "embedded_browser_view_set_bounds")
      ) {
        native.containerBounds = { ...args.bounds };
      }
      return state(native);
    }),
    resolveNativeView: vi.fn((viewId: string) => {
      const native = views.get(viewId);
      return native
        ? {
            state: state(native),
            view: native.view,
            window: native.window,
            containerBounds: { ...native.containerBounds },
          }
        : null;
    }),
    resolveDownloadPath: vi.fn(() => process.execPath),
    resolvePermission: vi.fn(() => true),
    clearPendingPermission: vi.fn(),
    revokePermissionGrants: vi.fn(),
  };
  const window = {
    id: 7,
    isDestroyed: () => false,
    webContents: { id: 41 },
    contentView: {
      get children() {
        return [...views.values()].map((native) => native.view);
      },
    },
  };
  const browserHost = new ElectronBrowserTabHost(
    embeddedHost as never,
    (event, payload) => events.push({ event, payload }),
    {
      ...options,
      resolveWindow: (owner) =>
        owner === window.webContents.id ? (window as never) : undefined,
    },
  );
  browserHost.setArtifactWriter(artifactWriter);
  // Existing lifecycle fixtures explicitly allow browsing; permission scenarios opt into ask.
  let settings = effectiveBrowserSettings({ approvalMode: "neverAsk" });
  browserHost.setSettingsProvider(async () => settings);
  const host = {
    connectionLost: browserHost.connectionLost.bind(browserHost),
    executeTool: (
      call: Omit<BrowserToolCall, "phase"> &
        Partial<Pick<BrowserToolCall, "phase">>,
    ) => browserHost.executeTool({ phase: "preflight", ...call }),
    invoke: browserHost.invoke.bind(browserHost),
    observeEmbeddedEvent: browserHost.observeEmbeddedEvent.bind(browserHost),
    setTurnInterruptHandler:
      browserHost.setTurnInterruptHandler.bind(browserHost),
    setArtifactWriter: browserHost.setArtifactWriter.bind(browserHost),
    setSettings: (next: BrowserSettings, locale?: string) => {
      settings = next;
      browserHost.setSettings(next, locale);
    },
    setSettingsProvider: browserHost.setSettingsProvider.bind(browserHost),
    setPopupIdentityHandler:
      browserHost.setPopupIdentityHandler.bind(browserHost),
    turnEnded: browserHost.turnEnded.bind(browserHost),
  };
  return {
    artifactWriter,
    browserHost,
    embeddedHost,
    events,
    host,
    views,
    window,
  };
}

function createNativeView(
  window: { id: number; webContents: { id: number } },
  viewId: string,
  webContentsId: number,
  url: string,
) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(...args);
    }
  };
  let debuggerAttached = false;
  const debuggerListeners = new Map<
    string,
    Set<(...args: unknown[]) => void>
  >();
  const debuggerOn = (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => {
    const handlers = debuggerListeners.get(event) ?? new Set();
    handlers.add(listener);
    debuggerListeners.set(event, handlers);
  };
  const debuggerEmit = (event: string, ...args: unknown[]) => {
    for (const listener of [...(debuggerListeners.get(event) ?? [])])
      listener(...args);
  };
  const debuggerApi = {
    on: debuggerOn,
    once: (event: string, listener: (...args: unknown[]) => void) => {
      const once = (...args: unknown[]) => {
        debuggerListeners.get(event)?.delete(once);
        listener(...args);
      };
      debuggerOn(event, once);
    },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      debuggerListeners.get(event)?.delete(listener);
    },
    emit: debuggerEmit,
    listenerCount: (event: string) => debuggerListeners.get(event)?.size ?? 0,
    attach: vi.fn(() => {
      debuggerAttached = true;
    }),
    detach: vi.fn(() => {
      debuggerAttached = false;
      debuggerEmit("detach", {}, "target_closed");
    }),
    isAttached: vi.fn(() => debuggerAttached),
    sendCommand: vi.fn(
      async (
        method: string,
        params?: Record<string, unknown>,
        _sessionId?: string,
      ): Promise<Record<string, unknown>> => {
        if (method === "Input.dispatchMouseEvent") {
          emit(
            "before-mouse-event",
            {},
            {
              button: "left",
              type: params?.type === "mousePressed" ? "mouseDown" : "mouseUp",
              x: Number(params?.x ?? 0),
              y: Number(params?.y ?? 0),
            },
          );
        }
        if (method === "Input.dispatchKeyEvent") {
          emit(
            "before-input-event",
            {},
            {
              key: params?.key,
              type: params?.type,
            },
          );
        }
        if (method === "Page.getNavigationHistory") {
          return { currentIndex: 0 };
        }
        if (method === "Page.navigate") {
          webContents.url = String(params?.url);
          queueMicrotask(() => emit("did-stop-loading"));
          return {};
        }
        if (method === "Page.captureScreenshot") return { data: "cGl4ZWxz" };
        if (method === "Accessibility.getFullAXTree") {
          return {
            nodes: [
              {
                backendDOMNodeId: 11,
                childIds: [],
                ignored: false,
                name: { value: "Open details" },
                nodeId: "ax-11",
                role: { value: "button" },
              },
            ],
          };
        }
        if (method === "DOM.describeNode") {
          const isFileInput =
            webContents.nodeAttributes.includes("type") &&
            webContents.nodeAttributes.includes("file");
          return {
            node: {
              attributes: webContents.nodeAttributes,
              nodeName: isFileInput ? "INPUT" : "BUTTON",
              localName: isFileInput ? "input" : "button",
            },
          };
        }
        if (method === "DOM.getBoxModel") {
          return {
            model: { content: [0, 0, 40, 0, 40, 20, 0, 20] },
          };
        }
        return {};
      },
    ),
  };
  const webContents = {
    isDestroyed: () => false,
    mainFrame: {
      get url() {
        return webContents.url;
      },
      detached: false,
      processId: 1,
      routingId: webContentsId,
      get framesInSubtree(): unknown[] {
        return [this];
      },
    },
    debugger: debuggerApi,
    getTitle: () => "Example",
    getURL: () => webContents.url,
    id: webContentsId,
    nodeAttributes: [] as string[],
    emit,
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    },
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const once = (...args: unknown[]) => {
        listeners.get(event)?.delete(once);
        listener(...args);
      };
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(once);
      listeners.set(event, eventListeners);
    }),
    url,
  };
  const view = {
    getVisible: () => true,
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    webContents,
  };
  return {
    viewId,
    view,
    webContents,
    window,
    containerBounds: { x: 0, y: 0, width: 800, height: 600 },
  };
}

function state(native: ReturnType<typeof createNativeView>) {
  return {
    canGoBack: false,
    canGoForward: false,
    error: null,
    find: null,
    isLoading: false,
    title: native.webContents.getTitle(),
    url: native.webContents.getURL(),
    viewId: native.viewId,
    zoomFactor: 1,
  };
}

export async function mount(
  harness: ReturnType<typeof createHarness>,
  overrides: Record<string, unknown> = {},
) {
  return await harness.host.invoke(
    harness.window as never,
    "browser_tab_mount",
    {
      browserSessionId: "browser-session-1",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      selected: true,
      tabId: "tab-1",
      threadId: "thread-1",
      url: "https://example.com/",
      ...overrides,
    },
  );
}
