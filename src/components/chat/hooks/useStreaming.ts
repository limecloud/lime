/**
 * @file useStreaming Hook
 * @description 遗留流式兼容 Hook
 * @module components/chat/hooks/useStreaming
 */

import { useCallback } from "react";
import { Message } from "../types";

/**
 * 流式对话选项
 */
interface StreamChatOptions {
  /** 项目 ID（可选，用于注入项目上下文） */
  projectId?: string;
}

/**
 * 遗留流式兼容 Hook
 *
 * 该 Hook 曾依赖已废弃的 `agent_chat_stream` 命令。
 * 为避免继续扩散旧链路，这里只保留兼容 API 形状，并显式提示调用方迁移。
 *
 * @returns 流式对话方法
 * @deprecated 禁止新增依赖，请迁移到 `@/components/general-chat` 或统一对话链路。
 */
export function useStreaming() {
  /**
   * 流式对话
   *
   * @param messages - 消息历史
   * @param onChunk - 收到数据块时的回调
   * @param signal - AbortSignal 用于取消请求
   * @param options - 可选配置（包含 projectId）
   */
  const streamChat = useCallback(
    async (
      _messages: Message[],
      _onChunk: (chunk: string) => void,
      _signal?: AbortSignal,
      _options?: StreamChatOptions,
    ): Promise<void> => {
      throw new Error(
        "components/chat/hooks/useStreaming 已停止维护，请迁移到 general-chat 或统一对话链路。",
      );
    },
    [],
  );

  return { streamChat };
}
