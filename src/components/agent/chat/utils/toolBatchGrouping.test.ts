import { describe, expect, it } from "vitest";

import type { AgentToolCallState } from "@/lib/api/agentProtocol";

import { summarizeStreamingToolBatch } from "./toolBatchGrouping";

function createToolCall(
  name: string,
  argumentsValue?: Record<string, unknown>,
): AgentToolCallState {
  return {
    id: `${name}-1`,
    name,
    status: "completed",
    arguments: argumentsValue ? JSON.stringify(argumentsValue) : undefined,
    startTime: new Date("2026-04-14T00:00:00.000Z"),
    endTime: new Date("2026-04-14T00:00:01.000Z"),
    result: {
      success: true,
      output: "ok",
    },
  };
}

describe("toolBatchGrouping", () => {
  it("应把 MCP 搜索与读取归入探索批次", () => {
    const summary = summarizeStreamingToolBatch([
      createToolCall("mcp__github__search_code", {
        query: "repo:lime tool runtime",
      }),
      createToolCall("mcp__github__get_file_contents", {
        path: "docs/guide.md",
      }),
    ]);

    expect(summary).toEqual(
      expect.objectContaining({
        kind: "exploration",
        title: "已探索项目",
        countLabel: "读 1 / 搜 1",
        rawDetailLabel: "展开查看探索明细",
      }),
    );
    expect(summary?.supportingLines).toContain("查看了 1 个文件，搜索 1 次");
    expect(summary?.supportingLines).toContain("最新线索：guide.md");
  });

  it("应让 REPL 调用被吸收到探索批次而不打断摘要", () => {
    const summary = summarizeStreamingToolBatch([
      createToolCall("Read", {
        file_path: "src/main.ts",
      }),
      createToolCall("REPLTool", {
        code: 'rg "tool inventory" src',
      }),
      createToolCall("Grep", {
        pattern: "tool inventory",
        path: "src",
      }),
    ]);

    expect(summary).toEqual(
      expect.objectContaining({
        kind: "exploration",
        countLabel: "读 1 / 搜 1",
      }),
    );
  });

  it("应继续把浏览器 MCP 步骤聚合为页面检查摘要", () => {
    const summary = summarizeStreamingToolBatch([
      createToolCall("mcp__lime-browser__navigate", {
        url: "https://example.com",
      }),
      createToolCall("mcp__lime-browser__click", {
        selector: "#cta",
      }),
    ]);

    expect(summary).toEqual(
      expect.objectContaining({
        kind: "browser",
        title: "已检查页面",
        countLabel: "2 步",
      }),
    );
    expect(summary?.supportingLines).toContain("检查了 2 个页面步骤");
    expect(summary?.supportingLines).toContain("最近目标：#cta");
  });
});
