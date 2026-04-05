import { afterEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import type { Message } from "../types";
import {
  prepareAgentStreamUserInputSend,
  type AgentStreamUserInputSendPreparationEnv,
} from "./agentStreamUserInputSendPreparation";
import type { ActiveStreamState } from "./agentStreamSubmissionLifecycle";

function createStateSetter<T>(getValue: () => T, setValue: (value: T) => void) {
  return (next: T | ((prev: T) => T)) => {
    setValue(typeof next === "function" ? (next as (prev: T) => T)(getValue()) : next);
  };
}

describe("agentStreamUserInputSendPreparation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createEnv(options?: {
    sessionId?: string | null;
    activeStream?: ActiveStreamState | null;
    queuedTurnsCount?: number;
    threadBusy?: boolean;
    providerType?: string;
    model?: string;
  }): AgentStreamUserInputSendPreparationEnv {
    let messages: Message[] = [];
    let isSending = false;

    return {
      executionStrategy: "react",
      providerTypeRef: {
        current: options?.providerType ?? "openai",
      } as MutableRefObject<string>,
      modelRef: {
        current: options?.model ?? "gpt-5.4",
      } as MutableRefObject<string>,
      sessionIdRef: {
        current: options?.sessionId ?? "session-1",
      } as MutableRefObject<string | null>,
      activeStreamRef: {
        current: options?.activeStream ?? null,
      } as MutableRefObject<ActiveStreamState | null>,
      getQueuedTurnsCount: () => options?.queuedTurnsCount ?? 0,
      isThreadBusy: () => options?.threadBusy ?? false,
      getSyncedSessionModelPreference: () => ({
        providerType: "openai",
        model: "gpt-5.4",
      }),
      setMessages: createStateSetter(() => messages, (value) => {
        messages = value;
      }),
      setIsSending: createStateSetter(() => isSending, (value) => {
        isSending = value;
      }),
    };
  }

  it("应归一化发送参数并注入 draft", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-0000-0000-000000000001")
      .mockReturnValueOnce("00000000-0000-0000-0000-000000000002");

    let messages: Message[] = [];
    let isSending = false;
    const env = {
      ...createEnv(),
      setMessages: createStateSetter(() => messages, (value) => {
        messages = value;
      }),
      setIsSending: createStateSetter(() => isSending, (value) => {
        isSending = value;
      }),
    };

    const result = prepareAgentStreamUserInputSend({
      content: "继续生成提纲",
      images: [],
      webSearch: true,
      thinking: true,
      skipUserMessage: false,
      options: {
        requestMetadata: { source: "test" },
      },
      env,
    });

    expect(result.effectiveExecutionStrategy).toBe("react");
    expect(result.effectiveProviderType).toBe("openai");
    expect(result.effectiveModel).toBe("gpt-5.4");
    expect(result.syncedSessionModelPreference).toEqual({
      providerType: "openai",
      model: "gpt-5.4",
    });
    expect(result.expectingQueue).toBe(false);
    expect(result.assistantMsgId).toBe("00000000-0000-0000-0000-000000000001");
    expect(result.userMsgId).toBe("00000000-0000-0000-0000-000000000002");
    expect(messages).toHaveLength(2);
    expect(isSending).toBe(true);
  });

  it("displayContent 应透传给用户消息草稿", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-0000-0000-000000000101")
      .mockReturnValueOnce("00000000-0000-0000-0000-000000000102");

    let messages: Message[] = [];
    let isSending = false;
    const env = {
      ...createEnv(),
      setMessages: createStateSetter(() => messages, (value) => {
        messages = value;
      }),
      setIsSending: createStateSetter(() => isSending, (value) => {
        isSending = value;
      }),
    };

    prepareAgentStreamUserInputSend({
      content: "/image_generate 生成 春日咖啡馆插画",
      images: [],
      skipUserMessage: false,
      options: {
        displayContent: "@配图 生成 春日咖啡馆插画",
      },
      env,
    });

    expect(messages[0]).toMatchObject({
      id: "00000000-0000-0000-0000-000000000102",
      role: "user",
      content: "@配图 生成 春日咖啡馆插画",
    });
    expect(isSending).toBe(true);
  });

  it("有 active stream 时应进入 queue 模式，并允许 model override", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-0000-0000-000000000003");

    let messages: Message[] = [];
    let isSending = false;
    const env = {
      ...createEnv({
        sessionId: null,
        activeStream: {
          assistantMsgId: "assistant-queued",
          eventName: "event-queued",
          sessionId: "session-queued",
        },
        providerType: "claude",
        model: "sonnet",
      }),
      setMessages: createStateSetter(() => messages, (value) => {
        messages = value;
      }),
      setIsSending: createStateSetter(() => isSending, (value) => {
        isSending = value;
      }),
      getSyncedSessionModelPreference: () => null,
    };

    const result = prepareAgentStreamUserInputSend({
      content: "继续生成提纲",
      images: [],
      skipUserMessage: true,
      executionStrategyOverride: "code_orchestrated",
      modelOverride: "opus",
      options: {
        assistantDraft: {
          content: "队列中",
        },
      },
      env,
    });

    expect(result.effectiveExecutionStrategy).toBe("code_orchestrated");
    expect(result.effectiveProviderType).toBe("claude");
    expect(result.effectiveModel).toBe("opus");
    expect(result.syncedSessionModelPreference).toBeNull();
    expect(result.expectingQueue).toBe(true);
    expect(result.userMsgId).toBeNull();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("队列中");
    expect(isSending).toBe(false);
  });

  it("恢复态 thread 仍忙时也应直接进入 queue 模式", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-0000-0000-000000000004")
      .mockReturnValueOnce("00000000-0000-0000-0000-000000000005");

    let messages: Message[] = [];
    let isSending = false;
    const env = {
      ...createEnv({
        threadBusy: true,
      }),
      setMessages: createStateSetter(() => messages, (value) => {
        messages = value;
      }),
      setIsSending: createStateSetter(() => isSending, (value) => {
        isSending = value;
      }),
    };

    const result = prepareAgentStreamUserInputSend({
      content: "继续分析这个项目",
      images: [],
      skipUserMessage: false,
      env,
    });

    expect(result.expectingQueue).toBe(true);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.runtimeStatus?.title).toBe("已加入排队列表");
    expect(isSending).toBe(false);
  });
});
