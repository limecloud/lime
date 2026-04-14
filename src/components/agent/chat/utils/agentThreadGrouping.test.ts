import { describe, expect, it } from "vitest";

import type { AgentThreadItem } from "../types";
import { buildAgentThreadDisplayModel } from "./agentThreadGrouping";

function at(second: number): string {
  return `2026-03-15T09:00:${String(second).padStart(2, "0")}Z`;
}

function createBaseItem(
  id: string,
  sequence: number,
): Pick<
  AgentThreadItem,
  | "id"
  | "thread_id"
  | "turn_id"
  | "sequence"
  | "status"
  | "started_at"
  | "completed_at"
  | "updated_at"
> {
  const timestamp = at(sequence);
  return {
    id,
    thread_id: "thread-1",
    turn_id: "turn-1",
    sequence,
    status: "completed",
    started_at: timestamp,
    completed_at: timestamp,
    updated_at: timestamp,
  };
}

describe("agentThreadGrouping", () => {
  it("应按真实时序把连续执行项收成一个过程块", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("browser-1", 1),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://example.com" },
      },
      {
        ...createBaseItem("browser-2", 2),
        type: "tool_call",
        tool_name: "browser_click",
        arguments: { selector: "#submit" },
      },
      {
        ...createBaseItem("search-1", 3),
        type: "web_search",
        action: "web_search",
        query: "Lime CDP 并行渲染",
      },
      {
        ...createBaseItem("browser-3", 4),
        type: "tool_call",
        tool_name: "browser_snapshot",
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.groups.map((group) => group.kind)).toEqual(["process"]);
    expect(model.groups[0]?.items).toHaveLength(4);
    expect(model.groups[0]?.previewLines).toContain(
      "打开了 https://example.com",
    );
    expect(model.groups[0]?.previewLines).toContain("点了 #submit");
    expect(model.groups[0]?.previewLines).toContain("搜了 Lime CDP 并行渲染");
    expect(model.summaryChips).toEqual([
      { kind: "process", label: "执行过程", count: 4 },
    ]);
  });

  it("应保留产物块，并把前后执行项收成过程块", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("plan-1", 1),
        type: "plan",
        text: "1. 打开页面\n2. 写入文件",
      },
      {
        ...createBaseItem("file-1", 2),
        type: "file_artifact",
        path: "articles/wechat-draft.md",
        source: "tool_result",
        content: "# 草稿",
      },
      {
        ...createBaseItem("cmd-1", 3),
        type: "command_execution",
        command: "npm test -- AgentThreadTimeline",
        cwd: "/workspace",
        aggregated_output: "ok",
      },
      {
        ...createBaseItem("summary-1", 4),
        type: "turn_summary",
        text: "已完成 CDP 页面检查\n后续可以继续发布。",
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.summaryText).toBe("已完成 CDP 页面检查");
    expect(model.groups.map((group) => group.kind)).toEqual([
      "process",
      "artifact",
      "process",
    ]);
    expect(model.groups[1]?.previewLines).toEqual(["生成了 wechat-draft.md"]);
    expect(model.groups[2]?.previewLines).toContain(
      "运行了 npm test -- AgentThreadTimeline",
    );
    expect(model.summaryChips).toEqual([
      { kind: "process", label: "执行过程", count: 3 },
      { kind: "artifact", label: "文件和产物", count: 1 },
    ]);
  });

  it("应通过 artifact protocol 识别嵌套参数中的文件路径", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("tool-file-1", 1),
        type: "tool_call",
        tool_name: "write_file",
        arguments: {
          payload: {
            filePath: "articles/nested-draft.md",
          },
        },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.groups.map((group) => group.kind)).toEqual(["process"]);
    expect(model.groups[0]?.previewLines).toEqual(["保存了 nested-draft.md"]);
  });

  it("应通过 filesystem event protocol 识别目录与输出文件位置线索", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("tool-dir-1", 1),
        type: "tool_call",
        tool_name: "list_directory",
        arguments: {
          directory: "workspace\\reports",
        },
      },
      {
        ...createBaseItem("tool-output-1", 2),
        type: "tool_call",
        tool_name: "bash",
        metadata: {
          output_file: "workspace\\logs\\run.log",
        },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.groups.map((group) => group.kind)).toEqual(["process"]);
    expect(model.groups[0]?.previewLines).toEqual([
      "查看了 reports",
      "处理了 run.log",
    ]);
  });

  it("思考与工具步骤应保持原始时序并收进同一个过程块", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("browser-1", 1),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://mp.weixin.qq.com" },
      },
      {
        ...createBaseItem("summary-1", 2),
        type: "turn_summary",
        text: "已打开公众号后台",
      },
      {
        ...createBaseItem("search-1", 3),
        type: "web_search",
        action: "web_search",
        query: "微信公众号 封面尺寸",
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.orderedBlocks.map((block) => block.kind)).toEqual(["process"]);
    expect(model.groups.map((group) => group.kind)).toEqual(["process"]);
    expect(model.orderedBlocks[0]?.previewLines).toEqual([
      "打开了 https://mp.weixin.qq.com",
      "已打开公众号后台",
      "搜了 微信公众号 封面尺寸",
    ]);
  });

  it("结构化问答摘要不应回退为原始 a2ui 代码块", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("summary-1", 1),
        type: "turn_summary",
        text: [
          "请先确认以下选项：",
          "",
          "```a2ui",
          '{"type":"form","title":"确认","fields":[]}',
          "```",
        ].join("\n"),
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.summaryText).toBe("请先确认以下选项：");
    expect(model.orderedBlocks[0]?.previewLines).toEqual([
      "请先确认以下选项：",
    ]);
  });

  it("ToolSearch 结果预览应优先展示过程结论，而不是退回通用动词模板", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("tool-search-1", 1),
        type: "tool_call",
        tool_name: "ToolSearch",
        arguments: {
          query: "select:Read,Write",
        },
        output: JSON.stringify({
          query: "select:Read,Write",
          count: 2,
          tools: [{ name: "Read" }, { name: "Write" }],
        }),
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.groups[0]?.previewLines).toEqual([
      "已确认可用工具 2 个 · 查看文件 · 保存文件",
    ]);
  });

  it("连续探索类工具应折叠成项目探索摘要", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("grep-1", 1),
        type: "tool_call",
        tool_name: "Grep",
        arguments: {
          pattern: "tool_use_summary",
          path: "/workspace/src",
        },
      },
      {
        ...createBaseItem("read-1", 2),
        type: "tool_call",
        tool_name: "Read",
        arguments: {
          file_path: "/workspace/src/query.ts",
        },
      },
      {
        ...createBaseItem("read-2", 3),
        type: "tool_call",
        tool_name: "Read",
        arguments: {
          file_path: "/workspace/src/components/messages/CollapsedReadSearchContent.tsx",
        },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.orderedBlocks).toHaveLength(1);
    expect(model.orderedBlocks[0]?.title).toBe("已探索项目");
    expect(model.orderedBlocks[0]?.previewLines).toEqual([
      "查看了 2 个文件，搜索 1 次",
      "最新线索：CollapsedReadSearchContent.tsx",
    ]);
    expect(model.orderedBlocks[0]?.countLabel).toBe("读 2 / 搜 1");
    expect(model.orderedBlocks[0]?.rawDetailLabel).toBe("展开查看探索明细");
  });

  it("交互与任务结果预览应使用更直白的用户文案", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("question-1", 1),
        type: "tool_call",
        tool_name: "AskUserQuestion",
        arguments: { question: "需要继续吗？" },
      },
      {
        ...createBaseItem("task-output-1", 2),
        type: "tool_call",
        tool_name: "TaskOutput",
        arguments: { task_id: "video-task-1" },
      },
      {
        ...createBaseItem("list-peers-1", 3),
        type: "tool_call",
        tool_name: "ListPeers",
        arguments: { team_name: "当前团队" },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.groups[0]?.previewLines).toEqual([
      "等你确认：需要继续吗？",
      "已查看结果 video-task-1",
      "已查看 当前团队",
    ]);
  });

  it("协作任务控制预览应直接表达查看、继续与暂停动作", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("wait-agent-1", 1),
        type: "tool_call",
        tool_name: "WaitAgent",
        arguments: { id: "agent-1" },
      },
      {
        ...createBaseItem("resume-agent-1", 2),
        type: "tool_call",
        tool_name: "ResumeAgent",
        arguments: { id: "agent-1" },
      },
      {
        ...createBaseItem("close-agent-1", 3),
        type: "tool_call",
        tool_name: "CloseAgent",
        arguments: { id: "agent-1" },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.groups[0]?.previewLines).toEqual([
      "已查看 agent-1",
      "已继续 agent-1",
      "已暂停 agent-1",
    ]);
  });

  it("内部路由型 turn_summary 不应抢占整轮摘要", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("summary-1", 1),
        type: "turn_summary",
        text: "直接回答优先\n当前请求无需默认升级为搜索或任务。",
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.summaryText).toBeNull();
    expect(model.orderedBlocks[0]?.previewLines).toEqual([]);
  });
});
