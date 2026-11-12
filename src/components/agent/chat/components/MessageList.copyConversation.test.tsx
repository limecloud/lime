import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createConversationMessages,
  render,
} from "./MessageList.testHarness";
import { requestCopyConversation } from "@/lib/conversationCopyEvents";
import { buildConversationTranscript } from "../utils/conversationTranscript";

describe("conversation copy", () => {
  it("builds a role-labelled transcript", () => {
    const transcript = buildConversationTranscript(
      createConversationMessages(2),
      { user: "You", assistant: "Assistant", separator: "\n---\n" },
    );
    expect(transcript).toContain("You:\n消息 1");
    expect(transcript).toContain("Assistant:\n消息 2");
    expect(transcript).toContain("\n---\n");
  });

  it("copies the transcript when the header requests it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(createConversationMessages(2));
    await act(async () => {
      requestCopyConversation();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(copied).toContain("消息 1");
    expect(copied).toContain("消息 2");
  });
});
