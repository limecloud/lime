import React, { useMemo, useRef, useState } from "react";
import { Globe } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TeamSuggestionBar } from "./TeamSuggestionBar";
import { CharacterMention } from "../skill-selection/CharacterMention";
import { InputbarAccessModeSelect } from "./Inputbar/components/InputbarAccessModeSelect";
import { InputbarCore } from "./Inputbar/components/InputbarCore";
import { InputbarExecutionStrategySelect } from "./Inputbar/components/InputbarExecutionStrategySelect";
import { InputbarModelExtra } from "./Inputbar/components/InputbarModelExtra";
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
import { getTeamSuggestion } from "../utils/teamSuggestion";
import {
  buildSkillSelectionBindings,
  type SkillSelectionProps,
} from "../skill-selection/skillSelectionBindings";
import type { AgentAccessMode } from "../hooks/agentChatStorage";

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
  const activeSkill = skillSelection.activeSkill ?? null;
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
    Boolean(activeSkill) || shouldShowTeamSuggestion ? (
      <>
        {activeSkill ? (
          <SkillBadge
            skill={activeSkill}
            onClear={clearActiveSkill ?? (() => undefined)}
          />
        ) : null}

        {shouldShowTeamSuggestion ? (
          <TeamSuggestionBar
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
  const shouldShowModelExtra = Boolean(providerType?.trim() && model?.trim());
  const shouldShowLeftExtra =
    isGeneralTheme ||
    shouldShowTeamSelector ||
    Boolean(setExecutionStrategy) ||
    shouldShowModelExtra ||
    Boolean(setAccessMode) ||
    shouldShowThemeSpecificExtra;
  const leftExtra = shouldShowLeftExtra ? (
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
  ) : undefined;

  return (
    <>
      <CharacterMention
        {...mentionSkillProps}
        characters={characters}
        inputRef={textareaRef}
        value={input}
        onChange={setInput}
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
      />
    </>
  );
}

export default EmptyStateComposerPanel;
