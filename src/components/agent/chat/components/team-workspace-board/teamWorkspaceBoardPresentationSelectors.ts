import { cn } from "@/lib/utils";
import type { TeamWorkspaceRuntimeFormationStatus } from "../../teamWorkspaceRuntime";
import { TEAM_WORKSPACE_CANVAS_STAGE_HEIGHT } from "../../utils/teamWorkspaceCanvas";

interface ResolveTeamWorkspaceBoardCopyStateParams {
  detailExpanded: boolean;
  dispatchPreviewStatus?: TeamWorkspaceRuntimeFormationStatus | null;
  hasRuntimeSessions: boolean;
  isChildSession: boolean;
  isEmptyShellState: boolean;
  shellExpanded: boolean;
  visibleSessionsCount: number;
}

interface TeamWorkspaceBoardCopyState {
  detailToggleLabel: string;
  detailVisible: boolean;
  memberCanvasSubtitle: string;
  memberCanvasTitle: string;
}

interface BuildTeamWorkspaceBoardSurfaceClassNamesParams {
  className?: string;
  detailVisible: boolean;
  embedded: boolean;
  selectedSessionStatusCardClassName?: string | null;
  selectedSessionVisible: boolean;
  useCompactCanvasChrome: boolean;
}

interface TeamWorkspaceBoardSurfaceClassNames {
  boardBodyClassName: string;
  boardHeaderClassName: string;
  boardShellClassName: string;
  canvasStageHeight: string;
  detailCardClassName: string;
  inlineDetailSectionClassName: string;
  inlineTimelineEntryClassName: string;
  inlineTimelineFeedClassName: string;
  railCardClassName: string;
}

export function resolveTeamWorkspaceBoardCopyState({
  detailExpanded,
  dispatchPreviewStatus = null,
  hasRuntimeSessions,
  isChildSession,
  isEmptyShellState,
  shellExpanded,
  visibleSessionsCount,
}: ResolveTeamWorkspaceBoardCopyStateParams): TeamWorkspaceBoardCopyState {
  const detailVisible =
    isEmptyShellState || !hasRuntimeSessions
      ? detailExpanded || shellExpanded
      : false;

  return {
    detailToggleLabel: detailVisible ? "收起细节" : "查看细节",
    detailVisible,
    memberCanvasTitle: "当前进展",
    memberCanvasSubtitle: hasRuntimeSessions
      ? isChildSession
        ? "并行任务会在各自面板里持续更新进展和结果，主对话只保留必要摘要。"
        : `${visibleSessionsCount} 条当前进展已接入，当前焦点会优先落在正在处理的分工上。`
      : dispatchPreviewStatus === "forming"
        ? "正在准备当前任务分工，任务拆出后会在这里独立更新进展。"
        : dispatchPreviewStatus === "formed"
          ? "当前任务分工已经就绪，任务拆出后会在各自进展面板里开始处理。"
        : dispatchPreviewStatus === "failed"
            ? "这次任务分工准备失败，暂时无法生成当前进展面板。"
            : "任务拆出后，这里会展开为独立的当前进展。",
  };
}

export function buildTeamWorkspaceBoardSurfaceClassNames({
  className,
  detailVisible,
  embedded,
  selectedSessionStatusCardClassName = null,
  selectedSessionVisible,
  useCompactCanvasChrome,
}: BuildTeamWorkspaceBoardSurfaceClassNamesParams): TeamWorkspaceBoardSurfaceClassNames {
  return {
    boardBodyClassName: embedded
      ? cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain",
          useCompactCanvasChrome
            ? "space-y-2.5 p-3 sm:p-3.5"
            : "space-y-3 p-3 sm:p-4",
        )
      : cn(useCompactCanvasChrome ? "p-3 sm:p-3.5" : "p-3 sm:p-4"),
    boardHeaderClassName: cn(
      "flex flex-wrap items-start justify-between gap-3",
      useCompactCanvasChrome ? "px-4 py-2.5 sm:px-4" : "px-4 py-3.5 sm:px-5",
      embedded
        ? cn(
            "sticky top-0 z-20 border-b border-slate-200",
            useCompactCanvasChrome ? "bg-white" : "bg-slate-50",
          )
        : cn(
            "border-b border-slate-200",
            useCompactCanvasChrome ? "bg-white" : "bg-slate-50",
          ),
    ),
    boardShellClassName: cn(
      embedded
        ? "pointer-events-auto flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5"
        : "overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_18px_64px_-42px_rgba(15,23,42,0.24)]",
      embedded ? "mx-0 mt-0" : "mx-3 mt-2",
      className,
    ),
    canvasStageHeight:
      embedded && !detailVisible
        ? "clamp(560px, 76vh, 980px)"
        : TEAM_WORKSPACE_CANVAS_STAGE_HEIGHT,
    detailCardClassName: cn(
      embedded
        ? "rounded-[20px] border border-slate-200 bg-white p-4"
        : "rounded-[22px] border p-4 shadow-sm shadow-slate-950/5",
      !embedded &&
        (selectedSessionVisible
          ? selectedSessionStatusCardClassName
          : "border-slate-200 bg-white"),
    ),
    inlineDetailSectionClassName:
      "mt-3 rounded-[18px] border border-slate-200 bg-slate-50 p-3",
    inlineTimelineEntryClassName:
      "rounded-[14px] border border-slate-200 bg-white p-3",
    inlineTimelineFeedClassName:
      "mt-3 rounded-[16px] border border-slate-200 bg-white p-3",
    railCardClassName: embedded
      ? cn(
          "pointer-events-auto",
          useCompactCanvasChrome ? "space-y-3" : "space-y-4",
        )
      : "rounded-[22px] border border-slate-200 bg-slate-50 p-3.5 shadow-sm shadow-slate-950/5",
  };
}
