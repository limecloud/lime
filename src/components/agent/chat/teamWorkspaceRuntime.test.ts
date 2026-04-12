import { describe, expect, it } from "vitest";

import { summarizeTeamWorkspaceExecution } from "./teamWorkspaceRuntime";

describe("summarizeTeamWorkspaceExecution", () => {
  it("主线程流结束后，只要 live team 仍在运行就应保持活跃", () => {
    const summary = summarizeTeamWorkspaceExecution({
      currentSessionId: "parent-1",
      currentSessionRuntimeStatus: "completed",
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1,
          updated_at: 2,
          session_type: "sub_agent",
          runtime_status: "completed",
          latest_turn_status: "completed",
        },
      ],
      liveRuntimeBySessionId: {
        "child-1": {
          runtimeStatus: "running",
          latestTurnStatus: "running",
          baseFingerprint: "child-1:2:completed:completed:0",
        },
      },
    });

    expect(summary.hasActiveRuntime).toBe(true);
    expect(summary.runningSessionCount).toBe(1);
    expect(summary.statusTitle).toContain("任务进行中");
  });

  it("某个子代理失败但仍有其他子代理运行时，不应提前收敛", () => {
    const summary = summarizeTeamWorkspaceExecution({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1,
          updated_at: 2,
          session_type: "sub_agent",
          runtime_status: "failed",
          latest_turn_status: "failed",
        },
        {
          id: "child-2",
          name: "执行者",
          created_at: 3,
          updated_at: 4,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
        },
      ],
    });

    expect(summary.hasActiveRuntime).toBe(true);
    expect(summary.activeSessionCount).toBe(1);
    expect(summary.runningSessionCount).toBe(1);
    expect(summary.statusTitle).toContain("任务进行中");
  });

  it("所有 team 会话进入终态后，应返回非活跃状态", () => {
    const summary = summarizeTeamWorkspaceExecution({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究员",
          created_at: 1,
          updated_at: 2,
          session_type: "sub_agent",
          runtime_status: "completed",
          latest_turn_status: "completed",
        },
        {
          id: "child-2",
          name: "执行者",
          created_at: 3,
          updated_at: 4,
          session_type: "sub_agent",
          runtime_status: "failed",
          latest_turn_status: "failed",
        },
      ],
    });

    expect(summary.hasActiveRuntime).toBe(false);
    expect(summary.activeSessionCount).toBe(0);
    expect(summary.statusTitle).toBeNull();
  });
});
