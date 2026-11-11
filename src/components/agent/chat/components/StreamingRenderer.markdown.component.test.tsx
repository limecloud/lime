import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  mockMarkdownRenderer,
  parseAIResponseMock,
} from "./StreamingRenderer.testMocks";
import type { ContentPart } from "../types";
import {
  installStreamingRendererTestHarness,
  renderStreamingRendererHarness as renderHarness,
} from "./StreamingRenderer.testHarness";

installStreamingRendererTestHarness();

describe("StreamingRenderer Markdown", () => {
  it("流式 Markdown 未完成行应先按纯文本尾巴展示，避免半行表格提前解析", () => {
    const fullText = "表格：\n| 来源";
    const { container } = renderHarness({
      content: fullText,
      isStreaming: true,
    });

    const markdownContents = mockMarkdownRenderer.mock.calls.map(
      ([props]) => props.content,
    );
    expect(markdownContents).not.toContain(fullText);
    expect(markdownContents).toContain("表格：\n");
    expect(container.textContent).toContain("| 来源");
    expect(
      container.querySelector(
        '[data-testid="streaming-markdown-pending-tail"]',
      ),
    ).not.toBeNull();
  });

  it("首个流式正文到达时应立即显示首批字符", () => {
    const { container, rerender } = renderHarness({
      content: "",
      isStreaming: true,
    });

    rerender({
      content: "这是首个流式正文，应该立即露出。",
      isStreaming: true,
    });

    expect(container.textContent).toContain("这是首个流式");
    expect(
      container.querySelector(
        '[data-testid="streaming-markdown-pending-tail"]',
      ),
    ).not.toBeNull();
  });

  it("纯文本内容应短路跳过结构化解析", () => {
    renderHarness({
      content: "这是普通文本输出，不包含结构化标签。",
      isStreaming: true,
    });

    expect(parseAIResponseMock).not.toHaveBeenCalled();
  });

  it("流式纯文本首帧应立即显示前缀，避免等待下一帧才吐字", () => {
    const fullText = "这是第一段流式输出，应该马上可见。";
    const { container } = renderHarness({
      content: fullText,
      isStreaming: true,
    });

    const renderedText = container.textContent || "";
    expect(renderedText).toBe(fullText);
  });

  it("流式正文积压较多时应快速追上最新目标文本", () => {
    vi.useFakeTimers();
    const fullText = "流式输出".repeat(80);
    const { container } = renderHarness({
      content: fullText,
      isStreaming: true,
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const renderedText = container.textContent || "";
    expect(renderedText.length).toBeGreaterThan(120);
    expect(fullText.startsWith(renderedText)).toBe(true);
  });

  it("开启正文块操作时应向 MarkdownRenderer 透传引用/复制能力", () => {
    const onQuoteContent = vi.fn();

    renderHarness({
      content: "这是最终输出",
      showContentBlockActions: true,
      onQuoteContent,
    });

    expect(mockMarkdownRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "这是最终输出",
        showBlockActions: true,
        onQuoteContent,
      }),
    );
  });

  it("历史恢复轻量模式应向 MarkdownRenderer 透传 light 渲染模式", () => {
    renderHarness({
      content: "这是历史会话正文\n\n```ts\nconsole.log('heavy')\n```",
      markdownRenderMode: "light",
    });

    expect(mockMarkdownRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("这是历史会话正文"),
        renderMode: "light",
      }),
    );
  });

  it("交错内容重复渲染时应复用已缓存解析结果", () => {
    const structuredText = "<document>hello</document>";
    parseAIResponseMock.mockImplementation((content: string) => {
      if (content === structuredText) {
        return {
          parts: [
            {
              type: "document",
              content: "hello",
            },
          ],
          hasA2UI: false,
          hasPending: false,
        };
      }

      return {
        parts: content.trim()
          ? [{ type: "text", content: content.trim() }]
          : [],
        hasA2UI: false,
        hasPending: false,
      };
    });
    const contentParts: ContentPart[] = [
      { type: "text", text: structuredText },
      { type: "text", text: "普通文本" },
    ];

    const { rerender } = renderHarness({
      content: structuredText,
      contentParts,
      isStreaming: true,
    });

    const initialParseCount = parseAIResponseMock.mock.calls.length;
    expect(initialParseCount).toBeGreaterThan(0);

    rerender({
      content: structuredText,
      contentParts: [...contentParts],
      isStreaming: true,
    });

    expect(parseAIResponseMock).toHaveBeenCalledTimes(initialParseCount);
  });
});
