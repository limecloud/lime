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

  it("缺少链接时也应保留解析意图，交给 Agent 继续追问", () => {
    const result = parseUrlParseWorkbenchCommand("@链接 帮我提炼这篇网页的核心观点");

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
