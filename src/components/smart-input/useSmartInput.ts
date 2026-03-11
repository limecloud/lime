/**
 * @file useSmartInput.ts
 * @description 截图对话核心 Hook，管理消息、图片和 AI 通信
 * @module components/smart-input/useSmartInput
 */

import { useState, useCallback, useRef } from "react";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { requireDefaultProjectId } from "@/lib/api/project";
import {
  createAgentSession,
  sendAsterMessageStream,
} from "@/lib/api/agentRuntime";
import type { ChatMessage, MessageImage, UseSmartInputReturn } from "./types";
import { parseStreamEvent, type StreamEvent } from "@/lib/api/agentStream";

const DEFAULT_SMART_INPUT_PROVIDER = "claude";
const DEFAULT_SMART_INPUT_MODEL = "claude-sonnet-4-5";

/**
 * 读取图片文件并转换为 Base64
 * 需求: 5.1 - 截图对话模块应将图片编码为 base64
 *
 * @param imagePath - 图片文件路径
 * @returns Base64 编码的图片数据
 */
export async function readImageAsBase64(imagePath: string): Promise<string> {
  try {
    const base64 = await safeInvoke<string>("read_image_as_base64", {
      path: imagePath,
    });
    return base64;
  } catch (error) {
    console.error("读取图片失败:", error);
    throw new Error(`读取图片失败: ${error}`);
  }
}

/**
 * 截图对话 Hook
 *
 * 提供截图对话功能的核心状态管理和 AI 通信能力
 *
 * 需求:
 * - 5.1: 将图片编码为 base64
 * - 5.2: 使用现有的 Agent API 进行 AI 通信
 * - 5.3: 显示加载指示器
 * - 5.5: 显示错误信息并提供重试选项
 */
export function useSmartInput(): UseSmartInputReturn {
  // 状态
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imagePath, setImagePathState] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  // 用于重试的最后一条消息
  const lastMessageRef = useRef<string | null>(null);

  // 会话 ID
  const sessionIdRef = useRef<string | null>(null);
  const workspaceIdRef = useRef<string | null>(null);

  /**
   * 设置截图路径并加载图片
   */
  const setImagePath = useCallback(async (path: string) => {
    setImagePathState(path);
    setError(null);

    try {
      const base64 = await readImageAsBase64(path);
      setImageBase64(base64);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "加载图片失败";
      setError(errorMsg);
      toast.error(errorMsg);
    }
  }, []);

  /**
   * 创建或获取会话
   */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) {
      return sessionIdRef.current;
    }

    try {
      let workspaceId = workspaceIdRef.current;
      if (!workspaceId) {
        workspaceId =
          await requireDefaultProjectId("未找到默认工作区，请先创建或选择项目");
        workspaceIdRef.current = workspaceId;
      }

      const response = await createAgentSession(
        DEFAULT_SMART_INPUT_PROVIDER,
        workspaceId,
        DEFAULT_SMART_INPUT_MODEL,
      );
      sessionIdRef.current = response.session_id;
      return response.session_id;
    } catch (err) {
      console.error("创建会话失败:", err);
      return null;
    }
  }, []);

  /**
   * 发送消息到 AI
   * 需求: 5.2 - 使用现有的 Agent API 进行 AI 通信
   */
  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim()) return;
      if (!imageBase64) {
        setError("请先加载截图");
        return;
      }

      // 保存消息用于重试
      lastMessageRef.current = message;
      setError(null);
      setIsLoading(true);

      // 创建用户消息
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        image:
          messages.length === 0
            ? { data: imageBase64, mediaType: "image/png" }
            : undefined,
        timestamp: Date.now(),
      };

      // 创建助手消息占位符
      const assistantMsgId = crypto.randomUUID();
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isThinking: true,
        thinkingContent: "思考中...",
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      let accumulatedContent = "";
      let unlisten: UnlistenFn | null = null;

      try {
        // 确保有会话
        const sessionId = await ensureSession();
        if (!sessionId) {
          throw new Error("无法创建会话");
        }

        // 创建唯一事件名称
        const eventName = `screenshot_chat_stream_${assistantMsgId}`;

        // 设置事件监听器
        unlisten = await safeListen<StreamEvent>(eventName, (event) => {
          const data = parseStreamEvent(event.payload);
          if (!data) return;

          switch (data.type) {
            case "text_delta":
              accumulatedContent += data.text;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        content: accumulatedContent,
                        isThinking: false,
                        thinkingContent: undefined,
                      }
                    : msg,
                ),
              );
              break;

            case "done":
            case "final_done":
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        isThinking: false,
                        content: accumulatedContent || "(无响应)",
                      }
                    : msg,
                ),
              );
              setIsLoading(false);
              if (unlisten) {
                unlisten();
                unlisten = null;
              }
              break;

            case "error":
              setError(data.message);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        isThinking: false,
                        content: `错误: ${data.message}`,
                      }
                    : msg,
                ),
              );
              setIsLoading(false);
              if (unlisten) {
                unlisten();
                unlisten = null;
              }
              break;
          }
        });

        // 准备图片数据（只在第一条消息时发送图片）
        const images: MessageImage[] =
          messages.length === 0
            ? [{ data: imageBase64, mediaType: "image/png" }]
            : [];

        const workspaceId = workspaceIdRef.current;
        if (!workspaceId) {
          throw new Error("缺少默认工作区，无法发送截图对话请求");
        }

        // 发送流式请求（使用 Aster Agent）
        await sendAsterMessageStream(
          message,
          sessionId,
          eventName,
          workspaceId,
          images.length > 0
            ? images.map((img) => ({
                data: img.data,
                media_type: img.mediaType,
              }))
            : undefined,
          {
            provider_id: DEFAULT_SMART_INPUT_PROVIDER,
            provider_name: DEFAULT_SMART_INPUT_PROVIDER,
            model_name: DEFAULT_SMART_INPUT_MODEL,
          },
        );
      } catch (err) {
        console.error("发送消息失败:", err);
        const errorMsg = err instanceof Error ? err.message : "发送失败";
        setError(errorMsg);
        toast.error(errorMsg);

        // 移除失败的助手消息
        setMessages((prev) => prev.filter((msg) => msg.id !== assistantMsgId));
        setIsLoading(false);

        if (unlisten) {
          unlisten();
        }
      }
    },
    [imageBase64, messages.length, ensureSession],
  );

  /**
   * 清空消息历史
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    sessionIdRef.current = null;
    lastMessageRef.current = null;
  }, []);

  /**
   * 清除错误
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * 重试上一条消息
   * 需求: 5.5 - 显示错误信息并提供重试选项
   */
  const retry = useCallback(async () => {
    if (lastMessageRef.current) {
      // 移除最后一条失败的助手消息
      setMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (
          lastMsg?.role === "assistant" &&
          lastMsg.content.startsWith("错误:")
        ) {
          return prev.slice(0, -1);
        }
        return prev;
      });

      await sendMessage(lastMessageRef.current);
    }
  }, [sendMessage]);

  return {
    messages,
    isLoading,
    error,
    imagePath,
    imageBase64,
    sendMessage,
    setImagePath,
    clearMessages,
    clearError,
    retry,
  };
}

export default useSmartInput;
