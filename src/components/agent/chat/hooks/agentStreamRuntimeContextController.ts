import type { AsterSessionExecutionRuntime } from "@/lib/api/agentRuntime";
import type {
  AgentEventContextTrace,
  AgentEventModelChange,
  AgentEventTurnContext,
} from "@/lib/api/agentProtocol";
import {
  applyModelChangeExecutionRuntime,
  applyTurnContextExecutionRuntime,
} from "../utils/sessionExecutionRuntime";

export interface AgentStreamContextTracePreApplyPlan {
  latestStage: string | null;
  shouldActivateStream: boolean;
  shouldClearOptimisticItem: boolean;
  stepCount: number;
}

export interface AgentStreamRuntimeContextPreApplyPlan {
  latestTurnId: string | null;
  shouldActivateStream: boolean;
  source: "turn_context" | "model_change";
}

export function buildAgentStreamContextTracePreApplyPlan(
  event: AgentEventContextTrace,
): AgentStreamContextTracePreApplyPlan {
  const latestStep = event.steps.at(-1);
  return {
    latestStage: latestStep?.stage || null,
    shouldActivateStream: true,
    shouldClearOptimisticItem: true,
    stepCount: event.steps.length,
  };
}

export function buildAgentStreamTurnContextPreApplyPlan(
  event: AgentEventTurnContext,
): AgentStreamRuntimeContextPreApplyPlan {
  return {
    latestTurnId: event.turn_id || null,
    shouldActivateStream: true,
    source: "turn_context",
  };
}

export function buildAgentStreamModelChangePreApplyPlan(
  _event: AgentEventModelChange,
): AgentStreamRuntimeContextPreApplyPlan {
  return {
    latestTurnId: null,
    shouldActivateStream: true,
    source: "model_change",
  };
}

export function applyAgentStreamTurnContextExecutionRuntime(
  current: AsterSessionExecutionRuntime | null,
  event: AgentEventTurnContext,
): AsterSessionExecutionRuntime | null {
  return applyTurnContextExecutionRuntime(current, event);
}

export function applyAgentStreamModelChangeExecutionRuntime(
  current: AsterSessionExecutionRuntime | null,
  event: AgentEventModelChange,
): AsterSessionExecutionRuntime | null {
  return applyModelChangeExecutionRuntime(current, event);
}
