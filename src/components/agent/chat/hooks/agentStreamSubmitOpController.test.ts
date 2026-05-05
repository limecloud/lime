import { describe, expect, it } from "vitest";
import { buildUserInputSubmitOp } from "../utils/buildUserInputSubmitOp";
import { buildAgentStreamSubmitOp } from "./agentStreamSubmitOpController";

describe("agentStreamSubmitOpController", () => {
  it("应按 stream submit 语义构造 runtime submitOp，并默认允许 busy queue", () => {
    const op = buildAgentStreamSubmitOp({
      activeSessionId: "session-fast-1",
      content: "只回答一个字：好",
      images: [],
      eventName: "aster_stream_fast",
      submitWorkspaceId: "workspace-1",
      requestTurnId: "turn-fast-1",
      skipPreSubmitResume: true,
      effectiveExecutionStrategy: "react",
      effectiveAccessMode: "current",
      effectiveProviderType: "deepseek",
      effectiveModel: "deepseek-chat",
    });

    expect(op).toEqual({
      type: "user_input",
      text: "只回答一个字：好",
      sessionId: "session-fast-1",
      eventName: "aster_stream_fast",
      workspaceId: "workspace-1",
      turnId: "turn-fast-1",
      images: undefined,
      preferences: {
        providerPreference: "deepseek",
        modelPreference: "deepseek-chat",
        thinking: undefined,
        approvalPolicy: "on-request",
        sandboxPolicy: "workspace-write",
        executionStrategy: "react",
        webSearch: undefined,
        autoContinue: undefined,
      },
      systemPrompt: undefined,
      metadata: undefined,
      queueIfBusy: true,
      skipPreSubmitResume: true,
    });
  });

  it("应与底层 user_input builder 保持 payload 等价", () => {
    const streamOp = buildAgentStreamSubmitOp({
      activeSessionId: "session-social-1",
      content: "继续生成社媒初稿",
      images: [
        {
          data: "base64-image",
          mediaType: "image/png",
        },
      ],
      eventName: "aster_stream_x",
      submitWorkspaceId: undefined,
      requestTurnId: "turn-1",
      systemPrompt: "system",
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
      autoContinue: {
        enabled: true,
        fast_mode_enabled: true,
        continuation_length: 1,
        sensitivity: 0.25,
      },
    });

    const directOp = buildUserInputSubmitOp({
      content: "继续生成社媒初稿",
      images: [
        {
          data: "base64-image",
          mediaType: "image/png",
        },
      ],
      sessionId: "session-social-1",
      eventName: "aster_stream_x",
      workspaceId: undefined,
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
      autoContinue: {
        enabled: true,
        fast_mode_enabled: true,
        continuation_length: 1,
        sensitivity: 0.25,
      },
    });

    expect(streamOp).toEqual(directOp);
  });
});
