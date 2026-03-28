import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentThreadTimeline } from "./AgentThreadTimeline";
import type {
  ActionRequired,
  AgentThreadItem,
  AgentThreadTurn,
} from "../types";
import type { AgentRuntimeThreadReadModel } from "@/lib/api/agentRuntime";
import type { ArtifactTimelineOpenTarget } from "../utils/artifactTimelineNavigation";

const parseAIResponseMock = vi.fn();

function resolveMockToolText(toolCall: {
  name: string;
  arguments?: string;
  status?: string;
}) {
  let parsedArguments: Record<string, unknown> | null = null;
  if (toolCall.arguments) {
    try {
      parsedArguments = JSON.parse(toolCall.arguments) as Record<string, unknown>;
    } catch {
      parsedArguments = null;
    }
  }

  if (
    toolCall.name === "browser_navigate" &&
    typeof parsedArguments?.url === "string"
  ) {
    return `打开 ${parsedArguments.url}`;
  }

  if (
    (toolCall.name === "web_search" || toolCall.name === "search_query") &&
    typeof parsedArguments?.query === "string"
  ) {
    return `搜索 ${parsedArguments.query}`;
  }

  if (
    toolCall.name === "exec_command" &&
    typeof parsedArguments?.command === "string"
  ) {
    return `执行 ${parsedArguments.command}`;
  }

  if (
    toolCall.name === "lime_site_run" &&
    typeof parsedArguments?.adapter_name === "string"
  ) {
    return `执行 ${parsedArguments.adapter_name}`;
  }

  return toolCall.name;
}

const mockToolCallItem = vi.fn(
  ({
    toolCall,
    onOpenSavedSiteContent,
  }: {
    toolCall: { name: string; arguments?: string; status?: string };
    onOpenSavedSiteContent?: (target: {
      projectId: string;
      contentId: string;
      title?: string;
    }) => void;
  }) => (
    <div
      data-testid="tool-call-item"
      data-has-open-saved-site-content={onOpenSavedSiteContent ? "yes" : "no"}
    >
      {resolveMockToolText(toolCall)}
      {toolCall.status === "running" ? " 进行中" : ""}
    </div>
  ),
);

vi.mock("@/components/content-creator/a2ui/parser", () => ({
  parseAIResponse: (...args: unknown[]) => parseAIResponseMock(...args),
}));

vi.mock("./MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  ),
}));

vi.mock("./A2UITaskCard", () => ({
  A2UITaskCard: () => <div data-testid="timeline-a2ui-card" />,
  A2UITaskLoadingCard: () => <div data-testid="timeline-a2ui-loading-card" />,
}));

vi.mock("./ToolCallDisplay", () => ({
  ToolCallItem: (props: {
    toolCall: { name: string; arguments?: string; status?: string };
    onOpenSavedSiteContent?: (target: {
      projectId: string;
      contentId: string;
      title?: string;
    }) => void;
  }) => mockToolCallItem(props),
}));

vi.mock("./DecisionPanel", () => ({
  DecisionPanel: ({ request }: { request: { prompt?: string } }) => (
    <div data-testid="decision-panel">{request.prompt || "decision"}</div>
  ),
}));

vi.mock("./AgentPlanBlock", () => ({
  AgentPlanBlock: ({ content }: { content: string }) => (
    <div data-testid="agent-plan-block">{content}</div>
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
  HTMLElement.prototype.scrollIntoView = vi.fn();
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

function at(second: number): string {
  return `2026-03-15T09:10:${String(second).padStart(2, "0")}Z`;
}

function createTurn(
  overrides?: Partial<AgentThreadTurn>,
): AgentThreadTurn {
  return {
    id: "turn-1",
    thread_id: "thread-1",
    prompt_text: "请检查并发布文章",
    status: "completed",
    started_at: at(0),
    completed_at: at(9),
    created_at: at(0),
    updated_at: at(9),
    ...overrides,
  };
}

function createBaseItem(
  id: string,
  sequence: number,
): Pick<
  AgentThreadItem,
  | "id"
  | "thread_id"
  | "turn_id"
  | "sequence"
  | "status"
  | "started_at"
  | "completed_at"
  | "updated_at"
> {
  const timestamp = at(sequence);
  return {
    id,
    thread_id: "thread-1",
    turn_id: "turn-1",
    sequence,
    status: "completed",
    started_at: timestamp,
    completed_at: timestamp,
    updated_at: timestamp,
  };
}

function renderTimeline(
  items: AgentThreadItem[],
  props?: {
    isCurrentTurn?: boolean;
    turn?: Partial<AgentThreadTurn>;
    threadRead?: AgentRuntimeThreadReadModel | null;
    actionRequests?: ActionRequired[];
    onOpenSavedSiteContent?: (target: {
      projectId: string;
      contentId: string;
      title?: string;
    }) => void;
    onOpenSubagentSession?: (sessionId: string) => void;
    onOpenArtifactFromTimeline?: (target: ArtifactTimelineOpenTarget) => void;
    focusedItemId?: string | null;
    focusRequestKey?: number;
  },
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <AgentThreadTimeline
        turn={createTurn(props?.turn)}
        items={items}
        threadRead={props?.threadRead}
        actionRequests={props?.actionRequests}
        isCurrentTurn={props?.isCurrentTurn}
        onOpenArtifactFromTimeline={props?.onOpenArtifactFromTimeline}
        onOpenSavedSiteContent={props?.onOpenSavedSiteContent}
        onOpenSubagentSession={props?.onOpenSubagentSession}
        focusedItemId={props?.focusedItemId}
        focusRequestKey={props?.focusRequestKey}
      />,
    );
  });

  mountedRoots.push({ container, root });
  return container;
}

function createFileArtifactItem(
  overrides: Partial<Extract<AgentThreadItem, { type: "file_artifact" }>> = {},
): Extract<AgentThreadItem, { type: "file_artifact" }> {
  return {
    ...createBaseItem("artifact-1", 1),
    type: "file_artifact",
    path: ".lime/artifacts/thread-1/demo.artifact.json",
    source: "artifact_snapshot",
    content: JSON.stringify({
      schemaVersion: "artifact_document.v1",
      artifactId: "artifact-document:demo",
      kind: "analysis",
      title: "季度复盘",
      status: "ready",
      language: "zh-CN",
      blocks: [
        { id: "hero-1", type: "hero_summary", summary: "摘要" },
        { id: "body-1", type: "rich_text", markdown: "正文" },
      ],
      sources: [],
      metadata: {},
    }),
    metadata: {
      artifact_id: "artifact-document:demo",
      artifact_block_id: ["hero-1", "body-1"],
    },
    ...overrides,
  };
}

describe("AgentThreadTimeline", () => {
  it("默认直接渲染内联时间线，不再显示旧摘要壳", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("summary-1", 1),
        type: "turn_summary",
        text: "已完成页面检查\n可以继续执行发布。",
      },
      {
        ...createBaseItem("browser-1", 2),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://mp.weixin.qq.com" },
      },
      {
        ...createBaseItem("approval-1", 3),
        type: "approval_request",
        request_id: "req-1",
        action_type: "tool_confirmation",
        prompt: "请确认是否发布文章",
        tool_name: "browser_click",
      },
    ];

    const container = renderTimeline(items, { isCurrentTurn: true });

    expect(
      container.querySelector('[data-testid="agent-thread-flow"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-overview"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-summary-shell"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-details-toggle"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-goal"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-focus"]'),
    ).toBeNull();
    expect(container.textContent).toContain("已完成页面检查");
    expect(container.textContent).toContain("打开 https://mp.weixin.qq.com");
    expect(container.textContent).toContain("请确认是否发布文章");
  });

  it("file_artifact 命中多个 block 时应提供精确跳转按钮", () => {
    const onOpenArtifactFromTimeline = vi.fn();
    const container = renderTimeline([createFileArtifactItem()], {
      onOpenArtifactFromTimeline,
    });

    const heroJumpButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("跳到 block hero-1"));
    expect(heroJumpButton).not.toBeUndefined();

    act(() => {
      heroJumpButton?.click();
    });

    expect(onOpenArtifactFromTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        timelineItemId: "artifact-1",
        filePath: ".lime/artifacts/thread-1/demo.artifact.json",
        blockId: "hero-1",
      }),
    );
  });

  it("收到 timeline 聚焦请求时应自动展开并高亮目标项", () => {
    const container = renderTimeline(
      [
        {
          ...createBaseItem("browser-1", 1),
          type: "tool_call",
          tool_name: "browser_click",
          arguments: { selector: "#publish" },
        },
      ],
      {
        turn: {
          status: "completed",
        },
        focusedItemId: "browser-1",
        focusRequestKey: 1,
      },
    );

    const block = container.querySelector<HTMLDetailsElement>(
      '[data-testid="agent-thread-block:1:browser"]',
    );
    const focusedEntry = container.querySelector<HTMLElement>(
      '[data-thread-item-id="browser-1"]',
    );

    expect(block).not.toBeNull();
    expect(focusedEntry?.className).toContain("ring-2");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("应向时间线内的工具明细透传已保存站点内容打开回调", () => {
    const onOpenSavedSiteContent = vi.fn();
    renderTimeline(
      [
        {
          ...createBaseItem("site-tool-1", 1),
          type: "tool_call",
          tool_name: "lime_site_run",
          arguments: { adapter_name: "github/search" },
          output: "ok",
          metadata: {
            tool_family: "site",
            saved_content: {
              content_id: "content-1",
              project_id: "project-1",
              title: "GitHub 搜索结果",
            },
          },
        },
      ],
      { onOpenSavedSiteContent },
    );

    expect(mockToolCallItem).toHaveBeenCalledWith(
      expect.objectContaining({ onOpenSavedSiteContent }),
    );
  });

  it("审批项与技术项都应直接落在消息流中", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("approval-1", 1),
        type: "approval_request",
        request_id: "req-1",
        action_type: "tool_confirmation",
        prompt: "请确认是否继续",
        tool_name: "browser_click",
      },
      {
        ...createBaseItem("other-1", 2),
        type: "tool_call",
        tool_name: "workspace_sync",
      },
    ];

    const container = renderTimeline(items);
    const approvalGroup = container.querySelector<HTMLElement>(
      '[data-testid="agent-thread-block:1:approval"]',
    );
    const otherGroup = container.querySelector<HTMLElement>(
      '[data-testid="agent-thread-block:2:other"]',
    );

    expect(approvalGroup).not.toBeNull();
    expect(otherGroup).not.toBeNull();
    expect(container.textContent).toContain("请确认是否继续");
    expect(container.textContent).toContain("workspace_sync");
  });

  it("应按真实发生顺序渲染思考与工具块", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("browser-1", 1),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://example.com" },
      },
      {
        ...createBaseItem("summary-1", 2),
        type: "turn_summary",
        text: "页面已打开",
      },
      {
        ...createBaseItem("search-1", 3),
        type: "web_search",
        action: "web_search",
        query: "封面尺寸",
      },
    ];

    const container = renderTimeline(items);
    const blockIds = Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-testid^='agent-thread-block:']",
      ),
    )
      .map((node) => node.dataset.testid)
      .filter((value): value is string => Boolean(value))
      .filter(
        (value) =>
          !value.endsWith(":shell") &&
          !value.endsWith(":details"),
      );

    expect(blockIds).toEqual([
      "agent-thread-block:1:browser",
      "agent-thread-block:2:thinking",
      "agent-thread-block:3:search",
    ]);
  });

  it("运行中的块应高亮，已完成块应降噪", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("browser-1", 1),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://example.com" },
      },
      {
        ...createBaseItem("search-1", 2),
        status: "in_progress",
        completed_at: undefined,
        updated_at: at(2),
        type: "web_search",
        action: "web_search",
        query: "Mac mini 最新价格",
      },
      {
        ...createBaseItem("other-1", 3),
        type: "tool_call",
        tool_name: "workspace_sync",
      },
    ];

    const container = renderTimeline(items, { isCurrentTurn: true });
    const browserBlock = container.querySelector<HTMLElement>(
      '[data-testid="agent-thread-block:1:browser"]',
    );
    const searchBlock = container.querySelector<HTMLElement>(
      '[data-testid="agent-thread-block:2:search"]',
    );
    const otherBlock = container.querySelector<HTMLElement>(
      '[data-testid="agent-thread-block:3:other"]',
    );

    expect(browserBlock?.dataset.emphasis).toBe("quiet");
    expect(searchBlock?.dataset.emphasis).toBe("active");
    expect(otherBlock?.dataset.emphasis).toBe("quiet");
    expect(container.textContent).toContain("Mac mini 最新价格");
  });

  it("浏览器前置等待时应显示轻量待继续提示", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("browser-1", 1),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://mp.weixin.qq.com" },
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "aborted",
      },
      actionRequests: [
        {
          requestId: "req-browser",
          actionType: "ask_user",
          status: "pending",
          uiKind: "browser_preflight",
          browserPrepState: "awaiting_user",
          prompt: "请先在浏览器完成登录。",
          detail: "浏览器已经打开，请先完成登录、扫码或验证码后继续。",
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="agent-thread-inline-status"]')
        ?.textContent,
    ).toContain("待继续");
    expect(container.textContent).toContain("完成登录");
    expect(container.textContent).not.toContain("已中断");
  });

  it("普通 aborted 回合应显示已暂停提示", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("other-1", 1),
        type: "tool_call",
        tool_name: "workspace_sync",
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "aborted",
      },
    });

    expect(
      container.querySelector('[data-testid="agent-thread-inline-status"]')
        ?.textContent,
    ).toContain("已暂停");
    expect(container.textContent).not.toContain("已中断");
  });

  it("思考摘要中的 A2UI 代码块应切换为结构化预览", () => {
    parseAIResponseMock.mockReturnValue({
      parts: [
        { type: "text", content: "请先确认以下选项：" },
        {
          type: "a2ui",
          content: {
            id: "form-1",
            root: "root",
            components: [],
            submitAction: {
              label: "提交",
              action: { name: "submit" },
            },
          },
        },
      ],
      hasA2UI: true,
      hasWriteFile: false,
      hasPending: false,
    });

    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("summary-1", 1),
        status: "in_progress",
        completed_at: undefined,
        updated_at: at(1),
        type: "turn_summary",
        text: "```a2ui\n{}\n```",
      },
    ];

    const container = renderTimeline(items, {
      isCurrentTurn: true,
      turn: {
        status: "running",
      },
    });

    expect(
      container.querySelector('[data-testid="timeline-a2ui-card"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("请先确认以下选项：");
    expect(container.textContent).not.toContain("```a2ui");
  });

  it("纯 reasoning 阶段仅在时间线中出现一次", () => {
    const reasoningText = "先核对执行链路，再立即恢复当前运行。";
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("reasoning-1", 1),
        type: "reasoning",
        text: reasoningText,
      },
    ];

    const container = renderTimeline(items, {
      isCurrentTurn: true,
      turn: {
        status: "running",
      },
    });

    expect(
      container.querySelector('[data-testid="agent-thread-block:1:thinking:details"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("思考摘要");
    expect((container.textContent?.split(reasoningText).length ?? 1) - 1).toBe(1);
  });

  it("已完成的思考应默认折叠，只保留摘要行", () => {
    const reasoningText = "先核对执行链路，再立即恢复当前运行。\n随后补齐自动续提。";
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("reasoning-1", 1),
        type: "reasoning",
        text: reasoningText,
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "completed",
      },
    });

    const block = container.querySelector<HTMLDetailsElement>(
      '[data-testid="agent-thread-block:1:thinking"]',
    );
    const summary = block?.querySelector("summary");

    expect(block?.open).toBe(false);
    expect(summary?.textContent).toContain("已完成思考");
    expect(summary?.textContent).toContain("先核对执行链路，再立即恢复当前运行。");
    expect(container.textContent).not.toContain("随后补齐自动续提。");

    act(() => {
      summary?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(block?.open).toBe(true);
    expect(container.textContent).toContain("随后补齐自动续提。");
  });

  it("已完成的 request_user_input 应以只读 A2UI 卡片回显", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("input-1", 1),
        type: "request_user_input",
        request_id: "req-ask-1",
        action_type: "ask_user",
        prompt: "请选择执行模式",
        questions: [
          {
            question: "请选择执行模式",
            options: [{ label: "自动执行" }, { label: "确认后执行" }],
          },
        ],
        response: { answer: "自动执行" },
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "completed",
      },
    });

    expect(
      container.querySelector('[data-testid="timeline-a2ui-card"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="decision-panel"]')).toBeNull();
  });

  it("真实协作成员 item 应支持查看协作详情", () => {
    const onOpenSubagentSession = vi.fn();
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("subagent-1", 1),
        type: "subagent_activity",
        status: "completed",
        status_label: "completed",
        title: "Image #1",
        summary: "封面图已生成",
        role: "image_editor",
        model: "gpt-image-1",
        session_id: "child-session-1",
      },
    ];

    const container = renderTimeline(items, {
      onOpenSubagentSession,
    });

    expect(container.textContent).toContain("图片任务 1");
    expect(container.textContent).not.toContain("Image #1");

    const button = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((element) => element.textContent?.includes("查看协作详情"));

    expect(button).toBeTruthy();

    act(() => {
      button?.click();
    });

    expect(onOpenSubagentSession).toHaveBeenCalledWith("child-session-1");
  });
});
