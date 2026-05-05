import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import {
  buildAgentStreamThinkingDeltaMessagePatch,
  buildAgentStreamThinkingDeltaPreApplyPlan,
  type AgentStreamThinkingPartsAppender,
} from "./agentStreamThinkingDeltaController";

const appendThinkingToParts: AgentStreamThinkingPartsAppender = (
  parts,
  textDelta,
) => [...parts, { type: "thinking", text: textDelta }];

describe("agentStreamThinkingDeltaController", () => {
  it("应构造 thinking delta 前置计划", () => {
    expect(
      buildAgentStreamThinkingDeltaPreApplyPlan({
        surfaceThinkingDeltas: true,
      }),
    ).toEqual({
      shouldActivateStream: true,
      shouldApplyThinkingDelta: true,
    });
    expect(
      buildAgentStreamThinkingDeltaPreApplyPlan({
        surfaceThinkingDeltas: false,
      }),
    ).toEqual({
      shouldActivateStream: true,
      shouldApplyThinkingDelta: false,
    });
  });

  it("应构造 thinking 消息 patch 并做 overlap append", () => {
    expect(
      buildAgentStreamThinkingDeltaMessagePatch({
        appendThinkingToParts,
        contentParts: [{ type: "text", text: "正文" }],
        textDelta: "世界",
        thinkingContent: "你好，世",
      }),
    ).toEqual({
      isThinking: true,
      thinkingContent: "你好，世界",
      contentParts: [
        { type: "text", text: "正文" },
        { type: "thinking", text: "世界" },
      ],
    });
  });

  it("无既有 contentParts 时应从空数组追加 thinking part", () => {
    const patch = buildAgentStreamThinkingDeltaMessagePatch({
      appendThinkingToParts,
      textDelta: "推理",
    });

    expect(patch).toEqual({
      isThinking: true,
      thinkingContent: "推理",
      contentParts: [{ type: "thinking", text: "推理" }],
    } satisfies Pick<
      Message,
      "contentParts" | "isThinking" | "thinkingContent"
    >);
  });
});
