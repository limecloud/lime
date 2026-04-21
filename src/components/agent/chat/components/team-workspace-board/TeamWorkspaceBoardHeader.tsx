import { ArrowUpLeft, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TeamWorkspaceBoardChromeDisplayState } from "../../team-workspace-runtime/boardChromeSelectors";
import type { TeamWorkspaceRuntimeStatus } from "../../teamWorkspaceRuntime";
import { TEAM_WORKSPACE_IDLE_STATUS_LABEL, TEAM_WORKSPACE_SURFACE_TITLE } from "../../utils/teamWorkspaceCopy";

interface TeamWorkspaceStatusMeta {
  badgeClassName: string;
}

interface TeamWorkspaceBoardHeaderProps {
  boardChromeDisplay: TeamWorkspaceBoardChromeDisplayState;
  className: string;
  createdFromTurnId?: string | null;
  dataTestId?: string;
  detailToggleLabel: string;
  detailVisible: boolean;
  isChildSession: boolean;
  isEmptyShellState: boolean;
  onReturnToParentSession?: () => void | Promise<void>;
  onToggleDetail: () => void;
  resolveStatusMeta: (
    status?: TeamWorkspaceRuntimeStatus,
  ) => TeamWorkspaceStatusMeta;
  runtimeFormationStatusLabel?: string | null;
  totalTeamSessions: number;
  useCompactCanvasChrome: boolean;
}

export function TeamWorkspaceBoardHeader({
  boardChromeDisplay,
  className,
  createdFromTurnId,
  dataTestId,
  detailToggleLabel,
  detailVisible,
  isChildSession,
  isEmptyShellState,
  onReturnToParentSession,
  onToggleDetail,
  resolveStatusMeta,
  runtimeFormationStatusLabel,
  totalTeamSessions,
  useCompactCanvasChrome,
}: TeamWorkspaceBoardHeaderProps) {
  return (
    <div className={className} data-testid={dataTestId}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium">
            {TEAM_WORKSPACE_SURFACE_TITLE}
          </span>
          {createdFromTurnId ? (
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
              承接自 {createdFromTurnId}
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className={cn("text-[15px] font-semibold leading-6 text-slate-900")}
          >
            {boardChromeDisplay.compactBoardHeadline}
          </span>
          {!useCompactCanvasChrome && !isChildSession && totalTeamSessions > 0 ? (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] text-sky-700">
              {totalTeamSessions} 项任务
            </span>
          ) : null}
        </div>
        {!useCompactCanvasChrome ? (
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {boardChromeDisplay.boardHint}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isEmptyShellState ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onToggleDetail}
            data-testid="team-workspace-detail-toggle"
          >
            {detailVisible ? (
              <ChevronUp className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
            )}
            {detailToggleLabel}
          </Button>
        ) : null}
        {isEmptyShellState ? (
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500">
            {runtimeFormationStatusLabel || TEAM_WORKSPACE_IDLE_STATUS_LABEL}
          </span>
        ) : !useCompactCanvasChrome ? (
          boardChromeDisplay.statusSummaryBadges.map((badge) => {
            const meta = resolveStatusMeta(badge.status);
            return (
              <span
                key={badge.key}
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium",
                  meta.badgeClassName,
                )}
              >
                {badge.text}
              </span>
            );
          })
        ) : null}
        {isChildSession && onReturnToParentSession ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void onReturnToParentSession()}
          >
            <ArrowUpLeft className="mr-1.5 h-3.5 w-3.5" />
            返回主助手
          </Button>
        ) : null}
      </div>
    </div>
  );
}
