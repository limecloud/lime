import { beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadItem, AgentThreadTurn } from "../types";
import {
  clearAgentSessionCachedSnapshot,
  getAgentSessionCachedSnapshotAvailability,
  loadAgentSessionCachedSnapshot,
  saveAgentSessionCachedMessagesSnapshot,
  saveAgentSessionCachedSnapshot,
} from "./agentSessionScopedStorage";
import {
  createCompletedAssistantMessageWithStaleRunningTool,
  createHeavyAssistantMessage,
  createItem,
  createLegacyCommandSkillAssistantMessage,
  createMessage,
  createServiceSceneSkillAssistantMessage,
  createStandaloneSkillAssistantMessage,
  createStandaloneSkillUserMessage,
  createTurn,
} from "./agentSessionScopedStorage.testFixtures";

describe("agentSessionScopedStorage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("保存会话快照时应只保留最近一段 tail，避免恢复时内存峰值过高", () => {
    const workspaceId = "ws-session-snapshot-trim";
    const sessionId = "topic-heavy";

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: Array.from({ length: 48 }, (_, index) => createMessage(index)),
      threadTurns: Array.from({ length: 36 }, (_, index) => createTurn(index)),
      threadItems: Array.from({ length: 120 }, (_, index) => createItem(index)),
      currentTurnId: "turn-35",
    });

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId);

    expect(restored).not.toBeNull();
    expect(restored?.messages).toHaveLength(32);
    expect(restored?.messages[0]?.id).toBe("message-16");
    expect(restored?.threadTurns).toHaveLength(24);
    expect(restored?.threadTurns[0]?.id).toBe("turn-12");
    expect(restored?.threadItems).toHaveLength(24);
    expect(restored?.threadItems[0]?.id).toBe("item-12");
    expect(restored?.currentTurnId).toBe("turn-35");
  });

  it("保存已完成会话快照时应压缩 assistant 过程字段，避免旧会话首帧恢复过重", () => {
    const workspaceId = "ws-session-snapshot-compact";
    const sessionId = "topic-compact";

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: [createMessage(1), createHeavyAssistantMessage()],
      threadTurns: [createTurn(1)],
      threadItems: [createItem(1)],
      currentTurnId: "turn-1",
    });

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId);
    const restoredAssistant = restored?.messages.find(
      (message) => message.id === "message-heavy-assistant",
    );

    expect(restoredAssistant).toMatchObject({
      role: "assistant",
      content: "最终回复正文",
      thinkingContent: undefined,
      toolCalls: undefined,
    });
    expect(restoredAssistant?.contentParts).toEqual([
      {
        type: "text",
        text: "最终回复正文",
      },
    ]);
  });

  it("恢复未压缩缓存时应收尾已完成 assistant 残留 running 工具", () => {
    const workspaceId = "ws-session-snapshot-stale-running-tool";
    const sessionId = "topic-stale-running-tool";

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: [
        {
          id: "message-news-user",
          role: "user",
          content: "整理今天的国际新闻",
          timestamp: new Date("2026-06-07T10:34:44.000Z"),
        },
        createCompletedAssistantMessageWithStaleRunningTool(),
      ],
      threadTurns: [
        {
          ...createTurn(1),
          id: "turn-news-running-stale",
          status: "running",
          completed_at: undefined,
        },
      ],
      threadItems: [],
      currentTurnId: "turn-news-running-stale",
    });

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId);
    const restoredAssistant = restored?.messages.find(
      (message) => message.id === "message-news-assistant-complete",
    );

    expect(restoredAssistant?.content).toContain("主要国际新闻整理");
    expect(restoredAssistant?.isThinking).toBe(false);
    expect(restoredAssistant?.toolCalls?.[0]).toMatchObject({
      id: "tool-web-search-stale-running",
      status: "completed",
      result: {
        success: true,
        output: "",
      },
    });
    const toolPart = restoredAssistant?.contentParts?.find(
      (part) => part.type === "tool_use",
    );
    expect(toolPart?.type).toBe("tool_use");
    if (toolPart?.type === "tool_use") {
      expect(toolPart.toolCall.status).toBe("completed");
    }
  });

  it("保存已完成直执 Skill 快照时应保留本地思考，因为后端会话详情没有对应 timeline", () => {
    const workspaceId = "ws-session-snapshot-skill-process";
    const sessionId = "topic-skill-process";

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: [createMessage(1), createStandaloneSkillAssistantMessage()],
      threadTurns: [],
      threadItems: [],
      currentTurnId: null,
    });

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId);
    const restoredAssistant = restored?.messages.find(
      (message) => message.id === "message-skill-assistant",
    );

    expect(restoredAssistant).toMatchObject({
      role: "assistant",
      content: "最终 Skill 回复",
      runtimeTurnId: "skill-exec-message-skill-assistant",
      thinkingContent: "正在执行 Skill: personal-ip-knowledge-builder...",
    });
    expect(restoredAssistant?.contentParts).toEqual([
      {
        type: "thinking",
        text: "正在执行 Skill: personal-ip-knowledge-builder...",
      },
      {
        type: "text",
        text: "最终 Skill 回复",
      },
    ]);
  });

  it("旧版 @ 命令 Skill 快照缺少 retention 标记时也应保留本地思考", () => {
    const workspaceId = "ws-session-snapshot-legacy-command-skill";
    const sessionId = "topic-legacy-command-skill";

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: [
        {
          id: "message-legacy-command-user",
          role: "user",
          content: "@analysis 帮我分析一下今天的国际形势",
          timestamp: new Date("2026-04-24T00:00:03.000Z"),
        },
        createLegacyCommandSkillAssistantMessage(),
      ],
      threadTurns: [],
      threadItems: [],
      currentTurnId: null,
    });

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId);
    const restoredAssistant = restored?.messages.find(
      (message) => message.id === "message-legacy-command-skill-assistant",
    );

    expect(restoredAssistant).toMatchObject({
      role: "assistant",
      content: "历史 Skill 回复",
      inlineProcessRetention: "skill",
      thinkingContent: "先读取 Skill，再生成回复。",
    });
    expect(restoredAssistant?.contentParts).toEqual([
      {
        type: "thinking",
        text: "先读取 Skill，再生成回复。",
      },
      {
        type: "text",
        text: "历史 Skill 回复",
      },
    ]);
  });

  it("远端纯正文刷新缓存时不应覆盖直执 Skill 本地思考", () => {
    const workspaceId = "ws-session-snapshot-skill-remote-refresh";
    const sessionId = "topic-skill-remote-refresh";

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: [
        createStandaloneSkillUserMessage(),
        createStandaloneSkillAssistantMessage(),
      ],
      threadTurns: [],
      threadItems: [],
      currentTurnId: null,
    });

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: [
        {
          id: "remote-skill-user",
          role: "user",
          content: "请整理产品知识库",
          timestamp: new Date("2026-04-24T00:00:04.000Z"),
        },
        {
          id: "remote-skill-assistant",
          role: "assistant",
          content: "远端会话详情里的纯正文结果",
          contentParts: [
            {
              type: "text",
              text: "远端会话详情里的纯正文结果",
            },
          ],
          timestamp: new Date("2026-04-24T00:00:05.000Z"),
        },
      ],
      threadTurns: [],
      threadItems: [],
      currentTurnId: null,
    });

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId);
    const restoredAssistant = restored?.messages.find(
      (message) => message.role === "assistant",
    );

    expect(restoredAssistant).toMatchObject({
      id: "message-skill-assistant",
      content: "最终 Skill 回复",
      runtimeTurnId: "skill-exec-message-skill-assistant",
      thinkingContent: "正在执行 Skill: personal-ip-knowledge-builder...",
    });
    expect(restoredAssistant?.contentParts).toEqual([
      {
        type: "thinking",
        text: "正在执行 Skill: personal-ip-knowledge-builder...",
      },
      {
        type: "text",
        text: "最终 Skill 回复",
      },
    ]);
  });

  it("远端纯正文刷新缓存时不应覆盖服务型 Skill 本地思考", () => {
    const workspaceId = "ws-session-snapshot-service-skill-remote-refresh";
    const sessionId = "topic-service-skill-remote-refresh";

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: [
        createStandaloneSkillUserMessage(),
        createServiceSceneSkillAssistantMessage(),
      ],
      threadTurns: [],
      threadItems: [],
      currentTurnId: null,
    });

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: [
        {
          id: "remote-service-skill-user",
          role: "user",
          content: "请整理产品知识库",
          timestamp: new Date("2026-04-24T00:00:07.000Z"),
        },
        {
          id: "remote-service-skill-assistant",
          role: "assistant",
          content: "远端服务型 Skill 纯正文结果",
          contentParts: [
            {
              type: "text",
              text: "远端服务型 Skill 纯正文结果",
            },
          ],
          timestamp: new Date("2026-04-24T00:00:08.000Z"),
        },
      ],
      threadTurns: [],
      threadItems: [],
      currentTurnId: null,
    });

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId);
    const restoredAssistant = restored?.messages.find(
      (message) => message.role === "assistant",
    );

    expect(restoredAssistant).toMatchObject({
      id: "message-service-scene-skill-assistant",
      content: "服务型 Skill 最终回复",
      runtimeTurnId: "turn-service-scene-skill",
      inlineProcessRetention: "skill",
      thinkingContent: "先读取服务 Skill，再整理产品边界。",
    });
    expect(restoredAssistant?.contentParts).toEqual([
      {
        type: "thinking",
        text: "先读取服务 Skill，再整理产品边界。",
      },
      {
        type: "text",
        text: "服务型 Skill 最终回复",
      },
    ]);
  });

  it("只保存消息快照时应保留已有时间线状态", () => {
    const workspaceId = "ws-session-snapshot-message-only";
    const sessionId = "topic-message-only";

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: [createStandaloneSkillUserMessage()],
      threadTurns: [createTurn(1)],
      threadItems: [createItem(1)],
      currentTurnId: "turn-1",
    });

    saveAgentSessionCachedMessagesSnapshot(workspaceId, sessionId, [
      createStandaloneSkillUserMessage(),
      createServiceSceneSkillAssistantMessage(),
    ]);

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId);
    expect(restored?.messages[1]).toMatchObject({
      content: "服务型 Skill 最终回复",
      thinkingContent: "先读取服务 Skill，再整理产品边界。",
      inlineProcessRetention: "skill",
    });
    expect(restored?.threadTurns).toHaveLength(1);
    expect(restored?.threadTurns[0]?.id).toBe("turn-1");
    expect(restored?.threadItems).toHaveLength(1);
    expect(restored?.threadItems[0]?.id).toBe("item-1");
    expect(restored?.currentTurnId).toBe("turn-1");
  });

  it("保存运行中会话快照时应保留过程字段，避免切回执行中会话丢状态", () => {
    const workspaceId = "ws-session-snapshot-running";
    const sessionId = "topic-running";
    const runningTurn: AgentThreadTurn = {
      ...createTurn(1),
      status: "running",
      completed_at: undefined,
    };
    const runningItem: AgentThreadItem = {
      ...createItem(1),
      status: "in_progress",
    } as AgentThreadItem;

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: [createHeavyAssistantMessage()],
      threadTurns: [runningTurn],
      threadItems: [runningItem],
      currentTurnId: "turn-1",
    });

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId);
    const restoredAssistant = restored?.messages.find(
      (message) => message.id === "message-heavy-assistant",
    );

    expect(restoredAssistant?.thinkingContent).toBe("大量思考过程");
    expect(restoredAssistant?.toolCalls?.[0]).toMatchObject({
      id: "tool-heavy",
      status: "completed",
    });
    expect(
      restoredAssistant?.contentParts?.some((part) => part.type === "tool_use"),
    ).toBe(true);
  });

  it("同标签页快照丢失后应回退到持久化 tail，避免重开应用时仍然整段慢恢复", () => {
    const workspaceId = "ws-session-snapshot-persisted";
    const sessionId = "topic-persisted";

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: Array.from({ length: 24 }, (_, index) => createMessage(index)),
      threadTurns: Array.from({ length: 16 }, (_, index) => createTurn(index)),
      threadItems: Array.from({ length: 48 }, (_, index) => createItem(index)),
      currentTurnId: "turn-15",
    });

    sessionStorage.clear();

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId);

    expect(restored).not.toBeNull();
    expect(restored?.messages).toHaveLength(12);
    expect(restored?.messages[0]?.id).toBe("message-12");
    expect(restored?.threadTurns).toHaveLength(8);
    expect(restored?.threadTurns[0]?.id).toBe("turn-8");
    expect(restored?.threadItems).toHaveLength(8);
    expect(restored?.threadItems[0]?.id).toBe("item-8");
    expect(restored?.currentTurnId).toBe("turn-15");
  });

  it("保存快照时应同步维护轻量索引，供会话点击路径跳过无缓存重解析", () => {
    const workspaceId = "ws-session-snapshot-index";
    const sessionId = "topic-indexed";
    const nowMs = Date.parse("2026-04-24T00:00:00.000Z");

    expect(
      getAgentSessionCachedSnapshotAvailability(workspaceId, sessionId),
    ).toEqual({
      hasSnapshot: true,
      hasIndex: false,
    });

    saveAgentSessionCachedSnapshot(
      workspaceId,
      sessionId,
      {
        messages: [createMessage(1)],
        threadTurns: [],
        threadItems: [],
        currentTurnId: null,
      },
      {
        nowMs,
        sessionUpdatedAt: nowMs,
        messagesCount: 1,
      },
    );

    expect(
      getAgentSessionCachedSnapshotAvailability(workspaceId, sessionId),
    ).toMatchObject({
      hasSnapshot: true,
      hasIndex: true,
      transient: {
        updatedAt: nowMs,
        sessionUpdatedAt: nowMs,
        messagesCount: 1,
        historyTruncated: false,
      },
      persisted: {
        updatedAt: nowMs,
        sessionUpdatedAt: nowMs,
        messagesCount: 1,
        historyTruncated: false,
      },
    });
    expect(
      getAgentSessionCachedSnapshotAvailability(workspaceId, "topic-missing"),
    ).toEqual({
      hasSnapshot: false,
      hasIndex: true,
    });
  });

  it("清理快照时应同步移除索引项，避免后续点击误解析空缓存", () => {
    const workspaceId = "ws-session-snapshot-index-clear";
    const sessionId = "topic-index-clear";

    saveAgentSessionCachedSnapshot(workspaceId, sessionId, {
      messages: [createMessage(1)],
      threadTurns: [],
      threadItems: [],
      currentTurnId: null,
    });

    clearAgentSessionCachedSnapshot(workspaceId, sessionId);

    expect(
      getAgentSessionCachedSnapshotAvailability(workspaceId, sessionId),
    ).toEqual({
      hasSnapshot: false,
      hasIndex: true,
    });
  });

  it("持久化 tail 超过热缓存窗口后仍应作为 stale 回放，避免隔天恢复只能等待后端详情", () => {
    const workspaceId = "ws-session-snapshot-persisted-stale";
    const sessionId = "topic-persisted-stale";
    const nowMs = Date.parse("2026-04-24T00:00:00.000Z");

    saveAgentSessionCachedSnapshot(
      workspaceId,
      sessionId,
      {
        messages: [createMessage(1)],
        threadTurns: [],
        threadItems: [],
        currentTurnId: null,
      },
      { nowMs, sessionUpdatedAt: nowMs, messagesCount: 12 },
    );

    sessionStorage.clear();

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId, {
      nowMs: nowMs + 2 * 24 * 60 * 60 * 1000,
      topicUpdatedAt: nowMs,
      messagesCount: 12,
    });

    expect(restored).not.toBeNull();
    expect(restored?.cacheMetadata?.storageKind).toBe("persisted");
    expect(restored?.cacheMetadata?.freshness).toBe("stale");
    expect(restored?.messages[0]?.id).toBe("message-1");
  });

  it("读取旧版秒级 sessionUpdatedAt 时应归一到毫秒，避免新写缓存被误判过期", () => {
    const workspaceId = "ws-session-snapshot-legacy-seconds";
    const sessionId = "topic-legacy-seconds";
    const nowMs = Date.parse("2026-04-24T00:00:00.000Z");
    const sessionUpdatedAtMs = Date.parse("2026-04-24T00:01:00.000Z");
    const cacheKey = `agent_session_snapshots_${workspaceId}`;

    sessionStorage.setItem(
      cacheKey,
      JSON.stringify({
        [sessionId]: {
          messages: [createMessage(1)],
          threadTurns: [],
          threadItems: [],
          currentTurnId: null,
          updatedAt: nowMs,
          lastAccessedAt: nowMs,
          expiresAt: nowMs + 10 * 60 * 1000,
          staleUntil: nowMs + 12 * 60 * 1000,
          sessionUpdatedAt: Math.floor(sessionUpdatedAtMs / 1000),
          messagesCount: 1,
          historyTruncated: false,
        },
      }),
    );

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId, {
      nowMs: nowMs + 1_000,
      topicUpdatedAt: sessionUpdatedAtMs,
      messagesCount: 1,
    });

    expect(restored).not.toBeNull();
    expect(restored?.cacheMetadata?.sessionUpdatedAt).toBe(sessionUpdatedAtMs);
    expect(restored?.cacheMetadata?.freshness).toBe("fresh");
  });

  it("快照超过热缓存 TTL 但仍在 grace 内时应作为 stale 返回并要求后台刷新", () => {
    const workspaceId = "ws-session-snapshot-stale";
    const sessionId = "topic-stale";
    const nowMs = Date.parse("2026-04-24T00:00:00.000Z");

    saveAgentSessionCachedSnapshot(
      workspaceId,
      sessionId,
      {
        messages: Array.from({ length: 16 }, (_, index) =>
          createMessage(index),
        ),
        threadTurns: [],
        threadItems: [],
        currentTurnId: null,
      },
      {
        nowMs,
        sessionUpdatedAt: nowMs,
        messagesCount: 40,
        historyTruncated: true,
      },
    );

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId, {
      nowMs: nowMs + 10 * 60 * 1000 + 1,
    });

    expect(restored).not.toBeNull();
    expect(restored?.cacheMetadata?.freshness).toBe("stale");
    expect(restored?.cacheMetadata?.messagesCount).toBe(40);
    expect(restored?.cacheMetadata?.historyTruncated).toBe(true);
  });

  it("读取命中快照时不应同步刷新 lastAccessedAt，避免点击会话时重写整张快照 map", () => {
    const workspaceId = "ws-session-snapshot-read-only";
    const sessionId = "topic-read-only";
    const nowMs = Date.parse("2026-04-24T00:00:00.000Z");

    saveAgentSessionCachedSnapshot(
      workspaceId,
      sessionId,
      {
        messages: [createMessage(1)],
        threadTurns: [],
        threadItems: [],
        currentTurnId: null,
      },
      { nowMs, sessionUpdatedAt: nowMs },
    );

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId, {
      nowMs: nowMs + 10_000,
    });
    const snapshotMap = JSON.parse(
      sessionStorage.getItem(`agent_session_snapshots_${workspaceId}`) || "{}",
    ) as Record<string, { lastAccessedAt?: number }>;

    expect(restored).not.toBeNull();
    expect(snapshotMap[sessionId]?.lastAccessedAt).toBe(nowMs);
  });

  it("快照超过 TTL 和 grace 后应被懒清理", () => {
    const workspaceId = "ws-session-snapshot-expired";
    const sessionId = "topic-expired";
    const nowMs = Date.parse("2026-04-24T00:00:00.000Z");

    saveAgentSessionCachedSnapshot(
      workspaceId,
      sessionId,
      {
        messages: [createMessage(1)],
        threadTurns: [],
        threadItems: [],
        currentTurnId: null,
      },
      { nowMs, sessionUpdatedAt: nowMs },
    );
    localStorage.clear();

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId, {
      nowMs: nowMs + 32 * 60 * 1000 + 1,
    });
    const snapshotMap = JSON.parse(
      sessionStorage.getItem(`agent_session_snapshots_${workspaceId}`) || "{}",
    ) as Record<string, unknown>;

    expect(restored).toBeNull();
    expect(snapshotMap[sessionId]).toBeUndefined();
  });

  it("话题摘要比缓存更新时应把快照标记为 stale，但仍允许先回放 tail", () => {
    const workspaceId = "ws-session-snapshot-topic-stale";
    const sessionId = "topic-topic-stale";
    const nowMs = Date.parse("2026-04-24T00:00:00.000Z");

    saveAgentSessionCachedSnapshot(
      workspaceId,
      sessionId,
      {
        messages: [createMessage(1)],
        threadTurns: [],
        threadItems: [],
        currentTurnId: null,
      },
      {
        nowMs,
        sessionUpdatedAt: nowMs,
        messagesCount: 1,
      },
    );

    const restored = loadAgentSessionCachedSnapshot(workspaceId, sessionId, {
      nowMs: nowMs + 1_000,
      topicUpdatedAt: nowMs + 2_000,
      messagesCount: 2,
    });

    expect(restored).not.toBeNull();
    expect(restored?.cacheMetadata?.freshness).toBe("stale");
  });

  it("保存快照时应按 LRU 裁剪同标签页和持久缓存", () => {
    const workspaceId = "ws-session-snapshot-lru";
    const nowMs = Date.parse("2026-04-24T00:00:00.000Z");

    for (let index = 0; index < 13; index += 1) {
      saveAgentSessionCachedSnapshot(
        workspaceId,
        `topic-${index}`,
        {
          messages: [createMessage(index)],
          threadTurns: [],
          threadItems: [],
          currentTurnId: null,
        },
        {
          nowMs: nowMs + index,
          sessionUpdatedAt: nowMs + index,
        },
      );
    }

    const transientMap = JSON.parse(
      sessionStorage.getItem(`agent_session_snapshots_${workspaceId}`) || "{}",
    ) as Record<string, unknown>;
    const persistedMap = JSON.parse(
      localStorage.getItem(
        `agent_session_snapshots_persisted_${workspaceId}`,
      ) || "{}",
    ) as Record<string, unknown>;

    expect(Object.keys(transientMap)).toHaveLength(12);
    expect(transientMap["topic-0"]).toBeUndefined();
    expect(Object.keys(persistedMap)).toHaveLength(8);
    expect(persistedMap["topic-4"]).toBeUndefined();
    expect(persistedMap["topic-12"]).toBeDefined();
  });
});
