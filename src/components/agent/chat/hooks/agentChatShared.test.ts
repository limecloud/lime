import { describe, expect, it } from "vitest";

import type { Message } from "../types";
import {
  buildLiveTaskSnapshot,
  deriveTaskLiveState,
  deriveTaskStatusFromLiveState,
  extractTaskPreviewFromMessages,
  resolveRecentTopicActionLabel,
  resolveRecentTopicCandidate,
} from "./agentChatShared";

function createPendingActionMessages(
  prompt = "请先确认发布标题后继续执行。",
): Message[] {
  const startedAt = new Date("2026-03-15T09:45:00.000Z");

  return [
    {
      id: "msg-user",
      role: "user",
      content: "帮我写一篇公众号发布文案",
      timestamp: startedAt,
    },
    {
      id: "msg-pending-action",
      role: "assistant",
      content: "",
      timestamp: new Date(startedAt.getTime() + 1000),
      actionRequests: [
        {
          requestId: "req-user-action-1",
          actionType: "ask_user",
          prompt,
        },
      ],
      contentParts: [
        {
          type: "action_required",
          actionRequired: {
            requestId: "req-user-action-1",
            actionType: "ask_user",
            prompt,
          },
        },
      ],
    },
  ];
}

describe("agentChatShared", () => {
  it("待处理 action request 未提交时应优先判定为待处理", () => {
    const messages = createPendingActionMessages();

    expect(
      deriveTaskStatusFromLiveState({
        messages,
        isSending: false,
        pendingActionCount: 0,
        workspaceError: false,
      }),
    ).toBe("waiting");

    expect(
      buildLiveTaskSnapshot({
        messages,
        isSending: false,
        pendingActionCount: 0,
        workspaceError: false,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "waiting",
        statusReason: "user_action",
      }),
    );

    expect(
      deriveTaskLiveState({
        messages,
        isSending: false,
        pendingActionCount: 0,
        workspaceError: false,
      }),
    ).toEqual({
      status: "waiting",
      statusReason: "user_action",
    });
  });

  it("应优先展示待处理请求的摘要", () => {
    const messages =
      createPendingActionMessages("请先确认发布标题后继续执行。");

    expect(extractTaskPreviewFromMessages(messages)).toBe(
      "请先确认发布标题后继续执行。",
    );
  });

  it("图片占位符不应直接出现在任务摘要里", () => {
    const now = new Date("2026-03-19T00:00:00.000Z");
    const messages: Message[] = [
      {
        id: "msg-user-image",
        role: "user",
        content: "[Image #1]",
        images: [
          {
            mediaType: "image/png",
            data: "aGVsbG8=",
          },
        ],
        timestamp: now,
      },
    ];

    expect(extractTaskPreviewFromMessages(messages)).toBe("已附加图片");
  });

  it("助手内部图片标签应转换为自然语言摘要", () => {
    const now = new Date("2026-03-19T00:00:00.000Z");
    const messages: Message[] = [
      {
        id: "msg-assistant-image",
        role: "assistant",
        content: "[Image #1]",
        timestamp: now,
      },
    ];

    expect(extractTaskPreviewFromMessages(messages)).toBe("图片处理中");
  });

  it("最新工具调用失败时应映射为工具失败", () => {
    expect(
      deriveTaskLiveState({
        messages: [
          {
            id: "msg-tool-failed",
            role: "assistant",
            content: "",
            timestamp: new Date("2026-03-15T09:45:01.000Z"),
            toolCalls: [
              {
                id: "tool-1",
                name: "write_file",
                arguments: "{}",
                status: "failed",
                startTime: new Date("2026-03-15T09:45:01.000Z"),
                endTime: new Date("2026-03-15T09:45:02.000Z"),
              },
            ],
          },
        ],
        isSending: false,
        pendingActionCount: 0,
        workspaceError: false,
      }),
    ).toEqual({
      status: "failed",
      statusReason: "tool_failure",
    });
  });

  it("当前线程仍在运行时，不应把最新 assistant 消息误判为已完成", () => {
    const messages: Message[] = [
      {
        id: "msg-tool-request",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-04-22T10:59:16.000Z"),
        toolCalls: [
          {
            id: "tool-1",
            name: "WebSearch",
            arguments: '{"query":"AI agent trends"}',
            status: "running",
            startTime: new Date("2026-04-22T10:59:16.000Z"),
          },
        ],
      },
    ];

    expect(
      deriveTaskLiveState({
        messages,
        isSending: false,
        pendingActionCount: 0,
        queuedTurnCount: 0,
        threadStatus: "running",
        workspaceError: false,
      }),
    ).toEqual({
      status: "running",
      statusReason: "default",
    });
  });

  it("应优先返回最近可继续的会话候选", () => {
    const topics = [
      {
        id: "topic-done",
        title: "最近结果",
        createdAt: new Date("2026-03-15T09:40:00.000Z"),
        updatedAt: new Date("2026-03-15T09:45:00.000Z"),
        workspaceId: "workspace-1",
        messagesCount: 4,
        executionStrategy: "react" as const,
        status: "done" as const,
        statusReason: "default" as const,
        lastPreview: "结果已产出。",
        isPinned: false,
        hasUnread: false,
        tag: null,
        sourceSessionId: "topic-done",
      },
      {
        id: "topic-waiting",
        title: "待继续任务",
        createdAt: new Date("2026-03-15T09:46:00.000Z"),
        updatedAt: new Date("2026-03-15T09:50:00.000Z"),
        workspaceId: "workspace-1",
        messagesCount: 2,
        executionStrategy: "react" as const,
        status: "waiting" as const,
        statusReason: "user_action" as const,
        lastPreview: "等待补充标题。",
        isPinned: false,
        hasUnread: false,
        tag: null,
        sourceSessionId: "topic-waiting",
      },
      {
        id: "topic-current",
        title: "当前任务",
        createdAt: new Date("2026-03-15T09:52:00.000Z"),
        updatedAt: new Date("2026-03-15T09:55:00.000Z"),
        workspaceId: "workspace-1",
        messagesCount: 1,
        executionStrategy: "react" as const,
        status: "draft" as const,
        statusReason: "default" as const,
        lastPreview: "当前草稿。",
        isPinned: false,
        hasUnread: false,
        tag: null,
        sourceSessionId: "topic-current",
      },
    ];

    expect(resolveRecentTopicCandidate(topics, "topic-current")?.id).toBe(
      "topic-waiting",
    );
  });

  it("最近会话动作文案应随会话状态变化", () => {
    expect(
      resolveRecentTopicActionLabel({
        status: "waiting",
        statusReason: "user_action",
        messagesCount: 2,
      }),
    ).toBe("继续最近会话");

    expect(
      resolveRecentTopicActionLabel({
        status: "done",
        statusReason: "default",
        messagesCount: 4,
      }),
    ).toBe("回看最近结果");

    expect(
      resolveRecentTopicActionLabel({
        status: "draft",
        statusReason: "default",
        messagesCount: 0,
      }),
    ).toBe("打开最近会话");
  });
});
