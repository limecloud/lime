import { describe, expect, it } from "vitest";

import {
  containsAssistantProtocolResidue,
  stripAssistantProtocolResidue,
} from "./protocolResidue";

describe("protocolResidue", () => {
  it("应清理 tool protocol 标签残留", () => {
    expect(
      stripAssistantProtocolResidue(
        '<tool_result>{"output":"saved"}</tool_result>\n\n已保存到项目目录。',
      ),
    ).toBe("已保存到项目目录。");
  });

  it("应清理 StructuredOutput continuation 提示块", () => {
    const leaked = [
      "You MUST call the `StructuredOutput` tool NOW with the structured final output for the user.",
      "",
      "已完成处理，结果如下。",
    ].join("\n");

    expect(containsAssistantProtocolResidue(leaked)).toBe(true);
    expect(stripAssistantProtocolResidue(leaked)).toBe("已完成处理，结果如下。");
  });

  it("应清理内部检索协议词，但保留正常答复", () => {
    const leaked = [
      "StructuredOutput",
      "select:StructuredOutput",
      "output final deliver artifact document",
      "",
      "我已经整理好了最终答复。",
    ].join("\n");

    expect(stripAssistantProtocolResidue(leaked)).toBe(
      "我已经整理好了最终答复。",
    );
  });

  it("提及 StructuredOutput 的正常说明不应被误删", () => {
    const normal =
      "StructuredOutput 是运行时内部使用的最终输出工具名，但这里是在解释概念。";

    expect(containsAssistantProtocolResidue(normal)).toBe(false);
    expect(stripAssistantProtocolResidue(normal)).toBe(normal);
  });
});
