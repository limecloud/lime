import React, { useState } from "react";
import type { ChatInputAdapter } from "@/components/input-kit/adapters/types";
import type { Character } from "@/lib/api/memory";
import type {
  AsterSessionExecutionRuntime,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type { MessageImage } from "../../../types";
import { CharacterMention } from "../../../skill-selection/CharacterMention";
import { InputbarCore } from "./InputbarCore";
import { SkillSelector } from "../../../skill-selection/SkillSelector";
import type { BuiltinInputCommand } from "../../../skill-selection/builtinCommands";
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
import type { AgentAccessMode } from "../../../hooks/agentChatStorage";
import type {
  WorkflowGateState,
  WorkflowQuickAction,
  WorkflowStep,
} from "../../../utils/workflowInputState";

interface InputbarComposerSectionProps {
  renderWorkflowGeneratingPanel: boolean;
  workflowGate?: WorkflowGateState | null;
  workflowQuickActions: WorkflowQuickAction[];
  workflowQueueItems: WorkflowStep[];
  inputAdapter: ChatInputAdapter;
  characters: Character[];
  skillSelection: SkillSelectionProps;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  input: string;
  onSelectCharacter?: (character: Character) => void;
  onSelectBuiltinCommand: (command: BuiltinInputCommand | null) => void;
  selectedTeam?: TeamDefinition | null;
  onSelectTeam?: (team: TeamDefinition | null) => void;
  teamWorkspaceSettings?: WorkspaceSettings | null;
  onPersistCustomTeams?: (teams: TeamDefinition[]) => void | Promise<void>;
  onSend: () => void;
  onToolClick: (tool: string) => void;
  activeTools: Record<string, boolean>;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  pendingImages: MessageImage[];
  onRemoveImage: (index: number) => void;
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
}

export const InputbarComposerSection: React.FC<
  InputbarComposerSectionProps
> = ({
  renderWorkflowGeneratingPanel,
  workflowGate,
  workflowQuickActions,
  workflowQueueItems,
  inputAdapter,
  characters,
  skillSelection,
  textareaRef,
  input,
  onSelectCharacter,
  onSelectBuiltinCommand,
  selectedTeam,
  onSelectTeam,
  teamWorkspaceSettings,
  onPersistCustomTeams,
  onSend,
  onToolClick,
  activeTools,
  executionStrategy,
  pendingImages,
  onRemoveImage,
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
}) => {
  const [teamSelectorAutoOpenToken, setTeamSelectorAutoOpenToken] = useState<
    number | null
  >(null);
  const showSkillSelector =
    !isWorkspaceVariant && isGeneralResearchTheme(activeTheme);
  const currentPendingImages =
    (inputAdapter.state.attachments as MessageImage[] | undefined) ||
    pendingImages;
  const { mentionProps: mentionSkillProps, selectorProps: skillSelectorProps } =
    buildSkillSelectionBindings(skillSelection);
  const resolvedProviderType = inputAdapter.model?.providerType;
  const resolvedModel = inputAdapter.model?.model;
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

  if (renderWorkflowGeneratingPanel) {
    return (
      <InputbarWorkflowStatusPanel
        gate={workflowGate}
        quickActions={workflowQuickActions}
        queueItems={workflowQueueItems}
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
        onSelectBuiltinCommand={onSelectBuiltinCommand}
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
        onPaste={onPaste}
        isFullscreen={isFullscreen}
        placeholder={
          isWorkspaceVariant
            ? workflowGate?.status === "waiting"
              ? "说说你的选择，剩下的交给我"
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
        leftExtra={
          <>
            {showSkillSelector ? (
              <SkillSelector {...skillSelectorProps} />
            ) : null}
            {isGeneralResearchTheme(activeTheme) ? (
              activeTools["subagent_mode"] ? (
                <TeamSelector
                  activeTheme={activeTheme}
                  input={input}
                  autoOpenToken={teamSelectorAutoOpenToken}
                  selectedTeam={selectedTeam}
                  workspaceSettings={teamWorkspaceSettings}
                  onPersistCustomTeams={onPersistCustomTeams}
                  onSelectTeam={(team) => onSelectTeam?.(team)}
                />
              ) : null
            ) : null}
            <InputbarExecutionStrategySelect
              isFullscreen={isFullscreen}
              executionStrategy={executionStrategy}
              setExecutionStrategy={setExecutionStrategy}
            />
            {!isWorkspaceVariant ? (
              <InputbarModelExtra
                isFullscreen={isFullscreen}
                providerType={inputAdapter.model?.providerType}
                setProviderType={resolvedSetProviderType}
                model={inputAdapter.model?.model}
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
        }
      />
    </>
  );
};
