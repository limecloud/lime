import { describe, expect, it } from "vitest";
import { buildAgentStreamTextDeltaApplyPlan } from "./agentStreamTextDeltaController";

describe("agentStreamTextDeltaController", () => {
  it("应构造首个 text delta 的累积内容、buffer 计数与指标上下文", () => {
    expect(
      buildAgentStreamTextDeltaApplyPlan({
        activeSessionId: "session-a",
        accumulatedContent: "",
        deltaText: "你好",
        eventName: "event-a",
        firstEventReceivedAt: 140,
        firstRuntimeStatusAt: 180,
        firstTextDeltaAt: null,
        now: 240,
        requestStartedAt: 100,
        textDeltaBufferedCount: undefined,
      }),
    ).toEqual({
      firstTextDeltaAt: 240,
      firstTextDeltaContext: {
        deltaChars: 2,
        elapsedMs: 140,
        eventName: "event-a",
        firstEventDeltaMs: 100,
        firstRuntimeStatusDeltaMs: 60,
        sessionId: "session-a",
      },
      nextAccumulatedContent: "你好",
      nextBufferedCount: 1,
    });
  });

  it("非首个 text delta 不应重复生成首 delta 指标", () => {
    expect(
      buildAgentStreamTextDeltaApplyPlan({
        activeSessionId: "session-a",
        accumulatedContent: "你好",
        deltaText: "，世界",
        eventName: "event-a",
        firstTextDeltaAt: 240,
        now: 280,
        requestStartedAt: 100,
        textDeltaBufferedCount: 2,
      }),
    ).toMatchObject({
      firstTextDeltaAt: null,
      firstTextDeltaContext: null,
      nextAccumulatedContent: "你好，世界",
      nextBufferedCount: 3,
    });
  });

  it("应使用 overlap detection 避免重复吐字", () => {
    expect(
      buildAgentStreamTextDeltaApplyPlan({
        activeSessionId: "session-a",
        accumulatedContent: "你好，世",
        deltaText: "世界",
        eventName: "event-a",
        firstTextDeltaAt: 240,
        now: 300,
        requestStartedAt: 100,
        textDeltaBufferedCount: 1,
      }).nextAccumulatedContent,
    ).toBe("你好，世界");
  });

  it("delta 被快照 replay 去重时首字指标仍应记录原始 delta 长度", () => {
    expect(
      buildAgentStreamTextDeltaApplyPlan({
        activeSessionId: "session-a",
        accumulatedContent: "快照正文",
        deltaText: "",
        eventName: "event-a",
        firstTextDeltaAt: null,
        metricDeltaText: "快照",
        now: 320,
        requestStartedAt: 100,
        textDeltaBufferedCount: 0,
      }),
    ).toMatchObject({
      firstTextDeltaAt: 320,
      firstTextDeltaContext: expect.objectContaining({
        deltaChars: 2,
      }),
      nextAccumulatedContent: "快照正文",
      nextBufferedCount: 1,
    });
  });
});
