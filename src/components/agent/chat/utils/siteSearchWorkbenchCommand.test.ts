import { describe, expect, it } from "vitest";
import { parseSiteSearchWorkbenchCommand } from "./siteSearchWorkbenchCommand";

describe("parseSiteSearchWorkbenchCommand", () => {
  it("应解析带显式字段的 @站点搜索 命令", () => {
    const result = parseSiteSearchWorkbenchCommand(
      "@站点搜索 站点:GitHub 关键词:openai agents sdk issue 数量:8",
    );

    expect(result).toMatchObject({
      trigger: "@站点搜索",
      site: "GitHub",
      query: "openai agents sdk issue",
      limit: 8,
      prompt: "openai agents sdk issue",
    });
  });

  it("应解析自然语句里的站点和数量", () => {
    const result = parseSiteSearchWorkbenchCommand(
      "@站点 B站 AI Agent 教程 6条",
    );

    expect(result).toMatchObject({
      trigger: "@站点",
      site: "B站",
      query: "AI Agent 教程",
      limit: 6,
      prompt: "AI Agent 教程",
    });
  });

  it("应兼容 @site 英文触发", () => {
    const result = parseSiteSearchWorkbenchCommand(
      "@site source: Yahoo Finance query: tsla latest earnings limit: 5",
    );

    expect(result).toMatchObject({
      trigger: "@site",
      site: "Yahoo Finance",
      query: "tsla latest earnings",
      limit: 5,
      prompt: "tsla latest earnings",
    });
  });

  it("非站点命令应返回空", () => {
    expect(parseSiteSearchWorkbenchCommand("@搜索 AI Agent 融资")).toBeNull();
  });
});
