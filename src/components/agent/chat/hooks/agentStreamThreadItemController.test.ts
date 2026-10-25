import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import { changeLimeLocale } from "@/i18n/createI18n";

import { resolveAgentThreadToolProcessNarrative } from "../utils/toolProcessSummary";
import { upsertThreadItemState } from "./agentThreadState";
import { buildAgentStreamTurnStartedPendingItemUpdate } from "./agentStreamThreadItemController";
import { projectAgentStreamTimelineItem } from "./agentStreamTimelineItemProjector";

function threadItem(overrides: Partial<AgentThreadItem> = {}): AgentThreadItem {
  return {
    id: "item-a",
    thread_id: "thread-old",
    turn_id: "turn-old",
    sequence: 1,
    status: "in_progress",
    started_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:00:01.000Z",
    type: "reasoning",
    text: "thinking",
    ...overrides,
  } as AgentThreadItem;
}

const turn: AgentThreadTurn = {
  id: "turn-new",
  thread_id: "thread-new",
  prompt_text: "hello",
  status: "running",
  started_at: "2026-05-05T00:00:02.000Z",
  created_at: "2026-05-05T00:00:02.000Z",
  updated_at: "2026-05-05T00:00:03.000Z",
};

describe("agentStreamThreadItemController", () => {
  beforeEach(async () => {
    await changeLimeLocale("zh-CN");
  });

  afterEach(async () => {
    await changeLimeLocale("zh-CN");
  });

  it("应把 pending item 绑定到真实 turn，并优先使用 turn.updated_at", () => {
    expect(
      buildAgentStreamTurnStartedPendingItemUpdate({
        pendingItem: threadItem(),
        turn,
      }),
    ).toMatchObject({
      id: "item-a",
      thread_id: "thread-new",
      turn_id: "turn-new",
      updated_at: "2026-05-05T00:00:03.000Z",
    });
  });

  it("无 pending item 时不应构造更新", () => {
    expect(
      buildAgentStreamTurnStartedPendingItemUpdate({
        pendingItem: null,
        turn,
      }),
    ).toBeNull();
  });

  it("命令输出增量更新不应覆盖 command/cwd 等已知细节", () => {
    const started = threadItem({
      id: "command-1",
      type: "command_execution",
      command: "npm test",
      cwd: "/repo",
      aggregated_output: "",
      sequence: 10,
    });
    const updated = threadItem({
      id: "command-1",
      type: "command_execution",
      command: "",
      cwd: "",
      aggregated_output: "PASS",
      sequence: 11,
      updated_at: "2026-05-05T00:00:05.000Z",
    });

    expect(upsertThreadItemState([started], updated)[0]).toMatchObject({
      id: "command-1",
      type: "command_execution",
      command: "npm test",
      cwd: "/repo",
      aggregated_output: "PASS",
      sequence: 10,
      updated_at: "2026-05-05T00:00:05.000Z",
    });
  });

  it("同一 tool id 出现在不同 turn 时不应覆盖上一轮工具 item", () => {
    const firstTurnItem = threadItem({
      id: "tool-search",
      type: "tool_call",
      thread_id: "thread-1",
      turn_id: "turn-1",
      tool_name: "web_search",
      output: "第一轮结果",
      status: "completed",
      success: true,
      sequence: 10,
    });
    const secondTurnItem = threadItem({
      id: "tool-search",
      type: "tool_call",
      thread_id: "thread-1",
      turn_id: "turn-2",
      tool_name: "web_search",
      output: "第二轮结果",
      status: "completed",
      success: true,
      sequence: 20,
      started_at: "2026-05-05T00:01:00.000Z",
      updated_at: "2026-05-05T00:01:01.000Z",
    });

    const items = upsertThreadItemState([firstTurnItem], secondTurnItem);

    expect(items).toHaveLength(2);
    expect(
      items.map((item) => [
        item.turn_id,
        item.type === "tool_call" ? item.output : undefined,
      ]),
    ).toEqual([
      ["turn-1", "第一轮结果"],
      ["turn-2", "第二轮结果"],
    ]);
  });

  it("应把工具增量实时投影为通用 tool_call item，保留多模态 metadata", () => {
    const started = projectAgentStreamTimelineItem(
      {
        type: "tool_start",
        tool_id: "tool-image-1",
        tool_name: "image_generate",
        arguments: JSON.stringify({ prompt: "海报" }),
        sequence: 20,
        timestamp: "2026-05-05T00:01:00.000Z",
      },
      {
        activeSessionId: "thread-1",
        fallbackTurnId: "turn-1",
        now: "2026-05-05T00:01:00.000Z",

      },
    );
    const updated = projectAgentStreamTimelineItem(
      {
        type: "tool_output_delta",
        tool_id: "tool-image-1",
        delta: "生成中",
        output_kind: "preview",
        metadata: {
          modality: "image",
          assetRef: "artifact://image-1",
        },
        sequence: 21,
        timestamp: "2026-05-05T00:01:01.000Z",
      },
      {
        activeSessionId: "thread-1",
        fallbackTurnId: "turn-1",
        now: "2026-05-05T00:01:01.000Z",
      },
      started ?? undefined,
    );

    expect(updated).toMatchObject({
      id: "tool-image-1",
      type: "tool_call",
      thread_id: "thread-1",
      turn_id: "turn-1",
      tool_name: "image_generate",
      output: "生成中",
      metadata: {
        modality: "image",
        assetRef: "artifact://image-1",
        output_kind: "preview",



        streaming: true,
      },
    });
  });

  it("工具进度应优先继承 App Server lifecycle metadata，而不是被本地 fallback 覆盖", () => {
    const started = projectAgentStreamTimelineItem(
      {
        type: "tool_start",
        tool_id: "tool-risk-1",
        tool_name: "Bash",
        arguments: JSON.stringify({ command: "rm -rf build" }),
        sequence: 20,
        timestamp: "2026-05-05T00:01:00.000Z",
      },
      {
        activeSessionId: "thread-1",
        fallbackTurnId: "turn-1",
        now: "2026-05-05T00:01:00.000Z",
      },
    );

    const progress = projectAgentStreamTimelineItem(
      {
        type: "tool_progress",
        tool_id: "tool-risk-1",
        progress: {
          message: "waiting approval",
          metadata: {

          },
        },
        sequence: 21,
        timestamp: "2026-05-05T00:01:01.000Z",
      },
      {
        activeSessionId: "thread-1",
        fallbackTurnId: "turn-1",
        now: "2026-05-05T00:01:01.000Z",
      },
      started ?? undefined,
    );

    expect(progress).toMatchObject({
      type: "tool_call",
      metadata: {


      },
    });
  });

  it("应保留工具开始事件中的结构化过程摘要 metadata", async () => {
    await changeLimeLocale("en-US");
    const started = projectAgentStreamTimelineItem(
      {
        type: "tool_start",
        tool_id: "tool-search-start",
        tool_name: "web_search",
        arguments: JSON.stringify({ query: "runtime start" }),
        metadata: {
          tool_process_summary: {
            source: "runtime_facts",
            pre: {
              key: "toolCall.processSummary.webSearch.searchFirstWithQuery",
              values: { query: "runtime start" },
            },
          },

        },
        sequence: 20,
        timestamp: "2026-05-05T00:01:00.000Z",
      },
      {
        activeSessionId: "thread-1",
        fallbackTurnId: "turn-1",
        now: "2026-05-05T00:01:00.000Z",
      },
    );

    expect(started).toMatchObject({
      id: "tool-search-start",
      type: "tool_call",
      metadata: {
        tool_process_summary: {
          source: "runtime_facts",
        },

      },
    });
    expect(
      resolveAgentThreadToolProcessNarrative(started as AgentThreadItem),
    ).toMatchObject({
      preSummary: "Searching runtime start first",
      summary: "Searching runtime start first",
    });
  });

  it("应保留工具结果中的结构化过程摘要 metadata 供工具卡片渲染", async () => {
    await changeLimeLocale("en-US");
    const started = projectAgentStreamTimelineItem(
      {
        type: "tool_start",
        tool_id: "tool-search-1",
        tool_name: "web_search",
        arguments: JSON.stringify({ query: "runtime facts" }),
        sequence: 20,
        timestamp: "2026-05-05T00:01:00.000Z",
      },
      {
        activeSessionId: "thread-1",
        fallbackTurnId: "turn-1",
        now: "2026-05-05T00:01:00.000Z",
      },
    );
    const completed = projectAgentStreamTimelineItem(
      {
        type: "tool_end",
        tool_id: "tool-search-1",
        result: {
          success: true,
          output: "raw result should not win",
          metadata: {
            tool_process_summary: {
              source: "runtime_facts",
              pre: {
                key: "toolCall.processSummary.webSearch.searchFirstWithQuery",
                values: { query: "runtime facts" },
              },
              completed: {
                key: "toolCall.processSummary.webSearch.sourcesFound",
                values: { count: 2 },
              },
            },
          },
        },
        sequence: 21,
        timestamp: "2026-05-05T00:01:01.000Z",
      },
      {
        activeSessionId: "thread-1",
        fallbackTurnId: "turn-1",
        now: "2026-05-05T00:01:01.000Z",
      },
      started ?? undefined,
    );

    expect(completed).toMatchObject({
      id: "tool-search-1",
      type: "tool_call",
      metadata: {
        tool_process_summary: {
          source: "runtime_facts",
        },

      },
    });
    expect(
      resolveAgentThreadToolProcessNarrative(completed as AgentThreadItem),
    ).toMatchObject({
      preSummary: "Searching runtime facts first",
      postSummary: "2 reference sources found",
      summary: "2 reference sources found",
      postSource: "metadata",
    });
  });

  it("应保留 tool_end structuredContent 供 MCP 工具过程渲染", () => {
    const started = projectAgentStreamTimelineItem(
      {
        type: "tool_start",
        tool_id: "tool-mcp-structured",
        tool_name: "mcp__docs__diagnostic_probe",
        arguments: JSON.stringify({ query: "structured content" }),
        sequence: 20,
        timestamp: "2026-05-05T00:01:00.000Z",
      },
      {
        activeSessionId: "thread-1",
        fallbackTurnId: "turn-1",
        now: "2026-05-05T00:01:00.000Z",
      },
    );

    const completed = projectAgentStreamTimelineItem(
      {
        type: "tool_end",
        tool_id: "tool-mcp-structured",
        result: {
          success: true,
          output: JSON.stringify({
            request_metadata: { projection: "mcp_tool_result_projection" },
            diagnostics: { elapsed_ms: 12 },
          }),
          structuredContent: {
            answer: "MCP 结构化答案已进入 Agent Chat GUI",
            ids: ["doc-structured-1"],
          },
        },
        sequence: 21,
        timestamp: "2026-05-05T00:01:01.000Z",
      },
      {
        activeSessionId: "thread-1",
        fallbackTurnId: "turn-1",
        now: "2026-05-05T00:01:01.000Z",
      },
      started ?? undefined,
    );

    expect(completed).toMatchObject({
      id: "tool-mcp-structured",
      type: "tool_call",
      structuredContent: {
        answer: "MCP 结构化答案已进入 Agent Chat GUI",
        ids: ["doc-structured-1"],
      },
      structured_content: {
        answer: "MCP 结构化答案已进入 Agent Chat GUI",
        ids: ["doc-structured-1"],
      },
    });
  });

  it("legacy tool event 带 turn_id 时应优先使用事件 turn，不挂到当前 fallback turn", () => {
    expect(
      projectAgentStreamTimelineItem(
        {
          type: "tool_end",
          tool_id: "tool-search",
          turn_id: "turn-from-event",
          result: {
            success: true,
            output: "搜索完成",
          },
          sequence: 24,
          timestamp: "2026-05-05T00:01:04.000Z",
        },
        {
          activeSessionId: "thread-1",
          fallbackTurnId: "turn-fallback",
          now: "2026-05-05T00:01:04.000Z",
        },
      ),
    ).toMatchObject({
      id: "tool-search",
      type: "tool_call",
      turn_id: "turn-from-event",
      output: "搜索完成",
      status: "completed",
    });
  });

  it("应把 ask_user / action_resolved 投影为 request_user_input lifecycle item", () => {
    const required = projectAgentStreamTimelineItem(
      {
        type: "action_required",
        request_id: "ask-1",
        action_type: "ask_user",
        prompt: "请选择方向",
        questions: [
          {
            question: "风格？",
            options: [{ label: "极简" }],
            multiSelect: false,
          },
        ],
        scope: {
          turn_id: "turn-1",
        },
        sequence: 30,
        timestamp: "2026-05-05T00:02:00.000Z",
      },
      {
        activeSessionId: "thread-1",
        fallbackTurnId: "turn-fallback",
        now: "2026-05-05T00:02:00.000Z",
      },
    );
    const resolved = projectAgentStreamTimelineItem(
      {
        type: "action_resolved",
        request_id: "ask-1",
        action_type: "ask_user",
        data: {
          answer: "极简",
        },
        sequence: 31,
        timestamp: "2026-05-05T00:02:10.000Z",
      },
      {
        activeSessionId: "thread-1",
        fallbackTurnId: "turn-1",
        now: "2026-05-05T00:02:10.000Z",
      },
      required ?? undefined,
    );

    expect(required).toMatchObject({
      type: "request_user_input",
      status: "in_progress",
      turn_id: "turn-1",
      prompt: "请选择方向",
      questions: [
        {
          question: "风格？",
          options: [{ label: "极简" }],
          multi_select: false,
        },
      ],
    });
    expect(resolved).toMatchObject({
      type: "request_user_input",
      status: "completed",
      prompt: "请选择方向",
      response: {
        answer: "极简",
      },
    });
  });
});
