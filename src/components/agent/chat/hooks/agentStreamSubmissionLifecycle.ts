import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import type { QueuedTurnSnapshot } from "@/lib/api/agentRuntime";
import type { Message } from "../types";
import {
  removeThreadItemState,
  removeThreadTurnState,
  upsertThreadItemState,
  upsertThreadTurnState,
} from "./agentThreadState";
import {
  buildFailedAgentRuntimeStatus,
  formatAgentRuntimeStatusSummary,
} from "../utils/agentRuntimeStatus";

export interface ActiveStreamState {
  assistantMsgId: string;
  eventName: string;
  sessionId: string;
  pendingTurnKey?: string;
  pendingItemKey?: string;
}

export interface StreamRequestState {
  accumulatedContent: string;
  hasMeaningfulCompletionSignal?: boolean;
  requestLogId: string | null;
  requestStartedAt: number;
  requestFinished: boolean;
  queuedTurnId: string | null;
  queuedDraftCleanupTimerId?: ReturnType<typeof setTimeout> | null;
}

interface CreateSubmissionLifecycleOptions {
  assistantMsg: Message;
  assistantMsgId: string;
  userMsgId: string | null;
  content: string;
  expectingQueue: boolean;
  initialThreadId: string;
  listenerMapRef: MutableRefObject<Map<string, () => void>>;
  setActiveStream: (nextActive: ActiveStreamState | null) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setQueuedTurns: Dispatch<SetStateAction<QueuedTurnSnapshot[]>>;
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
  setThreadTurns: Dispatch<SetStateAction<AgentThreadTurn[]>>;
  setCurrentTurnId: Dispatch<SetStateAction<string | null>>;
}

function createPendingTurnKey() {
  return `pending-turn:${crypto.randomUUID()}`;
}

function createPendingItemKey(pendingTurnKey: string) {
  return `pending-item:${pendingTurnKey}`;
}

export function createAgentStreamSubmissionLifecycle(
  options: CreateSubmissionLifecycleOptions,
) {
  const {
    assistantMsg,
    assistantMsgId,
    userMsgId,
    content,
    expectingQueue,
    initialThreadId,
    listenerMapRef,
    setActiveStream,
    setMessages,
    setQueuedTurns,
    setThreadItems,
    setThreadTurns,
    setCurrentTurnId,
  } = options;

  let unlisten: (() => void) | null = null;
  let streamActivated = false;
  const requestState: StreamRequestState = {
    accumulatedContent: "",
    hasMeaningfulCompletionSignal: false,
    requestLogId: null,
    requestStartedAt: 0,
    requestFinished: false,
    queuedTurnId: null,
    queuedDraftCleanupTimerId: null,
  };
  const optimisticStartedAt = assistantMsg.timestamp.toISOString();
  const pendingTurnKey = createPendingTurnKey();
  const pendingItemKey = createPendingItemKey(pendingTurnKey);
  const requestTurnId = crypto.randomUUID();
  const eventName = `aster_stream_${assistantMsgId}`;
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

  const activateStream = (
    activeSessionId: string,
    effectiveWaitingRuntimeStatus: NonNullable<Message["runtimeStatus"]>,
  ) => {
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

    if (expectingQueue) {
      return;
    }

    const updatedAt = new Date().toISOString();
    setThreadTurns((prev) =>
      upsertThreadTurnState(prev, {
        id: pendingTurnKey,
        thread_id: activeSessionId,
        prompt_text: content,
        status: "running",
        started_at: optimisticStartedAt,
        created_at: optimisticStartedAt,
        updated_at: updatedAt,
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
        updated_at: updatedAt,
        type: "turn_summary",
        text: formatAgentRuntimeStatusSummary(effectiveWaitingRuntimeStatus),
      }),
    );
  };

  const registerListener = (nextUnlisten: () => void) => {
    unlisten = nextUnlisten;
    listenerMapRef.current.set(eventName, nextUnlisten);
  };

  if (!expectingQueue) {
    setThreadTurns((prev) =>
      upsertThreadTurnState(prev, {
        id: pendingTurnKey,
        thread_id: initialThreadId,
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
        thread_id: initialThreadId,
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

  return {
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
    isStreamActivated: () => streamActivated,
  };
}
