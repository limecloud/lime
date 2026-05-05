import { describe, expect, it } from "vitest";
import type { AsterSessionExecutionRuntime } from "@/lib/api/agentRuntime";
import {
  applyAgentStreamModelChangeExecutionRuntime,
  applyAgentStreamTurnContextExecutionRuntime,
  buildAgentStreamContextTracePreApplyPlan,
  buildAgentStreamModelChangePreApplyPlan,
  buildAgentStreamTurnContextPreApplyPlan,
} from "./agentStreamRuntimeContextController";

describe("agentStreamRuntimeContextController", () => {
  it("应构造 context trace 前置计划", () => {
    expect(
      buildAgentStreamContextTracePreApplyPlan({
        type: "context_trace",
        steps: [
          { stage: "准备", detail: "读取上下文" },
          { stage: "检索", detail: "匹配记忆" },
        ],
      }),
    ).toEqual({
      latestStage: "检索",
      shouldActivateStream: true,
      shouldClearOptimisticItem: true,
      stepCount: 2,
    });
  });

  it("应构造 turn context 前置计划并应用 execution runtime", () => {
    const event = {
      type: "turn_context" as const,
      session_id: "session-a",
      thread_id: "thread-a",
      turn_id: "turn-a",
      output_schema_runtime: {
        source: "turn" as const,
        strategy: "native" as const,
        providerName: "deepseek",
        modelName: "deepseek-chat",
      },
    };

    expect(buildAgentStreamTurnContextPreApplyPlan(event)).toEqual({
      latestTurnId: "turn-a",
      shouldActivateStream: true,
      source: "turn_context",
    });
    expect(applyAgentStreamTurnContextExecutionRuntime(null, event))
      .toMatchObject({
        session_id: "session-a",
        provider_name: "deepseek",
        model_name: "deepseek-chat",
        latest_turn_id: "turn-a",
        latest_turn_status: "running",
        source: "turn_context",
      });
  });

  it("应构造 model change 前置计划并保留当前 turn 状态", () => {
    const current: AsterSessionExecutionRuntime = {
      session_id: "session-a",
      provider_selector: null,
      provider_name: "deepseek",
      model_name: "deepseek-chat",
      execution_strategy: null,
      output_schema_runtime: null,
      recent_access_mode: null,
      recent_preferences: null,
      recent_team_selection: null,
      recent_theme: null,
      recent_session_mode: null,
      recent_gate_key: null,
      recent_run_title: null,
      recent_content_id: null,
      source: "turn_context",
      mode: null,
      latest_turn_id: "turn-a",
      latest_turn_status: "completed",
    };
    const event = {
      type: "model_change" as const,
      model: "deepseek-reasoner",
      mode: "chat",
    };

    expect(buildAgentStreamModelChangePreApplyPlan(event)).toEqual({
      latestTurnId: null,
      shouldActivateStream: true,
      source: "model_change",
    });
    expect(applyAgentStreamModelChangeExecutionRuntime(current, event))
      .toMatchObject({
        session_id: "session-a",
        model_name: "deepseek-reasoner",
        mode: "chat",
        latest_turn_status: "completed",
        source: "model_change",
      });
  });
});
