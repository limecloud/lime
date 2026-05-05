import { describe, expect, it } from "vitest";
import {
  buildConversationThreadTimelineWindowProjection,
  filterConversationThreadItemsForRenderedTurns,
  resolveConversationRenderedTurns,
} from "./threadTimelineWindowProjection";

function turn(id: string) {
  return { id };
}

function item(id: string, turnId: string) {
  return { id, turn_id: turnId };
}

describe("threadTimelineWindowProjection", () => {
  it("无隐藏历史时应保留全部 turns 和 threadItems", () => {
    const turns = [turn("turn-1"), turn("turn-2")];
    const threadItems = [item("item-1", "turn-1"), item("item-2", "turn-2")];

    const projection = buildConversationThreadTimelineWindowProjection({
      turns,
      threadItems,
      hiddenHistoryCount: 0,
      isRestoredHistoryWindow: false,
      renderedAssistantMessageCount: 1,
      renderedMessageCount: 2,
      progressiveInitialRenderCount: 3,
      shouldDeferThreadItemsScan: false,
    });

    expect(projection.renderedTurns).toEqual(turns);
    expect(projection.renderedTurnIdSet).toBeNull();
    expect(projection.renderedThreadItems).toEqual(threadItems);
  });

  it("旧会话应按可见 assistant 数量裁剪尾部 turns", () => {
    const turns = [turn("turn-1"), turn("turn-2"), turn("turn-3")];

    expect(
      resolveConversationRenderedTurns({
        turns,
        hiddenHistoryCount: 5,
        isRestoredHistoryWindow: true,
        renderedAssistantMessageCount: 1,
        renderedMessageCount: 1,
        progressiveInitialRenderCount: 10,
      }).map((entry) => entry.id),
    ).toEqual(["turn-2", "turn-3"]);
  });

  it("尾部窗口不含 currentTurnId 时应额外保留当前 turn", () => {
    const turns = [
      turn("turn-current"),
      turn("turn-old"),
      turn("turn-tail-1"),
      turn("turn-tail-2"),
    ];

    expect(
      resolveConversationRenderedTurns({
        turns,
        currentTurnId: "turn-current",
        hiddenHistoryCount: 4,
        isRestoredHistoryWindow: true,
        renderedAssistantMessageCount: 0,
        renderedMessageCount: 1,
        progressiveInitialRenderCount: 1,
      }).map((entry) => entry.id),
    ).toEqual(["turn-current", "turn-tail-2"]);
  });

  it("应按 renderedTurnIdSet 精确裁剪 threadItems", () => {
    const threadItems = [
      item("item-1", "turn-1"),
      item("item-2", "turn-2"),
      item("item-3", "turn-3"),
    ];

    expect(
      filterConversationThreadItemsForRenderedTurns({
        threadItems,
        renderedTurnIdSet: new Set(["turn-2", "turn-3"]),
        shouldDeferThreadItemsScan: false,
      }).map((entry) => entry.id),
    ).toEqual(["item-2", "item-3"]);
  });

  it("延迟扫描时应返回空 threadItems", () => {
    expect(
      filterConversationThreadItemsForRenderedTurns({
        threadItems: [item("item-1", "turn-1")],
        renderedTurnIdSet: null,
        shouldDeferThreadItemsScan: true,
      }),
    ).toEqual([]);
  });
});
