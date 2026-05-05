import { describe, expect, it, vi } from "vitest";
import type { StreamRequestState } from "./agentStreamSubmissionLifecycle";
import { runAgentStreamSubmitLifecycle } from "./agentStreamSubmitLifecycleController";

function createRequestState(): StreamRequestState {
  return {
    accumulatedContent: "",
    requestLogId: null,
    requestStartedAt: 100,
    listenerBoundAt: 140,
    requestFinished: false,
    queuedTurnId: null,
    performanceTrace: {
      requestId: "request-a",
      sessionId: "session-a",
      workspaceId: "workspace-a",
      source: "home-input",
      submittedAt: 90,
    },
  };
}

function createNow(values: number[]) {
  return () => {
    const value = values.shift();
    if (value === undefined) {
      throw new Error("now sequence exhausted");
    }
    return value;
  };
}

describe("agentStreamSubmitLifecycleController", () => {
  it("应记录 submit dispatched 与 accepted 生命周期", async () => {
    const requestState = createRequestState();
    const submit = vi.fn(async () => {});
    const recordMetric = vi.fn();
    const logDebug = vi.fn();

    await runAgentStreamSubmitLifecycle({
      activeSessionId: "session-a",
      effectiveModel: "deepseek-chat",
      effectiveProviderType: "deepseek",
      eventName: "event-a",
      expectingQueue: false,
      requestState,
      submit,
      deps: {
        now: createNow([175, 230]),
        recordMetric,
        logDebug,
      },
    });

    expect(requestState.submissionDispatchedAt).toBe(175);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(recordMetric).toHaveBeenNthCalledWith(
      1,
      "agentStream.submitDispatched",
      requestState.performanceTrace,
      {
        elapsedMs: 75,
        eventName: "event-a",
        expectingQueue: false,
        listenerBoundDeltaMs: 35,
        model: "deepseek-chat",
        provider: "deepseek",
        sessionId: "session-a",
      },
    );
    expect(recordMetric).toHaveBeenNthCalledWith(
      2,
      "agentStream.submitAccepted",
      requestState.performanceTrace,
      {
        elapsedMs: 130,
        eventName: "event-a",
        sessionId: "session-a",
        submitInvokeMs: 55,
      },
    );
    expect(logDebug).toHaveBeenNthCalledWith(
      1,
      "AgentStream",
      "submitDispatched",
      expect.objectContaining({ eventName: "event-a" }),
    );
    expect(logDebug).toHaveBeenNthCalledWith(
      2,
      "AgentStream",
      "submitAccepted",
      expect.objectContaining({ submitInvokeMs: 55 }),
    );
  });

  it("submit 失败时应记录 failed 并继续抛出原始错误", async () => {
    const requestState = createRequestState();
    const error = new Error("bridge timeout");
    const submit = vi.fn(async () => {
      throw error;
    });
    const recordMetric = vi.fn();
    const logDebug = vi.fn();

    await expect(
      runAgentStreamSubmitLifecycle({
        activeSessionId: "session-a",
        effectiveModel: "gpt-5.4",
        effectiveProviderType: "openai",
        eventName: "event-a",
        expectingQueue: true,
        requestState,
        submit,
        deps: {
          now: createNow([180, 260]),
          recordMetric,
          logDebug,
        },
      }),
    ).rejects.toBe(error);

    expect(requestState.submissionDispatchedAt).toBe(180);
    expect(recordMetric).toHaveBeenNthCalledWith(
      2,
      "agentStream.submitFailed",
      requestState.performanceTrace,
      {
        elapsedMs: 160,
        error: "bridge timeout",
        eventName: "event-a",
        sessionId: "session-a",
        submitInvokeMs: 80,
      },
    );
    expect(logDebug).toHaveBeenNthCalledWith(
      2,
      "AgentStream",
      "submitFailed",
      {
        elapsedMs: 160,
        error,
        eventName: "event-a",
        sessionId: "session-a",
        submitInvokeMs: 80,
      },
      { level: "error" },
    );
  });
});
