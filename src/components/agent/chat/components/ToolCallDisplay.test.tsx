import { act } from "react";
import { describe, expect, it } from "vitest";
import { renderTool, renderToolList } from "./ToolCallDisplay.testFixtures";

describe("ToolCallDisplay", () => {


  it("WebSearch 工具结果应在 AI 对话区展示搜索列表并支持悬浮预览", async () => {
    const { container } = renderTool({
      id: "tool-search-1",
      name: "WebSearch",
      arguments: JSON.stringify({ query: "3月13日国际新闻" }),
      status: "completed",
      result: {
        success: true,
        output: [
          "Xinhua world news summary at 0030 GMT, March 13",
          "https://example.com/xinhua",
          "全球要闻摘要，覆盖国际局势与市场动态。",
          "",
          "Friday morning news: March 13, 2026 | WORLD - wng.org",
          "https://example.com/wng",
          "补充国际动态与区域冲突更新。",
        ].join("\n"),
      },
      startTime: new Date("2026-03-13T12:00:00.000Z"),
      endTime: new Date("2026-03-13T12:00:02.000Z"),
    });

    expect(document.body.textContent).toContain(
      "Xinhua world news summary at 0030 GMT, March 13",
    );
    expect(document.body.textContent).toContain(
      "Friday morning news: March 13, 2026 | WORLD - wng.org",
    );
    expect(
      container.querySelector('[data-testid="tool-call-rendered-result"]'),
    ).toBeNull();
    expect(document.body.textContent).toContain("查看文本详情");

    const firstSearchResult = document.body.querySelector(
      '[aria-label="打开搜索结果：Xinhua world news summary at 0030 GMT, March 13"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      firstSearchResult?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      "全球要闻摘要，覆盖国际局势与市场动态。",
    );
    expect(document.body.textContent).toContain("https://example.com/xinhua");
    expect(document.body.querySelector('[data-side="bottom"]')).not.toBeNull();
    expect(document.body.querySelector('[data-side="left"]')).toBeNull();

    act(() => {
      const rawToggle = document.body.querySelector(
        'button[aria-label="查看搜索文本详情"]',
      ) as HTMLButtonElement | null;
      rawToggle?.click();
    });

    expect(document.body.textContent).toContain("收起文本详情");
    expect(
      container.querySelector('[data-testid="tool-call-rendered-result"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("https://example.com/wng");

    const collapseButton = document.body.querySelector(
      'button[title="收起结果"]',
    ) as HTMLButtonElement | null;

    act(() => {
      collapseButton?.click();
    });

    expect(document.body.textContent).not.toContain(
      "Xinhua world news summary at 0030 GMT, March 13",
    );

    const expandButton = document.body.querySelector(
      'button[title="查看结果"]',
    ) as HTMLButtonElement | null;

    act(() => {
      expandButton?.click();
    });

    expect(document.body.textContent).toContain(
      "Xinhua world news summary at 0030 GMT, March 13",
    );
  });

  it("WebSearch 未命中结构化搜索结果时应继续展示原始输出", () => {
    const { container } = renderTool({
      id: "tool-search-plain-1",
      name: "WebSearch",
      arguments: JSON.stringify({ query: "golang 学习建议" }),
      status: "completed",
      result: {
        success: true,
        output: "本次检索未返回可解析链接，请稍后重试。",
      },
      startTime: new Date("2026-03-13T12:05:00.000Z"),
      endTime: new Date("2026-03-13T12:05:02.000Z"),
    });

    act(() => {
      const expandButton = container.querySelector(
        'button[title="查看结果"]',
      ) as HTMLButtonElement | null;
      expandButton?.click();
    });

    expect(
      container.querySelector('[data-testid="tool-call-rendered-result"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "本次检索未返回可解析链接，请稍后重试。",
    );
    expect(container.textContent).not.toContain("查看文本详情");
  });

  it("动态 MCP web_search 结果应按搜索来源渲染而不是落回原始结果", () => {
    const { container } = renderTool({
      id: "tool-mcp-search-1",
      name: "mcp__news__web_search",
      arguments: JSON.stringify({ query: "today international news" }),
      status: "completed",
      result: {
        success: true,
        output: JSON.stringify({
          results: [
            {
              title: "Reuters World News",
              url: "https://www.reuters.com/world/",
              snippet: "Latest international headlines",
            },
          ],
        }),
      },
      startTime: new Date("2026-06-02T12:00:00.000Z"),
      endTime: new Date("2026-06-02T12:00:02.000Z"),
    });

    expect(document.body.textContent).toContain("Reuters World News");
    expect(document.body.textContent).toContain("reuters.com");
    expect(document.body.textContent).toContain("查看文本详情");
    expect(
      container.querySelector('[data-testid="tool-call-rendered-result"]'),
    ).toBeNull();
  });

  it("动态 MCP mutation 应展示为 MCP 工具过程而不是搜索或读取", () => {
    const { container } = renderTool({
      id: "tool-mcp-mutation-1",
      name: "mcp__github__create_issue",
      arguments: JSON.stringify({ title: "修复工具渲染" }),
      status: "completed",
      result: {
        success: true,
        output: JSON.stringify({ id: 123, title: "修复工具渲染" }),
      },
      startTime: new Date("2026-06-02T12:00:00.000Z"),
      endTime: new Date("2026-06-02T12:00:02.000Z"),
    });

    expect(container.textContent).toContain("MCP 工具");
    expect(container.textContent).toContain("已调用 MCP 工具 修复工具渲染");
    expect(container.textContent).not.toContain("MCP 搜索");
    expect(container.textContent).not.toContain("MCP 读取");
  });

  it("完整工具卡应隐藏非命令工具的协议诊断包络", () => {
    const { container } = renderTool({
      id: "tool-protocol-envelope-1",
      name: "mcp__github__create_issue",
      arguments: JSON.stringify({ title: "修复工具渲染" }),
      status: "completed",
      result: {
        success: true,
        output: JSON.stringify({
          request_metadata: {
            event: "turn/start",
            session_id: "session-1",
          },
          diagnostics: {
            projection: "tool_result_projection",
            ok: true,
          },
          metadata: {
            durationMs: 12,
          },
        }),
      },
      startTime: new Date("2026-06-21T12:00:00.000Z"),
      endTime: new Date("2026-06-21T12:00:01.000Z"),
    });

    act(() => {
      const expandButton = container.querySelector(
        'button[title="查看结果"]',
      ) as HTMLButtonElement | null;
      expandButton?.click();
    });

    expect(
      container.querySelector('[data-testid="tool-call-rendered-result"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("已调用 MCP 工具");
    expect(container.textContent).not.toContain("request_metadata");
    expect(container.textContent).not.toContain("turn/start");
    expect(container.textContent).not.toContain("tool_result_projection");
    expect(container.textContent).not.toContain("durationMs");
  });

  it("MCP 工具只有协议包络输出时应展示 structuredContent 正文", () => {
    const { container } = renderTool({
      id: "tool-mcp-structured-content-1",
      name: "mcp__docs__diagnostic_probe",
      arguments: JSON.stringify({ query: "MCP structured content" }),
      status: "completed",
      result: {
        success: true,
        output: JSON.stringify({
          request_metadata: {
            projection: "mcp_tool_result_projection",
            trace_id: "trace-structured-content",
          },
          diagnostics: {
            elapsed_ms: 12,
            raw_transport_payload: "doc-hidden-envelope",
          },
          content: [
            {
              type: "text",
              text: "control-plane envelope only; user answer is stored in structuredContent",
            },
          ],
        }),
        structuredContent: {
          answer: "MCP 结构化答案已进入 GUI",
          ids: ["doc-1"],
        },
      },
      startTime: new Date("2026-06-21T13:00:00.000Z"),
      endTime: new Date("2026-06-21T13:00:01.000Z"),
    });

    act(() => {
      const expandButton = container.querySelector(
        'button[title="查看结果"]',
      ) as HTMLButtonElement | null;
      expandButton?.click();
    });

    expect(
      container.querySelector('[data-testid="tool-call-rendered-result"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("MCP 结构化答案已进入 GUI");
    expect(container.textContent).toContain("doc-1");
    expect(container.textContent).not.toContain("control-plane envelope only");
    expect(container.textContent).not.toContain("request_metadata");
    expect(container.textContent).not.toContain("doc-hidden-envelope");
    expect(container.textContent).not.toContain("mcp_tool_result_projection");
  });

  it("连续多次 WebSearch 应在对话区按搜索批次分组展示", () => {
    const { container } = renderToolList({
      toolCalls: [
        {
          id: "tool-search-1",
          name: "WebSearch",
          arguments: JSON.stringify({ query: "3月13日国际新闻" }),
          status: "completed",
          result: { success: true, output: "https://example.com/1" },
          startTime: new Date("2026-03-13T12:00:00.000Z"),
          endTime: new Date("2026-03-13T12:00:01.000Z"),
        },
        {
          id: "tool-search-2",
          name: "WebSearch",
          arguments: JSON.stringify({
            query: "March 13 2026 world headlines",
          }),
          status: "completed",
          result: { success: true, output: "https://example.com/2" },
          startTime: new Date("2026-03-13T12:00:02.000Z"),
          endTime: new Date("2026-03-13T12:00:03.000Z"),
        },
      ],
    });

    expect(container.textContent).toContain("已搜索");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("3月13日国际新闻");
    expect(container.textContent).toContain("March 13 2026 world headlines");
    expect(container.textContent).toContain("搜索 3月13日国际新闻");
    expect(container.textContent).toContain(
      "搜索 March 13 2026 world headlines",
    );
    expect(container.textContent).not.toContain("中文日期检索");
    expect(container.textContent).not.toContain("头条检索");
  });
});
