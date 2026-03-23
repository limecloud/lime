import { useEffect, useMemo } from "react";
import {
  buildLiveTaskSnapshot,
} from "../hooks/agentChatShared";
import { buildLegacyQuestionnaireA2UI } from "../utils/legacyQuestionnaireA2UI";
import { buildRuntimeTeamDispatchPreviewMessages } from "./runtimeTeamPreview";
import type { RuntimeTeamDispatchPreviewSnapshot } from "./runtimeTeamPreview";
import type { Message } from "../types";

interface UseWorkspaceDisplayMessagesRuntimeParams {
  bootstrapDispatchPreviewMessages: Message[];
  browserPreflightMessages?: Message[] | null;
  isSending: boolean;
  messages: Message[];
  pendingActionCount: number;
  queuedTurnCount: number;
  runtimeTeamDispatchPreview: RuntimeTeamDispatchPreviewSnapshot | null;
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

export function useWorkspaceDisplayMessagesRuntime({
  bootstrapDispatchPreviewMessages,
  browserPreflightMessages,
  isSending,
  messages,
  pendingActionCount,
  queuedTurnCount,
  runtimeTeamDispatchPreview,
  sessionId,
  updateTopicSnapshot,
  workspaceError,
}: UseWorkspaceDisplayMessagesRuntimeParams) {
  const displayMessages = useMemo(() => {
    const collapsedMessages = collapseLegacyQuestionnaireMessages(messages);
    const runtimeTeamDispatchPreviewMessages = runtimeTeamDispatchPreview
      ? buildRuntimeTeamDispatchPreviewMessages(runtimeTeamDispatchPreview)
      : [];

    if (browserPreflightMessages) {
      return [...collapsedMessages, ...browserPreflightMessages];
    }

    if (runtimeTeamDispatchPreviewMessages.length > 0) {
      return [...collapsedMessages, ...runtimeTeamDispatchPreviewMessages];
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
    browserPreflightMessages,
    messages,
    runtimeTeamDispatchPreview,
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
