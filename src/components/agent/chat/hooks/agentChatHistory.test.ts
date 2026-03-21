import { describe, expect, it } from "vitest";

import type { AsterSessionDetail } from "@/lib/api/agentRuntime";
import {
  extractThinkingContentFromParts,
  hydrateSessionDetailMessages,
  mergeHydratedMessagesWithLocalState,
} from "./agentChatHistory";

describe("agentChatHistory", () => {
  it("应清理仅用于内部展示的图片占位文本", () => {
    const detail: AsterSessionDetail = {
      id: "session-image-placeholder",
      created_at: 1,
      updated_at: 2,
      messages: [
        {
          role: "user",
          timestamp: 1710000200,
          content: [
            { type: "input_text", text: "[Image #1]" },
            {
              type: "input_image",
              image_url: "data:image/png;base64,aGVsbG8=",
            },
          ],
        },
        {
          role: "assistant",
          timestamp: 1710000201,
          content: [{ type: "output_text", text: "已收到图片" }],
        },
      ],
    };

    const messages = hydrateSessionDetailMessages(
      detail,
      "session-image-placeholder",
    );

    expect(messages[0]).toMatchObject({
      role: "user",
      content: "",
      images: [
        {
          mediaType: "image/png",
          data: "aGVsbG8=",
        },
      ],
    });
    expect(messages[1]?.content).toBe("已收到图片");
  });

  it("应从历史消息的 thinking 字段恢复完整思考过程", () => {
    const detail: AsterSessionDetail = {
      id: "session-1",
      created_at: 1,
      updated_at: 2,
      messages: [
        {
          role: "user",
          timestamp: 1710000000,
          content: [{ type: "text", text: "请给我一版可直接使用的图片 Prompt" }],
        },
        {
          role: "assistant",
          timestamp: 1710000005,
          content: [
            { type: "thinking", thinking: "先理解主题" } as never,
            { type: "thinking", thinking: "，再组织结构。\n" } as never,
            { type: "output_text", text: "下面是整理好的 Prompt。" },
          ],
        },
      ],
    };

    const messages = hydrateSessionDetailMessages(detail, "session-1");
    const assistantMessage = messages.find((message) => message.role === "assistant");

    expect(assistantMessage).toBeDefined();
    expect(assistantMessage?.content).toBe("下面是整理好的 Prompt。");
    expect(assistantMessage?.thinkingContent).toBe("先理解主题，再组织结构。\n");
    expect(assistantMessage?.contentParts).toEqual([
      {
        type: "thinking",
        text: "先理解主题，再组织结构。\n",
      },
      {
        type: "text",
        text: "下面是整理好的 Prompt。",
      },
    ]);
  });

  it("应兼容 reasoning 字段的历史恢复格式", () => {
    const detail: AsterSessionDetail = {
      id: "session-2",
      created_at: 1,
      updated_at: 2,
      messages: [
        {
          role: "assistant",
          timestamp: 1710000100,
          content: [
            { type: "reasoning", reasoning: "先列提纲" } as never,
            { type: "reasoning", reasoning: "，再展开正文" } as never,
          ],
        },
      ],
    };

    const messages = hydrateSessionDetailMessages(detail, "session-2");

    expect(messages[0]?.contentParts).toEqual([
      {
        type: "thinking",
        text: "先列提纲，再展开正文",
      },
    ]);
    expect(messages[0]?.thinkingContent).toBe("先列提纲，再展开正文");
  });

  it("应从内容片段中提取合并后的 thinkingContent", () => {
    expect(
      extractThinkingContentFromParts([
        { type: "text", text: "正文" },
        { type: "thinking", text: "先想" },
        { type: "thinking", text: "后写" },
      ]),
    ).toBe("先想后写");
  });

  it("刷新会话详情时应保留本地用户消息里的图片", () => {
    const localMessages = [
      {
        id: "local-user-1",
        role: "user" as const,
        content: "请参考这张图继续分析",
        images: [
          {
            mediaType: "image/png",
            data: "local-image-base64",
          },
        ],
        timestamp: new Date("2026-03-19T00:00:00.000Z"),
      },
      {
        id: "local-assistant-1",
        role: "assistant" as const,
        content: "已收到，正在分析。",
        timestamp: new Date("2026-03-19T00:00:01.000Z"),
      },
    ];
    const hydratedMessages = [
      {
        id: "history-user-1",
        role: "user" as const,
        content: "请参考这张图继续分析",
        timestamp: new Date("2026-03-19T00:00:02.000Z"),
      },
      {
        id: "history-assistant-1",
        role: "assistant" as const,
        content: "已收到，正在分析。",
        timestamp: new Date("2026-03-19T00:00:03.000Z"),
      },
    ];

    const mergedMessages = mergeHydratedMessagesWithLocalState(
      localMessages,
      hydratedMessages,
    );

    expect(mergedMessages[0]?.images).toEqual(localMessages[0]?.images);
    expect(mergedMessages[1]?.images).toBeUndefined();
  });
});
