import { describe, expect, it } from "vitest";
import {
  buildAgentStreamFirstEventContext,
  buildAgentStreamFirstEventDeferredContext,
  buildAgentStreamListenerBoundContext,
  extractAgentStreamRuntimeEventType,
  shouldDeferAgentStreamFirstEventTimeout,
  shouldIgnoreAgentStreamInactivityResult,
  shouldScheduleAgentStreamInactivityWatchdog,
} from "./agentStreamListenerReadinessController";

describe("agentStreamListenerReadinessController", () => {
  it("应提取结构化 runtime event type", () => {
    expect(
      extractAgentStreamRuntimeEventType({
        type: "runtime_status",
      }),
    ).toBe("runtime_status");
    expect(extractAgentStreamRuntimeEventType({ type: "   " })).toBeNull();
    expect(extractAgentStreamRuntimeEventType(["runtime_status"])).toBeNull();
    expect(extractAgentStreamRuntimeEventType(null)).toBeNull();
  });

  it("应构造 listener bound 与 first event 指标上下文", () => {
    expect(
      buildAgentStreamListenerBoundContext({
        activeSessionId: "session-a",
        eventName: "event-a",
        expectingQueue: false,
        listenerBoundAt: 145,
        requestStartedAt: 100,
      }),
    ).toEqual({
      elapsedMs: 45,
      eventName: "event-a",
      expectingQueue: false,
      sessionId: "session-a",
    });

    expect(
      buildAgentStreamFirstEventContext({
        activeSessionId: "session-a",
        eventName: "event-a",
        eventReceivedAt: 260,
        eventType: "text_delta",
        recognized: true,
        requestStartedAt: 100,
        submissionDispatchedAt: 180,
      }),
    ).toEqual({
      elapsedMs: 160,
      eventName: "event-a",
      eventType: "text_delta",
      recognized: true,
      sessionId: "session-a",
      submissionDispatchedDeltaMs: 80,
    });
  });

  it("应构造 first event deferred 上下文并保留未派发 delta", () => {
    expect(
      buildAgentStreamFirstEventDeferredContext({
        activeSessionId: "session-a",
        deferredAt: 12_100,
        eventName: "event-a",
        requestStartedAt: 100,
        submissionDispatchedAt: null,
      }),
    ).toEqual({
      elapsedMs: 12_000,
      eventName: "event-a",
      sessionId: "session-a",
      submissionDispatchedDeltaMs: null,
    });
  });

  it("应判断 first event timeout 是否可转为提交后继续等待", () => {
    expect(
      shouldDeferAgentStreamFirstEventTimeout({
        firstEventReceived: false,
        requestFinished: false,
        submissionDispatchedAt: 200,
      }),
    ).toBe(true);

    expect(
      shouldDeferAgentStreamFirstEventTimeout({
        firstEventReceived: true,
        requestFinished: false,
        submissionDispatchedAt: 200,
      }),
    ).toBe(false);
    expect(
      shouldDeferAgentStreamFirstEventTimeout({
        firstEventReceived: false,
        requestFinished: false,
        submissionDispatchedAt: null,
      }),
    ).toBe(false);
  });

  it("应判断 inactivity watchdog 调度与过期结果丢弃", () => {
    expect(
      shouldScheduleAgentStreamInactivityWatchdog({
        firstEventReceived: true,
        requestFinished: false,
        streamActivated: true,
      }),
    ).toBe(true);
    expect(
      shouldScheduleAgentStreamInactivityWatchdog({
        firstEventReceived: false,
        requestFinished: false,
        streamActivated: true,
      }),
    ).toBe(false);

    expect(
      shouldIgnoreAgentStreamInactivityResult({
        lastEventReceivedAt: 220,
        requestFinished: false,
        streamActivated: true,
        timeoutStartedAt: 200,
      }),
    ).toBe(true);
    expect(
      shouldIgnoreAgentStreamInactivityResult({
        lastEventReceivedAt: 180,
        requestFinished: false,
        streamActivated: true,
        timeoutStartedAt: 200,
      }),
    ).toBe(false);
  });
});
