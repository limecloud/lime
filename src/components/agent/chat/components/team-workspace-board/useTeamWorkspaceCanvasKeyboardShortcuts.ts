import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  isEditableTeamWorkspaceCanvasKeyboardTarget,
  TEAM_WORKSPACE_CANVAS_KEYBOARD_FAST_PAN_STEP,
  TEAM_WORKSPACE_CANVAS_KEYBOARD_PAN_STEP,
  type TeamWorkspaceCanvasLayoutState,
} from "../../utils/teamWorkspaceCanvas";

interface UseTeamWorkspaceCanvasKeyboardShortcutsParams {
  canvasLaneCount: number;
  handleAutoArrangeCanvas: () => void;
  handleFitCanvasView: () => void;
  handleResetCanvasView: () => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  isCanvasPanModifierActive: boolean;
  setIsCanvasPanModifierActive: Dispatch<SetStateAction<boolean>>;
  updateCanvasViewport: (
    updater: (
      viewport: TeamWorkspaceCanvasLayoutState["viewport"],
    ) => TeamWorkspaceCanvasLayoutState["viewport"],
  ) => void;
}

export function useTeamWorkspaceCanvasKeyboardShortcuts({
  canvasLaneCount,
  handleAutoArrangeCanvas,
  handleFitCanvasView,
  handleResetCanvasView,
  handleZoomIn,
  handleZoomOut,
  isCanvasPanModifierActive,
  setIsCanvasPanModifierActive,
  updateCanvasViewport,
}: UseTeamWorkspaceCanvasKeyboardShortcutsParams) {
  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (isEditableTeamWorkspaceCanvasKeyboardTarget(event.target)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        if (!isCanvasPanModifierActive) {
          setIsCanvasPanModifierActive(true);
        }
        return;
      }

      if (event.repeat) {
        return;
      }

      const normalizedKey = event.key.toLowerCase();
      if (normalizedKey === "a") {
        event.preventDefault();
        handleAutoArrangeCanvas();
        return;
      }
      if (normalizedKey === "f") {
        event.preventDefault();
        handleFitCanvasView();
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        handleResetCanvasView();
        return;
      }
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        handleZoomIn();
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        handleZoomOut();
        return;
      }

      if (canvasLaneCount === 0) {
        return;
      }

      const keyboardPanStep = event.shiftKey
        ? TEAM_WORKSPACE_CANVAS_KEYBOARD_FAST_PAN_STEP
        : TEAM_WORKSPACE_CANVAS_KEYBOARD_PAN_STEP;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        updateCanvasViewport((viewport) => ({
          ...viewport,
          x: viewport.x + keyboardPanStep,
        }));
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        updateCanvasViewport((viewport) => ({
          ...viewport,
          x: viewport.x - keyboardPanStep,
        }));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        updateCanvasViewport((viewport) => ({
          ...viewport,
          y: viewport.y + keyboardPanStep,
        }));
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        updateCanvasViewport((viewport) => ({
          ...viewport,
          y: viewport.y - keyboardPanStep,
        }));
      }
    };

    const handleWindowKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setIsCanvasPanModifierActive(false);
      }
    };

    const handleWindowBlur = () => {
      setIsCanvasPanModifierActive(false);
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    window.addEventListener("keyup", handleWindowKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
      window.removeEventListener("keyup", handleWindowKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
    canvasLaneCount,
    handleAutoArrangeCanvas,
    handleFitCanvasView,
    handleResetCanvasView,
    handleZoomIn,
    handleZoomOut,
    isCanvasPanModifierActive,
    setIsCanvasPanModifierActive,
    updateCanvasViewport,
  ]);
}
