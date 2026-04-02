import React, { useMemo, useRef, useState } from "react";
import styled from "styled-components";
import {
  BrainCircuit,
  Globe,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TeamSuggestionBar } from "./TeamSuggestionBar";
import { CharacterMention } from "./Inputbar/components/CharacterMention";
import { InputbarAccessModeSelect } from "./Inputbar/components/InputbarAccessModeSelect";
import { InputbarCore } from "./Inputbar/components/InputbarCore";
import { InputbarExecutionStrategySelect } from "./Inputbar/components/InputbarExecutionStrategySelect";
import { InputbarModelExtra } from "./Inputbar/components/InputbarModelExtra";
import { SkillBadge } from "./Inputbar/components/SkillBadge";
import { SkillSelector } from "./Inputbar/components/SkillSelector";
import { TeamSelector } from "./Inputbar/components/TeamSelector";
import type { WorkspaceSettings } from "@/types/workspace";
import { CREATION_MODE_CONFIG } from "./constants";
import type {
  CreationMode,
  EntryTaskSlotValues,
  EntryTaskTemplate,
  EntryTaskType,
} from "./types";
import type { Character } from "@/lib/api/memory";
import type { MessageImage } from "../types";
import type { TeamDefinition } from "../utils/teamDefinitions";

import iconXhs from "@/assets/platforms/xhs.png";
import iconGzh from "@/assets/platforms/gzh.png";
import iconZhihu from "@/assets/platforms/zhihu.png";
import iconToutiao from "@/assets/platforms/toutiao.png";
import iconJuejin from "@/assets/platforms/juejin.png";
import iconCsdn from "@/assets/platforms/csdn.png";
import {
  EMPTY_STATE_PASSIVE_BADGE_CLASSNAME,
  EMPTY_STATE_SELECT_TRIGGER_CLASSNAME,
} from "./emptyStateSurfaceTokens";
import type { ModelSelectorProps } from "@/components/input-kit";
import { getTeamSuggestion } from "../utils/teamSuggestion";
import {
  buildSkillSelectionBindings,
  type SkillSelectionProps,
} from "./Inputbar/components/skillSelectionBindings";
import type { AgentAccessMode } from "../hooks/agentChatStorage";

const EntryTaskContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 16px 6px 16px;
  background: linear-gradient(
    180deg,
    rgba(248, 250, 252, 0.84) 0%,
    rgba(255, 255, 255, 0) 100%
  );
  border-bottom: 1px dashed rgba(203, 213, 225, 0.9);
`;

const EntryTaskTabs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const EntryTaskTab = styled.button<{ $active?: boolean }>`
  height: 32px;
  padding: 0 12px;
  border-radius: 9999px;
  font-size: 12px;
  border: 1px solid
    ${(props) =>
      props.$active ? "rgba(203, 213, 225, 0.92)" : "rgba(226, 232, 240, 0.9)"};
  color: ${(props) => (props.$active ? "#0f172a" : "#64748b")};
  background: ${(props) =>
    props.$active ? "rgba(255, 255, 255, 0.96)" : "rgba(255, 255, 255, 0.78)"};
  box-shadow: ${(props) =>
    props.$active ? "0 10px 22px -20px rgba(15, 23, 42, 0.24)" : "none"};
  transition: all 0.2s ease;

  &:hover {
    border-color: rgba(203, 213, 225, 0.92);
    color: #0f172a;
  }
`;

const EntryTaskPreview = styled.div`
  font-size: 14px;
  line-height: 1.6;
  color: #0f172a;
`;

const SlotToken = styled.span`
  color: #0369a1;
  background: rgba(224, 242, 254, 0.95);
  border-radius: 8px;
  padding: 2px 8px;
  font-size: 13px;
`;

const SlotGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
`;

const PLATFORM_ICON_MAP: Record<string, string | undefined> = {
  xiaohongshu: iconXhs,
  wechat: iconGzh,
  zhihu: iconZhihu,
  toutiao: iconToutiao,
  juejin: iconJuejin,
  csdn: iconCsdn,
};

const PLATFORM_LABEL_MAP: Record<string, string> = {
  xiaohongshu: "小红书",
  wechat: "公众号",
  zhihu: "知乎",
  toutiao: "今日头条",
  juejin: "掘金",
  csdn: "CSDN",
};

interface EmptyStateComposerPanelProps {
  input: string;
  setInput: (value: string) => void;
  placeholder: string;
  onSend: () => void;
  activeTheme: string;
  providerType: string;
  setProviderType: (type: string) => void;
  model: string;
  setModel: (model: string) => void;
  workspaceId?: string | null;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  setExecutionStrategy?: (
    strategy: "react" | "code_orchestrated" | "auto",
  ) => void;
  accessMode?: AgentAccessMode;
  setAccessMode?: (mode: AgentAccessMode) => void;
  onManageProviders?: () => void;
  modelSelectorBackgroundPreload?: ModelSelectorProps["backgroundPreload"];
  isGeneralTheme: boolean;
  isEntryTheme: boolean;
  entryTaskType: EntryTaskType;
  entryTaskTypes: EntryTaskType[];
  getEntryTaskTemplate: (type: EntryTaskType) => EntryTaskTemplate;
  entryTemplate: EntryTaskTemplate;
  entryPreview: string;
  entrySlotValues: EntryTaskSlotValues;
  onEntryTaskTypeChange: (type: EntryTaskType) => void;
  onEntrySlotChange: (key: string, value: string) => void;
  characters: Character[];
  skillSelection: SkillSelectionProps;
  showCreationModeSelector: boolean;
  creationMode: CreationMode;
  onCreationModeChange?: (mode: CreationMode) => void;
  platform: string;
  setPlatform: (value: string) => void;
  depth: string;
  setDepth: (value: string) => void;
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
  activeTheme,
  providerType,
  setProviderType,
  model,
  setModel,
  workspaceId,
  executionStrategy = "react",
  setExecutionStrategy,
  accessMode,
  setAccessMode,
  onManageProviders,
  modelSelectorBackgroundPreload = "immediate",
  isGeneralTheme,
  isEntryTheme,
  entryTaskType,
  entryTaskTypes,
  getEntryTaskTemplate,
  entryTemplate,
  entryPreview,
  entrySlotValues,
  onEntryTaskTypeChange,
  onEntrySlotChange,
  characters,
  skillSelection,
  showCreationModeSelector,
  creationMode,
  onCreationModeChange,
  platform,
  setPlatform,
  depth,
  setDepth,
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

  const getPlatformIcon = (value: string) => PLATFORM_ICON_MAP[value];
  const getPlatformLabel = (value: string) =>
    PLATFORM_LABEL_MAP[value] || value;
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
    isEntryTheme ||
    Boolean(activeSkill) ||
    shouldShowTeamSuggestion ? (
      <>
        {isEntryTheme ? (
          <EntryTaskContainer>
            <EntryTaskTabs>
              {entryTaskTypes.map((task) => {
                const taskTemplate =
                  task === entryTaskType
                    ? entryTemplate
                    : getEntryTaskTemplate(task);
                return (
                  <EntryTaskTab
                    key={task}
                    $active={entryTaskType === task}
                    onClick={() => onEntryTaskTypeChange(task)}
                    title={taskTemplate?.description}
                  >
                    {taskTemplate?.label || task}
                  </EntryTaskTab>
                );
              })}
            </EntryTaskTabs>

            <EntryTaskPreview>
              {entryPreview.split(/(\[[^\]]+\])/g).map((chunk, index) => {
                const isToken = /^\[[^\]]+\]$/.test(chunk);
                if (!chunk) return null;
                if (!isToken) {
                  return (
                    <React.Fragment key={`${chunk}-${index}`}>
                      {chunk}
                    </React.Fragment>
                  );
                }

                return <SlotToken key={`${chunk}-${index}`}>{chunk}</SlotToken>;
              })}
            </EntryTaskPreview>

            <SlotGrid>
              {entryTemplate.slots.map((slot) => (
                <Input
                  key={slot.key}
                  value={entrySlotValues[slot.key] ?? ""}
                  onChange={(event) =>
                    onEntrySlotChange(slot.key, event.target.value)
                  }
                  placeholder={slot.placeholder}
                  className="h-9 rounded-xl border-slate-200/80 bg-white/88 text-xs shadow-none focus-visible:ring-1 focus-visible:ring-slate-200"
                />
              ))}
            </SlotGrid>
          </EntryTaskContainer>
        ) : null}

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

  const shouldShowThemeSpecificExtra =
    activeTheme === "social-media" ||
    showCreationModeSelector ||
    activeTheme === "knowledge" ||
    activeTheme === "planning";
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
          workspaceId={workspaceId}
          providerType={providerType}
          model={model}
          executionStrategy={executionStrategy}
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
        backgroundPreload={modelSelectorBackgroundPreload}
      />

      <InputbarAccessModeSelect
        accessMode={accessMode}
        setAccessMode={setAccessMode}
      />

      {activeTheme === "social-media" ? (
        <Select value={platform} onValueChange={setPlatform} closeOnMouseLeave>
          <SelectTrigger
            className={`${EMPTY_STATE_SELECT_TRIGGER_CLASSNAME} min-w-[120px]`}
          >
            <div className="flex items-center gap-2">
              {getPlatformIcon(platform) ? (
                <img
                  src={getPlatformIcon(platform)}
                  className="h-4 w-4 rounded-full"
                />
              ) : null}
              <span>{getPlatformLabel(platform)}</span>
            </div>
          </SelectTrigger>
          <SelectContent className="p-1" side="top">
            <div className="px-2 py-1.5 text-xs font-medium text-slate-500">
              选择要创作的内容平台
            </div>
            {Object.keys(PLATFORM_LABEL_MAP).map((item) => (
              <SelectItem key={item} value={item}>
                <div className="flex items-center gap-2">
                  {getPlatformIcon(item) ? (
                    <img
                      src={getPlatformIcon(item)}
                      className="h-4 w-4 rounded-full"
                    />
                  ) : null}
                  {getPlatformLabel(item)}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

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

      {activeTheme === "knowledge" ? (
        <Select value={depth} onValueChange={setDepth}>
          <SelectTrigger
            className={`${EMPTY_STATE_SELECT_TRIGGER_CLASSNAME} w-[110px]`}
          >
            <BrainCircuit className="mr-2 h-3.5 w-3.5 text-slate-500" />
            <SelectValue placeholder="深度" />
          </SelectTrigger>
          <SelectContent side="top">
            <SelectItem value="deep">深度解析</SelectItem>
            <SelectItem value="quick">快速概览</SelectItem>
          </SelectContent>
        </Select>
      ) : null}

      {activeTheme === "planning" ? (
        <Badge
          variant="outline"
          className={EMPTY_STATE_PASSIVE_BADGE_CLASSNAME}
        >
          <Globe className="mr-1 h-3.5 w-3.5" />
          旅行/职业/活动
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
        onToolClick={handleToolAction}
        activeTools={{
          thinking: thinkingEnabled,
          web_search: webSearchEnabled,
          subagent_mode: subagentEnabled,
        }}
        executionStrategy={executionStrategy}
        showExecutionStrategy={false}
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
        allowEmptySend={isEntryTheme}
        topExtra={topExtra}
        leftExtra={leftExtra}
      />
    </>
  );
}

export default EmptyStateComposerPanel;
