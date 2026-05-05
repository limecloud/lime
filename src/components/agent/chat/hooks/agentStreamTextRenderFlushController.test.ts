import { describe, expect, it } from "vitest";
import {
  buildAgentStreamFirstTextPaintContext,
  buildAgentStreamTextRenderFlushPlan,
  resolveAgentStreamPendingRenderedTextDelta,
  shouldFlushAgentStreamVisibleFirstText,
  shouldScheduleAgentStreamTextRenderTimer,
} from "./agentStreamTextRenderFlushController";

describe("agentStreamTextRenderFlushController", () => {
  it("应解析本次待渲染 text delta", () => {
    expect(
      resolveAgentStreamPendingRenderedTextDelta({
        renderedContent: "你好",
        accumulatedContent: "你好，世界",
      }),
    ).toBe("，世界");
    expect(
      resolveAgentStreamPendingRenderedTextDelta({
        renderedContent: "旧文本",
        accumulatedContent: "新文本",
      }),
    ).toBe("新文本");
  });

  it("应判断首个可见文本立即 flush 和 timer 调度", () => {
    expect(
      shouldFlushAgentStreamVisibleFirstText({
        renderedContent: "",
        accumulatedContent: " 好 ",
      }),
    ).toBe(true);
    expect(
      shouldFlushAgentStreamVisibleFirstText({
        renderedContent: "好",
        accumulatedContent: "好啊",
      }),
    ).toBe(false);
    expect(shouldScheduleAgentStreamTextRenderTimer({ hasPendingTimer: false }))
      .toBe(true);
    expect(shouldScheduleAgentStreamTextRenderTimer({ hasPendingTimer: true }))
      .toBe(false);
  });

  it("应构造首个 render flush 计划和 first paint 调度", () => {
    expect(
      buildAgentStreamTextRenderFlushPlan({
        activeSessionId: "session-a",
        eventName: "event-a",
        firstTextDeltaAt: 180,
        firstTextPaintAt: null,
        firstTextPaintScheduled: false,
        firstTextRenderFlushAt: null,
        flushStartedAt: 220,
        maxTextDeltaBacklogChars: 0,
        nextContent: "你好",
        renderedContent: "",
        requestStartedAt: 100,
        textDeltaFlushCount: 0,
      }),
    ).toEqual({
      backlogChars: 2,
      firstTextRenderFlushAt: 220,
      firstTextRenderFlushContext: {
        elapsedMs: 120,
        eventName: "event-a",
        firstTextDeltaDeltaMs: 40,
        sessionId: "session-a",
      },
      flushLogContext: {
        accumulatedChars: 2,
        backlogChars: 2,
        elapsedMs: 120,
        eventName: "event-a",
        flushCount: 1,
        maxBacklogChars: 2,
        sessionId: "session-a",
      },
      flushLogDedupeKey: "AgentStream:textRenderFlush:event-a:1",
      nextLastTextRenderFlushAt: 220,
      nextMaxTextDeltaBacklogChars: 2,
      nextRenderedContent: "你好",
      nextTextDeltaFlushCount: 1,
      shouldLogFlush: true,
      shouldScheduleFirstTextPaint: true,
      textDelta: "你好",
    });
  });

  it("内容未变化时不应构造 flush 计划，非首 flush 不重复 first flush", () => {
    expect(
      buildAgentStreamTextRenderFlushPlan({
        activeSessionId: "session-a",
        eventName: "event-a",
        flushStartedAt: 220,
        nextContent: "你好",
        renderedContent: "你好",
        requestStartedAt: 100,
      }),
    ).toBeNull();

    expect(
      buildAgentStreamTextRenderFlushPlan({
        activeSessionId: "session-a",
        eventName: "event-a",
        firstTextPaintAt: 260,
        firstTextRenderFlushAt: 220,
        flushStartedAt: 300,
        maxTextDeltaBacklogChars: 2,
        nextContent: "你好，世界",
        renderedContent: "你好",
        requestStartedAt: 100,
        textDeltaFlushCount: 1,
      }),
    ).toMatchObject({
      firstTextRenderFlushAt: null,
      firstTextRenderFlushContext: null,
      nextTextDeltaFlushCount: 2,
      shouldLogFlush: false,
      shouldScheduleFirstTextPaint: false,
      textDelta: "，世界",
    });
  });

  it("应构造 first text paint 指标上下文", () => {
    expect(
      buildAgentStreamFirstTextPaintContext({
        activeSessionId: "session-a",
        eventName: "event-a",
        firstTextDeltaAt: 180,
        flushStartedAt: 220,
        paintedAt: 260,
        requestStartedAt: 100,
      }),
    ).toEqual({
      elapsedMs: 160,
      eventName: "event-a",
      firstTextDeltaDeltaMs: 80,
      renderFlushDeltaMs: 40,
      sessionId: "session-a",
    });
  });
});
