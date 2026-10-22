import { runRuntimeSubmissionEffect } from "../../../hooks/agentSendResult";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  ComposerDraftCoordinator,
  ComposerDraftCapture,
} from "@/components/input-kit/ComposerDraftCoordinator";
import type { AcceptedRuntimeSubmissionResult } from "@/components/agent/chat/hooks/agentSendResult";
import type { RuntimeSubmissionResult } from "../../../hooks/agentSendResult";
import { createComposerSubmissionSettlement } from "../../composerSubmissionSettlement";
import {
  buildNewThreadGoalSendPayload,
  formatThreadGoalPrompt,
  submitNewThreadGoal,
} from "../../newThreadGoalSubmission";
import { prepareThreadGoalDraft } from "./threadGoalDraft";
import type { MessageImage, MessagePathReference } from "../../../types";

import type {
  InputbarSendHandler,
  InputbarSendPayload,
} from "../inputbarSendPayload";

import { buildPathReferenceRequestMetadata } from "../../../utils/pathReferences";
import {
  resolveInputCapabilityDispatch,
  resolveInputCapabilitySelectionFromRoute,
  resolveInputCapabilitySendRoute,
  type InputCapabilitySelection,
  type InputCapabilitySendRoute,
} from "../../../skill-selection/inputCapabilitySelection";
import { buildInputbarToolPreferencesOverride } from "../utils/inputbarModeRequestMetadata";
import { recordAgentUiPerformanceMetric } from "@/lib/agentUiPerformanceMetrics";
import type {
  BaseComposerSendMetadata,
  ComposerController,
  ComposerDraftSnapshot,
  ComposerSubmitTarget,
} from "@/components/input-kit";

interface UseInputbarSendParams {
  input: string;
  hasAdditionalContent?: boolean;
  pendingImages: MessageImage[];
  pathReferences: MessagePathReference[];
  activeCapability: InputCapabilitySelection | null;
  activeTools?: Record<string, boolean>;
  projectId?: string | null;
  sessionId?: string | null;
  isLoading?: boolean;
  onSend: InputbarSendHandler;
  clearPendingImages: () => void;
  clearPathReferences?: () => void;
  clearActiveCapability: () => void;
  getInputRestoreEpoch?: () => number;
  composerController?: ComposerController;
  composerDraftCoordinator?: ComposerDraftCoordinator;
  onComposerDraftAccepted?: (
    capture: ComposerDraftCapture,
    result: AcceptedRuntimeSubmissionResult,
  ) => Promise<void> | void;
  onComposerAccepted?: (
    draft: ComposerDraftSnapshot | undefined,
    result: AcceptedRuntimeSubmissionResult,
    historyText?: string,
  ) => void;
  onComposerCommitted?: (text: string, draft?: ComposerDraftSnapshot) => void;
  submitTarget?: ComposerSubmitTarget;
  prepareThreadGoalSubmit?: () => Promise<RuntimeSubmissionResult> | null;
  onGoalModeEnabled?: () => void;
  onGoalSubmittingChange?: (submitting: boolean) => void;
}

export function useInputbarSend({
  input,
  hasAdditionalContent = false,
  pendingImages,
  pathReferences,
  activeCapability,
  activeTools = {},
  projectId,
  sessionId,
  isLoading = false,
  onSend,
  clearPendingImages,
  clearPathReferences,
  clearActiveCapability,
  getInputRestoreEpoch,
  composerController,
  composerDraftCoordinator,
  onComposerDraftAccepted,
  onComposerAccepted,
  onComposerCommitted,
  submitTarget,
  prepareThreadGoalSubmit,
  onGoalModeEnabled,
  onGoalSubmittingChange,
}: UseInputbarSendParams) {
  const { t } = useTranslation("agent");
  const mounted = useRef(true);
  const goalSubmissionPending = useRef(false);
  const surface = useRef({
    composerController,
    composerDraftCoordinator,
    projectId,
    sessionId,
  });
  surface.current = {
    composerController,
    composerDraftCoordinator,
    projectId,
    sessionId,
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(
    async (triggerMetadata?: BaseComposerSendMetadata) => {
      if (goalSubmissionPending.current) return { kind: "rejected" as const };
      const goalSubmission = prepareThreadGoalSubmit?.();
      if (goalSubmission) return goalSubmission;
      const handlerEnteredAt = Date.now();
      const sendRestoreEpoch = getInputRestoreEpoch?.() ?? 0;
      const resolvedSubmitTarget: ComposerSubmitTarget =
        triggerMetadata?.submitTarget ??
        submitTarget ??
        (isLoading ? "steer" : "start");
      let goalHistoryText: string | undefined;
      const settlement = createComposerSubmissionSettlement({
        controller: composerController,
        coordinator: composerDraftCoordinator,
        target: resolvedSubmitTarget,
        onDraftAccepted: onComposerDraftAccepted,
        scope: { projectId, sessionId },
        canApplyUi: () =>
          mounted.current &&
          surface.current.composerController === composerController &&
          surface.current.composerDraftCoordinator ===
            composerDraftCoordinator &&
          (!!composerDraftCoordinator ||
            (surface.current.projectId === projectId &&
              surface.current.sessionId === sessionId)) &&
          (getInputRestoreEpoch?.() ?? sendRestoreEpoch) === sendRestoreEpoch,
        onAccepted: (result, draft) => {
          runRuntimeSubmissionEffect(result.receipt, "accepted_submit", () =>
            goalHistoryText
              ? onComposerAccepted?.(draft, result, goalHistoryText)
              : onComposerAccepted?.(draft, result),
          );
        },
        onCommitted: (accepted) => {
          // Controller has already been committed by its sole settlement owner.
          runRuntimeSubmissionEffect(
            accepted.receipt,
            "accepted_submit",
            clearPendingImages,
          );
          runRuntimeSubmissionEffect(accepted.receipt, "accepted_submit", () =>
            clearPathReferences?.(),
          );
          runRuntimeSubmissionEffect(
            accepted.receipt,
            "accepted_submit",
            clearActiveCapability,
          );
          if (composerReceipt?.kind === "accepted") {
            runRuntimeSubmissionEffect(
              accepted.receipt,
              "accepted_submit",
              () =>
                onComposerCommitted?.(
                  composerController?.getDocument().text ?? "",
                  composerDraft,
                ),
            );
          }
        },
      });
      const composerReceipt = settlement.receipt;
      if (composerReceipt?.kind === "empty") {
        if (!hasAdditionalContent) return;
        try {
          return await onSend({
            sendOptions: {
              composerTarget: resolvedSubmitTarget,
              targetSessionId: sessionId ?? undefined,
            },
          });
        } catch (error) {
          return { kind: "rejected" as const, error };
        }
      }
      const composerDraft = composerReceipt?.draft;
      const submittedInput = composerReceipt?.submission.text ?? input;
      const composerSubmission = composerReceipt?.submission;
      const submittedImages = composerSubmission?.attachments ?? pendingImages;
      const submittedReferences =
        composerSubmission?.pathReferences ?? pathReferences;
      const submittedRoute = composerDraft?.inputCapabilityRoute as
        | InputCapabilitySendRoute
        | undefined;
      const submittedCapability = composerDraft
        ? submittedRoute
          ? activeCapability &&
            JSON.stringify(
              resolveInputCapabilitySendRoute(activeCapability),
            ) === JSON.stringify(submittedRoute)
            ? activeCapability
            : resolveInputCapabilitySelectionFromRoute({
                route: submittedRoute,
              })
          : null
        : activeCapability;
      const captureMetadata = {
        onRuntimeAccepted: settlement.onRuntimeAccepted,
        ...(settlement.composerRestoreToken
          ? { composerRestoreToken: settlement.composerRestoreToken }
          : {}),
        ...(settlement.composerDraftCapture
          ? { composerDraftCapture: settlement.composerDraftCapture }
          : {}),
      };
      const triggeredAt =
        typeof triggerMetadata?.triggeredAt === "number" &&
        Number.isFinite(triggerMetadata.triggeredAt)
          ? triggerMetadata.triggeredAt
          : handlerEnteredAt;
      const triggerSource = triggerMetadata?.triggerSource ?? "adapter";
      recordAgentUiPerformanceMetric("inputbar.send.enter", {
        durationMs: Math.max(0, handlerEnteredAt - triggeredAt),
        hasTriggerMetadata: Boolean(triggerMetadata),
        imageCount: submittedImages.length,
        inputLength: submittedInput.trim().length,
        pathReferenceCount: submittedReferences.length,
        sessionId: sessionId ?? null,
        source: "inputbar",
        triggerSource,
        workspaceId: projectId ?? null,
      });
      const inputMentions = composerSubmission?.inputMentions ?? [];
      const goalCommand = (composerDraft?.text ?? submittedInput)
        .trimStart()
        .match(/^\/go+al(?=$| )/);
      const isNewThreadGoal =
        !prepareThreadGoalSubmit &&
        (Boolean(activeTools["objective_mode"]) || Boolean(goalCommand));
      const goalDraft =
        isNewThreadGoal && composerReceipt
          ? prepareThreadGoalDraft(composerReceipt, goalCommand?.[0].length)
          : null;
      if (isNewThreadGoal && !goalDraft) return { kind: "rejected" as const };
      if (goalDraft) {
        if (submittedReferences.length || submittedRoute) {
          toast.error(t("agentChat.threadGoal.composer.unsupportedContext"));
          return { kind: "rejected" as const };
        }
        if (
          !goalDraft.objective &&
          !goalDraft.pastedTextAttachments.length &&
          !goalDraft.imageAttachments.length
        ) {
          onGoalModeEnabled?.();
          return { kind: "local-handled" as const };
        }
        goalHistoryText = formatThreadGoalPrompt(goalDraft.objective);
      }
      if (
        !submittedInput.trim() &&
        submittedImages.length === 0 &&
        submittedReferences.length === 0 &&
        !goalDraft?.pastedTextAttachments.length
      ) {
        return;
      }

      const hasRuntimeMode =
        Boolean(activeTools["objective_mode"]) ||
        Boolean(activeTools["task_mode"]) ||
        Boolean(activeTools["subagent_mode"]);
      const canUsePlainTextFastPath =
        submittedInput.trim() &&
        submittedImages.length === 0 &&
        submittedReferences.length === 0 &&
        !submittedCapability &&
        !hasRuntimeMode &&
        !goalDraft &&
        resolvedSubmitTarget !== "queue";
      if (canUsePlainTextFastPath) {
        recordAgentUiPerformanceMetric("inputbar.send.plainTextFastPath", {
          elapsedMs: Math.max(0, Date.now() - triggeredAt),
          inputLength: submittedInput.trim().length,
          sessionId: sessionId ?? null,
          source: "inputbar",
          triggerSource,
          workspaceId: projectId ?? null,
        });
        try {
          const result = await onSend({
            ...captureMetadata,
            images: undefined,
            textOverride: submittedInput,
            sendOptions: undefined,
            ...(composerReceipt?.kind === "accepted"
              ? {
                  composerIntent: composerReceipt.intent,
                  composerTarget: composerReceipt.target,
                  composerDraft,
                  composerSubmission,
                }
              : {}),
            ...(triggerMetadata
              ? {
                  triggeredAt,
                  triggerSource,
                }
              : {}),
          });
          return settlement.finish(result);
        } catch (error) {
          return settlement.reject(error);
        }
      }

      const capabilityDispatch = resolveInputCapabilityDispatch(
        submittedCapability,
        submittedInput,
      );
      const baseRequestMetadata = buildPathReferenceRequestMetadata(
        capabilityDispatch.requestMetadata,
        [...submittedReferences],
      );
      const inputbarModeState = {
        planEnabled: Boolean(activeTools["task_mode"]),
        subagentEnabled: Boolean(activeTools["subagent_mode"]),
      };
      const requestMetadata = baseRequestMetadata;
      const toolPreferencesOverride =
        buildInputbarToolPreferencesOverride(inputbarModeState);
      const collaborationMode = inputbarModeState.planEnabled
        ? ("plan" as const)
        : undefined;
      const hasPathReferences = submittedReferences.length > 0;
      const textOverride = submittedInput.trim()
        ? submittedInput
        : hasPathReferences
          ? "请查看这些文件或文件夹。"
          : undefined;
      const inputRestoreDraft = {
        ...composerDraft,
        text: submittedInput.trim() ? submittedInput : "",
        ...(composerDraft ? { text: composerDraft.text } : {}),
        images: [...submittedImages],
        pathReferences: [...submittedReferences],
        textElements: composerDraft?.textElements ?? [],
        inputCapabilityRoute: capabilityDispatch.capabilityRoute,
      };
      const sendOptions =
        capabilityDispatch.capabilityRoute ||
        capabilityDispatch.displayContent ||
        requestMetadata ||
        goalDraft ||
        toolPreferencesOverride ||
        collaborationMode ||
        inputMentions.length > 0
          ? {
              ...(capabilityDispatch.capabilityRoute
                ? { capabilityRoute: capabilityDispatch.capabilityRoute }
                : {}),
              inputRestoreDraft,
              ...(inputMentions.length > 0 ? { inputMentions } : {}),
              ...(capabilityDispatch.displayContent || submittedInput.trim()
                ? {
                    displayContent:
                      capabilityDispatch.displayContent ||
                      (submittedInput.trim() ? submittedInput : undefined),
                  }
                : {}),
              ...(requestMetadata ? { requestMetadata } : {}),
              ...(toolPreferencesOverride ? { toolPreferencesOverride } : {}),
              ...(collaborationMode ? { collaborationMode } : {}),
            }
          : undefined;

      try {
        const payload: InputbarSendPayload = {
          ...captureMetadata,
          images: submittedImages.length > 0 ? [...submittedImages] : undefined,
          textOverride,
          sendOptions,
          ...(composerReceipt?.kind === "accepted"
            ? {
                composerIntent: composerReceipt.intent,
                composerTarget: composerReceipt.target,
                composerDraft,
                composerSubmission,
              }
            : {}),
          ...(triggerMetadata
            ? {
                triggeredAt,
                triggerSource,
              }
            : {}),
        };
        if (goalDraft) {
          goalSubmissionPending.current = true;
          onGoalSubmittingChange?.(true);
          const binding = composerDraftCoordinator?.captureBinding();
          const generation = composerDraftCoordinator?.getSnapshot().generation;
          const assertRequestCurrent = () => {
            const current = composerDraftCoordinator?.getSnapshot();
            if (
              !mounted.current ||
              surface.current.composerController !== composerController ||
              surface.current.composerDraftCoordinator !==
                composerDraftCoordinator ||
              surface.current.projectId !== projectId ||
              surface.current.sessionId !== sessionId ||
              (getInputRestoreEpoch?.() ?? sendRestoreEpoch) !==
                sendRestoreEpoch ||
              (current &&
                (current.generation !== generation ||
                  JSON.stringify(current.scope) !==
                    JSON.stringify(binding?.scope) ||
                  current.identity?.draftId !== binding?.identity.draftId))
            ) {
              throw new Error("Goal submission is no longer current");
            }
          };
          const result = await submitNewThreadGoal({
            draft: goalDraft,
            assertRequestCurrent,
            onPreparationFailed: () => {
              try {
                assertRequestCurrent();
              } catch {
                return;
              }
              toast.error(t("agentChat.threadGoal.composer.materializeFailed"));
            },
            submit: (goalInput) =>
              onSend(buildNewThreadGoalSendPayload(payload, goalInput)),
          });
          return settlement.finish(result);
        }
        const result = await onSend(payload);
        return settlement.finish(result);
      } catch (error) {
        // 发送失败时保留图片与技能，交由上层 toast / 恢复逻辑处理。
        return settlement.reject(error);
      } finally {
        if (goalDraft) {
          goalSubmissionPending.current = false;
          if (mounted.current) onGoalSubmittingChange?.(false);
        }
      }
    },
    [
      activeCapability,
      activeTools,
      clearActiveCapability,
      composerController,
      composerDraftCoordinator,
      onComposerDraftAccepted,
      clearPendingImages,
      clearPathReferences,
      getInputRestoreEpoch,
      input,
      hasAdditionalContent,
      isLoading,
      onComposerAccepted,
      onComposerCommitted,
      projectId,
      submitTarget,
      prepareThreadGoalSubmit,
      onGoalModeEnabled,
      onGoalSubmittingChange,
      sessionId,
      onSend,
      pendingImages,
      pathReferences,
      t,
    ],
  );
}
