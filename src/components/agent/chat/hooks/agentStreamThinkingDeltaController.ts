import type { Message } from "../types";
import { appendTextWithOverlapDetection } from "./agentChatHistory";

type MessageParts = NonNullable<Message["contentParts"]>;

export type AgentStreamThinkingPartsAppender = (
  parts: MessageParts,
  textDelta: string,
) => MessageParts;

export interface AgentStreamThinkingDeltaPreApplyPlan {
  shouldActivateStream: boolean;
  shouldApplyThinkingDelta: boolean;
}

export function buildAgentStreamThinkingDeltaPreApplyPlan(params: {
  surfaceThinkingDeltas: boolean;
}): AgentStreamThinkingDeltaPreApplyPlan {
  return {
    shouldActivateStream: true,
    shouldApplyThinkingDelta: params.surfaceThinkingDeltas,
  };
}

export function buildAgentStreamThinkingDeltaMessagePatch(params: {
  appendThinkingToParts: AgentStreamThinkingPartsAppender;
  contentParts?: Message["contentParts"];
  textDelta: string;
  thinkingContent?: string;
}): Pick<Message, "contentParts" | "isThinking" | "thinkingContent"> {
  return {
    isThinking: true,
    thinkingContent: appendTextWithOverlapDetection(
      params.thinkingContent || "",
      params.textDelta,
    ),
    contentParts: params.appendThinkingToParts(
      params.contentParts || [],
      params.textDelta,
    ),
  };
}
