import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasState as GeneralCanvasState } from "@/components/general-chat/bridge";
import { useWorkspaceCanvasLayoutRuntime } from "./useWorkspaceCanvasLayoutRuntime";

type HookProps = Parameters<typeof useWorkspaceCanvasLayoutRuntime>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<typeof useWorkspaceCanvasLayoutRuntime> | null =
    null;

  const defaultProps: HookProps = {
    activeTheme: "general",
    isThemeWorkbench: false,
    layoutMode: "chat-canvas",
    showChatPanel: true,
    showSidebar: true,
    defaultTopicSidebarVisible: true,
    hasMessages: true,
    canvasWorkbenchLayoutMode: "split",
    autoCollapsedTopicSidebarRef: { current: false },
    mappedTheme: "general",
    normalizedEntryTheme: "general",
    shouldBootstrapCanvasOnEntry: false,
    canvasState: null,
    generalCanvasState: {
      isOpen: false,
      contentType: "empty",
      content: "",
      isEditing: false,
    },
    showTeamWorkspaceBoard: false,
    hasCurrentCanvasArtifact: false,
    currentCanvasArtifactType: null,
    currentImageWorkbenchActive: false,
    isBrowserAssistCanvasVisible: false,
    onHasMessagesChange: vi.fn(),
    dismissActiveTeamWorkbenchAutoOpen: vi.fn(),
    suppressGeneralCanvasArtifactAutoOpen: vi.fn(),
    suppressBrowserAssistCanvasAutoOpen: vi.fn(),
    setShowSidebar: vi.fn(),
    setLayoutMode: vi.fn(),
    setGeneralCanvasState: vi.fn(),
    setCanvasState: vi.fn(),
    setCanvasWorkbenchLayoutMode: vi.fn(),
    setNovelChapterListCollapsed: vi.fn(),
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceCanvasLayoutRuntime(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ root, container });

  return {
    render,
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
    defaultProps,
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.restoreAllMocks();
});

describe("useWorkspaceCanvasLayoutRuntime", () => {
  it("进入真实预览目标时应自动收起通用空画布，但保留已有内容", async () => {
    const setGeneralCanvasState = vi.fn();
    const { render } = renderHook({
      setGeneralCanvasState,
    });

    await render();
    expect(setGeneralCanvasState).not.toHaveBeenCalled();

    await render({
      hasCurrentCanvasArtifact: true,
    });

    expect(setGeneralCanvasState).toHaveBeenCalledTimes(1);
    const updater = setGeneralCanvasState.mock.calls[0]?.[0] as
      | ((previous: GeneralCanvasState) => GeneralCanvasState)
      | undefined;
    expect(typeof updater).toBe("function");

    const previousState: GeneralCanvasState = {
      isOpen: true,
      contentType: "markdown",
      content: "# 临时草稿\n\n保留这段内容",
      isEditing: false,
    };

    const nextState = updater?.(previousState);
    expect(nextState).toEqual({
      ...previousState,
      isOpen: false,
    });
  });

  it("general 空白画布没有真实预览目标时应回退到聊天态", async () => {
    const setLayoutMode = vi.fn();
    const { render } = renderHook({
      layoutMode: "chat-canvas",
      generalCanvasState: {
        isOpen: true,
        contentType: "markdown",
        content: "   ",
        isEditing: false,
      },
      setLayoutMode,
    });

    await render();

    expect(
      setLayoutMode.mock.calls.some((call) => call[0] === "chat"),
    ).toBe(true);
  });

  it("stacked 自动收起侧栏后，不应在同一轮 general chat-canvas 中立刻反向展开", async () => {
    const setShowSidebar = vi.fn();
    const autoCollapsedTopicSidebarRef = { current: false };
    const { render } = renderHook({
      setShowSidebar,
      autoCollapsedTopicSidebarRef,
      canvasWorkbenchLayoutMode: "stacked",
      showSidebar: true,
      layoutMode: "chat-canvas",
    });

    await render();

    expect(setShowSidebar).toHaveBeenCalledWith(false);
    expect(autoCollapsedTopicSidebarRef.current).toBe(true);

    setShowSidebar.mockClear();

    await render({
      canvasWorkbenchLayoutMode: "split",
      showSidebar: false,
      autoCollapsedTopicSidebarRef,
      layoutMode: "chat-canvas",
    });

    expect(setShowSidebar).not.toHaveBeenCalled();
    expect(autoCollapsedTopicSidebarRef.current).toBe(true);
  });

  it("自动收起的侧栏在离开 general chat-canvas 主路径后应恢复", async () => {
    const setShowSidebar = vi.fn();
    const autoCollapsedTopicSidebarRef = { current: true };
    const { render } = renderHook({
      setShowSidebar,
      autoCollapsedTopicSidebarRef,
      showSidebar: false,
      canvasWorkbenchLayoutMode: "split",
      layoutMode: "chat",
    });

    await render();

    expect(setShowSidebar).toHaveBeenCalledWith(true);
    expect(autoCollapsedTopicSidebarRef.current).toBe(false);
  });
});
