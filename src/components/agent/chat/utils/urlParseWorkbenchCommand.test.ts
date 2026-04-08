import { describe, expect, it } from "vitest";
import { parseUrlParseWorkbenchCommand } from "./urlParseWorkbenchCommand";

describe("parseUrlParseWorkbenchCommand", () => {
  it("应解析带 URL 和要点目标的 @链接解析 命令", () => {
    const result = parseUrlParseWorkbenchCommand(
      "@链接解析 https://example.com/agent 提取要点 并整理成投资人可读摘要",
    );

    expect(result).toMatchObject({
      trigger: "@链接解析",
      url: "https://example.com/agent",
      extractGoal: "key_points",
      prompt: "并整理成投资人可读摘要",
    });
  });

  it("应兼容 @url 英文触发与全文目标", () => {
    const result = parseUrlParseWorkbenchCommand(
      "@url https://example.com/post parse full text for citation",
    );

    expect(result).toMatchObject({
      trigger: "@url",
      url: "https://example.com/post",
      extractGoal: "full_text",
      prompt: "for citation",
    });
  });

  it("应把 @抓取 识别为抓取型链接命令，并默认提取正文", () => {
    const result = parseUrlParseWorkbenchCommand(
      "@抓取 https://example.com/post 帮我抓正文并整理成素材库摘要",
    );

    expect(result).toMatchObject({
      trigger: "@抓取",
      url: "https://example.com/post",
      extractGoal: "full_text",
      prompt: "帮我抓正文并整理成素材库摘要",
    });
  });

  it("应把 @网页读取 识别为页面阅读命令，并默认输出摘要", () => {
    const result = parseUrlParseWorkbenchCommand(
      "@网页读取 https://example.com/post 帮我读这篇文章并告诉我核心结论",
    );

    expect(result).toMatchObject({
      trigger: "@网页读取",
      url: "https://example.com/post",
      extractGoal: "summary",
      prompt: "帮我读这篇文章并告诉我核心结论",
    });
  });

  it("应解析显式字段写法，并保留结构化提取目标与要求", () => {
    const result = parseUrlParseWorkbenchCommand(
      "@链接解析 链接:https://example.com/post 提取:引用 要求:整理成三条适合发朋友圈的句子",
    );

    expect(result).toMatchObject({
      trigger: "@链接解析",
      url: "https://example.com/post",
      extractGoal: "quotes",
      prompt: "整理成三条适合发朋友圈的句子",
    });
  });

  it("缺少链接时也应保留解析意图，交给 Agent 继续追问", () => {
    const result =
      parseUrlParseWorkbenchCommand("@链接 帮我提炼这篇网页的核心观点");

    expect(result).toMatchObject({
      trigger: "@链接",
      url: undefined,
      prompt: "帮我提炼这篇网页的核心观点",
    });
  });

  it("非链接解析命令应返回空", () => {
    expect(parseUrlParseWorkbenchCommand("@视频 新品发布片")).toBeNull();
  });
});
