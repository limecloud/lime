import type { Message } from "../types";

export interface ConversationTranscriptLabels {
  user: string;
  assistant: string;
  separator: string;
}

export function buildConversationTranscript(
  messages: readonly Message[],
  labels: ConversationTranscriptLabels,
): string {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => {
      const role =
        message.role === "user" ? labels.user : labels.assistant;
      return `${role}:\n${message.content.trim()}`;
    })
    .join(labels.separator);
}
