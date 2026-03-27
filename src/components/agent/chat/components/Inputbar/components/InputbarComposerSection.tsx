import React, { useState } from "react";
import type { ChatInputAdapter } from "@/components/input-kit/adapters/types";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import type { ServiceSkillHomeItem } from "@/components/agent/chat/service-skills/types";
import type {
  AsterSessionExecutionRuntime,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type { MessageImage } from "../../../types";
import { CharacterMention } from "./CharacterMention";
import { InputbarCore } from "./InputbarCore";
import { SkillSelector } from "./SkillSelector";
import type { BuiltinInputCommand } from "./builtinCommands";
import { TeamSelector } from "./TeamSelector";
import { ThemeWorkbenchStatusPanel } from "./ThemeWorkbenchStatusPanel";
import { InputbarModelExtra } from "./InputbarModelExtra";
import { InputbarVisionCapabilityNotice } from "./InputbarVisionCapabilityNotice";
import { InputbarExecutionStrategySelect } from "./InputbarExecutionStrategySelect";
import { StableProcessingNotice } from "../../StableProcessingNotice";
import { isGeneralResearchTheme } from "../../../utils/generalAgentPrompt";
import type { TeamDefinition } from "../../../utils/teamDefinitions";
import { shouldShowStableProcessingNotice } from "../../../utils/stableProcessingExperience";
import type { WorkspaceSettings } from "@/types/workspace";
import type {
  ThemeWorkbenchGateState,
  ThemeWorkbenchQuickAction,
  ThemeWorkbenchWorkflowStep,
} from "../hooks/useThemeWorkbenchInputState";

interface InputbarComposerSectionProps {
  renderThemeWorkbenchGeneratingPanel: boolean;
  themeWorkbenchGate?: ThemeWorkbenchGateState | null;
  themeWorkbenchQuickActions: ThemeWorkbenchQuickAction[];
  themeWorkbenchQueueItems: ThemeWorkbenchWorkflowStep[];
  inputAdapter: ChatInputAdapter;
  characters: Character[];
  skills: Skill[];
  serviceSkills?: ServiceSkillHomeItem[];
  isSkillsLoading?: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  input: string;
  activeSkill?: Skill | null;
  onSelectCharacter?: (character: Character) => void;
  onSelectSkill: (skill: Skill) => void;
  onSelectServiceSkill?: (skill: ServiceSkillHomeItem) => void;
  onSelectBuiltinCommand: (command: BuiltinInputCommand | null) => void;
  onClearSkill?: () => void;
  onNavigateToSettings?: () => void;
  onImportSkill?: () => void | Promise<void>;
  onRefreshSkills?: () => void | Promise<void>;
  selectedTeam?: TeamDefinition | null;
  onSelectTeam?: (team: TeamDefinition | null) => void;
  teamWorkspaceSettings?: WorkspaceSettings | null;
  onPersistCustomTeams?: (teams: TeamDefinition[]) => void | Promise<void>;
  workspaceId?: string | null;
  providerType?: string;
  model?: string;
  onSend: () => void;
  onToolClick: (tool: string) => void;
  activeTools: Record<string, boolean>;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  pendingImages: MessageImage[];
  onRemoveImage: (index: number) => void;
  onPaste: (event: React.ClipboardEvent) => void;
  isFullscreen: boolean;
  isCanvasOpen: boolean;
  isThemeWorkbenchVariant: boolean;
  activeTheme?: string;
  onManageProviders?: () => void;
  executionRuntime?: AsterSessionExecutionRuntime | null;
  isExecutionRuntimeActive?: boolean;
  setExecutionStrategy?: (
    strategy: "react" | "code_orchestrated" | "auto",
  ) => void;
  topExtra?: React.ReactNode;
  queuedTurns: QueuedTurnSnapshot[];
  onPromoteQueuedTurn?: (queuedTurnId: string) => void | Promise<boolean>;
  onRemoveQueuedTurn?: (queuedTurnId: string) => void | Promise<boolean>;
}

export const InputbarComposerSection: React.FC<
  InputbarComposerSectionProps
> = ({
  renderThemeWorkbenchGeneratingPanel,
  themeWorkbenchGate,
  themeWorkbenchQuickActions,
  themeWorkbenchQueueItems,
  inputAdapter,
  characters,
  skills,
  serviceSkills = [],
  isSkillsLoading,
  textareaRef,
  input,
  activeSkill,
  onSelectCharacter,
  onSelectSkill,
  onSelectServiceSkill,
  onSelectBuiltinCommand,
  onClearSkill,
  onNavigateToSettings,
  onImportSkill,
  onRefreshSkills,
  selectedTeam,
  onSelectTeam,
  teamWorkspaceSettings,
  onPersistCustomTeams,
  workspaceId,
  providerType,
  model,
  onSend,
  onToolClick,
  activeTools,
  executionStrategy,
  pendingImages,
  onRemoveImage,
  onPaste,
  isFullscreen,
  isCanvasOpen,
  isThemeWorkbenchVariant,
  activeTheme,
  onManageProviders,
  executionRuntime,
  isExecutionRuntimeActive,
  setExecutionStrategy,
  topExtra,
  queuedTurns,
  onPromoteQueuedTurn,
  onRemoveQueuedTurn,
}) => {
  const [teamSelectorAutoOpenToken, setTeamSelectorAutoOpenToken] = useState<
    number | null
  >(null);
  const showSkillSelector =
    !isThemeWorkbenchVariant && isGeneralResearchTheme(activeTheme);
  const currentPendingImages =
    (inputAdapter.state.attachments as MessageImage[] | undefined) ||
    pendingImages;
  const resolvedProviderType = inputAdapter.model?.providerType;
  const resolvedModel = inputAdapter.model?.model;
  const shouldShowStableNotice =
    !isThemeWorkbenchVariant &&
    shouldShowStableProcessingNotice({
      providerType: resolvedProviderType,
      model: resolvedModel,
    });
  const shouldShowVisionNotice =
    currentPendingImages.length > 0 &&
    Boolean(resolvedProviderType?.trim()) &&
    Boolean(resolvedModel?.trim());
  const resolvedTopExtra =
    topExtra || shouldShowStableNotice || shouldShowVisionNotice ? (
      <>
        {topExtra}
        {shouldShowStableNotice ? (
          <StableProcessingNotice
            providerType={resolvedProviderType}
            model={resolvedModel}
            scope={activeTools["subagent_mode"] ? "team" : "request"}
            className="mx-3 mb-2"
            testId="inputbar-stable-processing-notice"
          />
        ) : null}
        {shouldShowVisionNotice ? (
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

  if (renderThemeWorkbenchGeneratingPanel) {
    return (
      <ThemeWorkbenchStatusPanel
        gate={themeWorkbenchGate}
        quickActions={themeWorkbenchQuickActions}
        queueItems={themeWorkbenchQueueItems}
        renderGeneratingPanel
        onQuickAction={inputAdapter.actions.setText}
        onStop={inputAdapter.actions.stop}
      />
    );
  }

  return (
    <>
      <ThemeWorkbenchStatusPanel
        gate={themeWorkbenchGate}
        quickActions={themeWorkbenchQuickActions}
        queueItems={themeWorkbenchQueueItems}
        renderGeneratingPanel={false}
        onQuickAction={inputAdapter.actions.setText}
        onStop={inputAdapter.actions.stop}
      />
      <CharacterMention
        characters={characters}
        skills={skills}
        serviceSkills={serviceSkills}
        inputRef={textareaRef}
        value={input}
        onChange={inputAdapter.actions.setText}
        onSelectCharacter={onSelectCharacter}
        onSelectSkill={onSelectSkill}
        onSelectServiceSkill={onSelectServiceSkill}
        onSelectBuiltinCommand={onSelectBuiltinCommand}
        onNavigateToSettings={onNavigateToSettings}
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
        executionStrategy={executionStrategy}
        showExecutionStrategy={false}
        pendingImages={
          currentPendingImages
        }
        onRemoveImage={onRemoveImage}
        onPaste={onPaste}
        isFullscreen={isFullscreen}
        isCanvasOpen={isCanvasOpen}
        placeholder={
          isThemeWorkbenchVariant
            ? themeWorkbenchGate?.status === "waiting"
              ? "说说你的选择，剩下的交给我"
              : "试着输入任何指令，剩下的交给我"
            : undefined
        }
        toolMode={isThemeWorkbenchVariant ? "attach-only" : "default"}
        showTranslate={!isThemeWorkbenchVariant}
        showDragHandle={!isThemeWorkbenchVariant}
        visualVariant={isThemeWorkbenchVariant ? "floating" : "default"}
        topExtra={resolvedTopExtra}
        activeTheme={activeTheme}
        queuedTurns={queuedTurns}
        onPromoteQueuedTurn={onPromoteQueuedTurn}
        onRemoveQueuedTurn={onRemoveQueuedTurn}
        leftExtra={
          <>
            {showSkillSelector ? (
              <SkillSelector
                skills={skills}
                activeSkill={activeSkill}
                isLoading={isSkillsLoading}
                onSelectSkill={onSelectSkill}
                onClearSkill={onClearSkill}
                onNavigateToSettings={onNavigateToSettings}
                onImportSkill={onImportSkill}
                onRefreshSkills={onRefreshSkills}
              />
            ) : null}
            {isGeneralResearchTheme(activeTheme) ? (
              activeTools["subagent_mode"] ? (
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
              ) : null
            ) : null}
            <InputbarModelExtra
              isFullscreen={isFullscreen}
              isThemeWorkbenchVariant={isThemeWorkbenchVariant}
              providerType={inputAdapter.model?.providerType}
              setProviderType={inputAdapter.actions.setProviderType}
              model={inputAdapter.model?.model}
              setModel={inputAdapter.actions.setModel}
              activeTheme={activeTheme}
              onManageProviders={onManageProviders}
              executionRuntime={executionRuntime}
              isExecutionRuntimeActive={isExecutionRuntimeActive}
            />
          </>
        }
        rightExtra={
          <InputbarExecutionStrategySelect
            isFullscreen={isFullscreen}
            isThemeWorkbenchVariant={isThemeWorkbenchVariant}
            executionStrategy={executionStrategy}
            setExecutionStrategy={setExecutionStrategy}
          />
        }
      />
    </>
  );
};
