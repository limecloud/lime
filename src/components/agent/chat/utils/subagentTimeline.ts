import type { AgentThreadItem, AgentThreadTurn } from "../types";
import type { AsterSubagentSessionInfo } from "@/lib/api/agentRuntime";
import type { CompatSubagentEvent } from "./compatSubagentRuntime";
import { sortThreadItems } from "./threadTimelineView";

type SyntheticSubagentItem = Extract<
  AgentThreadItem,
  { type: "subagent_activity" }
>;

interface BuildSubagentTimelineItemsOptions {
  threadId?: string | null;
  turnId?: string | null;
  events: CompatSubagentEvent[];
  baseTime?: Date;
}

interface BuildRealSubagentTimelineItemsOptions {
  threadId?: string | null;
  turns: AgentThreadTurn[];
  childSessions: AsterSubagentSessionInfo[];
}

function createTimestamp(baseTime: number, index: number): string {
  return new Date(baseTime + index).toISOString();
}

function resolveRunSummary(event: CompatSubagentEvent): string | undefined {
  switch (event.type) {
    case "started":
      return `准备调度 ${event.totalTasks} 个子任务`;
    case "progress":
      return `进度 ${event.progress.completed}/${event.progress.total}，处理中 ${event.progress.running}`;
    case "completed":
      return event.success
        ? `子代理协作完成，耗时 ${Math.round(event.durationMs / 1000)} 秒`
        : `子代理协作结束，耗时 ${Math.round(event.durationMs / 1000)} 秒`;
    case "cancelled":
      return "子代理协作已取消";
    default:
      return undefined;
  }
}

function resolveTaskTitle(
  event: Extract<CompatSubagentEvent, { taskId: string }>,
): string {
  if (
    "taskType" in event &&
    typeof event.taskType === "string" &&
    event.taskType.trim()
  ) {
    return `${event.taskId} · ${event.taskType.trim()}`;
  }
  return event.taskId;
}

function resolveTimestampMs(value?: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveChildSubagentItemStatus(
  status?: AsterSubagentSessionInfo["runtime_status"],
): SyntheticSubagentItem["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
    case "aborted":
      return "failed";
    case "idle":
    case "queued":
    case "running":
    default:
      return "in_progress";
  }
}

function resolveChildSubagentStatusLabel(
  status?: AsterSubagentSessionInfo["runtime_status"],
): string {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "aborted":
      return "aborted";
    case "idle":
    default:
      return "waiting";
  }
}

function resolveParentTurnIdForChildSession(
  turns: AgentThreadTurn[],
  childSession: AsterSubagentSessionInfo,
): string | null {
  if (turns.length === 0) {
    return null;
  }

  const explicitTurnId = childSession.created_from_turn_id?.trim();
  if (explicitTurnId) {
    const matchedTurn = turns.find((turn) => turn.id === explicitTurnId);
    if (matchedTurn) {
      return matchedTurn.id;
    }
  }

  const targetMs = childSession.created_at * 1000;
  const sortedTurns = [...turns].sort((left, right) => {
    if (left.started_at !== right.started_at) {
      return left.started_at.localeCompare(right.started_at);
    }
    return left.id.localeCompare(right.id);
  });

  const turnInWindow = sortedTurns.find((turn) => {
    const startedAtMs = resolveTimestampMs(turn.started_at);
    const completedAtMs = resolveTimestampMs(turn.completed_at);

    if (startedAtMs === null || targetMs < startedAtMs) {
      return false;
    }

    return completedAtMs === null || targetMs <= completedAtMs;
  });
  if (turnInWindow) {
    return turnInWindow.id;
  }

  const latestStartedBeforeChild = [...sortedTurns].reverse().find((turn) => {
    const startedAtMs = resolveTimestampMs(turn.started_at);
    return startedAtMs !== null && startedAtMs <= targetMs;
  });
  if (latestStartedBeforeChild) {
    return latestStartedBeforeChild.id;
  }

  return sortedTurns[sortedTurns.length - 1]?.id || null;
}

export function buildRealSubagentTimelineItems({
  threadId,
  turns,
  childSessions,
}: BuildRealSubagentTimelineItemsOptions): AgentThreadItem[] {
  const resolvedThreadId = threadId?.trim();
  if (!resolvedThreadId || childSessions.length === 0 || turns.length === 0) {
    return [];
  }

  const items = childSessions.reduce<SyntheticSubagentItem[]>(
    (collection, childSession, index) => {
      const inferredTurnId = resolveParentTurnIdForChildSession(
        turns,
        childSession,
      );
      if (!inferredTurnId) {
        return collection;
      }

      const startedAt = new Date(childSession.created_at * 1000).toISOString();
      const updatedAt = new Date(childSession.updated_at * 1000).toISOString();
      const status = resolveChildSubagentItemStatus(
        childSession.runtime_status,
      );

      collection.push({
        id: `real:subagent:${childSession.id}`,
        thread_id: resolvedThreadId,
        turn_id: inferredTurnId,
        sequence: 15_000 + index,
        status,
        started_at: startedAt,
        completed_at: status === "in_progress" ? undefined : updatedAt,
        updated_at: updatedAt,
        type: "subagent_activity",
        status_label: resolveChildSubagentStatusLabel(
          childSession.runtime_status,
        ),
        title: childSession.name || "子代理会话",
        summary: childSession.task_summary,
        role: childSession.role_hint,
        model: childSession.model,
        session_id: childSession.id,
      });

      return collection;
    },
    [],
  );

  return sortThreadItems(items);
}

export function buildSyntheticSubagentTimelineItems({
  threadId,
  turnId,
  events,
  baseTime,
}: BuildSubagentTimelineItemsOptions): AgentThreadItem[] {
  const resolvedThreadId = threadId?.trim();
  const resolvedTurnId = turnId?.trim();
  if (!resolvedThreadId || !resolvedTurnId || events.length === 0) {
    return [];
  }

  const items = new Map<string, AgentThreadItem>();
  const startTimes = new Map<string, string>();
  const timestampBase = (baseTime ?? new Date()).getTime();

  const upsertItem = (
    id: string,
    sequence: number,
    timestamp: string,
    item: Omit<
      SyntheticSubagentItem,
      "id" | "thread_id" | "turn_id" | "sequence" | "started_at"
    >,
  ) => {
    const previous = items.get(id);
    const startedAt = previous?.started_at || startTimes.get(id) || timestamp;
    startTimes.set(id, startedAt);
    items.set(id, {
      ...previous,
      ...item,
      id,
      thread_id: resolvedThreadId,
      turn_id: resolvedTurnId,
      sequence: previous?.sequence ?? sequence,
      started_at: startedAt,
    } as AgentThreadItem);
  };

  events.forEach((event, index) => {
    const sequence = 10_000 + index;
    const timestamp = createTimestamp(timestampBase, index);
    const runItemId = `synthetic:subagent:${resolvedTurnId}:run`;

    switch (event.type) {
      case "started":
      case "progress":
      case "completed":
      case "cancelled": {
        upsertItem(runItemId, sequence, timestamp, {
          status:
            event.type === "completed" || event.type === "cancelled"
              ? "completed"
              : "in_progress",
          completed_at:
            event.type === "completed" || event.type === "cancelled"
              ? timestamp
              : undefined,
          updated_at: timestamp,
          type: "subagent_activity",
          status_label:
            event.type === "started"
              ? "dispatching"
              : event.type === "progress"
                ? "running"
                : event.type === "cancelled"
                  ? "cancelled"
                  : "completed",
          title: "子代理协作",
          summary: resolveRunSummary(event),
        });
        break;
      }

      case "taskStarted":
      case "taskRetry":
      case "taskCompleted":
      case "taskFailed":
      case "taskSkipped": {
        const itemId = `synthetic:subagent:${resolvedTurnId}:${event.taskId}`;
        upsertItem(itemId, sequence, timestamp, {
          status:
            event.type === "taskFailed"
              ? "failed"
              : event.type === "taskCompleted" || event.type === "taskSkipped"
                ? "completed"
                : "in_progress",
          completed_at:
            event.type === "taskCompleted" ||
            event.type === "taskFailed" ||
            event.type === "taskSkipped"
              ? timestamp
              : undefined,
          updated_at: timestamp,
          type: "subagent_activity",
          status_label:
            event.type === "taskStarted"
              ? "running"
              : event.type === "taskRetry"
                ? "retrying"
                : event.type === "taskCompleted"
                  ? "completed"
                  : event.type === "taskSkipped"
                    ? "skipped"
                    : "failed",
          title: resolveTaskTitle(event),
          summary:
            event.type === "taskStarted"
              ? "子代理开始执行"
              : event.type === "taskRetry"
                ? `重试第 ${event.retryCount} 次`
                : event.type === "taskCompleted"
                  ? `已完成，耗时 ${Math.round(event.durationMs / 1000)} 秒`
                  : event.type === "taskSkipped"
                    ? `已跳过：${event.reason}`
                    : event.error,
        });
        break;
      }
    }
  });

  return sortThreadItems(Array.from(items.values()));
}
