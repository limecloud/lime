import type { Message } from "../types";

export interface MessageTurnGroup {
  id: string;
  messages: Message[];
  userMessage: Message | null;
  assistantMessages: Message[];
  startedAt: Date;
  endedAt: Date;
}

function createGroup(seed: Message): MessageTurnGroup {
  return {
    id: `turn-group:${seed.id}`,
    messages: [seed],
    userMessage: seed.role === "user" ? seed : null,
    assistantMessages: seed.role === "assistant" ? [seed] : [],
    startedAt: seed.timestamp,
    endedAt: seed.timestamp,
  };
}

export function buildMessageTurnGroups(messages: Message[]): MessageTurnGroup[] {
  const groups: MessageTurnGroup[] = [];
  let current: MessageTurnGroup | null = null;

  for (const message of messages) {
    if (!current) {
      current = createGroup(message);
      continue;
    }

    if (message.role === "user") {
      groups.push(current);
      current = createGroup(message);
      continue;
    }

    current.messages.push(message);
    current.assistantMessages.push(message);
    current.endedAt = message.timestamp;
  }

  if (current) {
    groups.push(current);
  }

  return groups;
}
