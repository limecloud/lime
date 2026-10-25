import { resolveRequiredAgentChatCopy } from "@/i18n/agentChatCopy";
import type { AgentExecutionStrategy } from "@/lib/api/agentExecutionRuntime";
import type {
  AgentContextTraceStep as ContextTraceStep,
  AgentRuntimeStatusMetadata,
} from "@/lib/api/agentProtocol";
import type { AgentRuntimeStatus } from "../types";
import { resolveAgentRuntimeErrorPresentation } from "./agentRuntimeErrorPresentation";

export function buildDiagnosticsRuntimeStatusMetadata(
  extra?: AgentRuntimeStatusMetadata,
): AgentRuntimeStatusMetadata {
  return {
    sourceType: "runtime_status",
    source: "runtime_status",
    surface: "runtime_status",
    visibility: "diagnostics",
    persistence: "transient",
    agentui: {
      eventClass: "run.status",
      surface: "runtime_status",
      visibility: "diagnostics",
    },
    ...extra,
  };
}

function normalizeRuntimeErrorDetail(errorMessage: string): string {
  return resolveAgentRuntimeErrorPresentation(errorMessage).displayMessage;
}

export function buildContextRuntimeStatus(
  steps: ContextTraceStep[],
): AgentRuntimeStatus {
  const latestStep = steps[steps.length - 1];
  const checkpoints = steps
    .slice(-3)
    .map((step) => `${step.stage}：${step.detail}`);

  return {
    phase: "context",
    title: "正在整理相关信息",
    detail: latestStep
      ? `${latestStep.stage}：${latestStep.detail}`
      : "正在整理相关信息，以便给出更准确的结果。",
    checkpoints,
  };
}

export function buildActionResumeRuntimeStatus(): AgentRuntimeStatus {
  return {
    phase: "routing",
    title: "已收到补充信息，继续处理中",
    detail: "补充信息已加入当前流程，正在继续后续步骤。",
    checkpoints: ["补充信息已确认", "已恢复当前流程", "等待下一条进展"],
  };
}

export function formatAgentRuntimeStatusSummary(
  status?: AgentRuntimeStatus | null,
): string {
  if (!status?.title) {
    return "正在准备处理";
  }

  const lines = [status.title.trim()];
  if (status.detail?.trim()) {
    lines.push(status.detail.trim());
  }

  return lines.join("\n\n");
}

export function buildInitialAgentRuntimeStatus(_options: {
  executionStrategy: AgentExecutionStrategy;
  skipUserMessage?: boolean;
}): AgentRuntimeStatus {
  return {
    phase: "preparing",
    title: resolveRequiredAgentChatCopy("runtime.preparing"),
    detail: "",
    metadata: buildDiagnosticsRuntimeStatusMetadata(),
  };
}

export function buildWaitingAgentRuntimeStatus(_options: {
  executionStrategy: AgentExecutionStrategy;
}): AgentRuntimeStatus {
  return {
    phase: "routing",
    title: resolveRequiredAgentChatCopy("runtime.waiting"),
    detail: "",
    metadata: buildDiagnosticsRuntimeStatusMetadata(),
  };
}

export function buildFailedAgentRuntimeStatus(
  errorMessage: string,
): AgentRuntimeStatus {
  return {
    phase: "failed",
    title: resolveRequiredAgentChatCopy("runtime.failed"),
    detail: normalizeRuntimeErrorDetail(errorMessage),
    metadata: buildDiagnosticsRuntimeStatusMetadata(),
  };
}

export function buildFailedAgentMessageContent(
  errorMessage: string,
  partialContent?: string,
): string {
  const error = normalizeRuntimeErrorDetail(errorMessage);
  return partialContent?.trim()
    ? `${partialContent.trim()}\n\n${error}`
    : error;
}
