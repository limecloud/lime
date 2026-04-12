import type { AgentThreadItem, AgentThreadTurn } from "../types";
import type { AsterSubagentSessionInfo } from "@/lib/api/agentRuntime";
import { sortThreadItems } from "./threadTimelineView";

type SyntheticSubagentItem = Extract<
  AgentThreadItem,
  { type: "subagent_activity" }
>;

interface BuildRealSubagentTimelineItemsOptions {
  threadId?: string | null;
  turns: AgentThreadTurn[];
  childSessions: AsterSubagentSessionInfo[];
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
        title: childSession.name || "子任务",
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
