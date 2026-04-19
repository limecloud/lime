import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolCallDisplay, ToolCallList } from "./ToolCallDisplay";
import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn().mockResolvedValue(undefined),
}));

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function renderTool(toolCall: ToolCallState): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ToolCallDisplay toolCall={toolCall} />);
  });

  const rendered = { container, root };
  mountedRoots.push(rendered);
  return rendered;
}

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

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
      '[aria-label="预览搜索结果：Xinhua world news summary at 0030 GMT, March 13"]',
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

  it("连续多次 WebSearch 应在对话区按搜索批次分组展示", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ToolCallList
          toolCalls={[
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
          ]}
        />,
      );
    });

    mountedRoots.push({ container, root });

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

  it("连续完成的命令工具应聚合成一个 work group", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ToolCallList
          toolCalls={[
            {
              id: "tool-exec-1",
              name: "bash",
              arguments: JSON.stringify({ command: "pwd" }),
              status: "completed",
              result: { success: true, output: "/workspace\n" },
              startTime: new Date("2026-03-20T12:00:00.000Z"),
              endTime: new Date("2026-03-20T12:00:01.000Z"),
            },
            {
              id: "tool-exec-2",
              name: "bash",
              arguments: JSON.stringify({ command: "ls -la" }),
              status: "completed",
              result: { success: true, output: "file-a\nfile-b\n" },
              startTime: new Date("2026-03-20T12:00:02.000Z"),
              endTime: new Date("2026-03-20T12:00:03.000Z"),
            },
          ]}
        />,
      );
    });

    mountedRoots.push({ container, root });

    const groups = container.querySelectorAll(
      '[data-testid="tool-call-work-group"]',
    );
    expect(groups).toHaveLength(1);
    expect(container.textContent).toContain("已运行 2 条命令");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("pwd");
    expect(container.textContent).toContain("ls -la");

    act(() => {
      const groupToggle = groups[0]?.querySelector(
        "button",
      ) as HTMLButtonElement | null;
      groupToggle?.click();
    });

    expect(container.textContent).toContain("运行 pwd");
    expect(container.textContent).toContain("运行 ls -la");
    expect(container.textContent).not.toContain("pwd · ls -la");
  });

  it("命令结果应进入代码块渲染，而不是裸文本标题重复", () => {
    const { container } = renderTool({
      id: "tool-exec-render-1",
      name: "bash",
      arguments: JSON.stringify({ command: "ls -la" }),
      status: "completed",
      result: {
        success: true,
        output: "/tmp\nfile-a\nfile-b\nfile-c\n",
        metadata: {
          exit_code: 0,
          stdout_length: 24,
          stderr_length: 0,
        },
      },
      startTime: new Date("2026-03-20T12:10:00.000Z"),
      endTime: new Date("2026-03-20T12:10:01.000Z"),
    });

    act(() => {
      const toggle = container.querySelector(
        'button[title="查看结果"]',
      ) as HTMLButtonElement | null;
      toggle?.click();
    });

    expect(container.textContent).toContain("已运行 ls -la");
    expect(container.textContent).not.toContain("已运行已运行");
    expect(container.textContent).not.toContain("退出码 0");
    expect(container.textContent).not.toContain("stdout 24");
    expect(container.textContent).not.toContain("stderr 0");
    expect(
      container.querySelector('[data-testid="tool-call-rendered-result"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("text");
    expect(container.textContent).toContain("复制");
  });

  it("结果区应压缩内部元信息与长路径提示", () => {
    const { container } = renderTool({
      id: "tool-exec-render-2",
      name: "bash",
      arguments: JSON.stringify({ command: "generate-report" }),
      status: "failed",
      result: {
        success: false,
        output: "报告生成失败，请检查参数后重试。",
        metadata: {
          exit_code: 2,
          lime_offloaded: true,
          output_truncated: true,
          output_file: "exports/reports/final-result.md",
        },
      },
      startTime: new Date("2026-03-20T12:12:00.000Z"),
      endTime: new Date("2026-03-20T12:12:01.000Z"),
    });

    act(() => {
      const toggle = container.querySelector(
        'button[title="查看结果"]',
      ) as HTMLButtonElement | null;
      toggle?.click();
    });

    expect(container.textContent).toContain("内容较长，已省略部分文本");
    expect(container.textContent).toContain("命令返回错误");
    expect(container.textContent).toContain("结果文件: final-result.md");
    expect(container.textContent).not.toContain("完整输出已转存");
    expect(container.textContent).not.toContain("输出已截断");
    expect(container.textContent).not.toContain("输出文件:");
    expect(container.textContent).not.toContain("退出码 2");
    expect(container.textContent).not.toContain(
      "exports/reports/final-result.md",
    );
  });

  it("语义成功的非零退出码不应继续显示命令错误提示", () => {
    const { container } = renderTool({
      id: "tool-exec-render-3",
      name: "bash",
      arguments: JSON.stringify({ command: "rg missing src" }),
      status: "completed",
      result: {
        success: true,
        output: "No matches found",
        metadata: {
          exit_code: 1,
          stdout_length: 0,
          stderr_length: 0,
          reported_success: true,
        },
      },
      startTime: new Date("2026-04-14T10:00:00.000Z"),
      endTime: new Date("2026-04-14T10:00:01.000Z"),
    });

    act(() => {
      const toggle = container.querySelector(
        'button[title="查看结果"]',
      ) as HTMLButtonElement | null;
      toggle?.click();
    });

    expect(container.textContent).toContain("No matches found");
    expect(container.textContent).not.toContain("命令返回错误");
  });

  it("正式工具卡不应额外展示原始工具名", () => {
    const { container } = renderTool({
      id: "tool-ask-user-1",
      name: "AskUserQuestion",
      arguments: JSON.stringify({ question: "需要继续吗？" }),
      status: "completed",
      result: {
        success: true,
        output: "用户已确认继续。",
      },
      startTime: new Date("2026-04-13T10:31:00.000Z"),
      endTime: new Date("2026-04-13T10:31:01.000Z"),
    });

    expect(container.textContent).toContain("已收集 需要继续吗？");
    expect(container.textContent).not.toContain("Ask User Question");
  });

  it("站点能力工具结果应展示自动保存结果与脚本来源", () => {
    const { container } = renderTool({
      id: "tool-site-run-1",
      name: "lime_site_run",
      arguments: JSON.stringify({
        adapter_name: "github/search",
        args: { query: "mcp" },
      }),
      status: "completed",
      result: {
        success: true,
        output: JSON.stringify({
          ok: true,
          adapter: "github/search",
          data: { items: [{ title: "modelcontextprotocol/servers" }] },
        }),
        metadata: {
          tool_family: "site",
          adapter_name: "github/search",
          saved_content: {
            content_id: "content-1",
            project_id: "project-1",
            title: "GitHub MCP 搜索结果",
            project_root_path: "/Users/coso/.proxycast/projects/project-1",
            markdown_relative_path:
              "exports/x-article-export/github-mcp/index.md",
            images_relative_dir: "exports/x-article-export/github-mcp/images",
            image_count: 7,
          },
          saved_project_id: "project-1",
          saved_by: "context_project",
          adapter_source_kind: "server_synced",
          adapter_source_version: "2026-03-25",
        },
      },
      startTime: new Date("2026-03-25T12:10:00.000Z"),
      endTime: new Date("2026-03-25T12:10:01.000Z"),
    });

    expect(container.textContent).toContain("已执行 github/search");

    act(() => {
      const toggle = container.querySelector(
        'button[title="查看结果"]',
      ) as HTMLButtonElement | null;
      toggle?.click();
    });

    expect(container.textContent).toContain(
      "结果已自动保存到当前项目：GitHub MCP 搜索结果",
    );
    expect(container.textContent).toContain("已导出 Markdown 文稿");
    expect(container.textContent).toContain("附带图片 7 张");
    expect(container.textContent).not.toContain(
      "exports/x-article-export/github-mcp/index.md",
    );
    expect(container.textContent).not.toContain(
      "exports/x-article-export/github-mcp/images",
    );
    expect(container.textContent).not.toContain("项目目录：");
    expect(container.textContent).not.toContain("脚本来源：");
  });

  it("站点能力工具结果应支持直接打开已保存内容", () => {
    const onOpenSavedSiteContent = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ToolCallDisplay
          toolCall={{
            id: "tool-site-run-open-1",
            name: "lime_site_run",
            arguments: JSON.stringify({
              adapter_name: "github/search",
              args: { query: "lime" },
            }),
            status: "completed",
            result: {
              success: true,
              output: "ok",
              metadata: {
                tool_family: "site",
                saved_content: {
                  content_id: "content-open-1",
                  project_id: "project-open-1",
                  title: "Lime 搜索结果",
                },
                saved_by: "context_project",
              },
            },
            startTime: new Date("2026-03-25T12:20:00.000Z"),
            endTime: new Date("2026-03-25T12:20:01.000Z"),
          }}
          onOpenSavedSiteContent={onOpenSavedSiteContent}
        />,
      );
    });

    mountedRoots.push({ container, root });

    act(() => {
      const toggle = container.querySelector(
        'button[title="查看结果"]',
      ) as HTMLButtonElement | null;
      toggle?.click();
    });

    act(() => {
      const openButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("打开已保存内容"),
      ) as HTMLButtonElement | undefined;
      openButton?.click();
    });

    expect(onOpenSavedSiteContent).toHaveBeenCalledWith({
      projectId: "project-open-1",
      contentId: "content-open-1",
      title: "Lime 搜索结果",
    });
  });

  it("站点能力工具存在导出 Markdown 时应优先打开项目文件目标", () => {
    const onOpenSavedSiteContent = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ToolCallDisplay
          toolCall={{
            id: "tool-site-run-open-markdown-1",
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
                  content_id: "content-open-markdown-1",
                  project_id: "project-open-markdown-1",
                  title: "Google Cloud 周报",
                  markdown_relative_path:
                    "exports/social-article/google-cloud/index.md",
                },
                saved_by: "context_project",
              },
            },
            startTime: new Date("2026-03-25T12:22:00.000Z"),
            endTime: new Date("2026-03-25T12:22:01.000Z"),
          }}
          onOpenSavedSiteContent={onOpenSavedSiteContent}
        />,
      );
    });

    mountedRoots.push({ container, root });

    act(() => {
      const toggle = container.querySelector(
        'button[title="查看结果"]',
      ) as HTMLButtonElement | null;
      toggle?.click();
    });

    act(() => {
      const openButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("在下方预览导出 Markdown"),
      ) as HTMLButtonElement | undefined;
      openButton?.click();
    });

    expect(onOpenSavedSiteContent).toHaveBeenCalledWith({
      projectId: "project-open-markdown-1",
      contentId: "content-open-markdown-1",
      title: "Google Cloud 周报",
      preferredTarget: "project_file",
      projectFile: {
        relativePath: "exports/social-article/google-cloud/index.md",
      },
    });
  });

  it("工具结果图片预览浮层应使用浅色主题遮罩", () => {
    const { container } = renderTool({
      id: "tool-image-preview-1",
      name: "lime_image_search",
      arguments: JSON.stringify({ query: "青绿色海报" }),
      status: "completed",
      result: {
        success: true,
        output: "已返回 1 张图片",
        images: [
          {
            src: "https://example.com/poster.png",
            mimeType: "image/png",
            origin: "tool_payload",
          },
        ],
      },
      startTime: new Date("2026-04-11T03:00:00.000Z"),
      endTime: new Date("2026-04-11T03:00:01.000Z"),
    });

    const previewButton = container.querySelector(
      'button[title="点击查看大图"]',
    ) as HTMLButtonElement | null;
    expect(previewButton).not.toBeNull();

    act(() => {
      previewButton?.click();
    });

    const overlayButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) =>
      button.querySelector('img[alt="工具结果图片大图"]'),
    ) as HTMLButtonElement | undefined;

    expect(overlayButton).toBeTruthy();
    expect(overlayButton?.className).toContain("backdrop-blur-[2px]");
    expect(overlayButton?.className).not.toContain("bg-black/70");
    expect(
      document.body
        .querySelector('img[alt="工具结果图片大图"]')
        ?.getAttribute("src"),
    ).toBe("https://example.com/poster.png");
  });

  it("ToolSearch 展开后应展示结构化工具摘要，而不是原始 JSON", () => {
    const { container } = renderTool({
      id: "tool-search-bridge-1",
      name: "ToolSearch",
      arguments: JSON.stringify({ query: "select:Read,Write" }),
      status: "completed",
      result: {
        success: true,
        output: JSON.stringify({
          query: "select:Read,Write",
          caller: "assistant",
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
      startTime: new Date("2026-04-10T04:00:00.000Z"),
      endTime: new Date("2026-04-10T04:00:01.000Z"),
    });

    act(() => {
      const toggle = container.querySelector(
        'button[title="查看结果"]',
      ) as HTMLButtonElement | null;
      toggle?.click();
    });

    expect(
      container.querySelector('[data-testid="tool-call-tool-search-result"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("找到工具：2 个");
    expect(container.textContent).toContain("查看文件");
    expect(container.textContent).toContain("保存文件");
    expect(container.textContent).not.toContain("Read a file from disk");
    expect(container.textContent).not.toContain('"always_visible":true');
    expect(container.textContent).not.toContain("查询：select:Read,Write");
    expect(container.textContent).not.toContain("原生工具");
    expect(container.textContent).not.toContain("默认可见");
    expect(
      container.querySelector('[data-testid="tool-call-rendered-result"]'),
    ).toBeNull();
  });

  it("ToolSearch 在流式阶段不应自动展开内部结果", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ToolCallDisplay
          isMessageStreaming
          toolCall={{
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
            startTime: new Date("2026-04-10T04:05:00.000Z"),
            endTime: new Date("2026-04-10T04:05:01.000Z"),
          }}
        />,
      );
    });

    mountedRoots.push({ container, root });

    expect(
      container.querySelector('[data-testid="tool-call-tool-search-result"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("找到工具：2 个");
    expect(container.textContent).not.toContain("Read a file from disk");
  });

  it("站点能力工具失败时应展示未保存原因", () => {
    const { container } = renderTool({
      id: "tool-site-run-2",
      name: "lime_site_run",
      arguments: JSON.stringify({
        adapter_name: "zhihu/search",
        args: { query: "lime" },
      }),
      status: "failed",
      result: {
        success: false,
        error: "执行失败",
        output: "",
        metadata: {
          tool_family: "site",
          adapter_name: "zhihu/search",
          save_skipped_project_id: "project-2",
          save_skipped_by: "context_project",
          save_error_message: "数据库写入失败",
        },
      },
      startTime: new Date("2026-03-25T12:12:00.000Z"),
      endTime: new Date("2026-03-25T12:12:03.000Z"),
    });

    act(() => {
      const toggle = container.querySelector(
        'button[title="查看结果"]',
      ) as HTMLButtonElement | null;
      toggle?.click();
    });

    expect(container.textContent).toContain("执行失败，未保存到当前项目");
    expect(container.textContent).toContain("自动保存失败：数据库写入失败");
  });

  it("应为浏览器、委派、任务输出与交互类工具生成具体动作句", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ToolCallList
          toolCalls={[
            {
              id: "tool-browser-1",
              name: "mcp__lime-browser__browser_navigate",
              arguments: JSON.stringify({ url: "https://example.com/docs" }),
              status: "completed",
              result: { success: true, output: "ok" },
              startTime: new Date("2026-03-20T12:20:00.000Z"),
              endTime: new Date("2026-03-20T12:20:01.000Z"),
            },
            {
              id: "tool-subagent-1",
              name: "Agent",
              arguments: JSON.stringify({ description: "修复登录页" }),
              status: "running",
              startTime: new Date("2026-03-20T12:20:02.000Z"),
            },
            {
              id: "tool-output-1",
              name: "TaskOutput",
              arguments: JSON.stringify({ task_id: "video-task-1" }),
              status: "completed",
              result: { success: true, output: "done" },
              startTime: new Date("2026-03-20T12:20:03.000Z"),
              endTime: new Date("2026-03-20T12:20:04.000Z"),
            },
            {
              id: "tool-skill-1",
              name: "load_skill",
              arguments: JSON.stringify({ name: "lime-governance" }),
              status: "completed",
              result: { success: true, output: "loaded" },
              startTime: new Date("2026-03-20T12:20:05.000Z"),
              endTime: new Date("2026-03-20T12:20:06.000Z"),
            },
            {
              id: "tool-glob-1",
              name: "glob",
              arguments: JSON.stringify({ pattern: "src/**/*.tsx" }),
              status: "completed",
              result: { success: true, output: "matched" },
              startTime: new Date("2026-03-20T12:20:07.000Z"),
              endTime: new Date("2026-03-20T12:20:08.000Z"),
            },
            {
              id: "tool-input-1",
              name: "AskUserQuestion",
              arguments: JSON.stringify({ question: "需要继续吗？" }),
              status: "running",
              startTime: new Date("2026-03-20T12:20:09.000Z"),
            },
            {
              id: "tool-send-user-message-1",
              name: "SendUserMessage",
              arguments: JSON.stringify({ message: "修复已完成" }),
              status: "completed",
              result: { success: true, output: "Message delivered to user." },
              startTime: new Date("2026-03-20T12:20:09.500Z"),
              endTime: new Date("2026-03-20T12:20:09.900Z"),
            },
            {
              id: "tool-list-peers-1",
              name: "ListPeers",
              arguments: JSON.stringify({}),
              status: "completed",
              result: { success: true, output: "[]" },
              startTime: new Date("2026-03-20T12:20:10.000Z"),
              endTime: new Date("2026-03-20T12:20:11.000Z"),
            },
            {
              id: "tool-team-create-1",
              name: "TeamCreate",
              arguments: JSON.stringify({ team_name: "当前团队" }),
              status: "completed",
              result: { success: true, output: "{}" },
              startTime: new Date("2026-03-20T12:20:11.000Z"),
              endTime: new Date("2026-03-20T12:20:12.000Z"),
            },
            {
              id: "tool-team-delete-1",
              name: "TeamDelete",
              arguments: JSON.stringify({ team_name: "当前团队" }),
              status: "completed",
              result: { success: true, output: "{}" },
              startTime: new Date("2026-03-20T12:20:12.000Z"),
              endTime: new Date("2026-03-20T12:20:13.000Z"),
            },
            {
              id: "tool-remote-trigger-1",
              name: "RemoteTrigger",
              arguments: JSON.stringify({
                action: "run",
                trigger_id: "remote-1",
              }),
              status: "completed",
              result: { success: true, output: "ok" },
              startTime: new Date("2026-03-20T12:20:14.000Z"),
              endTime: new Date("2026-03-20T12:20:15.000Z"),
            },
            {
              id: "tool-cron-delete-1",
              name: "CronDelete",
              arguments: JSON.stringify({ id: "cron-job-1" }),
              status: "completed",
              result: { success: true, output: "ok" },
              startTime: new Date("2026-03-20T12:20:16.000Z"),
              endTime: new Date("2026-03-20T12:20:17.000Z"),
            },
          ]}
        />,
      );
    });

    mountedRoots.push({ container, root });

    expect(container.textContent).toContain("已打开 https://example.com/docs");
    expect(container.textContent).toContain("子任务处理中 修复登录页");
    expect(container.textContent).toContain("已查看结果 video-task-1");
    expect(container.textContent).toContain("已加载技能 lime-governance");
    expect(container.textContent).toContain("已找到 src/**/*.tsx");
    expect(container.textContent).toContain("等待输入 需要继续吗？");
    expect(container.textContent).toContain("已发送");
    expect(container.textContent).toContain("修复已完成");
    expect(container.textContent).toContain("已查看 当前团队");
    expect(container.textContent).toContain("已创建 当前团队");
    expect(container.textContent).toContain("已删除 当前团队");
    expect(container.textContent).toContain("已处理 remote-1");
    expect(container.textContent).toContain("已删除 cron-job-1");
  });

  it("写文件工具应通过 artifact protocol 解析嵌套产物路径", () => {
    const { container } = renderTool({
      id: "tool-write-nested-1",
      name: "write_file",
      arguments: JSON.stringify({
        payload: {
          artifact_paths: ["content-posts\\final.md"],
        },
      }),
      status: "completed",
      result: {
        success: true,
        output: "# 最终稿",
      },
      startTime: new Date("2026-03-25T09:00:00.000Z"),
      endTime: new Date("2026-03-25T09:00:01.000Z"),
    });

    expect(container.textContent).toContain("已保存 final.md");
  });
});
