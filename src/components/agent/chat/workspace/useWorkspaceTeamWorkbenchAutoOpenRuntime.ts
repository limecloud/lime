import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";

interface UseWorkspaceTeamWorkbenchAutoOpenRuntimeParams {
  hasRealTeamGraph: boolean;
  layoutMode: LayoutMode;
  runtimeTeamRequestId: string | null;
  sessionId?: string | null;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
}

export function useWorkspaceTeamWorkbenchAutoOpenRuntime({
  setLayoutMode,
}: UseWorkspaceTeamWorkbenchAutoOpenRuntimeParams) {
  const [teamWorkbenchAutoFocusToken, setTeamWorkbenchAutoFocusToken] =
    useState(0);
  const dismissActiveTeamWorkbenchAutoOpen = useCallback(() => {}, []);

  const handleActivateTeamWorkbench = useCallback(() => {
    setTeamWorkbenchAutoFocusToken((current) => current + 1);
    setLayoutMode((current) => (current === "chat" ? "chat-canvas" : current));
  }, [setLayoutMode]);

  return {
    teamWorkbenchAutoFocusToken,
    dismissActiveTeamWorkbenchAutoOpen,
    handleActivateTeamWorkbench,
  };
}
