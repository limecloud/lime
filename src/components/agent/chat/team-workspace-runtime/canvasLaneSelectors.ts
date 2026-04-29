import type { AsterSubagentSkillInfo } from "@/lib/api/agentRuntime";
import { formatRelativeTime } from "@/lib/api/project";
import type { TeamRoleDefinition } from "../utils/teamDefinitions";
import { normalizeTeamWorkspaceDisplayValue } from "../utils/teamWorkspaceDisplay";
import { getTeamPresetOption } from "../utils/teamPresets";
import {
  buildTeamWorkspaceSkillDisplayName,
  resolveTeamWorkspaceDisplayRuntimeStatusLabel,
  resolveTeamWorkspaceRoleHintLabel,
  resolveTeamWorkspaceStableProcessingLabel,
} from "../utils/teamWorkspaceCopy";
import {
  mergeSessionActivityEntries,
  resolveRuntimeMemberStatusMeta,
  type TeamWorkspaceActivityEntry,
  type TeamWorkspaceRuntimeMember,
  type TeamWorkspaceRuntimeStatus,
} from "../teamWorkspaceRuntime";
import {
  buildActivityPreviewFromEntry,
  type SessionActivityPreviewState,
} from "./activityPreviewSelectors";

const SESSION_LANE_PREVIEW_ENTRY_LIMIT = 3;

const STATUS_META: Record<
  NonNullable<TeamWorkspaceRuntimeStatus> | "idle",
  {
    label: string;
    badgeClassName: string;
    dotClassName: string;
  }
> = {
  idle: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel(undefined),
    badgeClassName: "border border-slate-200 bg-white text-slate-600",
    dotClassName: "bg-slate-300",
  },
  queued: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("queued"),
    badgeClassName: "border border-amber-200 bg-amber-50 text-amber-700",
    dotClassName: "bg-amber-400",
  },
  running: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("running"),
    badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
    dotClassName: "bg-sky-500",
  },
  completed: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("completed"),
    badgeClassName: "border border-emerald-200 bg-emerald-50 text-emerald-700",
    dotClassName: "bg-emerald-500",
  },
  failed: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("failed"),
    badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
    dotClassName: "bg-rose-500",
  },
  aborted: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("aborted"),
    badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
    dotClassName: "bg-rose-500",
  },
  closed: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("closed"),
    badgeClassName: "border border-slate-200 bg-slate-100 text-slate-600",
    dotClassName: "bg-slate-400",
  },
};

export interface TeamWorkspaceCanvasLaneSession {
  id: string;
  name: string;
  isCurrent?: boolean;
  runtimeStatus?: TeamWorkspaceRuntimeStatus;
  taskSummary?: string;
  roleHint?: string;
  sessionType?: string;
  updatedAt?: number;
  model?: string;
  blueprintRoleId?: string;
  blueprintRoleLabel?: string;
  profileId?: string;
  profileName?: string;
  roleKey?: string;
  teamPresetId?: string;
  skills?: AsterSubagentSkillInfo[];
  latestTurnStatus?: TeamWorkspaceRuntimeStatus;
  queuedTurnCount?: number;
  teamParallelBudget?: number;
  teamActiveCount?: number;
  teamQueuedCount?: number;
  providerConcurrencyGroup?: string;
  providerParallelBudget?: number;
}

export interface TeamWorkspaceRuntimeDetailSession {
  latestTurnStatus?: TeamWorkspaceRuntimeStatus;
  queuedTurnCount?: number;
  teamQueuedCount?: number;
  teamActiveCount?: number;
  teamParallelBudget?: number;
  providerConcurrencyGroup?: string;
  providerParallelBudget?: number;
}

export type TeamWorkspaceCanvasLaneKind = "session" | "runtime" | "planned";

export interface TeamWorkspaceCanvasLane {
  id: string;
  persistKey: string;
  fallbackPersistKeys: string[];
  kind: TeamWorkspaceCanvasLaneKind;
  title: string;
  summary: string;
  badgeLabel: string;
  badgeClassName: string;
  dotClassName: string;
  roleLabel?: string;
  profileLabel?: string;
  presetLabel?: string;
  modelLabel?: string;
  statusHint?: string | null;
  updatedAtLabel?: string | null;
  skillLabels: string[];
  session?: TeamWorkspaceCanvasLaneSession;
  previewText?: string | null;
  previewEntries?: TeamWorkspaceActivityEntry[];
}

function resolveStatusMeta(status?: TeamWorkspaceRuntimeStatus) {
  return STATUS_META[status ?? "idle"];
}

function normalizeComparableText(value?: string | null): string {
  return value?.trim().toLocaleLowerCase() || "";
}

function formatUpdatedAt(updatedAt?: number) {
  if (!updatedAt) {
    return "刚刚";
  }
  return formatRelativeTime(updatedAt * 1000);
}

function buildSkillDisplayName(skill: AsterSubagentSkillInfo): string {
  return buildTeamWorkspaceSkillDisplayName(skill);
}

export function buildRuntimeDetailSummary(
  session?: TeamWorkspaceRuntimeDetailSession | null,
): string | null {
  if (!session) {
    return null;
  }

  const parts: string[] = [];
  const waitingCount = session.teamQueuedCount ?? session.queuedTurnCount ?? 0;
  if (waitingCount > 0) {
    parts.push(`等待中 ${waitingCount}`);
  }
  if (session.latestTurnStatus) {
    parts.push(`最近进展 ${resolveStatusMeta(session.latestTurnStatus).label}`);
  }
  if (
    session.teamActiveCount !== undefined &&
    session.teamParallelBudget !== undefined
  ) {
    parts.push(
      `处理中 ${session.teamActiveCount}/${session.teamParallelBudget}`,
    );
  }
  if (
    session.providerParallelBudget === 1 &&
    session.providerConcurrencyGroup
  ) {
    parts.push(resolveTeamWorkspaceStableProcessingLabel());
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function buildSessionLaneEmptyState(params: {
  session?: TeamWorkspaceCanvasLaneSession | null;
  previewState?: SessionActivityPreviewState | null;
}) {
  const { session, previewState } = params;

  if (previewState?.status === "error") {
    return (
      normalizeTeamWorkspaceDisplayValue(previewState.errorMessage) ||
      "同步最新内容失败"
    );
  }

  if (previewState?.status === "loading") {
    return "正在同步这项任务的最新内容...";
  }

  if (session?.runtimeStatus === "queued") {
    return "这项任务已经收到安排，马上开始处理。";
  }

  if (session?.runtimeStatus === "running") {
    return "这项任务正在处理，最新进展会持续刷新到这里。";
  }

  if (session?.runtimeStatus === "completed") {
    return "这部分已经完成，结果会继续汇入当前内容。";
  }

  if (
    session?.runtimeStatus === "failed" ||
    session?.runtimeStatus === "aborted"
  ) {
    return "这一步没有顺利完成，你可以在下方查看细节并决定是否继续。";
  }

  return "这项任务暂时还没有产出可展示的内容。";
}

function buildCanvasLaneTitleSummary(
  member: Pick<TeamWorkspaceRuntimeMember, "status" | "summary" | "sessionId">,
) {
  const memberMeta = resolveRuntimeMemberStatusMeta(member.status);
  const statusHint =
    member.status === "spawning"
      ? "正在接入这项任务"
      : member.status === "running"
        ? "这项任务正在处理"
        : member.status === "waiting"
          ? "等待继续补充说明"
          : member.status === "completed"
            ? "这一步已经完成"
            : member.status === "failed"
              ? "这一步需要重试"
              : member.sessionId
                ? "已连接到真实任务"
                : "等待任务接手";

  return {
    badgeLabel: memberMeta.label,
    badgeClassName: memberMeta.badgeClassName,
    dotClassName:
      member.status === "failed"
        ? "bg-rose-500"
        : member.status === "completed"
          ? "bg-emerald-500"
          : member.status === "waiting"
            ? "bg-amber-400"
            : "bg-sky-500",
    summary:
      normalizeTeamWorkspaceDisplayValue(member.summary) || member.summary,
    statusHint,
  };
}

function buildPlannedRoleLaneSummary(role: TeamRoleDefinition) {
  return {
    badgeLabel: "待开始",
    badgeClassName: "border border-slate-200 bg-slate-50 text-slate-600",
    dotClassName: "bg-slate-300",
    summary: normalizeTeamWorkspaceDisplayValue(role.summary) || role.summary,
    statusHint: "等待系统把这项任务拆出来",
  };
}

function resolveLaneMatchingRuntimeMemberId(
  session: TeamWorkspaceCanvasLaneSession,
  runtimeMembers: TeamWorkspaceRuntimeMember[],
): string | null {
  if (runtimeMembers.length === 0) {
    return null;
  }

  const explicitRoleId = session.blueprintRoleId?.trim();
  if (
    explicitRoleId &&
    runtimeMembers.some((member) => member.id === explicitRoleId)
  ) {
    return explicitRoleId;
  }

  const normalizedRoleLabel = normalizeComparableText(
    session.blueprintRoleLabel || session.name,
  );
  const normalizedRoleKey = normalizeComparableText(
    session.roleKey || session.roleHint,
  );
  const normalizedProfileId = normalizeComparableText(session.profileId);

  const candidates = runtimeMembers
    .map((member) => {
      let score = 0;
      if (
        normalizedRoleLabel &&
        normalizeComparableText(member.label) === normalizedRoleLabel
      ) {
        score += 8;
      }
      if (
        normalizedRoleKey &&
        normalizeComparableText(member.roleKey) === normalizedRoleKey
      ) {
        score += 5;
      }
      if (
        normalizedProfileId &&
        normalizeComparableText(member.profileId) === normalizedProfileId
      ) {
        score += 4;
      }
      return {
        memberId: member.id,
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
  return candidates[0]?.memberId ?? null;
}

function resolveLaneMatchingPlannedRoleId(
  session: TeamWorkspaceCanvasLaneSession,
  plannedRoles: TeamRoleDefinition[],
): string | null {
  if (plannedRoles.length === 0) {
    return null;
  }

  const normalizedRoleLabel = normalizeComparableText(
    session.blueprintRoleLabel || session.name,
  );
  const normalizedRoleKey = normalizeComparableText(
    session.roleKey || session.roleHint,
  );
  const normalizedProfileId = normalizeComparableText(session.profileId);

  const candidates = plannedRoles
    .map((role) => {
      let score = 0;
      if (
        normalizedRoleLabel &&
        normalizeComparableText(role.label) === normalizedRoleLabel
      ) {
        score += 8;
      }
      if (
        normalizedRoleKey &&
        normalizeComparableText(role.roleKey) === normalizedRoleKey
      ) {
        score += 5;
      }
      if (
        normalizedProfileId &&
        normalizeComparableText(role.profileId) === normalizedProfileId
      ) {
        score += 4;
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

function resolveRuntimeMemberMatchingPlannedRoleId(
  member: TeamWorkspaceRuntimeMember,
  plannedRoles: TeamRoleDefinition[],
): string | null {
  if (plannedRoles.length === 0) {
    return null;
  }

  const normalizedRoleLabel = normalizeComparableText(member.label);
  const normalizedRoleKey = normalizeComparableText(member.roleKey);
  const normalizedProfileId = normalizeComparableText(member.profileId);

  const candidates = plannedRoles
    .map((role) => {
      let score = 0;
      if (
        normalizedRoleLabel &&
        normalizeComparableText(role.label) === normalizedRoleLabel
      ) {
        score += 8;
      }
      if (
        normalizedRoleKey &&
        normalizeComparableText(role.roleKey) === normalizedRoleKey
      ) {
        score += 5;
      }
      if (
        normalizedProfileId &&
        normalizeComparableText(role.profileId) === normalizedProfileId
      ) {
        score += 4;
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

function buildSessionCanvasLane(params: {
  session: TeamWorkspaceCanvasLaneSession;
  runtimeMembers: TeamWorkspaceRuntimeMember[];
  plannedRoles: TeamRoleDefinition[];
  liveActivityBySessionId?: Record<string, TeamWorkspaceActivityEntry[]>;
  previewBySessionId?: Record<string, SessionActivityPreviewState>;
  activityTimelineEntryLimit: number;
}): TeamWorkspaceCanvasLane {
  const { session, runtimeMembers, plannedRoles } = params;
  const previewState = params.previewBySessionId?.[session.id] ?? null;
  const mergedEntries = mergeSessionActivityEntries(
    params.liveActivityBySessionId?.[session.id],
    previewState?.entries,
    params.activityTimelineEntryLimit,
  );
  const cardActivityPreview =
    buildActivityPreviewFromEntry(mergedEntries[0]) ?? previewState?.preview;
  const meta = resolveStatusMeta(session.runtimeStatus);
  const matchedRuntimeMemberId = resolveLaneMatchingRuntimeMemberId(
    session,
    runtimeMembers,
  );
  const matchedPlannedRoleId = resolveLaneMatchingPlannedRoleId(
    session,
    plannedRoles,
  );
  const presetLabel = session.teamPresetId
    ? (getTeamPresetOption(session.teamPresetId)?.label ?? session.teamPresetId)
    : undefined;

  return {
    id: session.id,
    persistKey: `session:${session.id}`,
    fallbackPersistKeys: [
      matchedRuntimeMemberId ? `runtime:${matchedRuntimeMemberId}` : null,
      matchedPlannedRoleId ? `planned:${matchedPlannedRoleId}` : null,
    ].filter(Boolean) as string[],
    kind: "session",
    title: session.name,
    summary:
      normalizeTeamWorkspaceDisplayValue(session.taskSummary) ||
      "暂时还没有任务摘要，打开详情后可查看完整上下文。",
    badgeLabel: meta.label,
    badgeClassName: meta.badgeClassName,
    dotClassName: meta.dotClassName,
    roleLabel:
      session.blueprintRoleLabel ||
      resolveTeamWorkspaceRoleHintLabel(session.roleHint) ||
      undefined,
    profileLabel: session.profileName || undefined,
    presetLabel,
    modelLabel: session.model || undefined,
    statusHint: buildRuntimeDetailSummary(session),
    updatedAtLabel: formatUpdatedAt(session.updatedAt),
    skillLabels: (session.skills ?? [])
      .slice(0, 4)
      .map((skill) => buildSkillDisplayName(skill)),
    session,
    previewText:
      cardActivityPreview ??
      buildSessionLaneEmptyState({ session, previewState }),
    previewEntries: mergedEntries.slice(0, SESSION_LANE_PREVIEW_ENTRY_LIMIT),
  };
}

export function buildTeamWorkspaceCanvasLanes(params: {
  hasRealTeamGraph: boolean;
  sessions: TeamWorkspaceCanvasLaneSession[];
  runtimeMembers: TeamWorkspaceRuntimeMember[];
  plannedRoles: TeamRoleDefinition[];
  liveActivityBySessionId?: Record<string, TeamWorkspaceActivityEntry[]>;
  previewBySessionId?: Record<string, SessionActivityPreviewState>;
  activityTimelineEntryLimit: number;
}): TeamWorkspaceCanvasLane[] {
  if (params.hasRealTeamGraph) {
    return params.sessions.map((session) =>
      buildSessionCanvasLane({
        session,
        runtimeMembers: params.runtimeMembers,
        plannedRoles: params.plannedRoles,
        liveActivityBySessionId: params.liveActivityBySessionId,
        previewBySessionId: params.previewBySessionId,
        activityTimelineEntryLimit: params.activityTimelineEntryLimit,
      }),
    );
  }

  if (params.runtimeMembers.length > 0) {
    return params.runtimeMembers.map((member) => {
      const laneSummary = buildCanvasLaneTitleSummary(member);
      const matchedPlannedRoleId = resolveRuntimeMemberMatchingPlannedRoleId(
        member,
        params.plannedRoles,
      );

      return {
        id: member.id,
        persistKey: `runtime:${member.id}`,
        fallbackPersistKeys: matchedPlannedRoleId
          ? [`planned:${matchedPlannedRoleId}`]
          : [],
        kind: "runtime",
        title: member.label,
        summary: laneSummary.summary,
        badgeLabel: laneSummary.badgeLabel,
        badgeClassName: laneSummary.badgeClassName,
        dotClassName: laneSummary.dotClassName,
        roleLabel:
          resolveTeamWorkspaceRoleHintLabel(member.roleKey) || undefined,
        profileLabel: undefined,
        statusHint: laneSummary.statusHint,
        updatedAtLabel: "等待任务接手",
        skillLabels: [],
        previewText:
          normalizeTeamWorkspaceDisplayValue(member.summary) || member.summary,
        previewEntries: [],
      };
    });
  }

  return params.plannedRoles.map((role) => {
    const laneSummary = buildPlannedRoleLaneSummary(role);

    return {
      id: role.id,
      persistKey: `planned:${role.id}`,
      fallbackPersistKeys: [],
      kind: "planned",
      title: role.label,
      summary: laneSummary.summary,
      badgeLabel: laneSummary.badgeLabel,
      badgeClassName: laneSummary.badgeClassName,
      dotClassName: laneSummary.dotClassName,
      roleLabel: resolveTeamWorkspaceRoleHintLabel(role.roleKey) || undefined,
      profileLabel: undefined,
      statusHint: laneSummary.statusHint,
      updatedAtLabel: "计划分工",
      skillLabels: [],
      previewText:
        normalizeTeamWorkspaceDisplayValue(role.summary) || role.summary,
      previewEntries: [],
    };
  });
}
