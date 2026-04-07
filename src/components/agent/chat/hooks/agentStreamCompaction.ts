import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  parseAgentEvent,
  type AgentThreadItem,
  type AgentThreadTurn,
} from "@/lib/api/agentProtocol";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import type { ActiveStreamState } from "./agentStreamSubmissionLifecycle";
import {
  upsertThreadItemState,
  upsertThreadTurnState,
} from "./agentThreadState";
import { resolveRuntimeWarningToastPresentation } from "./runtimeWarningPresentation";

interface AgentStreamCompactionNotifications {
  info: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
}

interface RunAgentStreamCompactionOptions {
  runtime: AgentRuntimeAdapter;
  sessionId: string;
  warnedKeysRef: MutableRefObject<Set<string>>;
  setActiveStream: (nextActive: ActiveStreamState | null) => void;
  clearActiveStreamIfMatch: (eventName: string) => boolean;
  replaceStreamListener: (
    eventName: string,
    nextUnlisten: (() => void) | null | undefined,
  ) => void;
  removeStreamListener: (eventName: string) => boolean;
  setCurrentTurnId: Dispatch<SetStateAction<string | null>>;
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
  setThreadTurns: Dispatch<SetStateAction<AgentThreadTurn[]>>;
  notify: AgentStreamCompactionNotifications;
  createEventName?: () => string;
  createAssistantMessageId?: () => string;
}

function defaultCreateEventName() {
  return `agent_context_compaction_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

function defaultCreateAssistantMessageId() {
  return `context_compaction:${crypto.randomUUID()}`;
}

export class AgentStreamCompactionError extends Error {
  readonly alreadyNotified: boolean;

  constructor(message: string, alreadyNotified = false) {
    super(message);
    this.name = "AgentStreamCompactionError";
    this.alreadyNotified = alreadyNotified;
  }
}

export function normalizeAgentStreamCompactionError(error: unknown) {
  if (error instanceof AgentStreamCompactionError) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return new AgentStreamCompactionError(error.message);
  }

  const message = String(error ?? "").trim() || "压缩上下文失败，请稍后重试";
  return new AgentStreamCompactionError(message);
}

export async function runAgentStreamCompaction(
  options: RunAgentStreamCompactionOptions,
) {
  const {
    runtime,
    sessionId,
    warnedKeysRef,
    setActiveStream,
    clearActiveStreamIfMatch,
    replaceStreamListener,
    removeStreamListener,
    setCurrentTurnId,
    setThreadItems,
    setThreadTurns,
    notify,
    createEventName = defaultCreateEventName,
    createAssistantMessageId = defaultCreateAssistantMessageId,
  } = options;
  const eventName = createEventName();
  let disposed = false;
  let notifiedErrorMessage: string | null = null;

  const disposeListener = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    removeStreamListener(eventName);
  };

  setActiveStream({
    assistantMsgId: createAssistantMessageId(),
    eventName,
    sessionId,
  });

  try {
    const unlisten = await runtime.listenToTurnEvents(eventName, (event) => {
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
          const warningKey = `${sessionId}:${data.code || data.message}`;
          if (warnedKeysRef.current.has(warningKey)) {
            break;
          }
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
              notify.info(presentation.message);
              break;
            case "error":
              notify.error(presentation.message);
              break;
            case "warning":
            default:
              notify.warning(presentation.message);
              break;
          }
          break;
        }
        case "error":
          notifiedErrorMessage =
            String(data.message ?? "").trim() || "未知错误";
          notify.error(`压缩上下文失败: ${notifiedErrorMessage}`);
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

    replaceStreamListener(eventName, unlisten);
    await runtime.compactSession(sessionId, eventName);
  } catch (error) {
    clearActiveStreamIfMatch(eventName);
    disposeListener();
    if (notifiedErrorMessage) {
      throw new AgentStreamCompactionError(notifiedErrorMessage, true);
    }
    throw normalizeAgentStreamCompactionError(error);
  }
}
