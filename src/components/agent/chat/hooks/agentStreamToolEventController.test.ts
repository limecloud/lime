import { describe, expect, it } from "vitest";
import type { AgentToolExecutionResult } from "@/lib/api/agentProtocol";
import {
  LIME_TOOL_METADATA_BEGIN,
  LIME_TOOL_METADATA_END,
} from "./agentChatCoreUtils";
import { buildAgentStreamToolEndPreApplyPlan } from "./agentStreamToolEventController";

function toolResult(
  overrides: Partial<AgentToolExecutionResult> = {},
): AgentToolExecutionResult {
  return {
    success: true,
    output: "",
    ...overrides,
  };
}

describe("agentStreamToolEventController", () => {
  it("应查找 tool name 并归一化 tool result", () => {
    const toolNameByToolId = new Map([["tool-a", "lime_tool"]]);
    const plan = buildAgentStreamToolEndPreApplyPlan({
      toolId: "tool-a",
      toolNameByToolId,
      result: toolResult({
        output: [
          "正文",
          LIME_TOOL_METADATA_BEGIN,
          "{\"task_id\":\"task-a\",\"task_type\":\"image_generate\"}",
          LIME_TOOL_METADATA_END,
        ].join("\n"),
      }),
    });

    expect(plan.toolName).toBe("lime_tool");
    expect(plan.normalizedResult?.output).toBe("正文");
    expect(plan.normalizedResult?.metadata).toMatchObject({
      task_id: "task-a",
      task_type: "image_generate",
    });
  });

  it("应在结果可展示为任务时标记 meaningful completion", () => {
    const plan = buildAgentStreamToolEndPreApplyPlan({
      toolId: "tool-a",
      toolNameByToolId: new Map([
        ["tool-a", "lime_create_image_generation_task"],
      ]),
      result: toolResult({
        metadata: {
          task_id: "task-a",
          task_type: "image_generate",
          status: "running",
        },
      }),
    });

    expect(plan.hasMeaningfulCompletionSignal).toBe(true);
  });

  it("普通 tool result 不应标记 meaningful completion", () => {
    const plan = buildAgentStreamToolEndPreApplyPlan({
      toolId: "tool-a",
      toolNameByToolId: new Map(),
      result: toolResult({ metadata: { status: "ok" } }),
    });

    expect(plan.toolName).toBe("");
    expect(plan.hasMeaningfulCompletionSignal).toBe(false);
  });
});
