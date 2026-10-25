import type { AgentStreamResumeBindingTarget } from "./streamResumeTarget";
import {
  hasLocallyStartedAgentStreamBinding,
  hasLocallyInterruptedAgentStreamBinding,
} from "./streamBindingRecords";
import {
  findExistingAssistantMessageId,
  findExistingTurnSummaryItemId,
  upsertRecoveredAssistantMessage,
  upsertRecoveredRunningTurn,
  commitRecoveredAssistantProjection,
} from "./streamResumeProjection";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  parseAgentEvent,
  type AgentThreadItem,
  type AgentThreadTurn,
} from "@/lib/api/agentProtocol";
import type {
  AgentExecutionStrategy,
  AgentSessionExecutionRuntime,
} from "@/lib/api/agentExecutionRuntime";
import type { ActionRequired, Message } from "../types";
import { buildWaitingAgentRuntimeStatus } from "../utils/agentRuntimeStatus";

import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import { handleTurnStreamEvent } from "./agentStreamRuntimeHandler";
import type { StreamRequestState } from "./agentStreamRuntimeHandlerTypes";
import type { ActiveStreamState } from "./agentStreamSubmissionLifecycle";
import { upsertThreadTurnState } from "./agentThreadState";
import { reconcileAgentStreamProjectionItems } from "./agentStreamConversationProjection";
type MessageParts = NonNullable<Message["contentParts"]>;

interface ActiveAgentStreamBindingState {
  activeStreamRef: MutableRefObject<ActiveStreamState | null>;
  listenerMapRef: MutableRefObject<Map<string, () => void>>;
  target?: AgentStreamResumeBindingTarget | null;
}

interface BindRecoveredAgentStreamThreadOptions {
  activeStreamRef: MutableRefObject<ActiveStreamState | null>;
  appendThinkingToParts: (
    parts: MessageParts,
    textDelta: string,
  ) => MessageParts;
  clearActiveStreamIfMatch: (eventName: string) => boolean;
  executionStrategy: AgentExecutionStrategy;
  getMessages?: () => readonly Message[];
  getThreadItems?: () => readonly AgentThreadItem[];
  listenerMapRef: MutableRefObject<Map<string, () => void>>;
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: import("../types").WriteArtifactContext,
  ) => void;
  refreshSessionReadModel: (targetSessionId?: string) => Promise<boolean>;
  runtime: Pick<AgentRuntimeAdapter, "listenToTurnEvents" | "resumeThread">;
  setActiveStream: (nextActive: ActiveStreamState | null) => void;
  setCurrentTurnId: Dispatch<SetStateAction<string | null>>;
  setExecutionRuntime: Dispatch<
    SetStateAction<AgentSessionExecutionRuntime | null>
  >;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setPendingActions: Dispatch<SetStateAction<ActionRequired[]>>;
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
  setThreadTurns: Dispatch<SetStateAction<AgentThreadTurn[]>>;
  setIsSending: Dispatch<SetStateAction<boolean>>;

  surfaceThinkingDeltas?: boolean;
  target: AgentStreamResumeBindingTarget;
  warnedKeysRef: MutableRefObject<Set<string>>;
}

export function hasBlockingActiveAgentStreamBinding(
  options: ActiveAgentStreamBindingState,
): boolean {
  if (options.activeStreamRef.current) {
    return true;
  }
  if (options.listenerMapRef.current.size > 0) {
    return true;
  }
  return (
    hasLocallyStartedAgentStreamBinding(options.target) ||
    hasLocallyInterruptedAgentStreamBinding(options.target)
  );
}

export async function bindRecoveredAgentStreamThread(
  options: BindRecoveredAgentStreamThreadOptions,
): Promise<(() => void) | null> {
  const {
    activeStreamRef,
    appendThinkingToParts,
    clearActiveStreamIfMatch,
    executionStrategy,
    getMessages,
    getThreadItems,
    listenerMapRef,
    onWriteFile,
    refreshSessionReadModel,
    runtime,
    setActiveStream,
    setCurrentTurnId,
    setExecutionRuntime,
    setIsSending,
    setMessages,
    setPendingActions,
    setThreadItems,
    setThreadTurns,

    surfaceThinkingDeltas = false,
    target,
    warnedKeysRef,
  } = options;

  if (
    hasBlockingActiveAgentStreamBinding({
      activeStreamRef,
      listenerMapRef,
      target,
    })
  ) {
    return null;
  }

  const assistantMsgId =
    findExistingAssistantMessageId(getMessages?.() ?? [], target.turnId) ??
    `recovered-assistant:${target.turnId}`;
  const pendingTurnKey = target.turnId;
  const pendingItemKey =
    findExistingTurnSummaryItemId(getThreadItems?.() ?? [], target.turnId) ??
    `recovered-turn-summary:${target.turnId}`;
  const runtimeStatus = buildWaitingAgentRuntimeStatus({
    executionStrategy,

  });
  const requestState: StreamRequestState = {
    accumulatedContent: "",
    hasMeaningfulCompletionSignal: false,
    hasFinalAnswerRequiredProcessBoundary: false,
    hasAssistantTextAfterLatestFinalAnswerRequiredProcessBoundary: false,
    requestLogId: null,
    requestStartedAt: Date.now(),
    requestFinished: false,
    currentTurnId: target.turnId,
    renderedContent: "",
  };
  const toolLogIdByToolId = new Map<string, string>();
  const toolStartedAtByToolId = new Map<string, number>();
  const toolNameByToolId = new Map<string, string>();
  const actionLoggedKeys = new Set<string>();
  let unlisten: (() => void) | null = null;

  const disposeListener = () => {
    const registered = listenerMapRef.current.get(target.eventName);
    if (registered) {
      listenerMapRef.current.delete(target.eventName);
      registered();
    } else if (unlisten) {
      unlisten();
    }
    unlisten = null;
  };
  const activateStream = () => {
    if (activeStreamRef.current?.eventName === target.eventName) {
      return;
    }
    setActiveStream({
      assistantMsgId,
      eventName: target.eventName,
      sessionId: target.sessionId,
      turnId: target.turnId,
      pendingTurnKey,
      pendingItemKey,
    });
  };
  setActiveStream({
    assistantMsgId,
    eventName: target.eventName,
    sessionId: target.sessionId,
    turnId: target.turnId,
    pendingTurnKey,
    pendingItemKey,
  });
  setCurrentTurnId(target.turnId);
  upsertRecoveredAssistantMessage({
    assistantMsgId,
    runtimeStatus,
    setMessages,
    target,
  });
  upsertRecoveredRunningTurn({
    pendingItemKey,
    runtimeStatus,
    setThreadItems,
    setThreadTurns,
    target,
  });

  try {
    unlisten = await runtime.listenToTurnEvents(target.eventName, (event) => {
      const data = parseAgentEvent(event.payload);
      if (!data) {
        return;
      }
      requestState.firstEventReceivedAt ??= Date.now();
      handleTurnStreamEvent({
        data,
        requestState,
        callbacks: {
          activateStream,
          isStreamActivated: () =>
            activeStreamRef.current?.eventName === target.eventName,
          clearOptimisticItem: () => undefined,
          clearOptimisticTurn: () => undefined,
          disposeListener,
          clearActiveStreamIfMatch,
          appendThinkingToParts,
        },
        eventName: target.eventName,
        pendingTurnKey,
        pendingItemKey,
        assistantMsgId,
        activeSessionId: target.sessionId,
        resolvedWorkspaceId: "",
        effectiveExecutionStrategy: executionStrategy,
        surfaceThinkingDeltas,
        content: "",
        runtime: runtime as AgentRuntimeAdapter,
        warnedKeysRef,
        actionLoggedKeys,
        toolLogIdByToolId,
        toolStartedAtByToolId,
        toolNameByToolId,
        onWriteFile,
        setMessages,
        setPendingActions,
        getThreadItems,
        setThreadItems,
        setThreadTurns,
        setCurrentTurnId,
        setExecutionRuntime,
        setIsSending,

      });
    });
  } catch (error) {
    console.error("[AgentChat] 恢复运行中会话事件监听失败:", error);
    clearActiveStreamIfMatch(target.eventName);
    return null;
  }

  listenerMapRef.current.set(target.eventName, unlisten);
  void runtime
    .resumeThread(target.threadId, (reducer) => {
      requestState.conversationProjectionOwner = {
        reducer,
        nextEventOrdinal: 1,
      };
      const projection = reducer.getProjection();
      if (projection.items.length > 0) {
        setThreadItems((current) =>
          reconcileAgentStreamProjectionItems({
            current,
            pendingItemKey,
            projected: projection.items,
          }),
        );
        commitRecoveredAssistantProjection({
          assistantMsgId,
          items: projection.items,
          setMessages,
          target,
        });
      }
      if (projection.turns.length > 0) {
        setThreadTurns((current) =>
          projection.turns.reduce(
            (turns, turn) => upsertThreadTurnState(turns, turn),
            current,
          ),
        );
      }
    })
    .catch((error) => {
      console.error("[AgentChat] 恢复运行中会话执行失败:", error);
    })
    .finally(() => {
      void refreshSessionReadModel(target.sessionId);
    });

  return disposeListener;
}
