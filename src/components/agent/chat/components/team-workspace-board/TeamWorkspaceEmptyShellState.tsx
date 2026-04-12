import { Activity, ChevronDown, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  TeamWorkspaceRuntimeFormationDisplayState,
  TeamWorkspaceSelectedTeamPlanDisplayState,
} from "../../team-workspace-runtime/formationDisplaySelectors";
import {
  TEAM_WORKSPACE_IDLE_STATUS_LABEL,
  TEAM_WORKSPACE_REALTIME_BADGE_LABEL,
  TEAM_WORKSPACE_SURFACE_TITLE,
} from "../../utils/teamWorkspaceCopy";

interface TeamWorkspaceEmptyShellStateProps {
  className?: string;
  embedded?: boolean;
  hasRuntimeFormation: boolean;
  onExpand: () => void;
  runtimeFormationDisplay: TeamWorkspaceRuntimeFormationDisplayState;
  selectedTeamPlanDisplay: TeamWorkspaceSelectedTeamPlanDisplayState;
}

export function TeamWorkspaceEmptyShellState({
  className,
  embedded = false,
  hasRuntimeFormation,
  onExpand,
  runtimeFormationDisplay,
  selectedTeamPlanDisplay,
}: TeamWorkspaceEmptyShellStateProps) {
  const summaryBadges = hasRuntimeFormation
    ? runtimeFormationDisplay.summaryBadges
    : selectedTeamPlanDisplay.summaryBadges;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5",
        embedded && "pointer-events-auto",
        embedded ? "mx-0 mt-0" : "mx-3 mt-2",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <Workflow className="h-3.5 w-3.5" />
            <span>{TEAM_WORKSPACE_SURFACE_TITLE}</span>
            <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-emerald-700 normal-case">
              <Activity className="h-3 w-3" />
              {TEAM_WORKSPACE_REALTIME_BADGE_LABEL}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">
              {hasRuntimeFormation
                ? runtimeFormationDisplay.panelHeadline
                : "任务协作已就绪"}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
              {runtimeFormationDisplay.panelStatusLabel ||
                TEAM_WORKSPACE_IDLE_STATUS_LABEL}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {hasRuntimeFormation
              ? runtimeFormationDisplay.hint
              : "这里先保持简洁，避免遮挡消息区；只有真正需要任务分工时才会展开完整面板。"}
          </p>
          {summaryBadges.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              {summaryBadges.map((badge) => (
                <span key={badge.key} className={badge.className}>
                  {badge.text}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onExpand}
          data-testid="team-workspace-detail-toggle"
        >
          <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
          查看任务进行时
        </Button>
      </div>
    </section>
  );
}
