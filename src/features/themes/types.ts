import type { WorkspaceTheme } from "@/types/page";
import type { ComponentType } from "react";

export type ThemeWorkspaceKind = "agent-chat" | "video-canvas";
export type ThemeWorkspaceView =
  | "create"
  | "workflow"
  | "material"
  | "publish"
  | "settings";

export interface ThemeWorkspaceNotice {
  message: string;
  actionLabel?: string;
}

export interface ThemeCapabilities {
  workspaceKind: ThemeWorkspaceKind;
  workspaceNotice?: ThemeWorkspaceNotice;
  showWorkspaceRightRailInWorkspace?: boolean;
}

export interface ThemeWorkspaceRendererProps {
  projectId: string | null;
  projectName?: string;
  workspaceType?: string;
  resetAt?: number;
  onBackHome?: () => void;
  onOpenCreateProjectDialog?: () => void;
  onProjectSelect?: (projectId: string) => void;
}

export interface ThemeWorkspaceNavigationItem {
  key: ThemeWorkspaceView;
  label: string;
}

export interface ThemeWorkspaceNavigationSpec {
  defaultView: ThemeWorkspaceView;
  items: ThemeWorkspaceNavigationItem[];
}

export interface ThemePanelRenderers {
  workflow?: ComponentType<ThemeWorkspaceRendererProps>;
  material?: ComponentType<ThemeWorkspaceRendererProps>;
  publish?: ComponentType<ThemeWorkspaceRendererProps>;
  settings?: ComponentType<ThemeWorkspaceRendererProps>;
}

export interface ThemeModule {
  theme: WorkspaceTheme;
  capabilities: ThemeCapabilities;
  navigation: ThemeWorkspaceNavigationSpec;
  primaryWorkspaceRenderer?: ComponentType<ThemeWorkspaceRendererProps>;
  panelRenderers?: ThemePanelRenderers;
  /**
   * @deprecated 使用 primaryWorkspaceRenderer
   */
  workspaceRenderer?: ComponentType<ThemeWorkspaceRendererProps>;
}
