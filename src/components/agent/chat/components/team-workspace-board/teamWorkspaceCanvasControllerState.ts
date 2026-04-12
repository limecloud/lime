import {
  buildDefaultTeamWorkspaceCanvasItemLayout,
  clampTeamWorkspaceCanvasZoom,
  TEAM_WORKSPACE_CANVAS_MIN_HEIGHT,
  TEAM_WORKSPACE_CANVAS_MIN_WIDTH,
  type TeamWorkspaceCanvasItemLayout,
  type TeamWorkspaceCanvasLayoutState,
} from "../../utils/teamWorkspaceCanvas";

export function updateTeamWorkspaceCanvasViewportState(
  previous: TeamWorkspaceCanvasLayoutState,
  updater: (
    viewport: TeamWorkspaceCanvasLayoutState["viewport"],
  ) => TeamWorkspaceCanvasLayoutState["viewport"],
): TeamWorkspaceCanvasLayoutState {
  const nextViewport = updater(previous.viewport);
  if (
    nextViewport.x === previous.viewport.x &&
    nextViewport.y === previous.viewport.y &&
    nextViewport.zoom === previous.viewport.zoom
  ) {
    return previous;
  }

  return {
    ...previous,
    updatedAt: Date.now(),
    viewport: {
      x: nextViewport.x,
      y: nextViewport.y,
      zoom: clampTeamWorkspaceCanvasZoom(nextViewport.zoom),
    },
  };
}

export function updateTeamWorkspaceCanvasLaneLayoutState(
  previous: TeamWorkspaceCanvasLayoutState,
  persistKey: string,
  updater: (
    current: TeamWorkspaceCanvasItemLayout,
  ) => TeamWorkspaceCanvasItemLayout,
): TeamWorkspaceCanvasLayoutState {
  const current =
    previous.items[persistKey] ?? buildDefaultTeamWorkspaceCanvasItemLayout(0);
  const next = updater(current);

  if (
    next.x === current.x &&
    next.y === current.y &&
    next.width === current.width &&
    next.height === current.height &&
    next.zIndex === current.zIndex
  ) {
    return previous;
  }

  return {
    ...previous,
    updatedAt: Date.now(),
    items: {
      ...previous.items,
      [persistKey]: {
        x: next.x,
        y: next.y,
        width: Math.max(TEAM_WORKSPACE_CANVAS_MIN_WIDTH, next.width),
        height: Math.max(TEAM_WORKSPACE_CANVAS_MIN_HEIGHT, next.height),
        zIndex: Math.max(1, next.zIndex),
      },
    },
  };
}

export function bringTeamWorkspaceCanvasLaneToFront(
  previous: TeamWorkspaceCanvasLayoutState,
  persistKey: string,
): TeamWorkspaceCanvasLayoutState {
  const target = previous.items[persistKey];
  if (!target) {
    return previous;
  }

  const maxZIndex = Math.max(
    1,
    ...Object.values(previous.items).map((item) => item.zIndex),
  );
  if (target.zIndex >= maxZIndex) {
    return previous;
  }

  return {
    ...previous,
    updatedAt: Date.now(),
    items: {
      ...previous.items,
      [persistKey]: {
        ...target,
        zIndex: maxZIndex + 1,
      },
    },
  };
}
