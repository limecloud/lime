import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceRightSurfaceCoordinatorRuntime } from "./useWorkspaceRightSurfaceCoordinatorRuntime";
import { useWorkspaceRightSurfaceLocalStateRuntime } from "./useWorkspaceRightSurfaceLocalStateRuntime";
import type { WorkspaceRightSurfaceBrowserIntent } from "./workspaceRightSurfaceBrowserIntent";
import { rememberBrowserPresentation } from "./right-surface/browser/browserPresentation";
import { browserState } from "./right-surface/browser/browserWorkspace.testFixtures";

const projection = vi.hoisted(() => vi.fn());

const pending = vi.hoisted(() => ({
  browser: null as WorkspaceRightSurfaceBrowserIntent | null,
  consume: vi.fn().mockResolvedValue(undefined),
  dismiss: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./useWorkspaceRightSurfacePendingBridgeRuntime", () => ({
  useWorkspaceRightSurfacePendingBridgeRuntime: () => ({
    pendingBrowserIntent: pending.browser,
    pendingIntents: [],
    pendingFileTarget: null,
    consumePendingRequestsForSurface: pending.consume,
    dismissPendingRequestsForSurface: pending.dismiss,
    refreshPendingRequests: pending.refresh,
  }),
}));
vi.mock("./useWorkspaceBrowserTabProjection", () => ({
  useWorkspaceBrowserTabProjection: projection,
}));
vi.mock("./right-surface/useThreadOutputs", () => ({
  useThreadOutputs: () => [],
}));
vi.mock("./useFileTreePanel", () => ({
  useFileTreePanel: () => ({ isOpen: false, setOpen: () => {} }),
}));

function browserIntent(
  sourceRequestId: string,
  priority: "foreground" | "background" = "foreground",
): WorkspaceRightSurfaceBrowserIntent {
  return {
    source: "rightSurfacePending",
    sourceRequestId,
    origin: "open_browser_history",
    priority,
    tabId: `tab-${sourceRequestId}`,
    launchUrl: "https://example.com/history",
  };
}

describe("Browser 待办挂载确认", () => {
  let root: Root;
  let container: HTMLDivElement;
  let latest: ReturnType<typeof useWorkspaceRightSurfaceCoordinatorRuntime>;
  const noop = () => {};
  const threadItems: [] = [];

  function Probe() {
    const localState = useWorkspaceRightSurfaceLocalStateRuntime({
      workspaceId: "workspace-a",
      sessionId: "session-a",
      threadId: "thread-a",
    });
    latest = useWorkspaceRightSurfaceCoordinatorRuntime({
      localState,
      articleEditorRightSurface: null,
      articleEditorRightSurfaceAvailable: false,
      bindRightSurfacePendingActions: noop,
      canvasWorkbenchRootPath: "/workspace",
      clawTraceEnabled: false,
      expertInfoPanelCollapsed: true,
      expertInfoPanelVisible: false,
      handleToggleCanvas: noop,
      harnessPendingCount: 0,
      hasExpertInfoPanel: false,
      preferredServiceSkillResultFileTarget: null,
      runtimeWorkspaceId: "workspace-a",
      sceneIsPreparingSend: false,
      sceneIsSending: false,
      sceneLayoutMode: "chat",
      sessionId: "session-a",
      sceneThreadId: "thread-a",
      shellRightSurfaceAvailable: true,
      showHarnessToggle: false,
      suppressHomeNavbarUtilityActions: false,
      taskCenterHomeHotpathActive: false,
      threadItems,
      setExpertInfoPanelCollapsed: noop,
      setHarnessPanelVisible: noop,
      setLayoutMode: noop,
    });
    return null;
  }

  const render = () => act(() => root.render(<Probe />));

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    pending.browser = null;
    rememberBrowserPresentation(
      { sessionId: "session-a", threadId: "thread-a" },
      null,
    );
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    rememberBrowserPresentation(
      { sessionId: "session-a", threadId: "thread-a" },
      null,
    );
  });

  it("设置返回时即使还没有Renderer页签也先读取真实Host，再恢复原Browser", () => {
    const native = browserState({ threadId: "thread-a" });
    rememberBrowserPresentation(
      { sessionId: "session-a", threadId: "thread-a" },
      native.tabId,
    );
    render();
    expect(projection.mock.lastCall?.[0].enabled).toBe(true);
    act(() => projection.mock.lastCall?.[0].onProjection([native]));
    expect(latest!.rightSurfaceState.activeSurface).toBe("browser");
    expect(pending.consume).not.toHaveBeenCalled();
  });

  it("前台请求保留到挂载确认，只消费被确认的请求", () => {
    pending.browser = browserIntent("history-a");
    render();
    expect(latest!.rightSurfaceState.activeSurface).toBe("browser");
    expect(latest!.browserRightSurfaceIntent?.launchApplied).not.toBe(true);
    expect(pending.consume).not.toHaveBeenCalled();
    render();
    expect(pending.consume).not.toHaveBeenCalled();

    act(() => latest!.handleBrowserLaunchApplied("history-a"));
    expect(pending.consume).toHaveBeenCalledExactlyOnceWith("browser", [
      "history-a",
    ]);
    expect(latest!.browserRightSurfaceIntent?.launchApplied).toBe(true);
    act(() => latest!.handleBrowserLaunchApplied("history-a"));
    expect(pending.consume).toHaveBeenCalledTimes(1);
  });

  it("未知或被替换的请求确认不能消费当前待办", () => {
    pending.browser = browserIntent("history-a");
    render();
    pending.consume.mockClear();
    act(() => latest!.handleBrowserLaunchApplied("unknown"));
    expect(pending.consume).not.toHaveBeenCalled();
    pending.browser = browserIntent("history-b");
    render();
    pending.consume.mockClear();
    act(() => latest!.handleBrowserLaunchApplied("history-a"));
    expect(pending.consume).not.toHaveBeenCalled();
    act(() => latest!.handleBrowserLaunchApplied("history-b"));
    expect(pending.consume).toHaveBeenCalledExactlyOnceWith("browser", [
      "history-b",
    ]);
  });

  it.each(["toggle", "select"] as const)(
    "手动打开后台 Browser 请求同样等待挂载确认：%s",
    (action) => {
      pending.browser = browserIntent("history-a", "background");
      render();
      expect(pending.consume).not.toHaveBeenCalled();
      act(() => {
        if (action === "toggle") latest!.handleToggleRightSurfaceBrowser();
        else latest!.handleSelectRightSurfaceTab("browser");
      });
      expect(latest!.rightSurfaceState.activeSurface).toBe("browser");
      expect(pending.consume).not.toHaveBeenCalled();
      act(() => latest!.handleBrowserLaunchApplied("history-a"));
      expect(pending.consume).toHaveBeenCalledExactlyOnceWith("browser", [
        "history-a",
      ]);
    },
  );
});
