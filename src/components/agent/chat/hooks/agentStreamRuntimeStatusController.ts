import type {
  AgentRuntimeStatusPayload,
  AgentThreadItem,
  AgentThreadTurnSummaryItem,
} from "@/lib/api/agentProtocol";
import { normalizeLegacyRuntimeStatusTitle } from "@/lib/api/agentTextNormalization";
import { formatAgentRuntimeStatusSummary } from "../utils/agentRuntimeStatus";

export interface AgentStreamRuntimeStatusApplyPlan {
  normalizedStatus: AgentRuntimeStatusPayload;
  summaryText: string;
  updatedAt: string;
}

export function buildAgentStreamNormalizedRuntimeStatus(
  status: AgentRuntimeStatusPayload,
): AgentRuntimeStatusPayload {
  return {
    ...status,
    title: normalizeLegacyRuntimeStatusTitle(status.title),
  };
}

export function buildAgentStreamRuntimeStatusApplyPlan(params: {
  status: AgentRuntimeStatusPayload;
  updatedAt: string;
}): AgentStreamRuntimeStatusApplyPlan {
  const normalizedStatus = buildAgentStreamNormalizedRuntimeStatus(
    params.status,
  );
  return {
    normalizedStatus,
    summaryText: formatAgentRuntimeStatusSummary(normalizedStatus),
    updatedAt: params.updatedAt,
  };
}

export function selectAgentStreamRuntimeSummaryItem(params: {
  activeSessionId: string;
  items: readonly AgentThreadItem[];
  pendingItemKey: string;
}): AgentThreadTurnSummaryItem | null {
  const pendingItem = params.items.find(
    (item) => item.id === params.pendingItemKey,
  );
  if (pendingItem) {
    return pendingItem.type === "turn_summary" ? pendingItem : null;
  }

  const fallbackItem = [...params.items].reverse().find(
    (item) =>
      item.thread_id === params.activeSessionId &&
      item.type === "turn_summary" &&
      item.status === "in_progress",
  );
  return fallbackItem?.type === "turn_summary" ? fallbackItem : null;
}

export function buildAgentStreamRuntimeSummaryItemUpdate(params: {
  activeSessionId: string;
  items: readonly AgentThreadItem[];
  pendingItemKey: string;
  summaryText: string;
  updatedAt: string;
}): AgentThreadTurnSummaryItem | null {
  const summaryItem = selectAgentStreamRuntimeSummaryItem(params);
  if (!summaryItem) {
    return null;
  }

  return {
    ...summaryItem,
    text: params.summaryText,
    updated_at: params.updatedAt,
  };
}
