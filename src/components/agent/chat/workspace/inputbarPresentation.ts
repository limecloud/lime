import type { ComponentProps } from "react";
import { Inputbar } from "../components/Inputbar";
import { TeamWorkspaceDock } from "../components/TeamWorkspaceDock";
import type { TeamWorkbenchSurfaceProps } from "./teamWorkbenchPresentation";

interface BuildFloatingTeamWorkspaceDockPropsParams {
  enabled: boolean;
  layoutMode: "chat" | "chat-canvas";
  showFloatingInputOverlay: boolean;
  onActivateWorkbench: NonNullable<
    ComponentProps<typeof TeamWorkspaceDock>["onActivateWorkbench"]
  >;
  surfaceProps: TeamWorkbenchSurfaceProps;
}

export function buildFloatingTeamWorkspaceDockProps({
  enabled,
  layoutMode,
  showFloatingInputOverlay,
  onActivateWorkbench,
  surfaceProps,
}: BuildFloatingTeamWorkspaceDockPropsParams): ComponentProps<
  typeof TeamWorkspaceDock
> | null {
  if (!enabled || !showFloatingInputOverlay || layoutMode !== "chat") {
    return null;
  }

  return {
    placement: "inline",
    onActivateWorkbench,
    ...surfaceProps,
  };
}

export function buildWorkspaceInputbarProps(
  params: Omit<ComponentProps<typeof Inputbar>, "overlayAccessory">,
): Omit<ComponentProps<typeof Inputbar>, "overlayAccessory"> {
  return params;
}
