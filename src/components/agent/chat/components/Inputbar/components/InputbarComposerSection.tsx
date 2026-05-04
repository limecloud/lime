import React, { useMemo, useState } from "react";
import styled from "styled-components";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Settings2,
} from "lucide-react";
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

const KnowledgePackControlWrap = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;

  ${MetaToggleLabel} {
    max-width: 154px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

const KnowledgePackMenuButton = styled.button`
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #ffffff;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;

  &:hover,
  &:focus-visible {
    border-color: rgba(16, 185, 129, 0.38);
    background: var(--lime-surface-hover, #f4fdf4);
    color: hsl(var(--foreground));
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--lime-focus-ring, rgba(74, 222, 128, 0.24));
  }
`;

const KnowledgePackMenu = styled.div`
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 120;
  width: min(300px, calc(100vw - 48px));
  max-height: 260px;
  overflow: auto;
  padding: 6px;
  border-radius: 14px;
  border: 1px solid rgba(203, 213, 225, 0.9);
  background: #ffffff;
  box-shadow: 0 18px 40px -28px rgba(15, 23, 42, 0.34);
`;

const KnowledgePackMenuItem = styled.button<{ $active?: boolean }>`
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  padding: 9px 10px;
  border: 1px solid
    ${({ $active }) => ($active ? "rgba(16, 185, 129, 0.42)" : "transparent")};
  border-radius: 10px;
  background: ${({ $active }) => ($active ? "#ecfdf5" : "transparent")};
  color: #0f172a;
  text-align: left;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: #f8fafc;
    border-color: rgba(203, 213, 225, 0.9);
  }

  &:focus-visible {
    outline: none;
  }
`;

const KnowledgePackMenuItemTitle = styled.span`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;

  > span:first-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const KnowledgePackMenuItemMeta = styled.span`
  color: #64748b;
  font-size: 11px;
  line-height: 1.3;
`;

const KnowledgePackMenuBadge = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  min-height: 18px;
  border-radius: 999px;
  background: #d1fae5;
  padding: 0 7px;
  color: #047857;
  font-size: 10px;
  font-weight: 700;
`;

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
  onToggleKnowledgePack?: (enabled: boolean) => void;
  onSelectKnowledgePack?: (packName: string) => void;
  onStartKnowledgeOrganize?: () => void;
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
  onToggleKnowledgePack,
  onSelectKnowledgePack,
  onStartKnowledgeOrganize,
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
  const [showKnowledgePackMenu, setShowKnowledgePackMenu] = useState(false);
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
  const shouldShowKnowledgePackToggle = Boolean(
    knowledgePackSelection?.packName && knowledgePackSelection?.workingDir,
  );
  const normalizedKnowledgePackOptions = useMemo(() => {
    const optionMap = new Map<string, InputbarKnowledgePackOption>();

    for (const option of knowledgePackOptions) {
      const packName = option.packName.trim();
      if (!packName || optionMap.has(packName)) {
        continue;
      }

      optionMap.set(packName, {
        ...option,
        packName,
      });
    }

    const selectedPackName = knowledgePackSelection?.packName.trim();
    if (selectedPackName && !optionMap.has(selectedPackName)) {
      optionMap.set(selectedPackName, {
        packName: selectedPackName,
        label: knowledgePackSelection?.label,
        status: knowledgePackSelection?.status,
      });
    }

    return Array.from(optionMap.values());
  }, [knowledgePackOptions, knowledgePackSelection]);
  const hasKnowledgePackChoices = normalizedKnowledgePackOptions.length > 1;
  const currentKnowledgePackLabel =
    knowledgePackSelection?.label ||
    knowledgePackSelection?.packName ||
    "项目资料";
  const handleKnowledgePackToggle = () => {
    if (!knowledgePackSelection) {
      return;
    }

    onToggleKnowledgePack?.(!knowledgePackSelection.enabled);
  };
  const handleSelectKnowledgePack = (packName: string) => {
    onSelectKnowledgePack?.(packName);
    onToggleKnowledgePack?.(true);
    setShowKnowledgePackMenu(false);
  };
  const hasHighlightedAdvancedPreference =
    activeTools["thinking"] ||
    activeTools["web_search"] ||
    activeTools["subagent_mode"] ||
    knowledgePackSelection?.enabled ||
    executionStrategy === "code_orchestrated" ||
    accessMode === "read-only" ||
    accessMode === "full-access";
  const knowledgePackControl = shouldShowKnowledgePackToggle &&
    knowledgePackSelection ? (
      <KnowledgePackControlWrap>
        <MetaToggleButton
          type="button"
          $checked={knowledgePackSelection.enabled}
          aria-label={
            knowledgePackSelection.enabled ? "关闭项目资料" : "使用项目资料"
          }
          title={
            knowledgePackSelection.enabled
              ? `已使用项目资料：${currentKnowledgePackLabel}`
              : `使用项目资料：${currentKnowledgePackLabel}`
          }
          data-testid="inputbar-knowledge-pack-toggle"
          onClick={handleKnowledgePackToggle}
        >
          <MetaToggleCheck
            $checked={knowledgePackSelection.enabled}
            aria-hidden
          />
          <MetaToggleGlyph aria-hidden>
            <BookOpen strokeWidth={1.8} />
          </MetaToggleGlyph>
          <MetaToggleLabel>
            {knowledgePackSelection.enabled
              ? currentKnowledgePackLabel
              : "项目资料"}
          </MetaToggleLabel>
        </MetaToggleButton>
        {hasKnowledgePackChoices ? (
          <KnowledgePackMenuButton
            type="button"
            aria-label="选择项目资料"
            aria-expanded={showKnowledgePackMenu}
            title="选择项目资料"
            data-testid="inputbar-knowledge-pack-menu-toggle"
            onClick={() => setShowKnowledgePackMenu((previous) => !previous)}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </KnowledgePackMenuButton>
        ) : null}
        {showKnowledgePackMenu ? (
          <KnowledgePackMenu role="menu" data-testid="inputbar-knowledge-pack-menu">
            {normalizedKnowledgePackOptions.map((option) => {
              const isSelected =
                option.packName === knowledgePackSelection.packName;
              const label = option.label || option.packName;

              return (
                <KnowledgePackMenuItem
                  key={option.packName}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  data-testid={`inputbar-knowledge-pack-option-${option.packName}`}
                  $active={isSelected}
                  onClick={() => handleSelectKnowledgePack(option.packName)}
                >
                  <KnowledgePackMenuItemTitle>
                    <span>{label}</span>
                    {option.defaultForWorkspace ? (
                      <KnowledgePackMenuBadge>默认</KnowledgePackMenuBadge>
                    ) : null}
                  </KnowledgePackMenuItemTitle>
                  <KnowledgePackMenuItemMeta>
                    {option.status || "未确认"}
                  </KnowledgePackMenuItemMeta>
                </KnowledgePackMenuItem>
              );
            })}
          </KnowledgePackMenu>
        ) : null}
      </KnowledgePackControlWrap>
    ) : onStartKnowledgeOrganize ? (
      <MetaToggleButton
        type="button"
        $checked={false}
        aria-label="整理成项目资料"
        title="整理成项目资料"
        data-testid="inputbar-knowledge-organize"
        onClick={onStartKnowledgeOrganize}
      >
        <MetaToggleGlyph aria-hidden>
          <BookOpen strokeWidth={1.8} />
        </MetaToggleGlyph>
        <MetaToggleLabel>整理成项目资料</MetaToggleLabel>
      </MetaToggleButton>
    ) : null;
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
