import { useCallback, useEffect, useMemo, useState } from "react";
import {
  resolveRuntimeTeamDispatchPreviewState,
  type RuntimeTeamDispatchPreviewSnapshot,
} from "./runtimeTeamPreview";

interface UseWorkspaceRuntimeTeamDispatchPreviewRuntimeParams {
  messagesLength: number;
  sessionId?: string | null;
}

export function useWorkspaceRuntimeTeamDispatchPreviewRuntime({
  messagesLength,
  sessionId,
}: UseWorkspaceRuntimeTeamDispatchPreviewRuntimeParams) {
  const [runtimeTeamDispatchPreview, setRuntimeTeamDispatchPreview] =
    useState<RuntimeTeamDispatchPreviewSnapshot | null>(null);
  const clearRuntimeTeamDispatchPreview = useCallback(() => {
    setRuntimeTeamDispatchPreview(null);
  }, []);
  const runtimeTeamPreviewState = useMemo(
    () => resolveRuntimeTeamDispatchPreviewState(runtimeTeamDispatchPreview),
    [runtimeTeamDispatchPreview],
  );

  useEffect(() => {
    clearRuntimeTeamDispatchPreview();
  }, [clearRuntimeTeamDispatchPreview, sessionId]);

  useEffect(() => {
    if (!runtimeTeamDispatchPreview) {
      return;
    }

    if (messagesLength > runtimeTeamDispatchPreview.baseMessageCount) {
      clearRuntimeTeamDispatchPreview();
    }
  }, [
    clearRuntimeTeamDispatchPreview,
    messagesLength,
    runtimeTeamDispatchPreview,
  ]);

  return {
    runtimeTeamDispatchPreview,
    runtimeTeamPreviewState,
    clearRuntimeTeamDispatchPreview,
    setRuntimeTeamDispatchPreview,
  };
}
