import { describe, expect, it } from "vitest";
import { parseDeepSearchWorkbenchCommand } from "./deepSearchWorkbenchCommand";

describe("parseDeepSearchWorkbenchCommand", () => {
  it("应解析带显式字段的 @深搜 命令，并强制深度为 deep", () => {
    const result = parseDeepSearchWorkbenchCommand(
      "@深搜 关键词:AI Agent 融资 站点:36Kr 时间:近30天 重点:融资额与产品发布 输出:对比表",
    );

    expect(result).toMatchObject({
      trigger: "@深搜",
      query: "AI Agent 融资",
      site: "36Kr",
      timeRange: "近30天",
      depth: "deep",
      focus: "融资额与产品发布",
      outputFormat: "对比表",
      prompt: "AI Agent 融资 36Kr 近30天 融资额与产品发布",
    });
  });

  it("应兼容自然语句里的站点与时间范围", () => {
    const result = parseDeepSearchWorkbenchCommand(
      "@深搜 GitHub 最近一周 openai agents sdk issue 讨论",
    );

    expect(result).toMatchObject({
      trigger: "@深搜",
      site: "GitHub",
      timeRange: "最近一周",
      query: "openai agents sdk issue 讨论",
      depth: "deep",
      prompt: "openai agents sdk issue 讨论",
    });
  });

  it("应兼容英文触发词", () => {
    const result = parseDeepSearchWorkbenchCommand(
      "@deepsearch query: openai agents sdk updates site: GitHub depth: quick",
    );

    expect(result).toMatchObject({
      trigger: "@deepsearch",
      query: "openai agents sdk updates",
      site: "GitHub",
      depth: "deep",
      prompt: "openai agents sdk updates GitHub",
    });
  });

  it("应兼容 @Researchers Pro，并继续走深搜主链", () => {
    const result = parseDeepSearchWorkbenchCommand(
      "@Researchers Pro GitHub 最近一周 openai agents sdk issue 讨论",
    );

    expect(result).toMatchObject({
      trigger: "@Researchers Pro",
      site: "GitHub",
      timeRange: "最近一周",
      query: "openai agents sdk issue 讨论",
      depth: "deep",
      prompt: "openai agents sdk issue 讨论",
    });
  });

  it("非深搜命令应返回空", () => {
    expect(parseDeepSearchWorkbenchCommand("@搜索 AI Agent 融资")).toBeNull();
  });
});
