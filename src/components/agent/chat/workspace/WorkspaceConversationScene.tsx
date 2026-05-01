import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import { StepProgress } from "@/lib/workspace/workbenchUi";
import type { A2UIFormData, A2UIResponse } from "@/lib/workspace/a2ui";
import { CanvasWorkbenchLayout } from "../components/CanvasWorkbenchLayout";
import { ChatNavbar } from "../components/ChatNavbar";
import { CreationReplaySurfaceBanner } from "../components/CreationReplaySurfaceBanner";
import { EmptyState } from "../components/EmptyState";
import { MessageList } from "../components/MessageList";
import { TeamWorkspaceDock } from "../components/TeamWorkspaceDock";
import { WorkspaceMainArea } from "./WorkspaceMainArea";
import { WorkspacePendingA2UIPanel } from "./WorkspacePendingA2UIPanel";
import {
  buildWorkspaceEmptyStateProps,
  buildWorkspaceNavbarProps,
} from "./chatSurfaceProps";
import { isCanvasStateEmpty } from "./generalWorkbenchHelpers";
import type { SyncStatus } from "../hooks/useContentSync";
import type { A2UISubmissionNoticeData } from "./A2UISubmissionNotice";
import type { CreationReplaySurfaceModel } from "../utils/creationReplaySurface";
import {
  ChatContainer,
  ChatContainerInner,
  ChatContent,
  ChatInputSlot,
  ContentSyncNotice,
  ContentSyncNoticeText,
  EntryBanner,
  EntryBannerClose,
  MessageViewport,
} from "./WorkspaceStyles";

type WorkspaceMainAreaProps = Omit<
  ComponentProps<typeof WorkspaceMainArea>,
  | "navbarNode"
  | "contentSyncNoticeNode"
  | "forceCanvasMode"
  | "chatContent"
  | "canvasContent"
>;
type CanvasWorkbenchLayoutProps = ComponentProps<typeof CanvasWorkbenchLayout>;
type ChatToolPreferences = {
  webSearch: boolean;
  thinking: boolean;
  task: boolean;
  subagent: boolean;
};
type ChatToolPreferenceKey = keyof ChatToolPreferences;
type StepProgressProps = ComponentProps<typeof StepProgress>;
type MessageListProps = ComponentProps<typeof MessageList>;
type TeamWorkspaceDockProps = ComponentProps<typeof TeamWorkspaceDock>;
type EmptyStateProps = ComponentProps<typeof EmptyState>;

interface WorkspaceChatContentParams {
  entryBannerVisible: boolean;
  entryBannerMessage?: string;
  onDismissEntryBanner: () => void;
  creationReplaySurface?: CreationReplaySurfaceModel | null;
  sceneAppExecutionSummaryCard?: ReactNode;
  serviceSkillExecutionCard?: ReactNode;
  stepProgressProps?: StepProgressProps | null;
  showChatLayout: boolean;
  compactChrome: boolean;
  taskCenterSurface: boolean;
  contextWorkspaceEnabled: boolean;
  generalWorkbenchMessageViewportBottomPadding?: string;
  messageListProps: MessageListProps;
  teamWorkspaceDockProps?: TeamWorkspaceDockProps | null;
  emptyStateProps: EmptyStateProps;
  showWorkspaceAlert: boolean;
  onSelectWorkspaceDirectory: () => void;
  onDismissWorkspaceAlert: () => void;
  pendingA2UIForm?: A2UIResponse | null;
  onPendingA2UISubmit?: (formData: A2UIFormData) => void;
  a2uiSubmissionNotice?: A2UISubmissionNoticeData | null;
  showInlineInputbar: boolean;
  inputbarNode: ReactNode;
}

function resolveContentSyncNoticeMeta(status: Exclude<SyncStatus, "idle">): {
  label: string;
  Icon: typeof Loader2;
  animated?: boolean;
} {
  switch (status) {
    case "syncing":
      return {
        label: "正在同步到当前内容…",
        Icon: Loader2,
        animated: true,
      };
    case "success":
      return {
        label: "内容已同步",
        Icon: CheckCircle2,
      };
    case "error":
    default:
      return {
        label: "同步失败，将自动重试",
        Icon: AlertTriangle,
      };
  }
}

function renderWorkspaceChatContent({
  entryBannerVisible,
  entryBannerMessage,
  onDismissEntryBanner,
  creationReplaySurface,
  sceneAppExecutionSummaryCard,
  serviceSkillExecutionCard,
  stepProgressProps,
  showChatLayout,
  compactChrome,
  taskCenterSurface,
  contextWorkspaceEnabled,
  generalWorkbenchMessageViewportBottomPadding,
  messageListProps,
  teamWorkspaceDockProps,
  emptyStateProps,
  showWorkspaceAlert,
  onSelectWorkspaceDirectory,
  onDismissWorkspaceAlert,
  pendingA2UIForm,
  onPendingA2UISubmit,
  a2uiSubmissionNotice,
  showInlineInputbar,
  inputbarNode,
}: WorkspaceChatContentParams): ReactNode {
  const leadingMessageContent =
    sceneAppExecutionSummaryCard ||
    stepProgressProps ||
    serviceSkillExecutionCard ? (
      <>
        {sceneAppExecutionSummaryCard}
        {stepProgressProps ? <StepProgress {...stepProgressProps} /> : null}
        {serviceSkillExecutionCard}
      </>
    ) : null;

  const messageListNode = (
    <MessageList
      {...messageListProps}
      leadingContent={leadingMessageContent}
      compactLeadingSpacing={contextWorkspaceEnabled}
    />
  );

  return (
    <ChatContainer>
      <ChatContainerInner $taskCenterSurface={taskCenterSurface}>
        {entryBannerVisible && entryBannerMessage ? (
          <EntryBanner>
            <Info className="h-4 w-4 shrink-0" />
            <span>{entryBannerMessage}</span>
            <EntryBannerClose
              type="button"
              onClick={onDismissEntryBanner}
              aria-label="关闭入口提示"
            >
              关闭
            </EntryBannerClose>
          </EntryBanner>
        ) : null}

        {showChatLayout && creationReplaySurface ? (
          <CreationReplaySurfaceBanner
            surface={creationReplaySurface}
            className="mx-4 mb-2"
          />
        ) : null}

        {showChatLayout ? (
          <ChatContent $compact={compactChrome}>
            <>
              {contextWorkspaceEnabled ? (
                <MessageViewport
                  $bottomPadding={generalWorkbenchMessageViewportBottomPadding}
                >
                  {messageListNode}
                </MessageViewport>
              ) : (
                messageListNode
              )}
              {teamWorkspaceDockProps ? (
                <TeamWorkspaceDock {...teamWorkspaceDockProps} />
              ) : null}
            </>
          </ChatContent>
        ) : (
          <EmptyState {...emptyStateProps} />
        )}

        {showChatLayout ? (
          <>
            {showWorkspaceAlert ? (
              <div className="mx-4 mb-2 flex items-center gap-2 rounded-[18px] border border-amber-200/90 bg-amber-50/86 px-3.5 py-2.5 text-sm text-amber-800 shadow-sm shadow-amber-950/5 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                <span className="flex-1">
                  工作区目录不存在，请重新选择一个本地目录后继续
                </span>
                <button
                  type="button"
                  onClick={onSelectWorkspaceDirectory}
                  className="shrink-0 rounded-xl border border-amber-200 bg-white/84 px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:border-amber-300 hover:bg-white dark:bg-amber-800 dark:text-amber-100 dark:hover:bg-amber-700"
                >
                  重新选择目录
                </button>
                <button
                  type="button"
                  onClick={onDismissWorkspaceAlert}
                  className="shrink-0 text-amber-600 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
                  aria-label="关闭"
                >
                  ✕
                </button>
              </div>
            ) : null}
            <WorkspacePendingA2UIPanel
              pendingA2UIForm={pendingA2UIForm}
              onA2UISubmit={onPendingA2UISubmit}
              a2uiSubmissionNotice={a2uiSubmissionNotice}
            />
            {showInlineInputbar ? (
              <ChatInputSlot>{inputbarNode}</ChatInputSlot>
            ) : null}
          </>
        ) : null}
      </ChatContainerInner>
    </ChatContainer>
  );
}

interface WorkspaceConversationSceneProps extends WorkspaceMainAreaProps {
  entryBannerVisible: boolean;
  entryBannerMessage?: string;
  onDismissEntryBanner: () => void;
  creationReplaySurface?: CreationReplaySurfaceModel | null;
  defaultCuratedTaskReferenceMemoryIds?: ComponentProps<
    typeof EmptyState
  >["defaultCuratedTaskReferenceMemoryIds"];
  defaultCuratedTaskReferenceEntries?: ComponentProps<
    typeof EmptyState
  >["defaultCuratedTaskReferenceEntries"];
  pathReferences?: ComponentProps<typeof EmptyState>["pathReferences"];
  onAddPathReferences?: ComponentProps<
    typeof EmptyState
  >["onAddPathReferences"];
  onRemovePathReference?: ComponentProps<
    typeof EmptyState
  >["onRemovePathReference"];
  onClearPathReferences?: ComponentProps<
    typeof EmptyState
  >["onClearPathReferences"];
  fileManagerOpen?: ComponentProps<typeof EmptyState>["fileManagerOpen"];
  onToggleFileManager?: ComponentProps<
    typeof EmptyState
  >["onToggleFileManager"];
  sceneAppExecutionSummaryCard?: WorkspaceChatContentParams["sceneAppExecutionSummaryCard"];
  serviceSkillExecutionCard?: WorkspaceChatContentParams["serviceSkillExecutionCard"];
  stepProgressProps?: WorkspaceChatContentParams["stepProgressProps"];
  showChatLayout: boolean;
  contextWorkspaceEnabled: boolean;
  generalWorkbenchMessageViewportBottomPadding?: string;
  messageListProps: WorkspaceChatContentParams["messageListProps"];
  teamWorkspaceDockProps?: WorkspaceChatContentParams["teamWorkspaceDockProps"];
  workspaceAlertVisible: boolean;
  onSelectWorkspaceDirectory: () => void;
  onDismissWorkspaceAlert: () => void;
  pendingA2UIForm?: WorkspaceChatContentParams["pendingA2UIForm"];
  onPendingA2UISubmit?: WorkspaceChatContentParams["onPendingA2UISubmit"];
  a2uiSubmissionNotice?: WorkspaceChatContentParams["a2uiSubmissionNotice"];
  shouldHideGeneralWorkbenchInputForTheme: boolean;
  input: ComponentProps<typeof EmptyState>["input"];
  setInput: ComponentProps<typeof EmptyState>["setInput"];
  onSendMessage: ComponentProps<typeof EmptyState>["onSend"];
  emptyStateIsLoading?: ComponentProps<typeof EmptyState>["isLoading"];
  emptyStateDisabled?: ComponentProps<typeof EmptyState>["disabled"];
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
  onThemeChange?: NonNullable<
    ComponentProps<typeof EmptyState>["onThemeChange"]
  >;
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
  serviceSkills: NonNullable<
    ComponentProps<typeof EmptyState>["serviceSkills"]
  >;
  serviceSkillGroups: NonNullable<
    ComponentProps<typeof EmptyState>["serviceSkillGroups"]
  >;
  isSkillsLoading: boolean;
  onSelectServiceSkill?: ComponentProps<
    typeof EmptyState
  >["onSelectServiceSkill"];
  onNavigateToSettings?: ComponentProps<
    typeof EmptyState
  >["onNavigateToSettings"];
  onRefreshSkills?: ComponentProps<typeof EmptyState>["onRefreshSkills"];
  onLaunchBrowserAssist?: ComponentProps<
    typeof EmptyState
  >["onLaunchBrowserAssist"];
  browserAssistLoading: boolean;
  featuredSceneApps: NonNullable<
    ComponentProps<typeof EmptyState>["featuredSceneApps"]
  >;
  sceneAppsLoading: boolean;
  sceneAppLaunchingId: ComponentProps<typeof EmptyState>["sceneAppLaunchingId"];
  onLaunchSceneApp?: ComponentProps<typeof EmptyState>["onLaunchSceneApp"];
  canResumeRecentSceneApp?: ComponentProps<
    typeof EmptyState
  >["canResumeRecentSceneApp"];
  onResumeRecentSceneApp?: ComponentProps<
    typeof EmptyState
  >["onResumeRecentSceneApp"];
  recentSessionTitle?: ComponentProps<typeof EmptyState>["recentSessionTitle"];
  recentSessionSummary?: ComponentProps<
    typeof EmptyState
  >["recentSessionSummary"];
  recentSessionActionLabel?: ComponentProps<
    typeof EmptyState
  >["recentSessionActionLabel"];
  onResumeRecentSession?: ComponentProps<
    typeof EmptyState
  >["onResumeRecentSession"];
  onOpenSceneAppsDirectory?: ComponentProps<
    typeof EmptyState
  >["onOpenSceneAppsDirectory"];
  projectId: string | null;
  sessionId?: ComponentProps<typeof EmptyState>["sessionId"];
  onProjectChange?: ComponentProps<typeof ChatNavbar>["onProjectChange"];
  deferWorkspaceListLoad?: ComponentProps<
    typeof ChatNavbar
  >["deferWorkspaceListLoad"];
  workspaceHintMessage?: ComponentProps<
    typeof ChatNavbar
  >["workspaceHintMessage"];
  workspaceHintVisible?: ComponentProps<
    typeof ChatNavbar
  >["workspaceHintVisible"];
  onDismissWorkspaceHint?: ComponentProps<
    typeof ChatNavbar
  >["onDismissWorkspaceHint"];
  onOpenSettings?: () => void;
  runtimeToolAvailability?: ComponentProps<
    typeof EmptyState
  >["runtimeToolAvailability"];
  runtimeTaskCard?: ComponentProps<typeof EmptyState>["runtimeTaskCard"];
  onOpenMemoryWorkbench?: ComponentProps<
    typeof EmptyState
  >["onOpenMemoryWorkbench"];
  onOpenChannels?: ComponentProps<typeof EmptyState>["onOpenChannels"];
  onOpenChromeRelay?: ComponentProps<typeof EmptyState>["onOpenChromeRelay"];
  onOpenOpenClaw?: ComponentProps<typeof EmptyState>["onOpenOpenClaw"];
  taskCenterTabsNode?: ReactNode;
  navbarVisible: boolean;
  isRunning: boolean;
  navbarChrome: ComponentProps<typeof ChatNavbar>["chrome"];
  navbarContextVariant?: "default" | "task-center";
  onToggleHistory: NonNullable<
    ComponentProps<typeof ChatNavbar>["onToggleHistory"]
  >;
  showHistoryToggle: boolean;
  onBackToProjectManagement?: ComponentProps<
    typeof ChatNavbar
  >["onBackToProjectManagement"];
  onBackToResources?: ComponentProps<typeof ChatNavbar>["onBackToResources"];
  onToggleCanvas?: ComponentProps<typeof ChatNavbar>["onToggleCanvas"];
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
  isThemeWorkbench: boolean;
  contentId?: string;
  syncStatus: SyncStatus;
  hasLiveCanvasPreviewContent: boolean;
  liveCanvasPreview: ReactNode;
  currentImageWorkbenchActive: boolean;
  shouldShowCanvasLoadingState: boolean;
  teamWorkbenchView: CanvasWorkbenchLayoutProps["teamView"];
  canvasWorkbenchLayoutProps: Omit<CanvasWorkbenchLayoutProps, "teamView">;
}

export function WorkspaceConversationScene({
  entryBannerVisible,
  entryBannerMessage,
  onDismissEntryBanner,
  creationReplaySurface,
  defaultCuratedTaskReferenceMemoryIds,
  defaultCuratedTaskReferenceEntries,
  pathReferences,
  onAddPathReferences,
  onRemovePathReference,
  onClearPathReferences,
  fileManagerOpen,
  onToggleFileManager,
  sceneAppExecutionSummaryCard,
  serviceSkillExecutionCard,
  stepProgressProps,
  showChatLayout,
  compactChrome,
  contextWorkspaceEnabled,
  generalWorkbenchMessageViewportBottomPadding,
  messageListProps,
  teamWorkspaceDockProps,
  workspaceAlertVisible,
  onSelectWorkspaceDirectory,
  onDismissWorkspaceAlert,
  pendingA2UIForm,
  onPendingA2UISubmit,
  a2uiSubmissionNotice,
  shouldHideGeneralWorkbenchInputForTheme,
  inputbarNode,
  input,
  setInput,
  onSendMessage,
  emptyStateIsLoading = false,
  emptyStateDisabled = false,
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
  serviceSkills,
  serviceSkillGroups,
  isSkillsLoading,
  onSelectServiceSkill,
  onNavigateToSettings,
  onRefreshSkills,
  onLaunchBrowserAssist,
  browserAssistLoading,
  featuredSceneApps,
  sceneAppsLoading,
  sceneAppLaunchingId,
  onLaunchSceneApp,
  canResumeRecentSceneApp,
  onResumeRecentSceneApp,
  recentSessionTitle,
  recentSessionSummary,
  recentSessionActionLabel,
  onResumeRecentSession,
  onOpenSceneAppsDirectory,
  projectId,
  sessionId,
  onProjectChange,
  deferWorkspaceListLoad,
  workspaceHintMessage,
  workspaceHintVisible,
  onDismissWorkspaceHint,
  onOpenSettings,
  runtimeToolAvailability,
  runtimeTaskCard,
  onOpenMemoryWorkbench,
  onOpenChannels,
  onOpenChromeRelay,
  onOpenOpenClaw,
  taskCenterTabsNode,
  navbarVisible,
  isRunning,
  navbarChrome,
  navbarContextVariant = "default",
  onToggleHistory,
  showHistoryToggle,
  onBackToProjectManagement,
  onBackToResources,
  isThemeWorkbench,
  layoutMode,
  onToggleCanvas,
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
  generalWorkbenchHarnessDialog,
  showFloatingInputOverlay,
  hasPendingA2UIForm,
}: WorkspaceConversationSceneProps) {
  const emptyStateProps = buildWorkspaceEmptyStateProps({
    input,
    setInput,
    onSendMessage,
    isLoading: emptyStateIsLoading,
    disabled: emptyStateDisabled,
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
    serviceSkills,
    serviceSkillGroups,
    isSkillsLoading,
    onSelectServiceSkill,
    onNavigateToSettings,
    onRefreshSkills,
    onLaunchBrowserAssist,
    browserAssistLoading,
    featuredSceneApps,
    sceneAppsLoading,
    sceneAppLaunchingId,
    onLaunchSceneApp,
    canResumeRecentSceneApp,
    onResumeRecentSceneApp,
    recentSessionTitle,
    recentSessionSummary,
    recentSessionActionLabel,
    onResumeRecentSession,
    onOpenSceneAppsDirectory,
    projectId,
    sessionId,
    runtimeToolAvailability,
    runtimeTaskCard,
    onOpenMemoryWorkbench,
    onOpenChannels,
    onOpenChromeRelay,
    onOpenOpenClaw,
    creationReplaySurface,
    defaultCuratedTaskReferenceMemoryIds,
    defaultCuratedTaskReferenceEntries,
    pathReferences,
    onAddPathReferences,
    onRemovePathReference,
    onClearPathReferences,
    fileManagerOpen,
    onToggleFileManager,
  });

  const chatContent = renderWorkspaceChatContent({
    entryBannerVisible,
    entryBannerMessage,
    onDismissEntryBanner,
    creationReplaySurface,
    sceneAppExecutionSummaryCard,
    serviceSkillExecutionCard,
    stepProgressProps,
    showChatLayout,
    compactChrome,
    taskCenterSurface: navbarContextVariant === "task-center",
    contextWorkspaceEnabled,
    generalWorkbenchMessageViewportBottomPadding,
    messageListProps,
    teamWorkspaceDockProps,
    emptyStateProps,
    showWorkspaceAlert: workspaceAlertVisible,
    onSelectWorkspaceDirectory,
    onDismissWorkspaceAlert,
    pendingA2UIForm,
    onPendingA2UISubmit,
    a2uiSubmissionNotice,
    showInlineInputbar:
      !contextWorkspaceEnabled && !shouldHideGeneralWorkbenchInputForTheme,
    inputbarNode,
  });
  const chatNavbarProps = buildWorkspaceNavbarProps({
    visible: navbarVisible,
    isRunning,
    chrome: navbarChrome,
    navbarContextVariant,
    onToggleHistory,
    showHistoryToggle,
    onBackToProjectManagement,
    onBackToResources,
    showCanvasToggle: !isThemeWorkbench,
    isCanvasOpen: layoutMode !== "chat",
    onToggleCanvas,
    projectId,
    onProjectChange,
    deferWorkspaceListLoad,
    workspaceHintMessage,
    workspaceHintVisible,
    onDismissWorkspaceHint,
    workspaceType: activeTheme,
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
  });

  const navbarNode = chatNavbarProps ? (
    <ChatNavbar {...chatNavbarProps} />
  ) : null;
  const shouldShowContentSyncNotice =
    !isThemeWorkbench &&
    Boolean(contentId) &&
    (syncStatus === "syncing" ||
      syncStatus === "success" ||
      syncStatus === "error");
  const contentSyncNoticeNode = shouldShowContentSyncNotice
    ? (() => {
        const notice = resolveContentSyncNoticeMeta(syncStatus);
        const NoticeIcon = notice.Icon;

        return (
          <ContentSyncNotice $status={syncStatus}>
            <NoticeIcon
              className={
                notice.animated ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"
              }
            />
            <ContentSyncNoticeText>{notice.label}</ContentSyncNoticeText>
          </ContentSyncNotice>
        );
      })()
    : null;
  const canvasContent =
    !liveCanvasPreview &&
    !teamWorkbenchView ? null : currentImageWorkbenchActive ||
      (!teamWorkbenchView && shouldShowCanvasLoadingState) ? (
      liveCanvasPreview
    ) : (
      <CanvasWorkbenchLayout
        {...canvasWorkbenchLayoutProps}
        teamView={teamWorkbenchView}
      />
    );
  const forceCanvasMode = Boolean(
    isThemeWorkbench &&
    (hasLiveCanvasPreviewContent || Boolean(teamWorkbenchView)),
  );

  return (
    <WorkspaceMainArea
      compactChrome={compactChrome}
      navbarNode={navbarNode}
      taskCenterTabsNode={taskCenterTabsNode}
      contentSyncNoticeNode={contentSyncNoticeNode}
      shellBottomInset={shellBottomInset}
      layoutMode={layoutMode}
      forceCanvasMode={forceCanvasMode}
      chatContent={chatContent}
      canvasContent={canvasContent}
      chatPanelWidth={chatPanelWidth}
      chatPanelMinWidth={chatPanelMinWidth}
      generalWorkbenchDialog={generalWorkbenchDialog}
      generalWorkbenchHarnessDialog={generalWorkbenchHarnessDialog}
      showFloatingInputOverlay={showFloatingInputOverlay}
      hasPendingA2UIForm={hasPendingA2UIForm}
      inputbarNode={inputbarNode}
    />
  );
}
