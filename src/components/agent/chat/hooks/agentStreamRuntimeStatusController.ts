import type {
  AgentRuntimeStatusPayload,
  AgentThreadItem,
  AgentThreadTurnSummaryItem,
} from "@/lib/api/agentProtocol";
import type { AgentExecutionStrategy } from "@/lib/api/agentExecutionRuntime";
import { normalizeLegacyRuntimeStatusTitle } from "@/lib/api/agentTextNormalization";
import type { Message } from "../types";
import {
  buildWaitingAgentRuntimeStatus,
  formatAgentRuntimeStatusSummary,
} from "../utils/agentRuntimeStatus";

import {
  areJsonLikeValuesEqual,
  upsertThreadItemState,
} from "./agentThreadState";

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

export function buildAgentStreamProviderTraceRuntimeStatusApplyPlan(params: {
  executionStrategy: AgentExecutionStrategy;
  firstRuntimeStatusAt?: number | null;
  stage?: string | null;
  updatedAt: string;

}): AgentStreamRuntimeStatusApplyPlan | null {
  if (params.firstRuntimeStatusAt) {
    return null;
  }
  if (
    params.stage !== "request_started" &&
    params.stage !== "first_event_received"
  ) {
    return null;
  }

  return buildAgentStreamRuntimeStatusApplyPlan({
    status: buildWaitingAgentRuntimeStatus({
      executionStrategy: params.executionStrategy,

    }),
    updatedAt: params.updatedAt,
  });
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

  const fallbackItem = [...params.items]
    .reverse()
    .find(
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
  if (summaryItem.text === params.summaryText) {
    return null;
  }

  return {
    ...summaryItem,
    text: params.summaryText,
    updated_at: params.updatedAt,
  };
}

export function applyAgentStreamRuntimeStatusToThreadItems(params: {
  activeSessionId: string;
  items: AgentThreadItem[];
  pendingItemKey: string;
  plan: AgentStreamRuntimeStatusApplyPlan;
}): AgentThreadItem[] | null {
  const runtimeSummaryItem = buildAgentStreamRuntimeSummaryItemUpdate({
    activeSessionId: params.activeSessionId,
    items: params.items,
    pendingItemKey: params.pendingItemKey,
    summaryText: params.plan.summaryText,
    updatedAt: params.plan.updatedAt,
  });
  if (!runtimeSummaryItem) {
    return null;
  }

  return upsertThreadItemState(params.items, runtimeSummaryItem);
}

export function applyAgentStreamRuntimeStatusToMessages(params: {
  assistantMsgId: string;
  messages: Message[];
  plan: AgentStreamRuntimeStatusApplyPlan;
}): Message[] {
  let changed = false;
  const nextMessages = params.messages.map((msg) => {
    if (msg.id !== params.assistantMsgId) {
      return msg;
    }
    if (
      areJsonLikeValuesEqual(msg.runtimeStatus, params.plan.normalizedStatus)
    ) {
      return msg;
    }
    changed = true;
    return {
      ...msg,
      runtimeStatus: params.plan.normalizedStatus,
    };
  });
  return changed ? nextMessages : params.messages;
}
