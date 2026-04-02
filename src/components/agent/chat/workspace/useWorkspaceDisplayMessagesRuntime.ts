import { useEffect, useMemo } from "react";
import { buildLiveTaskSnapshot } from "../hooks/agentChatShared";
import type { BrowserTaskPreflight } from "../hooks/handleSendTypes";
import { buildLegacyQuestionnaireA2UI } from "../utils/legacyQuestionnaireA2UI";
import { buildRuntimeTeamDispatchPreviewMessages } from "./runtimeTeamPreview";
import type { RuntimeTeamDispatchPreviewSnapshot } from "./runtimeTeamPreview";
import {
  buildSubmissionPreviewMessages,
  type SubmissionPreviewSnapshot,
} from "./submissionPreview";
import type { Message } from "../types";

interface UseWorkspaceDisplayMessagesRuntimeParams {
  browserTaskPreflight: BrowserTaskPreflight | null;
  bootstrapDispatchPreviewMessages: Message[];
  isSending: boolean;
  messages: Message[];
  pendingActionCount: number;
  queuedTurnCount: number;
  runtimeTeamDispatchPreview: RuntimeTeamDispatchPreviewSnapshot | null;
  submissionPreview: SubmissionPreviewSnapshot | null;
  sessionId?: string | null;
  updateTopicSnapshot: (
    sessionId: string,
    snapshot: ReturnType<typeof buildLiveTaskSnapshot>,
  ) => void;
  workspaceError: boolean;
}

function isLegacyQuestionnaireSummaryMessage(message?: Message): boolean {
  return (
    message?.role === "user" && message.content.trim().startsWith("我的选择：")
  );
}

function collapseLegacyQuestionnaireMessages(messages: Message[]): Message[] {
  let mutated = false;
  const collapsedMessages = messages.map((message, index) => {
    if (message.role !== "assistant") {
      return message;
    }

    if ((message.actionRequests || []).length > 0) {
      return message;
    }

    const legacyForm = buildLegacyQuestionnaireA2UI(message.content || "");
    if (!legacyForm) {
      return message;
    }

    const nextMessage = messages[index + 1];
    const isPendingQuestionnaire = index === messages.length - 1;
    const hasSubmittedSummary =
      isLegacyQuestionnaireSummaryMessage(nextMessage);

    if (!isPendingQuestionnaire && !hasSubmittedSummary) {
      return message;
    }

    mutated = true;
    return {
      ...message,
      content: hasSubmittedSummary
        ? "补充信息表单已提交。"
        : "已整理为补充信息表单，请在输入区完成填写。",
    };
  });

  return mutated ? collapsedMessages : messages;
}

function buildBrowserTaskPreflightPreviewMessages(
  preflight: BrowserTaskPreflight,
): Message[] {
  const timestamp = new Date(preflight.createdAt || Date.now());
  const assistantContent =
    preflight.detail?.trim() || "正在准备浏览器上下文，请稍候...";

  return [
    {
      id: `browser-preflight:${preflight.requestId}:user`,
      role: "user",
      content: preflight.sourceText,
      images: preflight.images.length > 0 ? preflight.images : undefined,
      timestamp,
    },
    {
      id: `browser-preflight:${preflight.requestId}:assistant`,
      role: "assistant",
      content: assistantContent,
      timestamp: new Date(timestamp.getTime() + 1),
      isThinking: preflight.phase === "launching",
    },
  ];
}

export function useWorkspaceDisplayMessagesRuntime({
  browserTaskPreflight,
  bootstrapDispatchPreviewMessages,
  isSending,
  messages,
  pendingActionCount,
  queuedTurnCount,
  runtimeTeamDispatchPreview,
  submissionPreview,
  sessionId,
  updateTopicSnapshot,
  workspaceError,
}: UseWorkspaceDisplayMessagesRuntimeParams) {
  const displayMessages = useMemo(() => {
    const collapsedMessages = collapseLegacyQuestionnaireMessages(messages);
    const runtimeTeamDispatchPreviewMessages = runtimeTeamDispatchPreview
      ? buildRuntimeTeamDispatchPreviewMessages(runtimeTeamDispatchPreview)
      : [];
    const submissionPreviewMessages =
      collapsedMessages.length === 0 && submissionPreview
        ? buildSubmissionPreviewMessages(submissionPreview)
        : [];

    if (runtimeTeamDispatchPreviewMessages.length > 0) {
      return [...collapsedMessages, ...runtimeTeamDispatchPreviewMessages];
    }

    if (submissionPreviewMessages.length > 0) {
      return submissionPreviewMessages;
    }

    if (collapsedMessages.length === 0 && browserTaskPreflight) {
      return buildBrowserTaskPreflightPreviewMessages(browserTaskPreflight);
    }

    if (
      collapsedMessages.length === 0 &&
      bootstrapDispatchPreviewMessages.length > 0
    ) {
      return bootstrapDispatchPreviewMessages;
    }

    return collapsedMessages;
  }, [
    browserTaskPreflight,
    bootstrapDispatchPreviewMessages,
    messages,
    runtimeTeamDispatchPreview,
    submissionPreview,
  ]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    updateTopicSnapshot(
      sessionId,
      buildLiveTaskSnapshot({
        messages: displayMessages,
        isSending,
        pendingActionCount,
        queuedTurnCount,
        workspaceError,
      }),
    );
  }, [
    displayMessages,
    isSending,
    pendingActionCount,
    queuedTurnCount,
    sessionId,
    updateTopicSnapshot,
    workspaceError,
  ]);

  return {
    displayMessages,
  };
}
