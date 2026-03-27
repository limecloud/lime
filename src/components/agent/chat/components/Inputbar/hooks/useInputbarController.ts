import React, { useMemo, useRef, useState } from "react";
import type { A2UISubmissionNoticeData } from "../components/A2UISubmissionNotice";
import { BuiltinCommandBadge } from "../components/BuiltinCommandBadge";
import { SkillBadge } from "../components/SkillBadge";
import { useActiveSkill } from "./useActiveSkill";
import { useHintRoutes } from "./useHintRoutes";
import { useImageAttachments } from "./useImageAttachments";
import { useInputbarAdapter } from "./useInputbarAdapter";
import { useInputbarDisplayState } from "./useInputbarDisplayState";
import { useInputbarSend } from "./useInputbarSend";
import { useStickyA2UIForm } from "./useStickyA2UIForm";
import {
  useInputbarToolState,
  type InputbarToolStates,
} from "./useInputbarToolState";
import type {
  ThemeWorkbenchGateState,
  ThemeWorkbenchWorkflowStep,
} from "./useThemeWorkbenchInputState";
import { TeamSuggestionBar } from "@/components/agent/chat/components/TeamSuggestionBar";
import type { A2UIResponse } from "@/components/content-creator/a2ui/types";
import { getTeamSuggestion } from "@/components/agent/chat/utils/teamSuggestion";
import type { MessageImage } from "../../../types";
import type { BuiltinInputCommand } from "../components/builtinCommands";

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
  onClearMessages?: () => void;
  onToggleCanvas?: () => void;
  providerType?: string;
  setProviderType?: (type: string) => void;
  model?: string;
  setModel?: (model: string) => void;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  setExecutionStrategy?: (
    strategy: "react" | "code_orchestrated" | "auto",
  ) => void;
  toolStates?: Partial<InputbarToolStates>;
  onToolStatesChange?: (states: InputbarToolStates) => void;
  activeTheme?: string;
  variant?: "default" | "theme_workbench";
  themeWorkbenchGate?: ThemeWorkbenchGateState | null;
  workflowSteps?: ThemeWorkbenchWorkflowStep[];
  themeWorkbenchRunState?: "idle" | "auto_running" | "await_user_decision";
  pendingA2UIForm?: A2UIResponse | null;
  a2uiSubmissionNotice?: A2UISubmissionNoticeData | null;
  onEnableSuggestedTeam?: (suggestedPresetId?: string) => void;
}

export function useInputbarController({
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
  variant = "default",
  themeWorkbenchGate,
  workflowSteps = [],
  themeWorkbenchRunState,
  pendingA2UIForm,
  a2uiSubmissionNotice,
  onEnableSuggestedTeam,
}: UseInputbarControllerParams) {
  const { activeSkill, setActiveSkill, clearActiveSkill } = useActiveSkill();
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
    taskEnabled,
    subagentEnabled,
    webSearchEnabled,
  } = useInputbarToolState({
    toolStates,
    onToolStatesChange,
    executionStrategy,
    setExecutionStrategy,
    setInput,
    onClearMessages,
    onToggleCanvas,
    clearPendingImages,
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
    activeTools,
    activeSkill,
    activeBuiltinCommand,
    activeTheme,
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
    setExecutionStrategy,
  });

  const {
    themeWorkbenchQuickActions,
    themeWorkbenchQueueItems,
    renderThemeWorkbenchGeneratingPanel,
    visibleA2UISubmissionNotice,
    isA2UISubmissionNoticeVisible,
  } = useInputbarDisplayState({
    isThemeWorkbenchVariant,
    themeWorkbenchGate,
    workflowSteps,
    themeWorkbenchRunState,
    isSending: inputAdapter.state.isSending,
    pendingA2UIForm: Boolean(pendingA2UIForm),
    a2uiSubmissionNotice,
  });

  const { visibleForm: visiblePendingA2UIForm } = useStickyA2UIForm({
    form: pendingA2UIForm,
    clearImmediately: Boolean(a2uiSubmissionNotice),
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
    taskEnabled,
    subagentEnabled,
    thinkingEnabled,
    webSearchEnabled,
    themeWorkbenchQuickActions,
    themeWorkbenchQueueItems,
    renderThemeWorkbenchGeneratingPanel,
    visiblePendingA2UIForm,
    visibleA2UISubmissionNotice,
    isA2UISubmissionNoticeVisible,
    activeSkill,
    setActiveSkill: (skill: Parameters<typeof setActiveSkill>[0]) => {
      setActiveBuiltinCommand(null);
      setActiveSkill(skill);
    },
    clearActiveSkill,
    activeBuiltinCommand,
    setActiveBuiltinCommand: (command: BuiltinInputCommand | null) => {
      if (command) {
        clearActiveSkill();
      }
      setActiveBuiltinCommand(command);
    },
    clearActiveBuiltinCommand: () => setActiveBuiltinCommand(null),
  };
}
