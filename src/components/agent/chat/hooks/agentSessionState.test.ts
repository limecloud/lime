import { describe, expect, it } from "vitest";
import type { AsterSessionExecutionRuntime } from "@/lib/api/agentExecutionRuntime";
import type { AsterSessionDetail } from "@/lib/api/agentRuntime";
import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import {
  buildHydratedAgentSessionSnapshot,
  createEmptyAgentSessionSnapshot,
  hasSessionHydrationActivity,
  resolveRestorableTopicSessionId,
} from "./agentSessionState";

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id ?? "message-1",
    role: overrides.role ?? "assistant",
    content: overrides.content ?? "默认内容",
    timestamp: overrides.timestamp ?? new Date("2026-03-29T00:00:00.000Z"),
    ...overrides,
  };
}

function createTurn(overrides: Partial<AgentThreadTurn> = {}): AgentThreadTurn {
  return {
    id: overrides.id ?? "turn-1",
    thread_id: overrides.thread_id ?? "thread-1",
    status: overrides.status ?? "completed",
    prompt_text: overrides.prompt_text ?? "默认 turn",
    started_at: overrides.started_at ?? "2026-03-29T00:00:00.000Z",
    completed_at: overrides.completed_at ?? "2026-03-29T00:00:02.000Z",
    created_at: overrides.created_at ?? "2026-03-29T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-03-29T00:00:02.000Z",
    ...overrides,
  };
}

function createItem(overrides: Partial<AgentThreadItem> = {}): AgentThreadItem {
  return {
    id: overrides.id ?? "item-1",
    thread_id: overrides.thread_id ?? "thread-1",
    turn_id: overrides.turn_id ?? "turn-1",
    sequence: overrides.sequence ?? 1,
    type: overrides.type ?? "agent_message",
    text:
      "text" in overrides && typeof overrides.text === "string"
        ? overrides.text
        : "默认 item",
    status: overrides.status ?? "completed",
    started_at: overrides.started_at ?? "2026-03-29T00:00:00.000Z",
    completed_at: overrides.completed_at ?? "2026-03-29T00:00:02.000Z",
    updated_at: overrides.updated_at ?? "2026-03-29T00:00:02.000Z",
    ...overrides,
  } as AgentThreadItem;
}

describe("agentSessionState", () => {
  it("应创建可复用的空会话快照", () => {
    const runtime = {
      session_id: "session-1",
      provider_name: "openai",
      model_name: "gpt-5.4-mini",
      source: "session",
    } satisfies AsterSessionExecutionRuntime;

    const snapshot = createEmptyAgentSessionSnapshot({
      executionRuntime: runtime,
    });

    expect(snapshot.sessionId).toBeNull();
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.threadTurns).toEqual([]);
    expect(snapshot.executionRuntime).toBe(runtime);
  });

  it("应在 restore 目标失效时回退到最新有效话题", () => {
    const resolved = resolveRestorableTopicSessionId("session-stale", [
      {
        id: "session-active",
        title: "活跃会话",
        createdAt: new Date("2026-03-28T00:00:00.000Z"),
        updatedAt: new Date("2026-03-29T00:00:00.000Z"),
        workspaceId: "ws-1",
        messagesCount: 1,
        executionStrategy: "react",
        status: "done",
        lastPreview: "已完成",
        isPinned: false,
        hasUnread: false,
        tag: null,
        sourceSessionId: "session-active",
      },
    ]);

    expect(resolved).toBe("session-active");
  });

  it("同会话 hydrate 且后端缺失 execution_runtime 时应保留本地运行态", () => {
    const currentMessages = [
      createMessage({
        id: "local-user",
        role: "user",
        content: "继续保持这条本地消息",
      }),
    ];
    const currentTurns = [createTurn({ id: "turn-local" })];
    const currentItems = [createItem({ id: "item-local" })];
    const currentExecutionRuntime = {
      session_id: "topic-1",
      provider_name: "openai",
      model_name: "gpt-5.4-mini",
      source: "session",
    } satisfies AsterSessionExecutionRuntime;
    const detail = {
      id: "topic-1",
      created_at: 1700000000,
      updated_at: 1700000001,
      messages: [],
      turns: [createTurn({ id: "turn-remote" })],
      items: [createItem({ id: "item-remote" })],
      queued_turns: [
        {
          queued_turn_id: "queued-1",
          message_preview: "继续执行",
          message_text: "继续执行当前任务",
          created_at: 1700000002000,
          image_count: 0,
          position: 1,
        },
      ],
    } satisfies AsterSessionDetail;

    const result = buildHydratedAgentSessionSnapshot({
      topicId: "topic-1",
      detail,
      currentSessionId: "topic-1",
      currentMessages,
      currentThreadTurns: currentTurns,
      currentThreadItems: currentItems,
      currentExecutionRuntime,
      currentExecutionStrategy: "react",
      topics: [],
    });

    expect(result.snapshot.sessionId).toBe("topic-1");
    expect(result.snapshot.messages).toEqual(currentMessages);
    expect(result.snapshot.threadTurns.map((turn) => turn.id)).toEqual([
      "turn-local",
      "turn-remote",
    ]);
    expect(result.snapshot.threadItems.map((item) => item.id)).toEqual([
      "item-local",
      "item-remote",
    ]);
    expect(result.snapshot.currentTurnId).toBe("turn-remote");
    expect(result.snapshot.executionRuntime).toEqual(currentExecutionRuntime);
    expect(result.snapshot.queuedTurns).toEqual([
      {
        queued_turn_id: "queued-1",
        message_preview: "继续执行",
        message_text: "继续执行当前任务",
        created_at: 1700000002000,
        image_count: 0,
        position: 1,
      },
    ]);
  });

  it("同会话 hydrate 时远端缺失过程字段也应保留本地 assistant 执行过程", () => {
    const now = new Date("2026-04-08T10:00:00.000Z");
    const currentMessages = [
      createMessage({
        id: "local-user",
        role: "user",
        content: "继续保存文章",
        timestamp: new Date("2026-04-08T09:59:59.000Z"),
      }),
      createMessage({
        id: "local-assistant",
        role: "assistant",
        content: "内容已保存到项目目录。",
        timestamp: now,
        thinkingContent: "先抓正文，再下载图片。",
        contentParts: [
          {
            type: "thinking",
            text: "先抓正文，再下载图片。",
          },
          {
            type: "tool_use",
            toolCall: {
              id: "tool-site-1",
              name: "site_run_adapter",
              arguments: "{\"url\":\"https://x.com/example/article/1\"}",
              status: "completed",
              startTime: now,
              endTime: now,
              result: {
                success: true,
                output: "saved: articles/google-cloud-tech.md",
              },
            },
          },
          {
            type: "text",
            text: "内容已保存到项目目录。",
          },
        ],
        toolCalls: [
          {
            id: "tool-site-1",
            name: "site_run_adapter",
            arguments: "{\"url\":\"https://x.com/example/article/1\"}",
            status: "completed",
            startTime: now,
            endTime: now,
            result: {
              success: true,
              output: "saved: articles/google-cloud-tech.md",
            },
          },
        ],
      }),
    ];
    const detail = {
      id: "topic-1",
      created_at: 1700000000,
      updated_at: 1700000001,
      messages: [
        {
          role: "user",
          timestamp: 1710000000,
          content: [{ type: "text", text: "继续保存文章" }],
        },
        {
          role: "assistant",
          timestamp: 1710000001,
          content: [{ type: "text", text: "内容已保存到项目目录。" }],
        },
      ],
    } satisfies AsterSessionDetail;

    const result = buildHydratedAgentSessionSnapshot({
      topicId: "topic-1",
      detail,
      currentSessionId: "topic-1",
      currentMessages,
      currentThreadTurns: [],
      currentThreadItems: [],
      currentExecutionRuntime: null,
      currentExecutionStrategy: "react",
      topics: [],
    });

    expect(result.snapshot.messages[1]?.thinkingContent).toBe(
      "先抓正文，再下载图片。",
    );
    expect(
      result.snapshot.messages[1]?.contentParts?.some(
        (part) =>
          part.type === "tool_use" && part.toolCall.id === "tool-site-1",
      ),
    ).toBe(true);
    expect(result.snapshot.messages[1]?.toolCalls?.[0]).toMatchObject({
      id: "tool-site-1",
      status: "completed",
    });
  });

  it("应按本地时间线活动判断是否需要校验丢失会话", () => {
    expect(
      hasSessionHydrationActivity({
        currentTurnId: null,
        threadTurnsCount: 0,
        threadItemsCount: 0,
        queuedTurnsCount: 0,
      }),
    ).toBe(false);
    expect(
      hasSessionHydrationActivity({
        currentTurnId: "turn-1",
        threadTurnsCount: 0,
        threadItemsCount: 0,
        queuedTurnsCount: 0,
      }),
    ).toBe(true);
  });
});
