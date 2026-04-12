import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  buildAutoArrangedTeamWorkspaceCanvasItems,
  resolveTeamWorkspaceCanvasFitViewport,
} from "../../team-workspace-runtime/canvasLayoutSelectors";
import type { TeamWorkspaceCanvasLane } from "../../team-workspace-runtime/canvasLaneSelectors";
import {
  canStartTeamWorkspaceCanvasPanGesture,
  clampTeamWorkspaceCanvasZoom,
  createDefaultTeamWorkspaceCanvasLayoutState,
  TEAM_WORKSPACE_CANVAS_MAX_ZOOM,
  TEAM_WORKSPACE_CANVAS_MIN_HEIGHT,
  TEAM_WORKSPACE_CANVAS_MIN_WIDTH,
  TEAM_WORKSPACE_CANVAS_MIN_ZOOM,
  type TeamWorkspaceCanvasBounds,
  type TeamWorkspaceCanvasItemLayout,
  type TeamWorkspaceCanvasLayoutState,
} from "../../utils/teamWorkspaceCanvas";
import type { TeamWorkspaceCanvasResizeDirection } from "./TeamWorkspaceCanvasLaneCard";
import { useTeamWorkspaceCanvasKeyboardShortcuts } from "./useTeamWorkspaceCanvasKeyboardShortcuts";

interface UseTeamWorkspaceCanvasInteractionHandlersParams {
  bringCanvasLaneToFront: (persistKey: string) => void;
  canvasAutoLayoutViewportWidth: number;
  canvasBounds: TeamWorkspaceCanvasBounds;
  canvasLanes: TeamWorkspaceCanvasLane[];
  canvasLaneLayoutsRef: MutableRefObject<
    Record<string, TeamWorkspaceCanvasItemLayout>
  >;
  canvasLayoutStateRef: MutableRefObject<TeamWorkspaceCanvasLayoutState>;
  canvasViewportRef: RefObject<HTMLDivElement | null>;
  expandedSessionId?: string | null;
  onSelectSession: (sessionId: string) => void;
  setCanvasLayoutState: Dispatch<SetStateAction<TeamWorkspaceCanvasLayoutState>>;
  updateCanvasLaneLayout: (
    persistKey: string,
    updater: (
      current: TeamWorkspaceCanvasItemLayout,
    ) => TeamWorkspaceCanvasItemLayout,
  ) => void;
  updateCanvasViewport: (
    updater: (
      viewport: TeamWorkspaceCanvasLayoutState["viewport"],
    ) => TeamWorkspaceCanvasLayoutState["viewport"],
  ) => void;
}

export function useTeamWorkspaceCanvasInteractionHandlers({
  bringCanvasLaneToFront,
  canvasAutoLayoutViewportWidth,
  canvasBounds,
  canvasLanes,
  canvasLaneLayoutsRef,
  canvasLayoutStateRef,
  canvasViewportRef,
  expandedSessionId = null,
  onSelectSession,
  setCanvasLayoutState,
  updateCanvasLaneLayout,
  updateCanvasViewport,
}: UseTeamWorkspaceCanvasInteractionHandlersParams) {
  const [isCanvasPanModifierActive, setIsCanvasPanModifierActive] =
    useState(false);
  const canvasInteractionCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      canvasInteractionCleanupRef.current?.();
      canvasInteractionCleanupRef.current = null;
    };
  }, []);

  const bindCanvasMouseInteraction = useCallback(
    (onMove: (event: MouseEvent) => void, onEnd?: () => void) => {
      canvasInteractionCleanupRef.current?.();

      const handleMouseMove = (event: MouseEvent) => {
        onMove(event);
      };
      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        canvasInteractionCleanupRef.current = null;
        onEnd?.();
      };

      canvasInteractionCleanupRef.current = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [],
  );

  const handleStartCanvasPan = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (
        !canStartTeamWorkspaceCanvasPanGesture(
          event.target,
          event.currentTarget,
          isCanvasPanModifierActive,
        )
      ) {
        return;
      }

      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startViewport = canvasLayoutStateRef.current.viewport;

      bindCanvasMouseInteraction((moveEvent) => {
        updateCanvasViewport(() => ({
          x: startViewport.x + (moveEvent.clientX - startX),
          y: startViewport.y + (moveEvent.clientY - startY),
          zoom: startViewport.zoom,
        }));
      });
    },
    [
      bindCanvasMouseInteraction,
      canvasLayoutStateRef,
      isCanvasPanModifierActive,
      updateCanvasViewport,
    ],
  );

  const handleStartCanvasLaneDrag = useCallback(
    (persistKey: string, event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const startLayout =
        canvasLaneLayoutsRef.current[persistKey] ??
        canvasLayoutStateRef.current.items[persistKey];
      if (!startLayout) {
        return;
      }

      const zoom = canvasLayoutStateRef.current.viewport.zoom;
      const startX = event.clientX;
      const startY = event.clientY;
      bringCanvasLaneToFront(persistKey);

      bindCanvasMouseInteraction((moveEvent) => {
        const deltaX = (moveEvent.clientX - startX) / zoom;
        const deltaY = (moveEvent.clientY - startY) / zoom;
        updateCanvasLaneLayout(persistKey, (current) => ({
          ...current,
          x: startLayout.x + deltaX,
          y: startLayout.y + deltaY,
        }));
      });
    },
    [
      bindCanvasMouseInteraction,
      bringCanvasLaneToFront,
      canvasLaneLayoutsRef,
      canvasLayoutStateRef,
      updateCanvasLaneLayout,
    ],
  );

  const handleStartCanvasLaneResize = useCallback(
    (
      persistKey: string,
      direction: TeamWorkspaceCanvasResizeDirection,
      event: ReactMouseEvent<HTMLSpanElement>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const startLayout =
        canvasLaneLayoutsRef.current[persistKey] ??
        canvasLayoutStateRef.current.items[persistKey];
      if (!startLayout) {
        return;
      }

      const zoom = canvasLayoutStateRef.current.viewport.zoom;
      const startX = event.clientX;
      const startY = event.clientY;
      bringCanvasLaneToFront(persistKey);

      bindCanvasMouseInteraction((moveEvent) => {
        const deltaX = (moveEvent.clientX - startX) / zoom;
        const deltaY = (moveEvent.clientY - startY) / zoom;

        updateCanvasLaneLayout(persistKey, (current) => {
          let nextX = startLayout.x;
          let nextY = startLayout.y;
          let nextWidth = startLayout.width;
          let nextHeight = startLayout.height;

          if (direction.includes("e")) {
            nextWidth = Math.max(
              TEAM_WORKSPACE_CANVAS_MIN_WIDTH,
              startLayout.width + deltaX,
            );
          }
          if (direction.includes("s")) {
            nextHeight = Math.max(
              TEAM_WORKSPACE_CANVAS_MIN_HEIGHT,
              startLayout.height + deltaY,
            );
          }
          if (direction.includes("w")) {
            nextWidth = Math.max(
              TEAM_WORKSPACE_CANVAS_MIN_WIDTH,
              startLayout.width - deltaX,
            );
            nextX = startLayout.x + (startLayout.width - nextWidth);
          }
          if (direction.includes("n")) {
            nextHeight = Math.max(
              TEAM_WORKSPACE_CANVAS_MIN_HEIGHT,
              startLayout.height - deltaY,
            );
            nextY = startLayout.y + (startLayout.height - nextHeight);
          }

          return {
            ...current,
            x: nextX,
            y: nextY,
            width: nextWidth,
            height: nextHeight,
          };
        });
      });
    },
    [
      bindCanvasMouseInteraction,
      bringCanvasLaneToFront,
      canvasLaneLayoutsRef,
      canvasLayoutStateRef,
      updateCanvasLaneLayout,
    ],
  );

  const handleCanvasWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.08 : 0.08;
      updateCanvasViewport((viewport) => ({
        ...viewport,
        zoom: clampTeamWorkspaceCanvasZoom(viewport.zoom + delta),
      }));
    },
    [updateCanvasViewport],
  );

  const handleZoomIn = useCallback(() => {
    updateCanvasViewport((viewport) => ({
      ...viewport,
      zoom: Math.min(
        TEAM_WORKSPACE_CANVAS_MAX_ZOOM,
        clampTeamWorkspaceCanvasZoom(viewport.zoom + 0.12),
      ),
    }));
  }, [updateCanvasViewport]);

  const handleZoomOut = useCallback(() => {
    updateCanvasViewport((viewport) => ({
      ...viewport,
      zoom: Math.max(
        TEAM_WORKSPACE_CANVAS_MIN_ZOOM,
        clampTeamWorkspaceCanvasZoom(viewport.zoom - 0.12),
      ),
    }));
  }, [updateCanvasViewport]);

  const handleResetCanvasView = useCallback(() => {
    updateCanvasViewport(
      () => createDefaultTeamWorkspaceCanvasLayoutState().viewport,
    );
  }, [updateCanvasViewport]);

  const handleAutoArrangeCanvas = useCallback(() => {
    if (canvasLanes.length === 0) {
      return;
    }

    setCanvasLayoutState((previous) => {
      const nextItems = buildAutoArrangedTeamWorkspaceCanvasItems({
        lanes: canvasLanes,
        currentItems: previous.items,
        viewportWidth: canvasAutoLayoutViewportWidth,
        zoom: previous.viewport.zoom,
        expandedSessionId,
      });

      return {
        ...previous,
        updatedAt: Date.now(),
        viewport: createDefaultTeamWorkspaceCanvasLayoutState().viewport,
        items: {
          ...previous.items,
          ...nextItems,
        },
      };
    });
  }, [
    canvasAutoLayoutViewportWidth,
    canvasLanes,
    expandedSessionId,
    setCanvasLayoutState,
  ]);

  const handleFitCanvasView = useCallback(() => {
    const viewportRect = canvasViewportRef.current?.getBoundingClientRect();
    if (!viewportRect || canvasLanes.length === 0) {
      return;
    }

    updateCanvasViewport(() =>
      resolveTeamWorkspaceCanvasFitViewport({
        bounds: canvasBounds,
        viewportWidth: viewportRect.width,
        viewportHeight: viewportRect.height,
      }),
    );
  }, [canvasBounds, canvasLanes.length, canvasViewportRef, updateCanvasViewport]);

  useTeamWorkspaceCanvasKeyboardShortcuts({
    canvasLaneCount: canvasLanes.length,
    handleAutoArrangeCanvas,
    handleFitCanvasView,
    handleResetCanvasView,
    handleZoomIn,
    handleZoomOut,
    isCanvasPanModifierActive,
    setIsCanvasPanModifierActive,
    updateCanvasViewport,
  });

  const handleSelectCanvasLane = useCallback(
    (lane: TeamWorkspaceCanvasLane) => {
      bringCanvasLaneToFront(lane.persistKey);
      if (lane.session) {
        onSelectSession(lane.session.id);
      }
    },
    [bringCanvasLaneToFront, onSelectSession],
  );

  return {
    handleAutoArrangeCanvas,
    handleCanvasWheel,
    handleFitCanvasView,
    handleResetCanvasView,
    handleSelectCanvasLane,
    handleStartCanvasLaneDrag,
    handleStartCanvasLaneResize,
    handleStartCanvasPan,
    handleZoomIn,
    handleZoomOut,
    isCanvasPanModifierActive,
  };
}
