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

const parseAIResponseMock = vi.fn();

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
  ToolCallItem: ({ toolCall }: { toolCall: { name: string } }) => (
    <div data-testid="tool-call-item">{toolCall.name}</div>
  ),
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
    actionRequests?: ActionRequired[];
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
        actionRequests={props?.actionRequests}
        isCurrentTurn={props?.isCurrentTurn}
      />,
    );
  });

  mountedRoots.push({ container, root });
  return container;
}

describe("AgentThreadTimeline", () => {
  it("应渲染本回合概览与按时序组织的分组块", () => {
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
      container.querySelector('[data-testid="agent-thread-summary"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-summary-shell"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("本回合摘要");
    expect(container.textContent).toContain("4 段流程");
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
    expect(container.textContent).toContain("技术细节");
  });

  it("审批块应默认展开，技术细节块默认折叠", () => {
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
    expect(container.textContent).toContain("低优先级技术细节");
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
      container.querySelector('[data-testid="timeline-a2ui-card"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("请先确认以下选项：");
    expect(container.textContent).not.toContain("```a2ui");
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
});
