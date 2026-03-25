import React from "react";
import type { MessageImage } from "../../types";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import type {
  AsterSessionExecutionRuntime,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type { TaskFile } from "../TaskFiles";
import { InputbarComposerSection } from "./components/InputbarComposerSection";
import { InputbarOverlayShell } from "./components/InputbarOverlayShell";
import { InputbarSurface } from "./components/InputbarSurface";
import type { A2UISubmissionNoticeData } from "./components/A2UISubmissionNotice";
import type {
  A2UIResponse,
  A2UIFormData,
} from "@/components/content-creator/a2ui/types";
import type {
  ThemeWorkbenchGateState,
  ThemeWorkbenchWorkflowStep,
} from "./hooks/useThemeWorkbenchInputState";
import { type InputbarToolStates } from "./hooks/useInputbarToolState";
import { useInputbarController } from "./hooks/useInputbarController";
import type { TeamDefinition } from "../../utils/teamDefinitions";
import type { WorkspaceSettings } from "@/types/workspace";

interface InputbarProps {
  input: string;
  setInput: (value: string) => void;
  onSend: (
    images?: MessageImage[],
    webSearch?: boolean,
    thinking?: boolean,
    textOverride?: string,
    executionStrategy?: "react" | "code_orchestrated" | "auto",
  ) => void | Promise<boolean> | boolean;
  /** 停止生成回调 */
  onStop?: () => void;
  isLoading: boolean;
  disabled?: boolean;
  onClearMessages?: () => void;
  /** 切换画布显示 */
  onToggleCanvas?: () => void;
  /** 画布是否打开 */
  isCanvasOpen?: boolean;
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
  /** 技能列表（用于 @ 引用） */
  skills?: Skill[];
  /** 技能列表加载状态 */
  isSkillsLoading?: boolean;
  /** 选择角色回调 */
  onSelectCharacter?: (character: Character) => void;
  /** 跳转到设置页安装技能 */
  onNavigateToSettings?: () => void;
  /** 导入本地技能 */
  onImportSkill?: () => void | Promise<void>;
  /** 刷新技能 */
  onRefreshSkills?: () => void | Promise<void>;
  providerType?: string;
  setProviderType?: (type: string) => void;
  model?: string;
  setModel?: (model: string) => void;
  executionRuntime?: AsterSessionExecutionRuntime | null;
  isExecutionRuntimeActive?: boolean;
  workspaceId?: string | null;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  setExecutionStrategy?: (
    strategy: "react" | "code_orchestrated" | "auto",
  ) => void;
  toolStates?: Partial<InputbarToolStates>;
  onToolStatesChange?: (states: InputbarToolStates) => void;
  activeTheme?: string;
  onManageProviders?: () => void;
  variant?: "default" | "theme_workbench";
  themeWorkbenchGate?: ThemeWorkbenchGateState | null;
  workflowSteps?: ThemeWorkbenchWorkflowStep[];
  themeWorkbenchRunState?: "idle" | "auto_running" | "await_user_decision";
  /** 待处理的 A2UI Form（显示在输入框上方） */
  pendingA2UIForm?: A2UIResponse | null;
  /** A2UI Form 提交回调 */
  onA2UISubmit?: (formData: A2UIFormData) => void;
  /** A2UI 表单已提交提示 */
  a2uiSubmissionNotice?: A2UISubmissionNoticeData | null;
  queuedTurns?: QueuedTurnSnapshot[];
  onPromoteQueuedTurn?: (queuedTurnId: string) => void | Promise<boolean>;
  onRemoveQueuedTurn?: (queuedTurnId: string) => void | Promise<boolean>;
  selectedTeam?: TeamDefinition | null;
  onSelectTeam?: (team: TeamDefinition | null) => void;
  onEnableSuggestedTeam?: (suggestedPresetId?: string) => void;
  teamWorkspaceSettings?: WorkspaceSettings | null;
  onPersistCustomTeams?: (teams: TeamDefinition[]) => void | Promise<void>;
}

export const Inputbar: React.FC<InputbarProps> = ({
  input,
  setInput,
  onSend,
  onStop,
  isLoading,
  disabled,
  onClearMessages,
  onToggleCanvas,
  isCanvasOpen = false,
  taskFiles = [],
  selectedFileId,
  taskFilesExpanded = false,
  onToggleTaskFiles,
  onTaskFileClick,
  overlayAccessory,
  characters = [],
  skills = [],
  isSkillsLoading = false,
  onSelectCharacter,
  onNavigateToSettings,
  onImportSkill,
  onRefreshSkills,
  providerType,
  setProviderType,
  model,
  setModel,
  executionRuntime,
  isExecutionRuntimeActive,
  workspaceId,
  executionStrategy,
  setExecutionStrategy,
  toolStates,
  onToolStatesChange,
  activeTheme,
  onManageProviders,
  variant = "default",
  themeWorkbenchGate,
  workflowSteps = [],
  themeWorkbenchRunState,
  pendingA2UIForm,
  onA2UISubmit,
  a2uiSubmissionNotice,
  queuedTurns = [],
  onPromoteQueuedTurn,
  onRemoveQueuedTurn,
  selectedTeam,
  onSelectTeam,
  onEnableSuggestedTeam,
  teamWorkspaceSettings,
  onPersistCustomTeams,
}) => {
  const {
    textareaRef,
    isThemeWorkbenchVariant,
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
    themeWorkbenchQuickActions,
    themeWorkbenchQueueItems,
    renderThemeWorkbenchGeneratingPanel,
    visibleA2UISubmissionNotice,
    isA2UISubmissionNoticeVisible,
    activeSkill,
    setActiveSkill,
    clearActiveSkill,
    setActiveBuiltinCommand,
  } = useInputbarController({
    input,
    setInput,
    onSend,
    onStop,
    isLoading,
    disabled,
    onClearMessages,
    onToggleCanvas,
    providerType,
    setProviderType,
    model,
    setModel,
    executionStrategy,
    setExecutionStrategy,
    toolStates,
    onToolStatesChange,
    activeTheme,
    variant,
    themeWorkbenchGate,
    workflowSteps,
    themeWorkbenchRunState,
    pendingA2UIForm,
    a2uiSubmissionNotice,
    onEnableSuggestedTeam,
  });

  return (
    <InputbarSurface
      isFullscreen={isFullscreen}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onKeyDown={handleHintKeyDown}
    >
      <InputbarOverlayShell
        showHintPopup={showHintPopup}
        hintRoutes={hintRoutes}
        hintIndex={hintIndex}
        onHintSelect={handleHintSelect}
        taskFiles={taskFiles}
        selectedFileId={selectedFileId}
        taskFilesExpanded={taskFilesExpanded}
        onToggleTaskFiles={onToggleTaskFiles}
        onTaskFileClick={onTaskFileClick}
        overlayAccessory={overlayAccessory}
        submissionNotice={visibleA2UISubmissionNotice}
        isSubmissionNoticeVisible={isA2UISubmissionNoticeVisible}
        pendingA2UIForm={pendingA2UIForm}
        onA2UISubmit={onA2UISubmit}
        fileInputRef={fileInputRef}
        onFileSelect={handleFileSelect}
      />
      <InputbarComposerSection
        renderThemeWorkbenchGeneratingPanel={
          renderThemeWorkbenchGeneratingPanel
        }
        themeWorkbenchGate={themeWorkbenchGate}
        themeWorkbenchQuickActions={themeWorkbenchQuickActions}
        themeWorkbenchQueueItems={themeWorkbenchQueueItems}
        inputAdapter={inputAdapter}
        characters={characters}
        skills={skills}
        isSkillsLoading={isSkillsLoading}
        textareaRef={textareaRef}
        input={input}
        activeSkill={activeSkill}
        onSelectCharacter={onSelectCharacter}
        onSelectSkill={setActiveSkill}
        onSelectBuiltinCommand={setActiveBuiltinCommand}
        onClearSkill={clearActiveSkill}
        onNavigateToSettings={onNavigateToSettings}
        onImportSkill={onImportSkill}
        onRefreshSkills={onRefreshSkills}
        selectedTeam={selectedTeam}
        onSelectTeam={onSelectTeam}
        teamWorkspaceSettings={teamWorkspaceSettings}
        onPersistCustomTeams={onPersistCustomTeams}
        workspaceId={workspaceId}
        onSend={handleSend}
        onToolClick={handleToolClick}
        activeTools={activeTools}
        executionStrategy={executionStrategy}
        pendingImages={pendingImages}
        onRemoveImage={handleRemoveImage}
        onPaste={handlePaste}
        isFullscreen={isFullscreen}
        isCanvasOpen={isCanvasOpen}
        isThemeWorkbenchVariant={isThemeWorkbenchVariant}
        activeTheme={activeTheme}
        providerType={providerType}
        model={model}
        onManageProviders={onManageProviders}
        executionRuntime={executionRuntime}
        isExecutionRuntimeActive={isExecutionRuntimeActive}
        setExecutionStrategy={setExecutionStrategy}
        topExtra={topExtra}
        queuedTurns={queuedTurns}
        onPromoteQueuedTurn={onPromoteQueuedTurn}
        onRemoveQueuedTurn={onRemoveQueuedTurn}
      />
    </InputbarSurface>
  );
};
