import type { TeamWorkspaceCanvasLane } from "./canvasLaneSelectors";
import {
  buildDefaultTeamWorkspaceCanvasItemLayout,
  buildTeamWorkspaceCanvasAutoLayout,
  clampTeamWorkspaceCanvasZoom,
  TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_X,
  TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_Y,
  TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING,
  resolveCanvasLanePreferredSize,
  type TeamWorkspaceCanvasBounds,
  type TeamWorkspaceCanvasItemLayout,
  type TeamWorkspaceCanvasViewport,
} from "../utils/teamWorkspaceCanvas";

const CANVAS_AUTO_LAYOUT_OFFSET_X = 64;
const CANVAS_AUTO_LAYOUT_OFFSET_Y = 76;

function isExpandedSessionLane(
  lane: TeamWorkspaceCanvasLane,
  expandedSessionId?: string | null,
): boolean {
  return (
    lane.kind === "session" &&
    lane.session?.id != null &&
    lane.session.id === expandedSessionId
  );
}

function resolveLanePreferredSize(params: {
  lane: TeamWorkspaceCanvasLane;
  laneCount: number;
  viewportWidth: number;
  expandedSessionId?: string | null;
}): Pick<TeamWorkspaceCanvasItemLayout, "width" | "height"> {
  return resolveCanvasLanePreferredSize({
    laneKind: params.lane.kind,
    laneCount: params.laneCount,
    viewportWidth: params.viewportWidth,
    expanded: isExpandedSessionLane(params.lane, params.expandedSessionId),
  });
}

function resolveCanvasAutoLayoutOptions(params: {
  viewportWidth: number;
  zoom?: number;
}) {
  return {
    maxRowWidth: Math.max(
      820,
      params.viewportWidth / Math.max(params.zoom ?? 1, 0.1) -
        TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING * 2,
    ),
    offsetX: CANVAS_AUTO_LAYOUT_OFFSET_X,
    offsetY: CANVAS_AUTO_LAYOUT_OFFSET_Y,
    gapX: TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_X,
    gapY: TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_Y,
    centerRows: true,
  } as const;
}

export function resolveTeamWorkspaceCanvasAutoLayoutViewportWidth(params: {
  embedded: boolean;
  viewportWidth: number;
}): number {
  return params.embedded
    ? Math.max(params.viewportWidth, 1240)
    : Math.max(params.viewportWidth, 1080);
}

export function buildInitializedTeamWorkspaceCanvasItems(params: {
  lanes: TeamWorkspaceCanvasLane[];
  existingItems: Record<string, TeamWorkspaceCanvasItemLayout>;
  viewportWidth: number;
}): Record<string, TeamWorkspaceCanvasItemLayout> | null {
  const { lanes, existingItems, viewportWidth } = params;
  let changed = false;
  const nextItems = { ...existingItems };
  const hasStoredItems = Object.keys(existingItems).length > 0;

  lanes.forEach((lane, index) => {
    if (nextItems[lane.persistKey]) {
      return;
    }

    const fallbackLayout = lane.fallbackPersistKeys
      .map((key) => nextItems[key])
      .find(Boolean);
    const preferredSize = resolveLanePreferredSize({
      lane,
      laneCount: lanes.length,
      viewportWidth,
    });
    nextItems[lane.persistKey] = fallbackLayout
      ? {
          ...fallbackLayout,
          width: preferredSize.width,
          height: preferredSize.height,
        }
      : buildDefaultTeamWorkspaceCanvasItemLayout(index, {
          width: preferredSize.width,
          height: preferredSize.height,
        });
    changed = true;
  });

  if (!changed) {
    return null;
  }

  if (hasStoredItems) {
    return nextItems;
  }

  return {
    ...nextItems,
    ...buildTeamWorkspaceCanvasAutoLayout(
      lanes.map((lane, index) => ({
        persistKey: lane.persistKey,
        layout:
          nextItems[lane.persistKey] ??
          buildDefaultTeamWorkspaceCanvasItemLayout(index),
      })),
      resolveCanvasAutoLayoutOptions({
        viewportWidth,
      }),
    ),
  };
}

export function buildTeamWorkspaceCanvasLaneLayouts(params: {
  lanes: TeamWorkspaceCanvasLane[];
  storedItems: Record<string, TeamWorkspaceCanvasItemLayout>;
  viewportWidth: number;
  expandedSessionId?: string | null;
}): Record<string, TeamWorkspaceCanvasItemLayout> {
  const { lanes, storedItems, viewportWidth, expandedSessionId } = params;

  return Object.fromEntries(
    lanes.map((lane, index) => {
      const baseLayout =
        storedItems[lane.persistKey] ??
        buildDefaultTeamWorkspaceCanvasItemLayout(index);

      if (!isExpandedSessionLane(lane, expandedSessionId)) {
        return [lane.persistKey, baseLayout];
      }

      const expandedHeight = resolveLanePreferredSize({
        lane,
        laneCount: lanes.length,
        viewportWidth,
        expandedSessionId,
      }).height;

      return [
        lane.persistKey,
        {
          ...baseLayout,
          height: Math.max(baseLayout.height, expandedHeight),
        },
      ];
    }),
  );
}

export function buildAutoArrangedTeamWorkspaceCanvasItems(params: {
  lanes: TeamWorkspaceCanvasLane[];
  currentItems: Record<string, TeamWorkspaceCanvasItemLayout>;
  viewportWidth: number;
  zoom: number;
  expandedSessionId?: string | null;
}): Record<string, TeamWorkspaceCanvasItemLayout> {
  const { lanes, currentItems, viewportWidth, zoom, expandedSessionId } =
    params;

  return buildTeamWorkspaceCanvasAutoLayout(
    lanes.map((lane, index) => ({
      persistKey: lane.persistKey,
      layout: {
        ...(currentItems[lane.persistKey] ??
          buildDefaultTeamWorkspaceCanvasItemLayout(index)),
        ...resolveLanePreferredSize({
          lane,
          laneCount: lanes.length,
          viewportWidth,
          expandedSessionId,
        }),
      },
    })),
    resolveCanvasAutoLayoutOptions({
      viewportWidth,
      zoom,
    }),
  );
}

export function resolveTeamWorkspaceCanvasFitViewport(params: {
  bounds: TeamWorkspaceCanvasBounds;
  viewportWidth: number;
  viewportHeight: number;
}): TeamWorkspaceCanvasViewport {
  const { bounds, viewportWidth, viewportHeight } = params;
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  const usableWidth = Math.max(
    200,
    viewportWidth - TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING * 2,
  );
  const usableHeight = Math.max(
    200,
    viewportHeight - TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING * 2,
  );
  const zoom = clampTeamWorkspaceCanvasZoom(
    Math.min(usableWidth / contentWidth, usableHeight / contentHeight, 1.08),
  );

  return {
    x:
      TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING +
      (viewportWidth - contentWidth * zoom) / 2 -
      bounds.minX * zoom,
    y:
      TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING +
      (viewportHeight - contentHeight * zoom) / 2 -
      bounds.minY * zoom,
    zoom,
  };
}
