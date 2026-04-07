import type {
  AsterApprovalPolicy,
  AsterSandboxPolicy,
  AsterSessionExecutionRuntime,
  AsterSessionExecutionRuntimeAccessMode,
} from "@/lib/api/agentRuntime";
import {
  normalizeAccessMode,
  type AgentAccessMode,
} from "../hooks/agentChatStorage";

export interface AgentAccessRuntimePolicies {
  approvalPolicy: AsterApprovalPolicy;
  sandboxPolicy: AsterSandboxPolicy;
}

export function createRuntimePoliciesFromAccessMode(
  accessMode?: AgentAccessMode | null,
): AgentAccessRuntimePolicies {
  const resolvedAccessMode = normalizeAccessMode(accessMode);
  switch (resolvedAccessMode) {
    case "read-only":
      return {
        approvalPolicy: "on-request",
        sandboxPolicy: "read-only",
      };
    case "full-access":
      return {
        approvalPolicy: "never",
        sandboxPolicy: "danger-full-access",
      };
    case "current":
    default:
      return {
        approvalPolicy: "on-request",
        sandboxPolicy: "workspace-write",
      };
  }
}

function normalizeExecutionRuntimeAccessMode(
  value?: AsterSessionExecutionRuntimeAccessMode | string | null,
): AgentAccessMode | null {
  if (value === "read-only" || value === "current" || value === "full-access") {
    return value;
  }
  return null;
}

export function createAccessModeFromExecutionRuntime(
  runtime?: Pick<AsterSessionExecutionRuntime, "recent_access_mode"> | null,
): AgentAccessMode | null {
  return normalizeExecutionRuntimeAccessMode(runtime?.recent_access_mode);
}
