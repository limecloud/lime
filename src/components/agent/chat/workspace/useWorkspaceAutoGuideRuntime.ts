import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { getDefaultGuidePromptByTheme } from "../utils/defaultGuidePrompt";
import type { GeneralWorkbenchEntryPromptState } from "../hooks/useGeneralWorkbenchEntryPrompt";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { MessageImage } from "../types";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import { isCanvasStateEmpty } from "./generalWorkbenchHelpers";
import type { WorkspaceHandleSend } from "./useWorkspaceSendActions";

const shouldLogWorkspaceInfo = import.meta.env.MODE !== "test";

function logWorkspaceInfo(...args: Parameters<typeof console.log>) {
  if (!shouldLogWorkspaceInfo) {
    return;
  }
  console.log(...args);
}

interface UseWorkspaceAutoGuideRuntimeParams {
  contentId?: string | null;
  sessionId?: string | null;
  initialUserPrompt?: string;
  initialUserImages?: MessageImage[];
  initialAutoSendRequestMetadata?: Record<string, unknown>;
  autoRunInitialPromptOnMount: boolean;
  initialDispatchKey: string | null;
  messagesCount: number;
  projectReady: boolean;
  systemPromptReady: boolean;
  isSending: boolean;
  canvasState: CanvasStateUnion | null;
  isThemeWorkbench: boolean;
  mappedTheme: ThemeType;
  shouldUseCompactGeneralWorkbench: boolean;
  shouldSkipGeneralWorkbenchAutoGuideWithoutPrompt: boolean;
  generalWorkbenchEntryCheckPending: boolean;
  generalWorkbenchEntryPrompt: GeneralWorkbenchEntryPromptState | null;
  chatToolPreferences: Pick<ChatToolPreferences, "thinking" | "webSearch">;
  setInput: Dispatch<SetStateAction<string>>;
  handleSend: WorkspaceHandleSend;
  triggerAIGuide: () => void;
  onInitialUserPromptConsumed?: () => void;
  hasTriggeredGuideRef: MutableRefObject<boolean>;
  consumedInitialPromptRef: MutableRefObject<string | null>;
}

export function useWorkspaceAutoGuideRuntime({
  contentId,
  sessionId,
  initialUserPrompt,
  initialUserImages,
  initialAutoSendRequestMetadata,
  autoRunInitialPromptOnMount,
  initialDispatchKey,
  messagesCount,
  projectReady,
  systemPromptReady,
  isSending,
  canvasState,
  isThemeWorkbench,
  mappedTheme,
  shouldUseCompactGeneralWorkbench,
  shouldSkipGeneralWorkbenchAutoGuideWithoutPrompt,
  generalWorkbenchEntryCheckPending,
  generalWorkbenchEntryPrompt,
  chatToolPreferences,
  setInput,
  handleSend,
  triggerAIGuide,
  onInitialUserPromptConsumed,
  hasTriggeredGuideRef,
  consumedInitialPromptRef,
}: UseWorkspaceAutoGuideRuntimeParams) {
  const triggerAIGuideRef = useRef(triggerAIGuide);
  triggerAIGuideRef.current = triggerAIGuide;

  useEffect(() => {
    if (shouldUseCompactGeneralWorkbench) {
      return;
    }

    const canvasEmpty = isCanvasStateEmpty(canvasState);
    const pendingInitialPrompt = (initialUserPrompt || "").trim();
    const pendingInitialImages = initialUserImages || [];
    const defaultGuidePrompt =
      contentId && canvasEmpty && !isThemeWorkbench
        ? getDefaultGuidePromptByTheme(mappedTheme)
        : undefined;

    if (
      !contentId ||
      messagesCount > 0 ||
      !projectReady ||
      !systemPromptReady ||
      isSending ||
      !canvasEmpty
    ) {
      return;
    }

    if (!initialDispatchKey && generalWorkbenchEntryCheckPending) {
      return;
    }

    if (initialDispatchKey) {
      if (
        isThemeWorkbench &&
        pendingInitialImages.length === 0 &&
        !autoRunInitialPromptOnMount
      ) {
        return;
      }
      if (consumedInitialPromptRef.current === initialDispatchKey) {
        return;
      }

      let disposed = false;
      consumedInitialPromptRef.current = initialDispatchKey;
      hasTriggeredGuideRef.current = true;
      logWorkspaceInfo("[AgentChatPage] 自动发送首条创作意图消息");

      void (async () => {
        const started = await handleSend(
          pendingInitialImages,
          chatToolPreferences.webSearch,
          chatToolPreferences.thinking,
          pendingInitialPrompt,
          undefined,
          undefined,
          initialAutoSendRequestMetadata
            ? {
                requestMetadata: initialAutoSendRequestMetadata,
              }
            : undefined,
        );
        if (disposed) {
          return;
        }
        if (!started) {
          consumedInitialPromptRef.current = null;
          return;
        }
        onInitialUserPromptConsumed?.();
      })();

      return () => {
        disposed = true;
      };
    }

    if (hasTriggeredGuideRef.current) {
      return;
    }

    if (generalWorkbenchEntryPrompt?.kind === "resume") {
      return;
    }

    if (defaultGuidePrompt) {
      hasTriggeredGuideRef.current = true;
      setInput((previous) => previous.trim() || defaultGuidePrompt);
      return;
    }

    if (isThemeWorkbench) {
      if (shouldSkipGeneralWorkbenchAutoGuideWithoutPrompt) {
        return;
      }

      hasTriggeredGuideRef.current = true;
      logWorkspaceInfo("[AgentChatPage] 工作区上下文：触发 AI 引导");

      triggerAIGuideRef.current();
      return;
    }

    hasTriggeredGuideRef.current = true;
    logWorkspaceInfo("[AgentChatPage] 自动触发 AI 创作引导");
    triggerAIGuideRef.current();
  }, [
    canvasState,
    chatToolPreferences.thinking,
    chatToolPreferences.webSearch,
    contentId,
    handleSend,
    initialDispatchKey,
    initialAutoSendRequestMetadata,
    initialUserImages,
    initialUserPrompt,
    autoRunInitialPromptOnMount,
    isSending,
    isThemeWorkbench,
    mappedTheme,
    messagesCount,
    onInitialUserPromptConsumed,
    projectReady,
    setInput,
    shouldSkipGeneralWorkbenchAutoGuideWithoutPrompt,
    shouldUseCompactGeneralWorkbench,
    systemPromptReady,
    generalWorkbenchEntryCheckPending,
    generalWorkbenchEntryPrompt,
    consumedInitialPromptRef,
    hasTriggeredGuideRef,
  ]);

  useEffect(() => {
    const pendingInitialPrompt = (initialUserPrompt || "").trim();
    const pendingInitialImages = initialUserImages || [];

    if (
      shouldUseCompactGeneralWorkbench ||
      !initialDispatchKey ||
      contentId ||
      !sessionId ||
      messagesCount > 0 ||
      isSending
    ) {
      return;
    }

    if (consumedInitialPromptRef.current === initialDispatchKey) {
      return;
    }

    let disposed = false;
    consumedInitialPromptRef.current = initialDispatchKey;

    void (async () => {
      const started = await handleSend(
        pendingInitialImages,
        chatToolPreferences.webSearch,
        chatToolPreferences.thinking,
        pendingInitialPrompt,
        undefined,
        undefined,
        initialAutoSendRequestMetadata
          ? {
              requestMetadata: initialAutoSendRequestMetadata,
            }
          : undefined,
      );
      if (disposed) {
        return;
      }
      if (!started) {
        consumedInitialPromptRef.current = null;
        return;
      }
      onInitialUserPromptConsumed?.();
    })();

    return () => {
      disposed = true;
    };
  }, [
    chatToolPreferences.thinking,
    chatToolPreferences.webSearch,
    contentId,
    handleSend,
    initialDispatchKey,
    initialAutoSendRequestMetadata,
    initialUserImages,
    initialUserPrompt,
    isSending,
    messagesCount,
    onInitialUserPromptConsumed,
    sessionId,
    shouldUseCompactGeneralWorkbench,
    consumedInitialPromptRef,
  ]);

  useEffect(() => {
    hasTriggeredGuideRef.current = false;
    consumedInitialPromptRef.current = null;
  }, [contentId, consumedInitialPromptRef, hasTriggeredGuideRef]);
}
