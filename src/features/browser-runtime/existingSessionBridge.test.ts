import { describe, expect, it } from "vitest";
import {
  getExistingSessionTabLabel,
  parseExistingSessionPageInfo,
  parseExistingSessionTabs,
  shouldReplaceExistingSessionPageInfo,
} from "./existingSessionBridge";

describe("existingSessionBridge", () => {
  it("应解析并排序桥接返回的标签页列表", () => {
    const tabs = parseExistingSessionTabs({
      data: {
        tabs: [
          {
            id: 202,
            index: 1,
            title: "创作页",
            url: "https://weibo.com/compose",
            active: false,
          },
          {
            id: 101,
            index: 0,
            title: "首页",
            url: "https://weibo.com/home",
            active: true,
          },
        ],
      },
    });

    expect(tabs.map((tab) => tab.id)).toEqual(["101", "202"]);
    expect(getExistingSessionTabLabel(tabs[0])).toBe("首页");
  });

  it("应从嵌套 data.page_info 中解析页面摘要", () => {
    expect(
      parseExistingSessionPageInfo({
        data: {
          page_info: {
            title: "微博创作中心",
            url: "https://weibo.com/compose",
            markdown: "# 微博创作中心",
            updated_at: "2026-03-16T10:00:00Z",
          },
        },
      }),
    ).toEqual({
      title: "微博创作中心",
      url: "https://weibo.com/compose",
      markdown: "# 微博创作中心",
      updated_at: "2026-03-16T10:00:00Z",
    });
  });

  it("应保留更新时间更近的页面摘要", () => {
    const current = {
      title: "切换后页面",
      url: "https://weibo.com/compose",
      markdown: "# 切换后页面",
      updated_at: "2026-03-16T10:00:08Z",
    };
    const stale = {
      title: "过期页面",
      url: "https://weibo.com/home",
      markdown: "# 过期页面",
      updated_at: "2026-03-16T10:00:06Z",
    };

    expect(shouldReplaceExistingSessionPageInfo(current, stale)).toBe(false);
  });
});
