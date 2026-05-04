import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../types";
import {
  clearAgentUiPerformanceMetrics,
  getAgentUiPerformanceMetrics,
} from "@/lib/agentUiPerformanceMetrics";
import { buildWaitingAgentRuntimeStatus } from "../utils/agentRuntimeStatus";
import { mergeAgentUiPerformanceTraceMetadata } from "./agentStreamPerformanceMetrics";
import { prepareAgentStreamSubmitDraft } from "./agentStreamSubmitDraft";

type FrameRequestCallback = Parameters<typeof requestAnimationFrame>[0];

function createStateSetter<T>(getValue: () => T, setValue: (value: T) => void) {
  return (next: T | ((prev: T) => T)) => {
    setValue(
      typeof next === "function" ? (next as (prev: T) => T)(getValue()) : next,
    );
  };
}

describe("agentStreamSubmitDraft", () => {
  afterEach(() => {
    clearAgentUiPerformanceMetrics();
    vi.restoreAllMocks();
  });

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
      setMessages: createStateSetter(
        () => messages,
        (value) => {
          messages = value;
        },
      ),
      setIsSending: createStateSetter(
        () => isSending,
        (value) => {
          isSending = value;
        },
      ),
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
      setMessages: createStateSetter(
        () => messages,
        (value) => {
          messages = value;
        },
      ),
      setIsSending: createStateSetter(
        () => isSending,
        (value) => {
          isSending = value;
        },
      ),
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

  it("displayContent 应只影响用户可见文案，不影响底层执行内容", () => {
    let messages: Message[] = [];
    let isSending = false;

    prepareAgentStreamSubmitDraft({
      content: "/image_generate 生成 春日咖啡馆插画",
      displayContent: "@配图 生成 春日咖啡馆插画",
      images: [],
      skipUserMessage: false,
      expectingQueue: false,
      assistantMsgId: "assistant-3",
      userMsgId: "user-3",
      effectiveExecutionStrategy: "react",
      webSearch: false,
      thinking: false,
      setMessages: createStateSetter(
        () => messages,
        (value) => {
          messages = value;
        },
      ),
      setIsSending: createStateSetter(
        () => isSending,
        (value) => {
          isSending = value;
        },
      ),
    });

    expect(messages[0]).toMatchObject({
      id: "user-3",
      content: "@配图 生成 春日咖啡馆插画",
    });
    expect(isSending).toBe(true);
  });

  it("带性能 trace 时应记录 assistant 草稿插入与绘制指标", () => {
    let messages: Message[] = [];
    let isSending = false;
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(
        (callback: FrameRequestCallback) => {
          callback(0);
          return 1;
        },
      );

    prepareAgentStreamSubmitDraft({
      content: "只回答一个字：好",
      images: [],
      skipUserMessage: false,
      expectingQueue: false,
      assistantMsgId: "assistant-4",
      userMsgId: "user-4",
      assistantDraft: {
        initialRuntimeStatus: {
          phase: "routing",
          title: "快速响应已启用",
          detail: "这轮先用低延迟模型降低首字等待。",
        },
      },
      requestMetadata: mergeAgentUiPerformanceTraceMetadata(undefined, {
        requestId: "request-fast",
        sessionId: "draft-fast",
        workspaceId: "workspace-fast",
        source: "test",
        submittedAt: Date.now(),
      }),
      effectiveExecutionStrategy: "react",
      webSearch: false,
      thinking: false,
      setMessages: createStateSetter(
        () => messages,
        (value) => {
          messages = value;
        },
      ),
      setIsSending: createStateSetter(
        () => isSending,
        (value) => {
          isSending = value;
        },
      ),
    });

    expect(requestAnimationFrameSpy).toHaveBeenCalled();
    expect(messages[1]).toMatchObject({
      id: "assistant-4",
      role: "assistant",
      content: "",
    });
    expect(getAgentUiPerformanceMetrics().map((entry) => entry.phase)).toEqual([
      "agentStream.assistantDraft",
      "agentStream.assistantDraftPaint",
    ]);
  });
});
