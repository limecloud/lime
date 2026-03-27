import type { MutableRefObject } from "react";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import type { Message } from "../types";
import type { AssistantDraftState } from "./agentChatShared";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import { buildWaitingAgentRuntimeStatus } from "../utils/agentRuntimeStatus";

interface ResolveAgentStreamSubmitContextOptions {
  ensureSession: () => Promise<string | null>;
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
    activateStream,
  } = options;

  const hadActiveSessionBeforeEnsure = Boolean(sessionIdRef.current?.trim());
  const activeSessionId = await ensureSession();
  if (!activeSessionId) {
    throw new Error("无法创建会话");
  }

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
