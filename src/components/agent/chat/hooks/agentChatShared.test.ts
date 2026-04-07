import { describe, expect, it } from "vitest";

import type { Message } from "../types";
import {
  buildLiveTaskSnapshot,
  deriveTaskLiveState,
  deriveTaskStatusFromLiveState,
  extractTaskPreviewFromMessages,
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
});
