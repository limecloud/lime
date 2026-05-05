import type { AsterSessionDetail } from "@/lib/api/agentRuntime";
import { normalizeLegacyThreadItems } from "@/lib/api/agentTextNormalization";
import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import {
  filterConversationThreadItems,
  mergeThreadItems,
  mergeThreadTurns,
} from "../utils/threadTimelineView";
import {
  hydrateSessionDetailMessages,
  mergeHydratedMessagesWithLocalState,
  shouldCompactCompletedSessionHistory,
} from "./agentChatHistory";

export interface SessionHistoryMergePlan {
  currentTurnId: string | null;
  incomingMessages: Message[];
  mergedMessages: Message[];
  mergedThreadItems: AgentThreadItem[];
  mergedThreadTurns: AgentThreadTurn[];
}

export function buildSessionHistoryMergePlan(params: {
  currentMessages: Message[];
  currentThreadItems: AgentThreadItem[];
  currentThreadTurns: AgentThreadTurn[];
  currentTurnId: string | null;
  detail: AsterSessionDetail;
  sessionId: string;
}): SessionHistoryMergePlan {
  const incomingMessages = hydrateSessionDetailMessages(
    params.detail,
    params.sessionId,
    {
      compactCompletedHistory: shouldCompactCompletedSessionHistory(
        params.detail,
      ),
    },
  );
  const mergedMessages = mergeHydratedMessagesWithLocalState(
    params.currentMessages,
    incomingMessages,
  );
  const mergedThreadTurns = mergeThreadTurns(
    params.currentThreadTurns,
    params.detail.turns || [],
  );
  const mergedThreadItems = filterConversationThreadItems(
    mergeThreadItems(
      params.currentThreadItems,
      normalizeLegacyThreadItems(params.detail.items || []),
    ),
  );

  return {
    currentTurnId:
      mergedThreadTurns.length > 0
        ? mergedThreadTurns[mergedThreadTurns.length - 1]?.id || null
        : params.currentTurnId,
    incomingMessages,
    mergedMessages,
    mergedThreadItems,
    mergedThreadTurns,
  };
}
