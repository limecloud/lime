import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  Activity,
  ArrowUpLeft,
  Bot,
  ChevronDown,
  ChevronUp,
  Clock3,
  Loader2,
  PanelTop,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getAgentRuntimeSession } from "@/lib/api/agentRuntime";
import type { AgentThreadItem } from "@/lib/api/agentProtocol";
import type {
  AsterSessionDetail,
  AsterSubagentSkillInfo,
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import { formatRelativeTime } from "@/lib/api/project";
import { cn } from "@/lib/utils";
import { getTeamPresetOption } from "../utils/teamPresets";
import type { TeamRoleDefinition } from "../utils/teamDefinitions";
import {
  applyLiveRuntimeState,
  buildTeamWorkspaceActivityEntryFromThreadItem,
  buildTeamWorkspaceSessionFingerprint,
  isTeamWorkspaceActiveStatus,
  isTeamWorkspaceTerminalStatus,
  mergeSessionActivityEntries,
  normalizeTeamWorkspaceRuntimeStatus,
  resolveRuntimeFormationStatusMeta,
  resolveRuntimeMemberStatusMeta,
  resolveTeamWorkspaceRuntimeStatusLabel,
  type TeamWorkspaceActivityEntry,
  type TeamWorkspaceControlSummary,
  type TeamWorkspaceRuntimeMember,
  type TeamWorkspaceLiveRuntimeState,
  type TeamWorkspaceRuntimeFormationState,
  type TeamWorkspaceWaitSummary,
} from "../teamWorkspaceRuntime";
import {
  buildTeamWorkspaceCanvasAutoLayout,
  buildDefaultTeamWorkspaceCanvasItemLayout,
  clampTeamWorkspaceCanvasZoom,
  createDefaultTeamWorkspaceCanvasLayoutState,
  loadTeamWorkspaceCanvasLayout,
  persistTeamWorkspaceCanvasLayout,
  TEAM_WORKSPACE_CANVAS_MAX_ZOOM,
  TEAM_WORKSPACE_CANVAS_MIN_HEIGHT,
  TEAM_WORKSPACE_CANVAS_MIN_WIDTH,
  TEAM_WORKSPACE_CANVAS_MIN_ZOOM,
  type TeamWorkspaceCanvasItemLayout,
  type TeamWorkspaceCanvasLayoutState,
} from "../utils/teamWorkspaceCanvas";
import {
  buildTeamWorkspaceSkillDisplayName,
  resolveTeamWorkspaceDisplayRuntimeStatusLabel,
  resolveTeamWorkspaceDisplaySessionTypeLabel,
  resolveTeamWorkspaceRoleHintLabel,
  resolveTeamWorkspaceStableProcessingLabel,
  TEAM_WORKSPACE_MAIN_ASSISTANT_LABEL,
  TEAM_WORKSPACE_PLAN_LABEL,
  TEAM_WORKSPACE_REALTIME_BADGE_LABEL,
  TEAM_WORKSPACE_SURFACE_TITLE,
} from "../utils/teamWorkspaceCopy";

type RuntimeStatus = AsterSubagentSessionInfo["runtime_status"];

interface TeamWorkspaceBoardProps {
  className?: string;
  embedded?: boolean;
  shellVisible?: boolean;
  defaultShellExpanded?: boolean;
  currentSessionId?: string | null;
  currentSessionName?: string | null;
  currentSessionRuntimeStatus?: RuntimeStatus;
  currentSessionLatestTurnStatus?: RuntimeStatus;
  currentSessionQueuedTurnCount?: number;
  childSubagentSessions?: AsterSubagentSessionInfo[];
  subagentParentContext?: AsterSubagentParentContext | null;
  liveRuntimeBySessionId?: Record<string, TeamWorkspaceLiveRuntimeState>;
  liveActivityBySessionId?: Record<string, TeamWorkspaceActivityEntry[]>;
  activityRefreshVersionBySessionId?: Record<string, number>;
  onSendSubagentInput?: (
    sessionId: string,
    message: string,
    options?: { interrupt?: boolean },
  ) => void | Promise<void>;
  onWaitSubagentSession?: (
    sessionId: string,
    timeoutMs?: number,
  ) => void | Promise<void>;
  onWaitActiveTeamSessions?: (
    sessionIds: string[],
    timeoutMs?: number,
  ) => void | Promise<void>;
  onCloseCompletedTeamSessions?: (
    sessionIds: string[],
  ) => void | Promise<void>;
  onCloseSubagentSession?: (sessionId: string) => void | Promise<void>;
  onResumeSubagentSession?: (sessionId: string) => void | Promise<void>;
  onOpenSubagentSession?: (sessionId: string) => void | Promise<void>;
  onReturnToParentSession?: () => void | Promise<void>;
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
  selectedTeamLabel?: string | null;
  selectedTeamSummary?: string | null;
  selectedTeamRoles?: TeamRoleDefinition[] | null;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
}

interface TeamSessionCard {
  id: string;
  name: string;
  runtimeStatus?: RuntimeStatus;
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
  latestTurnStatus?: RuntimeStatus;
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

interface SessionActivityPreviewState {
  preview: string | null;
  entries: SessionActivityEntry[];
  status: "loading" | "ready" | "error";
  errorMessage?: string;
  fingerprint?: string;
  refreshVersion?: number;
  syncedAt?: number;
}

interface TeamOperationDisplayEntry {
  id: string;
  title: string;
  detail: string;
  badgeClassName: string;
  updatedAt: number;
  targetSessionId?: string;
}

type SessionActivityEntry = TeamWorkspaceActivityEntry;
const ACTIVITY_PREVIEW_POLL_INTERVAL_MS = 1500;
const ACTIVITY_PREVIEW_MAX_LENGTH = 360;
const ACTIVITY_TIMELINE_ENTRY_LIMIT = 4;
const ACTIVITY_TIMELINE_DETAIL_MAX_LENGTH = 220;
const DEFAULT_WAIT_SELECTED_SUBAGENT_TIMEOUT_MS = 30_000;

const STATUS_META: Record<
  NonNullable<RuntimeStatus> | "idle",
  {
    label: string;
    badgeClassName: string;
    cardClassName: string;
    dotClassName: string;
  }
> = {
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
};

function resolveStatusMeta(status?: RuntimeStatus) {
  return STATUS_META[status ?? "idle"];
}

function resolveSessionTypeLabel(value?: string) {
  return resolveTeamWorkspaceDisplaySessionTypeLabel(value);
}

function formatUpdatedAt(updatedAt?: number) {
  if (!updatedAt) {
    return "刚刚";
  }
  return formatRelativeTime(updatedAt * 1000);
}

function formatOperationUpdatedAt(updatedAt?: number) {
  if (!updatedAt) {
    return "刚刚";
  }
  return formatRelativeTime(updatedAt);
}

function buildSkillDisplayName(skill: AsterSubagentSkillInfo): string {
  return buildTeamWorkspaceSkillDisplayName(skill);
}

function canStartCanvasPanGesture(
  target: EventTarget | null,
  currentTarget: EventTarget | null,
  modifierActive: boolean,
): boolean {
  if (modifierActive) {
    return true;
  }

  if (!(target instanceof HTMLElement)) {
    return target === currentTarget;
  }

  if (target.closest('[data-team-workspace-canvas-pan-block="true"]')) {
    return false;
  }

  return (
    target.closest('[data-team-workspace-canvas-pan-surface="true"]') !== null ||
    target === currentTarget
  );
}

function normalizeActivityPreviewText(
  value?: string | null,
  maxLength = ACTIVITY_PREVIEW_MAX_LENGTH,
): string | null {
  const normalized = value
    ?.replace(/\r\n/g, "\n")
    .split("\0")
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function buildActivityPreviewLine(
  label: string,
  value?: string | null,
): string | null {
  const normalized = normalizeActivityPreviewText(value);
  if (!normalized) {
    return null;
  }
  return `${label}：${normalized}`;
}

function resolveActivityEntryStatusMeta(
  item: AgentThreadItem | { type: "message_fallback" },
  status?: AgentThreadItem["status"],
) {
  if (item.type === "error") {
    return {
      label: "错误",
      badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
    };
  }

  if (item.type === "warning") {
    return {
      label: "警告",
      badgeClassName: "border border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  switch (status) {
    case "in_progress":
      return {
        label: "进行中",
        badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
      };
    case "failed":
      return {
        label: "失败",
        badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
      };
    case "completed":
      return {
        label: "完成",
        badgeClassName: "border border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    default:
      return {
        label: "消息",
        badgeClassName: "border border-slate-200 bg-slate-50 text-slate-600",
      };
  }
}

function buildActivityPreviewFromEntry(entry?: SessionActivityEntry | null) {
  if (!entry) {
    return null;
  }

  return buildActivityPreviewLine(entry.title, entry.detail);
}

function extractMessageActivityEntries(
  detail: AsterSessionDetail,
): SessionActivityEntry[] {
  const reversedMessages = [...detail.messages].sort(
    (left, right) => right.timestamp - left.timestamp,
  );

  for (const message of reversedMessages) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const content of message.content) {
      const title =
        content.type === "tool_response"
          ? content.error
            ? "错误"
            : content.output
              ? "输出"
              : "回复"
          : "回复";
      const previewSource =
        content.type === "tool_response"
          ? content.error || content.output
          : content.type === "text" || content.type === "thinking"
            ? content.text
            : undefined;
      const detailText = normalizeActivityPreviewText(
        previewSource,
        ACTIVITY_TIMELINE_DETAIL_MAX_LENGTH,
      );

      if (detailText) {
        const statusMeta = resolveActivityEntryStatusMeta(
          { type: "message_fallback" },
          undefined,
        );
        return [
          {
            id: `message-${message.id ?? message.timestamp}`,
            title,
            detail: detailText,
            statusLabel: statusMeta.label,
            badgeClassName: statusMeta.badgeClassName,
          },
        ];
      }
    }
  }

  return [];
}

function extractSessionActivitySnapshot(detail: AsterSessionDetail): {
  preview: string | null;
  entries: SessionActivityEntry[];
} {
  const orderedItems = [...(detail.items ?? [])].sort(
    (left, right) => right.sequence - left.sequence,
  );
  const entries: SessionActivityEntry[] = [];

  for (const item of orderedItems) {
    const entry = buildTeamWorkspaceActivityEntryFromThreadItem(item);
    if (entry) {
      entries.push(entry);
    }
    if (entries.length >= ACTIVITY_TIMELINE_ENTRY_LIMIT) {
      break;
    }
  }

  if (entries.length > 0) {
    return {
      preview: buildActivityPreviewFromEntry(entries[0]),
      entries,
    };
  }

  const messageEntries = extractMessageActivityEntries(detail);
  return {
    preview: buildActivityPreviewFromEntry(messageEntries[0]),
    entries: messageEntries,
  };
}

function shouldPollSessionActivity(session?: TeamSessionCard | null) {
  const runtimeStatus = session?.runtimeStatus;
  const latestTurnStatus = session?.latestTurnStatus;
  return (
    runtimeStatus === "running" ||
    runtimeStatus === "queued" ||
    latestTurnStatus === "running" ||
    latestTurnStatus === "queued"
  );
}

function buildSessionActivityFingerprint(session?: TeamSessionCard | null) {
  return buildTeamWorkspaceSessionFingerprint(session);
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}

function buildRuntimeDetailSummary(session?: TeamSessionCard | null): string | null {
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
    parts.push(`处理中 ${session.teamActiveCount}/${session.teamParallelBudget}`);
  }
  if (session.providerParallelBudget === 1 && session.providerConcurrencyGroup) {
    parts.push(resolveTeamWorkspaceStableProcessingLabel());
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function isWaitableTeamSession(session?: TeamSessionCard | null) {
  return Boolean(
    session &&
      session.sessionType !== "user" &&
      !isTeamWorkspaceTerminalStatus(session.runtimeStatus),
  );
}

function isCompletedTeamSession(session?: TeamSessionCard | null) {
  return (
    session?.runtimeStatus === "completed" ||
    session?.runtimeStatus === "failed" ||
    session?.runtimeStatus === "aborted"
  );
}

function buildTeamWaitSummaryDisplay(
  summary: TeamWorkspaceWaitSummary,
  sessionNameById: Map<string, string>,
): {
  text: string;
  badgeClassName: string;
} {
  if (summary.timedOut) {
    return {
      text: `刚才等待结果时超时了，还有 ${summary.awaitedSessionIds.length} 位协作成员仍在处理中。`,
      badgeClassName: "border border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  const resolvedName = summary.resolvedSessionId
    ? sessionNameById.get(summary.resolvedSessionId) ?? summary.resolvedSessionId
    : "成员";
  const normalizedStatus = summary.resolvedStatus
    ? normalizeTeamWorkspaceRuntimeStatus(summary.resolvedStatus)
    : undefined;
  const statusMeta = resolveStatusMeta(normalizedStatus);

  return {
    text: `刚才等到 ${resolvedName} 返回了新结果，当前状态为${resolveTeamWorkspaceRuntimeStatusLabel(summary.resolvedStatus)}。`,
    badgeClassName: statusMeta.badgeClassName,
  };
}

function buildTeamControlSummaryDisplay(
  summary: TeamWorkspaceControlSummary,
  sessionNameById: Map<string, string>,
): {
  text: string;
  badgeClassName: string;
} {
  const affectedCount = summary.affectedSessionIds.length;
  const firstAffectedId = summary.affectedSessionIds[0];
  const firstAffectedName = firstAffectedId
    ? sessionNameById.get(firstAffectedId) ?? firstAffectedId
    : "成员";

  switch (summary.action) {
    case "resume":
      return {
        text:
          affectedCount > 1
            ? `刚才已继续 ${affectedCount} 位协作成员的处理。`
            : `刚才已继续 ${firstAffectedName} 的处理。`,
        badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
      };
    case "close_completed":
      return {
        text: `刚才已收起 ${affectedCount} 位已完成成员。`,
        badgeClassName: "border border-slate-200 bg-slate-100 text-slate-700",
      };
    case "close":
    default:
      return {
        text:
          affectedCount > 1
            ? `刚才已暂停 ${affectedCount} 位协作成员的处理。`
            : `刚才已暂停 ${firstAffectedName} 的处理。`,
        badgeClassName: "border border-slate-200 bg-slate-100 text-slate-700",
      };
  }
}

function buildTeamOperationDisplayEntries(params: {
  sessionNameById: Map<string, string>;
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
}): TeamOperationDisplayEntry[] {
  const entries: TeamOperationDisplayEntry[] = [];

  if (params.teamWaitSummary) {
    const display = buildTeamWaitSummaryDisplay(
      params.teamWaitSummary,
      params.sessionNameById,
    );
    entries.push({
      id: `wait-${params.teamWaitSummary.updatedAt}`,
      title: params.teamWaitSummary.timedOut ? "等待超时" : "收到结果",
      detail: display.text,
      badgeClassName: display.badgeClassName,
      updatedAt: params.teamWaitSummary.updatedAt,
      targetSessionId:
        params.teamWaitSummary.resolvedSessionId ??
        params.teamWaitSummary.awaitedSessionIds[0],
    });
  }

  if (params.teamControlSummary) {
    const display = buildTeamControlSummaryDisplay(
      params.teamControlSummary,
      params.sessionNameById,
    );
    const title = (() => {
      switch (params.teamControlSummary.action) {
        case "resume":
          return "继续处理";
        case "close_completed":
          return "收起完成项";
        case "close":
        default:
          return "暂停处理";
      }
    })();

    entries.push({
      id: `control-${params.teamControlSummary.action}-${params.teamControlSummary.updatedAt}`,
      title,
      detail: display.text,
      badgeClassName: display.badgeClassName,
      updatedAt: params.teamControlSummary.updatedAt,
      targetSessionId:
        params.teamControlSummary.affectedSessionIds[0] ??
        params.teamControlSummary.requestedSessionIds[0],
    });
  }

  return entries.sort((left, right) => right.updatedAt - left.updatedAt);
}

function buildCurrentChildSession(
  currentSessionId?: string | null,
  currentSessionName?: string | null,
  currentSessionRuntimeStatus?: RuntimeStatus,
  currentSessionLatestTurnStatus?: RuntimeStatus,
  currentSessionQueuedTurnCount?: number,
  subagentParentContext?: AsterSubagentParentContext | null,
): TeamSessionCard | null {
  if (!currentSessionId || !subagentParentContext) {
    return null;
  }

  return {
    id: currentSessionId,
    name: currentSessionName?.trim() || "当前成员",
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

function buildOrchestratorSession(
  currentSessionId?: string | null,
  currentSessionName?: string | null,
  currentSessionRuntimeStatus?: RuntimeStatus,
): TeamSessionCard | null {
  if (!currentSessionId) {
    return null;
  }

  return {
    id: currentSessionId,
    name: currentSessionName?.trim() || TEAM_WORKSPACE_MAIN_ASSISTANT_LABEL,
    runtimeStatus: currentSessionRuntimeStatus,
    taskSummary:
      "当前主助手会负责拆分需求、邀请协作成员加入，并把各部分结果汇总到同一份内容里。",
    roleHint: "orchestrator",
    sessionType: "user",
    isCurrent: true,
  };
}

function dedupeSessions(
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
    profileId?: string;
    roleKey?: string;
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
      if (sessionRoleKey && normalizeComparableText(role.roleKey) === sessionRoleKey) {
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
  if (
    candidates.length > 1 &&
    candidates[0]?.score === candidates[1]?.score
  ) {
    return null;
  }

  return candidates[0]?.roleId ?? null;
}

function orderSessionsByRuntimeRoles(
  sessions: TeamSessionCard[],
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null,
): TeamSessionCard[] {
  if (sessions.length <= 1 || !teamDispatchPreviewState) {
    return sessions;
  }

  const runtimeRoles = (
    teamDispatchPreviewState.members.length > 0
      ? teamDispatchPreviewState.members
      : teamDispatchPreviewState.blueprint?.roles ?? []
  ).map((role) => ({
    id: role.id,
    label: role.label,
    profileId: role.profileId,
    roleKey: role.roleKey,
  }));

  if (runtimeRoles.length === 0) {
    return sessions;
  }

  const roleOrder = new Map(runtimeRoles.map((role, index) => [role.id, index]));
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

function buildBoardHeadline(params: {
  hasRealTeamGraph: boolean;
  isChildSession: boolean;
  subagentParentContext?: AsterSubagentParentContext | null;
  totalTeamSessions: number;
}) {
  const {
    hasRealTeamGraph,
    isChildSession,
    subagentParentContext,
    totalTeamSessions,
  } = params;

  if (isChildSession) {
    return subagentParentContext?.parent_session_name?.trim() || "主助手协作区";
  }
  if (!hasRealTeamGraph) {
    return "需要时会自动加入协作成员";
  }
  return totalTeamSessions > 0
    ? `${totalTeamSessions} 位成员协作中`
    : "创作协作";
}

function buildBoardHint(params: {
  hasRealTeamGraph: boolean;
  isChildSession: boolean;
  siblingCount: number;
}) {
  const { hasRealTeamGraph, isChildSession, siblingCount } = params;

  if (isChildSession) {
    return siblingCount > 0
      ? `当前正与 ${siblingCount} 位协作成员并行推进`
      : "当前由你和这位协作成员一起推进";
  }
  if (!hasRealTeamGraph) {
    return "系统会在需要时自动邀请协作成员加入，不需要你理解内部分工方式。";
  }
  return "这里只展示谁在帮你处理什么、处理到哪一步，以及接下来会给你什么结果。";
}

function buildFallbackSummary(params: {
  hasRealTeamGraph: boolean;
  isChildSession: boolean;
  selectedSession?: TeamSessionCard | null;
}) {
  const { hasRealTeamGraph, isChildSession, selectedSession } = params;

  if (!hasRealTeamGraph) {
    return "还没有协作成员加入。需要时系统会自动补充分工，并在这里展示最新进展。";
  }
  if (selectedSession?.sessionType === "user") {
    return "主助手会负责整理需求、分配分工，并把各部分结果汇总到当前内容里。";
  }
  if (isChildSession) {
    return "这位协作成员正在处理主助手分配的内容，你可以在这里切换查看其他成员的进展。";
  }
  return "选中一位协作成员后，这里会展示它正在帮你做什么，以及目前进展到哪一步。";
}

function buildRuntimeFormationHint(
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

function buildRuntimeFormationEmptyDetail(
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

function buildSessionLaneEmptyState(params: {
  session?: TeamSessionCard | null;
  previewState?: SessionActivityPreviewState | null;
}) {
  const { session, previewState } = params;

  if (previewState?.status === "error") {
    return previewState.errorMessage?.trim() || "同步最新内容失败";
  }

  if (previewState?.status === "loading") {
    return "正在同步这位协作成员的最新内容...";
  }

  if (session?.runtimeStatus === "queued") {
    return "这位协作成员已经收到任务，马上开始处理。";
  }

  if (session?.runtimeStatus === "running") {
    return "这位协作成员正在处理，最新进展会持续刷新到这里。";
  }

  if (session?.runtimeStatus === "completed") {
    return "这部分已经完成，结果会继续汇入当前内容。";
  }

  if (session?.runtimeStatus === "failed" || session?.runtimeStatus === "aborted") {
    return "这一步没有顺利完成，你可以在下方查看细节并决定是否继续。";
  }

  return "这位协作成员暂时还没有产出可展示的内容。";
}

type TeamWorkspaceCanvasLaneKind = "session" | "runtime" | "planned";

interface TeamWorkspaceCanvasLane {
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
  session?: TeamSessionCard;
  previewText?: string | null;
  previewEntries?: SessionActivityEntry[];
}

interface TeamWorkspaceCanvasBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

const TEAM_WORKSPACE_CANVAS_STAGE_HEIGHT = "clamp(540px, 74vh, 920px)";
const TEAM_WORKSPACE_CANVAS_WORLD_MIN_WIDTH = 1480;
const TEAM_WORKSPACE_CANVAS_WORLD_MIN_HEIGHT = 980;
const TEAM_WORKSPACE_CANVAS_WORLD_PADDING = 180;
const TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING = 64;
const TEAM_WORKSPACE_CANVAS_KEYBOARD_PAN_STEP = 72;
const TEAM_WORKSPACE_CANVAS_KEYBOARD_FAST_PAN_STEP = 216;
const TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_X = 24;
const TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_Y = 28;

function resolveCanvasAutoLayoutColumns(
  laneCount: number,
  viewportWidth: number,
): number {
  if (laneCount <= 1) {
    return 1;
  }
  if (laneCount === 2) {
    return 2;
  }

  if (viewportWidth >= 1080) {
    return Math.min(3, laneCount);
  }

  return Math.min(2, laneCount);
}

function resolveCanvasLanePreferredSize(params: {
  laneKind: TeamWorkspaceCanvasLaneKind;
  laneCount: number;
  viewportWidth: number;
  expanded?: boolean;
}): Pick<TeamWorkspaceCanvasItemLayout, "width" | "height"> {
  const columns = resolveCanvasAutoLayoutColumns(
    params.laneCount,
    params.viewportWidth,
  );
  const gapX = TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_X;
  const safeViewportWidth = Math.max(params.viewportWidth, columns >= 3 ? 1180 : 980);
  const usableWidth =
    safeViewportWidth -
    TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING * 2 -
    Math.max(0, columns - 1) * gapX;
  const rawWidth = Math.floor(usableWidth / columns);
  const width =
    params.laneKind === "session"
      ? clampCanvasNumber(rawWidth, 340, columns === 1 ? 560 : columns === 2 ? 460 : 390)
      : clampCanvasNumber(rawWidth - 20, 320, columns === 1 ? 520 : 380);
  const height =
    params.laneKind === "session"
      ? params.expanded
        ? clampCanvasNumber(Math.round(width * 1.68), 620, 880)
        : clampCanvasNumber(Math.round(width * 1.12), 380, 520)
      : clampCanvasNumber(Math.round(width * 0.78), 260, 340);

  return { width, height };
}

function buildCanvasStageHint(params: {
  hasRealTeamGraph: boolean;
  hasRuntimeFormation: boolean;
  hasSelectedTeamPlan: boolean;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
}) {
  const {
    hasRealTeamGraph,
    hasRuntimeFormation,
    hasSelectedTeamPlan,
    teamDispatchPreviewState,
  } =
    params;

  if (hasRealTeamGraph) {
    return "拖动画布空白处可平移，滚轮配合 Ctrl/Cmd 可缩放，拖动成员卡片可调整布局。";
  }

  if (teamDispatchPreviewState?.status === "forming") {
    return "当前协作分工正在准备中，成员加入后会接手这些位置。";
  }

  if (teamDispatchPreviewState?.status === "formed") {
    return "当前协作分工已经准备好，成员加入后会自动接手这些位置。";
  }

  if (teamDispatchPreviewState?.status === "failed") {
    return (
      teamDispatchPreviewState.errorMessage?.trim() ||
      "当前协作准备失败，暂时无法生成成员画布。"
    );
  }

  if (hasRuntimeFormation || hasSelectedTeamPlan) {
    return "当前画布会先展示计划分工，成员加入后会切换为独立进展面板。";
  }

  return "协作成员加入后，这里会展开成可拖拽、可缩放的进展画布。";
}

function buildCanvasLaneTitleSummary(
  member: Pick<TeamWorkspaceRuntimeMember, "status" | "summary" | "sessionId">,
) {
  const memberMeta = resolveRuntimeMemberStatusMeta(member.status);
  const statusHint =
    member.status === "spawning"
      ? "正在接入协作成员"
      : member.status === "running"
        ? "这位协作成员正在处理"
        : member.status === "waiting"
          ? "等待继续补充说明"
          : member.status === "completed"
            ? "这一步已经完成"
            : member.status === "failed"
              ? "这一步需要重试"
              : member.sessionId
                ? "已连接到真实成员"
                : "等待协作成员加入";

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
    summary: member.summary,
    statusHint,
  };
}

function buildPlannedRoleLaneSummary(role: TeamRoleDefinition) {
  return {
    badgeLabel: "待开始",
    badgeClassName: "border border-slate-200 bg-slate-50 text-slate-600",
    dotClassName: "bg-slate-300",
    summary: role.summary,
    statusHint: "等待系统邀请协作成员加入",
  };
}

function resolveLaneMatchingRuntimeMemberId(
  session: TeamSessionCard,
  runtimeMembers: TeamWorkspaceRuntimeMember[],
): string | null {
  if (runtimeMembers.length === 0) {
    return null;
  }

  const explicitRoleId = session.blueprintRoleId?.trim();
  if (explicitRoleId && runtimeMembers.some((member) => member.id === explicitRoleId)) {
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
      if (normalizedRoleLabel && normalizeComparableText(member.label) === normalizedRoleLabel) {
        score += 8;
      }
      if (normalizedRoleKey && normalizeComparableText(member.roleKey) === normalizedRoleKey) {
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
  if (
    candidates.length > 1 &&
    candidates[0]?.score === candidates[1]?.score
  ) {
    return null;
  }
  return candidates[0]?.memberId ?? null;
}

function resolveLaneMatchingPlannedRoleId(
  session: TeamSessionCard,
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
      if (normalizedRoleLabel && normalizeComparableText(role.label) === normalizedRoleLabel) {
        score += 8;
      }
      if (normalizedRoleKey && normalizeComparableText(role.roleKey) === normalizedRoleKey) {
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
  if (
    candidates.length > 1 &&
    candidates[0]?.score === candidates[1]?.score
  ) {
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
      if (normalizedRoleLabel && normalizeComparableText(role.label) === normalizedRoleLabel) {
        score += 8;
      }
      if (normalizedRoleKey && normalizeComparableText(role.roleKey) === normalizedRoleKey) {
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
  if (
    candidates.length > 1 &&
    candidates[0]?.score === candidates[1]?.score
  ) {
    return null;
  }
  return candidates[0]?.roleId ?? null;
}

function resolveCanvasLaneBounds(
  layouts: TeamWorkspaceCanvasItemLayout[],
): TeamWorkspaceCanvasBounds {
  if (layouts.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: TEAM_WORKSPACE_CANVAS_WORLD_MIN_WIDTH,
      maxY: TEAM_WORKSPACE_CANVAS_WORLD_MIN_HEIGHT,
      width: TEAM_WORKSPACE_CANVAS_WORLD_MIN_WIDTH,
      height: TEAM_WORKSPACE_CANVAS_WORLD_MIN_HEIGHT,
    };
  }

  const minX = Math.min(...layouts.map((layout) => layout.x));
  const minY = Math.min(...layouts.map((layout) => layout.y));
  const maxX = Math.max(...layouts.map((layout) => layout.x + layout.width));
  const maxY = Math.max(...layouts.map((layout) => layout.y + layout.height));

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(
      TEAM_WORKSPACE_CANVAS_WORLD_MIN_WIDTH,
      maxX - minX + TEAM_WORKSPACE_CANVAS_WORLD_PADDING * 2,
    ),
    height: Math.max(
      TEAM_WORKSPACE_CANVAS_WORLD_MIN_HEIGHT,
      maxY - minY + TEAM_WORKSPACE_CANVAS_WORLD_PADDING * 2,
    ),
  };
}

function resolveCanvasViewportMetrics(
  element: HTMLDivElement | null,
  fallbackHeight: number,
): {
  width: number;
  height: number;
} {
  const rect = element?.getBoundingClientRect();
  return {
    width: rect && rect.width > 0 ? rect.width : 960,
    height: rect && rect.height > 0 ? rect.height : fallbackHeight,
  };
}

function clampCanvasNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function TeamWorkspaceBoard({
  className,
  embedded = false,
  shellVisible = false,
  defaultShellExpanded = false,
  currentSessionId,
  currentSessionName,
  currentSessionRuntimeStatus,
  currentSessionLatestTurnStatus,
  currentSessionQueuedTurnCount = 0,
  childSubagentSessions = [],
  subagentParentContext = null,
  liveRuntimeBySessionId = {},
  liveActivityBySessionId = {},
  activityRefreshVersionBySessionId = {},
  onSendSubagentInput,
  onWaitSubagentSession,
  onWaitActiveTeamSessions,
  onCloseCompletedTeamSessions,
  onCloseSubagentSession,
  onResumeSubagentSession,
  onOpenSubagentSession,
  onReturnToParentSession,
  teamWaitSummary = null,
  teamControlSummary = null,
  selectedTeamLabel = null,
  selectedTeamSummary = null,
  selectedTeamRoles = [],
  teamDispatchPreviewState = null,
}: TeamWorkspaceBoardProps) {
  const runtimeTeamState = teamDispatchPreviewState;
  const isChildSession = Boolean(subagentParentContext);
  const canvasStorageScopeId =
    currentSessionId?.trim() ||
    subagentParentContext?.parent_session_id?.trim() ||
    runtimeTeamState?.requestId?.trim() ||
    "team-workspace";
  const [shellExpanded, setShellExpanded] = useState(defaultShellExpanded);
  const detailExpanded = !embedded;
  const canvasViewportFallbackHeight =
    embedded && !detailExpanded ? 720 : 560;
  const [canvasLayoutState, setCanvasLayoutState] =
    useState<TeamWorkspaceCanvasLayoutState>(() =>
      loadTeamWorkspaceCanvasLayout(canvasStorageScopeId) ??
      createDefaultTeamWorkspaceCanvasLayoutState(),
    );
  const [pendingSessionAction, setPendingSessionAction] = useState<{
    sessionId: string;
    action: "close" | "resume" | "wait" | "send" | "interrupt_send";
  } | null>(null);
  const [pendingTeamAction, setPendingTeamAction] = useState<
    "wait_any" | "close_completed" | null
  >(null);
  const [isCanvasPanModifierActive, setIsCanvasPanModifierActive] =
    useState(false);
  const [sessionInputDraftById, setSessionInputDraftById] = useState<
    Record<string, string>
  >({});
  const [sessionActivityPreviewById, setSessionActivityPreviewById] = useState<
    Record<string, SessionActivityPreviewState>
  >({});
  const sessionActivityPreviewByIdRef = useRef<
    Record<string, SessionActivityPreviewState>
  >({});
  const pendingSessionActivityRequestsRef = useRef(new Set<string>());
  const lastAutoFocusedTeamWaitKeyRef = useRef<string | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const [canvasViewportMetrics, setCanvasViewportMetrics] = useState<{
    width: number;
    height: number;
  }>({
    width: 960,
    height: embedded ? 720 : 560,
  });
  const canvasLayoutStateRef = useRef<TeamWorkspaceCanvasLayoutState>(
    canvasLayoutState,
  );
  const canvasLaneLayoutsRef = useRef<Record<string, TeamWorkspaceCanvasItemLayout>>(
    {},
  );
  const canvasInteractionCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    sessionActivityPreviewByIdRef.current = sessionActivityPreviewById;
  }, [sessionActivityPreviewById]);

  useEffect(() => {
    canvasLayoutStateRef.current = canvasLayoutState;
  }, [canvasLayoutState]);

  useEffect(() => {
    setCanvasLayoutState(
      loadTeamWorkspaceCanvasLayout(canvasStorageScopeId) ??
        createDefaultTeamWorkspaceCanvasLayoutState(),
    );
  }, [canvasStorageScopeId]);

  useEffect(() => {
    persistTeamWorkspaceCanvasLayout(canvasStorageScopeId, canvasLayoutState);
  }, [canvasLayoutState, canvasStorageScopeId]);

  useEffect(() => {
    return () => {
      canvasInteractionCleanupRef.current?.();
      canvasInteractionCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const syncCanvasViewportMetrics = () => {
      setCanvasViewportMetrics(
        resolveCanvasViewportMetrics(
          canvasViewportRef.current,
          canvasViewportFallbackHeight,
        ),
      );
    };

    syncCanvasViewportMetrics();
    window.addEventListener("resize", syncCanvasViewportMetrics);

    return () => {
      window.removeEventListener("resize", syncCanvasViewportMetrics);
    };
  }, [canvasViewportFallbackHeight]);

  const baseOrchestratorSession = useMemo(
    () =>
      buildOrchestratorSession(
        currentSessionId,
        currentSessionName,
        currentSessionRuntimeStatus,
      ),
    [currentSessionId, currentSessionName, currentSessionRuntimeStatus],
  );

  const baseCurrentChildSession = useMemo(
    () =>
      buildCurrentChildSession(
        currentSessionId,
        currentSessionName,
        currentSessionRuntimeStatus,
        currentSessionLatestTurnStatus,
        currentSessionQueuedTurnCount,
        subagentParentContext,
      ),
    [
      currentSessionId,
      currentSessionName,
      currentSessionRuntimeStatus,
      currentSessionLatestTurnStatus,
      currentSessionQueuedTurnCount,
      subagentParentContext,
    ],
  );

  const baseVisibleSessions = useMemo<TeamSessionCard[]>(
    () =>
      (isChildSession
        ? (subagentParentContext?.sibling_subagent_sessions ?? [])
        : childSubagentSessions
      ).map((session) => ({
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
      })),
    [childSubagentSessions, isChildSession, subagentParentContext],
  );
  const baseHasRealTeamGraph = isChildSession || baseVisibleSessions.length > 0;
  const baseRailSessions = useMemo(
    () =>
      dedupeSessions(
        isChildSession
          ? [baseCurrentChildSession, ...baseVisibleSessions]
          : baseHasRealTeamGraph
            ? [baseOrchestratorSession, ...baseVisibleSessions]
            : [],
      ),
    [
      baseCurrentChildSession,
      baseHasRealTeamGraph,
      baseOrchestratorSession,
      baseVisibleSessions,
      isChildSession,
    ],
  );
  const orchestratorSession = useMemo(
    () =>
      applyLiveRuntimeState(
        baseOrchestratorSession,
        baseOrchestratorSession
          ? liveRuntimeBySessionId[baseOrchestratorSession.id]
          : undefined,
      ),
    [baseOrchestratorSession, liveRuntimeBySessionId],
  );
  const currentChildSession = useMemo(
    () =>
      applyLiveRuntimeState(
        baseCurrentChildSession,
        baseCurrentChildSession
          ? liveRuntimeBySessionId[baseCurrentChildSession.id]
          : undefined,
      ),
    [baseCurrentChildSession, liveRuntimeBySessionId],
  );
  const visibleSessions = useMemo(
    () =>
      baseVisibleSessions.map(
        (session) =>
          applyLiveRuntimeState(
            session,
            liveRuntimeBySessionId[session.id],
          ) ?? session,
      ),
    [baseVisibleSessions, liveRuntimeBySessionId],
  );

  const totalTeamSessions = isChildSession
    ? visibleSessions.length + (currentChildSession ? 1 : 0)
    : visibleSessions.length;
  const siblingCount =
    subagentParentContext?.sibling_subagent_sessions?.length ?? 0;
  const hasRealTeamGraph = isChildSession || visibleSessions.length > 0;
  const isEmptyShellState =
    !isChildSession && shellVisible && visibleSessions.length === 0;
  const normalizedSelectedTeamLabel = selectedTeamLabel?.trim() || null;
  const normalizedSelectedTeamSummary = selectedTeamSummary?.trim() || null;
  const normalizedSelectedTeamRoles = (selectedTeamRoles ?? []).filter((role) =>
    role.label.trim(),
  );
  const runtimeFormationMeta = runtimeTeamState
    ? resolveRuntimeFormationStatusMeta(runtimeTeamState.status)
    : null;
  const runtimeFormationLabel =
    runtimeTeamState?.label?.trim() ||
    runtimeTeamState?.blueprint?.label?.trim() ||
    normalizedSelectedTeamLabel;
  const runtimeFormationSummary =
    runtimeTeamState?.summary?.trim() ||
    runtimeTeamState?.blueprint?.summary?.trim() ||
    normalizedSelectedTeamSummary;
  const runtimeMembers = useMemo(
    () => runtimeTeamState?.members ?? [],
    [runtimeTeamState?.members],
  );
  const runtimeBlueprintRoles = useMemo(
    () => runtimeTeamState?.blueprint?.roles ?? [],
    [runtimeTeamState?.blueprint?.roles],
  );
  const hasRuntimeFormation = Boolean(runtimeTeamState);
  const hasSelectedTeamPlan =
    Boolean(normalizedSelectedTeamLabel) ||
    Boolean(normalizedSelectedTeamSummary) ||
    normalizedSelectedTeamRoles.length > 0;

  const renderSelectedTeamPlanSummary = () => {
    if (!hasSelectedTeamPlan) {
      return null;
    }

    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        {normalizedSelectedTeamLabel ? (
          <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-700">
            {TEAM_WORKSPACE_PLAN_LABEL} · {normalizedSelectedTeamLabel}
          </span>
        ) : null}
        {normalizedSelectedTeamRoles.length > 0 ? (
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
            {normalizedSelectedTeamRoles.length} 个计划分工
          </span>
        ) : null}
      </div>
    );
  };

  const renderSelectedTeamPlanPanel = () => {
    if (!hasSelectedTeamPlan) {
      return null;
    }

    return (
      <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <Bot className="h-3.5 w-3.5" />
          <span>计划中的协作分工</span>
          {normalizedSelectedTeamLabel ? (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-sky-700 normal-case">
              {normalizedSelectedTeamLabel}
            </span>
          ) : null}
        </div>
        {normalizedSelectedTeamSummary ? (
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {normalizedSelectedTeamSummary}
          </p>
        ) : null}
        {normalizedSelectedTeamRoles.length > 0 ? (
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {normalizedSelectedTeamRoles.map((role) => (
              <div
                key={`planned-team-role-${role.id}`}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {role.label}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {role.summary}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderRuntimeFormationSummary = () => {
    if (!hasRuntimeFormation) {
      return null;
    }

    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        {runtimeFormationLabel ? (
          <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-700">
            {TEAM_WORKSPACE_PLAN_LABEL} · {runtimeFormationLabel}
          </span>
        ) : null}
        {runtimeFormationMeta ? (
          <span
            className={cn(
              "rounded-full px-2.5 py-1 font-medium",
              runtimeFormationMeta.badgeClassName,
            )}
          >
            {runtimeFormationMeta.label}
          </span>
        ) : null}
        {runtimeMembers.length > 0 ? (
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
            {runtimeMembers.length} 位当前成员
          </span>
        ) : null}
        {runtimeTeamState?.blueprint?.label ? (
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
            参考方案 · {runtimeTeamState.blueprint.label}
          </span>
        ) : null}
      </div>
    );
  };

  const renderRuntimeFormationPanel = () => {
    if (!runtimeTeamState || !runtimeFormationMeta) {
      return null;
    }

    return (
      <div
        data-testid="team-workspace-runtime-formation"
        className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5"
      >
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <Workflow className="h-3.5 w-3.5" />
          <span>当前协作准备</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium tracking-normal",
              runtimeFormationMeta.badgeClassName,
            )}
          >
            {runtimeFormationMeta.label}
          </span>
          {runtimeFormationLabel ? (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-sky-700 normal-case">
              {runtimeFormationLabel}
            </span>
          ) : null}
        </div>
        <div className="mt-2 text-sm font-semibold text-slate-900">
          {runtimeFormationMeta.title}
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {runtimeTeamState.status === "failed"
            ? runtimeTeamState.errorMessage?.trim() ||
              "当前协作准备失败，暂时无法展示更多内容。"
            : runtimeFormationSummary ||
              "这里会先展示当前协作方案，成员加入后再切换成实时进展。"}
        </p>
        {runtimeTeamState.blueprint?.label ? (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
            参考方案：{runtimeTeamState.blueprint.label}
          </div>
        ) : null}
      </div>
    );
  };

  const renderRuntimeMemberPanel = () => {
    if (runtimeMembers.length === 0) {
      return null;
    }

    return (
      <div
        className="mt-3 grid gap-3 xl:grid-cols-2"
        data-testid="team-workspace-runtime-members"
      >
        {runtimeMembers.map((member) => {
          const memberMeta = resolveRuntimeMemberStatusMeta(member.status);
          return (
            <div
              key={`runtime-team-member-${member.id}`}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">
                  {member.label}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    memberMeta.badgeClassName,
                  )}
                >
                  {memberMeta.label}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {member.summary}
              </p>
            </div>
          );
        })}
      </div>
    );
  };

  const memberCanvasSessions = useMemo(
    () =>
      orderSessionsByRuntimeRoles(
        isChildSession
          ? dedupeSessions([currentChildSession, ...visibleSessions])
          : visibleSessions,
        teamDispatchPreviewState,
      ),
    [
      currentChildSession,
      isChildSession,
      teamDispatchPreviewState,
      visibleSessions,
    ],
  );
  const railSessions = useMemo(
    () =>
      dedupeSessions(
        isChildSession
          ? [currentChildSession, ...visibleSessions]
          : hasRealTeamGraph
            ? [orchestratorSession, ...visibleSessions]
            : [],
      ),
    [
      currentChildSession,
      hasRealTeamGraph,
      isChildSession,
      orchestratorSession,
      visibleSessions,
    ],
  );

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    () => railSessions[0]?.id ?? null,
  );
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  useEffect(() => {
    const defaultSelectedId = isChildSession
      ? currentSessionId ?? railSessions[0]?.id ?? null
      : memberCanvasSessions[0]?.id ?? railSessions[0]?.id ?? null;

    if (!selectedSessionId) {
      setSelectedSessionId(defaultSelectedId);
      return;
    }

    if (!railSessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(defaultSelectedId);
      return;
    }

    if (
      !isChildSession &&
      selectedSessionId === orchestratorSession?.id &&
      memberCanvasSessions.length > 0
    ) {
      setSelectedSessionId(memberCanvasSessions[0]?.id ?? defaultSelectedId);
    }
  }, [
    currentSessionId,
    isChildSession,
    memberCanvasSessions,
    orchestratorSession?.id,
    railSessions,
    selectedSessionId,
  ]);

  useEffect(() => {
    if (!expandedSessionId) {
      return;
    }

    if (!memberCanvasSessions.some((session) => session.id === expandedSessionId)) {
      setExpandedSessionId(null);
    }
  }, [expandedSessionId, memberCanvasSessions]);

  const selectedSession = useMemo(
    () =>
      railSessions.find((session) => session.id === selectedSessionId) ??
      railSessions[0] ??
      null,
    [railSessions, selectedSessionId],
  );
  const selectedBaseSession = useMemo(
    () =>
      baseRailSessions.find((session) => session.id === selectedSessionId) ??
      baseRailSessions[0] ??
      null,
    [baseRailSessions, selectedSessionId],
  );
  const selectedSessionActivityPreview = selectedSession
    ? sessionActivityPreviewById[selectedSession.id] ?? null
    : null;
  const selectedSessionActivityEntries = selectedSession
    ? mergeSessionActivityEntries(
        liveActivityBySessionId[selectedSession.id],
        selectedSessionActivityPreview?.entries,
        ACTIVITY_TIMELINE_ENTRY_LIMIT,
      )
    : [];
  const selectedSessionActivityPreviewText =
    buildActivityPreviewFromEntry(selectedSessionActivityEntries[0]) ??
    selectedSessionActivityPreview?.preview ??
    null;
  const selectedSessionSupportsActivityPreview = Boolean(
    selectedSession && selectedSession.sessionType !== "user",
  );
  const selectedSessionActivityId = selectedSessionSupportsActivityPreview
    ? selectedSession?.id ?? null
    : null;
  const selectedSessionActivityFingerprint = selectedSessionSupportsActivityPreview
    ? buildSessionActivityFingerprint(selectedBaseSession)
    : null;
  const selectedSessionActivityRefreshVersion =
    selectedSessionActivityId
      ? (activityRefreshVersionBySessionId[selectedSessionActivityId] ?? 0)
      : 0;
  const selectedSessionActivityShouldPoll =
    selectedSessionSupportsActivityPreview &&
    shouldPollSessionActivity(selectedSession);
  const basePreviewableRailSessions = useMemo(
    () => baseRailSessions.filter((session) => session.sessionType !== "user"),
    [baseRailSessions],
  );
  const previewableRailSessionsSyncKey = useMemo(
    () =>
      basePreviewableRailSessions
        .map((session) => {
          const fingerprint = buildSessionActivityFingerprint(session);
          const refreshVersion =
            activityRefreshVersionBySessionId[session.id] ?? 0;
          return `${session.id}:${fingerprint}:${refreshVersion}`;
        })
        .join("|"),
    [activityRefreshVersionBySessionId, basePreviewableRailSessions],
  );

  const syncSessionActivityPreview = useCallback(
    async (
      sessionId: string,
      fingerprint: string,
      refreshVersion = 0,
      options?: { force?: boolean },
    ) => {
      const current = sessionActivityPreviewByIdRef.current[sessionId];
      const shouldForceRefresh =
        options?.force || (current?.refreshVersion ?? 0) < refreshVersion;
      if (
        !shouldForceRefresh &&
        current?.status === "ready" &&
        current.fingerprint === fingerprint &&
        (current.refreshVersion ?? 0) === refreshVersion
      ) {
        return;
      }

      if (pendingSessionActivityRequestsRef.current.has(sessionId)) {
        return;
      }

      pendingSessionActivityRequestsRef.current.add(sessionId);
      setSessionActivityPreviewById((previous) => {
        const currentState = previous[sessionId];
        if (
          currentState?.status === "loading" &&
          currentState.fingerprint === fingerprint
        ) {
          return previous;
        }

        return {
          ...previous,
          [sessionId]: {
            preview: currentState?.preview ?? null,
            entries: currentState?.entries ?? [],
            status: "loading",
            errorMessage: undefined,
            fingerprint,
            refreshVersion,
            syncedAt: currentState?.syncedAt,
          },
        };
      });

      try {
        const detail = await getAgentRuntimeSession(sessionId);
        const activitySnapshot = extractSessionActivitySnapshot(detail);
        const syncedAt = Date.now();
        setSessionActivityPreviewById((previous) => ({
          ...previous,
          [sessionId]: {
            preview: activitySnapshot.preview,
            entries: activitySnapshot.entries,
            status: "ready",
            errorMessage: undefined,
            fingerprint,
            refreshVersion,
            syncedAt,
          },
        }));
      } catch (error) {
        setSessionActivityPreviewById((previous) => ({
          ...previous,
          [sessionId]: {
            preview: previous[sessionId]?.preview ?? null,
            entries: previous[sessionId]?.entries ?? [],
            status: "error",
            errorMessage:
              error instanceof Error ? error.message : "同步最近过程失败",
            fingerprint,
            refreshVersion,
            syncedAt: previous[sessionId]?.syncedAt,
          },
        }));
      } finally {
        pendingSessionActivityRequestsRef.current.delete(sessionId);
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedSessionActivityId || !selectedSessionActivityFingerprint) {
      return;
    }

    const sessionId = selectedSessionActivityId;
    const fingerprint = selectedSessionActivityFingerprint;
    let pollTimer: number | null = null;
    const cachedPreview = sessionActivityPreviewByIdRef.current[sessionId];

    if (
      !selectedSessionActivityShouldPoll &&
      cachedPreview?.status === "ready" &&
      cachedPreview.fingerprint === fingerprint &&
      (cachedPreview.refreshVersion ?? 0) === selectedSessionActivityRefreshVersion
    ) {
      return;
    }

    const syncSessionActivity = async () => {
      const current = sessionActivityPreviewByIdRef.current[sessionId];
      await syncSessionActivityPreview(
        sessionId,
        fingerprint,
        selectedSessionActivityRefreshVersion,
        {
          force:
            (current?.refreshVersion ?? 0) < selectedSessionActivityRefreshVersion,
        },
      );
    };

    void syncSessionActivity();

    if (selectedSessionActivityShouldPoll) {
      pollTimer = window.setInterval(() => {
        void syncSessionActivity();
      }, ACTIVITY_PREVIEW_POLL_INTERVAL_MS);
    }

    return () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
    };
  }, [
    activityRefreshVersionBySessionId,
    selectedSessionActivityFingerprint,
    selectedSessionActivityId,
    selectedSessionActivityRefreshVersion,
    selectedSessionActivityShouldPoll,
    syncSessionActivityPreview,
  ]);

  useEffect(() => {
    const staleSessions = basePreviewableRailSessions.filter((session) => {
      const fingerprint = buildSessionActivityFingerprint(session);
      const cachedPreview = sessionActivityPreviewByIdRef.current[session.id];
      const refreshVersion = activityRefreshVersionBySessionId[session.id] ?? 0;
      return (
        cachedPreview?.fingerprint !== fingerprint ||
        (cachedPreview?.refreshVersion ?? 0) < refreshVersion
      );
    });

    if (staleSessions.length === 0) {
      return;
    }

    let cancelled = false;

    const prefetchPreviews = async () => {
      await Promise.allSettled(
        staleSessions.map((session) => {
          if (cancelled) {
            return Promise.resolve();
          }

          const refreshVersion =
            activityRefreshVersionBySessionId[session.id] ?? 0;
          const cachedPreview = sessionActivityPreviewByIdRef.current[session.id];
          return syncSessionActivityPreview(
            session.id,
            buildSessionActivityFingerprint(session),
            refreshVersion,
            {
              force: (cachedPreview?.refreshVersion ?? 0) < refreshVersion,
            },
          );
        }),
      );
    };

    void prefetchPreviews();

    return () => {
      cancelled = true;
    };
  }, [
    activityRefreshVersionBySessionId,
    basePreviewableRailSessions,
    previewableRailSessionsSyncKey,
    syncSessionActivityPreview,
  ]);

  const canvasSessionLanes = useMemo<TeamWorkspaceCanvasLane[]>(
    () =>
      memberCanvasSessions.map((session) => {
        const previewState = sessionActivityPreviewById[session.id] ?? null;
        const mergedEntries = mergeSessionActivityEntries(
          liveActivityBySessionId[session.id],
          previewState?.entries,
          ACTIVITY_TIMELINE_ENTRY_LIMIT,
        );
        const cardActivityPreview =
          buildActivityPreviewFromEntry(mergedEntries[0]) ??
          previewState?.preview ??
          null;
        const meta = resolveStatusMeta(session.runtimeStatus);
        const matchedRuntimeMemberId = resolveLaneMatchingRuntimeMemberId(
          session,
          runtimeMembers,
        );
        const matchedPlannedRoleId = resolveLaneMatchingPlannedRoleId(
          session,
          normalizedSelectedTeamRoles,
        );
        const presetLabel = session.teamPresetId
          ? getTeamPresetOption(session.teamPresetId)?.label ?? session.teamPresetId
          : undefined;

        return {
          id: session.id,
          persistKey: `session:${session.id}`,
          fallbackPersistKeys: [
            matchedRuntimeMemberId ? `runtime:${matchedRuntimeMemberId}` : null,
            matchedPlannedRoleId ? `planned:${matchedPlannedRoleId}` : null,
          ].filter(Boolean) as string[],
          kind: "session" as const,
          title: session.name,
          summary:
            session.taskSummary ||
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
            cardActivityPreview || buildSessionLaneEmptyState({ session, previewState }),
          previewEntries: mergedEntries.slice(0, 3),
        };
      }),
    [
      liveActivityBySessionId,
      memberCanvasSessions,
      normalizedSelectedTeamRoles,
      runtimeMembers,
      sessionActivityPreviewById,
    ],
  );

  const canvasBlueprintLanes = useMemo<TeamWorkspaceCanvasLane[]>(
    () => {
      if (hasRealTeamGraph) {
        return [];
      }

      if (runtimeMembers.length > 0) {
        return runtimeMembers.map((member) => {
          const laneSummary = buildCanvasLaneTitleSummary(member);
          const matchedPlannedRoleId = resolveRuntimeMemberMatchingPlannedRoleId(
            member,
            normalizedSelectedTeamRoles,
          );
          return {
            id: member.id,
            persistKey: `runtime:${member.id}`,
            fallbackPersistKeys: matchedPlannedRoleId
              ? [`planned:${matchedPlannedRoleId}`]
              : [],
            kind: "runtime" as const,
            title: member.label,
            summary: laneSummary.summary,
            badgeLabel: laneSummary.badgeLabel,
            badgeClassName: laneSummary.badgeClassName,
            dotClassName: laneSummary.dotClassName,
            roleLabel: resolveTeamWorkspaceRoleHintLabel(member.roleKey) || undefined,
            profileLabel: undefined,
            statusHint: laneSummary.statusHint,
            updatedAtLabel: "等待成员加入",
            skillLabels: [],
            previewText: member.summary,
            previewEntries: [],
          };
        });
      }

      return normalizedSelectedTeamRoles.map((role) => {
        const laneSummary = buildPlannedRoleLaneSummary(role);
        return {
          id: role.id,
          persistKey: `planned:${role.id}`,
          fallbackPersistKeys: [],
          kind: "planned" as const,
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
          previewText: role.summary,
          previewEntries: [],
        };
      });
    },
    [
      hasRealTeamGraph,
      normalizedSelectedTeamRoles,
      runtimeMembers,
    ],
  );

  const canvasLanes = hasRealTeamGraph
    ? canvasSessionLanes
    : canvasBlueprintLanes;
  const canvasAutoLayoutViewportWidth = embedded
    ? Math.max(canvasViewportMetrics.width, 1240)
    : Math.max(canvasViewportMetrics.width, 1080);

  const updateCanvasViewport = useCallback(
    (
      updater: (
        viewport: TeamWorkspaceCanvasLayoutState["viewport"],
      ) => TeamWorkspaceCanvasLayoutState["viewport"],
    ) => {
      setCanvasLayoutState((previous) => {
        const nextViewport = updater(previous.viewport);
        if (
          nextViewport.x === previous.viewport.x &&
          nextViewport.y === previous.viewport.y &&
          nextViewport.zoom === previous.viewport.zoom
        ) {
          return previous;
        }

        return {
          ...previous,
          updatedAt: Date.now(),
          viewport: {
            x: nextViewport.x,
            y: nextViewport.y,
            zoom: clampTeamWorkspaceCanvasZoom(nextViewport.zoom),
          },
        };
      });
    },
    [],
  );

  const updateCanvasLaneLayout = useCallback(
    (
      persistKey: string,
      updater: (
        current: TeamWorkspaceCanvasItemLayout,
      ) => TeamWorkspaceCanvasItemLayout,
    ) => {
      setCanvasLayoutState((previous) => {
        const current =
          previous.items[persistKey] ??
          buildDefaultTeamWorkspaceCanvasItemLayout(0);
        const next = updater(current);

        if (
          next.x === current.x &&
          next.y === current.y &&
          next.width === current.width &&
          next.height === current.height &&
          next.zIndex === current.zIndex
        ) {
          return previous;
        }

        return {
          ...previous,
          updatedAt: Date.now(),
          items: {
            ...previous.items,
            [persistKey]: {
              x: next.x,
              y: next.y,
              width: Math.max(TEAM_WORKSPACE_CANVAS_MIN_WIDTH, next.width),
              height: Math.max(TEAM_WORKSPACE_CANVAS_MIN_HEIGHT, next.height),
              zIndex: Math.max(1, next.zIndex),
            },
          },
        };
      });
    },
    [],
  );

  const bringCanvasLaneToFront = useCallback((persistKey: string) => {
    setCanvasLayoutState((previous) => {
      const target = previous.items[persistKey];
      if (!target) {
        return previous;
      }

      const maxZIndex = Math.max(
        1,
        ...Object.values(previous.items).map((item) => item.zIndex),
      );
      if (target.zIndex >= maxZIndex) {
        return previous;
      }

      return {
        ...previous,
        updatedAt: Date.now(),
        items: {
          ...previous.items,
          [persistKey]: {
            ...target,
            zIndex: maxZIndex + 1,
          },
        },
      };
    });
  }, []);

  const bindCanvasMouseInteraction = useCallback(
    (
      onMove: (event: MouseEvent) => void,
      onEnd?: () => void,
    ) => {
      canvasInteractionCleanupRef.current?.();

      const handleMouseMove = (event: MouseEvent) => {
        onMove(event);
      };
      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        canvasInteractionCleanupRef.current = null;
        onEnd?.();
      };

      canvasInteractionCleanupRef.current = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [],
  );

  useEffect(() => {
    if (canvasLanes.length === 0) {
      return;
    }

    setCanvasLayoutState((previous) => {
      let changed = false;
      const nextItems = { ...previous.items };
      const hadStoredItems = Object.keys(previous.items).length > 0;

      canvasLanes.forEach((lane, index) => {
        const directLayout = nextItems[lane.persistKey];
        if (directLayout) {
          return;
        }

        const fallbackLayout = lane.fallbackPersistKeys
          .map((key) => nextItems[key])
          .find(Boolean);

        const preferredSize = resolveCanvasLanePreferredSize({
          laneKind: lane.kind,
          laneCount: canvasLanes.length,
          viewportWidth: canvasAutoLayoutViewportWidth,
        });
        nextItems[lane.persistKey] = fallbackLayout
          ? {
              ...fallbackLayout,
              width: preferredSize.width,
              height: preferredSize.height,
            }
          : buildDefaultTeamWorkspaceCanvasItemLayout(index, {
              width: preferredSize.width,
              height: preferredSize.height,
            });
        changed = true;
      });

      if (!changed) {
        return previous;
      }

      return {
        ...previous,
        updatedAt: Date.now(),
        items: hadStoredItems
          ? nextItems
          : {
              ...nextItems,
              ...buildTeamWorkspaceCanvasAutoLayout(
                canvasLanes.map((lane, index) => ({
                  persistKey: lane.persistKey,
                  layout:
                    nextItems[lane.persistKey] ??
                    buildDefaultTeamWorkspaceCanvasItemLayout(index),
                })),
                {
                  maxRowWidth: Math.max(
                    820,
                    canvasAutoLayoutViewportWidth -
                      TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING * 2,
                  ),
                  offsetX: 64,
                  offsetY: 76,
                  gapX: TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_X,
                  gapY: TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_Y,
                  centerRows: true,
                },
              ),
            },
      };
    });
  }, [canvasAutoLayoutViewportWidth, canvasLanes]);

  const canvasLaneLayouts = useMemo(
    () =>
      Object.fromEntries(
        canvasLanes.map((lane, index) => {
          const baseLayout =
            canvasLayoutState.items[lane.persistKey] ??
            buildDefaultTeamWorkspaceCanvasItemLayout(index);
          const isInlineExpanded =
            lane.kind === "session" &&
            lane.session?.id != null &&
            lane.session.id === expandedSessionId;

          if (!isInlineExpanded) {
            return [lane.persistKey, baseLayout];
          }

          const expandedHeight = resolveCanvasLanePreferredSize({
            laneKind: lane.kind,
            laneCount: canvasLanes.length,
            viewportWidth: canvasAutoLayoutViewportWidth,
            expanded: true,
          }).height;

          return [
            lane.persistKey,
            {
              ...baseLayout,
              height: Math.max(baseLayout.height, expandedHeight),
            },
          ];
        }),
      ),
    [
      canvasAutoLayoutViewportWidth,
      canvasLanes,
      canvasLayoutState.items,
      expandedSessionId,
    ],
  );

  useEffect(() => {
    canvasLaneLayoutsRef.current = canvasLaneLayouts;
  }, [canvasLaneLayouts]);

  const canvasBounds = useMemo(
    () => resolveCanvasLaneBounds(Object.values(canvasLaneLayouts)),
    [canvasLaneLayouts],
  );

  const handleStartCanvasPan = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (
        !canStartCanvasPanGesture(
          event.target,
          event.currentTarget,
          isCanvasPanModifierActive,
        )
      ) {
        return;
      }

      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startViewport = canvasLayoutStateRef.current.viewport;

      bindCanvasMouseInteraction((moveEvent) => {
        updateCanvasViewport(() => ({
          x: startViewport.x + (moveEvent.clientX - startX),
          y: startViewport.y + (moveEvent.clientY - startY),
          zoom: startViewport.zoom,
        }));
      });
    },
    [bindCanvasMouseInteraction, isCanvasPanModifierActive, updateCanvasViewport],
  );

  const handleStartCanvasLaneDrag = useCallback(
    (persistKey: string, event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const startLayout =
        canvasLaneLayoutsRef.current[persistKey] ??
        canvasLayoutStateRef.current.items[persistKey];
      if (!startLayout) {
        return;
      }

      const zoom = canvasLayoutStateRef.current.viewport.zoom;
      const startX = event.clientX;
      const startY = event.clientY;
      bringCanvasLaneToFront(persistKey);

      bindCanvasMouseInteraction((moveEvent) => {
        const deltaX = (moveEvent.clientX - startX) / zoom;
        const deltaY = (moveEvent.clientY - startY) / zoom;
        updateCanvasLaneLayout(persistKey, (current) => ({
          ...current,
          x: startLayout.x + deltaX,
          y: startLayout.y + deltaY,
        }));
      });
    },
    [bindCanvasMouseInteraction, bringCanvasLaneToFront, updateCanvasLaneLayout],
  );

  const handleStartCanvasLaneResize = useCallback(
    (
      persistKey: string,
      direction: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw",
      event: ReactMouseEvent<HTMLSpanElement>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const startLayout =
        canvasLaneLayoutsRef.current[persistKey] ??
        canvasLayoutStateRef.current.items[persistKey];
      if (!startLayout) {
        return;
      }

      const zoom = canvasLayoutStateRef.current.viewport.zoom;
      const startX = event.clientX;
      const startY = event.clientY;
      bringCanvasLaneToFront(persistKey);

      bindCanvasMouseInteraction((moveEvent) => {
        const deltaX = (moveEvent.clientX - startX) / zoom;
        const deltaY = (moveEvent.clientY - startY) / zoom;

        updateCanvasLaneLayout(persistKey, (current) => {
          let nextX = startLayout.x;
          let nextY = startLayout.y;
          let nextWidth = startLayout.width;
          let nextHeight = startLayout.height;

          if (direction.includes("e")) {
            nextWidth = Math.max(
              TEAM_WORKSPACE_CANVAS_MIN_WIDTH,
              startLayout.width + deltaX,
            );
          }
          if (direction.includes("s")) {
            nextHeight = Math.max(
              TEAM_WORKSPACE_CANVAS_MIN_HEIGHT,
              startLayout.height + deltaY,
            );
          }
          if (direction.includes("w")) {
            nextWidth = Math.max(
              TEAM_WORKSPACE_CANVAS_MIN_WIDTH,
              startLayout.width - deltaX,
            );
            nextX = startLayout.x + (startLayout.width - nextWidth);
          }
          if (direction.includes("n")) {
            nextHeight = Math.max(
              TEAM_WORKSPACE_CANVAS_MIN_HEIGHT,
              startLayout.height - deltaY,
            );
            nextY = startLayout.y + (startLayout.height - nextHeight);
          }

          return {
            ...current,
            x: nextX,
            y: nextY,
            width: nextWidth,
            height: nextHeight,
          };
        });
      });
    },
    [bindCanvasMouseInteraction, bringCanvasLaneToFront, updateCanvasLaneLayout],
  );

  const handleCanvasWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.08 : 0.08;
      updateCanvasViewport((viewport) => ({
        ...viewport,
        zoom: clampTeamWorkspaceCanvasZoom(viewport.zoom + delta),
      }));
    },
    [updateCanvasViewport],
  );

  const handleZoomIn = useCallback(() => {
    updateCanvasViewport((viewport) => ({
      ...viewport,
      zoom: Math.min(
        TEAM_WORKSPACE_CANVAS_MAX_ZOOM,
        clampTeamWorkspaceCanvasZoom(viewport.zoom + 0.12),
      ),
    }));
  }, [updateCanvasViewport]);

  const handleZoomOut = useCallback(() => {
    updateCanvasViewport((viewport) => ({
      ...viewport,
      zoom: Math.max(
        TEAM_WORKSPACE_CANVAS_MIN_ZOOM,
        clampTeamWorkspaceCanvasZoom(viewport.zoom - 0.12),
      ),
    }));
  }, [updateCanvasViewport]);

  const handleResetCanvasView = useCallback(() => {
    updateCanvasViewport(() => createDefaultTeamWorkspaceCanvasLayoutState().viewport);
  }, [updateCanvasViewport]);
  const handleAutoArrangeCanvas = useCallback(() => {
    if (canvasLanes.length === 0) {
      return;
    }

    setCanvasLayoutState((previous) => {
      const maxRowWidth = Math.max(
        820,
        canvasAutoLayoutViewportWidth / Math.max(previous.viewport.zoom, 0.1) -
          TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING * 2,
      );
      const nextItems = buildTeamWorkspaceCanvasAutoLayout(
        canvasLanes.map((lane, index) => ({
          persistKey: lane.persistKey,
          layout: {
            ...(previous.items[lane.persistKey] ??
              buildDefaultTeamWorkspaceCanvasItemLayout(index)),
            ...resolveCanvasLanePreferredSize({
              laneKind: lane.kind,
              laneCount: canvasLanes.length,
              viewportWidth: canvasAutoLayoutViewportWidth,
              expanded:
                lane.kind === "session" &&
                lane.session?.id != null &&
                lane.session.id === expandedSessionId,
            }),
          },
        })),
        {
          maxRowWidth,
          offsetX: 64,
          offsetY: 76,
          gapX: TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_X,
          gapY: TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_Y,
          centerRows: true,
        },
      );

      return {
        ...previous,
        updatedAt: Date.now(),
        viewport: createDefaultTeamWorkspaceCanvasLayoutState().viewport,
        items: {
          ...previous.items,
          ...nextItems,
        },
      };
    });
  }, [canvasAutoLayoutViewportWidth, canvasLanes, expandedSessionId]);

  const handleFitCanvasView = useCallback(() => {
    const viewportRect = canvasViewportRef.current?.getBoundingClientRect();
    if (!viewportRect || canvasLanes.length === 0) {
      return;
    }

    const contentWidth = Math.max(1, canvasBounds.maxX - canvasBounds.minX);
    const contentHeight = Math.max(1, canvasBounds.maxY - canvasBounds.minY);
    const usableWidth = Math.max(
      200,
      viewportRect.width - TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING * 2,
    );
    const usableHeight = Math.max(
      200,
      viewportRect.height - TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING * 2,
    );
    const zoom = clampTeamWorkspaceCanvasZoom(
      Math.min(usableWidth / contentWidth, usableHeight / contentHeight, 1.08),
    );

    updateCanvasViewport(() => ({
      x:
        TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING +
        (viewportRect.width - contentWidth * zoom) / 2 -
        canvasBounds.minX * zoom,
      y:
        TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING +
        (viewportRect.height - contentHeight * zoom) / 2 -
        canvasBounds.minY * zoom,
      zoom,
    }));
  }, [canvasBounds, canvasLanes.length, updateCanvasViewport]);

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        if (!isCanvasPanModifierActive) {
          setIsCanvasPanModifierActive(true);
        }
        return;
      }

      if (event.repeat) {
        return;
      }

      const normalizedKey = event.key.toLowerCase();
      if (normalizedKey === "a") {
        event.preventDefault();
        handleAutoArrangeCanvas();
        return;
      }
      if (normalizedKey === "f") {
        event.preventDefault();
        handleFitCanvasView();
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        handleResetCanvasView();
        return;
      }
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        handleZoomIn();
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        handleZoomOut();
        return;
      }

      if (canvasLanes.length === 0) {
        return;
      }

      const keyboardPanStep = event.shiftKey
        ? TEAM_WORKSPACE_CANVAS_KEYBOARD_FAST_PAN_STEP
        : TEAM_WORKSPACE_CANVAS_KEYBOARD_PAN_STEP;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        updateCanvasViewport((viewport) => ({
          ...viewport,
          x: viewport.x + keyboardPanStep,
        }));
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        updateCanvasViewport((viewport) => ({
          ...viewport,
          x: viewport.x - keyboardPanStep,
        }));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        updateCanvasViewport((viewport) => ({
          ...viewport,
          y: viewport.y + keyboardPanStep,
        }));
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        updateCanvasViewport((viewport) => ({
          ...viewport,
          y: viewport.y - keyboardPanStep,
        }));
      }
    };

    const handleWindowKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setIsCanvasPanModifierActive(false);
      }
    };

    const handleWindowBlur = () => {
      setIsCanvasPanModifierActive(false);
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    window.addEventListener("keyup", handleWindowKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
      window.removeEventListener("keyup", handleWindowKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
    handleAutoArrangeCanvas,
    handleFitCanvasView,
    handleResetCanvasView,
    handleZoomIn,
    handleZoomOut,
    canvasLanes.length,
    isCanvasPanModifierActive,
    updateCanvasViewport,
  ]);

  const canvasStageHint = useMemo(
    () =>
      buildCanvasStageHint({
        hasRealTeamGraph,
        hasRuntimeFormation,
        hasSelectedTeamPlan,
        teamDispatchPreviewState,
      }),
    [
      hasRealTeamGraph,
      hasRuntimeFormation,
      hasSelectedTeamPlan,
      teamDispatchPreviewState,
    ],
  );

  const statusSummary = useMemo(() => {
    const sessions = isChildSession
      ? dedupeSessions([currentChildSession, ...visibleSessions])
      : visibleSessions;

    return sessions.reduce(
      (summary, session) => {
        const key = session.runtimeStatus ?? "idle";
        summary[key] = (summary[key] ?? 0) + 1;
        return summary;
      },
      {} as Record<string, number>,
    );
  }, [currentChildSession, isChildSession, visibleSessions]);
  const railSessionNameById = useMemo(
    () => new Map(railSessions.map((session) => [session.id, session.name])),
    [railSessions],
  );
  const waitableTeamSessions = useMemo(
    () => railSessions.filter((session) => isWaitableTeamSession(session)),
    [railSessions],
  );
  const waitableTeamSessionIds = useMemo(
    () => waitableTeamSessions.map((session) => session.id),
    [waitableTeamSessions],
  );
  const canWaitAnyActiveTeamSession = Boolean(
    onWaitActiveTeamSessions && waitableTeamSessionIds.length > 1,
  );
  const visibleTeamWaitSummary = useMemo(() => {
    if (!teamWaitSummary) {
      return null;
    }

    return teamWaitSummary.awaitedSessionIds.some((sessionId) =>
      railSessionNameById.has(sessionId),
    )
      ? teamWaitSummary
      : null;
  }, [railSessionNameById, teamWaitSummary]);
  const visibleTeamControlSummary = useMemo(() => {
    if (!teamControlSummary) {
      return null;
    }

    return [...teamControlSummary.requestedSessionIds, ...teamControlSummary.affectedSessionIds]
      .some((sessionId) => railSessionNameById.has(sessionId))
      ? teamControlSummary
      : null;
  }, [railSessionNameById, teamControlSummary]);
  const teamOperationEntries = useMemo(
    () =>
      buildTeamOperationDisplayEntries({
        sessionNameById: railSessionNameById,
        teamWaitSummary: visibleTeamWaitSummary,
        teamControlSummary: visibleTeamControlSummary,
      }).filter(
        (entry) =>
          !entry.targetSessionId || railSessions.some((session) => session.id === entry.targetSessionId),
      ),
    [
      railSessionNameById,
      railSessions,
      visibleTeamControlSummary,
      visibleTeamWaitSummary,
    ],
  );
  const completedTeamSessions = useMemo(
    () =>
      railSessions.filter(
        (session) =>
          session.id !== currentSessionId && isCompletedTeamSession(session),
      ),
    [currentSessionId, railSessions],
  );
  const completedTeamSessionIds = useMemo(
    () => completedTeamSessions.map((session) => session.id),
    [completedTeamSessions],
  );
  const canCloseCompletedTeamSessions = Boolean(
    onCloseCompletedTeamSessions && completedTeamSessionIds.length > 0,
  );
  const canOpenSelectedSession = Boolean(
    selectedSession &&
      onOpenSubagentSession &&
      selectedSession.id !== currentSessionId,
  );
  const canWaitSelectedSession = Boolean(
    selectedSession && isWaitableTeamSession(selectedSession) && onWaitSubagentSession,
  );
  const canSendSelectedSessionInput = Boolean(
    selectedSession &&
      selectedSession.sessionType !== "user" &&
      selectedSession.runtimeStatus !== "closed" &&
      onSendSubagentInput &&
      selectedSession.id !== currentSessionId,
  );
  const canStopSelectedSession = Boolean(
    selectedSession &&
      selectedSession.sessionType !== "user" &&
      isTeamWorkspaceActiveStatus(
        selectedSession.runtimeStatus ?? selectedSession.latestTurnStatus,
      ) &&
      onCloseSubagentSession,
  );
  const canResumeSelectedSession = Boolean(
    selectedSession &&
      selectedSession.sessionType !== "user" &&
      selectedSession.runtimeStatus === "closed" &&
      onResumeSubagentSession,
  );
  const selectedActionPending = Boolean(
    selectedSession && pendingSessionAction?.sessionId === selectedSession.id,
  );
  const selectedSessionInputDraft = selectedSession
    ? sessionInputDraftById[selectedSession.id] ?? ""
    : "";
  const selectedSessionInputMessage = selectedSessionInputDraft.trim();
  const handleWaitAnyActiveTeamSessions = useCallback(async () => {
    if (!onWaitActiveTeamSessions || waitableTeamSessionIds.length <= 1) {
      return;
    }

    setPendingTeamAction("wait_any");
    try {
      await onWaitActiveTeamSessions(
        waitableTeamSessionIds,
        DEFAULT_WAIT_SELECTED_SUBAGENT_TIMEOUT_MS,
      );
    } finally {
      setPendingTeamAction(null);
    }
  }, [onWaitActiveTeamSessions, waitableTeamSessionIds]);
  const handleCloseCompletedTeamSessions = useCallback(async () => {
    if (!onCloseCompletedTeamSessions || completedTeamSessionIds.length === 0) {
      return;
    }

    setPendingTeamAction("close_completed");
    try {
      await onCloseCompletedTeamSessions(completedTeamSessionIds);
    } finally {
      setPendingTeamAction(null);
    }
  }, [completedTeamSessionIds, onCloseCompletedTeamSessions]);
  const handleSelectTeamOperationEntry = useCallback(
    (entry: TeamOperationDisplayEntry) => {
      if (!entry.targetSessionId) {
        return;
      }
      if (!railSessions.some((session) => session.id === entry.targetSessionId)) {
        return;
      }
      setSelectedSessionId(entry.targetSessionId);
      setExpandedSessionId(entry.targetSessionId);
    },
    [railSessions],
  );

  useEffect(() => {
    if (
      !visibleTeamWaitSummary?.resolvedSessionId ||
      visibleTeamWaitSummary.timedOut
    ) {
      return;
    }

    const waitFocusKey = [
      visibleTeamWaitSummary.updatedAt,
      visibleTeamWaitSummary.resolvedSessionId,
      visibleTeamWaitSummary.resolvedStatus ?? "idle",
    ].join(":");
    if (lastAutoFocusedTeamWaitKeyRef.current === waitFocusKey) {
      return;
    }

    if (
      railSessions.some(
        (session) => session.id === visibleTeamWaitSummary.resolvedSessionId,
      )
    ) {
      lastAutoFocusedTeamWaitKeyRef.current = waitFocusKey;
      setSelectedSessionId(visibleTeamWaitSummary.resolvedSessionId);
      setExpandedSessionId(visibleTeamWaitSummary.resolvedSessionId);
    }
  }, [railSessions, visibleTeamWaitSummary]);
  const handleSelectedSessionAction = useCallback(
    async (action: "close" | "resume" | "wait") => {
      if (!selectedSession) {
        return;
      }

      setPendingSessionAction({ sessionId: selectedSession.id, action });
      try {
        if (action === "close") {
          await onCloseSubagentSession?.(selectedSession.id);
          return;
        }
        if (action === "resume") {
          await onResumeSubagentSession?.(selectedSession.id);
          return;
        }
        await onWaitSubagentSession?.(
          selectedSession.id,
          DEFAULT_WAIT_SELECTED_SUBAGENT_TIMEOUT_MS,
        );
      } finally {
        setPendingSessionAction((current) =>
          current?.sessionId === selectedSession.id ? null : current,
        );
      }
    },
    [
      onCloseSubagentSession,
      onResumeSubagentSession,
      onWaitSubagentSession,
      selectedSession,
    ],
  );
  const handleSelectedSessionInputDraftChange = useCallback(
    (value: string) => {
      if (!selectedSession) {
        return;
      }

      setSessionInputDraftById((previous) => {
        if (previous[selectedSession.id] === value) {
          return previous;
        }
        return {
          ...previous,
          [selectedSession.id]: value,
        };
      });
    },
    [selectedSession],
  );
  const handleSelectedSessionSendInput = useCallback(
    async (interrupt: boolean) => {
      if (!selectedSession || !selectedSessionInputMessage) {
        return;
      }

      const action = interrupt ? "interrupt_send" : "send";
      const sessionId = selectedSession.id;
      setPendingSessionAction({ sessionId, action });
      try {
        await onSendSubagentInput?.(sessionId, selectedSessionInputMessage, {
          interrupt,
        });
        setSessionInputDraftById((previous) => {
          if (!previous[sessionId]) {
            return previous;
          }
          return {
            ...previous,
            [sessionId]: "",
          };
        });
      } finally {
        setPendingSessionAction((current) =>
          current?.sessionId === sessionId ? null : current,
        );
      }
    },
    [onSendSubagentInput, selectedSession, selectedSessionInputMessage],
  );
  const memberCanvasTitle = "协作进展画布";
  const memberCanvasSubtitle = hasRealTeamGraph
    ? isChildSession
      ? "当前协作成员会在各自面板里持续更新进展和结果，主对话只保留必要摘要。"
      : `${visibleSessions.length} 位协作成员已加入，每位成员都会在自己的面板里持续更新进展和结果。`
    : runtimeTeamState?.status === "forming"
      ? "正在准备当前协作分工，成员接入后会在这里独立更新进展。"
      : runtimeTeamState?.status === "formed"
        ? "当前协作分工已经就绪，成员接入后会在各自面板里开始处理。"
        : runtimeTeamState?.status === "failed"
          ? "这次协作准备失败，暂时无法生成成员面板。"
          : "成员加入后，这里会展开为独立的协作进展面板。";

  if (
    !subagentParentContext &&
    childSubagentSessions.length === 0 &&
    !shellVisible
  ) {
    return null;
  }

  if (isEmptyShellState && !shellExpanded) {
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
                {runtimeFormationMeta?.title || "协作面板已就绪"}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
                {runtimeFormationMeta?.label || "还没有协作成员加入"}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {hasRuntimeFormation
                ? buildRuntimeFormationHint(runtimeTeamState)
                : "这里先保持简洁，避免遮挡消息区；只有真正需要协作分工时才会展开完整面板。"}
            </p>
            {hasRuntimeFormation
              ? renderRuntimeFormationSummary()
              : renderSelectedTeamPlanSummary()}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShellExpanded(true)}
            data-testid="team-workspace-detail-toggle"
          >
            <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
            查看任务进展
          </Button>
        </div>
      </section>
    );
  }

  const selectedStatusMeta = resolveStatusMeta(selectedSession?.runtimeStatus);
  const detailVisible =
    isEmptyShellState || !hasRealTeamGraph ? detailExpanded || shellExpanded : false;
  const detailToggleLabel = detailVisible ? "收起细节" : "查看细节";
  const boardHeadline =
    !hasRealTeamGraph && runtimeFormationMeta
      ? runtimeFormationMeta.title
      : buildBoardHeadline({
          hasRealTeamGraph,
          isChildSession,
          subagentParentContext,
          totalTeamSessions,
        });
  const boardHint =
    !hasRealTeamGraph && hasRuntimeFormation
      ? buildRuntimeFormationHint(runtimeTeamState)
      : buildBoardHint({
          hasRealTeamGraph,
          isChildSession,
          siblingCount,
        });
  const detailSummary =
    selectedSession?.taskSummary ||
    buildFallbackSummary({
      hasRealTeamGraph,
      isChildSession,
      selectedSession,
    });
  const useCompactCanvasChrome = hasRealTeamGraph;
  const runtimeDetailSummary = buildRuntimeDetailSummary(selectedSession);
  const selectedPresetOption = getTeamPresetOption(selectedSession?.teamPresetId);
  const selectedSkills = selectedSession?.skills ?? [];
  const selectedMetadata = [
    selectedSession?.blueprintRoleLabel
      ? `分工 ${selectedSession.blueprintRoleLabel}`
      : null,
    selectedSession?.sessionType
      ? resolveSessionTypeLabel(selectedSession.sessionType)
      : null,
    selectedSession?.providerName
      ? `服务 ${selectedSession.providerName}`
      : null,
    selectedSession?.model ? `模型 ${selectedSession.model}` : null,
    selectedSession?.originTool ? `来源 ${selectedSession.originTool}` : null,
    selectedSession?.createdFromTurnId
      ? `来自之前的任务 ${selectedSession.createdFromTurnId}`
      : null,
    selectedSession && (selectedSession.teamQueuedCount ?? selectedSession.queuedTurnCount ?? 0) > 0
      ? `等待中 ${selectedSession.teamQueuedCount ?? selectedSession.queuedTurnCount}`
      : null,
    selectedSession?.teamActiveCount !== undefined &&
    selectedSession?.teamParallelBudget !== undefined
      ? `处理中 ${selectedSession.teamActiveCount}/${selectedSession.teamParallelBudget}`
      : null,
    selectedSession?.providerParallelBudget === 1 &&
    selectedSession?.providerConcurrencyGroup
      ? resolveTeamWorkspaceStableProcessingLabel()
      : null,
    selectedSession?.latestTurnStatus
      ? `最近进展 ${resolveStatusMeta(selectedSession.latestTurnStatus).label}`
      : null,
    isChildSession && subagentParentContext?.parent_session_name
      ? `来自 ${subagentParentContext.parent_session_name}`
      : null,
  ].filter(Boolean) as string[];
  const boardShellClassName = cn(
    embedded
      ? "pointer-events-auto flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-transparent shadow-none"
      : "overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_18px_64px_-42px_rgba(15,23,42,0.24)]",
    embedded ? "mx-0 mt-0" : "mx-3 mt-2",
    className,
  );
  const boardHeaderClassName = cn(
    "flex flex-wrap items-start justify-between gap-3",
    useCompactCanvasChrome ? "px-4 py-2.5 sm:px-4" : "px-4 py-3.5 sm:px-5",
    embedded
      ? cn(
          "sticky top-0 z-20 border-b border-slate-200",
          useCompactCanvasChrome ? "bg-white" : "bg-slate-50",
        )
      : cn(
          "border-b border-slate-200",
          useCompactCanvasChrome ? "bg-white" : "bg-slate-50",
        ),
  );
  const boardBodyClassName = embedded
    ? cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain",
        useCompactCanvasChrome ? "p-3 sm:p-3.5 space-y-2.5" : "p-3 sm:p-4 space-y-3",
      )
    : cn(useCompactCanvasChrome ? "p-3 sm:p-3.5" : "p-3 sm:p-4");
  const canvasStageHeight =
    embedded && !detailVisible
      ? "clamp(560px, 76vh, 980px)"
      : TEAM_WORKSPACE_CANVAS_STAGE_HEIGHT;
  const railCardClassName = embedded
    ? cn("pointer-events-auto", useCompactCanvasChrome ? "space-y-3" : "space-y-4")
    : "rounded-[22px] border border-slate-200 bg-slate-50 p-3.5 shadow-sm shadow-slate-950/5";
  const detailCardClassName = cn(
    embedded
      ? "rounded-[20px] border border-slate-200 bg-white p-4"
      : "rounded-[22px] border p-4 shadow-sm shadow-slate-950/5",
    !embedded &&
      (selectedSession
        ? selectedStatusMeta.cardClassName
        : "border-slate-200 bg-white"),
  );
  const inlineDetailSectionClassName =
    "mt-3 rounded-[18px] border border-slate-200 bg-slate-50 p-3";
  const inlineTimelineFeedClassName =
    "mt-3 rounded-[16px] border border-slate-200 bg-white p-3";
  const inlineTimelineEntryClassName =
    "rounded-[14px] border border-slate-200 bg-white p-3";
  const compactCanvasSummaryChipClassName =
    "rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500";
  const compactCanvasMutedChipClassName =
    "rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500";
  const compactCanvasFocusLabel = selectedSession
    ? `焦点 ${selectedSession.name}`
    : "等待成员接入";
  const compactBoardHeadline =
    useCompactCanvasChrome && !isChildSession && totalTeamSessions > 0
      ? `${totalTeamSessions} 位成员协作中`
      : boardHeadline;
  const renderSelectedSessionInlineDetail = () => {
    if (!selectedSession) {
      return null;
    }

    return (
      <div
        className="mt-3 border-t border-slate-200 pt-3"
        data-testid={`team-workspace-member-detail-${selectedSession.id}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              <Bot className="h-3.5 w-3.5" />
              <span>当前查看</span>
              {selectedSession.isCurrent ? (
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
                  当前对话
                </span>
              ) : null}
            </div>
            <p
              className="mt-2 text-sm leading-6 text-slate-600"
              data-testid="team-workspace-session-summary"
            >
              {detailSummary}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canResumeSelectedSession ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={selectedActionPending}
                onClick={() => void handleSelectedSessionAction("resume")}
              >
                {selectedActionPending &&
                pendingSessionAction?.action === "resume" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                {selectedActionPending &&
                pendingSessionAction?.action === "resume"
                  ? "继续中..."
                  : "继续处理"}
              </Button>
            ) : null}
            {canStopSelectedSession ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={selectedActionPending}
                onClick={() => void handleSelectedSessionAction("close")}
              >
                {selectedActionPending &&
                pendingSessionAction?.action === "close" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                {selectedActionPending &&
                pendingSessionAction?.action === "close"
                  ? "暂停中..."
                  : "暂停处理"}
              </Button>
            ) : null}
            {canOpenSelectedSession ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void onOpenSubagentSession?.(selectedSession.id)}
              >
                {isChildSession ? "切换会话" : "打开对话"}
              </Button>
            ) : null}
          </div>
        </div>

        {runtimeDetailSummary ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
              {runtimeDetailSummary}
            </span>
          </div>
        ) : null}
        {selectedSession?.queueReason ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
            {selectedSession.queueReason}
          </div>
        ) : null}

        {selectedSession?.profileName ||
        selectedSession?.teamPresetId ||
        selectedSession?.theme ||
        selectedSession?.outputContract ||
        selectedSkills.length > 0 ? (
          <div className={inlineDetailSectionClassName}>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <Bot className="h-3.5 w-3.5" />
              <span>协作设置</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {selectedPresetOption ? (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                  预设 {selectedPresetOption.label}
                </span>
              ) : selectedSession?.teamPresetId ? (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                  预设 {selectedSession.teamPresetId}
                </span>
              ) : null}
              {selectedSession?.profileName ? (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                  风格 {selectedSession.profileName}
                </span>
              ) : null}
              {resolveTeamWorkspaceRoleHintLabel(selectedSession?.roleKey) ? (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                  分工 {resolveTeamWorkspaceRoleHintLabel(selectedSession?.roleKey)}
                </span>
              ) : null}
              {selectedSession?.theme ? (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                  主题 {selectedSession.theme}
                </span>
              ) : null}
            </div>
            {selectedSession?.outputContract ? (
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {selectedSession.outputContract}
              </p>
            ) : null}
            {selectedSkills.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedSkills.map((skill) => (
                  <span
                    key={`${selectedSession.id}-${skill.id}`}
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600"
                    title={skill.description || skill.directory || undefined}
                  >
                    {buildSkillDisplayName(skill)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {canWaitSelectedSession || canSendSelectedSessionInput ? (
          <div className={inlineDetailSectionClassName}>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <Clock3 className="h-3.5 w-3.5" />
              <span>继续协作</span>
              {canWaitSelectedSession ? (
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
                  可直接查看结果
                </span>
              ) : null}
            </div>
            {canWaitSelectedSession ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={selectedActionPending}
                  onClick={() => void handleSelectedSessionAction("wait")}
                >
                  {selectedActionPending &&
                  pendingSessionAction?.action === "wait" ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {selectedActionPending &&
                  pendingSessionAction?.action === "wait"
                    ? "等待中..."
                    : "等待结果 30 秒"}
                </Button>
                <span className="text-xs leading-5 text-slate-500">
                  仅在当前内容确实依赖这位成员结果时使用。
                </span>
              </div>
            ) : null}
            {canSendSelectedSessionInput ? (
              <div className="mt-3 space-y-3">
                <Textarea
                  value={selectedSessionInputDraft}
                  onChange={(event) =>
                    handleSelectedSessionInputDraftChange(event.target.value)
                  }
                  placeholder="给这位协作成员补充说明、补充约束，或请它继续推进下一步。"
                  className="min-h-[96px] resize-y border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400"
                  data-testid="team-workspace-send-input-textarea"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={selectedActionPending || !selectedSessionInputMessage}
                    onClick={() => void handleSelectedSessionSendInput(false)}
                  >
                    {selectedActionPending &&
                    pendingSessionAction?.action === "send" ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    {selectedActionPending &&
                    pendingSessionAction?.action === "send"
                      ? "发送中..."
                      : "发送说明"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={selectedActionPending || !selectedSessionInputMessage}
                    onClick={() => void handleSelectedSessionSendInput(true)}
                  >
                    {selectedActionPending &&
                    pendingSessionAction?.action === "interrupt_send" ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    {selectedActionPending &&
                    pendingSessionAction?.action === "interrupt_send"
                      ? "中断中..."
                      : "立即插入说明"}
                  </Button>
                  <span className="text-xs leading-5 text-slate-500">
                    这条说明只会发送给当前成员，不影响其他协作成员。
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {selectedSessionSupportsActivityPreview ? (
          <div className={inlineDetailSectionClassName}>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <Activity className="h-3.5 w-3.5" />
              <span>完整进展</span>
              {selectedSessionActivityShouldPoll ? (
                <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-medium tracking-normal text-sky-700 normal-case">
                  处理中自动刷新
                </span>
              ) : null}
            </div>
            {selectedSessionActivityPreviewText ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                {selectedSessionActivityPreviewText}
              </p>
            ) : selectedSessionActivityPreview?.status === "error" ? (
              <p className="mt-2 text-sm leading-6 text-rose-600">
                最新进展暂不可用：
                {selectedSessionActivityPreview.errorMessage ?? "同步失败"}
              </p>
            ) : selectedSessionActivityPreview?.status === "ready" ? (
              <p className="mt-2 text-sm leading-6 text-slate-500">
                这位成员暂时还没有可展示的新进展。
              </p>
            ) : (
              <p className="mt-2 text-sm leading-6 text-slate-500">
                正在同步这位成员的最新进展...
              </p>
            )}

            {selectedSessionActivityEntries.length > 0 ? (
              <div
                className={inlineTimelineFeedClassName}
                data-testid="team-workspace-activity-feed"
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  <span>进展记录</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
                    {selectedSessionActivityEntries.length} 条
                  </span>
                </div>
                <div className="mt-3 space-y-2.5">
                  {selectedSessionActivityEntries.map((entry) => (
                    <div key={entry.id} className={inlineTimelineEntryClassName}>
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-semibold text-slate-800">
                          {entry.title}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 font-medium",
                            entry.badgeClassName,
                          )}
                        >
                          {entry.statusLabel}
                        </span>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                        {entry.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1">
            <Clock3 className="h-3.5 w-3.5" />
            更新于 {formatUpdatedAt(selectedSession.updatedAt)}
          </span>
          {selectedMetadata.map((meta) => (
            <span
              key={meta}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1"
            >
              {meta}
            </span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section
      className={boardShellClassName}
      data-testid={embedded ? "team-workspace-board-embedded-shell" : undefined}
      style={embedded ? { maxHeight: "inherit" } : undefined}
    >
      <div
        className={boardHeaderClassName}
        data-testid={embedded ? "team-workspace-board-header" : undefined}
      >
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
            <span
              className={cn(
                "font-semibold text-slate-900",
                useCompactCanvasChrome ? "text-sm" : "text-[15px]",
              )}
            >
              {compactBoardHeadline}
            </span>
            {subagentParentContext?.created_from_turn_id ? (
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500">
                来自之前的任务 {subagentParentContext.created_from_turn_id}
              </span>
            ) : null}
            {!useCompactCanvasChrome && !isChildSession && totalTeamSessions > 0 ? (
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] text-sky-700">
                {totalTeamSessions} 位协作成员
              </span>
            ) : null}
          </div>
          {!useCompactCanvasChrome ? (
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {boardHint}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isEmptyShellState ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setShellExpanded((previous) => !previous);
              }}
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
          {isEmptyShellState
            ? (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500">
                  {runtimeFormationMeta?.label || "还没有协作成员加入"}
                </span>
              )
            : !useCompactCanvasChrome
              ? Object.entries(statusSummary)
                  .filter(([, count]) => count > 0)
                  .map(([status, count]) => {
                    const meta = resolveStatusMeta(status as RuntimeStatus);
                    return (
                      <span
                        key={status}
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium",
                          meta.badgeClassName,
                        )}
                      >
                        {meta.label} {count}
                      </span>
                    );
                  })
              : null}
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

      <div
        className={boardBodyClassName}
        data-testid={embedded ? "team-workspace-board-body" : undefined}
      >
        <div className={railCardClassName}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {useCompactCanvasChrome ? (
              <>
                <div
                  className="flex flex-wrap items-center gap-2"
                  data-testid="team-workspace-canvas-toolbar"
                >
                  <span className={compactCanvasSummaryChipClassName}>
                    {compactCanvasFocusLabel}
                  </span>
                  {selectedSession ? (
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium",
                        selectedStatusMeta.badgeClassName,
                      )}
                    >
                      {selectedStatusMeta.label}
                    </span>
                  ) : null}
                  {selectedSession ? (
                    <span className={compactCanvasMutedChipClassName}>
                      更新于 {formatUpdatedAt(selectedSession.updatedAt)}
                    </span>
                  ) : null}
                  {selectedSession?.isCurrent ? (
                    <span className={compactCanvasMutedChipClassName}>
                      当前对话
                    </span>
                  ) : null}
                  <span className={compactCanvasMutedChipClassName}>
                    缩放 {Math.round(canvasLayoutState.viewport.zoom * 100)}%
                  </span>
                  {canWaitAnyActiveTeamSession ? (
                    <span className={compactCanvasMutedChipClassName}>
                      {waitableTeamSessionIds.length} 位处理中
                    </span>
                  ) : null}
                  {canCloseCompletedTeamSessions ? (
                    <span className={compactCanvasMutedChipClassName}>
                      {completedTeamSessionIds.length} 位已完成
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canWaitAnyActiveTeamSession ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pendingTeamAction === "wait_any"}
                      onClick={() => void handleWaitAnyActiveTeamSessions()}
                      data-testid="team-workspace-wait-active-button"
                    >
                      {pendingTeamAction === "wait_any" ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      {pendingTeamAction === "wait_any"
                        ? "等待中..."
                        : "等待任一成员结果"}
                    </Button>
                  ) : null}
                  {canCloseCompletedTeamSessions ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pendingTeamAction === "close_completed"}
                      onClick={() => void handleCloseCompletedTeamSessions()}
                      data-testid="team-workspace-close-completed-button"
                    >
                      {pendingTeamAction === "close_completed" ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      {pendingTeamAction === "close_completed"
                        ? "收起中..."
                        : "收起已完成成员"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleAutoArrangeCanvas}
                    data-testid="team-workspace-auto-arrange-button"
                  >
                    整理布局
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleZoomOut}
                  >
                    缩小
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleZoomIn}
                  >
                    放大
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleFitCanvasView}
                  >
                    适应视图
                  </Button>
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
              {canWaitAnyActiveTeamSession ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pendingTeamAction === "wait_any"}
                  onClick={() => void handleWaitAnyActiveTeamSessions()}
                  data-testid="team-workspace-wait-active-button"
                >
                  {pendingTeamAction === "wait_any" ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                    {pendingTeamAction === "wait_any"
                      ? "等待中..."
                      : "等待任一成员结果"}
                </Button>
              ) : null}
              {canWaitAnyActiveTeamSession ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
                  {waitableTeamSessionIds.length} 位成员正在处理中
                </span>
              ) : null}
              {canCloseCompletedTeamSessions ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pendingTeamAction === "close_completed"}
                  onClick={() => void handleCloseCompletedTeamSessions()}
                  data-testid="team-workspace-close-completed-button"
                >
                  {pendingTeamAction === "close_completed" ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                    {pendingTeamAction === "close_completed"
                      ? "收起中..."
                      : "收起已完成成员"}
                </Button>
              ) : null}
              {canCloseCompletedTeamSessions ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
                  {completedTeamSessionIds.length} 位成员已完成
                </span>
              ) : null}
            </div>
          ) : null}
          {teamOperationEntries.length > 0 ? (
            useCompactCanvasChrome ? (
              <div
                className="mt-2 flex items-start gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                data-testid="team-workspace-team-operations"
              >
                <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-500 shadow-sm shadow-slate-950/5">
                  <Activity className="h-3.5 w-3.5" />
                  <span>协作动态</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
                    {teamOperationEntries.length}
                  </span>
                </div>
                {teamOperationEntries.map((entry) => {
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
                      onClick={() => handleSelectTeamOperationEntry(entry)}
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
            ) : (
              <div
                className={cn(
                  embedded
                    ? "mt-3 border-t border-slate-200 pt-3"
                    : "mt-3 rounded-[18px] border border-slate-200 bg-white p-3",
                )}
                data-testid="team-workspace-team-operations"
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <Activity className="h-3.5 w-3.5" />
                  <span>协作动态</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
                    最近 {teamOperationEntries.length} 条
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {teamOperationEntries.map((entry) => {
                    const content = (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            entry.badgeClassName,
                          )}>
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
                          embedded
                            ? "border-l-2 border-slate-200 px-3 py-2 hover:border-slate-300 hover:bg-slate-50"
                            : "rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5 hover:border-slate-300 hover:bg-slate-50",
                        )}
                        onClick={() => handleSelectTeamOperationEntry(entry)}
                      >
                        {content}
                      </button>
                    ) : (
                      <div
                        key={entry.id}
                        className={cn(
                          embedded
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
            )
          ) : null}

          <div className={cn("mt-3", useCompactCanvasChrome ? "space-y-2.5" : "space-y-3")}>
            {!useCompactCanvasChrome ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                    自由画布
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                    缩放 {Math.round(canvasLayoutState.viewport.zoom * 100)}%
                  </span>
                  {canvasLanes.length > 0 ? (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                      {canvasLanes.length} 个成员面板
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleAutoArrangeCanvas}
                    data-testid="team-workspace-auto-arrange-button"
                  >
                    整理布局
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleZoomOut}
                  >
                    缩小
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleZoomIn}
                  >
                    放大
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleResetCanvasView}
                  >
                    100%
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleFitCanvasView}
                  >
                    适应视图
                  </Button>
                </div>
              </div>
            ) : null}
            <div
              ref={canvasViewportRef}
              className={cn(
                "relative overflow-hidden rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] shadow-sm shadow-slate-950/5 cursor-grab active:cursor-grabbing",
                isCanvasPanModifierActive && "cursor-grabbing",
              )}
              data-testid="team-workspace-rail-list"
              data-layout-kind="free-canvas"
              data-viewport-x={Math.round(canvasLayoutState.viewport.x)}
              data-viewport-y={Math.round(canvasLayoutState.viewport.y)}
              data-viewport-zoom={canvasLayoutState.viewport.zoom.toFixed(2)}
              data-pan-mode={isCanvasPanModifierActive ? "active" : "idle"}
              style={{ height: canvasStageHeight }}
              onMouseDown={handleStartCanvasPan}
              onWheel={handleCanvasWheel}
            >
              <div
                data-testid="team-workspace-canvas-pan-surface"
                data-team-workspace-canvas-pan-surface="true"
                className="absolute inset-0 opacity-60"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.08) 1px, transparent 1px)",
                  backgroundSize: "32px 32px",
                }}
              />
              <div
                data-team-workspace-canvas-pan-block="true"
                className="absolute left-4 top-4 z-10 inline-flex max-w-[320px] items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] text-slate-500 shadow-sm shadow-slate-950/5"
                data-testid="team-workspace-canvas-shortcuts"
              >
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-slate-500">
                  画布
                </span>
                <span className="truncate">空白处拖拽 · Space 手型 · A 整理 · F 适应</span>
              </div>
              {canvasLanes.length > 0 ? (
                <div
                  data-team-workspace-canvas-pan-surface="true"
                  className="absolute inset-0 overflow-hidden"
                  data-testid="team-workspace-canvas-stage"
                >
                  <div
                    data-team-workspace-canvas-pan-surface="true"
                    className="absolute left-0 top-0"
                    style={{
                      transform: `translate(${canvasLayoutState.viewport.x}px, ${canvasLayoutState.viewport.y}px)`,
                    }}
                  >
                    <div
                      data-team-workspace-canvas-pan-surface="true"
                      className="relative"
                      style={{
                        width: `${canvasBounds.width}px`,
                        height: `${canvasBounds.height}px`,
                        transform: `scale(${canvasLayoutState.viewport.zoom})`,
                        transformOrigin: "top left",
                      }}
                    >
                      {canvasLanes.map((lane) => {
                        const layout = canvasLaneLayouts[lane.persistKey];
                        const selected =
                          lane.session?.id != null &&
                          selectedSession?.id === lane.session.id;
                        const expanded =
                          selected &&
                          lane.session?.id != null &&
                          expandedSessionId === lane.session.id;
                        const resizeHandles = [
                          {
                            direction: "n" as const,
                            className:
                              "left-1/2 top-0 h-3 w-14 -translate-x-1/2 -translate-y-1/2 cursor-n-resize",
                          },
                          {
                            direction: "s" as const,
                            className:
                              "bottom-0 left-1/2 h-3 w-14 -translate-x-1/2 translate-y-1/2 cursor-s-resize",
                          },
                          {
                            direction: "e" as const,
                            className:
                              "right-0 top-1/2 h-14 w-3 -translate-y-1/2 translate-x-1/2 cursor-e-resize",
                          },
                          {
                            direction: "w" as const,
                            className:
                              "left-0 top-1/2 h-14 w-3 -translate-x-1/2 -translate-y-1/2 cursor-w-resize",
                          },
                          {
                            direction: "ne" as const,
                            className:
                              "right-0 top-0 h-4 w-4 translate-x-1/2 -translate-y-1/2 cursor-ne-resize",
                          },
                          {
                            direction: "nw" as const,
                            className:
                              "left-0 top-0 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-nw-resize",
                          },
                          {
                            direction: "se" as const,
                            className:
                              "bottom-0 right-0 h-4 w-4 translate-x-1/2 translate-y-1/2 cursor-se-resize",
                          },
                          {
                            direction: "sw" as const,
                            className:
                              "bottom-0 left-0 h-4 w-4 -translate-x-1/2 translate-y-1/2 cursor-sw-resize",
                          },
                        ];

                        return (
                          <div
                            key={lane.persistKey}
                            data-team-workspace-canvas-pan-block="true"
                            data-testid={`team-workspace-member-lane-${lane.id}`}
                            data-lane-x={Math.round(layout.x)}
                            data-lane-y={Math.round(layout.y)}
                            data-lane-width={Math.round(layout.width)}
                            data-lane-height={Math.round(layout.height)}
                            data-expanded={expanded ? "true" : "false"}
                            className="absolute"
                            onClick={() => {
                              bringCanvasLaneToFront(lane.persistKey);
                              if (lane.session) {
                                setSelectedSessionId(lane.session.id);
                                setExpandedSessionId(lane.session.id);
                              }
                            }}
                            style={{
                              transform: `translate(${layout.x}px, ${layout.y}px)`,
                              width: `${layout.width}px`,
                              height: `${layout.height}px`,
                              zIndex: layout.zIndex,
                            }}
                          >
                            <div
                              role={lane.session ? "button" : undefined}
                              aria-pressed={lane.session ? selected : undefined}
                              tabIndex={lane.session ? 0 : -1}
                              onClick={() => {
                                bringCanvasLaneToFront(lane.persistKey);
                                if (lane.session) {
                                  setSelectedSessionId(lane.session.id);
                                  setExpandedSessionId(lane.session.id);
                                }
                              }}
                              className={cn(
                                "group flex h-full flex-col overflow-hidden rounded-[24px] border bg-white text-left shadow-[0_18px_52px_-32px_rgba(15,23,42,0.28)] transition",
                                lane.kind === "planned"
                                  ? "border-dashed border-slate-300"
                                  : lane.kind === "runtime"
                                    ? "border-sky-200"
                                    : "border-slate-200",
                                selected
                                  ? "ring-2 ring-slate-300"
                                  : "hover:border-slate-300",
                              )}
                            >
                              <div
                                data-testid={`team-workspace-member-lane-header-${lane.id}`}
                                className="flex cursor-grab items-start justify-between gap-3 border-b border-slate-200 bg-slate-50/88 px-4 py-3 active:cursor-grabbing"
                                onMouseDown={(event) =>
                                  handleStartCanvasLaneDrag(lane.persistKey, event)
                                }
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="truncate text-sm font-semibold text-slate-900">
                                      {lane.title}
                                    </span>
                                    {lane.session?.isCurrent ? (
                                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                        当前
                                      </span>
                                    ) : null}
                                    {expanded ? (
                                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700">
                                        当前查看
                                      </span>
                                    ) : null}
                                    {lane.kind === "runtime" ? (
                                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                                        当前分工
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                                    {lane.roleLabel ? (
                                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">
                                        分工 · {lane.roleLabel}
                                      </span>
                                    ) : null}
                                    {lane.profileLabel ? (
                                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                                        {lane.profileLabel}
                                      </span>
                                    ) : null}
                                    <span
                                      className={cn(
                                        "rounded-full px-2 py-0.5 font-medium",
                                        lane.badgeClassName,
                                      )}
                                    >
                                      {lane.badgeLabel}
                                    </span>
                                  </div>
                                </div>
                                <span
                                  className={cn(
                                    "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                                    lane.dotClassName,
                                  )}
                                />
                              </div>
                              <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
                                <p className="text-sm leading-6 text-slate-600">
                                  {lane.summary}
                                </p>
                                {(lane.skillLabels.length > 0 || lane.presetLabel) ? (
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                                    {lane.presetLabel ? (
                                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                                        {lane.presetLabel}
                                      </span>
                                    ) : null}
                                    {lane.skillLabels.slice(0, 4).map((skillLabel) => (
                                      <span
                                        key={`${lane.persistKey}-${skillLabel}`}
                                        className="rounded-full border border-slate-200 bg-white px-2 py-0.5"
                                      >
                                        {skillLabel}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                                <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                                  <div className="flex items-center gap-1.5 border-b border-slate-200 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                                    <PanelTop className="h-3 w-3" />
                                    <span>成员进展</span>
                                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
                                      {lane.kind === "session" ? "最近进展" : "等待接入"}
                                    </span>
                                  </div>
                                  <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
                                    <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-700">
                                      {lane.previewText}
                                    </p>
                                    {lane.previewEntries && lane.previewEntries.length > 0 ? (
                                      <div className="mt-3 space-y-2">
                                        {lane.previewEntries.map((entry) => (
                                          <div
                                            key={`${lane.persistKey}-${entry.id}`}
                                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5"
                                          >
                                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                              <span className="font-semibold text-slate-800">
                                                {entry.title}
                                              </span>
                                              <span
                                                className={cn(
                                                  "rounded-full px-2 py-0.5 font-medium",
                                                  entry.badgeClassName,
                                                )}
                                              >
                                                {entry.statusLabel}
                                              </span>
                                            </div>
                                            <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">
                                              {entry.detail}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {lane.statusHint ? (
                                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                                        {lane.statusHint}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {lane.updatedAtLabel ? (
                                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                                        {lane.updatedAtLabel}
                                      </span>
                                    ) : null}
                                    {lane.modelLabel ? (
                                      <span className="max-w-[180px] truncate rounded-full border border-slate-200 bg-white px-2 py-0.5">
                                        {lane.modelLabel}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                {expanded ? renderSelectedSessionInlineDetail() : null}
                              </div>
                            </div>
                            {resizeHandles.map((handle) => (
                              <span
                                key={`${lane.persistKey}-${handle.direction}`}
                                data-testid={`team-workspace-member-lane-resize-${lane.id}-${handle.direction}`}
                                aria-hidden="true"
                                className={cn(
                                  "absolute rounded-full border border-slate-300 bg-white shadow-sm",
                                  handle.className,
                                )}
                                onMouseDown={(event) =>
                                  handleStartCanvasLaneResize(
                                    lane.persistKey,
                                    handle.direction,
                                    event,
                                  )
                                }
                              />
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center p-8">
                  <div className="max-w-[520px] rounded-[24px] border border-dashed border-slate-300 bg-white/92 px-6 py-5 text-center shadow-sm shadow-slate-950/5">
                    <div className="text-sm font-semibold text-slate-900">
                      暂无协作画布
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {canvasStageHint}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {!hasRealTeamGraph ? (
            <>
              {hasRuntimeFormation ? (
                <>
                  {renderRuntimeFormationPanel()}
                  {renderRuntimeMemberPanel()}
                </>
              ) : (
                renderSelectedTeamPlanPanel()
              )}
              <div className="mt-4 rounded-[20px] border border-dashed border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-500">
                {runtimeTeamState?.status === "forming" ? (
                  "系统正在准备当前协作分工，完成后会先展示成员卡片，后续再切换为独立的实时进展面板。"
                ) : runtimeTeamState?.status === "formed" ? (
                  <>
                    当前协作方案已就绪。系统开始分工后，这里会从方案视图过渡到实时协作画布。
                  </>
                ) : runtimeTeamState?.status === "failed" ? (
                  runtimeTeamState.errorMessage?.trim() ||
                  "当前协作准备失败，暂时还没有协作成员加入。"
                ) : (
                  <>
                    还没有协作成员加入。系统开始分工后，这里会生成独立的成员进展画布。
                  </>
                )}
              </div>
            </>
          ) : null}

          {!hasRealTeamGraph && detailVisible ? (
            <div
              className={cn("mt-3", detailCardClassName)}
              data-testid="team-workspace-detail-section"
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <Bot className="h-3.5 w-3.5" />
                <span>当前详情</span>
              </div>
              <div className="mt-2 text-base font-semibold text-slate-900">
                {runtimeFormationMeta?.title || "等待协作成员加入"}
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {buildRuntimeFormationEmptyDetail(runtimeTeamState)}
              </p>
              {hasRuntimeFormation ? (
                <div className="mt-4 space-y-4">
                  {renderRuntimeFormationPanel()}
                  {renderRuntimeMemberPanel()}
                  {runtimeBlueprintRoles.length > 0 ? (
                    <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        参考分工
                      </div>
                      <div className="mt-3 grid gap-3 xl:grid-cols-2">
                        {runtimeBlueprintRoles.map((role) => (
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
                </div>
              ) : hasSelectedTeamPlan ? (
                <div className="mt-4">{renderSelectedTeamPlanPanel()}</div>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                  推荐流程：邀请协作成员 → 查看结果 → 补充说明
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
