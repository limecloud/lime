import { beforeEach, describe, expect, it } from "vitest";

import { changeLimeLocale } from "@/i18n/createI18n";
import type { AgentToolCallState } from "@/lib/api/agentProtocol";

import { resolveToolProcessNarrative } from "./toolProcessSummary";

function createToolCall(
  overrides: Partial<AgentToolCallState>,
): AgentToolCallState {
  return {
    id: "tool-1",
    name: "web_search",
    status: "running",
    startTime: new Date("2026-04-14T00:00:00.000Z"),
    ...overrides,
  };
}

describe("toolProcessSummary facts", () => {
  beforeEach(async () => {
    await changeLimeLocale("zh-CN");
  });



  it("应优先使用工具 metadata 中的结构化过程摘要 descriptor", async () => {
    await changeLimeLocale("en-US");
    const narrative = resolveToolProcessNarrative(
      createToolCall({
        name: "RuntimeProvidedTool",
        status: "completed",
        metadata: {
          tool_process_summary: {
            source: "runtime_facts",
            pre: {
              key: "toolCall.processSummary.webSearch.searchFirstWithQuery",
              values: { query: "runtime facts" },
            },
            completed: {
              key: "toolCall.processSummary.webSearch.sourcesFound",
              values: { count: 3 },
            },
          },
        },
      }),
    );

    expect(narrative.preSummary).toBe("Searching runtime facts first");
    expect(narrative.postSummary).toBe("3 reference sources found");
    expect(narrative.summary).toBe("3 reference sources found");
    expect(narrative.postSource).toBe("metadata");
  });

  it("不应把 raw process_summary 字符串当作可渲染 UI 文案", () => {
    const narrative = resolveToolProcessNarrative(
      createToolCall({
        name: "ConfigTool",
        status: "completed",
        metadata: {
          process_summary: "固定中文终稿",
        },
      }),
    );

    expect(narrative.postSummary).toBeNull();
    expect(narrative.summary).toBeNull();
  });

  it("应优先使用 tool_process_facts.subject 作为过程摘要主体", () => {
    const narrative = resolveToolProcessNarrative(
      createToolCall({
        metadata: {
          tool_process_facts: {
            source: "runtime_facts",
            toolName: "web_search",
            subject: "Lime Soul facts",
          },
        },
      }),
    );

    expect(narrative.preSummary).toBe("先搜索 Lime Soul facts");
    expect(narrative.summary).toBe("先搜索 Lime Soul facts");
  });

  it("应优先使用 tool_process_facts.toolFamily 决定泛化过程摘要", () => {
    const narrative = resolveToolProcessNarrative(
      createToolCall({
        name: "RuntimeProvidedTool",
        status: "completed",
        metadata: {
          tool_process_facts: {
            source: "runtime_facts",
            toolName: "RuntimeProvidedTool",
            toolFamily: "read",
            operationKind: "read",
            subject: "README.md",
          },
        },
        result: {
          success: true,
          output: "ok",
        },
      }),
    );

    expect(narrative.preSummary).toBe("先查看 README.md");
    expect(narrative.postSummary).toBe("已查看 README.md");
    expect(narrative.summary).toBe("已查看 README.md");
  });
});
