import type { MutableRefObject } from "react";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import type { Message } from "../types";
import type { AssistantDraftState } from "./agentChatShared";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import { logAgentDebug } from "@/lib/agentDebug";
import { buildWaitingAgentRuntimeStatus } from "../utils/agentRuntimeStatus";
import {
  recordAgentStreamPerformanceMetric,
  type AgentUiPerformanceTraceMetadata,
} from "./agentStreamPerformanceMetrics";

interface ResolveAgentStreamSubmitContextOptions {
  ensureSession: (options?: {
    skipSessionRestore?: boolean;
  }) => Promise<string | null>;
  sessionIdRef: MutableRefObject<string | null>;
  getRequiredWorkspaceId: () => string;
  getSyncedSessionRecentPreferences?: (
    sessionId: string,
  ) => ChatToolPreferences | null;
  getSyncedSessionExecutionStrategy: (
    sessionId: string,
  ) => AsterExecutionStrategy | null;
  effectiveExecutionStrategy: AsterExecutionStrategy;
  webSearch?: boolean;
  thinking?: boolean;
  assistantDraft?: AssistantDraftState;
  expectingQueue: boolean;
  skipSessionRestore?: boolean;
  performanceTrace?: AgentUiPerformanceTraceMetadata | null;
  activateStream: (
    activeSessionId: string,
    effectiveWaitingRuntimeStatus: NonNullable<Message["runtimeStatus"]>,
  ) => void;
}

export async function resolveAgentStreamSubmitContext(
  options: ResolveAgentStreamSubmitContextOptions,
) {
  const {
    ensureSession,
    sessionIdRef,
    getRequiredWorkspaceId,
    getSyncedSessionRecentPreferences,
    getSyncedSessionExecutionStrategy,
    effectiveExecutionStrategy,
    webSearch,
    thinking,
    assistantDraft,
    expectingQueue,
    skipSessionRestore,
    performanceTrace,
    activateStream,
  } = options;

  const hadActiveSessionBeforeEnsure = Boolean(sessionIdRef.current?.trim());
  const ensureStartedAt = Date.now();
  recordAgentStreamPerformanceMetric(
    "agentStream.ensureSession.start",
    performanceTrace,
    {
      hadActiveSessionBeforeEnsure,
      sessionId: sessionIdRef.current,
      skipSessionRestore: skipSessionRestore === true,
    },
  );
  logAgentDebug("AgentStream", "ensureSession.start", {
    hadActiveSessionBeforeEnsure,
    skipSessionRestore: skipSessionRestore === true,
  });
  const activeSessionId = await ensureSession({ skipSessionRestore });
  if (!activeSessionId) {
    throw new Error("无法创建会话");
  }
  recordAgentStreamPerformanceMetric(
    "agentStream.ensureSession.done",
    performanceTrace,
    {
      activeSessionId,
      durationMs: Date.now() - ensureStartedAt,
      hadActiveSessionBeforeEnsure,
      sessionId: activeSessionId,
      skipSessionRestore: skipSessionRestore === true,
    },
  );
  logAgentDebug("AgentStream", "ensureSession.done", {
    activeSessionId,
    durationMs: Date.now() - ensureStartedAt,
    hadActiveSessionBeforeEnsure,
  });

  const resolvedWorkspaceId = getRequiredWorkspaceId();
  const submitWorkspaceId = hadActiveSessionBeforeEnsure
    ? undefined
    : resolvedWorkspaceId;
  const syncedRecentPreferences =
    getSyncedSessionRecentPreferences?.(activeSessionId) || null;
  const syncedExecutionStrategy =
    getSyncedSessionExecutionStrategy(activeSessionId);
  const waitingRuntimeStatus = buildWaitingAgentRuntimeStatus({
    executionStrategy: effectiveExecutionStrategy,
    webSearch,
    thinking,
  });
  const effectiveWaitingRuntimeStatus =
    assistantDraft?.waitingRuntimeStatus || waitingRuntimeStatus;

  if (!expectingQueue) {
    activateStream(activeSessionId, effectiveWaitingRuntimeStatus);
  }

  return {
    activeSessionId,
    resolvedWorkspaceId,
    submitWorkspaceId,
    syncedRecentPreferences,
    syncedExecutionStrategy,
    effectiveWaitingRuntimeStatus,
  };
}
