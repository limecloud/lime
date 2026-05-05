import React, { useState } from "react";
import { ChevronDown, ChevronUp, FolderOpen, Settings2 } from "lucide-react";
import type { ChatInputAdapter } from "@/components/input-kit/adapters/types";
import type { Character } from "@/lib/api/memory";
import type {
  AsterSessionExecutionRuntime,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type { MessageImage, MessagePathReference } from "../../../types";
import { CharacterMention } from "../../../skill-selection/CharacterMention";
import { InputbarCore } from "./InputbarCore";
import { SkillSelector } from "../../../skill-selection/SkillSelector";
import { TeamSelector } from "./TeamSelector";
import { InputbarWorkflowStatusPanel } from "./InputbarWorkflowStatusPanel";
import { InputbarModelExtra } from "./InputbarModelExtra";
import { InputbarVisionCapabilityNotice } from "./InputbarVisionCapabilityNotice";
import { InputbarExecutionStrategySelect } from "./InputbarExecutionStrategySelect";
import { InputbarAccessModeSelect } from "./InputbarAccessModeSelect";
import { isGeneralResearchTheme } from "../../../utils/generalAgentPrompt";
import type { TeamDefinition } from "../../../utils/teamDefinitions";
import type { WorkspaceSettings } from "@/types/workspace";
import {
  buildSkillSelectionBindings,
  type SkillSelectionProps,
} from "../../../skill-selection/skillSelectionBindings";
import type {
  InputCapabilitySelection,
  SelectInputCapabilityHandler,
} from "../../../skill-selection/inputCapabilitySelection";
import type { AgentAccessMode } from "../../../hooks/agentChatStorage";
import type { CuratedTaskReferenceEntry } from "../../../utils/curatedTaskReferenceSelection";
import type {
  InputbarKnowledgePackOption,
  InputbarKnowledgePackSelection,
} from "../types";
import { InputbarKnowledgeControl } from "../knowledge/InputbarKnowledgeControl";
import type {
  WorkflowGateState,
  WorkflowQuickAction,
  WorkflowStep,
} from "../../../utils/workflowInputState";
import { Badge } from "@/components/ui/badge";
import {
  MetaIconButton,
  MetaToggleButton,
  MetaToggleCheck,
  MetaToggleGlyph,
  MetaToggleLabel,
} from "../styles";
import { getProviderLabel } from "@/lib/constants/providerMappings";

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
  characters: Character[];
  skillSelection: SkillSelectionProps;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  input: string;
  onSelectCharacter?: (character: Character) => void;
  onSelectInputCapability: SelectInputCapabilityHandler;
  activeCapability?: InputCapabilitySelection | null;
  defaultCuratedTaskReferenceMemoryIds?: string[];
  defaultCuratedTaskReferenceEntries?: CuratedTaskReferenceEntry[];
  selectedTeam?: TeamDefinition | null;
  knowledgePackSelection?: InputbarKnowledgePackSelection | null;
  knowledgePackOptions?: InputbarKnowledgePackOption[];
  knowledgeHubOpenRequestKey?: number;
  onToggleKnowledgePack?: (enabled: boolean) => void;
  onSelectKnowledgePack?: (packName: string) => void;
  onStartKnowledgeOrganize?: () => void;
  onManageKnowledgePacks?: () => void;
  onSelectTeam?: (team: TeamDefinition | null) => void;
  teamWorkspaceSettings?: WorkspaceSettings | null;
  onPersistCustomTeams?: (teams: TeamDefinition[]) => void | Promise<void>;
  onSend: () => void;
  onToolClick: (tool: string) => void;
  activeTools: Record<string, boolean>;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  pendingImages: MessageImage[];
  onRemoveImage: (index: number) => void;
  pathReferences?: MessagePathReference[];
  onImportPathReferenceAsKnowledge?: (reference: MessagePathReference) => void;
  onRemovePathReference?: (id: string) => void;
  fileManagerOpen?: boolean;
  onToggleFileManager?: () => void;
  onPaste: (event: React.ClipboardEvent) => void;
  isFullscreen: boolean;
  isWorkspaceVariant: boolean;
  activeTheme?: string;
  onManageProviders?: () => void;
  executionRuntime?: AsterSessionExecutionRuntime | null;
  accessMode?: AgentAccessMode;
  setAccessMode?: (mode: AgentAccessMode) => void;
  setExecutionStrategy?: (
    strategy: "react" | "code_orchestrated" | "auto",
  ) => void;
  topExtra?: React.ReactNode;
  queuedTurns: QueuedTurnSnapshot[];
  onPromoteQueuedTurn?: (queuedTurnId: string) => void | Promise<boolean>;
  onRemoveQueuedTurn?: (queuedTurnId: string) => void | Promise<boolean>;
  contextVariant?: "default" | "task-center";
  projectId?: string | null;
  sessionId?: string | null;
  inputCompletionEnabled?: boolean;
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
  characters,
  skillSelection,
  textareaRef,
  input,
  onSelectCharacter,
  onSelectInputCapability,
  activeCapability,
  defaultCuratedTaskReferenceMemoryIds = [],
  defaultCuratedTaskReferenceEntries = [],
  selectedTeam,
  knowledgePackSelection,
  knowledgePackOptions = [],
  knowledgeHubOpenRequestKey,
  onToggleKnowledgePack,
  onSelectKnowledgePack,
  onStartKnowledgeOrganize,
  onManageKnowledgePacks,
  onSelectTeam,
  teamWorkspaceSettings,
  onPersistCustomTeams,
  onSend,
  onToolClick,
  activeTools,
  executionStrategy,
  pendingImages,
  onRemoveImage,
  pathReferences = [],
  onImportPathReferenceAsKnowledge,
  onRemovePathReference,
  fileManagerOpen = false,
  onToggleFileManager,
  onPaste,
  isFullscreen,
  isWorkspaceVariant,
  activeTheme,
  onManageProviders,
  executionRuntime,
  accessMode,
  setAccessMode,
  setExecutionStrategy,
  topExtra,
  queuedTurns,
  onPromoteQueuedTurn,
  onRemoveQueuedTurn,
  contextVariant = "default",
  projectId = null,
  sessionId = null,
  inputCompletionEnabled = true,
}) => {
  const [teamSelectorAutoOpenToken, setTeamSelectorAutoOpenToken] = useState<
    number | null
  >(null);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const showSkillSelector =
    !isWorkspaceVariant && isGeneralResearchTheme(activeTheme);
  const currentPendingImages =
    (inputAdapter.state.attachments as MessageImage[] | undefined) ||
    pendingImages;
  const { mentionProps: mentionSkillProps, selectorProps: skillSelectorProps } =
    buildSkillSelectionBindings(skillSelection);
  const resolvedProviderType = inputAdapter.model?.providerType;
  const resolvedModel = inputAdapter.model?.model;
  const trimmedProviderType = resolvedProviderType?.trim() || "";
  const trimmedModel = resolvedModel?.trim() || "";
  const shouldShowModelControls = !isWorkspaceVariant;
  const hasConfiguredModel = Boolean(trimmedProviderType && trimmedModel);
  const currentModelSummary =
    shouldShowModelControls && hasConfiguredModel
      ? `${getProviderLabel(trimmedProviderType)} / ${trimmedModel}`
      : null;
  const resolvedSetProviderType =
    inputAdapter.actions.setProviderType || (() => undefined);
  const resolvedSetModel = inputAdapter.actions.setModel || (() => undefined);
  const shouldShowVisionNotice =
    currentPendingImages.length > 0 &&
    Boolean(resolvedProviderType?.trim()) &&
    Boolean(resolvedModel?.trim());
  const resolvedTopExtra =
    topExtra || shouldShowVisionNotice ? (
      <>
        {topExtra}
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
    if (
      tool === "subagent_mode" &&
      !activeTools["subagent_mode"] &&
      !selectedTeam
    ) {
      setTeamSelectorAutoOpenToken((current) => (current ?? 0) + 1);
    }
    onToolClick(tool);
  };
  const shouldShowTeamSelector =
    isGeneralResearchTheme(activeTheme) && activeTools["subagent_mode"];
  const knowledgePackControl =
    knowledgePackSelection || onStartKnowledgeOrganize ? (
      <InputbarKnowledgeControl
        knowledgePackSelection={knowledgePackSelection}
        knowledgePackOptions={knowledgePackOptions}
        inputText={input}
        openKnowledgeHubRequestKey={knowledgeHubOpenRequestKey}
        onToggleKnowledgePack={onToggleKnowledgePack}
        onSelectKnowledgePack={onSelectKnowledgePack}
        onStartKnowledgeOrganize={onStartKnowledgeOrganize}
        onManageKnowledgePacks={onManageKnowledgePacks}
      />
    ) : null;
  const hasHighlightedAdvancedPreference =
    activeTools["thinking"] ||
    activeTools["web_search"] ||
    activeTools["subagent_mode"] ||
    knowledgePackSelection?.enabled ||
    executionStrategy === "code_orchestrated" ||
    accessMode === "read-only" ||
    accessMode === "full-access";
  const shouldShowAdvancedToggle =
    showSkillSelector ||
    shouldShowTeamSelector ||
    Boolean(setExecutionStrategy) ||
    shouldShowModelControls ||
    Boolean(setAccessMode) ||
    Boolean(onToggleFileManager);
  const shouldShowLeftExtra =
    Boolean(knowledgePackControl) || shouldShowAdvancedToggle;
  const leftExtra = shouldShowLeftExtra ? (
    <>
      {knowledgePackControl}

      {shouldShowAdvancedToggle ? (
        <MetaToggleButton
          type="button"
          $checked={showAdvancedControls || hasHighlightedAdvancedPreference}
          aria-label={showAdvancedControls ? "收起高级设置" : "展开高级设置"}
          aria-expanded={showAdvancedControls}
          data-testid="inputbar-advanced-toggle"
          title={showAdvancedControls ? "收起高级设置" : "展开高级设置"}
          onClick={() => setShowAdvancedControls((previous) => !previous)}
        >
          <MetaToggleCheck
            $checked={showAdvancedControls || hasHighlightedAdvancedPreference}
            aria-hidden
          />
          <MetaToggleGlyph aria-hidden>
            <Settings2 strokeWidth={1.8} />
          </MetaToggleGlyph>
          <MetaToggleLabel>高级设置</MetaToggleLabel>
          {showAdvancedControls ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          )}
        </MetaToggleButton>
      ) : null}

      {!showAdvancedControls && currentModelSummary ? (
        <Badge
          variant="outline"
          className="h-8 max-w-[240px] items-center overflow-hidden rounded-full border-slate-200/80 bg-white/90 px-3 text-xs font-medium text-slate-600"
          title={`当前模型：${currentModelSummary}`}
        >
          <span className="mr-1 text-slate-500">当前模型</span>
          <span className="truncate">{trimmedModel}</span>
        </Badge>
      ) : null}

      {!showAdvancedControls &&
      shouldShowModelControls &&
      !hasConfiguredModel ? (
        <InputbarModelExtra
          isFullscreen={isFullscreen}
          providerType={resolvedProviderType}
          setProviderType={resolvedSetProviderType}
          model={resolvedModel}
          setModel={resolvedSetModel}
          activeTheme={activeTheme}
          onManageProviders={onManageProviders}
          executionRuntime={executionRuntime}
        />
      ) : null}

      {onToggleFileManager ? (
        <MetaIconButton
          type="button"
          $active={fileManagerOpen}
          aria-label={
            fileManagerOpen ? "关闭左侧文件管理器" : "打开左侧文件管理器"
          }
          title={fileManagerOpen ? "关闭左侧文件管理器" : "打开左侧文件管理器"}
          data-testid="inputbar-file-manager-toggle"
          onClick={onToggleFileManager}
        >
          <FolderOpen className="h-4 w-4" aria-hidden />
        </MetaIconButton>
      ) : null}

      {showAdvancedControls ? (
        <>
          {showSkillSelector ? <SkillSelector {...skillSelectorProps} /> : null}
          {shouldShowTeamSelector ? (
            <TeamSelector
              activeTheme={activeTheme}
              input={input}
              autoOpenToken={teamSelectorAutoOpenToken}
              selectedTeam={selectedTeam}
              workspaceSettings={teamWorkspaceSettings}
              onPersistCustomTeams={onPersistCustomTeams}
              onSelectTeam={(team) => onSelectTeam?.(team)}
            />
          ) : null}
          <InputbarExecutionStrategySelect
            isFullscreen={isFullscreen}
            executionStrategy={executionStrategy}
            setExecutionStrategy={setExecutionStrategy}
          />
          {shouldShowModelControls ? (
            <InputbarModelExtra
              isFullscreen={isFullscreen}
              providerType={resolvedProviderType}
              setProviderType={resolvedSetProviderType}
              model={resolvedModel}
              setModel={resolvedSetModel}
              activeTheme={activeTheme}
              onManageProviders={onManageProviders}
              executionRuntime={executionRuntime}
            />
          ) : null}
          <InputbarAccessModeSelect
            isFullscreen={isFullscreen}
            accessMode={accessMode}
            setAccessMode={setAccessMode}
          />
        </>
      ) : null}
    </>
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
      />
      <CharacterMention
        {...mentionSkillProps}
        characters={characters}
        inputRef={textareaRef}
        value={input}
        onChange={inputAdapter.actions.setText}
        onSelectCharacter={onSelectCharacter}
        onSelectInputCapability={onSelectInputCapability}
        projectId={projectId}
        sessionId={sessionId}
        defaultCuratedTaskReferenceMemoryIds={
          activeCapability?.kind === "curated_task"
            ? activeCapability.referenceMemoryIds ||
              defaultCuratedTaskReferenceMemoryIds
            : defaultCuratedTaskReferenceMemoryIds
        }
        defaultCuratedTaskReferenceEntries={
          activeCapability?.kind === "curated_task"
            ? activeCapability.referenceEntries ||
              defaultCuratedTaskReferenceEntries
            : defaultCuratedTaskReferenceEntries
        }
        inputCompletionEnabled={inputCompletionEnabled}
      />
      <InputbarCore
        textareaRef={textareaRef}
        text={inputAdapter.state.text}
        setText={inputAdapter.actions.setText}
        onSend={onSend}
        onStop={inputAdapter.actions.stop}
        isLoading={inputAdapter.state.isSending}
        disabled={inputAdapter.state.disabled}
        onToolClick={handleToolAction}
        activeTools={activeTools}
        pendingImages={currentPendingImages}
        onRemoveImage={onRemoveImage}
        pathReferences={pathReferences}
        onImportPathReferenceAsKnowledge={onImportPathReferenceAsKnowledge}
        onRemovePathReference={onRemovePathReference}
        onPaste={onPaste}
        isFullscreen={isFullscreen}
        placeholder={
          isWorkspaceVariant
            ? workflowGate?.status === "waiting"
              ? "说说你的选择，剩下的交给我"
              : contextVariant === "task-center"
                ? "继续补充这轮生成，或回到左侧继续旧历史"
                : "试着输入任何指令，剩下的交给我"
            : undefined
        }
        toolMode={isWorkspaceVariant ? "attach-only" : "default"}
        showDragHandle={!isWorkspaceVariant}
        visualVariant={isWorkspaceVariant ? "floating" : "default"}
        topExtra={resolvedTopExtra}
        activeTheme={activeTheme}
        queuedTurns={queuedTurns}
        onPromoteQueuedTurn={onPromoteQueuedTurn}
        onRemoveQueuedTurn={onRemoveQueuedTurn}
        leftExtra={leftExtra}
        showMetaTools={showAdvancedControls}
      />
    </>
  );
};
