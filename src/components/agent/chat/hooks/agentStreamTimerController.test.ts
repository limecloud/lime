import { describe, expect, it } from "vitest";
import {
  AGENT_STREAM_QUEUED_DRAFT_CLEANUP_GRACE_MS,
  AGENT_STREAM_TEXT_DELTA_RENDER_FLUSH_MS,
  buildAgentStreamQueuedDraftCleanupTimerFirePlan,
  buildAgentStreamQueuedDraftCleanupTimerSchedulePlan,
  buildAgentStreamTextRenderTimerSchedulePlan,
  buildAgentStreamTimerClearPlan,
} from "./agentStreamTimerController";

describe("agentStreamTimerController", () => {
  it("应根据 timer 是否存在构造 clear 计划", () => {
    expect(buildAgentStreamTimerClearPlan({ hasTimer: false })).toEqual({
      shouldClearTimer: false,
      nextTimerId: null,
    });
    expect(buildAgentStreamTimerClearPlan({ hasTimer: true })).toEqual({
      shouldClearTimer: true,
      nextTimerId: null,
    });
  });

  it("首个可见文本应立即 flush，不等待 32ms timer", () => {
    expect(
      buildAgentStreamTextRenderTimerSchedulePlan({
        accumulatedContent: "你好",
        renderedContent: "",
        hasPendingTimer: false,
      }),
    ).toEqual({
      action: "flush_now",
      delayMs: null,
    });
  });

  it("已有 text render timer 时不应重复调度", () => {
    expect(
      buildAgentStreamTextRenderTimerSchedulePlan({
        accumulatedContent: "你好，继续",
        renderedContent: "你好",
        hasPendingTimer: true,
      }),
    ).toEqual({
      action: "skip",
      delayMs: null,
    });
  });

  it("非首个可见文本且无 pending timer 时应调度低频 flush", () => {
    expect(
      buildAgentStreamTextRenderTimerSchedulePlan({
        accumulatedContent: "你好，继续",
        renderedContent: "你好",
        hasPendingTimer: false,
      }),
    ).toEqual({
      action: "schedule_timer",
      delayMs: AGENT_STREAM_TEXT_DELTA_RENDER_FLUSH_MS,
    });
  });

  it("queued draft cleanup 调度前应清理旧 timer，并只在当前请求仍需观察且流未激活时调度", () => {
    expect(
      buildAgentStreamQueuedDraftCleanupTimerSchedulePlan({
        shouldWatchCurrentRequest: false,
        streamActivated: false,
      }),
    ).toEqual({
      shouldClearExistingTimer: true,
      shouldScheduleTimer: false,
      delayMs: null,
    });

    expect(
      buildAgentStreamQueuedDraftCleanupTimerSchedulePlan({
        shouldWatchCurrentRequest: true,
        streamActivated: true,
      }),
    ).toEqual({
      shouldClearExistingTimer: true,
      shouldScheduleTimer: false,
      delayMs: null,
    });

    expect(
      buildAgentStreamQueuedDraftCleanupTimerSchedulePlan({
        shouldWatchCurrentRequest: true,
        streamActivated: false,
      }),
    ).toEqual({
      shouldClearExistingTimer: true,
      shouldScheduleTimer: true,
      delayMs: AGENT_STREAM_QUEUED_DRAFT_CLEANUP_GRACE_MS,
    });
  });

  it("queued draft cleanup timer 触发时应跳过已完成或已激活的请求", () => {
    expect(
      buildAgentStreamQueuedDraftCleanupTimerFirePlan({
        requestFinished: true,
        streamActivated: false,
      }),
    ).toEqual({ shouldCleanup: false });

    expect(
      buildAgentStreamQueuedDraftCleanupTimerFirePlan({
        requestFinished: false,
        streamActivated: true,
      }),
    ).toEqual({ shouldCleanup: false });

    expect(
      buildAgentStreamQueuedDraftCleanupTimerFirePlan({
        requestFinished: false,
        streamActivated: false,
      }),
    ).toEqual({ shouldCleanup: true });
  });
});
