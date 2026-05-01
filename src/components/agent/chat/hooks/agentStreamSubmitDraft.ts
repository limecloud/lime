import type { Dispatch, SetStateAction } from "react";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import type { Message, MessageImage } from "../types";
import type { AssistantDraftState } from "./agentChatShared";
import { buildInitialAgentRuntimeStatus } from "../utils/agentRuntimeStatus";
import {
  extractAgentUiPerformanceTraceMetadata,
  recordAgentStreamPerformanceMetric,
} from "./agentStreamPerformanceMetrics";

export function buildQueuedMessagePreview(content: string): string {
  const compact = content.split(/\s+/).filter(Boolean).join(" ");
  if (!compact) {
    return "空白输入";
  }

  const preview = Array.from(compact).slice(0, 80).join("");
  return compact.length > preview.length ? `${preview}...` : preview;
}

export function buildQueuedRuntimeStatus(
  executionStrategy: AsterExecutionStrategy,
  content: string,
  webSearch?: boolean,
) {
  return {
    phase: "routing" as const,
    title: "已加入排队列表",
    detail: `当前会话仍在执行中，本条消息会在前一条完成后自动开始。待处理内容：${buildQueuedMessagePreview(content)}`,
    checkpoints: [
      "已创建待处理阶段",
      webSearch ? "联网搜索能力待命" : "直接回答优先",
      executionStrategy === "code_orchestrated"
        ? "代码编排待命"
        : executionStrategy === "react"
          ? "对话执行待命"
          : "自动路由待命",
    ],
  };
}

interface PrepareAgentStreamSubmitDraftOptions {
  content: string;
  displayContent?: string;
  images: MessageImage[];
  skipUserMessage: boolean;
  expectingQueue: boolean;
  assistantMsgId: string;
  userMsgId: string | null;
  assistantDraft?: AssistantDraftState;
  requestMetadata?: Record<string, unknown>;
  messagePurpose?: Message["purpose"];
  effectiveExecutionStrategy: AsterExecutionStrategy;
  webSearch?: boolean;
  thinking?: boolean;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsSending: Dispatch<SetStateAction<boolean>>;
}

export function prepareAgentStreamSubmitDraft(
  options: PrepareAgentStreamSubmitDraftOptions,
) {
  const {
    content,
    displayContent,
    images,
    skipUserMessage,
    expectingQueue,
    assistantMsgId,
    userMsgId,
    assistantDraft,
    requestMetadata,
    messagePurpose,
    effectiveExecutionStrategy,
    webSearch,
    thinking,
    setMessages,
    setIsSending,
  } = options;

  const assistantMsg: Message = {
    id: assistantMsgId,
    role: "assistant",
    content: assistantDraft?.content || "",
    timestamp: new Date(),
    isThinking: true,
    contentParts: [],
    runtimeStatus: expectingQueue
      ? buildQueuedRuntimeStatus(
          effectiveExecutionStrategy,
          displayContent ?? content,
          webSearch,
        )
      : assistantDraft?.initialRuntimeStatus ||
        buildInitialAgentRuntimeStatus({
          executionStrategy: effectiveExecutionStrategy,
          webSearch,
          thinking,
          skipUserMessage,
        }),
    purpose: messagePurpose,
  };

  if (skipUserMessage) {
    setMessages((prev) => [...prev, assistantMsg]);
  } else {
    const userMsg: Message = {
      id: userMsgId as string,
      role: "user",
      content: displayContent ?? content,
      images: images.length > 0 ? images : undefined,
      timestamp: new Date(),
      purpose: messagePurpose,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
  }

  const performanceTrace =
    extractAgentUiPerformanceTraceMetadata(requestMetadata);
  if (performanceTrace?.sessionId || performanceTrace?.requestId) {
    recordAgentStreamPerformanceMetric(
      "agentStream.assistantDraft",
      performanceTrace,
      {
        assistantContentLength: assistantMsg.content.trim().length,
        expectingQueue,
        hasAssistantDraftContent: Boolean(assistantMsg.content.trim()),
        phase: assistantMsg.runtimeStatus?.phase ?? null,
        statusTitle: assistantMsg.runtimeStatus?.title ?? null,
      },
    );
    const recordDraftPaint = () => {
      recordAgentStreamPerformanceMetric(
        "agentStream.assistantDraftPaint",
        performanceTrace,
        {
          assistantContentLength: assistantMsg.content.trim().length,
          expectingQueue,
          hasAssistantDraftContent: Boolean(assistantMsg.content.trim()),
          phase: assistantMsg.runtimeStatus?.phase ?? null,
          statusTitle: assistantMsg.runtimeStatus?.title ?? null,
        },
      );
    };

    if (
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(recordDraftPaint);
      });
    } else {
      setTimeout(recordDraftPaint, 0);
    }
  }

  if (!expectingQueue) {
    setIsSending(true);
  }

  return {
    assistantMsg,
  };
}
