import { createAgentStreamSubmissionLifecycle } from "./agentStreamSubmissionLifecycle";
import { executeAgentStreamSubmit } from "./agentStreamSubmitExecution";
import { handleAgentStreamSubmitFailure } from "./agentStreamSubmitFailure";
import type { PreparedAgentStreamUserInputSend } from "./agentStreamUserInputSendPreparation";
import type { AgentStreamPreparedSendEnv } from "./agentStreamPreparedSendEnv";

interface SubmitAgentStreamUserInputOptions {
  preparedSend: PreparedAgentStreamUserInputSend;
  env: AgentStreamPreparedSendEnv;
}

export async function submitAgentStreamUserInput(
  options: SubmitAgentStreamUserInputOptions,
) {
  const { preparedSend, env } = options;
  const {
    assistantMsg,
    assistantMsgId,
    userMsgId,
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
    observer,
    syncedSessionModelPreference,
  } = preparedSend;

  const lifecycle = createAgentStreamSubmissionLifecycle({
    assistantMsg,
    assistantMsgId,
    userMsgId,
    content,
    expectingQueue,
    initialThreadId: env.sessionIdRef.current || `local-thread:${assistantMsgId}`,
    listenerMapRef: env.listenerMapRef,
    setActiveStream: env.setActiveStream,
    setMessages: env.setMessages,
    setQueuedTurns: env.setQueuedTurns,
    setThreadItems: env.setThreadItems,
    setThreadTurns: env.setThreadTurns,
    setCurrentTurnId: env.setCurrentTurnId,
  });

  const {
    eventName,
    requestTurnId,
    requestState,
    pendingTurnKey,
    pendingItemKey,
    toolLogIdByToolId,
    toolStartedAtByToolId,
    toolNameByToolId,
    actionLoggedKeys,
    activateStream,
    clearOptimisticItem,
    clearOptimisticTurn,
    disposeListener,
    upsertQueuedTurn,
    removeQueuedTurnState,
    removeQueuedDraftMessages,
    markOptimisticFailure,
    registerListener,
    isStreamActivated,
  } = lifecycle;

  try {
    await executeAgentStreamSubmit({
      runtime: env.runtime,
      ensureSession: env.ensureSession,
      sessionIdRef: env.sessionIdRef,
      getRequiredWorkspaceId: env.getRequiredWorkspaceId,
      getSyncedSessionExecutionStrategy: env.getSyncedSessionExecutionStrategy,
      getSyncedSessionRecentPreferences: env.getSyncedSessionRecentPreferences,
      effectiveAccessMode: env.accessMode,
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
      executionRuntime: env.executionRuntime,
      syncedSessionModelPreference,
      eventName,
      requestTurnId,
      requestState,
      assistantMsgId,
      pendingTurnKey,
      pendingItemKey,
      warnedKeysRef: env.warnedKeysRef,
      actionLoggedKeys,
      toolLogIdByToolId,
      toolStartedAtByToolId,
      toolNameByToolId,
      observer,
      onWriteFile: env.onWriteFile,
      callbacks: {
        activateStream,
        isStreamActivated,
        clearOptimisticItem,
        clearOptimisticTurn,
        disposeListener,
        removeQueuedDraftMessages,
        clearActiveStreamIfMatch: env.clearActiveStreamIfMatch,
        upsertQueuedTurn,
        removeQueuedTurnState,
        registerListener,
      },
      sounds: {
        playToolcallSound: env.playToolcallSound,
        playTypewriterSound: env.playTypewriterSound,
      },
      appendThinkingToParts: env.appendThinkingToParts,
      setMessages: env.setMessages,
      setIsSending: env.setIsSending,
      setPendingActions: env.setPendingActions,
      setThreadItems: env.setThreadItems,
      setThreadTurns: env.setThreadTurns,
      setCurrentTurnId: env.setCurrentTurnId,
      setExecutionRuntime: env.setExecutionRuntime,
    });
  } catch (error) {
    handleAgentStreamSubmitFailure({
      error,
      requestState,
      observer,
      content,
      images,
      assistantMsgId,
      expectingQueue,
      eventName,
      activeStreamRef: env.activeStreamRef,
      setMessages: env.setMessages,
      setWorkspacePathMissing: env.setWorkspacePathMissing,
      setIsSending: env.setIsSending,
      clearActiveStreamIfMatch: env.clearActiveStreamIfMatch,
      disposeListener,
      removeQueuedTurnState,
      markOptimisticFailure,
    });
  }
}
