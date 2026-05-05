import type { AgentToolExecutionResult } from "@/lib/api/agentProtocol";
import { normalizeIncomingToolResult } from "./agentChatToolResult";
import { hasMeaningfulAgentStreamToolCompletionSignal } from "./agentStreamToolCompletionSignalController";

export interface AgentStreamToolEndPreApplyPlan {
  hasMeaningfulCompletionSignal: boolean;
  normalizedResult: AgentToolExecutionResult | undefined;
  toolName: string;
}

export function buildAgentStreamToolEndPreApplyPlan(params: {
  result: AgentToolExecutionResult | null | undefined;
  toolId: string;
  toolNameByToolId: Map<string, string>;
}): AgentStreamToolEndPreApplyPlan {
  const normalizedResult = normalizeIncomingToolResult(params.result);
  const toolName = params.toolNameByToolId.get(params.toolId) || "";

  return {
    hasMeaningfulCompletionSignal:
      hasMeaningfulAgentStreamToolCompletionSignal({
        toolId: params.toolId,
        toolName,
        normalizedResult,
      }),
    normalizedResult,
    toolName,
  };
}
