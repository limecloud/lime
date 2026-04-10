import { describe, expect, it, vi } from "vitest";
import {
  buildTeamWorkspaceSessionFingerprint,
  type TeamWorkspaceActivityEntry,
  type TeamWorkspaceLiveRuntimeState,
  type TeamWorkspaceRuntimeSessionSnapshot,
} from "../teamWorkspaceRuntime";
import type { SessionLiveStreamState } from "./liveRuntimeProjector";
import {
  subscribeTeamWorkspaceStatusEvents,
  subscribeTeamWorkspaceStreamEvents,
} from "./runtimeEventSubscriptions";

describe("runtimeEventSubscriptions", () => {
  it("应直接处理状态监听投影，而不需要先挂 React hook", async () => {
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    let liveRuntimeBySessionId: Record<string, TeamWorkspaceLiveRuntimeState> =
      {};
    let liveActivityBySessionId: Record<string, TeamWorkspaceActivityEntry[]> =
      {};
    const refreshSpy = vi.fn();
    const childSession: TeamWorkspaceRuntimeSessionSnapshot = {
      id: "child-1",
      runtimeStatus: "queued",
      latestTurnStatus: "queued",
      queuedTurnCount: 0,
    };

    const unsubscribe = await subscribeTeamWorkspaceStatusEvents({
      sessionIds: ["parent-1"],
      eventSource: {
        listenSubagentStatus: async (sessionId, handler) => {
          listeners.set(sessionId, handler);
          return () => {
            listeners.delete(sessionId);
          };
        },
      },
      getSnapshot: (sessionId) =>
        sessionId === "child-1" ? childSession : undefined,
      getBaseFingerprint: (_sessionId, session) =>
        buildTeamWorkspaceSessionFingerprint(session),
      getCurrentRuntime: (sessionId) => liveRuntimeBySessionId[sessionId],
      setLiveRuntimeBySessionId: (update) => {
        liveRuntimeBySessionId = update(liveRuntimeBySessionId);
      },
      setLiveActivityBySessionId: (update) => {
        liveActivityBySessionId = update(liveActivityBySessionId);
      },
      scheduleActivityRefresh: refreshSpy,
    });

    listeners.get("parent-1")?.({
      payload: {
        type: "subagent_status_changed",
        session_id: "child-1",
        root_session_id: "parent-1",
        status: "running",
      },
    });

    expect(liveRuntimeBySessionId["child-1"]?.runtimeStatus).toBe("running");
    expect(liveActivityBySessionId["child-1"]?.[0]?.detail).toContain(
      "已切换为处理中",
    );
    expect(refreshSpy).toHaveBeenCalledWith("child-1");

    unsubscribe();
  });

  it("应直接处理流式监听投影，并更新 tool 暂态与活动摘要", async () => {
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    let liveRuntimeBySessionId: Record<string, TeamWorkspaceLiveRuntimeState> =
      {};
    let liveActivityBySessionId: Record<string, TeamWorkspaceActivityEntry[]> =
      {};
    let liveStreamStateBySessionId: Record<string, SessionLiveStreamState> = {};
    let toolNameBySessionId: Record<string, Record<string, string>> = {};
    const refreshSpy = vi.fn();
    const session: TeamWorkspaceRuntimeSessionSnapshot = {
      id: "child-1",
      runtimeStatus: "running",
      latestTurnStatus: "running",
      queuedTurnCount: 0,
    };

    const unsubscribe = await subscribeTeamWorkspaceStreamEvents({
      sessionIds: ["child-1"],
      eventSource: {
        listenSubagentStream: async (sessionId, handler) => {
          listeners.set(sessionId, handler);
          return () => {
            listeners.delete(sessionId);
          };
        },
      },
      getSnapshot: (sessionId) =>
        sessionId === "child-1" ? session : undefined,
      getBaseFingerprint: (_sessionId, snapshot) =>
        buildTeamWorkspaceSessionFingerprint(snapshot),
      getCurrentRuntime: (sessionId) => liveRuntimeBySessionId[sessionId],
      getStreamState: (sessionId) => liveStreamStateBySessionId[sessionId],
      setStreamState: (sessionId, nextState) => {
        if (nextState) {
          liveStreamStateBySessionId[sessionId] = nextState;
          return;
        }

        delete liveStreamStateBySessionId[sessionId];
      },
      getToolNames: (sessionId) => toolNameBySessionId[sessionId],
      setToolNames: (sessionId, nextToolNames) => {
        if (nextToolNames) {
          toolNameBySessionId[sessionId] = nextToolNames;
          return;
        }

        delete toolNameBySessionId[sessionId];
      },
      setLiveRuntimeBySessionId: (update) => {
        liveRuntimeBySessionId = update(liveRuntimeBySessionId);
      },
      setLiveActivityBySessionId: (update) => {
        liveActivityBySessionId = update(liveActivityBySessionId);
      },
      scheduleActivityRefresh: refreshSpy,
    });

    listeners.get("child-1")?.({
      payload: {
        type: "tool_start",
        tool_id: "tool-1",
        tool_name: "browser_snapshot",
      },
    });

    expect(liveActivityBySessionId["child-1"]?.[0]?.title).toBe(
      "处理中 · 页面截图",
    );
    expect(toolNameBySessionId["child-1"]?.["tool-1"]).toBe("browser_snapshot");

    listeners.get("child-1")?.({
      payload: {
        type: "tool_end",
        tool_id: "tool-1",
        result: {
          success: true,
          output: "页面结构差异已提取完成。",
        },
      },
    });

    expect(liveActivityBySessionId["child-1"]?.[0]?.detail).toContain(
      "页面结构差异已提取完成",
    );
    expect(toolNameBySessionId["child-1"]).toBeUndefined();
    expect(refreshSpy).toHaveBeenCalledWith("child-1");

    unsubscribe();
  });
});
