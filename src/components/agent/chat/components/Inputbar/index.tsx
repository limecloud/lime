import React from "react";
import styled from "styled-components";
import type { MessageImage, MessagePathReference } from "../../types";
import type { Character } from "@/lib/api/memory";
import type {
  AsterSessionExecutionRuntime,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type { TaskFile } from "../TaskFiles";
import { InputbarComposerSection } from "./components/InputbarComposerSection";
import { HintRoutePopup } from "./components/HintRoutePopup";
import { TaskFilesPanel } from "./components/TaskFilesPanel";
import { InputbarSurface } from "./components/InputbarSurface";
import type { SkillSelectionSourceProps } from "../../skill-selection/skillSelectionBindings";
import type {
  WorkflowGateState,
  WorkflowStep,
} from "../../utils/workflowInputState";
import { type InputbarToolStates } from "./hooks/useInputbarToolState";
import { useInputbarController } from "./hooks/useInputbarController";
import type { TeamDefinition } from "../../utils/teamDefinitions";
import type { WorkspaceSettings } from "@/types/workspace";
import type { AgentAccessMode } from "../../hooks/agentChatStorage";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import type { HandleSendOptions } from "../../hooks/handleSendTypes";
import type { AgentInitialInputCapabilityParams } from "@/types/page";
import type { CuratedTaskReferenceEntry } from "../../utils/curatedTaskReferenceSelection";

const SecondaryControlsRow = styled.div`
  position: absolute;
  right: 8px;
  bottom: calc(100% + 8px);
  left: 8px;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
  z-index: 80;

  > * {
    pointer-events: auto;
    max-width: 100%;
  }
`;

interface InputbarProps extends SkillSelectionSourceProps {
  input: string;
  setInput: (value: string) => void;
  onSend: (
    images?: MessageImage[],
    webSearch?: boolean,
    thinking?: boolean,
    textOverride?: string,
    executionStrategy?: "react" | "code_orchestrated" | "auto",
    autoContinuePayload?: AutoContinueRequestPayload,
    sendOptions?: HandleSendOptions,
  ) => void | Promise<boolean> | boolean;
  /** 停止生成回调 */
  onStop?: () => void;
  isLoading: boolean;
  disabled?: boolean;
  /** 任务文件列表 */
  taskFiles?: TaskFile[];
  /** 选中的文件 ID */
  selectedFileId?: string;
  /** 任务文件面板是否展开 */
  taskFilesExpanded?: boolean;
  /** 切换任务文件面板 */
  onToggleTaskFiles?: () => void;
  /** 文件点击回调 */
  onTaskFileClick?: (file: TaskFile) => void;
  /** 输入区上方并排浮层控件 */
  overlayAccessory?: React.ReactNode;
  /** 角色列表（用于 @ 引用） */
  characters?: Character[];
  /** 选择角色回调 */
  onSelectCharacter?: (character: Character) => void;
  providerType?: string;
  setProviderType?: (type: string) => void;
  model?: string;
  setModel?: (model: string) => void;
  executionRuntime?: AsterSessionExecutionRuntime | null;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  setExecutionStrategy?: (
    strategy: "react" | "code_orchestrated" | "auto",
  ) => void;
  accessMode?: AgentAccessMode;
  setAccessMode?: (mode: AgentAccessMode) => void;
  toolStates?: Partial<InputbarToolStates>;
  onToolStatesChange?: (states: InputbarToolStates) => void;
  activeTheme?: string;
  onManageProviders?: () => void;
  initialInputCapability?: AgentInitialInputCapabilityParams;
  variant?: "default" | "workspace";
  workflowGate?: WorkflowGateState | null;
  workflowSteps?: WorkflowStep[];
  workflowRunState?: "idle" | "auto_running" | "await_user_decision";
  queuedTurns?: QueuedTurnSnapshot[];
  onPromoteQueuedTurn?: (queuedTurnId: string) => void | Promise<boolean>;
  onRemoveQueuedTurn?: (queuedTurnId: string) => void | Promise<boolean>;
  selectedTeam?: TeamDefinition | null;
  onSelectTeam?: (team: TeamDefinition | null) => void;
  onEnableSuggestedTeam?: (suggestedPresetId?: string) => void;
  teamWorkspaceSettings?: WorkspaceSettings | null;
  onPersistCustomTeams?: (teams: TeamDefinition[]) => void | Promise<void>;
  contextVariant?: "default" | "task-center";
  projectId?: string | null;
  sessionId?: string | null;
  pathReferences?: MessagePathReference[];
  onAddPathReferences?: (references: MessagePathReference[]) => void;
  onRemovePathReference?: (id: string) => void;
  onClearPathReferences?: () => void;
  fileManagerOpen?: boolean;
  onToggleFileManager?: () => void;
  defaultCuratedTaskReferenceMemoryIds?: string[];
  defaultCuratedTaskReferenceEntries?: CuratedTaskReferenceEntry[];
  inputCompletionEnabled?: boolean;
}

export const Inputbar: React.FC<InputbarProps> = ({
  input,
  setInput,
  onSend,
  onStop,
  isLoading,
  disabled,
  taskFiles = [],
  selectedFileId,
  taskFilesExpanded = false,
  onToggleTaskFiles,
  onTaskFileClick,
  overlayAccessory,
  characters = [],
  skills,
  serviceSkills,
  serviceSkillGroups,
  isSkillsLoading,
  onSelectCharacter,
  onSelectServiceSkill,
  onNavigateToSettings,
  onImportSkill,
  onRefreshSkills,
  providerType,
  setProviderType,
  model,
  setModel,
  executionRuntime,
  executionStrategy,
  setExecutionStrategy,
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
  queuedTurns = [],
  onPromoteQueuedTurn,
  onRemoveQueuedTurn,
  selectedTeam,
  onSelectTeam,
  onEnableSuggestedTeam,
  teamWorkspaceSettings,
  onPersistCustomTeams,
  contextVariant = "default",
  projectId = null,
  sessionId = null,
  pathReferences = [],
  onAddPathReferences,
  onRemovePathReference,
  onClearPathReferences,
  fileManagerOpen = false,
  onToggleFileManager,
  defaultCuratedTaskReferenceMemoryIds = [],
  defaultCuratedTaskReferenceEntries = [],
  inputCompletionEnabled = true,
}) => {
  const {
    textareaRef,
    isWorkspaceVariant,
    pendingImages,
    fileInputRef,
    handleFileSelect,
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
    inputAdapter,
    topExtra,
    dialogLayer,
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
  } = useInputbarController({
    input,
    setInput,
    onSend,
    onStop,
    isLoading,
    disabled,
    providerType,
    setProviderType,
    model,
    setModel,
    executionStrategy,
    toolStates,
    onToolStatesChange,
    activeTheme,
    initialInputCapability,
    variant,
    workflowGate,
    workflowSteps,
    workflowRunState,
    onEnableSuggestedTeam,
    projectId,
    sessionId,
    pathReferences,
    onAddPathReferences,
    onClearPathReferences,
    skills,
    serviceSkills,
    serviceSkillGroups,
    isSkillsLoading,
    onSelectServiceSkill,
    onNavigateToSettings,
    onImportSkill,
    onRefreshSkills,
  });

  return (
    <InputbarSurface
      isFullscreen={isFullscreen}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onKeyDown={handleHintKeyDown}
    >
      {showHintPopup ? (
        <HintRoutePopup
          routes={hintRoutes}
          activeIndex={hintIndex}
          onSelect={handleHintSelect}
        />
      ) : null}
      {taskFiles.length > 0 || overlayAccessory ? (
        <SecondaryControlsRow data-testid="inputbar-secondary-controls">
          <TaskFilesPanel
            files={taskFiles}
            selectedFileId={selectedFileId}
            expanded={taskFilesExpanded}
            onToggle={onToggleTaskFiles}
            onFileClick={onTaskFileClick}
          />
          {overlayAccessory}
        </SecondaryControlsRow>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={handleFileSelect}
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
        characters={characters}
        skillSelection={skillSelection}
        textareaRef={textareaRef}
        input={input}
        onSelectCharacter={onSelectCharacter}
        onSelectInputCapability={handleSelectInputCapability}
        activeCapability={activeCapability}
        projectId={projectId}
        sessionId={sessionId}
        defaultCuratedTaskReferenceMemoryIds={
          defaultCuratedTaskReferenceMemoryIds
        }
        defaultCuratedTaskReferenceEntries={defaultCuratedTaskReferenceEntries}
        selectedTeam={selectedTeam}
        onSelectTeam={onSelectTeam}
        teamWorkspaceSettings={teamWorkspaceSettings}
        onPersistCustomTeams={onPersistCustomTeams}
        onSend={handleSend}
        onToolClick={handleToolClick}
        activeTools={activeTools}
        executionStrategy={executionStrategy}
        pendingImages={pendingImages}
        onRemoveImage={handleRemoveImage}
        pathReferences={pathReferences}
        onRemovePathReference={onRemovePathReference}
        fileManagerOpen={fileManagerOpen}
        onToggleFileManager={onToggleFileManager}
        onPaste={handlePaste}
        isFullscreen={isFullscreen}
        isWorkspaceVariant={isWorkspaceVariant}
        activeTheme={activeTheme}
        onManageProviders={onManageProviders}
        executionRuntime={executionRuntime}
        accessMode={accessMode}
        setAccessMode={setAccessMode}
        setExecutionStrategy={setExecutionStrategy}
        topExtra={topExtra}
        queuedTurns={queuedTurns}
        onPromoteQueuedTurn={onPromoteQueuedTurn}
        onRemoveQueuedTurn={onRemoveQueuedTurn}
        contextVariant={contextVariant}
        inputCompletionEnabled={inputCompletionEnabled}
      />
      {dialogLayer}
    </InputbarSurface>
  );
};
