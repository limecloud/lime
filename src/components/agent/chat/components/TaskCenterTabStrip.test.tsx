import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TaskCenterTabStrip,
  type TaskCenterTabItem,
} from "./TaskCenterTabStrip";

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

function renderTabStrip(
  props?: Partial<React.ComponentProps<typeof TaskCenterTabStrip>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const items: TaskCenterTabItem[] = [
    {
      id: "topic-a",
      title: "任务 A",
      status: "running",
      updatedAt: new Date("2026-04-24T10:00:00.000Z"),
      isActive: true,
      hasUnread: true,
      isPinned: false,
    },
    {
      id: "topic-b",
      title: "任务 B",
      status: "done",
      updatedAt: new Date("2026-04-24T09:00:00.000Z"),
      isActive: false,
      hasUnread: false,
      isPinned: true,
    },
  ];

  const defaultProps: React.ComponentProps<typeof TaskCenterTabStrip> = {
    items,
    onSelectTask: vi.fn(),
    onCloseTask: vi.fn(),
    onCreateTask: vi.fn(),
  };

  act(() => {
    root.render(<TaskCenterTabStrip {...defaultProps} {...props} />);
  });

  mountedRoots.push({ root, container });
  return { container, props: { ...defaultProps, ...props } };
}

describe("TaskCenterTabStrip", () => {
  it("应渲染第二层会话 tabs 和加号入口", () => {
    const { container } = renderTabStrip();

    const strip = container.querySelector(
      '[data-testid="task-center-tab-strip"]',
    ) as HTMLElement | null;
    expect(strip).toBeTruthy();
    expect(strip?.className).toContain("z-10");
    expect(strip?.className).toContain("min-h-[42px]");
    expect(strip?.className).toContain(
      "bg-[color:var(--lime-chrome-tab-active-surface)]",
    );
    expect(
      strip?.style.getPropertyValue("--task-center-tab-strip-background"),
    ).toContain("--lime-chrome-stage-blend");
    expect(
      strip?.style.getPropertyValue("--task-center-tab-strip-seam"),
    ).toContain("--lime-chrome-stage-seam");
    expect(strip?.className).not.toContain("bg-[#fbfdfb]");
    expect(strip?.className).not.toContain("ml-[");
    expect(container.textContent).toContain("任务 A");
    expect(container.textContent).toContain("任务 B");
    expect(
      container.querySelector('[data-testid="task-center-tab-create-button"]'),
    ).toBeTruthy();

    const activeTab = container.querySelector(
      '[data-testid="task-center-tab-topic-a"]',
    ) as HTMLElement | null;
    expect(activeTab?.getAttribute("data-active")).toBe("true");
    expect(activeTab?.className).toContain(
      "bg-[color:var(--lime-chrome-tab-hover)]",
    );
    expect(activeTab?.className).toContain(
      "border-[color:var(--lime-chrome-divider)]",
    );
    expect(
      container.querySelector('[data-testid="task-center-tab-unread-topic-a"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="task-center-tab-close-topic-b"]')
        ?.className,
    ).toContain("group-hover:opacity-100");
  });

  it("点击标签应触发任务切换", () => {
    const onSelectTask = vi.fn();
    const { container } = renderTabStrip({ onSelectTask });

    act(() => {
      (
        container.querySelector(
          '[data-testid="task-center-tab-topic-b"] button[title]',
        ) as HTMLButtonElement | null
      )?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelectTask).toHaveBeenCalledWith("topic-b");
  });

  it("关闭标签时不应触发切换", () => {
    const onSelectTask = vi.fn();
    const onCloseTask = vi.fn();
    const { container } = renderTabStrip({ onSelectTask, onCloseTask });

    act(() => {
      (
        container.querySelector(
          '[data-testid="task-center-tab-close-topic-b"]',
        ) as HTMLButtonElement | null
      )?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCloseTask).toHaveBeenCalledWith("topic-b");
    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it("不可关闭标签不应渲染关闭按钮", () => {
    const { container } = renderTabStrip({
      items: [
        {
          id: "new-task-home",
          title: "新对话",
          status: "draft",
          updatedAt: new Date("2026-04-24T10:00:00.000Z"),
          isActive: true,
          hasUnread: false,
          isPinned: false,
          closable: false,
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="task-center-tab-new-task-home"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="task-center-tab-close-new-task-home"]',
      ),
    ).toBeNull();
  });

  it("点击加号应触发新建对话回调", () => {
    const onCreateTask = vi.fn();
    const { container } = renderTabStrip({ onCreateTask });

    act(() => {
      (
        container.querySelector(
          '[data-testid="task-center-tab-create-button"]',
        ) as HTMLButtonElement | null
      )?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCreateTask).toHaveBeenCalledTimes(1);
  });

  it("没有打开会话时也应保留第二层 tabs 壳和加号入口", () => {
    const { container } = renderTabStrip({ items: [] });

    const strip = container.querySelector(
      '[data-testid="task-center-tab-strip"]',
    ) as HTMLElement | null;
    const createButton = container.querySelector(
      '[data-testid="task-center-tab-create-button"]',
    ) as HTMLButtonElement | null;

    expect(strip).not.toBeNull();
    expect(createButton).not.toBeNull();
    expect(container.textContent).not.toContain("新对话");
  });

  it("应在右侧保留轻量工具按钮，并显示明确的工作台入口", () => {
    const onToggleHistory = vi.fn();
    const onToggleCanvas = vi.fn();
    const { container } = renderTabStrip({
      showHistoryToggle: true,
      onToggleHistory,
      showCanvasToggle: true,
      isCanvasOpen: true,
      onToggleCanvas,
    });

    act(() => {
      (
        container.querySelector(
          '[data-testid="task-center-tab-history"]',
        ) as HTMLButtonElement | null
      )?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      (
        container.querySelector(
          '[data-testid="task-center-tab-workbench"]',
        ) as HTMLButtonElement | null
      )?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToggleHistory).toHaveBeenCalledTimes(1);
    expect(onToggleCanvas).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("工作台");
    expect(
      container.querySelector('[data-testid="task-center-tab-toolbar"]'),
    ).toBeTruthy();
  });
});
