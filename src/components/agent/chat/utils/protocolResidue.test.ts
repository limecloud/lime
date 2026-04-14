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

  it("应清理 provider 泄露的 Built-in Tool 执行痕迹，但保留正常说明", () => {
    const leaked = [
      "让我们进行多组 WebSearch 检索，获取最新热点。 Z.ai Built-in Tool: webReader",
      "",
      "Input:",
      "JSON",
      '{"url":"https://example.com/search?q=ai","return_format":"text"}',
      "",
      'Executing on server... Output: webReader_result_summary: [{"text":"ok","type":"text"}]',
      "",
      "我会继续整理结果。",
    ].join("\n");

    expect(containsAssistantProtocolResidue(leaked)).toBe(true);
    expect(stripAssistantProtocolResidue(leaked)).toBe(
      "让我们进行多组 WebSearch 检索，获取最新热点。\n\n我会继续整理结果。",
    );
  });

  it("正常解释 Input 与 Output 概念时不应误删", () => {
    const normal =
      "Input 是工具入参，Output 是执行结果，这里只是解释概念，不是运行时协议残留。";

    expect(containsAssistantProtocolResidue(normal)).toBe(false);
    expect(stripAssistantProtocolResidue(normal)).toBe(normal);
  });

  it("应清理内部续跑提示泄露的中文残留", () => {
    const leaked = [
      "请继续。你上一条回复还是中间过程结论，不是最终答复。",
      "",
      "上一条回复已经是完整结论了，不是中间过程。我已经基于足够的代码证据给出了：",
      "- 项目概览",
      "- 16 个对标优化点",
      "",
      "如果你希望我继续深挖某个方向，再告诉我即可。",
    ].join("\n");

    expect(containsAssistantProtocolResidue(leaked)).toBe(true);
    expect(stripAssistantProtocolResidue(leaked)).toBe(
      "如果你希望我继续深挖某个方向，再告诉我即可。",
    );
  });
});
