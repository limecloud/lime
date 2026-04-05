import type { ThemeWorkbenchGateState } from "./themeWorkbenchInputState";

interface ResolveFloatingChromeInsetParams {
  showFloatingInputOverlay: boolean;
  hasCanvasContent: boolean;
  themeWorkbenchRunState?: "idle" | "auto_running" | "await_user_decision";
  gateStatus?: ThemeWorkbenchGateState["status"];
}

interface ResolveLayoutBottomSpacingParams extends ResolveFloatingChromeInsetParams {
  contextWorkspaceEnabled: boolean;
}

export function resolveThemeWorkbenchFloatingChromeInset({
  showFloatingInputOverlay,
  hasCanvasContent,
  themeWorkbenchRunState,
  gateStatus,
}: ResolveFloatingChromeInsetParams): string {
  if (!showFloatingInputOverlay) {
    return "0";
  }

  if (hasCanvasContent) {
    if (themeWorkbenchRunState === "auto_running") {
      return "24px";
    }

    if (gateStatus === "waiting") {
      return "12px";
    }

    return "0";
  }

  if (themeWorkbenchRunState === "auto_running") {
    return "168px";
  }

  if (gateStatus === "waiting") {
    return "136px";
  }

  return "88px";
}

export function resolveThemeWorkbenchLayoutBottomSpacing({
  contextWorkspaceEnabled,
  showFloatingInputOverlay,
  hasCanvasContent,
  themeWorkbenchRunState,
  gateStatus,
}: ResolveLayoutBottomSpacingParams): {
  shellBottomInset: string;
  messageViewportBottomPadding: string;
} {
  const floatingChromeInset = resolveThemeWorkbenchFloatingChromeInset({
    showFloatingInputOverlay,
    hasCanvasContent,
    themeWorkbenchRunState,
    gateStatus,
  });

  if (!showFloatingInputOverlay) {
    return {
      shellBottomInset: "0",
      messageViewportBottomPadding: "128px",
    };
  }

  if (contextWorkspaceEnabled) {
    return {
      shellBottomInset: "0",
      messageViewportBottomPadding: floatingChromeInset,
    };
  }

  return {
    shellBottomInset: floatingChromeInset,
    messageViewportBottomPadding: "128px",
  };
}
