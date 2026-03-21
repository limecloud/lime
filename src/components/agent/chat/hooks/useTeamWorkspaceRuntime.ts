import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseStreamEvent,
  type StreamEvent,
  type StreamRuntimeStatusPayload,
  type ToolExecutionResult,
} from "@/lib/api/agentStream";
import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import { safeListen } from "@/lib/dev-bridge";
import {
  buildStatusEventActivityEntry,
  buildTeamWorkspaceActivityEntryFromThreadItem,
  buildTeamWorkspaceSessionFingerprint,
  normalizeTeamWorkspaceRuntimeStatus,
  type TeamWorkspaceActivityEntry,
  type TeamWorkspaceLiveRuntimeState,
  type TeamWorkspaceRuntimeSessionSnapshot,
  type TeamWorkspaceRuntimeStatus,
} from "../teamWorkspaceRuntime";

const LIVE_ACTIVITY_ENTRY_LIMIT = 3;
const EVENT_ACTIVITY_REFRESH_DEBOUNCE_MS = 240;
const LIVE_ACTIVITY_DETAIL_MAX_LENGTH = 220;

const IN_PROGRESS_BADGE_CLASS_NAME =
  "border border-sky-200 bg-sky-50 text-sky-700";
const QUEUED_BADGE_CLASS_NAME =
  "border border-amber-200 bg-amber-50 text-amber-700";
const COMPLETED_BADGE_CLASS_NAME =
  "border border-emerald-200 bg-emerald-50 text-emerald-700";
const FAILED_BADGE_CLASS_NAME =
  "border border-rose-200 bg-rose-50 text-rose-700";

interface SessionLiveStreamState {
  textDraft?: string;
  thinkingDraft?: string;
}

interface TeamWorkspaceRuntimeStreamProjection {
  entry?: TeamWorkspaceActivityEntry | null;
  clearEntryIds?: string[];
  nextTextDraft?: string;
  clearTextDraft?: boolean;
  nextThinkingDraft?: string;
  clearThinkingDraft?: boolean;
  rememberTool?: { toolId: string; toolName: string };
  forgetToolId?: string;
  runtimeStatus?: TeamWorkspaceRuntimeStatus;
  latestTurnStatus?: TeamWorkspaceRuntimeStatus;
  queuedTurnCount?: number;
  refreshPreview?: boolean;
}

interface UseTeamWorkspaceRuntimeOptions {
  currentSessionId?: string | null;
  currentSessionRuntimeStatus?: TeamWorkspaceRuntimeStatus;
  currentSessionLatestTurnStatus?: TeamWorkspaceRuntimeStatus;
  currentSessionQueuedTurnCount?: number;
  childSubagentSessions?: AsterSubagentSessionInfo[];
  subagentParentContext?: AsterSubagentParentContext | null;
}

interface UseTeamWorkspaceRuntimeResult {
  liveRuntimeBySessionId: Record<string, TeamWorkspaceLiveRuntimeState>;
  liveActivityBySessionId: Record<string, TeamWorkspaceActivityEntry[]>;
  activityRefreshVersionBySessionId: Record<string, number>;
}

function normalizeLiveActivityText(
  value?: string | null,
  maxLength = LIVE_ACTIVITY_DETAIL_MAX_LENGTH,
) {
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

  return `...${normalized.slice(-maxLength).trimStart()}`;
}

function appendLiveActivityDraft(previous: string | undefined, chunk: string) {
  return normalizeLiveActivityText(`${previous ?? ""}${chunk}`) ?? undefined;
}

function buildActivityEntry(params: {
  id: string;
  title: string;
  detail?: string | null;
  statusLabel: string;
  badgeClassName: string;
}): TeamWorkspaceActivityEntry | null {
  const detail = normalizeLiveActivityText(params.detail);
  if (!detail) {
    return null;
  }

  return {
    id: params.id,
    title: params.title,
    detail,
    statusLabel: params.statusLabel,
    badgeClassName: params.badgeClassName,
  };
}

function buildTextDraftEntry(sessionId: string, draft?: string) {
  return buildActivityEntry({
    id: `stream-text:${sessionId}`,
    title: "回复进行中",
    detail: draft,
    statusLabel: "进行中",
    badgeClassName: IN_PROGRESS_BADGE_CLASS_NAME,
  });
}

function buildThinkingDraftEntry(sessionId: string, draft?: string) {
  return buildActivityEntry({
    id: `stream-thinking:${sessionId}`,
    title: "推理进行中",
    detail: draft,
    statusLabel: "进行中",
    badgeClassName: IN_PROGRESS_BADGE_CLASS_NAME,
  });
}

function buildRuntimeStatusEntry(
  sessionId: string,
  status: StreamRuntimeStatusPayload,
) {
  return buildActivityEntry({
    id: `runtime-status:${sessionId}`,
    title: status.title.trim() || "运行状态",
    detail: [status.detail, ...(status.checkpoints ?? []).map((item) => `• ${item}`)]
      .map((item) => item.trim())
      .filter(Boolean)
      .join("\n"),
    statusLabel: "进行中",
    badgeClassName: IN_PROGRESS_BADGE_CLASS_NAME,
  });
}

function buildToolActivityEntry(params: {
  sessionId: string;
  toolId: string;
  toolName?: string;
  result?: ToolExecutionResult;
}) {
  const { sessionId, toolId, toolName, result } = params;
  const title = toolName?.trim() ? `工具 ${toolName}` : "工具执行";
  const detail = result
    ? result.error || result.output || toolName || "工具执行已完成。"
    : `正在执行 ${toolName || "工具"}。`;
  const success = result ? result.success !== false : true;

  return buildActivityEntry({
    id: `tool:${sessionId}:${toolId}`,
    title,
    detail,
    statusLabel: result ? (success ? "完成" : "失败") : "进行中",
    badgeClassName: result
      ? success
        ? COMPLETED_BADGE_CLASS_NAME
        : FAILED_BADGE_CLASS_NAME
      : IN_PROGRESS_BADGE_CLASS_NAME,
  });
}

function buildLifecycleActivityEntry(params: {
  sessionId: string;
  key: string;
  title: string;
  detail: string;
  statusLabel: string;
  badgeClassName: string;
}) {
  return buildActivityEntry({
    id: `lifecycle:${params.sessionId}:${params.key}`,
    title: params.title,
    detail: params.detail,
    statusLabel: params.statusLabel,
    badgeClassName: params.badgeClassName,
  });
}

function buildWarningActivityEntry(
  sessionId: string,
  message: string,
  code?: string,
) {
  return buildActivityEntry({
    id: `warning:${sessionId}:${code ?? ""}:${message}`,
    title: "警告",
    detail: message,
    statusLabel: "警告",
    badgeClassName: QUEUED_BADGE_CLASS_NAME,
  });
}

function buildErrorActivityEntry(sessionId: string, message: string) {
  return buildActivityEntry({
    id: `error:${sessionId}:${message}`,
    title: "错误",
    detail: message,
    statusLabel: "失败",
    badgeClassName: FAILED_BADGE_CLASS_NAME,
  });
}

function areActivityEntriesEqual(
  left: TeamWorkspaceActivityEntry,
  right: TeamWorkspaceActivityEntry,
) {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.detail === right.detail &&
    left.statusLabel === right.statusLabel &&
    left.badgeClassName === right.badgeClassName
  );
}

function upsertLiveActivityEntries(
  entries: TeamWorkspaceActivityEntry[],
  entry: TeamWorkspaceActivityEntry,
) {
  if (entries[0] && areActivityEntriesEqual(entries[0], entry)) {
    return entries;
  }

  const filtered = entries.filter((item) => item.id !== entry.id);
  const next = [entry, ...filtered].slice(0, LIVE_ACTIVITY_ENTRY_LIMIT);

  if (
    next.length === entries.length &&
    next.every((item, index) => areActivityEntriesEqual(item, entries[index]!))
  ) {
    return entries;
  }

  return next;
}

function removeLiveActivityEntries(
  entries: TeamWorkspaceActivityEntry[],
  entryIds: string[],
) {
  if (entryIds.length === 0) {
    return entries;
  }

  const removeSet = new Set(entryIds);
  const next = entries.filter((entry) => !removeSet.has(entry.id));
  if (next.length === entries.length) {
    return entries;
  }
  return next;
}

function buildLiveRuntimeState(
  session: TeamWorkspaceRuntimeSessionSnapshot,
  baseFingerprint: string,
  current: TeamWorkspaceLiveRuntimeState | undefined,
  patch: Partial<
    Pick<
      TeamWorkspaceLiveRuntimeState,
      "runtimeStatus" | "latestTurnStatus" | "queuedTurnCount"
    >
  >,
): TeamWorkspaceLiveRuntimeState {
  return {
    runtimeStatus:
      patch.runtimeStatus ??
      current?.runtimeStatus ??
      session.runtimeStatus ??
      session.latestTurnStatus,
    latestTurnStatus:
      patch.latestTurnStatus ??
      current?.latestTurnStatus ??
      session.latestTurnStatus ??
      session.runtimeStatus,
    queuedTurnCount:
      patch.queuedTurnCount ??
      current?.queuedTurnCount ??
      session.queuedTurnCount,
    baseFingerprint,
  };
}

function getQueuedTurnCount(
  session: TeamWorkspaceRuntimeSessionSnapshot,
  current?: TeamWorkspaceLiveRuntimeState,
): number {
  return current?.queuedTurnCount ?? session.queuedTurnCount ?? 0;
}

function resolveQueueDrainedRuntimeStatus(
  session: TeamWorkspaceRuntimeSessionSnapshot,
  current?: TeamWorkspaceLiveRuntimeState,
): TeamWorkspaceRuntimeStatus {
  const candidate = [
    current?.latestTurnStatus,
    session.latestTurnStatus,
    current?.runtimeStatus,
    session.runtimeStatus,
  ].find((status) => status && status !== "queued" && status !== "running");

  return candidate ?? "idle";
}

function resolveFinalRuntimeStatus(params: {
  session: TeamWorkspaceRuntimeSessionSnapshot;
  current?: TeamWorkspaceLiveRuntimeState;
  terminalStatus?: Extract<TeamWorkspaceRuntimeStatus, "completed" | "failed">;
  queuedTurnCount?: number;
}): TeamWorkspaceRuntimeStatus {
  const queuedTurnCount =
    params.queuedTurnCount ?? getQueuedTurnCount(params.session, params.current);
  if (queuedTurnCount > 0) {
    return "queued";
  }

  if (params.terminalStatus) {
    return params.terminalStatus;
  }

  const candidate = [
    params.current?.latestTurnStatus,
    params.session.latestTurnStatus,
    params.current?.runtimeStatus,
    params.session.runtimeStatus,
  ].find((status) => status && status !== "queued" && status !== "running");

  return candidate ?? "completed";
}

function projectRuntimeStreamEvent(params: {
  sessionId: string;
  session: TeamWorkspaceRuntimeSessionSnapshot;
  event: StreamEvent;
  currentRuntime?: TeamWorkspaceLiveRuntimeState;
  streamState?: SessionLiveStreamState;
  toolNameById?: Record<string, string>;
}): TeamWorkspaceRuntimeStreamProjection | null {
  const { sessionId, session, event, currentRuntime, streamState, toolNameById } =
    params;

  switch (event.type) {
    case "item_started":
    case "item_updated":
    case "item_completed": {
      const entry = buildTeamWorkspaceActivityEntryFromThreadItem(event.item);
      const clearEntryIds: string[] = [];

      if (
        event.type === "item_completed" &&
        (event.item.type === "agent_message" || event.item.type === "turn_summary")
      ) {
        clearEntryIds.push(`stream-text:${sessionId}`, `runtime-status:${sessionId}`);
      }

      if (event.type === "item_completed" && event.item.type === "reasoning") {
        clearEntryIds.push(`stream-thinking:${sessionId}`);
      }

      return {
        entry,
        clearEntryIds,
        clearTextDraft:
          event.type === "item_completed" &&
          (event.item.type === "agent_message" || event.item.type === "turn_summary"),
        clearThinkingDraft:
          event.type === "item_completed" && event.item.type === "reasoning",
        refreshPreview: event.type === "item_completed",
      };
    }
    case "text_delta": {
      const nextTextDraft = appendLiveActivityDraft(
        streamState?.textDraft,
        event.text,
      );
      return {
        entry: buildTextDraftEntry(sessionId, nextTextDraft),
        nextTextDraft: nextTextDraft ?? undefined,
      };
    }
    case "thinking_delta": {
      const nextThinkingDraft = appendLiveActivityDraft(
        streamState?.thinkingDraft,
        event.text,
      );
      return {
        entry: buildThinkingDraftEntry(sessionId, nextThinkingDraft),
        nextThinkingDraft: nextThinkingDraft ?? undefined,
      };
    }
    case "tool_start":
      return {
        entry: buildToolActivityEntry({
          sessionId,
          toolId: event.tool_id,
          toolName: event.tool_name,
        }),
        rememberTool: {
          toolId: event.tool_id,
          toolName: event.tool_name,
        },
      };
    case "tool_end":
      return {
        entry: buildToolActivityEntry({
          sessionId,
          toolId: event.tool_id,
          toolName: toolNameById?.[event.tool_id],
          result: event.result,
        }),
        forgetToolId: event.tool_id,
        refreshPreview: true,
      };
    case "runtime_status":
      return {
        entry: buildRuntimeStatusEntry(sessionId, event.status),
      };
    case "queue_added":
      return {
        entry: buildLifecycleActivityEntry({
          sessionId,
          key: "queue",
          title: "进入队列",
          detail: "新的任务已加入该子代理队列，等待调度执行。",
          statusLabel: "排队中",
          badgeClassName: QUEUED_BADGE_CLASS_NAME,
        }),
        runtimeStatus: "queued",
        latestTurnStatus: "queued",
        queuedTurnCount: getQueuedTurnCount(session, currentRuntime) + 1,
      };
    case "queue_started":
      return {
        entry: buildLifecycleActivityEntry({
          sessionId,
          key: "queue",
          title: "开始执行",
          detail: "队列中的任务已开始执行。",
          statusLabel: "运行中",
          badgeClassName: IN_PROGRESS_BADGE_CLASS_NAME,
        }),
        runtimeStatus: "running",
        latestTurnStatus: "running",
        queuedTurnCount: Math.max(getQueuedTurnCount(session, currentRuntime) - 1, 0),
      };
    case "queue_removed": {
      const queuedTurnCount = Math.max(
        getQueuedTurnCount(session, currentRuntime) - 1,
        0,
      );
      return {
        queuedTurnCount,
        runtimeStatus:
          queuedTurnCount === 0 && currentRuntime?.runtimeStatus === "queued"
            ? resolveQueueDrainedRuntimeStatus(session, currentRuntime)
            : undefined,
        refreshPreview: true,
      };
    }
    case "queue_cleared":
      return {
        queuedTurnCount: 0,
        runtimeStatus:
          currentRuntime?.runtimeStatus === "queued"
            ? resolveQueueDrainedRuntimeStatus(session, currentRuntime)
            : undefined,
        refreshPreview: true,
      };
    case "turn_started":
      return {
        entry: buildLifecycleActivityEntry({
          sessionId,
          key: "turn",
          title: "回合开始",
          detail: "该子代理已开始处理当前回合。",
          statusLabel: "运行中",
          badgeClassName: IN_PROGRESS_BADGE_CLASS_NAME,
        }),
        runtimeStatus: "running",
        latestTurnStatus: "running",
      };
    case "turn_completed":
      {
        const queuedTurnCount = getQueuedTurnCount(session, currentRuntime);
        return {
          entry: buildLifecycleActivityEntry({
            sessionId,
            key: "turn",
            title: "回合完成",
            detail: "当前回合已完成，正在等待快照同步。",
            statusLabel: "完成",
            badgeClassName: COMPLETED_BADGE_CLASS_NAME,
          }),
          runtimeStatus: resolveFinalRuntimeStatus({
            session,
            current: currentRuntime,
            terminalStatus: "completed",
            queuedTurnCount,
          }),
          latestTurnStatus: "completed",
          queuedTurnCount,
          clearEntryIds: [
            `stream-text:${sessionId}`,
            `stream-thinking:${sessionId}`,
            `runtime-status:${sessionId}`,
          ],
          clearTextDraft: true,
          clearThinkingDraft: true,
          refreshPreview: true,
        };
      }
    case "turn_failed": {
      const queuedTurnCount = getQueuedTurnCount(session, currentRuntime);
      return {
        entry: buildLifecycleActivityEntry({
          sessionId,
          key: "turn",
          title: "回合失败",
          detail:
            event.turn.error_message?.trim() || "当前回合执行失败，请查看错误详情。",
          statusLabel: "失败",
          badgeClassName: FAILED_BADGE_CLASS_NAME,
        }),
        runtimeStatus: resolveFinalRuntimeStatus({
          session,
          current: currentRuntime,
          terminalStatus: "failed",
          queuedTurnCount,
        }),
        latestTurnStatus: "failed",
        queuedTurnCount,
        clearEntryIds: [
          `stream-text:${sessionId}`,
          `stream-thinking:${sessionId}`,
          `runtime-status:${sessionId}`,
        ],
        clearTextDraft: true,
        clearThinkingDraft: true,
        refreshPreview: true,
      };
    }
    case "warning":
      return {
        entry: buildWarningActivityEntry(sessionId, event.message, event.code),
        refreshPreview: true,
      };
    case "error": {
      const queuedTurnCount = getQueuedTurnCount(session, currentRuntime);
      return {
        entry: buildErrorActivityEntry(sessionId, event.message),
        runtimeStatus: resolveFinalRuntimeStatus({
          session,
          current: currentRuntime,
          terminalStatus: "failed",
          queuedTurnCount,
        }),
        latestTurnStatus: "failed",
        queuedTurnCount,
        clearEntryIds: [
          `stream-text:${sessionId}`,
          `stream-thinking:${sessionId}`,
          `runtime-status:${sessionId}`,
        ],
        clearTextDraft: true,
        clearThinkingDraft: true,
        refreshPreview: true,
      };
    }
    case "done":
      return null;
    case "final_done": {
      const queuedTurnCount = getQueuedTurnCount(session, currentRuntime);
      return {
        runtimeStatus: resolveFinalRuntimeStatus({
          session,
          current: currentRuntime,
          queuedTurnCount,
        }),
        queuedTurnCount,
        clearEntryIds: [
          `stream-text:${sessionId}`,
          `stream-thinking:${sessionId}`,
          `runtime-status:${sessionId}`,
        ],
        clearTextDraft: true,
        clearThinkingDraft: true,
        refreshPreview: true,
      };
    }
    default:
      return null;
  }
}

function buildActiveSubagentSnapshots(params: UseTeamWorkspaceRuntimeOptions) {
  const {
    currentSessionId,
    currentSessionRuntimeStatus,
    currentSessionLatestTurnStatus,
    currentSessionQueuedTurnCount = 0,
    childSubagentSessions = [],
    subagentParentContext = null,
  } = params;
  const snapshots: TeamWorkspaceRuntimeSessionSnapshot[] = [];
  const seen = new Set<string>();

  if (subagentParentContext && currentSessionId) {
    snapshots.push({
      id: currentSessionId,
      runtimeStatus: currentSessionRuntimeStatus,
      latestTurnStatus: currentSessionLatestTurnStatus,
      queuedTurnCount: currentSessionQueuedTurnCount,
    });
    seen.add(currentSessionId);
  }

  const siblingSessions = subagentParentContext
    ? subagentParentContext.sibling_subagent_sessions ?? []
    : childSubagentSessions;

  siblingSessions.forEach((session) => {
    if (seen.has(session.id)) {
      return;
    }
    seen.add(session.id);
    snapshots.push({
      id: session.id,
      runtimeStatus: session.runtime_status,
      latestTurnStatus: session.latest_turn_status,
      queuedTurnCount: session.queued_turn_count,
      updatedAt: session.updated_at,
    });
  });

  return snapshots;
}

export function useTeamWorkspaceRuntime(
  options: UseTeamWorkspaceRuntimeOptions,
): UseTeamWorkspaceRuntimeResult {
  const {
    currentSessionId,
    currentSessionRuntimeStatus,
    currentSessionLatestTurnStatus,
    currentSessionQueuedTurnCount = 0,
    childSubagentSessions = [],
    subagentParentContext = null,
  } = options;
  const [liveRuntimeBySessionId, setLiveRuntimeBySessionId] = useState<
    Record<string, TeamWorkspaceLiveRuntimeState>
  >({});
  const liveRuntimeBySessionIdRef = useRef<
    Record<string, TeamWorkspaceLiveRuntimeState>
  >({});
  const [liveActivityBySessionId, setLiveActivityBySessionId] = useState<
    Record<string, TeamWorkspaceActivityEntry[]>
  >({});
  const [activityRefreshVersionBySessionId, setActivityRefreshVersionBySessionId] =
    useState<Record<string, number>>({});
  const refreshTimersRef = useRef<Record<string, number>>({});
  const activeSnapshotByIdRef = useRef<
    Map<string, TeamWorkspaceRuntimeSessionSnapshot>
  >(new Map());
  const baseFingerprintByIdRef = useRef<Map<string, string>>(new Map());
  const liveStreamStateBySessionIdRef = useRef<
    Record<string, SessionLiveStreamState>
  >({});
  const toolNameBySessionIdRef = useRef<Record<string, Record<string, string>>>(
    {},
  );

  const activeSnapshots = useMemo(
    () =>
      buildActiveSubagentSnapshots({
        currentSessionId,
        currentSessionRuntimeStatus,
        currentSessionLatestTurnStatus,
        currentSessionQueuedTurnCount,
        childSubagentSessions,
        subagentParentContext,
      }),
    [
      childSubagentSessions,
      currentSessionId,
      currentSessionLatestTurnStatus,
      currentSessionQueuedTurnCount,
      currentSessionRuntimeStatus,
      subagentParentContext,
    ],
  );
  const activeSessionKey = useMemo(
    () =>
      activeSnapshots
        .map((session) => buildTeamWorkspaceSessionFingerprint(session))
        .join("|"),
    [activeSnapshots],
  );
  const activeSnapshotById = useMemo(
    () => new Map(activeSnapshots.map((session) => [session.id, session])),
    [activeSnapshots],
  );
  const baseFingerprintById = useMemo(
    () =>
      new Map(
        activeSnapshots.map((session) => [
          session.id,
          buildTeamWorkspaceSessionFingerprint(session),
        ]),
      ),
    [activeSnapshots],
  );

  useEffect(() => {
    activeSnapshotByIdRef.current = activeSnapshotById;
    baseFingerprintByIdRef.current = baseFingerprintById;
  }, [activeSnapshotById, baseFingerprintById]);

  useEffect(() => {
    liveRuntimeBySessionIdRef.current = liveRuntimeBySessionId;
  }, [liveRuntimeBySessionId]);

  const scheduleActivityRefresh = useCallback((sessionId: string) => {
    if (refreshTimersRef.current[sessionId] !== undefined) {
      return;
    }

    refreshTimersRef.current[sessionId] = window.setTimeout(() => {
      delete refreshTimersRef.current[sessionId];
      if (!activeSnapshotByIdRef.current.has(sessionId)) {
        return;
      }

      setActivityRefreshVersionBySessionId((previous) => ({
        ...previous,
        [sessionId]: (previous[sessionId] ?? 0) + 1,
      }));
    }, EVENT_ACTIVITY_REFRESH_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(refreshTimersRef.current)) {
        window.clearTimeout(timerId);
      }
      refreshTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const activeSessionIds = new Set(activeSnapshots.map((session) => session.id));

    Object.entries(refreshTimersRef.current).forEach(([sessionId, timerId]) => {
      if (activeSessionIds.has(sessionId)) {
        return;
      }
      window.clearTimeout(timerId);
      delete refreshTimersRef.current[sessionId];
    });

    setLiveActivityBySessionId((previous) => {
      const nextEntries = Object.entries(previous).filter(([sessionId]) =>
        activeSessionIds.has(sessionId),
      );
      if (nextEntries.length === Object.keys(previous).length) {
        return previous;
      }
      return Object.fromEntries(nextEntries);
    });

    setActivityRefreshVersionBySessionId((previous) => {
      const nextEntries = Object.entries(previous).filter(([sessionId]) =>
        activeSessionIds.has(sessionId),
      );
      if (nextEntries.length === Object.keys(previous).length) {
        return previous;
      }
      return Object.fromEntries(nextEntries);
    });

    setLiveRuntimeBySessionId((previous) => {
      const nextEntries = Object.entries(previous).filter(([sessionId, live]) => {
        if (!activeSessionIds.has(sessionId)) {
          return false;
        }
        return baseFingerprintById.get(sessionId) === live.baseFingerprint;
      });
      if (nextEntries.length === Object.keys(previous).length) {
        return previous;
      }
      return Object.fromEntries(nextEntries);
    });

    Object.keys(liveStreamStateBySessionIdRef.current).forEach((sessionId) => {
      if (!activeSessionIds.has(sessionId)) {
        delete liveStreamStateBySessionIdRef.current[sessionId];
      }
    });
    Object.keys(toolNameBySessionIdRef.current).forEach((sessionId) => {
      if (!activeSessionIds.has(sessionId)) {
        delete toolNameBySessionIdRef.current[sessionId];
      }
    });
  }, [activeSessionKey, activeSnapshots, baseFingerprintById]);

  useEffect(() => {
    const eventNames = [
      currentSessionId
        ? `agent_subagent_status:${currentSessionId}`
        : null,
      subagentParentContext?.parent_session_id
        ? `agent_subagent_status:${subagentParentContext.parent_session_id}`
        : null,
    ].filter((value, index, values): value is string => {
      return Boolean(value) && values.indexOf(value) === index;
    });

    if (eventNames.length === 0) {
      return;
    }

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const subscribe = async () => {
      for (const eventName of eventNames) {
        const unlisten = await safeListen(eventName, (event) => {
          const data = parseStreamEvent(event.payload);
          if (disposed || data?.type !== "subagent_status_changed") {
            return;
          }

          const matchingSession = activeSnapshotByIdRef.current.get(data.session_id);
          if (!matchingSession) {
            return;
          }

          const baseFingerprint =
            baseFingerprintByIdRef.current.get(data.session_id) ??
            buildTeamWorkspaceSessionFingerprint(matchingSession);
          const normalizedStatus = normalizeTeamWorkspaceRuntimeStatus(
            data.status,
          );
          const liveEntry = buildStatusEventActivityEntry(
            data.session_id,
            data.status,
          );

          setLiveRuntimeBySessionId((previous) => {
            const current = previous[data.session_id];
            const nextQueuedTurnCount =
              normalizedStatus === "completed" ||
              normalizedStatus === "failed" ||
              normalizedStatus === "aborted" ||
              normalizedStatus === "closed" ||
              normalizedStatus === "idle"
                ? 0
                : current?.queuedTurnCount ?? matchingSession.queuedTurnCount;
            if (
              current?.runtimeStatus === normalizedStatus &&
              current.latestTurnStatus === normalizedStatus &&
              current.queuedTurnCount === nextQueuedTurnCount &&
              current.baseFingerprint === baseFingerprint
            ) {
              return previous;
            }

            return {
              ...previous,
              [data.session_id]: buildLiveRuntimeState(
                matchingSession,
                baseFingerprint,
                current,
                {
                  runtimeStatus: normalizedStatus,
                  latestTurnStatus: normalizedStatus,
                  queuedTurnCount: nextQueuedTurnCount,
                },
              ),
            };
          });

          setLiveActivityBySessionId((previous) => {
            const existingEntries = previous[data.session_id] ?? [];
            if (
              existingEntries[0]?.title === liveEntry.title &&
              existingEntries[0]?.detail === liveEntry.detail
            ) {
              return previous;
            }

            return {
              ...previous,
              [data.session_id]: upsertLiveActivityEntries(
                existingEntries,
                liveEntry,
              ),
            };
          });

          scheduleActivityRefresh(data.session_id);
        });

        if (disposed) {
          unlisten();
          return;
        }

        unlisteners.push(unlisten);
      }
    };

    void subscribe();

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [
    activeSessionKey,
    currentSessionId,
    subagentParentContext?.parent_session_id,
    scheduleActivityRefresh,
  ]);

  useEffect(() => {
    const sessionIds = activeSnapshots.map((session) => session.id);
    if (sessionIds.length === 0) {
      return;
    }

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const subscribe = async () => {
      for (const sessionId of sessionIds) {
        const eventName = `agent_subagent_stream:${sessionId}`;
        const unlisten = await safeListen(eventName, (event) => {
          const data = parseStreamEvent(event.payload);
          if (disposed || !data) {
            return;
          }

          const matchingSession = activeSnapshotByIdRef.current.get(sessionId);
          if (!matchingSession) {
            return;
          }

          const projection = projectRuntimeStreamEvent({
            sessionId,
            session: matchingSession,
            event: data,
            currentRuntime: liveRuntimeBySessionIdRef.current[sessionId],
            streamState: liveStreamStateBySessionIdRef.current[sessionId],
            toolNameById: toolNameBySessionIdRef.current[sessionId],
          });
          if (!projection) {
            return;
          }

          if (projection.rememberTool) {
            toolNameBySessionIdRef.current[sessionId] = {
              ...(toolNameBySessionIdRef.current[sessionId] ?? {}),
              [projection.rememberTool.toolId]: projection.rememberTool.toolName,
            };
          }

          if (projection.forgetToolId) {
            const currentTools = toolNameBySessionIdRef.current[sessionId];
            if (currentTools) {
              delete currentTools[projection.forgetToolId];
              if (Object.keys(currentTools).length === 0) {
                delete toolNameBySessionIdRef.current[sessionId];
              }
            }
          }

          const nextStreamState = {
            ...(liveStreamStateBySessionIdRef.current[sessionId] ?? {}),
          };
          let streamStateChanged = false;

          if (projection.nextTextDraft !== undefined) {
            nextStreamState.textDraft = projection.nextTextDraft;
            streamStateChanged = true;
          }
          if (projection.clearTextDraft) {
            delete nextStreamState.textDraft;
            streamStateChanged = true;
          }
          if (projection.nextThinkingDraft !== undefined) {
            nextStreamState.thinkingDraft = projection.nextThinkingDraft;
            streamStateChanged = true;
          }
          if (projection.clearThinkingDraft) {
            delete nextStreamState.thinkingDraft;
            streamStateChanged = true;
          }

          if (streamStateChanged) {
            if (Object.keys(nextStreamState).length === 0) {
              delete liveStreamStateBySessionIdRef.current[sessionId];
            } else {
              liveStreamStateBySessionIdRef.current[sessionId] = nextStreamState;
            }
          }

          const baseFingerprint =
            baseFingerprintByIdRef.current.get(sessionId) ??
            buildTeamWorkspaceSessionFingerprint(matchingSession);

          if (
            projection.runtimeStatus !== undefined ||
            projection.latestTurnStatus !== undefined ||
            projection.queuedTurnCount !== undefined
          ) {
            setLiveRuntimeBySessionId((previous) => {
              const current = previous[sessionId];
              const nextState = buildLiveRuntimeState(
                matchingSession,
                baseFingerprint,
                current,
                {
                  runtimeStatus: projection.runtimeStatus,
                  latestTurnStatus: projection.latestTurnStatus,
                  queuedTurnCount: projection.queuedTurnCount,
                },
              );

              if (
                current &&
                current.runtimeStatus === nextState.runtimeStatus &&
                current.latestTurnStatus === nextState.latestTurnStatus &&
                current.queuedTurnCount === nextState.queuedTurnCount &&
                current.baseFingerprint === nextState.baseFingerprint
              ) {
                return previous;
              }

              return {
                ...previous,
                [sessionId]: nextState,
              };
            });
          }

          if (projection.entry || projection.clearEntryIds?.length) {
            setLiveActivityBySessionId((previous) => {
              const existingEntries = previous[sessionId] ?? [];
              const nextWithoutTransient = removeLiveActivityEntries(
                existingEntries,
                projection.clearEntryIds ?? [],
              );
              const nextEntries = projection.entry
                ? upsertLiveActivityEntries(nextWithoutTransient, projection.entry)
                : nextWithoutTransient;

              if (nextEntries === existingEntries) {
                return previous;
              }

              if (nextEntries.length === 0) {
                const { [sessionId]: _removed, ...rest } = previous;
                return rest;
              }

              return {
                ...previous,
                [sessionId]: nextEntries,
              };
            });
          }

          if (projection.refreshPreview) {
            scheduleActivityRefresh(sessionId);
          }
        });

        if (disposed) {
          unlisten();
          return;
        }

        unlisteners.push(unlisten);
      }
    };

    void subscribe();

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [activeSessionKey, activeSnapshots, scheduleActivityRefresh]);

  return {
    liveRuntimeBySessionId,
    liveActivityBySessionId,
    activityRefreshVersionBySessionId,
  };
}
