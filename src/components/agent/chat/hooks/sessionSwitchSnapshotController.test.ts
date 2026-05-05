import { describe, expect, it } from "vitest";
import {
  buildPendingSessionShellMetricContext,
  buildSessionSwitchDeferHydrationMetricContext,
  buildSessionSwitchLocalSnapshotOverride,
  buildSessionSwitchStartMetricContext,
  shouldApplyCachedTopicSnapshot,
  shouldApplyPendingSessionShell,
  shouldLoadCachedTopicSnapshot,
  shouldRefreshCachedSnapshotImmediately,
} from "./sessionSwitchSnapshotController";
import type { AgentSessionCachedSnapshot } from "./agentSessionScopedStorage";
import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";

function message(id: string): Message {
  return {
    id,
    role: "assistant",
    content: id,
    timestamp: new Date("2026-05-05T00:00:00.000Z"),
  };
}

function snapshot(
  messages: Message[] = [message("message-a")],
): AgentSessionCachedSnapshot {
  return {
    messages,
    threadTurns: [{ id: "turn-a" }] as AgentThreadTurn[],
    threadItems: [{ id: "item-a", turn_id: "turn-a" }] as AgentThreadItem[],
    currentTurnId: null,
    cacheMetadata: {
      storageKind: "transient",
      freshness: "fresh",
      updatedAt: 1,
      lastAccessedAt: 1,
      expiresAt: 2,
      staleUntil: 3,
      sessionUpdatedAt: 1,
      messagesCount: messages.length,
      historyTruncated: false,
    },
  };
}

describe("sessionSwitchSnapshotController", () => {
  it("当前会话不应重复加载或应用 cached snapshot", () => {
    expect(
      shouldLoadCachedTopicSnapshot({
        currentSessionId: "topic-a",
        topicId: "topic-a",
      }),
    ).toBe(false);
    expect(
      shouldApplyCachedTopicSnapshot({
        currentSessionId: "topic-a",
        topicId: "topic-a",
      }),
    ).toBe(false);
  });

  it("stale / running / waiting 话题应立即刷新 cached snapshot", () => {
    expect(
      shouldRefreshCachedSnapshotImmediately({
        cacheFreshness: "stale",
        topicStatus: "idle",
      }),
    ).toBe(true);
    expect(
      shouldRefreshCachedSnapshotImmediately({
        cacheFreshness: "fresh",
        topicStatus: "running",
      }),
    ).toBe(true);
    expect(
      shouldRefreshCachedSnapshotImmediately({
        cacheFreshness: "fresh",
        topicStatus: "completed",
      }),
    ).toBe(false);
  });

  it("无 cached snapshot 且切换到其他会话时应先应用 pending shell", () => {
    expect(
      shouldApplyPendingSessionShell({
        currentSessionId: "topic-a",
        topicId: "topic-b",
        cachedSnapshot: null,
      }),
    ).toBe(true);
    expect(
      shouldApplyPendingSessionShell({
        currentSessionId: "topic-a",
        topicId: "topic-b",
        cachedSnapshot: snapshot(),
      }),
    ).toBe(false);
  });

  it("应构造 switch start / defer / pending shell 指标上下文", () => {
    const cachedSnapshot = snapshot([message("message-a"), message("message-b")]);

    expect(
      buildSessionSwitchStartMetricContext({
        cachedSnapshot,
        currentSessionId: "topic-a",
        messagesCount: 7,
        refreshCachedSnapshotImmediately: true,
        topicId: "topic-b",
        workspaceId: "workspace-a",
      }),
    ).toMatchObject({
      cacheFreshness: "fresh",
      cacheStorageKind: "transient",
      cachedLocalMessagesCount: 2,
      currentSessionId: "topic-a",
      messagesCount: 7,
      refreshCachedSnapshotImmediately: true,
      sessionId: "topic-b",
      workspaceId: "workspace-a",
    });
    expect(
      buildSessionSwitchDeferHydrationMetricContext({
        cachedSnapshot,
        currentSessionId: "topic-a",
        refreshImmediately: false,
        topicId: "topic-b",
      }),
    ).toMatchObject({
      cachedLocalMessagesCount: 2,
      refreshImmediately: false,
      sessionId: "topic-b",
    });
    expect(
      buildPendingSessionShellMetricContext({
        currentSessionId: "topic-a",
        topicId: "topic-b",
      }),
    ).toEqual({
      currentSessionId: "topic-a",
      sessionId: "topic-b",
      topicId: "topic-b",
      workspaceId: undefined,
    });
  });

  it("仅当前 UI 仍持有同一 cached snapshot 引用时才返回 localSnapshotOverride", () => {
    const cachedSnapshot = snapshot();

    expect(
      buildSessionSwitchLocalSnapshotOverride({
        cachedSnapshot,
        currentSessionId: "topic-a",
        messages: cachedSnapshot.messages,
        threadTurns: cachedSnapshot.threadTurns,
        threadItems: cachedSnapshot.threadItems,
        topicId: "topic-a",
      }),
    ).toEqual({
      sessionId: "topic-a",
      messages: cachedSnapshot.messages,
      threadTurns: cachedSnapshot.threadTurns,
      threadItems: cachedSnapshot.threadItems,
    });
    expect(
      buildSessionSwitchLocalSnapshotOverride({
        cachedSnapshot,
        currentSessionId: "topic-a",
        messages: cachedSnapshot.messages.slice(),
        threadTurns: cachedSnapshot.threadTurns,
        threadItems: cachedSnapshot.threadItems,
        topicId: "topic-a",
      }),
    ).toBeNull();
  });
});
