import type { UnlistenFn } from "@tauri-apps/api/event";
import { parseAgentEvent } from "@/lib/api/agentProtocol";
import type { AgentRuntimeEventSource } from "@/lib/api/agentRuntimeEvents";
import type {
  TeamWorkspaceActivityEntry,
  TeamWorkspaceLiveRuntimeState,
  TeamWorkspaceRuntimeSessionSnapshot,
} from "../teamWorkspaceRuntime";
import {
  areLiveRuntimeStatesEqual,
  buildLiveRuntimeState,
  buildStatusChangedProjection,
  projectRuntimeStreamEvent,
  removeLiveActivityEntries,
  type SessionLiveStreamState,
  upsertLiveActivityEntries,
} from "./liveRuntimeProjector";

type LiveRuntimeBySessionId = Record<string, TeamWorkspaceLiveRuntimeState>;
type LiveActivityBySessionId = Record<string, TeamWorkspaceActivityEntry[]>;
type TeamWorkspaceRecordUpdater<TRecord> = (
  update: (previous: TRecord) => TRecord,
) => void;

export interface TeamWorkspaceStatusEventSubscriptionDeps {
  sessionIds: string[];
  eventSource: Pick<AgentRuntimeEventSource, "listenSubagentStatus">;
  getSnapshot(
    sessionId: string,
  ): TeamWorkspaceRuntimeSessionSnapshot | undefined;
  getBaseFingerprint(
    sessionId: string,
    session: TeamWorkspaceRuntimeSessionSnapshot,
  ): string;
  getCurrentRuntime(
    sessionId: string,
  ): TeamWorkspaceLiveRuntimeState | undefined;
  setLiveRuntimeBySessionId: TeamWorkspaceRecordUpdater<LiveRuntimeBySessionId>;
  setLiveActivityBySessionId: TeamWorkspaceRecordUpdater<LiveActivityBySessionId>;
  scheduleActivityRefresh(sessionId: string): void;
}

export interface TeamWorkspaceStreamEventSubscriptionDeps {
  sessionIds: string[];
  eventSource: Pick<AgentRuntimeEventSource, "listenSubagentStream">;
  getSnapshot(
    sessionId: string,
  ): TeamWorkspaceRuntimeSessionSnapshot | undefined;
  getBaseFingerprint(
    sessionId: string,
    session: TeamWorkspaceRuntimeSessionSnapshot,
  ): string;
  getCurrentRuntime(
    sessionId: string,
  ): TeamWorkspaceLiveRuntimeState | undefined;
  getStreamState(sessionId: string): SessionLiveStreamState | undefined;
  setStreamState(
    sessionId: string,
    nextState: SessionLiveStreamState | undefined,
  ): void;
  getToolNames(sessionId: string): Record<string, string> | undefined;
  setToolNames(
    sessionId: string,
    nextToolNames: Record<string, string> | undefined,
  ): void;
  setLiveRuntimeBySessionId: TeamWorkspaceRecordUpdater<LiveRuntimeBySessionId>;
  setLiveActivityBySessionId: TeamWorkspaceRecordUpdater<LiveActivityBySessionId>;
  scheduleActivityRefresh(sessionId: string): void;
}

type SessionEventHandler = (event: { payload: unknown }) => void;
type SessionEventListener = (
  sessionId: string,
  handler: SessionEventHandler,
) => Promise<UnlistenFn>;

async function subscribeToSessionEvents(params: {
  sessionIds: string[];
  listen: SessionEventListener;
  handleEvent(sessionId: string, event: { payload: unknown }): void;
}): Promise<() => void> {
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];

  for (const sessionId of params.sessionIds) {
    const unlisten = await params.listen(sessionId, (event) => {
      if (disposed) {
        return;
      }

      params.handleEvent(sessionId, event);
    });

    if (disposed) {
      unlisten();
      return () => {};
    }

    unlisteners.push(unlisten);
  }

  return () => {
    disposed = true;
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}

export async function subscribeTeamWorkspaceStatusEvents(
  deps: TeamWorkspaceStatusEventSubscriptionDeps,
): Promise<() => void> {
  return await subscribeToSessionEvents({
    sessionIds: deps.sessionIds,
    listen: deps.eventSource.listenSubagentStatus,
    handleEvent: (_statusSessionId, event) => {
      const data = parseAgentEvent(event.payload);
      if (data?.type !== "subagent_status_changed") {
        return;
      }

      const matchingSession = deps.getSnapshot(data.session_id);
      if (!matchingSession) {
        return;
      }

      const baseFingerprint = deps.getBaseFingerprint(
        data.session_id,
        matchingSession,
      );
      const projection = buildStatusChangedProjection({
        sessionId: data.session_id,
        status: data.status,
        session: matchingSession,
        currentRuntime: deps.getCurrentRuntime(data.session_id),
      });

      deps.setLiveRuntimeBySessionId((previous) => {
        const current = previous[data.session_id];
        const nextState = buildLiveRuntimeState(
          matchingSession,
          baseFingerprint,
          current,
          projection.liveRuntimePatch,
        );

        if (areLiveRuntimeStatesEqual(current, nextState)) {
          return previous;
        }

        return {
          ...previous,
          [data.session_id]: nextState,
        };
      });

      deps.setLiveActivityBySessionId((previous) => {
        const existingEntries = previous[data.session_id] ?? [];
        if (
          existingEntries[0]?.title === projection.entry.title &&
          existingEntries[0]?.detail === projection.entry.detail
        ) {
          return previous;
        }

        return {
          ...previous,
          [data.session_id]: upsertLiveActivityEntries(
            existingEntries,
            projection.entry,
          ),
        };
      });

      deps.scheduleActivityRefresh(data.session_id);
    },
  });
}

export async function subscribeTeamWorkspaceStreamEvents(
  deps: TeamWorkspaceStreamEventSubscriptionDeps,
): Promise<() => void> {
  return await subscribeToSessionEvents({
    sessionIds: deps.sessionIds,
    listen: deps.eventSource.listenSubagentStream,
    handleEvent: (sessionId, event) => {
      const data = parseAgentEvent(event.payload);
      if (!data) {
        return;
      }

      const matchingSession = deps.getSnapshot(sessionId);
      if (!matchingSession) {
        return;
      }

      const projection = projectRuntimeStreamEvent({
        sessionId,
        session: matchingSession,
        event: data,
        currentRuntime: deps.getCurrentRuntime(sessionId),
        streamState: deps.getStreamState(sessionId),
        toolNameById: deps.getToolNames(sessionId),
      });
      if (!projection) {
        return;
      }

      if (projection.rememberTool) {
        deps.setToolNames(sessionId, {
          ...(deps.getToolNames(sessionId) ?? {}),
          [projection.rememberTool.toolId]: projection.rememberTool.toolName,
        });
      }

      if (projection.forgetToolId) {
        const currentTools = deps.getToolNames(sessionId);
        if (currentTools) {
          const nextTools = { ...currentTools };
          delete nextTools[projection.forgetToolId];
          deps.setToolNames(
            sessionId,
            Object.keys(nextTools).length > 0 ? nextTools : undefined,
          );
        }
      }

      const nextStreamState = {
        ...(deps.getStreamState(sessionId) ?? {}),
      };
      let streamStateChanged = false;

      if (projection.nextTextDraft !== undefined) {
        nextStreamState.textDraft = projection.nextTextDraft;
        streamStateChanged = true;
      }
      if (projection.clearTextDraft) {
        delete nextStreamState.textDraft;
        streamStateChanged = true;
      }
      if (projection.nextThinkingDraft !== undefined) {
        nextStreamState.thinkingDraft = projection.nextThinkingDraft;
        streamStateChanged = true;
      }
      if (projection.clearThinkingDraft) {
        delete nextStreamState.thinkingDraft;
        streamStateChanged = true;
      }

      if (streamStateChanged) {
        deps.setStreamState(
          sessionId,
          Object.keys(nextStreamState).length > 0 ? nextStreamState : undefined,
        );
      }

      const liveRuntimePatch = projection.liveRuntimePatch;
      if (liveRuntimePatch) {
        const baseFingerprint = deps.getBaseFingerprint(
          sessionId,
          matchingSession,
        );

        deps.setLiveRuntimeBySessionId((previous) => {
          const current = previous[sessionId];
          const nextState = buildLiveRuntimeState(
            matchingSession,
            baseFingerprint,
            current,
            liveRuntimePatch,
          );

          if (areLiveRuntimeStatesEqual(current, nextState)) {
            return previous;
          }

          return {
            ...previous,
            [sessionId]: nextState,
          };
        });
      }

      if (projection.entry || projection.clearEntryIds?.length) {
        deps.setLiveActivityBySessionId((previous) => {
          const existingEntries = previous[sessionId] ?? [];
          const nextWithoutTransient = removeLiveActivityEntries(
            existingEntries,
            projection.clearEntryIds ?? [],
          );
          const nextEntries = projection.entry
            ? upsertLiveActivityEntries(nextWithoutTransient, projection.entry)
            : nextWithoutTransient;

          if (nextEntries === existingEntries) {
            return previous;
          }

          if (nextEntries.length === 0) {
            const { [sessionId]: _removed, ...rest } = previous;
            return rest;
          }

          return {
            ...previous,
            [sessionId]: nextEntries,
          };
        });
      }

      if (projection.refreshPreview) {
        deps.scheduleActivityRefresh(sessionId);
      }
    },
  });
}
