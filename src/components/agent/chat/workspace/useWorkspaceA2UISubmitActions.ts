import { useCallback } from "react";
import { toast } from "sonner";
import type { A2UIFormData } from "@/components/workspace/a2ui/types";
import type { SendMessageFn } from "../hooks/agentChatShared";

interface UseWorkspaceA2UISubmitActionsParams {
  resolvePendingA2UISubmit: (formData: A2UIFormData) => {
    status: "advance" | "empty" | "submit";
    formData?: A2UIFormData;
  };
  sendMessage: SendMessageFn;
}

export function useWorkspaceA2UISubmitActions({
  resolvePendingA2UISubmit,
  sendMessage,
}: UseWorkspaceA2UISubmitActionsParams) {
  const handleA2UISubmit = useCallback(
    async (formData: A2UIFormData, _messageId: string) => {
      console.log("[LocalConversationPage] A2UI 表单提交:", formData);

      const formattedData = Object.entries(formData)
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            return `- ${key}: ${value.join(", ")}`;
          }
          return `- ${key}: ${value}`;
        })
        .join("\n");

      await sendMessage(`我的选择：\n${formattedData}`, [], false, false);
    },
    [sendMessage],
  );

  const handleInputbarA2UISubmit = useCallback(
    (formData: A2UIFormData) => {
      const resolvedSubmission = resolvePendingA2UISubmit(formData);
      if (resolvedSubmission.status === "advance") {
        return;
      }

      if (resolvedSubmission.status === "empty") {
        toast.info("请先完成当前这一步，再继续");
        return;
      }

      const effectiveFormData = resolvedSubmission.formData || formData;

      void handleA2UISubmit(effectiveFormData, "");
    },
    [handleA2UISubmit, resolvePendingA2UISubmit],
  );

  return {
    handleA2UISubmit,
    handleInputbarA2UISubmit,
  };
}
