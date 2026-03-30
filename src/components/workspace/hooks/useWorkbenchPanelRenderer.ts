import { useMemo } from "react";
import type {
  ThemePanelRenderers,
  ThemeWorkspaceView,
} from "@/features/themes/types";

export interface UseWorkbenchPanelRendererParams {
  activeWorkspaceView: ThemeWorkspaceView;
  panelRenderers?: ThemePanelRenderers;
}

export function useWorkbenchPanelRenderer({
  activeWorkspaceView,
  panelRenderers,
}: UseWorkbenchPanelRendererParams) {
  const activePanelRenderer = useMemo(() => {
    if (!panelRenderers) {
      return null;
    }
    switch (activeWorkspaceView) {
      case "workflow":
        return panelRenderers.workflow ?? null;
      case "material":
        return panelRenderers.material ?? null;
      case "publish":
        return panelRenderers.publish ?? null;
      case "settings":
        return panelRenderers.settings ?? null;
      default:
        return null;
    }
  }, [activeWorkspaceView, panelRenderers]);

  return {
    activePanelRenderer,
  };
}

export default useWorkbenchPanelRenderer;
