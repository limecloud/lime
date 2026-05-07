import { appendTextWithOverlapDetection } from "./agentChatHistory";
import {
  buildAgentStreamFirstTextDeltaMetricContext,
  shouldRecordAgentStreamFirstTextDelta,
} from "./agentStreamRuntimeMetricsController";

export interface AgentStreamTextDeltaApplyPlan {
  firstTextDeltaAt: number | null;
  firstTextDeltaContext: Record<string, unknown> | null;
  nextAccumulatedContent: string;
  nextBufferedCount: number;
}

export function buildAgentStreamTextDeltaApplyPlan(params: {
  activeSessionId: string;
  accumulatedContent: string;
  deltaText: string;
  eventName: string;
  firstEventReceivedAt?: number | null;
  firstRuntimeStatusAt?: number | null;
  firstTextDeltaAt?: number | null;
  now: number;
  requestStartedAt: number;
  metricDeltaText?: string;
  textDeltaBufferedCount?: number | null;
}): AgentStreamTextDeltaApplyPlan {
  const shouldRecordFirstTextDelta = shouldRecordAgentStreamFirstTextDelta({
    firstTextDeltaAt: params.firstTextDeltaAt,
  });
  const firstTextDeltaAt = shouldRecordFirstTextDelta ? params.now : null;

  return {
    firstTextDeltaAt,
    firstTextDeltaContext: firstTextDeltaAt
      ? buildAgentStreamFirstTextDeltaMetricContext({
          activeSessionId: params.activeSessionId,
          deltaText: params.metricDeltaText ?? params.deltaText,
          eventName: params.eventName,
          firstEventReceivedAt: params.firstEventReceivedAt,
          firstRuntimeStatusAt: params.firstRuntimeStatusAt,
          firstTextDeltaAt,
          requestStartedAt: params.requestStartedAt,
        })
      : null,
    nextAccumulatedContent: appendTextWithOverlapDetection(
      params.accumulatedContent,
      params.deltaText,
    ),
    nextBufferedCount: (params.textDeltaBufferedCount ?? 0) + 1,
  };
}
