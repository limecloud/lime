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
});
