import { describe, expect, it, vi } from "vitest";
import type { StreamRequestState } from "./agentStreamSubmissionLifecycle";
import {
  buildAgentStreamRequestStartActivityLog,
  buildAgentStreamRequestStartMetricContext,
  startAgentStreamRequest,
} from "./agentStreamRequestStartController";

function createRequestState(): StreamRequestState {
  return {
    accumulatedContent: "",
    requestLogId: null,
    requestStartedAt: 0,
    requestFinished: false,
    queuedTurnId: null,
    performanceTrace: {
      requestId: "request-a",
      sessionId: "session-a",
      workspaceId: "workspace-a",
      source: "home-input",
      submittedAt: 100,
    },
  };
}

describe("agentStreamRequestStartController", () => {
  it("应构造 request start metric context", () => {
    expect(
      buildAgentStreamRequestStartMetricContext({
        activeSessionId: "session-a",
        content: "  继续生成提纲  ",
        effectiveExecutionStrategy: "react",
        effectiveModel: "deepseek-chat",
        effectiveProviderType: "deepseek",
        eventName: "event-a",
        expectingQueue: false,
        resolvedWorkspaceId: "workspace-a",
        skipUserMessage: false,
        systemPrompt: "0123456789".repeat(6),
      }),
    ).toEqual({
      contentLength: 6,
      eventName: "event-a",
      expectingQueue: false,
      model: "deepseek-chat",
      provider: "deepseek",
      sessionId: "session-a",
      skipUserMessage: false,
      systemPromptLength: 60,
      systemPromptPreview: "0123456789".repeat(4) + "01234567",
    });
  });

  it("应构造 request start activity log payload", () => {
    const autoContinue = {
      enabled: true,
      fast_mode_enabled: false,
      continuation_length: 2,
      sensitivity: 0.5,
    };

    expect(
      buildAgentStreamRequestStartActivityLog({
        activeSessionId: "session-a",
        autoContinue,
        content: "系统启动",
        effectiveExecutionStrategy: "code_orchestrated",
        effectiveModel: "gpt-5.4",
        effectiveProviderType: "openai",
        eventName: "event-a",
        expectingQueue: true,
        resolvedWorkspaceId: "workspace-a",
        skipUserMessage: true,
        systemPrompt: "system",
      }),
    ).toEqual({
      eventType: "chat_request_start",
      status: "pending",
      title: "系统引导请求",
      description: "模型: gpt-5.4 · 策略: code_orchestrated",
      workspaceId: "workspace-a",
      sessionId: "session-a",
      source: "aster-chat",
      metadata: {
        provider: "openai",
        model: "gpt-5.4",
        executionStrategy: "code_orchestrated",
        contentLength: 4,
        skipUserMessage: true,
        systemPromptLength: 6,
        autoContinueEnabled: true,
        autoContinue,
        queuedSubmission: true,
      },
    });
  });

  it("应写入 requestState 并记录 metric/activity", () => {
    const requestState = createRequestState();
    const recordMetric = vi.fn();
    const logActivity = vi.fn(() => "log-a");

    const requestLogId = startAgentStreamRequest({
      activeSessionId: "session-a",
      content: "你好",
      effectiveExecutionStrategy: "react",
      effectiveModel: "deepseek-chat",
      effectiveProviderType: "deepseek",
      eventName: "event-a",
      expectingQueue: false,
      requestState,
      resolvedWorkspaceId: "workspace-a",
      skipUserMessage: false,
      deps: {
        now: () => 250,
        recordMetric,
        logActivity,
      },
    });

    expect(requestLogId).toBe("log-a");
    expect(requestState.requestStartedAt).toBe(250);
    expect(requestState.requestLogId).toBe("log-a");
    expect(recordMetric).toHaveBeenCalledWith(
      "agentStream.request.start",
      requestState.performanceTrace,
      expect.objectContaining({
        contentLength: 2,
        eventName: "event-a",
        model: "deepseek-chat",
        provider: "deepseek",
        sessionId: "session-a",
      }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "chat_request_start",
        title: "发送请求",
        sessionId: "session-a",
        workspaceId: "workspace-a",
      }),
    );
  });
});
