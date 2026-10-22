import type { ComposerDraftCapture } from "@/components/input-kit/ComposerDraftCoordinator";
import {
  createRuntimeSubmissionCapture,
  type RuntimeSubmissionResult,
  type RuntimeSubmissionAcceptance,
} from "../../hooks/agentSendResult";
import type { ComposerSubmissionRestoreToken } from "../composerSubmissionSettlement";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime/sessionTypes";
import type { HandleSendOptions } from "../../hooks/handleSendTypes";
import type { MessageImage } from "../../types";
import type {
  BaseComposerSendTriggerSource,
  ComposerDraftSnapshot,
  ComposerIntent,
  ComposerSubmission,
  ComposerSubmitTarget,
} from "@/components/input-kit";

export type InputbarSendTriggerSource =
  | BaseComposerSendTriggerSource
  | "adapter";

export interface InputbarSendPayload {
  /** Desktop-only draft selection; lowered before the canonical runtime call. */
  browserAnnotationIds?: readonly string[];
  onRuntimeAccepted?: (receipt: RuntimeSubmissionAcceptance) => void;
  composerRestoreToken?: ComposerSubmissionRestoreToken;
  composerDraftCapture?: ComposerDraftCapture;
  images?: MessageImage[];
  textOverride?: string;
  autoContinuePayload?: AutoContinueRequestPayload;
  sendOptions?: HandleSendOptions;
  triggeredAt?: number;
  triggerSource?: InputbarSendTriggerSource;
  composerIntent?: ComposerIntent;
  composerTarget?: ComposerSubmitTarget;
  composerDraft?: ComposerDraftSnapshot;
  composerSubmission?: ComposerSubmission;
}

export type InputbarSendHandler = (
  payload?: InputbarSendPayload,
) => Promise<RuntimeSubmissionResult>;

export function getInputbarSendOptions(payload: InputbarSendPayload):
  | (HandleSendOptions & {
      composerRestoreToken?: ComposerSubmissionRestoreToken;
    })
  | undefined {
  if (
    !payload.composerDraft &&
    !payload.composerSubmission &&
    !payload.composerIntent &&
    !payload.composerTarget &&
    !payload.onRuntimeAccepted &&
    !payload.composerRestoreToken
  ) {
    return payload.sendOptions;
  }
  return {
    ...payload.sendOptions,
    ...(payload.onRuntimeAccepted
      ? {
          observer: createRuntimeSubmissionCapture(
            payload.sendOptions?.observer,
            (result) => payload.onRuntimeAccepted?.(result.receipt),
          ).observer,
        }
      : {}),
    ...(payload.composerRestoreToken
      ? { composerRestoreToken: payload.composerRestoreToken }
      : {}),
    ...(payload.composerDraft ? { composerDraft: payload.composerDraft } : {}),
    ...(payload.composerSubmission
      ? { composerSubmission: payload.composerSubmission }
      : {}),
    ...(payload.composerIntent
      ? { composerIntent: payload.composerIntent }
      : {}),
    ...(payload.composerTarget
      ? { composerTarget: payload.composerTarget }
      : {}),
  };
}
