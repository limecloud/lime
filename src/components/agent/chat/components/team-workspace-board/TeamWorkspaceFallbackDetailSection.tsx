import { Bot } from "lucide-react";
import type {
  TeamWorkspaceRuntimeFormationDisplayState,
  TeamWorkspaceSelectedTeamPlanDisplayState,
} from "../../team-workspace-runtime/formationDisplaySelectors";
import {
  TeamWorkspaceRuntimeFormationPanel,
  TeamWorkspaceSelectedPlanPanel,
} from "./TeamWorkspaceFormationPanels";

interface TeamWorkspaceFallbackDetailSectionProps {
  detailCardClassName: string;
  detailVisible: boolean;
  runtimeFormationDisplay: TeamWorkspaceRuntimeFormationDisplayState;
  selectedTeamPlanDisplay: TeamWorkspaceSelectedTeamPlanDisplayState;
}

export function TeamWorkspaceFallbackDetailSection({
  detailCardClassName,
  detailVisible,
  runtimeFormationDisplay,
  selectedTeamPlanDisplay,
}: TeamWorkspaceFallbackDetailSectionProps) {
  const hasRuntimeFormation = runtimeFormationDisplay.hasRuntimeFormation;
  const hasSelectedTeamPlan = selectedTeamPlanDisplay.hasSelectedTeamPlan;

  return (
    <>
      {hasRuntimeFormation ? (
        <TeamWorkspaceRuntimeFormationPanel
          runtimeFormationDisplay={runtimeFormationDisplay}
        />
      ) : hasSelectedTeamPlan ? (
        <TeamWorkspaceSelectedPlanPanel
          selectedTeamPlanDisplay={selectedTeamPlanDisplay}
        />
      ) : null}
      <div className="mt-4 rounded-[20px] border border-dashed border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-500">
        {runtimeFormationDisplay.noticeText}
      </div>
      {detailVisible ? (
        <div
          className={detailCardClassName}
          data-testid="team-workspace-detail-section"
        >
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <Bot className="h-3.5 w-3.5" />
            <span>当前详情</span>
          </div>
          <div className="mt-2 text-base font-semibold text-slate-900">
            {runtimeFormationDisplay.panelHeadline}
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {runtimeFormationDisplay.emptyDetail}
          </p>
          {hasRuntimeFormation ? (
            <div className="mt-4 space-y-4">
              <TeamWorkspaceRuntimeFormationPanel
                runtimeFormationDisplay={runtimeFormationDisplay}
                showBlueprintRoleCards
              />
            </div>
          ) : hasSelectedTeamPlan ? (
            <div className="mt-4">
              <TeamWorkspaceSelectedPlanPanel
                selectedTeamPlanDisplay={selectedTeamPlanDisplay}
              />
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
              推荐流程：邀请协作成员 → 查看结果 → 补充说明
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}
