import { describe, expect, it } from "vitest";
import type { AsterSessionExecutionRuntime } from "@/lib/api/agentExecutionRuntime";
import type { AsterSessionDetail } from "@/lib/api/agentRuntime";
import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import {
  buildHydratedAgentSessionSnapshot,
  createEmptyAgentSessionSnapshot,
  hasSessionHydrationActivity,
  resolveRestorableTopicSessionId,
  shouldDeferSessionDetailHydration,
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

  it("限量话题列表未命中候选时，应保留候选会话用于直接恢复", () => {
    const resolved = resolveRestorableTopicSessionId(
      "session-detached",
      [
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
      ],
      { allowDetachedCandidate: true },
    );

    expect(resolved).toBe("session-detached");
  });

  it("切到其他会话且命中有效本地快照时应允许延后 detail hydration", () => {
    expect(
      shouldDeferSessionDetailHydration({
        currentSessionId: "topic-current",
        topicId: "topic-target",
        cachedSnapshot: {
          messages: [
            createMessage({
              id: "cached-message",
              role: "assistant",
              content: "本地快照里的最近消息",
            }),
          ],
          threadTurns: [],
          threadItems: [],
          currentTurnId: null,
        },
      }),
    ).toBe(true);
  });

  it("从空态打开命中缓存的话题时也应允许先回放快照", () => {
    expect(
      shouldDeferSessionDetailHydration({
        currentSessionId: null,
        topicId: "topic-target",
        cachedSnapshot: {
          messages: [createMessage()],
          threadTurns: [],
          threadItems: [],
          currentTurnId: null,
        },
      }),
    ).toBe(true);
  });

  it("当前会话或 resume hook 场景不应延后 detail hydration", () => {
    expect(
      shouldDeferSessionDetailHydration({
        currentSessionId: "topic-target",
        topicId: "topic-target",
        cachedSnapshot: {
          messages: [createMessage()],
          threadTurns: [],
          threadItems: [],
          currentTurnId: null,
        },
      }),
    ).toBe(false);
    expect(
      shouldDeferSessionDetailHydration({
        currentSessionId: "topic-current",
        topicId: "topic-target",
        resumeSessionStartHooks: true,
        cachedSnapshot: {
          messages: [createMessage()],
          threadTurns: [],
          threadItems: [],
          currentTurnId: null,
        },
      }),
    ).toBe(false);
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

  it("同会话 hydrate 时远端已有最终正文应收敛旧 assistant 执行过程到元数据", () => {
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
              arguments: '{"url":"https://x.com/example/article/1"}',
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
            arguments: '{"url":"https://x.com/example/article/1"}',
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

    expect(result.snapshot.messages[1]?.thinkingContent).toBeUndefined();
    expect(result.snapshot.messages[1]?.contentParts).toEqual([
      {
        type: "text",
        text: "内容已保存到项目目录。",
      },
    ]);
    expect(result.snapshot.messages[1]?.toolCalls?.[0]).toMatchObject({
      id: "tool-site-1",
      status: "completed",
    });
  });

  it("同会话 hydrate 时远端暂未返回最新 assistant 消息也应保留本地尾部消息", () => {
    const now = new Date("2026-04-08T10:00:02.000Z");
    const currentMessages = [
      createMessage({
        id: "local-user",
        role: "user",
        content: "继续保存文章",
        timestamp: new Date("2026-04-08T10:00:00.000Z"),
      }),
      createMessage({
        id: "local-assistant",
        role: "assistant",
        content: "内容已保存到项目目录。",
        timestamp: now,
        contentParts: [
          {
            type: "tool_use",
            toolCall: {
              id: "tool-site-2",
              name: "site_run_adapter",
              arguments: '{"url":"https://x.com/example/article/2"}',
              status: "completed",
              startTime: new Date("2026-04-08T10:00:01.000Z"),
              endTime: now,
              result: {
                success: true,
                output: "saved: articles/google-cloud-tech-2.md",
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
            id: "tool-site-2",
            name: "site_run_adapter",
            arguments: '{"url":"https://x.com/example/article/2"}',
            status: "completed",
            startTime: new Date("2026-04-08T10:00:01.000Z"),
            endTime: now,
            result: {
              success: true,
              output: "saved: articles/google-cloud-tech-2.md",
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
          timestamp: 1710000001,
          content: [{ type: "text", text: "继续保存文章" }],
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

    expect(result.snapshot.messages).toHaveLength(2);
    expect(result.snapshot.messages[1]?.role).toBe("assistant");
    expect(
      result.snapshot.messages[1]?.contentParts?.some(
        (part) =>
          part.type === "tool_use" && part.toolCall.id === "tool-site-2",
      ),
    ).toBe(true);
  });

  it("首次按 restore 候选 hydrate 时也应合并本地缓存而不是整段覆盖", () => {
    const now = new Date("2026-04-08T10:00:02.000Z");
    const currentMessages = [
      createMessage({
        id: "local-user",
        role: "user",
        content: "把文章保存到项目里",
        timestamp: new Date("2026-04-08T10:00:00.000Z"),
      }),
      createMessage({
        id: "local-assistant",
        role: "assistant",
        content: "内容已保存到项目目录。",
        timestamp: now,
        contentParts: [
          {
            type: "tool_use",
            toolCall: {
              id: "tool-site-restore",
              name: "site_run_adapter",
              arguments: '{"url":"https://x.com/example/article/3"}',
              status: "completed",
              startTime: new Date("2026-04-08T10:00:01.000Z"),
              endTime: now,
              result: {
                success: true,
                output: "saved: articles/google-cloud-tech-3.md",
              },
            },
          },
        ],
        toolCalls: [
          {
            id: "tool-site-restore",
            name: "site_run_adapter",
            arguments: '{"url":"https://x.com/example/article/3"}',
            status: "completed",
            startTime: new Date("2026-04-08T10:00:01.000Z"),
            endTime: now,
            result: {
              success: true,
              output: "saved: articles/google-cloud-tech-3.md",
            },
          },
        ],
      }),
    ];
    const detail = {
      id: "topic-restore",
      created_at: 1700000000,
      updated_at: 1700000001,
      messages: [
        {
          role: "user",
          timestamp: 1710000001,
          content: [{ type: "text", text: "把文章保存到项目里" }],
        },
      ],
    } satisfies AsterSessionDetail;

    const result = buildHydratedAgentSessionSnapshot({
      topicId: "topic-restore",
      detail,
      currentSessionId: null,
      currentMessages,
      currentThreadTurns: [],
      currentThreadItems: [],
      currentExecutionRuntime: null,
      currentExecutionStrategy: "react",
      topics: [],
      syncSessionId: true,
    });

    expect(result.snapshot.sessionId).toBe("topic-restore");
    expect(result.snapshot.messages).toHaveLength(2);
    expect(result.snapshot.messages[1]?.toolCalls?.[0]?.id).toBe(
      "tool-site-restore",
    );
  });

  it("切回其他历史会话时也应优先合并目标会话自己的本地快照", () => {
    const now = new Date("2026-04-08T10:00:02.000Z");
    const detail = {
      id: "topic-history-target",
      created_at: 1700000000,
      updated_at: 1700000001,
      messages: [
        {
          role: "user",
          timestamp: 1710000001,
          content: [{ type: "text", text: "把文章保存到项目里" }],
        },
      ],
    } satisfies AsterSessionDetail;

    const result = buildHydratedAgentSessionSnapshot({
      topicId: "topic-history-target",
      detail,
      currentSessionId: "topic-other",
      currentMessages: [
        createMessage({
          id: "other-session-message",
          role: "assistant",
          content: "这是另一个会话，不应参与合并",
        }),
      ],
      currentThreadTurns: [],
      currentThreadItems: [],
      currentExecutionRuntime: null,
      currentExecutionStrategy: "react",
      topics: [],
      localSnapshotOverride: {
        sessionId: "topic-history-target",
        messages: [
          createMessage({
            id: "local-user-target",
            role: "user",
            content: "把文章保存到项目里",
            timestamp: new Date("2026-04-08T10:00:00.000Z"),
          }),
          createMessage({
            id: "local-assistant-target",
            role: "assistant",
            content: "内容已保存到项目目录。",
            timestamp: now,
            toolCalls: [
              {
                id: "tool-site-target",
                name: "site_run_adapter",
                arguments: '{"url":"https://x.com/example/article/4"}',
                status: "completed",
                startTime: new Date("2026-04-08T10:00:01.000Z"),
                endTime: now,
                result: {
                  success: true,
                  output: "saved: articles/google-cloud-tech-4.md",
                },
              },
            ],
            contentParts: [
              {
                type: "tool_use",
                toolCall: {
                  id: "tool-site-target",
                  name: "site_run_adapter",
                  arguments: '{"url":"https://x.com/example/article/4"}',
                  status: "completed",
                  startTime: new Date("2026-04-08T10:00:01.000Z"),
                  endTime: now,
                  result: {
                    success: true,
                    output: "saved: articles/google-cloud-tech-4.md",
                  },
                },
              },
            ],
          }),
        ],
        threadTurns: [],
        threadItems: [],
      },
      syncSessionId: true,
    });

    expect(result.snapshot.messages).toHaveLength(2);
    expect(result.snapshot.messages[1]?.content).toBe("内容已保存到项目目录。");
    expect(result.snapshot.messages[1]?.thinkingContent).toBeUndefined();
    expect(result.snapshot.messages[1]?.toolCalls?.[0]?.id).toBe(
      "tool-site-target",
    );
    expect(result.snapshot.messages[1]?.contentParts).toEqual([
      {
        type: "text",
        text: "内容已保存到项目目录。",
      },
    ]);
    expect(result.snapshot.messages[1]?.content).not.toContain(
      "这是另一个会话",
    );
  });

  it("同会话 hydrate 时远端最后停在 user 且时间更晚，也应保留本地 assistant 尾部", () => {
    const currentMessages = [
      createMessage({
        id: "local-user-earlier",
        role: "user",
        content: "导出这篇文章",
        timestamp: new Date("2026-04-08T10:00:00.000Z"),
      }),
      createMessage({
        id: "local-assistant-earlier",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-04-08T10:00:00.500Z"),
        contentParts: [
          {
            type: "tool_use",
            toolCall: {
              id: "tool-site-earlier",
              name: "site_run_adapter",
              arguments: '{"url":"https://x.com/example/article/earlier"}',
              status: "completed",
              startTime: new Date("2026-04-08T10:00:00.100Z"),
              endTime: new Date("2026-04-08T10:00:00.500Z"),
              result: {
                success: true,
                output: "saved: articles/example-earlier.md",
              },
            },
          },
        ],
        toolCalls: [
          {
            id: "tool-site-earlier",
            name: "site_run_adapter",
            arguments: '{"url":"https://x.com/example/article/earlier"}',
            status: "completed",
            startTime: new Date("2026-04-08T10:00:00.100Z"),
            endTime: new Date("2026-04-08T10:00:00.500Z"),
            result: {
              success: true,
              output: "saved: articles/example-earlier.md",
            },
          },
        ],
      }),
    ];
    const detail = {
      id: "topic-earlier-tail",
      created_at: 1700000000,
      updated_at: 1700000001,
      messages: [
        {
          role: "user",
          timestamp: 1712570401,
          content: [{ type: "text", text: "导出这篇文章" }],
        },
      ],
    } satisfies AsterSessionDetail;

    const result = buildHydratedAgentSessionSnapshot({
      topicId: "topic-earlier-tail",
      detail,
      currentSessionId: "topic-earlier-tail",
      currentMessages,
      currentThreadTurns: [],
      currentThreadItems: [],
      currentExecutionRuntime: null,
      currentExecutionStrategy: "react",
      topics: [],
    });

    expect(result.snapshot.messages).toHaveLength(2);
    expect(result.snapshot.messages[1]?.role).toBe("assistant");
    expect(result.snapshot.messages[1]?.toolCalls?.[0]?.id).toBe(
      "tool-site-earlier",
    );
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
