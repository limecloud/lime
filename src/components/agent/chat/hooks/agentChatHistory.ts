import type { ContextTraceStep } from "@/lib/api/agentStream";
import type { Message, MessageImage, ContentPart } from "../types";
import type { AsterSessionDetail } from "@/lib/api/agentRuntime";
import { mergeArtifacts } from "../utils/messageArtifacts";
import {
  extractLimeToolMetadataBlock,
  isToolResultSuccessful,
  normalizeHistoryImagePart,
  normalizeToolResultImages,
  normalizeToolResultMetadata,
  resolveHistoryUserDataText,
  stringifyToolArguments,
} from "./agentChatToolResult";
import {
  sanitizeContentPartsForDisplay,
  sanitizeMessageTextForDisplay,
} from "../utils/internalImagePlaceholder";

export const normalizeHistoryPartType = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
};

export const normalizeHistoryMessage = (message: Message): Message | null => {
  if (message.role !== "user") return message;

  const text = message.content.trim();
  const hasImages = Array.isArray(message.images) && message.images.length > 0;
  if (text.length > 0 || hasImages) return message;

  const hasToolCalls =
    Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
  const hasOnlyToolUseParts =
    Array.isArray(message.contentParts) &&
    message.contentParts.length > 0 &&
    message.contentParts.every((part) => part.type === "tool_use");

  if (hasToolCalls || hasOnlyToolUseParts) {
    return {
      ...message,
      role: "assistant",
    };
  }

  return null;
};

export const normalizeHistoryMessages = (messages: Message[]): Message[] =>
  messages
    .map((msg) => normalizeHistoryMessage(msg))
    .filter((msg): msg is Message => msg !== null);

export const hasLegacyFallbackToolNames = (messages: Message[]): boolean =>
  messages.some((message) =>
    (message.toolCalls || []).some((toolCall) =>
      /^工具调用\s+call_[0-9a-z]+$/i.test(toolCall.name.trim()),
    ),
  );

export const resolveHistoryToolName = (
  toolId: string,
  nameById: Map<string, string>,
): string => {
  const existing = nameById.get(toolId);
  if (existing && existing.trim()) {
    return existing.trim();
  }
  const shortId = toolId.trim().slice(0, 8);
  return shortId ? `工具调用 ${shortId}` : "工具调用";
};

export const appendTextToParts = (
  parts: ContentPart[],
  text: string,
): ContentPart[] => {
  const newParts = [...parts];
  const lastPart = newParts[newParts.length - 1];

  if (lastPart && lastPart.type === "text") {
    newParts[newParts.length - 1] = {
      type: "text",
      text: lastPart.text + text,
    };
  } else {
    newParts.push({ type: "text", text });
  }
  return newParts;
};

export const appendThinkingToHistoryParts = (
  parts: ContentPart[],
  text: string,
): ContentPart[] => {
  if (!text) {
    return parts;
  }

  const nextParts = [...parts];
  const lastPart = nextParts[nextParts.length - 1];

  if (lastPart?.type === "thinking") {
    nextParts[nextParts.length - 1] = {
      type: "thinking",
      text: lastPart.text + text,
    };
    return nextParts;
  }

  nextParts.push({
    type: "thinking",
    text,
  });
  return nextParts;
};

export const extractThinkingContentFromParts = (
  parts?: ContentPart[],
): string | undefined => {
  if (!parts || parts.length === 0) {
    return undefined;
  }

  const thinkingText = parts
    .filter(
      (part): part is Extract<ContentPart, { type: "thinking" }> =>
        part.type === "thinking",
    )
    .map((part) => part.text)
    .join("");

  return thinkingText || undefined;
};

export const mergeAdjacentAssistantMessages = (messages: Message[]): Message[] => {
  const merged: Message[] = [];

  for (const current of messages) {
    if (merged.length === 0) {
      merged.push(current);
      continue;
    }

    const previous = merged[merged.length - 1];
    if (
      !previous ||
      previous.role !== "assistant" ||
      current.role !== "assistant"
    ) {
      merged.push(current);
      continue;
    }

    const content = [previous.content.trim(), current.content.trim()]
      .filter(Boolean)
      .join("\n\n");
    const contentParts = (() => {
      const nextParts: ContentPart[] = [...(previous.contentParts || [])];
      for (const part of current.contentParts || []) {
        if (part.type === "tool_use") {
          const existingIndex = nextParts.findIndex(
            (item) =>
              item.type === "tool_use" && item.toolCall.id === part.toolCall.id,
          );
          if (existingIndex >= 0) {
            nextParts[existingIndex] = part;
            continue;
          }
          nextParts.push(part);
          continue;
        }

        if (part.type === "action_required") {
          const existingIndex = nextParts.findIndex(
            (item) =>
              item.type === "action_required" &&
              item.actionRequired.requestId === part.actionRequired.requestId,
          );
          if (existingIndex >= 0) {
            nextParts[existingIndex] = part;
            continue;
          }
          nextParts.push(part);
          continue;
        }

        nextParts.push(part);
      }
      return nextParts;
    })();
    const toolCallMap = new Map<
      string,
      NonNullable<Message["toolCalls"]>[number]
    >();
    for (const toolCall of [
      ...(previous.toolCalls || []),
      ...(current.toolCalls || []),
    ]) {
      toolCallMap.set(toolCall.id, toolCall);
    }
    const toolCalls = Array.from(toolCallMap.values());
    const contextTrace = (() => {
      const seen = new Set<string>();
      const mergedSteps: ContextTraceStep[] = [];
      for (const step of [
        ...(previous.contextTrace || []),
        ...(current.contextTrace || []),
      ]) {
        const key = `${step.stage}::${step.detail}`;
        if (!seen.has(key)) {
          seen.add(key);
          mergedSteps.push(step);
        }
      }
      return mergedSteps;
    })();
    const artifacts = mergeArtifacts([
      ...(previous.artifacts || []),
      ...(current.artifacts || []),
    ]);

    merged[merged.length - 1] = {
      ...previous,
      content,
      contentParts: contentParts.length > 0 ? contentParts : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      contextTrace: contextTrace.length > 0 ? contextTrace : undefined,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
      timestamp: current.timestamp,
      isThinking: false,
      thinkingContent: extractThinkingContentFromParts(contentParts),
    };
  }

  return merged;
};

const normalizeSignatureText = (text: string): string =>
  text.replace(/\s+/g, " ").trim();

const hasMessageImages = (message: Message): boolean =>
  Array.isArray(message.images) && message.images.length > 0;

const findMatchingLocalUserMessageIndex = (
  localUserMessages: Message[],
  targetMessage: Message,
  startIndex: number,
): number => {
  const targetContent = normalizeSignatureText(targetMessage.content || "");

  for (let index = startIndex; index < localUserMessages.length; index += 1) {
    const candidate = localUserMessages[index];
    if (!candidate) {
      continue;
    }

    const candidateContent = normalizeSignatureText(candidate.content || "");
    if (candidateContent === targetContent) {
      return index;
    }
  }

  return -1;
};

export const mergeHydratedMessagesWithLocalState = (
  localMessages: Message[],
  hydratedMessages: Message[],
): Message[] => {
  const localUserMessages = localMessages.filter(
    (message) => message.role === "user",
  );

  if (localUserMessages.length === 0 || hydratedMessages.length === 0) {
    return hydratedMessages;
  }

  let localUserCursor = 0;

  return hydratedMessages.map((message) => {
    if (message.role !== "user") {
      return message;
    }

    const matchedIndex = findMatchingLocalUserMessageIndex(
      localUserMessages,
      message,
      localUserCursor,
    );
    if (matchedIndex < 0) {
      return message;
    }

    localUserCursor = matchedIndex + 1;
    const localMessage = localUserMessages[matchedIndex];
    if (!localMessage || hasMessageImages(message) || !hasMessageImages(localMessage)) {
      return message;
    }

    return {
      ...message,
      images: localMessage.images,
    };
  });
};

const messageImageSignature = (images?: MessageImage[]): string => {
  if (!images || images.length === 0) return "";
  return images
    .map((image) => `${image.mediaType}:${image.data.slice(0, 64)}`)
    .join("|");
};

const messageToolCallsSignature = (
  toolCalls?: Message["toolCalls"],
): string => {
  if (!toolCalls || toolCalls.length === 0) return "";
  return toolCalls
    .map((toolCall) => {
      const output = toolCall.result?.output
        ? normalizeSignatureText(toolCall.result.output)
        : "";
      const error = toolCall.result?.error
        ? normalizeSignatureText(toolCall.result.error)
        : "";
      return `${toolCall.id}:${toolCall.status}:${toolCall.name}:${output}:${error}`;
    })
    .join("|");
};

const messageContentPartsSignature = (parts?: ContentPart[]): string => {
  if (!parts || parts.length === 0) return "";
  return parts
    .map((part) => {
      if (part.type === "text" || part.type === "thinking") {
        return `${part.type}:${normalizeSignatureText(part.text)}`;
      }
      if (part.type === "tool_use") {
        const output = part.toolCall.result?.output
          ? normalizeSignatureText(part.toolCall.result.output)
          : "";
        const error = part.toolCall.result?.error
          ? normalizeSignatureText(part.toolCall.result.error)
          : "";
        return `tool_use:${part.toolCall.id}:${part.toolCall.status}:${part.toolCall.name}:${output}:${error}`;
      }
      const prompt = part.actionRequired.prompt
        ? normalizeSignatureText(part.actionRequired.prompt)
        : "";
      return `action_required:${part.actionRequired.requestId}:${part.actionRequired.actionType}:${prompt}`;
    })
    .join("|");
};

const messageArtifactsSignature = (artifacts?: Message["artifacts"]): string => {
  if (!artifacts || artifacts.length === 0) return "";
  return artifacts
    .map((artifact) => {
      const filePath =
        typeof artifact.meta.filePath === "string" ? artifact.meta.filePath : "";
      return [
        artifact.id,
        artifact.type,
        artifact.status,
        normalizeSignatureText(artifact.title),
        normalizeSignatureText(filePath),
        normalizeSignatureText(artifact.content),
      ].join(":");
    })
    .join("|");
};

const buildHistoryMessageSignature = (message: Message): string => {
  return [
    message.role,
    normalizeSignatureText(message.content),
    messageImageSignature(message.images),
    messageToolCallsSignature(message.toolCalls),
    messageContentPartsSignature(message.contentParts),
    messageArtifactsSignature(message.artifacts),
  ].join("::");
};

export const dedupeAdjacentHistoryMessages = (messages: Message[]): Message[] => {
  const deduped: Message[] = [];
  let previousSignature: string | null = null;
  let previousTimestampMs: number | null = null;

  for (const message of messages) {
    const signature = buildHistoryMessageSignature(message);
    const timestampMs = message.timestamp.getTime();
    const isDuplicate =
      previousSignature === signature &&
      previousTimestampMs !== null &&
      Math.abs(timestampMs - previousTimestampMs) <= 5000;

    if (!isDuplicate) {
      deduped.push(message);
      previousSignature = signature;
      previousTimestampMs = timestampMs;
    }
  }

  return deduped;
};

export const hydrateSessionDetailMessages = (
  detail: AsterSessionDetail,
  topicId: string,
): Message[] => {
  const historyToolNameById = new Map<string, string>();

  const loadedMessages: Message[] = detail.messages
    .filter(
      (msg) =>
        msg.role === "user" || msg.role === "assistant" || msg.role === "tool",
    )
    .flatMap((msg, index) => {
      const contentParts: ContentPart[] = [];
      const textParts: string[] = [];
      const toolCalls: Message["toolCalls"] = [];
      const images: MessageImage[] = [];
      const messageTimestamp = new Date(msg.timestamp * 1000);
      const rawParts = Array.isArray(msg.content) ? msg.content : [];

      const appendText = (value: unknown) => {
        if (typeof value !== "string") return;
        const normalized = value.trim();
        if (!normalized) return;
        textParts.push(normalized);
        contentParts.push({ type: "text", text: normalized });
      };

      for (const rawPart of rawParts) {
        if (!rawPart || typeof rawPart !== "object") continue;
        const part = rawPart as unknown as Record<string, unknown>;
        const partType = normalizeHistoryPartType(part.type);

        if (
          partType === "text" ||
          partType === "input_text" ||
          partType === "output_text"
        ) {
          appendText(part.text ?? part.content);
          continue;
        }

        if (partType === "thinking" || partType === "reasoning") {
          const rawThinking =
            typeof part.thinking === "string"
              ? part.thinking
              : typeof part.reasoning === "string"
                ? part.reasoning
                : typeof part.text === "string"
                  ? part.text
                  : typeof part.content === "string"
                    ? part.content
                    : "";

          if (rawThinking) {
            const mergedThinkingParts = appendThinkingToHistoryParts(
              contentParts,
              rawThinking,
            );
            contentParts.splice(0, contentParts.length, ...mergedThinkingParts);
          }
          continue;
        }

        if (
          partType === "image" ||
          partType === "input_image" ||
          partType === "image_url"
        ) {
          const normalizedImage = normalizeHistoryImagePart(part);
          if (normalizedImage) {
            images.push(normalizedImage);
          }
          continue;
        }

        if (partType === "tool_request") {
          if (!part.id || typeof part.id !== "string") continue;
          const nestedToolCall =
            part.toolCall && typeof part.toolCall === "object"
              ? (part.toolCall as Record<string, unknown>)
              : part.tool_call && typeof part.tool_call === "object"
                ? (part.tool_call as Record<string, unknown>)
                : undefined;
          const nestedToolCallValue =
            nestedToolCall?.value && typeof nestedToolCall.value === "object"
              ? (nestedToolCall.value as Record<string, unknown>)
              : undefined;
          const toolName =
            (typeof part.tool_name === "string" && part.tool_name.trim()) ||
            (typeof part.toolName === "string" && part.toolName.trim()) ||
            (typeof part.name === "string" && part.name.trim()) ||
            (typeof nestedToolCallValue?.name === "string" &&
              nestedToolCallValue.name.trim()) ||
            resolveHistoryToolName(part.id, historyToolNameById);
          const rawArguments =
            part.arguments ??
            nestedToolCallValue?.arguments ??
            nestedToolCall?.arguments;
          const toolCall = {
            id: part.id,
            name: toolName,
            arguments: stringifyToolArguments(rawArguments),
            status: "running" as const,
            startTime: messageTimestamp,
          };
          historyToolNameById.set(part.id, toolName);
          toolCalls.push(toolCall);
          contentParts.push({ type: "tool_use", toolCall });
          continue;
        }

        if (partType === "tool_response") {
          if (!part.id || typeof part.id !== "string") continue;
          const toolName = resolveHistoryToolName(part.id, historyToolNameById);
          const rawOutputText = typeof part.output === "string" ? part.output : "";
          const rawErrorText = typeof part.error === "string" ? part.error : "";
          const normalizedOutput =
            extractLimeToolMetadataBlock(rawOutputText);
          const normalizedError =
            extractLimeToolMetadataBlock(rawErrorText);
          const normalizedResult = {
            success: part.success !== false,
            output: normalizedOutput.text,
            error: normalizedError.text || undefined,
            images: normalizeToolResultImages(part.images, normalizedOutput.text),
            metadata: normalizeToolResultMetadata(
              part.metadata,
              rawOutputText,
              rawErrorText,
            ),
          };
          const success = isToolResultSuccessful(normalizedResult);
          const toolCall = {
            id: part.id,
            name: toolName,
            status: success ? ("completed" as const) : ("failed" as const),
            startTime: messageTimestamp,
            endTime: messageTimestamp,
            result: {
              ...normalizedResult,
              success,
            },
          };
          toolCalls.push(toolCall);
          contentParts.push({ type: "tool_use", toolCall });
          continue;
        }

        if (partType !== "action_required") continue;

        const actionType =
          typeof part.action_type === "string" ? part.action_type : "";
        if (actionType !== "elicitation_response") continue;

        const data =
          part.data && typeof part.data === "object"
            ? (part.data as Record<string, unknown>)
            : undefined;
        const userData =
          data && "user_data" in data ? data.user_data : part.data;
        const resolved = resolveHistoryUserDataText(userData);
        if (!resolved) continue;

        textParts.push(resolved);
        contentParts.push({ type: "text", text: resolved });
      }

      const rawContent = textParts.join("\n").trim();
      let normalizedRole =
        msg.role === "tool" ? "assistant" : (msg.role as "user" | "assistant");
      const content = sanitizeMessageTextForDisplay(rawContent, {
        role: normalizedRole,
        hasImages: images.length > 0,
      });
      const sanitizedContentParts =
        sanitizeContentPartsForDisplay(contentParts, {
          role: normalizedRole,
          hasImages: images.length > 0,
        }) || [];
      const hasToolMetadata =
        toolCalls.length > 0 ||
        sanitizedContentParts.some((part) => part.type === "tool_use");

      if (normalizedRole === "user" && !content && images.length === 0) {
        if (hasToolMetadata) {
          normalizedRole = "assistant";
        } else {
          return [];
        }
      }

      if (
        !content &&
        images.length === 0 &&
        sanitizedContentParts.length === 0 &&
        toolCalls.length === 0
      ) {
        return [];
      }

      return [
        {
          id: `${topicId}-${index}`,
          role: normalizedRole,
          content,
          images: images.length > 0 ? images : undefined,
          contentParts:
            sanitizedContentParts.length > 0
              ? sanitizedContentParts
              : undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          timestamp: messageTimestamp,
          isThinking: false,
          thinkingContent: extractThinkingContentFromParts(
            sanitizedContentParts,
          ),
        },
      ];
    });

  return mergeAdjacentAssistantMessages(
    dedupeAdjacentHistoryMessages(loadedMessages),
  );
};
