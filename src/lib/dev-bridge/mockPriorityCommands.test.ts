import { describe, expect, it } from "vitest";

import {
  shouldDisallowMockEventFallbackInBrowser,
  shouldDisallowMockFallbackInBrowser,
  shouldPreferMockInBrowser,
} from "./mockPriorityCommands";

describe("mockPriorityCommands", () => {
  it("工作台阶段缺失桥接命令优先走 mock", () => {
    expect(
      shouldPreferMockInBrowser("execution_run_get_general_workbench_state"),
    ).toBe(true);
    expect(shouldPreferMockInBrowser("get_hint_routes")).toBe(true);
    expect(shouldPreferMockInBrowser("memory_cleanup_memdir")).toBe(true);
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
    expect(shouldDisallowMockFallbackInBrowser("agent_generate_title")).toBe(
      true,
    );
    expect(shouldDisallowMockFallbackInBrowser("workspace_list")).toBe(true);
    expect(shouldDisallowMockFallbackInBrowser("workspace_get_default")).toBe(
      true,
    );
    expect(shouldDisallowMockFallbackInBrowser("workspace_get")).toBe(true);
    expect(shouldDisallowMockFallbackInBrowser("workspace_ensure_ready")).toBe(
      true,
    );
    expect(
      shouldDisallowMockFallbackInBrowser("agent_runtime_submit_turn"),
    ).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser(
        "agent_runtime_list_file_checkpoints",
      ),
    ).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser("agent_runtime_get_file_checkpoint"),
    ).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser("agent_runtime_diff_file_checkpoint"),
    ).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser("agent_runtime_list_sessions"),
    ).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser("agent_runtime_update_session"),
    ).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser("sceneapp_create_automation_job"),
    ).toBe(true);
    expect(shouldDisallowMockFallbackInBrowser("gateway_channel_status")).toBe(
      true,
    );
    expect(
      shouldDisallowMockFallbackInBrowser("wechat_channel_list_accounts"),
    ).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser("get_model_registry_provider_ids"),
    ).toBe(true);
    expect(shouldDisallowMockFallbackInBrowser("get_provider_ui_state")).toBe(
      true,
    );
    expect(shouldPreferMockInBrowser("session_files_save_file")).toBe(false);
    expect(shouldDisallowMockFallbackInBrowser("session_files_save_file")).toBe(
      true,
    );
    expect(shouldDisallowMockFallbackInBrowser("read_file_preview_cmd")).toBe(
      true,
    );
    expect(
      shouldDisallowMockFallbackInBrowser("session_files_resolve_file_path"),
    ).toBe(true);
    expect(shouldDisallowMockFallbackInBrowser("upload_material")).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser(
        "create_image_generation_task_artifact",
      ),
    ).toBe(true);
    expect(shouldDisallowMockFallbackInBrowser("get_media_task_artifact")).toBe(
      true,
    );
    expect(
      shouldDisallowMockFallbackInBrowser("list_media_task_artifacts"),
    ).toBe(true);
    expect(
      shouldDisallowMockFallbackInBrowser("cancel_media_task_artifact"),
    ).toBe(true);
    expect(shouldDisallowMockFallbackInBrowser("list_plugin_tasks")).toBe(
      false,
    );
  });

  it("运行时真相事件在浏览器模式下禁止静默退回 mock", () => {
    expect(
      shouldDisallowMockEventFallbackInBrowser("aster_stream_session-1"),
    ).toBe(true);
    expect(
      shouldDisallowMockEventFallbackInBrowser(
        "agent_subagent_status:session-1",
      ),
    ).toBe(true);
    expect(
      shouldDisallowMockEventFallbackInBrowser(
        "agent_subagent_stream:session-1",
      ),
    ).toBe(true);
    expect(
      shouldDisallowMockEventFallbackInBrowser("companion-pet-status"),
    ).toBe(false);
    expect(
      shouldDisallowMockEventFallbackInBrowser(" plugin-task-event "),
    ).toBe(false);
  });
});
