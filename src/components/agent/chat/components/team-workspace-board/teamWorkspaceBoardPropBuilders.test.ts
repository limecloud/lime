import { describe, expect, it, vi } from "vitest";
import {
  buildTeamWorkspaceBoardCanvasSectionProps,
  buildTeamWorkspaceBoardEmptyShellProps,
  buildTeamWorkspaceBoardHeaderProps,
  buildTeamWorkspaceBoardShellProps,
} from "./teamWorkspaceBoardPropBuilders";

describe("teamWorkspaceBoardPropBuilders", () => {
  it("应按嵌入态规则组装 empty shell 与 shell props", () => {
    const onExpand = vi.fn();
    const onToggleDetail = vi.fn();
    const onReturnToParentSession = vi.fn();
    const resolveStatusMeta = vi.fn().mockReturnValue({
      badgeClassName: "border-sky-200 bg-sky-50 text-sky-700",
    });

    const emptyShellProps = buildTeamWorkspaceBoardEmptyShellProps({
      className: "custom-shell",
      embedded: true,
      hasRuntimeFormation: true,
      onExpand,
      runtimeFormationDisplay: {
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
      },
      selectedTeamPlanDisplay: {
        hasSelectedTeamPlan: true,
        label: "编辑 Team",
        roleCards: [],
        summary: "先拆三段，再并行推进。",
        summaryBadges: [],
      },
    });

    const headerProps = buildTeamWorkspaceBoardHeaderProps({
      boardChromeDisplay: {
        boardHeadline: "主任务总览",
        boardHint: "主线程会持续汇总子任务进展。",
        compactBoardHeadline: "任务进行中 · 3 项处理中",
        compactToolbarChips: [],
        statusSummaryBadges: [],
      },
      createdFromTurnId: "turn-42",
      detailToggleLabel: "查看细节",
      detailVisible: false,
      isChildSession: true,
      isEmptyShellState: false,
      onReturnToParentSession,
      onToggleDetail,
      resolveStatusMeta,
      runtimeFormationStatusLabel: "准备中",
      totalTeamSessions: 3,
      useCompactCanvasChrome: true,
    });

    const shellProps = buildTeamWorkspaceBoardShellProps({
      boardBodyClassName: "board-body",
      boardHeaderClassName: "board-header",
      boardShellClassName: "board-shell",
      canvasSectionProps: {
        canvasStageProps: {
          canvasBoundsHeight: 720,
          canvasBoundsWidth: 1080,
          canvasStageHeight: "720px",
          canvasStageHint: "拖动查看任务进行时",
          expandedSessionId: "child-1",
          isCanvasPanModifierActive: false,
          laneLayouts: {},
          lanes: [],
          onCanvasWheel: vi.fn(),
          onSelectLane: vi.fn(),
          onStartCanvasLaneDrag: vi.fn(),
          onStartCanvasLaneResize: vi.fn(),
          onStartCanvasPan: vi.fn(),
          selectedInlineDetail: null,
          selectedSessionId: "child-1",
          viewport: { x: 0, y: 0, zoom: 1 },
          viewportRef: { current: null },
        },
        canvasToolbarProps: {
          laneCount: 0,
          onAutoArrangeCanvas: vi.fn(),
          onFitCanvasView: vi.fn(),
          onResetCanvasView: vi.fn(),
          onZoomIn: vi.fn(),
          onZoomOut: vi.fn(),
          zoom: 1,
        },
        overviewChromeProps: {
          boardChromeDisplay: {
            boardHeadline: "主任务总览",
            boardHint: "主线程会持续汇总子任务进展。",
            compactBoardHeadline: "任务进行中 · 3 项处理中",
            compactToolbarChips: [],
            statusSummaryBadges: [],
          },
          canCloseCompletedTeamSessions: false,
          canWaitAnyActiveTeamSession: false,
          completedCount: 0,
          formatUpdatedAt: () => "刚刚",
          memberCanvasSubtitle: "子任务会持续更新进展。",
          memberCanvasTitle: "任务视图",
          onAutoArrangeCanvas: vi.fn(),
          onCloseCompletedTeamSessions: vi.fn(),
          onFitCanvasView: vi.fn(),
          onSelectTeamOperationEntry: vi.fn(),
          onWaitAnyActiveTeamSessions: vi.fn(),
          onZoomIn: vi.fn(),
          onZoomOut: vi.fn(),
          pendingTeamAction: null,
          resolveStatusMeta,
          selectedSession: null,
          teamOperationEntries: [],
          waitableCount: 0,
        },
        fallbackDetailProps: null,
        railCardClassName: "rail-card",
        useCompactCanvasChrome: true,
      },
      embedded: true,
      headerProps,
    });

    expect(emptyShellProps).toMatchObject({
      className: "custom-shell",
      embedded: true,
      hasRuntimeFormation: true,
    });
    expect(emptyShellProps.onExpand).toBe(onExpand);
    expect(headerProps).toMatchObject({
      createdFromTurnId: "turn-42",
      detailToggleLabel: "查看细节",
      runtimeFormationStatusLabel: "准备中",
      totalTeamSessions: 3,
    });
    expect(headerProps.onToggleDetail).toBe(onToggleDetail);
    expect(headerProps.onReturnToParentSession).toBe(onReturnToParentSession);
    expect(shellProps).toMatchObject({
      boardBodyClassName: "board-body",
      boardHeaderClassName: "board-header",
      boardShellClassName: "board-shell",
      embedded: true,
      style: { maxHeight: "inherit" },
    });
  });

  it("应在尚无 runtime sessions 时为 canvas section 透传 fallback detail 与 overview props", () => {
    const onStartCanvasLaneDrag = vi.fn();
    const onStartCanvasLaneResize = vi.fn();
    const onSelectTeamOperationEntry = vi.fn();
    const resolveStatusMeta = vi.fn().mockReturnValue({
      badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
    });

    const props = buildTeamWorkspaceBoardCanvasSectionProps({
      boardChromeDisplay: {
        boardHeadline: "任务进行中 · 1 项处理中 / 1 项稍后开始",
        boardHint: "当前主任务会继续汇总进展。",
        compactBoardHeadline: "任务进行中 · 1 项处理中 / 1 项稍后开始",
        compactToolbarChips: [
          {
            key: "running",
            text: "运行中 1",
            tone: "status",
            status: "running",
          },
        ],
        statusSummaryBadges: [],
      },
      canvasBoundsHeight: 680,
      canvasBoundsWidth: 960,
      canvasStageHeight: "680px",
      canvasStageHint: "正在同步任务进行时",
      canvasViewportRef: { current: null },
      canvasZoom: 1.2,
      canCloseCompletedTeamSessions: true,
      canWaitAnyActiveTeamSession: true,
      completedCount: 1,
      detailCardClassName: "detail-card",
      detailVisible: true,
      expandedSessionId: "child-2",
      formatUpdatedAt: () => "刚刚",
      hasRuntimeSessions: false,
      isCanvasPanModifierActive: true,
      laneLayouts: {},
      lanes: [
        {
          persistKey: "lane-alpha",
        } as never,
      ],
      memberCanvasSubtitle: "子任务会持续更新任务进展。",
      memberCanvasTitle: "任务视图",
      onAutoArrangeCanvas: vi.fn(),
      onCanvasWheel: vi.fn(),
      onCloseCompletedTeamSessions: vi.fn(),
      onFitCanvasView: vi.fn(),
      onResetCanvasView: vi.fn(),
      onSelectCanvasLane: vi.fn(),
      onSelectTeamOperationEntry,
      onStartCanvasLaneDrag,
      onStartCanvasLaneResize,
      onStartCanvasPan: vi.fn(),
      onWaitAnyActiveTeamSessions: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      pendingTeamAction: "wait_any",
      railCardClassName: "rail-card",
      resolveStatusMeta,
      runtimeFormationDisplay: {
        blueprintRoleCards: [],
        emptyDetail: "系统正在准备分工。",
        hint: "正在准备分工",
        hasRuntimeFormation: true,
        memberCards: [],
        noticeText: "系统正在准备当前任务分工。",
        panelDescription: "当前任务分工正在生成。",
        panelHeadline: "任务分工准备中",
        panelLabel: "资料整理 Team",
        panelStatusLabel: "准备中",
        panelStatusBadgeClassName: "border-sky-200 bg-sky-50 text-sky-700",
        panelTitle: "当前任务分工",
        referenceLabel: null,
        summaryBadges: [],
      },
      selectedInlineDetail: "inline-detail",
      selectedSession: {
        isCurrent: false,
        updatedAt: 1710000000,
      },
      selectedSessionId: "child-2",
      selectedTeamPlanDisplay: {
        hasSelectedTeamPlan: true,
        label: "资料整理 Team",
        roleCards: [],
        summary: "先拆任务，再并行推进。",
        summaryBadges: [],
      },
      teamOperationEntries: [
        {
          badgeClassName: "border-sky-200 bg-sky-50 text-sky-700",
          detail: "资料整理返回了新结果",
          id: "wait-1",
          title: "收到结果",
          updatedAt: 1710000000,
          targetSessionId: "child-2",
        },
      ],
      useCompactCanvasChrome: true,
      viewport: { x: 12, y: 24, zoom: 1.2 },
      waitableCount: 2,
    });

    expect(props.fallbackDetailProps).toMatchObject({
      detailCardClassName: "detail-card",
      detailVisible: true,
    });
    expect(props.overviewChromeProps).toMatchObject({
      canCloseCompletedTeamSessions: true,
      canWaitAnyActiveTeamSession: true,
      completedCount: 1,
      memberCanvasTitle: "任务视图",
      pendingTeamAction: "wait_any",
      waitableCount: 2,
    });
    expect(props.canvasToolbarProps.zoom).toBe(1.2);
    expect(props.canvasStageProps.selectedInlineDetail).toBe("inline-detail");
    expect(props.canvasStageProps.viewport).toEqual({ x: 12, y: 24, zoom: 1.2 });

    props.canvasStageProps.onStartCanvasLaneDrag?.(
      { persistKey: "lane-alpha" } as never,
      { clientX: 10, clientY: 20 } as never,
    );
    props.canvasStageProps.onStartCanvasLaneResize?.(
      { persistKey: "lane-alpha" } as never,
      "right" as never,
      { clientX: 40, clientY: 60 } as never,
    );

    expect(onStartCanvasLaneDrag).toHaveBeenCalledWith(
      "lane-alpha",
      expect.anything(),
    );
    expect(onStartCanvasLaneResize).toHaveBeenCalledWith(
      "lane-alpha",
      "right",
      expect.anything(),
    );
    expect(props.overviewChromeProps.onSelectTeamOperationEntry).toBe(
      onSelectTeamOperationEntry,
    );
    expect(props.railCardClassName).toBe("rail-card");
    expect(props.useCompactCanvasChrome).toBe(true);
  });

  it("应在已有 runtime sessions 时关闭 fallback detail", () => {
    const props = buildTeamWorkspaceBoardCanvasSectionProps({
      boardChromeDisplay: {
        boardHeadline: "任务进行中",
        boardHint: "正在持续汇总任务进展。",
        compactBoardHeadline: "任务进行中",
        compactToolbarChips: [],
        statusSummaryBadges: [],
      },
      canvasBoundsHeight: 680,
      canvasBoundsWidth: 960,
      canvasStageHeight: "680px",
      canvasStageHint: "正在同步任务进行时",
      canvasViewportRef: { current: null },
      canvasZoom: 1,
      canCloseCompletedTeamSessions: false,
      canWaitAnyActiveTeamSession: false,
      completedCount: 0,
      detailCardClassName: "detail-card",
      detailVisible: false,
      expandedSessionId: null,
      formatUpdatedAt: () => "刚刚",
      hasRuntimeSessions: true,
      isCanvasPanModifierActive: false,
      laneLayouts: {},
      lanes: [],
      memberCanvasSubtitle: "已有任务接入。",
      memberCanvasTitle: "任务视图",
      onAutoArrangeCanvas: vi.fn(),
      onCanvasWheel: vi.fn(),
      onCloseCompletedTeamSessions: vi.fn(),
      onFitCanvasView: vi.fn(),
      onResetCanvasView: vi.fn(),
      onSelectCanvasLane: vi.fn(),
      onSelectTeamOperationEntry: vi.fn(),
      onStartCanvasLaneDrag: vi.fn(),
      onStartCanvasLaneResize: vi.fn(),
      onStartCanvasPan: vi.fn(),
      onWaitAnyActiveTeamSessions: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      pendingTeamAction: null,
      railCardClassName: "rail-card",
      resolveStatusMeta: vi.fn(),
      runtimeFormationDisplay: {
        blueprintRoleCards: [],
        emptyDetail: "系统正在准备分工。",
        hint: "正在准备分工",
        hasRuntimeFormation: true,
        memberCards: [],
        noticeText: "系统正在准备当前任务分工。",
        panelDescription: "当前任务分工正在生成。",
        panelHeadline: "任务分工准备中",
        panelLabel: "资料整理 Team",
        panelStatusLabel: "准备中",
        panelStatusBadgeClassName: "border-sky-200 bg-sky-50 text-sky-700",
        panelTitle: "当前任务分工",
        referenceLabel: null,
        summaryBadges: [],
      },
      selectedInlineDetail: null,
      selectedSession: null,
      selectedSessionId: null,
      selectedTeamPlanDisplay: {
        hasSelectedTeamPlan: true,
        label: "资料整理 Team",
        roleCards: [],
        summary: "先拆任务，再并行推进。",
        summaryBadges: [],
      },
      teamOperationEntries: [],
      useCompactCanvasChrome: true,
      viewport: { x: 0, y: 0, zoom: 1 },
      waitableCount: 0,
    });

    expect(props.fallbackDetailProps).toBeNull();
  });
});
