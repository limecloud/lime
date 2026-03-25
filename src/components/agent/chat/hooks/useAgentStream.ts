import {
  useCallback,
  useEffect,
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
import { activityLogger } from "@/components/content-creator/utils/activityLogger";
import {
  parseSkillSlashCommand,
  tryExecuteSlashSkillCommand,
} from "./skillCommand";
import {
  isWorkspacePathErrorMessage,
  mapProviderName,
} from "./agentChatCoreUtils";
import { playToolcallSound, playTypewriterSound } from "./agentChatStorage";
import { updateMessageArtifactsStatus } from "../utils/messageArtifacts";
import type {
  SendMessageOptions,
  WorkspacePathMissingState,
} from "./agentChatShared";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import {
  removeThreadItemState,
  removeThreadTurnState,
  upsertThreadItemState,
  upsertThreadTurnState,
} from "./agentThreadState";
import {
  buildFailedAgentMessageContent,
  buildFailedAgentRuntimeStatus,
  buildInitialAgentRuntimeStatus,
  buildWaitingAgentRuntimeStatus,
  formatAgentRuntimeStatusSummary,
} from "../utils/agentRuntimeStatus";
import { handleTurnStreamEvent } from "./agentStreamRuntimeHandler";

function buildQueuedMessagePreview(content: string): string {
  const compact = content.split(/\s+/).filter(Boolean).join(" ");
  if (!compact) {
    return "空白输入";
  }

  const preview = Array.from(compact).slice(0, 80).join("");
  return compact.length > preview.length ? `${preview}...` : preview;
}

function normalizeRuntimeIdentifier(value?: string | null): string {
  return value?.trim().toLowerCase() || "";
}

function createPendingTurnKey() {
  return `pending-turn:${crypto.randomUUID()}`;
}

function createPendingItemKey(pendingTurnKey: string) {
  return `pending-item:${pendingTurnKey}`;
}

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

  const buildQueuedRuntimeStatus = useCallback(
    (
      currentExecutionStrategy: AsterExecutionStrategy,
      content: string,
      webSearch?: boolean,
    ) => ({
      phase: "routing" as const,
      title: "已加入排队列表",
      detail: `当前会话仍在执行中，本条消息会在前一条完成后自动开始。待处理内容：${buildQueuedMessagePreview(content)}`,
      checkpoints: [
        "已创建待处理阶段",
        webSearch ? "联网搜索能力待命" : "直接回答优先",
        currentExecutionStrategy === "code_orchestrated"
          ? "代码编排待命"
          : currentExecutionStrategy === "react"
            ? "对话执行待命"
            : "自动路由待命",
      ],
    }),
    [],
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
      const effectiveExecutionStrategy =
        executionStrategyOverride || executionStrategy;
      const effectiveProviderType = providerTypeRef.current;
      const effectiveModel = modelOverride?.trim() || modelRef.current;
      const runtimeProviderSelector =
        executionRuntime?.provider_selector?.trim() ||
        executionRuntime?.provider_name?.trim() ||
        null;
      const runtimeModelName = executionRuntime?.model_name?.trim() || null;
      const shouldSubmitProviderPreference =
        !runtimeProviderSelector ||
        normalizeRuntimeIdentifier(runtimeProviderSelector) !==
          normalizeRuntimeIdentifier(effectiveProviderType);
      const shouldSubmitModelPreference =
        Boolean(modelOverride?.trim()) ||
        shouldSubmitProviderPreference ||
        !runtimeModelName ||
        normalizeRuntimeIdentifier(runtimeModelName) !==
          normalizeRuntimeIdentifier(effectiveModel);
      const observer = options?.observer;
      const requestMetadata = options?.requestMetadata;
      const messagePurpose = options?.purpose;
      const assistantDraft = options?.assistantDraft;
      const expectingQueue =
        Boolean(activeStreamRef.current) || queuedTurns.length > 0;

      const assistantMsgId = crypto.randomUUID();
      const userMsgId = skipUserMessage ? null : crypto.randomUUID();
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: "assistant",
        content: assistantDraft?.content || "",
        timestamp: new Date(),
        isThinking: true,
        contentParts: [],
        runtimeStatus: expectingQueue
          ? buildQueuedRuntimeStatus(
              effectiveExecutionStrategy,
              content,
              webSearch,
            )
          : assistantDraft?.initialRuntimeStatus ||
            buildInitialAgentRuntimeStatus({
              executionStrategy: effectiveExecutionStrategy,
              webSearch,
              thinking: _thinking,
              skipUserMessage,
            }),
        purpose: messagePurpose,
      };

      if (skipUserMessage) {
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        const userMsg: Message = {
          id: userMsgId as string,
          role: "user",
          content,
          images: images.length > 0 ? images : undefined,
          timestamp: new Date(),
          purpose: messagePurpose,
        };
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
      }

      if (!expectingQueue) {
        setIsSending(true);
      }

      if (!skipUserMessage && !expectingQueue) {
        const parsedSkillCommand = parseSkillSlashCommand(content);
        if (parsedSkillCommand) {
          const skillEventName = `skill-exec-${assistantMsgId}`;
          setActiveStream({
            assistantMsgId,
            eventName: skillEventName,
            sessionId: sessionIdRef.current || "",
          });
          const skillHandled = await tryExecuteSlashSkillCommand({
            command: parsedSkillCommand,
            rawContent: content,
            assistantMsgId,
            providerType: effectiveProviderType,
            model: effectiveModel || undefined,
            ensureSession,
            setMessages,
            setIsSending,
            setCurrentAssistantMsgId: (id) => {
              if (!id) {
                clearActiveStreamIfMatch(skillEventName);
                return;
              }
              setActiveStream({
                assistantMsgId: id,
                eventName: skillEventName,
                sessionId:
                  activeStreamRef.current?.sessionId ||
                  sessionIdRef.current ||
                  "",
              });
            },
            setStreamUnlisten: (unlistenFn) => {
              const previous = listenerMapRef.current.get(skillEventName);
              if (previous) {
                previous();
                listenerMapRef.current.delete(skillEventName);
              }
              if (unlistenFn) {
                listenerMapRef.current.set(skillEventName, unlistenFn);
              }
            },
            setActiveSessionIdForStop: (sessionIdForStop) => {
              if (!sessionIdForStop) {
                clearActiveStreamIfMatch(skillEventName);
                return;
              }
              setActiveStream({
                assistantMsgId:
                  activeStreamRef.current?.assistantMsgId || assistantMsgId,
                eventName: skillEventName,
                sessionId: sessionIdForStop,
                pendingTurnKey: activeStreamRef.current?.pendingTurnKey,
                pendingItemKey: activeStreamRef.current?.pendingItemKey,
              });
            },
            isExecutionCancelled: () =>
              activeStreamRef.current?.assistantMsgId !== assistantMsgId,
            playTypewriterSound,
            playToolcallSound,
            onWriteFile,
          });

          if (skillHandled) {
            return;
          }

          clearActiveStreamIfMatch(skillEventName);
        }
      }

      let unlisten: (() => void) | null = null;
      const requestState = {
        accumulatedContent: "",
        requestLogId: null as string | null,
        requestStartedAt: 0,
        requestFinished: false,
        queuedTurnId: null as string | null,
      };
      let streamActivated = false;
      const optimisticStartedAt = assistantMsg.timestamp.toISOString();
      const pendingTurnKey = createPendingTurnKey();
      const pendingItemKey = createPendingItemKey(pendingTurnKey);
      const requestTurnId = crypto.randomUUID();
      const optimisticThreadId =
        sessionIdRef.current || `local-thread:${assistantMsgId}`;
      const toolLogIdByToolId = new Map<string, string>();
      const toolStartedAtByToolId = new Map<string, number>();
      const toolNameByToolId = new Map<string, string>();
      const actionLoggedKeys = new Set<string>();

      const upsertQueuedTurn = (nextQueuedTurn: QueuedTurnSnapshot) => {
        setQueuedTurns((prev) =>
          [
            ...prev.filter(
              (item) => item.queued_turn_id !== nextQueuedTurn.queued_turn_id,
            ),
            nextQueuedTurn,
          ].sort((left, right) => {
            if (left.position !== right.position) {
              return left.position - right.position;
            }
            return left.created_at - right.created_at;
          }),
        );
      };

      const removeQueuedTurnState = (queuedTurnIds: string[]) => {
        if (queuedTurnIds.length === 0) {
          return;
        }
        setQueuedTurns((prev) => {
          const idSet = new Set(queuedTurnIds);
          return prev
            .filter((item) => !idSet.has(item.queued_turn_id))
            .map((item, index) => ({
              ...item,
              position: index + 1,
            }));
        });
      };

      const removeQueuedDraftMessages = () => {
        setMessages((prev) =>
          prev.filter(
            (msg) =>
              msg.id !== assistantMsgId &&
              (userMsgId ? msg.id !== userMsgId : true),
          ),
        );
      };

      const clearOptimisticItem = () => {
        if (expectingQueue) {
          return;
        }
        setThreadItems((prev) => removeThreadItemState(prev, pendingItemKey));
      };

      const clearOptimisticTurn = () => {
        if (expectingQueue) {
          return;
        }
        setThreadTurns((prev) => removeThreadTurnState(prev, pendingTurnKey));
        setCurrentTurnId((prev) => (prev === pendingTurnKey ? null : prev));
      };

      const markOptimisticFailure = (errorMessage: string) => {
        if (expectingQueue) {
          return;
        }

        const failedAt = new Date().toISOString();
        const failedRuntimeStatus = buildFailedAgentRuntimeStatus(errorMessage);

        setThreadTurns((prev) => {
          const currentTurn = prev.find((turn) => turn.id === pendingTurnKey);
          if (!currentTurn) {
            return prev;
          }

          return upsertThreadTurnState(prev, {
            ...currentTurn,
            status: "failed",
            error_message: errorMessage,
            completed_at: currentTurn.completed_at || failedAt,
            updated_at: failedAt,
          });
        });

        setThreadItems((prev) => {
          const currentItem = prev.find((item) => item.id === pendingItemKey);
          if (!currentItem || currentItem.type !== "turn_summary") {
            return prev;
          }

          return upsertThreadItemState(prev, {
            ...currentItem,
            status: "failed",
            completed_at: currentItem.completed_at || failedAt,
            updated_at: failedAt,
            text: formatAgentRuntimeStatusSummary(failedRuntimeStatus),
          });
        });
      };

      const disposeListener = () => {
        const registered = listenerMapRef.current.get(eventName);
        if (registered) {
          registered();
          listenerMapRef.current.delete(eventName);
        } else if (unlisten) {
          unlisten();
        }
        unlisten = null;
      };

      if (!expectingQueue) {
        setThreadTurns((prev) =>
          upsertThreadTurnState(prev, {
            id: pendingTurnKey,
            thread_id: optimisticThreadId,
            prompt_text: content,
            status: "running",
            started_at: optimisticStartedAt,
            created_at: optimisticStartedAt,
            updated_at: optimisticStartedAt,
          }),
        );
        setThreadItems((prev) =>
          upsertThreadItemState(prev, {
            id: pendingItemKey,
            thread_id: optimisticThreadId,
            turn_id: pendingTurnKey,
            sequence: 0,
            status: "in_progress",
            started_at: optimisticStartedAt,
            updated_at: optimisticStartedAt,
            type: "turn_summary",
            text: formatAgentRuntimeStatusSummary(assistantMsg.runtimeStatus),
          }),
        );
        setCurrentTurnId(pendingTurnKey);
      }

      const eventName = `aster_stream_${assistantMsgId}`;

      try {
        const activeSessionId = await ensureSession();
        if (!activeSessionId) throw new Error("无法创建会话");
        const resolvedWorkspaceId = getRequiredWorkspaceId();
        const waitingRuntimeStatus = buildWaitingAgentRuntimeStatus({
          executionStrategy: effectiveExecutionStrategy,
          webSearch,
          thinking: _thinking,
        });
        const effectiveWaitingRuntimeStatus =
          assistantDraft?.waitingRuntimeStatus || waitingRuntimeStatus;

        const activateStream = () => {
          if (streamActivated) {
            return;
          }
          streamActivated = true;
          setActiveStream({
            assistantMsgId,
            eventName,
            sessionId: activeSessionId,
            pendingTurnKey,
            pendingItemKey,
          });
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? {
                  ...msg,
                    runtimeStatus: effectiveWaitingRuntimeStatus,
                  }
                : msg,
            ),
          );
        };

        if (!expectingQueue) {
          activateStream();
          setThreadTurns((prev) =>
            upsertThreadTurnState(prev, {
              id: pendingTurnKey,
              thread_id: activeSessionId,
              prompt_text: content,
              status: "running",
              started_at: optimisticStartedAt,
              created_at: optimisticStartedAt,
              updated_at: new Date().toISOString(),
            }),
          );
          setThreadItems((prev) =>
            upsertThreadItemState(prev, {
              id: pendingItemKey,
              thread_id: activeSessionId,
              turn_id: pendingTurnKey,
              sequence: 0,
              status: "in_progress",
              started_at: optimisticStartedAt,
              updated_at: new Date().toISOString(),
              type: "turn_summary",
              text: formatAgentRuntimeStatusSummary(
                effectiveWaitingRuntimeStatus,
              ),
            }),
          );
        }

        requestState.requestStartedAt = Date.now();
        requestState.requestLogId = activityLogger.log({
          eventType: "chat_request_start",
          status: "pending",
          title: skipUserMessage ? "系统引导请求" : "发送请求",
          description: `模型: ${effectiveModel} · 策略: ${effectiveExecutionStrategy}`,
          workspaceId: resolvedWorkspaceId,
          sessionId: activeSessionId,
          source: "aster-chat",
          metadata: {
            provider: mapProviderName(effectiveProviderType),
            model: effectiveModel,
            executionStrategy: effectiveExecutionStrategy,
            contentLength: content.trim().length,
            skipUserMessage,
            autoContinueEnabled: autoContinue?.enabled ?? false,
            autoContinue: autoContinue?.enabled ? autoContinue : undefined,
            queuedSubmission: expectingQueue,
          },
        });

        unlisten = await runtime.listenToTurnEvents(
          eventName,
          (event: { payload: unknown }) => {
            const data = parseAgentEvent(event.payload);
            if (!data) {
              return;
            }

            handleTurnStreamEvent({
              data,
              requestState,
              callbacks: {
                activateStream,
                isStreamActivated: () => streamActivated,
                clearOptimisticItem,
                clearOptimisticTurn,
                disposeListener,
                removeQueuedDraftMessages,
                clearActiveStreamIfMatch,
                upsertQueuedTurn,
                removeQueuedTurnState,
                playToolcallSound,
                playTypewriterSound,
                appendThinkingToParts,
              },
              observer,
              eventName,
              pendingTurnKey,
              pendingItemKey,
              assistantMsgId,
              activeSessionId,
              resolvedWorkspaceId,
              effectiveExecutionStrategy,
              runtime,
              warnedKeysRef,
              actionLoggedKeys,
              toolLogIdByToolId,
              toolStartedAtByToolId,
              toolNameByToolId,
              onWriteFile,
              setMessages,
              setPendingActions,
              setThreadItems,
              setThreadTurns,
              setCurrentTurnId,
              setExecutionRuntime,
            });
          },
        );

        listenerMapRef.current.set(eventName, unlisten);

        const imagesToSend =
          images.length > 0
            ? images.map((img) => ({
                data: img.data,
                media_type: img.mediaType,
              }))
            : undefined;

        await runtime.submitOp({
          type: "user_input",
          text: content,
          sessionId: activeSessionId,
          eventName,
          workspaceId: resolvedWorkspaceId,
          turnId: requestTurnId,
          images: imagesToSend,
          preferences: {
            providerPreference: shouldSubmitProviderPreference
              ? effectiveProviderType
              : undefined,
            modelPreference: shouldSubmitModelPreference
              ? effectiveModel
              : undefined,
            thinking: _thinking,
            executionStrategy: effectiveExecutionStrategy,
            webSearch,
            searchMode: webSearch ? "allowed" : "disabled",
            autoContinue,
          },
          systemPrompt,
          metadata: requestMetadata,
          queueIfBusy: true,
        });
      } catch (error) {
        if (requestState.requestLogId && !requestState.requestFinished) {
          requestState.requestFinished = true;
          activityLogger.updateLog(requestState.requestLogId, {
            eventType: "chat_request_error",
            status: "error",
            duration: Date.now() - requestState.requestStartedAt,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        console.error("[AsterChat] 发送失败:", error);
        const errMsg = error instanceof Error ? error.message : String(error);
        const failedRuntimeStatus = buildFailedAgentRuntimeStatus(errMsg);
        observer?.onError?.(errMsg);
        if (
          errMsg.includes("429") ||
          errMsg.toLowerCase().includes("rate limit")
        ) {
          toast.warning("请求过于频繁，请稍后重试");
        } else if (isWorkspacePathErrorMessage(errMsg)) {
          setWorkspacePathMissing({ content, images });
        } else {
          toast.error(`发送失败: ${error}`);
        }
        markOptimisticFailure(errMsg);
        removeQueuedTurnState(
          requestState.queuedTurnId ? [requestState.queuedTurnId] : [],
        );
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...updateMessageArtifactsStatus(msg, "error"),
                  isThinking: false,
                  content: buildFailedAgentMessageContent(errMsg, msg.content),
                  runtimeStatus: failedRuntimeStatus,
                }
              : msg,
          ),
        );
        clearActiveStreamIfMatch(eventName);
        disposeListener();
        if (!expectingQueue && !activeStreamRef.current) {
          setIsSending(false);
        }
      }
    },
    [
      activeStreamRef,
      buildQueuedRuntimeStatus,
      clearActiveStreamIfMatch,
      ensureSession,
      executionStrategy,
      getRequiredWorkspaceId,
      modelRef,
      onWriteFile,
      providerTypeRef,
      queuedTurns.length,
      runtime,
      executionRuntime,
      sessionIdRef,
      setActiveStream,
      setCurrentTurnId,
      setExecutionRuntime,
      setMessages,
      setPendingActions,
      setQueuedTurns,
      setThreadItems,
      setThreadTurns,
      setWorkspacePathMissing,
      systemPrompt,
      warnedKeysRef,
    ],
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
              toast.warning(data.message);
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
