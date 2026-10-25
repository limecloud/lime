import type { Dispatch, SetStateAction } from "react";
import type { AgentExecutionStrategy } from "@/lib/api/agentExecutionRuntime";
import type { Message, MessageImage } from "../types";
import type { AssistantDraftState } from "./agentChatShared";
import type { InputCapabilitySendRoute } from "../skill-selection/inputCapabilitySelection";

import { buildInitialAgentRuntimeStatus } from "../utils/agentRuntimeStatus";
import {
  extractAgentUiPerformanceTraceMetadata,
  recordAgentStreamPerformanceMetric,
} from "./agentStreamPerformanceMetrics";
import {
  SKILL_INLINE_PROCESS_RETENTION,
  shouldRetainSkillInlineProcessFromMetadata,
} from "../utils/skillInlineProcessRetention";

interface PrepareAgentStreamSubmitDraftOptions {
  content: string;
  displayContent?: string;
  images: MessageImage[];
  skipUserMessage: boolean;
  assistantMsgId: string;
  userMsgId: string | null;
  assistantDraft?: AssistantDraftState;
  requestMetadata?: Record<string, unknown>;
  messagePurpose?: Message["purpose"];
  capabilityRoute?: InputCapabilitySendRoute;
  effectiveExecutionStrategy: AgentExecutionStrategy;

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
    assistantMsgId,
    userMsgId,
    assistantDraft,
    requestMetadata,
    messagePurpose,
    capabilityRoute,
    effectiveExecutionStrategy,

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
    runtimeStatus:
      assistantDraft?.initialRuntimeStatus ||
      buildInitialAgentRuntimeStatus({
        executionStrategy: effectiveExecutionStrategy,
        skipUserMessage,

      }),
    purpose: messagePurpose,
    imageWorkbenchPreview: assistantDraft?.imageWorkbenchPreview,
    inlineProcessRetention: shouldRetainSkillInlineProcessFromMetadata(
      requestMetadata,
    )
      ? SKILL_INLINE_PROCESS_RETENTION
      : undefined,
  };

  const userMsg: Message | null = skipUserMessage
    ? null
    : {
        id: userMsgId as string,
        role: "user",
        content: displayContent ?? content,
        images: images.length > 0 ? images : undefined,
        timestamp: new Date(),
        purpose: messagePurpose,
        inputCapabilityRoute: capabilityRoute,
      };

  if (!userMsg) {
    setMessages((prev) => [...prev, assistantMsg]);
  } else {
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

  setIsSending(true);

  return {
    assistantMsg,
    userMsg,
  };
}
