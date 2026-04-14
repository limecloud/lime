import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingRenderer } from "./StreamingRenderer";
import type {
  AgentToolCallState,
  AgentToolResultMetadata,
} from "@/lib/api/agentProtocol";
import type {
  AgentRuntimeStatus,
  ActionRequired,
  ContentPart,
  WriteArtifactContext,
} from "../types";

const parseAIResponseMock = vi.fn();
const mockMarkdownRenderer = vi.fn(
  ({
    content,
    showBlockActions,
    onQuoteContent,
  }: {
    content: string;
    showBlockActions?: boolean;
    onQuoteContent?: (content: string) => void;
  }) => (
    <div
      data-testid="markdown-renderer"
      data-show-block-actions={showBlockActions ? "yes" : "no"}
      data-has-on-quote-content={onQuoteContent ? "yes" : "no"}
    >
      {content}
    </div>
  ),
);

vi.mock("@/lib/workspace/a2ui", () => ({
  parseAIResponse: (...args: unknown[]) => parseAIResponseMock(...args),
  CHAT_A2UI_TASK_CARD_PRESET: {},
  TIMELINE_A2UI_TASK_CARD_PRESET: {},
}));

vi.mock("@/lib/artifact/hooks/useDebouncedValue", () => ({
  useDebouncedValue: <T,>(value: T) => value,
}));

vi.mock("./MarkdownRenderer", () => ({
  MarkdownRenderer: (props: {
    content: string;
    showBlockActions?: boolean;
    onQuoteContent?: (content: string) => void;
  }) => mockMarkdownRenderer(props),
}));

vi.mock("./A2UITaskCard", () => ({
  A2UITaskCard: () => <div data-testid="a2ui-card" />,
  A2UITaskLoadingCard: () => <div data-testid="a2ui-loading-card" />,
}));

vi.mock("./DecisionPanel", () => ({
  DecisionPanel: () => <div data-testid="decision-panel" />,
}));

vi.mock("./AgentPlanBlock", () => ({
  AgentPlanBlock: ({
    content,
    isComplete,
  }: {
    content: string;
    isComplete?: boolean;
  }) => (
    <div data-testid="agent-plan-block">
      {isComplete === false ? "进行中:" : "完成:"}
      {content}
    </div>
  ),
}));

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedHarness[] = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  parseAIResponseMock.mockImplementation((content: string) => ({
    parts: content.trim() ? [{ type: "text", content: content.trim() }] : [],
    hasA2UI: false,
    hasWriteFile: false,
    hasPending: false,
  }));
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

function renderHarness(props: {
  content: string;
  isStreaming?: boolean;
  thinkingContent?: string;
  contentParts?: ContentPart[];
  renderA2UIInline?: boolean;
  runtimeStatus?: AgentRuntimeStatus;
  showRuntimeStatusInline?: boolean;
  toolCalls?: AgentToolCallState[];
  actionRequests?: ActionRequired[];
  promoteActionRequestsToA2UI?: boolean;
  onPermissionResponse?: (payload: unknown) => void;
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: WriteArtifactContext,
  ) => void;
  onOpenSavedSiteContent?: (target: {
    projectId: string;
    contentId: string;
    title?: string;
  }) => void;
  suppressProcessFlow?: boolean;
  showContentBlockActions?: boolean;
  onQuoteContent?: (content: string) => void;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const rerender = (nextProps: typeof props) => {
    act(() => {
      root.render(<StreamingRenderer {...nextProps} />);
    });
  };

  rerender(props);
  mountedRoots.push({ container, root });

  return { container, rerender };
}

function createSavedSiteMetadata(): AgentToolResultMetadata {
  return {
    tool_family: "site",
    saved_project_id: "project-1",
    saved_content: {
      content_id: "content-1",
      project_id: "project-1",
      title: "Google Cloud Tech 文章导出",
      markdown_relative_path: "saved/x-article-export/article.md",
      images_relative_dir: "saved/x-article-export/images",
      image_count: 2,
    },
  };
}

describe("StreamingRenderer", () => {
  it("交错内容应隐藏紧邻工具调用的调度自述", () => {
    const { container } = renderHarness({
      content: "",
      contentParts: [
        {
          type: "text",
          text: "ToolSearch 只返回了元数据，让我直接调用 WebSearch 进行多组检索。",
        },
        {
          type: "tool_use",
          toolCall: {
            id: "tool-narration-hidden",
            name: "WebSearch",
            arguments: JSON.stringify({ query: "latest openai api" }),
            status: "completed",
            result: { success: true, output: "ok" },
            startTime: new Date("2026-04-01T10:00:00.000Z"),
            endTime: new Date("2026-04-01T10:00:01.000Z"),
          },
        },
        {
          type: "text",
          text: "已经整理出 3 个可信来源。",
        },
      ],
    });

    expect(container.textContent).not.toContain("只返回了元数据");
    expect(
      container.querySelector('[data-testid="inline-tool-process-step"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("已经整理出 3 个可信来源。");
  });

  it("应过滤 assistant 正文中的工具协议残留", () => {
    const { container } = renderHarness({
      content:
        '<tool_call import={"name":"Read","arguments":{"file_path":"article.md"}}>{"ok":true}</tool_call>\n\n已完成 Markdown 保存。',
    });

    expect(container.textContent).toContain("已完成 Markdown 保存。");
    expect(container.textContent).not.toContain("tool_call");
    expect(container.textContent).not.toContain("file_path");
  });

  it("纯文本内容应短路跳过结构化解析", () => {
    renderHarness({
      content: "这是普通文本输出，不包含结构化标签。",
      isStreaming: true,
    });

    expect(parseAIResponseMock).not.toHaveBeenCalled();
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

  it("交错内容重复渲染时应复用已缓存解析结果", () => {
    const structuredText = '<write_file path="demo.md">hello</write_file>';
    parseAIResponseMock.mockImplementation((content: string) => {
      if (content === structuredText) {
        return {
          parts: [
            {
              type: "write_file",
              content: "hello",
              filePath: "demo.md",
            },
          ],
          hasA2UI: false,
          hasWriteFile: true,
          hasPending: false,
        };
      }

      return {
        parts: content.trim()
          ? [{ type: "text", content: content.trim() }]
          : [],
        hasA2UI: false,
        hasWriteFile: false,
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

    expect(parseAIResponseMock).toHaveBeenCalledTimes(1);

    rerender({
      content: structuredText,
      contentParts: [...contentParts],
      isStreaming: true,
    });

    expect(parseAIResponseMock).toHaveBeenCalledTimes(1);
  });

  it("连续探索工具应默认折叠成批次摘要", () => {
    const { container } = renderHarness({
      content: "",
      toolCalls: [
        {
          id: "tool-search-1",
          name: "Grep",
          arguments: JSON.stringify({
            pattern: "tool_use_summary",
            path: "/workspace/src",
          }),
          status: "completed",
          result: { success: true, output: "found" },
          startTime: new Date("2026-04-01T10:00:00.000Z"),
          endTime: new Date("2026-04-01T10:00:01.000Z"),
        },
        {
          id: "tool-read-1",
          name: "Read",
          arguments: JSON.stringify({
            file_path: "/workspace/src/query.ts",
          }),
          status: "completed",
          result: { success: true, output: "file contents" },
          startTime: new Date("2026-04-01T10:00:02.000Z"),
          endTime: new Date("2026-04-01T10:00:03.000Z"),
        },
      ],
    });

    expect(container.textContent).toContain("已探索项目");
    expect(container.textContent).toContain("查看了 1 个文件，搜索 1 次");
    expect(container.textContent).toContain("最新线索：query.ts");
    expect(
      container.querySelector('[data-testid="inline-tool-process-step"]'),
    ).toBeNull();
  });

  it("普通工具列表应透传已保存站点内容打开回调", () => {
    const onOpenSavedSiteContent = vi.fn();
    const { container } = renderHarness({
      content: "工具执行完成",
      toolCalls: [
        {
          id: "tool-site-run-streaming-list",
          name: "lime_site_run",
          arguments: JSON.stringify({
            adapter_name: "x/article-export",
            skill_title: "X 文章转存",
          }),
          status: "completed",
          result: {
            success: true,
            output: "ok",
            metadata: createSavedSiteMetadata(),
          },
          startTime: new Date("2026-03-25T10:00:00.000Z"),
          endTime: new Date("2026-03-25T10:00:01.000Z"),
        },
      ],
      onOpenSavedSiteContent,
    });

    const markdownButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("在下方预览导出 Markdown"),
    );
    expect(
      container.querySelector('[data-testid="inline-tool-process-step"]'),
    ).toBeTruthy();
    expect(markdownButton).toBeTruthy();

    act(() => {
      markdownButton?.click();
    });

    expect(onOpenSavedSiteContent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        contentId: "content-1",
        preferredTarget: "project_file",
      }),
    );
  });

  it("交错工具片段应透传已保存站点内容打开回调", () => {
    const onOpenSavedSiteContent = vi.fn();
    const { container } = renderHarness({
      content: "",
      contentParts: [
        {
          type: "tool_use",
          toolCall: {
            id: "tool-site-run-streaming-item",
            name: "lime_site_run",
            arguments: JSON.stringify({
              adapter_name: "x/article-export",
              skill_title: "X 文章转存",
            }),
            status: "completed",
            result: {
              success: true,
              output: "ok",
              metadata: createSavedSiteMetadata(),
            },
            startTime: new Date("2026-03-25T10:01:00.000Z"),
            endTime: new Date("2026-03-25T10:01:01.000Z"),
          },
        },
      ],
      onOpenSavedSiteContent,
    });

    const markdownButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("在下方预览导出 Markdown"),
    );
    expect(markdownButton).toBeTruthy();

    act(() => {
      markdownButton?.click();
    });

    expect(onOpenSavedSiteContent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        contentId: "content-1",
      }),
    );
  });

  it("非交错模式应将思考和工具收敛为同一执行过程组", () => {
    const { container } = renderHarness({
      content: "最终结论",
      thinkingContent: "先检查滚动触发逻辑\n再确认输出展开时机",
      toolCalls: [
        {
          id: "tool-process-group-fallback",
          name: "functions.exec_command",
          arguments: JSON.stringify({ cmd: "rg -n scrollKey src" }),
          status: "completed",
          result: { success: true, output: "ok" },
          startTime: new Date("2026-03-25T10:02:00.000Z"),
          endTime: new Date("2026-03-25T10:02:01.000Z"),
        },
      ],
    });

    expect(container.textContent).toContain("先检查滚动触发逻辑 · 1 个工具调用");
    expect(
      container.querySelector('[data-testid="streaming-process-group"]'),
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-testid="inline-tool-process-step"]')
        ?.getAttribute("data-grouped"),
    ).toBe("yes");
    expect(container.textContent).toContain("最终结论");
  });

  it("交错内容中的思考与工具应按连续执行流分组", () => {
    const { container } = renderHarness({
      content: "",
      contentParts: [
        {
          type: "thinking",
          text: "先检查 auto-scroll 触发条件\n确认是否只跟踪最后一项",
        },
        {
          type: "tool_use",
          toolCall: {
            id: "tool-process-group-interleaved",
            name: "functions.exec_command",
            arguments: JSON.stringify({
              cmd: "sed -n '1,120p' src/messages.tsx",
            }),
            status: "completed",
            result: { success: true, output: "ok" },
            startTime: new Date("2026-03-25T10:03:00.000Z"),
            endTime: new Date("2026-03-25T10:03:01.000Z"),
          },
        },
        {
          type: "thinking",
          text: "根因已经定位\n准备收口实现",
        },
        {
          type: "text",
          text: "已经定位到滚动没有跟随增量输出。",
        },
      ],
      isStreaming: false,
    });

    expect(container.textContent).toContain(
      "先检查 auto-scroll 触发条件 · 1 个工具调用",
    );
    expect(
      container.querySelector('[data-testid="streaming-process-group"]'),
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-testid="inline-tool-process-step"]')
        ?.getAttribute("data-grouped"),
    ).toBe("yes");
    expect(container.textContent).toContain("已经定位到滚动没有跟随增量输出。");
  });

  it("抑制过程流时，非交错模式不应重复渲染思考、工具和确认卡", () => {
    const { container } = renderHarness({
      content: "最终回答内容",
      thinkingContent: "这段思考应由 timeline 承载",
      toolCalls: [
        {
          id: "tool-suppressed-fallback",
          name: "functions.exec_command",
          arguments: JSON.stringify({ cmd: "rg -n duplicate src" }),
          status: "completed",
          result: { success: true, output: "ok" },
          startTime: new Date("2026-03-28T12:10:00.000Z"),
          endTime: new Date("2026-03-28T12:10:01.000Z"),
        },
      ],
      actionRequests: [
        {
          requestId: "req-suppressed-fallback",
          actionType: "tool_confirmation",
          status: "pending",
          prompt: "请确认是否继续",
        },
      ],
      onPermissionResponse: vi.fn(),
      suppressProcessFlow: true,
    });

    expect(
      container.querySelector('[data-testid="streaming-process-group"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inline-tool-process-step"]'),
    ).toBeNull();
    expect(container.querySelector("details")).toBeNull();
    expect(
      container.querySelector('[data-testid="decision-panel"]'),
    ).toBeNull();
    expect(container.textContent).toContain("最终回答内容");
  });

  it("抑制过程流时，交错模式只保留正文片段", () => {
    const { container } = renderHarness({
      content: "",
      contentParts: [
        {
          type: "thinking",
          text: "这段思考应由 timeline 渲染",
        },
        {
          type: "tool_use",
          toolCall: {
            id: "tool-suppressed-interleaved",
            name: "functions.exec_command",
            arguments: JSON.stringify({ cmd: "sed -n '1,80p' src/app.tsx" }),
            status: "completed",
            result: { success: true, output: "ok" },
            startTime: new Date("2026-03-28T12:12:00.000Z"),
            endTime: new Date("2026-03-28T12:12:01.000Z"),
          },
        },
        {
          type: "action_required",
          actionRequired: {
            requestId: "req-suppressed-interleaved",
            actionType: "tool_confirmation",
            status: "pending",
            prompt: "请确认是否继续",
          },
        },
        {
          type: "text",
          text: "这里只保留最终正文。",
        },
      ],
      onPermissionResponse: vi.fn(),
      suppressProcessFlow: true,
    });

    expect(
      container.querySelector('[data-testid="streaming-process-group"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inline-tool-process-step"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="decision-panel"]'),
    ).toBeNull();
    expect(container.textContent).toContain("这里只保留最终正文。");
  });

  it("关闭内联 A2UI 时应仅保留普通文本片段", () => {
    parseAIResponseMock.mockReturnValue({
      parts: [
        { type: "text", content: "请先补充以下信息：" },
        { type: "a2ui", content: { type: "form", children: [] } },
      ],
      hasA2UI: true,
      hasWriteFile: false,
      hasPending: false,
    });

    const { container } = renderHarness({
      content: "```a2ui\n{}\n```",
      renderA2UIInline: false,
    });

    expect(container.querySelector('[data-testid="a2ui-card"]')).toBeNull();
    expect(container.textContent).toContain("请先补充以下信息：");
  });

  it("pending_write_file 应触发流式 onWriteFile 回调", () => {
    const onWriteFile = vi.fn();
    parseAIResponseMock.mockReturnValue({
      parts: [
        {
          type: "pending_write_file",
          content: "# 草稿\n正在生成中",
          filePath: "notes/live.md",
        },
      ],
      hasA2UI: false,
      hasWriteFile: true,
      hasPending: true,
    });

    renderHarness({
      content: '<write_file path="notes/live.md"># 草稿\n正在生成中',
      isStreaming: true,
      onWriteFile,
    });

    expect(onWriteFile).toHaveBeenCalledTimes(1);
    expect(onWriteFile).toHaveBeenCalledWith(
      "# 草稿\n正在生成中",
      "notes/live.md",
      expect.objectContaining({
        source: "message_content",
        status: "streaming",
        metadata: expect.objectContaining({
          writePhase: "streaming",
          lastUpdateSource: "message_content",
          isPartial: true,
        }),
      }),
    );
  });

  it("应将 proposed_plan 片段渲染为独立计划卡片", () => {
    const { container } = renderHarness({
      content:
        "先说明一下\n<proposed_plan>\n- 调研\n- 汇总\n</proposed_plan>\n然后开始执行",
    });

    expect(
      container.querySelector('[data-testid="agent-plan-block"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("完成:- 调研");
    expect(container.textContent).toContain("- 汇总");
    expect(container.textContent).toContain("先说明一下");
    expect(container.textContent).toContain("然后开始执行");
  });

  it("等待首个事件时不应再把 agent 运行状态插入正文顶部", () => {
    const { container } = renderHarness({
      content: "",
      isStreaming: true,
      runtimeStatus: {
        phase: "preparing",
        title: "正在准备处理",
        detail: "正在理解请求并准备当前阶段。",
        checkpoints: ["对话优先执行", "等待首个事件"],
      },
      showRuntimeStatusInline: true,
    });

    expect(
      container.querySelector('[data-testid="agent-runtime-status"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("正在准备处理");
  });

  it("高风险服务进入稳妥顺序处理时，正文顶部不应再出现运行态卡", () => {
    const { container } = renderHarness({
      content: "",
      isStreaming: true,
      runtimeStatus: {
        phase: "routing",
        title: "当前服务较忙，稍后开始处理",
        detail:
          "当前服务在同时处理过多请求时容易直接失败，系统已切换为更稳妥的顺序处理。",
        checkpoints: ["当前服务仅同时处理 1 条此类请求"],
        metadata: {
          concurrency_scope: "provider_global",
          concurrency_phase: "queued",
          retryable_overload: true,
        },
      },
      showRuntimeStatusInline: true,
    });

    expect(
      container.querySelector('[data-testid="agent-runtime-status"]'),
    ).toBeNull();
  });

  it("正文已经开始输出后，不应再在正文区域重复渲染运行态", () => {
    const { container } = renderHarness({
      content: "我来帮你先打开 GitHub 搜索页。",
      isStreaming: true,
      runtimeStatus: {
        phase: "routing",
        title: "正在搜索 GitHub",
        detail: "已经打开搜索页，准备补充筛选条件。",
        checkpoints: ["浏览器已就绪", "准备应用最近更新时间筛选"],
      },
      showRuntimeStatusInline: true,
    });

    expect(
      container.querySelector('[data-testid="agent-runtime-status"]'),
    ).toBeNull();
  });

  it("交错内容模式下也不应在正文区域渲染运行态卡", () => {
    const { container } = renderHarness({
      content: "",
      isStreaming: true,
      runtimeStatus: {
        phase: "context",
        title: "正在整理搜索结果",
        detail: "已拿到页面内容，正在提取最近一个月更新的仓库。",
        checkpoints: ["页面内容已获取"],
      },
      showRuntimeStatusInline: true,
      contentParts: [
        {
          type: "text",
          text: "我已经打开 GitHub 搜索页，接下来开始筛选结果。",
        },
        {
          type: "tool_use",
          toolCall: {
            id: "tool-runtime-status-inline",
            name: "browser_snapshot",
            arguments: JSON.stringify({ page: "github-search" }),
            status: "running",
            result: undefined,
            startTime: new Date("2026-03-30T12:00:00.000Z"),
          },
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="agent-runtime-status"]'),
    ).toBeNull();
  });

  it("已取消的运行状态也不应在正文顶部额外渲染状态卡", () => {
    const { container } = renderHarness({
      content: "",
      isStreaming: true,
      runtimeStatus: {
        phase: "cancelled",
        title: "图片任务已取消",
        detail: "任务已停止，不会继续生成新的图片结果。",
        checkpoints: ["已保留当前任务记录", "可在图片画布重新生成"],
      },
      showRuntimeStatusInline: true,
    });

    expect(
      container.querySelector('[data-testid="agent-runtime-status"]'),
    ).toBeNull();
  });

  it("思考内容进入流式阶段后应自动展开", () => {
    const { container, rerender } = renderHarness({
      content: "",
      thinkingContent: "第一步：分析问题",
      isStreaming: false,
    });

    const initialDetails = container.querySelector("details");
    expect(initialDetails).toBeTruthy();
    expect((initialDetails as HTMLDetailsElement).open).toBe(false);

    rerender({
      content: "",
      thinkingContent: "第一步：分析问题\n第二步：调用工具",
      isStreaming: true,
    });

    const streamingDetails = container.querySelector("details");
    expect(streamingDetails).toBeTruthy();
    expect((streamingDetails as HTMLDetailsElement).open).toBe(true);
    expect(container.textContent).toContain("第二步：调用工具");
  });

  it("思考块应使用统一状态标签，并保留首行原始文案", () => {
    const { container, rerender } = renderHarness({
      content: "",
      thinkingContent: "先生成一版草稿\n- 再根据反馈快速迭代",
      isStreaming: false,
    });

    expect(container.textContent).toContain("已完成思考");
    expect(container.textContent).toContain("先生成一版草稿");
    expect(container.textContent).not.toContain("思考中");

    rerender({
      content: "",
      thinkingContent: "先生成一版草稿\n- 再根据反馈快速迭代",
      isStreaming: true,
    });

    expect(container.textContent).toContain("先生成一版草稿");
  });

  it("过程组中的思考块应切换为轻量行内样式", () => {
    const { container } = renderHarness({
      content: "",
      contentParts: [
        {
          type: "thinking",
          text: "先确认过程组行高\n再和工具行对齐",
        },
        {
          type: "tool_use",
          toolCall: {
            id: "tool-thinking-inline-style",
            name: "functions.exec_command",
            arguments: JSON.stringify({ cmd: "rg -n thinking src" }),
            status: "completed",
            result: { success: true, output: "ok" },
            startTime: new Date("2026-03-29T08:40:00.000Z"),
            endTime: new Date("2026-03-29T08:40:01.000Z"),
          },
        },
      ],
    });

    expect(
      container
        .querySelector('[data-testid="thinking-block"]')
        ?.getAttribute("data-visual-style"),
    ).toBe("grouped-inline");
  });

  it("提升为输入区 A2UI 的待处理问答不应继续渲染内联 DecisionPanel", () => {
    const { container } = renderHarness({
      content: "",
      actionRequests: [
        {
          requestId: "req-ask-1",
          actionType: "ask_user",
          status: "pending",
          prompt: "请选择执行模式",
          questions: [{ question: "请选择执行模式" }],
        },
        {
          requestId: "req-tool-1",
          actionType: "tool_confirmation",
          status: "pending",
          prompt: "请确认是否继续",
        },
      ],
      promoteActionRequestsToA2UI: true,
      onPermissionResponse: vi.fn(),
    });

    expect(
      container.querySelectorAll('[data-testid="decision-panel"]'),
    ).toHaveLength(1);
  });

  it("已排队的 ask_user 应继续以内联只读 A2UI 卡片回显", () => {
    const { container } = renderHarness({
      content: "",
      actionRequests: [
        {
          requestId: "req-ask-queued",
          actionType: "ask_user",
          status: "queued",
          prompt: "请选择渠道",
          questions: [
            {
              question: "请选择渠道",
              options: [{ label: "小红书" }, { label: "视频号" }],
            },
          ],
          submittedUserData: { answer: "小红书" },
        },
      ],
      promoteActionRequestsToA2UI: true,
      onPermissionResponse: vi.fn(),
    });

    expect(
      container.querySelectorAll('[data-testid="a2ui-card"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="decision-panel"]'),
    ).toBeNull();
  });

  it("交错内容中的已提交问答应渲染为只读 A2UI 卡片", () => {
    const { container } = renderHarness({
      content: "",
      contentParts: [
        {
          type: "action_required",
          actionRequired: {
            requestId: "req-ask-submitted",
            actionType: "ask_user",
            status: "submitted",
            prompt: "请选择执行模式",
            questions: [
              {
                question: "请选择执行模式",
                options: [{ label: "自动执行" }, { label: "逐步确认" }],
              },
            ],
            submittedUserData: { answer: "自动执行" },
          },
        },
      ],
    });

    expect(
      container.querySelectorAll('[data-testid="a2ui-card"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="decision-panel"]'),
    ).toBeNull();
  });
});
