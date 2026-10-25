import {
  canRestoreComposerSubmission,
  useComposerSubmissionRestoreState,
  createComposerSubmissionSettlement,
} from "./composerSubmissionSettlement";
import { runRuntimeSubmissionEffect } from "../hooks/agentSendResult";
import { restoreComposerDraft } from "../hooks/composerDraftRestore";
import type { ComposerDraftSnapshot } from "@/components/input-kit";
import {
  useComposerInitialSkill,
  useComposerCapabilitySelection,
} from "../skill-selection/useComposerCapabilitySelection";
import { insertComposerSkill } from "../skill-selection/composerCapabilityMention";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { EmptyStateComposerPanel } from "./EmptyStateComposerPanel";
import { EmptyStateComposerFrame, EmptyStateLayout } from "./EmptyStateLayout";
import { buildSkillSelectionProps } from "../skill-selection/skillSelectionBindings";

import type { MessagePathReference } from "../types";
import {
  mergePathReferences,
  buildPathReferenceRequestMetadata,
} from "../utils/pathReferences";

import {
  resolveInputCapabilityDispatch,
  resolveInputCapabilitySelectionFromRoute,
  type InputCapabilitySelection,
  type InputCapabilitySendRoute,
} from "../skill-selection/inputCapabilitySelection";
import { buildHomeSurfaceCopy } from "../home/homeSurfaceCopy";
import { buildInputbarCoreCopy } from "./Inputbar/components/inputbarCoreCopy";
import { buildInputbarToolPreferencesOverride } from "./Inputbar/utils/inputbarModeRequestMetadata";

import { useComposerAttachments } from "./useComposerAttachments";

import type { AgentI18nKey, EmptyStateProps } from "./EmptyState.types";
import {
  type BaseComposerSendMetadata,
  useComposerController,
  type ComposerSubmitTarget,
} from "@/components/input-kit";
import { AppServerClient } from "@/lib/api/appServer";
import { readPromptHistory } from "@/lib/api/promptHistory";
import { recordAgentUiPerformanceMetric } from "@/lib/agentUiPerformanceMetrics";
import { toast } from "sonner";
import { prepareThreadGoalDraft } from "./Inputbar/hooks/threadGoalDraft";
import {
  buildNewThreadGoalSendPayload,
  formatThreadGoalPrompt,
  submitNewThreadGoal,
} from "./newThreadGoalSubmission";

export const EmptyState: React.FC<EmptyStateProps> = ({
  composerController: externalComposerController,
  composerDraftCoordinator,
  onComposerDraftAccepted,
  input,
  setInput,
  onSend,
  onStop,
  sendOnPointerDown = false,
  activeTheme = "general",
  providerType,
  setProviderType,
  model,
  setModel,
  reasoningEffort,
  setReasoningEffort,
  accessMode,
  setAccessMode,
  onManageProviders,
  taskEnabled = false,
  onTaskEnabledChange,
  objectiveEnabled: objectiveEnabledProp,
  onObjectiveEnabledChange: onObjectiveEnabledChangeProp,
  subagentEnabled = false,
  onSubagentEnabledChange,
  skills,
  isSkillsLoading,
  onSkillSuggestionsNeeded,
  projectId = null,
  openedProjects = [],
  onProjectContextChange,
  sessionId = null,
  pluginSuggestions = [],
  pluginSuggestionsError = null,
  pluginSuggestionsLoading = false,
  onPluginSuggestionsNeeded,
  isLoading = false,
  disabled = false,
  initialInputCapability,
  pathReferences: initialPathReferences = [],
  onAddPathReferences,
  inputRestoreRequest = null,
  onInputRestoreRequestHandled,
  onRemovePathReference,
  onClearPathReferences,
}) => {
  const { t } = useTranslation("agent");
  const {
    controller: composerController,
    snapshot: composerSnapshot,
    setText: setComposerControllerText,
  } = useComposerController({
    controller: externalComposerController,
    initialDocument: {
      text: input,
      pathReferences: initialPathReferences,
    },
  });
  const mounted = useRef(true);
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
  const pathReferences = useMemo(
    () => [...composerSnapshot.document.pathReferences],
    [composerSnapshot.document.pathReferences],
  );
  const handleAddPathReferences = useCallback(
    (references: MessagePathReference[]) => {
      composerController.setPathReferences(
        mergePathReferences(
          [...composerController.getDocument().pathReferences],
          references,
        ),
      );
      onAddPathReferences?.(references);
    },
    [composerController, onAddPathReferences],
  );
  const handleRemovePathReference = useCallback(
    (id: string) => {
      composerController.setPathReferences(
        composerController
          .getDocument()
          .pathReferences.filter((reference) => reference.id !== id),
      );
      onRemovePathReference?.(id);
    },
    [composerController, onRemovePathReference],
  );
  const promptHistoryClientRef = useRef<AppServerClient | null>(null);
  if (!promptHistoryClientRef.current) {
    promptHistoryClientRef.current = new AppServerClient();
  }
  useEffect(() => {
    let cancelled = false;
    void readPromptHistory(promptHistoryClientRef.current ?? undefined)
      .then((entries) => {
        if (!cancelled) {
          composerController.mergeHistory(
            entries.reverse().map((entry) => ({ text: entry.text })),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [composerController]);
  const setComposerText = useCallback(
    (value: string) => {
      setComposerControllerText(value);
      setInput(value);
    },
    [setComposerControllerText, setInput],
  );
  useEffect(() => {
    setComposerControllerText(input);
  }, [input, setComposerControllerText]);
  const emittedComposerTextRef = useRef(input);
  useEffect(() => {
    if (emittedComposerTextRef.current === composerSnapshot.document.text)
      return;
    emittedComposerTextRef.current = composerSnapshot.document.text;
    setInput(composerSnapshot.document.text);
  }, [composerSnapshot.document.text, setInput]);
  const translateAgentCopyKey = useCallback(
    (key: string, values?: Record<string, number | string>) =>
      t(key as AgentI18nKey, values ?? {}),
    [t],
  );
  const homeSurfaceCopy = useMemo(
    () => buildHomeSurfaceCopy(translateAgentCopyKey),
    [translateAgentCopyKey],
  );
  const inputbarCoreCopy = useMemo(
    () => buildInputbarCoreCopy(translateAgentCopyKey),
    [translateAgentCopyKey],
  );
  const inputRestoreTokenState = useComposerSubmissionRestoreState(
    inputRestoreRequest?.composerRestoreToken,
  );
  const inputRestoreEpochRef = useRef(0);
  const [, setActiveCapability] =
    useComposerCapabilitySelection(composerController);
  const [localObjectiveEnabled, setLocalObjectiveEnabled] = useState(false);
  const [isGoalSubmitting, setIsGoalSubmitting] = useState(false);
  const goalSubmissionPending = useRef(false);
  const objectiveEnabled = objectiveEnabledProp ?? localObjectiveEnabled;
  const handleObjectiveEnabledChange = useCallback(
    (enabled: boolean) => {
      if (onObjectiveEnabledChangeProp) {
        onObjectiveEnabledChangeProp(enabled);
        return;
      }
      setLocalObjectiveEnabled(enabled);
    },
    [onObjectiveEnabledChangeProp],
  );
  const clearSelectedSkill = useCallback(() => {
    setActiveCapability(null);
  }, [setActiveCapability]);
  useComposerInitialSkill(composerController, initialInputCapability);
  const handleSelectInputCapability = useCallback(
    (capability: InputCapabilitySelection) => {
      if (capability.kind === "installed_skill") {
        insertComposerSkill(composerController, capability.skill);
        setInput(composerController.getDocument().text);
      }
    },
    [composerController, setInput],
  );
  const skillSelection = buildSkillSelectionProps({
    skills,
    isSkillsLoading,
    onSkillSuggestionsNeeded,
  });
  const isComposerBusy = isLoading || disabled || isGoalSubmitting;
  const {
    clearPendingImages,
    handleDragOver,
    handleDrop,
    openFileDialog,
    handlePaste,
    handleRemoveImage,
    pendingImages,
  } = useComposerAttachments({
    onAddPathReferences: handleAddPathReferences,
    controller: composerController,
  });

  useEffect(() => {
    if (!inputRestoreRequest || isComposerBusy) {
      return;
    }

    if (inputRestoreTokenState === "pending") return;
    if (
      !canRestoreComposerSubmission({
        controller: composerController,
        coordinator: composerDraftCoordinator,
        token: inputRestoreRequest.composerRestoreToken,
        scope: { projectId, sessionId },
      })
    ) {
      onInputRestoreRequestHandled?.(inputRestoreRequest.requestId);
      return;
    }
    if (!restoreComposerDraft(composerController, inputRestoreRequest)) return;
    inputRestoreEpochRef.current += 1;
    const { requestId } = inputRestoreRequest;
    setInput(composerController.getDocument().text);
    onInputRestoreRequestHandled?.(requestId);
  }, [
    inputRestoreRequest,
    inputRestoreTokenState,
    composerController,
    composerDraftCoordinator,
    projectId,
    sessionId,
    setInput,
    isComposerBusy,
    onAddPathReferences,
    onClearPathReferences,
    onInputRestoreRequestHandled,
    setComposerText,
    setActiveCapability,
    skills,
  ]);

  const handleSend = async (
    inputOverride = input,
    modeState?: {
      goalEnabled?: boolean;
      planEnabled?: boolean;
      subagentEnabled?: boolean;
    },
    triggerMetadata?: BaseComposerSendMetadata,
  ) => {
    const currentDraft = composerController.getDocument();
    const pendingImages = [...currentDraft.attachments];
    const pathReferences = [...currentDraft.pathReferences];
    const submissionCapability = currentDraft.inputCapabilityRoute
      ? resolveInputCapabilitySelectionFromRoute({
          route: currentDraft.inputCapabilityRoute as InputCapabilitySendRoute,
        })
      : null;
    const composerInputOverride =
      inputOverride === input
        ? composerController.getDocument().text
        : inputOverride;
    const handlerEnteredAt = Date.now();
    const triggeredAt =
      typeof triggerMetadata?.triggeredAt === "number" &&
      Number.isFinite(triggerMetadata.triggeredAt)
        ? triggerMetadata.triggeredAt
        : handlerEnteredAt;
    const triggerSource = triggerMetadata?.triggerSource ?? "adapter";
    recordAgentUiPerformanceMetric("inputbar.send.enter", {
      durationMs: Math.max(0, handlerEnteredAt - triggeredAt),
      hasTriggerMetadata: Boolean(triggerMetadata),
      imageCount: pendingImages.length,
      inputLength: composerInputOverride.trim().length,
      pathReferenceCount: pathReferences.length,
      sessionId: sessionId ?? null,
      source: "empty-state",
      triggerSource,
      workspaceId: projectId ?? null,
    });
    const sendRestoreEpoch = inputRestoreEpochRef.current;
    const hasPathReferences = currentDraft.pathReferences.length > 0;
    if (
      isComposerBusy ||
      goalSubmissionPending.current ||
      (!composerInputOverride.trim() &&
        currentDraft.attachments.length === 0 &&
        currentDraft.pendingPastes.length === 0 &&
        !hasPathReferences)
    ) {
      return { kind: "rejected" as const };
    }
    const capabilityDispatch = {
      ...resolveInputCapabilityDispatch(
        submissionCapability,
        composerInputOverride,
      ),
      capabilityRoute: currentDraft.inputCapabilityRoute as
        | InputCapabilitySendRoute
        | undefined,
    };
    const submitTarget: ComposerSubmitTarget =
      triggerMetadata?.submitTarget ?? (isLoading ? "steer" : "start");
    setComposerControllerText(composerInputOverride);
    let goalHistoryText: string | undefined;
    const settlement = createComposerSubmissionSettlement({
      controller: composerController,
      coordinator: composerDraftCoordinator,
      target: submitTarget,
      onDraftAccepted: onComposerDraftAccepted,
      scope: { projectId, sessionId },
      canApplyUi: () =>
        mounted.current &&
        surface.current.composerController === composerController &&
        surface.current.composerDraftCoordinator === composerDraftCoordinator &&
        (!!composerDraftCoordinator ||
          (surface.current.projectId === projectId &&
            surface.current.sessionId === sessionId)) &&
        inputRestoreEpochRef.current === sendRestoreEpoch,
      onAccepted: (result, draft) => {
        const historyText = goalHistoryText ?? draft?.text;
        if (historyText?.trim()) {
          runRuntimeSubmissionEffect(result.receipt, "accepted_submit", () => {
            void promptHistoryClientRef.current
              ?.appendPromptHistory({
                threadId: result.receipt.threadId,
                text: historyText,
              })
              .catch(() => undefined);
          });
        }
      },
      onCommitted: (result) => {
        runRuntimeSubmissionEffect(result.receipt, "accepted_submit", () =>
          setComposerText(""),
        );
        runRuntimeSubmissionEffect(
          result.receipt,
          "accepted_submit",
          clearPendingImages,
        );
        runRuntimeSubmissionEffect(result.receipt, "accepted_submit", () =>
          onClearPathReferences?.(),
        );
        runRuntimeSubmissionEffect(result.receipt, "accepted_submit", () =>
          clearSelectedSkill?.(),
        );
      },
    });
    const composerReceipt = settlement.receipt;
    if (!composerReceipt) return { kind: "rejected" as const };
    if (composerReceipt.kind === "empty") {
      return { kind: "rejected" as const };
    }
    const goalCommand = composerInputOverride
      .trimStart()
      .match(/^\/go+al(?=$| )/);
    const goalDraft =
      (modeState?.goalEnabled ?? objectiveEnabled) || goalCommand
        ? prepareThreadGoalDraft(composerReceipt, goalCommand?.[0].length)
        : null;
    if (goalDraft) {
      if (
        composerReceipt.submission.pathReferences.length ||
        composerReceipt.draft.inputCapabilityRoute
      ) {
        toast.error(t("agentChat.threadGoal.composer.unsupportedContext"));
        return { kind: "rejected" as const };
      }
      if (
        !goalDraft.objective &&
        !goalDraft.pastedTextAttachments.length &&
        !goalDraft.imageAttachments.length
      ) {
        handleObjectiveEnabledChange(true);
        setComposerText("");
        return { kind: "local-handled" as const };
      }
      goalHistoryText = formatThreadGoalPrompt(goalDraft.objective);
    }
    const imagesToSend =
      composerReceipt.submission.attachments.length > 0
        ? [...composerReceipt.submission.attachments]
        : undefined;
    const baseRequestMetadata = buildPathReferenceRequestMetadata(
      capabilityDispatch.requestMetadata,
      [...composerReceipt.submission.pathReferences],
    );
    const inputbarModeState = {
      planEnabled: modeState?.planEnabled ?? taskEnabled,
      subagentEnabled: modeState?.subagentEnabled ?? subagentEnabled,
    };
    const requestMetadata = baseRequestMetadata;
    const toolPreferencesOverride =
      buildInputbarToolPreferencesOverride(inputbarModeState);
    const collaborationMode = inputbarModeState.planEnabled
      ? ("plan" as const)
      : undefined;
    const effectiveInput = composerReceipt.submission.text.trim()
      ? composerReceipt.submission.text
      : hasPathReferences
        ? homeSurfaceCopy.composerPathReferenceFallbackPrompt
        : composerInputOverride;
    const inputRestoreDraft = {
      ...composerReceipt.draft,
      images: [...composerReceipt.draft.attachments],
      inputCapabilityRoute: composerReceipt.draft.inputCapabilityRoute as
        | InputCapabilitySendRoute
        | undefined,
    };
    const shouldAttachInputRestoreDraft = true;
    const sendOptions =
      capabilityDispatch.capabilityRoute ||
      capabilityDispatch.displayContent ||
      requestMetadata ||
      toolPreferencesOverride ||
      collaborationMode ||
      shouldAttachInputRestoreDraft
        ? {
            ...(capabilityDispatch.capabilityRoute
              ? { capabilityRoute: capabilityDispatch.capabilityRoute }
              : {}),
            ...(shouldAttachInputRestoreDraft ? { inputRestoreDraft } : {}),
            ...(capabilityDispatch.displayContent
              ? { displayContent: capabilityDispatch.displayContent }
              : {}),
            ...(requestMetadata ? { requestMetadata } : {}),
            ...(toolPreferencesOverride ? { toolPreferencesOverride } : {}),
            ...(collaborationMode ? { collaborationMode } : {}),
          }
        : undefined;

    try {
      const payload = {
        onRuntimeAccepted: settlement.onRuntimeAccepted,
        composerRestoreToken: settlement.composerRestoreToken,
        composerDraftCapture: settlement.composerDraftCapture,
        images: imagesToSend,
        textOverride: effectiveInput,
        sendOptions,
        composerIntent: composerReceipt.intent,
        composerTarget: composerReceipt.target,
        composerDraft: composerReceipt.draft,
        composerSubmission: composerReceipt.submission,
        ...(triggerMetadata
          ? {
              triggeredAt: triggerMetadata.triggeredAt,
              triggerSource: triggerMetadata.triggerSource,
            }
          : {}),
      };
      if (goalDraft) {
        goalSubmissionPending.current = true;
        setIsGoalSubmitting(true);
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
            inputRestoreEpochRef.current !== sendRestoreEpoch ||
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
      return settlement.reject(error);
    } finally {
      if (goalDraft) {
        goalSubmissionPending.current = false;
        if (mounted.current) setIsGoalSubmitting(false);
      }
    }
  };

  const handleComposerHistoryRecall = (draft: ComposerDraftSnapshot) => {
    setInput(draft.text);
  };

  const handleStop = useCallback(() => {
    onStop?.();
  }, [onStop]);

  const composerPanel = (
    <EmptyStateComposerFrame>
      <EmptyStateComposerPanel
        input={composerSnapshot.document.text}
        setInput={setComposerText}
        controller={composerController}
        onHistoryRecall={handleComposerHistoryRecall}
        placeholder={homeSurfaceCopy.composerPlaceholder}
        onSend={handleSend}
        onStop={handleStop}
        sendOnPointerDown={sendOnPointerDown}
        activeTheme={activeTheme}
        providerType={providerType}
        setProviderType={setProviderType}
        model={model}
        setModel={setModel}
        reasoningEffort={reasoningEffort}
        setReasoningEffort={setReasoningEffort}
        accessMode={accessMode}
        setAccessMode={setAccessMode}
        onManageProviders={onManageProviders}
        isLoading={isComposerBusy}
        disabled={isComposerBusy}
        skillSelection={skillSelection}
        onSelectInputCapability={handleSelectInputCapability}
        projectId={projectId}
        openedProjects={openedProjects}
        onProjectContextChange={onProjectContextChange}
        sessionId={sessionId}
        copy={homeSurfaceCopy.composer}
        inputbarCopy={inputbarCoreCopy}
        pluginSuggestions={pluginSuggestions}
        pluginSuggestionsError={pluginSuggestionsError}
        pluginSuggestionsLoading={pluginSuggestionsLoading}
        onPluginSuggestionsNeeded={onPluginSuggestionsNeeded}
        taskEnabled={taskEnabled}
        onTaskEnabledChange={onTaskEnabledChange}
        objectiveEnabled={objectiveEnabled}
        onObjectiveEnabledChange={handleObjectiveEnabledChange}
        subagentEnabled={subagentEnabled}
        onSubagentEnabledChange={onSubagentEnabledChange}
        pendingImages={pendingImages}
        onAddFiles={openFileDialog}
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onRemoveImage={handleRemoveImage}
        pathReferences={pathReferences}
        onRemovePathReference={handleRemovePathReference}
      />
    </EmptyStateComposerFrame>
  );

  return (
    <EmptyStateLayout
      composer={composerPanel}
    />
  );
};
