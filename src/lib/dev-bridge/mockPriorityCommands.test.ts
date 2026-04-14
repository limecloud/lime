import { describe, expect, it } from "vitest";

import {
  shouldDisallowMockFallbackInBrowser,
  shouldPreferMockInBrowser,
} from "./mockPriorityCommands";

describe("mockPriorityCommands", () => {
  it("工作台阶段缺失桥接命令优先走 mock", () => {
    expect(
      shouldPreferMockInBrowser("execution_run_get_general_workbench_state"),
    ).toBe(true);
    expect(shouldPreferMockInBrowser("get_hint_routes")).toBe(true);
    expect(shouldPreferMockInBrowser("aster_agent_init")).toBe(false);
    expect(shouldPreferMockInBrowser("agent_runtime_get_tool_inventory")).toBe(
      false,
    );
    expect(shouldPreferMockInBrowser("content_workflow_get_by_content")).toBe(
      false,
    );
  });

  it("OpenClaw 浏览器模式命令优先走 mock", () => {
    expect(shouldPreferMockInBrowser("openclaw_get_environment_status")).toBe(
      true,
    );
    expect(shouldPreferMockInBrowser("openclaw_get_status")).toBe(true);
    expect(shouldPreferMockInBrowser("close_webview_panel")).toBe(true);
  });

  it("模型与运行时真相命令在浏览器模式下禁止静默退回 mock", () => {
    expect(shouldDisallowMockFallbackInBrowser("aster_agent_init")).toBe(true);
    expect(shouldDisallowMockFallbackInBrowser("workspace_list")).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser("workspace_get_default"),
    ).toBe(true);
    expect(shouldDisallowMockFallbackInBrowser("workspace_get")).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser("workspace_ensure_ready"),
    ).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser("agent_runtime_submit_turn"),
    ).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser("agent_runtime_list_sessions"),
    ).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser("agent_runtime_update_session"),
    ).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser("get_model_registry_provider_ids"),
    ).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser("get_provider_pool_overview"),
    ).toBe(true);
    expect(shouldDisallowMockFallbackInBrowser("get_provider_ui_state")).toBe(
      true,
    );
    expect(shouldDisallowMockFallbackInBrowser("list_plugin_tasks")).toBe(
      false,
    );
  });
});
