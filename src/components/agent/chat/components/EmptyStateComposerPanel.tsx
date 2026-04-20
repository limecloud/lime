import React, { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Globe, Settings2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TeamSuggestionBar } from "./TeamSuggestionBar";
import { CharacterMention } from "../skill-selection/CharacterMention";
import { BuiltinCommandBadge } from "./Inputbar/components/BuiltinCommandBadge";
import { InputbarAccessModeSelect } from "./Inputbar/components/InputbarAccessModeSelect";
import { InputbarCore } from "./Inputbar/components/InputbarCore";
import { InputbarExecutionStrategySelect } from "./Inputbar/components/InputbarExecutionStrategySelect";
import { InputbarModelExtra } from "./Inputbar/components/InputbarModelExtra";
import { RuntimeSceneBadge } from "./Inputbar/components/RuntimeSceneBadge";
import { CuratedTaskBadge } from "../skill-selection/CuratedTaskBadge";
import { SkillBadge } from "../skill-selection/SkillBadge";
import { SkillSelector } from "../skill-selection/SkillSelector";
import { TeamSelector } from "./Inputbar/components/TeamSelector";
import type { WorkspaceSettings } from "@/types/workspace";
import { CREATION_MODE_CONFIG } from "./constants";
import type { CreationMode } from "./types";
import type { Character } from "@/lib/api/memory";
import type { MessageImage } from "../types";
import type { TeamDefinition } from "../utils/teamDefinitions";
import {
  EMPTY_STATE_PASSIVE_BADGE_CLASSNAME,
  EMPTY_STATE_SELECT_TRIGGER_CLASSNAME,
} from "./emptyStateSurfaceTokens";
import {
  MetaToggleButton,
  MetaToggleCheck,
  MetaToggleGlyph,
  MetaToggleLabel,
} from "./Inputbar/styles";
import { getTeamSuggestion } from "../utils/teamSuggestion";
import {
  buildSkillSelectionBindings,
  type SkillSelectionProps,
} from "../skill-selection/skillSelectionBindings";
import type { AgentAccessMode } from "../hooks/agentChatStorage";
import type {
  InputCapabilitySelection,
  SelectInputCapabilityHandler,
} from "../skill-selection/inputCapabilitySelection";
import type { CuratedTaskReferenceEntry } from "../utils/curatedTaskReferenceSelection";
import type { CreationReplaySurfaceModel } from "../utils/creationReplaySurface";
import { getProviderLabel } from "@/lib/constants/providerMappings";

interface EmptyStateComposerPanelProps {
  input: string;
  setInput: (value: string) => void;
  placeholder: string;
  onSend: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  activeTheme: string;
  providerType: string;
  setProviderType: (type: string) => void;
  model: string;
  setModel: (model: string) => void;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  setExecutionStrategy?: (
    strategy: "react" | "code_orchestrated" | "auto",
  ) => void;
  accessMode?: AgentAccessMode;
  setAccessMode?: (mode: AgentAccessMode) => void;
  onManageProviders?: () => void;
  isGeneralTheme: boolean;
  characters: Character[];
  skillSelection: SkillSelectionProps;
  activeCapability?: InputCapabilitySelection | null;
  onSelectInputCapability?: SelectInputCapabilityHandler;
  onClearInputCapability?: () => void;
  onEditCuratedTask?: () => void;
  creationReplaySurface?: CreationReplaySurfaceModel | null;
  projectId?: string | null;
  defaultCuratedTaskReferenceMemoryIds?: string[];
  defaultCuratedTaskReferenceEntries?: CuratedTaskReferenceEntry[];
  showCreationModeSelector: boolean;
  creationMode: CreationMode;
  onCreationModeChange?: (mode: CreationMode) => void;
  thinkingEnabled: boolean;
  onThinkingEnabledChange?: (enabled: boolean) => void;
  subagentEnabled: boolean;
  onSubagentEnabledChange?: (enabled: boolean) => void;
  selectedTeam?: TeamDefinition | null;
  onSelectTeam?: (team: TeamDefinition | null) => void;
  teamWorkspaceSettings?: WorkspaceSettings | null;
  onPersistCustomTeams?: (teams: TeamDefinition[]) => void | Promise<void>;
  onEnableSuggestedTeam?: (suggestedPresetId?: string) => void;
  webSearchEnabled: boolean;
  onWebSearchEnabledChange?: (enabled: boolean) => void;
  pendingImages: MessageImage[];
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onRemoveImage?: (index: number) => void;
}

export function EmptyStateComposerPanel({
  input,
  setInput,
  placeholder,
  onSend,
  isLoading = false,
  disabled = false,
  activeTheme,
  providerType,
  setProviderType,
  model,
  setModel,
  executionStrategy = "react",
  setExecutionStrategy,
  accessMode,
  setAccessMode,
  onManageProviders,
  isGeneralTheme,
  characters,
  skillSelection,
  activeCapability = null,
  onSelectInputCapability,
  onClearInputCapability,
  onEditCuratedTask,
  creationReplaySurface = null,
  projectId = null,
  defaultCuratedTaskReferenceMemoryIds = [],
  defaultCuratedTaskReferenceEntries = [],
  showCreationModeSelector,
  creationMode,
  onCreationModeChange,
  thinkingEnabled,
  onThinkingEnabledChange,
  subagentEnabled,
  onSubagentEnabledChange,
  selectedTeam,
  onSelectTeam,
  teamWorkspaceSettings,
  onPersistCustomTeams,
  onEnableSuggestedTeam,
  webSearchEnabled,
  onWebSearchEnabledChange,
  pendingImages,
  onFileSelect,
  onPaste,
  onRemoveImage,
}: EmptyStateComposerPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [dismissedSuggestionKey, setDismissedSuggestionKey] = useState<
    string | null
  >(null);
  const [teamSelectorAutoOpenToken, setTeamSelectorAutoOpenToken] = useState<
    number | null
  >(null);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const activeBuiltinCommand =
    activeCapability?.kind === "builtin_command"
      ? activeCapability.command
      : null;
  const activeRuntimeScene =
    activeCapability?.kind === "runtime_scene"
      ? activeCapability.command
      : null;
  const activeCuratedTask =
    activeCapability?.kind === "curated_task" ? activeCapability.task : null;
  const activeSkill =
    activeCapability?.kind === "installed_skill"
      ? activeCapability.skill
      : skillSelection.activeSkill ?? null;
  const clearActiveSkill = skillSelection.onClearSkill;
  const { mentionProps: mentionSkillProps, selectorProps: skillSelectorProps } =
    buildSkillSelectionBindings(skillSelection);
  const suggestionKey = `${activeTheme}:${input.trim().toLowerCase()}`;
  const teamSuggestion = useMemo(
    () =>
      getTeamSuggestion({
        input,
        activeTheme,
        subagentEnabled,
      }),
    [activeTheme, input, subagentEnabled],
  );
  const shouldShowTeamSuggestion =
    isGeneralTheme &&
    Boolean(onSubagentEnabledChange) &&
    teamSuggestion.shouldSuggest &&
    dismissedSuggestionKey !== suggestionKey;
  const shouldShowTeamSelector = isGeneralTheme && subagentEnabled;

  const handleEnableTeamSuggestion = () => {
    onSubagentEnabledChange?.(true);
    onEnableSuggestedTeam?.(teamSuggestion.suggestedPresetId);
    setDismissedSuggestionKey(suggestionKey);
  };

  const handleContinueSingleAgent = () => {
    setDismissedSuggestionKey(suggestionKey);
  };

  const handleToggleSubagentMode = () => {
    if (!subagentEnabled && !selectedTeam) {
      setTeamSelectorAutoOpenToken((current) => (current ?? 0) + 1);
    }
    onSubagentEnabledChange?.(!subagentEnabled);
  };

  const handleToolAction = (tool: string) => {
    switch (tool) {
      case "attach":
        imageInputRef.current?.click();
        return;
      case "thinking":
        onThinkingEnabledChange?.(!thinkingEnabled);
        return;
      case "web_search":
        onWebSearchEnabledChange?.(!webSearchEnabled);
        return;
      case "subagent_mode":
        handleToggleSubagentMode();
        return;
      default:
        return;
    }
  };

  const topExtra =
    activeBuiltinCommand ||
    activeRuntimeScene ||
    activeCuratedTask ||
    activeSkill ||
    creationReplaySurface ||
    shouldShowTeamSuggestion ? (
      <>
        {activeBuiltinCommand ? (
          <BuiltinCommandBadge
            command={activeBuiltinCommand}
            onClear={onClearInputCapability ?? (() => undefined)}
          />
        ) : null}

        {activeRuntimeScene ? (
          <RuntimeSceneBadge
            command={activeRuntimeScene}
            onClear={onClearInputCapability ?? (() => undefined)}
          />
        ) : null}

        {activeSkill ? (
          <SkillBadge
            skill={activeSkill}
            onClear={
              onClearInputCapability || clearActiveSkill || (() => undefined)
            }
          />
        ) : null}

        {activeCuratedTask ? (
          <CuratedTaskBadge
            task={activeCuratedTask}
            onEdit={onEditCuratedTask}
            onClear={onClearInputCapability ?? (() => undefined)}
          />
        ) : null}

        {creationReplaySurface ? (
          <Badge
            className={`${EMPTY_STATE_PASSIVE_BADGE_CLASSNAME} max-w-[320px] justify-start gap-1.5`}
            title={`${creationReplaySurface.eyebrow} · ${creationReplaySurface.title} · ${creationReplaySurface.summary}`}
          >
            <span className="shrink-0 text-emerald-700">
              {creationReplaySurface.badgeLabel}
            </span>
            <span className="truncate">{creationReplaySurface.title}</span>
          </Badge>
        ) : null}

        {shouldShowTeamSuggestion ? (
          <TeamSuggestionBar
            compact
            score={teamSuggestion.score}
            reasons={teamSuggestion.reasons}
            suggestedRoles={teamSuggestion.suggestedRoles}
            suggestedPresetLabel={teamSuggestion.suggestedPresetLabel}
            onEnableTeam={handleEnableTeamSuggestion}
            onContinueSingleAgent={handleContinueSingleAgent}
          />
        ) : null}
      </>
    ) : undefined;

  const shouldShowThemeSpecificExtra = showCreationModeSelector;
  const shouldShowModelControls = true;
  const trimmedProviderType = providerType.trim();
  const trimmedModel = model.trim();
  const hasConfiguredModel = Boolean(trimmedProviderType && trimmedModel);
  const currentModelSummary = hasConfiguredModel
    ? `${getProviderLabel(trimmedProviderType)} / ${trimmedModel}`
    : null;
  const hasHighlightedAdvancedPreference =
    thinkingEnabled ||
    webSearchEnabled ||
    subagentEnabled ||
    executionStrategy === "code_orchestrated" ||
    accessMode === "read-only" ||
    accessMode === "full-access";
  const shouldShowAdvancedToggle =
    isGeneralTheme ||
    shouldShowTeamSelector ||
    Boolean(setExecutionStrategy) ||
    shouldShowModelControls ||
    Boolean(setAccessMode) ||
    shouldShowThemeSpecificExtra;
  const leftExtra = shouldShowAdvancedToggle ? (
    <>
      <MetaToggleButton
        type="button"
        $checked={showAdvancedControls || hasHighlightedAdvancedPreference}
        aria-label={showAdvancedControls ? "收起高级设置" : "展开高级设置"}
        aria-expanded={showAdvancedControls}
        data-testid="empty-state-advanced-toggle"
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

      {!showAdvancedControls && currentModelSummary ? (
        <Badge
          variant="outline"
          className={`${EMPTY_STATE_PASSIVE_BADGE_CLASSNAME} max-w-[240px] items-center overflow-hidden`}
          title={`当前模型：${currentModelSummary}`}
        >
          <span className="mr-1 text-slate-500">当前模型</span>
          <span className="truncate">{trimmedModel}</span>
        </Badge>
      ) : null}

      {showAdvancedControls ? (
        <>
          {isGeneralTheme ? <SkillSelector {...skillSelectorProps} /> : null}

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
            executionStrategy={executionStrategy}
            setExecutionStrategy={setExecutionStrategy}
          />

          <InputbarModelExtra
            providerType={providerType}
            setProviderType={setProviderType}
            model={model}
            setModel={setModel}
            activeTheme={activeTheme}
            onManageProviders={onManageProviders}
          />

          <InputbarAccessModeSelect
            accessMode={accessMode}
            setAccessMode={setAccessMode}
          />

          {showCreationModeSelector ? (
            <Select
              value={creationMode}
              onValueChange={(value) =>
                onCreationModeChange?.(value as CreationMode)
              }
            >
              <SelectTrigger
                className={`${EMPTY_STATE_SELECT_TRIGGER_CLASSNAME} min-w-[120px]`}
              >
                <div className="flex items-center gap-2">
                  {CREATION_MODE_CONFIG[creationMode].icon}
                  <span>{CREATION_MODE_CONFIG[creationMode].name}</span>
                </div>
              </SelectTrigger>
              <SelectContent className="min-w-[200px] p-1" side="top">
                <div className="px-2 py-1.5 text-xs font-medium text-slate-500">
                  选择创作模式
                </div>
                {(
                  Object.entries(CREATION_MODE_CONFIG) as [
                    CreationMode,
                    (typeof CREATION_MODE_CONFIG)[CreationMode],
                  ][]
                ).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    <div className="flex items-center gap-3">
                      <span className="flex-shrink-0">{config.icon}</span>
                      <span className="font-medium">{config.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {isGeneralTheme ? (
            <Badge
              variant="outline"
              className={EMPTY_STATE_PASSIVE_BADGE_CLASSNAME}
            >
              <Globe className="mr-1 h-3.5 w-3.5" />
              通用任务上下文
            </Badge>
          ) : null}
        </>
      ) : null}
    </>
  ) : undefined;

  return (
    <>
      <CharacterMention
        {...mentionSkillProps}
        characters={characters}
        inputRef={textareaRef}
        value={input}
        onChange={setInput}
        onSelectInputCapability={onSelectInputCapability}
        projectId={projectId}
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
      />

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={onFileSelect}
      />

      <InputbarCore
        textareaRef={textareaRef}
        text={input}
        setText={setInput}
        onSend={onSend}
        isLoading={isLoading}
        disabled={disabled}
        onToolClick={handleToolAction}
        activeTools={{
          thinking: thinkingEnabled,
          web_search: webSearchEnabled,
          subagent_mode: subagentEnabled,
        }}
        pendingImages={pendingImages}
        onRemoveImage={onRemoveImage}
        onPaste={
          onPaste
            ? (event) =>
                onPaste(event as React.ClipboardEvent<HTMLTextAreaElement>)
            : undefined
        }
        placeholder={placeholder}
        activeTheme={activeTheme}
        showDragHandle={false}
        visualVariant="floating"
        topExtra={topExtra}
        leftExtra={leftExtra}
        showMetaTools={showAdvancedControls}
      />
    </>
  );
}

export default EmptyStateComposerPanel;
