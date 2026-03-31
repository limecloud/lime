import { useMemo } from "react";
import type { BrowserTaskPreflight } from "../hooks/handleSendTypes";
import { resolveThemeWorkbenchLayoutBottomSpacing } from "../utils/themeWorkbenchLayout";
import {
  TEAM_PRIMARY_CHAT_PANEL_MIN_WIDTH,
  TEAM_PRIMARY_CHAT_PANEL_WIDTH,
} from "./WorkspaceStyles";

interface UseWorkspaceShellChromeRuntimeParams {
  agentEntry?: "new-task" | "claw";
  browserTaskPreflight: BrowserTaskPreflight | null;
  contextWorkspaceEnabled: boolean;
  hasDisplayMessages: boolean;
  hideTopBar: boolean;
  isBootstrapDispatchPending: boolean;
  isSpecializedThemeMode: boolean;
  isSending: boolean;
  isThemeWorkbench: boolean;
  layoutMode: string;
  queuedTurnCount: number;
  shouldUseCompactThemeWorkbench: boolean;
  showTeamWorkspaceBoard: boolean;
  topBarChrome: "full" | "workspace-compact";
  themeWorkbenchRunState: "idle" | "auto_running" | "await_user_decision";
  currentGateStatus: "running" | "waiting" | "idle";
  hasRealTeamGraph: boolean;
  teamDispatchPreviewState: unknown;
}

export function useWorkspaceShellChromeRuntime({
  agentEntry,
  browserTaskPreflight,
  contextWorkspaceEnabled,
  hasDisplayMessages,
  hideTopBar,
  isBootstrapDispatchPending,
  isSpecializedThemeMode,
  isSending,
  isThemeWorkbench,
  layoutMode,
  queuedTurnCount,
  shouldUseCompactThemeWorkbench,
  showTeamWorkspaceBoard,
  topBarChrome,
  themeWorkbenchRunState,
  currentGateStatus,
  hasRealTeamGraph,
  teamDispatchPreviewState,
}: UseWorkspaceShellChromeRuntimeParams) {
  const hasUnconsumedInitialDispatch =
    !shouldUseCompactThemeWorkbench && isBootstrapDispatchPending;

  const showChatLayout =
    agentEntry === "claw" ||
    hasDisplayMessages ||
    isThemeWorkbench ||
    hasUnconsumedInitialDispatch ||
    isSending ||
    queuedTurnCount > 0 ||
    Boolean(browserTaskPreflight);

  const shouldHideThemeWorkbenchInputForTheme = shouldUseCompactThemeWorkbench;
  const shouldShowThemeWorkbenchFloatingInputOverlay =
    isThemeWorkbench &&
    showChatLayout &&
    !shouldHideThemeWorkbenchInputForTheme;

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

  const themeWorkbenchLayoutBottomSpacing = useMemo(
    () =>
      resolveThemeWorkbenchLayoutBottomSpacing({
        contextWorkspaceEnabled,
        showFloatingInputOverlay: shouldShowThemeWorkbenchFloatingInputOverlay,
        hasCanvasContent: layoutMode !== "chat",
        themeWorkbenchRunState,
        gateStatus: currentGateStatus,
      }),
    [
      contextWorkspaceEnabled,
      currentGateStatus,
      layoutMode,
      shouldShowThemeWorkbenchFloatingInputOverlay,
      themeWorkbenchRunState,
    ],
  );

  return {
    hasUnconsumedInitialDispatch,
    isWorkspaceCompactChrome,
    layoutTransitionChatPanelMinWidth,
    layoutTransitionChatPanelWidth,
    shouldHideThemeWorkbenchInputForTheme,
    shouldRenderInlineA2UI,
    shouldRenderTopBar,
    shouldShowThemeWorkbenchFloatingInputOverlay,
    showChatLayout,
    themeWorkbenchLayoutBottomSpacing,
  };
}
