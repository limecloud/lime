import type { MutableRefObject } from "react";
import type {
  AgentRuntimeThreadReadModel,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import { normalizeQueuedTurnSnapshots } from "@/lib/api/queuedTurn";
import { normalizeExecutionStrategy } from "./agentChatCoreUtils";
import type { AgentAccessMode } from "./agentChatStorage";
import { createSessionAccessModeFromExecutionRuntime } from "../utils/sessionExecutionRuntime";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";

export interface AgentSessionReadModelSnapshot {
  queuedTurns: QueuedTurnSnapshot[];
  threadRead: AgentRuntimeThreadReadModel | null;
}

export function createAgentSessionReadModelSnapshot(
  threadRead?: AgentRuntimeThreadReadModel | null,
): AgentSessionReadModelSnapshot {
  return {
    queuedTurns: normalizeQueuedTurnSnapshots(threadRead?.queued_turns),
    threadRead: threadRead ?? null,
  };
}

interface RefreshAgentSessionDetailOptions {
  runtime: Pick<AgentRuntimeAdapter, "getSession">;
  sessionIdRef: MutableRefObject<string | null>;
  targetSessionId?: string;
  applySessionDetail: (
    sessionId: string,
    detail: Awaited<ReturnType<AgentRuntimeAdapter["getSession"]>>,
    options: { preserveExecutionStrategyOnMissingDetail: boolean },
  ) => void;
  markSessionExecutionStrategySynced: (
    sessionId: string,
    executionStrategy: import("@/lib/api/agentRuntime").AsterExecutionStrategy,
  ) => void;
  persistSessionAccessMode?: (
    sessionId: string,
    accessMode: AgentAccessMode,
  ) => void;
  setAccessModeState?: (accessMode: AgentAccessMode) => void;
  onWarn?: (error: unknown) => void;
}

export async function refreshAgentSessionDetailState(
  options: RefreshAgentSessionDetailOptions,
) {
  const {
    runtime,
    sessionIdRef,
    targetSessionId,
    applySessionDetail,
    markSessionExecutionStrategySynced,
    onWarn,
  } = options;
  const resolvedSessionId = targetSessionId || sessionIdRef.current;
  if (!resolvedSessionId?.trim()) {
    return false;
  }

  try {
    const detail = await runtime.getSession(resolvedSessionId, {
      historyLimit: 40,
    });
    if (sessionIdRef.current !== resolvedSessionId) {
      return false;
    }
    applySessionDetail(resolvedSessionId, detail, {
      preserveExecutionStrategyOnMissingDetail: true,
    });
    const runtimeAccessMode = createSessionAccessModeFromExecutionRuntime(
      detail.execution_runtime,
    );
    if (runtimeAccessMode) {
      options.persistSessionAccessMode?.(resolvedSessionId, runtimeAccessMode);
      options.setAccessModeState?.(runtimeAccessMode);
    }
    if (detail.execution_strategy) {
      markSessionExecutionStrategySynced(
        resolvedSessionId,
        normalizeExecutionStrategy(detail.execution_strategy),
      );
    }
    return true;
  } catch (error) {
    onWarn?.(error);
    return false;
  }
}

interface RefreshAgentSessionReadModelOptions {
  runtime: Pick<AgentRuntimeAdapter, "getSessionReadModel">;
  sessionIdRef: MutableRefObject<string | null>;
  targetSessionId?: string;
  applyReadModelSnapshot: (snapshot: AgentSessionReadModelSnapshot) => void;
  onWarn?: (error: unknown) => void;
}

export async function refreshAgentSessionReadModelState(
  options: RefreshAgentSessionReadModelOptions,
) {
  const {
    runtime,
    sessionIdRef,
    targetSessionId,
    applyReadModelSnapshot,
    onWarn,
  } = options;
  const resolvedSessionId = targetSessionId || sessionIdRef.current;
  if (!resolvedSessionId?.trim()) {
    return false;
  }

  try {
    const threadRead = await runtime.getSessionReadModel(resolvedSessionId);
    if (sessionIdRef.current !== resolvedSessionId) {
      return false;
    }
    applyReadModelSnapshot(createAgentSessionReadModelSnapshot(threadRead));
    return true;
  } catch (error) {
    onWarn?.(error);
    return false;
  }
}
