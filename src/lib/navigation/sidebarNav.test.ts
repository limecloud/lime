import { describe, expect, it } from "vitest";
import {
  FOOTER_SIDEBAR_NAV_SECTIONS,
  MAIN_SIDEBAR_NAV_SECTIONS,
  resolveEnabledSidebarNavItems,
} from "./sidebarNav";

describe("sidebarNav", () => {
  it("应按任务、能力、资料、系统四组收口当前导航", () => {
    expect(
      MAIN_SIDEBAR_NAV_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        items: section.items.map((item) => item.label),
      })),
    ).toEqual([
      {
        id: "tasks",
        title: "任务",
        items: ["新建任务", "生成"],
      },
      {
        id: "capabilities",
        title: "能力",
        items: ["我的方法", "创作场景", "持续流程", "消息渠道"],
      },
      {
        id: "knowledge",
        title: "资料",
        items: ["资料库", "灵感库"],
      },
    ]);

    expect(
      FOOTER_SIDEBAR_NAV_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        items: section.items.map((item) => item.label),
      })),
    ).toEqual([
      {
        id: "system",
        title: "系统",
        items: ["设置", "插件中心", "OpenClaw", "桌宠"],
      },
    ]);
  });

  it("恢复导航设置时应过滤旧入口，只保留显式开启的隐藏系统项", () => {
    expect(
      resolveEnabledSidebarNavItems([
        "video",
        "image-gen",
        "terminal",
        "tools",
        "home-general",
        "plugins",
        "openclaw",
        "companion",
      ]),
    ).toEqual(["plugins", "openclaw", "companion"]);
  });

  it("没有显式设置时不应默认恢复任何隐藏入口", () => {
    expect(resolveEnabledSidebarNavItems()).toEqual([]);
    expect(resolveEnabledSidebarNavItems(["skills", "resources"])).toEqual([]);
  });
});
