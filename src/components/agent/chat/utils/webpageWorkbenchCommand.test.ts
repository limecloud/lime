import { describe, expect, it } from "vitest";
import { parseWebpageWorkbenchCommand } from "./webpageWorkbenchCommand";

describe("parseWebpageWorkbenchCommand", () => {
  it("应解析带页面类型、风格和技术约束的 @网页 命令", () => {
    const result = parseWebpageWorkbenchCommand(
      "@网页 类型:落地页 风格:未来感 技术:原生 HTML 帮我做一个 AI 代码助手官网",
    );

    expect(result).toMatchObject({
      trigger: "@网页",
      pageType: "landing_page",
      style: "未来感",
      techStack: "原生 HTML",
      prompt: "帮我做一个 AI 代码助手官网",
    });
  });

  it("应兼容 @webpage 英文触发", () => {
    const result = parseWebpageWorkbenchCommand(
      "@webpage landing page for an AI note app with calm editorial style",
    );

    expect(result).toMatchObject({
      trigger: "@webpage",
      pageType: "landing_page",
      prompt: "for an AI note app with calm editorial style",
    });
  });

  it("应兼容 Ribbi 风格的网页编排命令", () => {
    const composerResult = parseWebpageWorkbenchCommand(
      "@Web Composer campaign page for spring coffee launch",
    );
    const previewResult = parseWebpageWorkbenchCommand(
      "@HTML Preview docs page for agent runtime setup",
    );
    const styleResult = parseWebpageWorkbenchCommand(
      "@Web Style 类型:官网 风格:glassmorphism 帮我做一个 AI workspace 官网",
    );

    expect(composerResult).toMatchObject({
      trigger: "@Web Composer",
      pageType: "campaign_page",
    });
    expect(previewResult).toMatchObject({
      trigger: "@HTML Preview",
      pageType: "docs_page",
    });
    expect(styleResult).toMatchObject({
      trigger: "@Web Style",
      pageType: "homepage",
      style: "glassmorphism",
      prompt: "帮我做一个 AI workspace 官网",
    });
  });

  it("没有显式字段时也应保留网页生成意图", () => {
    const result = parseWebpageWorkbenchCommand(
      "@网页 帮我生成一个新品发布活动页，突出预约按钮和核心卖点",
    );

    expect(result).toMatchObject({
      trigger: "@网页",
      pageType: undefined,
      prompt: "帮我生成一个新品发布活动页，突出预约按钮和核心卖点",
    });
  });

  it("非网页命令应返回空", () => {
    expect(parseWebpageWorkbenchCommand("@排版 帮我整理这段文案")).toBeNull();
  });
});
