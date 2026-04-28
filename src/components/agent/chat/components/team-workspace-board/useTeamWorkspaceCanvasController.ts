import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  buildInitializedTeamWorkspaceCanvasItems,
  buildTeamWorkspaceCanvasLaneLayouts,
  resolveTeamWorkspaceCanvasAutoLayoutViewportWidth,
} from "../../team-workspace-runtime/canvasLayoutSelectors";
import type { TeamWorkspaceCanvasLane } from "../../team-workspace-runtime/canvasLaneSelectors";
import {
  createDefaultTeamWorkspaceCanvasLayoutState,
  loadTeamWorkspaceCanvasLayout,
  persistTeamWorkspaceCanvasLayout,
  resolveCanvasLaneBounds,
  resolveCanvasViewportMetrics,
  type TeamWorkspaceCanvasItemLayout,
  type TeamWorkspaceCanvasLayoutState,
} from "../../utils/teamWorkspaceCanvas";
import {
  bringTeamWorkspaceCanvasLaneToFront,
  updateTeamWorkspaceCanvasLaneLayoutState,
  updateTeamWorkspaceCanvasViewportState,
} from "./teamWorkspaceCanvasControllerState";
import { useTeamWorkspaceCanvasInteractionHandlers } from "./useTeamWorkspaceCanvasInteractionHandlers";

interface UseTeamWorkspaceCanvasControllerParams {
  canvasLanes: TeamWorkspaceCanvasLane[];
  canvasStorageScopeId: string;
  canvasViewportFallbackHeight: number;
  embedded: boolean;
  expandedSessionId?: string | null;
  onSelectSession: (sessionId: string) => void;
}

export function useTeamWorkspaceCanvasController({
  canvasLanes,
  canvasStorageScopeId,
  canvasViewportFallbackHeight,
  embedded,
  expandedSessionId = null,
  onSelectSession,
}: UseTeamWorkspaceCanvasControllerParams) {
  const [canvasLayoutState, setCanvasLayoutState] =
    useState<TeamWorkspaceCanvasLayoutState>(
      () =>
        loadTeamWorkspaceCanvasLayout(canvasStorageScopeId) ??
        createDefaultTeamWorkspaceCanvasLayoutState(),
    );
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const [canvasViewportMetrics, setCanvasViewportMetrics] = useState<{
    width: number;
    height: number;
  }>({
    width: 960,
    height: canvasViewportFallbackHeight,
  });
  const canvasLayoutStateRef =
    useRef<TeamWorkspaceCanvasLayoutState>(canvasLayoutState);
  const canvasLaneLayoutsRef = useRef<
    Record<string, TeamWorkspaceCanvasItemLayout>
  >({});

  useEffect(() => {
    canvasLayoutStateRef.current = canvasLayoutState;
  }, [canvasLayoutState]);

  useEffect(() => {
    setCanvasLayoutState(
      loadTeamWorkspaceCanvasLayout(canvasStorageScopeId) ??
        createDefaultTeamWorkspaceCanvasLayoutState(),
    );
  }, [canvasStorageScopeId]);

  useEffect(() => {
    persistTeamWorkspaceCanvasLayout(canvasStorageScopeId, canvasLayoutState);
  }, [canvasLayoutState, canvasStorageScopeId]);

  useEffect(() => {
    const syncCanvasViewportMetrics = () => {
      setCanvasViewportMetrics(
        resolveCanvasViewportMetrics(
          canvasViewportRef.current,
          canvasViewportFallbackHeight,
        ),
      );
    };

    syncCanvasViewportMetrics();
    window.addEventListener("resize", syncCanvasViewportMetrics);

    return () => {
      window.removeEventListener("resize", syncCanvasViewportMetrics);
    };
  }, [canvasViewportFallbackHeight]);

  const canvasAutoLayoutViewportWidth =
    resolveTeamWorkspaceCanvasAutoLayoutViewportWidth({
      embedded,
      viewportWidth: canvasViewportMetrics.width,
    });

  const updateCanvasViewport = useCallback(
    (
      updater: (
        viewport: TeamWorkspaceCanvasLayoutState["viewport"],
      ) => TeamWorkspaceCanvasLayoutState["viewport"],
    ) => {
      setCanvasLayoutState((previous) =>
        updateTeamWorkspaceCanvasViewportState(previous, updater),
      );
    },
    [],
  );

  const updateCanvasLaneLayout = useCallback(
    (
      persistKey: string,
      updater: (
        current: TeamWorkspaceCanvasItemLayout,
      ) => TeamWorkspaceCanvasItemLayout,
    ) => {
      setCanvasLayoutState((previous) =>
        updateTeamWorkspaceCanvasLaneLayoutState(previous, persistKey, updater),
      );
    },
    [],
  );

  const bringCanvasLaneToFront = useCallback((persistKey: string) => {
    setCanvasLayoutState((previous) =>
      bringTeamWorkspaceCanvasLaneToFront(previous, persistKey),
    );
  }, []);

  useEffect(() => {
    if (canvasLanes.length === 0) {
      return;
    }

    setCanvasLayoutState((previous) => {
      const nextItems = buildInitializedTeamWorkspaceCanvasItems({
        lanes: canvasLanes,
        existingItems: previous.items,
        viewportWidth: canvasAutoLayoutViewportWidth,
      });

      if (!nextItems) {
        return previous;
      }

      return {
        ...previous,
        updatedAt: Date.now(),
        items: nextItems,
      };
    });
  }, [canvasAutoLayoutViewportWidth, canvasLanes]);

  const canvasLaneLayouts = useMemo(
    () =>
      buildTeamWorkspaceCanvasLaneLayouts({
        lanes: canvasLanes,
        storedItems: canvasLayoutState.items,
        viewportWidth: canvasAutoLayoutViewportWidth,
        expandedSessionId,
      }),
    [
      canvasAutoLayoutViewportWidth,
      canvasLanes,
      canvasLayoutState.items,
      expandedSessionId,
    ],
  );

  useEffect(() => {
    canvasLaneLayoutsRef.current = canvasLaneLayouts;
  }, [canvasLaneLayouts]);

  const canvasBounds = useMemo(
    () => resolveCanvasLaneBounds(Object.values(canvasLaneLayouts)),
    [canvasLaneLayouts],
  );
  const {
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
  } = useTeamWorkspaceCanvasInteractionHandlers({
    bringCanvasLaneToFront,
    canvasAutoLayoutViewportWidth,
    canvasBounds,
    canvasLanes,
    canvasLaneLayoutsRef,
    canvasLayoutStateRef,
    canvasViewportRef,
    expandedSessionId,
    onSelectSession,
    setCanvasLayoutState,
    updateCanvasLaneLayout,
    updateCanvasViewport,
  });

  return {
    canvasBounds,
    canvasLaneLayouts,
    canvasViewportRef,
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
    viewport: canvasLayoutState.viewport,
    zoom: canvasLayoutState.viewport.zoom,
  };
}
