import { getProviderLabel } from "@/lib/constants/providerMappings";
import type {
  AsterSessionExecutionRuntime,
  AsterSessionExecutionRuntimePreferences,
  AsterSessionExecutionRuntimeRecentTeamRole,
  AsterSessionExecutionRuntimeRecentTeamSelection,
  AsterSessionExecutionRuntimeSource,
  AsterTurnOutputSchemaRuntime,
} from "@/lib/api/agentExecutionRuntime";
import type { AsterSessionDetail } from "@/lib/api/agentRuntime";
import type {
  AgentEventModelChange,
  AgentEventTurnContext,
} from "@/lib/api/agentProtocol";
import type { SessionModelPreference } from "../hooks/agentChatShared";
import type { ChatToolPreferences } from "./chatToolPreferences";
import {
  buildTeamDefinitionSummary,
  createTeamDefinitionFromPreset,
  normalizeTeamDefinition,
  type TeamDefinition,
} from "./teamDefinitions";

function mergeExecutionRuntime(
  current: AsterSessionExecutionRuntime | null,
  updates: Partial<AsterSessionExecutionRuntime>,
  source: AsterSessionExecutionRuntimeSource,
): AsterSessionExecutionRuntime | null {
  const sessionId = updates.session_id || current?.session_id;
  const providerSelector =
    updates.provider_selector ?? current?.provider_selector ?? null;
  const providerName = updates.provider_name ?? current?.provider_name ?? null;
  const modelName = updates.model_name ?? current?.model_name ?? null;
  const executionStrategy =
    updates.execution_strategy ?? current?.execution_strategy ?? null;
  const outputSchemaRuntime =
    updates.output_schema_runtime ?? current?.output_schema_runtime ?? null;
  const recentPreferences =
    updates.recent_preferences ?? current?.recent_preferences ?? null;
  const recentTeamSelection =
    updates.recent_team_selection ?? current?.recent_team_selection ?? null;
  const recentTheme = updates.recent_theme ?? current?.recent_theme ?? null;
  const recentSessionMode =
    updates.recent_session_mode ?? current?.recent_session_mode ?? null;
  const recentGateKey =
    updates.recent_gate_key ?? current?.recent_gate_key ?? null;
  const recentRunTitle =
    updates.recent_run_title ?? current?.recent_run_title ?? null;
  const recentContentId =
    updates.recent_content_id ?? current?.recent_content_id ?? null;
  const mode = updates.mode ?? current?.mode ?? null;
  const latestTurnId = updates.latest_turn_id ?? current?.latest_turn_id ?? null;
  const latestTurnStatus =
    updates.latest_turn_status ?? current?.latest_turn_status ?? null;

  if (!sessionId) {
    return null;
  }

  if (
    !providerSelector &&
    !providerName &&
    !modelName &&
    !outputSchemaRuntime &&
    !executionStrategy &&
    !recentPreferences &&
    !recentTeamSelection &&
    !recentTheme &&
    !recentSessionMode &&
    !recentGateKey &&
    !recentRunTitle &&
    !recentContentId
  ) {
    return null;
  }

  return {
    session_id: sessionId,
    provider_selector: providerSelector,
    provider_name: providerName,
    model_name: modelName,
    execution_strategy: executionStrategy,
    output_schema_runtime: outputSchemaRuntime,
    recent_preferences: recentPreferences,
    recent_team_selection: recentTeamSelection,
    recent_theme: recentTheme,
    recent_session_mode: recentSessionMode,
    recent_gate_key: recentGateKey,
    recent_run_title: recentRunTitle,
    recent_content_id: recentContentId,
    source,
    mode,
    latest_turn_id: latestTurnId,
    latest_turn_status: latestTurnStatus,
  };
}

export function createExecutionRuntimeFromSessionDetail(
  detail?: Pick<AsterSessionDetail, "execution_runtime"> | null,
): AsterSessionExecutionRuntime | null {
  return detail?.execution_runtime || null;
}

export function createSessionModelPreferenceFromExecutionRuntime(
  runtime?: Pick<
    AsterSessionExecutionRuntime,
    "provider_selector" | "provider_name" | "model_name"
  > | null,
): SessionModelPreference | null {
  const providerType =
    runtime?.provider_selector?.trim() ||
    runtime?.provider_name?.trim() ||
    null;
  const model = runtime?.model_name?.trim() || null;

  if (!providerType || !model) {
    return null;
  }

  return {
    providerType,
    model,
  };
}

function normalizeRecentPreferenceBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function createChatToolPreferencesFromExecutionRuntime(
  runtime?: Pick<AsterSessionExecutionRuntime, "recent_preferences"> | null,
): ChatToolPreferences | null {
  const preferences = runtime?.recent_preferences as
    | AsterSessionExecutionRuntimePreferences
    | null
    | undefined;
  if (!preferences) {
    return null;
  }

  const webSearch = normalizeRecentPreferenceBoolean(preferences.webSearch);
  const thinking = normalizeRecentPreferenceBoolean(preferences.thinking);
  const task = normalizeRecentPreferenceBoolean(preferences.task);
  const subagent = normalizeRecentPreferenceBoolean(preferences.subagent);

  if (
    webSearch === null &&
    thinking === null &&
    task === null &&
    subagent === null
  ) {
    return null;
  }

  return {
    webSearch: webSearch ?? false,
    thinking: thinking ?? false,
    task: task ?? false,
    subagent: subagent ?? false,
  };
}

export function createSessionRecentPreferencesFromChatToolPreferences(
  preferences: ChatToolPreferences,
): AsterSessionExecutionRuntimePreferences {
  return {
    webSearch: preferences.webSearch,
    thinking: preferences.thinking,
    task: preferences.task,
    subagent: preferences.subagent,
  };
}

function normalizeRuntimeText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeRuntimeSkillIds(
  value?: string[] | null,
): string[] | undefined {
  const skillIds =
    value
      ?.map((skillId) => normalizeRuntimeText(skillId))
      .filter((skillId): skillId is string => Boolean(skillId)) || [];
  return skillIds.length > 0 ? skillIds : undefined;
}

function createTeamRoleDefinitionsFromRuntimeSelection(
  roles?: AsterSessionExecutionRuntimeRecentTeamRole[] | null,
) {
  return (roles || [])
    .map((role, index) => {
      const label = normalizeRuntimeText(role.label) || `角色 ${index + 1}`;
      const summary =
        normalizeRuntimeText(role.summary) || `${label}负责当前子任务。`;
      return {
        id: normalizeRuntimeText(role.id) || `runtime-role-${index + 1}`,
        label,
        summary,
        profileId: normalizeRuntimeText(role.profileId) || undefined,
        roleKey: normalizeRuntimeText(role.roleKey) || undefined,
        skillIds: normalizeRuntimeSkillIds(role.skillIds),
      };
    })
    .filter((role) => role.label.trim().length > 0);
}

export function createTeamDefinitionFromExecutionRuntimeRecentTeamSelection(
  selection?: AsterSessionExecutionRuntimeRecentTeamSelection | null,
): TeamDefinition | null {
  if (!selection || selection.disabled) {
    return null;
  }

  const selectedTeamSource = normalizeRuntimeText(selection.selectedTeamSource);
  const selectedTeamId = normalizeRuntimeText(selection.selectedTeamId);
  const preferredTeamPresetId = normalizeRuntimeText(
    selection.preferredTeamPresetId,
  );

  if (
    selectedTeamSource === "builtin" ||
    (!selectedTeamSource && preferredTeamPresetId)
  ) {
    return createTeamDefinitionFromPreset(
      selectedTeamId || preferredTeamPresetId || "",
    );
  }

  const normalizedTeam = normalizeTeamDefinition({
    id: selectedTeamId || undefined,
    source:
      selectedTeamSource === "ephemeral"
        ? "ephemeral"
        : selectedTeamSource === "custom"
          ? "custom"
          : "custom",
    label: normalizeRuntimeText(selection.selectedTeamLabel) || "",
    description:
      normalizeRuntimeText(selection.selectedTeamDescription) || undefined,
    theme: normalizeRuntimeText(selection.theme) || undefined,
    presetId: preferredTeamPresetId || undefined,
    roles: createTeamRoleDefinitionsFromRuntimeSelection(
      selection.selectedTeamRoles,
    ),
  });

  return normalizedTeam;
}

export function createSessionRecentTeamSelectionFromTeamDefinition(
  team: TeamDefinition | null,
  theme?: string | null,
): AsterSessionExecutionRuntimeRecentTeamSelection {
  if (!team) {
    return {
      disabled: true,
      theme: normalizeRuntimeText(theme) || undefined,
    };
  }

  return {
    disabled: false,
    theme: normalizeRuntimeText(theme) || normalizeRuntimeText(team.theme),
    preferredTeamPresetId:
      normalizeRuntimeText(team.presetId) ||
      (team.source === "builtin" ? normalizeRuntimeText(team.id) : null) ||
      undefined,
    selectedTeamId: normalizeRuntimeText(team.id) || undefined,
    selectedTeamSource: team.source,
    selectedTeamLabel: normalizeRuntimeText(team.label) || undefined,
    selectedTeamDescription:
      normalizeRuntimeText(team.description) || undefined,
    selectedTeamSummary: buildTeamDefinitionSummary(team) || undefined,
    selectedTeamRoles: team.roles.map((role) => ({
      id: normalizeRuntimeText(role.id) || undefined,
      label: normalizeRuntimeText(role.label) || undefined,
      summary: normalizeRuntimeText(role.summary) || undefined,
      profileId: normalizeRuntimeText(role.profileId) || undefined,
      roleKey: normalizeRuntimeText(role.roleKey) || undefined,
      skillIds: normalizeRuntimeSkillIds(role.skillIds) || undefined,
    })),
  };
}

export function applyTurnContextExecutionRuntime(
  current: AsterSessionExecutionRuntime | null,
  event: AgentEventTurnContext,
): AsterSessionExecutionRuntime | null {
  const outputSchemaRuntime = event.output_schema_runtime || null;
  return mergeExecutionRuntime(
    current,
    {
      session_id: event.session_id,
      output_schema_runtime: outputSchemaRuntime,
      provider_name: outputSchemaRuntime?.providerName ?? undefined,
      model_name: outputSchemaRuntime?.modelName ?? undefined,
      latest_turn_id: event.turn_id,
      latest_turn_status: "running",
    },
    "turn_context",
  );
}

export function applyModelChangeExecutionRuntime(
  current: AsterSessionExecutionRuntime | null,
  event: AgentEventModelChange,
): AsterSessionExecutionRuntime | null {
  return mergeExecutionRuntime(
    current,
    {
      model_name: event.model,
      mode: event.mode,
      latest_turn_status: current?.latest_turn_status || "running",
    },
    "model_change",
  );
}

export function getExecutionRuntimeProviderLabel(
  runtime?: AsterSessionExecutionRuntime | null,
): string | null {
  const providerKey =
    runtime?.provider_selector?.trim() ||
    runtime?.provider_name?.trim() ||
    null;
  if (!providerKey) {
    return null;
  }
  return getProviderLabel(providerKey);
}

export function getOutputSchemaRuntimeLabel(
  runtime?: AsterTurnOutputSchemaRuntime | null,
): string | null {
  if (!runtime) {
    return null;
  }

  const strategyLabel =
    runtime.strategy === "native" ? "Native schema" : "Final output tool";
  const sourceLabel =
    runtime.source === "turn" ? "turn contract" : "session contract";
  return `${strategyLabel} · ${sourceLabel}`;
}

export function getExecutionRuntimeSummaryLabel(
  runtime?: AsterSessionExecutionRuntime | null,
): string | null {
  const providerLabel = getExecutionRuntimeProviderLabel(runtime);
  const modelLabel = runtime?.model_name?.trim() || null;
  if (providerLabel && modelLabel) {
    return `执行模型 ${providerLabel} · ${modelLabel}`;
  }
  if (modelLabel) {
    return `执行模型 ${modelLabel}`;
  }
  if (providerLabel) {
    return `执行提供方 ${providerLabel}`;
  }
  return null;
}

export function getExecutionRuntimeDisplayLabel(
  runtime?: AsterSessionExecutionRuntime | null,
  options?: { active?: boolean },
): string | null {
  const summaryLabel = getExecutionRuntimeSummaryLabel(runtime);
  if (!summaryLabel) {
    return null;
  }

  return summaryLabel.replace(
    /^执行/,
    options?.active ? "实际执行" : "最近执行",
  );
}
