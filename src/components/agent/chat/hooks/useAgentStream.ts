import {
  useCallback,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import type {
  AsterExecutionStrategy,
  AsterSessionExecutionRuntime,
  AutoContinueRequestPayload,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import {
  type AgentThreadItem,
  type AgentThreadTurn,
} from "@/lib/api/agentProtocol";
import type { ActionRequired, Message, MessageImage } from "../types";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { AgentAccessMode } from "./agentChatStorage";
import { playToolcallSound, playTypewriterSound } from "./agentChatStorage";
import type {
  SendMessageOptions,
  SessionModelPreference,
  WorkspacePathMissingState,
} from "./agentChatShared";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import {
  createAgentStreamPreparedSendEnv,
  type AgentStreamPreparedSendEnv,
} from "./agentStreamPreparedSendEnv";
import { AgentStreamSubmitGate } from "./agentStreamSubmitGate";
import {
  normalizeAgentStreamCompactionError,
  runAgentStreamCompaction,
} from "./agentStreamCompaction";
import {
  promoteQueuedAgentTurn,
  removeQueuedAgentTurn,
  resumeAgentStreamThread,
  stopActiveAgentStream,
} from "./agentStreamFlowControl";
import { sendAgentStreamMessage } from "./agentStreamSend";
import { useAgentStreamController } from "./useAgentStreamController";

function appendThinkingToParts(
  parts: NonNullable<Message["contentParts"]>,
  textDelta: string,
): NonNullable<Message["contentParts"]> {
  const nextParts = [...parts];
  const lastPart = nextParts[nextParts.length - 1];

  if (lastPart?.type === "thinking") {
    nextParts[nextParts.length - 1] = {
      type: "thinking",
      text: lastPart.text + textDelta,
    };
    return nextParts;
  }

  nextParts.push({
    type: "thinking",
    text: textDelta,
  });
  return nextParts;
}

interface UseAgentStreamOptions {
  runtime: AgentRuntimeAdapter;
  systemPrompt?: string;
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: import("../types").WriteArtifactContext,
  ) => void;
  ensureSession: () => Promise<string | null>;
  attemptSilentTurnRecovery: (
    sessionId: string,
    requestStartedAt: number,
    promptText: string,
  ) => Promise<boolean>;
  sessionIdRef: MutableRefObject<string | null>;
  executionStrategy: AsterExecutionStrategy;
  accessMode: AgentAccessMode;
  providerTypeRef: MutableRefObject<string>;
  modelRef: MutableRefObject<string>;
  getSyncedSessionModelPreference: (
    sessionId: string,
  ) => SessionModelPreference | null;
  getSyncedSessionExecutionStrategy: (
    sessionId: string,
  ) => AsterExecutionStrategy | null;
  getSyncedSessionRecentPreferences?: (
    sessionId: string,
  ) => ChatToolPreferences | null;
  currentAssistantMsgIdRef: MutableRefObject<string | null>;
  currentStreamingSessionIdRef: MutableRefObject<string | null>;
  currentStreamingEventNameRef: MutableRefObject<string | null>;
  warnedKeysRef: MutableRefObject<Set<string>>;
  getRequiredWorkspaceId: () => string;
  setWorkspacePathMissing: Dispatch<
    SetStateAction<WorkspacePathMissingState | null>
  >;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
  setThreadTurns: Dispatch<SetStateAction<AgentThreadTurn[]>>;
  setCurrentTurnId: Dispatch<SetStateAction<string | null>>;
  setExecutionRuntime: Dispatch<
    SetStateAction<AsterSessionExecutionRuntime | null>
  >;
  threadBusy: boolean;
  queuedTurns: QueuedTurnSnapshot[];
  setQueuedTurns: Dispatch<SetStateAction<QueuedTurnSnapshot[]>>;
  setPendingActions: Dispatch<SetStateAction<ActionRequired[]>>;
  refreshSessionReadModel: (targetSessionId?: string) => Promise<boolean>;
  executionRuntime: AsterSessionExecutionRuntime | null;
}

export function useAgentStream(options: UseAgentStreamOptions) {
  const {
    runtime,
    systemPrompt,
    onWriteFile,
    ensureSession,
    attemptSilentTurnRecovery,
    sessionIdRef,
    executionStrategy,
    accessMode,
    providerTypeRef,
    modelRef,
    getSyncedSessionModelPreference,
    getSyncedSessionExecutionStrategy,
    getSyncedSessionRecentPreferences,
    currentAssistantMsgIdRef,
    currentStreamingSessionIdRef,
    currentStreamingEventNameRef,
    warnedKeysRef,
    getRequiredWorkspaceId,
    setWorkspacePathMissing,
    setMessages,
    setThreadItems,
    setThreadTurns,
    setCurrentTurnId,
    setExecutionRuntime,
    threadBusy,
    queuedTurns,
    setQueuedTurns,
    setPendingActions,
    refreshSessionReadModel,
    executionRuntime,
  } = options;

  const {
    isSending,
    setIsSending,
    listenerMapRef,
    activeStreamRef,
    setActiveStream,
    clearActiveStreamIfMatch,
    replaceStreamListener,
    removeStreamListener,
  } = useAgentStreamController({
    currentAssistantMsgIdRef,
    currentStreamingSessionIdRef,
    currentStreamingEventNameRef,
  });
  const preparedSubmitGateRef = useRef(new AgentStreamSubmitGate());

  const preparedSendEnv = useMemo<AgentStreamPreparedSendEnv>(
    () =>
      createAgentStreamPreparedSendEnv({
        queuedTurnsCount: queuedTurns.length,
        threadBusy,
        runtime,
        ensureSession,
        attemptSilentTurnRecovery,
        executionStrategy,
        accessMode,
        providerTypeRef,
        modelRef,
        sessionIdRef,
        hasPendingPreparedSubmit: () =>
          preparedSubmitGateRef.current.hasPending(),
        runPreparedSubmit: (task) => preparedSubmitGateRef.current.run(task),
        getRequiredWorkspaceId,
        getSyncedSessionModelPreference,
        getSyncedSessionExecutionStrategy,
        getSyncedSessionRecentPreferences,
        listenerMapRef,
        activeStreamRef,
        warnedKeysRef,
        onWriteFile,
        executionRuntime,
        setActiveStream,
        clearActiveStreamIfMatch,
        setMessages,
        setThreadItems,
        setThreadTurns,
        setCurrentTurnId,
        setExecutionRuntime,
        setQueuedTurns,
        setPendingActions,
        setWorkspacePathMissing,
        setIsSending,
        playToolcallSound,
        playTypewriterSound,
        appendThinkingToParts,
      }),
    [
      activeStreamRef,
      accessMode,
      attemptSilentTurnRecovery,
      clearActiveStreamIfMatch,
      executionStrategy,
      ensureSession,
      executionRuntime,
      getRequiredWorkspaceId,
      getSyncedSessionModelPreference,
      getSyncedSessionExecutionStrategy,
      getSyncedSessionRecentPreferences,
      listenerMapRef,
      modelRef,
      onWriteFile,
      providerTypeRef,
      queuedTurns.length,
      runtime,
      sessionIdRef,
      threadBusy,
      setActiveStream,
      setCurrentTurnId,
      setExecutionRuntime,
      setIsSending,
      setMessages,
      setPendingActions,
      setQueuedTurns,
      setThreadItems,
      setThreadTurns,
      setWorkspacePathMissing,
      warnedKeysRef,
    ],
  );

  const sendMessage = useCallback(
    async (
      content: string,
      images: MessageImage[],
      webSearch?: boolean,
      _thinking?: boolean,
      skipUserMessage = false,
      executionStrategyOverride?: AsterExecutionStrategy,
      modelOverride?: string,
      autoContinue?: AutoContinueRequestPayload,
      options?: SendMessageOptions,
    ) => {
      await sendAgentStreamMessage({
        content,
        images,
        webSearch,
        thinking: _thinking,
        skipUserMessage,
        executionStrategyOverride,
        modelOverride,
        autoContinue,
        systemPrompt,
        options,
        env: preparedSendEnv,
      });
    },
    [preparedSendEnv, systemPrompt],
  );

  const stopSending = useCallback(async () => {
    await stopActiveAgentStream({
      activeStream: activeStreamRef.current,
      sessionIdRef,
      runtime,
      removeStreamListener,
      refreshSessionReadModel,
      setQueuedTurns,
      setThreadItems,
      setThreadTurns,
      setCurrentTurnId,
      setMessages,
      setActiveStream,
      notify: {
        info: (message) => toast.info(message),
        error: () => undefined,
      },
      onInterruptError: (error) => {
        console.error("[AsterChat] 停止失败:", error);
      },
    });
  }, [
    refreshSessionReadModel,
    runtime,
    sessionIdRef,
    setActiveStream,
    setCurrentTurnId,
    setMessages,
    setQueuedTurns,
    setThreadItems,
    setThreadTurns,
    removeStreamListener,
    activeStreamRef,
  ]);

  const removeQueuedTurn = useCallback(
    async (queuedTurnId: string) => {
      return removeQueuedAgentTurn({
        runtime,
        queuedTurnId,
        sessionIdRef,
        refreshSessionReadModel,
        setQueuedTurns,
        notify: {
          info: () => undefined,
          error: (message) => toast.error(message),
        },
        onError: (error) => {
          console.error("[AsterChat] 移除排队消息失败:", error);
        },
      });
    },
    [refreshSessionReadModel, runtime, sessionIdRef, setQueuedTurns],
  );

  const compactSession = useCallback(async () => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) {
      toast.error("当前没有可压缩的会话");
      return;
    }

    if (activeStreamRef.current) {
      toast.info("当前仍有任务执行中，稍后再压缩上下文");
      return;
    }

    try {
      await runAgentStreamCompaction({
        runtime,
        sessionId: activeSessionId,
        warnedKeysRef,
        setActiveStream,
        clearActiveStreamIfMatch,
        replaceStreamListener,
        removeStreamListener,
        setCurrentTurnId,
        setThreadItems,
        setThreadTurns,
        notify: {
          info: (message) => toast.info(message),
          warning: (message) => toast.warning(message),
          error: (message) => toast.error(message),
        },
      });
    } catch (error) {
      const compactionError = normalizeAgentStreamCompactionError(error);
      console.error("[AsterChat] 压缩上下文失败:", compactionError);
      if (!compactionError.alreadyNotified) {
        toast.error(compactionError.message);
      }
    }
  }, [
    clearActiveStreamIfMatch,
    removeStreamListener,
    replaceStreamListener,
    runtime,
    sessionIdRef,
    setActiveStream,
    setCurrentTurnId,
    setThreadItems,
    setThreadTurns,
    warnedKeysRef,
    activeStreamRef,
  ]);

  const resumeThread = useCallback(async () => {
    return resumeAgentStreamThread({
      runtime,
      sessionIdRef,
      refreshSessionReadModel,
      notify: {
        info: (message) => toast.info(message),
        error: (message) => toast.error(message),
      },
      onError: (error) => {
        console.error("[AsterChat] 恢复线程执行失败:", error);
      },
    });
  }, [refreshSessionReadModel, runtime, sessionIdRef]);

  const promoteQueuedTurn = useCallback(
    async (queuedTurnId: string) => {
      return promoteQueuedAgentTurn({
        runtime,
        queuedTurnId,
        activeStream: activeStreamRef.current,
        removeStreamListener,
        sessionIdRef,
        refreshSessionReadModel,
        setQueuedTurns,
        setThreadItems,
        setThreadTurns,
        setCurrentTurnId,
        setMessages,
        setActiveStream,
        notify: {
          info: (message) => toast.info(message),
          error: (message) => toast.error(message),
        },
        onError: (error) => {
          console.error("[AsterChat] 立即执行排队消息失败:", error);
        },
      });
    },
    [
      activeStreamRef,
      refreshSessionReadModel,
      removeStreamListener,
      runtime,
      sessionIdRef,
      setActiveStream,
      setCurrentTurnId,
      setMessages,
      setQueuedTurns,
      setThreadItems,
      setThreadTurns,
    ],
  );

  return {
    isSending,
    sendMessage,
    compactSession,
    stopSending,
    resumeThread,
    promoteQueuedTurn,
    removeQueuedTurn,
  };
}
