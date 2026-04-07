import { useCallback } from "react";
import type { MessageImage } from "../types";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { WorkspaceHandleSend } from "./useWorkspaceSendActions";

interface UseWorkspaceConversationSendRuntimeParams {
  chatToolPreferences: ChatToolPreferences;
  handleSend: WorkspaceHandleSend;
}

export function useWorkspaceConversationSendRuntime({
  chatToolPreferences,
  handleSend,
}: UseWorkspaceConversationSendRuntimeParams) {
  const handleSendFromEmptyState = useCallback(
    (
      text: string,
      sendExecutionStrategy?: "react" | "code_orchestrated" | "auto",
      images?: MessageImage[],
    ) => {
      void handleSend(
        images || [],
        chatToolPreferences.webSearch,
        chatToolPreferences.thinking,
        text,
        sendExecutionStrategy,
      );
    },
    [chatToolPreferences.thinking, chatToolPreferences.webSearch, handleSend],
  );

  return {
    handleSendFromEmptyState,
  };
}
