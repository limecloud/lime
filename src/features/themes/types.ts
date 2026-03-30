import type { WorkspaceTheme } from "@/types/page";
import type { ComponentType } from "react";
import type { CreationMode } from "@/lib/workspace/workbenchContract";

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

export interface NovelQuickCreateOptions {
  category: "long" | "short" | "book-analysis";
  projectName: string;
  autoCreateContent?: boolean;
  contentTitle?: string;
  initialUserPrompt?: string;
  creationMode?: CreationMode;
}

export interface NovelQuickCreateResult {
  projectId: string;
  contentId: string;
}

export interface OpenProjectWritingOptions {
  fallbackContentTitle?: string;
  initialUserPrompt?: string;
  creationMode?: CreationMode;
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
  onQuickCreateNovelEntry?: (
    options: NovelQuickCreateOptions,
  ) => Promise<NovelQuickCreateResult>;
  onOpenProjectWriting?: (
    projectId: string,
    options?: OpenProjectWritingOptions,
  ) => Promise<string>;
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
