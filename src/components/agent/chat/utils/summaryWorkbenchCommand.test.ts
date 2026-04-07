import { describe, expect, it } from "vitest";
import { parseSummaryWorkbenchCommand } from "./summaryWorkbenchCommand";

describe("parseSummaryWorkbenchCommand", () => {
  it("应解析带显式字段的 @总结 命令", () => {
    const result = parseSummaryWorkbenchCommand(
      "@总结 内容:这是一篇关于 AI Agent 融资的长文 重点:融资额与发布时间 长度:简短 风格:投资人简报 输出:三点要点",
    );

    expect(result).toMatchObject({
      trigger: "@总结",
      content: "这是一篇关于 AI Agent 融资的长文",
      focus: "融资额与发布时间",
      length: "short",
      style: "投资人简报",
      outputFormat: "三点要点",
      prompt:
        "这是一篇关于 AI Agent 融资的长文 融资额与发布时间 short 投资人简报",
    });
  });

  it("应兼容自然语句输入", () => {
    const result = parseSummaryWorkbenchCommand(
      "@总结 帮我把上面的讨论整理成 3 条要点",
    );

    expect(result).toMatchObject({
      trigger: "@总结",
      prompt: "帮我把上面的讨论整理成 3 条要点",
    });
  });

  it("应兼容英文触发词", () => {
    const result = parseSummaryWorkbenchCommand(
      "@summarize content: openai agents sdk release notes focus: breaking changes length: long",
    );

    expect(result).toMatchObject({
      trigger: "@summarize",
      content: "openai agents sdk release notes",
      focus: "breaking changes",
      length: "long",
    });
  });

  it("非总结命令应返回空", () => {
    expect(parseSummaryWorkbenchCommand("@搜索 AI Agent 融资")).toBeNull();
  });
});
