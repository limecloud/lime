import { describe, expect, it } from "vitest";
import {
  buildAgentStreamFirstRuntimeStatusMetricContext,
  buildAgentStreamFirstTextDeltaMetricContext,
  shouldRecordAgentStreamFirstRuntimeStatus,
  shouldRecordAgentStreamFirstTextDelta,
} from "./agentStreamRuntimeMetricsController";

describe("agentStreamRuntimeMetricsController", () => {
  it("应判断 first runtime status / first text delta 是否需要记录", () => {
    expect(
      shouldRecordAgentStreamFirstRuntimeStatus({
        firstRuntimeStatusAt: null,
      }),
    ).toBe(true);
    expect(
      shouldRecordAgentStreamFirstRuntimeStatus({
        firstRuntimeStatusAt: 120,
      }),
    ).toBe(false);
    expect(
      shouldRecordAgentStreamFirstTextDelta({ firstTextDeltaAt: undefined }),
    ).toBe(true);
    expect(shouldRecordAgentStreamFirstTextDelta({ firstTextDeltaAt: 130 })).toBe(
      false,
    );
  });

  it("应构造 first runtime status 指标上下文", () => {
    expect(
      buildAgentStreamFirstRuntimeStatusMetricContext({
        activeSessionId: "session-a",
        eventName: "event-a",
        firstEventReceivedAt: 140,
        firstRuntimeStatusAt: 190,
        requestStartedAt: 100,
        statusPhase: "routing",
        statusTitle: "分析中",
      }),
    ).toEqual({
      elapsedMs: 90,
      eventName: "event-a",
      firstEventDeltaMs: 50,
      phase: "routing",
      sessionId: "session-a",
      title: "分析中",
    });
  });

  it("应构造 first text delta 指标上下文", () => {
    expect(
      buildAgentStreamFirstTextDeltaMetricContext({
        activeSessionId: "session-a",
        deltaText: "你好",
        eventName: "event-a",
        firstEventReceivedAt: 140,
        firstRuntimeStatusAt: 190,
        firstTextDeltaAt: 260,
        requestStartedAt: 100,
      }),
    ).toEqual({
      deltaChars: 2,
      elapsedMs: 160,
      eventName: "event-a",
      firstEventDeltaMs: 120,
      firstRuntimeStatusDeltaMs: 70,
      sessionId: "session-a",
    });
  });

  it("未记录前置阶段时 delta 字段应为 null", () => {
    expect(
      buildAgentStreamFirstTextDeltaMetricContext({
        activeSessionId: "session-a",
        deltaText: "好",
        eventName: "event-a",
        firstEventReceivedAt: null,
        firstRuntimeStatusAt: null,
        firstTextDeltaAt: 150,
        requestStartedAt: 100,
      }),
    ).toMatchObject({
      firstEventDeltaMs: null,
      firstRuntimeStatusDeltaMs: null,
    });
  });
});
