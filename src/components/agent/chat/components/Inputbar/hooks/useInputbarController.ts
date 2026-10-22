import type {
  ComposerDraftCoordinator,
  ComposerDraftCapture,
} from "@/components/input-kit/ComposerDraftCoordinator";
import type { AcceptedRuntimeSubmissionResult } from "@/components/agent/chat/hooks/agentSendResult";
import { restoreComposerDraft } from "../../../hooks/composerDraftRestore";
import type {
  ComposerController,
  ComposerDraftSnapshot,
} from "@/components/input-kit";
import {
  useComposerInitialSkill,
  useComposerCapabilitySelection,
} from "../../../skill-selection/useComposerCapabilitySelection";
import { insertComposerSkill } from "../../../skill-selection/composerCapabilityMention";
import type { ComposerEditorHandle } from "@/components/input-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useHintRoutes } from "./useHintRoutes";
import { useComposerAttachments } from "../../useComposerAttachments";
import { useInputbarAdapter } from "./useInputbarAdapter";
import { useInputbarSend } from "./useInputbarSend";
import { useThreadGoalComposer } from "./useThreadGoalComposer";
import { formatThreadGoalPrompt } from "../../newThreadGoalSubmission";
import type { ThreadGoal } from "@limecloud/app-server-client";
import {
  type InputbarToolStates,
  useInputbarToolState,
} from "./useInputbarToolState";
import {
  buildSkillSelectionProps,
  type SkillSelectionSourceProps,
} from "../../../skill-selection/skillSelectionBindings";
import type {
  WorkflowGateState,
  WorkflowStep,
} from "../../../utils/workflowInputState";
import { useWorkflowInputState } from "../../../utils/workflowInputState";

import type { MessagePathReference } from "../../../types";
import { type InputCapabilitySelection } from "../../../skill-selection/inputCapabilitySelection";

import type { InputbarSendHandler } from "../inputbarSendPayload";
import {
  canRestoreComposerSubmission,
  useComposerSubmissionRestoreState,
  type ScopedComposerRestoreRequest,
} from "../../composerSubmissionSettlement";
import type { AgentInitialInputCapabilityParams } from "@/types/page";

import { buildInputbarWorkflowStateCopy } from "../inputbarWorkflowCopy";
import { logAgentDebug } from "@/lib/agentDebug";
import type { ModelReasoningEffortLevel } from "@/lib/types/modelRegistry";
import { useComposerController } from "@/components/input-kit/useComposerController";
import type { ComposerSubmitTarget } from "@/components/input-kit/types";
import { AppServerClient } from "@/lib/api/appServer";
import { readPromptHistory } from "@/lib/api/promptHistory";
import { type InputbarPluginCapability } from "../pluginInputCapability";

interface UseInputbarControllerParams {
  composerController?: ComposerController;
  composerDraftCoordinator?: ComposerDraftCoordinator;
  onComposerDraftAccepted?: (
    capture: ComposerDraftCapture,
    result: AcceptedRuntimeSubmissionResult,
  ) => Promise<void> | void;
  input: string;
  hasAdditionalContent?: boolean;
  setInput: (value: string) => void;
  onSend: InputbarSendHandler;
  onStop?: () => void;
  isLoading: boolean;
  disabled?: boolean;
  providerType?: string;
  setProviderType?: (type: string) => void;
  model?: string;
  setModel?: (model: string) => void;
  reasoningEffort?: ModelReasoningEffortLevel | "";
  setReasoningEffort?: (value: ModelReasoningEffortLevel | "") => void;
  toolStates?: Partial<InputbarToolStates>;
  onToolStatesChange?: (states: Partial<InputbarToolStates>) => void;
  initialInputCapability?: AgentInitialInputCapabilityParams;
  variant?: "default" | "workspace";
  workflowGate?: WorkflowGateState | null;
  workflowSteps?: WorkflowStep[];
  workflowRunState?: "idle" | "auto_running" | "await_user_decision";
  pluginSuggestions?: InputbarPluginCapability[];
  projectId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  threadGoal?: ThreadGoal | null;
  pathReferences?: MessagePathReference[];
  onAddPathReferences?: (references: MessagePathReference[]) => void;
  onClearPathReferences?: () => void;
  inputRestoreRequest?: ScopedComposerRestoreRequest | null;
  onInputRestoreRequestHandled?: (requestId: string) => void;
  submitTarget?: ComposerSubmitTarget;
}

export function useInputbarController({
  composerController: externalComposerController,
  composerDraftCoordinator,
  onComposerDraftAccepted,
  input,
  hasAdditionalContent,
  setInput,
  onSend,
  onStop,
  isLoading,
  disabled,
  providerType,
  setProviderType,
  model,
  setModel,
  reasoningEffort,
  setReasoningEffort,
  toolStates,
  onToolStatesChange,
  initialInputCapability,
  variant = "default",
  workflowGate,
  workflowSteps = [],
  workflowRunState,
  pluginSuggestions = [],
  projectId = null,
  sessionId = null,
  threadId = null,
  threadGoal = null,
  pathReferences: initialPathReferences = [],
  onAddPathReferences,
  onClearPathReferences,
  inputRestoreRequest = null,
  onInputRestoreRequestHandled,
  submitTarget,
  skills,
  isSkillsLoading,
}: UseInputbarControllerParams & SkillSelectionSourceProps) {
  const { t } = useTranslation("agent");
  const workflowCopy = useMemo(
    () => buildInputbarWorkflowStateCopy((key, values) => t(key, values ?? {})),
    [t],
  );
  const inputRestoreTokenState = useComposerSubmissionRestoreState(
    inputRestoreRequest?.composerRestoreToken,
  );
  const inputRestoreEpochRef = useRef(0);
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
  const pathReferences = useMemo(
    () => [...composerSnapshot.document.pathReferences],
    [composerSnapshot.document.pathReferences],
  );
  const [activeCapability, setActiveCapability] =
    useComposerCapabilitySelection(composerController);
  const {
    pendingImages,
    handlePaste,
    handleDragOver,
    handleDrop,
    handleRemoveImage,
    clearPendingImages,
    openFileDialog,
  } = useComposerAttachments({
    controller: composerController,
    onAddPathReferences,
  });
  const handleComposerHistoryRecall = useCallback(
    (draft: ComposerDraftSnapshot) => {
      setInput(draft.text);
    },
    [setInput],
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
    if (composerController.getDocument().text !== input) {
      setComposerControllerText(input);
    }
  }, [composerController, input, setComposerControllerText]);
  const emittedComposerTextRef = useRef(input);
  useEffect(() => {
    if (emittedComposerTextRef.current === composerSnapshot.document.text)
      return;
    emittedComposerTextRef.current = composerSnapshot.document.text;
    setInput(composerSnapshot.document.text);
  }, [composerSnapshot.document.text, setInput]);
  const editorRef = useRef<ComposerEditorHandle>(null);
  const isWorkspaceVariant = variant === "workspace";
  useComposerInitialSkill(composerController, initialInputCapability);
  useEffect(() => {
    if (!inputRestoreRequest) {
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
    const restoreEpoch = inputRestoreEpochRef.current;
    const { draft, requestId } = inputRestoreRequest;
    logAgentDebug("Inputbar", "inputRestoreRequest.apply", {
      draftImageCount: draft.images?.length ?? 0,
      draftPathReferenceCount: draft.pathReferences?.length ?? 0,
      draftTextLength: draft.text.trim().length,
      hasCapabilityRoute: Boolean(draft.inputCapabilityRoute),
      requestId,
      restoreEpoch,
    });
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
    onAddPathReferences,
    onClearPathReferences,
    onInputRestoreRequestHandled,
    setComposerText,
    setActiveCapability,
    skills,
  ]);

  const openComposerFiles = useCallback(async () => {
    const editor = editorRef.current;
    const added = await openFileDialog();
    if (
      added &&
      editorRef.current === editor &&
      editor?.getElement()?.isConnected
    ) {
      editor.focus();
    }
    return added;
  }, [openFileDialog]);

  const {
    activeTools: runtimeTools,
    handleToolClick: handleRuntimeToolClick,
    isFullscreen,
  } = useInputbarToolState({
    toolStates,
    onToolStatesChange,
    openFileDialog: openComposerFiles,
  });

  const goalComposer = useThreadGoalComposer({
    controller: composerController,
    coordinator: composerDraftCoordinator,
    projectId,
    sessionId,
    threadId,
    threadGoal,
    focusComposer: () => editorRef.current?.focus(),
    onCommitted: () => setInput(composerController.getDocument().text),
    onGoalSaved: (savedThreadId, objective) => {
      void promptHistoryClientRef.current
        ?.appendPromptHistory({
          threadId: savedThreadId,
          text: formatThreadGoalPrompt(objective),
        })
        .catch(() => undefined);
    },
  });
  const activeTools = useMemo(
    () =>
      threadId
        ? {
            ...runtimeTools,
            objective_mode: goalComposer.pendingThreadGoalObjective !== null,
          }
        : runtimeTools,
    [runtimeTools, threadId, goalComposer.pendingThreadGoalObjective],
  );
  const handleToolClick = useCallback(
    (tool: string) => {
      if (threadId && tool === "objective_mode") {
        if (goalComposer.pendingThreadGoalObjective === null)
          goalComposer.openGoalEditor();
        else goalComposer.closeGoalEditor();
        return;
      }
      handleRuntimeToolClick(tool);
    },
    [threadId, goalComposer, handleRuntimeToolClick],
  );

  const {
    showHintPopup,
    hintRoutes,
    hintIndex,
    handleSetInput,
    handleHintSelect,
    handleHintKeyDown,
  } = useHintRoutes({
    setInput: setComposerText,
    editorRef,
  });

  const [isNewGoalSubmitting, setIsNewGoalSubmitting] = useState(false);
  const handleSend = useInputbarSend({
    input,
    hasAdditionalContent,
    isLoading,
    pendingImages,
    pathReferences,
    activeCapability,
    activeTools,
    projectId,
    sessionId,
    onSend,
    clearPendingImages,
    clearPathReferences: onClearPathReferences,
    clearActiveCapability: () => setActiveCapability(null),
    getInputRestoreEpoch: () => inputRestoreEpochRef.current,
    composerController,
    composerDraftCoordinator,
    onComposerDraftAccepted,
    onComposerAccepted: (draft, result, historyText) => {
      const text = historyText ?? draft?.text;
      if (text?.trim()) {
        void promptHistoryClientRef.current
          ?.appendPromptHistory({
            threadId: result.receipt.threadId,
            text,
          })
          .catch(() => undefined);
      }
    },
    onComposerCommitted: (text) => {
      setInput(text);
    },
    submitTarget,
    prepareThreadGoalSubmit: threadId
      ? goalComposer.prepareThreadGoalSubmit
      : undefined,
    onGoalModeEnabled: () => {
      if (!runtimeTools["objective_mode"])
        handleRuntimeToolClick("objective_mode");
      setComposerText("");
    },
    onGoalSubmittingChange: setIsNewGoalSubmitting,
  });
  const handleInterrupt = useCallback(() => {
    onStop?.();
  }, [onStop]);
  const inputAdapter = useInputbarAdapter({
    input,
    setInput: handleSetInput,
    isLoading,
    disabled: disabled || goalComposer.isSubmitting || isNewGoalSubmitting,
    providerType,
    setProviderType,
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    handleSend,
    onStop: handleInterrupt,
    pendingImages,
  });

  const {
    workflowQuickActions,
    workflowQueueItems,
    workflowActiveItem,
    workflowQueueTotalCount,
    workflowCompletedCount,
    workflowTotalCount,
    workflowProgressLabel,
    workflowSummaryLabel,
    renderWorkflowGeneratingPanel,
  } = useWorkflowInputState({
    isWorkspaceVariant,
    workflowGate,
    workflowSteps,
    workflowRunState,
    isSending: inputAdapter.state.isSending,
    copy: workflowCopy,
  });

  const handleSelectInputCapability = (
    capability: InputCapabilitySelection,
  ) => {
    if (capability.kind === "installed_skill") {
      insertComposerSkill(composerController, capability.skill);
      setInput(composerController.getDocument().text);
    }
  };
  const skillSelection = buildSkillSelectionProps({
    skills,
    isSkillsLoading,
  });

  return {
    pathReferences,
    handleComposerHistoryRecall,
    editorRef,
    composerController,
    isWorkspaceVariant,
    pendingImages,
    handlePaste,
    handleDragOver,
    handleDrop,
    handleRemoveImage,
    showHintPopup,
    hintRoutes,
    hintIndex,
    handleHintSelect,
    handleHintKeyDown,
    activeTools,
    handleToolClick,
    isFullscreen,
    handleSend,
    goalComposer,
    inputAdapter,
    pluginSuggestions,
    workflowQuickActions,
    workflowQueueItems,
    workflowActiveItem,
    workflowQueueTotalCount,
    workflowCompletedCount,
    workflowTotalCount,
    workflowProgressLabel,
    workflowSummaryLabel,
    renderWorkflowGeneratingPanel,
    skillSelection,
    handleSelectInputCapability,
    activeCapability,
  };
}
