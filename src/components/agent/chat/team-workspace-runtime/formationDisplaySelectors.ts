import type { TeamRoleDefinition } from "../utils/teamDefinitions";
import { TEAM_WORKSPACE_PLAN_LABEL } from "../utils/teamWorkspaceCopy";
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
      return "系统正在准备当前任务的协作分工，成员接入后会自动开始处理。";
    case "formed":
      return "当前任务的协作分工已经准备好，成员加入后会继续接手处理。";
    case "failed":
      return "当前任务的协作准备失败，但你仍然可以继续在当前对话里推进。";
    default:
      return "需要时这里会自动展开成协作面板。";
  }
}

export function buildRuntimeFormationEmptyDetail(
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null,
) {
  switch (teamDispatchPreviewState?.status) {
    case "forming":
      return "系统正在根据当前任务准备协作分工。完成后，这里会先展示当前成员卡片，再接入真实处理进展。";
    case "formed":
      return "当前协作方案已经准备好。画布会先展示当前分工，等成员真正开始处理后，再自动切换为实时进展。";
    case "failed":
      return (
        teamDispatchPreviewState.errorMessage?.trim() ||
        "当前协作准备失败，暂时无法展示当前成员。"
      );
    default:
      return "当前还没有协作成员加入。系统开始分工后，详情区会切换为成员摘要视图。";
  }
}

export function buildSelectedTeamPlanDisplayState(params: {
  selectedTeamLabel?: string | null;
  selectedTeamSummary?: string | null;
  selectedTeamRoles?: TeamRoleDefinition[] | null;
}): TeamWorkspaceSelectedTeamPlanDisplayState {
  const label = params.selectedTeamLabel?.trim() || null;
  const summary = params.selectedTeamSummary?.trim() || null;
  const roleCards = (params.selectedTeamRoles ?? [])
    .filter((role) => role.label.trim())
    .map((role) => ({
      id: role.id,
      label: role.label,
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
  const label =
    state?.label?.trim() ||
    state?.blueprint?.label?.trim() ||
    params.fallbackLabel?.trim() ||
    null;
  const summary =
    state?.summary?.trim() ||
    state?.blueprint?.summary?.trim() ||
    params.fallbackSummary?.trim() ||
    null;
  const memberCards = (state?.members ?? []).map((member) => {
    const memberMeta = resolveRuntimeMemberStatusMeta(member.status);
    return {
      id: member.id,
      label: member.label,
      summary: member.summary,
      badgeLabel: memberMeta.label,
      badgeClassName: memberMeta.badgeClassName,
    };
  });
  const blueprintRoleCards = (state?.blueprint?.roles ?? []).map((role) => ({
    id: role.id,
    label: role.label,
    summary: role.summary,
  }));

  const noticeText =
    state?.status === "forming"
      ? "系统正在准备当前协作分工，完成后会先展示成员卡片，后续再切换为独立的实时进展面板。"
      : state?.status === "formed"
        ? "当前协作方案已就绪。系统开始分工后，这里会从方案视图过渡到实时协作画布。"
        : state?.status === "failed"
          ? state.errorMessage?.trim() ||
            "当前协作准备失败，暂时还没有协作成员加入。"
          : "还没有协作成员加入。系统开始分工后，这里会生成独立的成员进展画布。";

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
              text: `${memberCards.length} 位当前成员`,
              className:
                "rounded-full border border-slate-200 bg-white px-2.5 py-1",
            },
          ]
        : []),
      ...(state?.blueprint?.label
        ? [
            {
              key: "runtime-blueprint-label",
              text: `参考方案 · ${state.blueprint.label}`,
              className:
                "rounded-full border border-slate-200 bg-white px-2.5 py-1",
            },
          ]
        : []),
    ],
    panelTitle: "当前协作准备",
    panelStatusLabel: meta?.label ?? null,
    panelStatusBadgeClassName: meta?.badgeClassName ?? null,
    panelLabel: label,
    panelHeadline: meta?.title || "等待协作成员加入",
    panelDescription:
      state?.status === "failed"
        ? state.errorMessage?.trim() || "当前协作准备失败，暂时无法展示更多内容。"
        : summary || "这里会先展示当前协作方案，成员加入后再切换成实时进展。",
    referenceLabel: state?.blueprint?.label?.trim() || null,
    memberCards,
    blueprintRoleCards,
  };
}
