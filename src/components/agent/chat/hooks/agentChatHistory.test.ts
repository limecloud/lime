import { describe, expect, it } from "vitest";

import type { AsterSessionDetail } from "@/lib/api/agentRuntime";
import {
  appendTextToParts,
  extractThinkingContentFromParts,
  hydrateSessionDetailMessages,
  mergeHydratedMessagesWithLocalState,
} from "./agentChatHistory";

describe("agentChatHistory", () => {
  it("追加累计 text_delta 时不应重复吐字", () => {
    expect(
      appendTextToParts([{ type: "text", text: "你好" }], "你好！我是 Lime"),
    ).toEqual([{ type: "text", text: "你好！我是 Lime" }]);
  });

  it("历史 output_text 以累计快照存储时应恢复为单份正文", () => {
    const detail: AsterSessionDetail = {
      id: "session-cumulative-text",
      created_at: 1,
      updated_at: 2,
      messages: [
        {
          role: "assistant",
          timestamp: 1710000201,
          content: [
            { type: "output_text", text: "你好" } as never,
            { type: "output_text", text: "你好！我是 Lime 助手。" } as never,
          ],
        },
      ],
    };

    const messages = hydrateSessionDetailMessages(
      detail,
      "session-cumulative-text",
    );

    expect(messages[0]?.content).toBe("你好！我是 Lime 助手。");
    expect(messages[0]?.contentParts).toEqual([
      {
        type: "text",
        text: "你好！我是 Lime 助手。",
      },
    ]);
  });

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
            { type: "input_text", text: "[Image #1]" } as never,
            {
              type: "input_image",
              image_url: "data:image/png;base64,aGVsbG8=",
            } as never,
          ],
        },
        {
          role: "assistant",
          timestamp: 1710000201,
          content: [{ type: "output_text", text: "已收到图片" } as never],
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
          content: [
            { type: "text", text: "请给我一版可直接使用的图片 Prompt" },
          ],
        },
        {
          role: "assistant",
          timestamp: 1710000005,
          content: [
            { type: "thinking", thinking: "先理解主题" } as never,
            { type: "thinking", thinking: "，再组织结构。\n" } as never,
            { type: "output_text", text: "下面是整理好的 Prompt。" } as never,
          ],
        },
      ],
    };

    const messages = hydrateSessionDetailMessages(detail, "session-1");
    const assistantMessage = messages.find(
      (message) => message.role === "assistant",
    );

    expect(assistantMessage).toBeDefined();
    expect(assistantMessage?.content).toBe("下面是整理好的 Prompt。");
    expect(assistantMessage?.thinkingContent).toBe(
      "先理解主题，再组织结构。\n",
    );
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

  it("分页历史消息应使用历史窗口绝对位置生成稳定 ID", () => {
    const detail: AsterSessionDetail = {
      id: "session-page",
      created_at: 1,
      updated_at: 2,
      messages_count: 100,
      history_limit: 2,
      history_offset: 40,
      history_truncated: true,
      messages: [
        {
          role: "user",
          timestamp: 1710000000,
          content: [{ type: "text", text: "更早问题" }],
        },
        {
          role: "assistant",
          timestamp: 1710000005,
          content: [{ type: "text", text: "更早回答" }],
        },
      ],
    };

    const messages = hydrateSessionDetailMessages(detail, "session-page");

    expect(messages.map((message) => message.id)).toEqual([
      "session-page-58",
      "session-page-59",
    ]);
  });

  it("Cursor 分页历史消息应优先使用游标起始位置生成稳定 ID", () => {
    const detail: AsterSessionDetail = {
      id: "session-cursor-page",
      created_at: 1,
      updated_at: 2,
      messages_count: 100,
      history_limit: 2,
      history_offset: 40,
      history_cursor: {
        oldest_message_id: 21,
        start_index: 20,
        loaded_count: 2,
      },
      history_truncated: true,
      messages: [
        {
          role: "user",
          timestamp: 1710000000,
          content: [{ type: "text", text: "Cursor 更早问题" }],
        },
        {
          role: "assistant",
          timestamp: 1710000005,
          content: [{ type: "text", text: "Cursor 更早回答" }],
        },
      ],
    };

    const messages = hydrateSessionDetailMessages(
      detail,
      "session-cursor-page",
    );

    expect(messages.map((message) => message.id)).toEqual([
      "session-cursor-page-20",
      "session-cursor-page-21",
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

  it("应在历史恢复时清理 assistant 正文中的工具协议残留", () => {
    const detail: AsterSessionDetail = {
      id: "session-protocol-cleanup",
      created_at: 1,
      updated_at: 2,
      messages: [
        {
          role: "assistant",
          timestamp: 1710000150,
          content: [
            {
              type: "output_text",
              text: '<tool_result>{"output":"saved"}</tool_result>\n\n文章已保存为 Markdown。',
            } as never,
          ],
        },
      ],
    };

    const messages = hydrateSessionDetailMessages(
      detail,
      "session-protocol-cleanup",
    );

    expect(messages[0]?.content).toBe("文章已保存为 Markdown。");
    expect(messages[0]?.contentParts).toEqual([
      {
        type: "text",
        text: "文章已保存为 Markdown。",
      },
    ]);
  });

  it("应从历史 assistant 消息恢复 token usage", () => {
    const detail: AsterSessionDetail = {
      id: "session-usage",
      created_at: 1,
      updated_at: 2,
      messages: [
        {
          role: "assistant",
          timestamp: 1710000300,
          content: [{ type: "output_text", text: "图片已经生成完成" } as never],
          usage: {
            input_tokens: 12000,
            output_tokens: 19000,
            cached_input_tokens: 4000,
            cache_creation_input_tokens: 1200,
          },
        },
      ],
    };

    const messages = hydrateSessionDetailMessages(detail, "session-usage");

    expect(messages[0]?.usage).toEqual({
      input_tokens: 12000,
      output_tokens: 19000,
      cached_input_tokens: 4000,
      cache_creation_input_tokens: 1200,
    });
  });

  it("合并相邻 assistant 历史消息时也应保留最后一条 usage", () => {
    const detail: AsterSessionDetail = {
      id: "session-adjacent-usage",
      created_at: 1,
      updated_at: 2,
      messages: [
        {
          role: "user",
          timestamp: 1710000300,
          content: [{ type: "text", text: "帮我分析这个仓库" } as never],
        },
        {
          role: "assistant",
          timestamp: 1710000301,
          content: [
            { type: "output_text", text: "我先做一次轻量侦查。" } as never,
          ],
        },
        {
          role: "assistant",
          timestamp: 1710000302,
          content: [
            {
              type: "output_text",
              text: "## 阶段结论\n\n已经找到关键线索。",
            } as never,
          ],
          usage: {
            input_tokens: 38483,
            output_tokens: 2406,
            cached_input_tokens: 36976,
            cache_creation_input_tokens: 0,
          },
        },
      ],
    };

    const messages = hydrateSessionDetailMessages(
      detail,
      "session-adjacent-usage",
    );

    expect(messages).toHaveLength(2);
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.content).toContain("我先做一次轻量侦查。");
    expect(messages[1]?.content).toContain("已经找到关键线索。");
    expect(messages[1]?.content).not.toContain("阶段结论");
    expect(messages[1]?.usage).toEqual({
      input_tokens: 38483,
      output_tokens: 2406,
      cached_input_tokens: 36976,
      cache_creation_input_tokens: 0,
    });
  });

  it("应从历史 tool_response 恢复图片任务预览，并保留同一任务的连续 assistant 轨迹", () => {
    const detail: AsterSessionDetail = {
      id: "session-history-image-task-preview",
      created_at: 1,
      updated_at: 2,
      messages: [
        {
          role: "assistant",
          timestamp: 1710000400,
          content: [
            { type: "text", text: "正在生成广州塔夜景海报" } as never,
            {
              type: "tool_request",
              id: "tool-image-history-1",
              tool_name: "bash",
              arguments: {
                command:
                  'lime media image generate --prompt "广州塔夜景海报" --size 1536x1024 --count 1',
              },
            } as never,
          ],
        },
        {
          role: "tool",
          timestamp: 1710000401,
          content: [
            {
              type: "tool_response",
              id: "tool-image-history-1",
              success: true,
              output: "图片任务已提交",
              metadata: {
                task_id: "task-image-history-1",
                task_type: "image_generate",
                status: "succeeded",
                project_id: "project-history-1",
                content_id: "content-history-1",
                requested_count: 1,
                received_count: 1,
              },
            } as never,
          ],
        },
      ],
    };

    const messages = hydrateSessionDetailMessages(
      detail,
      "session-history-image-task-preview",
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      imageWorkbenchPreview: {
        taskId: "task-image-history-1",
        prompt: "广州塔夜景海报",
        status: "complete",
        size: "1536x1024",
        imageCount: 1,
        projectId: "project-history-1",
        contentId: "content-history-1",
      },
    });
    expect(messages[0]?.contentParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({
          type: "tool_use",
          toolCall: expect.objectContaining({
            id: "tool-image-history-1",
            status: "completed",
          }),
        }),
      ]),
    );
  });

  it("应从历史 tool_response 恢复视频任务预览，并保留视频结果地址与时长信息", () => {
    const detail: AsterSessionDetail = {
      id: "session-history-video-task-preview",
      created_at: 1,
      updated_at: 2,
      messages: [
        {
          role: "assistant",
          timestamp: 1710000500,
          content: [
            { type: "text", text: "正在生成广州塔城市短片" } as never,
            {
              type: "tool_request",
              id: "tool-video-history-1",
              tool_name: "bash",
              arguments: {
                command:
                  'lime media video generate --prompt "广州塔城市短片" --duration 15 --aspect-ratio 16:9 --resolution 720p',
              },
            } as never,
          ],
        },
        {
          role: "tool",
          timestamp: 1710000501,
          content: [
            {
              type: "tool_response",
              id: "tool-video-history-1",
              success: true,
              output: "视频任务已完成",
              metadata: {
                task_id: "task-video-history-1",
                task_type: "video_generate",
                status: "succeeded",
                project_id: "project-video-history-1",
                content_id: "content-video-history-1",
                result: {
                  videos: [
                    {
                      url: "https://example.com/history-video.mp4",
                      duration_ms: 15000,
                    },
                  ],
                },
              },
            } as never,
          ],
        },
      ],
    };

    const messages = hydrateSessionDetailMessages(
      detail,
      "session-history-video-task-preview",
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      taskPreview: {
        kind: "video_generate",
        taskId: "task-video-history-1",
        status: "complete",
        prompt: "广州塔城市短片",
        durationSeconds: 15,
        aspectRatio: "16:9",
        resolution: "720p",
        projectId: "project-video-history-1",
        contentId: "content-video-history-1",
        videoUrl: "https://example.com/history-video.mp4",
      },
    });
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

  it("后端暂未返回历史时应保留本地消息，避免刷新后界面空白", () => {
    const localMessages = [
      {
        id: "local-user-1",
        role: "user" as const,
        content: "继续刚才的任务",
        timestamp: new Date("2026-03-19T00:00:00.000Z"),
      },
      {
        id: "local-assistant-1",
        role: "assistant" as const,
        content: "这是刚刚停止后的对话内容",
        timestamp: new Date("2026-03-19T00:00:01.000Z"),
      },
    ];

    const mergedMessages = mergeHydratedMessagesWithLocalState(
      localMessages,
      [],
    );

    expect(mergedMessages).toEqual(localMessages);
  });

  it("同会话刷新详情时应保留本地 assistant 的 token usage", () => {
    const localMessages = [
      {
        id: "local-user-1",
        role: "user" as const,
        content: "请整理成可继续编辑的文稿",
        timestamp: new Date("2026-04-07T00:00:00.000Z"),
      },
      {
        id: "local-assistant-1",
        role: "assistant" as const,
        content: "已同步到工作区，可继续在画布里阅读、编辑和定位到对应区块。",
        timestamp: new Date("2026-04-07T00:00:01.000Z"),
        usage: {
          input_tokens: 20480,
          output_tokens: 10240,
          cached_input_tokens: 8192,
          cache_creation_input_tokens: 2048,
        },
      },
    ];
    const hydratedMessages = [
      {
        id: "history-user-1",
        role: "user" as const,
        content: "请整理成可继续编辑的文稿",
        timestamp: new Date("2026-04-07T00:00:02.000Z"),
      },
      {
        id: "history-assistant-1",
        role: "assistant" as const,
        content: "已同步到工作区，可继续在画布里阅读、编辑和定位到对应区块。",
        timestamp: new Date("2026-04-07T00:00:03.000Z"),
      },
    ];

    const mergedMessages = mergeHydratedMessagesWithLocalState(
      localMessages,
      hydratedMessages,
    );

    expect(mergedMessages[1]?.usage).toEqual({
      input_tokens: 20480,
      output_tokens: 10240,
      cached_input_tokens: 8192,
      cache_creation_input_tokens: 2048,
    });
  });

  it("同会话 hydrate 时远端缺失过程字段也应保留本地 assistant 执行轨迹", () => {
    const now = new Date("2026-04-08T10:00:00.000Z");
    const localMessages = [
      {
        id: "local-user-1",
        role: "user" as const,
        content: "把文章保存到项目里",
        timestamp: new Date("2026-04-08T09:59:59.000Z"),
      },
      {
        id: "local-assistant-1",
        role: "assistant" as const,
        content: "内容已保存到项目目录。",
        timestamp: now,
        thinkingContent: "先打开页面，再抓取正文和图片。",
        contentParts: [
          {
            type: "thinking" as const,
            text: "先打开页面，再抓取正文和图片。",
          },
          {
            type: "tool_use" as const,
            toolCall: {
              id: "tool-site-1",
              name: "site_run_adapter",
              arguments: '{"url":"https://x.com/example/article/1"}',
              status: "completed" as const,
              startTime: now,
              endTime: now,
              result: {
                success: true,
                output: "saved: articles/google-cloud-tech.md",
              },
            },
          },
          {
            type: "text" as const,
            text: "内容已保存到项目目录。",
          },
        ],
        toolCalls: [
          {
            id: "tool-site-1",
            name: "site_run_adapter",
            arguments: '{"url":"https://x.com/example/article/1"}',
            status: "completed" as const,
            startTime: now,
            endTime: now,
            result: {
              success: true,
              output: "saved: articles/google-cloud-tech.md",
            },
          },
        ],
      },
    ];
    const hydratedMessages = [
      {
        id: "history-user-1",
        role: "user" as const,
        content: "把文章保存到项目里",
        timestamp: new Date("2026-04-08T10:00:01.000Z"),
      },
      {
        id: "history-assistant-1",
        role: "assistant" as const,
        content: "内容已保存到项目目录。",
        timestamp: new Date("2026-04-08T10:00:02.000Z"),
        contentParts: [
          {
            type: "text" as const,
            text: "内容已保存到项目目录。",
          },
        ],
      },
    ];

    const mergedMessages = mergeHydratedMessagesWithLocalState(
      localMessages,
      hydratedMessages,
    );

    expect(mergedMessages[1]?.thinkingContent).toBeUndefined();
    expect(mergedMessages[1]?.contentParts).toEqual([
      {
        type: "text",
        text: "内容已保存到项目目录。",
      },
    ]);
    expect(mergedMessages[1]?.toolCalls?.[0]).toMatchObject({
      id: "tool-site-1",
      status: "completed",
    });
  });

  it("同会话 hydrate 时远端暂未返回最新 assistant 消息也应保留本地尾部过程", () => {
    const localMessages = [
      {
        id: "local-user-1",
        role: "user" as const,
        content: "把文章保存到项目里",
        timestamp: new Date("2026-04-08T10:00:00.000Z"),
      },
      {
        id: "local-assistant-1",
        role: "assistant" as const,
        content: "内容已保存到项目目录。",
        timestamp: new Date("2026-04-08T10:00:02.000Z"),
        contentParts: [
          {
            type: "tool_use" as const,
            toolCall: {
              id: "tool-site-2",
              name: "site_run_adapter",
              arguments: '{"url":"https://x.com/example/article/2"}',
              status: "completed" as const,
              startTime: new Date("2026-04-08T10:00:01.000Z"),
              endTime: new Date("2026-04-08T10:00:02.000Z"),
              result: {
                success: true,
                output: "saved: articles/google-cloud-tech-2.md",
              },
            },
          },
          {
            type: "text" as const,
            text: "内容已保存到项目目录。",
          },
        ],
        toolCalls: [
          {
            id: "tool-site-2",
            name: "site_run_adapter",
            arguments: '{"url":"https://x.com/example/article/2"}',
            status: "completed" as const,
            startTime: new Date("2026-04-08T10:00:01.000Z"),
            endTime: new Date("2026-04-08T10:00:02.000Z"),
            result: {
              success: true,
              output: "saved: articles/google-cloud-tech-2.md",
            },
          },
        ],
      },
    ];
    const hydratedMessages = [
      {
        id: "history-user-1",
        role: "user" as const,
        content: "把文章保存到项目里",
        timestamp: new Date("2026-04-08T10:00:01.000Z"),
      },
    ];

    const mergedMessages = mergeHydratedMessagesWithLocalState(
      localMessages,
      hydratedMessages,
    );

    expect(mergedMessages).toHaveLength(2);
    expect(mergedMessages[1]?.role).toBe("assistant");
    expect(
      mergedMessages[1]?.contentParts?.some(
        (part) =>
          part.type === "tool_use" && part.toolCall.id === "tool-site-2",
      ),
    ).toBe(true);
  });

  it("远端最后停在 user 且时间戳略晚时，也应保留本地 assistant 尾部", () => {
    const localMessages = [
      {
        id: "local-user-early",
        role: "user" as const,
        content: "导出这篇文章",
        timestamp: new Date("2026-04-08T10:00:00.000Z"),
      },
      {
        id: "local-assistant-early",
        role: "assistant" as const,
        content: "",
        timestamp: new Date("2026-04-08T10:00:00.500Z"),
        contentParts: [
          {
            type: "tool_use" as const,
            toolCall: {
              id: "tool-site-early",
              name: "site_run_adapter",
              arguments: '{"url":"https://x.com/example/article/early"}',
              status: "completed" as const,
              startTime: new Date("2026-04-08T10:00:00.100Z"),
              endTime: new Date("2026-04-08T10:00:00.500Z"),
              result: {
                success: true,
                output: "saved: articles/example-early.md",
              },
            },
          },
        ],
        toolCalls: [
          {
            id: "tool-site-early",
            name: "site_run_adapter",
            arguments: '{"url":"https://x.com/example/article/early"}',
            status: "completed" as const,
            startTime: new Date("2026-04-08T10:00:00.100Z"),
            endTime: new Date("2026-04-08T10:00:00.500Z"),
            result: {
              success: true,
              output: "saved: articles/example-early.md",
            },
          },
        ],
      },
    ];
    const hydratedMessages = [
      {
        id: "history-user-early",
        role: "user" as const,
        content: "导出这篇文章",
        timestamp: new Date("2026-04-08T10:00:01.000Z"),
      },
    ];

    const mergedMessages = mergeHydratedMessagesWithLocalState(
      localMessages,
      hydratedMessages,
    );

    expect(mergedMessages).toHaveLength(2);
    expect(mergedMessages[1]?.role).toBe("assistant");
    expect(mergedMessages[1]?.toolCalls?.[0]?.id).toBe("tool-site-early");
  });

  it("同一条 hydrate assistant 缺失本地图片预览时，不应重复追加同 id 消息", () => {
    const assistantTimestamp = new Date("2026-04-23T12:00:02.000Z");
    const localMessages = [
      {
        id: "session-image-dup-0",
        role: "user" as const,
        content: "@配图 生成一张三国群像",
        timestamp: new Date("2026-04-23T12:00:00.000Z"),
      },
      {
        id: "session-image-dup-1",
        role: "assistant" as const,
        content: "图片任务已完成，共生成 1 张。",
        timestamp: assistantTimestamp,
        contentParts: [
          {
            type: "tool_use" as const,
            toolCall: {
              id: "tool-image-dup-1",
              name: "lime_create_image_generation_task",
              arguments: '{"prompt":"三国群像"}',
              status: "completed" as const,
              startTime: assistantTimestamp,
              endTime: assistantTimestamp,
              result: {
                success: true,
                output: "图片任务已完成，共生成 1 张。",
              },
            },
          },
          {
            type: "text" as const,
            text: "图片任务已完成，共生成 1 张。",
          },
        ],
        toolCalls: [
          {
            id: "tool-image-dup-1",
            name: "lime_create_image_generation_task",
            arguments: '{"prompt":"三国群像"}',
            status: "completed" as const,
            startTime: assistantTimestamp,
            endTime: assistantTimestamp,
            result: {
              success: true,
              output: "图片任务已完成，共生成 1 张。",
            },
          },
        ],
        imageWorkbenchPreview: {
          taskId: "task-image-dup-1",
          prompt: "三国群像",
          mode: "generate" as const,
          status: "complete" as const,
          imageUrl: "data:image/png;base64,dup-preview",
          imageCount: 1,
          projectId: "project-image-dup-1",
          contentId: "content-image-dup-1",
        },
      },
    ];
    const hydratedMessages = [
      {
        id: "session-image-dup-0",
        role: "user" as const,
        content: "@配图 生成一张三国群像",
        timestamp: new Date("2026-04-23T12:00:01.000Z"),
      },
      {
        id: "session-image-dup-1",
        role: "assistant" as const,
        content: "图片任务已完成，共生成 1 张。",
        timestamp: new Date("2026-04-23T12:00:03.000Z"),
        contentParts: [
          {
            type: "text" as const,
            text: "图片任务已完成，共生成 1 张。",
          },
        ],
      },
    ];

    const mergedMessages = mergeHydratedMessagesWithLocalState(
      localMessages,
      hydratedMessages,
    );

    expect(mergedMessages).toHaveLength(2);
    expect(
      mergedMessages.filter((message) => message.id === "session-image-dup-1"),
    ).toHaveLength(1);
    expect(mergedMessages[1]?.imageWorkbenchPreview).toMatchObject({
      taskId: "task-image-dup-1",
      imageUrl: "data:image/png;base64,dup-preview",
      status: "complete",
    });
  });
});
