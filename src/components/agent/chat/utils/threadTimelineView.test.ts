import { describe, expect, it } from "vitest";

import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import {
  buildMessageTurnTimeline,
  mergeThreadTurns,
  mergeThreadItems,
} from "./threadTimelineView";

describe("threadTimelineView", () => {
  it("应将 turn 对齐到最近的 assistant 消息", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "旧问题",
        timestamp: new Date("2026-03-13T10:00:00Z"),
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "旧回答",
        timestamp: new Date("2026-03-13T10:00:01Z"),
      },
      {
        id: "user-2",
        role: "user",
        content: "新问题",
        timestamp: new Date("2026-03-13T10:01:00Z"),
      },
      {
        id: "assistant-2",
        role: "assistant",
        content: "新回答",
        timestamp: new Date("2026-03-13T10:01:01Z"),
      },
    ];
    const turns: AgentThreadTurn[] = [
      {
        id: "turn-2",
        thread_id: "thread-1",
        prompt_text: "新问题",
        status: "completed",
        started_at: "2026-03-13T10:01:00Z",
        completed_at: "2026-03-13T10:01:05Z",
        created_at: "2026-03-13T10:01:00Z",
        updated_at: "2026-03-13T10:01:05Z",
      },
    ];
    const items: AgentThreadItem[] = [
      {
        id: "plan-1",
        thread_id: "thread-1",
        turn_id: "turn-2",
        sequence: 2,
        status: "completed",
        started_at: "2026-03-13T10:01:02Z",
        completed_at: "2026-03-13T10:01:03Z",
        updated_at: "2026-03-13T10:01:03Z",
        type: "plan",
        text: "1. 总结\n2. 输出",
      },
    ];

    const timeline = buildMessageTurnTimeline(messages, turns, items);

    expect(timeline.has("assistant-1")).toBe(false);
    expect(timeline.get("assistant-2")?.turn.id).toBe("turn-2");
    expect(timeline.get("assistant-2")?.items).toHaveLength(1);
  });

  it("应合并并排序真实与临时 thread items", () => {
    const persistedItem: AgentThreadItem = {
      id: "item-1",
      thread_id: "thread-1",
      turn_id: "turn-1",
      sequence: 1,
      status: "completed",
      started_at: "2026-03-13T10:00:00Z",
      completed_at: "2026-03-13T10:00:01Z",
      updated_at: "2026-03-13T10:00:01Z",
      type: "plan",
      text: "旧计划",
    };
    const syntheticItem: AgentThreadItem = {
      id: "item-2",
      thread_id: "thread-1",
      turn_id: "turn-1",
      sequence: 10000,
      status: "in_progress",
      started_at: "2026-03-13T10:00:02Z",
      updated_at: "2026-03-13T10:00:02Z",
      type: "subagent_activity",
      status_label: "running",
      title: "子代理协作",
      summary: "执行中",
    };

    const items = mergeThreadItems([persistedItem], [syntheticItem]);

    expect(items.map((item) => item.id)).toEqual(["item-1", "item-2"]);
  });

  it("应忽略仅用于内部恢复成功的 warning 项", () => {
    const repairedWarning: AgentThreadItem = {
      id: "warning-artifact-repaired",
      thread_id: "thread-1",
      turn_id: "turn-1",
      sequence: 1,
      status: "completed",
      started_at: "2026-03-13T10:00:00Z",
      completed_at: "2026-03-13T10:00:01Z",
      updated_at: "2026-03-13T10:00:01Z",
      type: "warning",
      code: "artifact_document_repaired",
      message:
        "ArtifactDocument 已落盘: 已根据正文整理出一份可继续编辑的草稿。",
    };
    const planItem: AgentThreadItem = {
      id: "plan-2",
      thread_id: "thread-1",
      turn_id: "turn-1",
      sequence: 2,
      status: "completed",
      started_at: "2026-03-13T10:00:02Z",
      completed_at: "2026-03-13T10:00:03Z",
      updated_at: "2026-03-13T10:00:03Z",
      type: "plan",
      text: "继续整理结构",
    };

    const items = mergeThreadItems([repairedWarning], [planItem]);

    expect(items).toEqual([planItem]);
  });

  it("应优先将 turn 关联到最接近完成时刻的 assistant 消息", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "请生成图片",
        timestamp: new Date("2026-03-18T08:35:41.000Z"),
      },
      {
        id: "assistant-thinking",
        role: "assistant",
        content: "我先整理思路。",
        timestamp: new Date("2026-03-18T08:35:43.000Z"),
      },
      {
        id: "assistant-final",
        role: "assistant",
        content: "这是最终可用的 Prompt。",
        timestamp: new Date("2026-03-18T08:36:05.000Z"),
      },
      {
        id: "assistant-followup",
        role: "assistant",
        content: "如果你需要，我还可以继续细化风格。",
        timestamp: new Date("2026-03-18T08:36:20.000Z"),
      },
    ];
    const turns: AgentThreadTurn[] = [
      {
        id: "turn-1",
        thread_id: "thread-1",
        prompt_text: "请生成图片",
        status: "completed",
        started_at: "2026-03-18T08:35:41.000Z",
        completed_at: "2026-03-18T08:36:06.000Z",
        created_at: "2026-03-18T08:35:41.000Z",
        updated_at: "2026-03-18T08:36:06.000Z",
      },
    ];
    const items: AgentThreadItem[] = [
      {
        id: "reasoning-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 1,
        status: "completed",
        started_at: "2026-03-18T08:35:43.000Z",
        completed_at: "2026-03-18T08:36:05.000Z",
        updated_at: "2026-03-18T08:36:05.000Z",
        type: "reasoning",
        text: "先理解主题，再组织 Prompt。",
      },
    ];

    const timeline = buildMessageTurnTimeline(messages, turns, items);

    expect(timeline.has("assistant-thinking")).toBe(false);
    expect(timeline.get("assistant-final")?.turn.id).toBe("turn-1");
    expect(timeline.has("assistant-followup")).toBe(false);
  });

  it("相同距离下应优先绑定到有实际内容的 assistant 消息", () => {
    const messages: Message[] = [
      {
        id: "assistant-empty",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-03-18T08:36:05.000Z"),
        contentParts: [],
      },
      {
        id: "assistant-substantive",
        role: "assistant",
        content: "这是最终答复",
        timestamp: new Date("2026-03-18T08:36:05.000Z"),
      },
    ];
    const turns: AgentThreadTurn[] = [
      {
        id: "turn-1",
        thread_id: "thread-1",
        prompt_text: "帮我处理",
        status: "completed",
        started_at: "2026-03-18T08:35:41.000Z",
        completed_at: "2026-03-18T08:36:05.000Z",
        created_at: "2026-03-18T08:35:41.000Z",
        updated_at: "2026-03-18T08:36:05.000Z",
      },
    ];

    const timeline = buildMessageTurnTimeline(messages, turns, []);

    expect(timeline.has("assistant-empty")).toBe(false);
    expect(timeline.get("assistant-substantive")?.turn.id).toBe("turn-1");
  });

  it("应在增量刷新时合并并覆盖同 id 的 turn", () => {
    const previousTurns: AgentThreadTurn[] = [
      {
        id: "turn-1",
        thread_id: "thread-1",
        prompt_text: "帮我处理",
        status: "running",
        started_at: "2026-03-18T08:35:41.000Z",
        created_at: "2026-03-18T08:35:41.000Z",
        updated_at: "2026-03-18T08:35:41.000Z",
      },
    ];
    const incomingTurns: AgentThreadTurn[] = [
      {
        id: "turn-1",
        thread_id: "thread-1",
        prompt_text: "帮我处理",
        status: "completed",
        started_at: "2026-03-18T08:35:41.000Z",
        completed_at: "2026-03-18T08:36:05.000Z",
        created_at: "2026-03-18T08:35:41.000Z",
        updated_at: "2026-03-18T08:36:05.000Z",
      },
    ];

    const mergedTurns = mergeThreadTurns(previousTurns, incomingTurns);

    expect(mergedTurns).toHaveLength(1);
    expect(mergedTurns[0]?.status).toBe("completed");
    expect(mergedTurns[0]?.completed_at).toBe("2026-03-18T08:36:05.000Z");
  });
});
