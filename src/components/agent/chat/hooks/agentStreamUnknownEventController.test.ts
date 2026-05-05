import { describe, expect, it } from "vitest";
import {
  buildAgentStreamUnknownEventWarningMessage,
  rememberAgentStreamUnknownEventWarning,
  resolveAgentStreamUnknownEventPlan,
} from "./agentStreamUnknownEventController";

describe("agentStreamUnknownEventController", () => {
  it("应构造未知 runtime event 告警文案", () => {
    expect(
      buildAgentStreamUnknownEventWarningMessage({
        eventName: "event-a",
        eventType: "runtime_projection_bootstrap",
      }),
    ).toBe(
      "[AsterChat] 收到未识别的运行时事件，已保留流活跃态: event-a · runtime_projection_bootstrap",
    );
  });

  it("无 event type 时不应生成处理计划", () => {
    expect(
      resolveAgentStreamUnknownEventPlan({
        eventName: "event-a",
        eventType: null,
        warnedEventTypes: new Set(),
      }),
    ).toBeNull();
  });

  it("首次未知 event 应生成告警计划，重复 event 应去重", () => {
    expect(
      resolveAgentStreamUnknownEventPlan({
        eventName: "event-a",
        eventType: "runtime_projection_bootstrap",
        warnedEventTypes: new Set(),
      }),
    ).toEqual({
      eventType: "runtime_projection_bootstrap",
      shouldWarn: true,
      warningMessage:
        "[AsterChat] 收到未识别的运行时事件，已保留流活跃态: event-a · runtime_projection_bootstrap",
    });

    expect(
      resolveAgentStreamUnknownEventPlan({
        eventName: "event-a",
        eventType: "runtime_projection_bootstrap",
        warnedEventTypes: new Set(["runtime_projection_bootstrap"]),
      }),
    ).toEqual({
      eventType: "runtime_projection_bootstrap",
      shouldWarn: false,
      warningMessage: null,
    });
  });

  it("应记录已告警未知 event type 并返回是否首次记录", () => {
    const warnedEventTypes = new Set<string>();

    expect(
      rememberAgentStreamUnknownEventWarning({
        eventType: "runtime_projection_bootstrap",
        warnedEventTypes,
      }),
    ).toBe(true);
    expect(warnedEventTypes.has("runtime_projection_bootstrap")).toBe(true);

    expect(
      rememberAgentStreamUnknownEventWarning({
        eventType: "runtime_projection_bootstrap",
        warnedEventTypes,
      }),
    ).toBe(false);
  });
});
