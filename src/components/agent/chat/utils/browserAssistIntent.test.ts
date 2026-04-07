import { describe, expect, it } from "vitest";

import {
  extractExplicitUrlFromText,
  hasBrowserAssistIntent,
  resolveBrowserAssistLaunchUrl,
  shouldAutoOpenBrowserAssistForPrompt,
} from "./browserAssistIntent";

describe("browserAssistIntent", () => {
  it("应从自然语言提示中提取显式 URL", () => {
    expect(
      extractExplicitUrlFromText(
        "打开 https://news.baidu.com，使用浏览器协助模式执行。",
      ),
    ).toBe("https://news.baidu.com");
  });

  it("应识别不带协议头的域名并补全 https", () => {
    expect(extractExplicitUrlFromText("请访问 news.baidu.com/top")).toBe(
      "https://news.baidu.com/top",
    );
  });

  it("没有显式 URL 时应回退为 Google 搜索地址", () => {
    expect(resolveBrowserAssistLaunchUrl("今天的 AI 行业新闻")).toBe(
      "https://www.google.com/search?q=%E4%BB%8A%E5%A4%A9%E7%9A%84%20AI%20%E8%A1%8C%E4%B8%9A%E6%96%B0%E9%97%BB",
    );
  });

  it("显式 URL + 浏览器指令时应自动走浏览器协助", () => {
    expect(
      shouldAutoOpenBrowserAssistForPrompt(
        "打开 https://news.baidu.com，使用浏览器协助模式执行，并显示实时画面。",
      ),
    ).toBe(true);
  });

  it("显式 URL + 打开动作时也应视为浏览器导航意图", () => {
    expect(
      shouldAutoOpenBrowserAssistForPrompt("打开 https://example.com"),
    ).toBe(true);
    expect(hasBrowserAssistIntent("打开 https://example.com")).toBe(true);
  });

  it("只有链接总结诉求但没有浏览器意图时不应自动占用浏览器画布", () => {
    expect(
      shouldAutoOpenBrowserAssistForPrompt(
        "帮我总结 https://example.com 的内容",
      ),
    ).toBe(false);
  });
});
