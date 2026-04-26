import { beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import {
  loadAgentSessionCachedSnapshot,
  saveAgentSessionCachedSnapshot,
} from "./agentSessionScopedStorage";

function createMessage(index: number): Message {
  return {
    id: `message-${index}`,
    role: index % 2 === 0 ? "assistant" : "user",
    content: `message-${index}`,
    timestamp: new Date(`2026-04-24T00:${String(index % 60).padStart(2, "0")}:00.000Z`),
  };
}

function createTurn(index: number): AgentThreadTurn {
  return {
    id: `turn-${index}`,
    thread_id: "thread-1",
    status: "completed",
    prompt_text: `turn-${index}`,
    started_at: "2026-04-24T00:00:00.000Z",
    completed_at: "2026-04-24T00:00:01.000Z",
    created_at: "2026-04-24T00:00:00.000Z",
    updated_at: "2026-04-24T00:00:01.000Z",
  };
}

function createItem(index: number): AgentThreadItem {
  return {
    id: `item-${index}`,
    thread_id: "thread-1",
    turn_id: `turn-${index}`,
    sequence: index,
    type: "agent_message",
    text: `item-${index}`,
    status: "completed",
    started_at: "2026-04-24T00:00:00.000Z",
    completed_at: "2026-04-24T00:00:01.000Z",
    updated_at: "2026-04-24T00:00:01.000Z",
  } as AgentThreadItem;
}

describe("agentSessionScopedStorage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("保存会话快照时应只保留最近一段 tail，避免恢复时内存峰值过高", () => {
    const workspaceId = "ws-session-snapshot-trim";
    const sessionId = "topic-heavy";

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: Array.from({ length: 48 }, (_, index) => createMessage(index)),
      threadTurns: Array.from({ length: 36 }, (_, index) => createTurn(index)),
      threadItems: Array.from({ length: 120 }, (_, index) => createItem(index)),
      currentTurnId: "turn-35",
    });

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId);

    expect(restored).not.toBeNull();
    expect(restored?.messages).toHaveLength(32);
    expect(restored?.messages[0]?.id).toBe("message-16");
    expect(restored?.threadTurns).toHaveLength(24);
    expect(restored?.threadTurns[0]?.id).toBe("turn-12");
    expect(restored?.threadItems).toHaveLength(24);
    expect(restored?.threadItems[0]?.id).toBe("item-12");
    expect(restored?.currentTurnId).toBe("turn-35");
  });

  it("同标签页快照丢失后应回退到持久化 tail，避免重开应用时仍然整段慢恢复", () => {
    const workspaceId = "ws-session-snapshot-persisted";
    const sessionId = "topic-persisted";

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: Array.from({ length: 24 }, (_, index) => createMessage(index)),
      threadTurns: Array.from({ length: 16 }, (_, index) => createTurn(index)),
      threadItems: Array.from({ length: 48 }, (_, index) => createItem(index)),
      currentTurnId: "turn-15",
    });

    sessionStorage.clear();

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId);

    expect(restored).not.toBeNull();
    expect(restored?.messages).toHaveLength(12);
    expect(restored?.messages[0]?.id).toBe("message-12");
    expect(restored?.threadTurns).toHaveLength(8);
    expect(restored?.threadTurns[0]?.id).toBe("turn-8");
    expect(restored?.threadItems).toHaveLength(8);
    expect(restored?.threadItems[0]?.id).toBe("item-8");
    expect(restored?.currentTurnId).toBe("turn-15");
  });
});
