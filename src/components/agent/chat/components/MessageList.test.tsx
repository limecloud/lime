import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import {
  clearAgentUiPerformanceMetrics,
  getAgentUiPerformanceMetrics,
} from "@/lib/agentUiPerformanceMetrics";

const IMAGE_WORKBENCH_FOCUS_EVENT = "lime:image-workbench-focus";
const VIDEO_WORKBENCH_TASK_ACTION_EVENT = "lime:video-workbench-task-action";
type MockConfiguredProvider = {
  key: string;
  label?: string;
  registryId?: string;
  type?: string;
  providerId?: string;
};

const mockUseConfiguredProviders = vi.fn((_options?: unknown) => ({
  providers: [] as MockConfiguredProvider[],
  loading: false,
}));
const mockFindConfiguredProviderBySelection = vi.fn(
  (
    _providers: MockConfiguredProvider[],
    _selection?: string | null,
  ): MockConfiguredProvider | null => null,
);
const mockTokenUsageDisplay = vi.fn(
  ({
    promptCacheNotice,
    inline,
  }: {
    promptCacheNotice?: {
      label?: string;
    } | null;
    inline?: boolean;
  }) => (
    <div data-testid="token-usage-display" data-inline={inline ? "yes" : "no"}>
      {promptCacheNotice?.label || "token-usage-display"}
    </div>
  ),
);

vi.mock("@/hooks/useConfiguredProviders", () => ({
  useConfiguredProviders: (options?: unknown) =>
    mockUseConfiguredProviders(options),
  findConfiguredProviderBySelection: (
    providers: MockConfiguredProvider[],
    selection?: string | null,
  ) => mockFindConfiguredProviderBySelection(providers, selection),
  resolveConfiguredProviderPromptCacheSupportNotice: (
    providers: MockConfiguredProvider[],
    selection?: string | null,
  ) => {
    const selectedProvider = mockFindConfiguredProviderBySelection(
      providers,
      selection,
    );
    const normalizedConfiguredType = (selectedProvider?.type || "")
      .trim()
      .toLowerCase();
    const normalizedSelection = (selection || "").trim().toLowerCase();

    if (normalizedConfiguredType === "anthropic-compatible") {
      return {
        label: "未声明自动缓存",
        detail:
          "当前 Provider 未声明支持自动 Prompt Cache；如需复用前缀，请使用显式 cache_control 标记。",
        source: "configured_provider" as const,
      };
    }

    if (normalizedSelection === "anthropic-compatible") {
      return {
        label: "未声明自动缓存",
        detail:
          "当前 Provider 未声明支持自动 Prompt Cache；当前提示基于 Provider 选择器回退判断，如需复用前缀，请使用显式 cache_control 标记。",
        source: "selection_fallback" as const,
      };
    }

    return null;
  },
}));

vi.mock("./MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content || "<empty>"}</div>
  ),
}));

const mockStreamingRenderer = vi.fn(
  ({
    content,
    contentParts,
    thinkingContent,
    toolCalls,
    onOpenSavedSiteContent,
    suppressProcessFlow,
    showRuntimeStatusInline,
    renderProposedPlanBlocks,
    showContentBlockActions,
    onQuoteContent,
    markdownRenderMode,
  }: {
    content: string;
    contentParts?: unknown[];
    thinkingContent?: string;
    toolCalls?: unknown[];
    renderA2UIInline?: boolean;
    suppressedActionRequestId?: string | null;
    suppressProcessFlow?: boolean;
    showRuntimeStatusInline?: boolean;
    renderProposedPlanBlocks?: boolean;
    showContentBlockActions?: boolean;
    onQuoteContent?: (content: string) => void;
    markdownRenderMode?: string;
    onOpenSavedSiteContent?: (target: {
      projectId: string;
      contentId: string;
      title?: string;
    }) => void;
  }) => (
    <div
      data-testid="streaming-renderer"
      data-content-parts={contentParts?.length ?? 0}
      data-tool-calls={toolCalls?.length ?? 0}
      data-has-thinking-content={thinkingContent ? "yes" : "no"}
      data-has-open-saved-site-content={onOpenSavedSiteContent ? "yes" : "no"}
      data-suppress-process-flow={suppressProcessFlow ? "yes" : "no"}
      data-show-runtime-status-inline={showRuntimeStatusInline ? "yes" : "no"}
      data-render-proposed-plan-blocks={renderProposedPlanBlocks ? "yes" : "no"}
      data-show-content-block-actions={showContentBlockActions ? "yes" : "no"}
      data-has-on-quote-content={onQuoteContent ? "yes" : "no"}
      data-markdown-render-mode={markdownRenderMode || "standard"}
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
    deferCompletedSingleDetails?: boolean;
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
    markdownRenderMode?: string;
  }) => mockStreamingRenderer(props),
}));

vi.mock("./TokenUsageDisplay", () => ({
  TokenUsageDisplay: (props: {
    promptCacheNotice?: {
      label?: string;
    } | null;
    inline?: boolean;
  }) => mockTokenUsageDisplay(props),
}));

vi.mock("./AgentThreadTimeline", () => ({
  AgentThreadTimeline: (props: {
    actionRequests?: Array<Record<string, unknown>>;
    deferCompletedSingleDetails?: boolean;
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
  clearAgentUiPerformanceMetrics();
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
  vi.useRealTimers();
  vi.clearAllMocks();
  clearAgentUiPerformanceMetrics();
  mockUseConfiguredProviders.mockImplementation(() => ({
    providers: [],
    loading: false,
  }));
  mockFindConfiguredProviderBySelection.mockImplementation(() => null);
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

function createConversationMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index + 1}`,
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `消息 ${index + 1}`,
    timestamp: new Date(
      `2026-04-25T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
    ),
  }));
}

describe("MessageList", () => {
  it("应在同一滚动区域顶部渲染 leadingContent", () => {
    const container = render(
      [
        {
          id: "assistant-1",
          role: "assistant",
          content: "第一条消息",
        } as Message,
      ],
      {
        leadingContent: (
          <div data-testid="leading-probe">scene summary heading</div>
        ),
      },
    );

    const leadingContent = container.querySelector(
      '[data-testid="message-list-leading-content"]',
    );
    const messageColumn = container.querySelector(
      '[data-testid="message-list-column"]',
    );

    expect(leadingContent?.textContent).toContain("scene summary heading");
    expect(messageColumn?.firstElementChild).toBe(leadingContent);
    expect(messageColumn?.textContent).toContain("第一条消息");
    expect(messageColumn?.className).toContain("justify-start");
  });

  it("短对话发送首帧也应吸顶展示，避免完成前后跳动", () => {
    const container = render(
      [
        {
          id: "msg-user-first-frame",
          role: "user",
          content: "你好",
          timestamp: new Date("2026-04-25T10:00:00.000Z"),
        } as Message,
      ],
      { isSending: true },
    );

    const messageColumn = container.querySelector(
      '[data-testid="message-list-column"]',
    );

    expect(messageColumn?.textContent).toContain("你好");
    expect(messageColumn?.className).toContain("min-h-full");
    expect(messageColumn?.className).toContain("justify-start");
    expect(messageColumn?.className).not.toContain("justify-end");
  });

  it("任务中心发送首帧也应吸顶展示", () => {
    const container = render(
      [
        {
          id: "msg-user-task-center-first-frame",
          role: "user",
          content: "从任务中心开始对话",
          timestamp: new Date("2026-04-25T10:00:00.000Z"),
        } as Message,
      ],
      {
        emptyStateVariant: "task-center",
        isSending: true,
      },
    );

    const messageColumn = container.querySelector(
      '[data-testid="message-list-column"]',
    );

    expect(messageColumn?.textContent).toContain("从任务中心开始对话");
    expect(messageColumn?.className).toContain("justify-start");
    expect(messageColumn?.className).not.toContain("justify-end");
  });

  it("已完成的旧会话短消息应吸顶展示，避免打开历史时贴近输入区", () => {
    const container = render(
      [
        {
          id: "msg-user-history-short",
          role: "user",
          content: "打开旧会话",
          timestamp: new Date("2026-04-25T10:00:00.000Z"),
        } as Message,
        {
          id: "msg-assistant-history-short",
          role: "assistant",
          content: "这是历史回复",
          timestamp: new Date("2026-04-25T10:00:01.000Z"),
        } as Message,
      ],
      {
        currentTurnId: "turn-history-completed",
        turns: [
          {
            id: "turn-history-completed",
            thread_id: "session-history-short",
            prompt_text: "打开旧会话",
            status: "completed",
            started_at: "2026-04-25T10:00:00.000Z",
            completed_at: "2026-04-25T10:00:01.000Z",
            created_at: "2026-04-25T10:00:00.000Z",
            updated_at: "2026-04-25T10:00:01.000Z",
          },
        ],
      },
    );

    const messageColumn = container.querySelector(
      '[data-testid="message-list-column"]',
    );

    expect(messageColumn?.textContent).toContain("打开旧会话");
    expect(messageColumn?.className).toContain("justify-start");
    expect(messageColumn?.className).not.toContain("justify-end");
  });

  it("自动恢复生成会话时应展示恢复占位而不是空白引导", () => {
    const container = render([], { isRestoringSession: true });

    expect(
      container.querySelector('[data-testid="message-list-restoring-session"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("正在恢复生成会话...");
    expect(container.textContent).toContain(
      "正在同步最近一次生成会话，请稍候。",
    );
    expect(container.textContent).not.toContain("开始一段新的对话吧");
  });

  it("旧会话首屏只加载尾部历史时应提供继续加载入口", () => {
    const onLoadFullHistory = vi.fn();
    const container = render(createConversationMessages(2), {
      sessionHistoryWindow: {
        loadedMessages: 2,
        totalMessages: 320,
        isLoadingFull: false,
        error: null,
      },
      onLoadFullHistory,
    });

    expect(
      container.querySelector(
        '[data-testid="message-list-persisted-history-window"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("最近 2 / 320 条消息");

    const button = container.querySelector(
      '[data-testid="message-list-load-full-history"]',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("加载更多历史");

    act(() => {
      button?.click();
    });

    expect(onLoadFullHistory).toHaveBeenCalledTimes(1);
  });

  it("旧会话首帧应先渲染消息文本并延后历史 timeline", () => {
    vi.useFakeTimers();
    const messages = createConversationMessages(60);
    const turns: AgentThreadTurn[] = Array.from({ length: 30 }, (_, index) => {
      const startMinute = String(index * 2).padStart(2, "0");
      const completedMinute = String(index * 2 + 1).padStart(2, "0");
      return {
        id: `turn-${index + 1}`,
        thread_id: "thread-history",
        prompt_text: `消息 ${index * 2 + 1}`,
        status: "completed",
        started_at: `2026-04-25T10:${startMinute}:00.000Z`,
        completed_at: `2026-04-25T10:${completedMinute}:00.000Z`,
        created_at: `2026-04-25T10:${startMinute}:00.000Z`,
        updated_at: `2026-04-25T10:${completedMinute}:00.000Z`,
      };
    });
    const threadItems: AgentThreadItem[] = turns.map((turn, index) => ({
      id: `reasoning-${index + 1}`,
      thread_id: turn.thread_id,
      turn_id: turn.id,
      sequence: 1,
      status: "completed",
      started_at: turn.started_at,
      completed_at: turn.completed_at,
      updated_at: turn.updated_at,
      type: "reasoning",
      text: `历史执行轨迹 ${index + 1}`,
    }));

    const container = render(messages, {
      currentTurnId: "turn-30",
      turns,
      threadItems,
    });

    expect(container.textContent).toContain("消息 60");
    expect(mockAgentThreadTimeline).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(920);
    });

    expect(mockAgentThreadTimeline).toHaveBeenCalled();
    expect(mockAgentThreadTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        deferCompletedSingleDetails: true,
        isCurrentTurn: false,
      }),
    );
    expect(
      container.querySelector('[data-testid="agent-thread-timeline:leading"]'),
    ).not.toBeNull();
  });

  it("旧会话已分页窗口首帧应只挂载更小的尾部批次", () => {
    vi.useFakeTimers();
    const messages = createConversationMessages(40);
    const container = render(messages, {
      sessionHistoryWindow: {
        loadedMessages: 40,
        totalMessages: 188,
        isLoadingFull: false,
        error: null,
      },
    });

    expect(container.textContent).toContain("最近 40 / 188 条消息");
    expect(container.textContent).toContain("消息 40");
    expect(container.textContent).toContain("消息 31");
    expect(container.textContent).not.toContain("消息 30");
    expect(container.textContent).toContain("更早的 30 条可按需展开");

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(container.textContent).not.toContain("消息 30");

    const expandButton = container.querySelector(
      '[data-testid="message-list-expand-history"]',
    ) as HTMLButtonElement | null;

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("消息 30");
  });

  it("旧会话消息较少但执行过程很多时也应延后构建 timeline", async () => {
    vi.useFakeTimers();
    const turn: AgentThreadTurn = {
      id: "turn-history-many-items",
      thread_id: "thread-history-many-items",
      prompt_text: "检查慢历史",
      status: "completed",
      started_at: "2026-04-25T10:00:00.000Z",
      completed_at: "2026-04-25T10:01:00.000Z",
      created_at: "2026-04-25T10:00:00.000Z",
      updated_at: "2026-04-25T10:01:00.000Z",
    };
    const threadItems: AgentThreadItem[] = Array.from(
      { length: 30 },
      (_, index): AgentThreadItem => {
        const base = {
          id: `history-heavy-item-${index + 1}`,
          thread_id: turn.thread_id,
          turn_id: turn.id,
          sequence: index + 1,
          status: "completed" as const,
          started_at: "2026-04-25T10:00:00.000Z",
          completed_at: "2026-04-25T10:01:00.000Z",
          updated_at: "2026-04-25T10:01:00.000Z",
        };

        if (index % 2 === 0) {
          return {
            ...base,
            type: "tool_call",
            tool_name: "Bash",
            arguments: { command: `echo ${index}` },
            output: `输出 ${index}`,
          };
        }

        return {
          ...base,
          type: "reasoning",
          text: `思考 ${index}`,
        };
      },
    );
    const container = render(
      [
        {
          id: "msg-user-history-many-items",
          role: "user",
          content: "检查慢历史",
          timestamp: new Date("2026-04-25T10:00:00.000Z"),
        } as Message,
        {
          id: "msg-assistant-history-many-items",
          role: "assistant",
          content: "历史结果",
          timestamp: new Date("2026-04-25T10:01:00.000Z"),
        } as Message,
      ],
      {
        currentTurnId: turn.id,
        turns: [turn],
        threadItems,
        sessionHistoryWindow: {
          loadedMessages: 2,
          totalMessages: 170,
          isLoadingFull: false,
          error: null,
        },
      },
    );

    expect(container.textContent).toContain("历史结果");
    expect(
      container.querySelector(
        '[data-testid="message-list-historical-timeline-preview:leading"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-runtime-status-line"]'),
    ).toBeNull();
    expect(mockAgentThreadTimeline).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(880);
    });

    expect(
      container.querySelector(
        '[data-testid="message-list-historical-timeline-preview:leading"]',
      ),
    ).toBeNull();

    act(() => {
      vi.advanceTimersByTime(60);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector(
        '[data-testid="message-list-historical-timeline-preview:leading"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-runtime-status-line"]'),
    ).not.toBeNull();
    expect(mockAgentThreadTimeline).not.toHaveBeenCalled();
  });

  it("已分页旧会话展开执行过程前不应扫描 threadItems，展开后只纳入尾部相关 turns", async () => {
    vi.useFakeTimers();
    const turns: AgentThreadTurn[] = Array.from({ length: 8 }, (_, index) => {
      const minute = String(index + 1).padStart(2, "0");
      return {
        id: `turn-window-${index + 1}`,
        thread_id: "thread-windowed-history",
        prompt_text: `历史问题 ${index + 1}`,
        status: "completed",
        started_at: `2026-04-25T10:${minute}:00.000Z`,
        completed_at: `2026-04-25T10:${minute}:30.000Z`,
        created_at: `2026-04-25T10:${minute}:00.000Z`,
        updated_at: `2026-04-25T10:${minute}:30.000Z`,
      };
    });
    const threadItems: AgentThreadItem[] = turns.flatMap((turn, turnIndex) =>
      Array.from(
        { length: 5 },
        (_, itemIndex): AgentThreadItem => ({
          id: `turn-window-${turnIndex + 1}-item-${itemIndex + 1}`,
          thread_id: turn.thread_id,
          turn_id: turn.id,
          sequence: itemIndex + 1,
          status: "completed",
          started_at: turn.started_at,
          completed_at: turn.completed_at,
          updated_at: turn.updated_at,
          type: "tool_call",
          tool_name: "Read",
          arguments: { file_path: `/repo/file-${itemIndex + 1}.ts` },
        }),
      ),
    );

    const container = render(
      [
        {
          id: "msg-user-windowed-history",
          role: "user",
          content: "打开尾部旧会话",
          timestamp: new Date("2026-04-25T10:08:00.000Z"),
        } as Message,
        {
          id: "msg-assistant-windowed-history",
          role: "assistant",
          content: "这是尾部旧会话结果",
          timestamp: new Date("2026-04-25T10:08:30.000Z"),
        } as Message,
      ],
      {
        sessionId: "session-windowed-history",
        currentTurnId: "turn-window-8",
        turns,
        threadItems,
        sessionHistoryWindow: {
          loadedMessages: 2,
          totalMessages: 220,
          isLoadingFull: false,
          error: null,
        },
      },
    );

    await act(async () => {
      await Promise.resolve();
    });

    const commit = getAgentUiPerformanceMetrics().find(
      (entry) => entry.phase === "messageList.commit",
    );

    expect(commit?.metrics).toEqual(
      expect.objectContaining({
        renderedTurnsCount: 2,
        shouldDeferHistoricalTimeline: true,
        threadItemsCount: 0,
        threadItemsScanDeferred: true,
        turnsCount: 8,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(940);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const deferredPreview = container.querySelector<HTMLButtonElement>(
      '[data-testid="message-list-historical-timeline-preview:leading"]',
    );
    expect(deferredPreview).not.toBeNull();
    expect(deferredPreview?.textContent).toContain("点击展开后加载执行细节");
    const idleCommit = getAgentUiPerformanceMetrics()
      .filter((entry) => entry.phase === "messageList.commit")
      .find(
        (entry) =>
          entry.metrics.threadItemsScanDeferred === true &&
          entry.metrics.canBuildHistoricalTimeline === true,
      );
    expect(idleCommit?.metrics).toEqual(
      expect.objectContaining({
        renderedTurnsCount: 2,
        threadItemsCount: 0,
        turnsCount: 8,
      }),
    );

    await act(async () => {
      deferredPreview?.click();
      await Promise.resolve();
    });

    const expandedCommit = getAgentUiPerformanceMetrics()
      .filter((entry) => entry.phase === "messageList.commit")
      .find(
        (entry) =>
          entry.metrics.threadItemsScanDeferred === false &&
          entry.metrics.threadItemsCount === 10,
      );

    expect(expandedCommit?.metrics).toEqual(
      expect.objectContaining({
        renderedTurnsCount: 2,
        threadItemsCount: 10,
        turnsCount: 8,
      }),
    );
  });

  it("旧会话首帧应延后历史助手 contentParts 与 Markdown 细节扫描", async () => {
    vi.useFakeTimers();
    const turn: AgentThreadTurn = {
      id: "turn-history-content-parts",
      thread_id: "thread-history-content-parts",
      prompt_text: "检查 content parts",
      status: "completed",
      started_at: "2026-04-25T10:00:00.000Z",
      completed_at: "2026-04-25T10:01:00.000Z",
      created_at: "2026-04-25T10:00:00.000Z",
      updated_at: "2026-04-25T10:01:00.000Z",
    };
    const threadItems: AgentThreadItem[] = Array.from(
      { length: 30 },
      (_, index): AgentThreadItem => ({
        id: `history-content-parts-tool-${index + 1}`,
        thread_id: turn.thread_id,
        turn_id: turn.id,
        sequence: index + 1,
        status: "completed",
        started_at: turn.started_at,
        completed_at: turn.completed_at,
        updated_at: turn.updated_at,
        type: "tool_call",
        tool_name: "Read",
        arguments: { file_path: `/repo/history-${index + 1}.ts` },
      }),
    );
    const container = render(
      [
        {
          id: "msg-user-history-content-parts",
          role: "user",
          content: "检查 content parts",
          timestamp: new Date("2026-04-25T10:00:00.000Z"),
        } as Message,
        {
          id: "msg-assistant-history-content-parts",
          role: "assistant",
          content: "历史 content parts 正文",
          contentParts: [
            {
              type: "text",
              text: "历史 content parts 正文",
            },
            {
              type: "tool_use",
              toolCall: {
                id: "tool-history-content-parts",
                name: "Read",
                arguments: JSON.stringify({ file_path: "/repo/history.ts" }),
                status: "completed",
                result: { success: true, output: "ok" },
                startTime: new Date("2026-04-25T10:00:10.000Z"),
                endTime: new Date("2026-04-25T10:00:11.000Z"),
              },
            },
          ],
          timestamp: new Date("2026-04-25T10:01:00.000Z"),
        } as Message,
      ],
      {
        sessionId: "session-history-content-parts",
        currentTurnId: turn.id,
        turns: [turn],
        threadItems,
        sessionHistoryWindow: {
          loadedMessages: 2,
          totalMessages: 180,
          isLoadingFull: false,
          error: null,
        },
      },
    );

    expect(
      container.querySelector(
        '[data-testid="message-list-historical-markdown-preview"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="streaming-renderer"]'),
    ).toBeNull();
    expect(mockStreamingRenderer).not.toHaveBeenCalled();
    const markdownPreview = container.querySelector(
      '[data-testid="message-list-historical-markdown-preview"]',
    );
    expect(markdownPreview?.textContent).toContain("历史 content parts 正文");
    const commit = getAgentUiPerformanceMetrics().find(
      (entry) => entry.phase === "messageList.commit",
    );
    expect(commit?.metrics).toEqual(
      expect.objectContaining({
        historicalContentPartsDeferredCount: 1,
        historicalMarkdownDeferredCount: 1,
        messageListComputeMs: expect.any(Number),
        messageListThreadItemsScanMs: expect.any(Number),
        messageListTimelineBuildMs: expect.any(Number),
        threadItemsScanDeferred: true,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(940);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const hydratedCommit = getAgentUiPerformanceMetrics()
      .filter((entry) => entry.phase === "messageList.commit")
      .find((entry) => entry.metrics.historicalContentPartsDeferredCount === 0);
    expect(
      container.querySelector(
        '[data-testid="message-list-historical-markdown-preview"]',
      ),
    ).toBeNull();
    expect(mockStreamingRenderer).toHaveBeenCalled();
    expect(hydratedCommit?.metrics).toEqual(
      expect.objectContaining({
        historicalContentPartsDeferredCount: 0,
        historicalMarkdownDeferredCount: 0,
        threadItemsCount: 0,
        threadItemsScanDeferred: true,
      }),
    );
  });

  it("旧会话 idle 后应分批恢复历史 Markdown hydrate，避免一次性挂载", async () => {
    vi.useFakeTimers();
    const turn: AgentThreadTurn = {
      id: "turn-history-markdown-batches",
      thread_id: "thread-history-markdown-batches",
      prompt_text: "检查 markdown hydrate",
      status: "completed",
      started_at: "2026-04-25T10:00:00.000Z",
      completed_at: "2026-04-25T10:01:00.000Z",
      created_at: "2026-04-25T10:00:00.000Z",
      updated_at: "2026-04-25T10:01:00.000Z",
    };
    const threadItems: AgentThreadItem[] = Array.from(
      { length: 30 },
      (_, index): AgentThreadItem => ({
        id: `history-markdown-batch-tool-${index + 1}`,
        thread_id: turn.thread_id,
        turn_id: turn.id,
        sequence: index + 1,
        status: "completed",
        started_at: turn.started_at,
        completed_at: turn.completed_at,
        updated_at: turn.updated_at,
        type: "tool_call",
        tool_name: "Read",
        arguments: { file_path: `/repo/batch-${index + 1}.ts` },
      }),
    );
    const messages: Message[] = Array.from({ length: 10 }, (_, index) => ({
      id: `msg-history-markdown-batch-${index + 1}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content:
        index % 2 === 0
          ? `用户问题 ${index + 1}`
          : `## 历史回复 ${index + 1}\n\n- 需要分批 hydrate`,
      timestamp: new Date(
        `2026-04-25T10:00:${String(index + 1).padStart(2, "0")}.000Z`,
      ),
    }));

    const container = render(messages, {
      sessionId: "session-history-markdown-batches",
      currentTurnId: turn.id,
      turns: [turn],
      threadItems,
      sessionHistoryWindow: {
        loadedMessages: messages.length,
        totalMessages: 220,
        isLoadingFull: false,
        error: null,
      },
    });

    expect(
      container.querySelectorAll(
        '[data-testid="message-list-historical-markdown-preview"]',
      ),
    ).toHaveLength(5);
    expect(
      container.querySelectorAll('[data-testid="streaming-renderer"]'),
    ).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(940);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelectorAll('[data-testid="streaming-renderer"]'),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll(
        '[data-testid="message-list-historical-markdown-preview"]',
      ),
    ).toHaveLength(3);

    act(() => {
      vi.advanceTimersByTime(160);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelectorAll('[data-testid="streaming-renderer"]'),
    ).toHaveLength(4);
    expect(
      container.querySelectorAll(
        '[data-testid="message-list-historical-markdown-preview"]',
      ),
    ).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(160);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelectorAll('[data-testid="streaming-renderer"]'),
    ).toHaveLength(5);
    expect(
      container.querySelectorAll(
        '[data-testid="message-list-historical-markdown-preview"]',
      ),
    ).toHaveLength(0);
  });

  it("已分页旧会话的完成执行过程应先折叠为轻量摘要，点击后再挂载真实 timeline", () => {
    const turn: AgentThreadTurn = {
      id: "turn-history-heavy",
      thread_id: "thread-history-heavy",
      prompt_text: "打开慢历史",
      status: "completed",
      started_at: "2026-04-25T10:00:00.000Z",
      completed_at: "2026-04-25T10:01:00.000Z",
      created_at: "2026-04-25T10:00:00.000Z",
      updated_at: "2026-04-25T10:01:00.000Z",
    };
    const threadItems: AgentThreadItem[] = Array.from(
      { length: 10 },
      (_, index) => ({
        id: `history-tool-${index + 1}`,
        thread_id: turn.thread_id,
        turn_id: turn.id,
        sequence: index + 1,
        status: "completed",
        started_at: "2026-04-25T10:00:00.000Z",
        completed_at: "2026-04-25T10:01:00.000Z",
        updated_at: "2026-04-25T10:01:00.000Z",
        type: "tool_call",
        tool_name: "Bash",
        arguments: { command: `echo ${index + 1}` },
        output: `输出 ${index + 1}`,
      }),
    );
    const container = render(
      [
        {
          id: "msg-user-heavy-history",
          role: "user",
          content: "打开慢历史",
          timestamp: new Date("2026-04-25T10:00:00.000Z"),
        } as Message,
        {
          id: "msg-assistant-heavy-history",
          role: "assistant",
          content: "这是旧会话的最终回复",
          contentParts: [
            {
              type: "text",
              text: "这是旧会话的最终回复",
            },
          ],
          timestamp: new Date("2026-04-25T10:01:00.000Z"),
        } as Message,
      ],
      {
        turns: [turn],
        threadItems,
        currentTurnId: turn.id,
        sessionHistoryWindow: {
          loadedMessages: 2,
          totalMessages: 170,
          isLoadingFull: false,
          error: null,
        },
      },
    );

    expect(
      container.querySelector(
        '[data-testid="message-list-historical-timeline-preview:leading"]',
      ),
    ).not.toBeNull();
    expect(mockAgentThreadTimeline).not.toHaveBeenCalled();
    expect(mockStreamingRenderer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contentParts: undefined,
        markdownRenderMode: "light",
      }),
    );

    const expandButton = container.querySelector(
      '[data-testid="message-list-historical-timeline-preview:leading"]',
    ) as HTMLButtonElement | null;

    act(() => {
      expandButton?.click();
    });

    expect(mockAgentThreadTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: "leading",
        isCurrentTurn: false,
      }),
    );
  });

  it("旧会话里的超长历史助手消息应先渲染轻量预览，点击后再展开完整正文", () => {
    const longContent = `开头内容 ${"长历史 ".repeat(8000)} 末尾完整内容`;
    const container = render(
      [
        {
          id: "msg-user-long-history",
          role: "user",
          content: "打开超长历史",
          timestamp: new Date("2026-04-25T10:00:00.000Z"),
        } as Message,
        {
          id: "msg-assistant-long-history",
          role: "assistant",
          content: longContent,
          timestamp: new Date("2026-04-25T10:00:01.000Z"),
        } as Message,
      ],
      {
        sessionHistoryWindow: {
          loadedMessages: 2,
          totalMessages: 120,
          isLoadingFull: false,
          error: null,
        },
      },
    );

    const preview = container.querySelector(
      '[data-testid="message-list-long-history-preview"]',
    );

    expect(preview).not.toBeNull();
    expect(preview?.textContent).toContain("此历史消息较长");
    expect(preview?.textContent).toContain("纯文本预览");
    expect(preview?.textContent).not.toContain("末尾完整内容");
    expect(mockStreamingRenderer).not.toHaveBeenCalled();

    const expandButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("展开完整内容"),
    ) as HTMLButtonElement | undefined;

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector(
        '[data-testid="message-list-long-history-preview"]',
      ),
    ).toBeNull();
    expect(mockStreamingRenderer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("末尾完整内容"),
        markdownRenderMode: "light",
      }),
    );
  });

  it("旧会话里的长助手回复应先展示纯文本预览，避免首帧挂载 Markdown", () => {
    const oldAssistantContent = `旧回复开头 ${"历史分析 ".repeat(360)} 旧回复末尾完整内容`;
    const latestAssistantContent = "最新回复保持完整";
    const container = render(
      [
        {
          id: "msg-user-old-compact",
          role: "user",
          content: "旧问题",
          timestamp: new Date("2026-04-25T10:00:00.000Z"),
        } as Message,
        {
          id: "msg-assistant-old-compact",
          role: "assistant",
          content: oldAssistantContent,
          timestamp: new Date("2026-04-25T10:00:01.000Z"),
        } as Message,
        {
          id: "msg-user-latest-compact",
          role: "user",
          content: "最新问题",
          timestamp: new Date("2026-04-25T10:01:00.000Z"),
        } as Message,
        {
          id: "msg-assistant-latest-compact",
          role: "assistant",
          content: latestAssistantContent,
          timestamp: new Date("2026-04-25T10:01:01.000Z"),
        } as Message,
      ],
      {
        sessionHistoryWindow: {
          loadedMessages: 4,
          totalMessages: 88,
          isLoadingFull: false,
          error: null,
        },
      },
    );

    const preview = container.querySelector(
      '[data-testid="message-list-historical-assistant-preview"]',
    );

    expect(preview).not.toBeNull();
    expect(preview?.textContent).toContain("历史助手回复较长");
    expect(preview?.textContent).not.toContain("旧回复末尾完整内容");
    expect(container.textContent).toContain(latestAssistantContent);
    expect(mockStreamingRenderer).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("旧回复末尾完整内容"),
      }),
    );

    const expandButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("展开完整内容"),
    ) as HTMLButtonElement | undefined;

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector(
        '[data-testid="message-list-historical-assistant-preview"]',
      ),
    ).toBeNull();
    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("旧回复末尾完整内容"),
        markdownRenderMode: "light",
      }),
    );
  });

  it("非旧会话助手正文应保持标准 Markdown 渲染模式", () => {
    render([
      {
        id: "msg-user-live-standard-markdown",
        role: "user",
        content: "实时对话",
        timestamp: new Date("2026-04-25T10:00:00.000Z"),
      } as Message,
      {
        id: "msg-assistant-live-standard-markdown",
        role: "assistant",
        content: "```ts\nconsole.log('live')\n```",
        timestamp: new Date("2026-04-25T10:00:01.000Z"),
      } as Message,
    ]);

    expect(mockStreamingRenderer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        markdownRenderMode: "standard",
      }),
    );
  });

  it("任务中心空列表时应展示最近对话空态而不是普通新对话文案", () => {
    const container = render([], {
      emptyStateVariant: "task-center",
    });

    expect(
      container.querySelector('[data-testid="message-list-empty-task-center"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("对话");
    expect(container.textContent).toContain("最近对话");
    expect(container.textContent).toContain(
      "这里集中展示最近对话、待继续会话和更早归档，方便你随时回到上一次工作现场。",
    );
    expect(container.textContent).toContain(
      "还没有对话时，可以先从“新建对话”开始；后续的结果、素材和中间过程都会继续留在这里。",
    );
    expect(container.textContent).toContain("左侧会优先显示待继续的对话");
    expect(container.textContent).toContain("最近对话和归档会按时间自动整理");
    expect(container.textContent).toContain("恢复中的会话会自动回到这里继续");
    expect(container.textContent).not.toContain("开始一段新的对话吧");
  });

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

  it("大历史会话应先展示最近消息，并允许用户立即展开更早内容", () => {
    const messages = createConversationMessages(90);
    const container = render(messages);

    const historyWindow = container.querySelector(
      '[data-testid="message-list-history-window"]',
    );
    const expandButton = container.querySelector(
      '[data-testid="message-list-expand-history"]',
    ) as HTMLButtonElement | null;

    expect(historyWindow).not.toBeNull();
    expect(container.textContent).toContain("为了更快打开对话");
    expect(container.textContent).toContain("消息 90");
    expect(container.textContent).not.toContain("消息 1");
    expect(expandButton).not.toBeNull();

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('[data-testid="message-list-history-window"]'),
    ).toBeNull();
    expect(container.textContent).toContain("消息 1");
  });

  it("user peer 包络正文应直接渲染为专门协作卡片", () => {
    const container = render([
      {
        id: "msg-user-peer",
        role: "user",
        content: `<teammate-message teammate_id="researcher" summary="同步结果">
继续验证
</teammate-message>`,
      } as Message,
    ]);

    expect(
      container.querySelector('[data-testid="runtime-peer-message-cards"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("协作者消息");
    expect(container.textContent).toContain("来自 researcher");
    expect(container.textContent).toContain("同步结果");
    expect(container.textContent).toContain("继续验证");
    expect(container.textContent).not.toContain("teammate-message");
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

  it("assistant 消息带 contextTrace 时不应在聊天主线渲染上下文轨迹块", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-context-trace",
        role: "assistant",
        content: "我已经处理完成。",
        timestamp: now,
        contextTrace: [
          {
            stage: "memory_injection",
            detail: "query_len=8,injected=2",
          },
        ],
      },
    ];

    const container = render(messages);

    expect(container.textContent).toContain("我已经处理完成。");
    expect(container.textContent).not.toContain("上下文轨迹");
    expect(container.textContent).not.toContain("memory_injection");
    expect(container.textContent).not.toContain("query_len=8,injected=2");
  });

  it("anthropic-compatible 自定义 Provider 无缓存命中时应透传自动缓存提示", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-usage",
        role: "assistant",
        content: "本轮已完成。",
        timestamp: now,
        usage: {
          input_tokens: 1_500,
          output_tokens: 500,
          cached_input_tokens: 0,
        },
      },
    ];

    mockUseConfiguredProviders.mockImplementation(() => ({
      providers: [
        {
          key: "custom-provider-id",
          label: "GLM Anthropic",
          registryId: "custom-provider-id",
          type: "anthropic-compatible",
          providerId: "custom-provider-id",
        },
      ],
      loading: false,
    }));
    mockFindConfiguredProviderBySelection.mockImplementation(
      (
        providers: MockConfiguredProvider[],
        selection?: string | null,
      ): MockConfiguredProvider | null =>
        Array.isArray(providers)
          ? (providers.find((provider) => provider.key === selection) ?? null)
          : null,
    );

    const container = render(messages, {
      providerType: "custom-provider-id",
    });

    expect(container.textContent).toContain("未声明自动缓存");
    expect(mockTokenUsageDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        promptCacheNotice: expect.objectContaining({
          label: "未声明自动缓存",
        }),
      }),
    );
  });

  it("anthropic-compatible 自定义 Provider 存在缓存写入时不应再透传自动缓存提示", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-cache-write",
        role: "assistant",
        content: "本轮已完成。",
        timestamp: now,
        usage: {
          input_tokens: 1_500,
          output_tokens: 500,
          cached_input_tokens: 0,
          cache_creation_input_tokens: 256,
        },
      },
    ];

    mockUseConfiguredProviders.mockImplementation(() => ({
      providers: [
        {
          key: "custom-provider-id",
          label: "Kimi Anthropic",
          registryId: "custom-provider-id",
          type: "anthropic-compatible",
          providerId: "custom-provider-id",
        },
      ],
      loading: false,
    }));
    mockFindConfiguredProviderBySelection.mockImplementation(
      (
        providers: MockConfiguredProvider[],
        selection?: string | null,
      ): MockConfiguredProvider | null =>
        Array.isArray(providers)
          ? (providers.find((provider) => provider.key === selection) ?? null)
          : null,
    );

    const container = render(messages, {
      providerType: "custom-provider-id",
    });

    expect(container.textContent).not.toContain("未声明自动缓存");
    expect(mockTokenUsageDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        promptCacheNotice: undefined,
      }),
    );
  });

  it("旧会话恢复首帧不应立即自动加载 Provider 缓存提示配置", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-restored-usage",
        role: "assistant",
        content: "旧会话结果。",
        timestamp: now,
        usage: {
          input_tokens: 1_200,
          output_tokens: 300,
          cached_input_tokens: 0,
        },
      },
    ];

    render(messages, {
      providerType: "custom-provider-id",
      sessionHistoryWindow: {
        loadedMessages: 40,
        totalMessages: 320,
        isLoadingFull: false,
        error: null,
      },
    });

    expect(mockUseConfiguredProviders).toHaveBeenCalledWith({
      autoLoad: false,
    });
  });

  it("旧会话首帧应记录可汇总的渲染采样数值", async () => {
    const messages = createConversationMessages(32);

    render(messages, {
      sessionId: "session-metrics",
      sessionHistoryWindow: {
        loadedMessages: 32,
        totalMessages: 160,
        isLoadingFull: false,
        error: null,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const commit = getAgentUiPerformanceMetrics().find(
      (entry) => entry.phase === "messageList.commit",
    );
    expect(commit).toEqual(
      expect.objectContaining({
        sessionId: "session-metrics",
        metrics: expect.objectContaining({
          hiddenHistoryCount: expect.any(Number),
          messagesCount: 32,
          persistedHiddenHistoryCount: 128,
          renderedMessagesCount: expect.any(Number),
        }),
      }),
    );
  });

  it("复杂任务完成后应把运行状态、耗时与 token 结算收口到最后一条 assistant 消息尾部", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-user-task-card",
        role: "user",
        content: "分析 claudecode 项目为什么没有 task 视图",
        timestamp: now,
      },
      {
        id: "msg-assistant-task-card",
        role: "assistant",
        content: "已经定位到主聊天区没有任务投影层。",
        timestamp: now,
        usage: {
          input_tokens: 1_800,
          output_tokens: 640,
          cached_input_tokens: 0,
        },
      },
    ];

    mockUseConfiguredProviders.mockImplementation(() => ({
      providers: [
        {
          key: "custom-provider-id",
          label: "GLM Anthropic",
          registryId: "custom-provider-id",
          type: "anthropic-compatible",
          providerId: "custom-provider-id",
        },
      ],
      loading: false,
    }));
    mockFindConfiguredProviderBySelection.mockImplementation(
      (
        providers: MockConfiguredProvider[],
        selection?: string | null,
      ): MockConfiguredProvider | null =>
        Array.isArray(providers)
          ? (providers.find((provider) => provider.key === selection) ?? null)
          : null,
    );

    const container = render(messages, {
      providerType: "custom-provider-id",
      turns: [
        {
          id: "turn-task-card",
          thread_id: "thread-task-card",
          prompt_text: "分析 claudecode 项目为什么没有 task 视图",
          status: "completed",
          started_at: "2026-04-14T10:00:00Z",
          completed_at: "2026-04-14T10:00:06Z",
          created_at: "2026-04-14T10:00:00Z",
          updated_at: "2026-04-14T10:00:06Z",
        },
      ],
      currentTurnId: "turn-task-card",
      threadRead: {
        thread_id: "thread-task-card",
        status: "completed",
      },
      threadItems: [
        {
          id: "tool-read-task-card",
          type: "tool_call",
          thread_id: "thread-task-card",
          turn_id: "turn-task-card",
          sequence: 1,
          status: "completed",
          started_at: "2026-04-14T10:00:01Z",
          completed_at: "2026-04-14T10:00:02Z",
          updated_at: "2026-04-14T10:00:02Z",
          tool_name: "Read",
          arguments: { file_path: "/repo/src/main.tsx" },
        },
        {
          id: "tool-list-task-card",
          type: "command_execution",
          thread_id: "thread-task-card",
          turn_id: "turn-task-card",
          sequence: 2,
          status: "completed",
          started_at: "2026-04-14T10:00:02Z",
          completed_at: "2026-04-14T10:00:03Z",
          updated_at: "2026-04-14T10:00:03Z",
          command: "ls /repo/src",
          cwd: "/repo",
        },
      ],
      childSubagentSessions: [
        {
          id: "sub-task-card-1",
          name: "子任务 1",
          created_at: now.getTime(),
          updated_at: now.getTime(),
          session_type: "subagent",
          runtime_status: "completed",
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="agent-task-strip"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="assistant-message-meta-footer"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-runtime-status-line"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("已完成");
    expect(container.textContent).toContain("00:06");
    expect(container.textContent).toContain("工具 读 1 / 列 1");
    expect(container.textContent).toContain("任务 0/1");
    expect(container.textContent).toContain("输入 1.8K / 输出 640");
    expect(container.textContent).toContain("缓存 0");
    expect(container.textContent).toContain("未声明自动缓存");
    expect(
      container.querySelector('[data-testid="token-usage-display"]'),
    ).toBeNull();
  });

  it("流式运行态不应再在消息底部重复渲染阶段 pill", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-runtime-footer",
        role: "assistant",
        content: "我先查看项目结构。",
        timestamp: now,
        isThinking: true,
        runtimeStatus: {
          phase: "context",
          title: "正在整理相关信息",
          detail: "已开始聚焦当前仓库。",
          checkpoints: ["首批只读工具待执行"],
        },
      },
    ];

    const container = render(messages);

    expect(
      container.querySelector('[data-testid="message-runtime-status-pill"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="assistant-message-meta-footer"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("正在整理相关信息");
  });

  it("assistant 已有正文且仍在发送时，不应在消息尾部追加处理中状态回复", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-user-active-status-tail",
        role: "user",
        content: "hello",
        timestamp: now,
      },
      {
        id: "msg-assistant-active-status-tail",
        role: "assistant",
        content: "我正在处理你的请求。",
        timestamp: new Date(now.getTime() + 1000),
        isThinking: true,
        runtimeStatus: {
          phase: "routing",
          title: "处理中",
          detail: "正在等待模型输出。",
          checkpoints: ["请求已发送"],
        },
      },
    ];

    const container = render(messages, {
      isSending: true,
    });

    expect(
      container.querySelector('[data-testid="streaming-renderer"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("我正在处理你的请求。");
    expect(
      container.querySelector('[data-testid="assistant-message-meta-footer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-runtime-status-line"]'),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="assistant-first-token-placeholder"]',
      ),
    ).toBeNull();
  });

  it("首个文本分片到来前，不应把运行态当作 assistant 回复渲染", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-user-empty-tail",
        role: "user",
        content: "你好",
        timestamp: now,
      },
      {
        id: "msg-assistant-empty-tail",
        role: "assistant",
        content: "",
        timestamp: new Date(now.getTime() + 1000),
        isThinking: true,
      },
    ];

    const container = render(messages, {
      isSending: true,
    });

    expect(
      container.querySelector('[data-testid="streaming-renderer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="assistant-message-meta-footer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-runtime-status-line"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("处理中");
    expect(container.textContent).not.toContain("<empty-assistant>");
  });

  it("assistant 首条流式内容只有协议残留时，不应渲染空白气泡", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-user-protocol-tail",
        role: "user",
        content: "你好",
        timestamp: now,
      },
      {
        id: "msg-assistant-protocol-tail",
        role: "assistant",
        content: [
          "Built-in Tool: Read",
          "input:",
          '{"file_path":"/repo/src/index.ts"}',
          "output:",
          '{"ok":true}',
        ].join("\n"),
        timestamp: new Date(now.getTime() + 1000),
        isThinking: true,
      },
    ];

    const container = render(messages, {
      isSending: true,
    });

    expect(
      container.querySelector('[data-testid="streaming-renderer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="assistant-message-meta-footer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-runtime-status-line"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("处理中");
    expect(container.textContent).not.toContain("Built-in Tool");
  });

  it("assistant 占位消息只有启动态 runtimeStatus 时，应渲染轻量首字前占位", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-user-runtime-only",
        role: "user",
        content: "你好",
        timestamp: now,
      },
      {
        id: "msg-assistant-runtime-only",
        role: "assistant",
        content: "",
        timestamp: new Date(now.getTime() + 1000),
        isThinking: true,
        runtimeStatus: {
          phase: "routing",
          title: "正在启动处理流程",
          detail: "已开始处理，正在准备环境并等待第一条进展。",
          checkpoints: [
            "会话已建立",
            "对话优先执行",
            "直接回答优先",
            "等待首个模型事件",
          ],
        },
      },
    ];

    const container = render(messages, {
      isSending: true,
    });

    expect(
      container.querySelector('[data-testid="streaming-renderer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="assistant-message-meta-footer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-runtime-status-line"]'),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="assistant-first-token-placeholder"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("正在启动处理流程");
    expect(container.textContent).toContain(
      "已开始处理，正在准备环境并等待第一条进展。",
    );
  });

  it("assistant 消息结算区应以内联模式承载 token usage", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-inline-usage",
        role: "assistant",
        content: "本轮已完成。",
        timestamp: now,
        usage: {
          input_tokens: 1_200,
          output_tokens: 300,
          cached_input_tokens: 0,
        },
      },
    ];

    render(messages);

    expect(mockTokenUsageDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        inline: true,
      }),
    );
  });

  it("第二轮开始后，上一轮 assistant 的工具调用块不应被从正文投影中剥离", () => {
    const firstTurnTime = new Date("2026-04-15T09:00:00.000Z");
    const secondTurnTime = new Date("2026-04-15T09:00:10.000Z");
    const completedToolCall = {
      id: "tool-read-1",
      name: "Read",
      arguments: '{"file_path":"/repo/src/index.ts"}',
      status: "completed" as const,
      startTime: new Date("2026-04-15T09:00:01.000Z"),
      endTime: new Date("2026-04-15T09:00:02.000Z"),
      result: {
        success: true,
        output: "export const answer = 42;",
      },
    };
    const messages: Message[] = [
      {
        id: "msg-user-first-turn",
        role: "user",
        content: "先分析项目结构",
        timestamp: firstTurnTime,
      },
      {
        id: "msg-assistant-first-turn",
        role: "assistant",
        content: "已经整理完第一轮分析。",
        timestamp: new Date("2026-04-15T09:00:03.000Z"),
        toolCalls: [completedToolCall],
        contentParts: [
          {
            type: "tool_use",
            toolCall: completedToolCall,
          },
          {
            type: "text",
            text: "已经整理完第一轮分析。",
          },
        ],
      },
      {
        id: "msg-user-second-turn",
        role: "user",
        content: "继续追问第二轮",
        timestamp: secondTurnTime,
      },
      {
        id: "msg-assistant-second-turn",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-04-15T09:00:11.000Z"),
        isThinking: true,
        contentParts: [
          {
            type: "thinking",
            text: "准备继续查看模块边界。",
          },
        ],
        runtimeStatus: {
          phase: "preparing",
          title: "准备继续分析",
          detail: "正在建立第二轮上下文。",
          checkpoints: ["等待下一步工具调用"],
        },
      },
    ];

    render(messages);

    const firstAssistantCall = mockStreamingRenderer.mock.calls.find(
      ([props]) => props.content === "已经整理完第一轮分析。",
    )?.[0];
    const secondAssistantCall = mockStreamingRenderer.mock.calls.find(
      ([props]) => props.content === "",
    )?.[0];

    expect(firstAssistantCall?.contentParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_use",
        }),
      ]),
    );
    expect(firstAssistantCall?.thinkingContent).toBeUndefined();
    expect(secondAssistantCall?.contentParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "thinking",
        }),
      ]),
    );
  });

  it("图片任务消息卡应在聊天区渲染预览并支持展开图片画布", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-image-workbench",
        role: "assistant",
        content: "图片生成已完成，共生成 1 张。",
        timestamp: now,
        imageWorkbenchPreview: {
          taskId: "task-1",
          prompt: "一颗戴耳机的青柠，科技感插画风格",
          status: "complete",
          imageUrl: "https://example.com/generated.png",
          imageCount: 1,
          size: "1024x1024",
          projectId: "project-1",
          contentId: "content-1",
        },
      },
    ];

    let focusDetail: Record<string, unknown> | null = null;
    const handleFocus = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      focusDetail = event.detail as Record<string, unknown>;
    };
    window.addEventListener(IMAGE_WORKBENCH_FOCUS_EVENT, handleFocus);

    const container = render(messages);
    const previewCard = container.querySelector(
      '[data-testid="image-workbench-message-preview-task-1"]',
    ) as HTMLButtonElement | null;

    expect(previewCard?.textContent).toContain("一颗戴耳机的青柠");
    expect(previewCard?.textContent).toContain("已生成");
    expect(previewCard?.textContent).toContain("可在右侧继续查看与使用");
    expect(previewCard?.className).not.toContain("max-w-[620px]");
    expect(previewCard?.className).toContain("max-w-[360px]");

    act(() => {
      previewCard?.click();
    });

    expect(focusDetail).toEqual({
      projectId: "project-1",
      contentId: "content-1",
    });
    window.removeEventListener(IMAGE_WORKBENCH_FOCUS_EVENT, handleFocus);
  });

  it("图片任务消息卡应展示 LimeCore 策略输入标签", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-image-workbench-policy",
        role: "assistant",
        content: "图片生成已完成，共生成 1 张。",
        timestamp: now,
        imageWorkbenchPreview: {
          taskId: "task-policy-1",
          prompt: "一颗戴耳机的青柠，科技感插画风格",
          status: "complete",
          imageUrl: "https://example.com/generated.png",
          imageCount: 1,
          size: "1024x1024",
          projectId: "project-1",
          contentId: "content-1",
          runtimeContract: {
            contractKey: "image_generation",
            routingSlot: "image_task",
            limecorePolicyEvaluationStatus: "input_gap",
            limecorePolicyEvaluationDecision: "ask",
            limecorePolicyEvaluationPendingRefs: [
              "model_catalog",
              "provider_offer",
              "tenant_feature_flags",
            ],
          },
        },
      },
    ];

    const container = render(messages);
    const previewCard = container.querySelector(
      '[data-testid="image-workbench-message-preview-task-policy-1"]',
    );

    expect(previewCard?.textContent).toContain("LimeCore 策略输入待命中: 3");
  });

  it("图片任务消息应收起内部 process flow，只保留任务卡与正文", () => {
    const container = render(
      [
        {
          id: "msg-assistant-image-workbench-process-flow",
          role: "assistant",
          content: "已成功提交分镜任务。",
          timestamp: new Date(),
          contentParts: [
            { type: "thinking", text: "先执行图片技能。" },
            { type: "text", text: "已成功提交分镜任务。" },
          ],
          toolCalls: [
            {
              id: "tool-image-skill",
              name: "skill",
              arguments: JSON.stringify({ skill: "image_generate" }),
              status: "completed",
              result: {
                success: true,
                output: "processing",
              },
              startTime: new Date(),
              endTime: new Date(),
            },
          ],
          imageWorkbenchPreview: {
            taskId: "task-image-process-flow",
            prompt: "三国主要人物分镜",
            status: "running",
            imageCount: 9,
            expectedImageCount: 9,
            layoutHint: "storyboard_3x3",
            projectId: "project-1",
            contentId: "content-1",
          },
        } as Message,
      ],
      {
        currentTurnId: "turn-image-process-flow",
        turns: [
          {
            id: "turn-image-process-flow",
            thread_id: "thread-image-process-flow",
            prompt_text: "@分镜 生成三国人物分镜",
            status: "completed",
            started_at: "2026-04-24T01:36:56Z",
            completed_at: "2026-04-24T01:37:12Z",
            created_at: "2026-04-24T01:36:56Z",
            updated_at: "2026-04-24T01:37:12Z",
          },
        ],
        threadItems: [
          {
            id: "summary-image-process-flow",
            thread_id: "thread-image-process-flow",
            turn_id: "turn-image-process-flow",
            sequence: 1,
            status: "completed",
            started_at: "2026-04-24T01:36:56Z",
            completed_at: "2026-04-24T01:37:12Z",
            updated_at: "2026-04-24T01:37:12Z",
            type: "turn_summary",
            text: "已完成思考 3 步，正在提交图片任务",
          },
        ],
      },
    );

    const streamingCall = mockStreamingRenderer.mock.calls.at(-1)?.[0];
    expect(streamingCall?.suppressProcessFlow).toBe(true);
    expect(
      container.querySelector('[data-testid="agent-thread-timeline:leading"]'),
    ).toBeNull();
  });

  it("视频任务消息卡应在聊天区渲染预览并支持打开工作区查看", () => {
    const now = new Date();
    const onOpenMessagePreview = vi.fn();
    const messages: Message[] = [
      {
        id: "msg-assistant-video-task",
        role: "assistant",
        content: "视频任务已提交，正在生成。",
        timestamp: now,
        taskPreview: {
          kind: "video_generate",
          taskId: "task-video-1",
          taskType: "video_generate",
          prompt: "新品发布会短视频，镜头缓慢推进主角产品",
          status: "running",
          progress: 42,
          durationSeconds: 15,
          aspectRatio: "16:9",
          resolution: "720p",
          projectId: "project-video-1",
          contentId: "content-video-1",
        },
      },
    ];

    const container = render(messages, { onOpenMessagePreview });
    const previewCard = container.querySelector(
      '[data-testid="task-message-preview-task-video-1"]',
    ) as HTMLButtonElement | null;

    expect(previewCard?.textContent).toContain("视频生成");
    expect(previewCard?.textContent).toContain("16:9");
    expect(previewCard?.textContent).toContain("720p");
    expect(previewCard?.textContent).toContain("42%");

    act(() => {
      previewCard?.click();
    });

    expect(onOpenMessagePreview).toHaveBeenCalledWith(
      {
        kind: "task",
        preview: expect.objectContaining({
          kind: "video_generate",
          taskId: "task-video-1",
        }),
      },
      expect.objectContaining({
        id: "msg-assistant-video-task",
      }),
    );
  });

  it("失败的视频任务卡应提供重新生成动作，并通过事件总线下发而不是误触发打开工作区", () => {
    const now = new Date();
    const onOpenMessagePreview = vi.fn();
    const messages: Message[] = [
      {
        id: "msg-assistant-video-failed",
        role: "assistant",
        content: "视频任务失败。",
        timestamp: now,
        taskPreview: {
          kind: "video_generate",
          taskId: "task-video-failed-1",
          taskType: "video_generate",
          prompt: "新品发布会短视频，镜头缓慢推进主角产品",
          status: "failed",
          durationSeconds: 15,
          aspectRatio: "16:9",
          resolution: "720p",
          projectId: "project-video-1",
          contentId: "content-video-1",
        },
      },
    ];

    let actionDetail: Record<string, unknown> | null = null;
    const handleAction = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      actionDetail = event.detail as Record<string, unknown>;
    };
    window.addEventListener(VIDEO_WORKBENCH_TASK_ACTION_EVENT, handleAction);

    const container = render(messages, { onOpenMessagePreview });
    const actionButton = container.querySelector(
      '[data-testid="task-message-preview-action-task-video-failed-1-retry"]',
    ) as HTMLButtonElement | null;

    expect(actionButton?.textContent).toContain("重新生成");

    act(() => {
      actionButton?.click();
    });

    expect(actionDetail).toEqual({
      action: "retry",
      taskId: "task-video-failed-1",
      projectId: "project-video-1",
      contentId: "content-video-1",
    });
    expect(onOpenMessagePreview).not.toHaveBeenCalled();

    window.removeEventListener(VIDEO_WORKBENCH_TASK_ACTION_EVENT, handleAction);
  });

  it("进行中的视频任务卡应提供取消动作，并继续保留打开工作区能力", () => {
    const now = new Date();
    const onOpenMessagePreview = vi.fn();
    const messages: Message[] = [
      {
        id: "msg-assistant-video-running-action",
        role: "assistant",
        content: "视频任务进行中。",
        timestamp: now,
        taskPreview: {
          kind: "video_generate",
          taskId: "task-video-running-action-1",
          taskType: "video_generate",
          prompt: "新品发布会短视频，镜头缓慢推进主角产品",
          status: "running",
          progress: 18,
          durationSeconds: 15,
          aspectRatio: "16:9",
          resolution: "720p",
          projectId: "project-video-1",
          contentId: "content-video-1",
        },
      },
    ];

    let actionDetail: Record<string, unknown> | null = null;
    const handleAction = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      actionDetail = event.detail as Record<string, unknown>;
    };
    window.addEventListener(VIDEO_WORKBENCH_TASK_ACTION_EVENT, handleAction);

    const container = render(messages, { onOpenMessagePreview });
    const previewCard = container.querySelector(
      '[data-testid="task-message-preview-task-video-running-action-1"]',
    ) as HTMLButtonElement | null;
    const actionButton = container.querySelector(
      '[data-testid="task-message-preview-action-task-video-running-action-1-cancel"]',
    ) as HTMLButtonElement | null;

    expect(actionButton?.textContent).toContain("取消任务");

    act(() => {
      actionButton?.click();
    });

    expect(actionDetail).toEqual({
      action: "cancel",
      taskId: "task-video-running-action-1",
      projectId: "project-video-1",
      contentId: "content-video-1",
    });
    expect(onOpenMessagePreview).not.toHaveBeenCalled();

    act(() => {
      previewCard?.click();
    });

    expect(onOpenMessagePreview).toHaveBeenCalledWith(
      {
        kind: "task",
        preview: expect.objectContaining({
          kind: "video_generate",
          taskId: "task-video-running-action-1",
        }),
      },
      expect.objectContaining({
        id: "msg-assistant-video-running-action",
      }),
    );

    window.removeEventListener(VIDEO_WORKBENCH_TASK_ACTION_EVENT, handleAction);
  });

  it("通用任务消息卡应在聊天区渲染预览并支持打开对应产物", () => {
    const now = new Date();
    const onOpenMessagePreview = vi.fn();
    const messages: Message[] = [
      {
        id: "msg-assistant-resource-task",
        role: "assistant",
        content: "素材检索任务已提交。",
        timestamp: now,
        taskPreview: {
          kind: "modal_resource_search",
          taskId: "task-resource-1",
          taskType: "modal_resource_search",
          prompt: "咖啡馆木桌背景",
          title: "公众号头图素材",
          status: "running",
          artifactPath:
            ".lime/tasks/modal_resource_search/task-resource-1.json",
          metaItems: ["image", "公众号头图", "8 个候选"],
        },
      },
    ];

    const container = render(messages, { onOpenMessagePreview });
    const previewCard = container.querySelector(
      '[data-testid="task-message-preview-task-resource-1"]',
    ) as HTMLButtonElement | null;

    expect(previewCard?.textContent).toContain("素材检索");
    expect(previewCard?.textContent).toContain("公众号头图素材");
    expect(previewCard?.textContent).toContain("8 个候选");

    act(() => {
      previewCard?.click();
    });

    expect(onOpenMessagePreview).toHaveBeenCalledWith(
      {
        kind: "task",
        preview: expect.objectContaining({
          kind: "modal_resource_search",
          taskId: "task-resource-1",
        }),
      },
      expect.objectContaining({
        id: "msg-assistant-resource-task",
      }),
    );
  });

  it("配音任务消息卡应展示 audio_generate 预览并支持打开运行时文档", () => {
    const now = new Date();
    const onOpenMessagePreview = vi.fn();
    const messages: Message[] = [
      {
        id: "msg-assistant-audio-task",
        role: "assistant",
        content: "配音任务已提交。",
        timestamp: now,
        taskPreview: {
          kind: "audio_generate",
          taskId: "task-audio-1",
          taskType: "audio_generate",
          prompt: "欢迎来到 Lime 多模态工作台。",
          title: "配音生成任务",
          status: "running",
          artifactPath: ".lime/runtime/audio-generate/task-audio-1.md",
          taskFilePath: ".lime/tasks/audio_generate/task-audio-1.json",
          metaItems: ["warm_female", "8 秒"],
          voice: "warm_female",
          durationMs: 8200,
        },
      },
    ];

    const container = render(messages, { onOpenMessagePreview });
    const previewCard = container.querySelector(
      '[data-testid="task-message-preview-task-audio-1"]',
    ) as HTMLButtonElement | null;

    expect(previewCard?.textContent).toContain("配音生成");
    expect(previewCard?.textContent).toContain("欢迎来到 Lime 多模态工作台");
    expect(previewCard?.textContent).toContain("warm_female");
    expect(previewCard?.textContent).toContain("源任务");

    act(() => {
      previewCard?.click();
    });

    expect(onOpenMessagePreview).toHaveBeenCalledWith(
      {
        kind: "task",
        preview: expect.objectContaining({
          kind: "audio_generate",
          taskId: "task-audio-1",
        }),
      },
      expect.objectContaining({
        id: "msg-assistant-audio-task",
      }),
    );
  });

  it("失败的配音任务卡应展示 provider 错误码与原因", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-audio-task-failed",
        role: "assistant",
        content: "配音任务失败。",
        timestamp: now,
        taskPreview: {
          kind: "audio_generate",
          taskId: "task-audio-failed-1",
          taskType: "audio_generate",
          prompt: "欢迎来到 Lime 多模态工作台。",
          title: "配音生成任务",
          status: "failed",
          artifactPath: ".lime/runtime/audio-generate/task-audio-failed-1.md",
          taskFilePath: ".lime/tasks/audio_generate/task-audio-failed-1.json",
          errorCode: "audio_provider_unconfigured",
          errorMessage:
            "未找到可用的 voice_generation provider/API Key: missing-provider。",
          statusMessage:
            "配音 Provider 未配置，请先在语音生成设置中选择可用 Provider；任务保留在 audio_generate，不会回退 legacy TTS。",
        },
      },
    ];

    const container = render(messages);
    const previewCard = container.querySelector(
      '[data-testid="task-message-preview-task-audio-failed-1"]',
    ) as HTMLButtonElement | null;

    expect(previewCard?.textContent).toContain("执行失败");
    expect(previewCard?.textContent).toContain("audio_provider_unconfigured");
    expect(previewCard?.textContent).toContain(
      "未找到可用的 voice_generation provider/API Key",
    );
    expect(previewCard?.textContent).toContain("不会回退 legacy TTS");
  });

  it("转写任务消息卡应展示 transcript 路径与 provider 错误", () => {
    const now = new Date();
    const onOpenMessagePreview = vi.fn();
    const messages: Message[] = [
      {
        id: "msg-assistant-transcription-task",
        role: "assistant",
        content: "转写任务已同步。",
        timestamp: now,
        taskPreview: {
          kind: "transcription_generate",
          taskId: "task-transcription-1",
          taskType: "transcription_generate",
          prompt: "请转写访谈音频",
          title: "内容转写任务",
          status: "complete",
          artifactPath:
            ".lime/runtime/transcription-generate/task-transcription-1.md",
          taskFilePath:
            ".lime/tasks/transcription_generate/task-transcription-1.json",
          transcriptPath: ".lime/runtime/transcripts/task-transcription-1.txt",
          language: "zh-CN",
          outputFormat: "txt",
          transcriptSegments: [
            {
              id: "segment-1",
              index: 1,
              startMs: 1000,
              endMs: 3500,
              speaker: "主持人",
              text: "欢迎来到 Lime 访谈。",
            },
          ],
          statusMessage:
            "转写结果已同步，工作区已从 transcript 读取可校对文本。",
        },
      },
    ];

    const container = render(messages, { onOpenMessagePreview });
    const previewCard = container.querySelector(
      '[data-testid="task-message-preview-task-transcription-1"]',
    ) as HTMLButtonElement | null;

    expect(previewCard?.textContent).toContain("内容转写");
    expect(previewCard?.textContent).toContain("请转写访谈音频");
    expect(previewCard?.textContent).toContain("转写结果");
    expect(previewCard?.textContent).toContain("task-transcription-1.txt");
    expect(previewCard?.textContent).toContain("1 段时间轴");
    expect(previewCard?.textContent).toContain("时间轴预览");
    expect(previewCard?.textContent).toContain("主持人：欢迎来到 Lime 访谈。");

    act(() => {
      previewCard?.click();
    });

    expect(onOpenMessagePreview).toHaveBeenCalledWith(
      {
        kind: "task",
        preview: expect.objectContaining({
          kind: "transcription_generate",
          taskId: "task-transcription-1",
        }),
      },
      expect.objectContaining({
        id: "msg-assistant-transcription-task",
      }),
    );
  });

  it("失败的转写任务卡应展示 transcript 错误码与原因", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-transcription-task-failed",
        role: "assistant",
        content: "转写任务失败。",
        timestamp: now,
        taskPreview: {
          kind: "transcription_generate",
          taskId: "task-transcription-failed-1",
          taskType: "transcription_generate",
          prompt: "请转写访谈音频",
          title: "内容转写任务",
          status: "failed",
          artifactPath:
            ".lime/runtime/transcription-generate/task-transcription-failed-1.md",
          taskFilePath:
            ".lime/tasks/transcription_generate/task-transcription-failed-1.json",
          errorCode: "transcription_provider_unconfigured",
          errorMessage:
            "未找到可用的 audio_transcription provider/API Key: missing-provider。",
          statusMessage:
            "转写 Provider 未配置，请先在转写设置中选择可用 Provider；任务保留在 transcription_generate，不会回退 frontend ASR。",
        },
      },
    ];

    const container = render(messages);
    const previewCard = container.querySelector(
      '[data-testid="task-message-preview-task-transcription-failed-1"]',
    ) as HTMLButtonElement | null;

    expect(previewCard?.textContent).toContain("执行失败");
    expect(previewCard?.textContent).toContain(
      "transcription_provider_unconfigured",
    );
    expect(previewCard?.textContent).toContain(
      "未找到可用的 audio_transcription provider/API Key",
    );
    expect(previewCard?.textContent).toContain("不会回退 frontend ASR");
  });

  it("联网搜图结果消息卡应展示缩略图候选", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-resource-search-preview",
        role: "assistant",
        content: "已找到一组图片素材候选。",
        timestamp: now,
        taskPreview: {
          kind: "modal_resource_search",
          taskId: "resource-search:tool-1",
          taskType: "modal_resource_search",
          prompt: "cozy coffee table",
          title: "Pexels 图片候选",
          status: "complete",
          artifactPath: ".lime/runtime/resource-search/tool-1.md",
          metaItems: ["Pexels", "3 个候选"],
          imageCandidates: [
            {
              id: "hit-1",
              thumbnailUrl: "https://pexels.example/1-thumb.jpg",
              contentUrl: "https://pexels.example/1.jpg",
              name: "cozy coffee table 1",
            },
            {
              id: "hit-2",
              thumbnailUrl: "https://pexels.example/2-thumb.jpg",
              contentUrl: "https://pexels.example/2.jpg",
              name: "cozy coffee table 2",
            },
            {
              id: "hit-3",
              thumbnailUrl: "https://pexels.example/3-thumb.jpg",
              contentUrl: "https://pexels.example/3.jpg",
              name: "cozy coffee table 3",
            },
          ],
        },
      },
    ];

    const container = render(messages);
    const media = container.querySelector(
      '[data-testid="task-message-preview-media-resource-search:tool-1"]',
    );

    expect(media).not.toBeNull();
    expect(
      container.querySelector('img[src="https://pexels.example/1-thumb.jpg"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('img[src="https://pexels.example/2-thumb.jpg"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('img[src="https://pexels.example/3-thumb.jpg"]'),
    ).toBeTruthy();
  });

  it("修图任务消息卡应展示来源图区域与修图语义", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-image-edit-preview",
        role: "assistant",
        content: "修图任务已完成。",
        timestamp: now,
        imageWorkbenchPreview: {
          taskId: "task-edit-1",
          prompt: "去掉背景里的广告牌，保留主体人物",
          mode: "edit",
          status: "complete",
          imageUrl: "https://example.com/edited.png",
          imageCount: 1,
          sourceImageUrl: "https://example.com/source.png",
          sourceImagePrompt: "原始街景海报",
          sourceImageRef: "img-source-1",
          sourceImageCount: 1,
          projectId: "project-1",
          contentId: "content-1",
        },
      },
    ];

    const container = render(messages);
    const previewCard = container.querySelector(
      '[data-testid="image-workbench-message-preview-task-edit-1"]',
    );

    expect(previewCard?.textContent).toContain("已修图");
    expect(previewCard?.textContent).toContain("来源图");
    expect(previewCard?.textContent).toContain("原始街景海报");
    expect(previewCard?.textContent).not.toContain("Image Editing");
  });

  it("图片任务完成但图片仍在工作台时，不应继续显示生成中占位", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-image-workbench-complete-without-image",
        role: "assistant",
        content: "图片任务已完成。",
        timestamp: now,
        imageWorkbenchPreview: {
          taskId: "task-complete-without-image",
          prompt: "赛博青柠实验室，电影感光影",
          status: "complete",
          imageCount: 2,
          projectId: "project-1",
          contentId: "content-1",
        },
      },
    ];

    const container = render(messages);
    const previewCard = container.querySelector(
      '[data-testid="image-workbench-message-preview-task-complete-without-image"]',
    );

    expect(previewCard?.textContent).toContain("结果已同步");
    expect(previewCard?.textContent).toContain("已生成");
    expect(previewCard?.textContent).toContain("可在右侧继续查看与使用");
    expect(previewCard?.textContent).not.toContain("图片任务卡");
  });

  it("图片任务已经完成时，不应继续向用户暴露同步中的过渡文案", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-image-workbench-complete-sync-copy",
        role: "assistant",
        content: "图片任务已完成。",
        timestamp: now,
        imageWorkbenchPreview: {
          taskId: "task-complete-sync-copy",
          prompt: "广州塔清晨薄雾氛围图",
          status: "complete",
          imageUrl: "https://example.com/guangzhou-tower-morning.png",
          imageCount: 1,
          statusMessage: "图片任务已提交，正在同步任务状态。",
          projectId: "project-1",
          contentId: "content-1",
        },
      },
    ];

    const container = render(messages);
    const previewCard = container.querySelector(
      '[data-testid="image-workbench-message-preview-task-complete-sync-copy"]',
    );

    expect(previewCard?.textContent).toContain("已生成");
    expect(previewCard?.textContent).toContain("可在右侧继续查看与使用");
    expect(previewCard?.textContent).not.toContain("正在同步任务状态");
    expect(previewCard?.textContent).not.toContain("图片任务已提交");
  });

  it("失败的图片任务卡应收敛为静态状态卡，不再展示操作按钮", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-image-workbench-failed",
        role: "assistant",
        content: "图片任务失败。",
        timestamp: now,
        imageWorkbenchPreview: {
          taskId: "task-failed-1",
          prompt: "青柠品牌 KV",
          status: "failed",
          projectId: "project-1",
          contentId: "content-1",
        },
      },
    ];

    const container = render(messages);
    const previewCard = container.querySelector(
      '[data-testid="image-workbench-message-preview-task-failed-1"]',
    );

    expect(previewCard?.textContent).toContain("生成失败");
    expect(previewCard?.textContent).toContain("调整描述后重试");
    expect(
      container.querySelector(
        '[data-testid="image-workbench-message-preview-action-task-failed-1-retry"]',
      ),
    ).toBeNull();
  });

  it("生成中的图片任务卡应展示队列状态，但不再展示取消按钮", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-image-workbench-running",
        role: "assistant",
        content: "图片任务处理中。",
        timestamp: now,
        imageWorkbenchPreview: {
          taskId: "task-running-1",
          prompt: "青柠宇航员海报",
          status: "running",
          phase: "queued",
          statusMessage: "任务已进入队列，等待图片服务分配执行槽位。",
          attemptCount: 2,
          projectId: "project-1",
          contentId: "content-1",
        },
      },
    ];

    const container = render(messages);
    expect(container.textContent).toContain("等待队列");
    expect(container.textContent).toContain(
      "任务已进入队列，等待图片服务分配执行槽位。",
    );
    expect(
      container.querySelector(
        '[data-testid="image-workbench-message-preview-action-task-running-1-cancel"]',
      ),
    ).toBeNull();
  });

  it("失败的图片任务卡应保留错误文案，但不再突出不可重试标签", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-image-workbench-failed-no-retry",
        role: "assistant",
        content: "图片任务失败。",
        timestamp: now,
        imageWorkbenchPreview: {
          taskId: "task-failed-no-retry",
          prompt: "青柠品牌 KV",
          status: "failed",
          retryable: false,
          statusMessage: "FAL 请求参数无效，请先调整配置。",
          projectId: "project-1",
          contentId: "content-1",
        },
      },
    ];

    const container = render(messages);
    const previewCard = container.querySelector(
      '[data-testid="image-workbench-message-preview-task-failed-no-retry"]',
    );

    expect(previewCard?.textContent).toContain("生成失败");
    expect(previewCard?.textContent).toContain(
      "FAL 请求参数无效，请先调整配置。",
    );
    expect(previewCard?.textContent).not.toContain("不可重试");
  });

  it("已取消的图片任务卡应显示独立状态且不再展示重试按钮", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-image-workbench-cancelled",
        role: "assistant",
        content: "图片任务已取消。",
        timestamp: now,
        imageWorkbenchPreview: {
          taskId: "task-cancelled-1",
          prompt: "青柠像素头像",
          status: "cancelled",
          projectId: "project-1",
          contentId: "content-1",
        },
      },
    ];

    const container = render(messages);
    const previewCard = container.querySelector(
      '[data-testid="image-workbench-message-preview-task-cancelled-1"]',
    );

    expect(previewCard?.textContent).toContain("已取消");
    expect(previewCard?.textContent).toContain("任务已取消");
    expect(previewCard?.textContent).not.toContain("打开查看");
    expect(
      container.querySelector(
        '[data-testid="image-workbench-message-preview-action-task-cancelled-1-retry"]',
      ),
    ).toBeNull();
  });

  it("图片任务卡点击后仍应打开右侧查看区，而不是丢失导航能力", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-image-workbench-cancelled-open",
        role: "assistant",
        content: "图片任务已取消。",
        timestamp: now,
        imageWorkbenchPreview: {
          taskId: "task-open-1",
          prompt: "青柠像素头像",
          status: "cancelled",
          projectId: "project-1",
          contentId: "content-1",
        },
      },
    ];

    let focusDetail: Record<string, unknown> | null = null;
    const handleFocus = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      focusDetail = event.detail as Record<string, unknown>;
    };
    window.addEventListener(IMAGE_WORKBENCH_FOCUS_EVENT, handleFocus);

    const container = render(messages);
    const previewCard = container.querySelector(
      '[data-testid="image-workbench-message-preview-task-open-1"]',
    ) as HTMLButtonElement | null;

    act(() => {
      previewCard?.click();
    });

    expect(focusDetail).toEqual({
      projectId: "project-1",
      contentId: "content-1",
    });

    window.removeEventListener(IMAGE_WORKBENCH_FOCUS_EVENT, handleFocus);
  });

  it("图片任务卡默认不再渲染任何底部操作按钮", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-image-workbench-actions-hidden",
        role: "assistant",
        content: "图片任务处理中。",
        timestamp: now,
        imageWorkbenchPreview: {
          taskId: "task-actions-hidden",
          prompt: "青柠宇航员海报",
          status: "running",
          projectId: "project-1",
          contentId: "content-1",
        },
      },
    ];

    const container = render(messages);
    expect(
      container.querySelectorAll(
        '[data-testid^="image-workbench-message-preview-action-"]',
      ).length,
    ).toBe(0);
  });

  it("3x3 分镜消息卡应渲染九宫格摘要而不是单图卡", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-image-workbench-storyboard",
        role: "assistant",
        content: "3x3 分镜已完成。",
        timestamp: now,
        imageWorkbenchPreview: {
          taskId: "task-storyboard-preview-1",
          prompt: "三国主要人物分镜",
          status: "complete",
          imageCount: 9,
          imageUrl: "https://example.com/storyboard-primary.png",
          previewImages: Array.from(
            { length: 9 },
            (_, index) => `https://example.com/storyboard-${index + 1}.png`,
          ),
          layoutHint: "storyboard_3x3",
          projectId: "project-1",
          contentId: "content-1",
        },
      },
    ];

    const container = render(messages);
    const grid = container.querySelector(
      '[data-testid="image-workbench-message-preview-grid-task-storyboard-preview-1"]',
    ) as HTMLDivElement | null;

    expect(container.textContent).toContain(
      "3x3 分镜已经完成，可在右侧继续查看与使用。",
    );
    expect(container.textContent).toContain("9 张");
    expect(grid?.className).toContain("grid-cols-3");
    expect(grid?.querySelectorAll("img")).toHaveLength(9);
    expect(grid?.textContent).toContain("1");
    expect(grid?.textContent).toContain("9");
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

  it("已完成 assistant 消息应只向正文传递可见正文片段", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-process-suppressed",
        role: "assistant",
        content: "最终说明",
        timestamp: now,
        thinkingContent: "这段思考应只留在执行轨迹中。",
        contentParts: [
          {
            type: "thinking",
            text: "这段思考应只留在执行轨迹中。",
          },
          {
            type: "tool_use",
            toolCall: {
              id: "tool-process-suppressed-1",
              name: "functions.exec_command",
              arguments: JSON.stringify({ cmd: "rg -n process src" }),
              status: "completed",
              result: { success: true, output: "ok" },
              startTime: now,
              endTime: now,
            },
          },
          {
            type: "text",
            text: "最终说明",
          },
        ],
        toolCalls: [
          {
            id: "tool-process-suppressed-1",
            name: "functions.exec_command",
            arguments: JSON.stringify({ cmd: "rg -n process src" }),
            status: "completed",
            result: { success: true, output: "ok" },
            startTime: now,
            endTime: now,
          },
        ],
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
    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        thinkingContent: undefined,
        toolCalls: undefined,
        contentParts: [{ type: "text", text: "最终说明" }],
      }),
    );
  });

  it("流式 assistant 消息仍应向正文传递当前过程状态", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-streaming-process",
        role: "assistant",
        content: "",
        timestamp: now,
        isThinking: true,
        thinkingContent: "先读取当前实现。",
        contentParts: [
          {
            type: "thinking",
            text: "先读取当前实现。",
          },
        ],
        toolCalls: [
          {
            id: "tool-streaming-process-1",
            name: "Read",
            arguments: JSON.stringify({ file_path: "src/app.tsx" }),
            status: "running",
            startTime: now,
          },
        ],
      },
    ];

    render(messages);

    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        thinkingContent: "先读取当前实现。",
        toolCalls: [
          expect.objectContaining({
            id: "tool-streaming-process-1",
            status: "running",
          }),
        ],
        contentParts: [{ type: "thinking", text: "先读取当前实现。" }],
      }),
    );
  });

  it("已完成旧消息残留 runtimeStatus 时不应把思考过程重复塞回正文", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-stale-runtime",
        role: "assistant",
        content: "这是最终回答。",
        timestamp: now,
        runtimeStatus: {
          phase: "routing",
          title: "历史运行态",
          detail: "旧版本残留的运行态不应影响正文。",
        },
        thinkingContent: "这段思考只应留在执行轨迹里。",
        contentParts: [
          {
            type: "thinking",
            text: "这段思考只应留在执行轨迹里。",
          },
          {
            type: "text",
            text: "这是最终回答。",
          },
        ],
      },
    ];

    render(messages);

    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        thinkingContent: undefined,
        contentParts: [{ type: "text", text: "这是最终回答。" }],
      }),
    );
  });

  it("已完成工具调用应回到消息顶部执行轨迹展示，不再占用正文主视觉", () => {
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
      container.querySelector('[data-testid="agent-thread-timeline:trailing"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-timeline:leading"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="assistant-primary-timeline-shell"]',
      ),
    ).not.toBeNull();
    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        renderProposedPlanBlocks: false,
        toolCalls: undefined,
        contentParts: [{ type: "text", text: "已经定位到问题根因。" }],
      }),
    );
  });

  it("当前回合仍在运行时，即使 assistant 非 streaming 占位也应继续透传工具调用", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-active-turn",
        role: "assistant",
        content: "正在分析依赖关系。",
        timestamp: now,
        runtimeStatus: {
          phase: "routing",
          title: "处理中",
          detail: "正在读取多个 crate 的依赖。",
        },
        contentParts: [
          {
            type: "tool_use",
            toolCall: {
              id: "tool-active-turn-1",
              name: "functions.exec_command",
              arguments: JSON.stringify({
                cmd: "sed -n '1,120p' Cargo.toml",
              }),
              status: "running",
              startTime: now,
            },
          },
          {
            type: "text",
            text: "正在分析依赖关系。",
          },
        ],
        toolCalls: [
          {
            id: "tool-active-turn-1",
            name: "functions.exec_command",
            arguments: JSON.stringify({
              cmd: "sed -n '1,120p' Cargo.toml",
            }),
            status: "running",
            startTime: now,
          },
        ],
      },
    ];

    render(messages, {
      currentTurnId: "turn-active-turn",
      turns: [
        {
          id: "turn-active-turn",
          thread_id: "thread-active-turn",
          prompt_text: "继续分析",
          status: "running",
          started_at: "2026-04-15T10:00:00Z",
          created_at: "2026-04-15T10:00:00Z",
          updated_at: "2026-04-15T10:00:03Z",
        },
      ],
      threadRead: {
        thread_id: "thread-active-turn",
        status: "running",
      },
    });

    expect(mockStreamingRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCalls: [
          expect.objectContaining({
            id: "tool-active-turn-1",
            status: "running",
          }),
        ],
        contentParts: [
          expect.objectContaining({
            type: "tool_use",
          }),
          {
            type: "text",
            text: "正在分析依赖关系。",
          },
        ],
      }),
    );
  });

  it("内联高层工具过程不应吞掉不同工具名的底层执行轨迹", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-service-tool",
        role: "assistant",
        content: "文章已经保存到项目。",
        timestamp: now,
        contentParts: [
          {
            type: "tool_use",
            toolCall: {
              id: "tool-service-1",
              name: "lime_run_service_skill",
              arguments: JSON.stringify({ skill_id: "x_article_export" }),
              status: "completed",
              result: { success: true, output: "saved" },
              startTime: now,
              endTime: now,
            },
          },
          {
            type: "text",
            text: "文章已经保存到项目。",
          },
        ],
      },
    ];

    const container = render(messages, {
      currentTurnId: "turn-service-tool",
      turns: [
        {
          id: "turn-service-tool",
          thread_id: "thread-1",
          prompt_text: "继续保存文章",
          status: "completed",
          started_at: "2026-04-09T12:00:00Z",
          completed_at: "2026-04-09T12:00:05Z",
          created_at: "2026-04-09T12:00:00Z",
          updated_at: "2026-04-09T12:00:05Z",
        },
      ],
      threadItems: [
        {
          id: "item-read-1",
          thread_id: "thread-1",
          turn_id: "turn-service-tool",
          sequence: 1,
          status: "completed",
          started_at: "2026-04-09T12:00:01Z",
          completed_at: "2026-04-09T12:00:02Z",
          updated_at: "2026-04-09T12:00:02Z",
          type: "tool_call",
          tool_name: "Read",
          arguments: { file_path: "article.md" },
        },
        {
          id: "item-write-1",
          thread_id: "thread-1",
          turn_id: "turn-service-tool",
          sequence: 2,
          status: "completed",
          started_at: "2026-04-09T12:00:03Z",
          completed_at: "2026-04-09T12:00:04Z",
          updated_at: "2026-04-09T12:00:04Z",
          type: "tool_call",
          tool_name: "Write",
          arguments: { file_path: "article.md" },
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="agent-thread-timeline:leading"]'),
    ).not.toBeNull();
  });

  it("完成态 process 不再占正文时，计划信息应回到消息前序执行轨迹", () => {
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
        renderProposedPlanBlocks: false,
        thinkingContent: undefined,
        contentParts: [{ type: "text", text: "已经整理完执行思路。" }],
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

  it("不应把 .lime/artifacts 下的内部 artifact 文稿 JSON 渲染成尾部时间线", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-hidden-artifact-json",
        role: "assistant",
        content: "已生成内部文稿快照。",
        timestamp: now,
      },
    ];

    const container = render(messages, {
      currentTurnId: "turn-hidden-artifact-json",
      turns: [
        {
          id: "turn-hidden-artifact-json",
          thread_id: "thread-1",
          prompt_text: "生成内部 artifact 文稿",
          status: "completed",
          started_at: "2026-04-10T10:35:00Z",
          completed_at: "2026-04-10T10:35:03Z",
          created_at: "2026-04-10T10:35:00Z",
          updated_at: "2026-04-10T10:35:03Z",
        },
      ],
      threadItems: [
        {
          id: "item-hidden-artifact-json",
          thread_id: "thread-1",
          turn_id: "turn-hidden-artifact-json",
          sequence: 1,
          status: "completed",
          started_at: "2026-04-10T10:35:01Z",
          completed_at: "2026-04-10T10:35:02Z",
          updated_at: "2026-04-10T10:35:02Z",
          type: "file_artifact",
          path: ".lime/artifacts/thread-1/report.artifact.json",
          source: "artifact_snapshot",
          content: '{"schemaVersion":"artifact_document.v1"}',
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="agent-thread-timeline:trailing"]'),
    ).toBeNull();
  });

  it("同一路径的 file_artifact 重复出现时，尾部时间线只应保留更完整的一条", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-duplicate-artifact",
        role: "assistant",
        content: "导出完成。",
        timestamp: now,
      },
    ];

    render(messages, {
      currentTurnId: "turn-duplicate-artifact",
      turns: [
        {
          id: "turn-duplicate-artifact",
          thread_id: "thread-1",
          prompt_text: "导出 index.md",
          status: "completed",
          started_at: "2026-04-10T09:57:00Z",
          completed_at: "2026-04-10T09:57:05Z",
          created_at: "2026-04-10T09:57:00Z",
          updated_at: "2026-04-10T09:57:05Z",
        },
      ],
      threadItems: [
        {
          id: "item-artifact-duplicate-empty",
          thread_id: "thread-1",
          turn_id: "turn-duplicate-artifact",
          sequence: 1,
          status: "completed",
          started_at: "2026-04-10T09:57:01Z",
          completed_at: "2026-04-10T09:57:02Z",
          updated_at: "2026-04-10T09:57:02Z",
          type: "file_artifact",
          path: "exports/x-article-export/google/index.md",
          source: "artifact_snapshot",
          content: "",
        },
        {
          id: "item-artifact-duplicate-rich",
          thread_id: "thread-1",
          turn_id: "turn-duplicate-artifact",
          sequence: 2,
          status: "completed",
          started_at: "2026-04-10T09:57:03Z",
          completed_at: "2026-04-10T09:57:04Z",
          updated_at: "2026-04-10T09:57:04Z",
          type: "file_artifact",
          path: "exports/x-article-export/google/index.md",
          source: "artifact_snapshot",
          content: "# 最新导出\n\n这里是完整预览。",
        },
      ],
    });

    const trailingTimelineProps = mockAgentThreadTimeline.mock.calls.find(
      ([props]) => props?.placement === "trailing",
    )?.[0] as { items?: Array<Record<string, unknown>> } | undefined;

    expect(trailingTimelineProps?.items).toHaveLength(1);
    expect(trailingTimelineProps?.items?.[0]).toEqual(
      expect.objectContaining({
        path: "exports/x-article-export/google/index.md",
        content: "# 最新导出\n\n这里是完整预览。",
      }),
    );
  });

  it("已有尾部 file_artifact 卡片时，不应再额外渲染消息级在画布中打开入口", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-artifact-card-only",
        role: "assistant",
        content: "导出完成。",
        timestamp: now,
      },
    ];

    const container = render(messages, {
      currentTurnId: "turn-artifact-card-only",
      turns: [
        {
          id: "turn-artifact-card-only",
          thread_id: "thread-1",
          prompt_text: "导出 index.md",
          status: "completed",
          started_at: "2026-04-10T10:20:00Z",
          completed_at: "2026-04-10T10:20:05Z",
          created_at: "2026-04-10T10:20:00Z",
          updated_at: "2026-04-10T10:20:05Z",
        },
      ],
      threadItems: [
        {
          id: "item-artifact-card-only",
          thread_id: "thread-1",
          turn_id: "turn-artifact-card-only",
          sequence: 1,
          status: "completed",
          started_at: "2026-04-10T10:20:01Z",
          completed_at: "2026-04-10T10:20:02Z",
          updated_at: "2026-04-10T10:20:02Z",
          type: "file_artifact",
          path: "exports/x-article-export/google/index.md",
          source: "artifact_snapshot",
          content: "# 最新导出\n\n这里是完整预览。",
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="message-canvas-shortcut"]'),
    ).toBeNull();
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
    expect(
      container.querySelector('[data-testid="streaming-renderer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="assistant-message-meta-footer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-runtime-status-line"]'),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="assistant-first-token-placeholder"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("正在打开 GitHub");
  });

  it("首字前已有运行中 turn_summary 时仍应优先展示轻量等待占位", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-first-token-with-summary",
        role: "assistant",
        content: "",
        timestamp: now,
        isThinking: true,
        runtimeStatus: {
          phase: "preparing",
          title: "已接收请求，正在准备执行",
          detail:
            "系统正在初始化本轮执行环境并整理上下文，稍后会继续返回更详细进度。",
          checkpoints: ["请求已接收"],
        },
      },
    ];

    const container = render(messages, {
      currentTurnId: "turn-first-token-with-summary",
      turns: [
        {
          id: "turn-first-token-with-summary",
          thread_id: "thread-1",
          prompt_text: "你好",
          status: "running",
          started_at: "2026-03-30T10:20:00Z",
          created_at: "2026-03-30T10:20:00Z",
          updated_at: "2026-03-30T10:20:05Z",
        },
      ],
      threadItems: [
        {
          id: "summary-first-token-1",
          thread_id: "thread-1",
          turn_id: "turn-first-token-with-summary",
          sequence: 1,
          status: "in_progress",
          started_at: "2026-03-30T10:20:00Z",
          updated_at: "2026-03-30T10:20:05Z",
          type: "turn_summary",
          text: "已接收请求，正在准备执行",
        },
      ],
    });

    expect(
      container.querySelector(
        '[data-testid="assistant-first-token-placeholder"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-timeline:trailing"]'),
    ).toBeNull();
    expect(container.textContent).toContain("已接收请求，正在准备执行");
  });

  it("本地工具批次的阶段结论不应再进入主消息流时间线", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-local-batch",
        role: "assistant",
        content: "",
        timestamp: now,
      },
    ];

    const container = render(messages, {
      currentTurnId: "turn-local-batch",
      turns: [
        {
          id: "turn-local-batch",
          thread_id: "thread-1",
          prompt_text: "分析本地仓库",
          status: "running",
          started_at: "2026-04-14T10:00:00Z",
          created_at: "2026-04-14T10:00:00Z",
          updated_at: "2026-04-14T10:00:10Z",
        },
      ],
      threadItems: [
        {
          id: "summary-local-batch-1",
          thread_id: "thread-1",
          turn_id: "turn-local-batch",
          sequence: 1,
          status: "in_progress",
          started_at: "2026-04-14T10:00:00Z",
          updated_at: "2026-04-14T10:00:10Z",
          type: "turn_summary",
          text: "已完成一批本地分析\n已完成这一批本地仓库的文件读取，正在整理这一批结果并判断是否还需要继续取证。",
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="agent-thread-timeline:trailing"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("已完成一批本地分析");
    expect(container.textContent).not.toContain("正在整理这一批结果");
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

  it("助手结果应支持保存为技能草稿", () => {
    const onSaveMessageAsSkill = vi.fn();
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-save-skill",
        role: "assistant",
        content:
          "这是一段足够长的结果说明，用来验证助手消息上会出现保存为技能的入口。",
        timestamp: now,
      },
    ];

    const container = render(messages, { onSaveMessageAsSkill });
    const saveButton = container.querySelector(
      'button[aria-label="保存为技能"]',
    );

    expect(saveButton).not.toBeNull();

    act(() => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSaveMessageAsSkill).toHaveBeenCalledWith({
      messageId: "msg-assistant-save-skill",
      content:
        "这是一段足够长的结果说明，用来验证助手消息上会出现保存为技能的入口。",
    });
  });

  it("助手结果应支持保存到灵感库", () => {
    const onSaveMessageAsInspiration = vi.fn();
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-save-memory",
        role: "assistant",
        content:
          "这是一段足够长的结果说明，用来验证助手消息上会出现保存到灵感库的入口。",
        timestamp: now,
      },
    ];

    const container = render(messages, { onSaveMessageAsInspiration });
    const saveButton = container.querySelector(
      'button[aria-label="保存到灵感库"]',
    );

    expect(saveButton).not.toBeNull();

    act(() => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSaveMessageAsInspiration).toHaveBeenCalledWith({
      messageId: "msg-assistant-save-memory",
      content:
        "这是一段足够长的结果说明，用来验证助手消息上会出现保存到灵感库的入口。",
    });
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
    expect(
      window.getComputedStyle(assistantBubble as Element).maxWidth,
    ).toContain("1040px");
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

    expect(
      container.querySelector('[data-testid="markdown-renderer"]'),
    ).toBeNull();
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

    const container = render(messages);

    expect(
      container.querySelector('[data-testid="streaming-renderer"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("[Image #1]");
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

  it("内容发布主链产物卡片应优先显示预览/上传/发布语义标题", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-content-post-artifact",
        role: "assistant",
        content: "已整理渠道预览稿",
        timestamp: now,
        artifacts: [
          {
            id: "artifact-content-post-preview",
            type: "document",
            title: "20260408-preview.md",
            content: "# 春日咖啡活动",
            status: "complete",
            meta: {
              filePath: "content-posts/20260408-preview.md",
              filename: "20260408-preview.md",
              contentPostIntent: "preview",
              contentPostLabel: "渠道预览稿",
              contentPostPlatformLabel: "小红书",
            },
            position: { start: 0, end: 0 },
            createdAt: now.getTime(),
            updatedAt: now.getTime(),
          },
        ],
      },
    ];

    const container = render(messages);

    expect(container.textContent).toContain("渠道预览稿");
    expect(container.textContent).toContain(
      "content-posts/20260408-preview.md",
    );
    const titleNode = container.querySelector(
      "div.truncate.text-sm.font-medium.text-foreground",
    );
    expect(titleNode?.textContent).toBe("渠道预览稿");
  });

  it("不应把 .lime/tasks 下的内部任务快照 JSON 渲染成用户可见产物卡片", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-hidden-task-json",
        role: "assistant",
        content: "图片任务进行中",
        timestamp: now,
        artifacts: [
          {
            id: "artifact-hidden-task-json",
            type: "code",
            title: "task-image-1.json",
            content: '{"status":"running"}',
            status: "complete",
            meta: {
              filePath: ".lime/tasks/image_generate/task-image-1.json",
              filename: "task-image-1.json",
            },
            position: { start: 0, end: 0 },
            createdAt: now.getTime(),
            updatedAt: now.getTime(),
          },
        ],
      },
    ];

    const container = render(messages);
    expect(container.textContent).toContain("图片任务进行中");
    expect(container.textContent).not.toContain("task-image-1.json");
  });

  it("不应把 .lime/artifacts 下的内部 artifact 文稿 JSON 渲染成用户可见产物卡片", () => {
    const now = new Date();
    const messages: Message[] = [
      {
        id: "msg-assistant-hidden-conversation-artifact-json",
        role: "assistant",
        content: "内部文稿已同步。",
        timestamp: now,
        artifacts: [
          {
            id: "artifact-hidden-conversation-artifact-json",
            type: "document",
            title: "report.artifact.json",
            content: '{"schemaVersion":"artifact_document.v1"}',
            status: "complete",
            meta: {
              filePath: ".lime/artifacts/thread-1/report.artifact.json",
              filename: "report.artifact.json",
            },
            position: { start: 0, end: 0 },
            createdAt: now.getTime(),
            updatedAt: now.getTime(),
          },
        ],
      },
    ];

    const container = render(messages);
    expect(container.textContent).toContain("内部文稿已同步。");
    expect(container.textContent).not.toContain("report.artifact.json");
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

    const streaming = container.querySelector(
      '[data-testid="streaming-renderer"]',
    );
    const leadingTimeline = container.querySelector(
      '[data-testid="agent-thread-timeline:leading"]',
    );
    const artifactButton = Array.from(
      container.querySelectorAll("button"),
    ).find((node) => node.textContent?.includes("publish.md"));

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
        id: "msg-assistant-action",
        role: "assistant",
        content: "请先确认文章标题。",
        timestamp: now,
        actionRequests: [
          {
            requestId: "req-ask-title",
            actionType: "ask_user",
            prompt: "请先确认文章标题",
            questions: [{ question: "这篇文章的最终标题是什么？" }],
          },
        ],
      },
    ];

    render(messages, {
      turns: [
        {
          id: "turn-action",
          thread_id: "thread-1",
          prompt_text: "确认文章标题",
          status: "aborted",
          started_at: "2026-03-15T09:00:00Z",
          completed_at: "2026-03-15T09:00:05Z",
          created_at: "2026-03-15T09:00:00Z",
          updated_at: "2026-03-15T09:00:05Z",
        },
      ],
      threadItems: [
        {
          id: "item-action-1",
          thread_id: "thread-1",
          turn_id: "turn-action",
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

  it("当前 turn 已映射到较早助手消息时，不应被最新助手消息抢占", () => {
    const messages: Message[] = [
      {
        id: "msg-user-earlier",
        role: "user",
        content: "先做第一轮分析",
        timestamp: new Date("2026-03-15T09:00:00Z"),
      },
      {
        id: "msg-assistant-earlier",
        role: "assistant",
        content: "先给出一段中间反馈。",
        timestamp: new Date("2026-03-15T09:00:05Z"),
      },
      {
        id: "msg-user-latest",
        role: "user",
        content: "继续下一轮",
        timestamp: new Date("2026-03-15T09:00:10Z"),
      },
      {
        id: "msg-assistant-latest",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-03-15T09:00:20Z"),
        runtimeStatus: {
          phase: "preparing",
          title: "排队中",
          detail: "等待上一轮完成后继续。",
          checkpoints: [],
        },
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
      container.querySelectorAll(
        '[data-testid="agent-thread-timeline:leading"]',
      ),
    );

    expect(streamingNodes).toHaveLength(1);
    expect(timelineNodes).toHaveLength(1);
    expect(
      (timelineNodes[0] as Node).compareDocumentPosition(
        streamingNodes[0] as Node,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="assistant-message-meta-footer"]'),
    ).toBeNull();
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
      container.querySelectorAll('[data-testid^="agent-thread-timeline:"]'),
    );

    expect(
      container.querySelector('[data-testid="agent-thread-reliability-panel"]'),
    ).toBeNull();
    expect(timelineNodes).toHaveLength(1);
  });
});
