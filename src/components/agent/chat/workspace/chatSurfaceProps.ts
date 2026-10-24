import type { ComposerDraftCoordinator } from "@/components/input-kit/ComposerDraftCoordinator";
import type { ComponentProps } from "react";
import type { ComposerController } from "@/components/input-kit/ComposerController";
import { StepProgress } from "@/components/workspace/layout/StepProgress";
import { ChatNavbar } from "../components/ChatNavbar";
import { EmptyState } from "../components/EmptyState";
import type { InputbarSendHandler } from "../components/Inputbar/inputbarSendPayload";

type ChatToolPreferences = {
  task: boolean;
  subagent: boolean;
};

type ChatToolPreferenceKey = keyof ChatToolPreferences;

interface BuildStepProgressPropsParams {
  hidden: boolean;
  isSpecializedThemeMode: boolean;
  hasMessages: boolean;
  steps: ComponentProps<typeof StepProgress>["steps"];
  currentIndex: ComponentProps<typeof StepProgress>["currentIndex"];
  onStepClick: NonNullable<ComponentProps<typeof StepProgress>["onStepClick"]>;
}

export function buildStepProgressProps({
  hidden,
  isSpecializedThemeMode,
  hasMessages,
  steps,
  currentIndex,
  onStepClick,
}: BuildStepProgressPropsParams): ComponentProps<typeof StepProgress> | null {
  if (hidden || !isSpecializedThemeMode || !hasMessages || steps.length === 0) {
    return null;
  }

  return {
    steps,
    currentIndex,
    onStepClick,
  };
}

interface BuildWorkspaceEmptyStatePropsParams {
  input: ComponentProps<typeof EmptyState>["input"];
  composerController?: ComposerController;
  composerDraftCoordinator?: ComposerDraftCoordinator;
  onComposerDraftAccepted?: ComponentProps<
    typeof EmptyState
  >["onComposerDraftAccepted"];
  setInput: ComponentProps<typeof EmptyState>["setInput"];
  onSendMessage: InputbarSendHandler;
  onStopSending?: ComponentProps<typeof EmptyState>["onStop"];
  sendOnPointerDown?: ComponentProps<typeof EmptyState>["sendOnPointerDown"];
  isLoading: ComponentProps<typeof EmptyState>["isLoading"];
  disabled: ComponentProps<typeof EmptyState>["disabled"];
  providerType: ComponentProps<typeof EmptyState>["providerType"];
  setProviderType: ComponentProps<typeof EmptyState>["setProviderType"];
  model: ComponentProps<typeof EmptyState>["model"];
  setModel: ComponentProps<typeof EmptyState>["setModel"];
  reasoningEffort?: ComponentProps<typeof EmptyState>["reasoningEffort"];
  setReasoningEffort?: ComponentProps<typeof EmptyState>["setReasoningEffort"];
  accessMode: ComponentProps<typeof EmptyState>["accessMode"];
  setAccessMode: ComponentProps<typeof EmptyState>["setAccessMode"];
  onManageProviders?: ComponentProps<typeof EmptyState>["onManageProviders"];
  toolPreferences: ChatToolPreferences;
  onToolPreferenceChange: (
    key: ChatToolPreferenceKey,
    enabled: boolean,
  ) => void;
  objectiveEnabled?: ComponentProps<typeof EmptyState>["objectiveEnabled"];
  onObjectiveEnabledChange?: ComponentProps<
    typeof EmptyState
  >["onObjectiveEnabledChange"];
  activeTheme: ComponentProps<typeof EmptyState>["activeTheme"];
  skills: NonNullable<ComponentProps<typeof EmptyState>["skills"]>;
  isSkillsLoading: boolean;
  onSkillSuggestionsNeeded?: ComponentProps<
    typeof EmptyState
  >["onSkillSuggestionsNeeded"];
  projectId: string | null;
  openedProjects?: ComponentProps<typeof EmptyState>["openedProjects"];
  sessionId?: string | null;
  onProjectChange?: ComponentProps<typeof EmptyState>["onProjectContextChange"];
  pluginSuggestions?: ComponentProps<typeof EmptyState>["pluginSuggestions"];
  pluginSuggestionsError?: ComponentProps<
    typeof EmptyState
  >["pluginSuggestionsError"];
  pluginSuggestionsLoading?: ComponentProps<
    typeof EmptyState
  >["pluginSuggestionsLoading"];
  onPluginSuggestionsNeeded?: ComponentProps<
    typeof EmptyState
  >["onPluginSuggestionsNeeded"];
  initialInputCapability?: ComponentProps<
    typeof EmptyState
  >["initialInputCapability"];
  pathReferences?: ComponentProps<typeof EmptyState>["pathReferences"];
  onAddPathReferences?: ComponentProps<
    typeof EmptyState
  >["onAddPathReferences"];
  inputRestoreRequest?: ComponentProps<
    typeof EmptyState
  >["inputRestoreRequest"];
  onInputRestoreRequestHandled?: ComponentProps<
    typeof EmptyState
  >["onInputRestoreRequestHandled"];
  onRemovePathReference?: ComponentProps<
    typeof EmptyState
  >["onRemovePathReference"];
  onClearPathReferences?: ComponentProps<
    typeof EmptyState
  >["onClearPathReferences"];
}

export function buildWorkspaceEmptyStateProps({
  input,
  composerController,
  composerDraftCoordinator,
  onComposerDraftAccepted,
  setInput,
  onSendMessage,
  onStopSending,
  sendOnPointerDown,
  isLoading,
  disabled,
  providerType,
  setProviderType,
  model,
  setModel,
  reasoningEffort,
  setReasoningEffort,
  accessMode,
  setAccessMode,
  onManageProviders,
  toolPreferences,
  onToolPreferenceChange,
  objectiveEnabled,
  onObjectiveEnabledChange,
  activeTheme,
  skills,
  isSkillsLoading,
  onSkillSuggestionsNeeded,
  projectId,
  openedProjects,
  onProjectChange,
  sessionId,
  pluginSuggestions,
  pluginSuggestionsError,
  pluginSuggestionsLoading,
  onPluginSuggestionsNeeded,
  initialInputCapability,
  pathReferences,
  onAddPathReferences,
  inputRestoreRequest,
  onInputRestoreRequestHandled,
  onRemovePathReference,
  onClearPathReferences,
}: BuildWorkspaceEmptyStatePropsParams): ComponentProps<typeof EmptyState> {
  const handleEmptyStateSend: InputbarSendHandler = (payload = {}) =>
    onSendMessage({
      ...payload,
      textOverride: payload.textOverride ?? input,
    });

  return {
    input,
    composerController,
    composerDraftCoordinator,
    onComposerDraftAccepted,
    setInput,
    onSend: handleEmptyStateSend,
    onStop: onStopSending,
    sendOnPointerDown,
    isLoading,
    disabled,
    providerType,
    setProviderType,
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    accessMode,
    setAccessMode,
    onManageProviders,
    taskEnabled: toolPreferences.task,
    onTaskEnabledChange: (enabled) => onToolPreferenceChange("task", enabled),
    objectiveEnabled,
    onObjectiveEnabledChange,
    subagentEnabled: toolPreferences.subagent,
    onSubagentEnabledChange: (enabled) =>
      onToolPreferenceChange("subagent", enabled),
    activeTheme,
    skills,
    isSkillsLoading,
    onSkillSuggestionsNeeded,
    projectId,
    openedProjects,
    onProjectContextChange: onProjectChange,
    sessionId,
    pluginSuggestions,
    pluginSuggestionsError,
    pluginSuggestionsLoading,
    onPluginSuggestionsNeeded,
    initialInputCapability,
    pathReferences,
    onAddPathReferences,
    inputRestoreRequest,
    onInputRestoreRequestHandled,
    onRemovePathReference,
    onClearPathReferences,
  };
}

interface BuildWorkspaceNavbarPropsParams {
  visible: boolean;
  isRunning: boolean;
  chrome: ComponentProps<typeof ChatNavbar>["chrome"];
  collapseChrome?: boolean;
  navbarContextVariant?: "default" | "task-center";
  collapseEntryContext?: boolean;
  onBackToProjectManagement?: ComponentProps<
    typeof ChatNavbar
  >["onBackToProjectManagement"];
  showCanvasToggle: boolean;
  isCanvasOpen: boolean;
  onToggleCanvas?: ComponentProps<typeof ChatNavbar>["onToggleCanvas"];
  projectId: string | null;
  threadId?: string | null;
  workspaceRootPath?: string | null;
  openedProjects?: ComponentProps<typeof ChatNavbar>["openedProjects"];
  onProjectChange?: ComponentProps<typeof ChatNavbar>["onProjectChange"];
  onCloseProject?: ComponentProps<typeof ChatNavbar>["onCloseProject"];
  workspaceType?: ComponentProps<typeof ChatNavbar>["workspaceType"];
  deferWorkspaceListLoad?: ComponentProps<
    typeof ChatNavbar
  >["deferWorkspaceListLoad"];
  onBackHome?: ComponentProps<typeof ChatNavbar>["onBackHome"];
  showHarnessToggle: boolean;
  harnessPanelVisible: boolean;
  onToggleHarnessPanel?: ComponentProps<
    typeof ChatNavbar
  >["onToggleHarnessPanel"];
  harnessPendingCount: number;
  harnessAttentionLevel: ComponentProps<
    typeof ChatNavbar
  >["harnessAttentionLevel"];
  harnessToggleLabel?: ComponentProps<typeof ChatNavbar>["harnessToggleLabel"];
  showContextCompactionAction?: ComponentProps<
    typeof ChatNavbar
  >["showContextCompactionAction"];
  contextCompactionRunning?: ComponentProps<
    typeof ChatNavbar
  >["contextCompactionRunning"];
  onCompactContext?: ComponentProps<typeof ChatNavbar>["onCompactContext"];
  onOpenSettings?: () => void;
}

export function buildWorkspaceNavbarProps({
  visible,
  isRunning,
  chrome,
  collapseChrome = false,
  navbarContextVariant = "default",
  collapseEntryContext = false,
  onBackToProjectManagement,
  showCanvasToggle,
  isCanvasOpen,
  onToggleCanvas,
  projectId,
  threadId,
  workspaceRootPath,
  openedProjects,
  onProjectChange,
  onCloseProject,
  workspaceType,
  deferWorkspaceListLoad,
  onBackHome,
  showHarnessToggle,
  harnessPanelVisible,
  onToggleHarnessPanel,
  harnessPendingCount,
  harnessAttentionLevel,
  harnessToggleLabel,
  showContextCompactionAction,
  contextCompactionRunning,
  onCompactContext,
  onOpenSettings,
}: BuildWorkspaceNavbarPropsParams): ComponentProps<typeof ChatNavbar> | null {
  if (!visible) {
    return null;
  }

  return {
    isRunning,
    chrome,
    collapseChrome,
    contextVariant:
      navbarContextVariant === "task-center" && !collapseEntryContext
        ? "task-center"
        : "default",
    onToggleFullscreen: () => undefined,
    onBackToProjectManagement,
    showCanvasToggle,
    isCanvasOpen,
    onToggleCanvas,
    projectId,
    threadId,
    workspaceRootPath,
    openedProjects,
    onProjectChange,
    onCloseProject,
    workspaceType,
    deferWorkspaceListLoad,
    onBackHome,
    showHarnessToggle,
    harnessPanelVisible,
    onToggleHarnessPanel,
    harnessPendingCount,
    harnessAttentionLevel,
    harnessToggleLabel,
    showContextCompactionAction,
    contextCompactionRunning,
    onCompactContext,
    onToggleSettings: onOpenSettings,
  };
}
