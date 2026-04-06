import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { Message } from "../types";

const {
  mockSafeListen,
  mockParseAgentEvent,
  mockListExecutableSkills,
  mockExecuteSkill,
} = vi.hoisted(() => ({
  mockSafeListen: vi.fn(),
  mockParseAgentEvent: vi.fn((payload: unknown) => payload),
  mockListExecutableSkills: vi.fn(),
  mockExecuteSkill: vi.fn(),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: mockSafeListen,
}));

vi.mock("@/lib/api/agentProtocol", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/agentProtocol")
  >("@/lib/api/agentProtocol");
  return {
    ...actual,
    parseAgentEvent: mockParseAgentEvent,
  };
});

vi.mock("@/lib/api/skill-execution", () => ({
  skillExecutionApi: {
    listExecutableSkills: mockListExecutableSkills,
    executeSkill: mockExecuteSkill,
  },
}));

import {
  parseSkillSlashCommand,
  tryExecuteSlashSkillCommand,
} from "./skillCommand";

interface MessageStore {
  getMessages: () => Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
}

function createMessageStore(initial: Message[]): MessageStore {
  let messages = [...initial];
  return {
    getMessages: () => messages,
    setMessages: (value) => {
      messages = typeof value === "function" ? value(messages) : value;
    },
  };
}

function buildBaseMessage(id = "assistant-1"): Message {
  return {
    id,
    role: "assistant",
    content: "",
    timestamp: new Date(),
    contentParts: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockParseAgentEvent.mockImplementation((payload: unknown) => payload);
  mockListExecutableSkills.mockResolvedValue([
    {
      name: "content_post_with_cover",
      display_name: "content_post_with_cover",
      description: "social",
      execution_mode: "prompt",
      has_workflow: false,
    },
  ]);
  mockSafeListen.mockResolvedValue((() => {}) as UnlistenFn);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("tryExecuteSlashSkillCommand 社媒主链路", () => {
  it("不应再归一非当前 skill 名", () => {
    expect(
      parseSkillSlashCommand("/legacy_content_post 写一版主稿"),
    ).toMatchObject({
      skillName: "legacy_content_post",
      userInput: "写一版主稿",
    });
  });

  it("当后端连续发出 write_file 工具事件时应写入主稿与辅助产物", async () => {
    const store = createMessageStore([buildBaseMessage()]);
    const onWriteFile = vi.fn();
    let streamHandler: ((event: { payload: unknown }) => void) | null = null;

    mockSafeListen.mockImplementation(async (_eventName, handler) => {
      streamHandler = handler as (event: { payload: unknown }) => void;
      return () => {
        streamHandler = null;
      };
    });

    mockExecuteSkill.mockImplementation(async () => {
      const emitWriteToolStart = (
        toolId: string,
        path: string,
        content: string,
      ) => {
        streamHandler?.({
          payload: {
            type: "tool_start",
            tool_id: toolId,
            tool_name: "write_file",
            arguments: JSON.stringify({
              path,
              content,
            }),
          },
        });
      };

      emitWriteToolStart(
        "tool-main",
        "content-posts/demo.md",
        "# 标题\n\n主稿正文",
      );
      emitWriteToolStart(
        "tool-cover",
        "content-posts/demo.cover.json",
        '{"cover_url":"https://example.com/cover.png","status":"成功"}',
      );
      emitWriteToolStart(
        "tool-pack",
        "content-posts/demo.publish-pack.json",
        '{"article_path":"content-posts/demo.md","cover_meta_path":"content-posts/demo.cover.json"}',
      );
      streamHandler?.({ payload: { type: "final_done" } });

      return {
        success: true,
        output:
          '<write_file path="content-posts/demo.md">\n# 标题\n\n主稿正文\n</write_file>',
        steps_completed: [],
      };
    });

    const handled = await tryExecuteSlashSkillCommand({
      command: {
        skillName: "content_post_with_cover",
        userInput: "输出社媒文案",
      },
      rawContent: "/content_post_with_cover 输出社媒文案",
      assistantMsgId: "assistant-1",
      providerType: "anthropic",
      model: "claude-sonnet-4-20250514",
      ensureSession: async () => "session-1",
      setMessages: store.setMessages,
      setIsSending: vi.fn(),
      setCurrentAssistantMsgId: vi.fn(),
      setStreamUnlisten: vi.fn(),
      setActiveSessionIdForStop: vi.fn(),
      isExecutionCancelled: () => false,
      playTypewriterSound: vi.fn(),
      playToolcallSound: vi.fn(),
      onWriteFile,
    });

    expect(handled).toBe(true);
    expect(onWriteFile).toHaveBeenCalledTimes(3);

    const writtenPaths = onWriteFile.mock.calls.map((call) => call[1]);
    expect(writtenPaths).toContain("content-posts/demo.md");
    expect(writtenPaths).toContain("content-posts/demo.cover.json");
    expect(writtenPaths).toContain("content-posts/demo.publish-pack.json");
  });

  it("当 executeSkill.output 包含 write_file 时应覆盖流式旧内容", async () => {
    const store = createMessageStore([buildBaseMessage()]);
    const onWriteFile = vi.fn();
    let streamHandler: ((event: { payload: unknown }) => void) | null = null;

    mockSafeListen.mockImplementation(async (_eventName, handler) => {
      streamHandler = handler as (event: { payload: unknown }) => void;
      return () => {
        streamHandler = null;
      };
    });

    const writeFileOutput = `<write_file path="content-posts/final.md">\n# 最终稿\n\n正文\n</write_file>`;
    mockExecuteSkill.mockImplementation(async () => {
      streamHandler?.({ payload: { type: "text_delta", text: "流式旧内容" } });
      streamHandler?.({ payload: { type: "final_done" } });
      return {
        success: true,
        output: writeFileOutput,
        steps_completed: [],
      };
    });

    const handled = await tryExecuteSlashSkillCommand({
      command: {
        skillName: "content_post_with_cover",
        userInput: "写一篇春季上新文案",
      },
      rawContent: "/content_post_with_cover 写一篇春季上新文案",
      assistantMsgId: "assistant-1",
      providerType: "anthropic",
      model: "claude-sonnet-4-20250514",
      ensureSession: async () => "session-1",
      setMessages: store.setMessages,
      setIsSending: vi.fn(),
      setCurrentAssistantMsgId: vi.fn(),
      setStreamUnlisten: vi.fn(),
      setActiveSessionIdForStop: vi.fn(),
      isExecutionCancelled: () => false,
      playTypewriterSound: vi.fn(),
      playToolcallSound: vi.fn(),
      onWriteFile,
    });

    expect(handled).toBe(true);
    expect(store.getMessages()[0]?.content).toBe(writeFileOutput);
    expect(store.getMessages()[0]?.contentParts).toEqual([
      { type: "text", text: writeFileOutput },
    ]);
    expect(onWriteFile).not.toHaveBeenCalled();
  });

  it("收到 artifact_snapshot 时应立刻透传给 onWriteFile", async () => {
    const store = createMessageStore([buildBaseMessage()]);
    const onWriteFile = vi.fn();
    let streamHandler: ((event: { payload: unknown }) => void) | null = null;

    mockSafeListen.mockImplementation(async (_eventName, handler) => {
      streamHandler = handler as (event: { payload: unknown }) => void;
      return () => {
        streamHandler = null;
      };
    });

    mockExecuteSkill.mockImplementation(async () => {
      streamHandler?.({
        payload: {
          type: "artifact_snapshot",
          artifact: {
            artifactId: "artifact-1",
            filePath: "content-posts/live.md",
            content: "# 实时稿",
            metadata: {
              complete: false,
              writePhase: "streaming",
              lastUpdateSource: "artifact_snapshot",
            },
          },
        },
      });
      streamHandler?.({ payload: { type: "final_done" } });

      return {
        success: true,
        output:
          '<write_file path="content-posts/live.md">\n# 实时稿\n</write_file>',
        steps_completed: [],
      };
    });

    const handled = await tryExecuteSlashSkillCommand({
      command: {
        skillName: "content_post_with_cover",
        userInput: "实时写作",
      },
      rawContent: "/content_post_with_cover 实时写作",
      assistantMsgId: "assistant-1",
      providerType: "anthropic",
      model: "claude-sonnet-4-20250514",
      ensureSession: async () => "session-1",
      setMessages: store.setMessages,
      setIsSending: vi.fn(),
      setCurrentAssistantMsgId: vi.fn(),
      setStreamUnlisten: vi.fn(),
      setActiveSessionIdForStop: vi.fn(),
      isExecutionCancelled: () => false,
      playTypewriterSound: vi.fn(),
      playToolcallSound: vi.fn(),
      onWriteFile,
    });

    expect(handled).toBe(true);
    expect(onWriteFile).toHaveBeenCalledTimes(1);
    expect(onWriteFile).toHaveBeenCalledWith(
      "# 实时稿",
      "content-posts/live.md",
      expect.objectContaining({
        artifactId: "artifact-1",
        source: "artifact_snapshot",
        status: "streaming",
      }),
    );
  });

  it("当社媒结果无 write_file 时应走前端兜底写入", async () => {
    const store = createMessageStore([buildBaseMessage()]);
    const onWriteFile = vi.fn();

    mockExecuteSkill.mockResolvedValue({
      success: true,
      output: "# 标题\n\n正文内容",
      steps_completed: [],
    });

    const handled = await tryExecuteSlashSkillCommand({
      command: {
        skillName: "content_post_with_cover",
        userInput: "新品发布",
      },
      rawContent: "/content_post_with_cover 新品发布",
      assistantMsgId: "assistant-1",
      providerType: "anthropic",
      model: "claude-sonnet-4-20250514",
      ensureSession: async () => "session-1",
      setMessages: store.setMessages,
      setIsSending: vi.fn(),
      setCurrentAssistantMsgId: vi.fn(),
      setStreamUnlisten: vi.fn(),
      setActiveSessionIdForStop: vi.fn(),
      isExecutionCancelled: () => false,
      playTypewriterSound: vi.fn(),
      playToolcallSound: vi.fn(),
      onWriteFile,
    });

    expect(handled).toBe(true);
    expect(store.getMessages()[0]?.content).toBe("# 标题\n\n正文内容");
    expect(onWriteFile).toHaveBeenCalledTimes(1);
    const [contentArg, filePathArg] = onWriteFile.mock.calls[0];
    expect(contentArg).toBe("# 标题\n\n正文内容");
    expect(filePathArg).toMatch(
      /^content-posts\/\d{8}-\d{6}-[a-z0-9-]+-[a-z0-9]{3,6}\.md$/,
    );
  });

  it("非社媒技能在无 write_file 时不应触发兜底写入", async () => {
    const store = createMessageStore([buildBaseMessage()]);
    const onWriteFile = vi.fn();
    mockListExecutableSkills.mockResolvedValue([
      {
        name: "other_skill",
        display_name: "other_skill",
        description: "other",
        execution_mode: "prompt",
        has_workflow: false,
      },
    ]);
    mockExecuteSkill.mockResolvedValue({
      success: true,
      output: "普通文本输出",
      steps_completed: [],
    });

    const handled = await tryExecuteSlashSkillCommand({
      command: {
        skillName: "other_skill",
        userInput: "输出内容",
      },
      rawContent: "/other_skill 输出内容",
      assistantMsgId: "assistant-1",
      providerType: "anthropic",
      model: "claude-sonnet-4-20250514",
      ensureSession: async () => "session-1",
      setMessages: store.setMessages,
      setIsSending: vi.fn(),
      setCurrentAssistantMsgId: vi.fn(),
      setStreamUnlisten: vi.fn(),
      setActiveSessionIdForStop: vi.fn(),
      isExecutionCancelled: () => false,
      playTypewriterSound: vi.fn(),
      playToolcallSound: vi.fn(),
      onWriteFile,
    });

    expect(handled).toBe(true);
    expect(onWriteFile).not.toHaveBeenCalled();
  });

  it("图片 skill 返回媒体任务 metadata 时应直接挂载图片预览卡", async () => {
    const store = createMessageStore([buildBaseMessage()]);
    let streamHandler: ((event: { payload: unknown }) => void) | null = null;

    mockListExecutableSkills.mockResolvedValueOnce([
      {
        name: "image_generate",
        display_name: "image_generate",
        description: "image",
        execution_mode: "prompt",
        has_workflow: false,
      },
    ]);
    mockSafeListen.mockImplementation(async (_eventName, handler) => {
      streamHandler = handler as (event: { payload: unknown }) => void;
      return () => {
        streamHandler = null;
      };
    });

    mockExecuteSkill.mockImplementation(async () => {
      streamHandler?.({
        payload: {
          type: "tool_start",
          tool_id: "tool-image-1",
          tool_name: "Bash",
          arguments: JSON.stringify({
            command:
              "lime media image generate --prompt '春日咖啡馆插画' --size 1024x1024 --count 2 --json",
          }),
        },
      });
      streamHandler?.({
        payload: {
          type: "tool_end",
          tool_id: "tool-image-1",
          result: {
            success: true,
            output: "任务已提交",
            metadata: {
              task_id: "task-image-skill-1",
              task_type: "image_generate",
              task_family: "image",
              status: "pending_submit",
              artifact_path:
                ".lime/tasks/image_generate/task-image-skill-1.json",
            },
          },
        },
      });
      streamHandler?.({ payload: { type: "final_done" } });

      return {
        success: true,
        output:
          "任务类型：image_generate\n任务 ID：task-image-skill-1\n状态：pending_submit",
        steps_completed: [],
      };
    });

    const handled = await tryExecuteSlashSkillCommand({
      command: {
        skillName: "image_generate",
        userInput: "春日咖啡馆插画",
      },
      rawContent: "/image_generate 春日咖啡馆插画",
      assistantMsgId: "assistant-1",
      providerType: "openai",
      model: "gpt-5.4",
      ensureSession: async () => "session-1",
      setMessages: store.setMessages,
      setIsSending: vi.fn(),
      setCurrentAssistantMsgId: vi.fn(),
      setStreamUnlisten: vi.fn(),
      setActiveSessionIdForStop: vi.fn(),
      isExecutionCancelled: () => false,
      playTypewriterSound: vi.fn(),
      playToolcallSound: vi.fn(),
    });

    expect(handled).toBe(true);
    expect(store.getMessages()[0]).toMatchObject({
      imageWorkbenchPreview: {
        taskId: "task-image-skill-1",
        prompt: "春日咖啡馆插画",
        status: "running",
        phase: "queued",
      },
    });
  });

  it("视频 skill 返回媒体任务 metadata 时应直接挂载通用任务预览卡", async () => {
    const store = createMessageStore([buildBaseMessage("assistant-video-1")]);
    let streamHandler: ((event: { payload: unknown }) => void) | null = null;

    mockListExecutableSkills.mockResolvedValueOnce([
      {
        name: "video_generate",
        display_name: "video_generate",
        description: "video",
        execution_mode: "prompt",
        has_workflow: false,
      },
    ]);
    mockSafeListen.mockImplementation(async (_eventName, handler) => {
      streamHandler = handler as (event: { payload: unknown }) => void;
      return () => {
        streamHandler = null;
      };
    });

    mockExecuteSkill.mockImplementation(async () => {
      streamHandler?.({
        payload: {
          type: "tool_start",
          tool_id: "tool-video-1",
          tool_name: "Bash",
          arguments: JSON.stringify({
            command:
              "lime task create video --prompt '新品发布会短视频' --duration 15 --aspect-ratio 16:9 --resolution 720p --json",
          }),
        },
      });
      streamHandler?.({
        payload: {
          type: "tool_end",
          tool_id: "tool-video-1",
          result: {
            success: true,
            output: "任务已提交",
            metadata: {
              task_id: "task-video-skill-1",
              task_type: "video_generate",
              task_family: "video",
              status: "pending_submit",
              project_id: "project-video-1",
              content_id: "content-video-1",
              artifact_path:
                ".lime/tasks/video_generate/task-video-skill-1.json",
            },
          },
        },
      });
      streamHandler?.({ payload: { type: "final_done" } });

      return {
        success: true,
        output:
          "任务类型：video_generate\n任务 ID：task-video-skill-1\n状态：pending_submit",
        steps_completed: [],
      };
    });

    const handled = await tryExecuteSlashSkillCommand({
      command: {
        skillName: "video_generate",
        userInput: "新品发布会短视频",
      },
      rawContent: "/video_generate 新品发布会短视频",
      assistantMsgId: "assistant-video-1",
      providerType: "openai",
      model: "gpt-5.4",
      ensureSession: async () => "session-video-1",
      setMessages: store.setMessages,
      setIsSending: vi.fn(),
      setCurrentAssistantMsgId: vi.fn(),
      setStreamUnlisten: vi.fn(),
      setActiveSessionIdForStop: vi.fn(),
      isExecutionCancelled: () => false,
      playTypewriterSound: vi.fn(),
      playToolcallSound: vi.fn(),
    });

    expect(handled).toBe(true);
    expect(store.getMessages()[0]).toMatchObject({
      taskPreview: {
        kind: "video_generate",
        taskId: "task-video-skill-1",
        prompt: "新品发布会短视频",
        status: "running",
        durationSeconds: 15,
        aspectRatio: "16:9",
        resolution: "720p",
        projectId: "project-video-1",
        contentId: "content-video-1",
        phase: "queued",
      },
    });
  });

  it("素材 skill 直搜图片时应挂载图片候选预览与 artifact", async () => {
    const store = createMessageStore([
      buildBaseMessage("assistant-resource-1"),
    ]);
    let streamHandler: ((event: { payload: unknown }) => void) | null = null;

    mockListExecutableSkills.mockResolvedValueOnce([
      {
        name: "modal_resource_search",
        display_name: "modal_resource_search",
        description: "resource",
        execution_mode: "prompt",
        has_workflow: false,
      },
    ]);
    mockSafeListen.mockImplementation(async (_eventName, handler) => {
      streamHandler = handler as (event: { payload: unknown }) => void;
      return () => {
        streamHandler = null;
      };
    });

    mockExecuteSkill.mockImplementation(async () => {
      streamHandler?.({
        payload: {
          type: "tool_start",
          tool_id: "tool-resource-web-1",
          tool_name: "lime_search_web_images",
          arguments: JSON.stringify({
            query: "cozy coffee table",
            count: 3,
            aspect: "landscape",
          }),
        },
      });
      streamHandler?.({
        payload: {
          type: "tool_end",
          tool_id: "tool-resource-web-1",
          result: {
            success: true,
            output: "已找到 3 张图片候选",
            metadata: {
              provider: "pexels",
              result: {
                provider: "pexels",
                query: "cozy coffee table",
                returnedCount: 3,
                aspect: "landscape",
                hits: [
                  {
                    id: "hit-1",
                    thumbnail_url: "https://pexels.example/1-thumb.jpg",
                    content_url: "https://pexels.example/1.jpg",
                    width: 1600,
                    height: 900,
                    name: "cozy coffee table 1",
                    host_page_url: "https://www.pexels.com/photo/1",
                  },
                  {
                    id: "hit-2",
                    thumbnail_url: "https://pexels.example/2-thumb.jpg",
                    content_url: "https://pexels.example/2.jpg",
                    width: 1600,
                    height: 900,
                    name: "cozy coffee table 2",
                    host_page_url: "https://www.pexels.com/photo/2",
                  },
                  {
                    id: "hit-3",
                    thumbnail_url: "https://pexels.example/3-thumb.jpg",
                    content_url: "https://pexels.example/3.jpg",
                    width: 1600,
                    height: 900,
                    name: "cozy coffee table 3",
                    host_page_url: "https://www.pexels.com/photo/3",
                  },
                ],
              },
            },
          },
        },
      });
      streamHandler?.({ payload: { type: "final_done" } });

      return {
        success: true,
        output: "已返回 3 张图片候选",
        steps_completed: [],
      };
    });

    const handled = await tryExecuteSlashSkillCommand({
      command: {
        skillName: "modal_resource_search",
        userInput: "找一组咖啡馆木桌背景图",
      },
      rawContent: "/modal_resource_search 找一组咖啡馆木桌背景图",
      assistantMsgId: "assistant-resource-1",
      providerType: "openai",
      model: "gpt-5.4",
      ensureSession: async () => "session-resource-1",
      setMessages: store.setMessages,
      setIsSending: vi.fn(),
      setCurrentAssistantMsgId: vi.fn(),
      setStreamUnlisten: vi.fn(),
      setActiveSessionIdForStop: vi.fn(),
      isExecutionCancelled: () => false,
      playTypewriterSound: vi.fn(),
      playToolcallSound: vi.fn(),
    });

    expect(handled).toBe(true);
    expect(store.getMessages()[0]).toMatchObject({
      taskPreview: {
        kind: "modal_resource_search",
        taskId: "resource-search:tool-resource-web-1",
        status: "complete",
        artifactPath: ".lime/runtime/resource-search/tool-resource-web-1.md",
      },
      artifacts: [
        expect.objectContaining({
          title: "tool-resource-web-1.md",
          type: "document",
        }),
      ],
    });
  });

  it("slash skill 执行时应透传图片与结构化请求上下文", async () => {
    const store = createMessageStore([buildBaseMessage()]);
    mockListExecutableSkills.mockResolvedValueOnce([
      {
        name: "image_generate",
        display_name: "image_generate",
        description: "image",
        execution_mode: "prompt",
        has_workflow: false,
      },
    ]);
    mockExecuteSkill.mockResolvedValue({
      success: true,
      output: "任务已提交",
      steps_completed: [],
    });

    const handled = await tryExecuteSlashSkillCommand({
      command: {
        skillName: "image_generate",
        userInput: "请基于参考图微调",
      },
      rawContent: "/image_generate 请基于参考图微调",
      assistantMsgId: "assistant-ctx-1",
      providerType: "openai",
      model: "gpt-5.4",
      images: [
        {
          data: "base64-image-1",
          mediaType: "image/png",
        },
      ],
      requestContext: {
        kind: "image_task",
        image_task: {
          mode: "edit",
          reference_images: ["skill-input-image://1"],
        },
      },
      ensureSession: async () => "session-ctx-1",
      setMessages: store.setMessages,
      setIsSending: vi.fn(),
      setCurrentAssistantMsgId: vi.fn(),
      setStreamUnlisten: vi.fn(),
      setActiveSessionIdForStop: vi.fn(),
      isExecutionCancelled: () => false,
      playTypewriterSound: vi.fn(),
      playToolcallSound: vi.fn(),
    });

    expect(handled).toBe(true);
    expect(mockExecuteSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        skillName: "image_generate",
        userInput: "请基于参考图微调",
        images: [
          {
            data: "base64-image-1",
            mediaType: "image/png",
          },
        ],
        requestContext: {
          kind: "image_task",
          image_task: {
            mode: "edit",
            reference_images: ["skill-input-image://1"],
          },
        },
      }),
    );
  });
});

describe("tryExecuteSlashSkillCommand 浏览器工具链路", () => {
  it("收到 tool_end error 时应清洗 Lime 元数据块", async () => {
    let messages: Message[] = [buildBaseMessage("assistant-skill-1")];

    const setMessages = (
      next: Message[] | ((prev: Message[]) => Message[]),
    ) => {
      messages = typeof next === "function" ? next(messages) : next;
    };

    let streamHandler: ((event: { payload: unknown }) => void) | null = null;
    mockListExecutableSkills.mockResolvedValue([
      {
        name: "browser_task",
        display_name: "浏览器任务",
        description: "执行浏览器相关操作",
        execution_mode: "agent",
        has_workflow: false,
      },
    ]);
    mockSafeListen.mockImplementation(async (eventName, handler) => {
      if (String(eventName).startsWith("skill-exec-")) {
        streamHandler = handler as (event: { payload: unknown }) => void;
      }
      return () => {
        if (streamHandler === handler) {
          streamHandler = null;
        }
      };
    });

    mockExecuteSkill.mockImplementationOnce(async () => {
      streamHandler?.({
        payload: {
          type: "tool_start",
          tool_id: "skill-tool-1",
          tool_name: "browser_navigate",
          arguments: JSON.stringify({
            url: "https://example.com",
          }),
        },
      });
      streamHandler?.({
        payload: {
          type: "tool_end",
          tool_id: "skill-tool-1",
          result: {
            success: true,
            error: [
              "CDP 会话已断开，请重试",
              "",
              "[Lime 工具元数据开始]",
              JSON.stringify({
                reported_success: false,
                exit_code: 1,
              }),
              "[Lime 工具元数据结束]",
            ].join("\n"),
          },
        },
      });
      streamHandler?.({
        payload: {
          type: "final_done",
        },
      });

      return {
        success: true,
        output: "",
        error: undefined,
        steps_completed: [],
      };
    });

    const handled = await tryExecuteSlashSkillCommand({
      command: {
        skillName: "browser_task",
        userInput: "打开目标页面",
      },
      rawContent: "/browser_task 打开目标页面",
      assistantMsgId: "assistant-skill-1",
      providerType: "claude",
      model: "claude-sonnet-4-5",
      ensureSession: async () => "session-skill-1",
      setMessages,
      setIsSending: vi.fn(),
      setCurrentAssistantMsgId: vi.fn(),
      setStreamUnlisten: vi.fn(),
      setActiveSessionIdForStop: vi.fn(),
      isExecutionCancelled: () => false,
      playTypewriterSound: vi.fn(),
      playToolcallSound: vi.fn(),
      onWriteFile: vi.fn(),
    });

    expect(handled).toBe(true);

    const assistantMessage = messages.find(
      (message) => message.id === "assistant-skill-1",
    );
    const toolCall = assistantMessage?.toolCalls?.find(
      (item) => item.id === "skill-tool-1",
    );

    expect(toolCall?.status).toBe("failed");
    expect(toolCall?.result?.error).toBe("CDP 会话已断开，请重试");
    expect(toolCall?.result?.error).not.toContain("Lime 工具元数据");
    expect(toolCall?.result?.metadata).toMatchObject({
      reported_success: false,
      exit_code: 1,
    });
  });
});
