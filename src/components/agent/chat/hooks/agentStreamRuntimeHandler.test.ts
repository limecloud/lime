import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/lib/api/agentProtocol";
import type { Message } from "../types";
import { handleTurnStreamEvent } from "./agentStreamRuntimeHandler";

const { mockToast } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

describe("agentStreamRuntimeHandler", () => {
  afterEach(() => {
    vi.useRealTimers();
    mockToast.success.mockReset();
    mockToast.error.mockReset();
    mockToast.info.mockReset();
    mockToast.warning.mockReset();
  });

  it("收到 final_done 时应把 usage 写回 assistant 消息", () => {
    let messages: Message[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "图片已经生成完成",
        timestamp: new Date("2026-04-07T10:00:00.000Z"),
        isThinking: true,
      },
    ];

    const setMessages = vi.fn(
      (value: Message[] | ((prev: Message[]) => Message[])) => {
        messages = typeof value === "function" ? value(messages) : value;
      },
    );

    handleTurnStreamEvent({
      data: {
        type: "final_done",
        usage: {
          input_tokens: 12_000,
          output_tokens: 19_000,
          cached_input_tokens: 8_000,
          cache_creation_input_tokens: 1_200,
        },
      } as AgentEvent,
      requestState: {
        accumulatedContent: "图片已经生成完成",
        queuedTurnId: null,
        requestLogId: null,
        requestStartedAt: 0,
        requestFinished: false,
      },
      callbacks: {
        activateStream: () => {},
        isStreamActivated: () => true,
        clearOptimisticItem: () => {},
        clearOptimisticTurn: () => {},
        disposeListener: () => {},
        removeQueuedDraftMessages: () => {},
        clearActiveStreamIfMatch: () => true,
        upsertQueuedTurn: () => {},
        removeQueuedTurnState: () => {},
        playToolcallSound: () => {},
        playTypewriterSound: () => {},
        appendThinkingToParts: (parts) => parts,
      },
      eventName: "agent-runtime-test",
      pendingTurnKey: "pending-turn",
      pendingItemKey: "pending-item",
      assistantMsgId: "assistant-1",
      activeSessionId: "session-1",
      resolvedWorkspaceId: "workspace-1",
      effectiveExecutionStrategy: "react",
      content: "图片已经生成完成",
      runtime: {} as never,
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      setMessages: setMessages as never,
      setPendingActions: vi.fn() as never,
      setThreadItems: vi.fn() as never,
      setThreadTurns: vi.fn() as never,
      setCurrentTurnId: vi.fn() as never,
      setExecutionRuntime: vi.fn() as never,
      setIsSending: vi.fn() as never,
    });

    expect(setMessages).toHaveBeenCalled();
    expect(messages[0]).toMatchObject({
      isThinking: false,
      usage: {
        input_tokens: 12_000,
        output_tokens: 19_000,
        cached_input_tokens: 8_000,
        cache_creation_input_tokens: 1_200,
      },
    });
  });

  it("收到完整 message 快照事件时只激活流，不重复写入文本", () => {
    const setMessages = vi.fn();
    const activateStream = vi.fn();

    handleTurnStreamEvent({
      data: {
        type: "message",
        message: {
          id: "msg-runtime-1",
          role: "assistant",
          content: [
            {
              type: "text",
              text: "完整快照会由后续 text_delta 渲染。",
            },
          ],
          timestamp: 1777284240,
        },
      } as AgentEvent,
      requestState: {
        accumulatedContent: "",
        queuedTurnId: null,
        requestLogId: null,
        requestStartedAt: 0,
        requestFinished: false,
      },
      callbacks: {
        activateStream,
        isStreamActivated: () => true,
        clearOptimisticItem: () => {},
        clearOptimisticTurn: () => {},
        disposeListener: () => {},
        removeQueuedDraftMessages: () => {},
        clearActiveStreamIfMatch: () => true,
        upsertQueuedTurn: () => {},
        removeQueuedTurnState: () => {},
        playToolcallSound: () => {},
        playTypewriterSound: () => {},
        appendThinkingToParts: (parts) => parts,
      },
      eventName: "agent-runtime-message-test",
      pendingTurnKey: "pending-turn",
      pendingItemKey: "pending-item",
      assistantMsgId: "assistant-1",
      activeSessionId: "session-1",
      resolvedWorkspaceId: "workspace-1",
      effectiveExecutionStrategy: "react",
      content: "生成验收矩阵",
      runtime: {} as never,
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      setMessages: setMessages as never,
      setPendingActions: vi.fn() as never,
      setThreadItems: vi.fn() as never,
      setThreadTurns: vi.fn() as never,
      setCurrentTurnId: vi.fn() as never,
      setExecutionRuntime: vi.fn() as never,
      setIsSending: vi.fn() as never,
    });

    expect(activateStream).toHaveBeenCalledTimes(1);
    expect(setMessages).not.toHaveBeenCalled();
  });

  it("高频 reasoning item_updated 事件不应持续刷新时间线状态", () => {
    const setThreadItems = vi.fn();
    const activateStream = vi.fn();

    handleTurnStreamEvent({
      data: {
        type: "item_updated",
        item: {
          id: "reasoning-1",
          thread_id: "session-1",
          turn_id: "turn-1",
          sequence: 2,
          type: "reasoning",
          text: "正在持续追加推理文本",
          status: "in_progress",
          started_at: "2026-04-27T10:00:00.000Z",
          updated_at: "2026-04-27T10:00:01.000Z",
        },
      } as AgentEvent,
      requestState: {
        accumulatedContent: "",
        queuedTurnId: null,
        requestLogId: null,
        requestStartedAt: 0,
        requestFinished: false,
      },
      callbacks: {
        activateStream,
        isStreamActivated: () => true,
        clearOptimisticItem: () => {},
        clearOptimisticTurn: () => {},
        disposeListener: () => {},
        removeQueuedDraftMessages: () => {},
        clearActiveStreamIfMatch: () => true,
        upsertQueuedTurn: () => {},
        removeQueuedTurnState: () => {},
        playToolcallSound: () => {},
        playTypewriterSound: () => {},
        appendThinkingToParts: (parts) => parts,
      },
      eventName: "agent-runtime-reasoning-test",
      pendingTurnKey: "pending-turn",
      pendingItemKey: "pending-item",
      assistantMsgId: "assistant-1",
      activeSessionId: "session-1",
      resolvedWorkspaceId: "workspace-1",
      effectiveExecutionStrategy: "react",
      content: "生成验收矩阵",
      runtime: {} as never,
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      setMessages: vi.fn() as never,
      setPendingActions: vi.fn() as never,
      setThreadItems: setThreadItems as never,
      setThreadTurns: vi.fn() as never,
      setCurrentTurnId: vi.fn() as never,
      setExecutionRuntime: vi.fn() as never,
      setIsSending: vi.fn() as never,
    });

    expect(activateStream).toHaveBeenCalledTimes(1);
    expect(setThreadItems).not.toHaveBeenCalled();
  });

  it("收到 final_done 时应剥离 assistant 正文中的工具协议残留", () => {
    let messages: Message[] = [
      {
        id: "assistant-2",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-04-07T10:00:00.000Z"),
        isThinking: true,
      },
    ];

    const setMessages = vi.fn(
      (value: Message[] | ((prev: Message[]) => Message[])) => {
        messages = typeof value === "function" ? value(messages) : value;
      },
    );

    handleTurnStreamEvent({
      data: {
        type: "final_done",
      } as AgentEvent,
      requestState: {
        accumulatedContent:
          '<tool_result>{"output":"saved"}</tool_result>\n\n已保存到项目目录。',
        queuedTurnId: null,
        requestLogId: null,
        requestStartedAt: 0,
        requestFinished: false,
      },
      callbacks: {
        activateStream: () => {},
        isStreamActivated: () => true,
        clearOptimisticItem: () => {},
        clearOptimisticTurn: () => {},
        disposeListener: () => {},
        removeQueuedDraftMessages: () => {},
        clearActiveStreamIfMatch: () => true,
        upsertQueuedTurn: () => {},
        removeQueuedTurnState: () => {},
        playToolcallSound: () => {},
        playTypewriterSound: () => {},
        appendThinkingToParts: (parts) => parts,
      },
      eventName: "agent-runtime-test",
      pendingTurnKey: "pending-turn",
      pendingItemKey: "pending-item",
      assistantMsgId: "assistant-2",
      activeSessionId: "session-1",
      resolvedWorkspaceId: "workspace-1",
      effectiveExecutionStrategy: "react",
      content: "",
      runtime: {} as never,
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      setMessages: setMessages as never,
      setPendingActions: vi.fn() as never,
      setThreadItems: vi.fn() as never,
      setThreadTurns: vi.fn() as never,
      setCurrentTurnId: vi.fn() as never,
      setExecutionRuntime: vi.fn() as never,
      setIsSending: vi.fn() as never,
    });

    expect(messages[0]?.content).toBe("已保存到项目目录。");
  });

  it("收到空 final_done 且没有真实产物信号时应落成失败态", () => {
    let messages: Message[] = [
      {
        id: "assistant-3",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-04-07T10:00:00.000Z"),
        isThinking: true,
      },
    ];

    const setMessages = vi.fn(
      (value: Message[] | ((prev: Message[]) => Message[])) => {
        messages = typeof value === "function" ? value(messages) : value;
      },
    );

    handleTurnStreamEvent({
      data: {
        type: "final_done",
      } as AgentEvent,
      requestState: {
        accumulatedContent: "",
        queuedTurnId: null,
        requestLogId: null,
        requestStartedAt: 0,
        requestFinished: false,
      },
      callbacks: {
        activateStream: () => {},
        isStreamActivated: () => true,
        clearOptimisticItem: () => {},
        clearOptimisticTurn: () => {},
        disposeListener: () => {},
        removeQueuedDraftMessages: () => {},
        clearActiveStreamIfMatch: () => true,
        upsertQueuedTurn: () => {},
        removeQueuedTurnState: () => {},
        playToolcallSound: () => {},
        playTypewriterSound: () => {},
        appendThinkingToParts: (parts) => parts,
      },
      eventName: "agent-runtime-test",
      pendingTurnKey: "pending-turn",
      pendingItemKey: "pending-item",
      assistantMsgId: "assistant-3",
      activeSessionId: "session-1",
      resolvedWorkspaceId: "workspace-1",
      effectiveExecutionStrategy: "react",
      content: "",
      runtime: {} as never,
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      setMessages: setMessages as never,
      setPendingActions: vi.fn() as never,
      setThreadItems: vi.fn() as never,
      setThreadTurns: vi.fn() as never,
      setCurrentTurnId: vi.fn() as never,
      setExecutionRuntime: vi.fn() as never,
      setIsSending: vi.fn() as never,
    });

    expect(messages[0]?.content).toBe("执行失败：模型未输出最终答复，请重试");
    expect(messages[0]?.runtimeStatus).toMatchObject({
      phase: "failed",
      title: "当前处理失败",
    });
    expect(mockToast.error).toHaveBeenCalledWith("模型未输出最终答复，请重试");
  });

  it("站点导出在 tool_end 已登记结果时，空 final_done 不应误报缺少最终答复", () => {
    let messages: Message[] = [
      {
        id: "assistant-site-export",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-04-07T10:00:00.000Z"),
        isThinking: true,
        toolCalls: [
          {
            id: "tool-site-export-1",
            name: "site_run_adapter",
            status: "running",
            startTime: new Date("2026-04-07T10:00:00.000Z"),
          },
        ],
      },
    ];

    const requestState = {
      accumulatedContent: "",
      hasMeaningfulCompletionSignal: false,
      queuedTurnId: null,
      requestLogId: null,
      requestStartedAt: 0,
      requestFinished: false,
    };

    const callbacks = {
      activateStream: () => {},
      isStreamActivated: () => true,
      clearOptimisticItem: () => {},
      clearOptimisticTurn: () => {},
      disposeListener: () => {},
      removeQueuedDraftMessages: () => {},
      clearActiveStreamIfMatch: () => true,
      upsertQueuedTurn: () => {},
      removeQueuedTurnState: () => {},
      playToolcallSound: () => {},
      playTypewriterSound: () => {},
      appendThinkingToParts: (parts: NonNullable<Message["contentParts"]>) =>
        parts,
    };

    const setMessages = vi.fn(
      (value: Message[] | ((prev: Message[]) => Message[])) => {
        messages = typeof value === "function" ? value(messages) : value;
      },
    );

    handleTurnStreamEvent({
      data: {
        type: "tool_end",
        tool_id: "tool-site-export-1",
        result: {
          success: true,
          output: "exports/x-article-export/article/index.md",
          metadata: {
            tool_family: "site",
            saved_content: {
              content_id: "content-site-export-1",
              project_id: "project-site-export-1",
              markdown_relative_path:
                "exports/x-article-export/article/index.md",
            },
          },
        },
      } as AgentEvent,
      requestState,
      callbacks,
      eventName: "agent-runtime-test",
      pendingTurnKey: "pending-turn",
      pendingItemKey: "pending-item",
      assistantMsgId: "assistant-site-export",
      activeSessionId: "session-1",
      resolvedWorkspaceId: "workspace-1",
      effectiveExecutionStrategy: "react",
      content: "",
      runtime: {} as never,
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>([
        ["tool-site-export-1", "site_run_adapter"],
      ]),
      setMessages: setMessages as never,
      setPendingActions: vi.fn() as never,
      setThreadItems: vi.fn() as never,
      setThreadTurns: vi.fn() as never,
      setCurrentTurnId: vi.fn() as never,
      setExecutionRuntime: vi.fn() as never,
      setIsSending: vi.fn() as never,
    });

    expect(requestState.hasMeaningfulCompletionSignal).toBe(true);

    handleTurnStreamEvent({
      data: {
        type: "final_done",
      } as AgentEvent,
      requestState,
      callbacks,
      eventName: "agent-runtime-test",
      pendingTurnKey: "pending-turn",
      pendingItemKey: "pending-item",
      assistantMsgId: "assistant-site-export",
      activeSessionId: "session-1",
      resolvedWorkspaceId: "workspace-1",
      effectiveExecutionStrategy: "react",
      content: "",
      runtime: {} as never,
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      setMessages: setMessages as never,
      setPendingActions: vi.fn() as never,
      setThreadItems: vi.fn() as never,
      setThreadTurns: vi.fn() as never,
      setCurrentTurnId: vi.fn() as never,
      setExecutionRuntime: vi.fn() as never,
      setIsSending: vi.fn() as never,
    });

    expect(messages[0]?.content).toBe(
      "本轮执行已完成，详细过程与产物已保留在当前对话中。",
    );
    expect(mockToast.error).not.toHaveBeenCalledWith(
      "模型未输出最终答复，请重试",
    );
  });

  it("命中空最终答复错误但已有真实产物信号时仍应软完成", () => {
    let messages: Message[] = [
      {
        id: "assistant-site-export-error",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-04-07T10:00:00.000Z"),
        isThinking: true,
      },
    ];

    const setMessages = vi.fn(
      (value: Message[] | ((prev: Message[]) => Message[])) => {
        messages = typeof value === "function" ? value(messages) : value;
      },
    );

    handleTurnStreamEvent({
      data: {
        type: "error",
        message:
          "已完成当前回合的工具执行，但模型未输出最终答复。\n尝试记录: site_run_adapter#tool-site-export-2:success",
      } as AgentEvent,
      requestState: {
        accumulatedContent: "",
        hasMeaningfulCompletionSignal: true,
        queuedTurnId: null,
        requestLogId: null,
        requestStartedAt: 0,
        requestFinished: false,
      },
      callbacks: {
        activateStream: () => {},
        isStreamActivated: () => true,
        clearOptimisticItem: () => {},
        clearOptimisticTurn: () => {},
        disposeListener: () => {},
        removeQueuedDraftMessages: () => {},
        clearActiveStreamIfMatch: () => true,
        upsertQueuedTurn: () => {},
        removeQueuedTurnState: () => {},
        playToolcallSound: () => {},
        playTypewriterSound: () => {},
        appendThinkingToParts: (parts) => parts,
      },
      eventName: "agent-runtime-test",
      pendingTurnKey: "pending-turn",
      pendingItemKey: "pending-item",
      assistantMsgId: "assistant-site-export-error",
      activeSessionId: "session-1",
      resolvedWorkspaceId: "workspace-1",
      effectiveExecutionStrategy: "react",
      content: "",
      runtime: {} as never,
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      setMessages: setMessages as never,
      setPendingActions: vi.fn() as never,
      setThreadItems: vi.fn() as never,
      setThreadTurns: vi.fn() as never,
      setCurrentTurnId: vi.fn() as never,
      setExecutionRuntime: vi.fn() as never,
      setIsSending: vi.fn() as never,
    });

    expect(messages[0]?.content).toBe(
      "本轮执行已完成，详细过程与产物已保留在当前对话中。",
    );
    expect(messages[0]?.runtimeStatus).toBeUndefined();
    expect(mockToast.error).not.toHaveBeenCalledWith(
      "模型未输出最终答复，请重试",
    );
  });

  it("收到 queue_removed 时不应立刻清空当前 assistant 草稿", () => {
    vi.useFakeTimers();
    const disposeListener = vi.fn();
    const removeQueuedDraftMessages = vi.fn();

    handleTurnStreamEvent({
      data: {
        type: "queue_removed",
        queued_turn_id: "queued-1",
      } as AgentEvent,
      requestState: {
        accumulatedContent: "",
        queuedTurnId: "queued-1",
        queuedDraftCleanupTimerId: null,
        requestLogId: null,
        requestStartedAt: 0,
        requestFinished: false,
      },
      callbacks: {
        activateStream: () => {},
        isStreamActivated: () => false,
        clearOptimisticItem: () => {},
        clearOptimisticTurn: () => {},
        disposeListener,
        removeQueuedDraftMessages,
        clearActiveStreamIfMatch: () => true,
        upsertQueuedTurn: () => {},
        removeQueuedTurnState: () => {},
        playToolcallSound: () => {},
        playTypewriterSound: () => {},
        appendThinkingToParts: (parts) => parts,
      },
      eventName: "agent-runtime-test",
      pendingTurnKey: "pending-turn",
      pendingItemKey: "pending-item",
      assistantMsgId: "assistant-queue-removed",
      activeSessionId: "session-1",
      resolvedWorkspaceId: "workspace-1",
      effectiveExecutionStrategy: "react",
      content: "继续执行",
      runtime: {} as never,
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      setMessages: vi.fn() as never,
      setPendingActions: vi.fn() as never,
      setThreadItems: vi.fn() as never,
      setThreadTurns: vi.fn() as never,
      setCurrentTurnId: vi.fn() as never,
      setExecutionRuntime: vi.fn() as never,
      setIsSending: vi.fn() as never,
    });

    expect(disposeListener).not.toHaveBeenCalled();
    expect(removeQueuedDraftMessages).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1799);
    expect(disposeListener).not.toHaveBeenCalled();
    expect(removeQueuedDraftMessages).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(disposeListener).toHaveBeenCalledTimes(1);
    expect(removeQueuedDraftMessages).toHaveBeenCalledTimes(1);
  });

  it("queue_removed 后若很快收到 turn_started，则不应清空 assistant 草稿", () => {
    vi.useFakeTimers();
    const disposeListener = vi.fn();
    const removeQueuedDraftMessages = vi.fn();
    const requestState = {
      accumulatedContent: "",
      queuedTurnId: "queued-1",
      queuedDraftCleanupTimerId: null,
      requestLogId: null,
      requestStartedAt: 0,
      requestFinished: false,
    };
    let activated = false;

    const baseCallbacks = {
      activateStream: () => {
        activated = true;
      },
      isStreamActivated: () => activated,
      clearOptimisticItem: () => {},
      clearOptimisticTurn: () => {},
      disposeListener,
      removeQueuedDraftMessages,
      clearActiveStreamIfMatch: () => true,
      upsertQueuedTurn: () => {},
      removeQueuedTurnState: () => {},
      playToolcallSound: () => {},
      playTypewriterSound: () => {},
      appendThinkingToParts: (parts: NonNullable<Message["contentParts"]>) =>
        parts,
    };

    handleTurnStreamEvent({
      data: {
        type: "queue_removed",
        queued_turn_id: "queued-1",
      } as AgentEvent,
      requestState,
      callbacks: baseCallbacks,
      eventName: "agent-runtime-test",
      pendingTurnKey: "pending-turn",
      pendingItemKey: "pending-item",
      assistantMsgId: "assistant-queue-removed",
      activeSessionId: "session-1",
      resolvedWorkspaceId: "workspace-1",
      effectiveExecutionStrategy: "react",
      content: "继续执行",
      runtime: {} as never,
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      setMessages: vi.fn() as never,
      setPendingActions: vi.fn() as never,
      setThreadItems: vi.fn() as never,
      setThreadTurns: vi.fn() as never,
      setCurrentTurnId: vi.fn() as never,
      setExecutionRuntime: vi.fn() as never,
      setIsSending: vi.fn() as never,
    });

    handleTurnStreamEvent({
      data: {
        type: "turn_started",
        turn: {
          id: "turn-1",
          thread_id: "session-1",
          prompt_text: "继续执行",
          status: "running",
          started_at: "2026-04-09T08:00:00.000Z",
          created_at: "2026-04-09T08:00:00.000Z",
          updated_at: "2026-04-09T08:00:00.000Z",
        },
      } as AgentEvent,
      requestState,
      callbacks: baseCallbacks,
      eventName: "agent-runtime-test",
      pendingTurnKey: "pending-turn",
      pendingItemKey: "pending-item",
      assistantMsgId: "assistant-queue-removed",
      activeSessionId: "session-1",
      resolvedWorkspaceId: "workspace-1",
      effectiveExecutionStrategy: "react",
      content: "继续执行",
      runtime: {} as never,
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      setMessages: vi.fn() as never,
      setPendingActions: vi.fn() as never,
      setThreadItems: vi.fn() as never,
      setThreadTurns: vi.fn() as never,
      setCurrentTurnId: vi.fn() as never,
      setExecutionRuntime: vi.fn() as never,
      setIsSending: vi.fn() as never,
    });

    vi.advanceTimersByTime(5000);
    expect(disposeListener).not.toHaveBeenCalled();
    expect(removeQueuedDraftMessages).not.toHaveBeenCalled();
  });
});
