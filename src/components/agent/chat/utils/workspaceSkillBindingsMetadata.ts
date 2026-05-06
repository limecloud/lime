import type { AgentRuntimeWorkspaceSkillBinding } from "@/lib/api/agentRuntime";

const MAX_WORKSPACE_SKILL_BINDINGS = 5;
const MAX_PERMISSION_SUMMARY_ITEMS = 4;
const SHORT_TEXT_MAX_CHARS = 120;
const DESCRIPTION_MAX_CHARS = 240;

export interface WorkspaceSkillBindingsHarnessMetadata {
  workspace_skill_bindings: {
    source: "p3c_runtime_binding";
    bindings: Array<Record<string, unknown>>;
  };
}

export interface WorkspaceSkillRuntimeEnableInput {
  workspaceRoot?: string | null;
  bindings: readonly AgentRuntimeWorkspaceSkillBinding[];
}

export interface WorkspaceSkillRuntimeEnableHarnessMetadata {
  workspace_skill_runtime_enable: {
    source: "manual_session_enable";
    approval: "manual";
    workspace_root?: string;
    bindings: Array<Record<string, unknown>>;
  };
}

function normalizeText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars)}…`;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  const normalized = values
    .map((item) => normalizeText(item, SHORT_TEXT_MAX_CHARS))
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_PERMISSION_SUMMARY_ITEMS);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function removeEmptyFields(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null) {
        return false;
      }
      if (Array.isArray(entry)) {
        return entry.length > 0;
      }
      return true;
    }),
  );
}

function normalizeBinding(
  binding: AgentRuntimeWorkspaceSkillBinding,
): Record<string, unknown> | undefined {
  const normalized = removeEmptyFields({
    directory: normalizeText(binding.directory, SHORT_TEXT_MAX_CHARS),
    name: normalizeText(binding.name, SHORT_TEXT_MAX_CHARS),
    description: normalizeText(binding.description, DESCRIPTION_MAX_CHARS),
    binding_status: normalizeText(binding.binding_status, SHORT_TEXT_MAX_CHARS),
    next_gate: normalizeText(binding.next_gate, SHORT_TEXT_MAX_CHARS),
    query_loop_visible: normalizeBool(binding.query_loop_visible),
    tool_runtime_visible: normalizeBool(binding.tool_runtime_visible),
    launch_enabled: normalizeBool(binding.launch_enabled),
    permission_summary: normalizeStringArray(
      binding.permission_summary ?? binding.registration.permission_summary,
    ),
    source_draft_id: normalizeText(
      binding.registration.source_draft_id ??
        binding.registration.sourceDraftId,
      SHORT_TEXT_MAX_CHARS,
    ),
    source_verification_report_id: normalizeText(
      binding.registration.source_verification_report_id ??
        binding.registration.sourceVerificationReportId,
      SHORT_TEXT_MAX_CHARS,
    ),
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeRuntimeEnableBinding(
  binding: AgentRuntimeWorkspaceSkillBinding,
): Record<string, unknown> | undefined {
  if (binding.binding_status !== "ready_for_manual_enable") {
    return undefined;
  }

  const directory = normalizeText(binding.directory, SHORT_TEXT_MAX_CHARS);
  if (!directory) {
    return undefined;
  }

  const normalized = removeEmptyFields({
    directory,
    skill: `project:${directory}`,
    registered_skill_directory: normalizeText(
      binding.registered_skill_directory,
      DESCRIPTION_MAX_CHARS,
    ),
    source_draft_id: normalizeText(
      binding.registration.source_draft_id ??
        binding.registration.sourceDraftId,
      SHORT_TEXT_MAX_CHARS,
    ),
    source_verification_report_id: normalizeText(
      binding.registration.source_verification_report_id ??
        binding.registration.sourceVerificationReportId,
      SHORT_TEXT_MAX_CHARS,
    ),
    permission_summary: normalizeStringArray(
      binding.permission_summary ?? binding.registration.permission_summary,
    ),
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function buildWorkspaceSkillBindingsHarnessMetadata(
  bindings?: readonly AgentRuntimeWorkspaceSkillBinding[] | null,
): WorkspaceSkillBindingsHarnessMetadata | undefined {
  const normalizedBindings = (bindings ?? [])
    .slice(0, MAX_WORKSPACE_SKILL_BINDINGS)
    .map(normalizeBinding)
    .filter((item): item is Record<string, unknown> => Boolean(item));

  if (normalizedBindings.length === 0) {
    return undefined;
  }

  return {
    workspace_skill_bindings: {
      source: "p3c_runtime_binding",
      bindings: normalizedBindings,
    },
  };
}

export function buildWorkspaceSkillRuntimeEnableHarnessMetadata(
  input?: WorkspaceSkillRuntimeEnableInput | null,
): WorkspaceSkillRuntimeEnableHarnessMetadata | undefined {
  const normalizedBindings = (input?.bindings ?? [])
    .slice(0, MAX_WORKSPACE_SKILL_BINDINGS)
    .map(normalizeRuntimeEnableBinding)
    .filter((item): item is Record<string, unknown> => Boolean(item));

  if (normalizedBindings.length === 0) {
    return undefined;
  }

  return {
    workspace_skill_runtime_enable: removeEmptyFields({
      source: "manual_session_enable",
      approval: "manual",
      workspace_root: normalizeText(
        input?.workspaceRoot,
        DESCRIPTION_MAX_CHARS,
      ),
      bindings: normalizedBindings,
    }) as WorkspaceSkillRuntimeEnableHarnessMetadata["workspace_skill_runtime_enable"],
  };
}
