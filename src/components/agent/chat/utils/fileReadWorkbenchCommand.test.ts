import { describe, expect, it } from "vitest";
import { parseFileReadWorkbenchCommand } from "./fileReadWorkbenchCommand";

describe("parseFileReadWorkbenchCommand", () => {
  it("应解析带显式字段的 @读文件 命令", () => {
    const result = parseFileReadWorkbenchCommand(
      '@读文件 文件:"./docs/AI Agent Report.md" 重点:融资额与发布时间 长度:简短 输出:三点结论',
    );

    expect(result).toMatchObject({
      trigger: "@读文件",
      sourcePath: "./docs/AI Agent Report.md",
      focus: "融资额与发布时间",
      length: "short",
      outputFormat: "三点结论",
      prompt: "",
    });
  });

  it("应解析内联文件路径与自然语句提示", () => {
    const result = parseFileReadWorkbenchCommand(
      "@读文件 /tmp/demo-notes.md 提炼三点结论并标出关键证据",
    );

    expect(result).toMatchObject({
      trigger: "@读文件",
      sourcePath: "/tmp/demo-notes.md",
      prompt: "提炼三点结论并标出关键证据",
    });
  });

  it("应兼容英文 trigger 与带空格文件路径", () => {
    const result = parseFileReadWorkbenchCommand(
      '@Read File Content "./docs/agent notes.txt" output:三点要点',
    );

    expect(result).toMatchObject({
      trigger: "@Read File Content",
      sourcePath: "./docs/agent notes.txt",
      outputFormat: "三点要点",
    });
  });

  it("非读文件命令应返回空", () => {
    expect(parseFileReadWorkbenchCommand("@总结 /tmp/demo.md")).toBeNull();
  });
});
