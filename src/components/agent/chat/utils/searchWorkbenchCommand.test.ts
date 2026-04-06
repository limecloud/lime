import { describe, expect, it } from "vitest";
import { parseSearchWorkbenchCommand } from "./searchWorkbenchCommand";

describe("parseSearchWorkbenchCommand", () => {
  it("应解析带显式字段的 @搜索 命令", () => {
    const result = parseSearchWorkbenchCommand(
      "@搜索 关键词:AI Agent 融资 站点:36Kr 时间:近30天 深度:深度 重点:融资额与产品发布 输出:要点",
    );

    expect(result).toMatchObject({
      trigger: "@搜索",
      query: "AI Agent 融资",
      site: "36Kr",
      timeRange: "近30天",
      depth: "deep",
      focus: "融资额与产品发布",
      outputFormat: "要点",
      prompt: "AI Agent 融资 36Kr 近30天 融资额与产品发布",
    });
  });

  it("应兼容自然语句里的站点与时间范围", () => {
    const result = parseSearchWorkbenchCommand(
      "@搜索 GitHub 最近一周 openai agents sdk issue 讨论",
    );

    expect(result).toMatchObject({
      trigger: "@搜索",
      site: "GitHub",
      timeRange: "最近一周",
      query: "openai agents sdk issue 讨论",
      prompt: "openai agents sdk issue 讨论",
    });
  });

  it("应兼容 @research 英文触发", () => {
    const result = parseSearchWorkbenchCommand(
      "@research query: openai agents sdk updates site: GitHub depth: quick",
    );

    expect(result).toMatchObject({
      trigger: "@research",
      query: "openai agents sdk updates",
      site: "GitHub",
      depth: "quick",
      prompt: "openai agents sdk updates GitHub",
    });
  });

  it("非搜索命令应返回空", () => {
    expect(parseSearchWorkbenchCommand("@视频 做一条新品视频")).toBeNull();
  });
});
