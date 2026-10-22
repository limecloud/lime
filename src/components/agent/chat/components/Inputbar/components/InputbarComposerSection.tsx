import type { ComposerDraftSnapshot } from "@/components/input-kit";
import type { ComposerEditorHandle } from "@/components/input-kit";
import React from "react";

import type { ChatInputAdapter } from "@/components/input-kit/adapters/types";

import type { AgentSessionExecutionRuntime } from "@/lib/api/agentExecutionRuntime";
import type { MessageImage, MessagePathReference } from "../../../types";
import { InputbarCore } from "./InputbarCore";
import { InputbarWorkflowStatusPanel } from "./InputbarWorkflowStatusPanel";
import { InputbarModelExtra } from "./InputbarModelExtra";
import { InputbarVisionCapabilityNotice } from "./InputbarVisionCapabilityNotice";
import { InputbarAccessModeSelect } from "./InputbarAccessModeSelect";
import { InputbarModeStatusChip } from "./InputbarModeStatusChip";
import { ThreadGoalPanel } from "../../ThreadGoalPanel";
import { type SkillSelectionProps } from "../../../skill-selection/skillSelectionBindings";
import type { SelectInputCapabilityHandler } from "../../../skill-selection/inputCapabilitySelection";
import type { AgentAccessMode } from "../../../hooks/agentChatStorage";

import type { InputbarComposerSectionCopy } from "./inputbarComposerSectionCopy";
import type { InputbarCoreCopy } from "./inputbarCoreCopy";
import type { InputbarWorkflowPanelCopy } from "../inputbarWorkflowCopy";
import type {
  WorkflowGateState,
  WorkflowQuickAction,
  WorkflowStep,
} from "../../../utils/workflowInputState";
import {
  PlanModeContext,
  PlanModeContextSegment,
  PlanModeContextSeparator,
} from "../styles";
import type { ModelReasoningEffortLevel } from "@/lib/types/modelRegistry";
import type { InputbarPluginCapability } from "../pluginInputCapability";
import type { BaseComposerSendMetadata } from "@/components/input-kit";
import type { ComposerController } from "@/components/input-kit";
import type { ThreadGoal } from "@limecloud/app-server-client";

interface InputbarComposerSectionProps {
  renderWorkflowGeneratingPanel: boolean;
  workflowGate?: WorkflowGateState | null;
  workflowQuickActions: WorkflowQuickAction[];
  workflowQueueItems: WorkflowStep[];
  workflowActiveItem: WorkflowStep | null;
  workflowQueueTotalCount: number;
  workflowCompletedCount: number;
  workflowTotalCount: number;
  workflowProgressLabel: string;
  workflowSummaryLabel: string;
  inputAdapter: ChatInputAdapter;
  hasAdditionalContent?: boolean;
  composerController: ComposerController;
  skillSelection: SkillSelectionProps;
  onSkillSuggestionsNeeded?: () => void;
  editorRef: React.RefObject<ComposerEditorHandle>;
  disabledPlaceholder?: string;
  onSelectInputCapability: SelectInputCapabilityHandler;
  pluginSuggestions?: readonly InputbarPluginCapability[];
  pluginSuggestionsError?: string | null;
  pluginSuggestionsLoading?: boolean;
  onPluginSuggestionsNeeded?: () => void;
  onSend: (metadata?: BaseComposerSendMetadata) => void;
  onToolClick: (tool: string) => void;
  activeTools: Record<string, boolean>;
  pendingImages: MessageImage[];
  onRemoveImage: (index: number) => void;
  pathReferences?: MessagePathReference[];
  onRemovePathReference?: (id: string) => void;

  onPaste: (event: ClipboardEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => boolean | void;
  onHistoryRecall?: (draft: ComposerDraftSnapshot) => void;
  isFullscreen: boolean;
  isWorkspaceVariant: boolean;
  activeTheme?: string;
  onManageProviders?: () => void;
  reasoningEffort?: ModelReasoningEffortLevel | "";
  setReasoningEffort?: (value: ModelReasoningEffortLevel | "") => void;
  executionRuntime?: AgentSessionExecutionRuntime | null;
  accessMode?: AgentAccessMode;
  setAccessMode?: (mode: AgentAccessMode) => void;
  showModelControls?: boolean;
  contextVariant?: "default" | "task-center";
  projectId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  threadGoal?: ThreadGoal | null;
  threadGoalError?: unknown;
  threadGoalLoading?: boolean;
  onOpenGoalEditor?: () => void;
  isGoalMode?: boolean;
  goalPlaceholder?: string;
  copy: InputbarComposerSectionCopy;
  inputbarCopy: InputbarCoreCopy;
  workflowPanelCopy: InputbarWorkflowPanelCopy;
}

export const InputbarComposerSection: React.FC<
  InputbarComposerSectionProps
> = ({
  renderWorkflowGeneratingPanel,
  workflowGate,
  workflowQuickActions,
  workflowQueueItems,
  workflowActiveItem,
  workflowQueueTotalCount,
  workflowCompletedCount,
  workflowTotalCount,
  workflowProgressLabel,
  workflowSummaryLabel,
  inputAdapter,
  hasAdditionalContent,
  composerController,
  skillSelection,
  onSkillSuggestionsNeeded,
  editorRef,
  disabledPlaceholder,
  onSelectInputCapability,
  pluginSuggestions = [],
  pluginSuggestionsError = null,
  pluginSuggestionsLoading = false,
  onPluginSuggestionsNeeded,
  onSend,
  onHistoryRecall,
  onToolClick,
  activeTools,
  pendingImages,
  onRemoveImage,
  pathReferences = [],
  onRemovePathReference,

  onPaste,
  onKeyDown,
  isFullscreen,
  isWorkspaceVariant,
  activeTheme,
  onManageProviders,
  reasoningEffort,
  setReasoningEffort,
  executionRuntime,
  accessMode,
  setAccessMode,
  showModelControls = false,
  contextVariant = "default",
  projectId = null,
  sessionId = null,
  threadId = null,
  threadGoal = null,
  threadGoalError = null,
  threadGoalLoading = false,
  onOpenGoalEditor,
  isGoalMode = false,
  goalPlaceholder,
  copy,
  inputbarCopy,
  workflowPanelCopy,
}) => {
  const currentPendingImages =
    (inputAdapter.state.attachments as MessageImage[] | undefined) ||
    pendingImages;
  const resolvedProviderType = inputAdapter.model?.providerType;
  const resolvedModel = inputAdapter.model?.model;
  const resolvedReasoningEffort =
    inputAdapter.model?.reasoningEffort ?? reasoningEffort ?? "";
  const shouldShowModelControls = showModelControls;
  const resolvedSetProviderType =
    inputAdapter.actions.setProviderType || (() => undefined);
  const resolvedSetModel = inputAdapter.actions.setModel || (() => undefined);
  const resolvedSetReasoningEffort =
    inputAdapter.actions.setReasoningEffort || setReasoningEffort;
  const shouldShowVisionNotice =
    currentPendingImages.length > 0 &&
    Boolean(resolvedProviderType?.trim()) &&
    Boolean(resolvedModel?.trim());
  const inputbarDisabled = Boolean(inputAdapter.state.disabled);
  const objectiveInlinePanel =
    threadId && (threadGoal || threadGoalLoading) ? (
      <ThreadGoalPanel
        runtimeBusy={inputAdapter.state.isSending}
        threadGoal={threadGoal}
        threadGoalError={threadGoalError}
        threadGoalLoading={threadGoalLoading}
        threadId={threadId}
        variant="inline"
        onEdit={onOpenGoalEditor}
      />
    ) : null;
  const resolvedTopExtra =
    objectiveInlinePanel || shouldShowVisionNotice ? (
      <>
        {objectiveInlinePanel}
        {shouldShowVisionNotice && resolvedProviderType && resolvedModel ? (
          <InputbarVisionCapabilityNotice
            providerType={resolvedProviderType}
            model={resolvedModel}
            hasPendingImages={currentPendingImages.length > 0}
          />
        ) : null}
      </>
    ) : undefined;
  const handleToolAction = (tool: string) => {
    onToolClick(tool);
  };
  const planModeStatusLabel = copy.planStatus.label;
  const objectiveStatusLabel = copy.contextCommands.goal;
  const planStatusModelLabel = resolvedModel?.trim()
    ? copy.planStatus.model(resolvedModel.trim())
    : copy.planStatus.modelFallback;
  const planStatusReasoningLevel = resolvedReasoningEffort
    ? (copy.planStatus.reasoningLevels[resolvedReasoningEffort] ??
      resolvedReasoningEffort)
    : copy.planStatus.reasoningDefault;
  const planStatusReasoningLabel = copy.planStatus.reasoning(
    planStatusReasoningLevel,
  );
  const planStatusTitle = [
    copy.contextCommands.planMode,
    planStatusModelLabel,
    planStatusReasoningLabel,
  ].join(" · ");
  const workspacePlaceholder =
    workflowGate?.status === "waiting"
      ? copy.workspacePlaceholder.waiting
      : contextVariant === "task-center"
        ? copy.workspacePlaceholder.taskCenter
        : copy.workspacePlaceholder.default;
  const contextualSuggestions = {
    onAddFiles: () => handleToolAction("attach"),
    commands: [
      {
        id: "goal" as const,
        label: copy.contextCommands.goal,
        onSelect: () => {
          if (!activeTools["objective_mode"])
            handleToolAction("objective_mode");
        },
      },
      {
        id: "plan-mode" as const,
        label: copy.contextCommands.planMode,
        onSelect: () => handleToolAction("task_mode"),
      },
    ],
    projectId,
    skills: skillSelection.skills,
    skillsLoading: skillSelection.isSkillsLoading,
    onSkillSuggestionsNeeded,
    onSelectInputCapability,
    plugins: pluginSuggestions,
    pluginsLoading: pluginSuggestionsLoading,
    pluginsError: pluginSuggestionsError,
    onPluginSuggestionsNeeded,
    onChange: inputAdapter.actions.setText,
  };
  const shouldShowLeftExtra =
    Boolean(activeTools["task_mode"]) ||
    Boolean(activeTools["objective_mode"]) ||
    Boolean(setAccessMode);
  const leftExtra = shouldShowLeftExtra ? (
    <>
      <InputbarAccessModeSelect
        isFullscreen={isFullscreen}
        disabled={inputbarDisabled}
        accessMode={accessMode}
        setAccessMode={setAccessMode}
      />

      {activeTools["task_mode"] ? (
        <>
          <InputbarModeStatusChip
            label={planModeStatusLabel}
            testId="inputbar-task-mode-status"
            disabled={inputbarDisabled}
            onRemove={() => handleToolAction("task_mode")}
          />
          <PlanModeContext
            data-testid="inputbar-plan-mode-context"
            title={planStatusTitle}
          >
            <PlanModeContextSegment>
              {planStatusModelLabel}
            </PlanModeContextSegment>
            <PlanModeContextSeparator aria-hidden>·</PlanModeContextSeparator>
            <PlanModeContextSegment>
              {planStatusReasoningLabel}
            </PlanModeContextSegment>
          </PlanModeContext>
        </>
      ) : null}

      {activeTools["objective_mode"] ? (
        <InputbarModeStatusChip
          label={objectiveStatusLabel}
          testId="inputbar-objective-status"
          disabled={inputbarDisabled}
          onRemove={() => handleToolAction("objective_mode")}
        />
      ) : null}
    </>
  ) : undefined;
  const trailingMeta = shouldShowModelControls ? (
    <InputbarModelExtra
      isFullscreen={isFullscreen}
      disabled={inputbarDisabled}
      providerType={resolvedProviderType}
      setProviderType={resolvedSetProviderType}
      model={resolvedModel}
      setModel={resolvedSetModel}
      reasoningEffort={resolvedReasoningEffort}
      setReasoningEffort={resolvedSetReasoningEffort}
      activeTheme={activeTheme}
      onManageProviders={onManageProviders}
      executionRuntime={executionRuntime}
    />
  ) : undefined;
  if (renderWorkflowGeneratingPanel) {
    return (
      <InputbarWorkflowStatusPanel
        gate={workflowGate}
        quickActions={workflowQuickActions}
        queueItems={workflowQueueItems}
        activeItem={workflowActiveItem}
        queueTotalCount={workflowQueueTotalCount}
        completedCount={workflowCompletedCount}
        totalCount={workflowTotalCount}
        progressLabel={workflowProgressLabel}
        summaryLabel={workflowSummaryLabel}
        renderGeneratingPanel
        onQuickAction={inputAdapter.actions.setText}
        onStop={inputAdapter.actions.stop}
        copy={workflowPanelCopy}
      />
    );
  }

  return (
    <>
      <InputbarWorkflowStatusPanel
        gate={workflowGate}
        quickActions={workflowQuickActions}
        queueItems={workflowQueueItems}
        activeItem={workflowActiveItem}
        queueTotalCount={workflowQueueTotalCount}
        completedCount={workflowCompletedCount}
        totalCount={workflowTotalCount}
        progressLabel={workflowProgressLabel}
        summaryLabel={workflowSummaryLabel}
        renderGeneratingPanel={false}
        onQuickAction={inputAdapter.actions.setText}
        onStop={inputAdapter.actions.stop}
        copy={workflowPanelCopy}
      />
      <InputbarCore
        uiCopy={inputbarCopy}
        controller={composerController}
        editorRef={editorRef}
        text={inputAdapter.state.text}
        hasAdditionalContent={hasAdditionalContent}
        setText={inputAdapter.actions.setText}
        onSend={onSend}
        onHistoryRecall={onHistoryRecall}
        onStop={inputAdapter.actions.stop}
        isLoading={inputAdapter.state.isSending}
        disabled={inputbarDisabled}
        sessionId={sessionId}
        onToolClick={handleToolAction}
        pendingImages={currentPendingImages}
        onRemoveImage={onRemoveImage}
        pathReferences={pathReferences}
        onRemovePathReference={onRemovePathReference}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        isFullscreen={isFullscreen}
        placeholder={
          disabledPlaceholder ||
          (isGoalMode ? goalPlaceholder : undefined) ||
          (isWorkspaceVariant ? workspacePlaceholder : undefined)
        }
        showDragHandle={!isWorkspaceVariant}
        visualVariant={isWorkspaceVariant ? "floating" : "default"}
        connectedContextBar={false}
        topExtra={resolvedTopExtra}
        leftExtra={leftExtra}
        trailingMeta={trailingMeta}
        contextualSuggestions={contextualSuggestions}
      />
    </>
  );
};
