import { resolveRequiredAgentChatCopy } from "@/i18n/agentChatCopy";
import type { RuntimeSubmissionResult } from "./hooks/agentSendResult";
import type { AcceptedRuntimeSubmissionResult } from "./hooks/agentSendResult";
import type { ComposerDraftCapture } from "@/components/input-kit/ComposerDraftCoordinator";
import type { HandleSendOptions } from "./hooks/handleSendTypes";
import type { Message, MessageImage } from "./types";
import { buildDiagnosticsRuntimeStatusMetadata } from "./utils/agentRuntimeStatus";

export interface TaskCenterSendSource {
  sessionId: string | null;
  workspaceId: string | null;
  navigationEpoch: number | null;
  newChatAt: number | null;
}

export interface TaskCenterSessionReadyOptions {
  composerDraftCapture?: ComposerDraftCapture;
  sendSource?: TaskCenterSendSource;
  acceptedResult?: AcceptedRuntimeSubmissionResult;
}

export interface TaskCenterDraftSendRequest {
  id: string;
  sessionId: string | null;
  text: string;
  images: MessageImage[];
  sendExecutionStrategy?: "react";
  sendOptions?: HandleSendOptions;
  composerDraftCapture?: ComposerDraftCapture;
  sendSource?: TaskCenterSendSource;
  submittedAt: number;
  dispatchState?: "queued" | "dispatched";
  sessionReady?: boolean;
  source: "task-center-empty-state" | "empty-state";
  triggerSource?: string | null;
  /** 将内存中的实际发送结果返回给原始 Composer receipt。 */
  onDispatchSettled?: (result: RuntimeSubmissionResult) => void;
}

export function buildHomePendingPreviewMessages(
  request: TaskCenterDraftSendRequest,
  executionStrategy: "react",
): Message[] {
  const timestamp = new Date(request.submittedAt);
  void request.sendExecutionStrategy;
  void executionStrategy;
  const displayContent =
    request.sendOptions?.displayContent?.trim() || request.text;

  return [
    {
      id: `${request.id}:user`,
      role: "user",
      content: displayContent,
      images: request.images.length > 0 ? request.images : undefined,
      timestamp,
      inputCapabilityRoute: request.sendOptions?.capabilityRoute,
    },
    {
      id: `${request.id}:assistant`,
      role: "assistant",
      content: "",
      timestamp,
      isThinking: true,
      runtimeStatus: {
        phase: "preparing",
        title: resolveRequiredAgentChatCopy("runtime.preparing"),
        detail: "",
        metadata: buildDiagnosticsRuntimeStatusMetadata(),
      },
    },
  ];
}
