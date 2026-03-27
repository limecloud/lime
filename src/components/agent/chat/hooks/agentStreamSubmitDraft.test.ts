import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import { buildWaitingAgentRuntimeStatus } from "../utils/agentRuntimeStatus";
import { prepareAgentStreamSubmitDraft } from "./agentStreamSubmitDraft";

function createStateSetter<T>(getValue: () => T, setValue: (value: T) => void) {
  return (next: T | ((prev: T) => T)) => {
    setValue(typeof next === "function" ? (next as (prev: T) => T)(getValue()) : next);
  };
}

describe("agentStreamSubmitDraft", () => {
  it("应注入 user/assistant 草稿，并开启发送态", () => {
    let messages: Message[] = [];
    let isSending = false;

    const { assistantMsg } = prepareAgentStreamSubmitDraft({
      content: "继续生成一版提纲",
      images: [],
      skipUserMessage: false,
      expectingQueue: false,
      assistantMsgId: "assistant-1",
      userMsgId: "user-1",
      effectiveExecutionStrategy: "react",
      webSearch: true,
      thinking: true,
      setMessages: createStateSetter(() => messages, (value) => {
        messages = value;
      }),
      setIsSending: createStateSetter(() => isSending, (value) => {
        isSending = value;
      }),
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "user-1",
      role: "user",
      content: "继续生成一版提纲",
    });
    expect(messages[1]).toMatchObject({
      id: "assistant-1",
      role: "assistant",
      isThinking: true,
    });
    expect(assistantMsg.id).toBe("assistant-1");
    expect(assistantMsg.runtimeStatus?.title).toContain("准备");
    expect(isSending).toBe(true);
  });

  it("队列态应只注入 assistant draft，并保留自定义初始内容", () => {
    let messages: Message[] = [];
    let isSending = false;

    const waitingRuntimeStatus = buildWaitingAgentRuntimeStatus({
      executionStrategy: "react",
      webSearch: false,
      thinking: true,
    });

    const { assistantMsg } = prepareAgentStreamSubmitDraft({
      content: "   ",
      images: [],
      skipUserMessage: true,
      expectingQueue: true,
      assistantMsgId: "assistant-2",
      userMsgId: null,
      assistantDraft: {
        content: "准备执行中",
        initialRuntimeStatus: waitingRuntimeStatus,
      },
      effectiveExecutionStrategy: "code_orchestrated",
      webSearch: false,
      thinking: true,
      setMessages: createStateSetter(() => messages, (value) => {
        messages = value;
      }),
      setIsSending: createStateSetter(() => isSending, (value) => {
        isSending = value;
      }),
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "assistant-2",
      role: "assistant",
      content: "准备执行中",
    });
    expect(assistantMsg.runtimeStatus?.title).toBe("已加入排队列表");
    expect(assistantMsg.runtimeStatus?.detail).toContain("空白输入");
    expect(isSending).toBe(false);
  });
});
