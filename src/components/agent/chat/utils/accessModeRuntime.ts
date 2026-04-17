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

export function createAccessModeFromRuntimePolicies(
  approvalPolicy?: AsterApprovalPolicy | string | null,
  sandboxPolicy?: AsterSandboxPolicy | string | null,
): AgentAccessMode | null {
  const normalizedApprovalPolicy =
    typeof approvalPolicy === "string" ? approvalPolicy.trim() : "";
  const normalizedSandboxPolicy =
    typeof sandboxPolicy === "string" ? sandboxPolicy.trim() : "";

  switch (normalizedSandboxPolicy) {
    case "read-only":
      return !normalizedApprovalPolicy ||
        normalizedApprovalPolicy === "on-request"
        ? "read-only"
        : null;
    case "workspace-write":
      return !normalizedApprovalPolicy ||
        normalizedApprovalPolicy === "on-request"
        ? "current"
        : null;
    case "danger-full-access":
      return !normalizedApprovalPolicy || normalizedApprovalPolicy === "never"
        ? "full-access"
        : null;
    default:
      return null;
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
