import { describe, expect, it } from "vitest";
import { parseAnalysisWorkbenchCommand } from "./analysisWorkbenchCommand";

describe("parseAnalysisWorkbenchCommand", () => {
  it("应解析带显式字段的 @分析 命令", () => {
    const result = parseAnalysisWorkbenchCommand(
      "@分析 内容:OpenAI 发布新模型 重点:商业影响 风格:投资备忘 输出:三点判断",
    );

    expect(result).toMatchObject({
      trigger: "@分析",
      content: "OpenAI 发布新模型",
      focus: "商业影响",
      style: "投资备忘",
      outputFormat: "三点判断",
      prompt: "OpenAI 发布新模型 围绕商业影响 投资备忘 三点判断",
    });
  });

  it("应兼容自然语句输入", () => {
    const result = parseAnalysisWorkbenchCommand(
      "@分析 帮我判断上面的方案有哪些关键风险",
    );

    expect(result).toMatchObject({
      trigger: "@分析",
      prompt: "帮我判断上面的方案有哪些关键风险",
    });
  });

  it("应兼容英文触发词", () => {
    const result = parseAnalysisWorkbenchCommand(
      "@analyze content: openai agents sdk focus: breaking changes output: bullet points",
    );

    expect(result).toMatchObject({
      trigger: "@analyze",
      content: "openai agents sdk",
      focus: "breaking changes",
      outputFormat: "bullet points",
    });
  });

  it("非分析命令应返回空", () => {
    expect(parseAnalysisWorkbenchCommand("@总结 OpenAI 发布新模型")).toBeNull();
  });
});
