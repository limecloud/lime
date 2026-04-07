import { describe, expect, it } from "vitest";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import type { QueuedTurnSnapshot } from "@/lib/api/agentRuntime";
import type { Message } from "../types";
import { buildWaitingAgentRuntimeStatus } from "../utils/agentRuntimeStatus";
import {
  createAgentStreamSubmissionLifecycle,
  type ActiveStreamState,
} from "./agentStreamSubmissionLifecycle";

function createStateSetter<T>(getValue: () => T, setValue: (value: T) => void) {
  return (next: T | ((prev: T) => T)) => {
    setValue(
      typeof next === "function" ? (next as (prev: T) => T)(getValue()) : next,
    );
  };
}

describe("agentStreamSubmissionLifecycle", () => {
  it("应先注入 optimistic turn/item，并在 activateStream 后切换到真实 session", () => {
    const assistantMsg: Message = {
      id: "assistant-1",
      role: "assistant",
      content: "",
      timestamp: new Date("2026-03-27T01:00:00.000Z"),
      isThinking: true,
      contentParts: [],
      runtimeStatus: buildWaitingAgentRuntimeStatus({
        executionStrategy: "react",
        webSearch: false,
        thinking: true,
      }),
    };

    let activeStream: ActiveStreamState | null = null;
    let messages: Message[] = [assistantMsg];
    let queuedTurns: QueuedTurnSnapshot[] = [];
    let threadItems: AgentThreadItem[] = [];
    let threadTurns: AgentThreadTurn[] = [];
    let currentTurnId: string | null = null;

    const lifecycle = createAgentStreamSubmissionLifecycle({
      assistantMsg,
      assistantMsgId: assistantMsg.id,
      userMsgId: "user-1",
      content: "继续生成",
      expectingQueue: false,
      initialThreadId: "local-thread:assistant-1",
      listenerMapRef: { current: new Map() },
      setActiveStream: (next) => {
        activeStream = next;
      },
      setMessages: createStateSetter(
        () => messages,
        (value) => {
          messages = value;
        },
      ),
      setQueuedTurns: createStateSetter(
        () => queuedTurns,
        (value) => {
          queuedTurns = value;
        },
      ),
      setThreadItems: createStateSetter(
        () => threadItems,
        (value) => {
          threadItems = value;
        },
      ),
      setThreadTurns: createStateSetter(
        () => threadTurns,
        (value) => {
          threadTurns = value;
        },
      ),
      setCurrentTurnId: createStateSetter(
        () => currentTurnId,
        (value) => {
          currentTurnId = value;
        },
      ),
    });

    expect(threadTurns).toHaveLength(1);
    expect(threadTurns[0]?.thread_id).toBe("local-thread:assistant-1");
    expect(threadItems).toHaveLength(1);
    expect(threadItems[0]?.thread_id).toBe("local-thread:assistant-1");
    expect(currentTurnId).toBe(lifecycle.pendingTurnKey);

    const runtimeStatus = buildWaitingAgentRuntimeStatus({
      executionStrategy: "react",
      webSearch: true,
      thinking: true,
    });
    lifecycle.activateStream("session-1", runtimeStatus);

    expect(activeStream).toEqual({
      assistantMsgId: "assistant-1",
      eventName: lifecycle.eventName,
      sessionId: "session-1",
      pendingTurnKey: lifecycle.pendingTurnKey,
      pendingItemKey: lifecycle.pendingItemKey,
    });
    expect(messages[0]?.runtimeStatus).toEqual(runtimeStatus);
    expect(threadTurns[0]?.thread_id).toBe("session-1");
    expect(threadItems[0]?.thread_id).toBe("session-1");
  });

  it("markOptimisticFailure 应标记 pending turn/item 为 failed", () => {
    const assistantMsg: Message = {
      id: "assistant-2",
      role: "assistant",
      content: "",
      timestamp: new Date("2026-03-27T01:00:00.000Z"),
      isThinking: true,
      contentParts: [],
      runtimeStatus: buildWaitingAgentRuntimeStatus({
        executionStrategy: "react",
        webSearch: false,
        thinking: true,
      }),
    };

    let messages: Message[] = [assistantMsg];
    let queuedTurns: QueuedTurnSnapshot[] = [];
    let threadItems: AgentThreadItem[] = [];
    let threadTurns: AgentThreadTurn[] = [];
    let currentTurnId: string | null = null;

    const lifecycle = createAgentStreamSubmissionLifecycle({
      assistantMsg,
      assistantMsgId: assistantMsg.id,
      userMsgId: null,
      content: "继续生成",
      expectingQueue: false,
      initialThreadId: "local-thread:assistant-2",
      listenerMapRef: { current: new Map() },
      setActiveStream: () => {},
      setMessages: createStateSetter(
        () => messages,
        (value) => {
          messages = value;
        },
      ),
      setQueuedTurns: createStateSetter(
        () => queuedTurns,
        (value) => {
          queuedTurns = value;
        },
      ),
      setThreadItems: createStateSetter(
        () => threadItems,
        (value) => {
          threadItems = value;
        },
      ),
      setThreadTurns: createStateSetter(
        () => threadTurns,
        (value) => {
          threadTurns = value;
        },
      ),
      setCurrentTurnId: createStateSetter(
        () => currentTurnId,
        (value) => {
          currentTurnId = value;
        },
      ),
    });

    lifecycle.markOptimisticFailure("发送失败");

    expect(threadTurns[0]?.status).toBe("failed");
    expect(threadTurns[0]?.error_message).toBe("发送失败");
    expect(threadItems[0]?.status).toBe("failed");
    expect(threadItems[0]?.type).toBe("turn_summary");
    if (threadItems[0]?.type !== "turn_summary") {
      throw new Error("缺少 optimistic turn summary");
    }
    expect(threadItems[0].text).toContain("失败");
  });
});
