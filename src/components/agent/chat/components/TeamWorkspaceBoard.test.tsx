import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AsterSessionDetail } from "@/lib/api/agentRuntime";
import { TeamWorkspaceBoard } from "./TeamWorkspaceBoard";

const { mockGetAgentRuntimeSession } = vi.hoisted(() => ({
  mockGetAgentRuntimeSession: vi.fn(),
}));

vi.mock("@/lib/api/agentRuntime", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/agentRuntime")>(
      "@/lib/api/agentRuntime",
    );
  return {
    ...actual,
    getAgentRuntimeSession: mockGetAgentRuntimeSession,
  };
});

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <span className={className}>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    className,
    onClick,
    type = "button",
  }: {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
  }) => (
    <button type={type} className={className} onClick={onClick}>
      {children}
    </button>
  ),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockGetAgentRuntimeSession.mockImplementation(async (sessionId: string) =>
    createSessionDetail(sessionId),
  );
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

function createSessionDetail(
  sessionId: string,
  overrides: Partial<AsterSessionDetail> = {},
): AsterSessionDetail {
  return {
    id: sessionId,
    created_at: 1_710_000_000,
    updated_at: 1_710_000_100,
    messages: [],
    items: [],
    ...overrides,
  };
}

async function flushBoardEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderBoard(
  props?: Partial<React.ComponentProps<typeof TeamWorkspaceBoard>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof TeamWorkspaceBoard> = {
    currentSessionId: "parent-1",
    currentSessionName: "主线程",
    childSubagentSessions: [],
  };

  await act(async () => {
    root.render(<TeamWorkspaceBoard {...defaultProps} {...props} />);
    await Promise.resolve();
  });
  await flushBoardEffects();

  mountedRoots.push({ root, container });
  return container;
}

describe("TeamWorkspaceBoard", () => {
  it("仅打开 team shell 且尚未创建子会话时，应默认渲染紧凑状态条", async () => {
    const container = await renderBoard({
      shellVisible: true,
      childSubagentSessions: [],
    });

    expect(container.textContent).toContain("Team Workspace");
    expect(container.textContent).toContain("尚未出现真实团队成员");
    expect(container.textContent).toContain("查看详情");
    expect(container.textContent).not.toContain("spawn_agent");
    expect(container.textContent).not.toContain("Explorer 槽位");
    expect(container.textContent).not.toContain("Executor 槽位");
  });

  it("空 shell 态点击查看详情后，应展开完整 team 说明", async () => {
    const container = await renderBoard({
      shellVisible: true,
      childSubagentSessions: [],
    });

    const expandButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("查看详情"),
    );
    expect(expandButton).toBeTruthy();

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("等待团队成员加入");
    expect(container.textContent).toContain("分派成员");
    expect(container.textContent).toContain("收起");
  });

  it("已选 Team 但尚无真实子会话时，应在主画布展示计划角色", async () => {
    const container = await renderBoard({
      shellVisible: true,
      childSubagentSessions: [],
      selectedTeamLabel: "临时修复 Team",
      selectedTeamSummary: "分析、执行、验证三段式推进。",
      selectedTeamRoles: [
        {
          id: "explorer",
          label: "分析",
          summary: "负责定位问题与影响范围。",
          profileId: "code-explorer",
          roleKey: "explorer",
          skillIds: ["repo-exploration"],
        },
        {
          id: "executor",
          label: "执行",
          summary: "负责完成改动并给出结果。",
          profileId: "code-executor",
          roleKey: "executor",
          skillIds: ["bounded-implementation"],
        },
      ],
    });

    expect(container.textContent).toContain("临时修复 Team");
    expect(container.textContent).toContain("2 个计划角色");

    const expandButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("查看详情"),
    );
    expect(expandButton).toBeTruthy();

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("计划中的 Team 角色");
    expect(container.textContent).toContain("分析");
    expect(container.textContent).toContain("执行");
    expect(container.textContent).toContain("Role · explorer");
    expect(container.textContent).toContain("Profile · code-explorer");
    expect(container.textContent).toContain("Skill · repo-exploration");
  });

  it("主会话视角应展示团队成员、最近过程并支持打开焦点会话", async () => {
    const onOpenSubagentSession = vi.fn();
    mockGetAgentRuntimeSession.mockImplementation(async (sessionId: string) => {
      if (sessionId === "child-2") {
        return createSessionDetail(sessionId, {
          items: [
            {
              id: "child-2-item-1",
              thread_id: "child-2-thread",
              turn_id: "child-2-turn",
              sequence: 1,
              status: "completed",
              started_at: "2026-03-20T10:00:04Z",
              updated_at: "2026-03-20T10:00:06Z",
              type: "plan",
              text: "先整理落地步骤，再生成第一版实施清单。",
            },
          ],
        });
      }

      return createSessionDetail(sessionId, {
        items: [
          {
            id: `${sessionId}-item-1`,
            thread_id: `${sessionId}-thread`,
            turn_id: `${sessionId}-turn`,
            sequence: 2,
            status: "completed",
            started_at: "2026-03-20T10:00:00Z",
            updated_at: "2026-03-20T10:00:02Z",
            type: "agent_message",
            text: "已完成竞品摘要与数据来源梳理。",
          },
          {
            id: `${sessionId}-item-2`,
            thread_id: `${sessionId}-thread`,
            turn_id: `${sessionId}-turn`,
            sequence: 1,
            status: "completed",
            started_at: "2026-03-20T10:00:03Z",
            updated_at: "2026-03-20T10:00:04Z",
            type: "command_execution",
            command: "rg --files docs",
            cwd: "/workspace",
            aggregated_output: "已对 3 个来源完成去重校验。",
          },
        ],
      });
    });
    const container = await renderBoard({
      onOpenSubagentSession,
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "整理竞品与数据来源",
          role_hint: "explorer",
          profile_name: "代码分析员",
          team_preset_id: "code-triage-team",
          skills: [
            {
              id: "repo-exploration",
              name: "仓库探索",
              source: "builtin",
            },
            {
              id: "local:lint-fix",
              name: "lint-fix",
              source: "local",
              directory: "lint-fix",
            },
          ],
        },
        {
          id: "child-2",
          name: "执行器",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "queued",
          queued_turn_count: 2,
          latest_turn_status: "completed",
          task_summary: "起草第一版落地方案",
          role_hint: "executor",
        },
      ],
    });

    expect(container.textContent).toContain("Team Workspace");
    expect(container.textContent).toContain("研究员");
    expect(container.textContent).toContain("执行器");
    expect(container.textContent).toContain("2 位成员已加入");
    expect(container.textContent).toContain("代码分析员");
    expect(container.textContent).toContain("代码排障团队");
    expect(container.textContent).toContain("仓库探索");
    expect(container.textContent).toContain("最近 turn 运行中");
    expect(container.textContent).toContain("最近过程");
    expect(container.textContent).toContain(
      "回复：已完成竞品摘要与数据来源梳理。",
    );
    expect(container.textContent).toContain(
      "计划：先整理落地步骤，再生成第一版实施清单。",
    );
    expect(
      container.querySelector('[data-testid="team-workspace-activity-feed"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("命令输出");
    expect(container.textContent).toContain("已对 3 个来源完成去重校验。");

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("查看对话"),
    );
    expect(openButton).toBeTruthy();

    act(() => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenSubagentSession).toHaveBeenCalledWith("child-1");
  });

  it("子线程视角应展示父会话、最近过程并支持切换 sibling", async () => {
    const onOpenSubagentSession = vi.fn();
    const onReturnToParentSession = vi.fn();
    mockGetAgentRuntimeSession.mockImplementation(async (sessionId: string) => {
      if (sessionId === "child-current") {
        return createSessionDetail(sessionId, {
          items: [
            {
              id: "child-current-item-1",
              thread_id: "child-current-thread",
              turn_id: "child-current-turn",
              sequence: 2,
              status: "completed",
              started_at: "2026-03-20T10:00:00Z",
              updated_at: "2026-03-20T10:00:01Z",
              type: "reasoning",
              text: "先检查 team runtime 的控制面状态，再决定是否等待。",
            },
            {
              id: "child-current-item-2",
              thread_id: "child-current-thread",
              turn_id: "child-current-turn",
              sequence: 1,
              status: "completed",
              started_at: "2026-03-20T10:00:02Z",
              updated_at: "2026-03-20T10:00:03Z",
              type: "web_search",
              output: "已汇总 5 条 roadmap 差异。",
            },
          ],
        });
      }

      if (sessionId === "child-sibling-1") {
        return createSessionDetail(sessionId, {
          items: [
            {
              id: "child-sibling-1-item-1",
              thread_id: "child-sibling-1-thread",
              turn_id: "child-sibling-1-turn",
              sequence: 2,
              status: "completed",
              started_at: "2026-03-20T10:01:00Z",
              updated_at: "2026-03-20T10:01:03Z",
              type: "tool_call",
              tool_name: "browser_snapshot",
              output: "页面已刷新为最新状态并生成差异截图。",
            },
            {
              id: "child-sibling-1-item-2",
              thread_id: "child-sibling-1-thread",
              turn_id: "child-sibling-1-turn",
              sequence: 1,
              status: "failed",
              started_at: "2026-03-20T10:01:04Z",
              updated_at: "2026-03-20T10:01:05Z",
              type: "warning",
              message: "等待父线程确认是否继续扩展范围。",
            },
          ],
        });
      }

      return createSessionDetail(sessionId);
    });
    const container = await renderBoard({
      currentSessionId: "child-current",
      currentSessionName: "实现代理",
      currentSessionRuntimeStatus: "running",
      currentSessionLatestTurnStatus: "running",
      currentSessionQueuedTurnCount: 1,
      onOpenSubagentSession,
      onReturnToParentSession,
      subagentParentContext: {
        parent_session_id: "parent-1",
        parent_session_name: "主线程总览",
        role_hint: "executor",
        task_summary: "完成 UI 与订阅闭环",
        sibling_subagent_sessions: [
          {
            id: "child-sibling-1",
            name: "检索代理",
            created_at: 1_710_000_000,
            updated_at: 1_710_000_200,
            session_type: "sub_agent",
            runtime_status: "completed",
            latest_turn_status: "completed",
            task_summary: "补齐路线图差异清单",
            role_hint: "explorer",
          },
        ],
      },
    });

    expect(container.textContent).toContain("主线程总览");
    expect(container.textContent).toContain("实现代理");
    expect(container.textContent).toContain("检索代理");
    expect(container.textContent).toContain("队列 1");
    expect(container.textContent).toContain("最近过程");
    expect(container.textContent).toContain(
      "推理：先检查 team runtime 的控制面状态，再决定是否等待。",
    );
    expect(
      container.querySelector('[data-testid="team-workspace-activity-feed"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("检索结果");
    expect(container.textContent).toContain("已汇总 5 条 roadmap 差异。");
    expect(container.textContent).toContain(
      "工具 browser_snapshot：页面已刷新为最新状态并生成差异截图。",
    );

    const returnButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("返回父会话"),
    );
    expect(returnButton).toBeTruthy();

    act(() => {
      returnButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onReturnToParentSession).toHaveBeenCalledTimes(1);

    const siblingCardButton = Array.from(
      container.querySelectorAll("button"),
    ).find((element) => element.textContent?.includes("检索代理"));
    expect(siblingCardButton).toBeTruthy();

    act(() => {
      siblingCardButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flushBoardEffects();

    expect(container.textContent).toContain("等待父线程确认是否继续扩展范围。");

    const switchButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("切换"),
    );
    expect(switchButton).toBeTruthy();

    act(() => {
      switchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenSubagentSession).toHaveBeenCalledWith("child-sibling-1");
  });

  it("嵌入态 team 面板应使用实体外壳，并将轨道改为双列卡片布局", async () => {
    const container = await renderBoard({
      embedded: true,
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "整理竞品与数据来源，补齐关键差异点与证据链。",
          role_hint: "explorer",
        },
        {
          id: "child-2",
          name: "执行器",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "queued",
          latest_turn_status: "completed",
          queued_turn_count: 1,
          task_summary: "起草第一版实施方案并给出需要确认的阻塞点。",
          role_hint: "executor",
        },
      ],
    });

    const embeddedShell = container.querySelector<HTMLElement>(
      '[data-testid="team-workspace-board-embedded-shell"]',
    );
    const railList = container.querySelector<HTMLElement>(
      '[data-testid="team-workspace-rail-list"]',
    );
    const summary = container.querySelector<HTMLElement>(
      '[data-testid="team-workspace-session-summary"]',
    );
    const boardBody = container.querySelector<HTMLElement>(
      '[data-testid="team-workspace-board-body"]',
    );

    expect(embeddedShell?.className).toContain("bg-white");
    expect(embeddedShell?.className).toContain("pointer-events-auto");
    expect(embeddedShell?.className).toContain("overflow-hidden");
    expect(embeddedShell?.className).toContain("flex-col");
    expect(embeddedShell?.className).not.toContain("backdrop-blur");
    expect(boardBody?.className).toContain("overflow-y-auto");
    expect(railList?.className).toContain("md:grid-cols-2");
    expect(summary?.textContent).toContain("整理竞品与数据来源");
  });

  it("嵌入态真实 team 应支持收起并重新展开详情", async () => {
    const container = await renderBoard({
      embedded: true,
      childSubagentSessions: [
        {
          id: "child-collapse-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "整理竞品与数据来源，补齐关键差异点与证据链。",
          role_hint: "explorer",
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="team-workspace-detail-section"]'),
    ).toBeTruthy();

    const collapseButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("收起详情"),
    );
    expect(collapseButton).toBeTruthy();

    act(() => {
      collapseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('[data-testid="team-workspace-detail-section"]'),
    ).toBeFalsy();
    expect(
      container.querySelector('[data-testid="team-workspace-compact-summary"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("紧凑视图");
    expect(container.textContent).toContain("展开详情");

    const expandButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("展开详情"),
    );
    expect(expandButton).toBeTruthy();

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('[data-testid="team-workspace-detail-section"]'),
    ).toBeTruthy();
  });

  it("注入 live runtime props 后应立即投影状态与最近轨迹", async () => {
    mockGetAgentRuntimeSession.mockImplementation(async (sessionId: string) =>
      createSessionDetail(sessionId),
    );

    const container = await renderBoard({
      currentSessionId: "parent-1",
      currentSessionName: "主线程",
      childSubagentSessions: [
        {
          id: "child-live-1",
          name: "实时代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "queued",
          latest_turn_status: "queued",
          task_summary: "等待执行实时检查",
          role_hint: "explorer",
        },
      ],
      liveRuntimeBySessionId: {
        "child-live-1": {
          runtimeStatus: "running",
          latestTurnStatus: "running",
          baseFingerprint: "child-live-1:1710000100:queued:queued:0",
        },
      },
      liveActivityBySessionId: {
        "child-live-1": [
          {
            id: "status-child-live-1-running",
            title: "状态切换",
            detail: "收到 team 状态事件，已切换为运行中。",
            statusLabel: "运行中",
            badgeClassName:
              "border border-sky-200 bg-sky-50 text-sky-700",
          },
        ],
      },
      activityRefreshVersionBySessionId: {
        "child-live-1": 1,
      },
    });

    const liveSessionCard = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("实时代理"),
    );

    expect(liveSessionCard?.textContent).toContain("运行中");
    expect(container.textContent).toContain("运行中 1");
    expect(container.textContent).toContain("最近 turn 运行中");
    expect(container.textContent).toContain("状态切换");
    expect(container.textContent).toContain("已切换为运行中。");
    expect(
      container.querySelector('[data-testid="team-workspace-activity-feed"]'),
    ).toBeTruthy();
    expect(mockGetAgentRuntimeSession).toHaveBeenCalledWith("child-live-1");
  });

  it("注入 runtime stream live activity 后，应优先展示实时过程片段", async () => {
    mockGetAgentRuntimeSession.mockImplementation(async (sessionId: string) =>
      createSessionDetail(sessionId, {
        items: [
          {
            id: `${sessionId}-item-1`,
            thread_id: `${sessionId}-thread`,
            turn_id: `${sessionId}-turn`,
            sequence: 1,
            status: "completed",
            started_at: "2026-03-20T10:00:00Z",
            updated_at: "2026-03-20T10:00:03Z",
            type: "agent_message",
            text: "历史快照里的旧内容。",
          },
        ],
      }),
    );

    const container = await renderBoard({
      currentSessionId: "parent-1",
      currentSessionName: "主线程",
      childSubagentSessions: [
        {
          id: "child-live-stream-1",
          name: "实时片段代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "持续回传最新执行过程",
          role_hint: "executor",
        },
      ],
      liveActivityBySessionId: {
        "child-live-stream-1": [
          {
            id: "tool:child-live-stream-1:tool-1",
            title: "工具 browser_snapshot",
            detail: "页面结构差异已提取完成。",
            statusLabel: "完成",
            badgeClassName:
              "border border-emerald-200 bg-emerald-50 text-emerald-700",
          },
        ],
      },
      activityRefreshVersionBySessionId: {
        "child-live-stream-1": 1,
      },
    });

    expect(container.textContent).toContain("实时片段代理");
    expect(container.textContent).toContain(
      "工具 browser_snapshot：页面结构差异已提取完成。",
    );
    expect(container.textContent).toContain("工具 browser_snapshot");
    expect(container.textContent).toContain("页面结构差异已提取完成。");
  });

  it("选中运行中的子代理时应展示停止操作，停止后触发回调", async () => {
    const onCloseSubagentSession = vi.fn();
    const container = await renderBoard({
      childSubagentSessions: [
        {
          id: "child-close-1",
          name: "可关闭代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "准备关闭测试",
          role_hint: "executor",
        },
      ],
      onCloseSubagentSession,
    });

    expect(container.textContent).toContain(
      "停止会中断当前执行并保留会话，可稍后恢复。",
    );

    const closeButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("停止成员"),
    );
    expect(closeButton).toBeTruthy();

    await act(async () => {
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onCloseSubagentSession).toHaveBeenCalledWith("child-close-1");
  });

  it("选中已关闭的子代理时应展示恢复操作，恢复后触发回调", async () => {
    const onResumeSubagentSession = vi.fn();
    const container = await renderBoard({
      childSubagentSessions: [
        {
          id: "child-resume-1",
          name: "可恢复代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "closed",
          latest_turn_status: "closed",
          task_summary: "准备恢复测试",
          role_hint: "explorer",
        },
      ],
      onResumeSubagentSession,
    });

    const resumeButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("恢复成员"),
    );
    expect(resumeButton).toBeTruthy();
    expect(container.textContent).toContain(
      "停止会中断当前执行并保留会话，可稍后恢复。",
    );

    await act(async () => {
      resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onResumeSubagentSession).toHaveBeenCalledWith("child-resume-1");
  });

  it("选中可管理子代理时应支持等待结果", async () => {
    const onWaitSubagentSession = vi.fn();
    const container = await renderBoard({
      childSubagentSessions: [
        {
          id: "child-wait-1",
          name: "可等待代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "等待结果测试",
          role_hint: "executor",
        },
      ],
      onWaitSubagentSession,
    });

    const waitButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("等待结果 30 秒"),
    );
    expect(waitButton).toBeTruthy();

    await act(async () => {
      waitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onWaitSubagentSession).toHaveBeenCalledWith("child-wait-1", 30000);
  });

  it("存在多个活跃子代理时应支持等待任一活跃 agent", async () => {
    const onWaitActiveTeamSessions = vi.fn();
    const container = await renderBoard({
      childSubagentSessions: [
        {
          id: "child-wait-team-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "并行检索差异",
          role_hint: "explorer",
        },
        {
          id: "child-wait-team-2",
          name: "执行器",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "queued",
          latest_turn_status: "queued",
          task_summary: "整理落地清单",
          role_hint: "executor",
        },
        {
          id: "child-wait-team-3",
          name: "归档员",
          created_at: 1_710_000_020,
          updated_at: 1_710_000_130,
          session_type: "sub_agent",
          runtime_status: "completed",
          latest_turn_status: "completed",
          task_summary: "汇总已有结果",
          role_hint: "reviewer",
        },
      ],
      onWaitActiveTeamSessions,
    });

    expect(container.textContent).toContain("等待任一活跃成员");
    expect(container.textContent).toContain("2 位活跃成员可统一等待");

    const waitAnyButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("等待任一活跃成员"),
    );
    expect(waitAnyButton).toBeTruthy();

    await act(async () => {
      waitAnyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onWaitActiveTeamSessions).toHaveBeenCalledWith(
      ["child-wait-team-1", "child-wait-team-2"],
      30000,
    );
  });

  it("存在 team wait 摘要时应在 Team 轨迹中展示聚合等待结果", async () => {
    const container = await renderBoard({
      childSubagentSessions: [
        {
          id: "child-summary-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "继续检索差异",
          role_hint: "explorer",
        },
        {
          id: "child-summary-2",
          name: "执行器",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "completed",
          latest_turn_status: "completed",
          task_summary: "输出落地方案",
          role_hint: "executor",
        },
      ],
      teamWaitSummary: {
        awaitedSessionIds: ["child-summary-1", "child-summary-2"],
        timedOut: false,
        resolvedSessionId: "child-summary-2",
        resolvedStatus: "completed",
        updatedAt: Date.now(),
      },
    });

    const operations = container.querySelector(
      '[data-testid="team-workspace-team-operations"]',
    );

    expect(operations).toBeTruthy();
    expect(operations?.textContent).toContain("等待命中");
    expect(operations?.textContent).toContain("最近一次统一等待命中 执行器");
    expect(operations?.textContent).toContain("已进入已完成状态");
    expect(container.textContent).toContain("输出落地方案");
  });

  it("存在 team wait 命中结果时应自动聚焦到对应 agent", async () => {
    const container = await renderBoard({
      childSubagentSessions: [
        {
          id: "child-focus-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "继续检索差异",
          role_hint: "explorer",
        },
        {
          id: "child-focus-2",
          name: "执行器",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "completed",
          latest_turn_status: "completed",
          task_summary: "输出落地方案",
          role_hint: "executor",
        },
      ],
      teamWaitSummary: {
        awaitedSessionIds: ["child-focus-1", "child-focus-2"],
        timedOut: false,
        resolvedSessionId: "child-focus-2",
        resolvedStatus: "completed",
        updatedAt: Date.now(),
      },
    });

    const summary = container.querySelector(
      '[data-testid="team-workspace-session-summary"]',
    );

    expect(summary?.textContent).toContain("输出落地方案");
    expect(container.textContent).toContain("执行器");
  });

  it("存在级联 close/resume 摘要时应在 Team 轨迹中展示 team 控制结果", async () => {
    const container = await renderBoard({
      childSubagentSessions: [
        {
          id: "child-control-1",
          name: "父执行器",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "closed",
          latest_turn_status: "closed",
          task_summary: "已关闭父执行器",
          role_hint: "executor",
        },
        {
          id: "child-control-2",
          name: "子执行器",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "closed",
          latest_turn_status: "closed",
          task_summary: "已关闭子执行器",
          role_hint: "executor",
        },
      ],
      teamControlSummary: {
        action: "close",
        requestedSessionIds: ["child-control-1"],
        cascadeSessionIds: ["child-control-1", "child-control-2"],
        affectedSessionIds: ["child-control-1", "child-control-2"],
        updatedAt: Date.now(),
      },
    });

    const operations = container.querySelector(
      '[data-testid="team-workspace-team-operations"]',
    );

    expect(operations).toBeTruthy();
    expect(operations?.textContent).toContain("级联停止");
    expect(operations?.textContent).toContain(
      "最近一次停止操作已级联停止 2 位成员",
    );
  });

  it("点击 Team 轨迹项时应切换焦点到对应 agent", async () => {
    const now = Date.now();
    const container = await renderBoard({
      childSubagentSessions: [
        {
          id: "child-op-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "closed",
          latest_turn_status: "closed",
          task_summary: "已关闭研究员",
          role_hint: "explorer",
        },
        {
          id: "child-op-2",
          name: "执行器",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "completed",
          latest_turn_status: "completed",
          task_summary: "输出落地方案",
          role_hint: "executor",
        },
      ],
      teamControlSummary: {
        action: "close",
        requestedSessionIds: ["child-op-1"],
        cascadeSessionIds: ["child-op-1"],
        affectedSessionIds: ["child-op-1"],
        updatedAt: now - 1_000,
      },
      teamWaitSummary: {
        awaitedSessionIds: ["child-op-1", "child-op-2"],
        timedOut: false,
        resolvedSessionId: "child-op-2",
        resolvedStatus: "completed",
        updatedAt: now,
      },
    });

    const summary = container.querySelector(
      '[data-testid="team-workspace-session-summary"]',
    );
    expect(summary?.textContent).toContain("输出落地方案");

    const controlEntry = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("级联停止"),
    );
    expect(controlEntry).toBeTruthy();

    await act(async () => {
      controlEntry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushBoardEffects();

    const nextSummary = container.querySelector(
      '[data-testid="team-workspace-session-summary"]',
    );
    expect(nextSummary?.textContent).toContain("已关闭研究员");
  });

  it("存在已完成 agent 时应支持批量关闭以释放 slot", async () => {
    const onCloseCompletedTeamSessions = vi.fn();
    const container = await renderBoard({
      childSubagentSessions: [
        {
          id: "child-close-team-1",
          name: "执行器",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "completed",
          latest_turn_status: "completed",
          task_summary: "输出落地方案",
          role_hint: "executor",
        },
        {
          id: "child-close-team-2",
          name: "复核员",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "failed",
          latest_turn_status: "failed",
          task_summary: "复核失败案例",
          role_hint: "reviewer",
        },
        {
          id: "child-close-team-3",
          name: "研究员",
          created_at: 1_710_000_020,
          updated_at: 1_710_000_130,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "继续检索差异",
          role_hint: "explorer",
        },
      ],
      onCloseCompletedTeamSessions,
    });

    expect(container.textContent).toContain("清理已完成成员");
    expect(container.textContent).toContain("2 位已完成成员可清理");

    const closeCompletedButton = Array.from(
      container.querySelectorAll("button"),
    ).find((element) => element.textContent?.includes("清理已完成成员"));
    expect(closeCompletedButton).toBeTruthy();

    await act(async () => {
      closeCompletedButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onCloseCompletedTeamSessions).toHaveBeenCalledWith([
      "child-close-team-1",
      "child-close-team-2",
    ]);
  });

  it("选中其他子代理时应支持 send_input 与 interrupt send_input", async () => {
    const onSendSubagentInput = vi.fn();
    const container = await renderBoard({
      currentSessionId: "parent-1",
      childSubagentSessions: [
        {
          id: "child-send-1",
          name: "可发送代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "发送输入测试",
          role_hint: "explorer",
        },
      ],
      onSendSubagentInput,
    });

    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="team-workspace-send-input-textarea"]',
    );
    expect(textarea).toBeTruthy();

    if (!textarea) {
      throw new Error("textarea 未渲染");
    }

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "请继续验证剩余差异，并回传结论。");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("发送补充说明"),
    );
    const interruptButton = Array.from(
      container.querySelectorAll("button"),
    ).find((element) => element.textContent?.includes("中断并发送"));
    expect(sendButton).toBeTruthy();
    expect(interruptButton).toBeTruthy();

    await act(async () => {
      sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onSendSubagentInput).toHaveBeenNthCalledWith(
      1,
      "child-send-1",
      "请继续验证剩余差异，并回传结论。",
      { interrupt: false },
    );

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "请中断当前步骤，改为先输出阻塞列表。");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      interruptButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onSendSubagentInput).toHaveBeenNthCalledWith(
      2,
      "child-send-1",
      "请中断当前步骤，改为先输出阻塞列表。",
      { interrupt: true },
    );
  });

  it("嵌入态头部应保持 sticky，避免滚动时顶部信息被卷走", async () => {
    const container = await renderBoard({
      embedded: true,
      childSubagentSessions: [
        {
          id: "child-sticky-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "整理竞品与数据来源",
          role_hint: "explorer",
        },
      ],
    });

    const header = container.querySelector<HTMLElement>(
      '[data-testid="team-workspace-board-header"]',
    );

    expect(header).toBeTruthy();
    expect(header?.className).toContain("sticky");
    expect(header?.className).toContain("top-0");
  });

  it("本轮 Team 准备中时，应在空 shell 展示组建状态", async () => {
    const container = await renderBoard({
      shellVisible: true,
      runtimeTeamState: {
        requestId: "runtime-forming-1",
        status: "forming",
        label: "排障 Team",
        summary: "围绕当前任务组织最轻量可用的运行时团队。",
        members: [],
        blueprint: {
          label: "代码排障团队",
          summary: "分析、执行、验证三段式推进。",
          roles: [],
        },
        updatedAt: Date.now(),
      },
    });

    expect(container.textContent).toContain("正在准备本轮 Team");
    expect(container.textContent).toContain("组建中");
    expect(container.textContent).toContain("Team · 排障 Team");
    expect(container.textContent).toContain("参考蓝图 · 代码排障团队");
  });

  it("本轮 Team 已就绪时，应在无真实子会话下展示当前成员", async () => {
    const container = await renderBoard({
      shellVisible: true,
      defaultShellExpanded: true,
      runtimeTeamState: {
        requestId: "runtime-formed-1",
        status: "formed",
        label: "修复 Team",
        summary: "分析、执行、验证协作闭环。",
        members: [
          {
            id: "runtime-explorer",
            label: "分析",
            summary: "收敛问题边界并整理影响范围。",
            roleKey: "explorer",
            profileId: "code-explorer",
            skillIds: ["repo-exploration"],
            status: "planned",
          },
          {
            id: "runtime-executor",
            label: "执行",
            summary: "在边界内落地修复并汇报结果。",
            roleKey: "executor",
            profileId: "code-executor",
            skillIds: ["bounded-implementation"],
            status: "planned",
          },
        ],
        blueprint: {
          label: "代码排障团队",
          summary: "分析、执行、验证三段式推进。",
          roles: [
            {
              id: "explorer",
              label: "分析",
              summary: "先定位问题与影响面。",
            },
          ],
        },
        updatedAt: Date.now(),
      },
    });

    expect(
      container.querySelector('[data-testid="team-workspace-runtime-formation"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="team-workspace-runtime-members"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("本轮 Team 已就绪");
    expect(container.textContent).toContain("分析");
    expect(container.textContent).toContain("执行");
    expect(container.textContent).toContain("Skill · repo-exploration");
    expect(container.textContent).toContain("参考蓝图角色");
  });

  it("本轮 Team 准备失败时，应展示失败原因", async () => {
    const container = await renderBoard({
      shellVisible: true,
      defaultShellExpanded: true,
      runtimeTeamState: {
        requestId: "runtime-failed-1",
        status: "failed",
        label: "失败的 Team",
        summary: null,
        members: [],
        blueprint: null,
        errorMessage: "Provider 认证失败，无法生成 Team。",
        updatedAt: Date.now(),
      },
    });

    expect(container.textContent).toContain("Team 生成失败");
    expect(container.textContent).toContain(
      "Provider 认证失败，无法生成 Team。",
    );
  });
});
