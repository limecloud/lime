import { describe, expect, it } from "vitest";

import {
  buildHarnessRequestMetadata,
  extractExistingHarnessMetadata,
} from "./harnessRequestMetadata";
import { normalizeHarnessSessionMode } from "./harnessSessionMode";

describe("harnessRequestMetadata", () => {
  it("应保留已有 harness metadata 并覆盖当前字段", () => {
    const metadata = buildHarnessRequestMetadata({
      base: {
        trace_id: "trace-1",
        legacy_flag: true,
      },
      theme: "general",
      preferences: {
        webSearch: true,
        thinking: false,
        task: true,
        subagent: false,
      },
      sessionMode: "default",
      browserAssistProfileKey: "general_browser_assist",
      preferredTeamPresetId: "code-triage-team",
      selectedTeamId: "custom-team-1",
      selectedTeamSource: "custom",
      selectedTeamLabel: "前端联调团队",
      selectedTeamDescription: "分析、实现、验证三段式推进。",
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
      preferences: {
        web_search: true,
        thinking: false,
        task: true,
        subagent: false,
      },
      preferred_team_preset_id: "code-triage-team",
      selected_team_id: "custom-team-1",
      selected_team_source: "custom",
      selected_team_label: "前端联调团队",
      selected_team_description: "分析、实现、验证三段式推进。",
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
    expect(metadata.creation_mode).toBeUndefined();
    expect(metadata.chat_mode).toBeUndefined();
    expect(metadata.web_search_enabled).toBeUndefined();
    expect(metadata.task_mode_enabled).toBeUndefined();
  });

  it("应清理 base 中遗留的平铺状态字段", () => {
    const metadata = buildHarnessRequestMetadata({
      base: {
        creation_mode: "guided",
        chat_mode: "general",
        web_search_enabled: false,
        thinking_enabled: false,
        task_mode_enabled: false,
        subagent_mode_enabled: false,
        creationMode: "hybrid",
        chatMode: "workbench",
        webSearchEnabled: true,
        thinkingEnabled: true,
        taskModeEnabled: true,
        subagentModeEnabled: true,
        turn_team_decision: "team_prepared",
        turn_team_reason: "runtime_team_prepared",
        turn_team_blueprint: {
          label: "旧 Team 蓝图",
        },
        turnTeamDecision: "single_agent",
        turnTeamReason: "single_agent_direct",
        turnTeamBlueprint: {
          label: "legacy team blueprint",
        },
      },
      theme: "general",
      preferences: {
        webSearch: true,
        thinking: true,
        task: false,
        subagent: false,
      },
      sessionMode: "default",
    });

    expect(metadata).toMatchObject({
      theme: "general",
      preferences: {
        web_search: true,
        thinking: true,
        task: false,
        subagent: false,
      },
    });
    expect(metadata.creation_mode).toBeUndefined();
    expect(metadata.chat_mode).toBeUndefined();
    expect(metadata.web_search_enabled).toBeUndefined();
    expect(metadata.thinking_enabled).toBeUndefined();
    expect(metadata.task_mode_enabled).toBeUndefined();
    expect(metadata.subagent_mode_enabled).toBeUndefined();
    expect(metadata.creationMode).toBeUndefined();
    expect(metadata.chatMode).toBeUndefined();
    expect(metadata.webSearchEnabled).toBeUndefined();
    expect(metadata.thinkingEnabled).toBeUndefined();
    expect(metadata.taskModeEnabled).toBeUndefined();
    expect(metadata.subagentModeEnabled).toBeUndefined();
    expect(metadata.turn_team_decision).toBeUndefined();
    expect(metadata.turn_team_reason).toBeUndefined();
    expect(metadata.turn_team_blueprint).toBeUndefined();
    expect(metadata.turnTeamDecision).toBeUndefined();
    expect(metadata.turnTeamReason).toBeUndefined();
    expect(metadata.turnTeamBlueprint).toBeUndefined();
  });

  it("默认会话模式不应写入 gate_key", () => {
    const metadata = buildHarnessRequestMetadata({
      theme: "general",
      preferences: {
        webSearch: false,
        thinking: true,
        task: false,
        subagent: false,
      },
      sessionMode: "default",
      gateKey: "topic_select",
    });

    expect(metadata.gate_key).toBeUndefined();
  });

  it("应透传当前发送用途，供后端统一决策运行时行为", () => {
    const metadata = buildHarnessRequestMetadata({
      theme: "general",
      turnPurpose: "content_review",
      preferences: {
        webSearch: false,
        thinking: true,
        task: false,
        subagent: false,
      },
      sessionMode: "general_workbench",
    });

    expect(metadata.turn_purpose).toBe("content_review");
  });

  it("应将 legacy general workbench alias 会话模式归一为 general_workbench", () => {
    expect(normalizeHarnessSessionMode("theme_workbench")).toBe(
      "general_workbench",
    );

    const metadata = buildHarnessRequestMetadata({
      theme: "general",
      preferences: {
        webSearch: false,
        thinking: true,
        task: false,
        subagent: false,
      },
      sessionMode: "theme_workbench",
      gateKey: "write_mode",
    });

    expect(metadata.session_mode).toBe("general_workbench");
    expect(metadata.gate_key).toBe("write_mode");
  });

  it("应保留 Team 角色的 profileId、roleKey 与 skillIds", () => {
    const metadata = buildHarnessRequestMetadata({
      theme: "general",
      preferences: {
        webSearch: false,
        thinking: true,
        task: true,
        subagent: true,
      },
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

  it("应透传 repo-scoped team memory shadow", () => {
    const metadata = buildHarnessRequestMetadata({
      theme: "general",
      preferences: {
        webSearch: false,
        thinking: true,
        task: true,
        subagent: true,
      },
      sessionMode: "default",
      teamMemoryShadow: {
        repo_scope: "/tmp/repo",
        entries: [
          {
            key: "team.selection",
            content: "Team：前端联调团队",
            updated_at: 1,
          },
        ],
      },
    });

    expect(metadata.team_memory_shadow).toEqual({
      repo_scope: "/tmp/repo",
      entries: [
        {
          key: "team.selection",
          content: "Team：前端联调团队",
          updated_at: 1,
        },
      ],
    });
  });

  it("不应再写入旧 turn_team compat 字段", () => {
    const metadata = buildHarnessRequestMetadata({
      theme: "general",
      preferences: {
        webSearch: false,
        thinking: true,
        task: true,
        subagent: true,
      },
      sessionMode: "default",
    });

    expect(metadata.turn_team_decision).toBeUndefined();
    expect(metadata.turn_team_reason).toBeUndefined();
    expect(metadata.turn_team_blueprint).toBeUndefined();
  });

  it("需要人工确认的浏览器任务应标记 user step", () => {
    const metadata = buildHarnessRequestMetadata({
      theme: "general",
      preferences: {
        webSearch: true,
        thinking: true,
        task: true,
        subagent: true,
      },
      sessionMode: "general_workbench",
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

  it("应允许附着会话覆盖浏览器后端与自动拉起策略", () => {
    const metadata = buildHarnessRequestMetadata({
      theme: "general",
      preferences: {
        webSearch: true,
        thinking: true,
        task: true,
        subagent: true,
      },
      sessionMode: "default",
      browserAssistProfileKey: "attached-xhs",
      browserAssistPreferredBackend: "lime_extension_bridge",
      browserAssistAutoLaunch: false,
    });

    expect(metadata).toMatchObject({
      browser_assist: {
        enabled: true,
        profile_key: "attached-xhs",
        preferred_backend: "lime_extension_bridge",
        auto_launch: false,
        stream_mode: "both",
      },
    });
  });

  it("应保留 Browser Assist 已注入的运行合同快照", () => {
    const metadata = buildHarnessRequestMetadata({
      base: {
        browser_assist: {
          enabled: true,
          modality_contract_key: "browser_control",
          modality: "browser",
          required_capabilities: [
            "text_generation",
            "browser_reasoning",
            "browser_control_planning",
          ],
          routing_slot: "browser_reasoning_model",
          runtime_contract: {
            contract_key: "browser_control",
          },
          launch_url: "https://example.com",
        },
      },
      theme: "general",
      preferences: {
        webSearch: false,
        thinking: true,
        task: true,
        subagent: true,
      },
      sessionMode: "default",
      browserAssistProfileKey: "general_browser_assist",
    });

    expect(metadata).toMatchObject({
      browser_assist: {
        enabled: true,
        profile_key: "general_browser_assist",
        modality_contract_key: "browser_control",
        modality: "browser",
        required_capabilities: expect.arrayContaining([
          "browser_control_planning",
        ]),
        routing_slot: "browser_reasoning_model",
        runtime_contract: expect.objectContaining({
          contract_key: "browser_control",
        }),
        launch_url: "https://example.com",
      },
    });
  });

  it("未显式指定浏览器后端时不应强制写入 cdp_direct", () => {
    const metadata = buildHarnessRequestMetadata({
      theme: "general",
      preferences: {
        webSearch: true,
        thinking: true,
        task: true,
        subagent: true,
      },
      sessionMode: "default",
      browserAssistProfileKey: "general_browser_assist",
    });

    expect(metadata).toMatchObject({
      browser_assist: {
        enabled: true,
        profile_key: "general_browser_assist",
        auto_launch: true,
        stream_mode: "both",
      },
    });
    expect(
      (metadata.browser_assist as { preferred_backend?: string })
        ?.preferred_backend,
    ).toBeUndefined();
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
