import { describe, expect, it } from "vitest";
import { getAppShellLayoutState } from "./useAppShellLayout";

describe("getAppShellLayoutState", () => {
  it("agent 沉浸态应隐藏 sidebar ", () => {
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
    });
  });

  it("普通 agent 页应显示 sidebar ", () => {
    expect(
      getAppShellLayoutState({
        currentPage: "agent",
        pageParams: {},
        agentHasMessages: false,
      }),
    ).toEqual({
      shouldHideSidebarForAgent: false,
      shouldShowAppSidebar: true,
    });
  });

  it("settings 页应保留全局图标导航", () => {
    expect(
      getAppShellLayoutState({
        currentPage: "settings",
        pageParams: {},
        agentHasMessages: false,
      }),
    ).toEqual({
      shouldHideSidebarForAgent: false,
      shouldShowAppSidebar: true,
    });
  });

  it("skills 页应显示 sidebar ", () => {
    expect(
      getAppShellLayoutState({
        currentPage: "skills",
        pageParams: {},
        agentHasMessages: false,
      }),
    ).toEqual({
      shouldHideSidebarForAgent: false,
      shouldShowAppSidebar: true,
    });
  });

  it("experts 页应显示 sidebar ", () => {
    expect(
      getAppShellLayoutState({
        currentPage: "experts",
        pageParams: {},
        agentHasMessages: false,
      }),
    ).toEqual({
      shouldHideSidebarForAgent: false,
      shouldShowAppSidebar: true,
    });
  });
});
