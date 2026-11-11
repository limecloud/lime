import { describe, expect, it } from "vitest";

import { resolveStreamingMarkdownDisplaySource } from "./streamingMarkdownDisplaySource";

describe("streamingMarkdownDisplaySource", () => {
  it("流式内容应把未完成行保留为即时 tail", () => {
    expect(resolveStreamingMarkdownDisplaySource("首字", true)).toEqual({
      markdown: "",
      pendingTail: "首字",
    });

    expect(
      resolveStreamingMarkdownDisplaySource("第一行\n第二行", true),
    ).toEqual({
      markdown: "第一行\n",
      pendingTail: "第二行",
    });
  });

  it("完成态应把全部内容交给 Markdown renderer", () => {
    expect(
      resolveStreamingMarkdownDisplaySource("第一行\n第二行", false),
    ).toEqual({
      markdown: "第一行\n第二行",
      pendingTail: "",
    });
  });

  it("结构化流式内容应保留给结构化解析器处理", () => {
    expect(resolveStreamingMarkdownDisplaySource("<a2ui", true)).toEqual({
      markdown: "<a2ui",
      pendingTail: "",
    });
  });

  it("流式 Markdown 应只把完整换行前的源码交给 Markdown renderer", () => {
    expect(
      resolveStreamingMarkdownDisplaySource(
        "| 来源 | 结论 |\n| --- | --- |\n| Codex",
        true,
      ),
    ).toEqual({
      markdown: "| 来源 | 结论 |\n| --- | --- |\n",
      pendingTail: "| Codex",
    });

    expect(resolveStreamingMarkdownDisplaySource("## 标题", true)).toEqual({
      markdown: "",
      pendingTail: "## 标题",
    });

    expect(resolveStreamingMarkdownDisplaySource("## 标题", false)).toEqual({
      markdown: "## 标题",
      pendingTail: "",
    });

    expect(
      resolveStreamingMarkdownDisplaySource("- 半截列表\n- 仍在输出", true, {
        deferMarkdownUntilComplete: true,
      }),
    ).toEqual({
      markdown: "",
      pendingTail: "- 半截列表\n- 仍在输出",
    });
  });
});
