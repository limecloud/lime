import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import {
  AGENT_STREAM_EMPTY_FINAL_REPLY_ERROR_MESSAGE,
  buildAgentStreamCompletedAssistantMessagePatch,
  buildAgentStreamEmptyFinalErrorPlan,
  buildAgentStreamFinalDonePlan,
  buildAgentStreamMissingFinalReplyFailurePlan,
  buildAgentStreamMissingFinalReplyFailureSideEffectPlan,
  isAgentStreamEmptyFinalReplyError,
  reconcileAgentStreamFinalContentParts,
  resolveAgentStreamGracefulCompletionContent,
  shouldFailAgentStreamMissingFinalReply,
} from "./agentStreamCompletionController";

describe("agentStreamCompletionController", () => {
  it("应识别空最终回复错误", () => {
    expect(
      isAgentStreamEmptyFinalReplyError(
        `runtime error: ${AGENT_STREAM_EMPTY_FINAL_REPLY_ERROR_MESSAGE}`,
      ),
    ).toBe(true);
    expect(isAgentStreamEmptyFinalReplyError("普通错误")).toBe(false);
  });

  it("应判断空最终回复是否需要失败", () => {
    expect(
      shouldFailAgentStreamMissingFinalReply({
        accumulatedContent: "",
      }),
    ).toBe(true);
    expect(
      shouldFailAgentStreamMissingFinalReply({
        accumulatedContent: "<tool_call></tool_call>",
      }),
    ).toBe(true);
    expect(
      shouldFailAgentStreamMissingFinalReply({
        accumulatedContent: "<tool_call></tool_call>",
        hasMeaningfulCompletionSignal: true,
      }),
    ).toBe(false);
    expect(
      shouldFailAgentStreamMissingFinalReply({
        accumulatedContent: "最终答复",
      }),
    ).toBe(false);
  });

  it("应解析可降级完成内容并剥离协议残留", () => {
    expect(
      resolveAgentStreamGracefulCompletionContent({
        accumulatedContent: " 最终答复 ",
      }),
    ).toBe("最终答复");
    expect(
      resolveAgentStreamGracefulCompletionContent({
        accumulatedContent: "<tool_call></tool_call>",
        fallbackContent: "兜底内容",
      }),
    ).toBe("兜底内容");
  });

  it("应在最终文本变化时重建 text part 并保留过程 part", () => {
    const parts = [
      { type: "text", text: "原始" },
      { type: "tool_use", toolCall: { id: "tool-a" } },
    ] as unknown as Message["contentParts"];

    expect(
      reconcileAgentStreamFinalContentParts({
        parts,
        finalContent: "最终",
        rawContent: "原始",
        surfaceThinkingDeltas: true,
      }),
    ).toEqual([
      { type: "tool_use", toolCall: { id: "tool-a" } },
      { type: "text", text: "最终" },
    ]);
  });

  it("应在不展示 thinking 时过滤 thinking part", () => {
    const parts = [
      { type: "thinking", text: "推理" },
      { type: "text", text: "最终" },
    ] satisfies Message["contentParts"];

    expect(
      reconcileAgentStreamFinalContentParts({
        parts,
        finalContent: "最终",
        rawContent: "最终",
        surfaceThinkingDeltas: false,
      }),
    ).toEqual([{ type: "text", text: "最终" }]);
  });

  it("应构造完成态 assistant 消息 patch 并带回 usage", () => {
    const usage = { input_tokens: 1, output_tokens: 2 };

    expect(
      buildAgentStreamCompletedAssistantMessagePatch({
        parts: [{ type: "text", text: "原始" }],
        finalContent: "最终",
        rawContent: "原始",
        surfaceThinkingDeltas: true,
        usage,
      }),
    ).toEqual({
      isThinking: false,
      content: "最终",
      contentParts: [{ type: "text", text: "最终" }],
      thinkingContent: undefined,
      runtimeStatus: undefined,
      usage,
    });
  });

  it("完成态应在持久化 reasoning 接管前保留本地思考兜底", () => {
    expect(
      buildAgentStreamCompletedAssistantMessagePatch({
        parts: [
          { type: "thinking", text: "先分析意图。" },
          { type: "text", text: "最终" },
        ],
        finalContent: "最终",
        rawContent: "最终",
        surfaceThinkingDeltas: true,
        thinkingContent: " 先分析意图。 ",
      }),
    ).toEqual({
      isThinking: false,
      content: "最终",
      contentParts: [
        { type: "thinking", text: "先分析意图。" },
        { type: "text", text: "最终" },
      ],
      thinkingContent: "先分析意图。",
      runtimeStatus: undefined,
    });
  });

  it("关闭思考展示时完成态不应保留本地思考兜底", () => {
    expect(
      buildAgentStreamCompletedAssistantMessagePatch({
        parts: [
          { type: "thinking", text: "先分析意图。" },
          { type: "text", text: "最终" },
        ],
        finalContent: "最终",
        rawContent: "最终",
        surfaceThinkingDeltas: false,
        thinkingContent: "先分析意图。",
      }),
    ).toEqual({
      isThinking: false,
      content: "最终",
      contentParts: [{ type: "text", text: "最终" }],
      thinkingContent: undefined,
      runtimeStatus: undefined,
    });
  });

  it("应为 final_done 构造完成副作用计划", () => {
    expect(
      buildAgentStreamFinalDonePlan({
        accumulatedContent:
          '<tool_result>{"output":"saved"}</tool_result>\n\n已保存。',
        queuedTurnId: "queued-1",
        toolCallCount: 2,
      }),
    ).toEqual({
      type: "complete",
      finalContent: "已保存。",
      queuedTurnIds: ["queued-1"],
      requestLogPayload: {
        eventType: "chat_request_complete",
        status: "success",
        description: "请求完成，工具调用 2 次",
      },
    });
  });

  it("应为缺少最终回复的 final_done 构造失败计划并保留 usage", () => {
    const usage = { input_tokens: 5, output_tokens: 0 };

    expect(
      buildAgentStreamFinalDonePlan({
        accumulatedContent: "",
        hasMeaningfulCompletionSignal: false,
        queuedTurnId: "queued-missing",
        toolCallCount: 0,
        usage,
      }),
    ).toEqual({
      type: "missing_final_reply_failure",
      errorMessage: AGENT_STREAM_EMPTY_FINAL_REPLY_ERROR_MESSAGE,
      queuedTurnIds: ["queued-missing"],
      requestLogPayload: {
        eventType: "chat_request_error",
        status: "error",
        error: AGENT_STREAM_EMPTY_FINAL_REPLY_ERROR_MESSAGE,
      },
      toastMessage: AGENT_STREAM_EMPTY_FINAL_REPLY_ERROR_MESSAGE,
      usage,
    });
  });

  it("应构造缺少最终回复失败副作用计划", () => {
    expect(
      buildAgentStreamMissingFinalReplyFailurePlan({
        errorMessage: "模型未输出最终答复：工具已完成",
        queuedTurnId: "queued-1",
      }),
    ).toEqual({
      type: "missing_final_reply_failure",
      errorMessage: "模型未输出最终答复：工具已完成",
      queuedTurnIds: ["queued-1"],
      requestLogPayload: {
        eventType: "chat_request_error",
        status: "error",
        error: "模型未输出最终答复：工具已完成",
      },
      toastMessage: AGENT_STREAM_EMPTY_FINAL_REPLY_ERROR_MESSAGE,
    });
  });

  it("应构造缺少最终回复失败的执行层副作用计划", () => {
    const usage = { input_tokens: 10, output_tokens: 0 };
    const failurePlan = buildAgentStreamMissingFinalReplyFailurePlan({
      errorMessage: "模型未输出最终答复：工具已完成",
      queuedTurnId: "queued-1",
      usage,
    });

    expect(
      buildAgentStreamMissingFinalReplyFailureSideEffectPlan(failurePlan),
    ).toEqual({
      errorMessage: "模型未输出最终答复：工具已完成",
      observerErrorMessage: "模型未输出最终答复：工具已完成",
      queuedTurnIds: ["queued-1"],
      requestLogPayload: {
        eventType: "chat_request_error",
        status: "error",
        error: "模型未输出最终答复：工具已完成",
      },
      shouldClearActiveStream: true,
      shouldClearPendingTextRenderTimer: true,
      shouldDisposeListener: true,
      shouldMarkFailedTimeline: true,
      toastMessage: AGENT_STREAM_EMPTY_FINAL_REPLY_ERROR_MESSAGE,
      usage,
    });
  });

  it("应为空 final error 按产物信号决定失败或软完成", () => {
    expect(
      buildAgentStreamEmptyFinalErrorPlan({
        errorMessage: "模型未输出最终答复：工具已完成",
        accumulatedContent: "",
        hasMeaningfulCompletionSignal: false,
      }),
    ).toEqual({
      type: "missing_final_reply_failure",
      errorMessage: "模型未输出最终答复：工具已完成",
      queuedTurnIds: [],
      requestLogPayload: {
        eventType: "chat_request_error",
        status: "error",
        error: "模型未输出最终答复：工具已完成",
      },
      toastMessage: AGENT_STREAM_EMPTY_FINAL_REPLY_ERROR_MESSAGE,
    });

    expect(
      buildAgentStreamEmptyFinalErrorPlan({
        errorMessage: "模型未输出最终答复：工具已完成",
        accumulatedContent: "",
        hasMeaningfulCompletionSignal: true,
        queuedTurnId: "queued-2",
      }),
    ).toEqual({
      type: "complete",
      finalContent: "本轮执行已完成，详细过程与产物已保留在当前对话中。",
      queuedTurnIds: ["queued-2"],
      requestLogPayload: {
        eventType: "chat_request_complete",
        status: "success",
        description: "请求完成，模型未补充最终总结，已降级保留当前过程结果",
      },
    });
  });
});
