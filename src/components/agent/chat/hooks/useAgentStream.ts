import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  parseAgentEvent,
  type AgentThreadItem,
  type AgentThreadTurn,
} from "@/lib/api/agentProtocol";
import type { ActionRequired, Message, MessageImage } from "../types";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import { playToolcallSound, playTypewriterSound } from "./agentChatStorage";
import { updateMessageArtifactsStatus } from "../utils/messageArtifacts";
import type {
  SendMessageOptions,
  SessionModelPreference,
  WorkspacePathMissingState,
} from "./agentChatShared";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import {
  removeThreadItemState,
  removeThreadTurnState,
  upsertThreadItemState,
  upsertThreadTurnState,
} from "./agentThreadState";
import { dispatchPreparedAgentStreamSend } from "./agentStreamPreparedSendDispatch";
import type { AgentStreamPreparedSendEnv } from "./agentStreamPreparedSendEnv";
import { prepareAgentStreamUserInputSend } from "./agentStreamUserInputSendPreparation";
import { resolveRuntimeWarningToastPresentation } from "./runtimeWarningPresentation";

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
  sessionIdRef: MutableRefObject<string | null>;
  executionStrategy: AsterExecutionStrategy;
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
    sessionIdRef,
    executionStrategy,
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
    queuedTurns,
    setQueuedTurns,
    setPendingActions,
    refreshSessionReadModel,
    executionRuntime,
  } = options;

  const [isSending, setIsSending] = useState(false);
  const listenerMapRef = useRef(new Map<string, () => void>());
  const activeStreamRef = useRef<{
    assistantMsgId: string;
    eventName: string;
    sessionId: string;
    pendingTurnKey?: string;
    pendingItemKey?: string;
  } | null>(null);

  useEffect(() => {
    const listenerMap = listenerMapRef.current;
    return () => {
      for (const unlisten of listenerMap.values()) {
        unlisten();
      }
      listenerMap.clear();
    };
  }, []);

  const setActiveStream = useCallback(
    (
      nextActive: {
        assistantMsgId: string;
        eventName: string;
        sessionId: string;
        pendingTurnKey?: string;
        pendingItemKey?: string;
      } | null,
    ) => {
      activeStreamRef.current = nextActive;
      currentAssistantMsgIdRef.current = nextActive?.assistantMsgId ?? null;
      currentStreamingSessionIdRef.current = nextActive?.sessionId ?? null;
      currentStreamingEventNameRef.current = nextActive?.eventName ?? null;
      setIsSending(Boolean(nextActive));
    },
    [
      currentAssistantMsgIdRef,
      currentStreamingEventNameRef,
      currentStreamingSessionIdRef,
    ],
  );

  const clearActiveStreamIfMatch = useCallback(
    (eventName: string) => {
      if (activeStreamRef.current?.eventName !== eventName) {
        return false;
      }
      setActiveStream(null);
      return true;
    },
    [setActiveStream],
  );

  const preparedSendEnv = useMemo<AgentStreamPreparedSendEnv>(
    () => ({
      runtime,
      ensureSession,
      executionStrategy,
      providerTypeRef,
      modelRef,
      sessionIdRef,
      getQueuedTurnsCount: () => queuedTurns.length,
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
      clearActiveStreamIfMatch,
      executionStrategy,
      ensureSession,
      executionRuntime,
      getRequiredWorkspaceId,
      getSyncedSessionModelPreference,
      getSyncedSessionExecutionStrategy,
      getSyncedSessionRecentPreferences,
      modelRef,
      onWriteFile,
      providerTypeRef,
      queuedTurns.length,
      runtime,
      sessionIdRef,
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
      const preparedSend = prepareAgentStreamUserInputSend({
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

      await dispatchPreparedAgentStreamSend({
        preparedSend,
        env: preparedSendEnv,
      });
    },
    [preparedSendEnv, systemPrompt],
  );

  const stopSending = useCallback(async () => {
    const activeStream = activeStreamRef.current;
    if (activeStream) {
      const activeUnlisten = listenerMapRef.current.get(activeStream.eventName);
      if (activeUnlisten) {
        activeUnlisten();
        listenerMapRef.current.delete(activeStream.eventName);
      }
    }

    const activeSessionId = activeStream?.sessionId || sessionIdRef.current;
    if (activeSessionId) {
      try {
        await runtime.interruptTurn(activeSessionId);
      } catch (e) {
        console.error("[AsterChat] 停止失败:", e);
      }
    }

    setQueuedTurns([]);

    if (activeStream?.assistantMsgId) {
      if (activeStream.pendingItemKey) {
        setThreadItems((prev) =>
          removeThreadItemState(prev, activeStream.pendingItemKey!),
        );
      }
      if (activeStream.pendingTurnKey) {
        setThreadTurns((prev) =>
          removeThreadTurnState(prev, activeStream.pendingTurnKey!),
        );
        setCurrentTurnId((prev) =>
          prev === activeStream.pendingTurnKey ? null : prev,
        );
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === activeStream.assistantMsgId
            ? {
                ...updateMessageArtifactsStatus(msg, "complete"),
                isThinking: false,
                content: msg.content || "(已停止)",
                runtimeStatus: undefined,
              }
            : msg,
        ),
      );
    }

    setActiveStream(null);
    if (activeSessionId) {
      await refreshSessionReadModel(activeSessionId);
    }
    toast.info("已停止生成");
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
  ]);

  const removeQueuedTurn = useCallback(
    async (queuedTurnId: string) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId || !queuedTurnId.trim()) {
        return false;
      }

      try {
        const removed = await runtime.removeQueuedTurn(
          activeSessionId,
          queuedTurnId,
        );
        if (removed) {
          setQueuedTurns((prev) =>
            prev
              .filter((item) => item.queued_turn_id !== queuedTurnId)
              .map((item, index) => ({
                ...item,
                position: index + 1,
              })),
          );
        }
        await refreshSessionReadModel(activeSessionId);
        return removed;
      } catch (error) {
        console.error("[AsterChat] 移除排队消息失败:", error);
        await refreshSessionReadModel(activeSessionId);
        toast.error("移除排队消息失败");
        return false;
      }
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

    const eventName = `agent_context_compaction_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const disposeListener = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (unlisten) {
        unlisten();
      }
      listenerMapRef.current.delete(eventName);
    };

    setActiveStream({
      assistantMsgId: `context_compaction:${crypto.randomUUID()}`,
      eventName,
      sessionId: activeSessionId,
    });

    try {
      unlisten = await runtime.listenToTurnEvents(eventName, (event) => {
        const data = parseAgentEvent(event.payload);
        if (!data) {
          return;
        }

        switch (data.type) {
          case "turn_started":
            setCurrentTurnId(data.turn.id);
            setThreadTurns((prev) => upsertThreadTurnState(prev, data.turn));
            break;
          case "item_started":
          case "item_updated":
          case "item_completed":
            setThreadItems((prev) => upsertThreadItemState(prev, data.item));
            break;
          case "turn_completed":
          case "turn_failed":
            setCurrentTurnId(data.turn.id);
            setThreadTurns((prev) => upsertThreadTurnState(prev, data.turn));
            break;
          case "warning": {
            const warningKey = `${activeSessionId}:${data.code || data.message}`;
            if (!warnedKeysRef.current.has(warningKey)) {
              warnedKeysRef.current.add(warningKey);
              const presentation = resolveRuntimeWarningToastPresentation({
                code: data.code,
                message: data.message,
              });
              if (!presentation.shouldToast) {
                break;
              }
              switch (presentation.level) {
                case "info":
                  toast.info(presentation.message);
                  break;
                case "error":
                  toast.error(presentation.message);
                  break;
                case "warning":
                default:
                  toast.warning(presentation.message);
                  break;
              }
            }
            break;
          }
          case "error":
            toast.error(`压缩上下文失败: ${data.message}`);
            clearActiveStreamIfMatch(eventName);
            disposeListener();
            break;
          case "final_done":
            clearActiveStreamIfMatch(eventName);
            disposeListener();
            break;
          default:
            break;
        }
      });

      listenerMapRef.current.set(eventName, unlisten);
      await runtime.compactSession(activeSessionId, eventName);
    } catch (error) {
      console.error("[AsterChat] 压缩上下文失败:", error);
      clearActiveStreamIfMatch(eventName);
      disposeListener();
      toast.error(
        error instanceof Error ? error.message : "压缩上下文失败，请稍后重试",
      );
    }
  }, [
    clearActiveStreamIfMatch,
    runtime,
    sessionIdRef,
    setActiveStream,
    setCurrentTurnId,
    setThreadItems,
    setThreadTurns,
    warnedKeysRef,
  ]);

  const resumeThread = useCallback(async () => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) {
      return false;
    }

    try {
      const resumed = await runtime.resumeThread(activeSessionId);
      await refreshSessionReadModel(activeSessionId);
      if (resumed) {
        toast.info("正在恢复排队执行");
      }
      return resumed;
    } catch (error) {
      console.error("[AsterChat] 恢复线程执行失败:", error);
      await refreshSessionReadModel(activeSessionId);
      toast.error("恢复线程执行失败");
      return false;
    }
  }, [refreshSessionReadModel, runtime, sessionIdRef]);

  const promoteQueuedTurn = useCallback(
    async (queuedTurnId: string) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId || !queuedTurnId.trim()) {
        return false;
      }

      setQueuedTurns((prev) =>
        prev
          .filter((item) => item.queued_turn_id !== queuedTurnId)
          .map((item, index) => ({
            ...item,
            position: index + 1,
          })),
      );

      try {
        const promoted = await runtime.promoteQueuedTurn(
          activeSessionId,
          queuedTurnId,
        );
        await refreshSessionReadModel(activeSessionId);
        if (!promoted) {
          return false;
        }

        toast.info("正在切换到该排队任务");
        return true;
      } catch (error) {
        console.error("[AsterChat] 立即执行排队消息失败:", error);
        await refreshSessionReadModel(activeSessionId);
        toast.error("立即执行排队消息失败");
        return false;
      }
    },
    [refreshSessionReadModel, runtime, sessionIdRef, setQueuedTurns],
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
