import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserTabDownloadEvent,
  BrowserTabLoadFailedEvent,
  BrowserTabPermissionRequestEvent,
  BrowserTabState,
} from "@/lib/api/browserTab";

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  createIdentity: vi.fn(),
  downloadHandler: null as ((event: BrowserTabDownloadEvent) => void) | null,
  find: vi.fn(),
  focus: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  loadFailedHandler: null as
    | ((event: BrowserTabLoadFailedEvent) => void)
    | null,
  list: vi.fn(),
  mount: vi.fn(),
  navigate: vi.fn(),
  openIdentity: vi.fn(),
  permissionHandler: null as
    | ((event: BrowserTabPermissionRequestEvent) => void)
    | null,
  select: vi.fn(),
  setBounds: vi.fn(),
  setZoom: vi.fn(),
  stateHandler: null as ((state: BrowserTabState) => void) | null,
  stopFind: vi.fn(),
}));

vi.mock("react-i18next", () => {
  const t = (key: string, options?: Record<string, unknown>) => {
    const rendered = key.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
      String(options?.[name] ?? `{{${name}}}`),
    );
    return options
      ? `${rendered} ${Object.values(options).join(" ")}`
      : rendered;
  };
  return { useTranslation: () => ({ t }) };
});

vi.mock("@/lib/api/browserTab", () => ({
  closeBrowserTab: mocks.close,
  findInBrowserTab: mocks.find,
  focusBrowserTabPage: mocks.focus,
  goBackBrowserTab: mocks.goBack,
  goForwardBrowserTab: mocks.goForward,
  isBrowserTabHostAvailable: () => true,
  listenBrowserTabClosed: vi.fn(async () => () => undefined),
  listenBrowserTabCommand: vi.fn(async () => () => undefined),
  listenBrowserTabDownload: vi.fn(async (handler) => {
    mocks.downloadHandler = handler;
    return () => {
      if (mocks.downloadHandler === handler) {
        mocks.downloadHandler = null;
      }
    };
  }),
  listenBrowserTabLoadFailed: vi.fn(async (handler) => {
    mocks.loadFailedHandler = handler;
    return () => {
      if (mocks.loadFailedHandler === handler) {
        mocks.loadFailedHandler = null;
      }
    };
  }),
  listenBrowserTabPermissionRequest: vi.fn(async (handler) => {
    mocks.permissionHandler = handler;
    return () => {
      if (mocks.permissionHandler === handler) {
        mocks.permissionHandler = null;
      }
    };
  }),
  listenBrowserTabState: vi.fn(async (handler) => {
    mocks.stateHandler = handler;
    return () => {
      if (mocks.stateHandler === handler) {
        mocks.stateHandler = null;
      }
    };
  }),
  listBrowserTabs: mocks.list,
  mountBrowserTab: mocks.mount,
  navigateBrowserTab: mocks.navigate,
  reloadBrowserTab: vi.fn(),
  selectBrowserTab: mocks.select,
  setBrowserTabBounds: mocks.setBounds,
  setBrowserTabZoom: mocks.setZoom,
  stopBrowserTab: vi.fn(),
  stopFindInBrowserTab: mocks.stopFind,
}));

vi.mock("@/lib/api/browserWorkspace", () => ({
  createBrowserWorkspaceTabIdentity: mocks.createIdentity,
  openBrowserWorkspaceIdentity: mocks.openIdentity,
}));

import { BrowserWorkspace } from "./BrowserWorkspace";
import { browserState, deferred } from "./browserWorkspace.testFixtures";

describe("BrowserWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: (time: number) => void) => {
        callback(0);
        return 1;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    container = document.createElement("div");
    container.style.width = "900px";
    container.style.height = "700px";
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.mount.mockReset();
    mocks.list.mockReset().mockResolvedValue([]);
    mocks.navigate.mockReset();
    mocks.focus.mockImplementation(
      async (target) =>
        (await mocks.navigate.mock.results.at(-1)?.value) ??
        browserState(target),
    );
    mocks.openIdentity.mockReset();
    mocks.createIdentity.mockReset();
    mocks.setBounds.mockReset();
    mocks.select.mockReset();
    mocks.downloadHandler = null;
    mocks.loadFailedHandler = null;
    mocks.permissionHandler = null;
    mocks.openIdentity.mockResolvedValue({
      browserSessionId: "browser-session-1",
      tabId: "browser-session-1:user:primary",
    });
    mocks.createIdentity.mockResolvedValue({
      browserSessionId: "browser-session-1",
      tabId: "browser-session-1:user:secondary",
    });
    mocks.mount.mockImplementation(async (params) =>
      browserState({
        browserSessionId: params.browserSessionId,
        tabId: params.tabId,
        threadId: params.threadId,
      }),
    );
    mocks.navigate.mockImplementation(async (tabId: string, url: string) =>
      browserState({ tabId, url }),
    );
    mocks.setBounds.mockImplementation(async ({ tabId }) =>
      browserState(
        tabId === "tab-agent-1"
          ? {
              activeTurnId: "turn-1",
              controlOwner: "agent",
              origin: "agent",
              tabId,
              title: "Agent tab",
              viewId: "browser-tab-agent-1",
              webContentsId: 202,
            }
          : { tabId },
      ),
    );
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    vi.unstubAllGlobals();
    container.remove();
  });

  it("selects the explicitly requested canonical tab without navigating the previously selected tab", async () => {
    const old = browserState({
      tabId: "old",
      selected: true,
      url: "https://example.com/old",
    });
    const target = browserState({
      tabId: "canonical-new",
      viewId: "new-view",
      selected: false,
      url: "http://localhost:4317/new",
    });
    mocks.list.mockResolvedValue([old, target]);
    let selectedId = old.tabId;
    mocks.select.mockImplementation(async ({ tabId }) => {
      selectedId = tabId;
      return { ...target, selected: true };
    });
    mocks.setBounds.mockImplementation(async ({ tabId }) => ({
      ...(tabId === old.tabId ? old : target),
      selected: tabId === selectedId,
    }));
    const ack = vi.fn();
    await act(async () =>
      root.render(
        <BrowserWorkspace
          runtimeSessionId="session-1"
          threadId="thread-1"
          initialUrl={target.url}
          launchTabId={target.tabId}
          launchRequestId="explicit-tab"
          onLaunchApplied={ack}
        />,
      ),
    );
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tabId: "canonical-new" }),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(
      container
        .querySelector('[data-testid="browser-workspace"]')
        ?.getAttribute("data-browser-tab-id"),
    ).toBe("canonical-new");
    expect(ack).toHaveBeenCalledExactlyOnceWith("explicit-tab");
  });

  it("acknowledges a show-only request without navigating the restored page", async () => {
    const tab = browserState({ url: "https://example.com/current" });
    mocks.list.mockResolvedValue([tab]);
    mocks.setBounds.mockResolvedValue(tab);
    const ack = vi.fn();
    await act(async () =>
      root.render(
        <BrowserWorkspace
          runtimeSessionId="session-1"
          threadId="thread-1"
          launchRequestId="show-only"
          onLaunchApplied={ack}
        />,
      ),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledExactlyOnceWith("show-only");
  });

  it("applies a new launch request to a restored native tab and ignores an older navigation result", async () => {
    const onLaunchApplied = vi.fn();
    const tab = browserState();
    mocks.list.mockResolvedValue([tab]);
    mocks.setBounds.mockResolvedValue(tab);
    const old = deferred<BrowserTabState>();
    mocks.navigate
      .mockReturnValueOnce(old.promise)
      .mockImplementation(async (tabId, url) => browserState({ tabId, url }));
    const render = async (launchRequestId: string, initialUrl: string) =>
      act(async () => {
        root.render(
          <BrowserWorkspace
            runtimeSessionId="session-1"
            threadId="thread-1"
            launchRequestId={launchRequestId}
            initialUrl={initialUrl}
            onLaunchApplied={onLaunchApplied}
          />,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    await render("request-a", "http://localhost:4317/first");
    expect(mocks.navigate).toHaveBeenCalledWith(
      tab.tabId,
      "http://localhost:4317/first",
    );
    await render("request-b", "http://localhost:4317/second");
    expect(mocks.navigate).toHaveBeenCalledWith(
      tab.tabId,
      "http://localhost:4317/second",
    );
    await act(async () =>
      old.resolve(browserState({ url: "http://localhost:4317/first" })),
    );
    expect(
      container.querySelector<HTMLInputElement>(
        'input[data-testid="browser-workspace-address"]',
      )?.value,
    ).toBe("localhost:4317");
    expect(
      container
        .querySelector('[data-testid="browser-workspace"]')
        ?.getAttribute("data-browser-tab-id"),
    ).toBe(browserState().tabId);
    await render("request-b", "http://localhost:4317/second");
    expect(mocks.navigate).toHaveBeenCalledTimes(2);
    expect(onLaunchApplied).toHaveBeenCalledExactlyOnceWith("request-b");
    expect(mocks.mount).not.toHaveBeenCalled();
  });

  it("restores two native tabs, selected view and URL after the Browser pane remounts", async () => {
    const second = browserState({
      tabId: "second",
      viewId: "second-view",
      webContentsId: 202,
      url: "https://example.com/current",
      title: "Second",
    });
    const tabs = [browserState({ selected: false }), second];
    mocks.list.mockResolvedValue(tabs);
    mocks.setBounds.mockImplementation(async ({ tabId }) =>
      tabs.find((tab) => tab.tabId === tabId),
    );
    const render = async () =>
      act(async () => {
        root.render(
          <BrowserWorkspace runtimeSessionId="session-1" threadId="thread-1" />,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    await render();
    expect(
      container.querySelector('[data-testid="browser-workspace-tabs"]'),
    ).toBeNull();
    await act(async () => root.render(null));
    expect(mocks.setBounds).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: "second", visible: false }),
    );
    await render();
    expect(
      container.querySelector('[data-testid="browser-workspace-tabs"]'),
    ).toBeNull();
    const workspace = container.querySelector(
      '[data-testid="browser-workspace"]',
    );
    expect(workspace?.getAttribute("data-browser-tab-id")).toBe("second");
    expect(workspace?.getAttribute("data-browser-view-id")).toBe("second-view");
    expect(workspace?.getAttribute("data-browser-web-contents-id")).toBe("202");
    expect(
      container.querySelector<HTMLInputElement>(
        '[data-testid="browser-workspace-address"]',
      )?.value,
    ).toBe("example.com");
    await act(async () =>
      container
        .querySelector<HTMLInputElement>(
          '[data-testid="browser-workspace-address"]',
        )
        ?.focus(),
    );
    expect(
      container.querySelector<HTMLInputElement>(
        '[data-testid="browser-workspace-address"]',
      )?.value,
    ).toBe("https://example.com/current");
    expect(mocks.mount).not.toHaveBeenCalled();
  });

  it("does not revive closed primary or bootstrap a nonempty unselected snapshot", async () => {
    const second = browserState({
      tabId: "second",
      viewId: "second-view",
      webContentsId: 202,
      selected: false,
    });
    mocks.list.mockResolvedValue([second]);
    await act(async () => {
      root.render(
        <BrowserWorkspace runtimeSessionId="session-1" threadId="thread-1" />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      container.querySelector('[data-testid="browser-workspace-tabs"]'),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="browser-workspace"]')
        ?.getAttribute("data-browser-tab-id"),
    ).toBe("");
    expect(mocks.mount).not.toHaveBeenCalled();
    expect(mocks.setBounds).not.toHaveBeenCalled();
  });

  it("rejects late bounds success and failure after A→B→A", async () => {
    const old = deferred<BrowserTabState>();
    mocks.list.mockImplementation(async ({ threadId }) => [
      browserState({ threadId }),
    ]);
    mocks.setBounds
      .mockReturnValueOnce(old.promise)
      .mockImplementation(async () => browserState());
    const render = async (threadId: string) =>
      act(async () => {
        root.render(
          <BrowserWorkspace runtimeSessionId="session-1" threadId={threadId} />,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    await render("thread-1");
    await render("thread-2");
    await render("thread-1");
    await act(async () =>
      old.resolve(
        browserState({
          tabId: "old-response",
          viewId: "old-view",
          title: "Stale",
        }),
      ),
    );
    expect(
      container.querySelector('[data-testid="browser-workspace-tabs"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("Stale");
    const failed = deferred<BrowserTabState>();
    mocks.setBounds.mockReturnValueOnce(failed.promise);
    await render("thread-2");
    await render("thread-1");
    await act(async () => failed.reject(new Error("late bounds failure")));
    expect(container.textContent).not.toContain("late bounds failure");
  });

  it("mounts a stable native tab identity and projects its WebContents id", async () => {
    await act(async () => {
      root.render(
        <BrowserWorkspace
          initialUrl="https://example.com"
          runtimeSessionId="session-1"
          threadId="thread-1"
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.mount).toHaveBeenCalledWith(
      expect.objectContaining({
        browserSessionId: "browser-session-1",
        tabId: "browser-session-1:user:primary",
        threadId: "thread-1",
      }),
    );
    expect(mocks.openIdentity).toHaveBeenCalledWith({
      runtimeSessionId: "session-1",
      threadId: "thread-1",
    });
    const workspace = container.querySelector(
      '[data-testid="browser-workspace"]',
    );
    expect(workspace?.getAttribute("data-browser-tab-id")).toBe(
      "browser-session-1:user:primary",
    );
    expect(workspace?.getAttribute("data-browser-active-turn-id")).toBe("");
    expect(workspace?.getAttribute("data-browser-control-owner")).toBe("user");
    expect(workspace?.getAttribute("data-browser-page-revision")).toBe("0");
    expect(workspace?.getAttribute("data-browser-view-id")).toBe(
      "browser:browser-session-1:user:primary",
    );
    expect(workspace?.getAttribute("data-browser-web-contents-id")).toBe("101");
  });

  it("accepts an Agent-created tab event and navigates that same tab", async () => {
    await act(async () => {
      root.render(
        <BrowserWorkspace runtimeSessionId="session-1" threadId="thread-1" />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      mocks.stateHandler?.(
        browserState({
          activeTurnId: "turn-1",
          controlOwner: "agent",
          origin: "agent",
          tabId: "tab-agent-1",
          title: "Agent tab",
          viewId: "browser-tab-agent-1",
          webContentsId: 202,
        }),
      );
    });

    const workspace = container.querySelector(
      '[data-testid="browser-workspace"]',
    );
    expect(workspace?.getAttribute("data-browser-tab-id")).toBe("tab-agent-1");
    expect(workspace?.getAttribute("data-browser-active-turn-id")).toBe(
      "turn-1",
    );
    expect(workspace?.getAttribute("data-browser-control-owner")).toBe("agent");
    expect(workspace?.getAttribute("data-browser-page-revision")).toBe("0");
    expect(workspace?.getAttribute("data-browser-view-id")).toBe(
      "browser-tab-agent-1",
    );
    expect(workspace?.getAttribute("data-browser-web-contents-id")).toBe("202");

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="agentChat.browserWorkspace.address"]',
    );
    const form = input?.closest("form");
    await act(async () => {
      if (input) {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(input, "example.org");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await Promise.resolve();
    });
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(mocks.navigate).toHaveBeenCalledWith(
      "tab-agent-1",
      "https://example.org/",
    );
  });

  it("creates a canonical owner before mounting from an empty task", async () => {
    const ensureOwner = vi.fn(async () => ({
      runtimeSessionId: "session-created",
      threadId: "thread-created",
    }));

    await act(async () => {
      root.render(<BrowserWorkspace ensureOwner={ensureOwner} threadId="" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(ensureOwner).toHaveBeenCalledOnce();
    expect(mocks.openIdentity).toHaveBeenCalledWith({
      runtimeSessionId: "session-created",
      threadId: "thread-created",
    });
    expect(mocks.mount).toHaveBeenCalledWith(
      expect.objectContaining({
        browserSessionId: "browser-session-1",
        tabId: "browser-session-1:user:primary",
        threadId: "thread-created",
      }),
    );
    expect(
      container.querySelector('[data-testid="browser-workspace-loading"]'),
    ).toBeNull();
  });

  it("只投影当前 native tab 的权限和下载事件，并把状态带放在 viewport 外", async () => {
    await act(async () => {
      root.render(
        <BrowserWorkspace runtimeSessionId="session-1" threadId="thread-1" />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const permission = permissionEvent();
    await act(async () => {
      mocks.permissionHandler?.({ ...permission, tabId: "other-tab" });
    });
    expect(
      container.querySelector('[data-testid="browser-workspace-permission"]'),
    ).toBeNull();

    await act(async () => {
      mocks.permissionHandler?.(permission);
    });
    const banner = container.querySelector(
      '[data-testid="browser-workspace-permission"]',
    );
    const viewport = container.querySelector(
      '[data-testid="browser-workspace-viewport"]',
    );
    expect(banner).not.toBeNull();
    expect(banner?.className).not.toContain("absolute");
    expect(
      Boolean(
        banner &&
        viewport &&
        banner.compareDocumentPosition(viewport) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);

    await act(async () => {
      mocks.downloadHandler?.(downloadEvent());
    });
    const shelf = container.querySelector(
      '[data-testid="browser-workspace-download"]',
    );
    expect(shelf).not.toBeNull();
    expect(shelf?.className).not.toContain("absolute");

    await act(async () => {
      mocks.stateHandler?.(
        browserState({
          tabId: "tab-2",
          viewId: "view-2",
          webContentsId: 202,
        }),
      );
    });
    expect(
      container
        .querySelector('[data-testid="browser-workspace"]')
        ?.getAttribute("data-browser-tab-id"),
    ).toBe("tab-2");
    expect(
      container.querySelector('[data-testid="browser-workspace-permission"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="browser-workspace-download"]'),
    ).toBeNull();
  });

  it("把当前 native tab 的 load-failed 事件投影成可区分的错误状态", async () => {
    await act(async () => {
      root.render(
        <BrowserWorkspace runtimeSessionId="session-1" threadId="thread-1" />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      mocks.loadFailedHandler?.({
        ...browserState({ isLoading: false }),
        errorCode: -105,
        errorDescription: "NAME_NOT_RESOLVED",
        failureCategory: "dns",
      });
    });

    const error = container.querySelector(
      '[data-testid="browser-workspace-error"]',
    );
    expect(error?.getAttribute("data-browser-workspace-status")).toBe(
      "load-error",
    );
    expect(error?.getAttribute("data-browser-error-source")).toBe("load");
    expect(error?.textContent).toContain(
      "agentChat.browserWorkspace.loadFailedDnsTitle",
    );
    expect(error?.textContent).toContain("NAME_NOT_RESOLVED");

    await act(async () => {
      mocks.loadFailedHandler?.({
        ...browserState({ tabId: "other-tab" }),
        errorCode: -105,
        errorDescription: "OTHER_TAB",
        failureCategory: "dns",
      });
    });
    expect(error?.textContent).not.toContain("OTHER_TAB");
  });
});

function permissionEvent(
  overrides: Partial<BrowserTabPermissionRequestEvent> = {},
): BrowserTabPermissionRequestEvent {
  return {
    browserSessionId: "browser-session-1",
    decision: "blocked",
    isMainFrame: true,
    embeddingOrigin: "https://example.com",
    ownerWebContentsId: 41,
    permission: "geolocation",
    requestingUrl: "https://example.com/",
    requestId: "permission-1",
    tabId: "browser-session-1:user:primary",
    threadId: "thread-1",
    url: "https://example.com/",
    viewId: "browser:browser-session-1:user:primary",
    webContentsId: 101,
    windowId: 7,
    ...overrides,
  };
}

function downloadEvent(
  overrides: Partial<BrowserTabDownloadEvent> = {},
): BrowserTabDownloadEvent {
  return {
    browserSessionId: "browser-session-1",
    canResume: false,
    downloadId: "download-1",
    filename: "report.pdf",
    mimeType: "application/pdf",
    ownerWebContentsId: 41,
    receivedBytes: 100,
    state: "completed",
    tabId: "browser-session-1:user:primary",
    threadId: "thread-1",
    totalBytes: 100,
    url: "https://example.com/report.pdf",
    viewId: "browser:browser-session-1:user:primary",
    webContentsId: 101,
    windowId: 7,
    ...overrides,
  };
}
