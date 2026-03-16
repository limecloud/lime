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
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
    lastPreview: "已记录 2 条消息，可继续补充或复盘。",
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
  function createBrowserPreflightMessage(
    phase: "launching" | "awaiting_user" | "failed",
    detail: string,
  ): Message {
    return {
      id: `msg-preflight-${phase}`,
      role: "assistant",
      content: "",
      timestamp: new Date("2026-03-15T09:45:00.001Z"),
      actionRequests: [
        {
          requestId: `browser-preflight-${phase}`,
          actionType: "ask_user",
          uiKind: "browser_preflight",
          browserRequirement: "required_with_user_step",
          browserPrepState: phase,
          prompt: "该任务需要真实浏览器执行，不能仅靠网页检索完成。",
          detail,
        },
      ],
    };
  }

  it("应显示新建任务入口和任务列表", () => {
    const container = renderSidebar();
    expect(container.textContent).toContain("新建任务");
    expect(container.textContent).toContain("任务一");
  });

  it("点击任务时应触发切换", () => {
    const onSwitchTopic = vi.fn();
    const container = renderSidebar({ onSwitchTopic });
    const taskItem = Array.from(
      container.querySelectorAll('[role="button"]'),
    ).find(
      (element) => element.textContent?.includes("任务一"),
    );
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

  it("浏览器未就绪时应显示可操作的失败前置态", () => {
    const now = new Date("2026-03-15T09:45:00.000Z");
    const topics: Topic[] = [
      {
        ...defaultTopics[0],
        status: "failed",
        lastPreview: "执行失败：browser_connect",
      },
    ];
    const currentMessages: Message[] = [
      {
        id: "msg-user",
        role: "user",
        content: "帮我把文章发布到微信公众号",
        timestamp: now,
      },
      {
        ...createBrowserPreflightMessage(
          "failed",
          "还没有建立可用的浏览器会话。请确认本机浏览器/CDP 可用后重试。",
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

    expect(container.textContent).toContain("浏览器未就绪");
    expect(container.textContent).toContain("浏览器会话");
    expect(container.textContent).not.toContain("执行失败");
  });

  it("等待用户在浏览器完成登录时应显示待继续", () => {
    const currentMessages: Message[] = [
      {
        id: "msg-user",
        role: "user",
        content: "帮我把文章发布到微信公众号",
        timestamp: new Date("2026-03-15T09:45:00.000Z"),
      },
      createBrowserPreflightMessage(
        "awaiting_user",
        "已为你打开浏览器。请先完成登录、扫码或验证码，然后继续当前任务。",
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

    expect(container.textContent).toContain("待继续");
    expect(container.textContent).toContain("完成登录");
  });

  it("浏览器启动中时应显示连接浏览器", () => {
    const currentMessages: Message[] = [
      {
        id: "msg-user",
        role: "user",
        content: "帮我把文章发布到微信公众号",
        timestamp: new Date("2026-03-15T09:45:00.000Z"),
      },
      createBrowserPreflightMessage(
        "launching",
        "正在尝试建立浏览器会话，请稍候...",
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

    expect(container.textContent).toContain("连接浏览器");
    expect(container.textContent).toContain("正在建立浏览器会话");
  });

  it("浏览器介入任务应单独归入待继续分组", () => {
    const topics: Topic[] = [
      {
        ...defaultTopics[0],
        status: "waiting",
        statusReason: "browser_awaiting_user",
        lastPreview: "请先在浏览器完成登录后继续。",
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

    expect(container.textContent).toContain("待继续1");
    expect(container.textContent).toContain("待处理1");
    expect(container.textContent).toContain("任务一");
    expect(container.textContent).toContain("任务二");
  });

  it("当前待继续任务应在顶部提供打开浏览器入口", () => {
    const onResumeTask = vi.fn();
    const currentMessages: Message[] = [
      {
        id: "msg-user",
        role: "user",
        content: "帮我把文章发布到微信公众号",
        timestamp: new Date("2026-03-15T09:45:00.000Z"),
      },
      createBrowserPreflightMessage(
        "awaiting_user",
        "已为你打开浏览器。请先完成登录、扫码或验证码，然后继续当前任务。",
      ),
    ];
    const container = renderSidebar({
      onResumeTask,
      topics: [
        {
          ...defaultTopics[0],
          status: "waiting",
          statusReason: "browser_awaiting_user",
          lastPreview: "请先在浏览器完成登录后继续。",
        },
      ],
      currentTopicId: "topic-1",
      currentMessages,
    });

    expect(container.textContent).toContain("当前任务待继续");
    expect(container.textContent).toContain("打开浏览器");

    const openBrowserButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("打开浏览器"),
    );
    expect(openBrowserButton).toBeTruthy();

    act(() => {
      openBrowserButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onResumeTask).toHaveBeenCalledWith(
      "topic-1",
      "browser_awaiting_user",
    );
  });

  it("非当前待继续任务应提供进入任务动作", () => {
    const onResumeTask = vi.fn();
    const container = renderSidebar({
      onResumeTask,
      topics: [
        {
          ...defaultTopics[0],
          status: "waiting",
          statusReason: "browser_awaiting_user",
          lastPreview: "请先在浏览器完成登录后继续。",
        },
      ],
      currentTopicId: null,
    });

    expect(container.textContent).toContain("有 1 个任务待继续");
    expect(container.textContent).toContain("进入任务");

    const enterTaskButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("进入任务"),
    );
    expect(enterTaskButton).toBeTruthy();

    act(() => {
      enterTaskButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onResumeTask).toHaveBeenCalledWith(
      "topic-1",
      "browser_awaiting_user",
    );
  });

  it("可按待继续筛选任务", () => {
    const container = renderSidebar({
      topics: [
        {
          ...defaultTopics[0],
          status: "waiting",
          statusReason: "browser_awaiting_user",
          lastPreview: "请先在浏览器完成登录后继续。",
        },
        {
          ...defaultTopics[0],
          id: "topic-2",
          title: "任务二",
          sourceSessionId: "topic-2",
          status: "done",
          lastPreview: "已完成。",
        },
      ],
      currentTopicId: null,
    });

    const resumableFilterButton = Array.from(
      container.querySelectorAll("button"),
    ).find((element) => element.textContent?.includes("待继续 1"));
    expect(resumableFilterButton).toBeTruthy();

    act(() => {
      resumableFilterButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("任务一");
    expect(container.textContent).not.toContain("任务二");
  });
});
