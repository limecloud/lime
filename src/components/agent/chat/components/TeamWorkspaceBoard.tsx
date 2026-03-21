import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getAgentRuntimeSession } from "@/lib/api/agentRuntime";
import type { AgentThreadItem } from "@/lib/api/agentStream";
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
  type TeamWorkspaceLiveRuntimeState,
  type TeamWorkspaceRuntimeFormationState,
  type TeamWorkspaceWaitSummary,
} from "../teamWorkspaceRuntime";

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
  runtimeTeamState?: TeamWorkspaceRuntimeFormationState | null;
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
const CARD_ACTIVITY_PREVIEW_MAX_LENGTH = 110;
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
    label: "待开始",
    badgeClassName: "border border-slate-200 bg-white text-slate-600",
    cardClassName: "border-slate-200 bg-white",
    dotClassName: "bg-slate-300",
  },
  queued: {
    label: "排队中",
    badgeClassName: "border border-amber-200 bg-amber-50 text-amber-700",
    cardClassName: "border-amber-200 bg-white",
    dotClassName: "bg-amber-400",
  },
  running: {
    label: "运行中",
    badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
    cardClassName: "border-sky-200 bg-white",
    dotClassName: "bg-sky-500",
  },
  completed: {
    label: "已完成",
    badgeClassName: "border border-emerald-200 bg-emerald-50 text-emerald-700",
    cardClassName: "border-emerald-200 bg-white",
    dotClassName: "bg-emerald-500",
  },
  failed: {
    label: "失败",
    badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
    cardClassName: "border-rose-200 bg-white",
    dotClassName: "bg-rose-500",
  },
  aborted: {
    label: "已中止",
    badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
    cardClassName: "border-rose-200 bg-white",
    dotClassName: "bg-rose-500",
  },
  closed: {
    label: "已停止",
    badgeClassName: "border border-slate-200 bg-slate-100 text-slate-600",
    cardClassName: "border-slate-200 bg-slate-50",
    dotClassName: "bg-slate-400",
  },
};

function resolveStatusMeta(status?: RuntimeStatus) {
  return STATUS_META[status ?? "idle"];
}

function resolveSessionTypeLabel(value?: string) {
  switch (value) {
    case "sub_agent":
      return "协作成员";
    case "fork":
      return "分支会话";
    case "user":
    default:
      return value?.trim() || "会话";
  }
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
  const sourcePrefix =
    skill.source === "local" ? "Skill" : skill.source === "builtin" ? "Builtin" : null;
  return sourcePrefix ? `${sourcePrefix} · ${skill.name}` : skill.name;
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
      const title = content.error ? "错误" : content.output ? "输出" : "回复";
      const detailText = normalizeActivityPreviewText(
        content.error || content.output || content.text,
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

function buildCardActivityPreview(preview?: string | null): string | null {
  if (!preview) {
    return null;
  }

  if (preview.length <= CARD_ACTIVITY_PREVIEW_MAX_LENGTH) {
    return preview;
  }

  return `${preview.slice(0, CARD_ACTIVITY_PREVIEW_MAX_LENGTH).trimEnd()}...`;
}

function buildRuntimeDetailSummary(session?: TeamSessionCard | null): string | null {
  if (!session) {
    return null;
  }

  const parts: string[] = [];
  if ((session.queuedTurnCount ?? 0) > 0) {
    parts.push(`队列 ${session.queuedTurnCount}`);
  }
  if (session.latestTurnStatus) {
    parts.push(`最近 turn ${resolveStatusMeta(session.latestTurnStatus).label}`);
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
      text: `最近一次统一等待已超时，${summary.awaitedSessionIds.length} 位活跃成员仍在推进。`,
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
    text: `最近一次统一等待命中 ${resolvedName}，已进入${resolveTeamWorkspaceRuntimeStatusLabel(summary.resolvedStatus)}状态。`,
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
            ? `最近一次恢复操作已级联恢复 ${affectedCount} 位成员。`
            : `最近一次恢复操作已恢复 ${firstAffectedName}。`,
        badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
      };
    case "close_completed":
      return {
        text: `最近一次批量清理已关闭 ${affectedCount} 位成员。`,
        badgeClassName: "border border-slate-200 bg-slate-100 text-slate-700",
      };
    case "close":
    default:
      return {
        text:
          affectedCount > 1
            ? `最近一次停止操作已级联停止 ${affectedCount} 位成员。`
            : `最近一次停止操作已停止 ${firstAffectedName}。`,
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
      title: params.teamWaitSummary.timedOut ? "等待超时" : "等待命中",
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
          return "级联恢复";
        case "close_completed":
          return "批量关闭";
        case "close":
        default:
          return "级联停止";
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
    name: currentSessionName?.trim() || "主会话编排器",
    runtimeStatus: currentSessionRuntimeStatus,
    taskSummary:
      "当前主会话负责拆分任务、启动成员协作、等待结果并在同一团队面板中汇总结论。",
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
    return subagentParentContext?.parent_session_name?.trim() || "父会话团队";
  }
  if (!hasRealTeamGraph) {
    return "等待团队成员加入";
  }
  return totalTeamSessions > 0 ? `团队中有 ${totalTeamSessions} 位成员` : "团队协作";
}

function buildBoardHint(params: {
  hasRealTeamGraph: boolean;
  isChildSession: boolean;
  siblingCount: number;
}) {
  const { hasRealTeamGraph, isChildSession, siblingCount } = params;

  if (isChildSession) {
    return siblingCount > 0 ? `当前与 ${siblingCount} 位同组成员协作` : "当前为唯一成员";
  }
  if (!hasRealTeamGraph) {
    return "只有出现真实团队成员时才会展开团队视图";
  }
  return "仅在任务需要拆分时进入 team，不默认使用多代理";
}

function buildFallbackSummary(params: {
  hasRealTeamGraph: boolean;
  isChildSession: boolean;
  selectedSession?: TeamSessionCard | null;
}) {
  const { hasRealTeamGraph, isChildSession, selectedSession } = params;

  if (!hasRealTeamGraph) {
    return "尚未出现真实团队成员。开始分派成员后，这里会展示团队成员与最新状态。";
  }
  if (selectedSession?.sessionType === "user") {
    return "主会话负责拆分任务、分派团队成员，并在必要时等待结果后汇总。";
  }
  if (isChildSession) {
    return "当前成员正在执行主会话分派的子任务，可在这里快速切换到同组成员或返回主会话。";
  }
  return "选择一位团队成员后，这里会展示它的任务摘要、运行状态与模型信息。";
}

function buildRuntimeFormationHint(
  runtimeTeamState?: TeamWorkspaceRuntimeFormationState | null,
) {
  switch (runtimeTeamState?.status) {
    case "forming":
      return "先准备本轮 Team，再等待真实团队成员接入实时轨道。";
    case "formed":
      return "本轮 Team 已就绪，真实团队成员加入后会自动接管实时协作。";
    case "failed":
      return "Team 准备失败，但主会话仍可继续执行或稍后重试。";
    default:
      return "只有出现真实团队成员时才会展开团队视图";
  }
}

function buildRuntimeFormationEmptyDetail(
  runtimeTeamState?: TeamWorkspaceRuntimeFormationState | null,
) {
  switch (runtimeTeamState?.status) {
    case "forming":
      return "当前正在根据本轮任务准备 Team。完成后，这里会先展示本轮成员卡片，随后等待真实团队成员接入。";
    case "formed":
      return "本轮 Team 已就绪。当前画布先展示本轮成员蓝图，待系统真正分派成员并开始协作后，会自动切换到真实协作轨道。";
    case "failed":
      return (
        runtimeTeamState.errorMessage?.trim() ||
        "本轮 Team 准备失败，暂时无法展示本轮成员。"
      );
    default:
      return "当前还没有真实团队成员。系统开始分派成员后，详情区会切换为选中成员的摘要视图。";
  }
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
  runtimeTeamState = null,
}: TeamWorkspaceBoardProps) {
  const isChildSession = Boolean(subagentParentContext);
  const [shellExpanded, setShellExpanded] = useState(defaultShellExpanded);
  const [detailExpanded, setDetailExpanded] = useState(true);
  const [pendingSessionAction, setPendingSessionAction] = useState<{
    sessionId: string;
    action: "close" | "resume" | "wait" | "send" | "interrupt_send";
  } | null>(null);
  const [pendingTeamAction, setPendingTeamAction] = useState<
    "wait_any" | "close_completed" | null
  >(null);
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

  useEffect(() => {
    sessionActivityPreviewByIdRef.current = sessionActivityPreviewById;
  }, [sessionActivityPreviewById]);

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
  const runtimeMembers = runtimeTeamState?.members ?? [];
  const runtimeBlueprintRoles = runtimeTeamState?.blueprint?.roles ?? [];
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
            Team · {normalizedSelectedTeamLabel}
          </span>
        ) : null}
        {normalizedSelectedTeamRoles.length > 0 ? (
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
            {normalizedSelectedTeamRoles.length} 个计划角色
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
          <span>计划中的 Team 角色</span>
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
                  {role.roleKey ? (
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                      Role · {role.roleKey}
                    </span>
                  ) : null}
                  {role.profileId ? (
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                      Profile · {role.profileId}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {role.summary}
                </p>
                {role.skillIds?.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {role.skillIds.map((skillId) => (
                      <span
                        key={`${role.id}-${skillId}`}
                        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500"
                      >
                        Skill · {skillId}
                      </span>
                    ))}
                  </div>
                ) : null}
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
            Team · {runtimeFormationLabel}
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
            {runtimeMembers.length} 个当前成员
          </span>
        ) : null}
        {runtimeTeamState?.blueprint?.label ? (
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
            参考蓝图 · {runtimeTeamState.blueprint.label}
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
          <span>本轮编队</span>
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
              "本轮 Team 准备失败，暂时无法展示更多内容。"
            : runtimeFormationSummary ||
              "这里展示本轮 Team 规划结果，真实成员加入后会接管实时协作视图。"}
        </p>
        {runtimeTeamState.blueprint?.label ? (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
            参考蓝图 Team：{runtimeTeamState.blueprint.label}
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
                {member.roleKey ? (
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                    Role · {member.roleKey}
                  </span>
                ) : null}
                {member.profileId ? (
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                    Profile · {member.profileId}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {member.summary}
              </p>
              {member.skillIds.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {member.skillIds.map((skillId) => (
                    <span
                      key={`${member.id}-${skillId}`}
                      className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500"
                    >
                      Skill · {skillId}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

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

  useEffect(() => {
    const defaultSelectedId = isChildSession
      ? currentSessionId ?? railSessions[0]?.id ?? null
      : visibleSessions[0]?.id ?? railSessions[0]?.id ?? null;

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
      visibleSessions.length > 0
    ) {
      setSelectedSessionId(visibleSessions[0]?.id ?? defaultSelectedId);
    }
  }, [
    currentSessionId,
    isChildSession,
    orchestratorSession?.id,
    railSessions,
    selectedSessionId,
    visibleSessions,
  ]);

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
      setDetailExpanded(true);
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
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <Workflow className="h-3.5 w-3.5" />
              <span>Team Workspace</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-emerald-700 normal-case">
                <Activity className="h-3 w-3" />
                实时订阅
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">
                {runtimeFormationMeta?.title || "Team 运行时已就绪"}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
                {runtimeFormationMeta?.label || "尚未出现真实团队成员"}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {hasRuntimeFormation
                ? buildRuntimeFormationHint(runtimeTeamState)
                : "这里先保持轻量状态条，避免遮挡消息区。只有真正出现团队成员后，团队面板才需要展开。"}
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
          >
            <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
            查看详情
          </Button>
        </div>
      </section>
    );
  }

  const selectedStatusMeta = resolveStatusMeta(selectedSession?.runtimeStatus);
  const detailVisible = isEmptyShellState ? shellExpanded : detailExpanded;
  const detailToggleLabel = isEmptyShellState
    ? detailVisible
      ? "收起面板"
      : "展开详情"
    : detailVisible
      ? "收起详情"
      : "展开详情";
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
  const runtimeDetailSummary = buildRuntimeDetailSummary(selectedSession);
  const selectedPresetOption = getTeamPresetOption(selectedSession?.teamPresetId);
  const selectedSkills = selectedSession?.skills ?? [];
  const selectedMetadata = [
    selectedSession?.sessionType
      ? resolveSessionTypeLabel(selectedSession.sessionType)
      : null,
    selectedSession?.providerName
      ? `Provider ${selectedSession.providerName}`
      : null,
    selectedSession?.model ? `模型 ${selectedSession.model}` : null,
    selectedSession?.originTool ? `来源 ${selectedSession.originTool}` : null,
    selectedSession?.createdFromTurnId
      ? `turn ${selectedSession.createdFromTurnId}`
      : null,
    selectedSession && (selectedSession.queuedTurnCount ?? 0) > 0
      ? `队列 ${selectedSession.queuedTurnCount}`
      : null,
    selectedSession?.latestTurnStatus
      ? `最近 turn ${resolveStatusMeta(selectedSession.latestTurnStatus).label}`
      : null,
    isChildSession && subagentParentContext?.parent_session_name
      ? `父会话 ${subagentParentContext.parent_session_name}`
      : null,
  ].filter(Boolean) as string[];
  const stackedRail = embedded;
  const boardShellClassName = cn(
    embedded
      ? "pointer-events-auto flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_18px_64px_-36px_rgba(15,23,42,0.18)]"
      : "overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_18px_64px_-42px_rgba(15,23,42,0.24)]",
    embedded ? "mx-0 mt-0" : "mx-3 mt-2",
    className,
  );
  const boardHeaderClassName = cn(
    "flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5",
    embedded
      ? "sticky top-0 z-20 border-b border-slate-200 bg-slate-50"
      : "border-b border-slate-200 bg-slate-50",
  );
  const boardBodyClassName = embedded
    ? "min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4 space-y-3"
    : "p-3 sm:p-4";
  const railCardClassName = embedded
    ? "pointer-events-auto space-y-4"
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
  const secondarySectionClassName = embedded
    ? "mt-4 border-t border-slate-200 pt-4"
    : "mt-4 rounded-[18px] border border-slate-200 bg-white p-3.5";
  const timelineFeedClassName = embedded
    ? "mt-3 border-t border-slate-200 pt-3"
    : "mt-3 rounded-[16px] border border-slate-200 bg-slate-50 p-3";
  const timelineEntryClassName = embedded
    ? "border-l-2 border-slate-200 pl-3"
    : "rounded-[14px] border border-slate-200 bg-white p-3";
  const railTitle = isChildSession ? "同组成员轨道" : "团队成员轨道";
  const railSubtitle = isChildSession
    ? siblingCount > 0
      ? `当前成员与 ${siblingCount} 位同组成员协作`
      : "当前只有一位成员"
    : hasRealTeamGraph
      ? `${visibleSessions.length} 位成员已加入`
      : runtimeTeamState?.status === "forming"
        ? "正在准备本轮成员"
        : runtimeTeamState?.status === "formed"
          ? `${runtimeMembers.length} 个成员待启动`
          : runtimeTeamState?.status === "failed"
            ? "Team 准备失败"
            : "等待成员加入";

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
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <Workflow className="h-3.5 w-3.5" />
            <span>Team Workspace</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-emerald-700 normal-case">
              <Activity className="h-3 w-3" />
              实时订阅
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-slate-900">
              {boardHeadline}
            </span>
            {subagentParentContext?.created_from_turn_id ? (
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500">
                来源 turn {subagentParentContext.created_from_turn_id}
              </span>
            ) : null}
            {!isChildSession && totalTeamSessions > 0 ? (
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] text-sky-700">
                {totalTeamSessions} 位活跃成员
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {boardHint}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(isEmptyShellState || railSessions.length > 0) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (isEmptyShellState) {
                  setShellExpanded((previous) => !previous);
                  return;
                }
                setDetailExpanded((previous) => !previous);
              }}
            >
              {detailVisible ? (
                <ChevronUp className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
              )}
              {detailToggleLabel}
            </Button>
          )}
          {isEmptyShellState
            ? (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500">
                  {runtimeFormationMeta?.label || "尚未出现真实团队成员"}
                </span>
              )
            : Object.entries(statusSummary)
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
                })}
          {isChildSession && onReturnToParentSession ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void onReturnToParentSession()}
            >
              <ArrowUpLeft className="mr-1.5 h-3.5 w-3.5" />
              返回父会话
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
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {railTitle}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {railSubtitle}
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
                    当前线程
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          {canWaitAnyActiveTeamSession ||
          canCloseCompletedTeamSessions ||
          teamOperationEntries.length > 0 ? (
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
                      : "等待任一活跃成员"}
                </Button>
              ) : null}
              {canWaitAnyActiveTeamSession ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
                  {waitableTeamSessionIds.length} 位活跃成员可统一等待
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
                      ? "关闭中..."
                      : "清理已完成成员"}
                </Button>
              ) : null}
              {canCloseCompletedTeamSessions ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
                  {completedTeamSessionIds.length} 位已完成成员可清理
                </span>
              ) : null}
            </div>
          ) : null}
          {teamOperationEntries.length > 0 ? (
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
                <span>Team 轨迹</span>
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
          ) : null}

          {railSessions.length > 0 ? (
            <div
              className={cn(
                "mt-3",
                stackedRail
                  ? "grid gap-2 md:grid-cols-2"
                  : "flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              )}
              data-testid="team-workspace-rail-list"
            >
              {railSessions.map((session) => {
                const meta = resolveStatusMeta(session.runtimeStatus);
                const selected = selectedSession?.id === session.id;
                const runtimeDetail = buildRuntimeDetailSummary(session);
                const mergedCardEntries = mergeSessionActivityEntries(
                  liveActivityBySessionId[session.id],
                  sessionActivityPreviewById[session.id]?.entries,
                  ACTIVITY_TIMELINE_ENTRY_LIMIT,
                );
                const cardActivityPreview = buildCardActivityPreview(
                  buildActivityPreviewFromEntry(mergedCardEntries[0]) ??
                    sessionActivityPreviewById[session.id]?.preview,
                );

                return (
                  <button
                    key={session.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedSessionId(session.id)}
                    className={cn(
                      "group flex flex-col rounded-[18px] border p-3 text-left transition",
                      stackedRail ? "w-full" : "w-[258px] shrink-0",
                      meta.cardClassName,
                      selected
                        ? "ring-1 ring-slate-300 bg-slate-50"
                        : "hover:border-slate-300 hover:bg-slate-50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900">
                            {session.name}
                          </span>
                          {session.isCurrent ? (
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
                              当前
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          {session.roleHint ? (
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                              {session.roleHint}
                            </span>
                          ) : null}
                          <span>{resolveSessionTypeLabel(session.sessionType)}</span>
                          <span className={cn(
                            "rounded-full px-2 py-0.5 font-medium",
                            meta.badgeClassName,
                          )}>
                            {meta.label}
                          </span>
                        </div>
                        {session.profileName ||
                        session.teamPresetId ||
                        (session.skills?.length ?? 0) > 0 ? (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                            {session.profileName ? (
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                                {session.profileName}
                              </span>
                            ) : null}
                            {session.teamPresetId ? (
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                                {getTeamPresetOption(session.teamPresetId)?.label ??
                                  session.teamPresetId}
                              </span>
                            ) : null}
                            {(session.skills ?? []).slice(0, 2).map((skill) => (
                              <span
                                key={`${session.id}-${skill.id}`}
                                className="rounded-full border border-slate-200 bg-white px-2 py-0.5"
                              >
                                {skill.name}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                          meta.dotClassName,
                        )}
                      />
                    </div>
                    <p
                      className={cn(
                        "mt-2 text-sm leading-5 text-slate-600",
                        stackedRail ? "line-clamp-4" : "line-clamp-2",
                      )}
                    >
                      {session.taskSummary ||
                        "暂未生成任务摘要，打开该会话可查看完整上下文。"}
                    </p>
                    {cardActivityPreview ? (
                      <div className="mt-2 border-l-2 border-slate-200 pl-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                          <Activity className="h-3 w-3" />
                          <span>最近过程</span>
                        </div>
                        <p
                          className={cn(
                            "mt-1 text-[11px] leading-5 text-slate-600",
                            stackedRail ? "line-clamp-3" : "line-clamp-2",
                          )}
                        >
                          {cardActivityPreview}
                        </p>
                      </div>
                    ) : null}
                    {runtimeDetail ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                          {runtimeDetail}
                        </span>
                      </div>
                    ) : null}
                    <div className="mt-2.5 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                      <span className="truncate">
                        {formatUpdatedAt(session.updatedAt)}
                      </span>
                      {session.model ? (
                        <span className="max-w-[180px] truncate">
                          {session.model}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
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
                  "模型正在准备本轮 Team，完成后这里会先展示本轮成员；后续真实成员加入时，再切换为可纵向浏览的团队轨道。"
                ) : runtimeTeamState?.status === "formed" ? (
                  <>
                    本轮 Team 已就绪。系统开始分派成员后，这里会从当前编队过渡到真实团队轨道。
                  </>
                ) : runtimeTeamState?.status === "failed" ? (
                  runtimeTeamState.errorMessage?.trim() ||
                  "Team 准备失败，暂时还没有真实团队成员。"
                ) : (
                  <>
                    还没有真实团队成员。系统开始分派成员后，这里会生成可纵向浏览的团队轨道。
                  </>
                )}
              </div>
            </>
          )}

          {detailVisible ? (
            <div
              className={cn("mt-3", detailCardClassName)}
              data-testid="team-workspace-detail-section"
            >
              {selectedSession ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        <Bot className="h-3.5 w-3.5" />
                        <span>焦点详情</span>
                        {selectedSession.isCurrent ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
                            当前线程
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold text-slate-900">
                          {selectedSession.name}
                        </span>
                        <Badge className={selectedStatusMeta.badgeClassName}>
                          {selectedStatusMeta.label}
                        </Badge>
                        {selectedSession.roleHint ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600">
                            {selectedSession.roleHint}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {canResumeSelectedSession ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={selectedActionPending}
                          onClick={() =>
                            void handleSelectedSessionAction("resume")
                          }
                        >
                          {selectedActionPending &&
                          pendingSessionAction?.action === "resume" ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          {selectedActionPending &&
                          pendingSessionAction?.action === "resume"
                            ? "恢复中..."
                            : "恢复成员"}
                        </Button>
                      ) : null}
                      {canStopSelectedSession ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={selectedActionPending}
                          onClick={() =>
                            void handleSelectedSessionAction("close")
                          }
                        >
                          {selectedActionPending &&
                          pendingSessionAction?.action === "close" ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          {selectedActionPending &&
                          pendingSessionAction?.action === "close"
                            ? "停止中..."
                            : "停止成员"}
                        </Button>
                      ) : null}
                      {canStopSelectedSession || canResumeSelectedSession ? (
                        <span className="text-xs leading-5 text-slate-500">
                          停止会中断当前执行并保留会话，可稍后恢复。
                        </span>
                      ) : null}
                      {canOpenSelectedSession ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void onOpenSubagentSession?.(selectedSession.id)
                          }
                        >
                          {isChildSession ? "切换" : "查看对话"}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <p
                    className="mt-3 text-sm leading-6 text-slate-600"
                    data-testid="team-workspace-session-summary"
                  >
                    {detailSummary}
                  </p>
                  {runtimeDetailSummary ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                        {runtimeDetailSummary}
                      </span>
                    </div>
                  ) : null}
                  {selectedSession?.profileName ||
                  selectedSession?.teamPresetId ||
                  selectedSession?.theme ||
                  selectedSession?.outputContract ||
                  selectedSkills.length > 0 ? (
                    <div className={secondarySectionClassName}>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        <Bot className="h-3.5 w-3.5" />
                        <span>执行配置</span>
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
                            Profile {selectedSession.profileName}
                          </span>
                        ) : null}
                        {selectedSession?.roleKey ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                            Role {selectedSession.roleKey}
                          </span>
                        ) : null}
                        {selectedSession?.theme ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                            Theme {selectedSession.theme}
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
                              key={`${selectedSession?.id}-${skill.id}`}
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
                    <div className={secondarySectionClassName}>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        <Clock3 className="h-3.5 w-3.5" />
                        <span>协作控制</span>
                        {canWaitSelectedSession ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
                            可直接等待结果
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
                            onClick={() =>
                              void handleSelectedSessionAction("wait")
                            }
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
                            仅在当前对话确实依赖该成员结果时使用。
                          </span>
                        </div>
                      ) : null}
                      {canSendSelectedSessionInput ? (
                        <div className="mt-3 space-y-3">
                          <Textarea
                            value={selectedSessionInputDraft}
                            onChange={(event) =>
                              handleSelectedSessionInputDraftChange(
                                event.target.value,
                              )
                            }
                            placeholder="给该成员补充新的说明、澄清约束，或要求它继续推进下一步。"
                            className="min-h-[96px] resize-y border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400"
                            data-testid="team-workspace-send-input-textarea"
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              disabled={
                                selectedActionPending ||
                                !selectedSessionInputMessage
                              }
                              onClick={() =>
                                void handleSelectedSessionSendInput(false)
                              }
                            >
                              {selectedActionPending &&
                              pendingSessionAction?.action === "send" ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : null}
                              {selectedActionPending &&
                              pendingSessionAction?.action === "send"
                                ? "发送中..."
                                : "发送补充说明"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={
                                selectedActionPending ||
                                !selectedSessionInputMessage
                              }
                              onClick={() =>
                                void handleSelectedSessionSendInput(true)
                              }
                            >
                              {selectedActionPending &&
                              pendingSessionAction?.action ===
                                "interrupt_send" ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : null}
                              {selectedActionPending &&
                              pendingSessionAction?.action ===
                                "interrupt_send"
                                ? "中断中..."
                                : "中断并发送"}
                            </Button>
                            <span className="text-xs leading-5 text-slate-500">
                              这条补充说明只会发送给当前成员，不影响其他团队成员。
                            </span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {selectedSessionSupportsActivityPreview ? (
                    <div className={secondarySectionClassName}>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        <Activity className="h-3.5 w-3.5" />
                        <span>最近过程</span>
                        {selectedSessionActivityShouldPoll ? (
                          <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-sky-700 normal-case">
                            运行中自动刷新
                          </span>
                        ) : null}
                      </div>
                      {selectedSessionActivityPreviewText ? (
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                          {selectedSessionActivityPreviewText}
                        </p>
                      ) : selectedSessionActivityPreview?.status === "error" ? (
                        <p className="mt-2 text-sm leading-6 text-rose-600">
                          最近过程暂不可用：
                          {selectedSessionActivityPreview.errorMessage ??
                            "同步失败"}
                        </p>
                      ) : selectedSessionActivityPreview?.status === "ready" ? (
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          该成员暂未产出可展示的最近过程。
                        </p>
                      ) : (
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          正在同步该成员的最近过程...
                        </p>
                      )}

                      {selectedSessionActivityEntries.length > 0 ? (
                        <div
                          className={timelineFeedClassName}
                          data-testid="team-workspace-activity-feed"
                        >
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                            <span>最近轨迹</span>
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
                              {selectedSessionActivityEntries.length} 条
                            </span>
                          </div>
                          <div className="mt-3 space-y-2.5">
                            {selectedSessionActivityEntries.map((entry) => (
                              <div
                                key={entry.id}
                                className={timelineEntryClassName}
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

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
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
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    <Bot className="h-3.5 w-3.5" />
                    <span>焦点详情</span>
                  </div>
                  <div className="mt-2 text-base font-semibold text-slate-900">
                    {runtimeFormationMeta?.title || "等待团队成员加入"}
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
                            参考蓝图角色
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
                      推荐流程：分派成员 → 等待结果 → 补充说明
                    </span>
                  </div>
                </>
              )}
            </div>
          ) : railSessions.length > 0 ? (
            <div
              className={cn(
                "mt-3 rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500",
                embedded ? "shadow-none" : "shadow-sm shadow-slate-950/5",
              )}
              data-testid="team-workspace-compact-summary"
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <PanelTop className="h-3.5 w-3.5" />
                <span>紧凑视图</span>
                {selectedSession ? (
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
                    焦点成员 · {selectedSession.name}
                  </span>
                ) : null}
              </div>
              <p className="mt-2">
                已收起焦点详情、执行配置、协作控制与最近过程，当前仅保留团队轨道与 Team
                轨迹，便于在小屏幕下先浏览整体进度。
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
