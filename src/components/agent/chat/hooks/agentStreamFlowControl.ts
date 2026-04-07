import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import type { QueuedTurnSnapshot } from "@/lib/api/agentRuntime";
import type { Message } from "../types";
import type { ActiveStreamState } from "./agentStreamSubmissionLifecycle";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import { updateMessageArtifactsStatus } from "../utils/messageArtifacts";
import {
  removeThreadItemState,
  removeThreadTurnState,
} from "./agentThreadState";

interface AgentStreamFlowNotify {
  info: (message: string) => void;
  error: (message: string) => void;
}

interface StopAgentStreamOptions {
  activeStream: ActiveStreamState | null;
  sessionIdRef: MutableRefObject<string | null>;
  runtime: AgentRuntimeAdapter;
  removeStreamListener: (eventName: string) => boolean;
  refreshSessionReadModel: (targetSessionId?: string) => Promise<boolean>;
  setQueuedTurns: Dispatch<SetStateAction<QueuedTurnSnapshot[]>>;
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
  setThreadTurns: Dispatch<SetStateAction<AgentThreadTurn[]>>;
  setCurrentTurnId: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setActiveStream: (nextActive: ActiveStreamState | null) => void;
  notify: AgentStreamFlowNotify;
  onInterruptError?: (error: unknown) => void;
}

interface QueueActionOptions {
  sessionIdRef: MutableRefObject<string | null>;
  refreshSessionReadModel: (targetSessionId?: string) => Promise<boolean>;
  setQueuedTurns: Dispatch<SetStateAction<QueuedTurnSnapshot[]>>;
  notify: AgentStreamFlowNotify;
}

interface RemoveQueuedTurnOptions extends QueueActionOptions {
  runtime: Pick<AgentRuntimeAdapter, "removeQueuedTurn">;
  queuedTurnId: string;
  onError?: (error: unknown) => void;
}

interface PromoteQueuedTurnOptions extends QueueActionOptions {
  runtime: Pick<AgentRuntimeAdapter, "promoteQueuedTurn">;
  queuedTurnId: string;
  onError?: (error: unknown) => void;
}

interface ResumeThreadOptions extends Omit<
  QueueActionOptions,
  "setQueuedTurns"
> {
  runtime: Pick<AgentRuntimeAdapter, "resumeThread">;
  onError?: (error: unknown) => void;
}

export function removeQueuedTurnFromState(
  queuedTurns: QueuedTurnSnapshot[],
  queuedTurnId: string,
) {
  return queuedTurns
    .filter((item) => item.queued_turn_id !== queuedTurnId)
    .map((item, index) => ({
      ...item,
      position: index + 1,
    }));
}

export async function stopActiveAgentStream(options: StopAgentStreamOptions) {
  const {
    activeStream,
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
    notify,
    onInterruptError,
  } = options;

  if (activeStream) {
    removeStreamListener(activeStream.eventName);
  }

  const activeSessionId = activeStream?.sessionId || sessionIdRef.current;
  if (activeSessionId) {
    try {
      await runtime.interruptTurn(activeSessionId);
    } catch (error) {
      onInterruptError?.(error);
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
  notify.info("已停止生成");
}

export async function removeQueuedAgentTurn(options: RemoveQueuedTurnOptions) {
  const {
    runtime,
    queuedTurnId,
    sessionIdRef,
    refreshSessionReadModel,
    setQueuedTurns,
    notify,
    onError,
  } = options;
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
      setQueuedTurns((prev) => removeQueuedTurnFromState(prev, queuedTurnId));
    }
    await refreshSessionReadModel(activeSessionId);
    return removed;
  } catch (error) {
    onError?.(error);
    await refreshSessionReadModel(activeSessionId);
    notify.error("移除排队消息失败");
    return false;
  }
}

export async function promoteQueuedAgentTurn(
  options: PromoteQueuedTurnOptions,
) {
  const {
    runtime,
    queuedTurnId,
    sessionIdRef,
    refreshSessionReadModel,
    setQueuedTurns,
    notify,
    onError,
  } = options;
  const activeSessionId = sessionIdRef.current;
  if (!activeSessionId || !queuedTurnId.trim()) {
    return false;
  }

  setQueuedTurns((prev) => removeQueuedTurnFromState(prev, queuedTurnId));

  try {
    const promoted = await runtime.promoteQueuedTurn(
      activeSessionId,
      queuedTurnId,
    );
    await refreshSessionReadModel(activeSessionId);
    if (!promoted) {
      return false;
    }

    notify.info("正在切换到该排队任务");
    return true;
  } catch (error) {
    onError?.(error);
    await refreshSessionReadModel(activeSessionId);
    notify.error("立即执行排队消息失败");
    return false;
  }
}

export async function resumeAgentStreamThread(options: ResumeThreadOptions) {
  const { runtime, sessionIdRef, refreshSessionReadModel, notify, onError } =
    options;
  const activeSessionId = sessionIdRef.current;
  if (!activeSessionId) {
    return false;
  }

  try {
    const resumed = await runtime.resumeThread(activeSessionId);
    await refreshSessionReadModel(activeSessionId);
    if (resumed) {
      notify.info("正在恢复排队执行");
    }
    return resumed;
  } catch (error) {
    onError?.(error);
    await refreshSessionReadModel(activeSessionId);
    notify.error("恢复线程执行失败");
    return false;
  }
}
