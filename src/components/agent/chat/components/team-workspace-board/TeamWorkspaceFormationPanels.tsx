import { Bot, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  TeamWorkspaceRuntimeFormationDisplayState,
  TeamWorkspaceSelectedTeamPlanDisplayState,
} from "../../team-workspace-runtime/formationDisplaySelectors";

function TeamWorkspaceMemberCard(props: {
  badgeClassName: string;
  badgeLabel: string;
  label: string;
  summary: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-900">
          {props.label}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            props.badgeClassName,
          )}
        >
          {props.badgeLabel}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{props.summary}</p>
    </div>
  );
}

function TeamWorkspaceRoleCard(props: { label: string; summary: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-900">
          {props.label}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{props.summary}</p>
    </div>
  );
}

interface TeamWorkspaceRuntimeFormationPanelProps {
  runtimeFormationDisplay: TeamWorkspaceRuntimeFormationDisplayState;
  showBlueprintRoleCards?: boolean;
}

export function TeamWorkspaceRuntimeFormationPanel({
  runtimeFormationDisplay,
  showBlueprintRoleCards = false,
}: TeamWorkspaceRuntimeFormationPanelProps) {
  return (
    <>
      <div
        data-testid="team-workspace-runtime-formation"
        className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5"
      >
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <Workflow className="h-3.5 w-3.5" />
          <span>{runtimeFormationDisplay.panelTitle}</span>
          {runtimeFormationDisplay.panelStatusLabel &&
          runtimeFormationDisplay.panelStatusBadgeClassName ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium tracking-normal",
                runtimeFormationDisplay.panelStatusBadgeClassName,
              )}
            >
              {runtimeFormationDisplay.panelStatusLabel}
            </span>
          ) : null}
          {runtimeFormationDisplay.panelLabel ? (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-sky-700 normal-case">
              {runtimeFormationDisplay.panelLabel}
            </span>
          ) : null}
        </div>
        <div className="mt-2 text-sm font-semibold text-slate-900">
          {runtimeFormationDisplay.panelHeadline}
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {runtimeFormationDisplay.panelDescription}
        </p>
        {runtimeFormationDisplay.referenceLabel ? (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
            参考方案：{runtimeFormationDisplay.referenceLabel}
          </div>
        ) : null}
      </div>
      {runtimeFormationDisplay.memberCards.length > 0 ? (
        <div
          className="mt-3 grid gap-3 xl:grid-cols-2"
          data-testid="team-workspace-runtime-members"
        >
          {runtimeFormationDisplay.memberCards.map((member) => (
            <TeamWorkspaceMemberCard
              key={`runtime-team-member-${member.id}`}
              badgeClassName={member.badgeClassName}
              badgeLabel={member.badgeLabel}
              label={member.label}
              summary={member.summary}
            />
          ))}
        </div>
      ) : null}
      {showBlueprintRoleCards &&
      runtimeFormationDisplay.blueprintRoleCards.length > 0 ? (
        <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            参考分工
          </div>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {runtimeFormationDisplay.blueprintRoleCards.map((role) => (
              <div
                key={`runtime-blueprint-role-${role.id}`}
                className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3"
              >
                <div className="text-sm font-semibold text-slate-900">
                  {role.label}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {role.summary}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

interface TeamWorkspaceSelectedPlanPanelProps {
  selectedTeamPlanDisplay: TeamWorkspaceSelectedTeamPlanDisplayState;
}

export function TeamWorkspaceSelectedPlanPanel({
  selectedTeamPlanDisplay,
}: TeamWorkspaceSelectedPlanPanelProps) {
  if (!selectedTeamPlanDisplay.hasSelectedTeamPlan) {
    return null;
  }

  return (
    <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <Bot className="h-3.5 w-3.5" />
        <span>计划中的任务分工</span>
        {selectedTeamPlanDisplay.label ? (
          <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-sky-700 normal-case">
            {selectedTeamPlanDisplay.label}
          </span>
        ) : null}
      </div>
      {selectedTeamPlanDisplay.summary ? (
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {selectedTeamPlanDisplay.summary}
        </p>
      ) : null}
      {selectedTeamPlanDisplay.roleCards.length > 0 ? (
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          {selectedTeamPlanDisplay.roleCards.map((role) => (
            <TeamWorkspaceRoleCard
              key={`planned-team-role-${role.id}`}
              label={role.label}
              summary={role.summary}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
