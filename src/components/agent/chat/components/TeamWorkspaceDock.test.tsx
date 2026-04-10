import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AsterSessionDetail } from "@/lib/api/agentRuntime";
import { TeamWorkspaceDock } from "./TeamWorkspaceDock";

const { mockGetAgentRuntimeSession } = vi.hoisted(() => ({
  mockGetAgentRuntimeSession: vi.fn(),
}));
const { mockSafeInvoke, mockSafeListen, mockParseAgentEvent } = vi.hoisted(() => ({
  mockSafeInvoke: vi.fn(),
  mockSafeListen: vi.fn(),
  mockParseAgentEvent: vi.fn((payload: unknown) => payload),
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

vi.mock("@/lib/api/agentProtocol", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/agentProtocol")
  >("@/lib/api/agentProtocol");
  return {
    ...actual,
    parseAgentEvent: mockParseAgentEvent,
  };
});

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: mockSafeInvoke,
  safeListen: mockSafeListen,
}));

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
  mockSafeInvoke.mockResolvedValue(undefined);
  mockSafeListen.mockResolvedValue(() => {});
  mockParseAgentEvent.mockImplementation((payload: unknown) => payload);
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

async function flushDockEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderDock(
  props?: Partial<React.ComponentProps<typeof TeamWorkspaceDock>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof TeamWorkspaceDock> = {
    shellVisible: true,
    currentSessionId: "parent-1",
    currentSessionName: "主线程",
    childSubagentSessions: [],
  };

  const render = async (
    nextProps?: Partial<React.ComponentProps<typeof TeamWorkspaceDock>>,
  ) => {
    await act(async () => {
      root.render(
        <TeamWorkspaceDock {...defaultProps} {...props} {...nextProps} />,
      );
      await Promise.resolve();
    });
    await flushDockEffects();
  };

  await render();
  mountedRoots.push({ root, container });
  return { container, render };
}

describe("TeamWorkspaceDock", () => {
  it("空 team shell 点击外层浮钮后，应直接展开详情面板", async () => {
    const { container } = await renderDock({
      selectedTeamLabel: "前端联调团队",
      selectedTeamSummary: "分析、实现、验证三段式推进。",
      selectedTeamRoles: [
        {
          id: "explorer",
          label: "分析",
          summary: "负责定位问题与影响范围。",
        },
      ],
    });

    expect(container.textContent).toContain("创作协作");

    const toggleButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="team-workspace-dock-toggle"]',
    );
    expect(toggleButton).toBeTruthy();

    act(() => {
      toggleButton?.click();
    });

    expect(document.body.textContent).toContain("等待协作成员加入");
    expect(document.body.textContent).toContain("协作方案");
    expect(document.body.textContent).toContain("不遮挡画布");
    expect(document.body.textContent).toContain("当前协作方案：前端联调团队");
    expect(document.body.textContent).toContain("分析、实现、验证三段式推进。");
    expect(document.body.textContent).not.toContain("查看详情");
    expect(
      document.body.querySelector('[data-testid="team-workspace-empty-card"]'),
    ).toBeTruthy();
    expect(
      document.body.querySelector(
        '[data-testid="team-workspace-selected-team"]',
      ),
    ).toBeTruthy();
  });

  it("空态工作台应支持展开当前协作方案的详情", async () => {
    const { container } = await renderDock({
      selectedTeamLabel: "前端联调团队",
      selectedTeamSummary: "分析、实现、验证三段式推进。",
      selectedTeamRoles: [
        {
          id: "explorer",
          label: "分析",
          summary: "负责定位问题与影响范围。",
        },
        {
          id: "executor",
          label: "执行",
          summary: "负责落地改动与结果说明。",
        },
      ],
    });

    const toggleButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="team-workspace-dock-toggle"]',
    );
    expect(toggleButton).toBeTruthy();

    act(() => {
      toggleButton?.click();
    });

    const detailToggle = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="team-workspace-selected-team-toggle"]',
    );
    expect(detailToggle).toBeTruthy();

    act(() => {
      detailToggle?.click();
    });

    expect(
      document.body.querySelector(
        '[data-testid="team-workspace-selected-team-detail"]',
      ),
    ).toBeTruthy();
    expect(document.body.textContent).toContain("负责定位问题与影响范围");
    expect(document.body.textContent).toContain("负责落地改动与结果说明");
  });

  it("真实子代理从空态出现时，应自动展开协作面板", async () => {
    const { container, render } = await renderDock();

    expect(
      container.querySelector('[data-testid="team-workspace-dock-panel"]'),
    ).toBeNull();

    await render({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          task_summary: "整理竞品与数据来源",
          role_hint: "explorer",
        },
      ],
    });

    expect(
      document.body.querySelector('[data-testid="team-workspace-dock-panel"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("收起协作面板");
    expect(document.body.textContent).toContain("研究员");
  });

  it("仅处于协作准备中时，不应自动展开面板，但应显示提醒", async () => {
    const { container } = await renderDock({
      teamDispatchPreviewState: {
        requestId: "runtime-forming-1",
        status: "forming",
        label: "修复 Team",
        summary: "正在根据任务准备协作成员。",
        members: [],
        blueprint: {
          label: "代码排障团队",
          summary: "分析、执行、验证三段式推进。",
          roles: [],
        },
        updatedAt: Date.now(),
      },
    });

    expect(
      document.body.querySelector('[data-testid="team-workspace-dock-panel"]'),
    ).toBeNull();
    expect(container.textContent).toContain("查看任务进展 · 准备中");
    expect(
      container.querySelector('[data-testid="team-workspace-dock-signal"]'),
    ).toBeTruthy();
  });

  it("协作方案已就绪但真实成员未出现时，不应自动展开面板", async () => {
    const { container } = await renderDock({
      teamDispatchPreviewState: {
        requestId: "runtime-formed-2",
        status: "formed",
        label: "修复 Team",
        summary: "分析、执行、验证协作闭环。",
        members: [
          {
            id: "runtime-explorer",
            label: "分析",
            summary: "负责定位问题边界。",
            roleKey: "explorer",
            profileId: "code-explorer",
            skillIds: ["repo-exploration"],
            status: "planned",
          },
        ],
        blueprint: {
          label: "代码排障团队",
          summary: "分析、执行、验证三段式推进。",
          roles: [],
        },
        updatedAt: Date.now(),
      },
    });

    expect(
      document.body.querySelector('[data-testid="team-workspace-dock-panel"]'),
    ).toBeNull();
    expect(container.textContent).toContain("查看任务进展 · 1");
    expect(
      container.querySelector('[data-testid="team-workspace-dock-signal"]'),
    ).toBeTruthy();
  });

  it("协作准备失败时，不应自动展开面板，但应保留提醒入口", async () => {
    const { container } = await renderDock({
      teamDispatchPreviewState: {
        requestId: "runtime-failed-1",
        status: "failed",
        label: "修复 Team",
        summary: "分析、执行、验证协作闭环。",
        members: [],
        blueprint: {
          label: "代码排障团队",
          summary: "分析、执行、验证三段式推进。",
          roles: [],
        },
        errorMessage: "Team 生成失败",
        updatedAt: Date.now(),
      },
    });

    expect(
      document.body.querySelector('[data-testid="team-workspace-dock-panel"]'),
    ).toBeNull();
    expect(container.textContent).toContain("查看任务进展 · 失败");
    expect(
      container.querySelector('[data-testid="team-workspace-dock-signal"]'),
    ).toBeTruthy();
  });

  it("launcherOnly 模式应显示轻量胶囊入口，并触发画布激活", async () => {
    const onActivateWorkbench = vi.fn();
    const { container } = await renderDock({
      placement: "inline",
      onActivateWorkbench,
      teamDispatchPreviewState: {
        requestId: "runtime-formed-launcher-1",
        status: "formed",
        label: "修复 Team",
        summary: "分析、执行、验证协作闭环。",
        members: [
          {
            id: "runtime-explorer",
            label: "分析",
            summary: "负责定位问题边界。",
            roleKey: "explorer",
            profileId: "code-explorer",
            skillIds: ["repo-exploration"],
            status: "running",
          },
        ],
        blueprint: {
          label: "代码排障团队",
          summary: "分析、执行、验证三段式推进。",
          roles: [],
        },
        updatedAt: Date.now(),
      },
      childSubagentSessions: [
        {
          id: "child-1",
          name: "分析",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          task_summary: "定位问题边界",
          role_hint: "explorer",
        },
      ],
    });

    const toggleButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="team-workspace-dock-toggle"]',
    );

    expect(toggleButton).toBeTruthy();
    expect(toggleButton?.textContent).toContain("修复 Team");
    expect(toggleButton?.textContent).toContain("1 位处理中");
    expect(toggleButton?.textContent).not.toContain("查看任务进展");

    act(() => {
      toggleButton?.click();
    });

    expect(onActivateWorkbench).toHaveBeenCalledTimes(1);
    expect(
      document.body.querySelector('[data-testid="team-workspace-dock-panel"]'),
    ).toBeNull();
  });

  it("真实 team 图谱折叠时，应显示查看入口和动态提示", async () => {
    const { container } = await renderDock({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          task_summary: "整理竞品与数据来源",
          role_hint: "explorer",
        },
      ],
    });

    const toggleButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="team-workspace-dock-toggle"]',
    );

    expect(toggleButton?.textContent).toContain("查看任务进展 · 1");
    expect(
      container.querySelector('[data-testid="team-workspace-dock-signal"]'),
    ).toBeTruthy();
    expect(
      getComputedStyle(
        container.querySelector(
          '[data-testid="team-workspace-dock"]',
        ) as HTMLElement,
      ).zIndex,
    ).toBe("18");
  });

  it("inline 模式应作为输入区并排控件渲染，展开面板向上浮出而不占位", async () => {
    const { container, render } = await renderDock({
      placement: "inline",
    });

    await render({
      placement: "inline",
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          task_summary: "整理竞品与数据来源",
          role_hint: "explorer",
        },
      ],
    });

    const dock = container.querySelector<HTMLElement>(
      '[data-testid="team-workspace-dock"]',
    );
    const panelInContainer = container.querySelector<HTMLElement>(
      '[data-testid="team-workspace-dock-panel"]',
    );
    const panelInBody = document.body.querySelector<HTMLElement>(
      '[data-testid="team-workspace-dock-panel"]',
    );

    expect(dock).toBeTruthy();
    expect(panelInContainer).toBeNull();
    expect(panelInBody).toBeTruthy();
    expect(getComputedStyle(dock as HTMLElement).position).toBe("relative");
    expect(getComputedStyle(dock as HTMLElement).zIndex).toBe("120");
    expect(getComputedStyle(panelInBody as HTMLElement).position).toBe("fixed");
    expect(getComputedStyle(panelInBody as HTMLElement).zIndex).toBe("10010");
  });

  it("用户手动收起后，同一轮不应再次自动展开", async () => {
    const { container, render } = await renderDock({
      placement: "inline",
    });

    await render({
      placement: "inline",
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          task_summary: "整理竞品与数据来源",
          role_hint: "explorer",
        },
      ],
    });

    const toggleButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="team-workspace-dock-toggle"]',
    );
    expect(toggleButton?.textContent).toContain("收起协作面板");

    act(() => {
      toggleButton?.click();
    });

    expect(
      document.body.querySelector('[data-testid="team-workspace-dock-panel"]'),
    ).toBeNull();

    await render({
      placement: "inline",
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          task_summary: "整理竞品与数据来源",
          role_hint: "explorer",
        },
        {
          id: "child-2",
          name: "执行者",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "running",
          task_summary: "提交修复方案",
          role_hint: "executor",
        },
      ],
    });

    expect(
      document.body.querySelector('[data-testid="team-workspace-dock-panel"]'),
    ).toBeNull();
    expect(toggleButton?.textContent).toContain("查看任务进展 · 2");
  });

  it("切换会话后，新的真实成员出现应再次自动展开", async () => {
    const { container, render } = await renderDock({
      placement: "inline",
    });

    await render({
      placement: "inline",
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          task_summary: "整理竞品与数据来源",
          role_hint: "explorer",
        },
      ],
    });

    const toggleButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="team-workspace-dock-toggle"]',
    );

    act(() => {
      toggleButton?.click();
    });

    await render({
      placement: "inline",
      currentSessionId: "parent-2",
      childSubagentSessions: [],
    });

    expect(
      document.body.querySelector('[data-testid="team-workspace-dock-panel"]'),
    ).toBeNull();

    await render({
      placement: "inline",
      currentSessionId: "parent-2",
      childSubagentSessions: [
        {
          id: "child-2",
          name: "执行者",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "running",
          task_summary: "提交修复方案",
          role_hint: "executor",
        },
      ],
    });

    expect(
      document.body.querySelector('[data-testid="team-workspace-dock-panel"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("收起协作面板");
  });

  it("旧会话初次挂载时即使已有真实成员，也不应自动展开", async () => {
    const { container } = await renderDock({
      placement: "inline",
      currentSessionId: "parent-history",
      childSubagentSessions: [
        {
          id: "child-history-1",
          name: "研究员",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          task_summary: "整理历史任务结论",
          role_hint: "explorer",
        },
      ],
    });

    expect(
      document.body.querySelector('[data-testid="team-workspace-dock-panel"]'),
    ).toBeNull();
    expect(container.textContent).toContain("查看任务进展 · 1");
  });

  it("已有真实成员的 Dock 切到 inline 时，不应因为布局变化自动展开", async () => {
    const { container, render } = await renderDock({
      placement: "floating",
      childSubagentSessions: [
        {
          id: "child-layout-1",
          name: "执行者",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          task_summary: "继续执行历史任务",
          role_hint: "executor",
        },
      ],
    });

    expect(
      document.body.querySelector('[data-testid="team-workspace-dock-panel"]'),
    ).toBeNull();

    await render({
      placement: "inline",
      childSubagentSessions: [
        {
          id: "child-layout-1",
          name: "执行者",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "running",
          task_summary: "继续执行历史任务",
          role_hint: "executor",
        },
      ],
    });

    expect(
      document.body.querySelector('[data-testid="team-workspace-dock-panel"]'),
    ).toBeNull();
    expect(container.textContent).toContain("查看任务进展 · 1");
  });

  it("本轮协作方案已就绪时，应在空态 Dock 展示成员摘要", async () => {
    const { container } = await renderDock({
      teamDispatchPreviewState: {
        requestId: "runtime-formed-1",
        status: "formed",
        label: "修复 Team",
        summary: "分析、执行、验证协作闭环。",
        members: [
          {
            id: "runtime-explorer",
            label: "分析",
            summary: "负责定位问题边界。",
            roleKey: "explorer",
            profileId: "code-explorer",
            skillIds: ["repo-exploration"],
            status: "planned",
          },
        ],
        blueprint: {
          label: "代码排障团队",
          summary: "分析、执行、验证三段式推进。",
          roles: [],
        },
        updatedAt: Date.now(),
      },
    });

    const toggleButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="team-workspace-dock-toggle"]',
    );
    expect(toggleButton?.textContent).toContain("查看任务进展 · 1");

    act(() => {
      toggleButton?.click();
    });

    const detailToggle = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="team-workspace-selected-team-toggle"]',
    );
    expect(detailToggle).toBeTruthy();

    act(() => {
      detailToggle?.click();
    });

    expect(document.body.textContent).toContain("协作分工已准备好");
    expect(document.body.textContent).toContain("修复 Team");
    expect(document.body.textContent).toContain("分析");
  });
});
