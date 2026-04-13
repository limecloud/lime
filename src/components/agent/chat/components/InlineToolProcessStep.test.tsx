import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InlineToolProcessStep } from "./InlineToolProcessStep";
import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  ),
}));

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

interface RenderOptions {
  isMessageStreaming?: boolean;
  onOpenSavedSiteContent?: (target: unknown) => void;
}

const mountedRoots: RenderResult[] = [];

function renderTool(
  toolCall: ToolCallState,
  options?: RenderOptions,
): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <InlineToolProcessStep
        toolCall={toolCall}
        isMessageStreaming={options?.isMessageStreaming}
        onOpenSavedSiteContent={options?.onOpenSavedSiteContent}
      />,
    );
  });

  const rendered = { container, root };
  mountedRoots.push(rendered);
  return rendered;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

describe("InlineToolProcessStep", () => {
  it("ToolSearch 在流式阶段应保持结构化预览，不自动展开原始 JSON", () => {
    const { container } = renderTool(
      {
        id: "tool-search-streaming-1",
        name: "ToolSearch",
        arguments: JSON.stringify({ query: "select:Read,Write" }),
        status: "completed",
        result: {
          success: true,
          output: JSON.stringify({
            query: "select:Read,Write",
            count: 2,
            notes: [],
            tools: [{ name: "Read" }, { name: "Write" }],
          }),
        },
        startTime: new Date("2026-04-13T10:00:00.000Z"),
        endTime: new Date("2026-04-13T10:00:01.000Z"),
      },
      { isMessageStreaming: true },
    );

    expect(container.textContent).toContain("找到工具 2 个");
    expect(container.textContent).not.toContain("查询：");
    expect(container.textContent).not.toContain("select:Read,Write");
    expect(
      container.querySelector('[data-testid="inline-tool-process-tool-search-result"]'),
    ).toBeNull();
    expect(container.querySelector('[data-testid="markdown-renderer"]')).toBeNull();
    expect(container.textContent).not.toContain('"tools"');
  });

  it("ToolSearch 展开后应展示结构化工具摘要，而不是原始 JSON", () => {
    const { container } = renderTool({
      id: "tool-search-1",
      name: "ToolSearch",
      arguments: JSON.stringify({ query: "select:Read,Write" }),
      status: "completed",
      result: {
        success: true,
        output: JSON.stringify({
          query: "select:Read,Write",
          count: 2,
          notes: [],
          tools: [
            {
              name: "Read",
              source: "native_registry",
              description: "Read a file from disk",
              always_visible: true,
            },
            {
              name: "Write",
              source: "native_registry",
              description: "Write content to a file",
              always_visible: true,
            },
          ],
        }),
      },
      startTime: new Date("2026-04-13T10:10:00.000Z"),
      endTime: new Date("2026-04-13T10:10:01.000Z"),
    });

    act(() => {
      const toggle = container.querySelector(
        'button[title="展开过程详情"]',
      ) as HTMLButtonElement | null;
      toggle?.click();
    });

    expect(
      container.querySelector('[data-testid="inline-tool-process-tool-search-result"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("找到工具：2 个");
    expect(container.textContent).toContain("查看文件");
    expect(container.textContent).toContain("保存文件");
    expect(container.querySelector('[data-testid="markdown-renderer"]')).toBeNull();
    expect(container.textContent).not.toContain('"always_visible":true');
    expect(container.textContent).not.toContain("Read a file from disk");
    expect(container.textContent).not.toContain("查询：select:Read,Write");
    expect(container.textContent).not.toContain("原生工具");
    expect(container.textContent).not.toContain("默认可见");
  });

  it("WebSearch 展开后应优先展示搜索结果列表", () => {
    const { container } = renderTool({
      id: "tool-search-web-1",
      name: "WebSearch",
      arguments: JSON.stringify({ query: "AI Agent 最新热点" }),
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
      startTime: new Date("2026-04-13T10:20:00.000Z"),
      endTime: new Date("2026-04-13T10:20:01.000Z"),
    });

    act(() => {
      const toggle = container.querySelector(
        'button[title="展开过程详情"]',
      ) as HTMLButtonElement | null;
      toggle?.click();
    });

    expect(
      document.body.querySelector(
        '[aria-label="预览搜索结果：Xinhua world news summary at 0030 GMT, March 13"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "Friday morning news: March 13, 2026 | WORLD - wng.org",
    );
    expect(container.querySelector('[data-testid="markdown-renderer"]')).toBeNull();
  });

  it("完成态过程卡不应重复展示执行完成与原始工具名", () => {
    const { container } = renderTool({
      id: "tool-inline-ask-user-1",
      name: "AskUserQuestion",
      arguments: JSON.stringify({ question: "需要继续吗？" }),
      status: "completed",
      result: {
        success: true,
        output: "用户已确认继续。",
      },
      startTime: new Date("2026-04-13T10:30:00.000Z"),
      endTime: new Date("2026-04-13T10:30:01.000Z"),
    });

    expect(container.textContent).toContain("已收集 需要继续吗？");
    expect(container.textContent).not.toContain("执行完成");
    expect(container.textContent).not.toContain("Ask User Question");
  });

  it("站点导出按钮副文案应优先展示短文件名", () => {
    const onOpenSavedSiteContent = vi.fn();
    const { container } = renderTool(
      {
        id: "tool-inline-site-run-1",
        name: "lime_site_run",
        arguments: JSON.stringify({
          adapter_name: "x/article",
          args: { url: "https://x.com/google/article/1" },
        }),
        status: "completed",
        result: {
          success: true,
          output: "ok",
          metadata: {
            tool_family: "site",
            saved_content: {
              content_id: "content-inline-site-1",
              project_id: "project-inline-site-1",
              title: "Google Cloud 周报",
              markdown_relative_path:
                "exports/social-article/google-cloud/index.md",
              image_count: 3,
            },
            saved_by: "context_project",
          },
        },
        startTime: new Date("2026-04-13T10:40:00.000Z"),
        endTime: new Date("2026-04-13T10:40:01.000Z"),
      },
      { onOpenSavedSiteContent },
    );

    expect(container.textContent).toContain("已保存到当前项目：Google Cloud 周报");
    expect(container.textContent).toContain("已导出 Markdown 文稿");
    expect(container.textContent).toContain("附带图片 3 张");

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("在下方预览导出 Markdown"),
    ) as HTMLButtonElement | undefined;

    expect(openButton).toBeDefined();
    expect(openButton?.textContent).toContain("index.md");
    expect(openButton?.textContent).not.toContain(
      "exports/social-article/google-cloud/index.md",
    );

    act(() => {
      openButton?.click();
    });

    expect(onOpenSavedSiteContent).toHaveBeenCalledWith({
      projectId: "project-inline-site-1",
      contentId: "content-inline-site-1",
      title: "Google Cloud 周报",
      preferredTarget: "project_file",
      projectFile: {
        relativePath: "exports/social-article/google-cloud/index.md",
      },
    });
  });
});
