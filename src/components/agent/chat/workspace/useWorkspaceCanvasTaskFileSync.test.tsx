import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceCanvasTaskFileSync } from "./useWorkspaceCanvasTaskFileSync";

type HookProps = Parameters<typeof useWorkspaceCanvasTaskFileSync>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: HookProps = {
    taskFiles: [
      {
        id: "task-file-1",
        name: "draft.md",
        type: "document",
        content: "# Spring\n\nhello",
        version: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    isThemeWorkbench: true,
    selectedFileId: undefined,
    canvasState: null,
    mappedTheme: "general",
    documentEditorFocusedRef: { current: false },
    setSelectedFileId: vi.fn(),
    setCanvasState: vi.fn(),
  };

  function Probe(currentProps: HookProps) {
    useWorkspaceCanvasTaskFileSync(currentProps);
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

describe("useWorkspaceCanvasTaskFileSync", () => {
  it("同步 task file 时应只刷新画布内容，不再被动切换布局", async () => {
    const setCanvasState = vi.fn();
    const { render } = renderHook({
      setCanvasState,
    });

    await render();

    expect(setCanvasState).toHaveBeenCalledTimes(1);
  });
});
