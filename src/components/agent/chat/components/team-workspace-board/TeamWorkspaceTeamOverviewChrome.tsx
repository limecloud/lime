import { Clock3 } from "lucide-react";
import type { TeamWorkspaceBoardChromeDisplayState } from "../../team-workspace-runtime/boardChromeSelectors";
import type { TeamOperationDisplayEntry } from "../../team-workspace-runtime/teamOperationSelectors";
import type { TeamWorkspaceRuntimeStatus } from "../../teamWorkspaceRuntime";
import {
  TeamWorkspaceCanvasViewButtons,
  TeamWorkspaceCompactToolbarChip,
  TeamWorkspaceTeamActionButtons,
} from "./TeamWorkspaceTeamOverviewControls";
import { TeamWorkspaceTeamOperationsPanel } from "./TeamWorkspaceTeamOperationsPanel";

interface TeamWorkspaceStatusMeta {
  badgeClassName: string;
}

interface TeamWorkspaceOverviewSelectedSession {
  name?: string;
  isCurrent?: boolean;
  updatedAt?: number;
}

interface TeamWorkspaceTeamOverviewChromeProps {
  boardChromeDisplay: TeamWorkspaceBoardChromeDisplayState;
  canCloseCompletedTeamSessions: boolean;
  canWaitAnyActiveTeamSession: boolean;
  completedCount: number;
  embedded: boolean;
  formatUpdatedAt: (updatedAt?: number) => string;
  memberCanvasSubtitle: string;
  memberCanvasTitle: string;
  onAutoArrangeCanvas: () => void;
  onCloseCompletedTeamSessions: () => void | Promise<void>;
  onFitCanvasView: () => void;
  onSelectTeamOperationEntry: (entry: TeamOperationDisplayEntry) => void;
  onWaitAnyActiveTeamSessions: () => void | Promise<void>;
  onZoomIn: () => void;
  onZoomOut: () => void;
  pendingTeamAction: "wait_any" | "close_completed" | null;
  resolveStatusMeta: (
    status?: TeamWorkspaceRuntimeStatus,
  ) => TeamWorkspaceStatusMeta;
  selectedSession?: TeamWorkspaceOverviewSelectedSession | null;
  teamOperationEntries: TeamOperationDisplayEntry[];
  useCompactCanvasChrome: boolean;
  waitableCount: number;
}

export function TeamWorkspaceTeamOverviewChrome({
  boardChromeDisplay,
  canCloseCompletedTeamSessions,
  canWaitAnyActiveTeamSession,
  completedCount,
  embedded,
  formatUpdatedAt,
  memberCanvasSubtitle,
  memberCanvasTitle,
  onAutoArrangeCanvas,
  onCloseCompletedTeamSessions,
  onFitCanvasView,
  onSelectTeamOperationEntry,
  onWaitAnyActiveTeamSessions,
  onZoomIn,
  onZoomOut,
  pendingTeamAction,
  resolveStatusMeta,
  selectedSession,
  teamOperationEntries,
  useCompactCanvasChrome,
  waitableCount,
}: TeamWorkspaceTeamOverviewChromeProps) {
  const compactCanvasSummaryChipClassName =
    "rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500";
  const compactCanvasMutedChipClassName =
    "rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500";
  const compactActionButtonClassName =
    "h-8 rounded-full border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-100";
  const compactViewButtonClassName =
    "h-8 rounded-full border-slate-200 bg-slate-50 px-3 text-xs text-slate-600 hover:bg-white";
  const compactSummaryStatusChips =
    boardChromeDisplay.compactToolbarChips.filter(
      (chip) => chip.key !== "focus",
    );
  const hasCompactTaskActions =
    canWaitAnyActiveTeamSession || canCloseCompletedTeamSessions;

  return (
    <>
      {useCompactCanvasChrome ? (
        <div className="space-y-2.5">
          <div
            className="rounded-[20px] border border-slate-200 bg-white px-3.5 py-3 shadow-sm shadow-slate-950/5"
            data-testid="team-workspace-compact-summary"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {memberCanvasTitle}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {selectedSession?.name?.trim() || "等待任务接手"}
                  </div>
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                    {selectedSession ? "当前焦点" : "等待接手"}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {memberCanvasSubtitle}
                </p>
              </div>
              {selectedSession ? (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                    <Clock3 className="h-3.5 w-3.5" />
                    更新于 {formatUpdatedAt(selectedSession.updatedAt)}
                  </span>
                  {selectedSession.isCurrent ? (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                      当前任务
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            {compactSummaryStatusChips.length > 0 ? (
              <div
                className="mt-3 flex flex-wrap items-center gap-2"
                data-testid="team-workspace-canvas-toolbar"
              >
                {compactSummaryStatusChips.map((chip) => (
                  <TeamWorkspaceCompactToolbarChip
                    key={chip.key}
                    chip={chip}
                    compactCanvasMutedChipClassName={
                      compactCanvasMutedChipClassName
                    }
                    compactCanvasSummaryChipClassName={
                      compactCanvasSummaryChipClassName
                    }
                    resolveStatusMeta={resolveStatusMeta}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <TeamWorkspaceTeamOperationsPanel
            embedded={embedded}
            onSelectTeamOperationEntry={onSelectTeamOperationEntry}
            teamOperationEntries={teamOperationEntries}
            useCompactCanvasChrome={true}
          />
          <div
            className="flex flex-wrap items-start justify-between gap-2.5"
            data-testid="team-workspace-compact-controls"
          >
            {hasCompactTaskActions ? (
              <div
                className="flex flex-wrap items-center gap-2 rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2"
                data-testid="team-workspace-compact-task-actions"
              >
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  任务处理
                </span>
                <TeamWorkspaceTeamActionButtons
                  buttonClassName={compactActionButtonClassName}
                  canCloseCompletedTeamSessions={canCloseCompletedTeamSessions}
                  canWaitAnyActiveTeamSession={canWaitAnyActiveTeamSession}
                  onCloseCompletedTeamSessions={onCloseCompletedTeamSessions}
                  onWaitAnyActiveTeamSessions={onWaitAnyActiveTeamSessions}
                  pendingTeamAction={pendingTeamAction}
                />
              </div>
            ) : null}
            <div
              className="flex flex-wrap items-center gap-2 rounded-[18px] border border-slate-200 bg-white px-3 py-2"
              data-testid="team-workspace-compact-view-actions"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                视图
              </span>
              <TeamWorkspaceCanvasViewButtons
                buttonClassName={compactViewButtonClassName}
                includeZoomControls={false}
                onAutoArrangeCanvas={onAutoArrangeCanvas}
                onFitCanvasView={onFitCanvasView}
                onZoomIn={onZoomIn}
                onZoomOut={onZoomOut}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {memberCanvasTitle}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {memberCanvasSubtitle}
              </div>
            </div>
            {selectedSession ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                  <Clock3 className="h-3.5 w-3.5" />
                  更新于 {formatUpdatedAt(selectedSession.updatedAt)}
                </span>
                {selectedSession.isCurrent ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                    当前任务
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        </div>
      )}
      {!useCompactCanvasChrome &&
      (canWaitAnyActiveTeamSession ||
        canCloseCompletedTeamSessions ||
        teamOperationEntries.length > 0) ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TeamWorkspaceTeamActionButtons
            canCloseCompletedTeamSessions={canCloseCompletedTeamSessions}
            canWaitAnyActiveTeamSession={canWaitAnyActiveTeamSession}
            onCloseCompletedTeamSessions={onCloseCompletedTeamSessions}
            onWaitAnyActiveTeamSessions={onWaitAnyActiveTeamSessions}
            pendingTeamAction={pendingTeamAction}
          />
          {canWaitAnyActiveTeamSession ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
              {waitableCount} 项任务正在处理中
            </span>
          ) : null}
          {canCloseCompletedTeamSessions ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
              {completedCount} 项任务已完成
            </span>
          ) : null}
        </div>
      ) : null}
      {!useCompactCanvasChrome ? (
        <TeamWorkspaceTeamOperationsPanel
          embedded={embedded}
          onSelectTeamOperationEntry={onSelectTeamOperationEntry}
          teamOperationEntries={teamOperationEntries}
          useCompactCanvasChrome={false}
        />
      ) : null}
    </>
  );
}
