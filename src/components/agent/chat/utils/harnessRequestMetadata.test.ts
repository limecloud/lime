import { describe, expect, it } from "vitest";

import {
  buildHarnessRequestMetadata,
  extractExistingHarnessMetadata,
} from "./harnessRequestMetadata";

describe("harnessRequestMetadata", () => {
  it("应保留已有 harness metadata 并覆盖当前字段", () => {
    const metadata = buildHarnessRequestMetadata({
      base: {
        trace_id: "trace-1",
        legacy_flag: true,
      },
      theme: "general",
      creationMode: "guided",
      chatMode: "general",
      webSearchEnabled: true,
      thinkingEnabled: false,
      taskModeEnabled: true,
      subagentModeEnabled: false,
      sessionMode: "default",
      browserAssistProfileKey: "general_browser_assist",
      preferredTeamPresetId: "code-triage-team",
      selectedTeamId: "custom-team-1",
      selectedTeamSource: "custom",
      selectedTeamLabel: "前端联调团队",
      selectedTeamSummary: "分析、实现、验证三段式推进。",
      selectedTeamRoles: [
        {
          id: "explorer",
          label: "分析",
          summary: "负责定位问题与影响范围。",
        },
        {
          id: "executor",
          label: "执行",
          summary: "负责提交实现。",
        },
      ],
    });

    expect(metadata).toMatchObject({
      trace_id: "trace-1",
      legacy_flag: true,
      theme: "general",
      creation_mode: "guided",
      chat_mode: "general",
      web_search_enabled: true,
      task_mode_enabled: true,
      preferred_team_preset_id: "code-triage-team",
      selected_team_id: "custom-team-1",
      selected_team_source: "custom",
      selected_team_label: "前端联调团队",
      selected_team_summary: "分析、实现、验证三段式推进。",
      selected_team_roles: [
        expect.objectContaining({
          id: "explorer",
          label: "分析",
          role_key: undefined,
        }),
        expect.objectContaining({
          id: "executor",
          label: "执行",
        }),
      ],
      browser_assist: expect.objectContaining({
        enabled: true,
        profile_key: "general_browser_assist",
      }),
    });
  });

  it("默认会话模式不应写入 gate_key", () => {
    const metadata = buildHarnessRequestMetadata({
      theme: "document",
      creationMode: "fast",
      chatMode: "agent",
      webSearchEnabled: false,
      thinkingEnabled: true,
      taskModeEnabled: false,
      subagentModeEnabled: false,
      sessionMode: "default",
      gateKey: "topic_select",
    });

    expect(metadata.gate_key).toBeUndefined();
  });

  it("应保留 Team 角色的 profileId、roleKey 与 skillIds", () => {
    const metadata = buildHarnessRequestMetadata({
      theme: "general",
      creationMode: "guided",
      chatMode: "agent",
      webSearchEnabled: false,
      thinkingEnabled: true,
      taskModeEnabled: true,
      subagentModeEnabled: true,
      sessionMode: "default",
      selectedTeamRoles: [
        {
          id: "explorer",
          label: "分析",
          summary: "负责定位问题。",
          profileId: "code-explorer",
          roleKey: "explorer",
          skillIds: ["repo-exploration", "source-grounding"],
        },
      ],
    });

    expect(metadata.selected_team_roles).toEqual([
      {
        id: "explorer",
        label: "分析",
        summary: "负责定位问题。",
        profile_id: "code-explorer",
        role_key: "explorer",
        skill_ids: ["repo-exploration", "source-grounding"],
      },
    ]);
  });

  it("需要人工确认的浏览器任务应标记 user step", () => {
    const metadata = buildHarnessRequestMetadata({
      theme: "general",
      creationMode: "hybrid",
      chatMode: "general",
      webSearchEnabled: true,
      thinkingEnabled: true,
      taskModeEnabled: true,
      subagentModeEnabled: true,
      sessionMode: "theme_workbench",
      gateKey: "publish_confirm",
      browserRequirement: "required_with_user_step",
      browserRequirementReason: "需要登录站点后继续",
      browserLaunchUrl: "https://example.com/publish",
      browserAssistProfileKey: "general_browser_assist",
    });

    expect(metadata).toMatchObject({
      gate_key: "publish_confirm",
      browser_requirement: "required_with_user_step",
      browser_requirement_reason: "需要登录站点后继续",
      browser_launch_url: "https://example.com/publish",
      browser_user_step_required: true,
    });
  });

  it("应能从 request metadata 中提取已有 harness metadata", () => {
    expect(
      extractExistingHarnessMetadata({
        harness: {
          trace_id: "trace-2",
          theme: "general",
        },
      }),
    ).toEqual({
      trace_id: "trace-2",
      theme: "general",
    });

    expect(
      extractExistingHarnessMetadata({ harness: "invalid" }),
    ).toBeUndefined();
  });
});
