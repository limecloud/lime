import type { TeamRoleDefinition } from "../utils/teamDefinitions";
import { normalizeTeamWorkspaceDisplayValue } from "../utils/teamWorkspaceDisplay";
import {
  TEAM_WORKSPACE_IDLE_STATUS_LABEL,
  TEAM_WORKSPACE_PLAN_LABEL,
  TEAM_WORKSPACE_WAITING_HEADLINE,
} from "../utils/teamWorkspaceCopy";
import {
  resolveRuntimeFormationStatusMeta,
  resolveRuntimeMemberStatusMeta,
  type TeamWorkspaceRuntimeFormationState,
} from "../teamWorkspaceRuntime";

export interface TeamWorkspaceFormationBadge {
  key: string;
  text: string;
  className: string;
}

export interface TeamWorkspaceFormationRoleCard {
  id: string;
  label: string;
  summary: string;
}

export interface TeamWorkspaceFormationMemberCard {
  id: string;
  label: string;
  summary: string;
  badgeLabel: string;
  badgeClassName: string;
}

export interface TeamWorkspaceSelectedTeamPlanDisplayState {
  hasSelectedTeamPlan: boolean;
  summaryBadges: TeamWorkspaceFormationBadge[];
  label: string | null;
  summary: string | null;
  roleCards: TeamWorkspaceFormationRoleCard[];
}

export interface TeamWorkspaceRuntimeFormationDisplayState {
  hasRuntimeFormation: boolean;
  hint: string;
  emptyDetail: string;
  noticeText: string;
  summaryBadges: TeamWorkspaceFormationBadge[];
  panelTitle: string;
  panelStatusLabel: string | null;
  panelStatusBadgeClassName: string | null;
  panelLabel: string | null;
  panelHeadline: string;
  panelDescription: string;
  referenceLabel: string | null;
  memberCards: TeamWorkspaceFormationMemberCard[];
  blueprintRoleCards: TeamWorkspaceFormationRoleCard[];
}

export function buildRuntimeFormationHint(
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null,
) {
  switch (teamDispatchPreviewState?.status) {
    case "forming":
      return "系统正在准备当前任务的分工，任务拆出后会自动开始处理。";
    case "formed":
      return "当前任务的分工已经准备好，任务拆出后会继续接手处理。";
    case "failed":
      return "当前任务的分工准备失败，但你仍然可以继续在当前任务里推进。";
    default:
      return "需要时这里会自动展开成任务面板。";
  }
}

export function buildRuntimeFormationEmptyDetail(
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null,
) {
  const errorMessage = normalizeTeamWorkspaceDisplayValue(
    teamDispatchPreviewState?.errorMessage,
  );

  switch (teamDispatchPreviewState?.status) {
    case "forming":
      return "系统正在根据当前任务准备分工。完成后，这里会先展示任务卡片，再接入真实处理进展。";
    case "formed":
      return "当前任务方案已经准备好。画布会先展示当前分工，等任务真正开始处理后，再自动切换为任务视图。";
    case "failed":
      return errorMessage || "当前任务分工准备失败，暂时无法展示当前任务。";
    default:
      return `${TEAM_WORKSPACE_IDLE_STATUS_LABEL}。系统开始分工后，详情区会切换为任务摘要视图。`;
  }
}

export function buildSelectedTeamPlanDisplayState(params: {
  selectedTeamLabel?: string | null;
  selectedTeamSummary?: string | null;
  selectedTeamRoles?: TeamRoleDefinition[] | null;
}): TeamWorkspaceSelectedTeamPlanDisplayState {
  const label = normalizeTeamWorkspaceDisplayValue(params.selectedTeamLabel);
  const summary = normalizeTeamWorkspaceDisplayValue(params.selectedTeamSummary);
  const roleCards = (params.selectedTeamRoles ?? [])
    .map((role) => ({
      id: role.id,
      label: normalizeTeamWorkspaceDisplayValue(role.label),
      summary:
        normalizeTeamWorkspaceDisplayValue(role.summary) || role.summary.trim(),
    }))
    .filter((role) => Boolean(role.label))
    .map((role) => ({
      id: role.id,
      label: role.label || "",
      summary: role.summary,
    }));

  return {
    hasSelectedTeamPlan:
      Boolean(label) || Boolean(summary) || roleCards.length > 0,
    summaryBadges: [
      ...(label
        ? [
            {
              key: "plan-label",
              text: `${TEAM_WORKSPACE_PLAN_LABEL} · ${label}`,
              className:
                "rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-700",
            },
          ]
        : []),
      ...(roleCards.length > 0
        ? [
            {
              key: "plan-role-count",
              text: `${roleCards.length} 个计划分工`,
              className:
                "rounded-full border border-slate-200 bg-white px-2.5 py-1",
            },
          ]
        : []),
    ],
    label,
    summary,
    roleCards,
  };
}

export function buildRuntimeFormationDisplayState(params: {
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
  fallbackLabel?: string | null;
  fallbackSummary?: string | null;
}): TeamWorkspaceRuntimeFormationDisplayState {
  const state = params.teamDispatchPreviewState ?? null;
  const meta = state ? resolveRuntimeFormationStatusMeta(state.status) : null;
  const label = normalizeTeamWorkspaceDisplayValue(
    state?.label || state?.blueprint?.label || params.fallbackLabel,
  );
  const summary = normalizeTeamWorkspaceDisplayValue(
    state?.summary || state?.blueprint?.summary || params.fallbackSummary,
  );
  const errorMessage = normalizeTeamWorkspaceDisplayValue(state?.errorMessage);
  const referenceLabel = normalizeTeamWorkspaceDisplayValue(
    state?.blueprint?.label,
  );
  const memberCards = (state?.members ?? []).map((member) => {
    const memberMeta = resolveRuntimeMemberStatusMeta(member.status);
    return {
      id: member.id,
      label: normalizeTeamWorkspaceDisplayValue(member.label) || member.label,
      summary:
        normalizeTeamWorkspaceDisplayValue(member.summary) || member.summary,
      badgeLabel: memberMeta.label,
      badgeClassName: memberMeta.badgeClassName,
    };
  });
  const blueprintRoleCards = (state?.blueprint?.roles ?? []).map((role) => ({
    id: role.id,
    label: normalizeTeamWorkspaceDisplayValue(role.label) || role.label,
    summary: normalizeTeamWorkspaceDisplayValue(role.summary) || role.summary,
  }));

  const noticeText =
    state?.status === "forming"
      ? "系统正在准备当前任务分工，完成后会先展示任务卡片，后续再切换为独立的任务视图。"
      : state?.status === "formed"
        ? "当前任务方案已就绪。任务拆出后，这里会从方案视图过渡到任务视图。"
        : state?.status === "failed"
          ? errorMessage || "当前任务分工准备失败，暂时还没有任务接手。"
          : `${TEAM_WORKSPACE_IDLE_STATUS_LABEL}。系统开始分工后，这里会生成独立的任务视图。`;

  return {
    hasRuntimeFormation: Boolean(state),
    hint: buildRuntimeFormationHint(state),
    emptyDetail: buildRuntimeFormationEmptyDetail(state),
    noticeText,
    summaryBadges: [
      ...(label
        ? [
            {
              key: "runtime-label",
              text: `${TEAM_WORKSPACE_PLAN_LABEL} · ${label}`,
              className:
                "rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-700",
            },
          ]
        : []),
      ...(meta
        ? [
            {
              key: "runtime-status",
              text: meta.label,
              className: `rounded-full px-2.5 py-1 font-medium ${meta.badgeClassName}`,
            },
          ]
        : []),
      ...(memberCards.length > 0
        ? [
            {
              key: "runtime-member-count",
              text: `${memberCards.length} 项当前任务`,
              className:
                "rounded-full border border-slate-200 bg-white px-2.5 py-1",
            },
          ]
        : []),
      ...(referenceLabel
        ? [
            {
              key: "runtime-blueprint-label",
              text: `参考方案 · ${referenceLabel}`,
              className:
                "rounded-full border border-slate-200 bg-white px-2.5 py-1",
            },
          ]
        : []),
    ],
    panelTitle: "当前任务分工",
    panelStatusLabel: meta?.label ?? null,
    panelStatusBadgeClassName: meta?.badgeClassName ?? null,
    panelLabel: label,
    panelHeadline: meta?.title || TEAM_WORKSPACE_WAITING_HEADLINE,
    panelDescription:
      state?.status === "failed"
        ? errorMessage || "当前任务分工准备失败，暂时无法展示更多内容。"
        : summary || "这里会先展示当前任务方案，任务拆出后再切换成任务视图。",
    referenceLabel,
    memberCards,
    blueprintRoleCards,
  };
}
