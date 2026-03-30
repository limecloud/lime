import {
  useEffect,
  useRef,
  type MutableRefObject,
} from "react";
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
  const hasRuntimeEventListenerCapability =
    hasTauriEventListenerCapability() || hasDevBridgeEventListenerCapability();
  const shouldUseDevBridgeRuntimePolling =
    Boolean(sessionId) &&
    isSending &&
    isDevBridgeAvailable() &&
    !hasRuntimeEventListenerCapability;

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

    const normalizedThreadReadStatus = (threadReadStatus || "").toLowerCase();
    const hasRecoveredQueueWork =
      normalizedThreadReadStatus === "running" ||
      normalizedThreadReadStatus === "queued" ||
      queuedTurnCount > 0 ||
      threadTurns.some((turn) => turn.status === "running");
    if (!hasRecoveredQueueWork) {
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
  }, [
    refreshSessionDetail,
    sessionId,
    shouldUseDevBridgeRuntimePolling,
  ]);

  useEffect(() => {
    if (!sessionId) {
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
        const unlisten = await runtime.listenToTeamEvents(eventName, (event) => {
          const data = parseAgentEvent(event.payload);
          if (disposed || data?.type !== "subagent_status_changed") {
            return;
          }
          if (sessionIdRef.current !== sessionId) {
            return;
          }
          void refreshSessionDetail(sessionId);
        });

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
  ]);
}
