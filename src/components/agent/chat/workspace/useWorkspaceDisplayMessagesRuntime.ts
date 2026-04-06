import { useEffect, useMemo } from "react";
import { buildLiveTaskSnapshot } from "../hooks/agentChatShared";
import { buildCompatQuestionnaireA2UI } from "../utils/compatQuestionnaireA2UI";
import { buildRuntimeTeamDispatchPreviewMessages } from "./runtimeTeamPreview";
import type { RuntimeTeamDispatchPreviewSnapshot } from "./runtimeTeamPreview";
import {
  buildSubmissionPreviewMessages,
  type SubmissionPreviewSnapshot,
} from "./submissionPreview";
import type { Message } from "../types";

interface UseWorkspaceDisplayMessagesRuntimeParams {
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

    const legacyForm = buildCompatQuestionnaireA2UI(message.content || "");
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

export function useWorkspaceDisplayMessagesRuntime({
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

    if (
      collapsedMessages.length === 0 &&
      bootstrapDispatchPreviewMessages.length > 0
    ) {
      return bootstrapDispatchPreviewMessages;
    }

    return collapsedMessages;
  }, [
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
