import { describe, expect, it } from "vitest";
import type { TeamWorkbenchSurfaceProps } from "./chatSurfaceProps";
import { buildCanvasTeamWorkbenchView } from "./useWorkspaceCanvasSceneRuntime";

function createSurfaceProps(
  overrides: Partial<TeamWorkbenchSurfaceProps> = {},
): TeamWorkbenchSurfaceProps {
  return {
    currentSessionQueuedTurnCount: 0,
    childSubagentSessions: [],
    selectedTeamRoles: [],
    liveRuntimeBySessionId: {},
    ...overrides,
  };
}

function buildView(
  overrides: Partial<Parameters<typeof buildCanvasTeamWorkbenchView>[0]> = {},
) {
  return buildCanvasTeamWorkbenchView({
    enabled: true,
    surfaceProps: createSurfaceProps(),
    liveActivityBySessionId: {},
    teamWaitSummary: null,
    teamControlSummary: null,
    renderTeamWorkbenchPreview: () => null,
    renderTeamWorkbenchPanel: () => null,
    ...overrides,
  });
}

describe("buildCanvasTeamWorkbenchView", () => {
  it("应为 workbench 摘要统计产出任务叙事", () => {
    const view = buildView({
      surfaceProps: createSurfaceProps({
        childSubagentSessions: [
          {
            id: "task-1",
            name: "分析",
            created_at: 1_710_000_000,
            updated_at: 1_710_000_100,
            session_type: "sub_agent",
            runtime_status: "running",
            latest_turn_status: "running",
            task_summary: "收敛问题边界",
            role_hint: "explorer",
          },
          {
            id: "task-2",
            name: "执行",
            created_at: 1_710_000_010,
            updated_at: 1_710_000_120,
            session_type: "sub_agent",
            runtime_status: "running",
            latest_turn_status: "running",
            task_summary: "落地修复",
            role_hint: "executor",
          },
          {
            id: "task-3",
            name: "复核",
            created_at: 1_710_000_020,
            updated_at: 1_710_000_140,
            session_type: "sub_agent",
            runtime_status: "queued",
            latest_turn_status: "queued",
            task_summary: "等待接手",
            role_hint: "reviewer",
          },
        ],
      }),
    });

    expect(view).not.toBeNull();
    if (!view) {
      throw new Error("teamWorkbenchView 不应为空");
    }

    expect(view.subtitle).toBe(
      "主对话保留调度记录，画布按任务分别展示执行过程与结果。",
    );
    expect(view.summaryStats?.[0]).toMatchObject({
      key: "team-status",
      label: "任务状态",
      detail: "任务进行中 · 2 项处理中 / 1 项稍后开始",
    });
    expect(view.summaryStats?.[1]).toMatchObject({
      key: "team-members",
      label: "活跃任务",
      value: "3/3",
      detail: "2 项处理中，1 项排队中。",
    });
  });

  it("等待摘要应提示检查任务状态", () => {
    const view = buildView({
      teamWaitSummary: {
        awaitedSessionIds: ["task-1", "task-2"],
        timedOut: true,
        updatedAt: 1_710_000_100_000,
      },
    });

    expect(view).not.toBeNull();
    if (!view) {
      throw new Error("teamWorkbenchView 不应为空");
    }

    expect(view.summaryStats?.[0]).toMatchObject({
      label: "任务状态",
      detail: "当前没有活跃的任务执行。",
    });
    expect(view.summaryStats?.[1]).toMatchObject({
      label: "活跃任务",
      detail: "当前还没有可展示的任务。",
    });
    expect(view.summaryStats?.[2]).toMatchObject({
      label: "等待确认",
      value: "2 项",
      detail: "等待结果超时，建议重新检查任务状态。",
    });
    expect(view.panelCopy?.emptyText).toBe("当前没有可展示的任务工作台。");
  });
});
