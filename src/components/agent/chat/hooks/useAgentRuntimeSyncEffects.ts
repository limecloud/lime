import { useEffect, useRef, type MutableRefObject } from "react";
import {
  hasDevBridgeEventListenerCapability,
  isDevBridgeAvailable,
} from "@/lib/dev-bridge";
import { parseAgentEvent } from "@/lib/api/agentProtocol";
import {
  dedupeAgentRuntimeEventNames,
  getAgentSubagentStatusEventName,
} from "@/lib/api/agentRuntimeEvents";
import { hasTauriEventListenerCapability } from "@/lib/tauri-runtime";
import type { AgentThreadTurn } from "../types";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";

const DEV_BRIDGE_RUNTIME_POLL_MS = 1000;
const RECOVERED_RUNTIME_POLL_ACTIVE_WINDOW_MS = 30 * 60 * 1000;

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function hasRecentRunningTurn(threadTurns: AgentThreadTurn[]): boolean {
  const nowMs = Date.now();
  return threadTurns.some((turn) => {
    if (turn.status !== "running") {
      return false;
    }

    const timestampMs =
      parseTimestampMs(turn.updated_at) ?? parseTimestampMs(turn.started_at);
    if (timestampMs === null) {
      return false;
    }

    return nowMs - timestampMs <= RECOVERED_RUNTIME_POLL_ACTIVE_WINDOW_MS;
  });
}

function shouldPollRecoveredRuntimeWork(params: {
  threadReadStatus?: string | null;
  queuedTurnCount: number;
  threadTurns: AgentThreadTurn[];
}): boolean {
  if (params.queuedTurnCount > 0) {
    return true;
  }

  const normalizedThreadReadStatus = (
    params.threadReadStatus || ""
  ).toLowerCase();
  const hasRunningTurn = params.threadTurns.some(
    (turn) => turn.status === "running",
  );

  if (hasRunningTurn) {
    return hasRecentRunningTurn(params.threadTurns);
  }

  return (
    normalizedThreadReadStatus === "running" ||
    normalizedThreadReadStatus === "queued"
  );
}

interface UseAgentRuntimeSyncEffectsOptions {
  runtime: Pick<AgentRuntimeAdapter, "listenToTeamEvents">;
  sessionIdRef: MutableRefObject<string | null>;
  sessionId: string | null;
  parentSessionId?: string | null;
  isSending: boolean;
  threadReadStatus?: string | null;
  queuedTurnCount: number;
  threadTurns: AgentThreadTurn[];
  refreshSessionDetail: (targetSessionId?: string) => Promise<unknown>;
}

export function useAgentRuntimeSyncEffects(
  options: UseAgentRuntimeSyncEffectsOptions,
) {
  const {
    runtime,
    sessionIdRef,
    sessionId,
    parentSessionId,
    isSending,
    threadReadStatus,
    queuedTurnCount,
    threadTurns,
    refreshSessionDetail,
  } = options;
  const lastIsSendingRef = useRef(isSending);
  const normalizedParentSessionId = parentSessionId?.trim() || null;
  const hasTauriRuntimeEventListenerCapability =
    hasTauriEventListenerCapability();
  const hasRuntimeEventListenerCapability =
    hasTauriRuntimeEventListenerCapability ||
    hasDevBridgeEventListenerCapability();
  const hasActiveRuntimeWork = shouldPollRecoveredRuntimeWork({
    threadReadStatus,
    queuedTurnCount,
    threadTurns,
  });
  const shouldUseDevBridgeRuntimePolling =
    Boolean(sessionId) &&
    isSending &&
    isDevBridgeAvailable() &&
    !hasRuntimeEventListenerCapability;
  const shouldSubscribeTeamEvents =
    Boolean(sessionId) &&
    (hasTauriRuntimeEventListenerCapability ||
      isSending ||
      hasActiveRuntimeWork ||
      Boolean(normalizedParentSessionId));

  useEffect(() => {
    const wasSending = lastIsSendingRef.current;
    lastIsSendingRef.current = isSending;

    if (!wasSending || isSending || !sessionId) {
      return;
    }

    void refreshSessionDetail(sessionId);
  }, [isSending, refreshSessionDetail, sessionId]);

  useEffect(() => {
    if (!sessionId || isSending) {
      return;
    }

    if (
      !shouldPollRecoveredRuntimeWork({
        threadReadStatus,
        queuedTurnCount,
        threadTurns,
      })
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshSessionDetail(sessionId);
    }, 1500);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    isSending,
    threadReadStatus,
    queuedTurnCount,
    refreshSessionDetail,
    sessionId,
    threadTurns,
  ]);

  useEffect(() => {
    if (!sessionId || !shouldUseDevBridgeRuntimePolling) {
      return;
    }

    void refreshSessionDetail(sessionId);

    const timer = window.setInterval(() => {
      void refreshSessionDetail(sessionId);
    }, DEV_BRIDGE_RUNTIME_POLL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshSessionDetail, sessionId, shouldUseDevBridgeRuntimePolling]);

  useEffect(() => {
    if (!sessionId || !shouldSubscribeTeamEvents) {
      return;
    }

    const eventNames = dedupeAgentRuntimeEventNames([
      getAgentSubagentStatusEventName(sessionId),
      normalizedParentSessionId
        ? getAgentSubagentStatusEventName(normalizedParentSessionId)
        : null,
    ]);

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const subscribe = async () => {
      for (const eventName of eventNames) {
        const unlisten = await runtime.listenToTeamEvents(
          eventName,
          (event) => {
            const data = parseAgentEvent(event.payload);
            if (disposed || data?.type !== "subagent_status_changed") {
              return;
            }
            if (sessionIdRef.current !== sessionId) {
              return;
            }
            void refreshSessionDetail(sessionId);
          },
        );

        if (disposed) {
          unlisten();
          return;
        }

        unlisteners.push(unlisten);
      }
    };

    void subscribe();

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [
    normalizedParentSessionId,
    refreshSessionDetail,
    runtime,
    sessionId,
    sessionIdRef,
    shouldSubscribeTeamEvents,
  ]);
}
