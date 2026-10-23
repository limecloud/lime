import { ArtifactAnnotationComposerAccessory } from "@/components/artifact/annotations/ArtifactAnnotationComposerAccessory";
import { BrowserAnnotationAccessory } from "../../workspace/right-surface/browser/BrowserAnnotationAccessory";
import { useBrowserAnnotationDrafts } from "../../workspace/right-surface/browser/useBrowserAnnotationDrafts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type {
  ComposerDraftCoordinator,
  ComposerDraftCapture,
} from "@/components/input-kit/ComposerDraftCoordinator";
import type { AcceptedRuntimeSubmissionResult } from "@/components/agent/chat/hooks/agentSendResult";
import React from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
import type { MessagePathReference } from "../../types";

import type { AgentSessionExecutionRuntime } from "@/lib/api/agentExecutionRuntime";
import { InputbarComposerSection } from "./components/InputbarComposerSection";
import { HintRoutePopup } from "./components/HintRoutePopup";
import { InputbarSurface } from "./components/InputbarSurface";
import type { SkillSelectionSourceProps } from "../../skill-selection/skillSelectionBindings";
import type {
  WorkflowGateState,
  WorkflowStep,
} from "../../utils/workflowInputState";
import { type InputbarToolStates } from "./hooks/useInputbarToolState";
import { useInputbarController } from "./hooks/useInputbarController";
import type { AgentAccessMode } from "../../hooks/agentChatStorage";
import type { AgentInitialInputCapabilityParams } from "@/types/page";

import type { InputbarPluginCapability } from "./pluginInputCapability";
import { buildInputbarComposerSectionCopy } from "./components/inputbarComposerSectionCopy";
import { buildInputbarCoreCopy } from "./components/inputbarCoreCopy";
import { buildInputbarWorkflowPanelCopy } from "./inputbarWorkflowCopy";
import type { InputbarSendHandler } from "./inputbarSendPayload";
import type { ScopedComposerRestoreRequest } from "../composerSubmissionSettlement";
import type { ModelReasoningEffortLevel } from "@/lib/types/modelRegistry";
import type { ThreadGoal } from "@limecloud/app-server-client";
import type {
  ComposerController,
  ComposerSubmitTarget,
} from "@/components/input-kit";

const SecondaryControlsRow = styled.div`
  position: absolute;
  right: 8px;
  bottom: calc(100% + 8px);
  left: 8px;
  display: flex;
  flex-wrap: wrap;
  justify-content: stretch;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
  z-index: 80;

  > * {
    flex: 1 1 100%;
    pointer-events: auto;
    max-width: 100%;
  }
`;

interface InputbarProps extends SkillSelectionSourceProps {
  composerController?: ComposerController;
  composerDraftCoordinator?: ComposerDraftCoordinator;
  onComposerDraftAccepted?: (
    capture: ComposerDraftCapture,
    result: AcceptedRuntimeSubmissionResult,
  ) => Promise<void> | void;
  input: string;
  setInput: (value: string) => void;
  onSend: InputbarSendHandler;
  /** 停止生成回调 */
  onStop?: () => void;
  isLoading: boolean;
  disabled?: boolean;
  disabledPlaceholder?: string;
  /** 输入区上方并排浮层控件 */
  overlayAccessory?: React.ReactNode;
  providerType?: string;
  setProviderType?: (type: string) => void;
  model?: string;
  setModel?: (model: string) => void;
  reasoningEffort?: ModelReasoningEffortLevel | "";
  setReasoningEffort?: (value: ModelReasoningEffortLevel | "") => void;
  executionRuntime?: AgentSessionExecutionRuntime | null;
  accessMode?: AgentAccessMode;
  setAccessMode?: (mode: AgentAccessMode) => void;
  toolStates?: Partial<InputbarToolStates>;
  onToolStatesChange?: (states: Partial<InputbarToolStates>) => void;
  activeTheme?: string;
  onManageProviders?: () => void;
  initialInputCapability?: AgentInitialInputCapabilityParams;
  variant?: "default" | "workspace";
  workflowGate?: WorkflowGateState | null;
  workflowSteps?: WorkflowStep[];
  workflowRunState?: "idle" | "auto_running" | "await_user_decision";
  pluginSuggestions?: InputbarPluginCapability[];
  pluginSuggestionsError?: string | null;
  pluginSuggestionsLoading?: boolean;
  onSkillSuggestionsNeeded?: () => void;
  onPluginSuggestionsNeeded?: () => void;
  contextVariant?: "default" | "task-center";
  projectId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  threadGoal?: ThreadGoal | null;
  threadGoalError?: unknown;
  threadGoalLoading?: boolean;
  pathReferences?: MessagePathReference[];
  onAddPathReferences?: (references: MessagePathReference[]) => void;
  inputRestoreRequest?: ScopedComposerRestoreRequest | null;
  onInputRestoreRequestHandled?: (requestId: string) => void;
  onRemovePathReference?: (id: string) => void;
  onClearPathReferences?: () => void;
  submitTarget?: ComposerSubmitTarget;
}

export const Inputbar: React.FC<InputbarProps> = ({
  composerController: externalComposerController,
  composerDraftCoordinator,
  onComposerDraftAccepted,
  input,
  setInput,
  onSend,
  onStop,
  isLoading,
  disabled,
  disabledPlaceholder,
  overlayAccessory,
  skills,
  isSkillsLoading,
  providerType,
  setProviderType,
  model,
  setModel,
  reasoningEffort,
  setReasoningEffort,
  executionRuntime,
  accessMode,
  setAccessMode,
  toolStates,
  onToolStatesChange,
  activeTheme,
  onManageProviders,
  initialInputCapability,
  variant = "default",
  workflowGate,
  workflowSteps = [],
  workflowRunState,
  pluginSuggestions = [],
  pluginSuggestionsError = null,
  pluginSuggestionsLoading = false,
  onSkillSuggestionsNeeded,
  onPluginSuggestionsNeeded,
  contextVariant = "default",
  projectId = null,
  sessionId = null,
  threadId = null,
  threadGoal = null,
  threadGoalError = null,
  threadGoalLoading = false,
  pathReferences = [],
  onAddPathReferences,
  inputRestoreRequest = null,
  onInputRestoreRequestHandled,
  onRemovePathReference,
  onClearPathReferences,

  submitTarget,
}) => {
  const { t } = useTranslation("agent");
  const browserDrafts = useBrowserAnnotationDrafts(sessionId, threadId);
  const hasAdditionalContent =
    browserDrafts.hasContent && !browserDrafts.pending;
  const inputbarCopy = React.useMemo(
    () => buildInputbarCoreCopy((key, values) => t(key, values ?? {})),
    [t],
  );
  const inputbarComposerCopy = React.useMemo(
    () =>
      buildInputbarComposerSectionCopy((key, values) => t(key, values ?? {})),
    [t],
  );
  const workflowPanelCopy = React.useMemo(
    () => buildInputbarWorkflowPanelCopy((key, values) => t(key, values ?? {})),
    [t],
  );
  const showModelControls = Boolean(
    providerType ||
    model ||
    setProviderType ||
    setModel ||
    onManageProviders ||
    executionRuntime,
  );
  const {
    editorRef,
    handleComposerHistoryRecall,
    pathReferences: composerPathReferences,
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
    pluginSuggestions: resolvedPluginSuggestions,
  } = useInputbarController({
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
    variant,
    workflowGate,
    workflowSteps,
    workflowRunState,
    pluginSuggestions,
    projectId,
    sessionId,
    threadId,
    threadGoal,
    pathReferences,
    onAddPathReferences,
    inputRestoreRequest,
    onInputRestoreRequestHandled,
    onClearPathReferences,
    skills,
    isSkillsLoading,
    submitTarget,
  });

  return (
    <InputbarSurface
      isFullscreen={isFullscreen}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {showHintPopup ? (
        <HintRoutePopup
          routes={hintRoutes}
          activeIndex={hintIndex}
          onSelect={handleHintSelect}
        />
      ) : null}
      {overlayAccessory ? (
        <SecondaryControlsRow data-testid="inputbar-secondary-controls">
          {overlayAccessory}
        </SecondaryControlsRow>
      ) : null}
      <ArtifactAnnotationComposerAccessory />
      <BrowserAnnotationAccessory
        onFocusComposer={() => editorRef.current?.focus()}
      />
      <ConfirmDialog
        isOpen={goalComposer.goalReplacementConfirmation !== null}
        title={t("agentChat.threadGoal.composer.replaceTitle")}
        message={t("agentChat.threadGoal.composer.replaceDescription")}
        confirmText={t("agentChat.threadGoal.composer.replaceConfirm")}
        variant="default"
        onCancel={goalComposer.handleCloseGoalReplacement}
        onConfirm={() => void goalComposer.handleConfirmGoalReplacement()}
      />
      <InputbarComposerSection
        renderWorkflowGeneratingPanel={renderWorkflowGeneratingPanel}
        workflowGate={workflowGate}
        workflowQuickActions={workflowQuickActions}
        workflowQueueItems={workflowQueueItems}
        workflowActiveItem={workflowActiveItem}
        workflowQueueTotalCount={workflowQueueTotalCount}
        workflowCompletedCount={workflowCompletedCount}
        workflowTotalCount={workflowTotalCount}
        workflowProgressLabel={workflowProgressLabel}
        workflowSummaryLabel={workflowSummaryLabel}
        inputAdapter={inputAdapter}
        hasAdditionalContent={hasAdditionalContent}
        composerController={composerController}
        skillSelection={skillSelection}
        onSkillSuggestionsNeeded={onSkillSuggestionsNeeded}
        editorRef={editorRef}
        disabledPlaceholder={disabledPlaceholder}
        onSelectInputCapability={handleSelectInputCapability}
        pluginSuggestions={resolvedPluginSuggestions}
        pluginSuggestionsError={pluginSuggestionsError}
        pluginSuggestionsLoading={pluginSuggestionsLoading}
        onPluginSuggestionsNeeded={onPluginSuggestionsNeeded}
        projectId={projectId}
        sessionId={sessionId}
        threadId={threadId}
        threadGoal={threadGoal}
        threadGoalError={threadGoalError}
        threadGoalLoading={threadGoalLoading}
        onOpenGoalEditor={goalComposer.openGoalEditor}
        isGoalMode={goalComposer.pendingThreadGoalObjective !== null}
        goalPlaceholder={t("agentChat.threadGoal.form.objectivePlaceholder")}
        onSend={handleSend}
        onToolClick={handleToolClick}
        activeTools={activeTools}
        pendingImages={pendingImages}
        onRemoveImage={handleRemoveImage}
        pathReferences={composerPathReferences}
        onRemovePathReference={(id) => {
          composerController.setPathReferences(
            composerController
              .getDocument()
              .pathReferences.filter((reference) => reference.id !== id),
          );
          onRemovePathReference?.(id);
        }}
        onPaste={handlePaste}
        onKeyDown={handleHintKeyDown}
        onHistoryRecall={handleComposerHistoryRecall}
        isFullscreen={isFullscreen}
        isWorkspaceVariant={isWorkspaceVariant}
        activeTheme={activeTheme}
        onManageProviders={onManageProviders}
        reasoningEffort={reasoningEffort}
        setReasoningEffort={setReasoningEffort}
        executionRuntime={executionRuntime}
        accessMode={accessMode}
        setAccessMode={setAccessMode}
        showModelControls={showModelControls}
        contextVariant={contextVariant}
        copy={inputbarComposerCopy}
        inputbarCopy={inputbarCopy}
        workflowPanelCopy={workflowPanelCopy}
      />
    </InputbarSurface>
  );
};
