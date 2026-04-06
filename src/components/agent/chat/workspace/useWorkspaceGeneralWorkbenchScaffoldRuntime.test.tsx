import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeListen } from "@/lib/dev-bridge";
import { useWorkspaceGeneralWorkbenchScaffoldRuntime } from "./useWorkspaceGeneralWorkbenchScaffoldRuntime";

const mockCreateInitialCanvasState = vi.hoisted(() => vi.fn(() => null));
const mockCreateInitialDocumentState = vi.hoisted(() =>
  vi.fn(() => ({
    type: "document",
    currentVersionId: null,
    versions: [],
  })),
);
const mockUseTopicBranchBoard = vi.hoisted(() =>
  vi.fn(() => ({
    branchItems: [],
    setTopicStatus: vi.fn(),
  })),
);

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: vi.fn(),
}));

vi.mock("@/lib/workspace/workbenchCanvas", () => ({
  createInitialCanvasState: mockCreateInitialCanvasState,
  createInitialDocumentState: mockCreateInitialDocumentState,
}));

vi.mock("../hooks", () => ({
  useTopicBranchBoard: mockUseTopicBranchBoard,
}));

type HookProps = Parameters<
  typeof useWorkspaceGeneralWorkbenchScaffoldRuntime
>[0];
type CreationTaskListener = Parameters<typeof safeListen>[1];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let latestValue: ReturnType<
    typeof useWorkspaceGeneralWorkbenchScaffoldRuntime
  > | null = null;

  const defaultProps: HookProps = {
    isGeneralWorkbench: true,
    mappedTheme: "general",
    sessionId: "session-theme-1",
    projectId: "project-theme-1",
    canvasState: null,
    documentVersionStatusMap: {},
    setDocumentVersionStatusMap: vi.fn(),
    clearThemeSkillsRailState: vi.fn(),
    setCanvasState: vi.fn(),
    setLayoutMode: vi.fn(),
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceGeneralWorkbenchScaffoldRuntime(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
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
  };
}

describe("useWorkspaceGeneralWorkbenchScaffoldRuntime", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.mocked(safeListen).mockResolvedValue(vi.fn());
    mockCreateInitialCanvasState.mockReturnValue(null);
    mockCreateInitialDocumentState.mockReturnValue({
      type: "document",
      currentVersionId: null,
      versions: [],
    });
    mockUseTopicBranchBoard.mockReturnValue({
      branchItems: [],
      setTopicStatus: vi.fn(),
    });
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
    vi.clearAllMocks();
  });

  it("应接收并去重 creation_task_submitted 事件", async () => {
    let listener: CreationTaskListener | null = null;
    vi.mocked(safeListen).mockImplementationOnce(async (event, handler) => {
      expect(event).toBe("lime://creation_task_submitted");
      listener = handler;
      return vi.fn();
    });

    const { render, getValue } = renderHook();
    await render();

    expect(safeListen).toHaveBeenCalledWith(
      "lime://creation_task_submitted",
      expect.any(Function),
    );

    await act(async () => {
      listener?.({
        payload: {
          task_id: "task-cover-1",
          task_type: "cover_generate",
          path: " .lime/tasks/cover_generate/demo.json ",
          absolute_path: " /tmp/demo.json ",
        },
      });
      await Promise.resolve();
    });

    expect(getValue().generalWorkbenchCreationTaskEvents).toEqual([
      expect.objectContaining({
        taskId: "task-cover-1",
        taskType: "cover_generate",
        path: ".lime/tasks/cover_generate/demo.json",
        absolutePath: "/tmp/demo.json",
      }),
    ]);

    await act(async () => {
      listener?.({
        payload: {
          task_id: "task-cover-1",
          task_type: "cover_generate",
          path: ".lime/tasks/cover_generate/demo.json",
          absolute_path: "/tmp/demo.json",
        },
      });
      listener?.({
        payload: {
          task_id: "   ",
          task_type: "cover_generate",
          path: ".lime/tasks/cover_generate/ignored.json",
        },
      });
      await Promise.resolve();
    });

    expect(getValue().generalWorkbenchCreationTaskEvents).toHaveLength(1);
  });
});
