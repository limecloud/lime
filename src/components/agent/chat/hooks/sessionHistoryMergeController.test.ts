import { describe, expect, it } from "vitest";
import type { AsterSessionDetail } from "@/lib/api/agentRuntime";
import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import { buildSessionHistoryMergePlan } from "./sessionHistoryMergeController";

const baseDate = new Date("2026-05-05T00:00:00.000Z");

function localMessage(id: string, content: string): Message {
  return {
    id,
    role: "assistant",
    content,
    timestamp: baseDate,
  };
}

function turn(id: string, offset: number): AgentThreadTurn {
  return {
    id,
    thread_id: "thread-a",
    prompt_text: id,
    status: "completed",
    started_at: `2026-05-05T00:00:0${offset}.000Z`,
    completed_at: `2026-05-05T00:00:0${offset}.500Z`,
    created_at: `2026-05-05T00:00:0${offset}.000Z`,
    updated_at: `2026-05-05T00:00:0${offset}.500Z`,
  };
}

function agentItem(
  id: string,
  turnId: string,
  sequence: number,
  text: string,
): AgentThreadItem {
  return {
    id,
    thread_id: "thread-a",
    turn_id: turnId,
    sequence,
    status: "completed",
    started_at: `2026-05-05T00:00:0${sequence}.000Z`,
    updated_at: `2026-05-05T00:00:0${sequence}.500Z`,
    type: "agent_message",
    text,
  };
}

function detail(overrides: Partial<AsterSessionDetail> = {}): AsterSessionDetail {
  return {
    id: "topic-a",
    created_at: 1,
    updated_at: 2,
    messages: [
      {
        role: "user",
        timestamp: 1,
        content: [{ type: "text", text: "更早的问题" }],
      },
      {
        role: "assistant",
        timestamp: 2,
        content: [{ type: "text", text: "更早的回复" }],
      },
    ],
    turns: [turn("turn-b", 2)],
    items: [agentItem("item-b", "turn-b", 2, "更早工具过程")],
    ...overrides,
  };
}

describe("sessionHistoryMergeController", () => {
  it("应合并分页 detail 的消息、turns 与 thread items", () => {
    const plan = buildSessionHistoryMergePlan({
      currentMessages: [localMessage("local-a", "最近回复")],
      currentThreadTurns: [turn("turn-a", 1)],
      currentThreadItems: [agentItem("item-a", "turn-a", 1, "最近工具过程")],
      currentTurnId: "turn-a",
      detail: detail(),
      sessionId: "topic-a",
    });

    expect(plan.incomingMessages).toHaveLength(2);
    expect(plan.mergedMessages.map((message) => message.content)).toEqual([
      "更早的问题",
      "更早的回复",
      "最近回复",
    ]);
    expect(plan.mergedThreadTurns.map((item) => item.id)).toEqual([
      "turn-a",
      "turn-b",
    ]);
    expect(plan.mergedThreadItems.map((item) => item.id)).toEqual([
      "item-a",
      "item-b",
    ]);
    expect(plan.currentTurnId).toBe("turn-b");
  });

  it("无 incoming turns 时应保留当前 turnId", () => {
    const plan = buildSessionHistoryMergePlan({
      currentMessages: [localMessage("local-a", "最近回复")],
      currentThreadTurns: [],
      currentThreadItems: [],
      currentTurnId: "turn-current",
      detail: detail({ messages: [], turns: [], items: [] }),
      sessionId: "topic-a",
    });

    expect(plan.currentTurnId).toBe("turn-current");
    expect(plan.mergedMessages).toHaveLength(1);
  });
});
