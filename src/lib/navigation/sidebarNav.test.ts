import { describe, expect, it } from "vitest";
import {
  FOOTER_SIDEBAR_NAV_ITEMS,
  MAIN_SIDEBAR_NAV_ITEMS,
  resolveEnabledSidebarNavItems,
} from "./sidebarNav";

describe("sidebarNav", () => {
  it("应把主导航与底部系统入口收口为一级列表", () => {
    expect(MAIN_SIDEBAR_NAV_ITEMS.map((item) => item.label)).toEqual([
      "新建任务",
      "我的方法",
      "灵感库",
      "知识库",
    ]);

    expect(FOOTER_SIDEBAR_NAV_ITEMS.map((item) => item.label)).toEqual([
      "设置",
      "持续流程",
      "消息渠道",
      "插件中心",
      "OpenClaw",
      "桌宠",
    ]);
  });

  it("恢复导航设置时应过滤固定系统入口，只保留显式开启的可选系统项", () => {
    expect(
      resolveEnabledSidebarNavItems([
        "video",
        "image-gen",
        "terminal",
        "tools",
        "home-general",
        "automation",
        "channels",
        "plugins",
        "openclaw",
        "companion",
      ]),
    ).toEqual(["plugins", "openclaw", "companion"]);
  });

  it("没有显式设置时不应默认恢复任何可选入口", () => {
    expect(resolveEnabledSidebarNavItems()).toEqual([]);
    expect(resolveEnabledSidebarNavItems(["skills", "resources"])).toEqual([]);
  });
});
