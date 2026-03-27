import { describe, expect, it } from "vitest";
import {
  applyModelChangeExecutionRuntime,
  applyTurnContextExecutionRuntime,
  getExecutionRuntimeSummaryLabel,
  getOutputSchemaRuntimeLabel,
} from "./sessionExecutionRuntime";

describe("sessionExecutionRuntime deepseek-reasoner", () => {
  it("应在 deepseek-reasoner 的 Artifact runtime 上持续保留 final_output_tool 策略", () => {
    const fromTurnContext = applyTurnContextExecutionRuntime(null, {
      type: "turn_context",
      session_id: "session-deepseek",
      thread_id: "thread-1",
      turn_id: "turn-1",
      output_schema_runtime: {
        source: "turn",
        strategy: "final_output_tool",
        providerName: "OpenAI",
        modelName: "deepseek-reasoner",
      },
    });

    const runtime = applyModelChangeExecutionRuntime(fromTurnContext, {
      type: "model_change",
      model: "deepseek-reasoner",
      mode: "chat_completions",
    });

    expect(runtime).toMatchObject({
      session_id: "session-deepseek",
      source: "model_change",
      provider_name: "OpenAI",
      model_name: "deepseek-reasoner",
      latest_turn_id: "turn-1",
      latest_turn_status: "running",
    });
    expect(runtime?.output_schema_runtime?.strategy).toBe("final_output_tool");
    expect(getOutputSchemaRuntimeLabel(runtime?.output_schema_runtime)).toBe(
      "Final output tool · turn contract",
    );
    expect(getExecutionRuntimeSummaryLabel(runtime)).toBe(
      "执行模型 OpenAI · deepseek-reasoner",
    );
  });
});
