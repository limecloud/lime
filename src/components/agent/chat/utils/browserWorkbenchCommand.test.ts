import { describe, expect, it } from "vitest";

import { parseBrowserWorkbenchCommand } from "./browserWorkbenchCommand";

describe("parseBrowserWorkbenchCommand", () => {
  it("应解析显式网址的 @浏览器 命令", () => {
    const result = parseBrowserWorkbenchCommand(
      "@浏览器 打开 https://news.baidu.com 并提炼页面主要内容",
    );

    expect(result).toMatchObject({
      trigger: "@浏览器",
      body: "打开 https://news.baidu.com 并提炼页面主要内容",
      prompt: "https://news.baidu.com 并提炼页面主要内容",
      explicitUrl: "https://news.baidu.com",
      launchUrl: "https://news.baidu.com",
      browserRequirement: "required",
    });
  });

  it("后台操作应沿用 required_with_user_step", () => {
    const result = parseBrowserWorkbenchCommand(
      "@浏览器 去微信公众号后台发布这篇文章",
    );

    expect(result).toMatchObject({
      browserRequirement: "required_with_user_step",
      launchUrl: "https://mp.weixin.qq.com/",
    });
  });

  it("英文别名应可用", () => {
    const result = parseBrowserWorkbenchCommand(
      "@browser open github.com/openai/codex and summarize the repo",
    );

    expect(result).toMatchObject({
      trigger: "@browser",
      explicitUrl: "https://github.com/openai/codex",
      launchUrl: "https://github.com/openai/codex",
    });
  });

  it("应兼容 Ribbi 风格的 @Browser Agent 命令", () => {
    const result = parseBrowserWorkbenchCommand(
      "@Browser Agent open openai.com/pricing and compare plans",
    );

    expect(result).toMatchObject({
      trigger: "@Browser Agent",
      launchUrl: "https://openai.com/pricing",
    });
  });

  it("应把 Mini Tester / Web Scheduler / Web Manage 收到同一条浏览器执行主链", () => {
    const testerResult = parseBrowserWorkbenchCommand(
      "@Mini Tester open https://example.com and verify the CTA flow",
    );
    const schedulerResult = parseBrowserWorkbenchCommand(
      "@Web Scheduler 打开 https://calendar.google.com 并安排明早 9 点回访提醒",
    );
    const manageResult = parseBrowserWorkbenchCommand(
      "@Web Manage open https://notion.so and update the launch checklist",
    );

    expect(testerResult).toMatchObject({
      trigger: "@Mini Tester",
      launchUrl: "https://example.com",
    });
    expect(schedulerResult).toMatchObject({
      trigger: "@Web Scheduler",
      launchUrl: "https://calendar.google.com",
      browserRequirement: "required",
    });
    expect(manageResult).toMatchObject({
      trigger: "@Web Manage",
      launchUrl: "https://notion.so",
    });
  });

  it("不应误识别其他命令", () => {
    expect(parseBrowserWorkbenchCommand("@搜索 OpenAI 最新融资")).toBeNull();
  });
});
