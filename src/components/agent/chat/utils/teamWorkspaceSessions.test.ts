import { describe, expect, it } from "vitest";
import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import type { TeamWorkspaceRuntimeFormationState } from "../teamWorkspaceRuntime";
import {
  buildCurrentChildSession,
  buildFallbackSummary,
  buildTeamWorkspaceMemberCanvasSessions,
  buildTeamWorkspaceRailSessions,
  buildVisibleTeamSessionCards,
  dedupeSessions,
  formatUpdatedAt,
  orderSessionsByRuntimeRoles,
  resolveExpandedTeamWorkspaceSessionId,
  resolveStatusMeta,
  resolveTeamWorkspaceSelectedSessionId,
  type TeamSessionCard,
} from "./teamWorkspaceSessions";

function createSessionCard(
  overrides: Partial<TeamSessionCard> & Pick<TeamSessionCard, "id" | "name">,
): TeamSessionCard {
  return {
    ...overrides,
  };
}

function createSubagentSessionInfo(
  overrides: Partial<AsterSubagentSessionInfo> &
    Pick<AsterSubagentSessionInfo, "id" | "name">,
): AsterSubagentSessionInfo {
  return {
    created_at: overrides.created_at ?? 1,
    updated_at: overrides.updated_at ?? 2,
    session_type: overrides.session_type ?? "sub_agent",
    ...overrides,
  };
}

describe("teamWorkspaceSessions", () => {
  it("应构建当前子成员会话卡片", () => {
    const parentContext = {
      task_summary: "整理调研结论",
      role_hint: "researcher",
      origin_tool: "TeamCreate",
      created_from_turn_id: "turn-1",
      blueprint_role_id: "role-research",
      blueprint_role_label: "研究",
      profile_id: "profile-research",
      profile_name: "研究员",
      parent_session_id: "parent-session",
      parent_session_name: "主助手",
      role_key: "researcher",
      team_preset_id: "preset-1",
      theme: "general",
      output_contract: "markdown",
      skill_ids: ["research"],
      skills: [],
    } as unknown as AsterSubagentParentContext;

    expect(
      buildCurrentChildSession(
        "session-child",
        "研究成员",
        "running",
        "queued",
        2,
        parentContext,
      ),
    ).toMatchObject({
      id: "session-child",
      name: "研究成员",
      runtimeStatus: "running",
      latestTurnStatus: "queued",
      queuedTurnCount: 2,
      taskSummary: "整理调研结论",
      profileName: "研究员",
      isCurrent: true,
    });
  });

  it("应去重并忽略空会话", () => {
    const first = createSessionCard({ id: "s-1", name: "成员 1" });
    const duplicated = createSessionCard({ id: "s-1", name: "成员 1 重复" });
    const second = createSessionCard({ id: "s-2", name: "成员 2" });

    expect(
      dedupeSessions([first, null, duplicated, second, undefined]),
    ).toEqual([first, second]);
  });

  it("应把 API 会话映射为 Team 会话卡片", () => {
    expect(
      buildVisibleTeamSessionCards([
        createSubagentSessionInfo({
          id: "session-1",
          name: "执行成员",
          runtime_status: "running",
          latest_turn_status: "queued",
          queued_turn_count: 2,
          team_phase: "running",
        }),
      ]),
    ).toMatchObject([
      {
        id: "session-1",
        name: "执行成员",
        runtimeStatus: "running",
        latestTurnStatus: "queued",
        queuedTurnCount: 2,
        teamPhase: "running",
      },
    ]);
  });

  it("应按 runtime 角色顺序排列成员会话", () => {
    const formationState = {
      requestId: "dispatch-1",
      status: "formed",
      members: [],
      blueprint: {
        roles: [
          {
            id: "role-plan",
            label: "规划",
            summary: "负责拆解方案",
            profileId: "profile-plan",
            roleKey: "planner",
          },
          {
            id: "role-exec",
            label: "执行",
            summary: "负责落地实现",
            profileId: "profile-exec",
            roleKey: "executor",
          },
        ],
      },
      updatedAt: 1,
    } as TeamWorkspaceRuntimeFormationState;

    const planner = createSessionCard({
      id: "session-plan",
      name: "规划成员",
      blueprintRoleLabel: "规划",
    });
    const executor = createSessionCard({
      id: "session-exec",
      name: "执行成员",
      roleKey: "executor",
    });

    expect(
      orderSessionsByRuntimeRoles([executor, planner], formationState).map(
        (session) => session.id,
      ),
    ).toEqual(["session-plan", "session-exec"]);
  });

  it("应按任务状态优先级构建 task schedule 顺序与默认选中项", () => {
    const orchestrator = createSessionCard({
      id: "session-main",
      name: "主助手",
      sessionType: "user",
    });
    const planner = createSessionCard({
      id: "session-plan",
      name: "规划成员",
      blueprintRoleLabel: "规划",
      runtimeStatus: "completed",
    });
    const executor = createSessionCard({
      id: "session-exec",
      name: "执行成员",
      roleKey: "executor",
      runtimeStatus: "running",
    });
    const formationState = {
      requestId: "dispatch-1",
      status: "formed",
      members: [],
      blueprint: {
        roles: [
          {
            id: "role-plan",
            label: "规划",
            summary: "负责拆解方案",
            profileId: "profile-plan",
            roleKey: "planner",
          },
          {
            id: "role-exec",
            label: "执行",
            summary: "负责落地实现",
            profileId: "profile-exec",
            roleKey: "executor",
          },
        ],
      },
      updatedAt: 1,
    } as TeamWorkspaceRuntimeFormationState;

    const memberCanvasSessions = buildTeamWorkspaceMemberCanvasSessions({
      isChildSession: false,
      visibleSessions: [executor, planner],
      teamDispatchPreviewState: formationState,
    });
    const railSessions = buildTeamWorkspaceRailSessions({
      isChildSession: false,
      hasRealTeamGraph: true,
      orchestratorSession: orchestrator,
      visibleSessions: [executor, planner],
    });

    expect(memberCanvasSessions.map((session) => session.id)).toEqual([
      "session-exec",
      "session-plan",
    ]);
    expect(railSessions.map((session) => session.id)).toEqual([
      "session-main",
      "session-exec",
      "session-plan",
    ]);
    expect(
      resolveTeamWorkspaceSelectedSessionId({
        currentSessionId: "session-main",
        isChildSession: false,
        selectedSessionId: "session-main",
        railSessions,
        memberCanvasSessions,
        orchestratorSessionId: "session-main",
      }),
    ).toBe("session-exec");
  });

  it("应在展开成员失效时自动回收 expanded session id", () => {
    expect(
      resolveExpandedTeamWorkspaceSessionId("missing", [
        createSessionCard({
          id: "session-1",
          name: "成员 1",
        }),
      ]),
    ).toBeNull();
  });

  it("应返回对应场景的 fallback 文案", () => {
    expect(
      buildFallbackSummary({
        hasRuntimeSessions: false,
        isChildSession: false,
      }),
    ).toContain("还没有任务接入");

    expect(
      buildFallbackSummary({
        hasRuntimeSessions: true,
        isChildSession: false,
        selectedSession: createSessionCard({
          id: "orchestrator",
          name: "主助手",
          sessionType: "user",
        }),
      }),
    ).toContain("主助手会负责整理需求、安排任务顺序");
  });

  it("应暴露稳定的状态与时间展示 helper", () => {
    expect(resolveStatusMeta("running")).toMatchObject({
      label: "处理中",
      dotClassName: "bg-sky-500",
    });
    expect(formatUpdatedAt()).toBe("刚刚");
  });
});
