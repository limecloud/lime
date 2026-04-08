import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SendMessageFn } from "./agentChatShared";
import { createAgentChatSendMessage } from "./agentChatSendMessage";
import { listSlashEntryUsage } from "../skill-selection/slashEntryUsage";

beforeEach(() => {
  window.localStorage.clear();
});

describe("createAgentChatSendMessage", () => {
  it("普通消息应直接透传到 rawSendMessage", async () => {
    const rawSendMessage = vi.fn<SendMessageFn>(async () => undefined);
    const sendMessage = createAgentChatSendMessage({
      baseStatusSnapshot: {
        sessionId: "session-1",
        currentTurnId: "turn-1",
        providerType: "openai",
        model: "gpt-5",
        executionStrategy: "react",
        queuedTurnsCount: 0,
        isSending: false,
      },
      rawSendMessage,
      compactSession: vi.fn(async () => undefined),
      clearMessages: vi.fn(),
      createFreshSession: vi.fn(async () => null),
      appendAssistantMessage: vi.fn(),
      notifyInfo: vi.fn(),
      notifySuccess: vi.fn(),
    });

    await sendMessage("继续执行", [], false, false, false, "auto", "gpt-5.4");

    expect(rawSendMessage).toHaveBeenCalledTimes(1);
    expect(rawSendMessage).toHaveBeenCalledWith(
      "继续执行",
      [],
      false,
      false,
      false,
      "auto",
      "gpt-5.4",
      undefined,
      undefined,
    );
  });

  it("命中本地 slash 命令时应跳过 rawSendMessage", async () => {
    const rawSendMessage = vi.fn<SendMessageFn>(async () => undefined);
    const appendAssistantMessage = vi.fn();
    const sendMessage = createAgentChatSendMessage({
      baseStatusSnapshot: {
        sessionId: "session-status",
        currentTurnId: "turn-status",
        providerType: "openai",
        model: "gpt-5",
        executionStrategy: "react",
        queuedTurnsCount: 2,
        isSending: false,
      },
      rawSendMessage,
      compactSession: vi.fn(async () => undefined),
      clearMessages: vi.fn(),
      createFreshSession: vi.fn(async () => null),
      appendAssistantMessage,
      notifyInfo: vi.fn(),
      notifySuccess: vi.fn(),
    });

    await sendMessage("/status", [], false, false, false, "auto", "gpt-5.4");

    expect(rawSendMessage).not.toHaveBeenCalled();
    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.stringContaining("当前会话状态："),
    );
    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.stringContaining("gpt-5.4"),
    );
    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.stringContaining("自动路由"),
    );
    expect(listSlashEntryUsage()).toEqual([
      expect.objectContaining({
        kind: "command",
        entryId: "status",
      }),
    ]);
  });

  it("命中 prompt slash 命令时应转换 prompt 后透传", async () => {
    const rawSendMessage = vi.fn<SendMessageFn>(async () => undefined);
    const sendMessage = createAgentChatSendMessage({
      baseStatusSnapshot: {
        sessionId: "session-review",
        currentTurnId: "turn-review",
        providerType: "openai",
        model: "gpt-5",
        executionStrategy: "react",
        queuedTurnsCount: 0,
        isSending: false,
      },
      rawSendMessage,
      compactSession: vi.fn(async () => undefined),
      clearMessages: vi.fn(),
      createFreshSession: vi.fn(async () => null),
      appendAssistantMessage: vi.fn(),
      notifyInfo: vi.fn(),
      notifySuccess: vi.fn(),
    });

    await sendMessage("/review src-tauri", [], false, false, false);

    expect(rawSendMessage).toHaveBeenCalledTimes(1);
    expect(rawSendMessage.mock.calls[0]?.[0]).toContain(
      "请对以下对象进行代码审查",
    );
    expect(rawSendMessage.mock.calls[0]?.[0]).toContain("src-tauri");
    expect(listSlashEntryUsage()).toEqual([
      expect.objectContaining({
        kind: "command",
        entryId: "review",
        replayText: "src-tauri",
      }),
    ]);
  });

  it("skipUserMessage 为 true 时应绕过 slash 分流", async () => {
    const rawSendMessage = vi.fn<SendMessageFn>(async () => undefined);
    const appendAssistantMessage = vi.fn();
    const sendMessage = createAgentChatSendMessage({
      baseStatusSnapshot: {
        sessionId: "session-skip",
        currentTurnId: "turn-skip",
        providerType: "openai",
        model: "gpt-5",
        executionStrategy: "react",
        queuedTurnsCount: 0,
        isSending: false,
      },
      rawSendMessage,
      compactSession: vi.fn(async () => undefined),
      clearMessages: vi.fn(),
      createFreshSession: vi.fn(async () => null),
      appendAssistantMessage,
      notifyInfo: vi.fn(),
      notifySuccess: vi.fn(),
    });

    await sendMessage("/status", [], false, false, true);

    expect(rawSendMessage).toHaveBeenCalledTimes(1);
    expect(rawSendMessage).toHaveBeenCalledWith(
      "/status",
      [],
      false,
      false,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(appendAssistantMessage).not.toHaveBeenCalled();
  });
});
