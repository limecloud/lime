import { describe, expect, it } from "vitest";
import { parseReportWorkbenchCommand } from "./reportWorkbenchCommand";

describe("parseReportWorkbenchCommand", () => {
  it("应解析带显式字段的 @研报 命令", () => {
    const result = parseReportWorkbenchCommand(
      "@研报 关键词:AI Agent 融资 站点:36Kr 时间:近30天 重点:融资额与代表产品 输出:投资人研报",
    );

    expect(result).toMatchObject({
      trigger: "@研报",
      query: "AI Agent 融资",
      site: "36Kr",
      timeRange: "近30天",
      focus: "融资额与代表产品",
      outputFormat: "投资人研报",
      prompt: "AI Agent 融资 36Kr 近30天 融资额与代表产品 投资人研报",
    });
  });

  it("应兼容自然语句输入", () => {
    const result = parseReportWorkbenchCommand(
      "@研报 帮我做一份 2026 AI Agent 出海竞争格局研报",
    );

    expect(result).toMatchObject({
      trigger: "@研报",
      query: "帮我做一份 AI Agent 出海竞争格局研报",
      prompt: "帮我做一份 AI Agent 出海竞争格局研报",
      timeRange: "2026",
      outputFormat: "研究报告",
    });
  });

  it("应兼容英文触发词", () => {
    const result = parseReportWorkbenchCommand(
      "@report query: openai enterprise adoption site: GitHub range: 2026 focus: enterprise blockers output: board memo",
    );

    expect(result).toMatchObject({
      trigger: "@report",
      query: "openai enterprise adoption",
      site: "GitHub",
      timeRange: "2026",
      focus: "enterprise blockers",
      outputFormat: "board memo",
    });
  });

  it("非研报命令应返回空", () => {
    expect(parseReportWorkbenchCommand("@搜索 OpenAI 最新融资")).toBeNull();
  });
});
