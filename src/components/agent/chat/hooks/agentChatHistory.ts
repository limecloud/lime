import type {
  AgentContextTraceStep as ContextTraceStep,
  AgentTokenUsage,
} from "@/lib/api/agentProtocol";
import type {
  ContentPart,
  Message,
  MessageImage,
  MessageImageWorkbenchPreview,
  MessageTaskPreview,
} from "../types";
import type { AsterSessionDetail } from "@/lib/api/agentRuntime";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import { mergeArtifacts } from "../utils/messageArtifacts";
import {
  buildImageTaskPreviewFromToolResult,
  buildTaskPreviewFromToolResult,
} from "../utils/taskPreviewFromToolResult";
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

const normalizeHistoryUsage = (usage: unknown): AgentTokenUsage | undefined => {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const inputTokens = (usage as { input_tokens?: unknown }).input_tokens;
  const outputTokens = (usage as { output_tokens?: unknown }).output_tokens;
  const cachedInputTokens = (usage as { cached_input_tokens?: unknown })
    .cached_input_tokens;
  const cacheCreationInputTokens = (
    usage as { cache_creation_input_tokens?: unknown }
  ).cache_creation_input_tokens;
  if (
    typeof inputTokens !== "number" ||
    typeof outputTokens !== "number" ||
    !Number.isFinite(inputTokens) ||
    !Number.isFinite(outputTokens) ||
    inputTokens < 0 ||
    outputTokens < 0
  ) {
    return undefined;
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens:
      typeof cachedInputTokens === "number" &&
      Number.isFinite(cachedInputTokens) &&
      cachedInputTokens >= 0
        ? cachedInputTokens
        : undefined,
    cache_creation_input_tokens:
      typeof cacheCreationInputTokens === "number" &&
      Number.isFinite(cacheCreationInputTokens) &&
      cacheCreationInputTokens >= 0
        ? cacheCreationInputTokens
        : undefined,
  };
};

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

function mergeImageWorkbenchPreview(
  previous?: MessageImageWorkbenchPreview,
  next?: MessageImageWorkbenchPreview,
): MessageImageWorkbenchPreview | undefined {
  if (!previous) {
    return next;
  }
  if (!next) {
    return previous;
  }
  if (previous.taskId !== next.taskId) {
    return next;
  }
  return {
    ...previous,
    ...next,
  };
}

function mergeTaskPreview(
  previous?: MessageTaskPreview,
  next?: MessageTaskPreview,
): MessageTaskPreview | undefined {
  if (!previous) {
    return next;
  }
  if (!next) {
    return previous;
  }
  if (previous.taskId !== next.taskId) {
    return next;
  }
  return {
    ...previous,
    ...next,
  };
}

function contentPartContainsProcess(part: ContentPart): boolean {
  return part.type !== "text";
}

function mergeByKey<T>(
  localItems: T[] | undefined,
  remoteItems: T[] | undefined,
  getKey: (item: T) => string,
): T[] | undefined {
  const local = Array.isArray(localItems) ? localItems : [];
  const remote = Array.isArray(remoteItems) ? remoteItems : [];

  if (local.length === 0) {
    return remote.length > 0 ? remote : undefined;
  }
  if (remote.length === 0) {
    return local;
  }

  const merged = new Map<string, T>();
  for (const item of local) {
    merged.set(getKey(item), item);
  }
  for (const item of remote) {
    merged.set(getKey(item), item);
  }
  return Array.from(merged.values());
}

function mergeHydratedContentParts(
  localParts?: ContentPart[],
  remoteParts?: ContentPart[],
): ContentPart[] | undefined {
  const local = Array.isArray(localParts) ? localParts : [];
  const remote = Array.isArray(remoteParts) ? remoteParts : [];

  if (local.length === 0) {
    return remote.length > 0 ? remote : undefined;
  }
  if (remote.length === 0) {
    return local;
  }

  const localHasProcess = local.some(contentPartContainsProcess);
  const remoteHasProcess = remote.some(contentPartContainsProcess);
  if (localHasProcess && !remoteHasProcess) {
    return local;
  }

  return remote;
}

function hasRenderableAssistantTextContent(message: Message): boolean {
  if (message.role !== "assistant") {
    return false;
  }

  if (message.content.trim().length > 0) {
    return true;
  }

  return (message.contentParts || []).some(
    (part) => part.type === "text" && part.text.trim().length > 0,
  );
}

export function normalizeHistoricalTopicSnapshotMessage(
  message: Message,
): Message {
  if (
    message.role !== "assistant" ||
    message.isThinking ||
    !hasRenderableAssistantTextContent(message)
  ) {
    return message;
  }

  const visibleContentParts = (message.contentParts || []).filter(
    (part) => part.type === "text" || part.type === "action_required",
  );
  const contentText = message.content.trim();
  const contentParts =
    visibleContentParts.length > 0
      ? visibleContentParts
      : contentText
        ? [{ type: "text", text: contentText } satisfies ContentPart]
        : undefined;

  return {
    ...message,
    thinkingContent: undefined,
    contentParts,
  };
}

export const normalizeHistoricalTopicSnapshotMessages = (
  messages: Message[],
): Message[] => messages.map(normalizeHistoricalTopicSnapshotMessage);

function normalizePreviewSignatureValue(value: unknown): string {
  if (typeof value === "string") {
    return normalizeSignatureText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function imageWorkbenchPreviewSignature(
  preview?: MessageImageWorkbenchPreview,
): string {
  if (!preview) {
    return "";
  }

  return [
    preview.taskId,
    preview.prompt,
    preview.mode,
    preview.status,
    preview.projectId,
    preview.contentId,
    preview.taskFilePath,
    preview.artifactPath,
    preview.imageUrl,
    preview.previewImages?.join("|"),
    preview.imageCount,
    preview.expectedImageCount,
    preview.layoutHint,
    preview.storyboardSlots
      ?.map((slot) =>
        [
          slot.slotId,
          slot.slotIndex,
          slot.label,
          slot.prompt,
          slot.shotType,
          slot.status,
        ]
          .map(normalizePreviewSignatureValue)
          .join("|"),
      )
      .join("||"),
    preview.sourceImageUrl,
    preview.sourceImagePrompt,
    preview.sourceImageRef,
    preview.sourceImageCount,
    preview.size,
    preview.phase,
    preview.statusMessage,
    preview.retryable,
    preview.attemptCount,
    preview.placeholderText,
  ]
    .map(normalizePreviewSignatureValue)
    .join(":");
}

function taskPreviewSignature(preview?: MessageTaskPreview): string {
  if (!preview) {
    return "";
  }

  const videoFields =
    preview.kind === "video_generate"
      ? [
          preview.videoUrl,
          preview.thumbnailUrl,
          preview.durationSeconds,
          preview.aspectRatio,
          preview.resolution,
          preview.progress,
          preview.retryable,
        ]
      : [];
  const metaItems =
    "metaItems" in preview && Array.isArray(preview.metaItems)
      ? preview.metaItems.map((item) => normalizeSignatureText(item)).join("|")
      : "";
  const imageCandidates =
    "imageCandidates" in preview && Array.isArray(preview.imageCandidates)
      ? preview.imageCandidates
          .map((candidate) =>
            [
              candidate.id,
              candidate.thumbnailUrl,
              candidate.contentUrl,
              candidate.hostPageUrl,
              candidate.width,
              candidate.height,
              candidate.name,
            ]
              .map(normalizePreviewSignatureValue)
              .join(":"),
          )
          .join("|")
      : "";

  return [
    preview.kind,
    preview.taskId,
    preview.taskType,
    preview.prompt,
    "title" in preview ? preview.title : "",
    preview.status,
    preview.projectId,
    preview.contentId,
    "artifactPath" in preview ? preview.artifactPath : "",
    "providerId" in preview ? preview.providerId : "",
    "model" in preview ? preview.model : "",
    preview.phase,
    preview.statusMessage,
    ...videoFields,
    metaItems,
    imageCandidates,
  ]
    .map(normalizePreviewSignatureValue)
    .join(":");
}

export const mergeAdjacentAssistantMessages = (
  messages: Message[],
): Message[] => {
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
    const imageWorkbenchPreview = mergeImageWorkbenchPreview(
      previous.imageWorkbenchPreview,
      current.imageWorkbenchPreview,
    );
    const taskPreview = mergeTaskPreview(
      previous.taskPreview,
      current.taskPreview,
    );

    merged[merged.length - 1] = {
      ...previous,
      content,
      contentParts: contentParts.length > 0 ? contentParts : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      contextTrace: contextTrace.length > 0 ? contextTrace : undefined,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
      usage: current.usage ?? previous.usage,
      imageWorkbenchPreview,
      taskPreview,
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

const findMatchingLocalAssistantMessageIndex = (
  localAssistantMessages: Message[],
  targetMessage: Message,
  startIndex: number,
): number => {
  const targetSignature = buildHistoryMessageSignature({
    ...targetMessage,
    usage: undefined,
  });

  for (
    let index = startIndex;
    index < localAssistantMessages.length;
    index += 1
  ) {
    const candidate = localAssistantMessages[index];
    if (!candidate) {
      continue;
    }

    const candidateSignature = buildHistoryMessageSignature({
      ...candidate,
      usage: undefined,
    });
    if (candidateSignature === targetSignature) {
      return index;
    }
  }

  const fallbackSignature = buildAssistantHydrationSignature(targetMessage);
  if (!fallbackSignature) {
    return -1;
  }

  for (
    let index = startIndex;
    index < localAssistantMessages.length;
    index += 1
  ) {
    const candidate = localAssistantMessages[index];
    if (!candidate) {
      continue;
    }

    const candidateSignature = buildAssistantHydrationSignature(candidate);
    if (candidateSignature === fallbackSignature) {
      return index;
    }
  }

  return -1;
};

function resolveMessageTimestampMs(message: Message): number | null {
  const timestampMs = message.timestamp.getTime();
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function hasRetainableLocalMessageState(message: Message): boolean {
  if (message.role === "user") {
    return message.content.trim().length > 0 || hasMessageImages(message);
  }

  return (
    Boolean(message.thinkingContent?.trim()) ||
    (message.contentParts || []).some(contentPartContainsProcess) ||
    (message.toolCalls?.length || 0) > 0 ||
    (message.actionRequests?.length || 0) > 0 ||
    (message.contextTrace?.length || 0) > 0 ||
    (message.artifacts?.length || 0) > 0 ||
    Boolean(message.imageWorkbenchPreview) ||
    Boolean(message.taskPreview) ||
    Boolean(message.runtimeStatus) ||
    message.content.trim().length > 0
  );
}

export const mergeHydratedMessagesWithLocalState = (
  localMessages: Message[],
  hydratedMessages: Message[],
): Message[] => {
  if (hydratedMessages.length === 0) {
    return localMessages;
  }

  const localUserMessages = localMessages.filter(
    (message) => message.role === "user",
  );
  const localAssistantMessages = localMessages.filter(
    (message) => message.role === "assistant",
  );
  const localUserMessageIndexById = new Map<string, number>();
  const localAssistantMessageIndexById = new Map<string, number>();
  const localImagePreviewByTaskId = new Map<
    string,
    MessageImageWorkbenchPreview
  >();
  const localTaskPreviewByTaskId = new Map<string, MessageTaskPreview>();
  const hydratedMessageIds = new Set<string>();

  localUserMessages.forEach((message, index) => {
    if (message.id) {
      localUserMessageIndexById.set(message.id, index);
    }
  });
  localAssistantMessages.forEach((message, index) => {
    if (message.id) {
      localAssistantMessageIndexById.set(message.id, index);
    }
  });
  hydratedMessages.forEach((message) => {
    if (message.id) {
      hydratedMessageIds.add(message.id);
    }
  });

  localMessages.forEach((message) => {
    if (message.role !== "assistant") {
      return;
    }

    const imageTaskId = message.imageWorkbenchPreview?.taskId;
    if (imageTaskId) {
      localImagePreviewByTaskId.set(
        imageTaskId,
        message.imageWorkbenchPreview as MessageImageWorkbenchPreview,
      );
    }

    const taskPreviewId = message.taskPreview?.taskId;
    if (taskPreviewId) {
      localTaskPreviewByTaskId.set(
        taskPreviewId,
        message.taskPreview as MessageTaskPreview,
      );
    }
  });

  if (
    localUserMessages.length === 0 &&
    localAssistantMessages.length === 0 &&
    localImagePreviewByTaskId.size === 0 &&
    localTaskPreviewByTaskId.size === 0
  ) {
    return hydratedMessages;
  }

  let localUserCursor = 0;
  let localAssistantCursor = 0;
  const matchedLocalMessageIds = new Set<string>();

  const mergedMessages = hydratedMessages.map((message) => {
    if (message.role === "assistant") {
      const matchedAssistantIndexById = message.id
        ? (localAssistantMessageIndexById.get(message.id) ?? -1)
        : -1;
      const matchedAssistantIndex =
        matchedAssistantIndexById >= 0
          ? matchedAssistantIndexById
          : findMatchingLocalAssistantMessageIndex(
              localAssistantMessages,
              message,
              localAssistantCursor,
            );
      const localAssistantMessage =
        matchedAssistantIndex >= 0
          ? localAssistantMessages[matchedAssistantIndex]
          : undefined;
      if (matchedAssistantIndex >= 0) {
        localAssistantCursor = Math.max(
          localAssistantCursor,
          matchedAssistantIndex + 1,
        );
        if (localAssistantMessage?.id) {
          matchedLocalMessageIds.add(localAssistantMessage.id);
        }
      }

      const localImagePreview =
        (message.imageWorkbenchPreview?.taskId
          ? localImagePreviewByTaskId.get(message.imageWorkbenchPreview.taskId)
          : undefined) ?? localAssistantMessage?.imageWorkbenchPreview;
      const localTaskPreview =
        (message.taskPreview?.taskId
          ? localTaskPreviewByTaskId.get(message.taskPreview.taskId)
          : undefined) ?? localAssistantMessage?.taskPreview;

      if (!localImagePreview && !localTaskPreview && !localAssistantMessage) {
        return message;
      }

      const shouldRetainLocalProcessState =
        !hasRenderableAssistantTextContent(message);
      const contentParts = shouldRetainLocalProcessState
        ? mergeHydratedContentParts(
            localAssistantMessage?.contentParts,
            message.contentParts,
          )
        : message.contentParts;
      const toolCalls = mergeByKey(
        localAssistantMessage?.toolCalls,
        message.toolCalls,
        (toolCall) => toolCall.id,
      );
      const actionRequests = mergeByKey(
        localAssistantMessage?.actionRequests,
        message.actionRequests,
        (request) => request.requestId,
      );
      const contextTrace = mergeByKey(
        localAssistantMessage?.contextTrace,
        message.contextTrace,
        (step) => `${step.stage}::${step.detail}`,
      );
      const artifacts = (() => {
        const localArtifacts = localAssistantMessage?.artifacts || [];
        const remoteArtifacts = message.artifacts || [];
        if (localArtifacts.length === 0) {
          return remoteArtifacts.length > 0 ? remoteArtifacts : undefined;
        }
        if (remoteArtifacts.length === 0) {
          return localArtifacts;
        }
        const merged = mergeArtifacts([...localArtifacts, ...remoteArtifacts]);
        return merged.length > 0 ? merged : undefined;
      })();
      const thinkingContent =
        message.thinkingContent ??
        (shouldRetainLocalProcessState
          ? localAssistantMessage?.thinkingContent
          : undefined) ??
        extractThinkingContentFromParts(contentParts);

      return {
        ...message,
        usage: message.usage ?? localAssistantMessage?.usage,
        contentParts,
        toolCalls,
        actionRequests,
        contextTrace,
        artifacts,
        thinkingContent,
        imageWorkbenchPreview: mergeImageWorkbenchPreview(
          localImagePreview,
          message.imageWorkbenchPreview,
        ),
        taskPreview: mergeTaskPreview(localTaskPreview, message.taskPreview),
      };
    }

    if (message.role !== "user") {
      return message;
    }

    const matchedIndexById = message.id
      ? (localUserMessageIndexById.get(message.id) ?? -1)
      : -1;
    const matchedIndex =
      matchedIndexById >= 0
        ? matchedIndexById
        : findMatchingLocalUserMessageIndex(
            localUserMessages,
            message,
            localUserCursor,
          );
    if (matchedIndex < 0) {
      return message;
    }

    localUserCursor = Math.max(localUserCursor, matchedIndex + 1);
    const localMessage = localUserMessages[matchedIndex];
    if (localMessage?.id) {
      matchedLocalMessageIds.add(localMessage.id);
    }
    if (
      !localMessage ||
      hasMessageImages(message) ||
      !hasMessageImages(localMessage)
    ) {
      return message;
    }

    return {
      ...message,
      images: localMessage.images,
    };
  });

  const lastHydratedMessage =
    hydratedMessages.length > 0
      ? (hydratedMessages[hydratedMessages.length - 1] as Message)
      : null;
  const lastHydratedTimestampMs = lastHydratedMessage
    ? resolveMessageTimestampMs(lastHydratedMessage)
    : null;
  const lastMatchedLocalIndex = localMessages.reduce((latest, message, index) => {
    if (!matchedLocalMessageIds.has(message.id)) {
      return latest;
    }
    return index;
  }, -1);
  const lastMatchedLocalMessage =
    lastMatchedLocalIndex >= 0 ? localMessages[lastMatchedLocalIndex] : null;
  const retainedLocalTail = localMessages.filter((message, index) => {
    if (hydratedMessageIds.has(message.id)) {
      return false;
    }
    if (matchedLocalMessageIds.has(message.id)) {
      return false;
    }
    if (index <= lastMatchedLocalIndex) {
      return false;
    }
    if (!hasRetainableLocalMessageState(message)) {
      return false;
    }

    const shouldRetainAssistantTailAfterHydratedUser =
      message.role === "assistant" &&
      lastHydratedMessage?.role === "user" &&
      lastMatchedLocalMessage?.role === "user";
    if (shouldRetainAssistantTailAfterHydratedUser) {
      return true;
    }

    const localTimestampMs = resolveMessageTimestampMs(message);
    if (lastHydratedTimestampMs === null || localTimestampMs === null) {
      return true;
    }

    return localTimestampMs >= lastHydratedTimestampMs;
  });

  return retainedLocalTail.length > 0
    ? [...mergedMessages, ...retainedLocalTail]
    : mergedMessages;
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

const messageArtifactsSignature = (
  artifacts?: Message["artifacts"],
): string => {
  if (!artifacts || artifacts.length === 0) return "";
  return artifacts
    .map((artifact) => {
      const filePath = resolveArtifactProtocolFilePath(artifact);
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

const buildAssistantHydrationSignature = (message: Message): string => {
  const contentSignature = normalizeSignatureText(message.content);
  const imageSignature = messageImageSignature(message.images);
  const imagePreviewSignature = imageWorkbenchPreviewSignature(
    message.imageWorkbenchPreview,
  );
  const nextTaskPreviewSignature = taskPreviewSignature(message.taskPreview);

  if (
    !contentSignature &&
    !imageSignature &&
    !imagePreviewSignature &&
    !nextTaskPreviewSignature
  ) {
    return "";
  }

  return [
    message.role,
    contentSignature,
    imageSignature,
    imagePreviewSignature,
    nextTaskPreviewSignature,
  ].join("::");
};

const buildHistoryMessageSignature = (message: Message): string => {
  const usageSignature = message.usage
    ? `${message.usage.input_tokens}:${message.usage.output_tokens}:${message.usage.cached_input_tokens ?? ""}:${message.usage.cache_creation_input_tokens ?? ""}`
    : "";
  return [
    message.role,
    normalizeSignatureText(message.content),
    messageImageSignature(message.images),
    messageToolCallsSignature(message.toolCalls),
    messageContentPartsSignature(message.contentParts),
    messageArtifactsSignature(message.artifacts),
    imageWorkbenchPreviewSignature(message.imageWorkbenchPreview),
    taskPreviewSignature(message.taskPreview),
    usageSignature,
  ].join("::");
};

export const dedupeAdjacentHistoryMessages = (
  messages: Message[],
): Message[] => {
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
  const historyToolArgumentsById = new Map<string, string | undefined>();

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
      let imageWorkbenchPreview: MessageImageWorkbenchPreview | undefined;
      let taskPreview: MessageTaskPreview | undefined;

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
          historyToolArgumentsById.set(part.id, toolCall.arguments);
          toolCalls.push(toolCall);
          contentParts.push({ type: "tool_use", toolCall });
          continue;
        }

        if (partType === "tool_response") {
          if (!part.id || typeof part.id !== "string") continue;
          const toolName = resolveHistoryToolName(part.id, historyToolNameById);
          const rawOutputText =
            typeof part.output === "string" ? part.output : "";
          const rawErrorText = typeof part.error === "string" ? part.error : "";
          const normalizedOutput = extractLimeToolMetadataBlock(rawOutputText);
          const normalizedError = extractLimeToolMetadataBlock(rawErrorText);
          const normalizedResult = {
            success: part.success !== false,
            output: normalizedOutput.text,
            error: normalizedError.text || undefined,
            images: normalizeToolResultImages(
              part.images,
              normalizedOutput.text,
            ),
            metadata: normalizeToolResultMetadata(
              part.metadata,
              rawOutputText,
              rawErrorText,
            ),
          };
          const success = isToolResultSuccessful(normalizedResult);
          const normalizedResultRecord =
            normalizedResult &&
            typeof normalizedResult === "object" &&
            !Array.isArray(normalizedResult)
              ? (normalizedResult as Record<string, unknown>)
              : undefined;
          const toolArguments = historyToolArgumentsById.get(part.id);
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
          imageWorkbenchPreview = mergeImageWorkbenchPreview(
            imageWorkbenchPreview,
            buildImageTaskPreviewFromToolResult({
              toolId: part.id,
              toolName,
              toolArguments,
              toolResult: normalizedResultRecord,
              fallbackPrompt: textParts.join("\n").trim(),
            }) || undefined,
          );
          taskPreview = mergeTaskPreview(
            taskPreview,
            buildTaskPreviewFromToolResult({
              toolId: part.id,
              toolName,
              toolArguments,
              toolResult: normalizedResultRecord,
              fallbackPrompt: textParts.join("\n").trim(),
            }) || undefined,
          );
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
      const usage = normalizeHistoryUsage(msg.usage);
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
          usage: normalizedRole === "assistant" ? usage : undefined,
          thinkingContent: extractThinkingContentFromParts(
            sanitizedContentParts,
          ),
          imageWorkbenchPreview,
          taskPreview,
        },
      ];
    });

  return mergeAdjacentAssistantMessages(
    dedupeAdjacentHistoryMessages(loadedMessages),
  );
};
