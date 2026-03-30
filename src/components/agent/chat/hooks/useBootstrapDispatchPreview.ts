import { useEffect, useMemo, useState } from "react";
import type { BrowserTaskPreflight } from "./handleSendTypes";
import type { Message, MessageImage } from "../types";

export interface InitialDispatchPreviewSnapshot {
  key: string;
  prompt?: string;
  images: MessageImage[];
}

interface UseBootstrapDispatchPreviewOptions {
  initialUserPrompt?: string;
  initialUserImages?: MessageImage[];
  browserTaskPreflight?: BrowserTaskPreflight | null;
  messagesCount: number;
  isSending: boolean;
  queuedTurnCount: number;
  consumedInitialPromptKey?: string | null;
  shouldUseCompactThemeWorkbench?: boolean;
}

export function buildInitialDispatchKey(
  prompt?: string,
  images?: MessageImage[],
): string | null {
  const normalizedPrompt = (prompt || "").trim();
  const normalizedImages = images || [];

  if (!normalizedPrompt && normalizedImages.length === 0) {
    return null;
  }

  const imageSignature = normalizedImages
    .map(
      (image, index) =>
        `${index}:${image.mediaType}:${image.data.length}:${image.data.slice(0, 16)}`,
    )
    .join("|");

  return `${normalizedPrompt}::${imageSignature}`;
}

export function buildInitialDispatchPreviewMessages(
  dispatchKey: string,
  prompt?: string,
  images?: MessageImage[],
  assistantPreviewText?: string,
): Message[] {
  const normalizedPrompt = (prompt || "").trim();
  const normalizedImages = images || [];

  if (!normalizedPrompt && normalizedImages.length === 0) {
    return [];
  }

  const timestamp = new Date();
  const normalizedAssistantPreviewText =
    assistantPreviewText?.trim() || "正在开始处理任务…";
  const isAssistantThinking =
    normalizedAssistantPreviewText === "正在开始处理任务…";

  return [
    {
      id: `initial-dispatch:${dispatchKey}:user`,
      role: "user",
      content: normalizedPrompt,
      images: normalizedImages.length > 0 ? normalizedImages : undefined,
      timestamp,
    },
    {
      id: `initial-dispatch:${dispatchKey}:assistant`,
      role: "assistant",
      content: normalizedAssistantPreviewText,
      timestamp: new Date(timestamp.getTime() + 1),
      isThinking: isAssistantThinking,
    },
  ];
}

export function useBootstrapDispatchPreview({
  initialUserPrompt,
  initialUserImages,
  browserTaskPreflight,
  messagesCount,
  isSending,
  queuedTurnCount,
  consumedInitialPromptKey,
  shouldUseCompactThemeWorkbench = false,
}: UseBootstrapDispatchPreviewOptions) {
  const initialDispatchKey = useMemo(
    () => buildInitialDispatchKey(initialUserPrompt, initialUserImages),
    [initialUserImages, initialUserPrompt],
  );
  const [bootstrapDispatchSnapshot, setBootstrapDispatchSnapshot] =
    useState<InitialDispatchPreviewSnapshot | null>(null);

  useEffect(() => {
    if (!initialDispatchKey) {
      return;
    }

    setBootstrapDispatchSnapshot({
      key: initialDispatchKey,
      prompt: initialUserPrompt,
      images: initialUserImages || [],
    });
  }, [initialDispatchKey, initialUserImages, initialUserPrompt]);

  useEffect(() => {
    if (messagesCount > 0) {
      setBootstrapDispatchSnapshot(null);
      return;
    }

    if (!initialDispatchKey && !isSending && queuedTurnCount === 0) {
      setBootstrapDispatchSnapshot(null);
    }
  }, [initialDispatchKey, isSending, messagesCount, queuedTurnCount]);

  const activeBootstrapDispatch = useMemo(() => {
    if (
      initialDispatchKey &&
      ((initialUserPrompt || "").trim() || (initialUserImages || []).length > 0)
    ) {
      return {
        key: initialDispatchKey,
        prompt: initialUserPrompt,
        images: initialUserImages || [],
      };
    }

    return bootstrapDispatchSnapshot;
  }, [
    bootstrapDispatchSnapshot,
    initialDispatchKey,
    initialUserImages,
    initialUserPrompt,
  ]);

  const isBootstrapDispatchPending =
    activeBootstrapDispatch !== null &&
    consumedInitialPromptKey !== activeBootstrapDispatch.key;
  const bootstrapDispatchPreviewDetail =
    browserTaskPreflight?.detail?.trim() || undefined;
  const shouldShowBootstrapDispatchPreview =
    !shouldUseCompactThemeWorkbench &&
    Boolean(activeBootstrapDispatch) &&
    messagesCount === 0 &&
    (isSending ||
      queuedTurnCount > 0 ||
      Boolean(bootstrapDispatchPreviewDetail));
  const bootstrapDispatchPreviewMessages = useMemo(() => {
    if (!shouldShowBootstrapDispatchPreview || !activeBootstrapDispatch) {
      return [] as Message[];
    }

    return buildInitialDispatchPreviewMessages(
      activeBootstrapDispatch.key,
      activeBootstrapDispatch.prompt,
      activeBootstrapDispatch.images,
      bootstrapDispatchPreviewDetail,
    );
  }, [
    activeBootstrapDispatch,
    bootstrapDispatchPreviewDetail,
    shouldShowBootstrapDispatchPreview,
  ]);

  return {
    initialDispatchKey,
    activeBootstrapDispatch,
    isBootstrapDispatchPending,
    shouldShowBootstrapDispatchPreview,
    bootstrapDispatchPreviewMessages,
  };
}
