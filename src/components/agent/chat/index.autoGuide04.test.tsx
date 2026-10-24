import { describe, expect, it } from "vitest";
import {
  clickButton,
  flushEffects,
  getIndexTestMocks,
  renderPage,
} from "./index.testFixtures";

const {
  mockExecutionRunGetGeneralWorkbenchState,
  mockExecutionRunListGeneralWorkbenchHistory,
  mockIsSpecializedWorkbenchTheme,
  mockSkillExecutionGetDetail,
} = getIndexTestMocks();

describe("AgentChatPage 自动引导", { timeout: 20_000 }, () => {
  it("工作区编排日志应支持继续加载更早的会话历史", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockExecutionRunGetGeneralWorkbenchState.mockResolvedValue({
      run_state: "idle",
      current_gate_key: "idle",
      queue_items: [],
      latest_terminal: {
        run_id: "run-current",
        execution_id: "exec-current",
        title: "当前运行",
        gate_key: "write_mode",
        status: "success",
        source: "skill",
        source_ref: null,
        started_at: "2026-03-06T06:00:00.000Z",
        finished_at: "2026-03-06T06:05:00.000Z",
      },
      recent_terminals: [
        {
          run_id: "run-current",
          execution_id: "exec-current",
          title: "当前运行",
          gate_key: "write_mode",
          status: "success",
          source: "skill",
          source_ref: null,
          started_at: "2026-03-06T06:00:00.000Z",
          finished_at: "2026-03-06T06:05:00.000Z",
        },
      ],
      updated_at: "2026-03-06T06:05:00.000Z",
    });
    mockExecutionRunListGeneralWorkbenchHistory
      .mockResolvedValueOnce({
        items: [
          {
            run_id: "run-older-1",
            execution_id: "exec-older-1",
            title: "更早一轮",
            gate_key: "topic_select",
            status: "error",
            source: "skill",
            source_ref: null,
            started_at: "2026-03-06T05:00:00.000Z",
            finished_at: "2026-03-06T05:04:00.000Z",
          },
        ],
        has_more: true,
        next_offset: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            run_id: "run-older-2",
            execution_id: "exec-older-2",
            title: "更早二轮",
            gate_key: "publish_confirm",
            status: "success",
            source: "skill",
            source_ref: null,
            started_at: "2026-03-06T04:00:00.000Z",
            finished_at: "2026-03-06T04:05:00.000Z",
          },
        ],
        has_more: false,
        next_offset: null,
      });

    const container = renderPage({
      projectId: "project-theme-load-history",
      contentId: "content-theme-load-history",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(12);

    const sidebar = container.querySelector(
      '[data-testid="general-workbench-sidebar"]',
    ) as HTMLElement | null;
    expect(sidebar).toBeTruthy();

    const firstRuns = sidebar?.getAttribute("data-activity-runs") || "";
    expect(firstRuns).toContain("run-current");
    expect(firstRuns).toContain("run-older-1");

    clickButton(container, "general-load-more-history");
    await flushEffects(12);

    const secondRuns = sidebar?.getAttribute("data-activity-runs") || "";
    expect(secondRuns).toContain("run-older-2");
    expect(mockExecutionRunListGeneralWorkbenchHistory).toHaveBeenNthCalledWith(
      1,
      "session-1",
      20,
      0,
    );
    expect(mockExecutionRunListGeneralWorkbenchHistory).toHaveBeenNthCalledWith(
      2,
      "session-1",
      20,
      1,
    );
  });

  it("工作区编排不应把聊天命令 source_ref 当成 Skill 详情去加载", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    mockExecutionRunGetGeneralWorkbenchState.mockResolvedValue({
      run_state: "auto_running",
      current_gate_key: "write_mode",
      queue_items: [
        {
          run_id: "run-chat-command",
          title: "执行工作区编排",
          gate_key: "write_mode",
          status: "running",
          source: "chat",
          source_ref: "turn/start",
          started_at: "2026-03-06T04:00:00.000Z",
        },
      ],
      latest_terminal: null,
      updated_at: "2026-03-06T04:00:02.000Z",
    });

    renderPage({
      projectId: "project-theme-chat-command",
      contentId: "content-theme-chat-command",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(12);

    expect(mockSkillExecutionGetDetail).not.toHaveBeenCalledWith("turn/start");
  });

  it("社媒工作区编排空闲时也应常显 harness 图标入口", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);

    const container = renderPage({
      projectId: "project-social-harness-idle",
      contentId: "content-social-harness-idle",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(12);

    const harnessToggle = container.querySelector(
      '[data-testid="theme-workbench-harness-toggle"]',
    ) as HTMLButtonElement | null;
    const harnessCard = container.querySelector(
      '[data-testid="theme-workbench-harness-card"]',
    ) as HTMLElement | null;
    const sidebar = container.querySelector(
      '[data-testid="general-workbench-sidebar"]',
    ) as HTMLElement | null;

    expect(harnessToggle).not.toBeNull();
    expect(harnessCard).not.toBeNull();
    expect(harnessCard?.getAttribute("data-run-state")).toBe("idle");
    expect(harnessCard?.getAttribute("data-layout")).toBe("icon");
    expect(sidebar?.contains(harnessCard as Node)).toBe(true);
    expect(harnessCard?.textContent).toContain("工作台 Harness");
    expect(harnessCard?.textContent).toContain("编排待启动");
    expect(
      document.body.querySelector('[data-testid="harness-status-panel"]'),
    ).toBeNull();
  });

  it("社媒工作区编排应以弹窗展示 harness 运行详情", async () => {
    mockIsSpecializedWorkbenchTheme.mockReturnValue(true);
    const startedAt = new Date(Date.now() - 10_000).toISOString();
    const updatedAt = new Date().toISOString();
    mockExecutionRunGetGeneralWorkbenchState.mockResolvedValue({
      run_state: "auto_running",
      current_gate_key: "write_mode",
      queue_items: [
        {
          run_id: "run-social-harness-active",
          title: "生成社媒初稿",
          gate_key: "write_mode",
          artifact_paths: [
            "content-posts/demo-post.md",
            "content-posts/demo-cover.png",
          ],
          status: "running",
          source: "skill",
          source_ref: null,
          started_at: startedAt,
        },
      ],
      latest_terminal: null,
      updated_at: updatedAt,
    });

    const container = renderPage({
      projectId: "project-social-harness-running",
      contentId: "content-social-harness-running",
      theme: "general",
      lockTheme: true,
    });
    await flushEffects(12);

    const harnessCard = container.querySelector(
      '[data-testid="theme-workbench-harness-card"]',
    ) as HTMLElement | null;
    const sidebar = container.querySelector(
      '[data-testid="general-workbench-sidebar"]',
    ) as HTMLElement | null;
    const layoutChat = container.querySelector(
      '[data-testid="layout-chat"]',
    ) as HTMLElement | null;
    expect(harnessCard?.getAttribute("data-run-state")).toBe("auto_running");
    expect(harnessCard?.getAttribute("data-layout")).toBe("icon");
    expect(sidebar?.contains(harnessCard as Node)).toBe(true);
    expect(harnessCard?.textContent).toContain("写作闸门");
    expect(harnessCard?.textContent).toContain("生成社媒初稿");
    expect(harnessCard?.textContent).toContain("2 个产物");
    expect(
      layoutChat?.querySelector('[data-testid="theme-workbench-harness-card"]'),
    ).toBeNull();

    clickButton(container, "theme-workbench-harness-toggle");
    await flushEffects(2);

    expect(
      document.body.querySelector('[data-testid="harness-status-panel"]'),
    ).not.toBeNull();
    expect(
      sidebar?.querySelector('[data-testid="harness-status-panel"]'),
    ).toBeNull();
    expect(
      layoutChat?.querySelector('[data-testid="harness-status-panel"]'),
    ).toBeNull();
    expect(
      document.body
        .querySelector('[data-testid="harness-status-panel"]')
        ?.getAttribute("data-layout"),
    ).toBe("dialog");
  });
});
