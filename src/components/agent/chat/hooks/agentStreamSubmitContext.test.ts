import { describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import { buildWaitingAgentRuntimeStatus } from "../utils/agentRuntimeStatus";
import { resolveAgentStreamSubmitContext } from "./agentStreamSubmitContext";

describe("agentStreamSubmitContext", () => {
  it("应解析 session/workspace/runtime context，并激活非队列流", async () => {
    const activateStream = vi.fn();
    const result = await resolveAgentStreamSubmitContext({
      ensureSession: async () => "session-1",
      sessionIdRef: { current: null } as MutableRefObject<string | null>,
      getRequiredWorkspaceId: () => "workspace-1",
      getSyncedSessionRecentPreferences: () => ({
        webSearch: true,
        thinking: true,
        task: false,
        subagent: true,
      }),
      getSyncedSessionExecutionStrategy: () => "react",
      effectiveExecutionStrategy: "react",
      webSearch: true,
      thinking: true,
      expectingQueue: false,
      activateStream,
    });

    expect(result.activeSessionId).toBe("session-1");
    expect(result.resolvedWorkspaceId).toBe("workspace-1");
    expect(result.submitWorkspaceId).toBe("workspace-1");
    expect(result.syncedRecentPreferences).toMatchObject({
      webSearch: true,
      thinking: true,
      task: false,
      subagent: true,
    });
    expect(result.syncedExecutionStrategy).toBe("react");
    expect(activateStream).toHaveBeenCalledWith(
      "session-1",
      result.effectiveWaitingRuntimeStatus,
    );
  });

  it("已存在 session 且队列态时不应重复激活流，并保留 assistant waiting status", async () => {
    const activateStream = vi.fn();
    const waitingRuntimeStatus = buildWaitingAgentRuntimeStatus({
      executionStrategy: "code_orchestrated",
      webSearch: false,
      thinking: true,
    });

    const result = await resolveAgentStreamSubmitContext({
      ensureSession: async () => "session-2",
      sessionIdRef: { current: "session-2" } as MutableRefObject<string | null>,
      getRequiredWorkspaceId: () => "workspace-2",
      getSyncedSessionExecutionStrategy: () => "code_orchestrated",
      effectiveExecutionStrategy: "code_orchestrated",
      webSearch: false,
      thinking: true,
      assistantDraft: {
        waitingRuntimeStatus,
      },
      expectingQueue: true,
      activateStream,
    });

    expect(result.submitWorkspaceId).toBeUndefined();
    expect(result.effectiveWaitingRuntimeStatus).toEqual(waitingRuntimeStatus);
    expect(activateStream).not.toHaveBeenCalled();
  });
});
