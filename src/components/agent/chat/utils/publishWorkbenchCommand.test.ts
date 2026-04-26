import { describe, expect, it } from "vitest";
import { parsePublishWorkbenchCommand } from "./publishWorkbenchCommand";

describe("parsePublishWorkbenchCommand", () => {
  it("应解析带显式平台的 @发布 命令", () => {
    const result = parsePublishWorkbenchCommand(
      "@发布 平台:微信公众号后台 帮我把这篇文章整理成可直接发布的版本",
    );

    expect(result).toMatchObject({
      trigger: "@发布",
      platformType: "wechat_official_account",
      platformLabel: "微信公众号后台",
      prompt: "帮我把这篇文章整理成可直接发布的版本",
    });
  });

  it("应兼容英文触发与英文平台名", () => {
    const result = parsePublishWorkbenchCommand(
      "@publish xiaohongshu turn this draft into a ready-to-post version",
    );

    expect(result).toMatchObject({
      trigger: "@publish",
      platformType: "xiaohongshu",
      platformLabel: "小红书",
      prompt: "turn this draft into a ready-to-post version",
    });
  });

  it("应把平台型 Publish trigger 映射到默认平台", () => {
    const result = parsePublishWorkbenchCommand(
      "@YouTube Publish refine this launch draft into a ready-to-post script",
    );

    expect(result).toMatchObject({
      trigger: "@YouTube Publish",
      platformType: "youtube",
      platformLabel: "YouTube",
      prompt: "refine this launch draft into a ready-to-post script",
    });
  });

  it("应把 Twitter Publish 归一到 X / Twitter 平台", () => {
    const result = parsePublishWorkbenchCommand(
      "@Twitter Publish turn this draft into a post thread package",
    );

    expect(result).toMatchObject({
      trigger: "@Twitter Publish",
      platformType: "x",
      platformLabel: "X / Twitter",
      prompt: "turn this draft into a post thread package",
    });
  });

  it("没有显式平台时也应保留发布意图", () => {
    const result = parsePublishWorkbenchCommand(
      "@发文 请帮我整理这篇稿子，并给出发布前检查清单",
    );

    expect(result).toMatchObject({
      trigger: "@发文",
      platformType: undefined,
      prompt: "请帮我整理这篇稿子，并给出发布前检查清单",
    });
  });

  it("非发布命令应返回空", () => {
    expect(parsePublishWorkbenchCommand("@表单 做个报名表")).toBeNull();
  });
});
