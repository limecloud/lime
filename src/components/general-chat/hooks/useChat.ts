/**
 * @file useChat.ts
 * @description 聊天逻辑 Hook
 * @module components/general-chat/hooks/useChat
 *
 * 封装消息发送、Provider 配置等逻辑
 *
 * @requirements 2.1, 5.1, 5.2
 */

import { useCallback } from "react";
import { useGeneralChatStore } from "../store/useGeneralChatStore";
import type { Message, ProviderConfig } from "../types";

/**
 * useChat Hook 配置
 */
interface UseChatOptions {
  /** 会话 ID */
  sessionId: string | null;
  /** Provider 配置 */
  providerConfig?: ProviderConfig;
  /** 消息发送成功回调 */
  onMessageSent?: (message: Message) => void;
  /** 消息发送失败回调 */
  onError?: (error: string) => void;
}

/**
 * 聊天逻辑 Hook
 *
 * @deprecated general-chat 的旧聊天 Hook。禁止新增依赖，请优先使用 @/hooks/useUnifiedChat 或现役聊天入口。
 */
export const useChat = (options: UseChatOptions) => {
  const { sessionId, onMessageSent, onError } = options;

  const sendMessageInStore = useGeneralChatStore((state) => state.sendMessage);
  const stopGenerationInStore = useGeneralChatStore(
    (state) => state.stopGeneration,
  );

  /**
   * 发送消息
   */
  const sendMessage = useCallback(
    async (content: string) => {
      if (!sessionId || !content.trim()) {
        return;
      }

      try {
        await sendMessageInStore(content.trim());

        // 消息发送成功
        if (onMessageSent) {
          const { messages } = useGeneralChatStore.getState();
          const latestAssistantMessage = [...(messages[sessionId] || [])]
            .reverse()
            .find((message) => message.role === "assistant");

          if (latestAssistantMessage) {
            onMessageSent(latestAssistantMessage);
          }
        }
      } catch (error) {
        stopGenerationInStore();
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        onError?.(errorMessage);
      }
    },
    [
      sessionId,
      sendMessageInStore,
      stopGenerationInStore,
      onMessageSent,
      onError,
    ],
  );

  /**
   * 停止生成
   */
  const stopGeneration = useCallback(async () => {
    try {
      stopGenerationInStore();
    } catch (error) {
      console.error("停止生成失败:", error);
    }
  }, [stopGenerationInStore]);

  /**
   * 重新生成消息
   */
  const regenerateMessage = useCallback(async (messageId: string) => {
    // TODO: 实现重新生成逻辑
    // 1. 获取该消息之前的用户消息
    // 2. 删除该消息
    // 3. 重新发送用户消息
    console.log("重新生成消息:", messageId);
  }, []);

  return {
    sendMessage,
    stopGeneration,
    regenerateMessage,
  };
};

export default useChat;
