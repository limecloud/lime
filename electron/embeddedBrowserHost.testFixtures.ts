import { vi } from "vitest";

const {
  addChildViewMock,
  closeMock,
  findInPageMock,
  getSessionUserAgentMock,
  getZoomFactorMock,
  loadUrlMock,
  menuBuildFromTemplateMock,
  menuPopupMock,
  reloadMock,
  removeChildViewMock,
  sessionEventHandlers,
  sessionFromPartitionMock,
  setPermissionRequestHandlerMock,
  setBoundsMock,
  setSessionUserAgentMock,
  setWebContentsUserAgentMock,
  setWindowOpenHandlerMock,
  setZoomFactorMock,
  shellOpenExternalMock,
  stopMock,
  stopFindInPageMock,
  setVisibleMock,
  webContentsEventHandlers,
  webContentsState,
  webContentsViewCtorMock,
  clipboardWriteTextMock,
  copyImageAtMock,
  downloadUrlMock,
} = vi.hoisted(() => {
  const webContentsState = {
    destroyed: false,
    isLoading: false,
    title: "Example",
    url: "https://example.com/",
  };
  const webContentsEventHandlers = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();
  const sessionEventHandlers = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();
  const setPermissionRequestHandlerMock = vi.fn();
  const loadUrlMock = vi.fn(async () => undefined);
  const reloadMock = vi.fn();
  const stopMock = vi.fn();
  const findInPageMock = vi.fn(() => 7);
  const stopFindInPageMock = vi.fn();
  const getZoomFactorMock = vi.fn(() => 1);
  const setZoomFactorMock = vi.fn();
  const clipboardWriteTextMock = vi.fn();
  const closeMock = vi.fn();
  const copyImageAtMock = vi.fn();
  const downloadUrlMock = vi.fn();
  const getSessionUserAgentMock = vi.fn();
  const setSessionUserAgentMock = vi.fn();
  const sessionFromPartitionMock = vi.fn(() => ({
    webRequest: { onBeforeRequest: vi.fn() },
    getUserAgent: getSessionUserAgentMock,
    on: vi.fn((eventName: string, handler: (...args: unknown[]) => void) => {
      const handlers = sessionEventHandlers.get(eventName) || [];
      handlers.push(handler);
      sessionEventHandlers.set(eventName, handlers);
    }),
    removeListener: vi.fn(
      (eventName: string, handler: (...args: unknown[]) => void) => {
        const handlers = sessionEventHandlers.get(eventName) || [];
        sessionEventHandlers.set(
          eventName,
          handlers.filter((item) => item !== handler),
        );
      },
    ),
    setPermissionRequestHandler: setPermissionRequestHandlerMock,
    setPermissionCheckHandler: vi.fn(),
    setUserAgent: setSessionUserAgentMock,
  }));
  const setWebContentsUserAgentMock = vi.fn();
  const setWindowOpenHandlerMock = vi.fn();
  const shellOpenExternalMock = vi.fn();
  const setBoundsMock = vi.fn();
  const setVisibleMock = vi.fn();
  const menuPopupMock = vi.fn();
  const menuBuildFromTemplateMock = vi.fn(() => ({
    popup: menuPopupMock,
  }));
  return {
    addChildViewMock: vi.fn(),
    closeMock,
    clipboardWriteTextMock,
    copyImageAtMock,
    downloadUrlMock,
    findInPageMock,
    getSessionUserAgentMock,
    getZoomFactorMock,
    loadUrlMock,
    reloadMock,
    removeChildViewMock: vi.fn(),
    sessionEventHandlers,
    sessionFromPartitionMock,
    setPermissionRequestHandlerMock,
    setBoundsMock,
    setSessionUserAgentMock,
    setWebContentsUserAgentMock,
    setZoomFactorMock,
    setVisibleMock,
    menuBuildFromTemplateMock,
    menuPopupMock,
    webContentsEventHandlers,
    webContentsState,
    webContentsViewCtorMock: vi.fn(() => ({
      setBackgroundColor: vi.fn(),
      setBounds: setBoundsMock,
      setVisible: setVisibleMock,
      webContents: {
        enableDeviceEmulation: vi.fn(),
        disableDeviceEmulation: vi.fn(),
        close: closeMock,
        copyImageAt: copyImageAtMock,
        downloadURL: downloadUrlMock,
        findInPage: findInPageMock,
        getTitle: () => webContentsState.title,
        getURL: () => webContentsState.url,
        getZoomFactor: getZoomFactorMock,
        isDestroyed: () => webContentsState.destroyed,
        isLoading: () => webContentsState.isLoading,
        loadURL: loadUrlMock,
        navigationHistory: {
          canGoBack: () => false,
          canGoForward: () => false,
          goBack: vi.fn(),
          goForward: vi.fn(),
        },
        on: vi.fn(
          (eventName: string, handler: (...args: unknown[]) => void) => {
            const handlers = webContentsEventHandlers.get(eventName) || [];
            handlers.push(handler);
            webContentsEventHandlers.set(eventName, handlers);
          },
        ),
        off: vi.fn(
          (eventName: string, handler: (...args: unknown[]) => void) => {
            const handlers = webContentsEventHandlers.get(eventName) || [];
            webContentsEventHandlers.set(
              eventName,
              handlers.filter((item) => item !== handler),
            );
          },
        ),
        reload: reloadMock,
        setZoomFactor: setZoomFactorMock,
        stop: stopMock,
        stopFindInPage: stopFindInPageMock,
        setUserAgent: setWebContentsUserAgentMock,
        setWindowOpenHandler: setWindowOpenHandlerMock,
      },
    })),
    setWindowOpenHandlerMock,
    shellOpenExternalMock,
    stopMock,
    stopFindInPageMock,
  };
});

vi.mock("./electronRuntime", () => ({
  app: {
    getLocale: () => "zh-CN",
  },
  clipboard: {
    writeText: clipboardWriteTextMock,
  },
  Menu: {
    buildFromTemplate: menuBuildFromTemplateMock,
  },
  session: {
    fromPartition: sessionFromPartitionMock,
  },
  shell: {
    openExternal: shellOpenExternalMock,
  },
  WebContentsView: webContentsViewCtorMock,
}));

export function createWindow() {
  let destroyed = false;
  const windowEventHandlers = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();
  const windowWebContentsEventHandlers = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();
  return {
    contentView: {
      addChildView: addChildViewMock,
      removeChildView: removeChildViewMock,
    },
    destroyForTest: () => {
      destroyed = true;
    },
    emitWebContentsEventForTest: (eventName: string, ...args: unknown[]) => {
      for (const handler of windowWebContentsEventHandlers.get(eventName) ||
        []) {
        handler(...args);
      }
    },
    emitWindowEventForTest: (eventName: string, ...args: unknown[]) => {
      for (const handler of windowEventHandlers.get(eventName) || []) {
        handler(...args);
      }
    },
    isDestroyed: () => destroyed,
    off: vi.fn((eventName: string, handler: (...args: unknown[]) => void) => {
      const handlers = windowEventHandlers.get(eventName) || [];
      windowEventHandlers.set(
        eventName,
        handlers.filter((item) => item !== handler),
      );
    }),
    on: vi.fn((eventName: string, handler: (...args: unknown[]) => void) => {
      const handlers = windowEventHandlers.get(eventName) || [];
      handlers.push(handler);
      windowEventHandlers.set(eventName, handlers);
    }),
    webContents: {
      off: vi.fn((eventName: string, handler: (...args: unknown[]) => void) => {
        const handlers = windowWebContentsEventHandlers.get(eventName) || [];
        windowWebContentsEventHandlers.set(
          eventName,
          handlers.filter((item) => item !== handler),
        );
      }),
      on: vi.fn((eventName: string, handler: (...args: unknown[]) => void) => {
        const handlers = windowWebContentsEventHandlers.get(eventName) || [];
        handlers.push(handler);
        windowWebContentsEventHandlers.set(eventName, handlers);
      }),
    },
  };
}

export function emitWebContentsEvent(eventName: string, ...args: unknown[]) {
  for (const handler of webContentsEventHandlers.get(eventName) || []) {
    handler(...args);
  }
}

export function resetMocks() {
  addChildViewMock.mockClear();
  closeMock.mockClear();
  clipboardWriteTextMock.mockClear();
  copyImageAtMock.mockClear();
  downloadUrlMock.mockClear();
  loadUrlMock.mockReset();
  loadUrlMock.mockResolvedValue(undefined);
  reloadMock.mockClear();
  stopMock.mockClear();
  findInPageMock.mockReset();
  findInPageMock.mockReturnValue(7);
  stopFindInPageMock.mockClear();
  getZoomFactorMock.mockClear();
  getZoomFactorMock.mockReturnValue(1);
  setZoomFactorMock.mockClear();
  removeChildViewMock.mockClear();
  getSessionUserAgentMock.mockReset();
  getSessionUserAgentMock.mockReturnValue(
    "Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36 Electron/31.0.0 Lime/1.78.0",
  );
  sessionFromPartitionMock.mockClear();
  setPermissionRequestHandlerMock.mockClear();
  setBoundsMock.mockClear();
  setSessionUserAgentMock.mockClear();
  setWebContentsUserAgentMock.mockClear();
  setWindowOpenHandlerMock.mockClear();
  shellOpenExternalMock.mockClear();
  setVisibleMock.mockClear();
  menuBuildFromTemplateMock.mockClear();
  menuPopupMock.mockClear();
  webContentsViewCtorMock.mockClear();
  webContentsState.destroyed = false;
  webContentsState.isLoading = false;
  webContentsState.title = "Example";
  webContentsState.url = "https://example.com/";
  sessionEventHandlers.clear();
  webContentsEventHandlers.clear();
}

export {
  addChildViewMock,
  closeMock,
  findInPageMock,
  getSessionUserAgentMock,
  getZoomFactorMock,
  loadUrlMock,
  menuBuildFromTemplateMock,
  menuPopupMock,
  reloadMock,
  removeChildViewMock,
  sessionEventHandlers,
  sessionFromPartitionMock,
  setPermissionRequestHandlerMock,
  setBoundsMock,
  setSessionUserAgentMock,
  setWebContentsUserAgentMock,
  setWindowOpenHandlerMock,
  setZoomFactorMock,
  shellOpenExternalMock,
  stopMock,
  stopFindInPageMock,
  setVisibleMock,
  webContentsEventHandlers,
  webContentsState,
  webContentsViewCtorMock,
  clipboardWriteTextMock,
  copyImageAtMock,
  downloadUrlMock,
};
