import { describe, expect, it } from "vitest";

import { shouldPreferMockInBrowser } from "./mockPriorityCommands";

describe("mockPriorityCommands", () => {
  it("工作台阶段缺失桥接命令优先走 mock", () => {
    expect(
      shouldPreferMockInBrowser("execution_run_get_general_workbench_state"),
    ).toBe(true);
    expect(shouldPreferMockInBrowser("get_hint_routes")).toBe(true);
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
});
