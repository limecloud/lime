import { describe, expect, it } from "vitest";
import type { MutableRefObject } from "react";

import { buildWaitingAgentRuntimeStatus } from "../utils/agentRuntimeStatus";
import { resolveAgentStreamSubmitContext } from "./agentStreamSubmitContext";

describe("agentStreamSubmitContext", () => {
  it("应只解析 session/workspace/runtime context，不提前激活流", async () => {
    const result = await resolveAgentStreamSubmitContext({
      ensureSession: async () => "session-1",
      sessionIdRef: { current: null } as MutableRefObject<string | null>,
      getWorkspaceIdForSubmit: () => "workspace-1",
      getSyncedSessionRecentPreferences: () => ({
        webSearch: false,
        thinking: false,
        task: false,
        subagent: true,
      }),
      getSyncedSessionExecutionStrategy: () => "react",
      effectiveExecutionStrategy: "react",
    });

    expect(result.activeSessionId).toBe("session-1");
    expect(result.resolvedWorkspaceId).toBe("workspace-1");
    expect(result.submitWorkspaceId).toBe("workspace-1");
    expect(result.syncedRecentPreferences).toMatchObject({
      task: false,
      subagent: true,
    });
    expect(result.syncedExecutionStrategy).toBe("react");
  });

  it("已存在 session 时应保留 assistant waiting status", async () => {
    const waitingRuntimeStatus = buildWaitingAgentRuntimeStatus({
      executionStrategy: "react",
    });

    const result = await resolveAgentStreamSubmitContext({
      ensureSession: async () => "session-2",
      sessionIdRef: { current: "session-2" } as MutableRefObject<string | null>,
      getWorkspaceIdForSubmit: () => "workspace-2",
      getSyncedSessionExecutionStrategy: () => "react",
      effectiveExecutionStrategy: "react",
      assistantDraft: {
        waitingRuntimeStatus,
      },
    });

    expect(result.submitWorkspaceId).toBeUndefined();
    expect(result.effectiveWaitingRuntimeStatus).toEqual(waitingRuntimeStatus);
  });

  it("detached 普通会话不应提交 workspace_id", async () => {
    const result = await resolveAgentStreamSubmitContext({
      ensureSession: async () => "session-detached",
      sessionIdRef: { current: null } as MutableRefObject<string | null>,
      getWorkspaceIdForSubmit: () => undefined,
      getSyncedSessionExecutionStrategy: () => "react",
      effectiveExecutionStrategy: "react",
    });

    expect(result.resolvedWorkspaceId).toBeUndefined();
    expect(result.submitWorkspaceId).toBeUndefined();
  });


});
