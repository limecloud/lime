import { describe, expect, it } from "vitest";
import {
  buildConversationMessageRenderWindowProjection,
  filterVisibleConversationMessages,
  resolveConversationMessageRenderWindowSettings,
  resolveInitialConversationRenderedMessageCount,
} from "./messageRenderWindowProjection";

const settingsSet = {
  regular: {
    progressiveRenderThreshold: 4,
    initialRenderCount: 3,
    renderBatchSize: 2,
    minimumDelayMs: 120,
  },
  restored: {
    progressiveRenderThreshold: 2,
    initialRenderCount: 1,
    renderBatchSize: 1,
    minimumDelayMs: 600,
  },
};

function message(id: number, role: "user" | "assistant", content = "x") {
  return {
    id: `message-${id}`,
    role,
    content,
  };
}

describe("messageRenderWindowProjection", () => {
  it("应过滤空白 user 消息，但保留带图片的空白 user 消息", () => {
    const visibleMessages = filterVisibleConversationMessages([
      message(1, "user", "   "),
      { ...message(2, "user", "   "), images: ["image-a"] },
      message(3, "assistant", ""),
    ]);

    expect(visibleMessages.map((entry) => entry.id)).toEqual([
      "message-2",
      "message-3",
    ]);
  });

  it("普通会话超过阈值时应只投影尾部窗口，并允许后台自动补齐", () => {
    const settings = resolveConversationMessageRenderWindowSettings(
      settingsSet,
      false,
    );
    const visibleMessages = Array.from({ length: 6 }, (_, index) =>
      message(index, index % 2 === 0 ? "user" : "assistant"),
    );
    const renderedMessageCount = resolveInitialConversationRenderedMessageCount({
      isSending: false,
      visibleMessageCount: visibleMessages.length,
      settings,
    });

    const projection = buildConversationMessageRenderWindowProjection({
      visibleMessages,
      renderedMessageCount,
      isSending: false,
      isRestoredHistoryWindow: false,
      settings,
    });

    expect(projection.renderedMessageCount).toBe(3);
    expect(projection.hiddenHistoryCount).toBe(3);
    expect(projection.renderedMessages.map((entry) => entry.id)).toEqual([
      "message-3",
      "message-4",
      "message-5",
    ]);
    expect(projection.shouldAutoHydrateHiddenHistory).toBe(true);
  });

  it("旧会话窗口应使用更小首帧，并禁止自动补齐隐藏历史", () => {
    const settings = resolveConversationMessageRenderWindowSettings(
      settingsSet,
      true,
    );
    const visibleMessages = Array.from({ length: 4 }, (_, index) =>
      message(index, "assistant"),
    );

    const projection = buildConversationMessageRenderWindowProjection({
      visibleMessages,
      renderedMessageCount: resolveInitialConversationRenderedMessageCount({
        isSending: false,
        visibleMessageCount: visibleMessages.length,
        settings,
      }),
      isSending: false,
      isRestoredHistoryWindow: true,
      settings,
    });

    expect(projection.renderedMessageCount).toBe(1);
    expect(projection.hiddenHistoryCount).toBe(3);
    expect(projection.renderedMessages.map((entry) => entry.id)).toEqual([
      "message-3",
    ]);
    expect(projection.shouldAutoHydrateHiddenHistory).toBe(false);
    expect(projection.progressiveRenderMinimumDelayMs).toBe(600);
  });

  it("发送中不应开启历史窗口裁剪", () => {
    const settings = resolveConversationMessageRenderWindowSettings(
      settingsSet,
      false,
    );
    const visibleMessages = Array.from({ length: 8 }, (_, index) =>
      message(index, "assistant"),
    );

    const projection = buildConversationMessageRenderWindowProjection({
      visibleMessages,
      renderedMessageCount: 1,
      isSending: true,
      isRestoredHistoryWindow: false,
      settings,
    });

    expect(projection.shouldUseProgressiveRender).toBe(false);
    expect(projection.hiddenHistoryCount).toBe(0);
    expect(projection.renderedMessages).toHaveLength(8);
  });
});
