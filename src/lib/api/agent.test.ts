import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSafeInvoke } = vi.hoisted(() => ({
  mockSafeInvoke: vi.fn(),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: mockSafeInvoke,
}));

import {
  createasterSession,
  getasterAgentStatus,
  sendAgentMessage,
  sendAgentMessageStream,
} from "./agentCompat";
import { sendAsterMessageStream } from "./agentRuntime";

describe("Agent API 治理护栏", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sendAgentMessage 应显式报废弃错误", async () => {
    await expect(sendAgentMessage("你好")).rejects.toThrow(
      "sendAgentMessage 已废弃",
    );
    expect(mockSafeInvoke).not.toHaveBeenCalled();
  });

  it("createasterSession 应显式报废弃错误", async () => {
    await expect(createasterSession("legacy")).rejects.toThrow(
      "createasterSession 已废弃",
    );
    expect(mockSafeInvoke).not.toHaveBeenCalled();
  });

  it("sendAgentMessageStream 应委托到 aster_agent_chat_stream", async () => {
    mockSafeInvoke.mockResolvedValueOnce(undefined);

    await sendAgentMessageStream(
      "hello",
      "event-1",
      "workspace-1",
      "session-1",
      "model-1",
      [{ data: "base64", media_type: "image/png" }],
      "provider-1",
      undefined,
      "project-1",
      "react",
    );

    expect(mockSafeInvoke).toHaveBeenCalledWith("aster_agent_chat_stream", {
      request: {
        message: "hello",
        session_id: "session-1",
        event_name: "event-1",
        images: [{ data: "base64", media_type: "image/png" }],
        provider_config: {
          provider_id: "provider-1",
          provider_name: "provider-1",
          model_name: "model-1",
        },
        project_id: "project-1",
        workspace_id: "workspace-1",
        execution_strategy: "react",
        web_search: undefined,
        auto_continue: undefined,
        system_prompt: undefined,
      },
    });
  });

  it("sendAsterMessageStream 应走统一 helper 并透传现役字段", async () => {
    mockSafeInvoke.mockResolvedValueOnce(undefined);

    await sendAsterMessageStream(
      "hello",
      "session-2",
      "event-2",
      "workspace-2",
      [{ data: "base64", media_type: "image/jpeg" }],
      {
        provider_id: "provider-2",
        provider_name: "Provider 2",
        model_name: "model-2",
      },
      "auto",
      true,
      {
        enabled: true,
        fast_mode_enabled: false,
        continuation_length: 256,
        sensitivity: 0.4,
      },
      "system prompt",
      "project-2",
    );

    expect(mockSafeInvoke).toHaveBeenCalledWith("aster_agent_chat_stream", {
      request: {
        message: "hello",
        session_id: "session-2",
        event_name: "event-2",
        images: [{ data: "base64", media_type: "image/jpeg" }],
        provider_config: {
          provider_id: "provider-2",
          provider_name: "Provider 2",
          model_name: "model-2",
        },
        project_id: "project-2",
        workspace_id: "workspace-2",
        execution_strategy: "auto",
        web_search: true,
        auto_continue: {
          enabled: true,
          fast_mode_enabled: false,
          continuation_length: 256,
          sensitivity: 0.4,
        },
        system_prompt: "system prompt",
      },
    });
  });

  it("getasterAgentStatus 应兼容映射到旧返回结构", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      initialized: true,
      provider_configured: true,
      provider_name: "Anthropic",
      model_name: "claude-sonnet-4-20250514",
    });

    await expect(getasterAgentStatus()).resolves.toEqual({
      initialized: true,
      provider: "Anthropic",
      model: "claude-sonnet-4-20250514",
    });
  });
});
