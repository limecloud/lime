import { describe, expect, it } from "vitest";
import { buildUserInputSubmitOp } from "./buildUserInputSubmitOp";

describe("buildUserInputSubmitOp", () => {
  it("应构造最小 user_input op，并裁掉 steady-state 字段", () => {
    const op = buildUserInputSubmitOp({
      content: "继续生成社媒初稿",
      images: [
        {
          data: "base64-image",
          mediaType: "image/png",
        },
      ],
      sessionId: "session-social-1",
      eventName: "aster_stream_x",
      workspaceId: "workspace-1",
      turnId: "turn-1",
      systemPrompt: "system",
      queueIfBusy: true,
      requestMetadata: {
        harness: {
          preferences: {
            web_search: false,
            thinking: true,
          },
          theme: "general",
          session_mode: "general_workbench",
          gate_key: "write_mode",
          run_title: "社媒初稿",
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
          thinking: true,
          task: false,
          subagent: false,
        },
        recent_theme: "general",
        recent_session_mode: "general_workbench",
        recent_gate_key: "write_mode",
        recent_run_title: "社媒初稿",
        recent_content_id: "content-social-1",
      },
      syncedRecentPreferences: {
        webSearch: false,
        thinking: true,
        task: false,
        subagent: false,
      },
      syncedSessionModelPreference: {
        providerType: "openai",
        model: "gpt-4.1",
      },
      syncedExecutionStrategy: "react",
      effectiveExecutionStrategy: "react",
      effectiveAccessMode: "current",
      effectiveProviderType: "openai",
      effectiveModel: "gpt-4.1",
      webSearch: false,
      thinking: true,
    });

    expect(op).toEqual({
      type: "user_input",
      text: "继续生成社媒初稿",
      sessionId: "session-social-1",
      eventName: "aster_stream_x",
      workspaceId: "workspace-1",
      turnId: "turn-1",
      images: [
        {
          data: "base64-image",
          media_type: "image/png",
        },
      ],
      preferences: {
        providerPreference: undefined,
        modelPreference: undefined,
        thinking: undefined,
        approvalPolicy: "on-request",
        sandboxPolicy: "workspace-write",
        executionStrategy: undefined,
        webSearch: undefined,
        autoContinue: undefined,
      },
      systemPrompt: "system",
      metadata: undefined,
      queueIfBusy: true,
    });
  });

  it("应保留尚未同步到 runtime 的显式偏好与 metadata", () => {
    const op = buildUserInputSubmitOp({
      content: "切到发布确认",
      images: [],
      sessionId: "session-social-1",
      eventName: "aster_stream_y",
      turnId: "turn-2",
      requestMetadata: {
        harness: {
          preferences: {
            thinking: true,
          },
          theme: "general",
          session_mode: "general_workbench",
          gate_key: "publish_confirm",
          run_title: "发布确认",
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
        recent_theme: "general",
        recent_session_mode: "general_workbench",
        recent_gate_key: "write_mode",
        recent_run_title: "社媒初稿",
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
      effectiveAccessMode: "full-access",
      effectiveProviderType: "openai",
      effectiveModel: "gpt-5",
      modelOverride: "gpt-5",
      webSearch: false,
      thinking: true,
      autoContinue: {
        enabled: true,
        fast_mode_enabled: false,
        continuation_length: 2,
        sensitivity: 0.5,
      },
    });

    expect(op.preferences).toEqual({
      providerPreference: undefined,
      modelPreference: "gpt-5",
      thinking: true,
      approvalPolicy: "never",
      sandboxPolicy: "danger-full-access",
      executionStrategy: "code_orchestrated",
      webSearch: undefined,
      autoContinue: {
        enabled: true,
        fast_mode_enabled: false,
        continuation_length: 2,
        sensitivity: 0.5,
      },
    });
    expect(op.metadata).toEqual({
      harness: {
        preferences: {
          thinking: true,
        },
        gate_key: "publish_confirm",
        run_title: "发布确认",
      },
    });
  });

  it("provider 发生切换时应同时提交 provider/model 偏好", () => {
    const op = buildUserInputSubmitOp({
      content: "使用翻译服务模型",
      images: [],
      sessionId: "session-translation-1",
      eventName: "aster_stream_translation",
      executionRuntime: {
        session_id: "session-translation-1",
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
      effectiveExecutionStrategy: "react",
      effectiveAccessMode: "current",
      effectiveProviderType: "translation-provider",
      effectiveModel: "translation-model",
      modelOverride: "translation-model",
      webSearch: false,
      thinking: false,
    });

    expect(op.preferences?.providerPreference).toBe("translation-provider");
    expect(op.preferences?.modelPreference).toBe("translation-model");
  });
});
