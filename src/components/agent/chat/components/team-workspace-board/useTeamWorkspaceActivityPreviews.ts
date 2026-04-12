import { useMemo } from "react";
import type { TeamWorkspaceActivityEntry } from "../../teamWorkspaceRuntime";
import {
  buildSelectedSessionActivityState,
  type ActivityPreviewSession,
  type SelectedSessionActivityState,
} from "../../team-workspace-runtime/activityPreviewSelectors";
import { useTeamWorkspaceActivityPreviewSync } from "./useTeamWorkspaceActivityPreviewSync";

interface UseTeamWorkspaceActivityPreviewsParams {
  activityRefreshVersionBySessionId?: Record<string, number>;
  activityTimelineEntryLimit: number;
  basePreviewableRailSessions: ActivityPreviewSession[];
  liveActivityBySessionId?: Record<string, TeamWorkspaceActivityEntry[]>;
  pollIntervalMs?: number;
  selectedBaseSession?: ActivityPreviewSession | null;
  selectedSession?: ActivityPreviewSession | null;
}

export function useTeamWorkspaceActivityPreviews({
  activityRefreshVersionBySessionId = {},
  activityTimelineEntryLimit,
  basePreviewableRailSessions,
  liveActivityBySessionId = {},
  pollIntervalMs,
  selectedBaseSession = null,
  selectedSession = null,
}: UseTeamWorkspaceActivityPreviewsParams) {
  const selectedSessionActivitySyncTarget =
    useMemo<SelectedSessionActivityState>(
      () =>
        buildSelectedSessionActivityState({
          selectedSession,
          selectedBaseSession,
          activityRefreshVersionBySessionId,
          activityTimelineEntryLimit,
        }),
      [
        activityRefreshVersionBySessionId,
        activityTimelineEntryLimit,
        selectedBaseSession,
        selectedSession,
      ],
    );
  const { sessionActivityPreviewById } = useTeamWorkspaceActivityPreviewSync({
    activityRefreshVersionBySessionId,
    activityTimelineEntryLimit,
    basePreviewableRailSessions,
    pollIntervalMs,
    selectedSessionActivityState: selectedSessionActivitySyncTarget,
  });
  const selectedSessionActivityState = useMemo<SelectedSessionActivityState>(
    () =>
      buildSelectedSessionActivityState({
        selectedSession,
        selectedBaseSession,
        liveActivityBySessionId,
        previewBySessionId: sessionActivityPreviewById,
        activityRefreshVersionBySessionId,
        activityTimelineEntryLimit,
      }),
    [
      activityRefreshVersionBySessionId,
      activityTimelineEntryLimit,
      liveActivityBySessionId,
      selectedBaseSession,
      selectedSession,
      sessionActivityPreviewById,
    ],
  );

  return {
    selectedSessionActivityState,
    sessionActivityPreviewById,
  };
}
