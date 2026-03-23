import { useMemo } from "react";
import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import { useTeamWorkspaceRuntime } from "../hooks";
import {
  deriveCurrentSessionRuntimeStatus,
  deriveLatestTurnRuntimeStatus,
} from "../agentChatWorkspaceShared";

interface WorkspaceSessionTopicSummary {
  id: string;
  title: string;
}

interface UseWorkspaceTeamSessionRuntimeParams {
  sessionId?: string | null;
  topics: WorkspaceSessionTopicSummary[];
  turns: Array<{ status: string }>;
  queuedTurnCount: number;
  isSending: boolean;
  subagentEnabled: boolean;
  runtimeTeamState: unknown;
  childSubagentSessions: AsterSubagentSessionInfo[];
  subagentParentContext: AsterSubagentParentContext | null;
}

export function useWorkspaceTeamSessionRuntime({
  sessionId,
  topics,
  turns,
  queuedTurnCount,
  isSending,
  subagentEnabled,
  runtimeTeamState,
  childSubagentSessions,
  subagentParentContext,
}: UseWorkspaceTeamSessionRuntimeParams) {
  const currentSessionTitle = useMemo(
    () => topics.find((topic) => topic.id === sessionId)?.title ?? null,
    [sessionId, topics],
  );

  const hasRealTeamGraph =
    childSubagentSessions.length > 0 || Boolean(subagentParentContext);
  const showTeamWorkspaceBoard =
    subagentEnabled || hasRealTeamGraph || Boolean(runtimeTeamState);

  const currentSessionRuntimeStatus = useMemo(
    () =>
      deriveCurrentSessionRuntimeStatus({
        isSending,
        queuedTurnCount,
        turns,
      }),
    [isSending, queuedTurnCount, turns],
  );
  const currentSessionLatestTurnStatus = useMemo(
    () => deriveLatestTurnRuntimeStatus(turns),
    [turns],
  );

  const liveTeamWorkspaceRuntime = useTeamWorkspaceRuntime({
    currentSessionId: sessionId,
    currentSessionRuntimeStatus,
    currentSessionLatestTurnStatus,
    currentSessionQueuedTurnCount: queuedTurnCount,
    childSubagentSessions,
    subagentParentContext,
  });

  return {
    currentSessionTitle,
    hasRealTeamGraph,
    showTeamWorkspaceBoard,
    currentSessionRuntimeStatus,
    currentSessionLatestTurnStatus,
    ...liveTeamWorkspaceRuntime,
  };
}
