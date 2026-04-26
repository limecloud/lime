import { describe, expect, it } from "vitest";
import { parseLogoDecompositionWorkbenchCommand } from "./logoDecompositionWorkbenchCommand";

describe("parseLogoDecompositionWorkbenchCommand", () => {
  it("应解析中文触发词并复用分析字段语义", () => {
    const result = parseLogoDecompositionWorkbenchCommand(
      "@Logo拆解 内容:品牌新 Logo 重点:配色与字形 输出:三点拆解",
    );

    expect(result).toMatchObject({
      trigger: "@Logo拆解",
      analysisMode: "image_logo_decomposition",
      content: "品牌新 Logo",
      focus: "配色与字形",
      outputFormat: "三点拆解",
      prompt: "品牌新 Logo 围绕配色与字形 三点拆解",
    });
  });

  it("应兼容 inventory 里的英文触发词", () => {
    const result = parseLogoDecompositionWorkbenchCommand(
      "@Image Logo Decomposition focus: composition output: bullet points",
    );

    expect(result).toMatchObject({
      trigger: "@Image Logo Decomposition",
      analysisMode: "image_logo_decomposition",
      focus: "composition",
      outputFormat: "bullet points",
      prompt: "围绕composition bullet points",
    });
  });

  it("空正文时应补专用默认提示", () => {
    const result = parseLogoDecompositionWorkbenchCommand("@Logo拆解");

    expect(result).toMatchObject({
      trigger: "@Logo拆解",
      analysisMode: "image_logo_decomposition",
      prompt: "请拆解这张图片或 Logo 的构图、元素、配色、字体与可复用视觉结构",
    });
  });

  it("非 Logo 拆解命令应返回空", () => {
    expect(parseLogoDecompositionWorkbenchCommand("@分析 某个品牌为什么火")).toBe(
      null,
    );
  });
});
