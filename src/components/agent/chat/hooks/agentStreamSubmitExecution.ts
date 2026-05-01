import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import type {
  AsterExecutionStrategy,
  AsterSessionExecutionRuntime,
  AutoContinueRequestPayload,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type {
  AssistantDraftState,
  SendMessageObserver,
  SessionModelPreference,
} from "./agentChatShared";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import type { AgentAccessMode } from "./agentChatStorage";
import type { StreamRequestState } from "./agentStreamSubmissionLifecycle";
import type { ActionRequired, Message, MessageImage } from "../types";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import { logAgentDebug } from "@/lib/agentDebug";
import { buildUserInputSubmitOp } from "../utils/buildUserInputSubmitOp";
import { resolveAgentStreamSubmitContext } from "./agentStreamSubmitContext";
import { registerAgentStreamTurnEventBinding } from "./agentStreamTurnEventBinding";
import {
  extractAgentUiPerformanceTraceMetadata,
  recordAgentStreamPerformanceMetric,
} from "./agentStreamPerformanceMetrics";

type MessageParts = NonNullable<Message["contentParts"]>;

interface ExecuteAgentStreamSubmitOptions {
  runtime: AgentRuntimeAdapter;
  ensureSession: (options?: {
    skipSessionRestore?: boolean;
    skipSessionStartHooks?: boolean;
  }) => Promise<string | null>;
  attemptSilentTurnRecovery: (
    sessionId: string,
    requestStartedAt: number,
    promptText: string,
  ) => Promise<boolean>;
  sessionIdRef: MutableRefObject<string | null>;
  getRequiredWorkspaceId: () => string;
  getSyncedSessionExecutionStrategy: (
    sessionId: string,
  ) => AsterExecutionStrategy | null;
  getSyncedSessionRecentPreferences?: (
    sessionId: string,
  ) => ChatToolPreferences | null;
  effectiveAccessMode: AgentAccessMode;
  content: string;
  images: MessageImage[];
  skipUserMessage: boolean;
  expectingQueue: boolean;
  effectiveProviderType: string;
  effectiveModel: string;
  effectiveExecutionStrategy: AsterExecutionStrategy;
  modelOverride?: string;
  webSearch?: boolean;
  thinking?: boolean;
  autoContinue?: AutoContinueRequestPayload;
  systemPrompt?: string;
  requestMetadata?: Record<string, unknown>;
  assistantDraft?: AssistantDraftState;
  skipSessionRestore?: boolean;
  skipSessionStartHooks?: boolean;
  skipPreSubmitResume?: boolean;
  executionRuntime?: AsterSessionExecutionRuntime | null;
  syncedSessionModelPreference?: SessionModelPreference | null;
  eventName: string;
  requestTurnId: string;
  requestState: StreamRequestState;
  assistantMsgId: string;
  pendingTurnKey: string;
  pendingItemKey: string;
  warnedKeysRef: MutableRefObject<Set<string>>;
  actionLoggedKeys: Set<string>;
  toolLogIdByToolId: Map<string, string>;
  toolStartedAtByToolId: Map<string, number>;
  toolNameByToolId: Map<string, string>;
  observer?: SendMessageObserver;
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: import("../types").WriteArtifactContext,
  ) => void;
  callbacks: {
    activateStream: (
      activeSessionId: string,
      effectiveWaitingRuntimeStatus: NonNullable<Message["runtimeStatus"]>,
    ) => void;
    isStreamActivated: () => boolean;
    clearOptimisticItem: () => void;
    clearOptimisticTurn: () => void;
    disposeListener: () => void;
    removeQueuedDraftMessages: () => void;
    clearActiveStreamIfMatch: (eventName: string) => boolean;
    upsertQueuedTurn: (queuedTurn: QueuedTurnSnapshot) => void;
    removeQueuedTurnState: (queuedTurnIds: string[]) => void;
    registerListener: (unlisten: () => void) => void;
  };
  sounds: {
    playToolcallSound: () => void;
    playTypewriterSound: () => void;
  };
  appendThinkingToParts: (
    parts: MessageParts,
    textDelta: string,
  ) => MessageParts;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsSending: Dispatch<SetStateAction<boolean>>;
  setPendingActions: Dispatch<SetStateAction<ActionRequired[]>>;
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
  setThreadTurns: Dispatch<SetStateAction<AgentThreadTurn[]>>;
  setCurrentTurnId: Dispatch<SetStateAction<string | null>>;
  setExecutionRuntime: Dispatch<
    SetStateAction<AsterSessionExecutionRuntime | null>
  >;
}

export async function executeAgentStreamSubmit(
  options: ExecuteAgentStreamSubmitOptions,
) {
  const {
    runtime,
    ensureSession,
    attemptSilentTurnRecovery,
    sessionIdRef,
    getRequiredWorkspaceId,
    getSyncedSessionExecutionStrategy,
    getSyncedSessionRecentPreferences,
    effectiveAccessMode,
    content,
    images,
    skipUserMessage,
    expectingQueue,
    effectiveProviderType,
    effectiveModel,
    effectiveExecutionStrategy,
    modelOverride,
    webSearch,
    thinking,
    autoContinue,
    systemPrompt,
    requestMetadata,
    assistantDraft,
    skipSessionRestore,
    skipSessionStartHooks,
    skipPreSubmitResume,
    executionRuntime,
    syncedSessionModelPreference,
    eventName,
    requestTurnId,
    requestState,
    assistantMsgId,
    pendingTurnKey,
    pendingItemKey,
    warnedKeysRef,
    actionLoggedKeys,
    toolLogIdByToolId,
    toolStartedAtByToolId,
    toolNameByToolId,
    observer,
    onWriteFile,
    callbacks,
    sounds,
    appendThinkingToParts,
    setMessages,
    setIsSending,
    setPendingActions,
    setThreadItems,
    setThreadTurns,
    setCurrentTurnId,
    setExecutionRuntime,
  } = options;

  const performanceTrace =
    extractAgentUiPerformanceTraceMetadata(requestMetadata);
  requestState.performanceTrace = performanceTrace;

  const {
    activeSessionId,
    resolvedWorkspaceId,
    submitWorkspaceId,
    syncedRecentPreferences,
    syncedExecutionStrategy,
    effectiveWaitingRuntimeStatus,
  } = await resolveAgentStreamSubmitContext({
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
    skipSessionStartHooks,
    performanceTrace,
    activateStream: callbacks.activateStream,
  });

  const unlisten = await registerAgentStreamTurnEventBinding({
    runtime,
    eventName,
    requestState,
    attemptSilentTurnRecovery,
    skipUserMessage,
    effectiveProviderType,
    effectiveModel,
    effectiveExecutionStrategy,
    systemPrompt,
    thinking,
    content,
    webSearch,
    autoContinue,
    expectingQueue,
    activeSessionId,
    resolvedWorkspaceId,
    assistantMsgId,
    pendingTurnKey,
    pendingItemKey,
    effectiveWaitingRuntimeStatus,
    warnedKeysRef,
    actionLoggedKeys,
    toolLogIdByToolId,
    toolStartedAtByToolId,
    toolNameByToolId,
    observer,
    onWriteFile,
    callbacks: {
      activateStream: callbacks.activateStream,
      isStreamActivated: callbacks.isStreamActivated,
      clearOptimisticItem: callbacks.clearOptimisticItem,
      clearOptimisticTurn: callbacks.clearOptimisticTurn,
      disposeListener: callbacks.disposeListener,
      removeQueuedDraftMessages: callbacks.removeQueuedDraftMessages,
      clearActiveStreamIfMatch: callbacks.clearActiveStreamIfMatch,
      upsertQueuedTurn: callbacks.upsertQueuedTurn,
      removeQueuedTurnState: callbacks.removeQueuedTurnState,
    },
    sounds,
    appendThinkingToParts,
    setMessages,
    setPendingActions,
    setThreadItems,
    setThreadTurns,
    setCurrentTurnId,
    setExecutionRuntime,
    setIsSending,
  });

  callbacks.registerListener(unlisten);

  requestState.submissionDispatchedAt = Date.now();
  recordAgentStreamPerformanceMetric(
    "agentStream.submitDispatched",
    performanceTrace,
    {
      elapsedMs:
        requestState.submissionDispatchedAt - requestState.requestStartedAt,
      eventName,
      expectingQueue,
      listenerBoundDeltaMs: requestState.listenerBoundAt
        ? requestState.submissionDispatchedAt - requestState.listenerBoundAt
        : null,
      model: effectiveModel,
      provider: effectiveProviderType,
      sessionId: activeSessionId,
    },
  );
  logAgentDebug("AgentStream", "submitDispatched", {
    elapsedMs:
      requestState.submissionDispatchedAt - requestState.requestStartedAt,
    eventName,
    expectingQueue,
    listenerBoundDeltaMs: requestState.listenerBoundAt
      ? requestState.submissionDispatchedAt - requestState.listenerBoundAt
      : null,
    sessionId: activeSessionId,
  });

  try {
    await runtime.submitOp(
      buildUserInputSubmitOp({
        content,
        images,
        sessionId: activeSessionId,
        eventName,
        workspaceId: submitWorkspaceId,
        turnId: requestTurnId,
        systemPrompt,
        queueIfBusy: true,
        skipPreSubmitResume,
        requestMetadata,
        executionRuntime,
        syncedRecentPreferences,
        syncedSessionModelPreference,
        syncedExecutionStrategy,
        effectiveExecutionStrategy,
        effectiveAccessMode,
        effectiveProviderType,
        effectiveModel,
        modelOverride,
        webSearch,
        thinking,
        autoContinue,
      }),
    );
    recordAgentStreamPerformanceMetric(
      "agentStream.submitAccepted",
      performanceTrace,
      {
        elapsedMs: Date.now() - requestState.requestStartedAt,
        eventName,
        sessionId: activeSessionId,
        submitInvokeMs: requestState.submissionDispatchedAt
          ? Date.now() - requestState.submissionDispatchedAt
          : null,
      },
    );
    logAgentDebug("AgentStream", "submitAccepted", {
      elapsedMs: Date.now() - requestState.requestStartedAt,
      eventName,
      sessionId: activeSessionId,
      submitInvokeMs: requestState.submissionDispatchedAt
        ? Date.now() - requestState.submissionDispatchedAt
        : null,
    });
  } catch (error) {
    recordAgentStreamPerformanceMetric(
      "agentStream.submitFailed",
      performanceTrace,
      {
        elapsedMs: Date.now() - requestState.requestStartedAt,
        error: error instanceof Error ? error.message : String(error),
        eventName,
        sessionId: activeSessionId,
        submitInvokeMs: requestState.submissionDispatchedAt
          ? Date.now() - requestState.submissionDispatchedAt
          : null,
      },
    );
    logAgentDebug(
      "AgentStream",
      "submitFailed",
      {
        elapsedMs: Date.now() - requestState.requestStartedAt,
        error,
        eventName,
        sessionId: activeSessionId,
        submitInvokeMs: requestState.submissionDispatchedAt
          ? Date.now() - requestState.submissionDispatchedAt
          : null,
      },
      { level: "error" },
    );
    throw error;
  }
}
