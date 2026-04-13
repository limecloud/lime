import { describe, expect, it } from "vitest";
import {
  FOOTER_SIDEBAR_NAV_SECTIONS,
  MAIN_SIDEBAR_NAV_SECTIONS,
  resolveEnabledSidebarNavItems,
} from "./sidebarNav";

describe("sidebarNav", () => {
  it("主导航不应再暴露独立插图、视频、终端或工具箱模块入口", () => {
    const workspaceSection = MAIN_SIDEBAR_NAV_SECTIONS.find(
      (section) => section.id === "workspace",
    );
    const systemSection = FOOTER_SIDEBAR_NAV_SECTIONS.find(
      (section) => section.id === "system",
    );

    expect(workspaceSection).toBeUndefined();
    expect(systemSection?.items.some((item) => item.id === "terminal")).toBe(
      false,
    );
    expect(systemSection?.items.some((item) => item.id === "tools")).toBe(
      false,
    );
  });

  it("已保存的 legacy 插图、视频、终端与工具箱导航项应在恢复时被过滤掉", () => {
    expect(
      resolveEnabledSidebarNavItems(["video", "image-gen", "terminal", "tools"]),
    ).toEqual([]);
  });
});
