import i18n from "i18next";
import type { Dispatch, SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseAgentEvent,
  type AgentThreadItem,
  type AgentThreadTurn,
} from "@/lib/api/agentProtocol";
import {
  projectAppServerV2NotificationPayload,
  resetAppServerV2NotificationProjectionState,
} from "@/lib/api/agentRuntime/appServerV2Notification";
import type { Message } from "../types";
import { clearAgentUiProjectionEvents } from "../projection/conversationProjectionStore";
import { handleTurnStreamEvent } from "./agentStreamRuntimeHandler";
import type {
  HandleTurnStreamEventOptions,
  StreamRequestState,
} from "./agentStreamRuntimeHandlerTypes";
import { clearAllAgentStreamTextOverlays } from "./agentStreamTextOverlayStore";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

const threadId = "history-completion-thread";
const turnId = "history-completion-turn";
const finalText = "HISTORY_ACCESS_DONE_allowed";
const agent = (id: string, text: string, phase?: string | null) => ({
  id,
  type: "agentMessage",
  text,
  ...(phase === undefined ? {} : { phase }),
});
const tool = {
  id: "history-call",
  type: "dynamicToolCall",
  namespace: "browser",
  tool: "history",
  arguments: { query: "controlled page", limit: 5 },
  status: "completed",
  success: true,
  contentItems: [{ type: "inputText", text: "history result" }],
};

function harness() {
  let messages: Message[] = [
    {
      id: "assistant-completion",
      role: "assistant",
      content: "",
      timestamp: new Date(0),
      isThinking: true,
      contentParts: [],
    },
  ];
  let items: AgentThreadItem[] = [];
  let turns: AgentThreadTurn[] = [];
  const update =
    <T>(get: () => T, set: (value: T) => void): Dispatch<SetStateAction<T>> =>
    (value) =>
      set(
        typeof value === "function"
          ? (value as (previous: T) => T)(get())
          : value,
      );
  const requestState: StreamRequestState = {
    accumulatedContent: "",
    currentTurnId: turnId,
    requestLogId: null,
    requestStartedAt: 0,
    requestFinished: false,
  };
  const options: Omit<HandleTurnStreamEventOptions, "data"> = {
    requestState,
    callbacks: {
      activateStream: vi.fn(),
      isStreamActivated: () => true,
      clearOptimisticItem: vi.fn(),
      clearOptimisticTurn: vi.fn(),
      disposeListener: vi.fn(),
      clearActiveStreamIfMatch: () => true,
      appendThinkingToParts: (parts) => parts,
    },
    eventName: "canonical-completion",
    pendingTurnKey: "pending-turn",
    pendingItemKey: "pending-item",
    assistantMsgId: "assistant-completion",
    activeSessionId: threadId,
    resolvedWorkspaceId: "workspace",
    effectiveExecutionStrategy: "react",
    content: "Read browser history",
    runtime: {} as HandleTurnStreamEventOptions["runtime"],
    warnedKeysRef: { current: new Set() },
    actionLoggedKeys: new Set(),
    toolLogIdByToolId: new Map(),
    toolStartedAtByToolId: new Map(),
    toolNameByToolId: new Map(),
    setMessages: update(
      () => messages,
      (value) => {
        messages = value;
      },
    ),
    getThreadItems: () => items,
    setThreadItems: update(
      () => items,
      (value) => {
        items = value;
      },
    ),
    setThreadTurns: update(
      () => turns,
      (value) => {
        turns = value;
      },
    ),
    setPendingActions: vi.fn(),
    setCurrentTurnId: vi.fn(),
    setExecutionRuntime: vi.fn(),
    setIsSending: vi.fn(),
  };
  const send = (method: string, params: Record<string, unknown>) => {
    const payload = projectAppServerV2NotificationPayload({
      method,
      params: { threadId, turnId, ...params },
    });
    const data = parseAgentEvent(payload);
    expect(data, `Invalid ${method} projection`).not.toBeNull();
    handleTurnStreamEvent({ ...options, data: data! });
    return payload;
  };
  const completed = (turnItems: Record<string, unknown>[] = [], id = turnId) =>
    send("turn/completed", {
      turn: {
        id,
        status: "completed",
        items: turnItems,
        startedAt: 1,
        completedAt: 2,
      },
    });
  return {
    requestState,
    send,
    completed,
    message: () => messages[0],
    snapshot: (item: Record<string, unknown>) =>
      send("item/completed", { item, completedAtMs: 2000 }),
    start: (item: Record<string, unknown>) =>
      send("item/started", { item, startedAtMs: 1000 }),
    delta: (id: string, delta: string) =>
      send("item/agentMessage/delta", { itemId: id, delta }),
  };
}

describe("canonical browser-tool reply completion", () => {
  beforeEach(async () => {
    resetAppServerV2NotificationProjectionState();
    document.documentElement.lang = "zh-CN";
    if (i18n.isInitialized) await i18n.changeLanguage("zh-CN");
  });
  afterEach(() => {
    vi.clearAllMocks();
    document.documentElement.lang = "";
    clearAgentUiProjectionEvents();
    clearAllAgentStreamTextOverlays();
  });

  it.each([undefined, null, "final_answer", "final"])(
    "accepts a completed reply after history with phase %s",
    (phase) => {
      const h = harness();
      h.snapshot(tool);
      h.start(agent("reply", "", phase));
      h.delta("reply", finalText);
      h.snapshot(agent("reply", finalText, phase));
      h.completed([tool, agent("reply", finalText, phase)]);
      expect(h.message().content).toBe(finalText);
      expect(toastError).not.toHaveBeenCalled();
      expect(h.message().isThinking).toBe(false);
    },
  );

  it("accepts an unphased item snapshot without delta or terminal item replay", () => {
    const h = harness();
    h.snapshot(tool);
    h.snapshot(agent("reply", finalText));
    h.completed();
    expect(h.message().content).toBe(finalText);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("accepts the final reply in a completed-turn snapshot when item notifications were missed", () => {
    const h = harness();
    h.snapshot(tool);
    h.completed([tool, agent("reply", finalText)]);
    expect(h.message().content).toBe(finalText);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("routes an ordered unphased delta after the tool without waiting for snapshots", () => {
    const h = harness();
    h.snapshot(tool);
    h.start(agent("reply", ""));
    const payload = h.delta("reply", finalText);
    expect(payload).toMatchObject({
      sequence: 1,
      sequence_provenance: "notification_order",
    });
    expect(h.requestState.accumulatedContent).toBe(finalText);
    h.completed();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("keeps commentary out of final completion after a tool", () => {
    const h = harness();
    h.snapshot(tool);
    h.start(agent("comment", "", "commentary"));
    expect(h.delta("comment", "Still working")).toMatchObject({
      phase: "commentary",
    });
    h.snapshot(agent("comment", "Still working", "commentary"));
    h.completed([tool, agent("comment", "Still working", "commentary")]);
    expect(toastError).toHaveBeenCalledWith("模型未输出最终答复，请重试");
  });

  it.each([undefined, "final_answer"])(
    "rejects a reply before the latest tool boundary, phase %s",
    (phase) => {
      const h = harness();
      const opening = agent("opening", "I will read history", phase);
      h.snapshot(opening);
      h.snapshot(tool);
      h.completed([opening, tool]);
      expect(toastError).toHaveBeenCalledWith("模型未输出最终答复，请重试");
    },
  );

  it.each([
    [],
    [tool, agent("empty", "", "final_answer")],
    [tool, agent("empty", "  ")],
  ])("rejects genuine empty completion %#", (items) => {
    const h = harness();
    h.snapshot(tool);
    h.completed(items);
    expect(toastError).toHaveBeenCalledWith("模型未输出最终答复，请重试");
  });

  it("ignores the previous turn terminal instead of borrowing its reply", () => {
    const h = harness();
    h.snapshot(tool);
    h.completed([agent("foreign", "Old reply", "final_answer")], "older-turn");
    expect(h.requestState.requestFinished).toBe(false);
    expect(h.message().content).toBe("");
    h.completed([tool]);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("does not replace a final reply with a late snapshot from the opening item", () => {
    const h = harness();
    const opening = agent("opening", "I will read history");
    h.snapshot(opening);
    h.snapshot(tool);
    h.snapshot(agent("reply", finalText));
    h.snapshot(opening);
    h.completed();
    expect(h.message().content).toBe(finalText);
    expect(toastError).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "rejects late commentary after a missing start, process boundary %s",
    (hasTool) => {
      const h = harness();
      if (hasTool) h.snapshot(tool);
      h.delta("late-comment", "Still reading history");
      h.snapshot(agent("late-comment", "Still reading history", "commentary"));
      h.completed([
        ...(hasTool ? [tool] : []),
        agent("late-comment", "Still reading history", "commentary"),
      ]);
      expect(toastError).toHaveBeenCalledWith("模型未输出最终答复，请重试");
    },
  );

  it.each([undefined, "final_answer"])(
    "retains an earlier reply with phase %s after late commentary",
    (phase) => {
      const h = harness();
      h.snapshot(tool);
      h.snapshot(agent("reply", finalText, phase));
      h.delta("late-comment", "Extra commentary");
      h.snapshot(agent("late-comment", "Extra commentary", "commentary"));
      h.completed();
      expect(h.message().content).toBe(finalText);
      expect(toastError).not.toHaveBeenCalled();
    },
  );

  it("does not revive an opening reply or late commentary when a tool completion is replayed", () => {
    const h = harness();
    h.snapshot(agent("opening", "I will read history"));
    h.snapshot(tool);
    h.delta("late-comment", "Still reading history");
    h.snapshot(agent("late-comment", "Still reading history", "commentary"));
    h.snapshot(tool);
    h.completed();
    expect(toastError).toHaveBeenCalledWith("模型未输出最终答复，请重试");
  });

  it("does not share message phases across threads, turns or a completed lifecycle", () => {
    const project = (method: string, params: Record<string, unknown>) =>
      projectAppServerV2NotificationPayload({
        method,
        params: { threadId, turnId, ...params },
      });
    project("item/started", {
      item: agent("shared", "", "commentary"),
      startedAtMs: 1000,
    });
    const delta = { itemId: "shared", delta: finalText };
    expect(project("item/agentMessage/delta", delta)).toMatchObject({
      phase: "commentary",
    });
    expect(
      project("item/agentMessage/delta", {
        ...delta,
        threadId: "other-thread",
      }),
    ).not.toHaveProperty("phase");
    expect(
      project("item/agentMessage/delta", { ...delta, turnId: "other-turn" }),
    ).not.toHaveProperty("phase");
    project("turn/completed", {
      turn: { id: turnId, status: "completed", items: [] },
    });
    expect(project("item/agentMessage/delta", delta)).not.toHaveProperty(
      "phase",
    );
  });
});
