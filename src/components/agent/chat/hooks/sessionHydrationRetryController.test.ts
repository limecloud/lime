import { describe, expect, it } from "vitest";
import { resolveDeferredSessionHydrationErrorAction } from "./sessionHydrationRetryController";

describe("sessionHydrationRetryController", () => {
  it("retryable transient 错误未达上限时应安排重试", () => {
    const action = resolveDeferredSessionHydrationErrorAction({
      error: new Error("bridge health check failed"),
      retryCount: 0,
      maxRetry: 1,
      retryDelayMs: 15_000,
      topicId: "topic-a",
      workspaceId: "workspace-a",
    });

    expect(action).toMatchObject({
      kind: "retry",
      nextRetryCount: 1,
      retryDelayMs: 15_000,
      metricName: "session.switch.fetchDetail.retryScheduled",
      logEvent: "switchTopic.fetchDetail.retryScheduled",
      logContext: {
        errorCategory: "bridge_health",
        retryCount: 1,
        retryDelayMs: 15_000,
        sessionId: "topic-a",
        topicId: "topic-a",
        workspaceId: "workspace-a",
      },
    });
  });

  it("retryable transient 错误达到上限后应跳过并保留缓存快照", () => {
    const action = resolveDeferredSessionHydrationErrorAction({
      error: new Error("fetch failed"),
      retryCount: 1,
      maxRetry: 1,
      retryDelayMs: 15_000,
      topicId: "topic-a",
      workspaceId: "workspace-a",
    });

    expect(action).toMatchObject({
      kind: "skip",
      metricName: "session.switch.fetchDetail.retrySkipped",
      logEvent: "switchTopic.fetchDetail.retrySkipped",
      logContext: {
        errorCategory: "connection",
        retryCount: 1,
        sessionId: "topic-a",
      },
    });
  });

  it("非 retryable transient 错误应直接跳过", () => {
    const action = resolveDeferredSessionHydrationErrorAction({
      error: new Error("request timeout"),
      retryCount: 0,
      maxRetry: 1,
      retryDelayMs: 15_000,
      topicId: "topic-timeout",
    });

    expect(action).toMatchObject({
      kind: "skip",
      logContext: {
        errorCategory: "timeout",
        retryCount: 0,
        sessionId: "topic-timeout",
      },
    });
  });

  it("未知错误应交给 switchTopic error fallback", () => {
    const error = new Error("permission denied");
    const action = resolveDeferredSessionHydrationErrorAction({
      error,
      retryCount: 0,
      maxRetry: 1,
      retryDelayMs: 15_000,
      topicId: "topic-a",
    });

    expect(action).toEqual({
      kind: "fail",
      error,
    });
  });
});
