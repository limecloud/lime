import { describe, expect, it } from "vitest";
import { parsePdfWorkbenchCommand } from "./pdfWorkbenchCommand";

describe("parsePdfWorkbenchCommand", () => {
  it("应解析带显式字段的 @读PDF 命令", () => {
    const result = parsePdfWorkbenchCommand(
      '@读PDF 文件:"./docs/AI Agent Report.pdf" 重点:融资额与发布时间 输出:三点结论',
    );

    expect(result).toMatchObject({
      trigger: "@读PDF",
      sourcePath: "./docs/AI Agent Report.pdf",
      focus: "融资额与发布时间",
      outputFormat: "三点结论",
      prompt: "",
    });
  });

  it("应解析内联 PDF 路径与自然语句提示", () => {
    const result = parsePdfWorkbenchCommand(
      "@读PDF /tmp/demo.pdf 提炼三点结论并标出关键证据",
    );

    expect(result).toMatchObject({
      trigger: "@读PDF",
      sourcePath: "/tmp/demo.pdf",
      prompt: "提炼三点结论并标出关键证据",
    });
  });

  it("应兼容 PDF URL 输入", () => {
    const result = parsePdfWorkbenchCommand(
      "@pdf https://example.com/agent-report.pdf 总结这份 PDF 的核心观点",
    );

    expect(result).toMatchObject({
      trigger: "@pdf",
      sourceUrl: "https://example.com/agent-report.pdf",
      prompt: "这份 PDF 的核心观点",
    });
  });

  it("非读 PDF 命令应返回空", () => {
    expect(parsePdfWorkbenchCommand("@总结 /tmp/demo.pdf")).toBeNull();
  });
});
