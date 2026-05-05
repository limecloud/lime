import { describe, expect, it } from "vitest";
import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";
import {
  buildCurrentTurnTimelineProjection,
  buildMessageGroupsProjection,
  buildMessageRenderGroupsProjection,
  buildTimelineByMessageIdProjection,
  resolveLastAssistantMessage,
} from "./messageTimelineRenderProjection";

function message(id: string, role: "user" | "assistant"): Message {
  return {
    id,
    role,
    content: id,
    timestamp: new Date(`2026-05-05T00:00:0${id.slice(-1)}.000Z`),
  } as Message;
}

function turn(id: string): AgentThreadTurn {
  return {
    id,
    status: "completed",
    started_at: "2026-05-05T00:00:00.000Z",
  } as AgentThreadTurn;
}

function item(id: string, turnId: string): AgentThreadItem {
  return {
    id,
    turn_id: turnId,
    type: "tool_call",
    sequence: 1,
    started_at: "2026-05-05T00:00:00.000Z",
  } as AgentThreadItem;
}

describe("messageTimelineRenderProjection", () => {
  it("不允许构建历史 timeline 时应返回空映射", () => {
    expect(
      buildTimelineByMessageIdProjection({
        canBuildHistoricalTimeline: false,
        renderedMessages: [message("message-1", "assistant")],
        renderedTurns: [turn("turn-1")],
        renderedThreadItems: [item("item-1", "turn-1")],
      }).size,
    ).toBe(0);
  });

  it("应解析最后一条 assistant 消息", () => {
    expect(
      resolveLastAssistantMessage([
        message("message-1", "assistant"),
        message("message-2", "user"),
        message("message-3", "assistant"),
      ])?.id,
    ).toBe("message-3");
  });

  it("当前 turn 未映射到消息时应挂到最后一条 assistant 消息", () => {
    const projection = buildCurrentTurnTimelineProjection({
      activeCurrentTurnId: "turn-current",
      activeCurrentTurn: turn("turn-current"),
      lastAssistantMessageId: "message-tail",
      timelineByMessageId: new Map(),
      renderedThreadItems: [
        item("item-1", "turn-current"),
        item("item-2", "turn-other"),
      ],
    });

    expect(projection).toMatchObject({
      messageId: "message-tail",
      turn: { id: "turn-current" },
      items: [{ id: "item-1" }],
    });
  });

  it("应为消息组补齐 timeline 与 active 标记", () => {
    const messages = [
      message("message-user", "user"),
      message("message-assistant", "assistant"),
    ];
    const groups = buildMessageGroupsProjection(messages);
    const renderGroups = buildMessageRenderGroupsProjection({
      messageGroups: groups,
      timelineByMessageId: new Map([
        [
          "message-assistant",
          {
            messageId: "message-assistant",
            turn: turn("turn-1"),
            items: [item("item-1", "turn-1")],
          },
        ],
      ]),
      currentTurnTimeline: null,
      lastAssistantMessageId: "message-assistant",
    });

    expect(renderGroups).toHaveLength(1);
    expect(renderGroups[0]).toMatchObject({
      lastAssistantId: "message-assistant",
      isActiveGroup: true,
      timeline: {
        messageId: "message-assistant",
        turn: { id: "turn-1" },
      },
    });
  });
});
