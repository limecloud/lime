import { useMemo } from "react";
import { resolveWorkflowLayoutBottomSpacing } from "../utils/workflowLayout";
import {
  TEAM_PRIMARY_CHAT_PANEL_MIN_WIDTH,
  TEAM_PRIMARY_CHAT_PANEL_WIDTH,
} from "./WorkspaceStyles";

interface UseWorkspaceShellChromeRuntimeParams {
  agentEntry?: "new-task" | "claw";
  contextWorkspaceEnabled: boolean;
  hasDisplayMessages: boolean;
  hideTopBar: boolean;
  isBootstrapDispatchPending: boolean;
  isSpecializedThemeMode: boolean;
  isSending: boolean;
  isThemeWorkbench: boolean;
  layoutMode: string;
  queuedTurnCount: number;
  shouldUseCompactGeneralWorkbench: boolean;
  showTeamWorkspaceBoard: boolean;
  topBarChrome: "full" | "workspace-compact";
  themeWorkbenchRunState: "idle" | "auto_running" | "await_user_decision";
  currentGateStatus: "running" | "waiting" | "idle";
  hasRealTeamGraph: boolean;
  teamDispatchPreviewState: unknown;
}

export function useWorkspaceShellChromeRuntime({
  agentEntry,
  contextWorkspaceEnabled,
  hasDisplayMessages,
  hideTopBar,
  isBootstrapDispatchPending,
  isSpecializedThemeMode,
  isSending,
  isThemeWorkbench,
  layoutMode,
  queuedTurnCount,
  shouldUseCompactGeneralWorkbench,
  showTeamWorkspaceBoard,
  topBarChrome,
  themeWorkbenchRunState,
  currentGateStatus,
  hasRealTeamGraph,
  teamDispatchPreviewState,
}: UseWorkspaceShellChromeRuntimeParams) {
  const hasUnconsumedInitialDispatch =
    !shouldUseCompactGeneralWorkbench && isBootstrapDispatchPending;

  const showChatLayout =
    agentEntry === "claw" ||
    hasDisplayMessages ||
    isThemeWorkbench ||
    hasUnconsumedInitialDispatch ||
    isSending ||
    queuedTurnCount > 0;

  const shouldHideGeneralWorkbenchInputForTheme =
    shouldUseCompactGeneralWorkbench;
  const shouldShowGeneralWorkbenchFloatingInputOverlay =
    isThemeWorkbench &&
    showChatLayout &&
    !shouldHideGeneralWorkbenchInputForTheme;

  const isWorkspaceCompactChrome = topBarChrome === "workspace-compact";
  const shouldRenderBrandedEmptyState = !showChatLayout;
  const shouldRenderTopBar = !hideTopBar && !shouldRenderBrandedEmptyState;
  const shouldRenderInlineA2UI = isSpecializedThemeMode;

  const shouldUseTeamPrimaryChatPanelWidth =
    layoutMode === "chat-canvas" &&
    showTeamWorkspaceBoard &&
    (hasRealTeamGraph || Boolean(teamDispatchPreviewState));
  const layoutTransitionChatPanelWidth = shouldUseTeamPrimaryChatPanelWidth
    ? TEAM_PRIMARY_CHAT_PANEL_WIDTH
    : undefined;
  const layoutTransitionChatPanelMinWidth = shouldUseTeamPrimaryChatPanelWidth
    ? TEAM_PRIMARY_CHAT_PANEL_MIN_WIDTH
    : undefined;

  const workflowLayoutBottomSpacing = useMemo(
    () =>
      resolveWorkflowLayoutBottomSpacing({
        contextWorkspaceEnabled,
        showFloatingInputOverlay:
          shouldShowGeneralWorkbenchFloatingInputOverlay,
        hasCanvasContent: layoutMode !== "chat",
        workflowRunState: themeWorkbenchRunState,
        gateStatus: currentGateStatus,
      }),
    [
      contextWorkspaceEnabled,
      currentGateStatus,
      layoutMode,
      shouldShowGeneralWorkbenchFloatingInputOverlay,
      themeWorkbenchRunState,
    ],
  );

  return {
    hasUnconsumedInitialDispatch,
    isWorkspaceCompactChrome,
    layoutTransitionChatPanelMinWidth,
    layoutTransitionChatPanelWidth,
    shouldHideGeneralWorkbenchInputForTheme,
    shouldRenderInlineA2UI,
    shouldRenderTopBar,
    shouldShowGeneralWorkbenchFloatingInputOverlay,
    showChatLayout,
    workflowLayoutBottomSpacing,
  };
}
