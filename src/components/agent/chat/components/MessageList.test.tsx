import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import type { Message } from "../types";

vi.mock("./MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content || "<empty>"}</div>
  ),
}));

const mockStreamingRenderer = vi.fn(
  ({
    content,
    onOpenSavedSiteContent,
    suppressProcessFlow,
    showRuntimeStatusInline,
    renderProposedPlanBlocks,
    showContentBlockActions,
    onQuoteContent,
  }: {
    content: string;
    renderA2UIInline?: boolean;
    suppressedActionRequestId?: string | null;
    suppressProcessFlow?: boolean;
    showRuntimeStatusInline?: boolean;
    renderProposedPlanBlocks?: boolean;
    showContentBlockActions?: boolean;
    onQuoteContent?: (content: string) => void;
    onOpenSavedSiteContent?: (target: {
      projectId: string;
      contentId: string;
      title?: string;
    }) => void;
  }) => (
    <div
      data-testid="streaming-renderer"
      data-has-open-saved-site-content={onOpenSavedSiteContent ? "yes" : "no"}
      data-suppress-process-flow={suppressProcessFlow ? "yes" : "no"}
      data-show-runtime-status-inline={
        showRuntimeStatusInline ? "yes" : "no"
      }
      data-render-proposed-plan-blocks={
        renderProposedPlanBlocks ? "yes" : "no"
      }
      data-show-content-block-actions={showContentBlockActions ? "yes" : "no"}
      data-has-on-quote-content={onQuoteContent ? "yes" : "no"}
    >
      {content || "<empty-assistant>"}
    </div>
  ),
);
const mockAgentThreadTimeline = vi.fn(
  ({
    actionRequests,
    onOpenSavedSiteContent,
    placement,
  }: {
    actionRequests?: Array<Record<string, unknown>>;
    onOpenSavedSiteContent?: (target: {
      projectId: string;
      contentId: string;
      title?: string;
    }) => void;
    placement?: "leading" | "trailing" | "default";
  }) => (
    <div
      data-testid={`agent-thread-timeline:${placement || "default"}`}
      data-has-open-saved-site-content={onOpenSavedSiteContent ? "yes" : "no"}
    >
      执行轨迹{actionRequests?.length ? `:${actionRequests.length}` : ""}
    </div>
  ),
);

vi.mock("./StreamingRenderer", () => ({
  StreamingRenderer: (props: {
    content: string;
    renderA2UIInline?: boolean;
    suppressedActionRequestId?: string | null;
  }) => mockStreamingRenderer(props),
}));

vi.mock("./TokenUsageDisplay", () => ({
  TokenUsageDisplay: () => <div data-testid="token-usage-display" />,
}));

vi.mock("./AgentThreadTimeline", () => ({
  AgentThreadTimeline: (props: {
    actionRequests?: Array<Record<string, unknown>>;
    placement?: "leading" | "trailing" | "default";
  }) => mockAgentThreadTimeline(props),
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
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }
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

function render(
  messages: Message[],
  props?: Partial<React.ComponentProps<typeof MessageList>>,
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<MessageList messages={messages} {...props} />);
  });

  mountedRoots.push({ container, root });
  return container;
}

describe("MessageList", () => {
  it("应过滤空白 user 消息，避免渲染空白气泡", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-user-empty",
        role: "user",
        content: "",
        timestamp: now,
      },
      {
        id: "msg-user-text",
        role: "user",
        content: "请继续生成",
        timestamp: now,
      },
      {
        id: "msg-assistant",
        role: "assistant",
        content: "好的，我继续处理。",
        timestamp: now,
      },
    ];

    const container = render(messages);

    const markdownTexts = Array.from(
      container.querySelectorAll('[data-testid="markdown-renderer"]'),
    ).map((node) => node.textContent);
    expect(markdownTexts).toEqual(["请继续生成"]);

    const streamingTexts = Array.from(
      container.querySelectorAll('[data-testid="streaming-renderer"]'),
    ).map((node) => node.textContent);
    expect(streamingTexts).toEqual(["好的，我继续处理。"]);
  });

  it("应向助手消息透传内联 A2UI 开关", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant",
        role: "assistant",
        content: "```a2ui\n{}\n```",
        timestamp: now,
      },
    ];

    render(messages);
    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ renderA2UIInline: true }),
    );

    render(messages, { renderA2UIInline: false });
    expect(mockStreamingRenderer).toHaveBeenLastCalledWith(
      expect.objectContaining({ renderA2UIInline: false }),
    );
  });

  it("当前由聊天区底部承载的 assistant A2UI 不应继续在正文里内联渲染", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-active-a2ui",
        role: "assistant",
        content: "```a2ui\n{}\n```",
        timestamp: now,
      },
    ];

    render(messages, {
      activePendingA2UISource: {
        kind: "assistant_message",
        messageId: "msg-assistant-active-a2ui",
      },
    });

    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ renderA2UIInline: false }),
    );
  });

  it("当前由聊天区底部承载的 action_request 不应继续在正文里渲染内联确认卡", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-action",
        role: "assistant",
        content: "请先确认执行方式。",
        timestamp: now,
        actionRequests: [
          {
            requestId: "req-action-1",
            actionType: "ask_user",
            status: "pending",
            prompt: "请选择执行方式",
            questions: [{ question: "请选择执行方式" }],
          },
        ],
      },
    ];

    render(messages, {
      activePendingA2UISource: {
        kind: "action_request",
        requestId: "req-action-1",
      },
    });

    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ suppressedActionRequestId: "req-action-1" }),
    );
  });

  it("应向助手消息正文透传已保存站点内容打开回调", () => {
    const onOpenSavedSiteContent = vi.fn();
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-site-open",
        role: "assistant",
        content: "已保存站点结果。",
        timestamp: now,
      },
    ];

    render(messages, { onOpenSavedSiteContent });

    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ onOpenSavedSiteContent }),
    );
  });

  it("存在主执行轨迹时不应再默认压掉正文过程流", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-process-suppressed",
        role: "assistant",
        content: "最终说明",
        timestamp: now,
      },
    ];

    render(messages, {
      currentTurnId: "turn-process-suppressed",
      turns: [
        {
          id: "turn-process-suppressed",
          thread_id: "thread-1",
          prompt_text: "继续执行",
          status: "running",
          started_at: "2026-03-28T12:00:00Z",
          created_at: "2026-03-28T12:00:00Z",
          updated_at: "2026-03-28T12:00:01Z",
        },
      ],
      threadItems: [
        {
          id: "item-process-suppressed",
          thread_id: "thread-1",
          turn_id: "turn-process-suppressed",
          sequence: 1,
          status: "completed",
          started_at: "2026-03-28T12:00:01Z",
          completed_at: "2026-03-28T12:00:02Z",
          updated_at: "2026-03-28T12:00:02Z",
          type: "tool_call",
          tool_name: "functions.exec_command",
          arguments: { cmd: "rg -n process src" },
        },
      ],
    });

    expect(mockStreamingRenderer).not.toHaveBeenCalledWith(
      expect.objectContaining({ suppressProcessFlow: true }),
    );
  });

  it("正文已承载工具调用时，不应再把执行轨迹提前到消息顶部", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-inline-tool",
        role: "assistant",
        content: "已经定位到问题根因。",
        timestamp: now,
        contentParts: [
          {
            type: "tool_use",
            toolCall: {
              id: "tool-inline-1",
              name: "functions.exec_command",
              arguments: JSON.stringify({ cmd: "rg -n issue src" }),
              status: "completed",
              result: { success: true, output: "ok" },
              startTime: now,
              endTime: now,
            },
          },
          {
            type: "text",
            text: "已经定位到问题根因。",
          },
        ],
      },
    ];

    const container = render(messages, {
      currentTurnId: "turn-inline-tool",
      turns: [
        {
          id: "turn-inline-tool",
          thread_id: "thread-1",
          prompt_text: "继续排查",
          status: "completed",
          started_at: "2026-03-28T12:00:00Z",
          completed_at: "2026-03-28T12:00:03Z",
          created_at: "2026-03-28T12:00:00Z",
          updated_at: "2026-03-28T12:00:03Z",
        },
      ],
      threadItems: [
        {
          id: "item-inline-tool",
          thread_id: "thread-1",
          turn_id: "turn-inline-tool",
          sequence: 1,
          status: "completed",
          started_at: "2026-03-28T12:00:01Z",
          completed_at: "2026-03-28T12:00:02Z",
          updated_at: "2026-03-28T12:00:02Z",
          type: "tool_call",
          tool_name: "functions.exec_command",
          arguments: { cmd: "rg -n issue src" },
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="agent-thread-timeline:leading"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-timeline:trailing"]'),
    ).toBeNull();
    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        renderProposedPlanBlocks: true,
      }),
    );
  });

  it("正文已承载过程流时，未被正文承载的计划信息仍应保留在消息前序", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-inline-process",
        role: "assistant",
        content: "已经整理完执行思路。",
        timestamp: now,
        contentParts: [
          {
            type: "thinking",
            text: "先对照用户截图，再确认 thread item 是否有重复来源。",
          },
          {
            type: "text",
            text: "已经整理完执行思路。",
          },
        ],
      },
    ];

    const container = render(messages, {
      currentTurnId: "turn-inline-process",
      turns: [
        {
          id: "turn-inline-process",
          thread_id: "thread-1",
          prompt_text: "继续收口消息流",
          status: "completed",
          started_at: "2026-03-29T12:00:00Z",
          completed_at: "2026-03-29T12:00:03Z",
          created_at: "2026-03-29T12:00:00Z",
          updated_at: "2026-03-29T12:00:03Z",
        },
      ],
      threadItems: [
        {
          id: "item-inline-process-plan",
          thread_id: "thread-1",
          turn_id: "turn-inline-process",
          sequence: 1,
          status: "completed",
          started_at: "2026-03-29T12:00:01Z",
          completed_at: "2026-03-29T12:00:02Z",
          updated_at: "2026-03-29T12:00:02Z",
          type: "plan",
          text: "1. 合并 assistant turn\n2. 收拢补充 timeline",
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="agent-thread-timeline:leading"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-timeline:trailing"]'),
    ).toBeNull();
    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        renderProposedPlanBlocks: true,
      }),
    );
  });

  it("正文已承载过程流时，file_artifact 仍应作为尾部补充信息展示", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-inline-artifact",
        role: "assistant",
        content: "结果已经整理好了。",
        timestamp: now,
        contentParts: [
          {
            type: "thinking",
            text: "先整理结果，再把产物路径落盘。",
          },
          {
            type: "text",
            text: "结果已经整理好了。",
          },
        ],
      },
    ];

    const container = render(messages, {
      currentTurnId: "turn-inline-artifact",
      turns: [
        {
          id: "turn-inline-artifact",
          thread_id: "thread-1",
          prompt_text: "继续整理产物",
          status: "completed",
          started_at: "2026-03-29T13:00:00Z",
          completed_at: "2026-03-29T13:00:03Z",
          created_at: "2026-03-29T13:00:00Z",
          updated_at: "2026-03-29T13:00:03Z",
        },
      ],
      threadItems: [
        {
          id: "item-inline-artifact",
          thread_id: "thread-1",
          turn_id: "turn-inline-artifact",
          sequence: 1,
          status: "completed",
          started_at: "2026-03-29T13:00:01Z",
          completed_at: "2026-03-29T13:00:02Z",
          updated_at: "2026-03-29T13:00:02Z",
          type: "file_artifact",
          path: "notes/agent-summary.md",
          source: "artifact_snapshot",
          content: "# Summary",
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="agent-thread-timeline:leading"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-timeline:trailing"]'),
    ).not.toBeNull();
  });

  it("运行中的 turn_summary 应作为尾部过程状态展示，而不是顶到消息头部", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-running-summary",
        role: "assistant",
        content: "",
        timestamp: now,
      },
    ];

    const container = render(messages, {
      currentTurnId: "turn-running-summary",
      turns: [
        {
          id: "turn-running-summary",
          thread_id: "thread-1",
          prompt_text: "继续搜索 GitHub",
          status: "running",
          started_at: "2026-03-30T10:00:00Z",
          created_at: "2026-03-30T10:00:00Z",
          updated_at: "2026-03-30T10:00:05Z",
        },
      ],
      threadItems: [
        {
          id: "summary-running-1",
          thread_id: "thread-1",
          turn_id: "turn-running-summary",
          sequence: 1,
          status: "in_progress",
          started_at: "2026-03-30T10:00:00Z",
          updated_at: "2026-03-30T10:00:05Z",
          type: "turn_summary",
          text: "正在打开 GitHub 搜索页",
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="agent-thread-timeline:leading"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-timeline:trailing"]'),
    ).not.toBeNull();
  });

  it("正文已有 runtime status 时，运行中的 turn_summary 不应再重复进入时间线", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-runtime-status",
        role: "assistant",
        content: "",
        timestamp: now,
        isThinking: true,
        runtimeStatus: {
          phase: "routing",
          title: "正在打开 GitHub",
          detail: "已连上浏览器，准备进入搜索页。",
          checkpoints: ["浏览器已就绪"],
        },
      },
    ];

    const container = render(messages, {
      currentTurnId: "turn-runtime-status",
      turns: [
        {
          id: "turn-runtime-status",
          thread_id: "thread-1",
          prompt_text: "继续搜索 GitHub",
          status: "running",
          started_at: "2026-03-30T10:10:00Z",
          created_at: "2026-03-30T10:10:00Z",
          updated_at: "2026-03-30T10:10:05Z",
        },
      ],
      threadItems: [
        {
          id: "summary-runtime-status-1",
          thread_id: "thread-1",
          turn_id: "turn-runtime-status",
          sequence: 1,
          status: "in_progress",
          started_at: "2026-03-30T10:10:00Z",
          updated_at: "2026-03-30T10:10:05Z",
          type: "turn_summary",
          text: "正在打开 GitHub 搜索页",
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="agent-thread-timeline:leading"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-timeline:trailing"]'),
    ).toBeNull();
    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        showRuntimeStatusInline: true,
      }),
    );
  });

  it("已完成且已有真实过程项的 turn_summary 不应再单独占用消息头部或尾部", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-finished-summary",
        role: "assistant",
        content: "已经打开 GitHub 并完成搜索。",
        timestamp: now,
      },
    ];

    const container = render(messages, {
      currentTurnId: "turn-finished-summary",
      turns: [
        {
          id: "turn-finished-summary",
          thread_id: "thread-1",
          prompt_text: "帮我找 AI Agent 项目",
          status: "completed",
          started_at: "2026-03-30T11:00:00Z",
          completed_at: "2026-03-30T11:00:05Z",
          created_at: "2026-03-30T11:00:00Z",
          updated_at: "2026-03-30T11:00:05Z",
        },
      ],
      threadItems: [
        {
          id: "summary-finished-1",
          thread_id: "thread-1",
          turn_id: "turn-finished-summary",
          sequence: 1,
          status: "completed",
          started_at: "2026-03-30T11:00:00Z",
          completed_at: "2026-03-30T11:00:01Z",
          updated_at: "2026-03-30T11:00:01Z",
          type: "turn_summary",
          text: "已打开 GitHub 搜索页面",
        },
        {
          id: "tool-finished-1",
          thread_id: "thread-1",
          turn_id: "turn-finished-summary",
          sequence: 2,
          status: "completed",
          started_at: "2026-03-30T11:00:02Z",
          completed_at: "2026-03-30T11:00:04Z",
          updated_at: "2026-03-30T11:00:04Z",
          type: "tool_call",
          tool_name: "browser_navigate",
          arguments: { url: "https://github.com/search?q=ai+agent" },
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="agent-thread-timeline:leading"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-timeline:trailing"]'),
    ).toBeNull();
    expect(mockAgentThreadTimeline).toHaveBeenCalledTimes(1);
  });

  it("应按回合分组展示同一轮用户与后续助手回复", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-user-1",
        role: "user",
        content: "先打开公众号后台",
        timestamp: new Date(now.getTime()),
      },
      {
        id: "msg-assistant-1",
        role: "assistant",
        content: "已打开登录页。",
        timestamp: new Date(now.getTime() + 1000),
      },
      {
        id: "msg-assistant-2",
        role: "assistant",
        content: "等待你完成扫码。",
        timestamp: new Date(now.getTime() + 2000),
      },
      {
        id: "msg-user-2",
        role: "user",
        content: "我已扫码，继续发布",
        timestamp: new Date(now.getTime() + 3000),
      },
      {
        id: "msg-assistant-3",
        role: "assistant",
        content: "已继续执行发布流程。",
        timestamp: new Date(now.getTime() + 4000),
      },
    ];

    const container = render(messages);
    const groups = Array.from(
      container.querySelectorAll('[data-testid="message-turn-group"]'),
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]?.textContent).toContain("先打开公众号后台");
    expect(groups[0]?.textContent).toContain("已打开登录页。");
    expect(groups[0]?.textContent).toContain("等待你完成扫码。");
    expect(groups[1]?.textContent).toContain("我已扫码，继续发布");
    expect(groups[1]?.textContent).toContain("已继续执行发布流程。");
    expect(
      container.querySelector('[data-testid="message-turn-group:1:header"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="message-turn-group:2:divider"]'),
    ).toBeNull();
  });

  it("传入 onQuoteMessage 时应渲染引用按钮并回调消息内容", () => {
    const onQuoteMessage = vi.fn();
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-user-quote",
        role: "user",
        content: "请引用这一段内容",
        timestamp: now,
      },
    ];

    const container = render(messages, { onQuoteMessage });
    const quoteButton = container.querySelector(
      'button[aria-label="引用消息"]',
    );

    expect(quoteButton).toBeTruthy();

    act(() => {
      quoteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onQuoteMessage).toHaveBeenCalledWith(
      "请引用这一段内容",
      "msg-user-quote",
    );
    expect(container.querySelector('button[aria-label="编辑消息"]')).toBeNull();
  });

  it("助手正文应将区块级引用/复制能力透传给 StreamingRenderer", () => {
    const onQuoteMessage = vi.fn();
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-block-actions",
        role: "assistant",
        content: "这是需要块级操作的输出",
        timestamp: now,
      },
    ];

    render(messages, { onQuoteMessage });

    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        showContentBlockActions: true,
        onQuoteContent: expect.any(Function),
      }),
    );
  });

  it("聊天主列与助手消息气泡应保持更宽的桌面阅读宽度", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-wide-reading",
        role: "assistant",
        content: "这里是一段较长的结构化输出，用于验证桌面阅读宽度。",
        timestamp: now,
      },
    ];

    const container = render(messages);
    const messageColumn = container.querySelector(
      '[data-testid="message-list-column"]',
    );
    const assistantBubble = container.querySelector('[aria-label="Lime"]');

    expect(messageColumn?.className).toContain("max-w-[1040px]");
    expect(assistantBubble).not.toBeNull();
    expect(window.getComputedStyle(assistantBubble as Element).maxWidth).toContain(
      "1040px",
    );
  });

  it("助手消息不应再渲染旧的继续处理标签或品牌头像", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-user-seed",
        role: "user",
        content: "继续",
        timestamp: new Date(now.getTime()),
      },
      {
        id: "msg-assistant-first",
        role: "assistant",
        content: "第一条回复",
        timestamp: new Date(now.getTime() + 1000),
      },
      {
        id: "msg-assistant-second",
        role: "assistant",
        content: "第二条回复",
        timestamp: new Date(now.getTime() + 2000),
      },
    ];

    const container = render(messages);

    expect(container.textContent).not.toContain("阶段 00");
    expect(container.textContent).not.toContain("继续处理");
    expect(container.querySelector('img[alt="Lime"]')).toBeNull();
  });

  it("用户图片消息不应渲染内部图片占位文本", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-user-image",
        role: "user",
        content: "[Image #1]",
        images: [
          {
            mediaType: "image/png",
            data: "aGVsbG8=",
          },
        ],
        timestamp: now,
      },
    ];

    const container = render(messages);

    expect(container.querySelector('[data-testid="markdown-renderer"]')).toBeNull();
    const image = container.querySelector('img[alt="attachment"]');
    expect(image).toBeTruthy();
    expect(container.textContent).not.toContain("[Image #1]");
  });

  it("助手内部图片标签应在主消息里隐藏", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-image",
        role: "assistant",
        content: "[Image #1]",
        timestamp: now,
      },
    ];

    render(messages);

    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "",
      }),
    );
  });

  it("助手消息包含 artifacts 时应渲染产物卡片并响应点击", () => {
    const now = new Date();
    const onArtifactClick = vi.fn();
    const messages: Message[] = [
      {
        id: "msg-assistant-artifact",
        role: "assistant",
        content: "已生成文档",
        timestamp: now,
        artifacts: [
          {
            id: "artifact-demo",
            type: "document",
            title: "demo.md",
            content: "# Demo",
            status: "complete",
            meta: {
              filePath: "docs/demo.md",
              filename: "demo.md",
            },
            position: { start: 0, end: 0 },
            createdAt: now.getTime(),
            updatedAt: now.getTime(),
          },
        ],
      },
    ];

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <MessageList messages={messages} onArtifactClick={onArtifactClick} />,
      );
    });

    mountedRoots.push({ container, root });

    const artifactCard = container.querySelector("button");
    expect(artifactCard?.textContent).toContain("demo.md");
    expect(artifactCard?.textContent).toContain("docs/demo.md");

    act(() => {
      artifactCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onArtifactClick).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "artifact-demo",
        title: "demo.md",
      }),
    );
  });

  it("应先渲染思考与过程，再渲染正文，最后再落产物", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-order",
        role: "assistant",
        content: "已生成发布文案",
        timestamp: now,
        artifacts: [
          {
            id: "artifact-order",
            type: "document",
            title: "publish.md",
            content: "# Publish",
            status: "complete",
            meta: {
              filePath: "articles/publish.md",
              filename: "publish.md",
            },
            position: { start: 0, end: 0 },
            createdAt: now.getTime(),
            updatedAt: now.getTime(),
          },
        ],
      },
    ];

    const container = render(messages, {
      turns: [
        {
          id: "turn-1",
          thread_id: "thread-1",
          prompt_text: "发布文章",
          status: "completed",
          started_at: "2026-03-15T09:00:00Z",
          completed_at: "2026-03-15T09:00:05Z",
          created_at: "2026-03-15T09:00:00Z",
          updated_at: "2026-03-15T09:00:05Z",
        },
      ],
      threadItems: [
        {
          id: "item-1",
          thread_id: "thread-1",
          turn_id: "turn-1",
          sequence: 1,
          status: "completed",
          started_at: "2026-03-15T09:00:01Z",
          completed_at: "2026-03-15T09:00:02Z",
          updated_at: "2026-03-15T09:00:02Z",
          type: "plan",
          text: "1. 打开页面\n2. 发布文章",
        },
      ],
    });

    const streaming = container.querySelector('[data-testid="streaming-renderer"]');
    const leadingTimeline = container.querySelector(
      '[data-testid="agent-thread-timeline:leading"]',
    );
    const artifactButton = Array.from(container.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("publish.md"),
    );

    expect(streaming).not.toBeNull();
    expect(artifactButton).toBeDefined();
    expect(leadingTimeline).not.toBeNull();
    const streamingNode = streaming as Node;
    const timelineNode = leadingTimeline as Node;
    const artifactButtonNode = artifactButton as Node;
    expect(
      timelineNode.compareDocumentPosition(streamingNode) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      streamingNode.compareDocumentPosition(artifactButtonNode) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("助手消息上的 actionRequests 应继续留在正文链路，不再重复透传给 timeline", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-browser",
        role: "assistant",
        content: "请先完成浏览器登录。",
        timestamp: now,
        actionRequests: [
          {
            requestId: "req-browser",
            actionType: "ask_user",
            uiKind: "browser_preflight",
            browserPrepState: "awaiting_user",
            prompt: "请先在浏览器完成登录",
          },
        ],
      },
    ];

    render(messages, {
      turns: [
        {
          id: "turn-browser",
          thread_id: "thread-1",
          prompt_text: "发布到公众号",
          status: "aborted",
          started_at: "2026-03-15T09:00:00Z",
          completed_at: "2026-03-15T09:00:05Z",
          created_at: "2026-03-15T09:00:00Z",
          updated_at: "2026-03-15T09:00:05Z",
        },
      ],
      threadItems: [
        {
          id: "item-browser-1",
          thread_id: "thread-1",
          turn_id: "turn-browser",
          sequence: 1,
          status: "completed",
          started_at: "2026-03-15T09:00:01Z",
          completed_at: "2026-03-15T09:00:02Z",
          updated_at: "2026-03-15T09:00:02Z",
          type: "tool_call",
          tool_name: "browser_navigate",
          arguments: { url: "https://mp.weixin.qq.com" },
        },
      ],
    });

    const timelineProps = mockAgentThreadTimeline.mock.calls.at(-1)?.[0] as
      | {
          actionRequests?: Array<Record<string, unknown>>;
          placement?: string;
        }
      | undefined;

    expect(timelineProps?.placement).toBe("leading");
    expect(timelineProps?.actionRequests).toBeUndefined();
    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        renderProposedPlanBlocks: true,
      }),
    );
  });

  it("应向执行轨迹透传已保存站点内容打开回调", () => {
    const onOpenSavedSiteContent = vi.fn();
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-site-timeline",
        role: "assistant",
        content: "站点结果已沉淀。",
        timestamp: now,
      },
    ];

    render(messages, {
      onOpenSavedSiteContent,
      turns: [
        {
          id: "turn-site-open",
          thread_id: "thread-1",
          prompt_text: "采集站点内容",
          status: "completed",
          started_at: "2026-03-25T09:00:00Z",
          completed_at: "2026-03-25T09:00:05Z",
          created_at: "2026-03-25T09:00:00Z",
          updated_at: "2026-03-25T09:00:05Z",
        },
      ],
      threadItems: [
        {
          id: "item-site-open-1",
          thread_id: "thread-1",
          turn_id: "turn-site-open",
          sequence: 1,
          status: "completed",
          started_at: "2026-03-25T09:00:01Z",
          completed_at: "2026-03-25T09:00:02Z",
          updated_at: "2026-03-25T09:00:02Z",
          type: "tool_call",
          tool_name: "lime_site_run",
          arguments: { adapter_name: "github/search" },
        },
      ],
    });

    expect(mockAgentThreadTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ onOpenSavedSiteContent }),
    );
  });

  it("当前 turn 映射错位时，应优先显示在最后一个助手消息上", () => {
    const messages: Message[] = [
      {
        id: "msg-assistant-earlier",
        role: "assistant",
        content: "先给出一段中间反馈。",
        timestamp: new Date("2026-03-15T09:00:05Z"),
      },
      {
        id: "msg-assistant-latest",
        role: "assistant",
        content: "这是当前回合的最新回复。",
        timestamp: new Date("2026-03-15T09:00:20Z"),
      },
    ];

    const container = render(messages, {
      currentTurnId: "turn-latest",
      turns: [
        {
          id: "turn-latest",
          thread_id: "thread-1",
          prompt_text: "继续执行",
          status: "running",
          started_at: "2026-03-15T09:00:00Z",
          completed_at: "2026-03-15T09:00:06Z",
          created_at: "2026-03-15T09:00:00Z",
          updated_at: "2026-03-15T09:00:06Z",
        },
      ],
      threadItems: [
        {
          id: "item-latest",
          thread_id: "thread-1",
          turn_id: "turn-latest",
          sequence: 1,
          status: "completed",
          started_at: "2026-03-15T09:00:01Z",
          completed_at: "2026-03-15T09:00:02Z",
          updated_at: "2026-03-15T09:00:02Z",
          type: "plan",
          text: "继续执行当前任务",
        },
      ],
    });

    const streamingNodes = Array.from(
      container.querySelectorAll('[data-testid="streaming-renderer"]'),
    );
    const timelineNodes = Array.from(
      container.querySelectorAll('[data-testid="agent-thread-timeline:leading"]'),
    );

    expect(streamingNodes).toHaveLength(2);
    expect(timelineNodes).toHaveLength(1);
    expect(
      (streamingNodes[0] as Node).compareDocumentPosition(timelineNodes[0] as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (timelineNodes[0] as Node).compareDocumentPosition(streamingNodes[1] as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="agent-thread-reliability-panel"]'),
    ).toBeNull();
  });

  it("应不再在消息区渲染 reliability panel，避免占用对话列表空间", () => {
    const messages: Message[] = [
      {
        id: "msg-assistant-earlier",
        role: "assistant",
        content: "较早的中间反馈。",
        timestamp: new Date("2026-03-15T09:00:05Z"),
      },
      {
        id: "msg-assistant-latest",
        role: "assistant",
        content: "最新回合的输出。",
        timestamp: new Date("2026-03-15T09:00:20Z"),
      },
    ];

    const container = render(messages, {
      currentTurnId: "turn-latest",
      turns: [
        {
          id: "turn-latest",
          thread_id: "thread-1",
          prompt_text: "继续执行发布",
          status: "running",
          started_at: "2026-03-15T09:00:00Z",
          created_at: "2026-03-15T09:00:00Z",
          updated_at: "2026-03-15T09:00:06Z",
        },
      ],
      threadItems: [
        {
          id: "item-latest",
          thread_id: "thread-1",
          turn_id: "turn-latest",
          sequence: 1,
          status: "completed",
          started_at: "2026-03-15T09:00:01Z",
          completed_at: "2026-03-15T09:00:02Z",
          updated_at: "2026-03-15T09:00:02Z",
          type: "plan",
          text: "继续执行当前任务",
        },
      ],
      pendingActions: [
        {
          requestId: "req-1",
          actionType: "ask_user",
          prompt: "请确认是否继续发布",
          status: "pending",
        },
      ],
    });

    const timelineNodes = Array.from(
      container.querySelectorAll(
        '[data-testid^="agent-thread-timeline:"]',
      ),
    );

    expect(
      container.querySelector('[data-testid="agent-thread-reliability-panel"]'),
    ).toBeNull();
    expect(timelineNodes).toHaveLength(1);
  });
});
