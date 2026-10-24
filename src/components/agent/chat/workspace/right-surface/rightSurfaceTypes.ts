import type { ReactNode } from "react";
import type { ThreadSidePanelTab } from "./threadSidePanelTabs";

export type WorkspaceRightSurfaceKind =
  | "workbench"
  | "appSurface"
  | "articleWorkspace"
  | "expertInfo"
  | "browser"
  | "files"
  | "changes"
  | "workspace-new-tab"
  | "shell"
  | "background-terminal"
  | "harness";

export type WorkspaceRightSurfaceSource = "user" | "route" | "runtime";

export type WorkspaceRightSurfaceLayoutVariant =
  | "docked"
  | "expanded"
  | "canvasFirst";

export interface WorkspaceRightSurfaceState {
  activeSurface: WorkspaceRightSurfaceKind | null;
  previousSurface: WorkspaceRightSurfaceKind | null;
  openSurfaces: readonly WorkspaceRightSurfaceKind[];
  source: WorkspaceRightSurfaceSource;
  layoutVariant: WorkspaceRightSurfaceLayoutVariant;
}

export interface RightSurfaceRenderInput {
  activeSurface: WorkspaceRightSurfaceKind | null;
  tab: ThreadSidePanelTab;
}

export interface RightSurfaceDefinition {
  kind: WorkspaceRightSurfaceKind;
  label?: string | null;
  render(input: RightSurfaceRenderInput): ReactNode;
}

export function normalizeWorkspaceRightSurfaceKind(
  value?: string | null,
): WorkspaceRightSurfaceKind | null {
  const normalized = value?.trim();
  switch (normalized) {
    case "workbench":
    case "appSurface":
    case "articleWorkspace":
    case "expertInfo":
    case "browser":
    case "files":
    case "changes":
    case "workspace-new-tab":
    case "shell":
    case "background-terminal":
    case "harness":
      return normalized;
    default:
      return null;
  }
}
