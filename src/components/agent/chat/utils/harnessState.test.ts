import { describe, expect, it } from "vitest";
import type { AgentThreadItem, Message } from "../types";
import { deriveHarnessSessionState } from "./harnessState";

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "message-1",
    role: "assistant",
    content: "hello",
    timestamp: new Date("2026-03-13T12:00:00.000Z"),
    ...overrides,
  };
}

describe("deriveHarnessSessionState", () => {
  it("应优先从 thread items 提取计划、审批与文件活动", () => {
    const messages = [
      createMessage({
        runtimeStatus: {
          phase: "preparing",
          title: "正在准备处理",
          detail: "正在理解请求并准备当前阶段。",
          checkpoints: ["对话优先执行"],
        },
        contextTrace: [{ stage: "memory", detail: "已注入上下文" }],
      }),
    ];
    const items: AgentThreadItem[] = [
      {
        id: "plan-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 1,
        status: "in_progress",
        started_at: "2026-03-13T12:00:00.000Z",
        updated_at: "2026-03-13T12:00:01.000Z",
        type: "plan",
        text: "1. 收集资料\n2. 输出方案",
      },
      {
        id: "approval-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 2,
        status: "in_progress",
        started_at: "2026-03-13T12:00:02.000Z",
        updated_at: "2026-03-13T12:00:02.000Z",
        type: "approval_request",
        request_id: "approval-1",
        action_type: "tool_confirmation",
        prompt: "确认写入文件",
        tool_name: "write_file",
      },
      {
        id: "artifact-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 3,
        status: "completed",
        started_at: "2026-03-13T12:00:03.000Z",
        completed_at: "2026-03-13T12:00:04.000Z",
        updated_at: "2026-03-13T12:00:04.000Z",
        type: "file_artifact",
        path: "workspace/plan.md",
        source: "tool_result",
        content: "# 计划\n正文",
      },
    ];

    const state = deriveHarnessSessionState(messages, [], items);

    expect(state.plan.phase).toBe("planning");
    expect(state.runtimeStatus?.title).toBe("正在准备处理");
    expect(state.plan.items).toHaveLength(2);
    expect(state.pendingApprovals).toHaveLength(1);
    expect(state.pendingApprovals[0]?.requestId).toBe("approval-1");
    expect(state.recentFileEvents[0]?.path).toBe("workspace/plan.md");
    expect(state.outputSignals[0]?.artifactPath).toBe("workspace/plan.md");
    expect(state.latestContextTrace).toHaveLength(1);
  });

  it("应从消息 artifacts 提取当前文件写入状态", () => {
    const messages = [
      createMessage({
        artifacts: [
          {
            id: "artifact-live-1",
            type: "document",
            title: "live.md",
            content: "# 实时草稿\n\n正在写入第二段",
            status: "streaming",
            meta: {
              filePath: "workspace/live.md",
              writePhase: "streaming",
              previewText: "# 实时草稿\n\n正在写入第二段",
              latestChunk: "正在写入第二段",
              lastUpdateSource: "artifact_snapshot",
            },
            position: { start: 0, end: 12 },
            createdAt: Date.now() - 1000,
            updatedAt: Date.now(),
          },
        ],
      }),
    ];

    const state = deriveHarnessSessionState(messages, []);

    expect(state.activeFileWrites).toHaveLength(1);
    expect(state.activeFileWrites[0]).toMatchObject({
      path: "workspace/live.md",
      displayName: "live.md",
      phase: "streaming",
      source: "artifact_snapshot",
    });
    expect(state.activeFileWrites[0]?.preview).toContain("实时草稿");
  });

  it("应为搜索工具调用生成可消费的搜索输出信号", () => {
    const messages = [
      createMessage({
        toolCalls: [
          {
            id: "tool-search-1",
            name: "WebSearch",
            arguments: JSON.stringify({ query: "3月13日国际新闻" }),
            status: "completed",
            result: {
              success: true,
              output: [
                "Xinhua world news summary at 0030 GMT, March 13",
                "https://example.com/xinhua",
                "全球要闻摘要，覆盖国际局势与市场动态。",
              ].join("\n"),
            },
            startTime: new Date("2026-03-13T12:00:00.000Z"),
            endTime: new Date("2026-03-13T12:00:03.000Z"),
          },
        ],
      }),
    ];

    const state = deriveHarnessSessionState(messages, []);

    expect(state.outputSignals).toHaveLength(1);
    expect(state.outputSignals[0]).toMatchObject({
      title: "联网检索摘要",
      summary: "3月13日国际新闻",
    });
    expect(state.outputSignals[0]?.preview).toContain(
      "Xinhua world news summary",
    );
    expect(state.outputSignals[0]?.content).toContain(
      "https://example.com/xinhua",
    );
  });

  it("应通过 artifact protocol 提取工具输出中的嵌套产物路径", () => {
    const messages = [
      createMessage({
        toolCalls: [
          {
            id: "tool-artifact-1",
            name: "write_file",
            arguments: JSON.stringify({
              payload: {
                filePath: "workspace/draft.md",
              },
            }),
            status: "completed",
            result: {
              success: true,
              metadata: {
                payload: {
                  artifactPath: "workspace\\cover.png",
                },
              },
              output: JSON.stringify({
                result: {
                  absolute_path: "/tmp/workspace/final.md",
                },
              }),
            },
            startTime: new Date("2026-03-13T12:00:00.000Z"),
            endTime: new Date("2026-03-13T12:00:03.000Z"),
          },
        ],
      }),
    ];

    const state = deriveHarnessSessionState(messages, []);

    expect(state.outputSignals[0]).toMatchObject({
      title: "产物已写入",
      artifactPath: "workspace/cover.png",
    });
    expect(state.recentFileEvents[0]).toMatchObject({
      path: "workspace/draft.md",
      action: "write",
    });
  });

  it("内部路由型 turn_summary 不应伪装成已就绪计划", () => {
    const messages = [createMessage()];
    const items: AgentThreadItem[] = [
      {
        id: "summary-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 1,
        status: "completed",
        started_at: "2026-03-13T12:00:00.000Z",
        completed_at: "2026-03-13T12:00:01.000Z",
        updated_at: "2026-03-13T12:00:01.000Z",
        type: "turn_summary",
        text: "直接回答优先\n当前请求无需工具介入。",
      },
    ];

    const state = deriveHarnessSessionState(messages, [], items);

    expect(state.plan.phase).toBe("idle");
    expect(state.plan.items).toHaveLength(0);
    expect(state.plan.summaryText).toBeUndefined();
    expect(state.outputSignals[0]?.toolName).toBe("turn_summary");
  });

  it("有真实进展的 turn_summary 仍应作为计划摘要兜底", () => {
    const messages = [createMessage()];
    const items: AgentThreadItem[] = [
      {
        id: "summary-2",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 1,
        status: "completed",
        started_at: "2026-03-13T12:00:00.000Z",
        completed_at: "2026-03-13T12:00:01.000Z",
        updated_at: "2026-03-13T12:00:01.000Z",
        type: "turn_summary",
        text: "已打开公众号后台\n后续可以继续执行发布。",
      },
    ];

    const state = deriveHarnessSessionState(messages, [], items);

    expect(state.plan.phase).toBe("ready");
    expect(state.plan.items).toHaveLength(0);
    expect(state.plan.summaryText).toContain("已打开公众号后台");
  });

  it("应保留最近 8 条输出信号以承载多组 WebSearch 扩搜", () => {
    const toolCalls = Array.from({ length: 9 }, (_, index) => ({
      id: `tool-search-${index + 1}`,
      name: "WebSearch",
      arguments: JSON.stringify({ query: `query-${index + 1}` }),
      status: "completed" as const,
      result: {
        success: true,
        output: `结果 ${index + 1}\nhttps://example.com/${index + 1}`,
      },
      startTime: new Date(`2026-03-13T12:00:0${Math.min(index, 8)}.000Z`),
      endTime: new Date(`2026-03-13T12:00:1${Math.min(index, 8)}.000Z`),
    }));
    const messages = [createMessage({ toolCalls })];

    const state = deriveHarnessSessionState(messages, []);

    expect(state.outputSignals).toHaveLength(8);
    expect(state.outputSignals[0]?.summary).toBe("query-9");
    expect(state.outputSignals[7]?.summary).toBe("query-2");
  });

  it("没有历史任务板轨迹时应回退到持久化任务快照", () => {
    const messages = [createMessage({ content: "已恢复会话" })];

    const state = deriveHarnessSessionState(messages, [], undefined, [
      {
        content: "整理运行时边界",
        status: "in_progress",
      },
      {
        content: "补治理验证",
        status: "pending",
      },
    ]);

    expect(state.plan.phase).toBe("planning");
    expect(state.plan.items).toEqual([
      {
        id: "todo-1",
        content: "整理运行时边界",
        status: "in_progress",
      },
      {
        id: "todo-2",
        content: "补治理验证",
        status: "pending",
      },
    ]);
    expect(state.plan.summaryText).toBeUndefined();
  });
});
