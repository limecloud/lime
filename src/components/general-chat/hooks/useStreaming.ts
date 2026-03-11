/**
 * @file useStreaming.ts
 * @description 流式响应处理 Hook（旧 general-chat 兼容实现）
 * @module components/general-chat/hooks/useStreaming
 *
 * 处理 Tauri 事件监听和流式内容累积
 *
 * @requirements 2.2, 2.5
 */

import { useEffect, useCallback, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { parseStreamEvent } from "@/lib/api/agentStream";
import { safeListen } from "@/lib/dev-bridge";
import { useGeneralChatStore } from "../store/useGeneralChatStore";

/**
 * 旧版流式事件类型
 */
interface LegacyStreamEvent {
  type: "start" | "delta" | "done" | "error";
  message_id?: string;
  content?: string;
  message?: string;
}

/**
 * useStreaming Hook 配置
 */
interface UseStreamingOptions {
  /** 会话 ID */
  sessionId: string | null;
  /** 事件名称 */
  eventName?: string;
  /** 开始回调 */
  onStart?: (messageId: string) => void;
  /** 增量内容回调 */
  onDelta?: (content: string) => void;
  /** 完成回调 */
  onDone?: (messageId: string, content: string) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
}

/**
 * 流式响应处理 Hook
 *
 * 监听 Tauri 事件，处理流式响应
 *
 * @deprecated 该 Hook 依赖 `start/delta/done` 旧事件协议，仅用于兼容旧版 general-chat 页面。
 */
export const useStreaming = (options: UseStreamingOptions) => {
  const {
    sessionId,
    eventName = "general-chat-stream",
    onStart,
    onDelta,
    onDone,
    onError,
  } = options;

  const { startStreaming, appendStreamingContent } = useGeneralChatStore();

  const unlistenRef = useRef<UnlistenFn | null>(null);
  const contentRef = useRef<string>("");

  // 处理流式事件
  const handleStreamEvent = useCallback(
    (event: { payload: unknown }) => {
      const payload = event.payload;
      const legacyEvent =
        payload && typeof payload === "object"
          ? (payload as LegacyStreamEvent)
          : null;

      if (legacyEvent?.type === "start") {
        contentRef.current = "";
        startStreaming(legacyEvent.message_id || "");
        onStart?.(legacyEvent.message_id || "");
        return;
      }

      if (legacyEvent?.type === "delta") {
        if (legacyEvent.content) {
          contentRef.current += legacyEvent.content;
          appendStreamingContent(legacyEvent.content);
          onDelta?.(legacyEvent.content);
        }
        return;
      }

      if (legacyEvent?.type === "done" && !("usage" in legacyEvent)) {
        const { finalizeMessage } = useGeneralChatStore.getState();
        void finalizeMessage();
        onDone?.(legacyEvent.message_id || "", contentRef.current);
        contentRef.current = "";
        return;
      }

      if (legacyEvent?.type === "error") {
        const {
          streaming,
          setMessageError,
          stopGeneration: stopGen,
        } = useGeneralChatStore.getState();
        if (streaming.currentMessageId) {
          setMessageError(
            streaming.currentMessageId,
            legacyEvent.message || "未知错误",
          );
        } else {
          stopGen();
        }
        onError?.(legacyEvent.message || "未知错误");
        contentRef.current = "";
        return;
      }

      const streamEvent = parseStreamEvent(payload);
      if (!streamEvent) {
        return;
      }

      switch (streamEvent.type) {
        case "text_delta":
          contentRef.current += streamEvent.text;
          appendStreamingContent(streamEvent.text);
          onDelta?.(streamEvent.text);
          break;

        case "done":
          // Aster 的 done 只代表一轮响应结束，工具循环可能继续。
          break;

        case "final_done": {
          const { finalizeMessage, streaming } = useGeneralChatStore.getState();
          const messageId = streaming.currentMessageId || "";
          void finalizeMessage();
          onDone?.(messageId, contentRef.current);
          contentRef.current = "";
          break;
        }

        case "error": {
          const {
            streaming,
            setMessageError,
            stopGeneration: stopGen,
          } = useGeneralChatStore.getState();
          if (streaming.currentMessageId) {
            setMessageError(streaming.currentMessageId, streamEvent.message);
          } else {
            stopGen();
          }
          onError?.(streamEvent.message);
          contentRef.current = "";
          break;
        }

        case "warning":
          console.warn("[GeneralChat] 流式告警:", streamEvent.message);
          break;

        default:
          break;
      }
    },
    [startStreaming, appendStreamingContent, onStart, onDelta, onDone, onError],
  );

  // 设置事件监听
  useEffect(() => {
    if (!sessionId) return;

    const setupListener = async () => {
      // 清理之前的监听器
      if (unlistenRef.current) {
        unlistenRef.current();
      }

      // 设置新的监听器
      const eventKey = `${eventName}-${sessionId}`;
      unlistenRef.current = await safeListen(eventKey, handleStreamEvent);
    };

    setupListener();

    // 清理函数
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [sessionId, eventName, handleStreamEvent]);

  // 停止生成
  const stopGeneration = useCallback(() => {
    const { stopGeneration: stopGen } = useGeneralChatStore.getState();
    stopGen();
    contentRef.current = "";
  }, []);

  return {
    stopGeneration,
  };
};

export default useStreaming;
