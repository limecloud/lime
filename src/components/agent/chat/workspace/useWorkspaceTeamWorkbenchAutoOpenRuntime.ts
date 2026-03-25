import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { LayoutMode } from "@/components/content-creator/types";

interface UseWorkspaceTeamWorkbenchAutoOpenRuntimeParams {
  hasRealTeamGraph: boolean;
  layoutMode: LayoutMode;
  runtimeTeamRequestId: string | null;
  sessionId?: string | null;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
}

export function useWorkspaceTeamWorkbenchAutoOpenRuntime({
  hasRealTeamGraph,
  layoutMode,
  runtimeTeamRequestId,
  sessionId,
  setLayoutMode,
}: UseWorkspaceTeamWorkbenchAutoOpenRuntimeParams) {
  const [teamWorkbenchAutoFocusToken, setTeamWorkbenchAutoFocusToken] =
    useState(0);
  const previousTeamWorkbenchSessionIdRef = useRef<string | null>(
    sessionId ?? null,
  );
  const previousRealTeamGraphRef = useRef(hasRealTeamGraph);
  const previousTeamWorkbenchLayoutModeRef = useRef<LayoutMode>(layoutMode);
  const previousRuntimeTeamRequestIdRef = useRef<string | null>(
    runtimeTeamRequestId,
  );
  const suppressedAutoOpenRef = useRef(false);
  const suppressedRuntimeTeamRequestIdRef = useRef<string | null>(null);

  const dismissActiveTeamWorkbenchAutoOpen = useCallback(() => {
    suppressedAutoOpenRef.current = true;
    if (runtimeTeamRequestId) {
      suppressedRuntimeTeamRequestIdRef.current = runtimeTeamRequestId;
    }
  }, [runtimeTeamRequestId]);

  const handleActivateTeamWorkbench = useCallback(() => {
    setTeamWorkbenchAutoFocusToken((current) => current + 1);
    setLayoutMode((current) => (current === "chat" ? "chat-canvas" : current));
  }, [setLayoutMode]);

  useEffect(() => {
    const previousLayoutMode = previousTeamWorkbenchLayoutModeRef.current;

    if (previousLayoutMode !== "chat" && layoutMode === "chat") {
      suppressedAutoOpenRef.current = true;
      if (runtimeTeamRequestId) {
        suppressedRuntimeTeamRequestIdRef.current = runtimeTeamRequestId;
      }
    }

    previousTeamWorkbenchLayoutModeRef.current = layoutMode;
  }, [layoutMode, runtimeTeamRequestId]);

  useEffect(() => {
    const normalizedSessionId = sessionId ?? null;

    if (previousTeamWorkbenchSessionIdRef.current !== normalizedSessionId) {
      previousTeamWorkbenchSessionIdRef.current = normalizedSessionId;
      previousRealTeamGraphRef.current = hasRealTeamGraph;
      previousTeamWorkbenchLayoutModeRef.current = layoutMode;
      previousRuntimeTeamRequestIdRef.current = runtimeTeamRequestId;
      suppressedAutoOpenRef.current = false;
      suppressedRuntimeTeamRequestIdRef.current = null;
      return;
    }

    const previousRuntimeTeamRequestId =
      previousRuntimeTeamRequestIdRef.current;
    const runtimeTeamRequestIdChanged =
      previousRuntimeTeamRequestId !== runtimeTeamRequestId;

    if (runtimeTeamRequestIdChanged) {
      const previousSuppressedRequestId =
        suppressedRuntimeTeamRequestIdRef.current;
      if (
        !runtimeTeamRequestId ||
        previousSuppressedRequestId !== runtimeTeamRequestId
      ) {
        suppressedAutoOpenRef.current = false;
        suppressedRuntimeTeamRequestIdRef.current = null;
      }
    }

    if (
      runtimeTeamRequestId &&
      runtimeTeamRequestIdChanged &&
      !hasRealTeamGraph &&
      !suppressedAutoOpenRef.current
    ) {
      handleActivateTeamWorkbench();
    }

    if (
      hasRealTeamGraph &&
      !previousRealTeamGraphRef.current &&
      !suppressedAutoOpenRef.current
    ) {
      handleActivateTeamWorkbench();
    }

    previousRuntimeTeamRequestIdRef.current = runtimeTeamRequestId;
    previousRealTeamGraphRef.current = hasRealTeamGraph;
  }, [
    handleActivateTeamWorkbench,
    hasRealTeamGraph,
    layoutMode,
    runtimeTeamRequestId,
    sessionId,
  ]);

  return {
    teamWorkbenchAutoFocusToken,
    dismissActiveTeamWorkbenchAutoOpen,
    handleActivateTeamWorkbench,
  };
}
