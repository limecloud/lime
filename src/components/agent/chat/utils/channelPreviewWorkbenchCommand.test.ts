import { describe, expect, it } from "vitest";
import { parseChannelPreviewWorkbenchCommand } from "./channelPreviewWorkbenchCommand";

describe("parseChannelPreviewWorkbenchCommand", () => {
  it("应解析带显式平台的 @渠道预览 命令", () => {
    const result = parseChannelPreviewWorkbenchCommand(
      "@渠道预览 平台:小红书 帮我预览这篇春日咖啡活动文案的首屏效果",
    );

    expect(result).toMatchObject({
      trigger: "@渠道预览",
      platformType: "xiaohongshu",
      platformLabel: "小红书",
      prompt: "帮我预览这篇春日咖啡活动文案的首屏效果",
    });
    expect(result?.dispatchBody).toContain("平台:小红书");
    expect(result?.dispatchBody).toContain("渠道预览稿");
  });

  it("应兼容英文触发与英文平台名", () => {
    const result = parseChannelPreviewWorkbenchCommand(
      "@preview Instagram preview this launch draft for the first screen card",
    );

    expect(result).toMatchObject({
      trigger: "@preview",
      platformType: "instagram",
      platformLabel: "Instagram",
      prompt: "preview this launch draft for the first screen card",
    });
  });

  it("应把平台型 Preview trigger 映射到默认平台", () => {
    const result = parseChannelPreviewWorkbenchCommand(
      "@Instagram Preview turn this launch brief into a first-screen draft",
    );

    expect(result).toMatchObject({
      trigger: "@Instagram Preview",
      platformType: "instagram",
      platformLabel: "Instagram",
      prompt: "turn this launch brief into a first-screen draft",
    });
  });

  it("应把 Twitter Preview 归一到 X / Twitter 平台", () => {
    const result = parseChannelPreviewWorkbenchCommand(
      "@Twitter Preview turn this thread into a channel preview draft",
    );

    expect(result).toMatchObject({
      trigger: "@Twitter Preview",
      platformType: "x",
      platformLabel: "X / Twitter",
      prompt: "turn this thread into a channel preview draft",
    });
  });

  it("没有显式平台时也应保留渠道预览意图", () => {
    const result = parseChannelPreviewWorkbenchCommand(
      "@预览 帮我先看一下这篇稿子的封面和开头排版节奏",
    );

    expect(result).toMatchObject({
      trigger: "@预览",
      platformType: undefined,
      prompt: "帮我先看一下这篇稿子的封面和开头排版节奏",
    });
    expect(result?.dispatchBody).toContain("渠道预览稿");
  });

  it("非渠道预览命令应返回空", () => {
    expect(
      parseChannelPreviewWorkbenchCommand("@发布 帮我发到小红书"),
    ).toBeNull();
  });
});
