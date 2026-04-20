import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import { activityLogger } from "@/lib/workspace/workbenchRuntime";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import type {
  AsterSessionExecutionRuntime,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type { ActionRequired, Message } from "../types";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import type { StreamRequestState } from "./agentStreamSubmissionLifecycle";
import { registerAgentStreamTurnEventBinding } from "./agentStreamTurnEventBinding";

function noopDispatch<T>() {
  return vi.fn() as unknown as Dispatch<SetStateAction<T>>;
}

describe("agentStreamTurnEventBinding", () => {
  afterEach(() => {
    vi.useRealTimers();
    activityLogger.clear();
  });

  it("应登记 request start 日志并返回 turn listener", async () => {
    const unlisten = vi.fn();
    const runtime = {
      listenToTurnEvents: vi.fn(async () => unlisten),
    } as unknown as AgentRuntimeAdapter;
    const requestState: StreamRequestState = {
      accumulatedContent: "",
      requestLogId: null,
      requestStartedAt: 0,
      requestFinished: false,
      queuedTurnId: null,
    };

    const result = await registerAgentStreamTurnEventBinding({
      runtime,
      eventName: "event-1",
      requestState,
      skipUserMessage: false,
      effectiveProviderType: "openai",
      effectiveModel: "gpt-5.4",
      effectiveExecutionStrategy: "react",
      content: "继续生成提纲",
      expectingQueue: false,
      activeSessionId: "session-1",
      resolvedWorkspaceId: "workspace-1",
      assistantMsgId: "assistant-1",
      pendingTurnKey: "pending-turn-1",
      pendingItemKey: "pending-item-1",
      effectiveWaitingRuntimeStatus: {
        phase: "preparing",
        title: "处理中",
        detail: "正在准备执行上下文",
      },
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      callbacks: {
        activateStream: () => {},
        isStreamActivated: () => false,
        clearOptimisticItem: () => {},
        clearOptimisticTurn: () => {},
        disposeListener: () => {},
        removeQueuedDraftMessages: () => {},
        clearActiveStreamIfMatch: () => false,
        upsertQueuedTurn: (_queuedTurn: QueuedTurnSnapshot) => {},
        removeQueuedTurnState: () => {},
      },
      sounds: {
        playToolcallSound: () => {},
        playTypewriterSound: () => {},
      },
      appendThinkingToParts: (parts) => parts,
      setMessages: noopDispatch<Message[]>(),
      setPendingActions: noopDispatch<ActionRequired[]>(),
      setThreadItems: noopDispatch<AgentThreadItem[]>(),
      setThreadTurns: noopDispatch<AgentThreadTurn[]>(),
      setCurrentTurnId: noopDispatch<string | null>(),
      setExecutionRuntime: noopDispatch<AsterSessionExecutionRuntime | null>(),
      setIsSending: noopDispatch<boolean>(),
    });

    expect(typeof result).toBe("function");
    expect(runtime.listenToTurnEvents).toHaveBeenCalledWith(
      "event-1",
      expect.any(Function),
    );
    expect(requestState.requestStartedAt).toBeGreaterThan(0);
    expect(requestState.requestLogId).toBeTruthy();
    expect(activityLogger.getLogs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: requestState.requestLogId,
          eventType: "chat_request_start",
          status: "pending",
          title: "发送请求",
          sessionId: "session-1",
          workspaceId: "workspace-1",
          source: "aster-chat",
        }),
      ]),
    );

    result();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("首个运行时事件超时未到达时，应把助手消息收口为失败态", async () => {
    vi.useFakeTimers();

    let messages: Message[] = [
      {
        id: "assistant-timeout",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-04-14T10:00:00.000Z"),
        isThinking: true,
      },
    ];
    const setMessages = vi.fn(
      (value: Message[] | ((prev: Message[]) => Message[])) => {
        messages = typeof value === "function" ? value(messages) : value;
      },
    );
    const clearActiveStreamIfMatch = vi.fn(() => true);
    const disposeListener = vi.fn();
    const unlisten = vi.fn();
    const runtime = {
      listenToTurnEvents: vi.fn(async () => unlisten),
    } as unknown as AgentRuntimeAdapter;
    const requestState: StreamRequestState = {
      accumulatedContent: "",
      requestLogId: null,
      requestStartedAt: 0,
      requestFinished: false,
      queuedTurnId: null,
    };

    await registerAgentStreamTurnEventBinding({
      runtime,
      eventName: "event-timeout",
      requestState,
      skipUserMessage: false,
      effectiveProviderType: "anthropic",
      effectiveModel: "glm-5.1",
      effectiveExecutionStrategy: "react",
      content: "帮我分析当前仓库",
      expectingQueue: false,
      activeSessionId: "session-timeout",
      resolvedWorkspaceId: "workspace-timeout",
      assistantMsgId: "assistant-timeout",
      pendingTurnKey: "pending-turn-timeout",
      pendingItemKey: "pending-item-timeout",
      effectiveWaitingRuntimeStatus: {
        phase: "preparing",
        title: "处理中",
        detail: "正在准备执行上下文",
      },
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      callbacks: {
        activateStream: () => {},
        isStreamActivated: () => true,
        clearOptimisticItem: () => {},
        clearOptimisticTurn: () => {},
        disposeListener,
        removeQueuedDraftMessages: () => {},
        clearActiveStreamIfMatch,
        upsertQueuedTurn: (_queuedTurn: QueuedTurnSnapshot) => {},
        removeQueuedTurnState: () => {},
      },
      sounds: {
        playToolcallSound: () => {},
        playTypewriterSound: () => {},
      },
      appendThinkingToParts: (parts) => parts,
      setMessages: setMessages as never,
      setPendingActions: noopDispatch<ActionRequired[]>(),
      setThreadItems: noopDispatch<AgentThreadItem[]>(),
      setThreadTurns: noopDispatch<AgentThreadTurn[]>(),
      setCurrentTurnId: noopDispatch<string | null>(),
      setExecutionRuntime: noopDispatch<AsterSessionExecutionRuntime | null>(),
      setIsSending: noopDispatch<boolean>(),
    });

    await vi.advanceTimersByTimeAsync(12_100);

    expect(messages[0]?.content).toContain("执行失败：执行已中断");
    expect(messages[0]?.runtimeStatus).toMatchObject({
      phase: "failed",
      title: "当前处理失败",
    });
    expect(clearActiveStreamIfMatch).toHaveBeenCalledWith("event-timeout");
    expect(disposeListener).toHaveBeenCalled();
  });

  it("首个运行时事件静默但后台已有 turn 活动时，应降级切换为快照同步", async () => {
    vi.useFakeTimers();

    let messages: Message[] = [
      {
        id: "assistant-recovery",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-04-14T10:00:00.000Z"),
        isThinking: true,
      },
    ];
    const setMessages = vi.fn(
      (value: Message[] | ((prev: Message[]) => Message[])) => {
        messages = typeof value === "function" ? value(messages) : value;
      },
    );
    const attemptSilentTurnRecovery = vi.fn(async () => true);
    const clearActiveStreamIfMatch = vi.fn(() => true);
    const disposeListener = vi.fn();
    const setIsSending = vi.fn();
    const runtime = {
      listenToTurnEvents: vi.fn(async () => vi.fn()),
    } as unknown as AgentRuntimeAdapter;
    const requestState: StreamRequestState = {
      accumulatedContent: "",
      requestLogId: null,
      requestStartedAt: 0,
      requestFinished: false,
      queuedTurnId: null,
    };

    await registerAgentStreamTurnEventBinding({
      runtime,
      eventName: "event-recovery",
      requestState,
      attemptSilentTurnRecovery,
      skipUserMessage: false,
      effectiveProviderType: "anthropic",
      effectiveModel: "astron-code-latest",
      effectiveExecutionStrategy: "react",
      content: "你好",
      expectingQueue: false,
      activeSessionId: "session-recovery",
      resolvedWorkspaceId: "workspace-recovery",
      assistantMsgId: "assistant-recovery",
      pendingTurnKey: "pending-turn-recovery",
      pendingItemKey: "pending-item-recovery",
      effectiveWaitingRuntimeStatus: {
        phase: "preparing",
        title: "处理中",
        detail: "正在准备执行上下文",
      },
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      callbacks: {
        activateStream: () => {},
        isStreamActivated: () => true,
        clearOptimisticItem: () => {},
        clearOptimisticTurn: () => {},
        disposeListener,
        removeQueuedDraftMessages: () => {},
        clearActiveStreamIfMatch,
        upsertQueuedTurn: (_queuedTurn: QueuedTurnSnapshot) => {},
        removeQueuedTurnState: () => {},
      },
      sounds: {
        playToolcallSound: () => {},
        playTypewriterSound: () => {},
      },
      appendThinkingToParts: (parts) => parts,
      setMessages: setMessages as never,
      setPendingActions: noopDispatch<ActionRequired[]>(),
      setThreadItems: noopDispatch<AgentThreadItem[]>(),
      setThreadTurns: noopDispatch<AgentThreadTurn[]>(),
      setCurrentTurnId: noopDispatch<string | null>(),
      setExecutionRuntime: noopDispatch<AsterSessionExecutionRuntime | null>(),
      setIsSending: setIsSending as never,
    });

    await vi.advanceTimersByTimeAsync(12_100);

    expect(attemptSilentTurnRecovery).toHaveBeenCalledWith(
      "session-recovery",
      expect.any(Number),
      "你好",
    );
    expect(messages[0]?.content).toBe("");
    expect(clearActiveStreamIfMatch).toHaveBeenCalledWith("event-recovery");
    expect(disposeListener).toHaveBeenCalled();
    expect(setIsSending).toHaveBeenCalledWith(false);
  });

  it("首包后长时间没有新事件时，应把助手消息收口为失败态", async () => {
    vi.useFakeTimers();

    let messages: Message[] = [
      {
        id: "assistant-inactivity",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-04-14T10:00:00.000Z"),
        isThinking: true,
      },
    ];
    let streamActivated = false;
    let streamHandler: ((event: { payload: unknown }) => void) | null = null;
    const setMessages = vi.fn(
      (value: Message[] | ((prev: Message[]) => Message[])) => {
        messages = typeof value === "function" ? value(messages) : value;
      },
    );
    const clearActiveStreamIfMatch = vi.fn(() => true);
    const disposeListener = vi.fn();
    const runtime = {
      listenToTurnEvents: vi.fn(async (_eventName, handler) => {
        streamHandler = handler;
        return vi.fn();
      }),
    } as unknown as AgentRuntimeAdapter;
    const requestState: StreamRequestState = {
      accumulatedContent: "",
      requestLogId: null,
      requestStartedAt: 0,
      requestFinished: false,
      queuedTurnId: null,
    };

    await registerAgentStreamTurnEventBinding({
      runtime,
      eventName: "event-inactivity",
      requestState,
      skipUserMessage: false,
      effectiveProviderType: "anthropic",
      effectiveModel: "glm-5.1",
      effectiveExecutionStrategy: "react",
      content: "继续分析当前仓库",
      expectingQueue: false,
      activeSessionId: "session-inactivity",
      resolvedWorkspaceId: "workspace-inactivity",
      assistantMsgId: "assistant-inactivity",
      pendingTurnKey: "pending-turn-inactivity",
      pendingItemKey: "pending-item-inactivity",
      effectiveWaitingRuntimeStatus: {
        phase: "preparing",
        title: "处理中",
        detail: "正在准备执行上下文",
      },
      warnedKeysRef: { current: new Set<string>() },
      actionLoggedKeys: new Set<string>(),
      toolLogIdByToolId: new Map<string, string>(),
      toolStartedAtByToolId: new Map<string, number>(),
      toolNameByToolId: new Map<string, string>(),
      callbacks: {
        activateStream: () => {
          streamActivated = true;
        },
        isStreamActivated: () => streamActivated,
        clearOptimisticItem: () => {},
        clearOptimisticTurn: () => {},
        disposeListener,
        removeQueuedDraftMessages: () => {},
        clearActiveStreamIfMatch,
        upsertQueuedTurn: (_queuedTurn: QueuedTurnSnapshot) => {},
        removeQueuedTurnState: () => {},
      },
      sounds: {
        playToolcallSound: () => {},
        playTypewriterSound: () => {},
      },
      appendThinkingToParts: (parts) => parts,
      setMessages: setMessages as never,
      setPendingActions: noopDispatch<ActionRequired[]>(),
      setThreadItems: noopDispatch<AgentThreadItem[]>(),
      setThreadTurns: noopDispatch<AgentThreadTurn[]>(),
      setCurrentTurnId: noopDispatch<string | null>(),
      setExecutionRuntime: noopDispatch<AsterSessionExecutionRuntime | null>(),
      setIsSending: noopDispatch<boolean>(),
    });

    if (!streamHandler) {
      throw new Error("expected stream handler to be registered");
    }

    const activeStreamHandler = streamHandler as (event: {
      payload: unknown;
    }) => void;

    activeStreamHandler({
      payload: {
        type: "runtime_status",
        status: {
          phase: "routing",
          title: "分析中",
          detail: "正在整理仓库结构",
        },
      },
    });

    await vi.advanceTimersByTimeAsync(45_100);

    expect(messages[0]?.content).toContain("执行失败：执行已中断");
    expect(messages[0]?.runtimeStatus).toMatchObject({
      phase: "failed",
      title: "当前处理失败",
    });
    expect(clearActiveStreamIfMatch).toHaveBeenCalledWith("event-inactivity");
    expect(disposeListener).toHaveBeenCalled();
  });
});
