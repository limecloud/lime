import { describe, expect, it } from "vitest";
import {
  buildAgentStreamSubmitAcceptedContext,
  buildAgentStreamSubmitDispatchedContext,
  buildAgentStreamSubmitFailedContext,
  buildAgentStreamSubmitFailedLogContext,
  resolveAgentStreamSubmitErrorMessage,
} from "./agentStreamSubmissionController";

describe("agentStreamSubmissionController", () => {
  it("应构造 listener bound 后的 submit dispatched 上下文", () => {
    expect(
      buildAgentStreamSubmitDispatchedContext({
        activeSessionId: "session-a",
        effectiveModel: "deepseek-chat",
        effectiveProviderType: "deepseek",
        eventName: "event-a",
        expectingQueue: false,
        timing: {
          requestStartedAt: 100,
          listenerBoundAt: 140,
          now: 175,
        },
      }),
    ).toEqual({
      elapsedMs: 75,
      eventName: "event-a",
      expectingQueue: false,
      listenerBoundDeltaMs: 35,
      model: "deepseek-chat",
      provider: "deepseek",
      sessionId: "session-a",
    });
  });

  it("未记录 listener bound 时 dispatched 上下文应保留 null delta", () => {
    expect(
      buildAgentStreamSubmitDispatchedContext({
        activeSessionId: "session-a",
        effectiveModel: "gpt-5.4",
        effectiveProviderType: "openai",
        eventName: "event-a",
        expectingQueue: true,
        timing: {
          requestStartedAt: 100,
          listenerBoundAt: null,
          now: 125,
        },
      }),
    ).toMatchObject({
      elapsedMs: 25,
      listenerBoundDeltaMs: null,
    });
  });

  it("应构造 submit accepted 与 failed 上下文", () => {
    expect(
      buildAgentStreamSubmitAcceptedContext({
        activeSessionId: "session-a",
        eventName: "event-a",
        timing: {
          requestStartedAt: 100,
          submissionDispatchedAt: 160,
          now: 210,
        },
      }),
    ).toEqual({
      elapsedMs: 110,
      eventName: "event-a",
      sessionId: "session-a",
      submitInvokeMs: 50,
    });

    expect(
      buildAgentStreamSubmitFailedContext({
        activeSessionId: "session-a",
        eventName: "event-a",
        error: new Error("provider timeout"),
        timing: {
          requestStartedAt: 100,
          submissionDispatchedAt: 160,
          now: 220,
        },
      }),
    ).toEqual({
      elapsedMs: 120,
      error: "provider timeout",
      eventName: "event-a",
      sessionId: "session-a",
      submitInvokeMs: 60,
    });
  });

  it("failed log context 应保留原始 error", () => {
    const error = new Error("bridge failed");

    expect(resolveAgentStreamSubmitErrorMessage("bad gateway")).toBe(
      "bad gateway",
    );
    expect(
      buildAgentStreamSubmitFailedLogContext({
        activeSessionId: "session-a",
        eventName: "event-a",
        error,
        timing: {
          requestStartedAt: 100,
          submissionDispatchedAt: null,
          now: 120,
        },
      }),
    ).toEqual({
      elapsedMs: 20,
      error,
      eventName: "event-a",
      sessionId: "session-a",
      submitInvokeMs: null,
    });
  });
});
