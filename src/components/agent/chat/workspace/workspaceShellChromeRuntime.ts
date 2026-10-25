import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import {
  CODE_WORKBENCH_CHAT_PANEL_WIDTH,
  TEAM_PRIMARY_CHAT_PANEL_WIDTH,
} from "./WorkspaceStyles";
import { shouldShowChatLayout } from "../utils/chatLayoutVisibility";
import { resolveWorkflowLayoutBottomSpacing } from "../utils/workflowLayout";
import type { WorkflowGateState } from "../utils/workflowInputState";

export interface ResolveWorkspaceShellChromeRuntimeParams {
  activeTheme: string;
  agentEntry: "new-task" | "conversation";
  contextWorkspaceEnabled: boolean;
  gateStatus?: WorkflowGateState["status"];
  effectiveShowChatPanel: boolean;
  generalWorkbenchPanelCollapseEnabled: boolean;
  generalWorkbenchSidebarCollapsed: boolean;
  hasCanvasWorkbenchContent: boolean;
  hasDisplayMessages: boolean;
  hasHomeConversationActivity: boolean;
  hasPendingA2UIForm: boolean;
  hideTopBar: boolean;
  isBootstrapDispatchPending: boolean;
  isPreparingSend: boolean;
  isSending: boolean;
  isTaskCenterDraftSendPending: boolean;
  isThemeWorkbench: boolean;
  layoutMode: LayoutMode;
  normalizedInitialSessionId?: string | null;
  queuedTurnCount: number;
  sessionId?: string | null;
  shouldRenderTaskCenterEmbeddedHome: boolean;
  shouldSuppressTaskCenterDraftContent: boolean;
  shouldUseBrowserWorkspaceHomeChrome: boolean;
  shouldUseCompactGeneralWorkbench: boolean;
  showSidebar: boolean;
  subagentsRuntimeVisible: boolean;
  hasRuntimeSessions: boolean;
  themeWorkbenchRunState?: "idle" | "auto_running" | "await_user_decision";
  topBarChrome: "full" | "workspace-compact";
}

export function resolveWorkspaceShellChromeRuntime({
  activeTheme,
  agentEntry,
  contextWorkspaceEnabled,
  gateStatus,
  hasCanvasWorkbenchContent,
  hasDisplayMessages,
  hasHomeConversationActivity,
  hasPendingA2UIForm,
  hideTopBar,
  isBootstrapDispatchPending,
  isPreparingSend,
  isSending,
  isTaskCenterDraftSendPending,
  isThemeWorkbench,
  layoutMode,
  normalizedInitialSessionId,
  queuedTurnCount,
  sessionId,
  shouldRenderTaskCenterEmbeddedHome,
  shouldSuppressTaskCenterDraftContent,
  shouldUseBrowserWorkspaceHomeChrome,
  shouldUseCompactGeneralWorkbench,
  showSidebar,
  subagentsRuntimeVisible,
  hasRuntimeSessions,
  themeWorkbenchRunState,
  topBarChrome,
  effectiveShowChatPanel,
  generalWorkbenchPanelCollapseEnabled,
  generalWorkbenchSidebarCollapsed,
}: ResolveWorkspaceShellChromeRuntimeParams) {
  const hasUnconsumedInitialDispatch =
    !shouldUseCompactGeneralWorkbench && isBootstrapDispatchPending;
  const shouldRenderTaskCenterHomeSurface =
    shouldRenderTaskCenterEmbeddedHome || shouldSuppressTaskCenterDraftContent;
  const isInitialSessionActive =
    Boolean(normalizedInitialSessionId) &&
    normalizedInitialSessionId === sessionId;
  const hasConversationSessionForLayout =
    (Boolean(sessionId) || isInitialSessionActive) &&
    !shouldRenderTaskCenterHomeSurface &&
    !(
      agentEntry === "new-task" &&
      shouldUseBrowserWorkspaceHomeChrome &&
      !hasHomeConversationActivity &&
      !normalizedInitialSessionId
    );
  const shouldTreatCurrentSessionAsBackground =
    agentEntry === "new-task" &&
    shouldUseBrowserWorkspaceHomeChrome &&
    Boolean(sessionId) &&
    !hasHomeConversationActivity &&
    !normalizedInitialSessionId;

  const showChatLayout = shouldRenderTaskCenterHomeSurface
    ? false
    : shouldShowChatLayout({
        agentEntry,
        preferEmptyStateForFreshTaskCenterTab:
          shouldRenderTaskCenterHomeSurface,
        hasSession: hasConversationSessionForLayout,
        hasDisplayMessages: shouldTreatCurrentSessionAsBackground
          ? false
          : hasDisplayMessages,
        hasPendingA2UIForm,
        hasCanvasContent: hasCanvasWorkbenchContent,
        isThemeWorkbench,
        hasUnconsumedInitialDispatch,
        isPreparingSend: shouldTreatCurrentSessionAsBackground
          ? false
          : isPreparingSend || isTaskCenterDraftSendPending,
        isSending: shouldTreatCurrentSessionAsBackground ? false : isSending,
        queuedTurnCount: shouldTreatCurrentSessionAsBackground
          ? 0
          : queuedTurnCount,
      });
  const shouldHideGeneralWorkbenchInputForTheme =
    shouldUseCompactGeneralWorkbench;
  const shouldKeepConversationInputOverlay =
    (contextWorkspaceEnabled || shouldUseCompactGeneralWorkbench) &&
    hasConversationSessionForLayout;
  const shouldShowGeneralWorkbenchFloatingInputOverlay =
    showChatLayout &&
    (isThemeWorkbench || contextWorkspaceEnabled) &&
    (!shouldHideGeneralWorkbenchInputForTheme ||
      shouldKeepConversationInputOverlay);
  const isWorkspaceCompactChrome = topBarChrome === "workspace-compact";
  const shouldRenderBrandedEmptyState =
    !showChatLayout && !shouldRenderTaskCenterHomeSurface;
  const shouldRenderTopBar =
    !hideTopBar &&
    (!shouldRenderBrandedEmptyState || shouldUseBrowserWorkspaceHomeChrome);
  const shouldRenderInlineA2UI = true;
  const shouldShowGeneralWorkbenchSidebarForTheme =
    !shouldUseCompactGeneralWorkbench;
  const canShowGeneralWorkbenchSidebar =
    effectiveShowChatPanel &&
    showSidebar &&
    !hasPendingA2UIForm &&
    isThemeWorkbench &&
    shouldShowGeneralWorkbenchSidebarForTheme;

  const shouldUseSubagentsPrimaryChatPanelWidth =
    layoutMode === "chat-canvas" &&
    subagentsRuntimeVisible &&
    hasRuntimeSessions;
  const shouldUseCodeWorkbenchChatPanelWidth =
    layoutMode === "chat-canvas" &&
    activeTheme === "general" &&
    hasCanvasWorkbenchContent &&
    !shouldUseSubagentsPrimaryChatPanelWidth;

  return {
    showChatLayout,
    isWorkspaceCompactChrome,
    workflowLayoutBottomSpacing: resolveWorkflowLayoutBottomSpacing({
      contextWorkspaceEnabled,
      showFloatingInputOverlay: shouldShowGeneralWorkbenchFloatingInputOverlay,
      hasCanvasContent: layoutMode !== "chat",
      workflowRunState: themeWorkbenchRunState,
      gateStatus,
    }),
    shouldHideGeneralWorkbenchInputForTheme,
    shouldRenderTopBar,
    showGeneralWorkbenchSidebar:
      canShowGeneralWorkbenchSidebar &&
      (!generalWorkbenchPanelCollapseEnabled ||
        !generalWorkbenchSidebarCollapsed),
    showGeneralWorkbenchLeftExpandButton:
      canShowGeneralWorkbenchSidebar &&
      generalWorkbenchPanelCollapseEnabled &&
      generalWorkbenchSidebarCollapsed,
    layoutTransitionChatPanelWidth: shouldUseSubagentsPrimaryChatPanelWidth
      ? TEAM_PRIMARY_CHAT_PANEL_WIDTH
      : shouldUseCodeWorkbenchChatPanelWidth
        ? CODE_WORKBENCH_CHAT_PANEL_WIDTH
        : undefined,
    shouldShowGeneralWorkbenchFloatingInputOverlay,
    shouldRenderInlineA2UI,
  };
}
