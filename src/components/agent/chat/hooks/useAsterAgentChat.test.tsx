import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WriteArtifactContext } from "../types";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";

const {
  mockInitAsterAgent,
  mockSubmitAgentRuntimeTurn,
  mockCreateAgentRuntimeSession,
  mockListAgentRuntimeSessions,
  mockGetAgentRuntimeSession,
  mockGetAgentRuntimeThreadRead,
  mockUpdateAgentRuntimeSession,
  mockDeleteAgentRuntimeSession,
  mockCompactAgentRuntimeSession,
  mockInterruptAgentRuntimeTurn,
  mockResumeAgentRuntimeThread,
  mockReplayAgentRuntimeRequest,
  mockPromoteAgentRuntimeQueuedTurn,
  mockRemoveAgentRuntimeQueuedTurn,
  mockRespondAgentRuntimeAction,
  mockParseAgentEvent,
  mockSafeListen,
  mockToast,
  mockParseSkillSlashCommand,
  mockTryExecuteSlashSkillCommand,
  mockWechatChannelSetRuntimeModel,
} = vi.hoisted(() => ({
  mockInitAsterAgent: vi.fn(),
  mockSubmitAgentRuntimeTurn: vi.fn(),
  mockCreateAgentRuntimeSession: vi.fn(),
  mockListAgentRuntimeSessions: vi.fn(),
  mockGetAgentRuntimeSession: vi.fn(),
  mockGetAgentRuntimeThreadRead: vi.fn(),
  mockUpdateAgentRuntimeSession: vi.fn(),
  mockDeleteAgentRuntimeSession: vi.fn(),
  mockCompactAgentRuntimeSession: vi.fn(),
  mockInterruptAgentRuntimeTurn: vi.fn(),
  mockResumeAgentRuntimeThread: vi.fn(),
  mockReplayAgentRuntimeRequest: vi.fn(),
  mockPromoteAgentRuntimeQueuedTurn: vi.fn(),
  mockRemoveAgentRuntimeQueuedTurn: vi.fn(),
  mockRespondAgentRuntimeAction: vi.fn(),
  mockParseAgentEvent: vi.fn((payload: unknown) => payload),
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
  mockWechatChannelSetRuntimeModel: vi.fn(async () => undefined),
}));

vi.mock("@/lib/api/agentRuntime", () => ({
  initAsterAgent: mockInitAsterAgent,
  submitAgentRuntimeTurn: mockSubmitAgentRuntimeTurn,
  createAgentRuntimeSession: mockCreateAgentRuntimeSession,
  listAgentRuntimeSessions: mockListAgentRuntimeSessions,
  getAgentRuntimeSession: mockGetAgentRuntimeSession,
  getAgentRuntimeThreadRead: mockGetAgentRuntimeThreadRead,
  updateAgentRuntimeSession: mockUpdateAgentRuntimeSession,
  deleteAgentRuntimeSession: mockDeleteAgentRuntimeSession,
  compactAgentRuntimeSession: mockCompactAgentRuntimeSession,
  interruptAgentRuntimeTurn: mockInterruptAgentRuntimeTurn,
  resumeAgentRuntimeThread: mockResumeAgentRuntimeThread,
  replayAgentRuntimeRequest: mockReplayAgentRuntimeRequest,
  promoteAgentRuntimeQueuedTurn: mockPromoteAgentRuntimeQueuedTurn,
  removeAgentRuntimeQueuedTurn: mockRemoveAgentRuntimeQueuedTurn,
  respondAgentRuntimeAction: mockRespondAgentRuntimeAction,
}));

vi.mock("@/lib/api/agentProtocol", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/agentProtocol")
  >("@/lib/api/agentProtocol");
  return {
    ...actual,
    parseAgentEvent: mockParseAgentEvent,
  };
});

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: mockSafeListen,
  hasDevBridgeEventListenerCapability: vi.fn(() => false),
  isDevBridgeAvailable: vi.fn(() => false),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("./skillCommand", () => ({
  parseSkillSlashCommand: mockParseSkillSlashCommand,
  tryExecuteSlashSkillCommand: mockTryExecuteSlashSkillCommand,
}));

vi.mock("@/lib/api/channelsRuntime", () => ({
  wechatChannelSetRuntimeModel: mockWechatChannelSetRuntimeModel,
}));

import { useAsterAgentChat } from "./useAsterAgentChat";

interface HookHarness {
  getValue: () => ReturnType<typeof useAsterAgentChat>;
  getRenderCount: () => number;
  unmount: () => void;
}

function mountHook(
  workspaceId = "ws-test",
  currentOptions: {
    onWriteFile?: (
      content: string,
      fileName: string,
      context?: WriteArtifactContext,
    ) => void;
    getSyncedSessionRecentPreferences?: (
      sessionId: string,
    ) => ChatToolPreferences | null;
  } = {},
): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useAsterAgentChat> | null = null;
  let renderCount = 0;

  function TestComponent() {
    renderCount += 1;
    hookValue = useAsterAgentChat({
      workspaceId,
      onWriteFile: currentOptions.onWriteFile,
      getSyncedSessionRecentPreferences:
        currentOptions.getSyncedSessionRecentPreferences,
    });
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
    getRenderCount: () => renderCount,
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

function captureTurnStream() {
  return captureRuntimeStream((eventName) => {
    return (
      typeof eventName === "string" && eventName.startsWith("aster_stream_")
    );
  });
}

function captureContextCompactionStream() {
  return captureRuntimeStream((eventName) => {
    return (
      typeof eventName === "string" &&
      eventName.startsWith("agent_context_compaction_")
    );
  });
}

function captureRuntimeStream(matcher: (eventName: unknown) => boolean) {
  let streamHandler: ((event: { payload: unknown }) => void) | null = null;
  let activeEventName: string | null = null;

  mockSafeListen.mockImplementation(async (eventName, handler) => {
    if (matcher(eventName)) {
      streamHandler = handler as (event: { payload: unknown }) => void;
      activeEventName =
        typeof eventName === "string" ? eventName : String(eventName);
      return () => {
        if (streamHandler === handler) {
          streamHandler = null;
        }
        if (activeEventName === eventName) {
          activeEventName = null;
        }
      };
    }
    return () => {};
  });

  return {
    emit(payload: unknown) {
      streamHandler?.({ payload });
    },
    getEventName() {
      return activeEventName;
    },
  };
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

  mockInitAsterAgent.mockReset();
  mockSubmitAgentRuntimeTurn.mockReset();
  mockCreateAgentRuntimeSession.mockReset();
  mockListAgentRuntimeSessions.mockReset();
  mockGetAgentRuntimeSession.mockReset();
  mockGetAgentRuntimeThreadRead.mockReset();
  mockUpdateAgentRuntimeSession.mockReset();
  mockDeleteAgentRuntimeSession.mockReset();
  mockCompactAgentRuntimeSession.mockReset();
  mockInterruptAgentRuntimeTurn.mockReset();
  mockReplayAgentRuntimeRequest.mockReset();
  mockPromoteAgentRuntimeQueuedTurn.mockReset();
  mockRemoveAgentRuntimeQueuedTurn.mockReset();
  mockRespondAgentRuntimeAction.mockReset();
  mockParseAgentEvent.mockReset();
  mockSafeListen.mockReset();
  mockParseSkillSlashCommand.mockReset();
  mockTryExecuteSlashSkillCommand.mockReset();
  mockWechatChannelSetRuntimeModel.mockReset();
  mockToast.success.mockReset();
  mockToast.error.mockReset();
  mockToast.info.mockReset();
  mockToast.warning.mockReset();
  localStorage.clear();
  sessionStorage.clear();

  mockInitAsterAgent.mockResolvedValue(undefined);
  mockSubmitAgentRuntimeTurn.mockResolvedValue(undefined);
  mockCreateAgentRuntimeSession.mockResolvedValue("created-session");
  mockListAgentRuntimeSessions.mockResolvedValue([]);
  mockGetAgentRuntimeSession.mockResolvedValue({
    id: "session-from-api",
    messages: [],
  });
  mockGetAgentRuntimeThreadRead.mockResolvedValue(undefined);
  mockUpdateAgentRuntimeSession.mockResolvedValue(undefined);
  mockDeleteAgentRuntimeSession.mockResolvedValue(undefined);
  mockCompactAgentRuntimeSession.mockResolvedValue(undefined);
  mockInterruptAgentRuntimeTurn.mockResolvedValue(undefined);
  mockReplayAgentRuntimeRequest.mockResolvedValue(null);
  mockPromoteAgentRuntimeQueuedTurn.mockResolvedValue(true);
  mockRemoveAgentRuntimeQueuedTurn.mockResolvedValue(true);
  mockRespondAgentRuntimeAction.mockResolvedValue(undefined);
  mockParseAgentEvent.mockImplementation((payload: unknown) => payload);
  mockSafeListen.mockResolvedValue(() => {});
  mockParseSkillSlashCommand.mockReturnValue(null);
  mockTryExecuteSlashSkillCommand.mockResolvedValue(false);
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("useAsterAgentChat 首页新会话", () => {
  it("无工作区时不应主动初始化 Agent", async () => {
    const harness = mountHook("");

    try {
      await flushEffects();

      expect(mockInitAsterAgent).not.toHaveBeenCalled();
      expect(mockListAgentRuntimeSessions).not.toHaveBeenCalled();
      expect(harness.getValue().processStatus.running).toBe(false);
      expect(harness.getValue().topics).toEqual([]);
    } finally {
      harness.unmount();
    }
  });

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

  it("加载话题时应后台预热 Agent，但不阻塞话题列表返回", async () => {
    const workspaceId = "ws-topic-lazy-init";
    const sessionId = "session-topic-lazy-init";
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: sessionId,
        name: "任务 C",
        created_at: 1700000020,
        updated_at: 1700000021,
        messages_count: 0,
      },
    ]);

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await flushEffects();

      expect(mockInitAsterAgent).toHaveBeenCalledTimes(1);
      expect(mockListAgentRuntimeSessions).toHaveBeenCalledTimes(1);
      expect(harness.getValue().topics.map((topic) => topic.id)).toEqual([
        sessionId,
      ]);
      expect(harness.getValue().processStatus.running).toBe(true);
    } finally {
      harness.unmount();
    }
  });

  it("话题列表暂时未返回当前执行会话时不应清空本地执行态", async () => {
    const workspaceId = "ws-topic-missing-active-session";
    mockCreateAgentRuntimeSession.mockResolvedValue("session-live-missing");
    mockListAgentRuntimeSessions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "session-existing",
          name: "既有任务",
          created_at: 1700000100,
          updated_at: 1700000101,
          messages_count: 2,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "session-existing",
          name: "既有任务",
          created_at: 1700000100,
          updated_at: 1700000101,
          messages_count: 2,
        },
      ]);
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: "session-live-missing",
      name: "当前执行任务",
      created_at: 1700000200,
      updated_at: 1700000201,
      messages: [],
      turns: [],
      items: [],
      queued_turns: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("继续执行当前任务", [], false, false, false, "react");
      });

      await flushEffects();
      await flushEffects();

      expect(harness.getValue().sessionId).toBe("session-live-missing");
      expect(harness.getValue().messages.length).toBeGreaterThan(0);
      expect(
        harness
          .getValue()
          .topics.some((topic) => topic.id === "session-live-missing"),
      ).toBe(true);
      expect(mockUpdateAgentRuntimeSession).toHaveBeenCalledWith({
        session_id: "session-live-missing",
        provider_name: harness.getValue().providerType,
        model_name: harness.getValue().model,
      });
      expect(mockGetAgentRuntimeSession).toHaveBeenCalledWith(
        "session-live-missing",
      );
    } finally {
      harness.unmount();
    }
  });

  it("当前执行会话确认不存在后应清空失效执行态并恢复到有效会话", async () => {
    const workspaceId = "ws-topic-missing-not-found";
    const missingSessionId = "session-live-gone";
    const activeSessionId = "session-existing";

    mockCreateAgentRuntimeSession.mockResolvedValue(missingSessionId);
    mockListAgentRuntimeSessions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: activeSessionId,
          name: "既有任务",
          created_at: 1700000100,
          updated_at: 1700000101,
          messages_count: 1,
        },
      ])
      .mockResolvedValue([
        {
          id: activeSessionId,
          name: "既有任务",
          created_at: 1700000100,
          updated_at: 1700000101,
          messages_count: 1,
        },
      ]);
    mockGetAgentRuntimeSession.mockImplementation(async (sessionId: string) => {
      if (sessionId === missingSessionId) {
        throw new Error(`Session not found: ${missingSessionId}`);
      }

      return {
        id: activeSessionId,
        name: "既有任务",
        created_at: 1700000100,
        updated_at: 1700000101,
        messages: [],
        turns: [],
        items: [],
        queued_turns: [],
      };
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("继续执行当前任务", [], false, false, false, "react");
      });

      await flushEffects();
      await flushEffects();
      await flushEffects();
      await flushEffects();

      expect(mockGetAgentRuntimeSession).toHaveBeenCalledWith(missingSessionId);
      expect(harness.getValue().sessionId).toBe(activeSessionId);
      expect(
        harness
          .getValue()
          .topics.some((topic) => topic.id === missingSessionId),
      ).toBe(false);
      expect(harness.getValue().messages).toHaveLength(0);
    } finally {
      harness.unmount();
    }
  });
});

describe("useAsterAgentChat 任务快照", () => {
  it("停止后刷新会话详情暂未返回历史时，应保留右侧本地对话内容", async () => {
    const workspaceId = "ws-task-stop-refresh-empty-history";
    const sessionId = "session-task-stop-refresh-empty-history";
    captureTurnStream();
    mockCreateAgentRuntimeSession.mockResolvedValue(sessionId);
    mockListAgentRuntimeSessions.mockResolvedValue([]);
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: sessionId,
      name: "当前任务",
      created_at: 1700000300,
      updated_at: 1700000301,
      messages: [],
      turns: [],
      items: [],
      queued_turns: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "帮我继续整理这份任务",
            [],
            false,
            false,
            false,
            "react",
          );
      });

      await flushEffects();

      await act(async () => {
        await harness.getValue().stopSending();
      });

      await flushEffects();
      await flushEffects();

      expect(mockGetAgentRuntimeSession).toHaveBeenCalledWith(sessionId);
      expect(harness.getValue().messages).toHaveLength(2);
      expect(harness.getValue().messages[0]?.content).toContain(
        "帮我继续整理这份任务",
      );
      expect(harness.getValue().messages[1]?.content).toBe("(已停止)");
    } finally {
      harness.unmount();
    }
  });

  it("恢复态会话执行 stopSending 时也应刷新 thread_read", async () => {
    const workspaceId = "ws-stop-refresh";
    const sessionId = "session-stop-refresh";
    seedSession(workspaceId, sessionId);
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: sessionId,
      messages: [],
      turns: [],
      items: [],
      queued_turns: [],
    });
    mockGetAgentRuntimeThreadRead.mockResolvedValueOnce({
      thread_id: "thread-stop-refresh",
      status: "interrupted",
      pending_requests: [],
      incidents: [],
      queued_turns: [],
      interrupt_state: "interrupted",
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await flushEffects();

      await act(async () => {
        await harness.getValue().stopSending();
      });

      expect(mockGetAgentRuntimeSession).toHaveBeenCalledWith(sessionId);
      expect(mockInterruptAgentRuntimeTurn).toHaveBeenCalledWith({
        session_id: sessionId,
      });
      expect(mockGetAgentRuntimeThreadRead).toHaveBeenCalledWith(sessionId);
      expect(harness.getValue().threadRead).toMatchObject({
        thread_id: "thread-stop-refresh",
        status: "interrupted",
        interrupt_state: "interrupted",
      });
    } finally {
      harness.unmount();
    }
  });

  it("空会话快照稳定后不应继续自发重渲染", async () => {
    const workspaceId = "ws-task-stable";
    const sessionId = "session-task-stable";
    sessionStorage.setItem(
      `aster_curr_sessionId_${workspaceId}`,
      JSON.stringify(sessionId),
    );
    mockListAgentRuntimeSessions.mockImplementation(async () => [
      {
        id: sessionId,
        name: "任务稳定性",
        created_at: 1700000100,
        updated_at: 1700000101,
        messages_count: 0,
      },
    ]);
    mockGetAgentRuntimeSession.mockImplementation(async () => ({
      id: sessionId,
      created_at: 1700000100,
      updated_at: 1700000101,
      messages: [],
      turns: [],
      items: [],
      queued_turns: [],
    }));

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await flushEffects();
      await flushEffects();

      let topic = harness
        .getValue()
        .topics.find((item) => item.id === sessionId);
      for (let attempt = 0; !topic && attempt < 3; attempt += 1) {
        await flushEffects();
        topic = harness.getValue().topics.find((item) => item.id === sessionId);
      }
      expect(topic).toBeTruthy();
      expect(topic?.updatedAt.getTime()).toBe(1700000101 * 1000);

      const settledRenderCount = harness.getRenderCount();

      await flushEffects();
      await flushEffects();

      expect(harness.getRenderCount()).toBe(settledRenderCount);
    } finally {
      harness.unmount();
    }
  });

  it("恢复带本地时间线缓存的会话时仍应向后端刷新详情", async () => {
    const workspaceId = "ws-hydrate-timeline-cache";
    const sessionId = "session-hydrate-timeline-cache";
    sessionStorage.setItem(
      `aster_curr_sessionId_${workspaceId}`,
      JSON.stringify(sessionId),
    );
    sessionStorage.setItem(
      `aster_messages_${workspaceId}`,
      JSON.stringify([
        {
          id: "msg-local-cache",
          role: "assistant",
          content: "本地缓存里的旧草稿",
          timestamp: new Date().toISOString(),
        },
      ]),
    );
    sessionStorage.setItem(
      `aster_thread_turns_${workspaceId}`,
      JSON.stringify([
        {
          id: "turn-local-cache",
          thread_id: "thread-local-cache",
          prompt_text: "旧的本地缓存 turn",
          status: "completed",
          started_at: "2026-03-26T00:00:00.000Z",
          completed_at: "2026-03-26T00:00:05.000Z",
          created_at: "2026-03-26T00:00:00.000Z",
          updated_at: "2026-03-26T00:00:05.000Z",
        },
      ]),
    );
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: sessionId,
        name: "缓存恢复会话",
        created_at: 1700000100,
        updated_at: 1700000101,
        messages_count: 1,
      },
    ]);
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: sessionId,
      messages: [],
      turns: [],
      items: [],
      queued_turns: [
        {
          queuedTurnId: "queued-hydrated-1",
          messagePreview: "以后端详情为准继续执行",
          messageText: "以后端详情为准继续执行，并刷新运行态缓存",
          createdAt: 1700000200000,
          imageCount: 0,
          position: 1,
        },
      ],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await flushEffects();
      await flushEffects();

      expect(mockGetAgentRuntimeSession).toHaveBeenCalledWith(sessionId);
      expect(harness.getValue().queuedTurns).toEqual([
        {
          queued_turn_id: "queued-hydrated-1",
          message_preview: "以后端详情为准继续执行",
          message_text: "以后端详情为准继续执行，并刷新运行态缓存",
          created_at: 1700000200000,
          image_count: 0,
          position: 1,
        },
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("应将当前任务的真实摘要与状态回写到任务列表", async () => {
    const workspaceId = "ws-task-snapshot";
    const sessionId = "session-task-snapshot";
    sessionStorage.setItem(
      `aster_curr_sessionId_${workspaceId}`,
      JSON.stringify(sessionId),
    );
    sessionStorage.setItem(
      `aster_messages_${workspaceId}`,
      JSON.stringify([
        {
          id: "msg-task-1",
          role: "assistant",
          content: "请先整理需求清单，再拆出里程碑。",
          timestamp: new Date().toISOString(),
        },
      ]),
    );
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: sessionId,
      messages: [
        {
          role: "assistant",
          timestamp: 1700000001,
          content: [
            {
              type: "output_text",
              text: "请先整理需求清单，再拆出里程碑。",
            },
          ],
        },
      ],
      turns: [],
      items: [],
      queued_turns: [],
    });
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: sessionId,
        name: "任务 A",
        created_at: 1700000000,
        updated_at: 1700000001,
        messages_count: 1,
      },
    ]);

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await flushEffects();
      let topic = harness
        .getValue()
        .topics.find((item) => item.id === sessionId);
      for (
        let attempt = 0;
        (!topic || topic.status !== "done") && attempt < 5;
        attempt += 1
      ) {
        await flushEffects();
        topic = harness.getValue().topics.find((item) => item.id === sessionId);
      }
      expect(topic).toBeTruthy();
      expect(topic?.status).toBe("done");
      expect(topic?.messagesCount).toBe(1);
      expect(topic?.lastPreview).toContain("请先整理需求清单");
    } finally {
      harness.unmount();
    }
  });

  it("发送中应将当前任务标记为进行中并同步最新摘要", async () => {
    const workspaceId = "ws-task-running";
    const sessionId = "session-task-running";
    sessionStorage.setItem(
      `aster_curr_sessionId_${workspaceId}`,
      JSON.stringify(sessionId),
    );
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: sessionId,
        name: "任务 B",
        created_at: 1700000010,
        updated_at: 1700000011,
        messages_count: 0,
      },
    ]);
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: sessionId,
      messages: [],
      turns: [],
      items: [],
      queued_turns: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "帮我输出一版任务拆解",
            [],
            false,
            false,
            false,
            "react",
          );
      });
      await flushEffects();

      const topic = harness
        .getValue()
        .topics.find((item) => item.id === sessionId);
      expect(topic).toBeTruthy();
      expect(topic?.status).toBe("running");
      expect(topic?.messagesCount).toBeGreaterThanOrEqual(1);
      expect(topic?.lastPreview).toContain("帮我输出一版任务拆解");
    } finally {
      harness.unmount();
    }
  });
});

describe("useAsterAgentChat team 订阅", () => {
  it("首次还没有 team 图谱时也应订阅当前会话的 subagent 状态事件", async () => {
    const workspaceId = "ws-team-runtime-empty";
    const sessionId = "session-team-runtime-empty";
    const listeners: Array<{
      eventName: string;
      handler: (event: { payload: unknown }) => void;
    }> = [];

    sessionStorage.setItem(
      `aster_curr_sessionId_${workspaceId}`,
      JSON.stringify(sessionId),
    );
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: sessionId,
        name: "团队总览",
        created_at: 1700000400,
        updated_at: 1700000401,
        messages_count: 0,
      },
    ]);
    mockGetAgentRuntimeSession
      .mockResolvedValueOnce({
        id: sessionId,
        messages: [],
        turns: [],
        items: [],
        queued_turns: [],
        child_subagent_sessions: [],
      })
      .mockResolvedValue({
        id: sessionId,
        messages: [],
        turns: [],
        items: [],
        queued_turns: [],
        child_subagent_sessions: [
          {
            id: "child-team-empty-1",
            name: "研究员",
            created_at: 1700000402,
            updated_at: 1700000403,
            session_type: "sub_agent",
            runtime_status: "queued",
            task_summary: "整理竞品资料",
          },
        ],
      });
    mockSafeListen.mockImplementation(async (eventName, handler) => {
      listeners.push({
        eventName,
        handler: handler as (event: { payload: unknown }) => void,
      });
      return () => {};
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await flushEffects();

      expect(listeners.map((item) => item.eventName)).toContain(
        `agent_subagent_status:${sessionId}`,
      );
      expect(mockGetAgentRuntimeSession).toHaveBeenCalledTimes(2);

      const listener = listeners
        .filter(
          (item) => item.eventName === `agent_subagent_status:${sessionId}`,
        )
        .at(-1);
      expect(listener).toBeTruthy();

      act(() => {
        listener?.handler({
          payload: {
            type: "subagent_status_changed",
            session_id: "child-team-empty-1",
            root_session_id: sessionId,
            status: "queued",
          },
        });
      });
      await flushEffects();

      expect(mockGetAgentRuntimeSession).toHaveBeenCalledTimes(3);
    } finally {
      harness.unmount();
    }
  });

  it("收到 subagent_status_changed 后应刷新当前会话详情", async () => {
    const workspaceId = "ws-team-runtime";
    const sessionId = "session-team-runtime";
    const listeners: Array<{
      eventName: string;
      handler: (event: { payload: unknown }) => void;
    }> = [];

    sessionStorage.setItem(
      `aster_curr_sessionId_${workspaceId}`,
      JSON.stringify(sessionId),
    );
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: sessionId,
        name: "团队总览",
        created_at: 1700000400,
        updated_at: 1700000401,
        messages_count: 0,
      },
    ]);
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: sessionId,
      messages: [],
      turns: [],
      items: [],
      queued_turns: [],
      child_subagent_sessions: [
        {
          id: "child-team-1",
          name: "研究员",
          created_at: 1700000402,
          updated_at: 1700000403,
          session_type: "sub_agent",
          runtime_status: "queued",
          task_summary: "整理竞品资料",
        },
      ],
    });
    mockSafeListen.mockImplementation(async (eventName, handler) => {
      listeners.push({
        eventName,
        handler: handler as (event: { payload: unknown }) => void,
      });
      return () => {};
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await flushEffects();

      expect(listeners.map((item) => item.eventName)).toContain(
        `agent_subagent_status:${sessionId}`,
      );
      expect(mockGetAgentRuntimeSession).toHaveBeenCalledTimes(2);

      const listener = listeners
        .filter(
          (item) => item.eventName === `agent_subagent_status:${sessionId}`,
        )
        .at(-1);
      expect(listener).toBeTruthy();

      act(() => {
        listener?.handler({
          payload: {
            type: "subagent_status_changed",
            session_id: "child-team-1",
            root_session_id: sessionId,
            status: "running",
          },
        });
      });
      await flushEffects();

      expect(mockGetAgentRuntimeSession).toHaveBeenCalledTimes(3);
    } finally {
      harness.unmount();
    }
  });
});

describe("useAsterAgentChat.confirmAction", () => {
  it("tool_confirmation 应调用统一 runtime action 响应", async () => {
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

      expect(mockRespondAgentRuntimeAction).toHaveBeenCalledTimes(1);
      expect(mockRespondAgentRuntimeAction).toHaveBeenCalledWith({
        session_id: "session-tool",
        request_id: "req-tool-1",
        action_type: "tool_confirmation",
        confirmed: true,
        response: "允许",
        user_data: undefined,
        metadata: undefined,
      });
    } finally {
      harness.unmount();
    }
  });

  it("elicitation 应调用统一 runtime action 响应并透传 userData", async () => {
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

      expect(mockRespondAgentRuntimeAction).toHaveBeenCalledTimes(1);
      expect(mockRespondAgentRuntimeAction).toHaveBeenCalledWith({
        session_id: "session-elicitation",
        request_id: "req-elicitation-1",
        action_type: "elicitation",
        confirmed: true,
        response: undefined,
        user_data: { answer: "A" },
        metadata: undefined,
      });
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

      expect(mockRespondAgentRuntimeAction).toHaveBeenCalledTimes(1);
      expect(mockRespondAgentRuntimeAction).toHaveBeenCalledWith({
        session_id: "session-ask-user",
        request_id: "req-ask-user-1",
        action_type: "ask_user",
        confirmed: true,
        response: '{"answer":"选项A"}',
        user_data: { answer: "选项A" },
        metadata: undefined,
      });
    } finally {
      harness.unmount();
    }
  });

  it("confirmAction 成功后应刷新当前会话详情以同步 thread_read", async () => {
    const workspaceId = "ws-ask-user-refresh";
    seedSession(workspaceId, "session-ask-user-refresh");
    mockGetAgentRuntimeThreadRead.mockResolvedValueOnce({
      thread_id: "thread-ask-user-refresh",
      status: "running",
      pending_requests: [],
      incidents: [],
      queued_turns: [],
    });
    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().confirmAction({
          requestId: "req-ask-user-refresh-1",
          confirmed: true,
          actionType: "ask_user",
          response: '{"answer":"已确认"}',
        });
      });

      expect(mockGetAgentRuntimeThreadRead).toHaveBeenCalledTimes(1);
      expect(mockGetAgentRuntimeThreadRead).toHaveBeenCalledWith(
        "session-ask-user-refresh",
      );
      expect(harness.getValue().threadRead).toMatchObject({
        thread_id: "thread-ask-user-refresh",
        status: "running",
      });
    } finally {
      harness.unmount();
    }
  });

  it("confirmAction 等待 read-model 回填时，应暴露 submittedActionsInFlight", async () => {
    const workspaceId = "ws-ask-user-submitting";
    seedSession(workspaceId, "session-ask-user-submitting");
    let resolveRefresh: (() => void) | null = null;
    mockGetAgentRuntimeThreadRead.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = () =>
            resolve({
              thread_id: "thread-ask-user-submitting",
              status: "running",
              pending_requests: [],
              incidents: [],
              queued_turns: [],
            });
        }),
    );
    const harness = mountHook(workspaceId);

    try {
      await flushEffects();

      let submissionPromise: Promise<void>;
      act(() => {
        submissionPromise = harness.getValue().confirmAction({
          requestId: "req-ask-user-submitting-1",
          confirmed: true,
          actionType: "ask_user",
          response: '{"answer":"已确认"}',
        });
      });

      await flushEffects();
      expect(harness.getValue().submittedActionsInFlight).toMatchObject([
        {
          requestId: "req-ask-user-submitting-1",
          actionType: "ask_user",
          status: "submitted",
        },
      ]);

      await act(async () => {
        resolveRefresh?.();
        await submissionPromise!;
      });

      expect(harness.getValue().submittedActionsInFlight).toEqual([]);
    } finally {
      harness.unmount();
    }
  });
});

describe("useAsterAgentChat queue hydration", () => {
  it("恢复态 thread 仍在运行时，发送继续应直接展示排队态而不是伪装成处理中", async () => {
    const workspaceId = "ws-queue-on-restored-running";
    const sessionId = "session-queue-on-restored-running";
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: sessionId,
        name: "恢复中的运行会话",
        created_at: 1,
        updated_at: 2,
        messages_count: 0,
      },
    ]);
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: sessionId,
      messages: [],
      turns: [],
      items: [],
      queued_turns: [],
      thread_read: {
        thread_id: "thread-queue-on-restored-running",
        status: "running",
        active_turn_id: "turn-running-1",
        pending_requests: [],
        incidents: [],
        queued_turns: [],
      },
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(sessionId);
      });
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请继续分析这个项目", [], false, false, false, "react");
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.runtimeStatus?.title).toBe("已加入排队列表");
      expect(harness.getValue().isSending).toBe(false);
      expect(harness.getValue().currentTurnId).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  it("切换话题时应恢复后端返回的排队项", async () => {
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-queue",
        name: "带队列的话题",
        created_at: 1,
        updated_at: 2,
      },
    ]);
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: "session-queue",
      messages: [],
      turns: [],
      items: [],
      queued_turns: [
        {
          queuedTurnId: "queued-1",
          messagePreview: "继续补充 PRD",
          messageText: "继续补充 PRD，并补一版里程碑拆解",
          createdAt: 1700000000000,
          imageCount: 0,
          position: 1,
        },
      ],
    });

    const harness = mountHook("ws-queue-hydration");

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic("session-queue");
      });

      expect(harness.getValue().queuedTurns).toEqual([
        {
          queued_turn_id: "queued-1",
          message_preview: "继续补充 PRD",
          message_text: "继续补充 PRD，并补一版里程碑拆解",
          created_at: 1700000000000,
          image_count: 0,
          position: 1,
        },
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("removeQueuedTurn 后应刷新 thread_read 与队列快照", async () => {
    const sessionId = "session-queue-remove";
    const harness = mountHook("ws-queue-remove");
    let removed = false;
    mockRemoveAgentRuntimeQueuedTurn.mockImplementation(async () => {
      removed = true;
      return true;
    });
    mockGetAgentRuntimeSession.mockImplementation(async () =>
      removed
        ? {
            id: sessionId,
            messages: [],
            turns: [],
            items: [],
            queued_turns: [],
            thread_read: {
              thread_id: "thread-queue-remove",
              status: "idle",
              pending_requests: [],
              incidents: [],
              queued_turns: [],
            },
          }
        : {
            id: sessionId,
            messages: [],
            turns: [],
            items: [],
            queued_turns: [
              {
                queuedTurnId: "queued-1",
                messagePreview: "继续生成周报",
                messageText: "继续生成周报正文",
                createdAt: 1700000000000,
                imageCount: 0,
                position: 1,
              },
            ],
            thread_read: {
              thread_id: "thread-queue-remove",
              status: "queued",
              pending_requests: [],
              incidents: [],
              queued_turns: [
                {
                  queuedTurnId: "queued-1",
                  messagePreview: "继续生成周报",
                  messageText: "继续生成周报正文",
                  createdAt: 1700000000000,
                  imageCount: 0,
                  position: 1,
                },
              ],
            },
          },
    );
    mockGetAgentRuntimeThreadRead.mockImplementation(async () =>
      removed
        ? {
            thread_id: "thread-queue-remove",
            status: "idle",
            pending_requests: [],
            incidents: [],
            queued_turns: [],
          }
        : {
            thread_id: "thread-queue-remove",
            status: "queued",
            pending_requests: [],
            incidents: [],
            queued_turns: [
              {
                queuedTurnId: "queued-1",
                messagePreview: "继续生成周报",
                messageText: "继续生成周报正文",
                createdAt: 1700000000000,
                imageCount: 0,
                position: 1,
              },
            ],
          },
    );

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(sessionId);
      });
      await flushEffects();
      expect(harness.getValue().threadRead).toMatchObject({
        thread_id: "thread-queue-remove",
        status: "queued",
      });

      await act(async () => {
        await harness.getValue().removeQueuedTurn("queued-1");
      });
      await flushEffects();

      expect(mockRemoveAgentRuntimeQueuedTurn).toHaveBeenCalledWith({
        session_id: sessionId,
        queued_turn_id: "queued-1",
      });
      expect(mockGetAgentRuntimeThreadRead).toHaveBeenCalledWith(sessionId);
      expect(harness.getValue().queuedTurns).toEqual([]);
      expect(harness.getValue().threadRead).toMatchObject({
        thread_id: "thread-queue-remove",
        status: "idle",
      });
    } finally {
      harness.unmount();
    }
  });

  it("promoteQueuedTurn 后应刷新 thread_read 为最新运行态", async () => {
    const sessionId = "session-queue-promote";
    const harness = mountHook("ws-queue-promote");
    let promoted = false;
    mockPromoteAgentRuntimeQueuedTurn.mockImplementation(async () => {
      promoted = true;
      return true;
    });
    mockGetAgentRuntimeSession.mockImplementation(async () =>
      promoted
        ? {
            id: sessionId,
            messages: [],
            turns: [],
            items: [],
            queued_turns: [],
            thread_read: {
              thread_id: "thread-queue-promote",
              status: "running",
              active_turn_id: "turn-running-1",
              pending_requests: [],
              incidents: [],
              queued_turns: [],
            },
          }
        : {
            id: sessionId,
            messages: [],
            turns: [],
            items: [],
            queued_turns: [
              {
                queuedTurnId: "queued-1",
                messagePreview: "继续执行排队任务",
                messageText: "继续执行排队任务正文",
                createdAt: 1700000000000,
                imageCount: 0,
                position: 1,
              },
            ],
            thread_read: {
              thread_id: "thread-queue-promote",
              status: "queued",
              pending_requests: [],
              incidents: [],
              queued_turns: [
                {
                  queuedTurnId: "queued-1",
                  messagePreview: "继续执行排队任务",
                  messageText: "继续执行排队任务正文",
                  createdAt: 1700000000000,
                  imageCount: 0,
                  position: 1,
                },
              ],
            },
          },
    );
    mockGetAgentRuntimeThreadRead.mockImplementation(async () =>
      promoted
        ? {
            thread_id: "thread-queue-promote",
            status: "running",
            active_turn_id: "turn-running-1",
            pending_requests: [],
            incidents: [],
            queued_turns: [],
          }
        : {
            thread_id: "thread-queue-promote",
            status: "queued",
            pending_requests: [],
            incidents: [],
            queued_turns: [
              {
                queuedTurnId: "queued-1",
                messagePreview: "继续执行排队任务",
                messageText: "继续执行排队任务正文",
                createdAt: 1700000000000,
                imageCount: 0,
                position: 1,
              },
            ],
          },
    );

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(sessionId);
      });
      await flushEffects();
      expect(harness.getValue().threadRead).toMatchObject({
        thread_id: "thread-queue-promote",
        status: "queued",
      });

      await act(async () => {
        await harness.getValue().promoteQueuedTurn("queued-1");
      });
      await flushEffects();

      expect(mockPromoteAgentRuntimeQueuedTurn).toHaveBeenCalledWith({
        session_id: sessionId,
        queued_turn_id: "queued-1",
      });
      expect(mockGetAgentRuntimeThreadRead).toHaveBeenCalledWith(sessionId);
      expect(harness.getValue().queuedTurns).toEqual([]);
      expect(harness.getValue().threadRead).toMatchObject({
        thread_id: "thread-queue-promote",
        status: "running",
        active_turn_id: "turn-running-1",
      });
    } finally {
      harness.unmount();
    }
  });

  it("resumeThread 后应刷新 thread_read 为最新运行态", async () => {
    const sessionId = "session-thread-resume";
    const harness = mountHook("ws-thread-resume");
    let resumed = false;
    mockResumeAgentRuntimeThread.mockImplementation(async () => {
      resumed = true;
      return true;
    });
    mockGetAgentRuntimeSession.mockImplementation(async () =>
      resumed
        ? {
            id: sessionId,
            messages: [],
            turns: [],
            items: [],
            queued_turns: [],
            thread_read: {
              thread_id: "thread-thread-resume",
              status: "running",
              active_turn_id: "turn-running-1",
              pending_requests: [],
              incidents: [],
              queued_turns: [],
            },
          }
        : {
            id: sessionId,
            messages: [],
            turns: [],
            items: [],
            queued_turns: [
              {
                queuedTurnId: "queued-1",
                messagePreview: "继续执行排队任务",
                messageText: "继续执行排队任务正文",
                createdAt: 1700000000000,
                imageCount: 0,
                position: 1,
              },
            ],
            thread_read: {
              thread_id: "thread-thread-resume",
              status: "queued",
              pending_requests: [],
              incidents: [],
              queued_turns: [
                {
                  queuedTurnId: "queued-1",
                  messagePreview: "继续执行排队任务",
                  messageText: "继续执行排队任务正文",
                  createdAt: 1700000000000,
                  imageCount: 0,
                  position: 1,
                },
              ],
            },
          },
    );
    mockGetAgentRuntimeThreadRead.mockImplementation(async () =>
      resumed
        ? {
            thread_id: "thread-thread-resume",
            status: "running",
            active_turn_id: "turn-running-1",
            pending_requests: [],
            incidents: [],
            queued_turns: [],
          }
        : {
            thread_id: "thread-thread-resume",
            status: "queued",
            pending_requests: [],
            incidents: [],
            queued_turns: [
              {
                queuedTurnId: "queued-1",
                messagePreview: "继续执行排队任务",
                messageText: "继续执行排队任务正文",
                createdAt: 1700000000000,
                imageCount: 0,
                position: 1,
              },
            ],
          },
    );

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(sessionId);
      });
      await flushEffects();
      expect(harness.getValue().threadRead).toMatchObject({
        thread_id: "thread-thread-resume",
        status: "queued",
      });

      await act(async () => {
        await harness.getValue().resumeThread();
      });
      await flushEffects();

      expect(mockResumeAgentRuntimeThread).toHaveBeenCalledWith({
        session_id: sessionId,
      });
      expect(mockGetAgentRuntimeThreadRead).toHaveBeenCalledWith(sessionId);
      expect(harness.getValue().threadRead).toMatchObject({
        thread_id: "thread-thread-resume",
        status: "running",
        active_turn_id: "turn-running-1",
      });
    } finally {
      harness.unmount();
    }
  });
});

describe("useAsterAgentChat thread timeline", () => {
  it("sendMessage 后在首个流事件前应先注入本地回合占位", async () => {
    const workspaceId = "ws-thread-optimistic";
    seedSession(workspaceId, "session-thread-optimistic");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("帮我先开始处理", [], false, false, false, "react");
      });

      const pendingTurnKey = harness.getValue().currentTurnId;
      expect(pendingTurnKey).toContain("pending-turn:");
      expect(harness.getValue().turns).toHaveLength(1);
      expect(harness.getValue().turns[0]?.id).toBe(pendingTurnKey);
      expect(harness.getValue().turns[0]?.status).toBe("running");
      expect(harness.getValue().threadItems).toHaveLength(1);
      expect(harness.getValue().threadItems[0]?.id).toBe(
        `pending-item:${pendingTurnKey}`,
      );
      expect(harness.getValue().threadItems[0]?.type).toBe("turn_summary");
      expect(harness.getValue().threadItems[0]?.status).toBe("in_progress");

      act(() => {
        stream.emit({
          type: "turn_started",
          turn: {
            id: "turn-real-1",
            thread_id: "session-thread-optimistic",
            prompt_text: "帮我先开始处理",
            status: "running",
            started_at: "2026-03-13T11:00:00.000Z",
            created_at: "2026-03-13T11:00:00.000Z",
            updated_at: "2026-03-13T11:00:00.000Z",
          },
        });
      });

      expect(harness.getValue().currentTurnId).toBe("turn-real-1");
      expect(harness.getValue().turns).toHaveLength(1);
      expect(harness.getValue().turns[0]?.id).toBe("turn-real-1");
      expect(harness.getValue().threadItems).toEqual([
        expect.objectContaining({
          id: `pending-item:${pendingTurnKey}`,
          type: "turn_summary",
          status: "in_progress",
          turn_id: "turn-real-1",
          thread_id: "session-thread-optimistic",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("运行时意外返回 queue_added 时，应降级为排队态并清掉假 running 占位", async () => {
    const workspaceId = "ws-thread-queue-added-fallback";
    const sessionId = "session-thread-queue-added-fallback";
    seedSession(workspaceId, sessionId);
    let queuedAdded = false;
    mockGetAgentRuntimeSession.mockImplementation(async () => ({
      id: sessionId,
      messages: [],
      turns: [],
      items: [],
      queued_turns: queuedAdded
        ? [
            {
              queuedTurnId: "queued-fallback-1",
              messagePreview: "请继续往下分析",
              messageText: "请继续往下分析",
              createdAt: 1700000000000,
              imageCount: 0,
              position: 1,
            },
          ]
        : [],
    }));
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请继续往下分析", [], false, false, false, "react");
      });

      expect(harness.getValue().isSending).toBe(true);
      expect(harness.getValue().turns).toHaveLength(1);

      act(() => {
        queuedAdded = true;
        stream.emit({
          type: "queue_added",
          session_id: sessionId,
          queued_turn: {
            queued_turn_id: "queued-fallback-1",
            message_preview: "请继续往下分析",
            message_text: "请继续往下分析",
            created_at: 1700000000000,
            image_count: 0,
            position: 1,
          },
        });
      });
      await flushEffects();

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(harness.getValue().isSending).toBe(false);
      expect(harness.getValue().currentTurnId).toBeNull();
      expect(harness.getValue().turns).toEqual([]);
      expect(harness.getValue().queuedTurns).toEqual([
        expect.objectContaining({
          queued_turn_id: "queued-fallback-1",
        }),
      ]);
      expect(assistantMessage?.runtimeStatus?.title).toBe("已加入排队列表");
    } finally {
      harness.unmount();
    }
  });

  it("submitTurn 失败时应保留失败回合与失败消息，而不是清空当前过程", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const workspaceId = "ws-thread-submit-failed";
    seedSession(workspaceId, "session-thread-submit-failed");
    mockSubmitAgentRuntimeTurn.mockRejectedValueOnce(
      new Error("429 rate limit"),
    );
    const harness = mountHook(workspaceId);

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("帮我开始执行", [], false, false, false, "react");
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.content).toContain("执行失败：429 rate limit");
      expect(assistantMessage?.runtimeStatus).toMatchObject({
        phase: "failed",
        title: "当前处理失败",
      });
      expect(harness.getValue().turns).toEqual([
        expect.objectContaining({
          status: "failed",
          error_message: "429 rate limit",
        }),
      ]);
      expect(harness.getValue().threadItems).toEqual([
        expect.objectContaining({
          type: "turn_summary",
          status: "failed",
        }),
      ]);
      expect(mockToast.warning).toHaveBeenCalledWith(
        "请求过于频繁，请稍后重试",
      );
    } finally {
      consoleErrorSpy.mockRestore();
      harness.unmount();
    }
  });

  it("应接收 turn/item 生命周期事件并写入运行态", async () => {
    const workspaceId = "ws-thread-timeline";
    seedSession(workspaceId, "session-thread-timeline");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("帮我整理一个计划", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "turn_started",
          turn: {
            id: "turn-1",
            thread_id: "session-thread-timeline",
            prompt_text: "帮我整理一个计划",
            status: "running",
            started_at: "2026-03-13T10:00:00.000Z",
            created_at: "2026-03-13T10:00:00.000Z",
            updated_at: "2026-03-13T10:00:00.000Z",
          },
        });
        stream.emit({
          type: "item_started",
          item: {
            id: "plan-1",
            thread_id: "session-thread-timeline",
            turn_id: "turn-1",
            sequence: 1,
            status: "in_progress",
            started_at: "2026-03-13T10:00:01.000Z",
            updated_at: "2026-03-13T10:00:01.000Z",
            type: "plan",
            text: "1. 收集资料\n2. 输出结论",
          },
        });
        stream.emit({
          type: "item_completed",
          item: {
            id: "plan-1",
            thread_id: "session-thread-timeline",
            turn_id: "turn-1",
            sequence: 1,
            status: "completed",
            started_at: "2026-03-13T10:00:01.000Z",
            completed_at: "2026-03-13T10:00:03.000Z",
            updated_at: "2026-03-13T10:00:03.000Z",
            type: "plan",
            text: "1. 收集资料\n2. 输出结论",
          },
        });
        stream.emit({
          type: "turn_completed",
          turn: {
            id: "turn-1",
            thread_id: "session-thread-timeline",
            prompt_text: "帮我整理一个计划",
            status: "completed",
            started_at: "2026-03-13T10:00:00.000Z",
            completed_at: "2026-03-13T10:00:04.000Z",
            created_at: "2026-03-13T10:00:00.000Z",
            updated_at: "2026-03-13T10:00:04.000Z",
          },
        });
        stream.emit({
          type: "final_done",
        });
      });

      expect(harness.getValue().currentTurnId).toBe("turn-1");
      expect(harness.getValue().turns).toHaveLength(1);
      expect(harness.getValue().turns[0]?.status).toBe("completed");
      expect(harness.getValue().threadItems).toHaveLength(1);
      expect(harness.getValue().threadItems[0]?.type).toBe("plan");
      expect(harness.getValue().threadItems[0]?.status).toBe("completed");
    } finally {
      harness.unmount();
    }
  });

  it("stream error 事件时应保留失败消息与失败回合", async () => {
    const workspaceId = "ws-thread-stream-error";
    seedSession(workspaceId, "session-thread-stream-error");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请开始处理", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "turn_started",
          turn: {
            id: "turn-stream-error-1",
            thread_id: "session-thread-stream-error",
            prompt_text: "请开始处理",
            status: "running",
            started_at: "2026-03-20T10:00:00.000Z",
            created_at: "2026-03-20T10:00:00.000Z",
            updated_at: "2026-03-20T10:00:00.000Z",
          },
        });
        stream.emit({
          type: "error",
          message: "模型执行失败",
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.content).toContain("执行失败：模型执行失败");
      expect(assistantMessage?.runtimeStatus).toMatchObject({
        phase: "failed",
        title: "当前处理失败",
      });
      expect(harness.getValue().turns).toEqual([
        expect.objectContaining({
          id: "turn-stream-error-1",
          status: "failed",
          error_message: "模型执行失败",
        }),
      ]);
      expect(harness.getValue().threadItems).toEqual([
        expect.objectContaining({
          id: expect.stringContaining("pending-item:"),
          type: "turn_summary",
          status: "failed",
          turn_id: "turn-stream-error-1",
        }),
      ]);
      expect(mockToast.error).toHaveBeenCalledWith("响应错误: 模型执行失败");
    } finally {
      harness.unmount();
    }
  });

  it("手动压缩上下文时即使没有 assistant 正文也应完成时间线更新", async () => {
    const workspaceId = "ws-context-compaction";
    seedSession(workspaceId, "session-context-compaction");
    const harness = mountHook(workspaceId);
    const stream = captureContextCompactionStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness.getValue().compactSession();
      });

      expect(mockCompactAgentRuntimeSession).toHaveBeenCalledWith({
        session_id: "session-context-compaction",
        event_name: stream.getEventName(),
      });

      act(() => {
        stream.emit({
          type: "turn_started",
          turn: {
            id: "turn-compact-1",
            thread_id: "session-context-compaction",
            prompt_text: "压缩上下文",
            status: "running",
            started_at: "2026-03-23T09:00:00.000Z",
            created_at: "2026-03-23T09:00:00.000Z",
            updated_at: "2026-03-23T09:00:00.000Z",
          },
        });
        stream.emit({
          type: "item_started",
          item: {
            id: "compact-1",
            thread_id: "session-context-compaction",
            turn_id: "turn-compact-1",
            sequence: 1,
            status: "in_progress",
            started_at: "2026-03-23T09:00:01.000Z",
            updated_at: "2026-03-23T09:00:01.000Z",
            type: "context_compaction",
            stage: "started",
            trigger: "manual",
            detail: "压缩当前会话上下文",
          },
        });
        stream.emit({
          type: "item_completed",
          item: {
            id: "compact-1",
            thread_id: "session-context-compaction",
            turn_id: "turn-compact-1",
            sequence: 1,
            status: "completed",
            started_at: "2026-03-23T09:00:01.000Z",
            completed_at: "2026-03-23T09:00:03.000Z",
            updated_at: "2026-03-23T09:00:03.000Z",
            type: "context_compaction",
            stage: "completed",
            trigger: "manual",
            detail: "已生成摘要并替换旧上下文",
          },
        });
        stream.emit({
          type: "turn_completed",
          turn: {
            id: "turn-compact-1",
            thread_id: "session-context-compaction",
            prompt_text: "压缩上下文",
            status: "completed",
            started_at: "2026-03-23T09:00:00.000Z",
            completed_at: "2026-03-23T09:00:04.000Z",
            created_at: "2026-03-23T09:00:00.000Z",
            updated_at: "2026-03-23T09:00:04.000Z",
          },
        });
        stream.emit({
          type: "warning",
          code: "context_compaction_accuracy",
          message:
            "长对话和多次上下文压缩会降低模型准确性；如果后续结果开始漂移，建议新开会话。",
        });
        stream.emit({
          type: "final_done",
        });
      });

      expect(harness.getValue().isSending).toBe(false);
      expect(harness.getValue().currentTurnId).toBe("turn-compact-1");
      expect(harness.getValue().turns).toEqual([
        expect.objectContaining({
          id: "turn-compact-1",
          status: "completed",
        }),
      ]);
      expect(harness.getValue().threadItems).toEqual([
        expect.objectContaining({
          id: "compact-1",
          type: "context_compaction",
          status: "completed",
          stage: "completed",
          trigger: "manual",
          detail: "已生成摘要并替换旧上下文",
        }),
      ]);
      expect(mockToast.warning).toHaveBeenCalledWith(
        "长对话和多次上下文压缩会降低模型准确性；如果后续结果开始漂移，建议新开会话。",
      );
      expect(mockToast.error).not.toHaveBeenCalledWith(
        expect.stringContaining("压缩上下文失败"),
      );
    } finally {
      harness.unmount();
    }
  });

  it("手动压缩上下文返回字符串错误时应透出真实原因", async () => {
    const workspaceId = "ws-context-compaction-error";
    seedSession(workspaceId, "session-context-compaction-error");
    const harness = mountHook(workspaceId);

    mockCompactAgentRuntimeSession.mockRejectedValueOnce(
      "当前会话上下文尚未准备完成，请稍后再试",
    );

    try {
      await flushEffects();

      await act(async () => {
        await harness.getValue().compactSession();
      });

      expect(mockToast.error).toHaveBeenCalledWith(
        "当前会话上下文尚未准备完成，请稍后再试",
      );
    } finally {
      harness.unmount();
    }
  });

  it("Artifact 恢复提示不应打断为全局 toast", async () => {
    const workspaceId = "ws-artifact-warning-tone";
    seedSession(workspaceId, "session-artifact-warning-tone");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "帮我整理成结构化文稿",
            [],
            false,
            false,
            false,
            "react",
          );
      });

      act(() => {
        stream.emit({
          type: "warning",
          code: "artifact_document_repaired",
          message:
            "ArtifactDocument 已落盘: 已根据正文整理出一份可继续编辑的草稿。",
        });
        stream.emit({
          type: "final_done",
        });
      });

      expect(mockToast.info).not.toHaveBeenCalled();
      expect(mockToast.warning).not.toHaveBeenCalledWith(
        expect.stringContaining("ArtifactDocument"),
      );
    } finally {
      harness.unmount();
    }
  });
});

describe("useAsterAgentChat runtime routing", () => {
  it("开启搜索能力时应提交 web_search，但不再重复提交 search_mode", async () => {
    const workspaceId = "ws-search-mode-allowed";
    seedSession(workspaceId, "session-search-mode-allowed");
    const harness = mountHook(workspaceId);

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "帮我看看今天的黄金价格",
            [],
            true,
            false,
            false,
            "react",
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "帮我看看今天的黄金价格",
          turn_config: expect.objectContaining({
            web_search: true,
          }),
          queue_if_busy: true,
        }),
      );
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config?.search_mode,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("runtime_status 与 thinking_delta 应在 final_done 前持续保留", async () => {
    const workspaceId = "ws-runtime-status-stream";
    seedSession(workspaceId, "session-runtime-status-stream");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "请先分析，再决定要不要搜索",
            [],
            true,
            true,
            false,
            "react",
          );
      });

      act(() => {
        stream.emit({
          type: "runtime_status",
          status: {
            phase: "routing",
            title: "已决定：先深度思考",
            detail: "先做更充分的意图理解，再决定是否调用搜索。",
            checkpoints: ["thinking 已开启", "搜索与工具保持候选状态"],
          },
        });
      });

      expect(
        harness
          .getValue()
          .threadItems.some(
            (item) =>
              item.type === "turn_summary" &&
              typeof item.text === "string" &&
              item.text.includes("先深度思考"),
          ),
      ).toBe(true);

      act(() => {
        stream.emit({
          type: "thinking_delta",
          text: "先判断任务是直接回答还是需要联网。",
        });
        stream.emit({
          type: "text_delta",
          text: "我会先分析你的诉求。",
        });
      });

      let assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.runtimeStatus).toMatchObject({
        phase: "routing",
        title: "先深度思考",
      });
      expect(
        assistantMessage?.contentParts?.some(
          (part) =>
            part.type === "thinking" &&
            part.text.includes("先判断任务是直接回答还是需要联网"),
        ),
      ).toBe(true);
      expect(assistantMessage?.content).toContain("我会先分析你的诉求。");

      act(() => {
        stream.emit({
          type: "final_done",
        });
      });

      assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.runtimeStatus).toBeUndefined();
      expect(assistantMessage?.isThinking).toBe(false);
    } finally {
      harness.unmount();
    }
  });

  it("final_done 后应主动刷新会话详情以恢复持久化执行轨迹", async () => {
    const workspaceId = "ws-final-done-refresh";
    const sessionId = "session-final-done-refresh";
    seedSession(workspaceId, sessionId);
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();
    mockGetAgentRuntimeSession.mockResolvedValueOnce({
      id: sessionId,
      messages: [
        {
          role: "user",
          timestamp: 1710000000,
          content: [{ type: "text", text: "请先分析，再回答" }],
        },
        {
          role: "assistant",
          timestamp: 1710000005,
          content: [
            { type: "thinking", thinking: "先分析意图。" },
            { type: "output_text", text: "分析完成，下面是回答。" },
          ],
        },
      ],
      turns: [
        {
          id: "turn-real-1",
          thread_id: sessionId,
          prompt_text: "请先分析，再回答",
          status: "completed",
          started_at: "2026-03-18T09:45:22.762244Z",
          completed_at: "2026-03-18T09:45:54.994500Z",
          created_at: "2026-03-18T09:45:22.762244Z",
          updated_at: "2026-03-18T09:45:54.994500Z",
        },
      ],
      items: [
        {
          id: "turn-summary-real-1",
          thread_id: sessionId,
          turn_id: "turn-real-1",
          sequence: 1,
          status: "completed",
          started_at: "2026-03-18T09:45:22.900000Z",
          completed_at: "2026-03-18T09:45:23.100000Z",
          updated_at: "2026-03-18T09:45:23.100000Z",
          type: "turn_summary",
          text: "已决定：直接回答优先",
        },
        {
          id: "reasoning-real-1",
          thread_id: sessionId,
          turn_id: "turn-real-1",
          sequence: 2,
          status: "completed",
          started_at: "2026-03-18T09:45:23.200000Z",
          completed_at: "2026-03-18T09:45:24.100000Z",
          updated_at: "2026-03-18T09:45:24.100000Z",
          type: "reasoning",
          text: "先分析意图。",
        },
      ],
    });

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请先分析，再回答", [], false, true, false, "react");
      });

      act(() => {
        stream.emit({
          type: "final_done",
        });
      });

      await flushEffects();
      await flushEffects();

      expect(mockGetAgentRuntimeSession).toHaveBeenCalledWith(sessionId);
      expect(harness.getValue().currentTurnId).toBe("turn-real-1");
      expect(harness.getValue().threadItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "turn-summary-real-1",
            type: "turn_summary",
            status: "completed",
            text: "直接回答优先",
          }),
          expect.objectContaining({
            id: "reasoning-real-1",
            type: "reasoning",
            status: "completed",
          }),
        ]),
      );
    } finally {
      harness.unmount();
    }
  });

  it("final_done 前未收到正文时应给出明确失败提示，而不是静默无响应", async () => {
    const workspaceId = "ws-empty-final-response";
    seedSession(workspaceId, "session-empty-final-response");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "帮我汇总今天的国际新闻",
            [],
            true,
            false,
            false,
            "react",
          );
      });

      act(() => {
        stream.emit({
          type: "tool_start",
          tool_name: "WebSearch",
          tool_id: "tool-search-1",
          arguments: JSON.stringify({ query: "今天的国际新闻" }),
        });
        stream.emit({
          type: "tool_end",
          tool_id: "tool-search-1",
          result: {
            success: true,
            output: "https://example.com/world-news",
          },
        });
        stream.emit({
          type: "final_done",
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.content).toContain(
        "已完成工具执行，但模型未输出最终答复，请重试。",
      );
      expect(mockToast.error).toHaveBeenCalledWith(
        "已完成工具执行，但模型未输出最终答复，请重试",
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
      expect(mockSubmitAgentRuntimeTurn).not.toHaveBeenCalled();
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
      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
    } finally {
      harness.unmount();
    }
  });

  it("命中 /compact 时应走本地压缩分支而非 chat_stream", async () => {
    const workspaceId = "ws-slash-compact";
    seedSession(workspaceId, "session-slash-compact");
    const harness = mountHook(workspaceId);
    const stream = captureContextCompactionStream();

    try {
      await flushEffects();
      await act(async () => {
        await harness
          .getValue()
          .sendMessage("/compact", [], false, false, false, "react");
      });

      expect(mockCompactAgentRuntimeSession).toHaveBeenCalledWith({
        session_id: "session-slash-compact",
        event_name: stream.getEventName(),
      });
      expect(mockSubmitAgentRuntimeTurn).not.toHaveBeenCalled();
      expect(mockParseSkillSlashCommand).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });

  it("命中 /clear 时应清空当前任务且不发送 chat_stream", async () => {
    const workspaceId = "ws-slash-clear";
    seedSession(workspaceId, "session-slash-clear");
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: "session-slash-clear",
      messages: [
        {
          role: "assistant",
          timestamp: 1700000001,
          content: [
            {
              type: "output_text",
              text: "hello",
            },
          ],
        },
      ],
      turns: [],
      items: [],
      queued_turns: [],
    });
    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      let messages = harness.getValue().messages;
      for (
        let attempt = 0;
        messages.length !== 1 && attempt < 5;
        attempt += 1
      ) {
        await flushEffects();
        messages = harness.getValue().messages;
      }
      expect(messages).toHaveLength(1);

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("/clear", [], false, false, false, "react");
      });

      expect(mockSubmitAgentRuntimeTurn).not.toHaveBeenCalled();
      expect(harness.getValue().messages).toEqual([]);
      expect(harness.getValue().sessionId).toBeNull();
      expect(mockToast.success).toHaveBeenCalledWith("已清空当前任务");
    } finally {
      harness.unmount();
    }
  });

  it("命中 /new 标题 时应创建新任务且不发送 chat_stream", async () => {
    const workspaceId = "ws-slash-new";
    const harness = mountHook(workspaceId);

    mockCreateAgentRuntimeSession.mockResolvedValue("session-slash-new");

    try {
      await flushEffects();
      await act(async () => {
        await harness
          .getValue()
          .sendMessage("/new 重构输入命令", [], false, false, false, "react");
      });

      expect(mockCreateAgentRuntimeSession).toHaveBeenCalledWith(
        workspaceId,
        "重构输入命令",
        "react",
      );
      expect(mockSubmitAgentRuntimeTurn).not.toHaveBeenCalled();
      expect(harness.getValue().sessionId).toBe("session-slash-new");
      expect(mockToast.success).not.toHaveBeenCalledWith(
        "已创建新任务：重构输入命令",
      );
    } finally {
      harness.unmount();
    }
  });

  it("命中 /review 时应转换为预置 prompt 后走 chat_stream", async () => {
    const workspaceId = "ws-slash-review";
    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness
          .getValue()
          .sendMessage("/review src-tauri", [], false, false, false, "react");
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("请对以下对象进行代码审查"),
        }),
      );
      expect(mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("src-tauri"),
        }),
      );
      expect(mockParseSkillSlashCommand).toHaveBeenCalledWith(
        expect.stringContaining("请对以下对象进行代码审查"),
      );
    } finally {
      harness.unmount();
    }
  });

  it("命中 /status 时应追加本地 assistant 状态消息", async () => {
    const workspaceId = "ws-slash-status";
    seedSession(workspaceId, "session-slash-status");
    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness
          .getValue()
          .sendMessage("/status", [], false, false, false, "react");
      });

      const latestMessage =
        harness.getValue().messages[harness.getValue().messages.length - 1];
      expect(latestMessage).toEqual(
        expect.objectContaining({
          role: "assistant",
          content: expect.stringContaining("当前会话状态："),
        }),
      );
      expect(latestMessage?.content).toContain("session-slash-status");
      expect(mockSubmitAgentRuntimeTurn).not.toHaveBeenCalled();
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
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "tool_start",
          tool_id: "tool-ask-1",
          tool_name: "Ask",
          arguments: JSON.stringify({
            question: "你希望海报主色调是什么？",
            options: ["蓝紫", "赛博绿"],
          }),
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
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "tool_start",
          tool_id: "tool-ask-fallback-id",
          tool_name: "Ask",
          arguments: JSON.stringify({
            id: "req-from-ask-arg",
            question: "你希望主色调是什么？",
          }),
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
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
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

  it("收到带 scope 的 action_required 后应保留作用域，并在提交时透传 action_scope", async () => {
    const workspaceId = "ws-action-required-scope";
    seedSession(workspaceId, "session-action-required-scope");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "action_required",
          request_id: "req-ar-scope-1",
          action_type: "ask_user",
          prompt: "请选择执行模式",
          scope: {
            session_id: "session-action-required-scope",
            thread_id: "thread-action-required-scope",
            turn_id: "turn-action-required-scope",
          },
          questions: [
            {
              question: "请选择执行模式",
              options: ["自动执行", "确认后执行"],
            },
          ],
        });
      });

      let assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.actionRequests?.[0]?.scope).toEqual({
        sessionId: "session-action-required-scope",
        threadId: "thread-action-required-scope",
        turnId: "turn-action-required-scope",
      });

      await act(async () => {
        await harness.getValue().confirmAction({
          requestId: "req-ar-scope-1",
          confirmed: true,
          actionType: "ask_user",
          response: '{"answer":"自动执行"}',
        });
      });

      assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(mockRespondAgentRuntimeAction).toHaveBeenCalledWith({
        session_id: "session-action-required-scope",
        request_id: "req-ar-scope-1",
        action_type: "ask_user",
        confirmed: true,
        response: '{"answer":"自动执行"}',
        user_data: { answer: "自动执行" },
        metadata: {
          elicitation_context: {
            source: "action_required",
            mode: "runtime_protocol",
            form_id: "req-ar-scope-1",
            action_type: "ask_user",
            field_count: 1,
            prompt: "请选择执行模式",
            entries: [
              {
                fieldId: "req-ar-scope-1_answer",
                fieldKey: "answer",
                label: "请选择执行模式",
                value: "自动执行",
                summary: "自动执行",
              },
            ],
          },
        },
        event_name: stream.getEventName(),
        action_scope: {
          session_id: "session-action-required-scope",
          thread_id: "thread-action-required-scope",
          turn_id: "turn-action-required-scope",
        },
      });
      expect(assistantMessage?.actionRequests?.[0]).toMatchObject({
        requestId: "req-ar-scope-1",
        status: "submitted",
        scope: {
          sessionId: "session-action-required-scope",
          threadId: "thread-action-required-scope",
          turnId: "turn-action-required-scope",
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("action_required 的字符串 options 应归一化为可展示选项", async () => {
    const workspaceId = "ws-action-required-options";
    seedSession(workspaceId, "session-action-required-options");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
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

  it("ask_user 多问题时应在进入聊天状态前裁剪为单轮单问", async () => {
    const workspaceId = "ws-action-required-governed-ask";
    seedSession(workspaceId, "session-action-required-governed-ask");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "action_required",
          request_id: "req-ar-governed-ask-1",
          action_type: "ask_user",
          prompt: "继续前先确认几个点",
          questions: [
            {
              question: "你希望我先聚焦哪一部分？",
            },
            {
              question: "这一步更看重速度还是完整度？",
            },
          ],
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.actionRequests?.[0]).toMatchObject({
        requestId: "req-ar-governed-ask-1",
        governance: {
          originalQuestionCount: 2,
          deferredQuestionCount: 1,
        },
      });
      expect(assistantMessage?.actionRequests?.[0]?.questions).toEqual([
        {
          question: "你希望我先聚焦哪一部分？",
          multiSelect: false,
        },
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("elicitation 多字段时应在进入聊天状态前裁剪为单轮单字段", async () => {
    const workspaceId = "ws-action-required-governed-elicitation";
    seedSession(workspaceId, "session-action-required-governed-elicitation");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "action_required",
          request_id: "req-ar-governed-elicitation-1",
          action_type: "elicitation",
          prompt: "补充创作约束",
          requested_schema: {
            type: "object",
            required: ["topic", "style"],
            properties: {
              topic: {
                type: "string",
                title: "主题",
              },
              style: {
                type: "string",
                title: "风格",
              },
            },
          },
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.actionRequests?.[0]).toMatchObject({
        requestId: "req-ar-governed-elicitation-1",
        governance: {
          originalFieldCount: 2,
          retainedFieldKey: "topic",
          deferredFieldCount: 1,
        },
        requestedSchema: {
          type: "object",
          required: ["topic"],
          properties: {
            topic: {
              type: "string",
              title: "主题",
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("elicitation 缺少 questions 时应从 requested_schema 扩展恢复 rich question，并在治理后只保留当前一问", async () => {
    const workspaceId = "ws-action-required-rich-elicitation";
    seedSession(workspaceId, "session-action-required-rich-elicitation");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "action_required",
          request_id: "req-ar-rich-elicitation-1",
          action_type: "elicitation",
          prompt: "继续前请确认执行模式和范围",
          requested_schema: {
            type: "object",
            required: ["mode", "scope"],
            properties: {
              mode: {
                type: "string",
                title: "执行模式",
              },
              scope: {
                type: "string",
                title: "执行范围",
              },
            },
            "x-lime-ask-user-questions": [
              {
                question: "请选择执行模式",
                header: "mode",
                options: [
                  {
                    label: "自动执行",
                    description: "直接继续推进",
                  },
                  {
                    value: "confirm",
                    label: "确认后执行",
                    description: "每一步都等我确认",
                  },
                ],
                multiSelect: false,
              },
              {
                question: "请选择执行范围",
                header: "scope",
                options: ["仅修改 ask", "顺手整理上下游"],
                multiSelect: false,
              },
            ],
          },
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.actionRequests?.[0]).toMatchObject({
        requestId: "req-ar-rich-elicitation-1",
        actionType: "elicitation",
        questions: [
          {
            question: "请选择执行模式",
            header: "mode",
            options: [
              {
                label: "自动执行",
                description: "直接继续推进",
              },
              {
                label: "确认后执行",
                description: "每一步都等我确认",
              },
            ],
            multiSelect: false,
          },
        ],
        governance: {
          originalQuestionCount: 2,
          deferredQuestionCount: 1,
          originalFieldCount: 2,
          retainedFieldKey: "mode",
          deferredFieldCount: 1,
        },
        requestedSchema: {
          type: "object",
          required: ["mode"],
          properties: {
            mode: {
              type: "string",
              title: "执行模式",
            },
          },
          "x-lime-ask-user-questions": [
            {
              question: "请选择执行模式",
              header: "mode",
              options: [
                {
                  label: "自动执行",
                  description: "直接继续推进",
                },
                {
                  label: "确认后执行",
                  description: "每一步都等我确认",
                },
              ],
              multiSelect: false,
            },
          ],
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("ask_user 提交后应保留只读回显，避免面板消失", async () => {
    const workspaceId = "ws-ask-submit-keep";
    seedSession(workspaceId, "session-ask-submit-keep");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "action_required",
          request_id: "req-ask-submit-1",
          action_type: "ask_user",
          prompt: "请选择执行模式",
          questions: [{ question: "你希望如何执行？" }],
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

      expect(mockRespondAgentRuntimeAction).toHaveBeenCalledWith({
        session_id: "session-ask-submit-keep",
        request_id: "req-ask-submit-1",
        action_type: "ask_user",
        confirmed: true,
        response: '{"answer":"自动执行（Auto）"}',
        user_data: { answer: "自动执行（Auto）" },
        metadata: {
          elicitation_context: {
            source: "action_required",
            mode: "runtime_protocol",
            form_id: "req-ask-submit-1",
            action_type: "ask_user",
            field_count: 1,
            prompt: "请选择执行模式",
            entries: [
              {
                fieldId: "req-ask-submit-1_answer",
                fieldKey: "answer",
                label: "你希望如何执行？",
                value: "自动执行（Auto）",
                summary: "自动执行（Auto）",
              },
            ],
          },
        },
        event_name: stream.getEventName(),
      });
      expect(assistantMessage?.actionRequests?.[0]).toMatchObject({
        requestId: "req-ask-submit-1",
        actionType: "ask_user",
        status: "submitted",
        submittedResponse: '{"answer":"自动执行（Auto）"}',
        submittedUserData: { answer: "自动执行（Auto）" },
      });
      expect(assistantMessage?.runtimeStatus).toMatchObject({
        phase: "routing",
        title: "已收到补充信息，继续处理中",
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

  it("replayPendingAction 应调用 replay request 命令并恢复 pendingActions", async () => {
    const workspaceId = "ws-replay-action-required";
    seedSession(workspaceId, "session-replay-action-required");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "action_required",
          request_id: "req-replay-1",
          action_type: "ask_user",
          prompt: "请选择执行模式",
          questions: [
            {
              question: "请选择执行模式",
              options: ["自动执行", "确认后执行"],
            },
          ],
        });
      });

      await act(async () => {
        await harness.getValue().confirmAction({
          requestId: "req-replay-1",
          confirmed: true,
          actionType: "ask_user",
          response: '{"answer":"自动执行"}',
        });
      });

      let assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.actionRequests?.[0]).toMatchObject({
        requestId: "req-replay-1",
        status: "submitted",
      });

      mockReplayAgentRuntimeRequest.mockResolvedValueOnce({
        type: "action_required",
        request_id: "req-replay-1",
        action_type: "ask_user",
        prompt: "请选择执行模式",
        questions: [
          {
            question: "请选择执行模式",
            options: ["自动执行", "确认后执行"],
          },
        ],
        scope: {
          session_id: "session-replay-action-required",
          thread_id: "thread-replay-action-required",
          turn_id: "turn-replay-action-required",
        },
      });

      await act(async () => {
        await expect(
          harness
            .getValue()
            .replayPendingAction("req-replay-1", assistantMessage?.id || ""),
        ).resolves.toBe(true);
      });

      assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(mockReplayAgentRuntimeRequest).toHaveBeenCalledWith({
        session_id: "session-replay-action-required",
        request_id: "req-replay-1",
      });
      expect(harness.getValue().pendingActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            requestId: "req-replay-1",
            actionType: "ask_user",
            status: "pending",
            scope: {
              sessionId: "session-replay-action-required",
              threadId: "thread-replay-action-required",
              turnId: "turn-replay-action-required",
            },
          }),
        ]),
      );
      expect(assistantMessage?.actionRequests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            requestId: "req-replay-1",
            actionType: "ask_user",
            status: "pending",
          }),
        ]),
      );
      expect(
        assistantMessage?.contentParts?.some(
          (part) =>
            part.type === "action_required" &&
            part.actionRequired.requestId === "req-replay-1" &&
            part.actionRequired.status === "pending",
        ),
      ).toBe(true);
      expect(mockToast.success).toHaveBeenCalledWith("已重新拉起待处理请求");
    } finally {
      harness.unmount();
    }
  });

  it("fallback ask 在真实 request_id 未就绪前应先记录答案，并在真实 request_id 到达后自动提交", async () => {
    const workspaceId = "ws-ask-fallback-pending";
    seedSession(workspaceId, "session-ask-fallback-pending");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("请继续", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "tool_start",
          tool_id: "tool-fallback-only",
          tool_name: "Ask",
          arguments: JSON.stringify({
            question: "请选择您喜欢的科技风格类型",
            options: ["网络矩阵", "极简未来"],
          }),
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

      let assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(mockRespondAgentRuntimeAction).not.toHaveBeenCalled();
      expect(mockToast.info).toHaveBeenCalledWith(
        "已记录你的回答，等待系统请求就绪后自动提交",
      );
      expect(assistantMessage?.actionRequests?.[0]).toMatchObject({
        requestId: "fallback:tool-fallback-only",
        status: "queued",
        submittedResponse: '{"answer":"网络矩阵"}',
        submittedUserData: { answer: "网络矩阵" },
      });

      act(() => {
        stream.emit({
          type: "action_required",
          request_id: "req-ask-real-1",
          action_type: "ask_user",
          prompt: "请选择您喜欢的科技风格类型",
          questions: [
            {
              question: "请选择您喜欢的科技风格类型",
              options: ["网络矩阵", "极简未来"],
            },
          ],
        });
      });

      await flushEffects();

      assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(mockRespondAgentRuntimeAction).toHaveBeenCalledWith({
        session_id: "session-ask-fallback-pending",
        request_id: "req-ask-real-1",
        action_type: "ask_user",
        confirmed: true,
        response: '{"answer":"网络矩阵"}',
        user_data: { answer: "网络矩阵" },
        metadata: {
          elicitation_context: {
            source: "action_required",
            mode: "runtime_protocol",
            form_id: "req-ask-real-1",
            action_type: "ask_user",
            field_count: 1,
            prompt: "请选择您喜欢的科技风格类型",
            entries: [
              {
                fieldId: "req-ask-real-1_answer",
                fieldKey: "answer",
                label: "请选择您喜欢的科技风格类型",
                value: "网络矩阵",
                summary: "网络矩阵",
              },
            ],
          },
        },
        event_name: expect.stringMatching(/^aster_stream_/),
      });
      expect(
        assistantMessage?.actionRequests?.some(
          (item) =>
            item.requestId === "req-ask-real-1" && item.status === "submitted",
        ),
      ).toBe(true);
    } finally {
      harness.unmount();
    }
  });

  it("Auto 模式下 tool_confirmation 应自动确认而不阻塞 UI", async () => {
    const workspaceId = "ws-auto-confirm";
    seedSession(workspaceId, "session-auto-confirm");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("执行命令", [], false, false, false, "auto");
      });

      act(() => {
        stream.emit({
          type: "action_required",
          request_id: "req-auto-1",
          action_type: "tool_confirmation",
          tool_name: "bash",
          arguments: { command: "ls" },
          prompt: "是否执行命令",
        });
      });

      await flushEffects();

      expect(mockRespondAgentRuntimeAction).toHaveBeenCalledWith({
        session_id: "session-auto-confirm",
        request_id: "req-auto-1",
        action_type: "tool_confirmation",
        confirmed: true,
        response: "Auto 模式自动确认",
        user_data: undefined,
        metadata: undefined,
      });

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
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("检查轨迹", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
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

  it("收到带 Lime 元数据块的 tool_end 后应清洗输出并恢复失败态 metadata", async () => {
    const workspaceId = "ws-tool-metadata-block";
    seedSession(workspaceId, "session-tool-metadata-block");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("执行任务", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "tool_start",
          tool_id: "tool-meta-1",
          tool_name: "SubAgentTask",
          arguments: JSON.stringify({
            prompt: "检查 harness 缺口",
          }),
        });
      });

      act(() => {
        stream.emit({
          type: "tool_end",
          tool_id: "tool-meta-1",
          result: {
            success: true,
            output: [
              "子任务执行失败，需要人工接管",
              "",
              "[Lime 工具元数据开始]",
              JSON.stringify({
                reported_success: false,
                role: "planner",
                failed_count: 1,
              }),
              "[Lime 工具元数据结束]",
            ].join("\n"),
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
      expect(toolCall?.result?.output).not.toContain("Lime 工具元数据");
      expect(toolCall?.result?.metadata).toMatchObject({
        reported_success: false,
        role: "planner",
        failed_count: 1,
      });
    } finally {
      harness.unmount();
    }
  });

  it("收到带 Lime 元数据块的 tool_end error 后应清洗错误文本并恢复失败态 metadata", async () => {
    const workspaceId = "ws-tool-metadata-error-block";
    seedSession(workspaceId, "session-tool-metadata-error-block");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("执行失败任务", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "tool_start",
          tool_id: "tool-meta-error-1",
          tool_name: "browser_navigate",
          arguments: JSON.stringify({
            url: "https://example.com",
          }),
        });
      });

      act(() => {
        stream.emit({
          type: "tool_end",
          tool_id: "tool-meta-error-1",
          result: {
            success: true,
            error: [
              "CDP 会话已断开，请重试",
              "",
              "[Lime 工具元数据开始]",
              JSON.stringify({
                reported_success: false,
                exit_code: 1,
                stderr_length: 128,
              }),
              "[Lime 工具元数据结束]",
            ].join("\n"),
          },
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");
      const toolCall = assistantMessage?.toolCalls?.find(
        (item) => item.id === "tool-meta-error-1",
      );

      expect(toolCall?.status).toBe("failed");
      expect(toolCall?.result?.error).toBe("CDP 会话已断开，请重试");
      expect(toolCall?.result?.error).not.toContain("Lime 工具元数据");
      expect(toolCall?.result?.metadata).toMatchObject({
        reported_success: false,
        exit_code: 1,
        stderr_length: 128,
      });
    } finally {
      harness.unmount();
    }
  });

  it("write_file 工具启动时应为当前 assistant 消息挂载 streaming artifact", async () => {
    const workspaceId = "ws-artifact-tool-start";
    seedSession(workspaceId, "session-artifact-tool-start");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("生成文档", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "tool_start",
          tool_id: "tool-write-1",
          tool_name: "write_file",
          arguments: JSON.stringify({
            path: "notes/demo.md",
            content: "# Demo\n\nartifact body",
          }),
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.artifacts?.[0]).toMatchObject({
        title: "demo.md",
        content: "# Demo\n\nartifact body",
        status: "streaming",
        meta: expect.objectContaining({
          filePath: "notes/demo.md",
          filename: "demo.md",
          source: "tool_start",
          sourceMessageId: assistantMessage?.id,
        }),
      });
    } finally {
      harness.unmount();
    }
  });

  it("write_file 工具启动时即使没有内容也应立即创建 preparing artifact 并触发 onWriteFile", async () => {
    const workspaceId = "ws-artifact-tool-start-preparing";
    seedSession(workspaceId, "session-artifact-tool-start-preparing");
    const onWriteFile = vi.fn();
    const harness = mountHook(workspaceId, { onWriteFile });
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("准备写入空文件", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "tool_start",
          tool_id: "tool-write-prepare-1",
          tool_name: "write_file",
          arguments: JSON.stringify({
            path: "notes/preparing.md",
          }),
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.artifacts).toHaveLength(1);
      expect(assistantMessage?.artifacts?.[0]).toMatchObject({
        title: "preparing.md",
        content: "",
        status: "streaming",
        meta: expect.objectContaining({
          filePath: "notes/preparing.md",
          writePhase: "preparing",
          source: "tool_start",
        }),
      });
      expect(onWriteFile).toHaveBeenCalledWith(
        "",
        "notes/preparing.md",
        expect.objectContaining({
          source: "tool_start",
          status: "streaming",
          metadata: expect.objectContaining({
            writePhase: "preparing",
            lastUpdateSource: "tool_start",
          }),
        }),
      );
    } finally {
      harness.unmount();
    }
  });

  it("write_file 工具启动时应递归识别嵌套参数中的协议路径", async () => {
    const workspaceId = "ws-artifact-tool-start-nested";
    seedSession(workspaceId, "session-artifact-tool-start-nested");
    const onWriteFile = vi.fn();
    const harness = mountHook(workspaceId, { onWriteFile });
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("生成嵌套文稿", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "tool_start",
          tool_id: "tool-write-nested-1",
          tool_name: "write_file",
          arguments: JSON.stringify({
            payload: {
              filePath: "notes/nested.md",
              content: "# Nested\n\nbody",
            },
          }),
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.artifacts?.[0]).toMatchObject({
        title: "nested.md",
        content: "",
        status: "streaming",
        meta: expect.objectContaining({
          filePath: "notes/nested.md",
          writePhase: "preparing",
          source: "tool_start",
        }),
      });
      expect(onWriteFile).toHaveBeenCalledWith(
        "",
        "notes/nested.md",
        expect.objectContaining({
          source: "tool_start",
          status: "streaming",
        }),
      );
    } finally {
      harness.unmount();
    }
  });

  it("apply_patch 工具启动时应立即暴露目标文件，避免工作台空白等待", async () => {
    const workspaceId = "ws-artifact-apply-patch";
    seedSession(workspaceId, "session-artifact-apply-patch");
    const onWriteFile = vi.fn();
    const harness = mountHook(workspaceId, { onWriteFile });
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("补丁更新文档", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "tool_start",
          tool_id: "tool-apply-patch-1",
          tool_name: "apply_patch",
          arguments: JSON.stringify({
            patch: [
              "*** Begin Patch",
              "*** Update File: notes/patched.md",
              "@@",
              "-old",
              "+new",
              "*** End Patch",
            ].join("\n"),
          }),
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.artifacts?.[0]).toMatchObject({
        title: "patched.md",
        content: "",
        status: "streaming",
        meta: expect.objectContaining({
          filePath: "notes/patched.md",
          writePhase: "preparing",
          source: "tool_start",
        }),
      });
      expect(onWriteFile).toHaveBeenCalledWith(
        "",
        "notes/patched.md",
        expect.objectContaining({
          source: "tool_start",
          status: "streaming",
        }),
      );
    } finally {
      harness.unmount();
    }
  });

  it("artifact_snapshot 完成后应在 final_done 时将 artifact 标记为 complete", async () => {
    const workspaceId = "ws-artifact-snapshot";
    seedSession(workspaceId, "session-artifact-snapshot");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("生成快照", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "artifact_snapshot",
          artifact: {
            artifactId: "artifact-snapshot-1",
            filePath: "notes/final.md",
            content: "# Final\n\nsnapshot body",
            metadata: {
              complete: false,
            },
          },
        });
      });

      let assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.artifacts?.[0]).toMatchObject({
        id: "artifact-snapshot-1",
        title: "final.md",
        status: "streaming",
        content: "# Final\n\nsnapshot body",
        meta: expect.objectContaining({
          filePath: "notes/final.md",
          source: "artifact_snapshot",
        }),
      });

      act(() => {
        stream.emit({
          type: "final_done",
        });
      });

      assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.artifacts?.[0]?.status).toBe("complete");
    } finally {
      harness.unmount();
    }
  });

  it("artifact_snapshot 到来时应复用同路径 artifact 而不是重复新增", async () => {
    const workspaceId = "ws-artifact-snapshot-reuse";
    seedSession(workspaceId, "session-artifact-snapshot-reuse");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("生成复用快照", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "tool_start",
          tool_id: "tool-write-reuse-1",
          tool_name: "write_file",
          arguments: JSON.stringify({
            path: "notes/reuse.md",
          }),
        });
      });

      const initialAssistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");
      const initialArtifactId = initialAssistantMessage?.artifacts?.[0]?.id;

      act(() => {
        stream.emit({
          type: "artifact_snapshot",
          artifact: {
            artifactId: "server-artifact-id-1",
            filePath: "notes/reuse.md",
            content: "# Reused\n\nsnapshot body",
            metadata: {
              complete: false,
            },
          },
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");

      expect(assistantMessage?.artifacts).toHaveLength(1);
      expect(assistantMessage?.artifacts?.[0]?.id).toBe(initialArtifactId);
      expect(assistantMessage?.artifacts?.[0]).toMatchObject({
        content: "# Reused\n\nsnapshot body",
        meta: expect.objectContaining({
          writePhase: "streaming",
          source: "artifact_snapshot",
        }),
      });
    } finally {
      harness.unmount();
    }
  });

  it("搜索工具来源应在后续 artifact_snapshot 中沉淀到同一文档", async () => {
    const workspaceId = "ws-artifact-sources-before-snapshot";
    seedSession(workspaceId, "session-artifact-sources-before-snapshot");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("先搜索再生成报告", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "tool_start",
          tool_id: "tool-search-1",
          tool_name: "WebSearch",
          arguments: JSON.stringify({
            query: "Artifact First 来源面板",
          }),
        });
      });

      act(() => {
        stream.emit({
          type: "tool_end",
          tool_id: "tool-search-1",
          result: {
            success: true,
            output: JSON.stringify({
              results: [
                {
                  title: "Artifact 来源指南",
                  url: "https://example.com/artifact-sources",
                  snippet: "统一来源与版本展示。",
                },
              ],
            }),
          },
        });
      });

      act(() => {
        stream.emit({
          type: "artifact_snapshot",
          artifact: {
            artifactId: "artifact-doc-search-1",
            filePath: ".lime/artifacts/thread-1/source-report.artifact.json",
            content: JSON.stringify({
              schemaVersion: "artifact_document.v1",
              artifactId: "artifact-doc-search-1",
              kind: "analysis",
              title: "来源报告",
              status: "ready",
              language: "zh-CN",
              summary: "先搜索后成文。",
              blocks: [
                {
                  id: "body-1",
                  type: "rich_text",
                  contentFormat: "markdown",
                  content: "正文内容",
                  markdown: "正文内容",
                },
              ],
              sources: [],
              metadata: {},
            }),
            metadata: {
              complete: false,
            },
          },
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");
      const artifactDocument = JSON.parse(
        assistantMessage?.artifacts?.[0]?.content || "{}",
      ) as {
        sources?: Array<{ locator?: { url?: string } }>;
      };

      expect(artifactDocument.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            locator: expect.objectContaining({
              url: "https://example.com/artifact-sources",
            }),
          }),
        ]),
      );
    } finally {
      harness.unmount();
    }
  });

  it("已有 artifact_snapshot 也应在后续 tool_end 时补齐来源", async () => {
    const workspaceId = "ws-artifact-sources-after-snapshot";
    seedSession(workspaceId, "session-artifact-sources-after-snapshot");
    const harness = mountHook(workspaceId);
    const stream = captureTurnStream();

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("先写报告再补来源", [], false, false, false, "react");
      });

      act(() => {
        stream.emit({
          type: "artifact_snapshot",
          artifact: {
            artifactId: "artifact-doc-search-2",
            filePath: ".lime/artifacts/thread-1/source-report-2.artifact.json",
            content: JSON.stringify({
              schemaVersion: "artifact_document.v1",
              artifactId: "artifact-doc-search-2",
              kind: "analysis",
              title: "来源报告 2",
              status: "ready",
              language: "zh-CN",
              summary: "先成文后补来源。",
              blocks: [
                {
                  id: "body-1",
                  type: "rich_text",
                  contentFormat: "markdown",
                  content: "正文内容",
                  markdown: "正文内容",
                },
              ],
              sources: [],
              metadata: {},
            }),
            metadata: {
              complete: false,
            },
          },
        });
      });

      act(() => {
        stream.emit({
          type: "tool_start",
          tool_id: "tool-search-2",
          tool_name: "WebSearch",
          arguments: JSON.stringify({
            query: "Artifact First 浏览器引用",
          }),
        });
      });

      act(() => {
        stream.emit({
          type: "tool_end",
          tool_id: "tool-search-2",
          result: {
            success: true,
            output: JSON.stringify({
              results: [
                {
                  title: "Browser Assist 文档",
                  url: "https://example.com/browser-assist",
                  snippet: "浏览器结果也应进入来源抽屉。",
                },
              ],
            }),
          },
        });
      });

      const assistantMessage = [...harness.getValue().messages]
        .reverse()
        .find((msg) => msg.role === "assistant");
      const artifactDocument = JSON.parse(
        assistantMessage?.artifacts?.[0]?.content || "{}",
      ) as {
        sources?: Array<{ locator?: { url?: string } }>;
      };

      expect(artifactDocument.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            locator: expect.objectContaining({
              url: "https://example.com/browser-assist",
            }),
          }),
        ]),
      );
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
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
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
      consoleWarnSpy.mockRestore();
      harness.unmount();
    }
  });

  it("会话映射为空占位时应写入当前工作区", async () => {
    const workspaceId = "ws-current";
    const sessionId = "session-invalid-placeholder";
    seedSession(workspaceId, sessionId);
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: sessionId,
      messages: [],
      turns: [],
      items: [],
      queued_turns: [],
    });
    localStorage.setItem(
      `agent_session_workspace_${sessionId}`,
      JSON.stringify("__invalid__"),
    );

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await flushEffects();
      expect(mockGetAgentRuntimeSession).toHaveBeenCalledWith(sessionId);
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

  it("恢复候选会话时应先由 runtime 确认工作区归属", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const workspaceId = "ws-restore-runtime-guard";
    const sessionId = "session-restore-runtime-guard";
    seedSession(workspaceId, sessionId);
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: sessionId,
      workspace_id: "ws-other-runtime",
      messages: [],
      turns: [],
      items: [],
      queued_turns: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await flushEffects();

      expect(mockGetAgentRuntimeSession).toHaveBeenCalledWith(sessionId);
      expect(harness.getValue().sessionId).toBeNull();
      expect(
        sessionStorage.getItem(`aster_curr_sessionId_${workspaceId}`),
      ).toBe("null");
      expect(localStorage.getItem(`aster_last_sessionId_${workspaceId}`)).toBe(
        "null",
      );
    } finally {
      consoleWarnSpy.mockRestore();
      harness.unmount();
    }
  });

  it("恢复失效会话时不应请求不存在的会话详情", async () => {
    const workspaceId = "ws-stale-session";
    const staleSessionId = "session-stale";
    const activeSessionId = "session-active";
    const now = Math.floor(Date.now() / 1000);

    seedSession(workspaceId, staleSessionId);
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: activeSessionId,
        name: "可用会话",
        created_at: now - 10,
        updated_at: now,
        messages_count: 1,
      },
    ]);
    mockGetAgentRuntimeSession.mockResolvedValue({
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
        mockGetAgentRuntimeSession.mock.calls.some(
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

    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "topic-current",
        name: "当前项目话题",
        created_at: createdAt,
        messages_count: 2,
        workspace_id: workspaceId,
      },
      {
        id: "topic-other",
        name: "其他项目话题",
        created_at: createdAt,
        messages_count: 3,
        workspace_id: "ws-filter-other",
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
      JSON.stringify("ws-stale-current"),
    );
    localStorage.setItem(
      "agent_session_workspace_topic-other",
      JSON.stringify(workspaceId),
    );

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await flushEffects();

      expect(harness.getValue().topics.map((topic) => topic.id)).toEqual([
        "topic-current",
        "topic-legacy",
      ]);
      expect(
        JSON.parse(
          localStorage.getItem("agent_session_workspace_topic-current") ||
            "null",
        ),
      ).toBe(workspaceId);
      expect(
        JSON.parse(
          localStorage.getItem("agent_session_workspace_topic-other") || "null",
        ),
      ).toBe("ws-filter-other");
    } finally {
      harness.unmount();
    }
  });

  it("切换话题后应恢复各自模型选择", async () => {
    const workspaceId = "ws-topic-memory";
    const createdAt = Math.floor(Date.now() / 1000);

    mockListAgentRuntimeSessions.mockResolvedValue([
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
    mockGetAgentRuntimeSession.mockImplementation(async (topicId: string) => ({
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

    mockListAgentRuntimeSessions.mockResolvedValue([
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
    mockGetAgentRuntimeSession.mockImplementation(async (topicId: string) => ({
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

  it("切换话题时应优先从 execution_runtime 恢复 provider/model", async () => {
    const workspaceId = "ws-topic-runtime-priority";
    const topicId = "topic-runtime-priority";
    localStorage.setItem(
      `agent_pref_provider_${workspaceId}`,
      JSON.stringify("deepseek"),
    );
    localStorage.setItem(
      `agent_pref_model_${workspaceId}`,
      JSON.stringify("deepseek-chat"),
    );
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      messages: [],
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        provider_selector: "openai",
        provider_name: "openai",
        model_name: "gpt-5.4-mini",
        source: "session",
      },
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();

      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      await flushEffects();

      const value = harness.getValue();
      expect(value.providerType).toBe("openai");
      expect(value.model).toBe("gpt-5.4-mini");
      expect(
        JSON.parse(
          localStorage.getItem(
            `agent_topic_model_pref_${workspaceId}_${topicId}`,
          ) || "null",
        ),
      ).toEqual({
        providerType: "openai",
        model: "gpt-5.4-mini",
      });
    } finally {
      harness.unmount();
    }
  });

  it("切换话题时 execution_runtime 缺失应回退本地 session preference", async () => {
    const workspaceId = "ws-topic-runtime-fallback";
    const topicId = "topic-runtime-fallback";
    localStorage.setItem(
      `agent_pref_provider_${workspaceId}`,
      JSON.stringify("openai"),
    );
    localStorage.setItem(
      `agent_pref_model_${workspaceId}`,
      JSON.stringify("gpt-5.4-mini"),
    );
    localStorage.setItem(
      `agent_topic_model_pref_${workspaceId}_${topicId}`,
      JSON.stringify({
        providerType: "gemini",
        model: "gemini-2.5-pro",
      }),
    );
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      messages: [],
      execution_strategy: "react",
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();

      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      await flushEffects();

      const value = harness.getValue();
      expect(value.providerType).toBe("gemini");
      expect(value.model).toBe("gemini-2.5-pro");
      expect(mockUpdateAgentRuntimeSession).toHaveBeenCalledWith({
        session_id: topicId,
        provider_name: "gemini",
        model_name: "gemini-2.5-pro",
      });
    } finally {
      harness.unmount();
    }
  });

  it("切换话题时 execution_strategy 缺失应回退工作区影子缓存并回写 session", async () => {
    const workspaceId = "ws-topic-strategy-fallback";
    const topicId = "topic-strategy-fallback";
    localStorage.setItem(
      `aster_execution_strategy_${workspaceId}`,
      JSON.stringify("auto"),
    );
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      messages: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();

      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      await flushEffects();

      expect(harness.getValue().executionStrategy).toBe("auto");
      expect(mockUpdateAgentRuntimeSession).toHaveBeenCalledWith({
        session_id: topicId,
        execution_strategy: "auto",
      });
    } finally {
      harness.unmount();
    }
  });

  it("切换话题时 recent_access_mode 缺失应回退本地 session access shadow 并回写 session", async () => {
    const workspaceId = "ws-topic-access-fallback";
    const topicId = "topic-access-fallback";
    localStorage.setItem(
      `aster_session_access_mode_${workspaceId}_${topicId}`,
      JSON.stringify("full-access"),
    );
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      messages: [],
      execution_strategy: "react",
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();

      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      await flushEffects();

      expect(harness.getValue().accessMode).toBe("full-access");
      expect(mockUpdateAgentRuntimeSession).toHaveBeenCalledWith({
        session_id: topicId,
        recent_access_mode: "full-access",
      });
    } finally {
      harness.unmount();
    }
  });

  it("切换话题时应保留工具调用历史并恢复 elicitation 回答文本", async () => {
    const workspaceId = "ws-history-hydrate";
    const now = Math.floor(Date.now() / 1000);
    mockGetAgentRuntimeSession.mockResolvedValue({
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
    mockGetAgentRuntimeSession.mockResolvedValue({
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
    mockGetAgentRuntimeSession.mockResolvedValue({
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
    mockGetAgentRuntimeSession.mockResolvedValue({
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

  it("切换话题时应清洗 tool_response error 中的 Lime 元数据块", async () => {
    const workspaceId = "ws-history-tool-error-metadata";
    const now = Math.floor(Date.now() / 1000);
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: "topic-tool-error-metadata",
      execution_strategy: "react",
      messages: [
        {
          role: "assistant",
          timestamp: now,
          content: [{ type: "text", text: "正在连接浏览器" }],
        },
        {
          role: "tool",
          timestamp: now + 1,
          content: [
            {
              type: "tool_response",
              id: "tool-error-1",
              success: true,
              error: [
                "CDP 连接失败，请检查目标页面",
                "",
                "[Lime 工具元数据开始]",
                JSON.stringify({
                  reported_success: false,
                  exit_code: 1,
                  sandboxed: true,
                }),
                "[Lime 工具元数据结束]",
              ].join("\n"),
            },
          ],
        },
      ],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic("topic-tool-error-metadata");
      });

      const value = harness.getValue();
      expect(value.messages).toHaveLength(1);

      const toolCall = value.messages[0]?.toolCalls?.find(
        (item) => item.id === "tool-error-1",
      );
      expect(toolCall?.status).toBe("failed");
      expect(toolCall?.result?.error).toBe("CDP 连接失败，请检查目标页面");
      expect(toolCall?.result?.error).not.toContain("Lime 工具元数据");
      expect(toolCall?.result?.metadata).toMatchObject({
        reported_success: false,
        exit_code: 1,
        sandboxed: true,
      });
    } finally {
      harness.unmount();
    }
  });

  it("切换话题时应合并同一工具调用的 running/completed 轨迹为一条", async () => {
    const workspaceId = "ws-history-tool-dedupe";
    const now = Math.floor(Date.now() / 1000);
    mockGetAgentRuntimeSession.mockResolvedValue({
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
              tool_name: "bash",
              arguments: { command: "echo hi", background: true },
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
    mockGetAgentRuntimeSession.mockResolvedValue({
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
    mockGetAgentRuntimeSession.mockResolvedValue({
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
      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]).toMatchObject({
        message: "",
      });
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
      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]).toMatchObject({
        message: prompt,
      });
    } finally {
      harness.unmount();
    }
  });

  it("发送请求时应透传 provider 偏好，避免 custom provider 类型丢失", async () => {
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

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.provider_preference,
      ).toBe(providerId);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.model_preference,
      ).toBe(model);
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

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.provider_preference,
      ).toBe(selectedProvider);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.model_preference,
      ).toBe(selectedModel);
    } finally {
      harness.unmount();
    }
  });

  it("已有会话时不应重复随 turn 提交 workspace_id", async () => {
    const workspaceId = "ws-runtime-workspace-reuse";
    const topicId = "topic-runtime-workspace-reuse";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      workspace_id: workspaceId,
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "继续沿用当前会话工作区",
            [],
            false,
            false,
            false,
            "react",
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]).not.toHaveProperty(
        "workspace_id",
      );
    } finally {
      harness.unmount();
    }
  });

  it("首次创建新会话发送时仍应提交 workspace_id", async () => {
    const workspaceId = "ws-runtime-workspace-bootstrap";
    const harness = mountHook(workspaceId);

    try {
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "首条消息需要绑定工作区",
            [],
            false,
            false,
            false,
            "react",
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.workspace_id).toBe(
        workspaceId,
      );
    } finally {
      harness.unmount();
    }
  });

  it("已有 recent_content_id 且 metadata 显式携带时，不应重复保留 content_id metadata", async () => {
    const workspaceId = "ws-runtime-content-id-reuse";
    const topicId = "topic-runtime-content-id-reuse";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_content_id: "content-current-1",
        source: "runtime_snapshot",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "继续写当前主稿",
            [],
            false,
            false,
            false,
            "react",
            undefined,
            undefined,
            {
              requestMetadata: {
                harness: {
                  content_id: "content-current-1",
                },
              },
            },
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config?.metadata,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("content_id 已变更但 session 仍是旧值时，应保留 content_id metadata", async () => {
    const workspaceId = "ws-runtime-content-id-pending-sync";
    const topicId = "topic-runtime-content-id-pending-sync";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_content_id: "content-old-1",
        source: "runtime_snapshot",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "切到新主稿后立即发送",
            [],
            false,
            false,
            false,
            "react",
            undefined,
            undefined,
            {
              requestMetadata: {
                harness: {
                  content_id: "content-new-1",
                },
              },
            },
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: { content_id?: string };
          } | null
        )?.harness?.content_id,
      ).toBe("content-new-1");
    } finally {
      harness.unmount();
    }
  });

  it("已有 recent_theme/recent_session_mode 且 metadata 显式携带时，不应重复保留 theme/session_mode metadata", async () => {
    const workspaceId = "ws-runtime-theme-reuse";
    const topicId = "topic-runtime-theme-reuse";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_theme: "general",
        recent_session_mode: "default",
        source: "runtime_snapshot",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "继续沿用当前主题会话",
            [],
            false,
            false,
            false,
            "react",
            undefined,
            undefined,
            {
              requestMetadata: {
                harness: {
                  theme: "general",
                  session_mode: "default",
                },
              },
            },
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config?.metadata,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("theme/session_mode 已变更但 session 仍是旧值时，应保留 theme/session_mode metadata", async () => {
    const workspaceId = "ws-runtime-theme-pending-sync";
    const topicId = "topic-runtime-theme-pending-sync";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_theme: "general",
        recent_session_mode: "default",
        source: "runtime_snapshot",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "切到工作台后立即发送",
            [],
            false,
            false,
            false,
            "react",
            undefined,
            undefined,
            {
              requestMetadata: {
                harness: {
                  theme: "document",
                  session_mode: "theme_workbench",
                },
              },
            },
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: { theme?: string; session_mode?: string };
          } | null
        )?.harness,
      ).toEqual({
        theme: "document",
        session_mode: "theme_workbench",
      });
    } finally {
      harness.unmount();
    }
  });

  it("已有 recent_gate_key/recent_run_title 且 metadata 显式携带时，不应重复保留 gate/run metadata", async () => {
    const workspaceId = "ws-runtime-gate-reuse";
    const topicId = "topic-runtime-gate-reuse";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_gate_key: "write_mode",
        recent_run_title: "社媒初稿",
        source: "runtime_snapshot",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "继续当前社媒运行",
            [],
            false,
            false,
            false,
            "react",
            undefined,
            undefined,
            {
              requestMetadata: {
                harness: {
                  gate_key: "write_mode",
                  run_title: "社媒初稿",
                },
              },
            },
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config?.metadata,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("gate_key/run_title 已变更但 session 仍是旧值时，应保留 gate/run metadata", async () => {
    const workspaceId = "ws-runtime-gate-pending-sync";
    const topicId = "topic-runtime-gate-pending-sync";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_gate_key: "topic_select",
        recent_run_title: "旧任务标题",
        source: "runtime_snapshot",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "切到新 gate 后立即发送",
            [],
            false,
            false,
            false,
            "react",
            undefined,
            undefined,
            {
              requestMetadata: {
                harness: {
                  gate_key: "publish_confirm",
                  run_title: "发布确认",
                },
              },
            },
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: { gate_key?: string; run_title?: string };
          } | null
        )?.harness,
      ).toEqual({
        gate_key: "publish_confirm",
        run_title: "发布确认",
      });
    } finally {
      harness.unmount();
    }
  });

  it("已有 recent_team_selection 且 metadata 显式携带时，不应重复保留 Team 选择 metadata", async () => {
    const workspaceId = "ws-runtime-team-selection-reuse";
    const topicId = "topic-runtime-team-selection-reuse";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_team_selection: {
          disabled: false,
          theme: "general",
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
              profileId: "code-explorer",
              roleKey: "explorer",
              skillIds: ["repo-exploration"],
            },
          ],
        },
        source: "session",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "继续沿用当前 Team 选择",
            [],
            false,
            false,
            false,
            "react",
            undefined,
            undefined,
            {
              requestMetadata: {
                harness: {
                  preferred_team_preset_id: "code-triage-team",
                  selected_team_id: "custom-team-1",
                  selected_team_source: "custom",
                  selected_team_label: "前端联调团队",
                  selected_team_description: "分析、实现、验证三段式推进。",
                  selected_team_summary: "分析、实现、验证三段式推进。",
                  selected_team_roles: [
                    {
                      id: "explorer",
                      label: "分析",
                      summary: "负责定位问题与影响范围。",
                      profile_id: "code-explorer",
                      role_key: "explorer",
                      skill_ids: ["repo-exploration"],
                    },
                  ],
                },
              },
            },
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config?.metadata,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("Team 选择已变更但 session 仍是旧值时，应保留 Team 选择 metadata", async () => {
    const workspaceId = "ws-runtime-team-selection-pending-sync";
    const topicId = "topic-runtime-team-selection-pending-sync";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_team_selection: {
          disabled: false,
          theme: "general",
          preferredTeamPresetId: "research-team",
          selectedTeamId: "runtime-team",
          selectedTeamSource: "builtin",
          selectedTeamLabel: "旧 Team",
          selectedTeamDescription: "旧 Team 描述。",
          selectedTeamSummary: "旧 Team 摘要。",
          selectedTeamRoles: [
            {
              id: "writer",
              label: "写作",
              summary: "负责整理文稿。",
              profileId: "writing-agent",
              roleKey: "writer",
              skillIds: ["drafting"],
            },
          ],
        },
        source: "session",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "切换 Team 后立即发送",
            [],
            false,
            false,
            false,
            "react",
            undefined,
            undefined,
            {
              requestMetadata: {
                harness: {
                  preferred_team_preset_id: "code-triage-team",
                  selected_team_id: "custom-team-1",
                  selected_team_source: "custom",
                  selected_team_label: "前端联调团队",
                  selected_team_description: "分析、实现、验证三段式推进。",
                  selected_team_summary: "分析、实现、验证三段式推进。",
                  selected_team_roles: [
                    {
                      id: "explorer",
                      label: "分析",
                      summary: "负责定位问题与影响范围。",
                      profile_id: "code-explorer",
                      role_key: "explorer",
                      skill_ids: ["repo-exploration"],
                    },
                  ],
                },
              },
            },
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: {
              selected_team_label?: string;
              selected_team_roles?: Array<{ profile_id?: string }>;
            };
          } | null
        )?.harness?.selected_team_label,
      ).toBe("前端联调团队");
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: {
              selected_team_roles?: Array<{ profile_id?: string }>;
            };
          } | null
        )?.harness?.selected_team_roles?.[0]?.profile_id,
      ).toBe("code-explorer");
    } finally {
      harness.unmount();
    }
  });

  it("已有 executionRuntime 且 provider/model 未变化时不应重复提交偏好", async () => {
    const workspaceId = "ws-runtime-model-reuse";
    const selectedProvider = "openai";
    const selectedModel = "gpt-5.4-mini";
    localStorage.setItem(
      `agent_pref_provider_${workspaceId}`,
      JSON.stringify(selectedProvider),
    );
    localStorage.setItem(
      `agent_pref_model_${workspaceId}`,
      JSON.stringify(selectedModel),
    );
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: "topic-runtime-model-reuse",
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: "topic-runtime-model-reuse",
        provider_selector: selectedProvider,
        provider_name: "openai",
        model_name: selectedModel,
        source: "session",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic("topic-runtime-model-reuse");
      });

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "继续沿用当前模型处理",
            [],
            false,
            false,
            false,
            "react",
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.provider_preference,
      ).toBeUndefined();
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.model_preference,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("同 provider 切模型且 session 已同步时不应重复提交 model 偏好", async () => {
    const workspaceId = "ws-runtime-model-switch-same-provider";
    const selectedProvider = "openai";
    const currentModel = "gpt-5.4-mini";
    const nextModel = "gpt-5.4";
    localStorage.setItem(
      `agent_pref_provider_${workspaceId}`,
      JSON.stringify(selectedProvider),
    );
    localStorage.setItem(
      `agent_pref_model_${workspaceId}`,
      JSON.stringify(currentModel),
    );
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: "topic-runtime-model-switch-same-provider",
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: "topic-runtime-model-switch-same-provider",
        provider_selector: selectedProvider,
        provider_name: "openai",
        model_name: currentModel,
        source: "session",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness
          .getValue()
          .switchTopic("topic-runtime-model-switch-same-provider");
      });

      act(() => {
        harness.getValue().setModel(nextModel);
      });
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "切换到同 provider 的另一个模型",
            [],
            false,
            false,
            false,
            "react",
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.provider_preference,
      ).toBeUndefined();
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.model_preference,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("同 provider 切模型但 session 同步未完成时仍应提交 model 偏好", async () => {
    const workspaceId = "ws-runtime-model-switch-pending-sync";
    const selectedProvider = "openai";
    const currentModel = "gpt-5.4-mini";
    const nextModel = "gpt-5.4";
    let resolveProviderSync: (() => void) | null = null;
    localStorage.setItem(
      `agent_pref_provider_${workspaceId}`,
      JSON.stringify(selectedProvider),
    );
    localStorage.setItem(
      `agent_pref_model_${workspaceId}`,
      JSON.stringify(currentModel),
    );
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: "topic-runtime-model-switch-pending-sync",
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: "topic-runtime-model-switch-pending-sync",
        provider_selector: selectedProvider,
        provider_name: "openai",
        model_name: currentModel,
        source: "session",
      },
      messages: [],
      turns: [],
      items: [],
    });
    mockUpdateAgentRuntimeSession.mockImplementation((request) => {
      if (request?.provider_name || request?.model_name) {
        return new Promise<void>((resolve) => {
          resolveProviderSync = resolve;
        });
      }
      return Promise.resolve();
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness
          .getValue()
          .switchTopic("topic-runtime-model-switch-pending-sync");
      });

      act(() => {
        harness.getValue().setModel(nextModel);
      });
      await flushEffects();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "切换到同 provider 的另一个模型，但 session 还没同步完",
            [],
            false,
            false,
            false,
            "react",
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.provider_preference,
      ).toBeUndefined();
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.model_preference,
      ).toBe(nextModel);
    } finally {
      (resolveProviderSync as (() => void) | null)?.();
      harness.unmount();
    }
  });

  it("execution_runtime 缺失但 session provider/model 已迁移回写后，不应重复随 turn 提交", async () => {
    const workspaceId = "ws-runtime-model-shadow-reuse";
    const topicId = "topic-runtime-model-shadow-reuse";
    localStorage.setItem(
      `agent_topic_model_pref_${workspaceId}_${topicId}`,
      JSON.stringify({
        providerType: "gemini",
        model: "gemini-2.5-pro",
      }),
    );
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      messages: [],
      execution_strategy: "react",
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();

      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      await flushEffects();
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "继续沿用刚迁移回写的模型处理",
            [],
            false,
            false,
            false,
            "react",
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.provider_preference,
      ).toBeUndefined();
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.model_preference,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("已有 recent_preferences.thinking 时不应重复随 turn 提交 thinking_enabled", async () => {
    const workspaceId = "ws-runtime-thinking-reuse";
    const topicId = "topic-runtime-thinking-reuse";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_preferences: {
          webSearch: false,
          thinking: true,
          task: false,
          subagent: false,
        },
        source: "session",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("继续沿用深度思考配置", [], false, true, false, "react");
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.thinking_enabled,
      ).toBeUndefined();
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: { preferences?: { thinking?: boolean } };
          } | null
        )?.harness?.preferences?.thinking,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("execution_runtime 缺失但 session recent_preferences 已同步时，不应重复随 turn 提交 thinking_enabled", async () => {
    const workspaceId = "ws-runtime-thinking-shadow-reuse";
    const topicId = "topic-runtime-thinking-shadow-reuse";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId, {
      getSyncedSessionRecentPreferences: (sessionId) =>
        sessionId === topicId
          ? {
              webSearch: false,
              thinking: true,
              task: false,
              subagent: false,
            }
          : null,
    });

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "继续沿用已同步的 thinking",
            [],
            false,
            true,
            false,
            "react",
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.thinking_enabled,
      ).toBeUndefined();
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: { preferences?: { thinking?: boolean } };
          } | null
        )?.harness?.preferences?.thinking,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("thinking 已变更但 session 仍是旧值时，仍应随 turn 提交 thinking_enabled", async () => {
    const workspaceId = "ws-runtime-thinking-pending-sync";
    const topicId = "topic-runtime-thinking-pending-sync";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_preferences: {
          webSearch: false,
          thinking: false,
          task: false,
          subagent: false,
        },
        source: "session",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "切换 thinking 后立即发送",
            [],
            false,
            true,
            false,
            "react",
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.thinking_enabled,
      ).toBe(true);
    } finally {
      harness.unmount();
    }
  });

  it("已有 recent_preferences.thinking 且 metadata 显式携带时，不应重复保留 thinking 偏好", async () => {
    const workspaceId = "ws-runtime-thinking-metadata-reuse";
    const topicId = "topic-runtime-thinking-metadata-reuse";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_preferences: {
          webSearch: false,
          thinking: true,
          task: false,
          subagent: false,
        },
        source: "session",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "继续沿用已保存的 thinking metadata 偏好",
            [],
            false,
            true,
            false,
            "react",
            undefined,
            undefined,
            {
              requestMetadata: {
                harness: {
                  preferences: {
                    thinking: true,
                  },
                },
              },
            },
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: { preferences?: { thinking?: boolean } };
          } | null
        )?.harness?.preferences?.thinking,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("thinking 已变更且 metadata 显式携带时，session 仍是旧值应保留 thinking 偏好", async () => {
    const workspaceId = "ws-runtime-thinking-metadata-pending-sync";
    const topicId = "topic-runtime-thinking-metadata-pending-sync";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_preferences: {
          webSearch: false,
          thinking: false,
          task: false,
          subagent: false,
        },
        source: "session",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "切换 thinking metadata 后立即发送",
            [],
            false,
            true,
            false,
            "react",
            undefined,
            undefined,
            {
              requestMetadata: {
                harness: {
                  preferences: {
                    thinking: true,
                  },
                },
              },
            },
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: { preferences?: { thinking?: boolean } };
          } | null
        )?.harness?.preferences?.thinking,
      ).toBe(true);
    } finally {
      harness.unmount();
    }
  });

  it("已有 recent_preferences.webSearch 时不应重复随 turn 提交 web_search", async () => {
    const workspaceId = "ws-runtime-websearch-reuse";
    const topicId = "topic-runtime-websearch-reuse";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_preferences: {
          webSearch: true,
          thinking: false,
          task: false,
          subagent: false,
        },
        source: "session",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "继续按已保存的联网偏好处理",
            [],
            true,
            false,
            false,
            "react",
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config?.web_search,
      ).toBeUndefined();
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config?.search_mode,
      ).toBeUndefined();
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: { preferences?: { web_search?: boolean } };
          } | null
        )?.harness?.preferences?.web_search,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("execution_runtime 缺失但 session recent_preferences 已同步时，不应重复随 turn 提交 web_search", async () => {
    const workspaceId = "ws-runtime-websearch-shadow-reuse";
    const topicId = "topic-runtime-websearch-shadow-reuse";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId, {
      getSyncedSessionRecentPreferences: (sessionId) =>
        sessionId === topicId
          ? {
              webSearch: true,
              thinking: false,
              task: false,
              subagent: false,
            }
          : null,
    });

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "继续沿用已同步的联网偏好",
            [],
            true,
            false,
            false,
            "react",
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config?.web_search,
      ).toBeUndefined();
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: { preferences?: { web_search?: boolean } };
          } | null
        )?.harness?.preferences?.web_search,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("webSearch 已变更但 session 仍是旧值时，仍应随 turn 提交 web_search", async () => {
    const workspaceId = "ws-runtime-websearch-pending-sync";
    const topicId = "topic-runtime-websearch-pending-sync";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_preferences: {
          webSearch: false,
          thinking: false,
          task: false,
          subagent: false,
        },
        source: "session",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "切换联网偏好后立即发送",
            [],
            true,
            false,
            false,
            "react",
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config?.web_search,
      ).toBe(true);
    } finally {
      harness.unmount();
    }
  });

  it("已有 recent_preferences.task/subagent 时不应重复随 turn 提交 metadata 偏好", async () => {
    const workspaceId = "ws-runtime-task-subagent-reuse";
    const topicId = "topic-runtime-task-subagent-reuse";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_preferences: {
          webSearch: false,
          thinking: false,
          task: true,
          subagent: true,
        },
        source: "session",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "继续沿用已保存的 task/subagent 偏好",
            [],
            false,
            false,
            false,
            "react",
            undefined,
            undefined,
            {
              requestMetadata: {
                harness: {
                  preferences: {
                    task: true,
                    subagent: true,
                  },
                },
              },
            },
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: {
              preferences?: { task?: boolean; subagent?: boolean };
            };
          } | null
        )?.harness?.preferences?.task,
      ).toBeUndefined();
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: {
              preferences?: { task?: boolean; subagent?: boolean };
            };
          } | null
        )?.harness?.preferences?.subagent,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("task/subagent 已变更但 session 仍是旧值时，仍应保留 metadata 偏好", async () => {
    const workspaceId = "ws-runtime-task-subagent-pending-sync";
    const topicId = "topic-runtime-task-subagent-pending-sync";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_preferences: {
          webSearch: false,
          thinking: false,
          task: false,
          subagent: false,
        },
        source: "session",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "切换 task/subagent 后立即发送",
            [],
            false,
            false,
            false,
            "react",
            undefined,
            undefined,
            {
              requestMetadata: {
                harness: {
                  preferences: {
                    task: true,
                    subagent: true,
                  },
                },
              },
            },
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: {
              preferences?: { task?: boolean; subagent?: boolean };
            };
          } | null
        )?.harness?.preferences?.task,
      ).toBe(true);
      expect(
        (
          mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
            ?.metadata as {
            harness?: {
              preferences?: { task?: boolean; subagent?: boolean };
            };
          } | null
        )?.harness?.preferences?.subagent,
      ).toBe(true);
    } finally {
      harness.unmount();
    }
  });

  it("已有 session execution_strategy 时不应重复随 turn 提交 execution_strategy", async () => {
    const workspaceId = "ws-runtime-strategy-reuse";
    const topicId = "topic-runtime-strategy-reuse";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "继续沿用当前执行策略",
            [],
            false,
            false,
            false,
            "react",
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.execution_strategy,
      ).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("切换 executionStrategy 但 session 同步未完成时仍应提交 execution_strategy", async () => {
    const workspaceId = "ws-runtime-strategy-pending-sync";
    const topicId = "topic-runtime-strategy-pending-sync";
    let resolveStrategySync: (() => void) | null = null;
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      messages: [],
      turns: [],
      items: [],
    });
    mockUpdateAgentRuntimeSession.mockImplementation((request) => {
      if (request?.execution_strategy) {
        return new Promise<void>((resolve) => {
          resolveStrategySync = resolve;
        });
      }
      return Promise.resolve();
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });

      act(() => {
        harness.getValue().setExecutionStrategy("auto");
      });
      await flushEffects();
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage("切换执行策略后立即发送", [], false, false, false);
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.execution_strategy,
      ).toBe("auto");
    } finally {
      (resolveStrategySync as (() => void) | null)?.();
      harness.unmount();
    }
  });

  it("已有 recent_access_mode 时发送消息应沿用恢复后的正式权限策略", async () => {
    const workspaceId = "ws-runtime-access-restore";
    const topicId = "topic-runtime-access-restore";
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: topicId,
      created_at: Date.now(),
      updated_at: Date.now(),
      execution_strategy: "react",
      execution_runtime: {
        session_id: topicId,
        execution_strategy: "react",
        recent_access_mode: "read-only",
        source: "session",
      },
      messages: [],
      turns: [],
      items: [],
    });

    const harness = mountHook(workspaceId);

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().switchTopic(topicId);
      });
      expect(harness.getValue().accessMode).toBe("read-only");
      mockSubmitAgentRuntimeTurn.mockClear();

      await act(async () => {
        await harness
          .getValue()
          .sendMessage(
            "沿用只读权限继续分析",
            [],
            false,
            false,
            false,
            "react",
          );
      });

      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledTimes(1);
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.approval_policy,
      ).toBe("on-request");
      expect(
        mockSubmitAgentRuntimeTurn.mock.calls[0]?.[0]?.turn_config
          ?.sandbox_policy,
      ).toBe("read-only");
    } finally {
      harness.unmount();
    }
  });

  it("流式 turn_context / model_change 应更新 executionRuntime，并在结束后仅保留 last runtime", async () => {
    const stream = captureTurnStream();
    const harness = mountHook("ws-execution-runtime");

    try {
      await flushEffects();
      await act(async () => {
        await harness.getValue().triggerAIGuide("请输出结构化结果");
      });

      await act(async () => {
        stream.emit({
          type: "turn_context",
          session_id: "created-session",
          thread_id: "created-session",
          turn_id: "turn-runtime-1",
          output_schema_runtime: {
            source: "turn",
            strategy: "native",
            providerName: "openai",
            modelName: "gpt-5.4",
          },
        });
      });

      expect(harness.getValue().executionRuntime).toMatchObject({
        session_id: "created-session",
        source: "turn_context",
        provider_name: "openai",
        model_name: "gpt-5.4",
      });
      expect(harness.getValue().activeExecutionRuntime).toMatchObject({
        model_name: "gpt-5.4",
      });

      await act(async () => {
        stream.emit({
          type: "model_change",
          model: "gpt-5.4-mini",
          mode: "responses",
        });
      });

      expect(harness.getValue().executionRuntime).toMatchObject({
        source: "model_change",
        model_name: "gpt-5.4-mini",
        mode: "responses",
      });
      expect(harness.getValue().activeExecutionRuntime).toMatchObject({
        model_name: "gpt-5.4-mini",
      });

      await act(async () => {
        stream.emit({
          type: "final_done",
        });
      });

      expect(harness.getValue().executionRuntime).toMatchObject({
        model_name: "gpt-5.4-mini",
      });
      expect(harness.getValue().activeExecutionRuntime).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  it("renameTopic 应调用后端并刷新话题标题", async () => {
    const createdAt = Math.floor(Date.now() / 1000);
    mockListAgentRuntimeSessions
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

      expect(mockUpdateAgentRuntimeSession).toHaveBeenCalledWith({
        session_id: "topic-1",
        name: "新标题",
      });

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

    mockListAgentRuntimeSessions.mockImplementation(
      async () => currentSessions,
    );
    mockDeleteAgentRuntimeSession.mockImplementation(async () => {
      currentSessions = [];
    });

    const harness = mountHook("ws-delete");

    try {
      await flushEffects();
      await flushEffects();

      await act(async () => {
        await harness.getValue().deleteTopic("topic-1");
      });

      expect(mockDeleteAgentRuntimeSession).toHaveBeenCalledTimes(1);
      expect(mockDeleteAgentRuntimeSession).toHaveBeenCalledWith("topic-1");

      const deletedTopic = harness
        .getValue()
        .topics.find((topic) => topic.id === "topic-1");
      expect(deletedTopic).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });
});
