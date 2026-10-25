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

describe("agentStreamSubmitDraft browser paint boundary", () => {
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
      assistantMsgId: "assistant-1",
      userMsgId: "user-1",
      effectiveExecutionStrategy: "react",
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



  it("跳过 user message 时只注入 assistant draft，并保留自定义初始内容", () => {
    let messages: Message[] = [];
    let isSending = false;

    const waitingRuntimeStatus = buildWaitingAgentRuntimeStatus({
      executionStrategy: "react",
    });

    const { assistantMsg } = prepareAgentStreamSubmitDraft({
      content: "   ",
      images: [],
      skipUserMessage: true,
      assistantMsgId: "assistant-2",
      userMsgId: null,
      assistantDraft: {
        content: "准备执行中",
        initialRuntimeStatus: waitingRuntimeStatus,
      },
      effectiveExecutionStrategy: "react",
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
    expect(assistantMsg.runtimeStatus?.title).toBe("正在启动处理流程");
    expect(assistantMsg.runtimeStatus?.detail).toBe(
      "已开始处理，正在准备环境并等待第一条进展。",
    );
    expect(isSending).toBe(true);
  });

  it("displayContent 应只影响用户可见文案，不影响底层执行内容", () => {
    let messages: Message[] = [];
    let isSending = false;

    prepareAgentStreamSubmitDraft({
      content: "/image_generate 生成 春日咖啡馆插画",
      displayContent: "@配图 生成 春日咖啡馆插画",
      capabilityRoute: {
        kind: "builtin_command",
        commandKey: "image_generate",
        commandPrefix: "@inspect",
      },
      images: [],
      skipUserMessage: false,
      assistantMsgId: "assistant-3",
      userMsgId: "user-3",
      effectiveExecutionStrategy: "react",
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
      inputCapabilityRoute: {
        kind: "builtin_command",
        commandKey: "image_generate",
        commandPrefix: "@inspect",
      },
    });
    expect(isSending).toBe(true);
  });

  it("图片 assistant draft 应直接挂载图片轻卡预览", () => {
    let messages: Message[] = [];
    let isSending = false;

    prepareAgentStreamSubmitDraft({
      content: "@Nanobanana Pro 生成广州塔春天照片",
      images: [],
      skipUserMessage: false,
      assistantMsgId: "assistant-image",
      userMsgId: "user-image",
      assistantDraft: {
        content: "",
        fallbackContent: "",
        imageWorkbenchPreview: {
          taskId: "draft-image-1",
          prompt: "一张广州塔春天照片",
          mode: "generate",
          status: "running",
          modelName: "fal-ai/nano-banana-pro",
          expectedImageCount: 1,
        },
      },
      effectiveExecutionStrategy: "react",
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

    expect(messages[1]).toMatchObject({
      id: "assistant-image",
      content: "",
      imageWorkbenchPreview: {
        taskId: "draft-image-1",
        prompt: "一张广州塔春天照片",
        status: "running",
        modelName: "fal-ai/nano-banana-pro",
      },
    });
    expect(isSending).toBe(true);
  });

  it("带性能 trace 时应记录 assistant 草稿插入与绘制指标", () => {
    let messages: Message[] = [];
    let isSending = false;
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

    prepareAgentStreamSubmitDraft({
      content: "只回答一个字：好",
      images: [],
      skipUserMessage: false,
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
