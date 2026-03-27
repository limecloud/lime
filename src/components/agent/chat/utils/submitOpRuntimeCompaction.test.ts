import { describe, expect, it } from "vitest";
import { buildSubmitOpRuntimeCompaction } from "./submitOpRuntimeCompaction";

describe("submitOpRuntimeCompaction", () => {
  it("应裁掉已经由 session/runtime 承接的 steady-state 提交字段", () => {
    const result = buildSubmitOpRuntimeCompaction({
      requestMetadata: {
        harness: {
          turn_purpose: "content_review",
          preferences: {
            web_search: false,
            thinking: true,
            task: false,
            subagent: true,
          },
          theme: "social-media",
          session_mode: "theme_workbench",
          gate_key: "write_mode",
          run_title: "社媒初稿",
          content_id: "content-social-1",
          preferred_team_preset_id: "social-preset",
          selected_team_id: "team-social-1",
          selected_team_source: "builtin",
          selected_team_label: "社媒执行团队",
          selected_team_description: "负责选题、写作和校对。",
          selected_team_summary: "负责选题、写作和校对。",
          selected_team_roles: [
            {
              id: "role-1",
              label: "写手",
              summary: "负责起草正文",
              profile_id: "writer",
              role_key: "writer",
              skill_ids: ["draft"],
            },
          ],
        },
      },
      executionRuntime: {
        session_id: "session-social-1",
        source: "runtime_snapshot",
        provider_selector: "openai",
        model_name: "gpt-4.1",
        execution_strategy: "react",
        recent_preferences: {
          webSearch: false,
          thinking: true,
          task: false,
          subagent: true,
        },
        recent_team_selection: {
          disabled: false,
          preferredTeamPresetId: "social-preset",
          selectedTeamId: "team-social-1",
          selectedTeamSource: "builtin",
          selectedTeamLabel: "社媒执行团队",
          selectedTeamDescription: "负责选题、写作和校对。",
          selectedTeamSummary: "负责选题、写作和校对。",
          selectedTeamRoles: [
            {
              id: "role-1",
              label: "写手",
              summary: "负责起草正文",
              profileId: "writer",
              roleKey: "writer",
              skillIds: ["draft"],
            },
          ],
        },
        recent_theme: "social-media",
        recent_session_mode: "theme_workbench",
        recent_gate_key: "write_mode",
        recent_run_title: "社媒初稿",
        recent_content_id: "content-social-1",
      },
      syncedRecentPreferences: {
        webSearch: false,
        thinking: true,
        task: false,
        subagent: true,
      },
      syncedSessionModelPreference: {
        providerType: "openai",
        model: "gpt-4.1",
      },
      syncedExecutionStrategy: "react",
      effectiveExecutionStrategy: "react",
      effectiveProviderType: "openai",
      effectiveModel: "gpt-4.1",
      webSearch: false,
      thinking: true,
    });

    expect(result.shouldSubmitProviderPreference).toBe(false);
    expect(result.shouldSubmitModelPreference).toBe(false);
    expect(result.shouldSubmitExecutionStrategy).toBe(false);
    expect(result.shouldSubmitWebSearch).toBe(false);
    expect(result.shouldSubmitThinking).toBe(false);
    expect(result.metadata).toEqual({
      harness: {
        turn_purpose: "content_review",
      },
    });
  });

  it("应保留尚未同步到 runtime 的显式变更", () => {
    const result = buildSubmitOpRuntimeCompaction({
      requestMetadata: {
        harness: {
          preferences: {
            thinking: true,
          },
          theme: "social-media",
          session_mode: "theme_workbench",
          gate_key: "publish_confirm",
          run_title: "发布确认",
          content_id: "content-social-1",
        },
      },
      executionRuntime: {
        session_id: "session-social-1",
        source: "runtime_snapshot",
        provider_selector: "openai",
        model_name: "gpt-4.1",
        execution_strategy: "react",
        recent_preferences: {
          webSearch: false,
          thinking: false,
          task: false,
          subagent: false,
        },
        recent_theme: "social-media",
        recent_session_mode: "theme_workbench",
        recent_gate_key: "write_mode",
        recent_run_title: "社媒初稿",
        recent_content_id: "content-social-1",
      },
      syncedRecentPreferences: {
        webSearch: false,
        thinking: false,
        task: false,
        subagent: false,
      },
      syncedSessionModelPreference: {
        providerType: "openai",
        model: "gpt-4.1",
      },
      syncedExecutionStrategy: "react",
      effectiveExecutionStrategy: "code_orchestrated",
      effectiveProviderType: "openai",
      effectiveModel: "gpt-5",
      modelOverride: "gpt-5",
      webSearch: false,
      thinking: true,
    });

    expect(result.shouldSubmitProviderPreference).toBe(false);
    expect(result.shouldSubmitModelPreference).toBe(true);
    expect(result.shouldSubmitExecutionStrategy).toBe(true);
    expect(result.shouldSubmitWebSearch).toBe(false);
    expect(result.shouldSubmitThinking).toBe(true);
    expect(result.metadata).toEqual({
      harness: {
        preferences: {
          thinking: true,
        },
        gate_key: "publish_confirm",
        run_title: "发布确认",
      },
    });
  });
});
