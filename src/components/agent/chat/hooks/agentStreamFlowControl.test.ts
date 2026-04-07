import { describe, expect, it, vi } from "vitest";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import type { QueuedTurnSnapshot } from "@/lib/api/agentRuntime";
import type { Message } from "../types";
import {
  promoteQueuedAgentTurn,
  removeQueuedAgentTurn,
  removeQueuedTurnFromState,
  resumeAgentStreamThread,
  stopActiveAgentStream,
} from "./agentStreamFlowControl";

function createStateSetter<T>(getValue: () => T, setValue: (value: T) => void) {
  return (next: T | ((prev: T) => T)) => {
    setValue(
      typeof next === "function" ? (next as (prev: T) => T)(getValue()) : next,
    );
  };
}

describe("agentStreamFlowControl", () => {
  it("removeQueuedTurnFromState 应删除目标并重新编号", () => {
    const next = removeQueuedTurnFromState(
      [
        {
          queued_turn_id: "queued-1",
          message_preview: "one",
          message_text: "one",
          created_at: 1,
          image_count: 0,
          position: 1,
        },
        {
          queued_turn_id: "queued-2",
          message_preview: "two",
          message_text: "two",
          created_at: 2,
          image_count: 0,
          position: 2,
        },
      ],
      "queued-1",
    );

    expect(next).toEqual([
      {
        queued_turn_id: "queued-2",
        message_preview: "two",
        message_text: "two",
        created_at: 2,
        image_count: 0,
        position: 1,
      },
    ]);
  });

  it("stopActiveAgentStream 应清理 optimistic 状态并刷新 read model", async () => {
    let queuedTurns: QueuedTurnSnapshot[] = [
      {
        queued_turn_id: "queued-1",
        message_preview: "preview",
        message_text: "text",
        created_at: 1,
        image_count: 0,
        position: 1,
      },
    ];
    let threadItems: AgentThreadItem[] = [
      {
        id: "pending-item:1",
        thread_id: "session-1",
        turn_id: "pending-turn:1",
        sequence: 0,
        status: "in_progress",
        started_at: "2026-03-29T00:00:00.000Z",
        updated_at: "2026-03-29T00:00:00.000Z",
        type: "turn_summary",
        text: "running",
      },
    ];
    let threadTurns: AgentThreadTurn[] = [
      {
        id: "pending-turn:1",
        thread_id: "session-1",
        prompt_text: "继续执行",
        status: "running",
        started_at: "2026-03-29T00:00:00.000Z",
        created_at: "2026-03-29T00:00:00.000Z",
        updated_at: "2026-03-29T00:00:00.000Z",
      },
    ];
    let currentTurnId: string | null = "pending-turn:1";
    let messages: Message[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-03-29T00:00:00.000Z"),
        isThinking: true,
      },
    ];
    let activeStream = {
      assistantMsgId: "assistant-1",
      eventName: "stream-1",
      sessionId: "session-1",
      pendingTurnKey: "pending-turn:1",
      pendingItemKey: "pending-item:1",
    };
    const removeStreamListener = vi.fn();
    const interruptTurn = vi.fn(async () => true);
    const refreshSessionReadModel = vi.fn(async () => true);
    const notify = {
      info: vi.fn(),
      error: vi.fn(),
    };

    await stopActiveAgentStream({
      activeStream,
      sessionIdRef: { current: "session-1" },
      runtime: {
        interruptTurn,
      } as never,
      removeStreamListener,
      refreshSessionReadModel,
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
      setMessages: createStateSetter(
        () => messages,
        (value) => {
          messages = value;
        },
      ),
      setActiveStream: (next) => {
        activeStream = next as never;
      },
      notify,
    });

    expect(removeStreamListener).toHaveBeenCalledWith("stream-1");
    expect(interruptTurn).toHaveBeenCalledWith("session-1");
    expect(refreshSessionReadModel).toHaveBeenCalledWith("session-1");
    expect(queuedTurns).toEqual([]);
    expect(threadItems).toEqual([]);
    expect(threadTurns).toEqual([]);
    expect(currentTurnId).toBeNull();
    expect(messages[0]?.content).toBe("(已停止)");
    expect(messages[0]?.isThinking).toBe(false);
    expect(activeStream).toBeNull();
    expect(notify.info).toHaveBeenCalledWith("已停止生成");
  });

  it("removeQueuedAgentTurn / promoteQueuedAgentTurn / resumeAgentStreamThread 应刷新 read model", async () => {
    let queuedTurns: QueuedTurnSnapshot[] = [
      {
        queued_turn_id: "queued-1",
        message_preview: "preview",
        message_text: "text",
        created_at: 1,
        image_count: 0,
        position: 1,
      },
    ];
    const refreshSessionReadModel = vi.fn(async () => true);
    const notify = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const sessionIdRef = { current: "session-1" };

    await expect(
      removeQueuedAgentTurn({
        runtime: {
          removeQueuedTurn: vi.fn(async () => true),
        },
        queuedTurnId: "queued-1",
        sessionIdRef,
        refreshSessionReadModel,
        setQueuedTurns: createStateSetter(
          () => queuedTurns,
          (value) => {
            queuedTurns = value;
          },
        ),
        notify,
      }),
    ).resolves.toBe(true);
    expect(queuedTurns).toEqual([]);

    queuedTurns = [
      {
        queued_turn_id: "queued-1",
        message_preview: "preview",
        message_text: "text",
        created_at: 1,
        image_count: 0,
        position: 1,
      },
    ];
    await expect(
      promoteQueuedAgentTurn({
        runtime: {
          promoteQueuedTurn: vi.fn(async () => true),
        },
        queuedTurnId: "queued-1",
        sessionIdRef,
        refreshSessionReadModel,
        setQueuedTurns: createStateSetter(
          () => queuedTurns,
          (value) => {
            queuedTurns = value;
          },
        ),
        notify,
      }),
    ).resolves.toBe(true);
    expect(notify.info).toHaveBeenCalledWith("正在切换到该排队任务");

    await expect(
      resumeAgentStreamThread({
        runtime: {
          resumeThread: vi.fn(async () => true),
        },
        sessionIdRef,
        refreshSessionReadModel,
        notify,
      }),
    ).resolves.toBe(true);
    expect(refreshSessionReadModel).toHaveBeenCalledWith("session-1");
    expect(notify.info).toHaveBeenCalledWith("正在恢复排队执行");
  });
});
