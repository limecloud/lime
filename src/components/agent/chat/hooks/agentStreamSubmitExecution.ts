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
import { buildUserInputSubmitOp } from "../utils/buildUserInputSubmitOp";
import { resolveAgentStreamSubmitContext } from "./agentStreamSubmitContext";
import { registerAgentStreamTurnEventBinding } from "./agentStreamTurnEventBinding";

type MessageParts = NonNullable<Message["contentParts"]>;

interface ExecuteAgentStreamSubmitOptions {
  runtime: AgentRuntimeAdapter;
  ensureSession: () => Promise<string | null>;
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
    activateStream: callbacks.activateStream,
  });

  const unlisten = await registerAgentStreamTurnEventBinding({
    runtime,
    eventName,
    requestState,
    skipUserMessage,
    effectiveProviderType,
    effectiveModel,
    effectiveExecutionStrategy,
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
}
