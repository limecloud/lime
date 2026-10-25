import { useEffect, useMemo, type MutableRefObject } from "react";
import { useWorkspaceImageWorkbenchRuntime } from "./useWorkspaceImageWorkbenchRuntime";
import { useWorkspaceSendActions } from "./useWorkspaceSendActions";
import { isRuntimeSubmissionAccepted } from "../hooks/agentSendResult";

type ImageWorkbenchParams = Parameters<
  typeof useWorkspaceImageWorkbenchRuntime
>[0];
type SendActionsParams = Parameters<typeof useWorkspaceSendActions>[0];

interface UseWorkspaceSendSurfaceRuntimeParams {
  imageWorkbench: ImageWorkbenchParams;
  pendingSkill: {
    consumePendingSkill: () => void;
    key?: string | null;
    isThemeWorkbench: boolean;
  };
  sceneGateResumeHandlerRef: MutableRefObject<
    (input: {
      rawText: string;
      requestMetadata: Record<string, unknown>;
    }) => Promise<boolean>
  >;
  sendActions: SendActionsParams;
}

/** 发送、图片工作台桥接与工作区技能命令由同一 surface 编排。 */
export function useWorkspaceSendSurfaceRuntime({
  imageWorkbench,
  pendingSkill: { consumePendingSkill, isThemeWorkbench, key: pendingSkillKey },
  sceneGateResumeHandlerRef,
  sendActions,
}: UseWorkspaceSendSurfaceRuntimeParams) {
  const {
    bindWorkspaceHandleSendRef: bindImageWorkbenchHandleSendRef,
    handleImageWorkbenchCommand,
    imageWorkbenchActionRuntime,
  } = useWorkspaceImageWorkbenchRuntime(imageWorkbench);
  const sendRuntime = useWorkspaceSendActions(sendActions);
  const { displayMessages, handleSend, handleSendRef } = sendRuntime;

  useEffect(() => {
    bindImageWorkbenchHandleSendRef(handleSendRef);
  }, [bindImageWorkbenchHandleSendRef, handleSendRef]);

  useEffect(() => {
    sceneGateResumeHandlerRef.current = async ({ rawText, requestMetadata }) =>
      isRuntimeSubmissionAccepted(
        await handleSendRef.current(
          [],
          undefined,
          undefined,
          rawText,
          undefined,
          undefined,
          {
            requestMetadata,
            skipSceneCommandRouting: true,
          },
        ),
      );
  }, [handleSendRef, sceneGateResumeHandlerRef]);

  useEffect(() => {
    if (!pendingSkillKey || !isThemeWorkbench) {
      return;
    }

    consumePendingSkill();
    const command = `/${pendingSkillKey}`;
    console.log("[LocalConversationPage] 执行技能命令:", command);
    handleSend([], false, false, command);
  }, [consumePendingSkill, handleSend, isThemeWorkbench, pendingSkillKey]);

  const latestAssistantMessageId = useMemo(
    () =>
      [...displayMessages]
        .reverse()
        .find((message) => message.role === "assistant")?.id ?? null,
    [displayMessages],
  );

  return {
    ...sendRuntime,
    handleImageWorkbenchCommand,
    imageWorkbenchActionRuntime,
    latestAssistantMessageId,
  };
}
