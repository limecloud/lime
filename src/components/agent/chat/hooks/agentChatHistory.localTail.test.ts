import { describe, expect, it } from "vitest";

import { mergeHydratedMessagesWithLocalState } from "./agentChatHistory";
import { collectRetainedLocalTail } from "./agentChatHistoryLocalMergeTail";

describe("agentChatHistory local tail preservation", () => {
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

    expect(mergedMessages[1]?.thinkingContent).toBe(
      "先打开页面，再抓取正文和图片。",
    );
    expect(mergedMessages[1]?.contentParts).toEqual([
      {
        type: "thinking",
        text: "先打开页面，再抓取正文和图片。",
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
    ]);
    expect(mergedMessages[1]?.toolCalls?.[0]).toMatchObject({
      id: "tool-site-1",
      status: "completed",
    });
  });

  it("刷新会话详情时不应把当前流式 assistant 输出替换成远端纯正文快照", () => {
    const localMessages = [
      {
        id: "local-user-live",
        role: "user" as const,
        content: "整理 Lime 产品知识库",
        timestamp: new Date("2026-05-13T03:36:00.000Z"),
      },
      {
        id: "local-assistant-live",
        role: "assistant" as const,
        content: "这是用户已经看到的流式输出。",
        timestamp: new Date("2026-05-13T03:36:01.000Z"),
        isThinking: true,
        thinkingContent: "先盘点产品资料，再整理知识库。",
        contentParts: [
          {
            type: "thinking" as const,
            text: "先盘点产品资料，再整理知识库。",
          },
          {
            type: "text" as const,
            text: "这是用户已经看到的流式输出。",
          },
        ],
      },
    ];
    const hydratedMessages = [
      {
        id: "history-user-live",
        role: "user" as const,
        content: "整理 Lime 产品知识库",
        timestamp: new Date("2026-05-13T03:36:02.000Z"),
      },
      {
        id: "history-assistant-live",
        role: "assistant" as const,
        content: "这是后端水合返回的纯正文快照。",
        contentParts: [
          {
            type: "text" as const,
            text: "这是后端水合返回的纯正文快照。",
          },
        ],
        timestamp: new Date("2026-05-13T03:36:03.000Z"),
      },
    ];

    const mergedMessages = mergeHydratedMessagesWithLocalState(
      localMessages,
      hydratedMessages,
    );

    expect(mergedMessages[1]).toMatchObject({
      id: "local-assistant-live",
      content: "这是用户已经看到的流式输出。",
      thinkingContent: "先盘点产品资料，再整理知识库。",
    });
    expect(mergedMessages[1]?.contentParts).toEqual([
      {
        type: "thinking",
        text: "先盘点产品资料，再整理知识库。",
      },
      {
        type: "text",
        text: "这是用户已经看到的流式输出。",
      },
    ]);
  });

  it("同轮本地 assistant 已带过程时不应被远端纯正文刷新掉已显示结果", () => {
    const localMessages = [
      {
        id: "local-user-skill-output",
        role: "user" as const,
        content:
          "/personal-ip-knowledge-builder 请根据现有资料整理 Lime 产品知识库并保留边界说明",
        timestamp: new Date("2026-05-13T03:37:00.000Z"),
      },
      {
        id: "local-assistant-skill-output",
        role: "assistant" as const,
        content: "本地流式完成后的产品知识库结果。",
        timestamp: new Date("2026-05-13T03:37:01.000Z"),
        isThinking: false,
        runtimeTurnId: "skill-exec-local-assistant-skill-output",
        thinkingContent: "先识别产品卖点，再输出知识库。",
        contentParts: [
          {
            type: "thinking" as const,
            text: "先识别产品卖点，再输出知识库。",
          },
          {
            type: "text" as const,
            text: "本地流式完成后的产品知识库结果。",
          },
        ],
      },
    ];
    const hydratedMessages = [
      {
        id: "history-user-skill-output",
        role: "user" as const,
        content: "请根据现有资料整理 Lime 产品知识库并保留边界说明",
        timestamp: new Date("2026-05-13T03:37:02.000Z"),
      },
      {
        id: "history-assistant-skill-output",
        role: "assistant" as const,
        content: "远端会话详情里的纯正文结果。",
        contentParts: [
          {
            type: "text" as const,
            text: "远端会话详情里的纯正文结果。",
          },
        ],
        timestamp: new Date("2026-05-13T03:37:03.000Z"),
      },
    ];

    const mergedMessages = mergeHydratedMessagesWithLocalState(
      localMessages,
      hydratedMessages,
    );

    expect(mergedMessages[1]).toMatchObject({
      id: "local-assistant-skill-output",
      content: "本地流式完成后的产品知识库结果。",
      runtimeTurnId: "skill-exec-local-assistant-skill-output",
      thinkingContent: "先识别产品卖点，再输出知识库。",
    });
    expect(mergedMessages[1]?.contentParts).toEqual([
      {
        type: "thinking",
        text: "先识别产品卖点，再输出知识库。",
      },
      {
        type: "text",
        text: "本地流式完成后的产品知识库结果。",
      },
    ]);
  });

  it("服务型 Skill 本地过程不应被远端纯正文刷新掉", () => {
    const localMessages = [
      {
        id: "local-user-service-skill-output",
        role: "user" as const,
        content: "整理 Lime 产品知识库",
        timestamp: new Date("2026-05-13T03:38:00.000Z"),
      },
      {
        id: "local-assistant-service-skill-output",
        role: "assistant" as const,
        content: "本地服务型 Skill 完成后的产品知识库结果。",
        timestamp: new Date("2026-05-13T03:38:01.000Z"),
        isThinking: false,
        runtimeTurnId: "turn-service-skill-output",
        inlineProcessRetention: "skill" as const,
        thinkingContent: "先读取服务型 Skill，再输出知识库。",
        contentParts: [
          {
            type: "thinking" as const,
            text: "先读取服务型 Skill，再输出知识库。",
          },
          {
            type: "text" as const,
            text: "本地服务型 Skill 完成后的产品知识库结果。",
          },
        ],
      },
    ];
    const hydratedMessages = [
      {
        id: "history-user-service-skill-output",
        role: "user" as const,
        content: "整理 Lime 产品知识库",
        timestamp: new Date("2026-05-13T03:38:02.000Z"),
      },
      {
        id: "history-assistant-service-skill-output",
        role: "assistant" as const,
        content: "远端服务型 Skill 纯正文结果。",
        contentParts: [
          {
            type: "text" as const,
            text: "远端服务型 Skill 纯正文结果。",
          },
        ],
        timestamp: new Date("2026-05-13T03:38:03.000Z"),
      },
    ];

    const mergedMessages = mergeHydratedMessagesWithLocalState(
      localMessages,
      hydratedMessages,
    );

    expect(mergedMessages[1]).toMatchObject({
      id: "local-assistant-service-skill-output",
      content: "本地服务型 Skill 完成后的产品知识库结果。",
      runtimeTurnId: "turn-service-skill-output",
      inlineProcessRetention: "skill",
      thinkingContent: "先读取服务型 Skill，再输出知识库。",
    });
    expect(mergedMessages[1]?.contentParts).toEqual([
      {
        type: "thinking",
        text: "先读取服务型 Skill，再输出知识库。",
      },
      {
        type: "text",
        text: "本地服务型 Skill 完成后的产品知识库结果。",
      },
    ]);
  });

  it("hydrate 宽松匹配不应把本地 thinking 兜底到远端纯正文 assistant", () => {
    const localMessages = [
      {
        id: "local-user-thinking",
        role: "user" as const,
        content: "整理会议纪要",
        timestamp: new Date("2026-05-06T10:00:00.000Z"),
      },
      {
        id: "local-assistant-thinking",
        role: "assistant" as const,
        content: "已完成。",
        timestamp: new Date("2026-05-06T10:00:02.000Z"),
        thinkingContent: "上一轮会议纪要思考。",
        contentParts: [
          {
            type: "thinking" as const,
            text: "上一轮会议纪要思考。",
          },
          {
            type: "text" as const,
            text: "已完成。",
          },
        ],
      },
    ];
    const hydratedMessages = [
      {
        id: "history-user-thinking",
        role: "user" as const,
        content: "另一个问题",
        timestamp: new Date("2026-05-06T10:00:03.000Z"),
      },
      {
        id: "history-assistant-thinking",
        role: "assistant" as const,
        content: "已完成。",
        timestamp: new Date("2026-05-06T10:00:04.000Z"),
        contentParts: [
          {
            type: "text" as const,
            text: "已完成。",
          },
        ],
      },
    ];

    const mergedMessages = mergeHydratedMessagesWithLocalState(
      localMessages,
      hydratedMessages,
    );

    expect(mergedMessages).toHaveLength(2);
    expect(mergedMessages[1]?.thinkingContent).toBeUndefined();
    expect(mergedMessages[1]?.contentParts).toEqual([
      {
        type: "text",
        text: "已完成。",
      },
    ]);
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

  it("尾部保留只应返回可保留的本地消息，不应污染已匹配的 timeline 主体", () => {
    const retainedTail = collectRetainedLocalTail({
      hydratedMessageIds: new Set(["history-user-1"]),
      lastHydratedMessage: {
        id: "history-user-1",
        role: "user" as const,
        content: "继续执行",
        timestamp: new Date("2026-04-08T10:00:01.000Z"),
      },
      lastMatchedLocalIndex: 0,
      lastMatchedLocalMessage: {
        id: "local-user-1",
        role: "user" as const,
        content: "继续执行",
        timestamp: new Date("2026-04-08T10:00:00.000Z"),
      },
      localMessages: [
        {
          id: "local-user-1",
          role: "user" as const,
          content: "继续执行",
          timestamp: new Date("2026-04-08T10:00:00.000Z"),
        },
        {
          id: "local-assistant-1",
          role: "assistant" as const,
          content: "本地尾部输出",
          timestamp: new Date("2026-04-08T10:00:02.000Z"),
        },
      ],
      matchedLocalMessageIds: new Set(["local-user-1"]),
    });

    expect(retainedTail).toHaveLength(1);
    expect(retainedTail[0]?.id).toBe("local-assistant-1");
  });
});
