import { Activity, Clock3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TeamWorkspaceBoardChromeDisplayState } from "../../team-workspace-runtime/boardChromeSelectors";
import {
  formatOperationUpdatedAt,
  type TeamOperationDisplayEntry,
} from "../../team-workspace-runtime/teamOperationSelectors";
import type { TeamWorkspaceRuntimeStatus } from "../../teamWorkspaceRuntime";

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

function TeamWorkspaceTeamActionButtons(props: {
  canCloseCompletedTeamSessions: boolean;
  canWaitAnyActiveTeamSession: boolean;
  onCloseCompletedTeamSessions: () => void | Promise<void>;
  onWaitAnyActiveTeamSessions: () => void | Promise<void>;
  pendingTeamAction: "wait_any" | "close_completed" | null;
}) {
  return (
    <>
      {props.canWaitAnyActiveTeamSession ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.pendingTeamAction === "wait_any"}
          onClick={() => void props.onWaitAnyActiveTeamSessions()}
          data-testid="team-workspace-wait-active-button"
        >
          {props.pendingTeamAction === "wait_any" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : null}
          {props.pendingTeamAction === "wait_any"
            ? "等待中..."
            : "等待任一成员结果"}
        </Button>
      ) : null}
      {props.canCloseCompletedTeamSessions ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.pendingTeamAction === "close_completed"}
          onClick={() => void props.onCloseCompletedTeamSessions()}
          data-testid="team-workspace-close-completed-button"
        >
          {props.pendingTeamAction === "close_completed" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : null}
          {props.pendingTeamAction === "close_completed"
            ? "收起中..."
            : "收起已完成成员"}
        </Button>
      ) : null}
    </>
  );
}

function TeamWorkspaceCanvasViewButtons(props: {
  onAutoArrangeCanvas: () => void;
  onFitCanvasView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={props.onAutoArrangeCanvas}
        data-testid="team-workspace-auto-arrange-button"
      >
        整理布局
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={props.onZoomOut}
      >
        缩小
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={props.onZoomIn}
      >
        放大
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={props.onFitCanvasView}
      >
        适应视图
      </Button>
    </>
  );
}

function TeamWorkspaceCompactToolbarChip(props: {
  chip: TeamWorkspaceBoardChromeDisplayState["compactToolbarChips"][number];
  compactCanvasMutedChipClassName: string;
  compactCanvasSummaryChipClassName: string;
  resolveStatusMeta: (
    status?: TeamWorkspaceRuntimeStatus,
  ) => TeamWorkspaceStatusMeta;
}) {
  if (props.chip.tone === "status") {
    return (
      <span
        className={cn(
          "rounded-full px-2.5 py-1 text-[11px] font-medium",
          props.resolveStatusMeta(props.chip.status).badgeClassName,
        )}
      >
        {props.chip.text}
      </span>
    );
  }

  return (
    <span
      className={
        props.chip.tone === "summary"
          ? props.compactCanvasSummaryChipClassName
          : props.compactCanvasMutedChipClassName
      }
    >
      {props.chip.text}
    </span>
  );
}

function TeamWorkspaceTeamOperationsPanel(props: {
  embedded: boolean;
  onSelectTeamOperationEntry: (entry: TeamOperationDisplayEntry) => void;
  teamOperationEntries: TeamOperationDisplayEntry[];
  useCompactCanvasChrome: boolean;
}) {
  if (props.teamOperationEntries.length === 0) {
    return null;
  }

  if (props.useCompactCanvasChrome) {
    return (
      <div
        className="mt-2 flex items-start gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="team-workspace-team-operations"
      >
        <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-500 shadow-sm shadow-slate-950/5">
          <Activity className="h-3.5 w-3.5" />
          <span>协作动态</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
            {props.teamOperationEntries.length}
          </span>
        </div>
        {props.teamOperationEntries.map((entry) => {
          const content = (
            <div className="flex min-w-0 items-start gap-2">
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  entry.badgeClassName,
                )}
              >
                {entry.title}
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs leading-5 text-slate-700">
                  {entry.detail}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  {formatOperationUpdatedAt(entry.updatedAt)}
                </div>
              </div>
            </div>
          );

          return entry.targetSessionId ? (
            <button
              key={entry.id}
              type="button"
              className="inline-flex min-w-[220px] max-w-[340px] shrink-0 rounded-[16px] border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
              onClick={() => props.onSelectTeamOperationEntry(entry)}
            >
              {content}
            </button>
          ) : (
            <div
              key={entry.id}
              className="inline-flex min-w-[220px] max-w-[340px] shrink-0 rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2"
            >
              {content}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={cn(
        props.embedded
          ? "mt-3 border-t border-slate-200 pt-3"
          : "mt-3 rounded-[18px] border border-slate-200 bg-white p-3",
      )}
      data-testid="team-workspace-team-operations"
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <Activity className="h-3.5 w-3.5" />
        <span>协作动态</span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
          最近 {props.teamOperationEntries.length} 条
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {props.teamOperationEntries.map((entry) => {
          const content = (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    entry.badgeClassName,
                  )}
                >
                  {entry.title}
                </span>
                <span className="text-[11px] text-slate-500">
                  {formatOperationUpdatedAt(entry.updatedAt)}
                </span>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                {entry.detail}
              </p>
            </>
          );

          return entry.targetSessionId ? (
            <button
              key={entry.id}
              type="button"
              className={cn(
                "w-full text-left transition",
                props.embedded
                  ? "border-l-2 border-slate-200 px-3 py-2 hover:border-slate-300 hover:bg-slate-50"
                  : "rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5 hover:border-slate-300 hover:bg-slate-50",
              )}
              onClick={() => props.onSelectTeamOperationEntry(entry)}
            >
              {content}
            </button>
          ) : (
            <div
              key={entry.id}
              className={cn(
                props.embedded
                  ? "border-l-2 border-slate-200 px-3 py-2"
                  : "rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5",
              )}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
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
