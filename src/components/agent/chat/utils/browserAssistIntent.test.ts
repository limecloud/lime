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

  it("普通页面跳转描述不应误触发浏览器协助", () => {
    expect(
      hasBrowserAssistIntent("首页输入后进入对话页很慢，请给出修复方案"),
    ).toBe(false);
    expect(
      shouldAutoOpenBrowserAssistForPrompt(
        "首页输入后进入对话页很慢，请给出修复方案",
      ),
    ).toBe(false);
  });

  it("把 Browser Assist 当回归项描述时不应触发浏览器协助", () => {
    const prompt =
      "请生成 Browser Assist 禁用回归、DevBridge 超时策略和发布门禁。";

    expect(hasBrowserAssistIntent(prompt)).toBe(false);
    expect(shouldAutoOpenBrowserAssistForPrompt(prompt)).toBe(false);
  });

  it("否定打开浏览器协助时不应触发预热", () => {
    const prompt = "不打开浏览器协助，只在对话内输出修复方案。";

    expect(hasBrowserAssistIntent(prompt)).toBe(false);
    expect(shouldAutoOpenBrowserAssistForPrompt(prompt)).toBe(false);
  });

  it("只有链接总结诉求但没有浏览器意图时不应自动占用浏览器画布", () => {
    expect(
      shouldAutoOpenBrowserAssistForPrompt(
        "帮我总结 https://example.com 的内容",
      ),
    ).toBe(false);
  });
});
