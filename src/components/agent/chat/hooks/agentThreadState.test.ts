import { describe, expect, it } from "vitest";
import type { AgentThreadItem, AgentThreadTurn } from "../types";
import {
  removeThreadItemState,
  removeThreadTurnState,
  upsertThreadItemState,
  upsertThreadTurnState,
} from "./agentThreadState";

function createTurn(overrides: Partial<AgentThreadTurn> = {}): AgentThreadTurn {
  return {
    id: overrides.id ?? "turn-1",
    thread_id: overrides.thread_id ?? "thread-1",
    prompt_text: overrides.prompt_text ?? "写一段简介",
    status: overrides.status ?? "running",
    started_at: overrides.started_at ?? "2026-04-27T01:00:00.000Z",
    created_at: overrides.created_at ?? "2026-04-27T01:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-04-27T01:00:00.000Z",
    ...overrides,
  };
}

function createItem(overrides: Partial<AgentThreadItem> = {}): AgentThreadItem {
  return {
    id: overrides.id ?? "item-1",
    thread_id: overrides.thread_id ?? "thread-1",
    turn_id: overrides.turn_id ?? "turn-1",
    sequence: overrides.sequence ?? 1,
    type: overrides.type ?? "tool_call",
    tool_name:
      "tool_name" in overrides && typeof overrides.tool_name === "string"
        ? overrides.tool_name
        : "search_query",
    arguments:
      "arguments" in overrides
        ? overrides.arguments
        : { query: "AI Agent" },
    status: overrides.status ?? "in_progress",
    started_at: overrides.started_at ?? "2026-04-27T01:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-04-27T01:00:00.000Z",
    ...overrides,
  } as AgentThreadItem;
}

describe("agentThreadState", () => {
  it("重复 upsert 相同 turn 时应复用原数组", () => {
    const turn = createTurn();
    const turns = [turn];

    expect(upsertThreadTurnState(turns, createTurn())).toBe(turns);
  });

  it("重复 upsert 相同 item 时应复用原数组", () => {
    const item = createItem();
    const items = [item];

    expect(upsertThreadItemState(items, createItem())).toBe(items);
  });

  it("item 内容变化时仍应更新状态", () => {
    const item = createItem();
    const items = [item];
    const nextItems = upsertThreadItemState(
      items,
      createItem({ output: "完成", status: "completed" }),
    );

    expect(nextItems).not.toBe(items);
    expect(nextItems[0]).toMatchObject({
      output: "完成",
      status: "completed",
    });
  });

  it("删除不存在的 pending turn/item 时应复用原数组", () => {
    const turns = [createTurn()];
    const items = [createItem()];

    expect(removeThreadTurnState(turns, "pending-turn:missing")).toBe(turns);
    expect(removeThreadItemState(items, "pending-item:missing")).toBe(items);
  });
});
