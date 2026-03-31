import type { ComponentProps } from "react";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import { ChatNavbar } from "../components/ChatNavbar";
import { EmptyState } from "../components/EmptyState";
import { WorkspaceChatContent } from "./WorkspaceChatContent";
import { WorkspaceMainScene } from "./WorkspaceMainScene";
import {
  buildWorkspaceEmptyStateProps,
  buildWorkspaceNavbarProps,
} from "./chatSurfaceProps";
import { isCanvasStateEmpty } from "./themeWorkbenchHelpers";

type WorkspaceMainSceneProps = Omit<
  ComponentProps<typeof WorkspaceMainScene>,
  "chatContent" | "chatNavbarProps"
>;
type ChatToolPreferences = {
  webSearch: boolean;
  thinking: boolean;
  task: boolean;
  subagent: boolean;
};
type ChatToolPreferenceKey = keyof ChatToolPreferences;

interface WorkspaceConversationSceneProps extends WorkspaceMainSceneProps {
  entryBannerVisible: boolean;
  entryBannerMessage?: string;
  onDismissEntryBanner: () => void;
  serviceSkillExecutionCard?: ComponentProps<
    typeof WorkspaceChatContent
  >["serviceSkillExecutionCard"];
  stepProgressProps?: ComponentProps<typeof WorkspaceChatContent>["stepProgressProps"];
  showChatLayout: boolean;
  contextWorkspaceEnabled: boolean;
  themeWorkbenchMessageViewportBottomPadding?: string;
  messageListProps: ComponentProps<typeof WorkspaceChatContent>["messageListProps"];
  teamWorkspaceDockProps?: ComponentProps<
    typeof WorkspaceChatContent
  >["teamWorkspaceDockProps"];
  workspaceAlertVisible: boolean;
  onSelectWorkspaceDirectory: () => void;
  onDismissWorkspaceAlert: () => void;
  pendingA2UIForm?: ComponentProps<
    typeof WorkspaceChatContent
  >["pendingA2UIForm"];
  onPendingA2UISubmit?: ComponentProps<
    typeof WorkspaceChatContent
  >["onPendingA2UISubmit"];
  a2uiSubmissionNotice?: ComponentProps<
    typeof WorkspaceChatContent
  >["a2uiSubmissionNotice"];
  shouldHideThemeWorkbenchInputForTheme: boolean;
  input: ComponentProps<typeof EmptyState>["input"];
  setInput: ComponentProps<typeof EmptyState>["setInput"];
  onSendMessage: ComponentProps<typeof EmptyState>["onSend"];
  providerType: ComponentProps<typeof EmptyState>["providerType"];
  setProviderType: ComponentProps<typeof EmptyState>["setProviderType"];
  model: ComponentProps<typeof EmptyState>["model"];
  setModel: ComponentProps<typeof EmptyState>["setModel"];
  executionStrategy: ComponentProps<typeof EmptyState>["executionStrategy"];
  setExecutionStrategy?: ComponentProps<
    typeof EmptyState
  >["setExecutionStrategy"];
  accessMode: ComponentProps<typeof EmptyState>["accessMode"];
  setAccessMode?: ComponentProps<typeof EmptyState>["setAccessMode"];
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
  onThemeChange?: NonNullable<ComponentProps<typeof EmptyState>["onThemeChange"]>;
  themeLocked: boolean;
  artifactsCount: number;
  generalCanvasContent?: string | null;
  resolvedCanvasState: CanvasStateUnion | null;
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
  onOpenSettings?: () => void;
  navbarVisible: boolean;
  isRunning: boolean;
  navbarChrome: ComponentProps<typeof ChatNavbar>["chrome"];
  onToggleHistory: NonNullable<ComponentProps<typeof ChatNavbar>["onToggleHistory"]>;
  showHistoryToggle: boolean;
  onBackToProjectManagement?: ComponentProps<
    typeof ChatNavbar
  >["onBackToProjectManagement"];
  onBackToResources?: ComponentProps<typeof ChatNavbar>["onBackToResources"];
  onToggleCanvas?: ComponentProps<typeof ChatNavbar>["onToggleCanvas"];
  onBackHome?: ComponentProps<typeof ChatNavbar>["onBackHome"];
  chatMode: string;
  browserAssistAttentionLevel: ComponentProps<
    typeof ChatNavbar
  >["browserAssistAttentionLevel"];
  browserAssistLabel?: ComponentProps<typeof ChatNavbar>["browserAssistLabel"];
  onOpenBrowserAssist?: () => Promise<void> | void;
  showHarnessToggle: boolean;
  harnessPanelVisible: boolean;
  onToggleHarnessPanel?: ComponentProps<typeof ChatNavbar>["onToggleHarnessPanel"];
  harnessPendingCount: number;
  harnessAttentionLevel: ComponentProps<
    typeof ChatNavbar
  >["harnessAttentionLevel"];
  showContextCompactionAction?: ComponentProps<
    typeof ChatNavbar
  >["showContextCompactionAction"];
  contextCompactionRunning?: ComponentProps<
    typeof ChatNavbar
  >["contextCompactionRunning"];
  onCompactContext?: ComponentProps<typeof ChatNavbar>["onCompactContext"];
}

export function WorkspaceConversationScene({
  entryBannerVisible,
  entryBannerMessage,
  onDismissEntryBanner,
  serviceSkillExecutionCard,
  stepProgressProps,
  showChatLayout,
  compactChrome,
  contextWorkspaceEnabled,
  themeWorkbenchMessageViewportBottomPadding,
  messageListProps,
  teamWorkspaceDockProps,
  workspaceAlertVisible,
  onSelectWorkspaceDirectory,
  onDismissWorkspaceAlert,
  pendingA2UIForm,
  onPendingA2UISubmit,
  a2uiSubmissionNotice,
  shouldHideThemeWorkbenchInputForTheme,
  inputbarNode,
  input,
  setInput,
  onSendMessage,
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
  artifactsCount,
  generalCanvasContent,
  resolvedCanvasState,
  contentId,
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
  navbarVisible,
  isRunning,
  navbarChrome,
  onToggleHistory,
  showHistoryToggle,
  onBackToProjectManagement,
  onBackToResources,
  isThemeWorkbench,
  layoutMode,
  onToggleCanvas,
  onBackHome,
  chatMode,
  isBrowserAssistCanvasVisible,
  browserAssistAttentionLevel,
  browserAssistLabel,
  onOpenBrowserAssist,
  showHarnessToggle,
  harnessPanelVisible,
  onToggleHarnessPanel,
  harnessPendingCount,
  harnessAttentionLevel,
  showContextCompactionAction,
  contextCompactionRunning,
  onCompactContext,
  syncStatus,
  hasLiveCanvasPreviewContent,
  liveCanvasPreview,
  currentImageWorkbenchActive,
  shouldShowCanvasLoadingState,
  teamWorkbenchView,
  canvasWorkbenchLayoutProps,
  shellBottomInset,
  chatPanelWidth,
  chatPanelMinWidth,
  generalWorkbenchDialog,
  themeWorkbenchHarnessDialog,
  showFloatingInputOverlay,
  hasPendingA2UIForm,
}: WorkspaceConversationSceneProps) {
  const emptyStateProps = buildWorkspaceEmptyStateProps({
    input,
    setInput,
    onSendMessage,
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
    hasCanvasContent:
      activeTheme === "general"
        ? artifactsCount > 0 || Boolean(generalCanvasContent?.trim())
        : !isCanvasStateEmpty(resolvedCanvasState),
    hasContentId: Boolean(contentId),
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
  });

  const chatContent = (
      <WorkspaceChatContent
        entryBannerVisible={entryBannerVisible}
        entryBannerMessage={entryBannerMessage}
        onDismissEntryBanner={onDismissEntryBanner}
        serviceSkillExecutionCard={serviceSkillExecutionCard}
        stepProgressProps={stepProgressProps}
        showChatLayout={showChatLayout}
      compactChrome={compactChrome}
      contextWorkspaceEnabled={contextWorkspaceEnabled}
      themeWorkbenchMessageViewportBottomPadding={
        themeWorkbenchMessageViewportBottomPadding
      }
      messageListProps={messageListProps}
      teamWorkspaceDockProps={teamWorkspaceDockProps}
      emptyStateProps={emptyStateProps}
      showWorkspaceAlert={workspaceAlertVisible}
      onSelectWorkspaceDirectory={onSelectWorkspaceDirectory}
      onDismissWorkspaceAlert={onDismissWorkspaceAlert}
      pendingA2UIForm={pendingA2UIForm}
      onPendingA2UISubmit={onPendingA2UISubmit}
      a2uiSubmissionNotice={a2uiSubmissionNotice}
      showInlineInputbar={
        !contextWorkspaceEnabled && !shouldHideThemeWorkbenchInputForTheme
      }
      inputbarNode={inputbarNode}
    />
  );

  const chatNavbarProps = buildWorkspaceNavbarProps({
    visible: navbarVisible,
    isRunning,
    chrome: navbarChrome,
    onToggleHistory,
    showHistoryToggle,
    onBackToProjectManagement,
    onBackToResources,
    showCanvasToggle: !isThemeWorkbench,
    isCanvasOpen: layoutMode !== "chat",
    onToggleCanvas,
    projectId,
    onProjectChange,
    workspaceType: activeTheme,
    onBackHome,
    showBrowserAssistEntry: chatMode === "general" && !isThemeWorkbench,
    browserAssistActive: isBrowserAssistCanvasVisible,
    browserAssistLoading,
    browserAssistAttentionLevel,
    browserAssistLabel,
    onOpenBrowserAssist,
    showHarnessToggle,
    harnessPanelVisible,
    onToggleHarnessPanel,
    harnessPendingCount,
    harnessAttentionLevel,
    harnessToggleLabel:
      chatMode === "general" && !isThemeWorkbench ? "工作台" : undefined,
    showContextCompactionAction,
    contextCompactionRunning,
    onCompactContext,
    onOpenSettings,
  });

  return (
    <WorkspaceMainScene
      chatNavbarProps={chatNavbarProps}
      isThemeWorkbench={isThemeWorkbench}
      contentId={contentId}
      syncStatus={syncStatus}
      hasLiveCanvasPreviewContent={hasLiveCanvasPreviewContent}
      liveCanvasPreview={liveCanvasPreview}
      currentImageWorkbenchActive={currentImageWorkbenchActive}
      shouldShowCanvasLoadingState={shouldShowCanvasLoadingState}
      isBrowserAssistCanvasVisible={isBrowserAssistCanvasVisible}
      teamWorkbenchView={teamWorkbenchView}
      canvasWorkbenchLayoutProps={canvasWorkbenchLayoutProps}
      compactChrome={compactChrome}
      shellBottomInset={shellBottomInset}
      layoutMode={layoutMode}
      chatContent={chatContent}
      chatPanelWidth={chatPanelWidth}
      chatPanelMinWidth={chatPanelMinWidth}
      generalWorkbenchDialog={generalWorkbenchDialog}
      themeWorkbenchHarnessDialog={themeWorkbenchHarnessDialog}
      showFloatingInputOverlay={showFloatingInputOverlay}
      hasPendingA2UIForm={hasPendingA2UIForm}
      inputbarNode={inputbarNode}
    />
  );
}
