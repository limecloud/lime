import { describe, expect, it } from "vitest";

import { normalizeProcessDisplayText } from "./processDisplayText";

describe("normalizeProcessDisplayText", () => {
  it("应压平被切碎成多行的过程性 prose 文本", () => {
    const input = [
      "目录",
      "",
      "也",
      "",
      "不存在。",
      "",
      "可能",
      "",
      "整个",
      "",
      ".lime",
      "",
      "目录",
      "",
      "都不",
      "",
      "存在。",
      "",
      "或者",
      "",
      "，",
      "",
      "任务",
      "",
      "文件",
      "",
      "路径",
      "",
      "是",
      "",
      "相对路径。",
    ].join("\n");

    expect(normalizeProcessDisplayText(input)).toBe(
      "目录也不存在。可能整个 .lime 目录都不存在。或者，任务文件路径是相对路径。",
    );
  });

  it("应压平较短的碎片化流式思考文本", () => {
    const input = ["The", "", "I", "", "Now"].join("\n");

    expect(normalizeProcessDisplayText(input)).toBe("The I Now");
  });

  it("应保留正常 markdown 列表的换行结构", () => {
    const input = ["先确认当前状态", "- 再检查目录", "- 最后补回退说明"].join(
      "\n",
    );

    expect(normalizeProcessDisplayText(input)).toBe(input);
  });
});
