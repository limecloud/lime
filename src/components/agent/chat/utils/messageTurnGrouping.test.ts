import { describe, expect, it } from "vitest";

import type { Message } from "../types";
import { buildMessageTurnGroups } from "./messageTurnGrouping";

function createMessage(
  id: string,
  role: Message["role"],
  second: number,
): Message {
  return {
    id,
    role,
    content: `${role}-${id}`,
    timestamp: new Date(`2026-03-15T09:00:${String(second).padStart(2, "0")}Z`),
  };
}

describe("buildMessageTurnGroups", () => {
  it("应按用户消息切分回合，并收拢后续助手回复", () => {
    const groups = buildMessageTurnGroups([
      createMessage("user-1", "user", 0),
      createMessage("assistant-1", "assistant", 1),
      createMessage("assistant-2", "assistant", 2),
      createMessage("user-2", "user", 3),
      createMessage("assistant-3", "assistant", 4),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.userMessage?.id).toBe("user-1");
    expect(groups[0]?.assistantMessages.map((message) => message.id)).toEqual([
      "assistant-1",
      "assistant-2",
    ]);
    expect(groups[1]?.userMessage?.id).toBe("user-2");
    expect(groups[1]?.assistantMessages.map((message) => message.id)).toEqual([
      "assistant-3",
    ]);
  });

  it("应兼容没有前置用户消息的助手回复", () => {
    const groups = buildMessageTurnGroups([
      createMessage("assistant-1", "assistant", 0),
      createMessage("assistant-2", "assistant", 1),
      createMessage("user-1", "user", 2),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.userMessage).toBeNull();
    expect(groups[0]?.assistantMessages.map((message) => message.id)).toEqual([
      "assistant-1",
      "assistant-2",
    ]);
    expect(groups[1]?.userMessage?.id).toBe("user-1");
    expect(groups[1]?.assistantMessages).toEqual([]);
  });
});
