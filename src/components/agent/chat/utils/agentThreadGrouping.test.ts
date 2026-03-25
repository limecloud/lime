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
  it("应按连续语义合并浏览器项并聚合摘要 chip", () => {
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

    expect(model.groups.map((group) => group.kind)).toEqual([
      "browser",
      "search",
      "browser",
    ]);
    expect(model.groups[0]?.items).toHaveLength(2);
    expect(model.groups[0]?.previewLines).toContain("打开 https://example.com");
    expect(model.groups[1]?.previewLines).toContain("Lime CDP 并行渲染");
    expect(model.summaryChips).toEqual([
      { kind: "browser", label: "浏览器操作", count: 3 },
      { kind: "search", label: "联网检索", count: 1 },
    ]);
  });

  it("应识别文件与命令分组，并从最新 thinking 项提取 summaryText", () => {
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
    expect(model.groups.map((group) => group.kind)).toEqual(["file", "command"]);
    expect(model.groups[0]?.previewLines).toEqual(["wechat-draft.md"]);
    expect(model.groups[1]?.previewLines).toEqual([
      "npm test -- AgentThreadTimeline",
    ]);
    expect(model.summaryChips).toEqual([
      { kind: "file", label: "文件与产物", count: 1 },
      { kind: "command", label: "命令执行", count: 1 },
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

    expect(model.groups.map((group) => group.kind)).toEqual(["file"]);
    expect(model.groups[0]?.previewLines).toEqual(["nested-draft.md"]);
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

    expect(model.groups.map((group) => group.kind)).toEqual(["file"]);
    expect(model.groups[0]?.previewLines).toEqual(["reports", "run.log"]);
  });

  it("思考块应保留在真实时序中，而不是整体前置", () => {
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

    expect(model.orderedBlocks.map((block) => block.kind)).toEqual([
      "browser",
      "thinking",
      "search",
    ]);
    expect(model.groups.map((group) => group.kind)).toEqual(["browser", "search"]);
    expect(model.orderedBlocks[1]?.previewLines).toEqual(["已打开公众号后台"]);
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
    expect(model.orderedBlocks[0]?.previewLines).toEqual(["请先确认以下选项："]);
  });
});
