import { useThreadProjectDirectory } from "../hooks/useThreadProjectDirectory";
import { HeaderToolbar } from "@/components/app-shell/HeaderToolbar";
import { type ComponentProps, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ThreadGoal } from "@limecloud/app-server-client";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { StepProgress } from "@/components/workspace/layout/StepProgress";
import type {
  A2UIFormData,
  A2UIResponse,
} from "@/components/workspace/a2ui/types";
import { CanvasWorkbenchLayout } from "../components/CanvasWorkbenchLayout";
import { ChatNavbar } from "../components/ChatNavbar";

import { TaskCenterUtilityToolbar } from "../components/TaskCenterUtilityToolbar";
import type { GeneralWorkbenchWorkflowStepInput } from "../components/generalWorkbenchWorkflowPanelViewModel";
import type { SidebarActivityLog } from "../components/generalWorkbenchWorkflowData";
import type { GeneralWorkbenchCreationTaskEvent } from "../components/generalWorkbenchWorkflowData";
import type { GeneralWorkbenchTaskRailContextInput } from "../components/generalWorkbenchTaskRailViewModel";
import type { ConfirmResponse } from "../types";
import type { AgentSessionExecutionRuntime } from "@/lib/api/agentExecutionRuntime";
import { CreationReplaySurfaceBanner } from "../components/CreationReplaySurfaceBanner";
import { EmptyState } from "../components/EmptyState";
import { MessageList } from "../components/MessageList";
import { WorkspaceMainArea } from "./WorkspaceMainArea";
import { WorkspacePendingA2UIPanel } from "./WorkspacePendingA2UIPanel";
import { buildWorkspaceNavbarProps } from "./chatSurfaceProps";
import type { SyncStatus } from "../hooks/useContentSync";
import type { A2UISubmissionNoticeData } from "./A2UISubmissionNotice";
import type { WorkspaceConversationLandingSurfaceRuntime } from "./useWorkspaceConversationLandingSurfaceRuntime";
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
import { ThreadWorkspaceHeader } from "./ThreadWorkspaceHeader";
import { ThreadSummaryPanel } from "./ThreadSummaryPanel";
import {
  ThreadSummaryLayout,
  ThreadSummaryToggle,
} from "./ThreadSummaryLayout";
import { useThreadSummaryPanel } from "./useThreadSummaryPanel";

import type { ThreadWorkspaceHeaderViewModel } from "./threadWorkspaceHeaderViewModel";
import { QueuedMessageList } from "../components/QueuedMessageList";
import { ThreadProjectSelector } from "../components/ThreadProjectSelector";
import { ReviewThreadSidePanelProjectionContext } from "./ReviewThreadSidePanelProjection";

type WorkspaceMainAreaProps = Omit<
  ComponentProps<typeof WorkspaceMainArea>,
  | "navbarNode"
  | "contentSyncNoticeNode"
  | "forceCanvasMode"
  | "chatContent"
  | "canvasContent"
>;
type CanvasWorkbenchLayoutProps = ComponentProps<typeof CanvasWorkbenchLayout>;
type StepProgressProps = ComponentProps<typeof StepProgress>;
type MessageListProps = ComponentProps<typeof MessageList>;
type AgentNamespaceTranslation = (
  key: string,
  options?: Record<string, unknown>,
) => unknown;

interface WorkspaceChatContentParams {
  landingSurface: WorkspaceConversationLandingSurfaceRuntime;
  stepProgressProps?: StepProgressProps | null;
  showChatLayout: boolean;
  compactChrome: boolean;
  taskCenterSurface: boolean;
  contextWorkspaceEnabled: boolean;
  showFloatingInputOverlay: boolean;
  generalWorkbenchMessageViewportBottomPadding?: string;
  messageListProps: MessageListProps;
  showWorkspaceAlert: boolean;
  onSelectWorkspaceDirectory: () => void;
  onDismissWorkspaceAlert: () => void;
  pendingA2UIForm?: A2UIResponse | null;
  onPendingA2UISubmit?: (formData: A2UIFormData) => void;
  a2uiSubmissionNotice?: A2UISubmissionNoticeData | null;
  showInlineInputbar: boolean;
  inputbarNode: ReactNode;
  queueStatusNode: ReactNode;
  copy: WorkspaceChatContentCopy;
}

interface WorkspaceChatContentCopy {
  entryBannerClose: string;
  entryBannerCloseAria: string;
  workspaceMissing: string;
  workspaceReselect: string;
  workspaceDismissAria: string;
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
  landingSurface,
  stepProgressProps,
  showChatLayout,
  compactChrome,
  taskCenterSurface,
  contextWorkspaceEnabled,
  showFloatingInputOverlay,
  generalWorkbenchMessageViewportBottomPadding,
  messageListProps,
  showWorkspaceAlert,
  onSelectWorkspaceDirectory,
  onDismissWorkspaceAlert,
  pendingA2UIForm,
  onPendingA2UISubmit,
  a2uiSubmissionNotice,
  showInlineInputbar,
  inputbarNode,
  queueStatusNode,
  copy,
}: WorkspaceChatContentParams): ReactNode {
  const pendingA2UISource = messageListProps.activePendingA2UISource ?? null;
  const hasPendingA2UIMessageTailPayload = Boolean(
    pendingA2UIForm || a2uiSubmissionNotice,
  );
  const shouldRenderPendingA2UIAsMessageTail =
    hasPendingA2UIMessageTailPayload &&
    (!pendingA2UISource ||
      pendingA2UISource.kind === "scene_gate" ||
      pendingA2UISource.kind === "service_skill" ||
      Boolean(a2uiSubmissionNotice));
  const leadingMessageContent =
    stepProgressProps || landingSurface.serviceSkillExecutionCard ? (
      <>
        {stepProgressProps ? <StepProgress {...stepProgressProps} /> : null}
        {landingSurface.serviceSkillExecutionCard}
      </>
    ) : null;
  const pendingA2UIMessageTail = shouldRenderPendingA2UIAsMessageTail ? (
    <WorkspacePendingA2UIPanel
      pendingA2UIForm={pendingA2UIForm}
      onA2UISubmit={onPendingA2UISubmit}
      a2uiSubmissionNotice={a2uiSubmissionNotice}
      placement="message"
    />
  ) : null;
  const floatingInputTailSpacer =
    contextWorkspaceEnabled && showFloatingInputOverlay ? (
      <div
        aria-hidden="true"
        className="h-8 shrink-0 max-[960px]:h-16"
        data-testid="message-list-floating-input-spacer"
      />
    ) : null;
  const trailingMessageContent =
    messageListProps.trailingContent ||
    pendingA2UIMessageTail ||
    floatingInputTailSpacer ? (
      <>
        {messageListProps.trailingContent}
        {pendingA2UIMessageTail}
        {floatingInputTailSpacer}
      </>
    ) : null;

  const messageListNode = (
    <MessageList
      {...messageListProps}
      leadingContent={leadingMessageContent}
      trailingContent={trailingMessageContent}
      compactLeadingSpacing={contextWorkspaceEnabled}
    />
  );

  return (
    <ChatContainer>
      <ChatContainerInner $taskCenterSurface={taskCenterSurface}>
        {landingSurface.entryBannerVisible &&
        landingSurface.entryBannerMessage ? (
          <EntryBanner data-testid="workspace-entry-banner">
            <Info className="h-4 w-4 shrink-0" />
            <span data-testid="workspace-entry-banner-text">
              {landingSurface.entryBannerMessage}
            </span>
            <EntryBannerClose
              type="button"
              onClick={landingSurface.onDismissEntryBanner}
              aria-label={copy.entryBannerCloseAria}
            >
              {copy.entryBannerClose}
            </EntryBannerClose>
          </EntryBanner>
        ) : null}

        {showChatLayout && landingSurface.creationReplaySurface ? (
          <CreationReplaySurfaceBanner
            surface={landingSurface.creationReplaySurface}
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
              {showWorkspaceAlert ? (
                <div className="mx-4 mb-2 flex items-center gap-2 rounded-[18px] border border-amber-200/90 bg-amber-50/86 px-3.5 py-2.5 text-sm text-amber-800 shadow-sm shadow-amber-950/5 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  <span className="flex-1">{copy.workspaceMissing}</span>
                  <button
                    type="button"
                    onClick={onSelectWorkspaceDirectory}
                    className="shrink-0 rounded-xl border border-amber-200 bg-white/84 px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:border-amber-300 hover:bg-white dark:bg-amber-800 dark:text-amber-100 dark:hover:bg-amber-700"
                  >
                    {copy.workspaceReselect}
                  </button>
                  <button
                    type="button"
                    onClick={onDismissWorkspaceAlert}
                    className="shrink-0 text-amber-600 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
                    aria-label={copy.workspaceDismissAria}
                  >
                    ✕
                  </button>
                </div>
              ) : null}
              {queueStatusNode}
              {showInlineInputbar ? (
                <ChatInputSlot
                  data-testid="workspace-inline-input-slot"
                  data-action-owner="composer"
                >
                  {inputbarNode}
                </ChatInputSlot>
              ) : null}
            </>
          </ChatContent>
        ) : (
          <>
            <EmptyState {...landingSurface.emptyStateProps} />
            {landingSurface.composerDraftStatusNode}
          </>
        )}
      </ChatContainerInner>
    </ChatContainer>
  );
}

interface WorkspaceConversationSceneProps extends WorkspaceMainAreaProps {
  threadHeader?: ThreadWorkspaceHeaderViewModel | null;
  onOpenPluginDirectory?: () => void;
  landingSurface: WorkspaceConversationLandingSurfaceRuntime;
  stepProgressProps?: WorkspaceChatContentParams["stepProgressProps"];
  showChatLayout: boolean;
  contextWorkspaceEnabled: boolean;
  generalWorkbenchMessageViewportBottomPadding?: string;
  messageListProps: WorkspaceChatContentParams["messageListProps"];
  taskRail?: {
    sessionId?: string | null;
    workflowSteps: GeneralWorkbenchWorkflowStepInput[];
    messages: MessageListProps["messages"];
    activityLogs?: SidebarActivityLog[];
    creationTaskEvents?: GeneralWorkbenchCreationTaskEvent[];
    pendingActions?: MessageListProps["pendingActions"];
    submittedActionsInFlight?: MessageListProps["submittedActionsInFlight"];
    threadItems?: MessageListProps["threadItems"];
    threadGoal?: ThreadGoal | null;
    threadRead?: MessageListProps["threadRead"];
    executionRuntime?: AgentSessionExecutionRuntime | null;
    canonicalChildren?: MessageListProps["canonicalChildren"];
    context?: GeneralWorkbenchTaskRailContextInput;
    onOpenOutput?: (path: string) => void | Promise<void>;
    onRespondToAction?: (response: ConfirmResponse) => void | Promise<void>;
  };
  workspaceAlertVisible: boolean;
  onSelectWorkspaceDirectory: () => void;
  onDismissWorkspaceAlert: () => void;
  pendingA2UIForm?: WorkspaceChatContentParams["pendingA2UIForm"];
  onPendingA2UISubmit?: WorkspaceChatContentParams["onPendingA2UISubmit"];
  a2uiSubmissionNotice?: WorkspaceChatContentParams["a2uiSubmissionNotice"];
  shouldHideGeneralWorkbenchInputForTheme: boolean;
  projectId: string | null;
  openedProjects?: ComponentProps<typeof ChatNavbar>["openedProjects"];
  projectRootPath?: string | null;
  onProjectChange?: (projectId: string | null) => void;
  onCloseProject?: ComponentProps<typeof ChatNavbar>["onCloseProject"];
  workspaceType?: ComponentProps<typeof ChatNavbar>["workspaceType"];
  deferWorkspaceListLoad?: ComponentProps<
    typeof ChatNavbar
  >["deferWorkspaceListLoad"];
  onOpenSettings?: () => void;
  navbarVisible: boolean;
  isRunning: boolean;
  navbarChrome: ComponentProps<typeof ChatNavbar>["chrome"];
  navbarContextVariant?: "default" | "task-center";
  onBackToProjectManagement?: ComponentProps<
    typeof ChatNavbar
  >["onBackToProjectManagement"];
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
  rightSurfaceContent?: ReactNode;
  rightSurfaceTabStrip?: ReactNode;
  rightSurfaceLauncher?: ReactNode;
  onOpenBackgroundTerminal?: ComponentProps<
    typeof ThreadSummaryPanel
  >["onOpenBackgroundTerminal"];
  onRefreshThread?: () => void | Promise<unknown>;
  currentImageWorkbenchActive: boolean;
  shouldShowCanvasLoadingState: boolean;
  canvasWorkbenchLayoutProps: CanvasWorkbenchLayoutProps;
}

export function WorkspaceConversationScene({
  threadHeader,
  landingSurface,
  stepProgressProps,
  showChatLayout,
  compactChrome,
  contextWorkspaceEnabled,
  generalWorkbenchMessageViewportBottomPadding,
  messageListProps,
  taskRail,
  workspaceAlertVisible,
  onSelectWorkspaceDirectory,
  onDismissWorkspaceAlert,
  pendingA2UIForm,
  onPendingA2UISubmit,
  a2uiSubmissionNotice,
  shouldHideGeneralWorkbenchInputForTheme,
  inputbarNode,
  contentId,
  projectId,
  openedProjects,
  projectRootPath,
  onProjectChange,
  onCloseProject,
  workspaceType,
  deferWorkspaceListLoad,
  onOpenSettings,
  onOpenPluginDirectory,
  navbarVisible,
  isRunning,
  navbarChrome,
  navbarContextVariant = "default",
  onBackToProjectManagement,
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
  rightSurfaceContent,
  rightSurfaceOpen = false,
  rightSurfaceTabStrip,
  rightSurfaceLauncher,
  onOpenBackgroundTerminal,
  onRefreshThread,
  currentImageWorkbenchActive,
  shouldShowCanvasLoadingState,
  canvasWorkbenchLayoutProps,
  shellBottomInset,
  chatPanelWidth,
  generalWorkbenchDialog,
  showFloatingInputOverlay,
  hasPendingA2UIForm,
}: WorkspaceConversationSceneProps) {
  const { t } = useTranslation("agent");
  const agentT = t as unknown as AgentNamespaceTranslation;
  const text = (key: string) =>
    String(agentT(`agentChat.workspaceConversation.${key}`));
  const currentThreadId =
    messageListProps.threadRead?.thread_id?.trim() ||
    threadHeader?.sessionId?.trim() ||
    taskRail?.threadRead?.thread_id?.trim() ||
    taskRail?.sessionId?.trim() ||
    null;
  const threadDirectory = useThreadProjectDirectory({
    threadId: currentThreadId,
  });
  const currentWorkspaceName =
    openedProjects?.find((project) => project.id === projectId)?.name ?? null;
  const queueStatusNode = (
    <QueuedMessageList threadId={messageListProps.threadRead?.thread_id} />
  );
  const summary = useThreadSummaryPanel(
    showChatLayout ? currentThreadId : null,
  );
  const summaryPanel = (
    <ThreadSummaryPanel
      threadId={currentThreadId}
      projectless={
        !threadDirectory.loading &&
        !threadDirectory.error &&
        !threadDirectory.projectId
      }
      onOpenPluginDirectory={onOpenPluginDirectory}
      turns={messageListProps.turns}
      threadItems={messageListProps.threadItems}
      onOpenBackgroundTerminal={onOpenBackgroundTerminal}
      onRefresh={onRefreshThread}
      canonicalChildren={messageListProps.canonicalChildren}
      onOpenSubagentSession={messageListProps.onOpenSubagentSession}
      onFileClick={messageListProps.onFileClick}
      onOpenArtifactFromTimeline={messageListProps.onOpenArtifactFromTimeline}
      persistenceError={summary.persistenceError}
    />
  );
  const chatContent = renderWorkspaceChatContent({
    landingSurface,
    stepProgressProps,
    showChatLayout,
    compactChrome,
    taskCenterSurface: navbarContextVariant === "task-center",
    contextWorkspaceEnabled,
    showFloatingInputOverlay,
    generalWorkbenchMessageViewportBottomPadding,
    messageListProps,
    showWorkspaceAlert: workspaceAlertVisible,
    onSelectWorkspaceDirectory,
    onDismissWorkspaceAlert,
    pendingA2UIForm,
    onPendingA2UISubmit,
    a2uiSubmissionNotice,
    showInlineInputbar:
      !contextWorkspaceEnabled && !shouldHideGeneralWorkbenchInputForTheme,
    inputbarNode,
    queueStatusNode,
    copy: {
      entryBannerClose: text("entryBanner.close"),
      entryBannerCloseAria: text("entryBanner.closeAria"),
      workspaceMissing: text("workspaceAlert.missing"),
      workspaceReselect: text("workspaceAlert.reselect"),
      workspaceDismissAria: text("workspaceAlert.dismissAria"),
    },
  });
  const shouldUseTaskCenterUtilityToolbar =
    navbarContextVariant === "task-center" && showChatLayout;
  const shouldRenderThreadHeader = Boolean(threadHeader && showChatLayout);
  const taskCenterUtilityToolbarNode = shouldUseTaskCenterUtilityToolbar ? (
    <TaskCenterUtilityToolbar
      workspaceId={projectId}
      projectRootPath={projectRootPath}
      onProjectChange={onProjectChange}
      taskRail={taskRail}
      placement={shouldRenderThreadHeader ? "workbench-header" : "task-strip"}
      sidePanelLauncher={rightSurfaceLauncher}
    />
  ) : null;
  const threadHeaderNode =
    shouldRenderThreadHeader && threadHeader ? (
      <ThreadWorkspaceHeader
        {...threadHeader}
        summaryToggle={
          <ThreadSummaryToggle state={summary} panel={summaryPanel} />
        }
        actions={
          <>
            <ThreadProjectSelector
              threadId={currentThreadId}
              workspaceName={currentWorkspaceName}
              workspaceRootPath={projectRootPath}
              compact
              className="text-[color:var(--lime-chrome-muted)] hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-chrome-text)]"
            />
            {taskCenterUtilityToolbarNode}
          </>
        }
      />
    ) : null;
  const chatNavbarProps = buildWorkspaceNavbarProps({
    visible: navbarVisible && showChatLayout,
    isRunning,
    chrome: navbarChrome,
    navbarContextVariant,
    onBackToProjectManagement,
    showCanvasToggle: !isThemeWorkbench,
    isCanvasOpen: layoutMode !== "chat",
    onToggleCanvas,
    projectId,
    threadId: currentThreadId,
    workspaceRootPath: projectRootPath,
    openedProjects,
    onProjectChange,
    onCloseProject,
    deferWorkspaceListLoad,
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
    !liveCanvasPreview ? null : currentImageWorkbenchActive ||
      shouldShowCanvasLoadingState ? (
      liveCanvasPreview
    ) : (
      <CanvasWorkbenchLayout
        {...canvasWorkbenchLayoutProps}
        topRightTools={null}
      />
    );
  const forceCanvasMode = Boolean(
    isThemeWorkbench && hasLiveCanvasPreviewContent,
  );

  return (
    <>
      <WorkspaceMainArea
        compactChrome={compactChrome}
        mainToolbar={
          threadHeaderNode ?? (
            <HeaderToolbar className="flex-1">
              {navbarNode}
              <HeaderToolbar.Actions>
                {taskCenterUtilityToolbarNode}
              </HeaderToolbar.Actions>
            </HeaderToolbar>
          )
        }
        mainTabLabel={threadHeader?.title}
        sidePanelTabStrip={rightSurfaceTabStrip}
        contentSyncNoticeNode={contentSyncNoticeNode}
        shellBottomInset={shellBottomInset}
        layoutMode={layoutMode}
        forceCanvasMode={forceCanvasMode}
        chatContent={
          showChatLayout ? (
            <ThreadSummaryLayout state={summary} panel={summaryPanel}>
              {chatContent}
            </ThreadSummaryLayout>
          ) : (
            chatContent
          )
        }
        canvasContent={canvasContent}
        rightSurfaceOpen={rightSurfaceOpen}
        rightSurfaceContent={
          rightSurfaceContent ? (
            <ReviewThreadSidePanelProjectionContext.Provider
              value={{
                changeView: canvasWorkbenchLayoutProps.changeView,
                workspaceRoot: canvasWorkbenchLayoutProps.workspaceRoot,
                loadFilePreview: canvasWorkbenchLayoutProps.loadFilePreview,
              }}
            >
              {rightSurfaceContent}
            </ReviewThreadSidePanelProjectionContext.Provider>
          ) : (
            rightSurfaceContent
          )
        }
        chatPanelWidth={chatPanelWidth}
        generalWorkbenchDialog={generalWorkbenchDialog}
        showFloatingInputOverlay={showFloatingInputOverlay}
        hasPendingA2UIForm={hasPendingA2UIForm}
        inputbarNode={inputbarNode}
        inputContentShift={summary.contentShift}
      />
    </>
  );
}
