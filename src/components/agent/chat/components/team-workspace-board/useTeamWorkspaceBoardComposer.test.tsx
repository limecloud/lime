import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTeamWorkspaceBoardComposer } from "./useTeamWorkspaceBoardComposer";

type HookProps = Parameters<typeof useTeamWorkspaceBoardComposer>[0];

const {
  mockUseTeamWorkspaceActivityPreviews,
  mockUseTeamWorkspaceBoardCanvasRuntime,
  mockUseTeamWorkspaceBoardPresentation,
  mockUseTeamWorkspaceBoardRuntimeState,
  mockUseTeamWorkspaceBoardShellProps,
} = vi.hoisted(() => ({
  mockUseTeamWorkspaceActivityPreviews: vi.fn(),
  mockUseTeamWorkspaceBoardCanvasRuntime: vi.fn(),
  mockUseTeamWorkspaceBoardPresentation: vi.fn(),
  mockUseTeamWorkspaceBoardRuntimeState: vi.fn(),
  mockUseTeamWorkspaceBoardShellProps: vi.fn(),
}));

vi.mock("./useTeamWorkspaceActivityPreviews", () => ({
  useTeamWorkspaceActivityPreviews: mockUseTeamWorkspaceActivityPreviews,
}));

vi.mock("./useTeamWorkspaceBoardCanvasRuntime", () => ({
  useTeamWorkspaceBoardCanvasRuntime: mockUseTeamWorkspaceBoardCanvasRuntime,
}));

vi.mock("./useTeamWorkspaceBoardPresentation", () => ({
  useTeamWorkspaceBoardPresentation: mockUseTeamWorkspaceBoardPresentation,
}));

vi.mock("./useTeamWorkspaceBoardRuntimeState", () => ({
  useTeamWorkspaceBoardRuntimeState: mockUseTeamWorkspaceBoardRuntimeState,
}));

vi.mock("./useTeamWorkspaceBoardShellProps", () => ({
  useTeamWorkspaceBoardShellProps: mockUseTeamWorkspaceBoardShellProps,
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createFormationState() {
  return {
    hasRuntimeFormation: true,
    hasSelectedTeamPlan: true,
    plannedRoles: [{ id: "researcher", label: "资料整理" }],
    runtimeFormationDisplay: {
      panelStatusLabel: "准备中",
    },
  };
}

function createSessionGraphState() {
  return {
    basePreviewableRailSessions: [{ id: "base-1" }],
    baseRailSessions: [{ id: "base-1" }],
    canvasStorageScopeId: "scope-1",
    currentChildSession: { id: "child-current" },
    hasRealTeamGraph: true,
    isChildSession: true,
    isEmptyShellState: false,
    memberCanvasSessions: [{ id: "child-1" }, { id: "child-2" }],
    orchestratorSession: { id: "orchestrator-1" },
    railSessions: [{ id: "child-1" }, { id: "child-2" }],
    siblingCount: 1,
    totalTeamSessions: 2,
    visibleSessions: [{ id: "child-1" }, { id: "child-2" }],
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let latestValue: ReturnType<typeof useTeamWorkspaceBoardComposer> | null =
    null;

  const defaultProps: HookProps = {
    canvasViewportFallbackHeight: 560,
    className: "board-shell",
    currentSessionId: "child-2",
    detailExpanded: true,
    embedded: false,
    formationState:
      createFormationState() as unknown as HookProps["formationState"],
    onCloseCompletedTeamSessions: vi.fn(),
    onCloseSubagentSession: vi.fn(),
    onExpandEmptyShell: vi.fn(),
    onOpenSubagentSession: vi.fn(),
    onResumeSubagentSession: vi.fn(),
    onReturnToParentSession: vi.fn(),
    onSendSubagentInput: vi.fn(),
    onToggleDetail: vi.fn(),
    onWaitActiveTeamSessions: vi.fn(),
    onWaitSubagentSession: vi.fn(),
    sessionGraphState:
      createSessionGraphState() as unknown as HookProps["sessionGraphState"],
    shellExpanded: true,
    subagentParentContext: {
      parent_session_name: "主线程",
    } as HookProps["subagentParentContext"],
    teamControlSummary: {
      action: "close_completed",
      affectedSessionIds: ["child-done"],
      cascadeSessionIds: [],
      requestedSessionIds: ["child-done"],
      updatedAt: 1710000000,
    },
    teamDispatchPreviewState: {
      status: "running",
    } as unknown as HookProps["teamDispatchPreviewState"],
    teamWaitSummary: {
      awaitedSessionIds: ["child-2"],
      resolvedSessionId: "child-2",
      resolvedStatus: "completed",
      timedOut: false,
      updatedAt: 1710000100,
    },
    activityRefreshVersionBySessionId: {
      "child-2": 3,
    },
    liveActivityBySessionId: {
      "child-2": [],
    },
  };

  function Probe(currentProps: HookProps) {
    latestValue = useTeamWorkspaceBoardComposer(currentProps);
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
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
    render,
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  mockUseTeamWorkspaceBoardRuntimeState.mockReturnValue({
    canCloseCompletedTeamSessions: true,
    canWaitAnyActiveTeamSession: true,
    completedTeamSessionIds: ["child-done-1", "child-done-2"],
    expandedSessionId: "child-2",
    focusSession: { id: "child-2" },
    selectedBaseSession: { id: "base-1" },
    selectedSession: { id: "child-2", runtimeStatus: "running" },
    statusSummary: { queued: 1, running: 1 },
    waitableTeamSessionIds: ["child-1"],
  });
  mockUseTeamWorkspaceActivityPreviews.mockReturnValue({
    selectedSessionActivityState: {
      entries: [],
      previewState: null,
      previewText: "资料整理刚更新进度",
      shouldPoll: true,
      supportsPreview: true,
    },
    sessionActivityPreviewById: {
      "child-2": {
        previewText: "资料整理刚更新进度",
      },
    },
  });
  mockUseTeamWorkspaceBoardCanvasRuntime.mockReturnValue({
    zoom: 1.25,
  });
  mockUseTeamWorkspaceBoardPresentation.mockReturnValue({
    boardShellClassName: "board-shell",
  });
  mockUseTeamWorkspaceBoardShellProps.mockReturnValue({
    emptyShellProps: {
      embedded: false,
    },
    shellProps: {
      embedded: false,
    },
  });
});

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      continue;
    }

    await act(async () => {
      mounted.root.unmount();
      await Promise.resolve();
    });
    mounted.container.remove();
  }

  vi.clearAllMocks();
});

describe("useTeamWorkspaceBoardComposer", () => {
  it("应把 schedule 主线所需的 runtime、activity、canvas、presentation 与 shell 串成同一条编排链", async () => {
    const harness = renderHook();

    await harness.render();

    expect(mockUseTeamWorkspaceBoardRuntimeState).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSessionId: "child-2",
        isChildSession: true,
        onCloseCompletedTeamSessions: expect.any(Function),
        orchestratorSessionId: "orchestrator-1",
        teamControlSummary: expect.objectContaining({
          action: "close_completed",
        }),
        teamWaitSummary: expect.objectContaining({
          resolvedSessionId: "child-2",
        }),
        visibleSessions: [{ id: "child-1" }, { id: "child-2" }],
        waitTimeoutMs: 30_000,
      }),
    );

    expect(mockUseTeamWorkspaceActivityPreviews).toHaveBeenCalledWith({
      activityRefreshVersionBySessionId: {
        "child-2": 3,
      },
      activityTimelineEntryLimit: 4,
      basePreviewableRailSessions: [{ id: "base-1" }],
      liveActivityBySessionId: {
        "child-2": [],
      },
      selectedBaseSession: { id: "base-1" },
      selectedSession: { id: "child-2", runtimeStatus: "running" },
    });

    expect(mockUseTeamWorkspaceBoardCanvasRuntime).toHaveBeenCalledWith({
      activityTimelineEntryLimit: 4,
      canvasStorageScopeId: "scope-1",
      canvasViewportFallbackHeight: 560,
      embedded: false,
      expandedSessionId: "child-2",
      focusSession: { id: "child-2" },
      hasRealTeamGraph: true,
      hasRuntimeFormation: true,
      hasSelectedTeamPlan: true,
      liveActivityBySessionId: {
        "child-2": [],
      },
      memberCanvasSessions: [{ id: "child-1" }, { id: "child-2" }],
      plannedRoles: [{ id: "researcher", label: "资料整理" }],
      previewBySessionId: {
        "child-2": {
          previewText: "资料整理刚更新进度",
        },
      },
      teamDispatchPreviewState: {
        status: "running",
      },
    });

    expect(mockUseTeamWorkspaceBoardPresentation).toHaveBeenCalledWith({
      canCloseCompletedTeamSessions: true,
      canWaitAnyActiveTeamSession: true,
      className: "board-shell",
      completedCount: 2,
      detailExpanded: true,
      dispatchPreviewStatus: "running",
      embedded: false,
      hasRuntimeFormation: true,
      isChildSession: true,
      isEmptyShellState: false,
      parentSessionName: "主线程",
      runtimeFormationDisplay: {
        panelStatusLabel: "准备中",
      },
      selectedSession: { id: "child-2", runtimeStatus: "running" },
      shellExpanded: true,
      siblingCount: 1,
      statusSummary: { queued: 1, running: 1 },
      totalTeamSessions: 2,
      visibleSessionsCount: 2,
      waitableCount: 1,
      zoom: 1.25,
    });

    expect(mockUseTeamWorkspaceBoardShellProps).toHaveBeenCalledWith({
      className: "board-shell",
      embedded: false,
      canvasRuntimeState: { zoom: 1.25 },
      formationState: expect.objectContaining({
        hasRuntimeFormation: true,
      }),
      onExpandEmptyShell: expect.any(Function),
      onOpenSubagentSession: expect.any(Function),
      onReturnToParentSession: expect.any(Function),
      onToggleDetail: expect.any(Function),
      presentationState: { boardShellClassName: "board-shell" },
      runtimeState: expect.objectContaining({
        completedTeamSessionIds: ["child-done-1", "child-done-2"],
      }),
      selectedSessionActivityState: expect.objectContaining({
        previewText: "资料整理刚更新进度",
      }),
      sessionGraphState: expect.objectContaining({
        canvasStorageScopeId: "scope-1",
      }),
      subagentParentContext: {
        parent_session_name: "主线程",
      },
    });

    expect(harness.getValue()).toEqual({
      emptyShellProps: {
        embedded: false,
      },
      shellProps: {
        embedded: false,
      },
    });
  });

  it("应在可选输入缺省时回退到稳定默认值", async () => {
    const harness = renderHook({
      activityRefreshVersionBySessionId: undefined,
      currentSessionId: undefined,
      liveActivityBySessionId: undefined,
      subagentParentContext: undefined,
      teamControlSummary: undefined,
      teamDispatchPreviewState: undefined,
      teamWaitSummary: undefined,
    });

    await harness.render();

    expect(mockUseTeamWorkspaceBoardRuntimeState).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSessionId: undefined,
        teamControlSummary: null,
        teamWaitSummary: null,
      }),
    );
    expect(mockUseTeamWorkspaceActivityPreviews).toHaveBeenCalledWith(
      expect.objectContaining({
        activityRefreshVersionBySessionId: {},
        liveActivityBySessionId: {},
      }),
    );
    expect(mockUseTeamWorkspaceBoardCanvasRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        liveActivityBySessionId: {},
        teamDispatchPreviewState: null,
      }),
    );
    expect(mockUseTeamWorkspaceBoardPresentation).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchPreviewStatus: undefined,
        parentSessionName: undefined,
      }),
    );
    expect(mockUseTeamWorkspaceBoardShellProps).toHaveBeenCalledWith(
      expect.objectContaining({
        subagentParentContext: null,
      }),
    );
  });
});
