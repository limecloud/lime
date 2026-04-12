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

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {useCompactCanvasChrome ? (
          <>
            <div
              className="flex flex-wrap items-center gap-2"
              data-testid="team-workspace-canvas-toolbar"
            >
              {boardChromeDisplay.compactToolbarChips.map((chip) => (
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
            <div className="flex flex-wrap items-center gap-2">
              <TeamWorkspaceTeamActionButtons
                canCloseCompletedTeamSessions={canCloseCompletedTeamSessions}
                canWaitAnyActiveTeamSession={canWaitAnyActiveTeamSession}
                onCloseCompletedTeamSessions={onCloseCompletedTeamSessions}
                onWaitAnyActiveTeamSessions={onWaitAnyActiveTeamSessions}
                pendingTeamAction={pendingTeamAction}
              />
              <TeamWorkspaceCanvasViewButtons
                onAutoArrangeCanvas={onAutoArrangeCanvas}
                onFitCanvasView={onFitCanvasView}
                onZoomIn={onZoomIn}
                onZoomOut={onZoomOut}
              />
            </div>
          </>
        ) : (
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
                    当前对话
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
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
              {waitableCount} 位成员正在处理中
            </span>
          ) : null}
          {canCloseCompletedTeamSessions ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
              {completedCount} 位成员已完成
            </span>
          ) : null}
        </div>
      ) : null}
      <TeamWorkspaceTeamOperationsPanel
        embedded={embedded}
        onSelectTeamOperationEntry={onSelectTeamOperationEntry}
        teamOperationEntries={teamOperationEntries}
        useCompactCanvasChrome={useCompactCanvasChrome}
      />
    </>
  );
}
