import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockStartAgentProcess,
  mockStopAgentProcess,
  mockGetAgentProcessStatus,
  mockCreateAgentSession,
  mockSendAsterMessageStream,
  mockListAgentSessions,
  mockDeleteAgentSession,
  mockGetAgentSessionMessages,
  mockRenameAgentSession,
  mockGenerateAgentTitle,
  mockParseStreamEvent,
  mockConfirmAsterAction,
  mockSubmitAsterElicitationResponse,
  mockStopAsterSession,
  mockSafeListen,
  mockGetProviderConfig,
} = vi.hoisted(() => ({
  mockStartAgentProcess: vi.fn(),
  mockStopAgentProcess: vi.fn(),
  mockGetAgentProcessStatus: vi.fn(),
  mockCreateAgentSession: vi.fn(),
  mockSendAsterMessageStream: vi.fn(),
  mockListAgentSessions: vi.fn(),
  mockDeleteAgentSession: vi.fn(),
  mockGetAgentSessionMessages: vi.fn(),
  mockRenameAgentSession: vi.fn(),
  mockGenerateAgentTitle: vi.fn(),
  mockParseStreamEvent: vi.fn((payload: unknown) => payload),
  mockConfirmAsterAction: vi.fn(),
  mockSubmitAsterElicitationResponse: vi.fn(),
  mockStopAsterSession: vi.fn(),
  mockSafeListen: vi.fn(),
  mockGetProviderConfig: vi.fn(),
}));

vi.mock("@/lib/api/agentRuntime", () => ({
  startAgentProcess: mockStartAgentProcess,
  stopAgentProcess: mockStopAgentProcess,
  getAgentProcessStatus: mockGetAgentProcessStatus,
  createAgentSession: mockCreateAgentSession,
  sendAsterMessageStream: mockSendAsterMessageStream,
  listAgentSessions: mockListAgentSessions,
  deleteAgentSession: mockDeleteAgentSession,
  getAgentSessionMessages: mockGetAgentSessionMessages,
  renameAgentSession: mockRenameAgentSession,
  generateAgentTitle: mockGenerateAgentTitle,
  confirmAsterAction: mockConfirmAsterAction,
  submitAsterElicitationResponse: mockSubmitAsterElicitationResponse,
  stopAsterSession: mockStopAsterSession,
}));

vi.mock("@/lib/api/agentStream", () => ({
  parseStreamEvent: mockParseStreamEvent,
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: mockSafeListen,
}));

vi.mock("@/lib/artifact/hooks/useArtifactParser", () => ({
  useArtifactParser: () => ({
    startParsing: vi.fn(),
    appendChunk: vi.fn(),
    finalizeParsing: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock("./skillCommand", () => ({
  parseSkillSlashCommand: vi.fn(() => null),
  tryExecuteSlashSkillCommand: vi.fn(async () => false),
}));

vi.mock("../utils/sessionRecovery", () => ({
  isValidSessionId: vi.fn(() => true),
  resolveRestorableSessionId: vi.fn(() => null),
}));

vi.mock("../types", () => {
  const providerConfig = {
    claude: { models: ["claude-sonnet-4-5", "claude-opus-4"] },
    gemini: { models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
    deepseek: { models: ["deepseek-reasoner", "deepseek-chat"] },
  };

  return {
    PROVIDER_CONFIG: providerConfig,
    getProviderConfig: mockGetProviderConfig,
  };
});

import { useAgentChat } from "./useAgentChat";

interface HookHarness {
  getValue: () => ReturnType<typeof useAgentChat>;
  unmount: () => void;
}

function mountHook(workspaceId = "ws-test"): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useAgentChat> | null = null;

  function TestComponent() {
    hookValue = useAgentChat({ workspaceId });
    return null;
  }

  act(() => {
    root.render(<TestComponent />);
  });

  return {
    getValue: () => {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function seedSession(
  workspaceId: string,
  sessionId: string,
  messages: Array<Record<string, unknown>>,
) {
  sessionStorage.setItem(
    `agent_curr_sessionId_${workspaceId}`,
    JSON.stringify(sessionId),
  );
  sessionStorage.setItem(
    `agent_messages_${workspaceId}`,
    JSON.stringify(messages),
  );
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();

  mockStartAgentProcess.mockResolvedValue(undefined);
  mockStopAgentProcess.mockResolvedValue(undefined);
  mockGetAgentProcessStatus.mockResolvedValue({ running: false });
  mockCreateAgentSession.mockResolvedValue({ session_id: "session-created" });
  mockSendAsterMessageStream.mockResolvedValue(undefined);
  mockListAgentSessions.mockResolvedValue([]);
  mockDeleteAgentSession.mockResolvedValue(undefined);
  mockGetAgentSessionMessages.mockResolvedValue([]);
  mockRenameAgentSession.mockResolvedValue(undefined);
  mockGenerateAgentTitle.mockResolvedValue("新话题");
  mockConfirmAsterAction.mockResolvedValue(undefined);
  mockSubmitAsterElicitationResponse.mockResolvedValue(undefined);
  mockStopAsterSession.mockResolvedValue(undefined);
  mockParseStreamEvent.mockImplementation((payload: unknown) => payload);
  mockSafeListen.mockResolvedValue(() => {});

  mockGetProviderConfig.mockResolvedValue({
    claude: { models: ["claude-sonnet-4-5", "claude-opus-4"] },
    gemini: { models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
    deepseek: { models: ["deepseek-reasoner", "deepseek-chat"] },
  });
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("useAgentChat 权限响应", () => {
  it("ask_user 提交应透传统一的 elicitation_context metadata", async () => {
    const workspaceId = "ws-native-action-meta";
    seedSession(workspaceId, "session-native-action-meta", [
      {
        id: "assistant-1",
        role: "assistant",
        content: "请选择执行模式",
        timestamp: new Date().toISOString(),
        actionRequests: [
          {
            requestId: "req-native-ask-1",
            actionType: "ask_user",
            prompt: "请选择执行模式",
            questions: [{ question: "你希望如何执行？" }],
            status: "pending",
          },
        ],
      },
    ]);
    const harness = mountHook(workspaceId);

    try {
      await flushEffects();

      await act(async () => {
        await harness.getValue().handlePermissionResponse({
          requestId: "req-native-ask-1",
          confirmed: true,
          actionType: "ask_user",
          response: '{"answer":"自动执行"}',
        });
      });

      expect(mockSubmitAsterElicitationResponse).toHaveBeenCalledWith(
        "session-native-action-meta",
        "req-native-ask-1",
        { answer: "自动执行" },
        {
          elicitation_context: {
            source: "action_required",
            mode: "runtime_protocol",
            form_id: "req-native-ask-1",
            action_type: "ask_user",
            field_count: 1,
            prompt: "请选择执行模式",
            entries: [
              {
                fieldId: "req-native-ask-1_answer",
                fieldKey: "answer",
                label: "你希望如何执行？",
                value: "自动执行",
                summary: "自动执行",
              },
            ],
          },
        },
      );
    } finally {
      harness.unmount();
    }
  });
});

describe("useAgentChat 偏好持久化", () => {
  it("应将旧全局偏好迁移到当前工作区", async () => {
    localStorage.setItem("agent_pref_provider", JSON.stringify("gemini"));
    localStorage.setItem("agent_pref_model", JSON.stringify("gemini-2.5-pro"));

    const workspaceId = "ws-native-migrate";
    const harness = mountHook(workspaceId);

    try {
      await flushEffects();

      const value = harness.getValue();
      expect(value.providerType).toBe("gemini");
      expect(value.model).toBe("gemini-2.5-pro");
      expect(
        JSON.parse(
          localStorage.getItem(`agent_pref_provider_${workspaceId}`) || "null",
        ),
      ).toBe("gemini");
      expect(
        JSON.parse(
          localStorage.getItem(`agent_pref_model_${workspaceId}`) || "null",
        ),
      ).toBe("gemini-2.5-pro");
      expect(
        JSON.parse(
          localStorage.getItem(`agent_pref_migrated_${workspaceId}`) || "false",
        ),
      ).toBe(true);
    } finally {
      harness.unmount();
    }
  });

  it("应优先使用工作区偏好而不是旧全局偏好", async () => {
    localStorage.setItem("agent_pref_provider", JSON.stringify("claude"));
    localStorage.setItem("agent_pref_model", JSON.stringify("claude-opus-4"));
    localStorage.setItem(
      "agent_pref_provider_ws-native-scoped",
      JSON.stringify("deepseek"),
    );
    localStorage.setItem(
      "agent_pref_model_ws-native-scoped",
      JSON.stringify("deepseek-reasoner"),
    );

    const harness = mountHook("ws-native-scoped");

    try {
      await flushEffects();

      const value = harness.getValue();
      expect(value.providerType).toBe("deepseek");
      expect(value.model).toBe("deepseek-reasoner");
    } finally {
      harness.unmount();
    }
  });

  it("无工作区时应保留全局模型偏好（切主题不丢失）", async () => {
    const firstMount = mountHook("");

    try {
      await flushEffects();
      act(() => {
        firstMount.getValue().setProviderType("gemini");
        firstMount.getValue().setModel("gemini-2.5-pro");
      });
      await flushEffects();
    } finally {
      firstMount.unmount();
    }

    const secondMount = mountHook("");
    try {
      await flushEffects();
      const value = secondMount.getValue();
      expect(value.providerType).toBe("gemini");
      expect(value.model).toBe("gemini-2.5-pro");
      expect(
        JSON.parse(
          localStorage.getItem("agent_pref_provider_global") || "null",
        ),
      ).toBe("gemini");
      expect(
        JSON.parse(localStorage.getItem("agent_pref_model_global") || "null"),
      ).toBe("gemini-2.5-pro");
    } finally {
      secondMount.unmount();
    }
  });
});

describe("useAgentChat 会话创建", () => {
  it("创建新会话时不应默认注入已安装 skills", async () => {
    const harness = mountHook("ws-session-create");

    try {
      await flushEffects();

      await act(async () => {
        await harness.getValue().sendMessage("普通对话消息", [], false, false);
      });

      expect(mockCreateAgentSession).toHaveBeenCalledTimes(1);
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        "claude",
        "ws-session-create",
        "claude-sonnet-4-5",
        undefined,
      );
      expect(mockCreateAgentSession.mock.calls[0]).toHaveLength(4);
    } finally {
      harness.unmount();
    }
  });

  it("旧链路收到带 ProxyCast 元数据块的 tool_end error 时应清洗错误文本", async () => {
    const harness = mountHook("ws-native-tool-error");

    let streamHandler: ((event: { payload: unknown }) => void) | null = null;
    mockSafeListen.mockImplementationOnce(async (_eventName, handler) => {
      streamHandler = handler as (event: { payload: unknown }) => void;
      return () => {
        streamHandler = null;
      };
    });

    try {
      await flushEffects();

      await act(async () => {
        await harness.getValue().sendMessage("测试旧链路", [], false, false);
      });

      act(() => {
        streamHandler?.({
          payload: {
            type: "tool_start",
            tool_id: "native-tool-1",
            tool_name: "browser_navigate",
            arguments: JSON.stringify({
              url: "https://example.com",
            }),
          },
        });
      });

      act(() => {
        streamHandler?.({
          payload: {
            type: "tool_end",
            tool_id: "native-tool-1",
            result: {
              success: true,
              output: "",
              error: [
                "CDP 会话已断开，请重试",
                "",
                "[ProxyCast 工具元数据开始]",
                JSON.stringify({
                  reported_success: false,
                  exit_code: 1,
                }),
                "[ProxyCast 工具元数据结束]",
              ].join("\n"),
            },
          },
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((message) => message.role === "assistant");
      const toolCall = assistantMessage?.toolCalls?.find(
        (item) => item.id === "native-tool-1",
      );

      expect(toolCall?.status).toBe("failed");
      expect(toolCall?.result?.error).toBe("CDP 会话已断开，请重试");
      expect(toolCall?.result?.error).not.toContain("ProxyCast 工具元数据");
      expect(toolCall?.result?.metadata).toMatchObject({
        reported_success: false,
        exit_code: 1,
      });
    } finally {
      harness.unmount();
    }
  });
});
