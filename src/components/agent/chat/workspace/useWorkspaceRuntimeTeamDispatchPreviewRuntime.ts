import { useEffect, useState } from "react";
import type { TeamWorkspaceRuntimeFormationState } from "../teamWorkspaceRuntime";
import type { RuntimeTeamDispatchPreviewSnapshot } from "./runtimeTeamPreview";

interface UseWorkspaceRuntimeTeamDispatchPreviewRuntimeParams {
  messagesLength: number;
  runtimeTeamState: TeamWorkspaceRuntimeFormationState | null;
  sessionId?: string | null;
}

export function useWorkspaceRuntimeTeamDispatchPreviewRuntime({
  messagesLength,
  runtimeTeamState,
  sessionId,
}: UseWorkspaceRuntimeTeamDispatchPreviewRuntimeParams) {
  const [runtimeTeamDispatchPreview, setRuntimeTeamDispatchPreview] =
    useState<RuntimeTeamDispatchPreviewSnapshot | null>(null);

  useEffect(() => {
    setRuntimeTeamDispatchPreview(null);
  }, [sessionId]);

  useEffect(() => {
    if (!runtimeTeamDispatchPreview) {
      return;
    }

    if (messagesLength > runtimeTeamDispatchPreview.baseMessageCount) {
      setRuntimeTeamDispatchPreview(null);
    }
  }, [messagesLength, runtimeTeamDispatchPreview]);

  useEffect(() => {
    if (
      !runtimeTeamDispatchPreview ||
      runtimeTeamDispatchPreview.status === "failed" ||
      runtimeTeamState?.status !== "failed"
    ) {
      return;
    }

    setRuntimeTeamDispatchPreview((current) =>
      current
        ? {
            ...current,
            status: "failed",
            formationState: null,
            failureMessage: runtimeTeamState.errorMessage?.trim() || null,
          }
        : null,
    );
  }, [runtimeTeamDispatchPreview, runtimeTeamState]);

  return {
    runtimeTeamDispatchPreview,
    setRuntimeTeamDispatchPreview,
  };
}
