import type { MutableRefObject } from "react";
import type { AgentExecutionStrategy } from "@/lib/api/agentExecutionRuntime";
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
    targetSessionId?: string;
    skipSessionRestore?: boolean;
    skipSessionStartHooks?: boolean;
  }) => Promise<string | null>;
  sessionIdRef: MutableRefObject<string | null>;
  getWorkspaceIdForSubmit: () => string | undefined;
  getSyncedSessionRecentPreferences?: (
    sessionId: string,
  ) => ChatToolPreferences | null;
  getSyncedSessionExecutionStrategy: (
    sessionId: string,
  ) => AgentExecutionStrategy | null;
  effectiveExecutionStrategy: AgentExecutionStrategy;
  assistantDraft?: AssistantDraftState;
  targetSessionId?: string;
  skipSessionRestore?: boolean;
  skipSessionStartHooks?: boolean;
  performanceTrace?: AgentUiPerformanceTraceMetadata | null;

}

export async function resolveAgentStreamSubmitContext(
  options: ResolveAgentStreamSubmitContextOptions,
) {
  const {
    ensureSession,
    sessionIdRef,
    getWorkspaceIdForSubmit,
    getSyncedSessionRecentPreferences,
    getSyncedSessionExecutionStrategy,
    effectiveExecutionStrategy,
    assistantDraft,
    targetSessionId,
    skipSessionRestore,
    skipSessionStartHooks,
    performanceTrace,

  } = options;

  const hadActiveSessionBeforeEnsure = Boolean(sessionIdRef.current?.trim());
  const normalizedTargetSessionId = targetSessionId?.trim() || undefined;
  const ensureStartedAt = Date.now();
  recordAgentStreamPerformanceMetric(
    "agentStream.ensureSession.start",
    performanceTrace,
    {
      hadActiveSessionBeforeEnsure,
      sessionId: sessionIdRef.current,
      targetSessionId: normalizedTargetSessionId ?? null,
      skipSessionRestore: skipSessionRestore === true,
      skipSessionStartHooks: skipSessionStartHooks === true,
    },
  );
  logAgentDebug("AgentStream", "ensureSession.start", {
    hadActiveSessionBeforeEnsure,
    targetSessionId: normalizedTargetSessionId ?? null,
    skipSessionRestore: skipSessionRestore === true,
    skipSessionStartHooks: skipSessionStartHooks === true,
  });
  const activeSessionId = await ensureSession({
    targetSessionId: normalizedTargetSessionId,
    skipSessionRestore,
    skipSessionStartHooks,
  });
  if (!activeSessionId) {
    throw new Error("无法创建会话");
  }
  recordAgentStreamPerformanceMetric(
    "agentStream.ensureSession.done",
    performanceTrace,
    {
      activeSessionId,
      targetSessionId: normalizedTargetSessionId ?? null,
      durationMs: Date.now() - ensureStartedAt,
      hadActiveSessionBeforeEnsure,
      sessionId: activeSessionId,
      skipSessionRestore: skipSessionRestore === true,
      skipSessionStartHooks: skipSessionStartHooks === true,
    },
  );
  logAgentDebug("AgentStream", "ensureSession.done", {
    activeSessionId,
    targetSessionId: normalizedTargetSessionId ?? null,
    durationMs: Date.now() - ensureStartedAt,
    hadActiveSessionBeforeEnsure,
  });

  const resolvedWorkspaceId = getWorkspaceIdForSubmit();
  const submitWorkspaceId =
    hadActiveSessionBeforeEnsure || !resolvedWorkspaceId
      ? undefined
      : resolvedWorkspaceId;
  const syncedRecentPreferences =
    getSyncedSessionRecentPreferences?.(activeSessionId) || null;
  const syncedExecutionStrategy =
    getSyncedSessionExecutionStrategy(activeSessionId);
  const waitingRuntimeStatus = buildWaitingAgentRuntimeStatus({
    executionStrategy: effectiveExecutionStrategy,

  });
  const effectiveWaitingRuntimeStatus =
    assistantDraft?.waitingRuntimeStatus || waitingRuntimeStatus;

  return {
    activeSessionId,
    resolvedWorkspaceId,
    submitWorkspaceId,
    syncedRecentPreferences,
    syncedExecutionStrategy,
    effectiveWaitingRuntimeStatus,
  };
}
