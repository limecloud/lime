import { describe, expect, it } from "vitest";
import { getAppShellLayoutState } from "./useAppShellLayout";

describe("getAppShellLayoutState", () => {
  it("agent 沉浸态应隐藏 sidebar 与主区间距", () => {
    expect(
      getAppShellLayoutState({
        currentPage: "agent",
        pageParams: {
          immersiveHome: true,
        },
        agentHasMessages: false,
      }),
    ).toEqual({
      shouldHideSidebarForAgent: true,
      shouldShowAppSidebar: false,
      shouldAddMainContentGap: false,
    });
  });

  it("agent 锁主题且已有消息时应隐藏 sidebar", () => {
    expect(
      getAppShellLayoutState({
        currentPage: "agent",
        pageParams: {
          lockTheme: true,
        },
        agentHasMessages: true,
      }),
    ).toEqual({
      shouldHideSidebarForAgent: true,
      shouldShowAppSidebar: false,
      shouldAddMainContentGap: false,
    });
  });

  it("普通 agent 页应显示 sidebar 且保留间距", () => {
    expect(
      getAppShellLayoutState({
        currentPage: "agent",
        pageParams: {},
        agentHasMessages: false,
      }),
    ).toEqual({
      shouldHideSidebarForAgent: false,
      shouldShowAppSidebar: true,
      shouldAddMainContentGap: true,
    });
  });

  it("settings 页应隐藏 sidebar", () => {
    expect(
      getAppShellLayoutState({
        currentPage: "settings",
        pageParams: {},
        agentHasMessages: false,
      }),
    ).toEqual({
      shouldHideSidebarForAgent: false,
      shouldShowAppSidebar: false,
      shouldAddMainContentGap: false,
    });
  });

  it("memory 页应显示 sidebar 且不追加 agent 间距", () => {
    expect(
      getAppShellLayoutState({
        currentPage: "memory",
        pageParams: {},
        agentHasMessages: false,
      }),
    ).toEqual({
      shouldHideSidebarForAgent: false,
      shouldShowAppSidebar: true,
      shouldAddMainContentGap: false,
    });
  });

  it("skills 页应显示 sidebar 且不追加 agent 间距", () => {
    expect(
      getAppShellLayoutState({
        currentPage: "skills",
        pageParams: {},
        agentHasMessages: false,
      }),
    ).toEqual({
      shouldHideSidebarForAgent: false,
      shouldShowAppSidebar: true,
      shouldAddMainContentGap: false,
    });
  });
});
