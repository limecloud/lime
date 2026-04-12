import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TeamWorkbenchSummaryPanel } from "./TeamWorkbenchSummaryPanel";

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
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

function renderPanel(
  props: Partial<Parameters<typeof TeamWorkbenchSummaryPanel>[0]> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <TeamWorkbenchSummaryPanel
        currentSessionQueuedTurnCount={0}
        childSubagentSessions={[]}
        selectedTeamRoles={[]}
        liveRuntimeBySessionId={{}}
        liveActivityBySessionId={{}}
        {...props}
      />,
    );
  });

  mountedRoots.push({ container, root });
  return container;
}

describe("TeamWorkbenchSummaryPanel", () => {
  it("应在主视图中展示 Team 记忆影子卡片", () => {
    const container = renderPanel({
      selectedTeamLabel: "研究双人组",
      selectedTeamSummary: "分析、实现、验证三段式推进。",
      teamMemorySnapshot: {
        repoScope: "/workspace/lime",
        entries: {
          "team.selection": {
            key: "team.selection",
            content: "Team：研究双人组\n角色：\n- 研究员：梳理上下文",
            updatedAt: 100,
          },
        },
      },
    });

    expect(container.textContent).toContain("任务工作台");
    expect(container.textContent).toContain("任务记忆影子");
    expect(container.textContent).toContain("/workspace/lime");
    expect(container.textContent).toContain("当前任务方案");
    expect(container.textContent).toContain("研究双人组");
  });

  it("任务分工已就绪时应展示当前任务视角", () => {
    const container = renderPanel({
      teamDispatchPreviewState: {
        requestId: "runtime-formed-1",
        status: "formed",
        label: "修复 Team",
        summary: "分析、执行、验证三段式推进。",
        members: [
          {
            id: "task-1",
            label: "分析",
            summary: "收敛问题边界。",
            roleKey: "explorer",
            profileId: "code-explorer",
            skillIds: ["repo-exploration"],
            status: "planned",
          },
          {
            id: "task-2",
            label: "执行",
            summary: "落地修复并回传结果。",
            roleKey: "executor",
            profileId: "code-executor",
            skillIds: ["bounded-implementation"],
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

    expect(container.textContent).toContain("任务分工已准备好");
    expect(container.textContent).toContain("当前任务分工");
    expect(container.textContent).toContain(
      "当前任务方案已就绪。任务拆出后，这里会从方案视图过渡到任务视图。",
    );
    expect(container.textContent).toContain("参考方案：代码排障团队");
  });

  it("最近动态应使用任务叙事", () => {
    const container = renderPanel({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "分析",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_100,
          session_type: "sub_agent",
          runtime_status: "completed",
          latest_turn_status: "completed",
          task_summary: "已整理问题边界",
        },
        {
          id: "child-2",
          name: "执行",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_120,
          session_type: "sub_agent",
          runtime_status: "completed",
          latest_turn_status: "completed",
          task_summary: "已完成修复",
        },
      ],
      teamControlSummary: {
        action: "close_completed",
        requestedSessionIds: ["child-1", "child-2"],
        cascadeSessionIds: [],
        affectedSessionIds: ["child-1", "child-2"],
        updatedAt: Date.now(),
      },
    });

    expect(container.textContent).toContain("最近动态");
    expect(container.textContent).toContain(
      "最近一次收尾操作收起了 2 项已完成任务。",
    );
    expect(container.textContent).toContain("任务轨道");
  });
});
