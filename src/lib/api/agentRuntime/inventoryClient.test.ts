import { describe, expect, it, vi } from "vitest";
import { createInventoryClient } from "./inventoryClient";

describe("agentRuntime inventoryClient", () => {
  it("应通过 agent_runtime_list_workspace_skill_bindings 获取 workspace skill binding readiness", async () => {
    const invokeCommand = vi.fn().mockResolvedValueOnce({
      request: {
        workspace_root: "/tmp/work",
        caller: "assistant",
        surface: {
          workbench: true,
          browser_assist: false,
        },
      },
      warnings: [],
      counts: {
        registered_total: 1,
        ready_for_manual_enable_total: 1,
        blocked_total: 0,
        query_loop_visible_total: 0,
        tool_runtime_visible_total: 0,
        launch_enabled_total: 0,
      },
      bindings: [],
    });
    const client = createInventoryClient({ invokeCommand });

    await expect(
      client.listWorkspaceSkillBindings({
        workspaceRoot: "/tmp/work",
        caller: "assistant",
        workbench: true,
      }),
    ).resolves.toMatchObject({
      counts: {
        registered_total: 1,
        ready_for_manual_enable_total: 1,
      },
    });

    expect(invokeCommand).toHaveBeenCalledWith(
      "agent_runtime_list_workspace_skill_bindings",
      {
        request: {
          workspaceRoot: "/tmp/work",
          caller: "assistant",
          workbench: true,
        },
      },
    );
  });
});
