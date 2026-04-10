import { describe, expect, it } from "vitest";
import {
  buildTeamWorkspaceSessionControlState,
  isCompletedTeamSession,
  isWaitableTeamSession,
} from "./sessionStateSelectors";

describe("sessionStateSelectors", () => {
  it("应聚合 statusSummary，并在子线程视角纳入当前成员", () => {
    const state = buildTeamWorkspaceSessionControlState({
      visibleSessions: [
        {
          id: "child-1",
          sessionType: "sub_agent",
          runtimeStatus: "running",
        },
        {
          id: "child-2",
          sessionType: "sub_agent",
          runtimeStatus: "queued",
        },
      ],
      railSessions: [
        {
          id: "child-1",
          sessionType: "sub_agent",
          runtimeStatus: "running",
        },
        {
          id: "child-2",
          sessionType: "sub_agent",
          runtimeStatus: "queued",
        },
      ],
      currentChildSession: {
        id: "child-1",
        sessionType: "sub_agent",
        runtimeStatus: "running",
      },
      isChildSession: true,
      currentSessionId: "child-1",
    });

    expect(state.statusSummary).toEqual({
      running: 1,
      queued: 1,
    });
    expect(state.waitableSessionIds).toEqual(["child-1", "child-2"]);
    expect(state.completedSessionIds).toEqual([]);
  });

  it("应忽略 user 与 terminal session 的 waitable 判定，并排除当前会话的 completed 聚合", () => {
    const state = buildTeamWorkspaceSessionControlState({
      visibleSessions: [
        {
          id: "parent-1",
          sessionType: "user",
          runtimeStatus: "running",
        },
        {
          id: "child-1",
          sessionType: "sub_agent",
          runtimeStatus: "completed",
        },
        {
          id: "child-2",
          sessionType: "sub_agent",
          runtimeStatus: "failed",
        },
        {
          id: "child-3",
          sessionType: "sub_agent",
          runtimeStatus: "queued",
        },
      ],
      railSessions: [
        {
          id: "parent-1",
          sessionType: "user",
          runtimeStatus: "running",
        },
        {
          id: "child-1",
          sessionType: "sub_agent",
          runtimeStatus: "completed",
        },
        {
          id: "child-2",
          sessionType: "sub_agent",
          runtimeStatus: "failed",
        },
        {
          id: "child-3",
          sessionType: "sub_agent",
          runtimeStatus: "queued",
        },
      ],
      isChildSession: false,
      currentSessionId: "child-1",
    });

    expect(state.waitableSessionIds).toEqual(["child-3"]);
    expect(state.completedSessionIds).toEqual(["child-2"]);
  });

  it("应暴露单条 session 的 waitable / completed 判断", () => {
    expect(
      isWaitableTeamSession({
        id: "child-1",
        sessionType: "sub_agent",
        runtimeStatus: "running",
      }),
    ).toBe(true);
    expect(
      isWaitableTeamSession({
        id: "parent-1",
        sessionType: "user",
        runtimeStatus: "running",
      }),
    ).toBe(false);
    expect(
      isCompletedTeamSession({
        id: "child-1",
        sessionType: "sub_agent",
        runtimeStatus: "aborted",
      }),
    ).toBe(true);
  });
});
