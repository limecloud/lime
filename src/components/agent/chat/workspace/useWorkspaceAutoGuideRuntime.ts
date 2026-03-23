import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { contentWorkflowApi } from "@/lib/api/content-workflow";
import { getDefaultGuidePromptByTheme } from "../utils/defaultGuidePrompt";
import type { ThemeWorkbenchEntryPromptState } from "../hooks/useThemeWorkbenchEntryPrompt";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { MessageImage } from "../types";
import type { CreationMode, ThemeType } from "@/components/content-creator/types";
import type { CanvasStateUnion } from "@/components/content-creator/canvas/canvasUtils";
import { isCanvasStateEmpty } from "./themeWorkbenchHelpers";
import type { WorkspaceHandleSend } from "./useWorkspaceSendActions";

interface UseWorkspaceAutoGuideRuntimeParams {
  contentId?: string | null;
  sessionId?: string | null;
  initialUserPrompt?: string;
  initialUserImages?: MessageImage[];
  initialDispatchKey: string | null;
  messagesCount: number;
  projectReady: boolean;
  systemPromptReady: boolean;
  isSending: boolean;
  canvasState: CanvasStateUnion | null;
  isThemeWorkbench: boolean;
  mappedTheme: ThemeType;
  creationMode: CreationMode;
  shouldUseCompactThemeWorkbench: boolean;
  shouldSkipThemeWorkbenchAutoGuideWithoutPrompt: boolean;
  themeWorkbenchEntryCheckPending: boolean;
  themeWorkbenchEntryPrompt: ThemeWorkbenchEntryPromptState | null;
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
  initialDispatchKey,
  messagesCount,
  projectReady,
  systemPromptReady,
  isSending,
  canvasState,
  isThemeWorkbench,
  mappedTheme,
  creationMode,
  shouldUseCompactThemeWorkbench,
  shouldSkipThemeWorkbenchAutoGuideWithoutPrompt,
  themeWorkbenchEntryCheckPending,
  themeWorkbenchEntryPrompt,
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
    if (shouldUseCompactThemeWorkbench) {
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

    if (!initialDispatchKey && themeWorkbenchEntryCheckPending) {
      return;
    }

    if (initialDispatchKey) {
      if (isThemeWorkbench && pendingInitialImages.length === 0) {
        return;
      }
      if (consumedInitialPromptRef.current === initialDispatchKey) {
        return;
      }

      let disposed = false;
      consumedInitialPromptRef.current = initialDispatchKey;
      hasTriggeredGuideRef.current = true;
      console.log("[AgentChatPage] 自动发送首条创作意图消息");

      void (async () => {
        const started = await handleSend(
          pendingInitialImages,
          chatToolPreferences.webSearch,
          chatToolPreferences.thinking,
          pendingInitialPrompt,
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

    if (themeWorkbenchEntryPrompt?.kind === "resume") {
      return;
    }

    if (defaultGuidePrompt) {
      hasTriggeredGuideRef.current = true;
      setInput((previous) => previous.trim() || defaultGuidePrompt);
      return;
    }

    if (isThemeWorkbench) {
      if (shouldSkipThemeWorkbenchAutoGuideWithoutPrompt) {
        return;
      }

      hasTriggeredGuideRef.current = true;
      console.log("[AgentChatPage] 主题工作台：触发 AI 引导，创建后端工作流");

      void (async () => {
        try {
          await contentWorkflowApi.create(contentId, mappedTheme, creationMode);
          console.log("[AgentChatPage] 后端工作流创建成功");
        } catch (error) {
          console.warn(
            "[AgentChatPage] 后端工作流创建失败（不影响主流程）:",
            error,
          );
        }
      })();

      triggerAIGuideRef.current();
      return;
    }

    hasTriggeredGuideRef.current = true;
    console.log("[AgentChatPage] 自动触发 AI 创作引导");
    triggerAIGuideRef.current();
  }, [
    canvasState,
    chatToolPreferences.thinking,
    chatToolPreferences.webSearch,
    contentId,
    creationMode,
    handleSend,
    initialDispatchKey,
    initialUserImages,
    initialUserPrompt,
    isSending,
    isThemeWorkbench,
    mappedTheme,
    messagesCount,
    onInitialUserPromptConsumed,
    projectReady,
    setInput,
    shouldSkipThemeWorkbenchAutoGuideWithoutPrompt,
    shouldUseCompactThemeWorkbench,
    systemPromptReady,
    themeWorkbenchEntryCheckPending,
    themeWorkbenchEntryPrompt,
    consumedInitialPromptRef,
    hasTriggeredGuideRef,
  ]);

  useEffect(() => {
    const pendingInitialPrompt = (initialUserPrompt || "").trim();
    const pendingInitialImages = initialUserImages || [];

    if (
      shouldUseCompactThemeWorkbench ||
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
    initialUserImages,
    initialUserPrompt,
    isSending,
    messagesCount,
    onInitialUserPromptConsumed,
    sessionId,
    shouldUseCompactThemeWorkbench,
    consumedInitialPromptRef,
  ]);

  useEffect(() => {
    hasTriggeredGuideRef.current = false;
    consumedInitialPromptRef.current = null;
  }, [contentId, consumedInitialPromptRef, hasTriggeredGuideRef]);

  useEffect(() => {
    if (!contentId || !isThemeWorkbench) {
      return;
    }

    let disposed = false;

    void (async () => {
      try {
        const workflow = await contentWorkflowApi.getByContent(contentId);
        if (!workflow || disposed) {
          return;
        }

        const completedCount = workflow.steps.filter(
          (step) => step.status === "completed" || step.status === "skipped",
        ).length;
        console.log(
          `[AgentChatPage] 找到已有工作流: ${workflow.id}，已完成步骤 ${completedCount}/${workflow.steps.length}`,
        );
      } catch (error) {
        console.debug("[AgentChatPage] 查询后端工作流失败:", error);
      }
    })();

    return () => {
      disposed = true;
    };
  }, [contentId, isThemeWorkbench]);
}
