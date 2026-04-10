import { describe, expect, it, vi } from "vitest";
import { createAgentRuntimeClient } from "./clientFactory";

describe("agentRuntime clientFactory", () => {
  it("传入 invoke 时应同时驱动 command 与 bridge client", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce("session-runtime-1")
      .mockResolvedValueOnce([{ id: "adapter-1" }]);
    const client = createAgentRuntimeClient({ invoke });

    await expect(client.createAgentRuntimeSession("workspace-1")).resolves.toBe(
      "session-runtime-1",
    );
    await expect(client.siteListAdapters()).resolves.toEqual([
      { id: "adapter-1" },
    ]);

    expect(invoke).toHaveBeenNthCalledWith(1, "agent_runtime_create_session", {
      workspaceId: "workspace-1",
      name: undefined,
      executionStrategy: undefined,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "site_list_adapters");
  });

  it("仅注入 bridgeInvoke 时 command client 也应复用同一桥接函数", async () => {
    const bridgeInvoke = vi.fn().mockResolvedValueOnce(undefined);
    const client = createAgentRuntimeClient({ bridgeInvoke });

    await client.submitAgentRuntimeTurn({
      message: "继续",
      session_id: "session-1",
      event_name: "event-1",
      workspace_id: "workspace-1",
    });

    expect(bridgeInvoke).toHaveBeenCalledWith("agent_runtime_submit_turn", {
      request: {
        message: "继续",
        session_id: "session-1",
        event_name: "event-1",
        workspace_id: "workspace-1",
      },
    });
  });
});
