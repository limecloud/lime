import React, { useMemo, useRef, useState } from "react";
import { BuiltinCommandBadge } from "../components/BuiltinCommandBadge";
import { SkillBadge } from "../../../skill-selection/SkillBadge";
import { useActiveSkill } from "../../../skill-selection/useActiveSkill";
import { useHintRoutes } from "./useHintRoutes";
import { useImageAttachments } from "./useImageAttachments";
import { useInputbarAdapter } from "./useInputbarAdapter";
import { useInputbarSend } from "./useInputbarSend";
import {
  useInputbarToolState,
  type InputbarToolStates,
} from "./useInputbarToolState";
import type { SkillSelectionSourceProps } from "../../../skill-selection/skillSelectionBindings";
import type {
  ThemeWorkbenchGateState,
  ThemeWorkbenchWorkflowStep,
} from "../../../utils/themeWorkbenchInputState";
import { useThemeWorkbenchInputState } from "../../../utils/themeWorkbenchInputState";
import { TeamSuggestionBar } from "@/components/agent/chat/components/TeamSuggestionBar";
import { getTeamSuggestion } from "@/components/agent/chat/utils/teamSuggestion";
import type { MessageImage } from "../../../types";
import type { BuiltinInputCommand } from "../../../skill-selection/builtinCommands";

interface UseInputbarControllerParams {
  input: string;
  setInput: (value: string) => void;
  onSend: (
    images?: MessageImage[],
    webSearch?: boolean,
    thinking?: boolean,
    textOverride?: string,
    executionStrategy?: "react" | "code_orchestrated" | "auto",
  ) => void | Promise<boolean> | boolean;
  onStop?: () => void;
  isLoading: boolean;
  disabled?: boolean;
  providerType?: string;
  setProviderType?: (type: string) => void;
  model?: string;
  setModel?: (model: string) => void;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  toolStates?: Partial<InputbarToolStates>;
  onToolStatesChange?: (states: InputbarToolStates) => void;
  activeTheme?: string;
  variant?: "default" | "theme_workbench";
  themeWorkbenchGate?: ThemeWorkbenchGateState | null;
  workflowSteps?: ThemeWorkbenchWorkflowStep[];
  themeWorkbenchRunState?: "idle" | "auto_running" | "await_user_decision";
  onEnableSuggestedTeam?: (suggestedPresetId?: string) => void;
}

export function useInputbarController({
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
  variant = "default",
  themeWorkbenchGate,
  workflowSteps = [],
  themeWorkbenchRunState,
  onEnableSuggestedTeam,
  skills,
  serviceSkills,
  isSkillsLoading,
  onSelectServiceSkill,
  onNavigateToSettings,
  onImportSkill,
  onRefreshSkills,
}: UseInputbarControllerParams & SkillSelectionSourceProps) {
  const { activeSkill, clearActiveSkill, buildSkillSelection } =
    useActiveSkill();
  const [activeBuiltinCommand, setActiveBuiltinCommand] =
    useState<BuiltinInputCommand | null>(null);
  const {
    pendingImages,
    fileInputRef,
    handleFileSelect,
    handlePaste,
    handleDragOver,
    handleDrop,
    handleRemoveImage,
    clearPendingImages,
    openFileDialog,
  } = useImageAttachments();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isThemeWorkbenchVariant = variant === "theme_workbench";

  const {
    activeTools,
    handleToolClick,
    setSubagentEnabled,
    isFullscreen,
    thinkingEnabled,
    subagentEnabled,
    webSearchEnabled,
  } = useInputbarToolState({
    toolStates,
    onToolStatesChange,
    openFileDialog,
  });

  const {
    showHintPopup,
    hintRoutes,
    hintIndex,
    handleSetInput,
    handleHintSelect,
    handleHintKeyDown,
  } = useHintRoutes({
    setInput,
    textareaRef,
  });

  const handleSend = useInputbarSend({
    input,
    pendingImages,
    webSearchEnabled,
    thinkingEnabled,
    executionStrategy,
    activeSkill,
    activeBuiltinCommand,
    onSend,
    clearPendingImages,
    clearActiveSkill,
    clearActiveBuiltinCommand: () => setActiveBuiltinCommand(null),
  });

  const inputAdapter = useInputbarAdapter({
    input,
    setInput: handleSetInput,
    isLoading,
    disabled,
    providerType,
    setProviderType,
    model,
    setModel,
    handleSend,
    onStop,
    pendingImages,
  });

  const {
    themeWorkbenchQuickActions,
    themeWorkbenchQueueItems,
    renderThemeWorkbenchGeneratingPanel,
  } = useThemeWorkbenchInputState({
    isThemeWorkbenchVariant,
    themeWorkbenchGate,
    workflowSteps,
    themeWorkbenchRunState,
    isSending: inputAdapter.state.isSending,
  });

  const [dismissedTeamSuggestionKey, setDismissedTeamSuggestionKey] = useState<
    string | null
  >(null);
  const teamSuggestionKey = `${activeTheme ?? "default"}:${input
    .trim()
    .toLowerCase()}`;
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
    activeTheme === "general" &&
    teamSuggestion.shouldSuggest &&
    dismissedTeamSuggestionKey !== teamSuggestionKey;

  const topExtra =
    activeSkill || activeBuiltinCommand || shouldShowTeamSuggestion
      ? React.createElement(
          React.Fragment,
          null,
          activeBuiltinCommand
            ? React.createElement(BuiltinCommandBadge, {
                command: activeBuiltinCommand,
                onClear: () => setActiveBuiltinCommand(null),
              })
            : null,
          activeSkill
            ? React.createElement(SkillBadge, {
                skill: activeSkill,
                onClear: clearActiveSkill,
              })
            : null,
          shouldShowTeamSuggestion
            ? React.createElement(TeamSuggestionBar, {
                compact: true,
                score: teamSuggestion.score,
                reasons: teamSuggestion.reasons,
                suggestedRoles: teamSuggestion.suggestedRoles,
                suggestedPresetLabel: teamSuggestion.suggestedPresetLabel,
                onEnableTeam: () => {
                  setSubagentEnabled(true);
                  onEnableSuggestedTeam?.(teamSuggestion.suggestedPresetId);
                  setDismissedTeamSuggestionKey(teamSuggestionKey);
                },
                onContinueSingleAgent: () => {
                  setDismissedTeamSuggestionKey(teamSuggestionKey);
                },
              })
            : null,
        )
      : undefined;
  const skillSelection = buildSkillSelection({
    skills,
    serviceSkills,
    isSkillsLoading,
    onSelectServiceSkill,
    onNavigateToSettings,
    onImportSkill,
    onRefreshSkills,
  });

  return {
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
    skillSelection,
    setActiveBuiltinCommand: (command: BuiltinInputCommand | null) => {
      if (command) {
        clearActiveSkill();
      }
      setActiveBuiltinCommand(command);
    },
  };
}
