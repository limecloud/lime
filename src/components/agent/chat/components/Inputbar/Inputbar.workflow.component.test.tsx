import { renderInputbar } from "./Inputbar.testFixtures";

import { act } from "react";

import { describe, expect, it, vi } from "vitest";

import { changeLimeLocale } from "@/i18n/createI18n";

describe("Inputbar workflow current integration", () => {
  it("工作区工作流在待启动状态下不应显示闸门条", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      workflowGate: {
        key: "draft_start",
        title: "编排待启动",
        status: "idle",
        description: "输入目标后将自动进入编排执行。",
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("编排待启动");
    expect(container.textContent).not.toContain("待启动");
  });

  it("工作区工作流闸门快捷操作应能快速填充输入", async () => {
    const setInput = vi.fn();
    const { container } = renderInputbar({
      variant: "workspace",
      setInput,
      workflowGate: {
        key: "topic_select",
        title: "选题闸门",
        status: "waiting",
        description: "请选择优先推进的选题方向。",
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("选题闸门");
    expect(container.textContent).not.toContain("当前闸门");
    expect(container.textContent).not.toContain("请选择优先推进的选题方向。");

    const quickActionButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("生成 3 个选题"));
    expect(quickActionButton).toBeTruthy();

    act(() => {
      quickActionButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(setInput).toHaveBeenCalledWith(
      "请给我 3 个可执行选题方向，并说明目标读者与传播价值。",
    );
  });

  it("工作区工作流生成中应展示任务面板并支持停止", async () => {
    const onStop = vi.fn();
    const { container } = renderInputbar({
      variant: "workspace",
      isLoading: true,
      onStop,
      workflowSteps: [
        { id: "research", title: "检索项目资料", status: "active" },
        { id: "write", title: "编写正文草稿", status: "pending" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("当前进展");
    expect(container.textContent).toContain("检索项目资料");
    expect(container.textContent).toContain("任务队列");
    expect(
      container.querySelector('[data-testid="inputbar-core-container"]'),
    ).toBeNull();

    const stopButton = container.querySelector(
      '[data-testid="workflow-stop"]',
    ) as HTMLButtonElement | null;
    expect(stopButton).toBeTruthy();
    act(() => {
      stopButton?.click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("工作区工作流面板 chrome 文案应跟随 en-US 资源", async () => {
    await changeLimeLocale("en-US");
    const onStop = vi.fn();
    const { container } = renderInputbar({
      variant: "workspace",
      isLoading: true,
      onStop,
      workflowSteps: [
        { id: "research", title: "Review project material", status: "active" },
        { id: "write", title: "Write body draft", status: "pending" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Current progress");
    expect(container.textContent).toContain("Task queue");
    expect(container.textContent).toContain("In progress 0/2");
    expect(container.textContent).toContain("Moving forward; 1 item(s) remain");
    expect(container.textContent).not.toContain("当前进展");
    expect(container.textContent).not.toContain("任务队列");

    const stopButton = container.querySelector(
      '[data-testid="workflow-stop"]',
    ) as HTMLButtonElement | null;
    expect(stopButton?.getAttribute("aria-label")).toBe("Stop generation");

    const collapseButton = Array.from(
      container.querySelectorAll("button"),
    ).find(
      (button) => button.getAttribute("aria-label") === "Collapse task queue",
    );
    expect(collapseButton).toBeTruthy();
  });

  it("工作区工作流生成中应支持折叠与展开待办列表", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      isLoading: true,
      workflowSteps: [
        { id: "research", title: "检索项目资料", status: "active" },
        { id: "write", title: "编写正文草稿", status: "pending" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("检索项目资料");

    const collapseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.getAttribute("aria-label") === "折叠任务队列");
    expect(collapseButton).toBeTruthy();

    act(() => {
      collapseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelectorAll('[data-testid="workflow-queue-item"]'),
    ).toHaveLength(0);

    const expandButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "展开任务队列",
    );
    expect(expandButton).toBeTruthy();

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelectorAll('[data-testid="workflow-queue-item"]'),
    ).toHaveLength(2);
  });

  it("工作区任务队列应展示统一进度计数并按优先级排序", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      isLoading: true,
      workflowSteps: [
        { id: "done", title: "完成选题", status: "completed" },
        { id: "pending", title: "等待补充案例", status: "pending" },
        { id: "active", title: "撰写主稿", status: "active" },
        { id: "error", title: "封面生成失败", status: "error" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("已完成 1/4");

    const queueItems = Array.from(
      container.querySelectorAll('[data-testid="workflow-queue-item"]'),
    );
    expect(queueItems.map((item) => item.getAttribute("data-status"))).toEqual([
      "active",
      "error",
      "pending",
    ]);
  });

  it("工作区工作流在 auto_running 状态下应展示生成面板（不依赖 isLoading）", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      isLoading: false,
      workflowRunState: "auto_running",
      workflowSteps: [
        { id: "research", title: "检索项目资料", status: "active" },
        { id: "write", title: "编写正文草稿", status: "pending" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("当前进展");
    expect(container.textContent).toContain("检索项目资料");
    expect(
      container.querySelector('[data-testid="inputbar-core-container"]'),
    ).toBeNull();
  });

  it("工作区工作流在 await_user_decision 状态下应显示输入框", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      isLoading: true,
      workflowRunState: "await_user_decision",
      workflowGate: {
        key: "topic_select",
        title: "等待用户确认选题",
        status: "waiting",
        description: "等待你确认后继续推进下一步。",
      },
      workflowSteps: [
        { id: "topic", title: "等待用户确认选题", status: "pending" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="inputbar-core-container"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("当前进展");
    expect(container.textContent).toContain("等待用户确认选题");
    expect(container.textContent).not.toContain("正在生成中");
  });

  it("对话页输入框底部不应再显示项目上下文条", async () => {
    const { container } = renderInputbar({
      projectId: "project-default",
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="inputbar-context-bar-slot"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="composer-utility-bar"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("默认项目");
    expect(container.textContent).not.toContain("本地模式");
    expect(container.textContent).not.toContain("main");
  });
});
