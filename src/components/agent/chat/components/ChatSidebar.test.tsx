import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSidebar } from "./ChatSidebar";
import type { Topic } from "../hooks/agentChatShared";
import type { Message } from "../types";

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <span className={className}>{children}</span>,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <div />,
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

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

const defaultTopics: Topic[] = [
  {
    id: "topic-1",
    title: "任务一",
    createdAt: new Date(),
    updatedAt: new Date(),
    messagesCount: 2,
    executionStrategy: "auto",
    status: "done",
    lastPreview: "已记录 2 条消息，可继续补充或接着推进。",
    isPinned: false,
    hasUnread: false,
    tag: null,
    sourceSessionId: "topic-1",
  },
];

function renderSidebar(
  props?: Partial<React.ComponentProps<typeof ChatSidebar>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof ChatSidebar> = {
    onNewChat: vi.fn(),
    topics: defaultTopics,
    currentTopicId: "topic-1",
    onSwitchTopic: vi.fn(),
    onDeleteTopic: vi.fn(),
  };

  act(() => {
    root.render(<ChatSidebar {...defaultProps} {...props} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

describe("ChatSidebar", () => {
  function createPendingActionMessage(
    prompt: string,
    question = "请补充需要继续执行的信息。",
  ): Message {
    return {
      id: "msg-pending-action",
      role: "assistant",
      content: "",
      timestamp: new Date("2026-03-15T09:45:00.001Z"),
      actionRequests: [
        {
          requestId: "req-user-action",
          actionType: "ask_user",
          prompt,
          questions: [{ question }],
        },
      ],
    };
  }

  it("应显示新建任务入口和任务列表", () => {
    const container = renderSidebar();
    expect(container.textContent).toContain("新建任务");
    expect(container.textContent).toContain("任务一");
  });

  it("任务中心侧栏空态应展示最近对话文案和新建入口", () => {
    const container = renderSidebar({
      contextVariant: "task-center",
      topics: [],
      currentTopicId: null,
    });
    const searchInput = container.querySelector(
      'input[placeholder="搜索对话标题或摘要"]',
    ) as HTMLInputElement | null;

    expect(container.textContent).toContain("最近对话");
    expect(container.textContent).toContain(
      "继续最近对话，待处理会话会优先显示在前面。",
    );
    expect(container.textContent).toContain("任务");
    expect(container.textContent).toContain("新建任务");
    expect(container.textContent).toContain("能力");
    expect(container.textContent).toContain("我的方法");
    expect(container.textContent).toContain("资料");
    expect(container.textContent).toContain("灵感库");
    expect(searchInput).toBeTruthy();
    expect(
      container.querySelector('button[aria-label="新建对话"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("全部对话");
    expect(container.textContent).toContain("待继续");
    expect(container.textContent).toContain("还没有最近对话");
    expect(container.textContent).toContain(
      "从“新建对话”开始后，最近对话会自动出现在这里。",
    );
  });

  it("任务中心导航块应支持入口跳转", () => {
    const onOpenTaskCenterHome = vi.fn();
    const onOpenSkillsPage = vi.fn();
    const onOpenMemoryPage = vi.fn();
    const container = renderSidebar({
      contextVariant: "task-center",
      onOpenTaskCenterHome,
      onOpenSkillsPage,
      onOpenMemoryPage,
    });

    act(() => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("新建任务"),
        ) as HTMLButtonElement | undefined
      )?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("我的方法"),
        ) as HTMLButtonElement | undefined
      )?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      (
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("灵感库"),
        ) as HTMLButtonElement | undefined
      )?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenTaskCenterHome).toHaveBeenCalledTimes(1);
    expect(onOpenSkillsPage).toHaveBeenCalledTimes(1);
    expect(onOpenMemoryPage).toHaveBeenCalledTimes(1);
  });

  it("任务中心侧栏不应再在顶部重复展示继续最近会话卡", () => {
    const now = Date.now();
    const container = renderSidebar({
      contextVariant: "task-center",
      currentTopicId: null,
      topics: [
        {
          ...defaultTopics[0],
          id: "topic-waiting",
          title: "待继续任务",
          updatedAt: new Date(now),
          status: "waiting",
          statusReason: "user_action",
          lastPreview: "请先确认发布标题后继续。",
          workspaceId: "project-waiting",
          sourceSessionId: "topic-waiting",
        },
        {
          ...defaultTopics[0],
          id: "topic-recent",
          title: "最近对话任务",
          updatedAt: new Date(now - 2_000),
          status: "done",
          lastPreview: "首版结果已经产出，可继续补充和复盘。",
          sourceSessionId: "topic-recent",
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="task-center-continuation-panel"]'),
    ).toBeNull();
    expect(container.textContent).toContain("待继续任务");
    expect(container.textContent).toContain("最近对话任务");
  });

  it("任务中心侧栏应使用对话与归档分组标题", () => {
    const now = Date.now();
    const container = renderSidebar({
      contextVariant: "task-center",
      currentTopicId: null,
      topics: [
        {
          ...defaultTopics[0],
          id: "topic-running",
          title: "进行中任务",
          updatedAt: new Date(now),
          status: "running",
          sourceSessionId: "topic-running",
        },
        {
          ...defaultTopics[0],
          id: "topic-waiting",
          title: "待继续任务",
          updatedAt: new Date(now - 1_000),
          status: "waiting",
          statusReason: "user_action",
          sourceSessionId: "topic-waiting",
        },
        {
          ...defaultTopics[0],
          id: "topic-recent",
          title: "最近对话任务",
          updatedAt: new Date(now - 2_000),
          status: "done",
          sourceSessionId: "topic-recent",
        },
        {
          ...defaultTopics[0],
          id: "topic-older",
          title: "更早任务",
          updatedAt: new Date(now - 1000 * 60 * 60 * 24 * 5),
          status: "done",
          sourceSessionId: "topic-older",
        },
      ],
    });

    expect(container.textContent).toContain("进行中");
    expect(container.textContent).toContain("待继续");
    expect(container.textContent).toContain("最近对话");
    expect(container.textContent).toContain("归档");
  });

  it("任务中心侧栏不应再显示 continuation fallback 文案", async () => {
    const container = renderSidebar({
      contextVariant: "task-center",
      currentTopicId: null,
      topics: [
        {
          ...defaultTopics[0],
          id: "topic-draft",
          title: "待整理现场",
          updatedAt: new Date(),
          status: "draft",
          lastPreview: "先补齐创作需求，再继续生成。",
          sourceSessionId: "topic-draft",
        },
      ],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("打开最近会话");
  });

  it("子任务和任务列表应处于同一滚动区域", () => {
    const container = renderSidebar({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "代码审查代理",
          created_at: 1_742_288_400,
          updated_at: 1_742_288_520,
          session_type: "sub_agent",
          task_summary: "检查 team runtime 侧栏遗漏的交互入口。",
          role_hint: "reviewer",
          runtime_status: "running",
        },
      ],
    });

    const scrollArea = container.querySelector(
      '[data-testid="chat-sidebar-scroll-area"]',
    ) as HTMLDivElement | null;
    const teamSection = container.querySelector(
      '[data-testid="team-runtime-section"]',
    ) as HTMLElement | null;

    expect(scrollArea).toBeTruthy();
    expect(teamSection).toBeTruthy();
    expect(scrollArea?.contains(teamSection)).toBe(true);
    expect(scrollArea?.textContent).toContain("子任务");
    expect(scrollArea?.textContent).toContain(
      "这里优先展示正在处理的子任务，再回到当前任务和后续节点。",
    );
    expect(scrollArea?.textContent).toContain("任务一");
  });

  it("父线程子任务应按状态优先级排序并前置当前焦点", () => {
    const container = renderSidebar({
      childSubagentSessions: [
        {
          id: "child-completed",
          name: "已完成代理",
          created_at: 1_742_288_400,
          updated_at: 1_742_288_560,
          session_type: "sub_agent",
          task_summary: "已经输出收尾结果。",
          role_hint: "writer",
          runtime_status: "completed",
        },
        {
          id: "child-running",
          name: "处理中代理",
          created_at: 1_742_288_390,
          updated_at: 1_742_288_500,
          session_type: "sub_agent",
          task_summary: "正在处理主线回归。",
          role_hint: "executor",
          runtime_status: "running",
        },
        {
          id: "child-queued",
          name: "待开始代理",
          created_at: 1_742_288_395,
          updated_at: 1_742_288_540,
          session_type: "sub_agent",
          task_summary: "等待前序任务完成后接手。",
          role_hint: "reviewer",
          runtime_status: "queued",
        },
      ],
    });

    const cards = Array.from(
      container.querySelectorAll('[data-testid^="sidebar-subagent-session-"]'),
    );

    expect(cards.map((card) => card.getAttribute("data-testid"))).toEqual([
      "sidebar-subagent-session-child-running",
      "sidebar-subagent-session-child-queued",
      "sidebar-subagent-session-child-completed",
    ]);
    expect(cards[0]?.textContent).toContain("当前焦点");
    expect(cards[0]?.textContent).toContain("处理中代理");
    expect(cards[2]?.textContent).not.toContain("当前焦点");
  });

  it("子线程并行子任务应按状态优先级排序并前置当前焦点", () => {
    const container = renderSidebar({
      topics: [
        {
          ...defaultTopics[0],
          id: "child-1",
          title: "当前子任务",
          sourceSessionId: "child-1",
        },
      ],
      currentTopicId: "child-1",
      subagentParentContext: {
        parent_session_id: "parent-1",
        parent_session_name: "主线程",
        role_hint: "implementer",
        task_summary: "对齐任务列表排序。",
        created_from_turn_id: "turn-42",
        sibling_subagent_sessions: [
          {
            id: "child-completed",
            name: "已完成代理",
            created_at: 1_742_288_400,
            updated_at: 1_742_288_560,
            session_type: "sub_agent",
            task_summary: "已经输出收尾结果。",
            role_hint: "writer",
            runtime_status: "completed",
          },
          {
            id: "child-running",
            name: "处理中代理",
            created_at: 1_742_288_390,
            updated_at: 1_742_288_500,
            session_type: "sub_agent",
            task_summary: "正在处理主线回归。",
            role_hint: "executor",
            runtime_status: "running",
          },
        ],
      },
    });

    const cards = Array.from(
      container.querySelectorAll('[data-testid^="sidebar-subagent-session-"]'),
    );

    expect(cards.map((card) => card.getAttribute("data-testid"))).toEqual([
      "sidebar-subagent-session-child-running",
      "sidebar-subagent-session-child-completed",
    ]);
    expect(cards[0]?.textContent).toContain("当前焦点");
    expect(container.textContent).toContain(
      "当前线程来自主助手，可直接返回主助手并切换其他子任务；正在处理的任务会排在前面。",
    );
  });

  it("点击子任务入口应收起顶部区块并滚动到任务列表", () => {
    const container = renderSidebar({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "代码审查代理",
          created_at: 1_742_288_400,
          updated_at: 1_742_288_520,
          session_type: "sub_agent",
          task_summary: "检查 team runtime 侧栏遗漏的交互入口。",
          role_hint: "reviewer",
          runtime_status: "running",
        },
      ],
    });

    const taskHeading = container.querySelector(
      '[data-testid="task-section-heading"]',
    ) as
      | (HTMLDivElement & { scrollIntoView?: ReturnType<typeof vi.fn> })
      | null;
    expect(taskHeading).toBeTruthy();

    const scrollIntoView = vi.fn();
    if (taskHeading) {
      taskHeading.scrollIntoView = scrollIntoView;
    }

    const jumpButton = container.querySelector(
      'button[aria-label="跳转到任务列表"]',
    ) as HTMLButtonElement | null;
    expect(jumpButton).toBeTruthy();

    act(() => {
      jumpButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "start",
      behavior: "smooth",
    });
    expect(container.textContent).toContain("已收起 · 1 个子任务 · 1 个处理中");
    expect(container.textContent).not.toContain("代码审查代理");
  });

  it("点击任务时应触发切换", () => {
    const onSwitchTopic = vi.fn();
    const container = renderSidebar({ onSwitchTopic });
    const taskItem = Array.from(
      container.querySelectorAll('[role="button"]'),
    ).find((element) => element.textContent?.includes("任务一"));
    expect(taskItem).toBeTruthy();
    if (taskItem) {
      act(() => {
        taskItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    expect(onSwitchTopic).toHaveBeenCalledWith("topic-1");
  });

  it("点击菜单删除任务时应触发删除", () => {
    const onDeleteTopic = vi.fn();
    const container = renderSidebar({ onDeleteTopic });
    const actionButton = container.querySelector(
      'button[aria-label="任务操作"]',
    ) as HTMLButtonElement | null;
    expect(actionButton).toBeTruthy();
    if (actionButton) {
      act(() => {
        actionButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    const deleteButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("删除任务"),
    );
    expect(deleteButton).toBeTruthy();
    if (deleteButton) {
      act(() => {
        deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    expect(onDeleteTopic).toHaveBeenCalledWith("topic-1");
  });

  it("当前任务应显示直接删除按钮并支持点击删除", () => {
    const onDeleteTopic = vi.fn();
    const container = renderSidebar({ onDeleteTopic });
    const deleteButton = container.querySelector(
      'button[aria-label="删除任务"]',
    ) as HTMLButtonElement | null;

    expect(deleteButton).toBeTruthy();

    act(() => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onDeleteTopic).toHaveBeenCalledWith("topic-1");
  });

  it("切换为仅看进行中时应过滤已完成任务", () => {
    const container = renderSidebar({
      isSending: true,
      currentTopicId: "topic-1",
    });

    const filterButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("仅看进行中"),
    );
    expect(filterButton).toBeTruthy();

    act(() => {
      filterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("任务一");
    expect(container.textContent).toContain("进行中");
  });

  it("当前任务存在待处理请求时应覆盖失败态并显示待处理摘要", () => {
    const now = new Date("2026-03-15T09:45:00.000Z");
    const topics: Topic[] = [
      {
        ...defaultTopics[0],
        status: "failed",
        lastPreview: "执行失败：write_file",
      },
    ];
    const currentMessages: Message[] = [
      {
        id: "msg-user",
        role: "user",
        content: "帮我整理一篇公众号发布文案",
        timestamp: now,
      },
      {
        ...createPendingActionMessage(
          "请先确认发布标题后继续执行。",
          "这篇文章的最终标题是什么？",
        ),
        timestamp: new Date(now.getTime() + 1),
      },
    ];

    const container = renderSidebar({
      topics,
      currentMessages,
      currentTopicId: "topic-1",
      isSending: false,
      pendingActionCount: 0,
    });

    expect(container.textContent).toContain("待处理");
    expect(container.textContent).toContain("确认发布标题");
    expect(container.textContent).not.toContain("执行失败");
  });

  it("等待用户补充信息时应显示待处理提示", () => {
    const currentMessages: Message[] = [
      {
        id: "msg-user",
        role: "user",
        content: "帮我写一篇活动预热文案",
        timestamp: new Date("2026-03-15T09:45:00.000Z"),
      },
      createPendingActionMessage(
        "请先补充活动标题后继续。",
        "这次活动的正式标题是什么？",
      ),
    ];

    const container = renderSidebar({
      topics: [
        {
          ...defaultTopics[0],
          status: "waiting",
        },
      ],
      currentMessages,
      currentTopicId: "topic-1",
      isSending: false,
      pendingActionCount: 0,
    });

    expect(container.textContent).toContain("待处理");
    expect(container.textContent).toContain("补充活动标题");
  });

  it("待处理任务应统一归入待处理分组", () => {
    const topics: Topic[] = [
      {
        ...defaultTopics[0],
        status: "waiting",
        statusReason: "user_action",
        lastPreview: "请先补充文章标题。",
      },
      {
        ...defaultTopics[0],
        id: "topic-2",
        title: "任务二",
        sourceSessionId: "topic-2",
        status: "waiting",
        statusReason: "user_action",
        lastPreview: "等待你补充发布标题。",
      },
    ];

    const container = renderSidebar({
      topics,
      currentTopicId: null,
      currentMessages: [],
    });

    expect(container.textContent).toContain("待处理2");
    expect(container.textContent).toContain("任务一");
    expect(container.textContent).toContain("任务二");
  });

  it("当前待处理任务应提供继续任务入口", () => {
    const onResumeTask = vi.fn();
    const currentMessages: Message[] = [
      {
        id: "msg-user",
        role: "user",
        content: "帮我把文章整理成周报",
        timestamp: new Date("2026-03-15T09:45:00.000Z"),
      },
      createPendingActionMessage(
        "请先补充周报标题后继续。",
        "本周周报的标题是什么？",
      ),
    ];
    const container = renderSidebar({
      onResumeTask,
      topics: [
        {
          ...defaultTopics[0],
          status: "waiting",
          statusReason: "user_action",
          lastPreview: "请先补充周报标题后继续。",
        },
      ],
      currentTopicId: "topic-1",
      currentMessages,
    });

    expect(container.textContent).toContain("继续任务");

    const resumeButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("继续任务"),
    );
    expect(resumeButton).toBeTruthy();

    act(() => {
      resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onResumeTask).toHaveBeenCalledWith("topic-1", "user_action");
  });

  it("非当前待处理任务也应提供继续任务动作", () => {
    const onResumeTask = vi.fn();
    const container = renderSidebar({
      onResumeTask,
      topics: [
        {
          ...defaultTopics[0],
          status: "waiting",
          statusReason: "user_action",
          lastPreview: "请先补充周报标题后继续。",
        },
      ],
      currentTopicId: null,
    });

    expect(container.textContent).toContain("继续任务");

    const resumeButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("继续任务"),
    );
    expect(resumeButton).toBeTruthy();

    act(() => {
      resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onResumeTask).toHaveBeenCalledWith("topic-1", "user_action");
  });

  it("父线程应在侧栏展示真实子任务并支持打开", () => {
    const onOpenSubagentSession = vi.fn();
    const container = renderSidebar({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "代码审查代理",
          created_at: 1_742_288_400,
          updated_at: 1_742_288_520,
          session_type: "sub_agent",
          task_summary: "检查 team runtime 侧栏遗漏的交互入口。",
          role_hint: "reviewer",
          runtime_status: "running",
        },
        {
          id: "child-2",
          name: "文档校对代理",
          created_at: 1_742_288_410,
          updated_at: 1_742_288_480,
          session_type: "sub_agent",
          task_summary: "核对 roadmap 的阶段完成度。",
          role_hint: "writer",
          runtime_status: "completed",
        },
      ],
      onOpenSubagentSession,
    });

    expect(container.textContent).toContain("子任务");
    expect(container.textContent).toContain("代码审查代理");
    expect(container.textContent).toContain("文档校对代理");
    expect(container.textContent).toContain("子任务");
    expect(container.textContent).toContain("处理中");
    expect(container.textContent).toContain("已完成");

    const sessionButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("代码审查代理"),
    );
    expect(sessionButton).toBeTruthy();

    act(() => {
      sessionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenSubagentSession).toHaveBeenCalledWith("child-1");
  });

  it("父线程子任务区域应支持折叠和展开", () => {
    const container = renderSidebar({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "代码审查代理",
          created_at: 1_742_288_400,
          updated_at: 1_742_288_520,
          session_type: "sub_agent",
          task_summary: "检查 team runtime 侧栏遗漏的交互入口。",
          role_hint: "reviewer",
          runtime_status: "running",
        },
        {
          id: "child-2",
          name: "文档校对代理",
          created_at: 1_742_288_410,
          updated_at: 1_742_288_480,
          session_type: "sub_agent",
          task_summary: "核对 roadmap 的阶段完成度。",
          role_hint: "writer",
          runtime_status: "completed",
        },
      ],
    });

    expect(container.textContent).toContain("代码审查代理");
    expect(container.textContent).toContain("文档校对代理");

    const collapseButton = container.querySelector(
      'button[aria-label="收起子任务"]',
    ) as HTMLButtonElement | null;
    expect(collapseButton).toBeTruthy();

    act(() => {
      collapseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain(
      "已收起 · 2 个子任务 · 1 个处理中 · 1 个已完成",
    );
    expect(container.textContent).not.toContain("代码审查代理");
    expect(container.textContent).not.toContain("文档校对代理");

    const expandButton = container.querySelector(
      'button[aria-label="展开子任务"]',
    ) as HTMLButtonElement | null;
    expect(expandButton).toBeTruthy();

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("代码审查代理");
    expect(container.textContent).toContain("文档校对代理");
  });

  it("父线程子任务较多时应默认收起，并支持展开更多子任务", () => {
    const container = renderSidebar({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "代码审查代理",
          created_at: 1_742_288_400,
          updated_at: 1_742_288_560,
          session_type: "sub_agent",
          task_summary: "检查 team runtime 侧栏遗漏的交互入口。",
          role_hint: "reviewer",
          runtime_status: "running",
        },
        {
          id: "child-2",
          name: "文档校对代理",
          created_at: 1_742_288_410,
          updated_at: 1_742_288_550,
          session_type: "sub_agent",
          task_summary: "核对 roadmap 的阶段完成度。",
          role_hint: "writer",
          runtime_status: "completed",
        },
        {
          id: "child-3",
          name: "数据整理代理",
          created_at: 1_742_288_420,
          updated_at: 1_742_288_540,
          session_type: "sub_agent",
          task_summary: "汇总运行日志中的关键告警。",
          role_hint: "analyst",
          runtime_status: "queued",
        },
        {
          id: "child-4",
          name: "回归验证代理",
          created_at: 1_742_288_430,
          updated_at: 1_742_288_530,
          session_type: "sub_agent",
          task_summary: "确认恢复链路和 UI 状态推进。",
          role_hint: "qa",
          runtime_status: "running",
        },
      ],
    });

    expect(container.textContent).toContain(
      "已收起 · 4 个子任务 · 2 个处理中 · 1 个稍后开始 · 1 个已完成",
    );
    expect(container.textContent).not.toContain("代码审查代理");
    expect(container.textContent).not.toContain("文档校对代理");
    expect(container.textContent).not.toContain("数据整理代理");
    expect(container.textContent).not.toContain("回归验证代理");

    const expandTeamButton = container.querySelector(
      'button[aria-label="展开子任务"]',
    ) as HTMLButtonElement | null;
    expect(expandTeamButton).toBeTruthy();

    act(() => {
      expandTeamButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("代码审查代理");
    expect(container.textContent).toContain("回归验证代理");
    expect(container.textContent).toContain("数据整理代理");
    expect(container.textContent).not.toContain("文档校对代理");
    expect(container.textContent).toContain("展开剩余 1 个子任务");

    const expandMoreButton = Array.from(
      container.querySelectorAll("button"),
    ).find((element) => element.textContent?.includes("展开剩余 1 个子任务"));
    expect(expandMoreButton).toBeTruthy();

    act(() => {
      expandMoreButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("回归验证代理");
    expect(container.textContent).toContain("文档校对代理");
    expect(container.textContent).toContain("收起子任务列表");

    const collapseListButton = Array.from(
      container.querySelectorAll("button"),
    ).find((element) => element.textContent?.includes("收起子任务列表"));
    expect(collapseListButton).toBeTruthy();

    act(() => {
      collapseListButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("回归验证代理");
    expect(container.textContent).not.toContain("文档校对代理");
  });

  it("子线程并行子任务较多时应默认收起子任务", () => {
    const container = renderSidebar({
      topics: [
        {
          ...defaultTopics[0],
          id: "child-1",
          title: "实现 team sidebar",
          sourceSessionId: "child-1",
        },
      ],
      currentTopicId: "child-1",
      subagentParentContext: {
        parent_session_id: "parent-1",
        parent_session_name: "主线程",
        role_hint: "implementer",
        task_summary: "把真实 child session 投影到常驻侧栏。",
        created_from_turn_id: "turn-42",
        sibling_subagent_sessions: [
          {
            id: "child-2",
            name: "研究代理",
            created_at: 1_742_288_430,
            updated_at: 1_742_288_530,
            session_type: "sub_agent",
            task_summary: "比对 roadmap 与当前实现差异。",
            role_hint: "researcher",
            runtime_status: "queued",
          },
          {
            id: "child-3",
            name: "验证代理",
            created_at: 1_742_288_431,
            updated_at: 1_742_288_531,
            session_type: "sub_agent",
            task_summary: "验证 team runtime 行为。",
            role_hint: "qa",
            runtime_status: "running",
          },
          {
            id: "child-4",
            name: "文档代理",
            created_at: 1_742_288_432,
            updated_at: 1_742_288_532,
            session_type: "sub_agent",
            task_summary: "补齐回归说明。",
            role_hint: "writer",
            runtime_status: "completed",
          },
        ],
      },
    });

    expect(container.textContent).toContain(
      "已收起 · 3 个并行子任务 · 1 个处理中 · 1 个稍后开始 · 1 个已完成",
    );
    expect(container.textContent).not.toContain("研究代理");
    expect(container.textContent).not.toContain("验证代理");
    expect(container.textContent).not.toContain("文档代理");

    const expandButton = container.querySelector(
      'button[aria-label="展开子任务"]',
    ) as HTMLButtonElement | null;
    expect(expandButton).toBeTruthy();

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("验证代理");
    expect(container.textContent).toContain("研究代理");
    expect(container.textContent).not.toContain("文档代理");
    expect(container.textContent).toContain("展开剩余 1 个并行子任务");
  });

  it("子线程应展示父会话和并行子任务入口", () => {
    const onOpenSubagentSession = vi.fn();
    const onReturnToParentSession = vi.fn();
    const container = renderSidebar({
      topics: [
        {
          ...defaultTopics[0],
          id: "child-1",
          title: "实现 team sidebar",
          sourceSessionId: "child-1",
        },
      ],
      currentTopicId: "child-1",
      subagentParentContext: {
        parent_session_id: "parent-1",
        parent_session_name: "主线程",
        role_hint: "implementer",
        task_summary: "把真实 child session 投影到常驻侧栏。",
        created_from_turn_id: "turn-42",
        sibling_subagent_sessions: [
          {
            id: "child-2",
            name: "研究代理",
            created_at: 1_742_288_430,
            updated_at: 1_742_288_530,
            session_type: "sub_agent",
            task_summary: "比对 roadmap 与当前实现差异。",
            role_hint: "researcher",
            runtime_status: "queued",
          },
        ],
      },
      onOpenSubagentSession,
      onReturnToParentSession,
    });

    expect(container.textContent).toContain("子任务");
    expect(container.textContent).toContain("主线程");
    expect(container.textContent).toContain("当前子任务");
    expect(container.textContent).toContain("实现 team sidebar");
    expect(container.textContent).toContain("研究代理");
    expect(container.textContent).toContain("稍后开始");

    const returnButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("主线程"),
    );
    expect(returnButton).toBeTruthy();

    act(() => {
      returnButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onReturnToParentSession).toHaveBeenCalledTimes(1);

    const siblingButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("研究代理"),
    );
    expect(siblingButton).toBeTruthy();

    act(() => {
      siblingButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenSubagentSession).toHaveBeenCalledWith("child-2");
  });

  it("内部图片子任务标题应显示为用户文案", () => {
    const container = renderSidebar({
      topics: [
        {
          ...defaultTopics[0],
          id: "child-image",
          title: "Image #1",
          sourceSessionId: "child-image",
        },
      ],
      currentTopicId: "child-image",
      subagentParentContext: {
        parent_session_id: "parent-1",
        parent_session_name: "主线程",
        role_hint: "image_editor",
        task_summary: "处理图片细节。",
        created_from_turn_id: "turn-42",
        sibling_subagent_sessions: [
          {
            id: "child-2",
            name: "Image #2",
            created_at: 1_742_288_430,
            updated_at: 1_742_288_530,
            session_type: "sub_agent",
            task_summary: "检查图片导出尺寸。",
            role_hint: "image_reviewer",
            runtime_status: "queued",
          },
        ],
      },
    });

    expect(container.textContent).toContain("图片任务 1");
    expect(container.textContent).toContain("图片任务 2");
    expect(container.textContent).not.toContain("Image #1");
    expect(container.textContent).not.toContain("Image #2");
  });
});
