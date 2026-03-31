import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceCanvasMessageSyncRuntime } from "./useWorkspaceCanvasMessageSyncRuntime";

type HookProps = Parameters<typeof useWorkspaceCanvasMessageSyncRuntime>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: HookProps = {
    canvasState: null,
    isSpecializedThemeMode: true,
    isThemeWorkbench: false,
    mappedTheme: "general",
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        content: "```markdown\n# 新文档\n\n这是生成内容。\n```",
        isThinking: false,
      } as HookProps["messages"][number],
    ],
    processedMessageIdsRef: { current: new Set<string>() },
    setCanvasState: vi.fn(),
  };

  function Probe(currentProps: HookProps) {
    useWorkspaceCanvasMessageSyncRuntime(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ container, root });

  return { render };
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

describe("useWorkspaceCanvasMessageSyncRuntime", () => {
  it("从助手消息同步主稿时应只更新画布内容，不主动切换到 chat-canvas", async () => {
    const setCanvasState = vi.fn();
    const { render } = renderHook({
      setCanvasState,
    });

    await render();

    expect(setCanvasState).toHaveBeenCalledTimes(1);
  });
});
