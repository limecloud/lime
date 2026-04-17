import {
  DEFAULT_AGENT_ACCESS_MODE,
  type AgentAccessMode,
} from "@/components/agent/chat/hooks/agentChatStorage";
import { createAccessModeFromRuntimePolicies } from "@/components/agent/chat/utils/accessModeRuntime";
import type {
  AgentTurnAutomationPayload,
  AutomationRequestMetadata,
} from "@/lib/api/automation";

export const AUTOMATION_ACCESS_MODE_OPTIONS: Array<{
  value: AgentAccessMode;
  label: string;
}> = [
  { value: "read-only", label: "只读" },
  { value: "current", label: "按需确认" },
  { value: "full-access", label: "完全访问" },
];

const LEGACY_ACCESS_MODE_KEYS = ["access_mode", "accessMode"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readLegacyAccessModeFromRecord(
  record: Record<string, unknown>,
): AgentAccessMode | null {
  for (const key of LEGACY_ACCESS_MODE_KEYS) {
    const value = record[key];
    if (typeof value !== "string") {
      continue;
    }

    switch (value.trim()) {
      case "read-only":
      case "current":
      case "full-access":
        return value.trim() as AgentAccessMode;
      default:
        break;
    }
  }
  return null;
}

function readLegacyAccessModeFromMetadata(
  requestMetadata?: AutomationRequestMetadata | null,
): AgentAccessMode | null {
  if (!isRecord(requestMetadata)) {
    return null;
  }

  const nestedHarness = isRecord(requestMetadata.harness)
    ? requestMetadata.harness
    : null;

  return (
    (nestedHarness ? readLegacyAccessModeFromRecord(nestedHarness) : null) ??
    readLegacyAccessModeFromRecord(requestMetadata)
  );
}

function omitLegacyAccessModeKeys(record: Record<string, unknown>): {
  nextRecord: Record<string, unknown>;
  changed: boolean;
} {
  const nextRecord = { ...record };
  let changed = false;

  for (const key of LEGACY_ACCESS_MODE_KEYS) {
    if (!(key in nextRecord)) {
      continue;
    }
    delete nextRecord[key];
    changed = true;
  }

  return {
    nextRecord,
    changed,
  };
}

export function resolveAgentTurnAutomationAccessMode(
  payload: Pick<
    AgentTurnAutomationPayload,
    "approval_policy" | "sandbox_policy" | "request_metadata"
  >,
): AgentAccessMode {
  return (
    createAccessModeFromRuntimePolicies(
      payload.approval_policy,
      payload.sandbox_policy,
    ) ??
    readLegacyAccessModeFromMetadata(payload.request_metadata) ??
    DEFAULT_AGENT_ACCESS_MODE
  );
}

export function omitLegacyAutomationAccessModeMetadata(
  requestMetadata?: AutomationRequestMetadata | null,
): AutomationRequestMetadata | null {
  if (!isRecord(requestMetadata)) {
    return requestMetadata ?? null;
  }

  const { nextRecord: nextRootRecord, changed: rootChanged } =
    omitLegacyAccessModeKeys(requestMetadata);
  let nextMetadata: Record<string, unknown> = nextRootRecord;
  let changed = rootChanged;

  if (isRecord(nextRootRecord.harness)) {
    const { nextRecord: nextHarness, changed: harnessChanged } =
      omitLegacyAccessModeKeys(nextRootRecord.harness);
    if (harnessChanged) {
      changed = true;
      if (Object.keys(nextHarness).length === 0) {
        delete nextMetadata.harness;
      } else {
        nextMetadata = {
          ...nextMetadata,
          harness: nextHarness,
        };
      }
    }
  }

  if (!changed) {
    return requestMetadata;
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : null;
}

export function automationAccessModeLabel(accessMode: AgentAccessMode): string {
  switch (accessMode) {
    case "read-only":
      return "只读";
    case "current":
      return "按需确认";
    case "full-access":
    default:
      return "完全访问";
  }
}

export function automationAccessModePolicySummary(
  accessMode: AgentAccessMode,
): string {
  switch (accessMode) {
    case "read-only":
      return "正式策略会写成 on-request + read-only。";
    case "current":
      return "正式策略会写成 on-request + workspace-write。";
    case "full-access":
    default:
      return "正式策略会写成 never + danger-full-access。";
  }
}
