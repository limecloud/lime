import { describe, expect, it } from "vitest";
import { render } from "./MessageList.testHarness";
import type { AgentThreadTurn, Message } from "./MessageList.testHarness";

const messages: Message[] = [
  {
    id: "assistant-1",
    role: "assistant",
    content: "reply",
    timestamp: new Date(),
    runtimeTurnId: "turn-1",
  },
];
const turns: AgentThreadTurn[] = [
  {
    id: "turn-1",
    thread_id: "thread-1",
    prompt_text: "hi",
    status: "completed",
    started_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

describe("MessageList message more actions", () => {
  it("falls back to the latest turns entry when runtimeTurnId is absent", () => {
    const withoutRuntimeTurn: Message[] = [
      {
        id: "assistant-2",
        role: "assistant",
        content: "reply without runtime turn id",
        timestamp: new Date(),
      },
    ];
    const container = render(withoutRuntimeTurn, {
      turns,
      threadRead: {
        thread_id: "thread-1",
        thread_turns: turns,
      },
    });
    expect(
      container.querySelector('[data-testid="message-actions-more"]'),
    ).not.toBeNull();
  });

  it("shows the more menu for the latest assistant turn", () => {
    const container = render(messages, {
      turns,
      threadRead: {
        thread_id: "thread-1",
        thread_turns: turns,
      },
    });
    expect(
      container.querySelector('[data-testid="message-actions-more"]'),
    ).not.toBeNull();
  });
});
