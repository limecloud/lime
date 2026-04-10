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
  const actual = await vi.importActual<typeof import("@/lib/api/agentRuntime")>(
    "@/lib/api/agentRuntime",
  );
  return {
    ...actual,
    getAgentRuntimeSession: mockGetAgentRuntimeSession,
  };
});

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    className,
    onClick,
    type = "button",
    ...props
  }: {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
    [key: string]: unknown;
  }) => (
    <button type={type} className={className} onClick={onClick} {...props}>
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
  window.localStorage.clear();
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
  window.localStorage.clear();
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

function getLaneMetrics(container: HTMLDivElement, laneId: string) {
  const lane = container.querySelector<HTMLElement>(
    `[data-testid="team-workspace-member-lane-${laneId}"]`,
  );
  expect(lane).toBeTruthy();

  return {
    lane,
    x: Number(lane?.getAttribute("data-lane-x") ?? "0"),
    y: Number(lane?.getAttribute("data-lane-y") ?? "0"),
    width: Number(lane?.getAttribute("data-lane-width") ?? "0"),
    height: Number(lane?.getAttribute("data-lane-height") ?? "0"),
  };
}

function getViewportMetrics(container: HTMLDivElement) {
  const viewport = container.querySelector<HTMLElement>(
    '[data-testid="team-workspace-rail-list"]',
  );
  expect(viewport).toBeTruthy();

  return {
    viewport,
    x: Number(viewport?.getAttribute("data-viewport-x") ?? "0"),
    y: Number(viewport?.getAttribute("data-viewport-y") ?? "0"),
    zoom: Number(viewport?.getAttribute("data-viewport-zoom") ?? "0"),
  };
}

async function dragMouse(
  target: Element,
  options: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  },
) {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        clientX: options.start.x,
        clientY: options.start.y,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: options.end.x,
        clientY: options.end.y,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        clientX: options.end.x,
        clientY: options.end.y,
      }),
    );
    await Promise.resolve();
  });
}

async function pressKey(
  target: EventTarget,
  options: {
    key: string;
    code: string;
    type?: "keydown" | "keyup";
    shiftKey?: boolean;
  },
) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent(options.type ?? "keydown", {
        bubbles: true,
        key: options.key,
        code: options.code,
        shiftKey: options.shiftKey,
      }),
    );
    await Promise.resolve();
  });
}

async function clickElement(target: Element | null) {
  expect(target).toBeTruthy();
  await act(async () => {
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function expandLane(container: HTMLDivElement, laneId: string) {
  const lane = container.querySelector(
    `[data-testid="team-workspace-member-lane-${laneId}"]`,
  );
  await clickElement(lane);
  await flushBoardEffects();
  return lane as HTMLElement | null;
}

async function unmountBoard(container: HTMLDivElement) {
  const mountedIndex = mountedRoots.findIndex(
    (mounted) => mounted.container === container,
  );
  if (mountedIndex < 0) {
    return;
  }

  const [mounted] = mountedRoots.splice(mountedIndex, 1);
  act(() => {
    mounted?.root.unmount();
  });
  mounted?.container.remove();
}

describe("TeamWorkspaceBoard", () => {
  it("仅打开 team shell 且尚未创建子会话时，应默认渲染紧凑状态条", async () => {
    const container = await renderBoard({
      shellVisible: true,
      childSubagentSessions: [],
    });

    expect(container.textContent).toContain("创作协作");
    expect(container.textContent).toContain("还没有协作成员加入");
    expect(container.textContent).toContain("查看任务进展");
    expect(container.textContent).not.toContain("spawn_agent");
    expect(container.textContent).not.toContain("Explorer 槽位");
    expect(container.textContent).not.toContain("Executor 槽位");
  });

  it("空 shell 态点击展开详情后，应展开完整 team 说明", async () => {
    const container = await renderBoard({
      shellVisible: true,
      childSubagentSessions: [],
    });

    const expandButton = container.querySelector(
      '[data-testid="team-workspace-detail-toggle"]',
    ) as HTMLButtonElement | null;
    expect(expandButton).toBeTruthy();

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("需要时会自动加入协作成员");
    expect(container.textContent).toContain("邀请协作成员");
    expect(container.textContent).toContain("收起细节");
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
    expect(container.textContent).toContain("2 个计划分工");

    const expandButton = container.querySelector(
      '[data-testid="team-workspace-detail-toggle"]',
    ) as HTMLButtonElement | null;
    expect(expandButton).toBeTruthy();

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("计划中的协作分工");
    expect(container.textContent).toContain("分析");
    expect(container.textContent).toContain("执行");
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

    expect(container.textContent).toContain("创作协作");
    expect(container.textContent).toContain("2 位成员协作中");
    expect(container.textContent).toContain("研究员");
    expect(container.textContent).toContain("执行器");
    expect(container.textContent).toContain("代码分析员");
    expect(container.textContent).toContain("代码排障团队");
    expect(container.textContent).toContain("仓库探索");
    expect(container.textContent).toContain("最近进展 处理中");
    expect(
      container.querySelector(
        '[data-testid="team-workspace-member-detail-child-1"]',
      ),
    ).toBeFalsy();
    expect(
      container
        .querySelector('[data-testid="team-workspace-member-lane-child-1"]')
        ?.getAttribute("data-expanded"),
    ).toBe("false");
    expect(
      container.querySelector('[data-testid="team-workspace-canvas-toolbar"]')
        ?.textContent,
    ).toContain("焦点 研究员");
    expect(
      container.querySelector('[data-testid="team-workspace-canvas-toolbar"]')
        ?.textContent,
    ).toContain("缩放 100%");
    expect(container.textContent).toContain("最近进展");
    expect(container.textContent).toContain(
      "回复：已完成竞品摘要与数据来源梳理。",
    );
    expect(container.textContent).toContain(
      "计划：先整理落地步骤，再生成第一版实施清单。",
    );

    const researcherLane = container.querySelector(
      '[data-testid="team-workspace-member-lane-child-1"]',
    );
    const executorLane = container.querySelector(
      '[data-testid="team-workspace-member-lane-child-2"]',
    );
    expect(researcherLane?.textContent).toContain("成员进展");
    expect(researcherLane?.textContent).toContain(
      "回复：已完成竞品摘要与数据来源梳理。",
    );
    expect(executorLane?.textContent).toContain(
      "计划：先整理落地步骤，再生成第一版实施清单。",
    );

    await expandLane(container, "child-1");

    expect(
      container.querySelector(
        '[data-testid="team-workspace-member-detail-child-1"]',
      ),
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-testid="team-workspace-member-lane-child-1"]')
        ?.getAttribute("data-expanded"),
    ).toBe("true");
    expect(
      container.querySelector('[data-testid="team-workspace-activity-feed"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("命令输出");
    expect(container.textContent).toContain("已对 3 个来源完成去重校验。");

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("打开对话"),
    );
    await clickElement(openButton ?? null);

    expect(onOpenSubagentSession).toHaveBeenCalledWith("child-1");
  });

  it("真实成员存在时应优先按蓝图角色顺序排列泳道", async () => {
    const container = await renderBoard({
      childSubagentSessions: [
        {
          id: "child-executor",
          name: "执行成员",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "queued",
          latest_turn_status: "queued",
          task_summary: "负责提交修复。",
          role_hint: "executor",
          blueprint_role_id: "runtime-executor",
          blueprint_role_label: "执行",
          profile_id: "code-executor",
          role_key: "executor",
        },
        {
          id: "child-explorer",
          name: "分析成员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "负责定位问题。",
          role_hint: "explorer",
          blueprint_role_id: "runtime-explorer",
          blueprint_role_label: "分析",
          profile_id: "code-explorer",
          role_key: "explorer",
        },
      ],
      teamDispatchPreviewState: {
        requestId: "runtime-formed-ordered",
        status: "formed",
        label: "修复 Team",
        summary: "分析、执行协同推进。",
        members: [
          {
            id: "runtime-explorer",
            label: "分析",
            summary: "先定位问题。",
            roleKey: "explorer",
            profileId: "code-explorer",
            skillIds: ["repo-exploration"],
            status: "planned",
          },
          {
            id: "runtime-executor",
            label: "执行",
            summary: "再提交修复。",
            roleKey: "executor",
            profileId: "code-executor",
            skillIds: ["bounded-implementation"],
            status: "planned",
          },
        ],
        blueprint: null,
        updatedAt: Date.now(),
      },
    });

    const laneIds = Array.from(
      container.querySelectorAll(
        '[data-testid^="team-workspace-member-lane-"][data-lane-x]',
      ),
    ).map((element) => element.getAttribute("data-testid"));

    expect(laneIds).toEqual([
      "team-workspace-member-lane-child-explorer",
      "team-workspace-member-lane-child-executor",
    ]);
    expect(container.textContent).toContain("分工 · 分析");
    expect(container.textContent).toContain("分工 · 执行");
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
    expect(container.textContent).toContain("等待中 1");
    expect(
      container.querySelector(
        '[data-testid="team-workspace-member-detail-child-current"]',
      ),
    ).toBeFalsy();
    expect(
      container.querySelector('[data-testid="team-workspace-canvas-toolbar"]')
        ?.textContent,
    ).toContain("焦点 实现代理");
    expect(
      container.querySelector('[data-testid="team-workspace-canvas-toolbar"]')
        ?.textContent,
    ).toContain("缩放 100%");
    expect(container.textContent).toContain("最近进展");
    expect(container.textContent).toContain(
      "推理：先检查 team runtime 的控制面状态，再决定是否等待。",
    );

    const currentLane = container.querySelector(
      '[data-testid="team-workspace-member-lane-child-current"]',
    );
    const siblingLane = container.querySelector(
      '[data-testid="team-workspace-member-lane-child-sibling-1"]',
    );
    expect(currentLane?.textContent).toContain("成员进展");
    expect(currentLane?.textContent).toContain(
      "推理：先检查 team runtime 的控制面状态，再决定是否等待。",
    );
    expect(siblingLane?.textContent).toContain("页面截图");
    expect(siblingLane?.textContent).toContain(
      "页面已刷新为最新状态并生成差异截图。",
    );

    const returnButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("返回主助手"),
    );
    expect(returnButton).toBeTruthy();

    act(() => {
      returnButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onReturnToParentSession).toHaveBeenCalledTimes(1);

    await expandLane(container, "child-sibling-1");

    expect(
      container.querySelector(
        '[data-testid="team-workspace-member-detail-child-sibling-1"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="team-workspace-activity-feed"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("检索结果");
    expect(container.textContent).toContain("已汇总 5 条 roadmap 差异。");
    expect(container.textContent).toContain("页面截图");
    expect(container.textContent).toContain(
      "页面已刷新为最新状态并生成差异截图。",
    );
    expect(container.textContent).toContain("等待父线程确认是否继续扩展范围。");

    const switchButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("切换"),
    );
    await clickElement(switchButton ?? null);

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
    const boardBody = container.querySelector<HTMLElement>(
      '[data-testid="team-workspace-board-body"]',
    );

    expect(embeddedShell?.className).toContain("pointer-events-auto");
    expect(embeddedShell?.className).toContain("overflow-hidden");
    expect(embeddedShell?.className).toContain("flex-col");
    expect(embeddedShell?.className).toContain("bg-transparent");
    expect(embeddedShell?.className).toContain("border-0");
    expect(embeddedShell?.className).not.toContain("backdrop-blur");
    expect(boardBody?.className).toContain("overflow-y-auto");
    expect(railList?.getAttribute("data-layout-kind")).toBe("free-canvas");
    expect(
      container.querySelector(
        '[data-testid="team-workspace-inspector-overlay"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="team-workspace-member-detail-child-1"]',
      ),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="team-workspace-member-lane-child-1"]')
        ?.getAttribute("data-expanded"),
    ).toBe("false");
    expect(
      container
        .querySelector('[data-testid="team-workspace-member-lane-child-2"]')
        ?.getAttribute("data-expanded"),
    ).toBe("false");
  });

  it("嵌入态真实 team 应在点击成员后切换卡内详情", async () => {
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
        {
          id: "child-collapse-2",
          name: "执行器",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "queued",
          latest_turn_status: "queued",
          task_summary: "整理执行步骤并准备提交方案。",
          role_hint: "executor",
        },
      ],
    });

    expect(
      container.querySelector(
        '[data-testid="team-workspace-member-detail-child-collapse-1"]',
      ),
    ).toBeFalsy();
    expect(
      container.querySelector(
        '[data-testid="team-workspace-member-detail-child-collapse-2"]',
      ),
    ).toBeFalsy();
    expect(
      container
        .querySelector(
          '[data-testid="team-workspace-member-lane-child-collapse-1"]',
        )
        ?.getAttribute("data-expanded"),
    ).toBe("false");
    expect(
      container
        .querySelector(
          '[data-testid="team-workspace-member-lane-child-collapse-2"]',
        )
        ?.getAttribute("data-expanded"),
    ).toBe("false");

    await expandLane(container, "child-collapse-1");

    expect(
      container.querySelector(
        '[data-testid="team-workspace-member-detail-child-collapse-1"]',
      ),
    ).toBeTruthy();
    expect(
      container
        .querySelector(
          '[data-testid="team-workspace-member-lane-child-collapse-1"]',
        )
        ?.getAttribute("data-expanded"),
    ).toBe("true");
    expect(
      container
        .querySelector(
          '[data-testid="team-workspace-member-lane-child-collapse-2"]',
        )
        ?.getAttribute("data-expanded"),
    ).toBe("false");

    await expandLane(container, "child-collapse-2");

    expect(
      container.querySelector(
        '[data-testid="team-workspace-member-detail-child-collapse-1"]',
      ),
    ).toBeFalsy();
    expect(
      container.querySelector(
        '[data-testid="team-workspace-member-detail-child-collapse-2"]',
      ),
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
            badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
          },
        ],
      },
      activityRefreshVersionBySessionId: {
        "child-live-1": 1,
      },
    });

    const liveSessionCard = container.querySelector<HTMLElement>(
      '[data-testid="team-workspace-member-lane-child-live-1"]',
    );

    expect(liveSessionCard?.textContent).toContain("运行中");
    expect(
      container.querySelector('[data-testid="team-workspace-canvas-toolbar"]')
        ?.textContent,
    ).toContain("处理中");
    expect(container.textContent).toContain("最近进展 处理中");
    expect(
      container.querySelector(
        '[data-testid="team-workspace-member-detail-child-live-1"]',
      ),
    ).toBeFalsy();

    await expandLane(container, "child-live-1");

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
            title: "工具 页面截图",
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
      "工具 页面截图：页面结构差异已提取完成。",
    );
    expect(container.textContent).toContain("工具 页面截图");
    expect(container.textContent).toContain("页面结构差异已提取完成。");
  });

  it("拖动角色头部后，应更新对应 lane 的画布坐标", async () => {
    const container = await renderBoard({
      currentSessionId: "parent-drag-1",
      childSubagentSessions: [
        {
          id: "child-drag-1",
          name: "拖拽代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "验证自由画布拖拽行为",
          role_hint: "explorer",
        },
      ],
    });

    const before = getLaneMetrics(container, "child-drag-1");
    const header = container.querySelector(
      '[data-testid="team-workspace-member-lane-header-child-drag-1"]',
    );
    expect(header).toBeTruthy();

    await dragMouse(header as Element, {
      start: { x: 120, y: 140 },
      end: { x: 220, y: 235 },
    });

    const after = getLaneMetrics(container, "child-drag-1");
    expect(after.x).toBe(before.x + 100);
    expect(after.y).toBe(before.y + 95);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });

  it("点击自动排布后，应将角色面板整理回规则布局并重置视口", async () => {
    const container = await renderBoard({
      currentSessionId: "parent-arrange-1",
      childSubagentSessions: [
        {
          id: "child-arrange-1",
          name: "分析代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "验证自动排布回正",
          role_hint: "explorer",
        },
        {
          id: "child-arrange-2",
          name: "执行代理",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "queued",
          latest_turn_status: "queued",
          task_summary: "验证自动排布顺序",
          role_hint: "executor",
        },
      ],
    });

    const firstBefore = getLaneMetrics(container, "child-arrange-1");
    const secondHeader = container.querySelector(
      '[data-testid="team-workspace-member-lane-header-child-arrange-2"]',
    );
    expect(secondHeader).toBeTruthy();

    await dragMouse(secondHeader as Element, {
      start: { x: 420, y: 160 },
      end: { x: 790, y: 430 },
    });

    const secondMoved = getLaneMetrics(container, "child-arrange-2");
    expect(secondMoved.y).toBeGreaterThan(firstBefore.y);

    const autoArrangeButton = container.querySelector(
      '[data-testid="team-workspace-auto-arrange-button"]',
    );
    expect(autoArrangeButton).toBeTruthy();

    act(() => {
      autoArrangeButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const firstAfter = getLaneMetrics(container, "child-arrange-1");
    const secondAfter = getLaneMetrics(container, "child-arrange-2");
    const viewportAfter = getViewportMetrics(container);

    expect(firstAfter.x).toBeGreaterThanOrEqual(64);
    expect(firstAfter.y).toBeGreaterThanOrEqual(64);
    expect(secondAfter.y).toBe(firstAfter.y);
    expect(secondAfter.x).toBeGreaterThan(firstAfter.x);
    expect(secondAfter.x).toBeLessThan(secondMoved.x);
    expect(viewportAfter.x).toBe(56);
    expect(viewportAfter.y).toBe(56);
    expect(viewportAfter.zoom).toBe(1);
  });

  it("按下 A 快捷键时，应触发自动排布；焦点在输入框时不应误触发", async () => {
    const onSendSubagentInput = vi.fn();
    const container = await renderBoard({
      currentSessionId: "parent-shortcut-arrange-1",
      childSubagentSessions: [
        {
          id: "child-shortcut-arrange-1",
          name: "分析代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "验证 A 快捷键",
          role_hint: "explorer",
        },
        {
          id: "child-shortcut-arrange-2",
          name: "执行代理",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "queued",
          latest_turn_status: "queued",
          task_summary: "验证输入态不误触发",
          role_hint: "executor",
        },
      ],
      onSendSubagentInput,
    });

    const secondHeader = container.querySelector(
      '[data-testid="team-workspace-member-lane-header-child-shortcut-arrange-2"]',
    );
    expect(secondHeader).toBeTruthy();

    await dragMouse(secondHeader as Element, {
      start: { x: 420, y: 160 },
      end: { x: 760, y: 420 },
    });

    const moved = getLaneMetrics(container, "child-shortcut-arrange-2");
    await expandLane(container, "child-shortcut-arrange-1");
    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="team-workspace-send-input-textarea"]',
    );
    expect(textarea).toBeTruthy();

    textarea?.focus();
    await pressKey(textarea as EventTarget, {
      key: "a",
      code: "KeyA",
    });

    const afterTextareaKey = getLaneMetrics(
      container,
      "child-shortcut-arrange-2",
    );
    expect(afterTextareaKey.x).toBe(moved.x);
    expect(afterTextareaKey.y).toBe(moved.y);

    await pressKey(window, {
      key: "a",
      code: "KeyA",
    });

    const arranged = getLaneMetrics(container, "child-shortcut-arrange-2");
    expect(arranged.x).toBeLessThan(moved.x);
    expect(arranged.y).toBeGreaterThanOrEqual(64);
  });

  it("按下方向键时，应平移画布视口；焦点在输入框时不应误触发", async () => {
    const onSendSubagentInput = vi.fn();
    const container = await renderBoard({
      currentSessionId: "parent-shortcut-pan-1",
      childSubagentSessions: [
        {
          id: "child-shortcut-pan-1",
          name: "分析代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "验证方向键平移",
          role_hint: "explorer",
        },
      ],
      onSendSubagentInput,
    });

    const viewportBefore = getViewportMetrics(container);
    await expandLane(container, "child-shortcut-pan-1");
    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="team-workspace-send-input-textarea"]',
    );
    expect(textarea).toBeTruthy();

    textarea?.focus();
    await pressKey(textarea as EventTarget, {
      key: "ArrowRight",
      code: "ArrowRight",
    });

    const afterTextareaKey = getViewportMetrics(container);
    expect(afterTextareaKey.x).toBe(viewportBefore.x);
    expect(afterTextareaKey.y).toBe(viewportBefore.y);

    await pressKey(window, {
      key: "ArrowRight",
      code: "ArrowRight",
    });
    await pressKey(window, {
      key: "ArrowDown",
      code: "ArrowDown",
    });

    const afterPan = getViewportMetrics(container);
    expect(afterPan.x).toBe(viewportBefore.x - 72);
    expect(afterPan.y).toBe(viewportBefore.y - 72);

    await pressKey(window, {
      key: "ArrowLeft",
      code: "ArrowLeft",
    });
    await pressKey(window, {
      key: "ArrowUp",
      code: "ArrowUp",
    });

    const afterResetPan = getViewportMetrics(container);
    expect(afterResetPan.x).toBe(viewportBefore.x);
    expect(afterResetPan.y).toBe(viewportBefore.y);
  });

  it("按下 Shift + 方向键时，应使用更大步长平移画布", async () => {
    const container = await renderBoard({
      currentSessionId: "parent-shortcut-fast-pan-1",
      childSubagentSessions: [
        {
          id: "child-shortcut-fast-pan-1",
          name: "分析代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "验证 Shift 方向键快移",
          role_hint: "explorer",
        },
      ],
    });

    const viewportBefore = getViewportMetrics(container);

    await pressKey(window, {
      key: "ArrowRight",
      code: "ArrowRight",
      shiftKey: true,
    });
    await pressKey(window, {
      key: "ArrowDown",
      code: "ArrowDown",
      shiftKey: true,
    });

    const afterFastPan = getViewportMetrics(container);
    expect(afterFastPan.x).toBe(viewportBefore.x - 216);
    expect(afterFastPan.y).toBe(viewportBefore.y - 216);
  });

  it("自由画布应隐藏 minimap 入口，避免占用主视图", async () => {
    const container = await renderBoard({
      currentSessionId: "parent-minimap-1",
      childSubagentSessions: [
        {
          id: "child-minimap-1",
          name: "分析代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "验证 minimap 定位能力",
          role_hint: "explorer",
        },
        {
          id: "child-minimap-2",
          name: "执行代理",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "queued",
          latest_turn_status: "queued",
          task_summary: "验证 minimap 可见区域框",
          role_hint: "executor",
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="team-workspace-minimap"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="team-workspace-toggle-minimap"]'),
    ).toBeNull();
  });

  it("按住 Space 时应进入画布拖拽模式，并允许直接拖动画布视口", async () => {
    const container = await renderBoard({
      currentSessionId: "parent-space-pan-1",
      childSubagentSessions: [
        {
          id: "child-space-pan-1",
          name: "分析代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "验证 Space 拖动画布",
          role_hint: "explorer",
        },
      ],
    });

    const laneBefore = getLaneMetrics(container, "child-space-pan-1");
    const viewportBefore = getViewportMetrics(container);
    const laneElement = container.querySelector(
      '[data-testid="team-workspace-member-lane-child-space-pan-1"]',
    );
    expect(laneElement).toBeTruthy();

    await pressKey(window, {
      key: " ",
      code: "Space",
    });

    const viewportInPanMode = container.querySelector<HTMLElement>(
      '[data-testid="team-workspace-rail-list"]',
    );
    expect(viewportInPanMode?.getAttribute("data-pan-mode")).toBe("active");

    await dragMouse(laneElement as Element, {
      start: { x: 180, y: 180 },
      end: { x: 250, y: 235 },
    });

    const laneAfter = getLaneMetrics(container, "child-space-pan-1");
    const viewportAfter = getViewportMetrics(container);

    expect(laneAfter.x).toBe(laneBefore.x);
    expect(laneAfter.y).toBe(laneBefore.y);
    expect(viewportAfter.x).toBe(viewportBefore.x + 70);
    expect(viewportAfter.y).toBe(viewportBefore.y + 55);

    await pressKey(window, {
      key: " ",
      code: "Space",
      type: "keyup",
    });

    expect(viewportInPanMode?.getAttribute("data-pan-mode")).toBe("idle");
  });

  it("空白画布区域应支持直接拖动画布视口，无需先按住 Space", async () => {
    const container = await renderBoard({
      currentSessionId: "parent-manual-pan-1",
      childSubagentSessions: [
        {
          id: "child-manual-pan-1",
          name: "分析代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "验证手动拖动画布",
          role_hint: "explorer",
        },
      ],
    });

    const laneBefore = getLaneMetrics(container, "child-manual-pan-1");
    const viewportBefore = getViewportMetrics(container);
    const panSurface = container.querySelector(
      '[data-testid="team-workspace-canvas-pan-surface"]',
    );
    expect(panSurface).toBeTruthy();

    await dragMouse(panSurface as Element, {
      start: { x: 220, y: 220 },
      end: { x: 290, y: 268 },
    });

    const laneAfter = getLaneMetrics(container, "child-manual-pan-1");
    const viewportAfter = getViewportMetrics(container);

    expect(laneAfter.x).toBe(laneBefore.x);
    expect(laneAfter.y).toBe(laneBefore.y);
    expect(viewportAfter.x).toBe(viewportBefore.x + 70);
    expect(viewportAfter.y).toBe(viewportBefore.y + 48);
  });

  it("拖动 resize handle 后，应更新对应 lane 的宽高", async () => {
    const container = await renderBoard({
      currentSessionId: "parent-resize-1",
      childSubagentSessions: [
        {
          id: "child-resize-1",
          name: "缩放代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "验证自由画布改尺寸行为",
          role_hint: "executor",
        },
      ],
    });

    const before = getLaneMetrics(container, "child-resize-1");
    const resizeHandle = container.querySelector(
      '[data-testid="team-workspace-member-lane-resize-child-resize-1-se"]',
    );
    expect(resizeHandle).toBeTruthy();

    await dragMouse(resizeHandle as Element, {
      start: { x: 380, y: 280 },
      end: { x: 455, y: 340 },
    });

    const after = getLaneMetrics(container, "child-resize-1");
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width + 75);
    expect(after.height).toBe(before.height + 60);
  });

  it("同一会话重新挂载后，应恢复上次保存的 lane 布局", async () => {
    const boardProps: Partial<React.ComponentProps<typeof TeamWorkspaceBoard>> =
      {
        currentSessionId: "parent-persist-1",
        childSubagentSessions: [
          {
            id: "child-persist-1",
            name: "持久化代理",
            created_at: 1_710_000_000,
            updated_at: 1_710_000_100,
            session_type: "sub_agent",
            runtime_status: "running",
            latest_turn_status: "running",
            task_summary: "验证会话级画布持久化",
            role_hint: "reviewer",
          },
        ],
      };

    const firstContainer = await renderBoard(boardProps);
    const firstHeader = firstContainer.querySelector(
      '[data-testid="team-workspace-member-lane-header-child-persist-1"]',
    );
    expect(firstHeader).toBeTruthy();

    await dragMouse(firstHeader as Element, {
      start: { x: 130, y: 150 },
      end: { x: 290, y: 260 },
    });

    const moved = getLaneMetrics(firstContainer, "child-persist-1");
    await unmountBoard(firstContainer);

    const secondContainer = await renderBoard(boardProps);
    const restored = getLaneMetrics(secondContainer, "child-persist-1");

    expect(restored.x).toBe(moved.x);
    expect(restored.y).toBe(moved.y);
    expect(restored.width).toBe(moved.width);
    expect(restored.height).toBe(moved.height);
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

    await expandLane(container, "child-close-1");

    expect(
      container.querySelector(
        '[data-testid="team-workspace-member-detail-child-close-1"]',
      ),
    ).toBeTruthy();

    const closeButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("暂停处理"),
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

    await expandLane(container, "child-resume-1");

    const resumeButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("继续处理"),
    );
    expect(resumeButton).toBeTruthy();
    expect(
      container.querySelector(
        '[data-testid="team-workspace-member-detail-child-resume-1"]',
      ),
    ).toBeTruthy();

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

    await expandLane(container, "child-wait-1");

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

    expect(container.textContent).toContain("等待任一成员结果");
    expect(container.textContent).toContain("2 位处理中");

    const waitAnyButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("等待任一成员结果"),
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
    expect(operations?.className).toContain("overflow-x-auto");
    expect(operations?.textContent).toContain("收到结果");
    expect(operations?.textContent).toContain("刚才等到 执行器 返回了新结果");
    expect(operations?.textContent).toContain("当前状态为已完成");
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
    expect(operations?.textContent).toContain("暂停处理");
    expect(operations?.textContent).toContain("刚才已暂停 2 位协作成员的处理");
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
      (element) => element.textContent?.includes("暂停处理"),
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

    expect(container.textContent).toContain("收起已完成成员");
    expect(container.textContent).toContain("2 位已完成");

    const closeCompletedButton = Array.from(
      container.querySelectorAll("button"),
    ).find((element) => element.textContent?.includes("收起已完成成员"));
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

  it("选中其他子代理时应支持 SendMessage 与 interrupt SendMessage", async () => {
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

    await expandLane(container, "child-send-1");

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
      (element) => element.textContent?.includes("发送说明"),
    );
    const interruptButton = Array.from(
      container.querySelectorAll("button"),
    ).find((element) => element.textContent?.includes("立即插入说明"));
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
      interruptButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
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
      teamDispatchPreviewState: {
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

    expect(container.textContent).toContain("正在准备协作分工");
    expect(container.textContent).toContain("准备中");
    expect(container.textContent).toContain("协作方案 · 排障 Team");
    expect(container.textContent).toContain("参考方案 · 代码排障团队");
  });

  it("本轮协作方案已就绪时，应在无真实子会话下展示当前成员", async () => {
    const container = await renderBoard({
      shellVisible: true,
      defaultShellExpanded: true,
      teamDispatchPreviewState: {
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
      container.querySelector(
        '[data-testid="team-workspace-runtime-formation"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="team-workspace-runtime-members"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("协作分工已准备好");
    expect(container.textContent).toContain("分析");
    expect(container.textContent).toContain("执行");
    expect(container.textContent).toContain("参考分工");
  });

  it("本轮 Team 准备失败时，应展示失败原因", async () => {
    const container = await renderBoard({
      shellVisible: true,
      defaultShellExpanded: true,
      teamDispatchPreviewState: {
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

    expect(container.textContent).toContain("协作准备失败");
    expect(container.textContent).toContain(
      "Provider 认证失败，无法生成 Team。",
    );
  });
});
