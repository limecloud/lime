import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import type { Message } from "../types";

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
    const selectedProvider =
      mockFindConfiguredProviderBySelection(providers, selection);
    const normalizedConfiguredType = (
      selectedProvider?.type || ""
    ).trim().toLowerCase();
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

describe("MessageList", () => {
  it("自动恢复任务中心时应展示恢复占位而不是空白引导", () => {
    const container = render([], { isRestoringSession: true });

    expect(
      container.querySelector('[data-testid="message-list-restoring-session"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("正在恢复任务中心...");
    expect(container.textContent).toContain(
      "正在同步最近一次任务会话，请稍候。",
    );
    expect(container.textContent).not.toContain("开始一段新的对话吧");
  });

  it("任务中心空列表时应展示回访型空态而不是普通新对话文案", () => {
    const container = render([], {
      emptyStateVariant: "task-center",
    });

    expect(
      container.querySelector('[data-testid="message-list-empty-task-center"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("创作");
    expect(container.textContent).toContain("任务中心");
    expect(container.textContent).toContain(
      "回到进行中的任务、最近结果和已经跑过的工作现场。",
    );
    expect(container.textContent).toContain(
      "还没有进行中的任务时，从新建任务开始也很自然；跑过的结果和做法后面都会继续留在这里。",
    );
    expect(container.textContent).toContain("左侧会继续显示继续中的任务");
    expect(container.textContent).toContain("最近结果会继续在这里回访");
    expect(container.textContent).toContain(
      "常用做法和恢复中的会话会自动回到这里",
    );
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

    expect(container.querySelector('[data-testid="agent-task-strip"]')).toBeNull();
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

  it("首个文本分片到来前，不应渲染空白 assistant 气泡，只保留运行态行", () => {
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
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-runtime-status-line"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("处理中");
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
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-runtime-status-line"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("处理中");
    expect(container.textContent).not.toContain("Built-in Tool");
  });

  it("assistant 占位消息只有启动态 runtimeStatus 时，也不应保留空白气泡", () => {
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
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-runtime-status-line"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("处理中");
    expect(container.textContent).not.toContain("正在启动处理流程");
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
          content: "{\"schemaVersion\":\"artifact_document.v1\"}",
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
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-runtime-status-line"]'),
    ).not.toBeNull();
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
            content: "{\"schemaVersion\":\"artifact_document.v1\"}",
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
    ).not.toBeNull();
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
