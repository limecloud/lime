import { useCallback } from "react";
import { toast } from "sonner";
import type { A2UIFormData } from "@/lib/workspace/a2ui";
import type { ConfirmResponse } from "../types";
import type { SendMessageFn } from "../hooks/agentChatShared";
import type { ActionRequired } from "../types";
import { buildActionRequestSubmissionPayload } from "../utils/actionRequestA2UI";

interface UseWorkspaceA2UISubmitActionsParams {
  handlePermissionResponse: (response: ConfirmResponse) => Promise<void>;
  pendingPromotedA2UIActionRequest: ActionRequired | null;
  resolvePendingA2UISubmit: (formData: A2UIFormData) => {
    status: "advance" | "empty" | "submit";
    formData?: A2UIFormData;
  };
  sendMessage: SendMessageFn;
}

export function useWorkspaceA2UISubmitActions({
  handlePermissionResponse,
  pendingPromotedA2UIActionRequest,
  resolvePendingA2UISubmit,
  sendMessage,
}: UseWorkspaceA2UISubmitActionsParams) {
  const handleA2UISubmit = useCallback(
    async (formData: A2UIFormData, _messageId: string) => {
      console.log("[AgentChatPage] A2UI 表单提交:", formData);

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

      if (pendingPromotedA2UIActionRequest) {
        const payload = buildActionRequestSubmissionPayload(
          pendingPromotedA2UIActionRequest,
          effectiveFormData,
        );

        void handlePermissionResponse({
          requestId: pendingPromotedA2UIActionRequest.requestId,
          confirmed: true,
          actionType: pendingPromotedA2UIActionRequest.actionType,
          response: payload.responseText,
          userData: payload.userData,
        });
        return;
      }

      void handleA2UISubmit(effectiveFormData, "");
    },
    [
      handleA2UISubmit,
      handlePermissionResponse,
      pendingPromotedA2UIActionRequest,
      resolvePendingA2UISubmit,
    ],
  );

  return {
    handleA2UISubmit,
    handleInputbarA2UISubmit,
  };
}
