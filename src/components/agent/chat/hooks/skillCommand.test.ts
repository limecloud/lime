import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { Message } from "../types";

const {
  mockSafeListen,
  mockParseStreamEvent,
  mockListExecutableSkills,
  mockExecuteSkill,
} = vi.hoisted(() => ({
  mockSafeListen: vi.fn(),
  mockParseStreamEvent: vi.fn((payload: unknown) => payload),
  mockListExecutableSkills: vi.fn(),
  mockExecuteSkill: vi.fn(),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: mockSafeListen,
}));

vi.mock("@/lib/api/agentStream", () => ({
  parseStreamEvent: mockParseStreamEvent,
}));

vi.mock("@/lib/api/skill-execution", () => ({
  skillExecutionApi: {
    listExecutableSkills: mockListExecutableSkills,
    executeSkill: mockExecuteSkill,
  },
}));

import { tryExecuteSlashSkillCommand } from "./skillCommand";

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
  mockParseStreamEvent.mockImplementation((payload: unknown) => payload);
  mockListExecutableSkills.mockResolvedValue([
    {
      name: "social_post_with_cover",
      display_name: "social_post_with_cover",
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
        "social-posts/demo.md",
        "# 标题\n\n主稿正文",
      );
      emitWriteToolStart(
        "tool-cover",
        "social-posts/demo.cover.json",
        '{"cover_url":"https://example.com/cover.png","status":"成功"}',
      );
      emitWriteToolStart(
        "tool-pack",
        "social-posts/demo.publish-pack.json",
        '{"article_path":"social-posts/demo.md","cover_meta_path":"social-posts/demo.cover.json"}',
      );
      streamHandler?.({ payload: { type: "final_done" } });

      return {
        success: true,
        output:
          '<write_file path="social-posts/demo.md">\n# 标题\n\n主稿正文\n</write_file>',
        steps_completed: [],
      };
    });

    const handled = await tryExecuteSlashSkillCommand({
      command: {
        skillName: "social_post_with_cover",
        userInput: "输出社媒文案",
      },
      rawContent: "/social_post_with_cover 输出社媒文案",
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
    expect(writtenPaths).toContain("social-posts/demo.md");
    expect(writtenPaths).toContain("social-posts/demo.cover.json");
    expect(writtenPaths).toContain("social-posts/demo.publish-pack.json");
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

    const writeFileOutput = `<write_file path="social-posts/final.md">\n# 最终稿\n\n正文\n</write_file>`;
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
        skillName: "social_post_with_cover",
        userInput: "写一篇春季上新文案",
      },
      rawContent: "/social_post_with_cover 写一篇春季上新文案",
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
            filePath: "social-posts/live.md",
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
          '<write_file path="social-posts/live.md">\n# 实时稿\n</write_file>',
        steps_completed: [],
      };
    });

    const handled = await tryExecuteSlashSkillCommand({
      command: {
        skillName: "social_post_with_cover",
        userInput: "实时写作",
      },
      rawContent: "/social_post_with_cover 实时写作",
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
      "social-posts/live.md",
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
        skillName: "social_post_with_cover",
        userInput: "新品发布",
      },
      rawContent: "/social_post_with_cover 新品发布",
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
      /^social-posts\/\d{8}-\d{6}-[a-z0-9-]+-[a-z0-9]{3,6}\.md$/,
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
});

describe("tryExecuteSlashSkillCommand 浏览器工具链路", () => {
  it("收到 tool_end error 时应清洗 ProxyCast 元数据块", async () => {
    let messages: Message[] = [buildBaseMessage("assistant-skill-1")];

    const setMessages = (next: Message[] | ((prev: Message[]) => Message[])) => {
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
              "[ProxyCast 工具元数据开始]",
              JSON.stringify({
                reported_success: false,
                exit_code: 1,
              }),
              "[ProxyCast 工具元数据结束]",
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
    expect(toolCall?.result?.error).not.toContain("ProxyCast 工具元数据");
    expect(toolCall?.result?.metadata).toMatchObject({
      reported_success: false,
      exit_code: 1,
    });
  });
});
