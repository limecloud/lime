import { act } from "react";
import { describe, expect, it } from "vitest";
import {
  createHarnessState,
  renderPanel,
} from "./HarnessStatusPanel.testFixtures";
import { conversationProjectionStore } from "../projection/conversationProjectionStore";

describe("HarnessStatusPanel", () => {
  it("只从 canonical ThreadGoal 展示目标详情", () => {
    const goal = {
      createdAt: 10,
      objective: "对齐 Codex ThreadGoal",
      status: "active" as const,
      threadId: "thread-goal-1",
      timeUsedSeconds: 12,
      tokensUsed: 240,
      updatedAt: 20,
    };
    const { container } = renderPanel({
      layout: "dialog",
      threadGoal: goal,
      threadRead: {
        thread_id: "thread-goal-1",
        status: "idle",
        managed_objective: {
          objective_text: "旧 ManagedObjective 不得展示",
          status: "active",
          success_criteria: [],
        },
      },
    });

    expect(container.textContent).toContain("对齐 Codex ThreadGoal");
    expect(container.textContent).not.toContain("旧 ManagedObjective 不得展示");
    expect(
      container.querySelector('[data-testid="thread-goal-panel"]'),
    ).not.toBeNull();

    const mismatch = renderPanel({
      layout: "dialog",
      threadGoal: { ...goal, threadId: "thread-other" },
      threadRead: { thread_id: "thread-goal-1", status: "idle" },
    });
    expect(
      mismatch.container.querySelector('[data-testid="thread-goal-panel"]'),
    ).toBeNull();
  });

  it("弹窗模式应默认展示完整内容且不渲染展开按钮", () => {
    const { container } = renderPanel({
      layout: "dialog",
    });
    const panel = container.querySelector(
      '[data-testid="harness-status-panel"]',
    ) as HTMLDivElement | null;
    const scrollArea = container.querySelector(
      '[data-testid="harness-status-panel"] > .relative.overflow-auto',
    ) as HTMLDivElement | null;
    const summaryGrid = container.querySelector(
      '[data-testid="harness-summary-cards-grid"]',
    ) as HTMLDivElement | null;

    expect(document.body.textContent).toContain("待审批");
    expect(document.body.textContent).toContain("文件活动");
    expect(document.body.textContent).toContain("计划状态");
    expect(document.body.textContent).not.toContain("展开详情");
    expect(document.body.textContent).not.toContain("收起详情");
    expect(panel?.className).toContain("lime-workbench-theme-scope");
    expect(panel?.className).toContain("lime-workbench-surface-scope");
    expect(panel?.className).toContain("bg-[color:var(--lime-surface)]");
    expect(panel?.className).toContain(
      "border-[color:var(--lime-surface-border)]",
    );
    expect(panel?.className).toContain("flex");
    expect(panel?.className).toContain("h-full");
    expect(panel?.children.length).toBe(2);
    expect(scrollArea?.className).toContain("flex-1");
    expect(scrollArea?.className).toContain("min-h-0");
    expect(summaryGrid?.className).toContain(
      "repeat(auto-fit,minmax(min(100%,12rem),1fr))",
    );
    expect(summaryGrid?.className).not.toContain("xl:grid-cols");
    expect(summaryGrid?.className).not.toContain("sm:grid-cols");
    expect(panel?.querySelector(".sticky.top-0")).toBeNull();
  });

  it("应从 conversationProjectionStore.agentUi 展示标准投影摘要", () => {
    act(() => {
      conversationProjectionStore.recordAgentUiProjectionEvents([
        {
          type: "task.changed",
          sourceType: "queue_added",
          sequence: 1,
          sessionId: "session-agentui-1",
          threadId: "thread-agentui-1",
          taskId: "task-agentui-1",
          owner: "task",
          scope: "task",
          phase: "submitted",
          surface: "task_capsule",
          control: "steer",
          payload: { taskEvent: "steer_intent" },
        },
        {
          type: "action.required",
          sourceType: "action_required",
          sequence: 2,
          sessionId: "session-agentui-1",
          threadId: "thread-agentui-1",
          actionId: "action-agentui-1",
          owner: "action",
          scope: "action_request",
          phase: "waiting",
          surface: "hitl",
          control: "approve",
          payload: { status: "waiting" },
        },
        {
          type: "artifact.preview.ready",
          sourceType: "artifact_snapshot",
          sequence: 3,
          sessionId: "session-agentui-1",
          threadId: "thread-agentui-1",
          artifactId: "artifact-agentui-1",
          owner: "artifact",
          scope: "artifact",
          phase: "completed",
          surface: "artifact_workspace",
          payload: { status: "preview_ready" },
        },
        {
          type: "evidence.changed",
          sourceType: "evidence_projection",
          sequence: 4,
          sessionId: "session-agentui-1",
          threadId: "thread-agentui-1",
          evidenceId: "evidence-agentui-1",
          owner: "evidence",
          scope: "evidence",
          phase: "completed",
          surface: "timeline_evidence",
          persistence: "evidence_pack",
          payload: { verdict: "gaps_present" },
        },
        {
          type: "diagnostic.changed",
          sourceType: "runtime_status",
          sequence: 5,
          sessionId: "session-agentui-1",
          threadId: "thread-agentui-1",
          owner: "diagnostics",
          scope: "run",
          phase: "routing",
          surface: "diagnostics",
          payload: { status: "limit_warning" },
        },
        {
          type: "metric.changed",
          sourceType: "performance_metric",
          sequence: 6,
          sessionId: "session-agentui-1",
          threadId: "thread-agentui-1",
          owner: "diagnostics",
          scope: "run",
          phase: "completed",
          surface: "diagnostics",
          payload: { status: "paint_ready" },
        },
        {
          type: "diagnostic.changed",
          sourceType: "runtime_status",
          sequence: 7,
          sessionId: "session-other",
          owner: "diagnostics",
          scope: "run",
          phase: "routing",
          surface: "diagnostics",
          payload: { status: "other session marker" },
        },
      ]);
    });

    renderPanel({
      layout: "dialog",
      diagnosticRuntimeContext: {
        sessionId: "session-agentui-1",
        workspaceId: "workspace-agentui-1",
        providerType: "openai",
        model: "gpt-5.4",
        executionStrategy: "react",
        activeTheme: "default",
      },
    });

    expect(document.body.textContent).toContain("AgentUI 标准投影");
    expect(document.body.textContent).toContain("6 条");
    expect(document.body.textContent).toContain(
      "只读取 conversationProjectionStore.agentUi",
    );
    expect(document.body.textContent).toContain("Action / HITL");
    expect(document.body.textContent).toContain("Task / Agent");
    expect(document.body.textContent).toContain("Artifact");
    expect(document.body.textContent).toContain("Evidence");
    expect(document.body.textContent).toContain("Diagnostics");
    expect(document.body.textContent).toContain("队列更新");
    expect(document.body.textContent).toContain("产物快照");
    expect(document.body.textContent).toContain("运行状态");
    expect(document.body.textContent).toContain("steer_intent");
    expect(document.body.textContent).toContain("gaps_present");
    expect(document.body.textContent).not.toContain("queue_added");
    expect(document.body.textContent).not.toContain("artifact_snapshot");
    expect(document.body.textContent).not.toContain("runtime_status");
    expect(document.body.textContent).not.toContain("other session marker");
  });

  it("非弹窗折叠态不应订阅并展示 AgentUI 投影详情，展开后再显示", () => {
    act(() => {
      conversationProjectionStore.recordAgentUiProjectionEvents([
        {
          type: "evidence.changed",
          sourceType: "evidence_projection",
          sequence: 101,
          sessionId: "session-agentui-collapsed",
          threadId: "thread-agentui-collapsed",
          evidenceId: "evidence-collapsed",
          owner: "evidence",
          scope: "evidence",
          phase: "completed",
          surface: "timeline_evidence",
          persistence: "evidence_pack",
          payload: { verdict: "gaps_present" },
        },
      ]);
    });

    renderPanel({
      diagnosticRuntimeContext: {
        sessionId: "session-agentui-collapsed",
        workspaceId: "workspace-agentui-collapsed",
        providerType: "openai",
        model: "gpt-5.4",
        executionStrategy: "react",
        activeTheme: "default",
      },
    });

    expect(document.body.textContent).toContain("展开详情");
    expect(document.body.textContent).not.toContain("AgentUI 标准投影");
    expect(document.body.textContent).not.toContain("gaps_present");

    const toggle = document.body.querySelector(
      'button[aria-label="展开详情"]',
    ) as HTMLButtonElement | null;

    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("AgentUI 标准投影");
    expect(document.body.textContent).toContain("gaps_present");
  });

  it("弹窗模式应让前置概览跟随滚动区，而不是固定在顶部", () => {
    const { container } = renderPanel({
      layout: "dialog",
      leadContent: <div>通用 Agent 运行概览</div>,
    });
    const panel = container.querySelector(
      '[data-testid="harness-status-panel"]',
    ) as HTMLDivElement | null;
    const scrollArea = container.querySelector(
      '[data-testid="harness-status-panel"] > .relative.overflow-auto',
    ) as HTMLDivElement | null;

    expect(panel?.children.length).toBe(2);
    expect(scrollArea?.textContent).toContain("通用 Agent 运行概览");
  });

  it("应支持自定义标题说明与前置运行概览内容", () => {
    renderPanel({
      title: "处理工作台",
      description: "集中查看代理运行轨迹。",
      toggleLabel: "工作台详情",
      leadContent: <div>通用 Agent 运行概览</div>,
    });

    expect(document.body.textContent).toContain("处理工作台");
    expect(document.body.textContent).toContain("集中查看代理运行轨迹。");
    expect(document.body.textContent).toContain("通用 Agent 运行概览");
    expect(document.body.textContent).toContain("展开工作台详情");
  });

  it("非弹窗模式默认折叠详情，避免 Harness 详情扫描阻塞对话首屏", () => {
    renderPanel({
      turns: [
        {
          id: "turn-light-panel",
          thread_id: "thread-1",
          prompt_text: "整理今天的国际新闻",
          status: "completed",
          started_at: "2026-03-24T09:00:00Z",
          created_at: "2026-03-24T09:00:00Z",
          updated_at: "2026-03-24T09:00:12Z",
          completed_at: "2026-03-24T09:00:12Z",
        },
      ],
      currentTurnId: "turn-light-panel",
      threadItems: [
        {
          id: "item-detail-only-error",
          thread_id: "thread-1",
          turn_id: "turn-light-panel",
          sequence: 2453,
          status: "failed",
          started_at: "2026-03-24T09:00:10Z",
          completed_at: "2026-03-24T09:00:10Z",
          updated_at: "2026-03-24T09:00:10Z",
          type: "error",
          message: "详情态才展示的历史错误",
        },
      ],
    });

    expect(document.body.textContent).toContain("展开详情");
    expect(document.body.textContent).not.toContain("线程可靠性");
    expect(document.body.textContent).not.toContain("详情态才展示的历史错误");

    const toggle = document.body.querySelector(
      'button[aria-label="展开详情"]',
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();

    act(() => {
      toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("收起详情");
    expect(document.body.textContent).toContain("线程可靠性");
    expect(document.body.textContent).toContain("详情态才展示的历史错误");
  });

  it("未激活 skill 时不应渲染技能区块与导航入口", () => {
    renderPanel({
      environment: {
        skillsCount: 0,
        skillNames: [],
        memorySignals: ["风格"],
      },
    });

    expect(document.body.textContent).not.toContain("已激活技能");
    expect(
      document.body.querySelector('button[aria-label="跳转到已激活技能"]'),
    ).toBeNull();
  });

  it("存在 runtimeStatus 时应在工作台中展示当前执行阶段", () => {
    renderPanel({
      layout: "dialog",
      harnessState: createHarnessState({
        runtimeStatus: {
          phase: "routing",
          title: "正在启动处理流程",
          detail: "已提交到运行时，正在等待首个执行事件。",
          checkpoints: ["会话已建立", "等待首个模型事件"],
        },
      }),
    });

    expect(document.body.textContent).toContain("当前任务");
    expect(document.body.textContent).toContain("任务进行时");
    expect(document.body.textContent).toContain("任务节点");
    expect(document.body.textContent).toContain("已记录 2 个任务节点");
    expect(document.body.textContent).toContain("正在启动处理流程");
    expect(document.body.textContent).toContain("等待首个模型事件");
  });

  it("存在线程可靠性信号时应在工作台展示可靠性入口与面板", () => {
    renderPanel({
      layout: "dialog",
      turns: [
        {
          id: "turn-reliability",
          thread_id: "thread-1",
          prompt_text: "继续发布文章",
          status: "running",
          started_at: "2026-03-24T09:00:00Z",
          created_at: "2026-03-24T09:00:00Z",
          updated_at: "2026-03-24T09:00:12Z",
        },
      ],
      currentTurnId: "turn-reliability",
      pendingActions: [
        {
          requestId: "req-reliability-1",
          actionType: "ask_user",
          prompt: "请确认是否继续发布",
          status: "pending",
        },
      ],
    });

    expect(document.body.textContent).toContain("线程可靠性");
    expect(document.body.textContent).toContain("请确认是否继续发布");
    expect(
      document.body.querySelector('button[aria-label="跳转到可靠性"]'),
    ).not.toBeNull();
  });

  it("存在 thread_read runtime facts 时应展示运行时事实区块", () => {
    renderPanel({
      layout: "dialog",
      threadRead: {
        thread_id: "thread-1",
        status: "running",
        decision_reason:
          "当前 provider 候选池共有 3 个兼容候选，已按连续性、能力与成本优选。",
        fallback_chain: ["openai:gpt-5.4", "openai:gpt-5.4-mini"],
        oem_policy: {
          locked: true,
          quotaLow: true,
          defaultModel: "claude-sonnet-4",
        },
        runtime_summary: {
          decisionReason:
            "当前 provider 候选池共有 3 个兼容候选，已按连续性、能力与成本优选。",
          fallbackChain: ["openai:gpt-5.4", "openai:gpt-5.4-mini"],
        },
      },
    });

    expect(document.body.textContent).toContain("运行时事实");
    expect(document.body.textContent).toContain("决策原因");
    expect(document.body.textContent).toContain("回退链");
    expect(document.body.textContent).toContain("品牌云端托管锁定");
    expect(document.body.textContent).toContain("品牌云端额度偏低");
    expect(document.body.textContent).toContain("claude-sonnet-4");
  });
});
