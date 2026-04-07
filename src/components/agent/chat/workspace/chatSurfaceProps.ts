import type { ComponentProps } from "react";
import { StepProgress } from "@/lib/workspace/workbenchUi";
import { ChatNavbar } from "../components/ChatNavbar";
import { ChatSidebar } from "../components/ChatSidebar";
import { EmptyState } from "../components/EmptyState";
import { TeamWorkspaceDock } from "../components/TeamWorkspaceDock";
import type { TeamWorkbenchSurfaceProps } from "./teamWorkbenchPresentation";

type ChatToolPreferences = {
  webSearch: boolean;
  thinking: boolean;
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

interface BuildTeamWorkspaceDockPropsParams {
  enabled: boolean;
  shouldShowFloatingInputOverlay: boolean;
  layoutMode: "chat" | "chat-canvas";
  onActivateWorkbench: NonNullable<
    ComponentProps<typeof TeamWorkspaceDock>["onActivateWorkbench"]
  >;
  withBottomOverlay: boolean;
  surfaceProps: TeamWorkbenchSurfaceProps;
}

export function buildTeamWorkspaceDockProps({
  enabled,
  shouldShowFloatingInputOverlay,
  layoutMode,
  onActivateWorkbench,
  withBottomOverlay,
  surfaceProps,
}: BuildTeamWorkspaceDockPropsParams): ComponentProps<
  typeof TeamWorkspaceDock
> | null {
  if (!enabled || shouldShowFloatingInputOverlay || layoutMode !== "chat") {
    return null;
  }

  return {
    onActivateWorkbench,
    withBottomOverlay,
    ...surfaceProps,
  };
}

interface BuildWorkspaceEmptyStatePropsParams {
  input: ComponentProps<typeof EmptyState>["input"];
  setInput: ComponentProps<typeof EmptyState>["setInput"];
  onSendMessage: ComponentProps<typeof EmptyState>["onSend"];
  isLoading: ComponentProps<typeof EmptyState>["isLoading"];
  disabled: ComponentProps<typeof EmptyState>["disabled"];
  providerType: ComponentProps<typeof EmptyState>["providerType"];
  setProviderType: ComponentProps<typeof EmptyState>["setProviderType"];
  model: ComponentProps<typeof EmptyState>["model"];
  setModel: ComponentProps<typeof EmptyState>["setModel"];
  executionStrategy: ComponentProps<typeof EmptyState>["executionStrategy"];
  setExecutionStrategy: ComponentProps<
    typeof EmptyState
  >["setExecutionStrategy"];
  accessMode: ComponentProps<typeof EmptyState>["accessMode"];
  setAccessMode: ComponentProps<typeof EmptyState>["setAccessMode"];
  onManageProviders?: ComponentProps<typeof EmptyState>["onManageProviders"];
  toolPreferences: ChatToolPreferences;
  onToolPreferenceChange: (
    key: ChatToolPreferenceKey,
    enabled: boolean,
  ) => void;
  selectedTeam: ComponentProps<typeof EmptyState>["selectedTeam"];
  onSelectTeam?: ComponentProps<typeof EmptyState>["onSelectTeam"];
  onEnableSuggestedTeam?: ComponentProps<
    typeof EmptyState
  >["onEnableSuggestedTeam"];
  creationMode: ComponentProps<typeof EmptyState>["creationMode"];
  onCreationModeChange?: ComponentProps<
    typeof EmptyState
  >["onCreationModeChange"];
  activeTheme: ComponentProps<typeof EmptyState>["activeTheme"];
  onThemeChange?: NonNullable<
    ComponentProps<typeof EmptyState>["onThemeChange"]
  >;
  themeLocked: boolean;
  hasCanvasContent: boolean;
  hasContentId: boolean;
  selectedText: ComponentProps<typeof EmptyState>["selectedText"];
  onRecommendationClick?: ComponentProps<
    typeof EmptyState
  >["onRecommendationClick"];
  characters: NonNullable<ComponentProps<typeof EmptyState>["characters"]>;
  skills: NonNullable<ComponentProps<typeof EmptyState>["skills"]>;
  isSkillsLoading: boolean;
  onNavigateToSettings?: ComponentProps<
    typeof EmptyState
  >["onNavigateToSettings"];
  onRefreshSkills?: ComponentProps<typeof EmptyState>["onRefreshSkills"];
  onLaunchBrowserAssist?: ComponentProps<
    typeof EmptyState
  >["onLaunchBrowserAssist"];
  browserAssistLoading: boolean;
  projectId: string | null;
  onProjectChange?: ComponentProps<typeof EmptyState>["onProjectChange"];
  onOpenSettings?: ComponentProps<typeof EmptyState>["onOpenSettings"];
}

export function buildWorkspaceEmptyStateProps({
  input,
  setInput,
  onSendMessage,
  isLoading,
  disabled,
  providerType,
  setProviderType,
  model,
  setModel,
  executionStrategy,
  setExecutionStrategy,
  accessMode,
  setAccessMode,
  onManageProviders,
  toolPreferences,
  onToolPreferenceChange,
  selectedTeam,
  onSelectTeam,
  onEnableSuggestedTeam,
  creationMode,
  onCreationModeChange,
  activeTheme,
  onThemeChange,
  themeLocked,
  hasCanvasContent,
  hasContentId,
  selectedText,
  onRecommendationClick,
  characters,
  skills,
  isSkillsLoading,
  onNavigateToSettings,
  onRefreshSkills,
  onLaunchBrowserAssist,
  browserAssistLoading,
  projectId,
  onProjectChange,
  onOpenSettings,
}: BuildWorkspaceEmptyStatePropsParams): ComponentProps<typeof EmptyState> {
  return {
    input,
    setInput,
    onSend: onSendMessage,
    isLoading,
    disabled,
    providerType,
    setProviderType,
    model,
    setModel,
    executionStrategy,
    setExecutionStrategy,
    accessMode,
    setAccessMode,
    onManageProviders,
    webSearchEnabled: toolPreferences.webSearch,
    onWebSearchEnabledChange: (enabled) =>
      onToolPreferenceChange("webSearch", enabled),
    thinkingEnabled: toolPreferences.thinking,
    onThinkingEnabledChange: (enabled) =>
      onToolPreferenceChange("thinking", enabled),
    subagentEnabled: toolPreferences.subagent,
    onSubagentEnabledChange: (enabled) =>
      onToolPreferenceChange("subagent", enabled),
    selectedTeam,
    onSelectTeam,
    onEnableSuggestedTeam,
    creationMode,
    onCreationModeChange,
    activeTheme,
    onThemeChange: themeLocked
      ? undefined
      : (theme) => {
          onThemeChange?.(theme);
        },
    hasCanvasContent,
    hasContentId,
    selectedText,
    onRecommendationClick,
    characters,
    skills,
    isSkillsLoading,
    onNavigateToSettings,
    onRefreshSkills,
    onLaunchBrowserAssist,
    browserAssistLoading,
    projectId,
    onProjectChange,
    onOpenSettings,
  };
}

interface BuildWorkspaceNavbarPropsParams {
  visible: boolean;
  isRunning: boolean;
  chrome: ComponentProps<typeof ChatNavbar>["chrome"];
  navbarContextVariant?: "default" | "task-center";
  onToggleHistory: NonNullable<
    ComponentProps<typeof ChatNavbar>["onToggleHistory"]
  >;
  showHistoryToggle: boolean;
  onBackToProjectManagement?: ComponentProps<
    typeof ChatNavbar
  >["onBackToProjectManagement"];
  onBackToResources?: ComponentProps<typeof ChatNavbar>["onBackToResources"];
  showCanvasToggle: boolean;
  isCanvasOpen: boolean;
  onToggleCanvas?: ComponentProps<typeof ChatNavbar>["onToggleCanvas"];
  projectId: string | null;
  onProjectChange?: ComponentProps<typeof ChatNavbar>["onProjectChange"];
  workspaceType?: ComponentProps<typeof ChatNavbar>["workspaceType"];
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
  navbarContextVariant = "default",
  onToggleHistory,
  showHistoryToggle,
  onBackToProjectManagement,
  onBackToResources,
  showCanvasToggle,
  isCanvasOpen,
  onToggleCanvas,
  projectId,
  onProjectChange,
  workspaceType,
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

  const entryContextCopy =
    navbarContextVariant === "task-center"
      ? {
          entryContextLabel: "任务中心",
          entryContextHint: "回到进行中的任务、旧历史和最近工作现场。",
        }
      : {};

  return {
    isRunning,
    chrome,
    ...entryContextCopy,
    onToggleHistory,
    showHistoryToggle,
    onToggleFullscreen: () => undefined,
    onBackToProjectManagement,
    onBackToResources,
    showCanvasToggle,
    isCanvasOpen,
    onToggleCanvas,
    projectId,
    onProjectChange,
    workspaceType,
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

export function buildWorkspaceChatSidebarProps(
  params: ComponentProps<typeof ChatSidebar>,
): ComponentProps<typeof ChatSidebar> {
  return params;
}
