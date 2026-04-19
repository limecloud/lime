import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTeamWorkspaceBoardShellProps } from "./useTeamWorkspaceBoardShellProps";

type HookProps = Parameters<typeof useTeamWorkspaceBoardShellProps>[0];

const { mockUseTeamWorkspaceBoardSelectedInlineDetail } = vi.hoisted(() => ({
  mockUseTeamWorkspaceBoardSelectedInlineDetail: vi.fn(),
}));

vi.mock("./useTeamWorkspaceBoardSelectedInlineDetail", () => ({
  useTeamWorkspaceBoardSelectedInlineDetail:
    mockUseTeamWorkspaceBoardSelectedInlineDetail,
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
const inlineDetailNode = (
  <div data-testid="inline-detail">inline detail</div>
);

function createRuntimeFormationDisplay() {
  return {
    blueprintRoleCards: [],
    emptyDetail: "系统正在准备分工。",
    hint: "正在准备分工",
    hasRuntimeFormation: true,
    memberCards: [],
    noticeText: "系统正在准备当前任务分工。",
    panelDescription: "当前任务分工正在生成。",
    panelHeadline: "任务分工准备中",
    panelLabel: "编辑 Team",
    panelStatusLabel: "准备中",
    panelStatusBadgeClassName: "border-sky-200 bg-sky-50 text-sky-700",
    panelTitle: "当前任务分工",
    referenceLabel: null,
    summaryBadges: [],
  };
}

function createSelectedTeamPlanDisplay() {
  return {
    hasSelectedTeamPlan: true,
    label: "编辑 Team",
    roleCards: [],
    summary: "先拆三段，再并行推进。",
    summaryBadges: [],
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let latestValue: ReturnType<typeof useTeamWorkspaceBoardShellProps> | null =
    null;

  const defaultProps: HookProps = {
    canvasRuntimeState: {
      canvasBounds: {
        height: 680,
        width: 960,
      },
      canvasLaneLayouts: {},
      canvasLanes: [{ persistKey: "lane-alpha" } as never],
      canvasStageHint: "正在同步任务进行时",
      canvasViewportRef: { current: null },
      handleAutoArrangeCanvas: vi.fn(),
      handleCanvasWheel: vi.fn(),
      handleFitCanvasView: vi.fn(),
      handleResetCanvasView: vi.fn(),
      handleSelectCanvasLane: vi.fn(),
      handleStartCanvasLaneDrag: vi.fn(),
      handleStartCanvasLaneResize: vi.fn(),
      handleStartCanvasPan: vi.fn(),
      handleZoomIn: vi.fn(),
      handleZoomOut: vi.fn(),
      isCanvasPanModifierActive: false,
      viewport: { x: 12, y: 24, zoom: 1.1 },
      zoom: 1.1,
    } as unknown as HookProps["canvasRuntimeState"],
    className: "custom-shell",
    embedded: true,
    formationState: {
      hasRuntimeFormation: true,
      runtimeFormationDisplay: createRuntimeFormationDisplay(),
      selectedTeamPlanDisplay: createSelectedTeamPlanDisplay(),
    } as unknown as HookProps["formationState"],
    onExpandEmptyShell: vi.fn(),
    onOpenSubagentSession: vi.fn(),
    onReturnToParentSession: vi.fn(),
    onToggleDetail: vi.fn(),
    presentationState: {
      boardBodyClassName: "board-body",
      boardChromeDisplay: {
        boardHeadline: "主任务总览",
        boardHint: "主线程会持续汇总子任务进展。",
        compactBoardHeadline: "任务进行中 · 2 项处理中",
        compactToolbarChips: [],
        statusSummaryBadges: [],
      },
      boardHeaderClassName: "board-header",
      boardShellClassName: "board-shell",
      canvasStageHeight: "680px",
      detailCardClassName: "detail-card",
      detailSummary: "子任务会持续更新任务进展。",
      detailToggleLabel: "查看细节",
      detailVisible: true,
      inlineDetailSectionClassName: "inline-detail",
      inlineTimelineEntryClassName: "inline-entry",
      inlineTimelineFeedClassName: "inline-feed",
      memberCanvasSubtitle: "子任务会持续更新任务进展。",
      memberCanvasTitle: "当前进展",
      railCardClassName: "rail-card",
      selectedSessionDetailDisplay: {
        summary: "资料整理正在推进。",
      },
      useCompactCanvasChrome: true,
    } as unknown as HookProps["presentationState"],
    runtimeState: {
      canCloseCompletedTeamSessions: true,
      canOpenSelectedSession: true,
      canResumeSelectedSession: false,
      canSendSelectedSessionInput: true,
      canStopSelectedSession: true,
      canWaitAnyActiveTeamSession: true,
      canWaitSelectedSession: true,
      completedTeamSessionIds: ["child-done"],
      expandedSessionId: "child-2",
      handleCloseCompletedTeamSessions: vi.fn(),
      handleSelectTeamOperationEntry: vi.fn(),
      handleSelectedSessionAction: vi.fn(),
      handleSelectedSessionInputDraftChange: vi.fn(),
      handleSelectedSessionSendInput: vi.fn(),
      handleWaitAnyActiveTeamSessions: vi.fn(),
      pendingSessionAction: {
        action: "interrupt_send",
        sessionId: "child-2",
      },
      pendingTeamAction: "wait_any",
      selectedActionPending: true,
      selectedSession: {
        id: "child-2",
        name: "资料整理",
        runtimeStatus: "running",
        sessionType: "sub_agent",
        updatedAt: 1710000000,
      },
      selectedSessionInputDraft: "继续推进下一步",
      selectedSessionInputMessage: "继续推进下一步",
      teamOperationEntries: [
        {
          badgeClassName: "border-sky-200 bg-sky-50 text-sky-700",
          detail: "资料整理返回了新结果",
          id: "wait-1",
          targetSessionId: "child-2",
          title: "收到结果",
          updatedAt: 1710000000,
        },
      ],
      waitableTeamSessionIds: ["child-1", "child-2"],
    } as unknown as HookProps["runtimeState"],
    selectedSessionActivityState: {
      entries: [],
      previewState: null,
      previewText: "",
      shouldPoll: false,
      supportsPreview: false,
    } as unknown as HookProps["selectedSessionActivityState"],
    sessionGraphState: {
      hasRealTeamGraph: true,
      isChildSession: true,
      isEmptyShellState: false,
      totalTeamSessions: 2,
    } as unknown as HookProps["sessionGraphState"],
    subagentParentContext: {
      created_from_turn_id: "turn-42",
      parent_session_name: "主线程",
    } as HookProps["subagentParentContext"],
  };

  function Probe(currentProps: HookProps) {
    latestValue = useTeamWorkspaceBoardShellProps(currentProps);
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
  mockUseTeamWorkspaceBoardSelectedInlineDetail.mockReturnValue(inlineDetailNode);
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

describe("useTeamWorkspaceBoardShellProps", () => {
  it("应在已有 runtime sessions 时关闭 fallback detail 并组装完整壳层 props", async () => {
    const harness = renderHook();

    await harness.render();

    expect(
      mockUseTeamWorkspaceBoardSelectedInlineDetail,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        canOpenSelectedSession: true,
        canWaitSelectedSession: true,
        isChildSession: true,
        selectedActionPending: true,
        selectedSession: expect.objectContaining({
          id: "child-2",
        }),
      }),
    );

    expect(harness.getValue().emptyShellProps).toMatchObject({
      className: "custom-shell",
      embedded: true,
      hasRuntimeFormation: true,
    });
    expect(harness.getValue().shellProps).toMatchObject({
      boardBodyClassName: "board-body",
      boardHeaderClassName: "board-header",
      boardShellClassName: "board-shell",
      embedded: true,
      style: { maxHeight: "inherit" },
    });
    expect(harness.getValue().shellProps.headerProps).toMatchObject({
      createdFromTurnId: "turn-42",
      detailToggleLabel: "查看细节",
      runtimeFormationStatusLabel: "准备中",
      totalTeamSessions: 2,
    });
    expect(
      harness.getValue().shellProps.canvasSectionProps.canvasStageProps
        .selectedSessionId,
    ).toBe("child-2");
    expect(
      harness.getValue().shellProps.canvasSectionProps.canvasStageProps
        .selectedInlineDetail,
    ).toBe(inlineDetailNode);
    expect(
      harness.getValue().shellProps.canvasSectionProps.overviewChromeProps,
    ).toMatchObject({
      completedCount: 1,
      pendingTeamAction: "wait_any",
      waitableCount: 2,
    });
    expect(
      harness.getValue().shellProps.canvasSectionProps.fallbackDetailProps,
    ).toBeNull();
  });

  it("应在尚无 runtime sessions 时保留 fallback detail 并保留普通 shell 高度", async () => {
    const harness = renderHook({
      embedded: false,
      sessionGraphState: {
        hasRealTeamGraph: false,
        isChildSession: false,
        isEmptyShellState: false,
        totalTeamSessions: 0,
      } as unknown as HookProps["sessionGraphState"],
      subagentParentContext: null,
    });

    await harness.render();

    expect(
      harness.getValue().shellProps.canvasSectionProps.fallbackDetailProps,
    ).toMatchObject({
      detailCardClassName: "detail-card",
      detailVisible: true,
    });
    expect(harness.getValue().shellProps.style).toBeUndefined();
    expect(harness.getValue().shellProps.headerProps.createdFromTurnId).toBe(
      undefined,
    );
  });
});
