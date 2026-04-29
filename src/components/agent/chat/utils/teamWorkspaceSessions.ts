import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
  AsterSubagentSkillInfo,
} from "@/lib/api/agentRuntime";
import { formatRelativeTime } from "@/lib/api/project";
import type {
  TeamWorkspaceRuntimeFormationState,
  TeamWorkspaceRuntimeStatus,
} from "../teamWorkspaceRuntime";
import {
  resolveTeamWorkspaceDisplayRuntimeStatusLabel,
  TEAM_WORKSPACE_MAIN_ASSISTANT_LABEL,
} from "./teamWorkspaceCopy";

export interface TeamSessionCard {
  id: string;
  name: string;
  runtimeStatus?: TeamWorkspaceRuntimeStatus;
  taskSummary?: string;
  roleHint?: string;
  sessionType?: string;
  updatedAt?: number;
  providerName?: string;
  model?: string;
  originTool?: string;
  createdFromTurnId?: string;
  blueprintRoleId?: string;
  blueprintRoleLabel?: string;
  profileId?: string;
  profileName?: string;
  roleKey?: string;
  teamPresetId?: string;
  theme?: string;
  outputContract?: string;
  skillIds?: string[];
  skills?: AsterSubagentSkillInfo[];
  latestTurnStatus?: TeamWorkspaceRuntimeStatus;
  queuedTurnCount?: number;
  teamPhase?: string;
  teamParallelBudget?: number;
  teamActiveCount?: number;
  teamQueuedCount?: number;
  providerConcurrencyGroup?: string;
  providerParallelBudget?: number;
  queueReason?: string;
  retryableOverload?: boolean;
  isCurrent?: boolean;
}

const TEAM_WORKSPACE_TASK_SCHEDULE_PRIORITY: Record<string, number> = {
  running: 0,
  queued: 1,
  failed: 2,
  aborted: 2,
  completed: 3,
  closed: 4,
  idle: 5,
};

const STATUS_META = {
  idle: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel(undefined),
    badgeClassName: "border border-slate-200 bg-white text-slate-600",
    cardClassName: "border-slate-200 bg-white",
    dotClassName: "bg-slate-300",
  },
  queued: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("queued"),
    badgeClassName: "border border-amber-200 bg-amber-50 text-amber-700",
    cardClassName: "border-amber-200 bg-white",
    dotClassName: "bg-amber-400",
  },
  running: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("running"),
    badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
    cardClassName: "border-sky-200 bg-white",
    dotClassName: "bg-sky-500",
  },
  completed: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("completed"),
    badgeClassName: "border border-emerald-200 bg-emerald-50 text-emerald-700",
    cardClassName: "border-emerald-200 bg-white",
    dotClassName: "bg-emerald-500",
  },
  failed: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("failed"),
    badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
    cardClassName: "border-rose-200 bg-white",
    dotClassName: "bg-rose-500",
  },
  aborted: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("aborted"),
    badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
    cardClassName: "border-rose-200 bg-white",
    dotClassName: "bg-rose-500",
  },
  closed: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("closed"),
    badgeClassName: "border border-slate-200 bg-slate-100 text-slate-600",
    cardClassName: "border-slate-200 bg-slate-50",
    dotClassName: "bg-slate-400",
  },
} satisfies Record<
  NonNullable<TeamWorkspaceRuntimeStatus> | "idle",
  {
    label: string;
    badgeClassName: string;
    cardClassName: string;
    dotClassName: string;
  }
>;

export function resolveStatusMeta(status?: TeamWorkspaceRuntimeStatus) {
  return STATUS_META[status ?? "idle"];
}

export function formatUpdatedAt(updatedAt?: number) {
  if (!updatedAt) {
    return "刚刚";
  }
  return formatRelativeTime(updatedAt * 1000);
}

export function buildCurrentChildSession(
  currentSessionId?: string | null,
  currentSessionName?: string | null,
  currentSessionRuntimeStatus?: TeamWorkspaceRuntimeStatus,
  currentSessionLatestTurnStatus?: TeamWorkspaceRuntimeStatus,
  currentSessionQueuedTurnCount?: number,
  subagentParentContext?: AsterSubagentParentContext | null,
): TeamSessionCard | null {
  if (!currentSessionId || !subagentParentContext) {
    return null;
  }

  return {
    id: currentSessionId,
    name: currentSessionName?.trim() || "当前任务",
    runtimeStatus: currentSessionRuntimeStatus,
    taskSummary: subagentParentContext.task_summary,
    roleHint: subagentParentContext.role_hint,
    sessionType: "sub_agent",
    originTool: subagentParentContext.origin_tool,
    createdFromTurnId: subagentParentContext.created_from_turn_id,
    blueprintRoleId: subagentParentContext.blueprint_role_id,
    blueprintRoleLabel: subagentParentContext.blueprint_role_label,
    profileId: subagentParentContext.profile_id,
    profileName: subagentParentContext.profile_name,
    roleKey: subagentParentContext.role_key,
    teamPresetId: subagentParentContext.team_preset_id,
    theme: subagentParentContext.theme,
    outputContract: subagentParentContext.output_contract,
    skillIds: subagentParentContext.skill_ids,
    skills: subagentParentContext.skills,
    latestTurnStatus: currentSessionLatestTurnStatus,
    queuedTurnCount: currentSessionQueuedTurnCount,
    isCurrent: true,
  };
}

export function buildOrchestratorSession(
  currentSessionId?: string | null,
  currentSessionName?: string | null,
  currentSessionRuntimeStatus?: TeamWorkspaceRuntimeStatus,
): TeamSessionCard | null {
  if (!currentSessionId) {
    return null;
  }

  return {
    id: currentSessionId,
    name: currentSessionName?.trim() || TEAM_WORKSPACE_MAIN_ASSISTANT_LABEL,
    runtimeStatus: currentSessionRuntimeStatus,
    taskSummary:
      "当前主助手会负责拆解任务、安排处理顺序，并把各部分结果汇总到同一份内容里。",
    roleHint: "orchestrator",
    sessionType: "user",
    isCurrent: true,
  };
}

export function buildVisibleTeamSessionCards(
  sessions: AsterSubagentSessionInfo[],
): TeamSessionCard[] {
  return sessions.map((session) => ({
    id: session.id,
    name: session.name,
    runtimeStatus: session.runtime_status,
    taskSummary: session.task_summary,
    roleHint: session.role_hint,
    sessionType: session.session_type,
    updatedAt: session.updated_at,
    providerName: session.provider_name,
    model: session.model,
    originTool: session.origin_tool,
    createdFromTurnId: session.created_from_turn_id,
    blueprintRoleId: session.blueprint_role_id,
    blueprintRoleLabel: session.blueprint_role_label,
    profileId: session.profile_id,
    profileName: session.profile_name,
    roleKey: session.role_key,
    teamPresetId: session.team_preset_id,
    theme: session.theme,
    outputContract: session.output_contract,
    skillIds: session.skill_ids,
    skills: session.skills,
    latestTurnStatus: session.latest_turn_status,
    queuedTurnCount: session.queued_turn_count,
    teamPhase: session.team_phase,
    teamParallelBudget: session.team_parallel_budget,
    teamActiveCount: session.team_active_count,
    teamQueuedCount: session.team_queued_count,
    providerConcurrencyGroup: session.provider_concurrency_group,
    providerParallelBudget: session.provider_parallel_budget,
    queueReason: session.queue_reason,
    retryableOverload: session.retryable_overload,
  }));
}

export function dedupeSessions(
  sessions: Array<TeamSessionCard | null | undefined>,
): TeamSessionCard[] {
  const seen = new Set<string>();
  const result: TeamSessionCard[] = [];

  sessions.forEach((session) => {
    if (!session || seen.has(session.id)) {
      return;
    }
    seen.add(session.id);
    result.push(session);
  });

  return result;
}

function normalizeComparableText(value?: string | null): string {
  return value?.trim().toLocaleLowerCase() || "";
}

function resolveSessionBlueprintRoleId(
  session: TeamSessionCard,
  runtimeRoles: Array<{
    id: string;
    label?: string | null;
    profileId?: string | null;
    roleKey?: string | null;
  }>,
  usedRoleIds: Set<string>,
): string | null {
  const explicitRoleId = session.blueprintRoleId?.trim();
  if (
    explicitRoleId &&
    !usedRoleIds.has(explicitRoleId) &&
    runtimeRoles.some((role) => role.id === explicitRoleId)
  ) {
    return explicitRoleId;
  }

  const sessionBlueprintRoleLabel = normalizeComparableText(
    session.blueprintRoleLabel,
  );
  const sessionRoleKey = normalizeComparableText(
    session.roleKey || session.roleHint,
  );
  const sessionProfileId = normalizeComparableText(session.profileId);
  const sessionName = normalizeComparableText(session.name);

  const candidates = runtimeRoles
    .filter((role) => !usedRoleIds.has(role.id))
    .map((role) => {
      let score = 0;
      if (
        sessionBlueprintRoleLabel &&
        normalizeComparableText(role.label) === sessionBlueprintRoleLabel
      ) {
        score += 8;
      }
      if (
        sessionRoleKey &&
        normalizeComparableText(role.roleKey) === sessionRoleKey
      ) {
        score += 4;
      }
      if (
        sessionProfileId &&
        normalizeComparableText(role.profileId) === sessionProfileId
      ) {
        score += 3;
      }
      if (sessionName && normalizeComparableText(role.label) === sessionName) {
        score += 2;
      }
      return {
        roleId: role.id,
        score,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length > 1 && candidates[0]?.score === candidates[1]?.score) {
    return null;
  }

  return candidates[0]?.roleId ?? null;
}

export function orderSessionsByRuntimeRoles(
  sessions: TeamSessionCard[],
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null,
): TeamSessionCard[] {
  if (sessions.length <= 1 || !teamDispatchPreviewState) {
    return sessions;
  }

  const runtimeRoles = (
    teamDispatchPreviewState.members.length > 0
      ? teamDispatchPreviewState.members
      : (teamDispatchPreviewState.blueprint?.roles ?? [])
  ).map((role) => ({
    id: role.id,
    label: role.label,
    profileId: role.profileId,
    roleKey: role.roleKey,
  }));

  if (runtimeRoles.length === 0) {
    return sessions;
  }

  const roleOrder = new Map(
    runtimeRoles.map((role, index) => [role.id, index]),
  );
  const usedRoleIds = new Set<string>();

  return [...sessions]
    .map((session, index) => {
      const matchedRoleId = resolveSessionBlueprintRoleId(
        session,
        runtimeRoles,
        usedRoleIds,
      );
      if (matchedRoleId) {
        usedRoleIds.add(matchedRoleId);
      }
      return {
        session,
        index,
        matchedRoleId,
        roleOrder:
          matchedRoleId !== null
            ? (roleOrder.get(matchedRoleId) ?? Number.MAX_SAFE_INTEGER)
            : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((left, right) => {
      if (left.roleOrder !== right.roleOrder) {
        return left.roleOrder - right.roleOrder;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.session);
}

export function buildTeamWorkspaceMemberCanvasSessions(params: {
  isChildSession: boolean;
  currentChildSession?: TeamSessionCard | null;
  visibleSessions: TeamSessionCard[];
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
}): TeamSessionCard[] {
  const {
    isChildSession,
    currentChildSession,
    visibleSessions,
    teamDispatchPreviewState,
  } = params;
  const roleOrderedSessions = orderSessionsByRuntimeRoles(
    isChildSession
      ? dedupeSessions([currentChildSession, ...visibleSessions])
      : visibleSessions,
    teamDispatchPreviewState,
  );

  return roleOrderedSessions
    .map((session, index) => ({
      session,
      index,
      priority:
        TEAM_WORKSPACE_TASK_SCHEDULE_PRIORITY[
          session.runtimeStatus ?? "idle"
        ] ?? TEAM_WORKSPACE_TASK_SCHEDULE_PRIORITY.idle,
    }))
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.session);
}

export function buildTeamWorkspaceRailSessions(params: {
  isChildSession: boolean;
  hasRealTeamGraph: boolean;
  currentChildSession?: TeamSessionCard | null;
  orchestratorSession?: TeamSessionCard | null;
  visibleSessions: TeamSessionCard[];
}): TeamSessionCard[] {
  const {
    isChildSession,
    hasRealTeamGraph,
    currentChildSession,
    orchestratorSession,
    visibleSessions,
  } = params;

  return dedupeSessions(
    isChildSession
      ? [currentChildSession, ...visibleSessions]
      : hasRealTeamGraph
        ? [orchestratorSession, ...visibleSessions]
        : [],
  );
}

export function resolveTeamWorkspaceSelectedSessionId(params: {
  currentSessionId?: string | null;
  isChildSession: boolean;
  selectedSessionId?: string | null;
  railSessions: TeamSessionCard[];
  memberCanvasSessions: TeamSessionCard[];
  orchestratorSessionId?: string | null;
}): string | null {
  const {
    currentSessionId,
    isChildSession,
    selectedSessionId,
    railSessions,
    memberCanvasSessions,
    orchestratorSessionId,
  } = params;
  const defaultSelectedId = isChildSession
    ? (currentSessionId ?? railSessions[0]?.id ?? null)
    : (memberCanvasSessions[0]?.id ?? railSessions[0]?.id ?? null);

  if (!selectedSessionId) {
    return defaultSelectedId;
  }

  if (!railSessions.some((session) => session.id === selectedSessionId)) {
    return defaultSelectedId;
  }

  if (
    !isChildSession &&
    selectedSessionId === orchestratorSessionId &&
    memberCanvasSessions.length > 0
  ) {
    return memberCanvasSessions[0]?.id ?? defaultSelectedId;
  }

  return selectedSessionId;
}

export function resolveExpandedTeamWorkspaceSessionId(
  expandedSessionId: string | null,
  memberCanvasSessions: TeamSessionCard[],
): string | null {
  if (!expandedSessionId) {
    return null;
  }

  return memberCanvasSessions.some(
    (session) => session.id === expandedSessionId,
  )
    ? expandedSessionId
    : null;
}

export function buildFallbackSummary(params: {
  hasRuntimeSessions: boolean;
  isChildSession: boolean;
  selectedSession?: TeamSessionCard | null;
}) {
  const { hasRuntimeSessions, isChildSession, selectedSession } = params;

  if (!hasRuntimeSessions) {
    return "还没有任务接入。需要时系统会自动补充分工，并在这里展示最新进展。";
  }
  if (selectedSession?.sessionType === "user") {
    return "主助手会负责整理需求、安排任务顺序，并把各部分结果汇总到当前内容里。";
  }
  if (isChildSession) {
    return "这项任务正在处理主助手分配的内容，你可以在这里切换查看其他并行任务的进展。";
  }
  return "选中一项任务后，这里会展示它正在推进什么，以及目前进展到哪一步。";
}
