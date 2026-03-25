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
const mockToolCallItem = vi.fn(
  ({
    toolCall,
    onOpenSavedSiteContent,
  }: {
    toolCall: { name: string };
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
      {toolCall.name}
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
    toolCall: { name: string };
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

function clickTimelineToggle(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>(
    '[data-testid="agent-thread-details-toggle"]',
  );
  if (!button) {
    throw new Error("未找到执行细节切换按钮");
  }

  act(() => {
    button.click();
  });
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
  it("file_artifact 命中多个 block 时应提供精确跳转按钮", () => {
    const onOpenArtifactFromTimeline = vi.fn();
    const container = renderTimeline([createFileArtifactItem()], {
      onOpenArtifactFromTimeline,
    });

    clickTimelineToggle(container);

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

    expect(
      container.querySelector('[data-testid="agent-thread-details"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-details-toggle"]'),
    ).toBeNull();

    const focusedEntry = container.querySelector<HTMLElement>(
      '[data-thread-item-id="browser-1"]',
    );
    expect(focusedEntry?.className).toContain("ring-2");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("应向时间线内的工具项透传已保存站点内容打开回调", () => {
    const onOpenSavedSiteContent = vi.fn();
    const container = renderTimeline(
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

    clickTimelineToggle(container);

    expect(mockToolCallItem).toHaveBeenCalledWith(
      expect.objectContaining({ onOpenSavedSiteContent }),
    );
  });

  it("应在时间线头部展示当前 turn 的 compact outcome 与 incident 徽标", () => {
    const container = renderTimeline(
      [
        {
          ...createBaseItem("summary-1", 1),
          type: "turn_summary",
          text: "最近一次 Provider 调用失败，等待人工处理。",
        },
      ],
      {
        threadRead: {
          thread_id: "thread-1",
          status: "failed",
          active_turn_id: "turn-1",
          pending_requests: [],
          last_outcome: {
            thread_id: "thread-1",
            turn_id: "turn-1",
            outcome_type: "failed_provider",
            summary: "Provider 请求失败",
            primary_cause: "429 rate limited",
            retryable: true,
            ended_at: at(9),
          },
          incidents: [
            {
              id: "incident-1",
              thread_id: "thread-1",
              turn_id: "turn-1",
              incident_type: "provider_failure",
              severity: "high",
              status: "active",
              title: "Provider 连续失败",
            },
          ],
        },
      },
    );

    expect(
      container.querySelector('[data-testid="agent-thread-compact-outcome"]')
        ?.textContent,
    ).toContain("Provider 失败");
    expect(
      container.querySelector('[data-testid="agent-thread-compact-incident"]')
        ?.textContent,
    ).toContain("1 个 incident");

    clickTimelineToggle(container);

    expect(
      container.querySelector('[data-testid="agent-thread-summary-outcome"]')
        ?.textContent,
    ).toContain("Provider 失败");
    expect(
      container.querySelector('[data-testid="agent-thread-summary-incident"]')
        ?.textContent,
    ).toContain("1 个 incident");
  });

  it("应渲染当前阶段概览与按时序组织的分组块", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("plan-1", 1),
        type: "plan",
        text: "1. 打开 CDP 页面\n2. 检查登录态",
      },
      {
        ...createBaseItem("summary-1", 2),
        type: "turn_summary",
        text: "已完成页面检查\n可以继续执行发布。",
      },
      {
        ...createBaseItem("browser-1", 3),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://mp.weixin.qq.com" },
      },
      {
        ...createBaseItem("browser-2", 4),
        type: "tool_call",
        tool_name: "browser_click",
        arguments: { selector: "#publish" },
      },
      {
        ...createBaseItem("approval-1", 5),
        type: "approval_request",
        request_id: "req-1",
        action_type: "tool_confirmation",
        prompt: "请确认是否发布文章",
        tool_name: "browser_click",
      },
      {
        ...createBaseItem("other-1", 6),
        type: "tool_call",
        tool_name: "workspace_sync",
      },
    ];

    const container = renderTimeline(items, { isCurrentTurn: true });

    expect(
      container.querySelector('[data-testid="agent-thread-overview"]')
        ?.textContent,
    ).toContain("已完成页面检查");
    expect(
      container.querySelector('[data-testid="agent-thread-details-inline-text"]')
        ?.textContent,
    ).toContain("思考与计划");
    const overviewNode = container.querySelector('[data-testid="agent-thread-overview"]');
    const toggleNode = container.querySelector('[data-testid="agent-thread-details-toggle"]');
    expect(
      Boolean(
        overviewNode &&
          toggleNode &&
          overviewNode.compareDocumentPosition(toggleNode) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      container.querySelector('[data-testid="agent-thread-flow"]'),
    ).toBeNull();

    clickTimelineToggle(container);

    expect(
      container.querySelector('[data-testid="agent-thread-summary"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-overview"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-details-inline-text"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-details-toggle"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-summary-collapse"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("当前任务摘要");
    expect(
      container.querySelector('[data-testid="agent-thread-summary-header"]')
        ?.textContent,
    ).not.toContain("段流程");
    expect(
      container.querySelector('[data-testid="agent-thread-summary-header"]')
        ?.textContent,
    ).not.toContain("已完成");
    expect(
      container.querySelector('[data-testid="agent-thread-summary-shell"]'),
    ).not.toBeNull();

    expect(
      container.querySelector('[data-testid="agent-thread-goal"]')?.textContent,
    ).toContain("请检查并发布文章");
    expect(
      container.querySelector('[data-testid="agent-thread-focus"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("已完成页面检查");
    expect(
      container.querySelector('[data-testid="agent-thread-flow"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("思考与计划");
    expect(container.textContent).toContain("浏览器操作");
    expect(container.textContent).toContain("需要你处理");
    expect(container.textContent).toContain("执行过程");
  });

  it("展开后应在摘要头提供收起入口，并恢复折叠态头部", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("summary-1", 1),
        type: "turn_summary",
        text: "已整理出下一步执行顺序。",
      },
      {
        ...createBaseItem("browser-1", 2),
        type: "tool_call",
        tool_name: "browser_click",
        arguments: { selector: "#publish" },
      },
    ];

    const container = renderTimeline(items, {
      isCurrentTurn: true,
      turn: {
        status: "running",
      },
    });

    clickTimelineToggle(container);

    const collapseButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="agent-thread-summary-collapse"]',
    );
    expect(collapseButton).not.toBeNull();

    act(() => {
      collapseButton?.click();
    });

    expect(
      container.querySelector('[data-testid="agent-thread-summary"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-details-toggle"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-overview"]'),
    ).not.toBeNull();
  });

  it("审批块应默认展开，处理记录块默认折叠", () => {
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

    expect(
      container.querySelector('[data-testid="agent-thread-flow"]'),
    ).toBeNull();

    clickTimelineToggle(container);

    const approvalGroup = container.querySelector<HTMLElement>(
      '[data-testid="agent-thread-block:1:approval"]',
    );
    const otherGroup = container.querySelector<HTMLElement>(
      '[data-testid="agent-thread-block:2:other"]',
    );

    expect(approvalGroup?.hasAttribute("open")).toBe(true);
    expect(otherGroup?.hasAttribute("open")).toBe(false);
    expect(
      container.querySelector('[data-testid="agent-thread-block:1:approval:rail"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="agent-thread-block:1:approval:details"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="agent-thread-block:2:other:details"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("次要执行记录");
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
    clickTimelineToggle(container);
    const blockIds = Array.from(
      container.querySelectorAll<HTMLElement>(
        "details[data-testid^='agent-thread-block:']",
      ),
    )
      .map((node) => node.dataset.testid)
      .filter((value): value is string => Boolean(value));

    expect(blockIds).toEqual([
      "agent-thread-block:1:browser",
      "agent-thread-block:2:thinking",
      "agent-thread-block:3:search",
    ]);
  });

  it("完成后折叠条仍应保留最近的思考过程", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("browser-1", 1),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://example.com" },
      },
      {
        ...createBaseItem("plan-1", 2),
        type: "plan",
        text: "先梳理问题背景，再给出三套方案。",
      },
      {
        ...createBaseItem("browser-2", 3),
        type: "tool_call",
        tool_name: "browser_click",
        arguments: { selector: "#submit" },
      },
    ];

    const container = renderTimeline(items, {
      isCurrentTurn: true,
      turn: {
        status: "completed",
      },
    });

    expect(
      container.querySelector('[data-testid="agent-thread-overview"]')
        ?.textContent,
    ).toContain("先梳理问题背景");
    expect(
      container.querySelector('[data-testid="agent-thread-details-stage"]')
        ?.textContent,
    ).toContain("步骤 02");
    expect(
      container.querySelector('[data-testid="agent-thread-details-inline-text"]')
        ?.textContent,
    ).toContain("思考与计划");
  });

  it("运行中的块应被高亮，已完成块应降噪", () => {
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

    expect(
      container.querySelector('[data-testid="agent-thread-details-inline-icon"]')
        ?.getAttribute("data-state"),
    ).toBe("running");
    expect(
      container.querySelector('[data-testid="agent-thread-details-inline-text"]')
        ?.textContent,
    ).toContain("Mac mini 最新价格");

    clickTimelineToggle(container);
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
    expect(browserBlock?.hasAttribute("open")).toBe(true);
    expect(searchBlock?.hasAttribute("open")).toBe(true);
    expect(otherBlock?.hasAttribute("open")).toBe(false);
    expect(container.textContent).toContain("执行中");
  });

  it("流程展开后不应重复显示顶部当前进展卡片", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("search-1", 1),
        status: "in_progress",
        completed_at: undefined,
        updated_at: at(1),
        type: "web_search",
        action: "web_search",
        query: "team runtime 侧栏高度",
      },
    ];

    const container = renderTimeline(items, {
      isCurrentTurn: true,
      turn: {
        status: "running",
      },
    });

    clickTimelineToggle(container);

    expect(
      container.querySelector('[data-testid="agent-thread-details"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-overview"]'),
    ).toBeNull();
    expect(container.textContent).toContain("当前任务摘要");
  });

  it("浏览器前置等待时不应显示已中断，而应显示待继续", () => {
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

    expect(container.textContent).toContain("待继续");
    expect(container.textContent).toContain("完成登录");
    expect(container.textContent).not.toContain("已中断");

    clickTimelineToggle(container);

    expect(
      container
        .querySelector<HTMLElement>('[data-testid="agent-thread-block:1:browser"]')
        ?.hasAttribute("open"),
    ).toBe(true);
  });

  it("普通 aborted 回合应显示已暂停，而不是已中断", () => {
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

    expect(container.textContent).toContain("已暂停");
    expect(container.textContent).not.toContain("已中断");
  });

  it("单个已完成阶段不应再默认展开", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("summary-1", 1),
        type: "turn_summary",
        text: "已整理为 notebook 工作方式。",
      },
    ];

    const container = renderTimeline(items, {
      isCurrentTurn: true,
      turn: {
        status: "completed",
      },
    });

    expect(
      container.querySelector('[data-testid="agent-thread-flow"]'),
    ).toBeNull();

    clickTimelineToggle(container);

    expect(
      container
        .querySelector<HTMLElement>('[data-testid="agent-thread-block:1:thinking"]')
        ?.hasAttribute("open"),
    ).toBe(false);
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
      container.querySelector('[data-testid="agent-thread-flow"]'),
    ).toBeNull();

    clickTimelineToggle(container);

    expect(
      container.querySelector('[data-testid="timeline-a2ui-card"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("请先确认以下选项：");
    expect(container.textContent).not.toContain("```a2ui");
  });

  it("纯 reasoning 阶段展开后不应重复渲染思考摘要卡", () => {
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

    clickTimelineToggle(container);

    expect(
      container.querySelector('[data-testid="agent-thread-block:1:thinking:details"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("思考摘要");
    expect((container.textContent?.split(reasoningText).length ?? 1) - 1).toBe(1);
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

    clickTimelineToggle(container);

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

    clickTimelineToggle(container);

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
