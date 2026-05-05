import { describe, expect, it } from "vitest";
import {
  buildAgentStreamActionRequiredPreApplyPlan,
  buildAgentStreamArtifactSnapshotPreApplyPlan,
} from "./agentStreamArtifactActionController";

describe("agentStreamArtifactActionController", () => {
  it("应构造 artifact snapshot 前置计划，并继续标记 meaningful completion", () => {
    expect(
      buildAgentStreamArtifactSnapshotPreApplyPlan({
        artifact: {
          artifactId: "artifact-a",
          filePath: "docs/out.md",
          content: "result",
        },
      }),
    ).toEqual({
      artifactId: "artifact-a",
      hasFilePath: true,
      hasInlineContent: true,
      shouldActivateStream: true,
      shouldClearOptimisticItem: true,
      shouldMarkMeaningfulCompletionSignal: true,
    });
  });

  it("无文件路径或正文时仍保持 artifact 完成信号语义", () => {
    expect(
      buildAgentStreamArtifactSnapshotPreApplyPlan({
        artifact: {
          artifactId: "artifact-a",
        },
      }),
    ).toMatchObject({
      artifactId: "artifact-a",
      hasFilePath: false,
      hasInlineContent: false,
      shouldMarkMeaningfulCompletionSignal: true,
    });
  });

  it("应构造 action required 前置计划", () => {
    expect(
      buildAgentStreamActionRequiredPreApplyPlan({
        type: "action_required",
        request_id: "request-a",
        action_type: "ask_user",
        prompt: "需要补充信息",
      }),
    ).toEqual({
      actionType: "ask_user",
      requestId: "request-a",
      shouldActivateStream: true,
      shouldClearOptimisticItem: true,
    });
  });
});
