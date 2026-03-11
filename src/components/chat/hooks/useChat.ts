/**
 * @file useChat Hook
 * @description 遗留通用对话兼容 Hook
 * @module components/chat/hooks/useChat
 */

import { useCallback, useMemo } from "react";
import {
  useGeneralChatStore,
  type GeneralChatState,
} from "@/components/general-chat/store/useGeneralChatStore";
import type { Message as GeneralChatMessage } from "@/components/general-chat/bridge";
import { Message, ChatState, ChatActions } from "../types";

const EMPTY_MESSAGES: GeneralChatMessage[] = [];

const getMessageContent = (message: GeneralChatMessage): string => {
  if (message.content.trim()) {
    return message.content;
  }

  const textContent = message.blocks
    .filter((block) => block.type === "text")
    .map((block) => block.content)
    .join("\n")
    .trim();

  return textContent;
};

const toLegacyMessage = (message: GeneralChatMessage): Message => ({
  id: message.id,
  role: message.role,
  content: getMessageContent(message),
  timestamp: message.createdAt,
  metadata: message.metadata
    ? {
        model: message.metadata.model,
        tokens: message.metadata.tokens,
        duration: message.metadata.duration,
      }
    : undefined,
});

const selectCurrentMessages = (
  state: GeneralChatState,
): GeneralChatMessage[] => {
  if (!state.currentSessionId) {
    return EMPTY_MESSAGES;
  }

  return state.messages[state.currentSessionId] || EMPTY_MESSAGES;
};

/**
 * 遗留通用对话兼容 Hook
 *
 * 兼容旧 `components/chat` 调用方，但内部已完全委托给
 * `general-chat` Store，避免继续维护第二套聊天状态机。
 *
 * @returns 对话状态和操作方法
 * @deprecated 遗留聊天 Hook。禁止新增依赖，请优先使用 @/hooks/useUnifiedChat 或现役聊天入口。
 */
export function useChat(): ChatState & ChatActions {
  const currentMessages = useGeneralChatStore(selectCurrentMessages);
  const isGenerating = useGeneralChatStore(
    (state) => state.streaming.isStreaming,
  );
  const sendMessageInStore = useGeneralChatStore((state) => state.sendMessage);
  const stopGenerationInStore = useGeneralChatStore(
    (state) => state.stopGeneration,
  );
  const retryMessageInStore = useGeneralChatStore(
    (state) => state.retryMessage,
  );
  const createSessionInStore = useGeneralChatStore(
    (state) => state.createSession,
  );

  const messages = useMemo(
    () => currentMessages.map(toLegacyMessage),
    [currentMessages],
  );

  const error = useMemo(() => {
    const latestMessage = currentMessages[currentMessages.length - 1];
    if (latestMessage?.status !== "error") {
      return null;
    }

    return latestMessage.error?.message || null;
  }, [currentMessages]);

  /**
   * 发送消息
   */
  const sendMessage = useCallback(
    async (content: string) => {
      await sendMessageInStore(content);
    },
    [sendMessageInStore],
  );

  /**
   * 清空消息（兼容语义：新建空白会话，而非删除已有历史）
   */
  const clearMessages = useCallback(() => {
    stopGenerationInStore();
    void createSessionInStore().catch((createSessionError) => {
      console.error("兼容 clearMessages 创建新会话失败:", createSessionError);
    });
  }, [createSessionInStore, stopGenerationInStore]);

  /**
   * 重试最后一条错误消息
   */
  const retryLastMessage = useCallback(async () => {
    const lastErrorAssistantMessage = [...currentMessages]
      .reverse()
      .find(
        (message) => message.role === "assistant" && message.status === "error",
      );

    if (!lastErrorAssistantMessage) {
      return;
    }

    await retryMessageInStore(lastErrorAssistantMessage.id);
  }, [currentMessages, retryMessageInStore]);

  /**
   * 停止生成
   */
  const stopGeneration = useCallback(() => {
    stopGenerationInStore();
  }, [stopGenerationInStore]);

  return {
    messages,
    isGenerating,
    error,
    sendMessage,
    clearMessages,
    retryLastMessage,
    stopGeneration,
  };
}
