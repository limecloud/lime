import { describe, expect, it } from "vitest";
import type { ActionRequired, Message } from "../types";
import { deriveHarnessSessionState } from "./harnessState";

const BASE_TIME = new Date("2026-03-11T12:00:00.000Z");

function asLegacyDate(value: string): Date {
  return value as unknown as Date;
}

function createAssistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    timestamp: BASE_TIME,
    ...overrides,
  };
}

describe("deriveHarnessSessionState", () => {
  it("应从 TodoWrite 参数提取结构化 Todo", () => {
    const state = deriveHarnessSessionState(
      [
        createAssistantMessage({
          toolCalls: [
            {
              id: "todo-1",
              name: "TodoWrite",
              arguments: JSON.stringify({
                todos: [
                  { id: "a", content: "梳理主链", status: "in_progress" },
                  { id: "b", content: "实现面板", status: "pending" },
                ],
              }),
              status: "completed",
              startTime: BASE_TIME,
              endTime: new Date(BASE_TIME.getTime() + 1000),
            },
          ],
        }),
      ],
      [],
    );

    expect(state.plan.phase).toBe("planning");
    expect(state.plan.items).toEqual([
      { id: "a", content: "梳理主链", status: "in_progress" },
      { id: "b", content: "实现面板", status: "pending" },
    ]);
    expect(state.activity.planning).toBe(1);
  });

  it("应在 ExitPlanMode 完成后标记规划完成", () => {
    const state = deriveHarnessSessionState(
      [
        createAssistantMessage({
          toolCalls: [
            {
              id: "todo-1",
              name: "TodoWrite",
              arguments: JSON.stringify({
                todos: [{ id: "a", content: "完成实现", status: "completed" }],
              }),
              status: "completed",
              startTime: BASE_TIME,
              endTime: new Date(BASE_TIME.getTime() + 1000),
            },
            {
              id: "plan-exit",
              name: "ExitPlanMode",
              status: "completed",
              startTime: new Date(BASE_TIME.getTime() + 2000),
              endTime: new Date(BASE_TIME.getTime() + 3000),
            },
          ],
        }),
      ],
      [],
    );

    expect(state.plan.phase).toBe("ready");
    expect(state.plan.items).toHaveLength(1);
  });

  it("应提取待审批数和最新 context trace", () => {
    const pendingApprovals: ActionRequired[] = [
      {
        requestId: "req-1",
        actionType: "tool_confirmation",
        prompt: "是否允许写文件？",
      },
    ];

    const state = deriveHarnessSessionState(
      [
        createAssistantMessage({
          id: "assistant-2",
          contextTrace: [
            { stage: "workspace", detail: "加载 AGENTS.md" },
            { stage: "memory", detail: "注入项目记忆" },
          ],
        }),
      ],
      pendingApprovals,
    );

    expect(state.pendingApprovals).toHaveLength(1);
    expect(state.latestContextTrace).toHaveLength(2);
    expect(state.latestContextTrace[0]?.stage).toBe("workspace");
  });

  it("应兼容未提供待审批数组的旧调用方", () => {
    const state = deriveHarnessSessionState(
      [
        createAssistantMessage({
          contextTrace: [{ stage: "workspace", detail: "恢复旧会话" }],
        }),
      ],
      undefined as unknown as ActionRequired[],
    );

    expect(state.pendingApprovals).toEqual([]);
    expect(state.latestContextTrace).toHaveLength(1);
    expect(state.hasSignals).toBe(true);
  });

  it("应识别 SubAgentTask 和关键工具活动", () => {
    const state = deriveHarnessSessionState(
      [
        createAssistantMessage({
          toolCalls: [
            {
              id: "read-1",
              name: "Read",
              status: "completed",
              startTime: BASE_TIME,
              endTime: new Date(BASE_TIME.getTime() + 1000),
            },
            {
              id: "sub-1",
              name: "SubAgentTask",
              arguments: JSON.stringify({
                description: "调研 legacy chat",
                role: "explorer",
                taskType: "explore",
              }),
              status: "running",
              result: {
                success: true,
                output: "正在执行",
              },
              startTime: new Date(BASE_TIME.getTime() + 2000),
            },
            {
              id: "web-1",
              name: "WebSearch",
              status: "completed",
              startTime: new Date(BASE_TIME.getTime() + 3000),
              endTime: new Date(BASE_TIME.getTime() + 4000),
            },
          ],
        }),
      ],
      [],
    );

    expect(state.activity.filesystem).toBe(1);
    expect(state.activity.delegation).toBe(1);
    expect(state.activity.web).toBe(1);
    expect(state.delegatedTasks).toHaveLength(1);
    expect(state.delegatedTasks[0]?.title).toBe("调研 legacy chat");
    expect(state.delegatedTasks[0]?.role).toBe("explorer");
  });

  it("应兼容历史缓存中的字符串时间戳", () => {
    const state = deriveHarnessSessionState(
      [
        createAssistantMessage({
          toolCalls: [
            {
              id: "plan-enter",
              name: "EnterPlanMode",
              status: "completed",
              startTime: asLegacyDate("2026-03-11T12:00:00.000Z"),
              endTime: asLegacyDate("2026-03-11T12:00:01.000Z"),
            },
            {
              id: "todo-legacy",
              name: "TodoWrite",
              arguments: JSON.stringify({
                todos: [
                  { id: "legacy-1", content: "修复短视频崩溃", status: "done" },
                ],
              }),
              status: "completed",
              startTime: asLegacyDate("2026-03-11T12:00:02.000Z"),
              endTime: asLegacyDate("2026-03-11T12:00:03.000Z"),
            },
            {
              id: "sub-legacy",
              name: "SubAgentTask",
              arguments: JSON.stringify({
                description: "检查历史会话",
                role: "diagnose",
              }),
              status: "completed",
              startTime: asLegacyDate("2026-03-11T12:00:04.000Z"),
              endTime: asLegacyDate("2026-03-11T12:00:05.000Z"),
              result: {
                success: true,
                output: "已完成",
              },
            },
          ],
        }),
      ],
      [],
    );

    expect(state.plan.phase).toBe("planning");
    expect(state.plan.items).toEqual([
      { id: "legacy-1", content: "修复短视频崩溃", status: "completed" },
    ]);
    expect(state.delegatedTasks[0]?.startedAt).toBeInstanceOf(Date);
    expect(state.activity.planning).toBe(2);
    expect(state.activity.delegation).toBe(1);
  });

  it("应识别归一化后的 Harness 工具别名", () => {
    const state = deriveHarnessSessionState(
      [
        createAssistantMessage({
          toolCalls: [
            {
              id: "todo-2",
              name: "Write_Todos",
              arguments: JSON.stringify({
                items: [{ content: "补充事件隔离", status: "running" }],
              }),
              status: "completed",
              startTime: BASE_TIME,
              endTime: new Date(BASE_TIME.getTime() + 1000),
            },
            {
              id: "fs-2",
              name: "list_directory",
              status: "completed",
              startTime: new Date(BASE_TIME.getTime() + 2000),
              endTime: new Date(BASE_TIME.getTime() + 3000),
            },
            {
              id: "skill-2",
              name: "three_stage_workflow",
              status: "completed",
              startTime: new Date(BASE_TIME.getTime() + 4000),
              endTime: new Date(BASE_TIME.getTime() + 5000),
            },
          ],
        }),
      ],
      [],
    );

    expect(state.plan.items).toEqual([
      { id: "todo-1", content: "补充事件隔离", status: "in_progress" },
    ]);
    expect(state.activity.planning).toBe(1);
    expect(state.activity.filesystem).toBe(1);
    expect(state.activity.skills).toBe(1);
  });

  it("应提取任务输出文件与命令执行摘要信号", () => {
    const state = deriveHarnessSessionState(
      [
        createAssistantMessage({
          toolCalls: [
            {
              id: "task-output-1",
              name: "TaskOutput",
              status: "completed",
              startTime: BASE_TIME,
              endTime: new Date(BASE_TIME.getTime() + 1000),
              result: {
                success: true,
                output: [
                  "=== 任务 task-1 ===",
                  "状态: completed",
                  "输出文件: /tmp/aster_tasks/task-1.log",
                ].join("\n"),
              },
            },
            {
              id: "bash-1",
              name: "Bash",
              status: "completed",
              startTime: new Date(BASE_TIME.getTime() + 2000),
              endTime: new Date(BASE_TIME.getTime() + 3000),
              result: {
                success: true,
                output: [
                  "done",
                  "[ProxyCast 执行摘要]",
                  "exit_code: 1",
                  "stdout_length: 120",
                  "stderr_length: 32",
                  "sandboxed: true",
                  "output_truncated: true",
                ].join("\n"),
              },
            },
          ],
        }),
      ],
      [],
    );

    const taskSignal = state.outputSignals.find(
      (signal) => signal.toolName === "TaskOutput",
    );
    const bashSignal = state.outputSignals.find(
      (signal) => signal.toolName === "Bash",
    );

    expect(taskSignal?.outputFile).toBe("/tmp/aster_tasks/task-1.log");
    expect(taskSignal?.title).toBe("任务输出已落盘");
    expect(bashSignal?.exitCode).toBe(1);
    expect(bashSignal?.stdoutLength).toBe(120);
    expect(bashSignal?.stderrLength).toBe(32);
    expect(bashSignal?.sandboxed).toBe(true);
    expect(bashSignal?.truncated).toBe(true);
  });

  it("应识别工具输出 offload 转存信号", () => {
    const state = deriveHarnessSessionState(
      [
        createAssistantMessage({
          toolCalls: [
            {
              id: "tool-offload-1",
              name: "Write",
              status: "completed",
              startTime: BASE_TIME,
              endTime: new Date(BASE_TIME.getTime() + 1000),
              result: {
                success: true,
                output:
                  "preview line 1\n\n[ProxyCast Offload] 完整输出已转存到文件：/tmp/proxycast/harness/tool-io/results/tool-offload-1.json",
                metadata: {
                  proxycast_offloaded: true,
                  offload_file:
                    "/tmp/proxycast/harness/tool-io/results/tool-offload-1.json",
                  offload_original_chars: 18234,
                  offload_original_tokens: 4521,
                  offload_trigger: "history_context_pressure",
                },
              },
            },
          ],
        }),
      ],
      [],
    );

    const signal = state.outputSignals.find(
      (item) => item.toolCallId === "tool-offload-1",
    );

    expect(signal?.title).toBe("工具输出已转存");
    expect(signal?.offloadFile).toBe(
      "/tmp/proxycast/harness/tool-io/results/tool-offload-1.json",
    );
    expect(signal?.offloaded).toBe(true);
    expect(signal?.offloadOriginalChars).toBe(18234);
    expect(signal?.offloadOriginalTokens).toBe(4521);
    expect(signal?.offloadTrigger).toBe("history_context_pressure");
    expect(signal?.summary).toContain("完整输出已转存");
    expect(signal?.summary).toContain("约 4521 tokens");
    expect(signal?.summary).toContain("上下文压力触发");
  });

  it("应提取最近文件活动并保留文本预览", () => {
    const state = deriveHarnessSessionState(
      [
        createAssistantMessage({
          toolCalls: [
            {
              id: "write-1",
              name: "Write",
              arguments: JSON.stringify({
                path: "/tmp/workspace/plan.md",
                content: "# 规划\n- 第一步",
              }),
              status: "completed",
              startTime: BASE_TIME,
              endTime: new Date(BASE_TIME.getTime() + 1000),
              result: {
                success: true,
                output: "已写入 /tmp/workspace/plan.md",
              },
            },
            {
              id: "read-1",
              name: "Read",
              arguments: JSON.stringify({
                path: "/tmp/workspace/plan.md",
              }),
              status: "completed",
              startTime: new Date(BASE_TIME.getTime() + 2000),
              endTime: new Date(BASE_TIME.getTime() + 3000),
              result: {
                success: true,
                output: "# 规划\n- 第一步\n- 第二步",
              },
            },
          ],
        }),
      ],
      [],
    );

    expect(state.recentFileEvents).toHaveLength(2);
    expect(state.recentFileEvents[0]).toMatchObject({
      action: "read",
      path: "/tmp/workspace/plan.md",
      displayName: "plan.md",
      kind: "document",
    });
    expect(state.recentFileEvents[0]?.preview).toContain("# 规划");
    expect(state.recentFileEvents[0]?.content).toContain("- 第二步");
    expect(state.recentFileEvents[1]).toMatchObject({
      action: "write",
      path: "/tmp/workspace/plan.md",
    });
    expect(state.recentFileEvents[1]?.content).toContain("# 规划");
  });

  it("应从输出信号提取可点击文件事件", () => {
    const state = deriveHarnessSessionState(
      [
        createAssistantMessage({
          toolCalls: [
            {
              id: "bash-offload-1",
              name: "Bash",
              status: "completed",
              startTime: BASE_TIME,
              endTime: new Date(BASE_TIME.getTime() + 1000),
              result: {
                success: true,
                output: [
                  "stdout preview line",
                  "输出文件: /tmp/proxycast/tasks/run-1.log",
                  "[ProxyCast Offload] 完整输出已转存到文件：/tmp/proxycast/harness/results/run-1.json",
                ].join("\n"),
                metadata: {
                  proxycast_offloaded: true,
                  output_file: "/tmp/proxycast/tasks/run-1.log",
                  offload_file: "/tmp/proxycast/harness/results/run-1.json",
                },
              },
            },
          ],
        }),
      ],
      [],
    );

    expect(state.recentFileEvents).toHaveLength(2);
    const offloadEvent = state.recentFileEvents.find(
      (event) => event.action === "offload",
    );
    const outputEvent = state.recentFileEvents.find(
      (event) => event.path === "/tmp/proxycast/tasks/run-1.log",
    );

    expect(offloadEvent).toMatchObject({
      action: "offload",
      path: "/tmp/proxycast/harness/results/run-1.json",
      kind: "offload",
      clickable: true,
    });
    expect(offloadEvent?.preview).toContain("stdout preview line");
    expect(outputEvent).toMatchObject({
      action: "persist",
      path: "/tmp/proxycast/tasks/run-1.log",
      kind: "log",
    });
  });

  it("最近文件活动应只保留最新 5 条", () => {
    const toolCalls = Array.from({ length: 6 }, (_, index) => ({
      id: `read-${index + 1}`,
      name: "Read",
      arguments: JSON.stringify({
        path: `/tmp/workspace/file-${index + 1}.txt`,
      }),
      status: "completed" as const,
      startTime: new Date(BASE_TIME.getTime() + index * 1000),
      endTime: new Date(BASE_TIME.getTime() + index * 1000 + 500),
      result: {
        success: true,
        output: `file-${index + 1}`,
      },
    }));

    const state = deriveHarnessSessionState(
      [
        createAssistantMessage({
          toolCalls,
        }),
      ],
      [],
    );

    expect(state.recentFileEvents).toHaveLength(5);
    expect(state.recentFileEvents.map((item) => item.displayName)).toEqual([
      "file-6.txt",
      "file-5.txt",
      "file-4.txt",
      "file-3.txt",
      "file-2.txt",
    ]);
  });
});
