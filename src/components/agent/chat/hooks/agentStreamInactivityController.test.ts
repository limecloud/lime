import { describe, expect, it } from "vitest";
import {
  AGENT_STREAM_FIRST_EVENT_TIMEOUT_MESSAGE,
  AGENT_STREAM_INACTIVITY_TIMEOUT_MESSAGE,
  buildAgentStreamFirstEventDeferredWarning,
  buildAgentStreamFirstEventSilentRecoveryWarning,
  buildAgentStreamInactivitySilentRecoveryWarning,
  resolveAgentStreamFirstEventTimeoutAction,
  resolveAgentStreamInactivityTimeoutAction,
} from "./agentStreamInactivityController";

describe("agentStreamInactivityController", () => {
  it("应导出首包与 inactivity timeout 的用户文案", () => {
    expect(AGENT_STREAM_FIRST_EVENT_TIMEOUT_MESSAGE).toContain(
      "未返回任何进度事件",
    );
    expect(AGENT_STREAM_INACTIVITY_TIMEOUT_MESSAGE).toContain(
      "长时间没有返回新进度",
    );
  });

  it("应构造 silent recovery 与 deferred warning 文案", () => {
    expect(
      buildAgentStreamFirstEventSilentRecoveryWarning({
        eventName: "event-a",
      }),
    ).toBe(
      "[AsterChat] 首个运行时事件静默，已降级切换为会话快照同步: event-a",
    );
    expect(
      buildAgentStreamFirstEventDeferredWarning({
        eventName: "event-a",
      }),
    ).toBe(
      "[AsterChat] 首个运行时事件暂未到达，已基于提交派发继续等待后续进度: event-a",
    );
    expect(
      buildAgentStreamInactivitySilentRecoveryWarning({
        eventName: "event-a",
      }),
    ).toBe(
      "[AsterChat] 运行时事件静默，已降级切换为会话快照同步: event-a",
    );
  });

  it("应按首包超时状态选择恢复动作", () => {
    expect(
      resolveAgentStreamFirstEventTimeoutAction({
        canDeferAfterSubmission: true,
        firstEventReceived: true,
        recovered: true,
        requestFinished: false,
      }),
    ).toBe("ignore");
    expect(
      resolveAgentStreamFirstEventTimeoutAction({
        canDeferAfterSubmission: true,
        firstEventReceived: false,
        recovered: true,
        requestFinished: false,
      }),
    ).toBe("recover");
    expect(
      resolveAgentStreamFirstEventTimeoutAction({
        canDeferAfterSubmission: true,
        firstEventReceived: false,
        recovered: false,
        requestFinished: false,
      }),
    ).toBe("defer");
    expect(
      resolveAgentStreamFirstEventTimeoutAction({
        canDeferAfterSubmission: false,
        firstEventReceived: false,
        recovered: false,
        requestFinished: false,
      }),
    ).toBe("fail");
  });

  it("应按 inactivity timeout 状态选择恢复动作", () => {
    expect(
      resolveAgentStreamInactivityTimeoutAction({
        recovered: true,
        shouldIgnore: true,
      }),
    ).toBe("ignore");
    expect(
      resolveAgentStreamInactivityTimeoutAction({
        recovered: true,
        shouldIgnore: false,
      }),
    ).toBe("recover");
    expect(
      resolveAgentStreamInactivityTimeoutAction({
        recovered: false,
        shouldIgnore: false,
      }),
    ).toBe("fail");
  });
});
