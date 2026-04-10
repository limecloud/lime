import type { Message, SiteSavedContentTarget } from "../types";
import {
  resolveSiteSavedContentTargetFromMetadata,
} from "./siteToolResultSummary";

export interface LatestSavedSiteContentTargetMatch {
  messageId: string;
  toolCallId: string;
  messageTimestampMs: number;
  target: SiteSavedContentTarget;
}

function collectAssistantToolCalls(
  message: Message,
): NonNullable<Message["toolCalls"]> {
  const merged = new Map<string, NonNullable<Message["toolCalls"]>[number]>();

  for (const toolCall of message.toolCalls || []) {
    merged.set(toolCall.id, toolCall);
  }

  for (const part of message.contentParts || []) {
    if (part.type !== "tool_use") {
      continue;
    }
    merged.set(part.toolCall.id, part.toolCall);
  }

  return Array.from(merged.values());
}

export function resolveLatestProjectFileSavedSiteContentTargetFromMessage(
  message: Message,
): SiteSavedContentTarget | null {
  if (message.role !== "assistant") {
    return null;
  }

  const toolCalls = collectAssistantToolCalls(message);
  for (let toolIndex = toolCalls.length - 1; toolIndex >= 0; toolIndex -= 1) {
    const toolCall = toolCalls[toolIndex];
    if (toolCall.status !== "completed") {
      continue;
    }

    const target = resolveSiteSavedContentTargetFromMetadata(
      toolCall.result?.metadata,
    );
    if (target?.preferredTarget !== "project_file") {
      continue;
    }

    return target;
  }

  return null;
}

export function resolveLatestProjectFileSavedSiteContentTargetFromMessages(
  messages: Message[],
): LatestSavedSiteContentTargetMatch | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message.role !== "assistant") {
      continue;
    }

    const toolCalls = collectAssistantToolCalls(message);
    for (let toolIndex = toolCalls.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const toolCall = toolCalls[toolIndex];
      if (toolCall.status !== "completed") {
        continue;
      }

      const target = resolveSiteSavedContentTargetFromMetadata(
        toolCall.result?.metadata,
      );
      if (target?.preferredTarget !== "project_file") {
        continue;
      }

      return {
        messageId: message.id,
        toolCallId: toolCall.id,
        messageTimestampMs: message.timestamp.getTime(),
        target,
      };
    }
  }

  return null;
}
