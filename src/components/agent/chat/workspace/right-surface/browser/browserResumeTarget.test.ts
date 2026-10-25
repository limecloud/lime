import { describe, expect, it } from "vitest";
import type { AgentThreadItem } from "@/lib/api/agentProtocol";
import { readBrowserResumeTarget } from "./browserResumeTarget";

const delivered = (overrides: Record<string, unknown> = {}): AgentThreadItem =>
  ({
    id: "browser-retained",
    thread_id: "thread",
    turn_id: "old-turn",
    sequence: 2,
    started_at: "",
    updated_at: "",
    type: "tool_call",
    tool_name: "markDeliverable",
    status: "completed",
    success: true,
    metadata: { namespace: "browser" },
    output: JSON.stringify({
      status: "completed",
      state: {
        threadId: "thread",
        tabId: "expired-tab",
        controlOwner: "agent",
        activeTurnId: "old-turn",
        url: "https://news.baidu.com/",
      },
    }),
    ...overrides,
  }) as AgentThreadItem;

describe("canonical browser navigation recovery", () => {
  it("extracts only a navigation URL from a delivered browser result", () => {
    expect(readBrowserResumeTarget([delivered()], "thread")).toBe(
      "https://news.baidu.com/",
    );
  });
  it.each([
    { status: "failed" },
    { success: false },
    { metadata: { namespace: "other" } },
    { tool_name: "newTab" },
    { thread_id: "foreign" },
    { output: "invalid json" },
    {
      output: JSON.stringify({
        status: "completed",
        state: { threadId: "foreign", url: "https://example.com" },
      }),
    },
    {
      output: JSON.stringify({
        status: "completed",
        state: { threadId: "thread", url: "file:///tmp/secret" },
      }),
    },
  ])("ignores untrusted, incomplete or unrelated results: %j", (overrides) => {
    expect(
      readBrowserResumeTarget([delivered(overrides)], "thread"),
    ).toBeNull();
  });
});
