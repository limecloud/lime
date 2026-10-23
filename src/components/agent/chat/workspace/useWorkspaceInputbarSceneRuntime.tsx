import type {
  ComposerDraftCoordinator,
  ComposerDraftStatus as DraftStatus,
} from "@/components/input-kit/ComposerDraftCoordinator";
import { ComposerDraftStatus } from "./ComposerDraftStatus";
import { useBrowserAnnotationSend } from "./useBrowserAnnotationSend";
import { submitWorkspaceQueue } from "./workspaceQueueSubmission";
import {
  useCallback,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ComposerController } from "@/components/input-kit/ComposerController";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  AgentInitialInputCapabilityParams,
  AgentInitialKnowledgePackSelectionParams,
} from "@/types/page";
import { PendingRequestItemPanel } from "../components/PendingRequestItemPanel";
import { StrictReviewStatus } from "../components/StrictReviewStatus";
import {
  PendingInteractionLayer,
  selectActivePendingInteraction,
} from "../components/PendingInteractionLayer";
import { usePendingInteractions } from "../hooks/usePendingInteractions";
import { useStrictReviewStatus } from "../hooks/useStrictReviewStatus";
import { useWorkspaceNavigationActions } from "./useWorkspaceNavigationActions";
import type { ConfirmResponse } from "../types";
import {
  DEFAULT_CHAT_TOOL_PREFERENCES,
  type ChatToolPreferences,
} from "../utils/chatToolPreferences";
import { deriveRuntimeToolAvailability } from "../utils/runtimeToolAvailability";
import type { WorkspaceGeneralWorkbenchHarnessPanelBaseProps } from "./useWorkspaceGeneralWorkbenchHarnessSurfaceRuntime";
import {
  getInputbarSendOptions,
  type InputbarSendHandler,
} from "../components/Inputbar/inputbarSendPayload";
import { buildTurnInput } from "../utils/buildUserInputSubmitOp";
import { addThreadQueue } from "@/lib/api/agentRuntime/threadQueueActions";
import type { WorkspaceHandleSend } from "./useWorkspaceSendActions";
import type { SendMessageFn } from "../hooks/agentChatShared";
import { useAsyncUserInput } from "./useAsyncUserInput";
import { QuestionSelectionContext } from "../components/asyncUserInput/QuestionSelectionContext";

import { useWorkspaceKnowledgeRuntime } from "./knowledge/useWorkspaceKnowledgeRuntime";
import { selectPendingInputbarApprovalAction } from "./inputbarApprovalAction";
import {
  useWorkspaceInputbarScenePresentationRuntime,
  type GeneralWorkbenchDialogParams,
  type InputbarParams,
  type InputbarPresentationParams,
  type InputbarScenePresentationParams,
  type WorkspaceInputbarToolStates,
} from "./useWorkspaceInputbarScenePresentationRuntime";

type NavigationActions = ReturnType<typeof useWorkspaceNavigationActions>;

interface UseWorkspaceInputbarSceneRuntimeParams {
  contextVariant?: "default" | "task-center";
  taskFiles?: InputbarScenePresentationParams["taskFiles"];
  selectedFileId?: InputbarScenePresentationParams["selectedFileId"];
  isThemeWorkbench: InputbarScenePresentationParams["isThemeWorkbench"];
  sessionId: InputbarParams["sessionId"];
  threadId: InputbarParams["threadId"];
  submitTarget?: InputbarParams["submitTarget"];
  canAcceptDirectInput?: boolean | null;
  threadGoal: InputbarParams["threadGoal"];
  threadGoalError: InputbarParams["threadGoalError"];
  threadGoalLoading: InputbarParams["threadGoalLoading"];
  generalWorkbenchHarnessPanelBaseProps: WorkspaceGeneralWorkbenchHarnessPanelBaseProps;
  currentSessionTitle: string | null | undefined;
  handleStopSending: InputbarParams["onStop"];
  input: InputbarParams["input"];
  composerController?: ComposerController;
  composerDraftCoordinator?: ComposerDraftCoordinator;
  onComposerDraftAccepted?: InputbarParams["onComposerDraftAccepted"];
  composerDraftStatus?: DraftStatus | null;
  composerDraftRestoring?: boolean;
  setInput: InputbarParams["setInput"];
  currentGate: InputbarParams["workflowGate"];
  generalWorkbenchWorkflowSteps: InputbarParams["workflowSteps"];
  steps: InputbarParams["workflowSteps"];
  workflowRunState: InputbarParams["workflowRunState"];
  handleSend: WorkspaceHandleSend;
  sendMessage?: SendMessageFn;
  isPreparingSend: boolean;
  isSending: boolean;
  isSessionRestoring?: boolean;
  providerType: InputbarParams["providerType"];
  setProviderType: InputbarParams["setProviderType"];
  model: InputbarParams["model"];
  setModel: InputbarParams["setModel"];
  reasoningEffort: InputbarParams["reasoningEffort"];
  setReasoningEffort: InputbarParams["setReasoningEffort"];
  sessionExecutionRuntime: InputbarParams["executionRuntime"];
  projectId: string | null | undefined;
  projectRootPath: string | null | undefined;
  accessMode: InputbarParams["accessMode"];
  setAccessMode: InputbarParams["setAccessMode"];
  activeTheme: InputbarParams["activeTheme"];
  navigationActions: Pick<
    NavigationActions,
    | "handleManageProviders"
    | "handleOpenExecutionPolicySettings"
    | "handleOpenRuntimeMemoryWorkbench"
    | "handleOpenKnowledgeManagement"
  >;
  skills: InputbarParams["skills"];
  skillsLoading: InputbarParams["isSkillsLoading"];
  onSkillSuggestionsNeeded?: InputbarParams["onSkillSuggestionsNeeded"];
  initialInputCapability?: AgentInitialInputCapabilityParams;
  initialKnowledgePackSelection?: AgentInitialKnowledgePackSelectionParams;
  pluginSuggestions?: InputbarParams["pluginSuggestions"];
  pluginSuggestionsError?: string | null;
  pluginSuggestionsLoading?: boolean;
  onPluginSuggestionsNeeded?: InputbarParams["onPluginSuggestionsNeeded"];
  setChatToolPreferences: Dispatch<SetStateAction<ChatToolPreferences>>;
  objectiveEnabled?: boolean;
  onObjectiveEnabledChange?: (enabled: boolean) => void;
  soulArtifactVoiceGenerationBrief?: Record<string, unknown> | null;
  soulArtifactVoiceEnabledForTurn: boolean;
  onSoulArtifactVoiceEnabledForTurnChange: (enabled: boolean) => void;
  generalWorkbenchEntryPrompt: InputbarPresentationParams["generalWorkbenchEntryPrompt"];
  handleRestartGeneralWorkbenchEntryPrompt: InputbarPresentationParams["onRestartGeneralWorkbenchEntryPrompt"];
  handleContinueGeneralWorkbenchEntryPrompt: InputbarPresentationParams["onContinueGeneralWorkbenchEntryPrompt"];
  planDecisionAccessory?: InputbarPresentationParams["planDecisionAccessory"];
  generalWorkbenchEnabled: boolean;
  harnessPanelVisible: GeneralWorkbenchDialogParams["open"];
  setHarnessPanelVisible: GeneralWorkbenchDialogParams["onOpenChange"];
  harnessState: GeneralWorkbenchDialogParams["harnessState"];
  mappedTheme: GeneralWorkbenchDialogParams["activeTheme"];
  activeRuntimeStatusTitle: GeneralWorkbenchDialogParams["runtimeStatusTitle"];
  chatToolPreferences?: ChatToolPreferences;
  pathReferences: InputbarParams["pathReferences"];
  onAddPathReferences: InputbarParams["onAddPathReferences"];
  inputRestoreRequest?: InputbarParams["inputRestoreRequest"];
  onInputRestoreRequestHandled?: InputbarParams["onInputRestoreRequestHandled"];
  onRemovePathReference: InputbarParams["onRemovePathReference"];
  onClearPathReferences: InputbarParams["onClearPathReferences"];
}

export function useWorkspaceInputbarSceneRuntime({
  contextVariant = "default",
  isThemeWorkbench,
  sessionId,
  threadId,
  submitTarget,
  canAcceptDirectInput,
  threadGoal,
  threadGoalError,
  threadGoalLoading,
  generalWorkbenchHarnessPanelBaseProps,
  currentSessionTitle,
  handleStopSending,
  input,
  composerController,
  composerDraftCoordinator,
  onComposerDraftAccepted,
  composerDraftStatus = null,
  composerDraftRestoring = false,
  setInput,
  currentGate,
  generalWorkbenchWorkflowSteps,
  steps,
  workflowRunState,
  handleSend,
  sendMessage,
  isPreparingSend,
  isSending,
  isSessionRestoring = false,
  providerType,
  setProviderType,
  model,
  setModel,
  reasoningEffort,
  setReasoningEffort,
  sessionExecutionRuntime,
  projectId,
  projectRootPath,
  accessMode,
  setAccessMode,
  activeTheme,
  navigationActions,
  skills,
  skillsLoading,
  onSkillSuggestionsNeeded,
  initialInputCapability,
  initialKnowledgePackSelection,
  pluginSuggestions,
  pluginSuggestionsError,
  pluginSuggestionsLoading,
  onPluginSuggestionsNeeded,
  setChatToolPreferences,
  objectiveEnabled = false,
  onObjectiveEnabledChange,
  soulArtifactVoiceGenerationBrief,
  soulArtifactVoiceEnabledForTurn,
  onSoulArtifactVoiceEnabledForTurnChange,
  generalWorkbenchEntryPrompt,
  handleRestartGeneralWorkbenchEntryPrompt,
  handleContinueGeneralWorkbenchEntryPrompt,
  planDecisionAccessory,
  generalWorkbenchEnabled,
  harnessPanelVisible,
  setHarnessPanelVisible,
  harnessState,
  mappedTheme,
  activeRuntimeStatusTitle,
  chatToolPreferences,
  pathReferences,
  onAddPathReferences,
  inputRestoreRequest,
  onInputRestoreRequestHandled,
  onRemovePathReference,
  onClearPathReferences,
}: UseWorkspaceInputbarSceneRuntimeParams) {
  const { t } = useTranslation("agent");
  const {
    interactions: pendingInteractions,
    respond: respondPendingInteraction,
    dismiss: dismissPendingInteraction,
  } = usePendingInteractions();
  const pendingInteractionThreadId = threadId?.trim() || sessionId?.trim();
  const activePendingInteraction = useMemo(
    () =>
      selectActivePendingInteraction(
        pendingInteractions,
        pendingInteractionThreadId,
      ),
    [pendingInteractionThreadId, pendingInteractions],
  );
  const strictReviewStatus = useStrictReviewStatus({
    threadId: pendingInteractionThreadId,
  });
  const directInputBlocked = canAcceptDirectInput === false;
  const knowledgeRuntime = useWorkspaceKnowledgeRuntime({
    projectRootPath,
    currentSessionTitle,
    input,
    setInput,
    handleSend,
    onOpenKnowledgeManagement: navigationActions.handleOpenKnowledgeManagement,
    initialKnowledgePackSelection,
  });
  const resolvedChatToolPreferences =
    chatToolPreferences ?? DEFAULT_CHAT_TOOL_PREFERENCES;
  const asyncUserInput = useAsyncUserInput({
    threadId,
    sessionId,
    items: generalWorkbenchHarnessPanelBaseProps.threadItems ?? [],
    turns: generalWorkbenchHarnessPanelBaseProps.turns ?? [],
    enabled: !directInputBlocked && !isSessionRestoring,
    sendMessage,
    collaborationMode: resolvedChatToolPreferences.task ? "plan" : undefined,
  });
  const inputbarApprovalAction = useMemo(
    () =>
      selectPendingInputbarApprovalAction(
        generalWorkbenchHarnessPanelBaseProps.pendingActions ?? [],
        generalWorkbenchHarnessPanelBaseProps.submittedActionsInFlight ?? [],
      ),
    [
      generalWorkbenchHarnessPanelBaseProps.pendingActions,
      generalWorkbenchHarnessPanelBaseProps.submittedActionsInFlight,
    ],
  );
  const runtimeToolAvailability = useMemo(
    () =>
      deriveRuntimeToolAvailability(
        generalWorkbenchHarnessPanelBaseProps.toolInventory,
      ),
    [generalWorkbenchHarnessPanelBaseProps.toolInventory],
  );
  const inputbarTargetSessionId = sessionId?.trim() || undefined;
  const sendPendingRef = useRef(false);
  const handleInputbarSendBase = useCallback<InputbarSendHandler>(
    async (payload = {}) => {
      if (
        directInputBlocked ||
        composerDraftRestoring ||
        sendPendingRef.current
      ) {
        return { kind: "rejected" };
      }
      sendPendingRef.current = true;
      try {
        const composerSendOptions = getInputbarSendOptions(payload);
        if (composerSendOptions?.composerTarget === "queue") {
          const targetThreadId = threadId?.trim();
          const requestedSessionId =
            composerSendOptions.targetSessionId?.trim();
          if (
            requestedSessionId &&
            requestedSessionId !== inputbarTargetSessionId
          ) {
            return { kind: "unknown" };
          }
          if (!targetThreadId) {
            return { kind: "rejected" };
          }
          const submission = composerSendOptions.composerSubmission;
          const pathText = (submission?.pathReferences ?? [])
            .map((reference) => reference.path.trim())
            .filter(Boolean)
            .join("\n");
          const content =
            payload.textOverride ||
            submission?.text ||
            (pathText ? `请查看这些文件或文件夹。\n${pathText}` : "");
          if (
            !content.trim() &&
            !(submission?.attachments.length ?? payload.images?.length ?? 0)
          ) {
            return { kind: "rejected" };
          }
          try {
            return await submitWorkspaceQueue({
              sessionId:
                composerSendOptions.targetSessionId?.trim() ||
                inputbarTargetSessionId,
              threadId: targetThreadId,
              clientUserMessageId: crypto.randomUUID(),
              input: buildTurnInput({
                content,
                images: payload.images ?? [],
                inputMentions: composerSendOptions.inputMentions,
                composerSubmission: submission,
              }),
              observer: composerSendOptions.observer,
              addQueue: addThreadQueue,
              onRejected: () =>
                toast.error(String(t("agentChat.threadQueue.actionFailed"))),
            });
          } catch (error) {
            toast.error(String(t("agentChat.threadQueue.actionFailed")));
            return { kind: "rejected", error };
          }
        }
        const payloadTargetSessionId =
          composerSendOptions?.targetSessionId?.trim() || undefined;
        const sendOptions =
          inputbarTargetSessionId || payloadTargetSessionId
            ? {
                ...(composerSendOptions || {}),
                targetSessionId:
                  payloadTargetSessionId ?? inputbarTargetSessionId,
              }
            : composerSendOptions;
        return await handleSend(
          payload.images,
          undefined,
          undefined,
          payload.textOverride,
          "react",
          payload.autoContinuePayload,
          sendOptions,
        );
      } finally {
        sendPendingRef.current = false;
      }
    },
    [
      directInputBlocked,
      composerDraftRestoring,
      handleSend,
      inputbarTargetSessionId,
      t,
      threadId,
    ],
  );
  const handleInputbarSend = useBrowserAnnotationSend(
    handleInputbarSendBase,
    sessionId,
    threadId,
  );
  const handleInputbarToolStatesChange = useCallback(
    (nextToolStates: WorkspaceInputbarToolStates) => {
      if (directInputBlocked) {
        return;
      }
      const hasPlanChange = typeof nextToolStates.plan === "boolean";
      const hasSubagentChange = typeof nextToolStates.subagent === "boolean";
      const hasObjectiveChange = typeof nextToolStates.objective === "boolean";
      if (!hasPlanChange && !hasSubagentChange && !hasObjectiveChange) {
        return;
      }

      if (hasPlanChange || hasSubagentChange) {
        setChatToolPreferences((previous) => ({
          ...previous,
          ...(hasPlanChange ? { task: nextToolStates.plan } : {}),
          ...(hasSubagentChange ? { subagent: nextToolStates.subagent } : {}),
        }));
      }
      if (hasObjectiveChange) {
        onObjectiveEnabledChange?.(nextToolStates.objective === true);
      }
    },
    [directInputBlocked, onObjectiveEnabledChange, setChatToolPreferences],
  );
  const resolvedTurns = useMemo(
    () => generalWorkbenchHarnessPanelBaseProps.turns ?? [],
    [generalWorkbenchHarnessPanelBaseProps.turns],
  );
  const latestTurnPrompt =
    resolvedTurns
      .find(
        (turn) =>
          turn.id === generalWorkbenchHarnessPanelBaseProps.currentTurnId,
      )
      ?.prompt_text?.trim() ||
    resolvedTurns[resolvedTurns.length - 1]?.prompt_text?.trim() ||
    "";
  const approvalAccessory =
    inputbarApprovalAction && !activePendingInteraction ? (
      <PendingRequestItemPanel
        key={inputbarApprovalAction.requestId}
        request={inputbarApprovalAction}
        onSubmit={
          generalWorkbenchHarnessPanelBaseProps.onRespondToAction as
            | ((response: ConfirmResponse) => void | Promise<void>)
            | undefined
        }
      />
    ) : null;

  const presentationRuntime = useWorkspaceInputbarScenePresentationRuntime({
    isThemeWorkbench,
    inputbarPresentation: {
      inputbar: {
        input,
        composerController,
        composerDraftCoordinator,
        onComposerDraftAccepted,
        setInput,
        contextVariant,
        variant: isThemeWorkbench ? "workspace" : "default",
        projectId,
        sessionId,
        threadId,
        submitTarget,
        threadGoal,
        threadGoalError,
        threadGoalLoading,
        workflowGate: isThemeWorkbench ? currentGate : null,
        workflowSteps: isThemeWorkbench ? generalWorkbenchWorkflowSteps : steps,
        workflowRunState,
        onSend: handleInputbarSend,
        onStop: handleStopSending,
        isLoading: isSending,
        providerType,
        setProviderType,
        model,
        setModel,
        reasoningEffort,
        setReasoningEffort,
        executionRuntime: sessionExecutionRuntime,
        accessMode,
        setAccessMode,
        activeTheme,
        onManageProviders: navigationActions.handleManageProviders,
        disabled:
          directInputBlocked ||
          isSessionRestoring ||
          composerDraftRestoring ||
          isPreparingSend ||
          (contextVariant !== "task-center" && !projectId && !sessionId),
        disabledPlaceholder: directInputBlocked
          ? t("agentChat.inputbar.parentOwned.placeholder")
          : undefined,
        skills,
        isSkillsLoading: skillsLoading,
        onSkillSuggestionsNeeded,
        initialInputCapability,
        pluginSuggestions,
        pluginSuggestionsError,
        pluginSuggestionsLoading,
        onPluginSuggestionsNeeded,
        toolStates: {
          objective: objectiveEnabled,
          plan: resolvedChatToolPreferences.task,
          subagent: resolvedChatToolPreferences.subagent,
        },
        onToolStatesChange: handleInputbarToolStatesChange,
        pathReferences,
        onAddPathReferences,
        inputRestoreRequest,
        onInputRestoreRequestHandled,
        onRemovePathReference,
        onClearPathReferences,
      },
      generalWorkbenchEntryPrompt,
      onRestartGeneralWorkbenchEntryPrompt:
        handleRestartGeneralWorkbenchEntryPrompt,
      onContinueGeneralWorkbenchEntryPrompt:
        handleContinueGeneralWorkbenchEntryPrompt,
      approvalAccessory,
      // Reverse requests are the canonical action slot owner. A plan decision
      // must not remain mounted underneath an active request form.
      planDecisionAccessory: activePendingInteraction
        ? undefined
        : planDecisionAccessory,
      soulArtifactVoiceGenerationBrief,
      soulArtifactVoiceEnabledForTurn,
      onSoulArtifactVoiceEnabledForTurnChange,
      generalWorkbenchDialog: {
        enabled: generalWorkbenchEnabled && !isThemeWorkbench,
        open: harnessPanelVisible,
        onOpenChange: setHarnessPanelVisible,
        harnessState,
        ...generalWorkbenchHarnessPanelBaseProps,
        onInterruptCurrentTurn: handleStopSending,
        onManageProviders:
          generalWorkbenchHarnessPanelBaseProps.onManageProviders ??
          navigationActions.handleManageProviders,
        onOpenExecutionPolicySettings:
          generalWorkbenchHarnessPanelBaseProps.onOpenExecutionPolicySettings ??
          navigationActions.handleOpenExecutionPolicySettings,
        onOpenMemoryWorkbench:
          generalWorkbenchHarnessPanelBaseProps.diagnosticRuntimeContext
            ?.sessionId && projectRootPath
            ? () =>
                navigationActions.handleOpenRuntimeMemoryWorkbench({
                  sessionId:
                    generalWorkbenchHarnessPanelBaseProps
                      .diagnosticRuntimeContext?.sessionId || "",
                  workingDir: projectRootPath,
                  userMessage: latestTurnPrompt,
                })
            : undefined,
        activeTheme: mappedTheme,
        toolPreferences: resolvedChatToolPreferences,
        runtimeToolAvailability,
        isSending,
        executionRuntime: sessionExecutionRuntime,
        runtimeStatusTitle: activeRuntimeStatusTitle,
      },
    },
  });
  const pendingInteractionLayer = activePendingInteraction ? (
    <PendingInteractionLayer
      interactions={pendingInteractions}
      threadId={pendingInteractionThreadId}
      onRespond={respondPendingInteraction}
      onDismiss={dismissPendingInteraction}
    />
  ) : null;
  const strictReviewStatusNode =
    strictReviewStatus &&
    !activePendingInteraction &&
    !inputbarApprovalAction ? (
      <StrictReviewStatus status={strictReviewStatus} />
    ) : null;
  const composerStatusNode = pendingInteractionLayer ?? strictReviewStatusNode;
  const asyncQuestionNode = activePendingInteraction
    ? null
    : asyncUserInput.node;
  const draftStatusNode = composerDraftCoordinator ? (
    <ComposerDraftStatus
      status={composerDraftStatus}
      restoring={composerDraftRestoring}
    />
  ) : null;

  return {
    handleInputbarSend,
    ...presentationRuntime,
    inputbarNode: (
      <QuestionSelectionContext.Provider value={Boolean(asyncQuestionNode)}>
        {composerStatusNode || draftStatusNode || asyncQuestionNode ? (
          <div className="w-full min-w-0 space-y-2">
            {composerStatusNode}
            {asyncQuestionNode}
            {presentationRuntime.inputbarNode}
            {draftStatusNode}
          </div>
        ) : (
          presentationRuntime.inputbarNode
        )}
      </QuestionSelectionContext.Provider>
    ),
    knowledgePackSelection: knowledgeRuntime.knowledgePackSelection,
    knowledgePackOptions: knowledgeRuntime.knowledgePackOptions,
    onToggleKnowledgePack: knowledgeRuntime.onToggleKnowledgePack,
    onSelectKnowledgePack: knowledgeRuntime.onSelectKnowledgePack,
    onToggleKnowledgeCompanionPack:
      knowledgeRuntime.onToggleKnowledgeCompanionPack,
    onKnowledgePacksNeeded: knowledgeRuntime.onKnowledgePacksNeeded,
    onStartKnowledgeOrganize: knowledgeRuntime.onStartKnowledgeOrganize,
    onManageKnowledgePacks: knowledgeRuntime.onManageKnowledgePacks,
  };
}
