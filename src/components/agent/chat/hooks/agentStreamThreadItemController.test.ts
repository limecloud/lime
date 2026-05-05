import { describe, expect, it } from "vitest";
import type {
  AgentThreadItem,
  AgentThreadTurn,
} from "@/lib/api/agentProtocol";
import {
  buildAgentStreamTurnStartedPendingItemUpdate,
  shouldDeferAgentStreamThreadItemUpdate,
} from "./agentStreamThreadItemController";

function threadItem(
  overrides: Partial<AgentThreadItem> = {},
): AgentThreadItem {
  return {
    id: "item-a",
    thread_id: "thread-old",
    turn_id: "turn-old",
    sequence: 1,
    status: "in_progress",
    started_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:00:01.000Z",
    type: "reasoning",
    text: "thinking",
    ...overrides,
  } as AgentThreadItem;
}

const turn: AgentThreadTurn = {
  id: "turn-new",
  thread_id: "thread-new",
  prompt_text: "hello",
  status: "running",
  started_at: "2026-05-05T00:00:02.000Z",
  created_at: "2026-05-05T00:00:02.000Z",
  updated_at: "2026-05-05T00:00:03.000Z",
};

describe("agentStreamThreadItemController", () => {
  it("应延后 in-progress reasoning 与 agent_message 高频更新", () => {
    expect(shouldDeferAgentStreamThreadItemUpdate(threadItem())).toBe(true);
    expect(
      shouldDeferAgentStreamThreadItemUpdate(
        threadItem({ type: "agent_message", text: "hello" }),
      ),
    ).toBe(true);
  });

  it("非 in-progress 或非文本类 item 不应延后", () => {
    expect(
      shouldDeferAgentStreamThreadItemUpdate(
        threadItem({ status: "completed" }),
      ),
    ).toBe(false);
    expect(
      shouldDeferAgentStreamThreadItemUpdate(
        threadItem({
          type: "tool_call",
          tool_name: "Read",
          status: "in_progress",
        }),
      ),
    ).toBe(false);
  });

  it("应把 pending item 绑定到真实 turn，并优先使用 turn.updated_at", () => {
    expect(
      buildAgentStreamTurnStartedPendingItemUpdate({
        pendingItem: threadItem(),
        turn,
      }),
    ).toMatchObject({
      id: "item-a",
      thread_id: "thread-new",
      turn_id: "turn-new",
      updated_at: "2026-05-05T00:00:03.000Z",
    });
  });

  it("无 pending item 时不应构造更新", () => {
    expect(
      buildAgentStreamTurnStartedPendingItemUpdate({
        pendingItem: null,
        turn,
      }),
    ).toBeNull();
  });
});
