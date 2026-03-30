import { useCallback } from "react";
import { toast } from "sonner";
import type { A2UIFormData, A2UIResponse } from "@/lib/workspace/a2ui";
import type { ConfirmResponse } from "../types";
import type { SendMessageFn } from "../hooks/agentChatShared";
import type { ActionRequired } from "../types";
import {
  buildActionRequestSubmissionPayload,
} from "../utils/actionRequestA2UI";
import { buildLegacyQuestionnaireSubmissionPayload } from "../utils/legacyQuestionnaireA2UI";

interface UseWorkspaceA2UISubmitActionsParams {
  handlePermissionResponseWithBrowserPreflight: (
    response: ConfirmResponse,
  ) => Promise<void>;
  pendingLegacyQuestionnaireA2UIForm: A2UIResponse | null;
  pendingPromotedA2UIActionRequest: ActionRequired | null;
  resolvePendingA2UISubmit: (formData: A2UIFormData) => {
    status: "advance" | "empty" | "submit";
    formData?: A2UIFormData;
  };
  sendMessage: SendMessageFn;
}

export function useWorkspaceA2UISubmitActions({
  handlePermissionResponseWithBrowserPreflight,
  pendingLegacyQuestionnaireA2UIForm,
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

        void handlePermissionResponseWithBrowserPreflight({
          requestId: pendingPromotedA2UIActionRequest.requestId,
          confirmed: true,
          actionType: pendingPromotedA2UIActionRequest.actionType,
          response: payload.responseText,
          userData: payload.userData,
        });
        return;
      }

      if (pendingLegacyQuestionnaireA2UIForm) {
        const submissionPayload = buildLegacyQuestionnaireSubmissionPayload(
          pendingLegacyQuestionnaireA2UIForm,
          effectiveFormData,
        );

        if (!submissionPayload) {
          toast.info("请至少补充一项信息后再继续");
          return;
        }

        void sendMessage(
          submissionPayload.formattedMessage,
          [],
          false,
          false,
          false,
          undefined,
          undefined,
          undefined,
          {
            requestMetadata: submissionPayload.requestMetadata,
          },
        );
        return;
      }

      void handleA2UISubmit(effectiveFormData, "");
    },
    [
      handleA2UISubmit,
      handlePermissionResponseWithBrowserPreflight,
      pendingLegacyQuestionnaireA2UIForm,
      pendingPromotedA2UIActionRequest,
      resolvePendingA2UISubmit,
      sendMessage,
    ],
  );

  return {
    handleA2UISubmit,
    handleInputbarA2UISubmit,
  };
}
