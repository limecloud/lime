import { describe, expect, it } from "vitest";
import { shouldShowChatLayout } from "./chatLayoutVisibility";

describe("chatLayoutVisibility", () => {
  it("首条消息还在准备发送时也应直接进入会话布局", () => {
    expect(
      shouldShowChatLayout({
        agentEntry: "new-task",
        hasDisplayMessages: false,
        hasPendingA2UIForm: false,
        isThemeWorkbench: false,
        hasUnconsumedInitialDispatch: false,
        isPreparingSend: true,
        isSending: false,
        queuedTurnCount: 0,
      }),
    ).toBe(true);
  });

  it("旧会话恢复 pending shell 阶段也应进入会话布局", () => {
    expect(
      shouldShowChatLayout({
        agentEntry: "new-task",
        hasDisplayMessages: false,
        hasPendingA2UIForm: false,
        isThemeWorkbench: false,
        hasUnconsumedInitialDispatch: false,
        isPreparingSend: false,
        isSending: false,
        isSessionHydrating: true,
        queuedTurnCount: 0,
      }),
    ).toBe(true);
  });

  it("空白首页在无会话活动时仍应保留空态布局", () => {
    expect(
      shouldShowChatLayout({
        agentEntry: "new-task",
        hasDisplayMessages: false,
        hasPendingA2UIForm: false,
        isThemeWorkbench: false,
        hasUnconsumedInitialDispatch: false,
        isPreparingSend: false,
        isSending: false,
        queuedTurnCount: 0,
      }),
    ).toBe(false);
  });

  it("任务中心新建空标签可内嵌首页空态", () => {
    expect(
      shouldShowChatLayout({
        agentEntry: "claw",
        preferEmptyStateForFreshTaskCenterTab: true,
        hasDisplayMessages: false,
        hasPendingA2UIForm: false,
        isThemeWorkbench: false,
        hasUnconsumedInitialDispatch: false,
        isPreparingSend: false,
        isSending: false,
        queuedTurnCount: 0,
      }),
    ).toBe(false);
  });

  it("任务中心新建空标签有会话活动时仍应进入对话布局", () => {
    expect(
      shouldShowChatLayout({
        agentEntry: "claw",
        preferEmptyStateForFreshTaskCenterTab: true,
        hasDisplayMessages: true,
        hasPendingA2UIForm: false,
        isThemeWorkbench: false,
        hasUnconsumedInitialDispatch: false,
        isPreparingSend: false,
        isSending: false,
        queuedTurnCount: 0,
      }),
    ).toBe(true);
  });

  it("任务中心切换历史会话的恢复阶段不应显示最近对话空态", () => {
    expect(
      shouldShowChatLayout({
        agentEntry: "claw",
        preferEmptyStateForFreshTaskCenterTab: true,
        hasDisplayMessages: false,
        hasPendingA2UIForm: false,
        isThemeWorkbench: false,
        hasUnconsumedInitialDispatch: false,
        isPreparingSend: false,
        isSending: false,
        isSessionHydrating: true,
        queuedTurnCount: 0,
      }),
    ).toBe(true);
  });
});
