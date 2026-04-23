import { describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import type { AsterSessionDetail } from "@/lib/api/agentRuntime";
import {
  createAgentSessionReadModelSnapshot,
  refreshAgentSessionDetailState,
  refreshAgentSessionReadModelState,
} from "./agentSessionRefresh";

describe("agentSessionRefresh", () => {
  it("应把 thread_read 归一成可消费快照", () => {
    const snapshot = createAgentSessionReadModelSnapshot({
      thread_id: "thread-1",
      status: "queued",
      pending_requests: [],
      incidents: [],
      queued_turns: [
        {
          queuedTurnId: "queued-1",
          messagePreview: "继续执行",
          messageText: "继续执行当前任务",
          createdAt: 1700000000000,
          imageCount: 0,
          position: 1,
        },
      ],
    } as never);

    expect(snapshot.threadRead).toMatchObject({
      thread_id: "thread-1",
      status: "queued",
    });
    expect(snapshot.queuedTurns).toEqual([
      {
        queued_turn_id: "queued-1",
        message_preview: "继续执行",
        message_text: "继续执行当前任务",
        created_at: 1700000000000,
        image_count: 0,
        position: 1,
      },
    ]);
  });

  it("刷新 detail 时应应用 detail 并同步 executionStrategy", async () => {
    const applySessionDetail = vi.fn();
    const markSynced = vi.fn();
    const detail: AsterSessionDetail = {
      id: "session-1",
      messages: [],
      created_at: 1,
      updated_at: 2,
      execution_strategy: "code_orchestrated",
    };

    await expect(
      refreshAgentSessionDetailState({
        runtime: {
          getSession: vi.fn(async () => detail),
        },
        sessionIdRef: {
          current: "session-1",
        } as MutableRefObject<string | null>,
        applySessionDetail,
        markSessionExecutionStrategySynced: markSynced,
      }),
    ).resolves.toBe(true);

    expect(applySessionDetail).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        id: "session-1",
        execution_strategy: "code_orchestrated",
      }),
      {
        preserveExecutionStrategyOnMissingDetail: true,
      },
    );
    expect(markSynced).toHaveBeenCalledWith("session-1", "code_orchestrated");
  });

  it("刷新 detail 时应把 recent_access_mode 同步到当前 accessMode 与 session shadow", async () => {
    const applySessionDetail = vi.fn();
    const markSynced = vi.fn();
    const persistSessionAccessMode = vi.fn();
    const setAccessModeState = vi.fn();
    const detail: AsterSessionDetail = {
      id: "session-1",
      messages: [],
      created_at: 1,
      updated_at: 2,
      execution_strategy: "react",
      execution_runtime: {
        session_id: "session-1",
        execution_strategy: "react",
        recent_access_mode: "current",
        source: "session",
      },
    };

    await expect(
      refreshAgentSessionDetailState({
        runtime: {
          getSession: vi.fn(async () => detail),
        },
        sessionIdRef: {
          current: "session-1",
        } as MutableRefObject<string | null>,
        applySessionDetail,
        markSessionExecutionStrategySynced: markSynced,
        persistSessionAccessMode,
        setAccessModeState,
      }),
    ).resolves.toBe(true);

    expect(persistSessionAccessMode).toHaveBeenCalledWith(
      "session-1",
      "current",
    );
    expect(setAccessModeState).toHaveBeenCalledWith("current");
  });

  it("刷新 read model 时应在会话仍匹配时应用 snapshot", async () => {
    const applyReadModelSnapshot = vi.fn();

    await expect(
      refreshAgentSessionReadModelState({
        runtime: {
          getSessionReadModel: vi.fn(async () => ({
            thread_id: "thread-1",
            status: "idle",
            pending_requests: [],
            incidents: [],
            queued_turns: [],
          })),
        },
        sessionIdRef: {
          current: "session-1",
        } as MutableRefObject<string | null>,
        applyReadModelSnapshot,
      }),
    ).resolves.toBe(true);

    expect(applyReadModelSnapshot).toHaveBeenCalledWith({
      queuedTurns: [],
      threadRead: expect.objectContaining({
        thread_id: "thread-1",
        status: "idle",
      }),
    });
  });
});
