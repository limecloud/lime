import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockInitAsterAgent,
  mockSendAsterMessageStream,
  mockCreateAsterSession,
  mockListAsterSessions,
  mockGetAsterSession,
  mockRenameAsterSession,
  mockDeleteAsterSession,
  mockStopAsterSession,
  mockConfirmAsterAction,
  mockSubmitAsterElicitationResponse,
  mockParseStreamEvent,
  mockSafeListen,
  mockToast,
  mockParseSkillSlashCommand,
  mockTryExecuteSlashSkillCommand,
} = vi.hoisted(() => ({
  mockInitAsterAgent: vi.fn(),
  mockSendAsterMessageStream: vi.fn(),
  mockCreateAsterSession: vi.fn(),
  mockListAsterSessions: vi.fn(),
  mockGetAsterSession: vi.fn(),
  mockRenameAsterSession: vi.fn(),
  mockDeleteAsterSession: vi.fn(),
  mockStopAsterSession: vi.fn(),
  mockConfirmAsterAction: vi.fn(),
  mockSubmitAsterElicitationResponse: vi.fn(),
  mockParseStreamEvent: vi.fn((payload: unknown) => payload),
  mockSafeListen: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  mockParseSkillSlashCommand: vi.fn(
    (): { skillName: string; userInput: string } | null => null,
  ),
  mockTryExecuteSlashSkillCommand: vi.fn(async () => false),
}));

vi.mock("@/lib/api/agentRuntime", () => ({
  initAsterAgent: mockInitAsterAgent,
  sendAsterMessageStream: mockSendAsterMessageStream,
  createAsterSession: mockCreateAsterSession,
  listAsterSessions: mockListAsterSessions,
  getAsterSession: mockGetAsterSession,
  renameAsterSession: mockRenameAsterSession,
  deleteAsterSession: mockDeleteAsterSession,
  stopAsterSession: mockStopAsterSession,
  confirmAsterAction: mockConfirmAsterAction,
  submitAsterElicitationResponse: mockSubmitAsterElicitationResponse,
}));

vi.mock("@/lib/api/agentStream", () => ({
  parseStreamEvent: mockParseStreamEvent,
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: mockSafeListen,
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("./skillCommand", () => ({
  parseSkillSlashCommand: mockParseSkillSlashCommand,
  tryExecuteSlashSkillCommand: mockTryExecuteSlashSkillCommand,
}));

import { useAsterAgentChat } from "./useAsterAgentChat";

interface HookHarness {
  getValue: () => ReturnType<typeof useAsterAgentChat>;
  unmount: () => void;
}

function mountHook(workspaceId = "ws-test"): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useAsterAgentChat> | null = null;

  function TestComponent() {
    hookValue = useAsterAgentChat({ workspaceId });
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

function seedSession(workspaceId: string, sessionId: string) {
  sessionStorage.setItem(
    `aster_curr_sessionId_${workspaceId}`,
    JSON.stringify(sessionId),
  );
  sessionStorage.setItem(
    `aster_messages_${workspaceId}`,
    JSON.stringify([
      {
        id: "m-1",
        role: "assistant",
        content: "hello",
        timestamp: new Date().toISOString(),
      },
    ]),
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

  mockInitAsterAgent.mockResolvedValue(undefined);
  mockSendAsterMessageStream.mockResolvedValue(undefined);
  mockCreateAsterSession.mockResolvedValue("created-session");
  mockListAsterSessions.mockResolvedValue([]);
  mockGetAsterSession.mockResolvedValue({
    id: "session-from-api",
    messages: [],
  });
  mockRenameAsterSession.mockResolvedValue(undefined);
  mockDeleteAsterSession.mockResolvedValue(undefined);
  mockStopAsterSession.mockResolvedValue(undefined);
  mockConfirmAsterAction.mockResolvedValue(undefined);
  mockSubmitAsterElicitationResponse.mockResolvedValue(undefined);
  mockSafeListen.mockResolvedValue(() => {});
  mockParseSkillSlashCommand.mockReturnValue(null);
  mockTryExecuteSlashSkillCommand.mockResolvedValue(false);
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("useAsterAgentChat 首页新会话", () => {
  it("clearMessages 后重新进入同工作区不应恢复旧话题", async () => {
    const workspaceId = "ws-home-clear";
    const sessionId = "session-home-clear";
    seedSession(workspaceId, sessionId);

    let harness = mountHook(workspaceId);

    try {
      await flushEffects();
      act(() => {
        harness.getValue().clearMessages({ showToast: false });
      });
      await flushEffects();

      expect(harness.getValue().sessionId).toBeNull();
      expect(harness.getValue().messages).toEqual([]);
      expect(
        sessionStorage.getItem(`aster_curr_sessionId_${workspaceId}`),
      ).toBe("null");
      expect(sessionStorage.getItem(`aster_messages_${workspaceId}`)).toBe(
        "[]",
      );
      expect(localStorage.getItem(`aster_last_sessionId_${workspaceId}`)).toBe(
        "null",
      );
    } finally {
      harness.unmount();
    }

    harness = mountHook(workspaceId);

    try {
      await flushEffects();
      expect(harness.getValue().sessionId).toBeNull();
      expect(harness.getValue().messages).toEqual([]);
    } finally {
      harness.unmount();
    }
  });
});

describe("useAsterAgentChat.confirmAction", () => {
  it("tool_confirmation 应调用 confirmAsterAction", async () => {
    const workspaceId = "ws-tool";
    seedSession(workspaceId, "session-tool");
    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().confirmAction({
          requestId: "req-tool-1",
          confirmed: true,
          response: "允许",
          actionType: "tool_confirmation",
        });
      });

      expect(mockConfirmAsterAction).toHaveBeenCalledTimes(1);
      expect(mockConfirmAsterAction).toHaveBeenCalledWith(
        "req-tool-1",
        true,
        "允许",
      );
      expect(mockSubmitAsterElicitationResponse).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });

  it("elicitation 应调用 submitAsterElicitationResponse 并透传 userData", async () => {
    const workspaceId = "ws-elicitation";
    seedSession(workspaceId, "session-elicitation");
    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().confirmAction({
          requestId: "req-elicitation-1",
          confirmed: true,
          actionType: "elicitation",
          userData: { answer: "A" },
        });
      });

      expect(mockSubmitAsterElicitationResponse).toHaveBeenCalledTimes(1);
      expect(mockSubmitAsterElicitationResponse).toHaveBeenCalledWith(
        "session-elicitation",
        "req-elicitation-1",
        { answer: "A" },
      );
      expect(mockConfirmAsterAction).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });

  it("ask_user 应解析 response JSON 后提交", async () => {
    const workspaceId = "ws-ask-user";
    seedSession(workspaceId, "session-ask-user");
    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().confirmAction({
          requestId: "req-ask-user-1",
          confirmed: true,
          actionType: "ask_user",
          response: '{"answer":"选项A"}',
        });
      });

      expect(mockSubmitAsterElicitationResponse).toHaveBeenCalledTimes(1);
      expect(mockSubmitAsterElicitationResponse).toHaveBeenCalledWith(
        "session-ask-user",
        "req-ask-user-1",
        { answer: "选项A" },
      );
    } finally {
      harness.unmount();
    }
  });
});

describe("useAsterAgentChat slash skill 执行链路", () => {
  it("命中 slash skill 时应走 execute_skill 分支而非 chat_stream", async () => {
    const workspaceId = "ws-slash-skill";
    const harness = mountHook(workspaceId);

    mockParseSkillSlashCommand.mockReturnValue({
      skillName: "social_post_with_cover",
      userInput: "写一篇春季新品文案",
    });
    mockTryExecuteSlashSkillCommand.mockResolvedValue(true);

    try {
      await flushEffects();
      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "/social_post_with_cover 写一篇春季新品文案",
            [],
            false,
            false,
            false,
            "react",
          );
      });

      expect(mockParseSkillSlashCommand).toHaveBeenCalledWith(
        "/social_post_with_cover 写一篇春季新品文案",
      );
      expect(mockTryExecuteSlashSkillCommand).toHaveBeenCalledTimes(1);
      expect(mockSendAsterMessageStream).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });

  it("slash skill 未处理时应回退到 chat_stream", async () => {
    const workspaceId = "ws-slash-fallback";
    const harness = mountHook(workspaceId);

    mockParseSkillSlashCommand.mockReturnValue({
      skillName: "social_post_with_cover",
      userInput: "写一篇春季新品文案",
    });
    mockTryExecuteSlashSkillCommand.mockResolvedValue(false);

    try {
      await flushEffects();
      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "/social_post_with_cover 写一篇春季新品文案",
            [],
            false,
            false,
            false,
            "react",
          );
      });

      expect(mockTryExecuteSlashSkillCommand).toHaveBeenCalledTimes(1);
      expect(mockSendAsterMessageStream).toHaveBeenCalledTimes(1);
    } finally {
      harness.unmount();
    }
  });
});

describe("useAsterAgentChat action_required 渲染链路", () => {
  it("仅收到 Ask 工具调用时应兜底渲染提问面板", async () => {
    const workspaceId = "ws-ask-fallback";
    seedSession(workspaceId, "session-ask-fallback");
    const harness = mountHook(workspaceId);

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
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        streamHandler?.({
          payload: {
            type: "tool_start",
            tool_id: "tool-ask-1",
            tool_name: "Ask",
            arguments: JSON.stringify({
              question: "你希望海报主色调是什么？",
              options: ["蓝紫", "赛博绿"],
            }),
          },
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.actionRequests?.[0]?.actionType).toBe(
        "ask_user",
      );
      expect(
        assistantMessage?.actionRequests?.[0]?.questions?.[0]?.question,
      ).toBe("你希望海报主色调是什么？");
      expect(
        assistantMessage?.actionRequests?.[0]?.questions?.[0]?.options?.map(
          (item) => item.label,
        ),
      ).toEqual(["蓝紫", "赛博绿"]);
    } finally {
      harness.unmount();
    }
  });

  it("Ask fallback 应优先使用参数中的 id 作为 requestId", async () => {
    const workspaceId = "ws-ask-fallback-id";
    seedSession(workspaceId, "session-ask-fallback-id");
    const harness = mountHook(workspaceId);

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
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        streamHandler?.({
          payload: {
            type: "tool_start",
            tool_id: "tool-ask-fallback-id",
            tool_name: "Ask",
            arguments: JSON.stringify({
              id: "req-from-ask-arg",
              question: "你希望主色调是什么？",
            }),
          },
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.actionRequests?.[0]?.requestId).toBe(
        "req-from-ask-arg",
      );
    } finally {
      harness.unmount();
    }
  });

  it("收到 action_required 后应写入消息 actionRequests 与 contentParts", async () => {
    const workspaceId = "ws-action-required";
    seedSession(workspaceId, "session-action-required");
    const harness = mountHook(workspaceId);

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
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        streamHandler?.({
          payload: {
            type: "action_required",
            request_id: "req-ar-1",
            action_type: "elicitation",
            prompt: "请选择一个方案",
            requested_schema: {
              type: "object",
              properties: {
                answer: {
                  type: "string",
                  enum: ["A", "B"],
                },
              },
            },
          },
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.actionRequests?.[0]?.requestId).toBe("req-ar-1");
      expect(
        assistantMessage?.contentParts?.some(
          (part) =>
            part.type === "action_required" &&
            part.actionRequired.requestId === "req-ar-1",
        ),
      ).toBe(true);
    } finally {
      harness.unmount();
    }
  });

  it("action_required 的字符串 options 应归一化为可展示选项", async () => {
    const workspaceId = "ws-action-required-options";
    seedSession(workspaceId, "session-action-required-options");
    const harness = mountHook(workspaceId);

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
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        streamHandler?.({
          payload: {
            type: "action_required",
            request_id: "req-ar-options-1",
            action_type: "ask_user",
            prompt: "请选择执行模式",
            questions: [
              {
                question: "请选择执行模式",
                options: ["自动执行（Auto）", "确认后执行（Ask）"],
              },
            ],
          },
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(
        assistantMessage?.actionRequests?.[0]?.questions?.[0]?.options?.map(
          (option) => option.label,
        ),
      ).toEqual(["自动执行（Auto）", "确认后执行（Ask）"]);
    } finally {
      harness.unmount();
    }
  });

  it("ask_user 提交后应保留只读回显，避免面板消失", async () => {
    const workspaceId = "ws-ask-submit-keep";
    seedSession(workspaceId, "session-ask-submit-keep");
    const harness = mountHook(workspaceId);

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
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        streamHandler?.({
          payload: {
            type: "action_required",
            request_id: "req-ask-submit-1",
            action_type: "ask_user",
            prompt: "请选择执行模式",
            questions: [{ question: "你希望如何执行？" }],
          },
        });
      });

      await act(async () => {
        await harness.getValue().confirmAction({
          requestId: "req-ask-submit-1",
          confirmed: true,
          actionType: "ask_user",
          response: '{"answer":"自动执行（Auto）"}',
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(mockSubmitAsterElicitationResponse).toHaveBeenCalledWith(
        "session-ask-submit-keep",
        "req-ask-submit-1",
        { answer: "自动执行（Auto）" },
      );
      expect(assistantMessage?.actionRequests?.[0]).toMatchObject({
        requestId: "req-ask-submit-1",
        actionType: "ask_user",
        status: "submitted",
        submittedResponse: '{"answer":"自动执行（Auto）"}',
        submittedUserData: { answer: "自动执行（Auto）" },
      });
      expect(
        assistantMessage?.contentParts?.some(
          (part) =>
            part.type === "action_required" &&
            part.actionRequired.requestId === "req-ask-submit-1" &&
            part.actionRequired.status === "submitted",
        ),
      ).toBe(true);
    } finally {
      harness.unmount();
    }
  });

  it("fallback ask 在真实 request_id 未就绪前不应提交，避免卡住", async () => {
    const workspaceId = "ws-ask-fallback-pending";
    seedSession(workspaceId, "session-ask-fallback-pending");
    const harness = mountHook(workspaceId);

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
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        streamHandler?.({
          payload: {
            type: "tool_start",
            tool_id: "tool-fallback-only",
            tool_name: "Ask",
            arguments: JSON.stringify({
              question: "请选择您喜欢的科技风格类型",
              options: ["网络矩阵", "极简未来"],
            }),
          },
        });
      });

      await act(async () => {
        await harness.getValue().confirmAction({
          requestId: "fallback:tool-fallback-only",
          confirmed: true,
          actionType: "ask_user",
          response: '{"answer":"网络矩阵"}',
        });
      });

      expect(mockSubmitAsterElicitationResponse).not.toHaveBeenCalled();
      expect(mockToast.error).toHaveBeenCalledWith(
        "Ask 请求 ID 尚未就绪，请稍后再试",
      );
    } finally {
      harness.unmount();
    }
  });

  it("Auto 模式下 tool_confirmation 应自动确认而不阻塞 UI", async () => {
    const workspaceId = "ws-auto-confirm";
    seedSession(workspaceId, "session-auto-confirm");
    const harness = mountHook(workspaceId);

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
        await harness
          .getValue()
          .sendMessage("执行命令", [], false, false, false, "auto");
      });

      act(() => {
        streamHandler?.({
          payload: {
            type: "action_required",
            request_id: "req-auto-1",
            action_type: "tool_confirmation",
            tool_name: "bash",
            arguments: { command: "ls" },
            prompt: "是否执行命令",
          },
        });
      });

      await flushEffects();

      expect(mockConfirmAsterAction).toHaveBeenCalledWith(
        "req-auto-1",
        true,
        "Auto 模式自动确认",
      );

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");
      expect(assistantMessage?.actionRequests?.length ?? 0).toBe(0);
    } finally {
      harness.unmount();
    }
  });

  it("收到 context_trace 事件后应写入当前 assistant 消息", async () => {
    const workspaceId = "ws-context-trace";
    seedSession(workspaceId, "session-context-trace");
    const harness = mountHook(workspaceId);

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
        await harness
          .getValue()
          .sendMessage("检查轨迹", [], false, false, false, "react");
      });

      act(() => {
        streamHandler?.({
          payload: {
            type: "context_trace",
            steps: [
              {
                stage: "memory_injection",
                detail: "query_len=8,injected=2",
              },
              {
                stage: "memory_injection",
                detail: "query_len=8,injected=2",
              },
            ],
          },
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.contextTrace).toBeDefined();
      expect(assistantMessage?.contextTrace?.length).toBe(1);
      expect(assistantMessage?.contextTrace?.[0]?.stage).toBe(
        "memory_injection",
      );
    } finally {
      harness.unmount();
    }
  });

  it("收到带 ProxyCast 元数据块的 tool_end 后应清洗输出并恢复失败态 metadata", async () => {
    const workspaceId = "ws-tool-metadata-block";
    seedSession(workspaceId, "session-tool-metadata-block");
    const harness = mountHook(workspaceId);

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
        await harness
          .getValue()
          .sendMessage("执行任务", [], false, false, false, "react");
      });

      act(() => {
        streamHandler?.({
          payload: {
            type: "tool_start",
            tool_id: "tool-meta-1",
            tool_name: "SubAgentTask",
            arguments: JSON.stringify({
              prompt: "检查 harness 缺口",
            }),
          },
        });
      });

      act(() => {
        streamHandler?.({
          payload: {
            type: "tool_end",
            tool_id: "tool-meta-1",
            result: {
              success: true,
              output: [
                "子任务执行失败，需要人工接管",
                "",
                "[ProxyCast 工具元数据开始]",
                JSON.stringify({
                  reported_success: false,
                  role: "planner",
                  failed_count: 1,
                }),
                "[ProxyCast 工具元数据结束]",
              ].join("\n"),
            },
          },
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");
      const toolCall = assistantMessage?.toolCalls?.find(
        (item) => item.id === "tool-meta-1",
      );

      expect(toolCall?.status).toBe("failed");
      expect(toolCall?.result?.output).toBe("子任务执行失败，需要人工接管");
      expect(toolCall?.result?.output).not.toContain("ProxyCast 工具元数据");
      expect(toolCall?.result?.metadata).toMatchObject({
        reported_success: false,
        role: "planner",
        failed_count: 1,
      });
    } finally {
      harness.unmount();
    }
  });
});

describe("useAsterAgentChat 偏好持久化", () => {
  it("初始化时应清理 sessionStorage 中空白 user 消息", async () => {
    const workspaceId = "ws-clean-blank-user";
    sessionStorage.setItem(
      `aster_messages_${workspaceId}`,
      JSON.stringify([
        {
          id: "blank-user",
          role: "user",
          content: "",
          timestamp: new Date().toISOString(),
        },
        {
          id: "assistant-text",
          role: "assistant",
          content: "hello",
          timestamp: new Date().toISOString(),
        },
      ]),
    );

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      const value = harness.getValue();
      expect(value.messages).toHaveLength(1);
      expect(value.messages[0]?.role).toBe("assistant");
      expect(value.messages[0]?.content).toBe("hello");
    } finally {
      harness.unmount();
    }
  });

  it("初始化时应将仅含工具轨迹的空白 user 消息归一为 assistant", async () => {
    const workspaceId = "ws-normalize-tool-user";
    sessionStorage.setItem(
      `aster_messages_${workspaceId}`,
      JSON.stringify([
        {
          id: "legacy-user-tool",
          role: "user",
          content: "",
          toolCalls: [
            {
              id: "tool_1",
              name: "bash",
              status: "completed",
              result: {
                success: true,
                output: "ok",
              },
              startTime: new Date().toISOString(),
              endTime: new Date().toISOString(),
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ]),
    );

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      const value = harness.getValue();
      expect(value.messages).toHaveLength(1);
      expect(value.messages[0]?.role).toBe("assistant");
      expect(value.messages[0]?.toolCalls?.[0]).toMatchObject({
        id: "tool_1",
        status: "completed",
      });
    } finally {
      harness.unmount();
    }
  });

  it("初始化时应丢弃带 fallback 工具名的旧缓存消息并触发回源", async () => {
    const workspaceId = "ws-drop-fallback-tool-name-cache";
    sessionStorage.setItem(
      `aster_messages_${workspaceId}`,
      JSON.stringify([
        {
          id: "legacy-fallback-tool-name",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_324abc",
              name: "工具调用 call_324abc",
              status: "completed",
              result: {
                success: true,
                output: "Launching skill: canvas-design",
              },
              startTime: new Date().toISOString(),
              endTime: new Date().toISOString(),
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ]),
    );

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      const value = harness.getValue();
      expect(value.messages).toHaveLength(0);
    } finally {
      harness.unmount();
    }
  });

  it("应将旧全局偏好迁移到当前工作区", async () => {
    localStorage.setItem("agent_pref_provider", JSON.stringify("gemini"));
    localStorage.setItem("agent_pref_model", JSON.stringify("gemini-2.5-pro"));

    const workspaceId = "ws-migrate";
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
    localStorage.setItem("agent_pref_model", JSON.stringify("claude-legacy"));
    localStorage.setItem(
      "agent_pref_provider_ws-prefer-scoped",
      JSON.stringify("deepseek"),
    );
    localStorage.setItem(
      "agent_pref_model_ws-prefer-scoped",
      JSON.stringify("deepseek-reasoner"),
    );

    const harness = mountHook("ws-prefer-scoped");

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

  it("会话已绑定其他工作区时不应覆盖 agent_session_workspace 映射", async () => {
    const workspaceId = "ws-current";
    const sessionId = "session-conflict";
    seedSession(workspaceId, sessionId);
    localStorage.setItem(
      `agent_session_workspace_${sessionId}`,
      JSON.stringify("ws-legacy"),
    );

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      expect(
        JSON.parse(
          localStorage.getItem(`agent_session_workspace_${sessionId}`) ||
            "null",
        ),
      ).toBe("ws-legacy");
    } finally {
      harness.unmount();
    }
  });

  it("会话映射为空占位时应写入当前工作区", async () => {
    const workspaceId = "ws-current";
    const sessionId = "session-invalid-placeholder";
    seedSession(workspaceId, sessionId);
    localStorage.setItem(
      `agent_session_workspace_${sessionId}`,
      JSON.stringify("__invalid__"),
    );

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      expect(
        JSON.parse(
          localStorage.getItem(`agent_session_workspace_${sessionId}`) ||
            "null",
        ),
      ).toBe(workspaceId);
    } finally {
      harness.unmount();
    }
  });

  it("恢复失效会话时不应请求不存在的会话详情", async () => {
    const workspaceId = "ws-stale-session";
    const staleSessionId = "session-stale";
    const activeSessionId = "session-active";
    const now = Math.floor(Date.now() / 1000);

    seedSession(workspaceId, staleSessionId);
    mockListAsterSessions.mockResolvedValue([
      {
        id: activeSessionId,
        name: "可用会话",
        created_at: now - 10,
        updated_at: now,
        messages_count: 1,
      },
    ]);
    mockGetAsterSession.mockResolvedValue({
      id: activeSessionId,
      created_at: now - 10,
      updated_at: now,
      messages: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await flushEffects();
      await flushEffects();

      expect(
        mockGetAsterSession.mock.calls.some(
          ([sessionId]) => sessionId === staleSessionId,
        ),
      ).toBe(false);
      expect(harness.getValue().sessionId).toBe(activeSessionId);
    } finally {
      harness.unmount();
    }
  });

  it("话题列表应按工作区映射过滤，排除其他项目会话", async () => {
    const workspaceId = "ws-filter-current";
    const createdAt = Math.floor(Date.now() / 1000);

    mockListAsterSessions.mockResolvedValue([
      {
        id: "topic-current",
        name: "当前项目话题",
        created_at: createdAt,
        messages_count: 2,
      },
      {
        id: "topic-other",
        name: "其他项目话题",
        created_at: createdAt,
        messages_count: 3,
      },
      {
        id: "topic-legacy",
        name: "历史未映射话题",
        created_at: createdAt,
        messages_count: 1,
      },
    ]);

    localStorage.setItem(
      "agent_session_workspace_topic-current",
      JSON.stringify(workspaceId),
    );
    localStorage.setItem(
      "agent_session_workspace_topic-other",
      JSON.stringify("ws-filter-other"),
    );

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await flushEffects();

      expect(harness.getValue().topics.map((topic) => topic.id)).toEqual([
        "topic-current",
        "topic-legacy",
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("切换话题后应恢复各自模型选择", async () => {
    const workspaceId = "ws-topic-memory";
    const createdAt = Math.floor(Date.now() / 1000);

    mockListAsterSessions.mockResolvedValue([
      {
        id: "topic-a",
        name: "话题 A",
        created_at: createdAt,
        messages_count: 0,
      },
      {
        id: "topic-b",
        name: "话题 B",
        created_at: createdAt,
        messages_count: 0,
      },
    ]);
    mockGetAsterSession.mockImplementation(async (topicId: string) => ({
      id: topicId,
      messages: [],
      execution_strategy: "react",
    }));

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await flushEffects();

      await act(async () => {
        await harness.getValue().switchTopic("topic-a");
      });
      act(() => {
        harness.getValue().setProviderType("gemini");
        harness.getValue().setModel("gemini-2.5-pro");
      });
      await flushEffects();

      await act(async () => {
        await harness.getValue().switchTopic("topic-b");
      });
      act(() => {
        harness.getValue().setProviderType("deepseek");
        harness.getValue().setModel("deepseek-chat");
      });
      await flushEffects();

      await act(async () => {
        await harness.getValue().switchTopic("topic-a");
      });
      await flushEffects();

      const value = harness.getValue();
      expect(value.providerType).toBe("gemini");
      expect(value.model).toBe("gemini-2.5-pro");
      expect(
        JSON.parse(
          localStorage.getItem(
            `agent_topic_model_pref_${workspaceId}_topic-a`,
          ) || "null",
        ),
      ).toEqual({
        providerType: "gemini",
        model: "gemini-2.5-pro",
      });
      expect(
        JSON.parse(
          localStorage.getItem(
            `agent_topic_model_pref_${workspaceId}_topic-b`,
          ) || "null",
        ),
      ).toEqual({
        providerType: "deepseek",
        model: "deepseek-chat",
      });
    } finally {
      harness.unmount();
    }
  });

  it("选择模型后立即切换话题也应保存当前话题选择", async () => {
    const workspaceId = "ws-topic-memory-immediate";
    const createdAt = Math.floor(Date.now() / 1000);

    mockListAsterSessions.mockResolvedValue([
      {
        id: "topic-a",
        name: "话题 A",
        created_at: createdAt,
        messages_count: 0,
      },
      {
        id: "topic-b",
        name: "话题 B",
        created_at: createdAt,
        messages_count: 0,
      },
    ]);
    mockGetAsterSession.mockImplementation(async (topicId: string) => ({
      id: topicId,
      messages: [],
      execution_strategy: "react",
    }));

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await flushEffects();

      await act(async () => {
        await harness.getValue().switchTopic("topic-a");
      });

      await act(async () => {
        harness.getValue().setProviderType("zhipu");
        harness.getValue().setModel("glm-4.7");
        await harness.getValue().switchTopic("topic-b");
      });

      await act(async () => {
        harness.getValue().setProviderType("antigravity");
        harness.getValue().setModel("gemini-3-pro-image-preview");
      });
      await flushEffects();

      await act(async () => {
        await harness.getValue().switchTopic("topic-a");
      });
      await flushEffects();

      const value = harness.getValue();
      expect(value.providerType).toBe("zhipu");
      expect(value.model).toBe("glm-4.7");
      expect(
        JSON.parse(
          localStorage.getItem(
            `agent_topic_model_pref_${workspaceId}_topic-a`,
          ) || "null",
        ),
      ).toEqual({
        providerType: "zhipu",
        model: "glm-4.7",
      });
    } finally {
      harness.unmount();
    }
  });

  it("切换话题时应保留工具调用历史并恢复 elicitation 回答文本", async () => {
    const workspaceId = "ws-history-hydrate";
    const now = Math.floor(Date.now() / 1000);
    mockGetAsterSession.mockResolvedValue({
      id: "topic-history",
      execution_strategy: "react",
      messages: [
        {
          role: "assistant",
          timestamp: now,
          content: [
            {
              type: "tool_request",
              id: "tool-1",
              tool_name: "Ask",
              arguments: { question: "请选择" },
            },
          ],
        },
        {
          role: "user",
          timestamp: now + 1,
          content: [
            {
              type: "action_required",
              action_type: "elicitation_response",
              data: { user_data: { answer: "自动执行（Auto）" } },
            },
          ],
        },
        {
          role: "assistant",
          timestamp: now + 2,
          content: [{ type: "text", text: "已收到你的选择，继续执行。" }],
        },
      ],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic("topic-history");
      });

      const value = harness.getValue();
      expect(value.messages).toHaveLength(3);
      expect(value.messages[0]).toMatchObject({
        role: "assistant",
      });
      expect(
        value.messages[0]?.contentParts?.some(
          (part) => part.type === "tool_use" && part.toolCall.id === "tool-1",
        ),
      ).toBe(true);
      expect(value.messages[1]).toMatchObject({
        role: "user",
        content: "自动执行（Auto）",
      });
      expect(value.messages[2]).toMatchObject({
        role: "assistant",
        content: "已收到你的选择，继续执行。",
      });
    } finally {
      harness.unmount();
    }
  });

  it("切换话题时应恢复 input_image 历史消息", async () => {
    const workspaceId = "ws-history-image";
    const now = Math.floor(Date.now() / 1000);
    mockGetAsterSession.mockResolvedValue({
      id: "topic-image",
      execution_strategy: "react",
      messages: [
        {
          role: "user",
          timestamp: now,
          content: [
            {
              type: "input_text",
              text: "请参考这张图",
            },
            {
              type: "input_image",
              image_url: "data:image/png;base64,aGVsbG8=",
            },
          ],
        },
        {
          role: "assistant",
          timestamp: now + 1,
          content: [{ type: "output_text", text: "已收到图片" }],
        },
      ],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic("topic-image");
      });

      const value = harness.getValue();
      expect(value.messages).toHaveLength(2);
      expect(value.messages[0]).toMatchObject({
        role: "user",
        content: "请参考这张图",
      });
      expect(value.messages[0]?.images).toEqual([
        {
          mediaType: "image/png",
          data: "aGVsbG8=",
        },
      ]);
      expect(value.messages[1]).toMatchObject({
        role: "assistant",
        content: "已收到图片",
      });
    } finally {
      harness.unmount();
    }
  });

  it("切换话题时应将仅含 tool_response 协议的空白 user 消息归一为 assistant 轨迹", async () => {
    const workspaceId = "ws-history-empty-user-tool-response";
    const now = Math.floor(Date.now() / 1000);
    mockGetAsterSession.mockResolvedValue({
      id: "topic-empty-user",
      execution_strategy: "react",
      messages: [
        {
          role: "user",
          timestamp: now,
          content: [
            { type: "text", text: "/canvas-design 帮我设计一张科技感的海报" },
          ],
        },
        {
          role: "assistant",
          timestamp: now + 1,
          content: [{ type: "text", text: "我来帮你设计一张科技感的海报！" }],
        },
        {
          role: "user",
          timestamp: now + 2,
          content: [
            {
              type: "tool_response",
              id: "call_xxx",
              success: true,
              output: "",
            },
          ],
        },
        {
          role: "assistant",
          timestamp: now + 3,
          content: [{ type: "text", text: "好的！让我为你创建一张科技海报。" }],
        },
      ],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic("topic-empty-user");
      });

      const value = harness.getValue();
      expect(value.messages).toHaveLength(2);
      expect(value.messages.map((msg) => msg.role)).toEqual([
        "user",
        "assistant",
      ]);
      expect(value.messages[1]?.content).toContain(
        "我来帮你设计一张科技感的海报！",
      );
      expect(value.messages[1]?.content).toContain(
        "好的！让我为你创建一张科技海报。",
      );
      expect(
        value.messages.some((msg) => msg.content.trim().length === 0),
      ).toBe(false);
      expect(
        value.messages[1]?.contentParts?.some(
          (part) =>
            part.type === "tool_use" &&
            part.toolCall.id === "call_xxx" &&
            part.toolCall.status === "completed",
        ),
      ).toBe(true);
    } finally {
      harness.unmount();
    }
  });

  it("切换话题时应从 tool_response 输出中提取图片并写入工具结果", async () => {
    const workspaceId = "ws-history-tool-image";
    const now = Math.floor(Date.now() / 1000);
    mockGetAsterSession.mockResolvedValue({
      id: "topic-tool-image",
      execution_strategy: "react",
      messages: [
        {
          role: "assistant",
          timestamp: now,
          content: [{ type: "text", text: "正在处理海报" }],
        },
        {
          role: "tool",
          timestamp: now + 1,
          content: [
            {
              type: "tool_response",
              id: "tool-image-1",
              success: true,
              output:
                "图片生成完成\ndata:image/png;base64,aGVsbG8=\n你可以继续编辑",
            },
          ],
        },
      ],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic("topic-tool-image");
      });

      const value = harness.getValue();
      expect(value.messages).toHaveLength(1);
      const toolPart = value.messages[0]?.contentParts?.find(
        (part) =>
          part.type === "tool_use" && part.toolCall.id === "tool-image-1",
      );
      expect(toolPart?.type).toBe("tool_use");
      if (toolPart?.type === "tool_use") {
        expect(toolPart.toolCall.result?.images?.[0]?.src).toBe(
          "data:image/png;base64,aGVsbG8=",
        );
      }
    } finally {
      harness.unmount();
    }
  });

  it("切换话题时应合并同一工具调用的 running/completed 轨迹为一条", async () => {
    const workspaceId = "ws-history-tool-dedupe";
    const now = Math.floor(Date.now() / 1000);
    mockGetAsterSession.mockResolvedValue({
      id: "topic-tool-dedupe",
      execution_strategy: "react",
      messages: [
        {
          role: "assistant",
          timestamp: now,
          content: [
            {
              type: "tool_request",
              id: "call_dup_1",
              tool_name: "Task",
              arguments: { command: "echo hi" },
            },
          ],
        },
        {
          role: "user",
          timestamp: now + 1,
          content: [
            {
              type: "tool_response",
              id: "call_dup_1",
              success: true,
              output: "done",
            },
          ],
        },
      ],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic("topic-tool-dedupe");
      });

      const value = harness.getValue();
      expect(value.messages).toHaveLength(1);

      const toolParts = (value.messages[0]?.contentParts || []).filter(
        (part) => part.type === "tool_use" && part.toolCall.id === "call_dup_1",
      );
      expect(toolParts).toHaveLength(1);
      if (toolParts[0]?.type === "tool_use") {
        expect(toolParts[0].toolCall.status).toBe("completed");
      }
    } finally {
      harness.unmount();
    }
  });

  it("切换话题时应合并连续 assistant 历史片段", async () => {
    const workspaceId = "ws-history-merge";
    const now = Math.floor(Date.now() / 1000);
    mockGetAsterSession.mockResolvedValue({
      id: "topic-merge",
      execution_strategy: "react",
      messages: [
        {
          role: "assistant",
          timestamp: now,
          content: [{ type: "text", text: "先执行工具" }],
        },
        {
          role: "tool",
          timestamp: now + 1,
          content: [
            {
              type: "tool_response",
              id: "tool-merge-1",
              success: true,
              output: "ok",
            },
          ],
        },
        {
          role: "assistant",
          timestamp: now + 2,
          content: [{ type: "text", text: "工具执行完成" }],
        },
      ],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic("topic-merge");
      });

      const value = harness.getValue();
      expect(value.messages).toHaveLength(1);
      expect(value.messages[0]).toMatchObject({
        role: "assistant",
        content: "先执行工具\n\n工具执行完成",
      });
      expect(
        value.messages[0]?.contentParts?.some(
          (part) =>
            part.type === "tool_use" &&
            part.toolCall.id === "tool-merge-1" &&
            part.toolCall.status === "completed",
        ),
      ).toBe(true);
    } finally {
      harness.unmount();
    }
  });

  it("切换话题时应去重相邻重复历史消息", async () => {
    const workspaceId = "ws-history-adjacent-dedupe";
    const now = Math.floor(Date.now() / 1000);
    mockGetAsterSession.mockResolvedValue({
      id: "topic-adjacent-dedupe",
      execution_strategy: "react",
      messages: [
        {
          role: "user",
          timestamp: now,
          content: [{ type: "text", text: "你好" }],
        },
        {
          role: "user",
          timestamp: now + 1,
          content: [{ type: "text", text: "你好" }],
        },
        {
          role: "assistant",
          timestamp: now + 2,
          content: [{ type: "text", text: "你好，我在。" }],
        },
        {
          role: "assistant",
          timestamp: now + 3,
          content: [{ type: "text", text: "你好，我在。" }],
        },
      ],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic("topic-adjacent-dedupe");
      });

      const value = harness.getValue();
      expect(value.messages).toHaveLength(2);
      expect(value.messages[0]).toMatchObject({
        role: "user",
        content: "你好",
      });
      expect(value.messages[1]).toMatchObject({
        role: "assistant",
        content: "你好，我在。",
      });
    } finally {
      harness.unmount();
    }
  });
});

describe("useAsterAgentChat 兼容接口", () => {
  it("triggerAIGuide 应仅生成 assistant 占位消息", async () => {
    const harness = mountHook("ws-guide");

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().triggerAIGuide();
      });

      const value = harness.getValue();
      expect(value.messages).toHaveLength(1);
      expect(value.messages[0]?.role).toBe("assistant");
      expect(mockSendAsterMessageStream).toHaveBeenCalledTimes(1);
      expect(mockSendAsterMessageStream.mock.calls[0]?.[0]).toBe("");
    } finally {
      harness.unmount();
    }
  });

  it("triggerAIGuide 传入引导词时应发送该引导词", async () => {
    const harness = mountHook("ws-guide-social");
    const prompt = "请先确认社媒平台和目标受众。";

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().triggerAIGuide(prompt);
      });

      const value = harness.getValue();
      expect(value.messages).toHaveLength(1);
      expect(value.messages[0]?.role).toBe("assistant");
      expect(mockSendAsterMessageStream).toHaveBeenCalledTimes(1);
      expect(mockSendAsterMessageStream.mock.calls[0]?.[0]).toBe(prompt);
    } finally {
      harness.unmount();
    }
  });

  it("发送请求时应透传 provider_id，避免 custom provider 类型丢失", async () => {
    const harness = mountHook("ws-provider-id");
    const providerId = "custom-a32774c6-6fd0-433b-8b81-e95340e08793";
    const model = "gpt-5.3-codex";

    try {
      await flushEffects();
      act(() => {
        harness.getValue().setProviderType(providerId);
        harness.getValue().setModel(model);
      });
      await flushEffects();

      await act(async () => {
        await harness.getValue().triggerAIGuide("检查 provider_id 透传");
      });

      expect(mockSendAsterMessageStream).toHaveBeenCalledTimes(1);
      expect(mockSendAsterMessageStream.mock.calls[0]?.[5]).toMatchObject({
        provider_id: providerId,
        provider_name: providerId,
        model_name: model,
      });
    } finally {
      harness.unmount();
    }
  });

  it("triggerAIGuide 应使用工作区已选模型发送请求", async () => {
    const workspaceId = "ws-guide-selected-model";
    const selectedProvider = "gemini";
    const selectedModel = "gemini-2.5-pro";
    localStorage.setItem(
      `agent_pref_provider_${workspaceId}`,
      JSON.stringify(selectedProvider),
    );
    localStorage.setItem(
      `agent_pref_model_${workspaceId}`,
      JSON.stringify(selectedModel),
    );

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().triggerAIGuide("请输出一版社媒主稿");
      });

      expect(mockSendAsterMessageStream).toHaveBeenCalledTimes(1);
      expect(mockSendAsterMessageStream.mock.calls[0]?.[5]).toMatchObject({
        provider_id: selectedProvider,
        model_name: selectedModel,
      });
    } finally {
      harness.unmount();
    }
  });

  it("renameTopic 应调用后端并刷新话题标题", async () => {
    const createdAt = Math.floor(Date.now() / 1000);
    mockListAsterSessions
      .mockResolvedValue([
        {
          id: "topic-1",
          name: "新标题",
          created_at: createdAt,
          messages_count: 2,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "topic-1",
          name: "旧标题",
          created_at: createdAt,
          messages_count: 2,
        },
      ]);

    const harness = mountHook("ws-rename");

    try {
      await flushEffects();
      await flushEffects();

      await act(async () => {
        await harness.getValue().renameTopic("topic-1", "新标题");
      });

      expect(mockRenameAsterSession).toHaveBeenCalledTimes(1);
      expect(mockRenameAsterSession).toHaveBeenCalledWith("topic-1", "新标题");

      const renamedTopic = harness
        .getValue()
        .topics.find((topic) => topic.id === "topic-1");
      expect(renamedTopic?.title).toBe("新标题");
    } finally {
      harness.unmount();
    }
  });

  it("deleteTopic 应调用后端并刷新话题列表", async () => {
    const createdAt = Math.floor(Date.now() / 1000);
    let currentSessions = [
      {
        id: "topic-1",
        name: "旧标题",
        created_at: createdAt,
        messages_count: 2,
      },
    ];

    mockListAsterSessions.mockImplementation(async () => currentSessions);
    mockDeleteAsterSession.mockImplementation(async () => {
      currentSessions = [];
    });

    const harness = mountHook("ws-delete");

    try {
      await flushEffects();
      await flushEffects();

      await act(async () => {
        await harness.getValue().deleteTopic("topic-1");
      });

      expect(mockDeleteAsterSession).toHaveBeenCalledTimes(1);
      expect(mockDeleteAsterSession).toHaveBeenCalledWith("topic-1");

      const deletedTopic = harness
        .getValue()
        .topics.find((topic) => topic.id === "topic-1");
      expect(deletedTopic).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });
});
