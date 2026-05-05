import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import {
  buildMessageTurnTimeline,
  type MessageTurnTimeline,
} from "../utils/threadTimelineView";
import {
  buildMessageTurnGroups,
  type MessageTurnGroup,
} from "../utils/messageTurnGrouping";

export interface CurrentTurnTimelineProjection {
  messageId: string;
  turn: AgentThreadTurn;
  items: AgentThreadItem[];
}

export interface MessageRenderGroupProjection extends MessageTurnGroup {
  lastAssistantId: string | null;
  timeline: MessageTurnTimeline | CurrentTurnTimelineProjection | null;
  isActiveGroup: boolean;
}

export function buildTimelineByMessageIdProjection(params: {
  canBuildHistoricalTimeline: boolean;
  renderedMessages: Message[];
  renderedTurns: AgentThreadTurn[];
  renderedThreadItems: AgentThreadItem[];
}): Map<string, MessageTurnTimeline> {
  if (!params.canBuildHistoricalTimeline) {
    return new Map<string, MessageTurnTimeline>();
  }

  return buildMessageTurnTimeline(
    params.renderedMessages,
    params.renderedTurns,
    params.renderedThreadItems,
  );
}

export function resolveLastAssistantMessage(
  renderedMessages: readonly Message[],
): Message | null {
  for (let index = renderedMessages.length - 1; index >= 0; index -= 1) {
    const message = renderedMessages[index];
    if (message?.role === "assistant") {
      return message;
    }
  }
  return null;
}

export function buildCurrentTurnTimelineProjection(params: {
  activeCurrentTurnId: string | null;
  activeCurrentTurn: AgentThreadTurn | null;
  lastAssistantMessageId: string | null;
  timelineByMessageId: Map<string, MessageTurnTimeline>;
  renderedThreadItems: AgentThreadItem[];
}): CurrentTurnTimelineProjection | null {
  if (
    !params.activeCurrentTurnId ||
    !params.activeCurrentTurn ||
    !params.lastAssistantMessageId
  ) {
    return null;
  }

  let mappedMessageId: string | null = null;
  for (const entry of params.timelineByMessageId.values()) {
    if (entry.turn.id === params.activeCurrentTurnId) {
      mappedMessageId = entry.messageId;
      break;
    }
  }

  return {
    messageId: mappedMessageId || params.lastAssistantMessageId,
    turn: params.activeCurrentTurn,
    items: params.renderedThreadItems.filter(
      (item) => item.turn_id === params.activeCurrentTurnId,
    ),
  };
}

export function buildMessageRenderGroupsProjection(params: {
  messageGroups: MessageTurnGroup[];
  timelineByMessageId: Map<string, MessageTurnTimeline>;
  currentTurnTimeline: CurrentTurnTimelineProjection | null;
  lastAssistantMessageId: string | null;
}): MessageRenderGroupProjection[] {
  return params.messageGroups.map((group) => {
    const lastAssistantId =
      group.assistantMessages[group.assistantMessages.length - 1]?.id ?? null;
    let mappedTimeline: MessageTurnTimeline | null = null;
    for (const message of group.assistantMessages) {
      mappedTimeline = params.timelineByMessageId.get(message.id) ?? null;
      if (mappedTimeline) {
        break;
      }
    }
    const isCurrentTurnGroup =
      Boolean(lastAssistantId) &&
      params.currentTurnTimeline?.messageId === lastAssistantId;
    const isActiveGroup =
      Boolean(lastAssistantId) &&
      lastAssistantId === params.lastAssistantMessageId;
    const timeline = isCurrentTurnGroup
      ? params.currentTurnTimeline
      : mappedTimeline;

    return {
      ...group,
      lastAssistantId,
      timeline,
      isActiveGroup,
    };
  });
}

export function buildMessageGroupsProjection(
  renderedMessages: Message[],
): MessageTurnGroup[] {
  return buildMessageTurnGroups(renderedMessages);
}
