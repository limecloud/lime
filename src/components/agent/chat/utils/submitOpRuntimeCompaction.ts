import type {
  AsterExecutionStrategy,
  AsterSessionExecutionRuntime,
  AsterSessionExecutionRuntimeRecentTeamSelection,
} from "@/lib/api/agentRuntime";
import type { SessionModelPreference } from "../hooks/agentChatShared";
import type { ChatToolPreferences } from "./chatToolPreferences";
import { normalizeHarnessSessionMode } from "./harnessSessionMode";

const HARNESS_WEB_SEARCH_PREFERENCE_KEYS = ["web_search", "webSearch"] as const;
const HARNESS_THINKING_PREFERENCE_KEYS = [
  "thinking",
  "thinking_enabled",
  "thinkingEnabled",
] as const;
const HARNESS_TASK_PREFERENCE_KEYS = ["task", "task_mode", "taskMode"] as const;
const HARNESS_SUBAGENT_PREFERENCE_KEYS = [
  "subagent",
  "subagent_mode",
  "subagentMode",
] as const;
const HARNESS_CONTENT_ID_KEYS = ["content_id", "contentId"] as const;
const HARNESS_ACCESS_MODE_KEYS = ["access_mode", "accessMode"] as const;
const HARNESS_THEME_KEYS = ["theme", "harness_theme", "harnessTheme"] as const;
const HARNESS_SESSION_MODE_KEYS = ["session_mode", "sessionMode"] as const;
const HARNESS_GATE_KEY_KEYS = ["gate_key", "gateKey"] as const;
const HARNESS_RUN_TITLE_KEYS = ["run_title", "runTitle", "title"] as const;
const HARNESS_TEAM_SELECTION_PRESET_KEYS = [
  "preferred_team_preset_id",
  "preferredTeamPresetId",
] as const;
const HARNESS_TEAM_SELECTION_ID_KEYS = [
  "selected_team_id",
  "selectedTeamId",
] as const;
const HARNESS_TEAM_SELECTION_SOURCE_KEYS = [
  "selected_team_source",
  "selectedTeamSource",
] as const;
const HARNESS_TEAM_SELECTION_LABEL_KEYS = [
  "selected_team_label",
  "selectedTeamLabel",
] as const;
const HARNESS_TEAM_SELECTION_DESCRIPTION_KEYS = [
  "selected_team_description",
  "selectedTeamDescription",
] as const;
const HARNESS_TEAM_SELECTION_SUMMARY_KEYS = [
  "selected_team_summary",
  "selectedTeamSummary",
] as const;
const HARNESS_TEAM_SELECTION_ROLE_KEYS = [
  "selected_team_roles",
  "selectedTeamRoles",
] as const;
const HARNESS_TEAM_SELECTION_KEYS = [
  ...HARNESS_TEAM_SELECTION_PRESET_KEYS,
  ...HARNESS_TEAM_SELECTION_ID_KEYS,
  ...HARNESS_TEAM_SELECTION_SOURCE_KEYS,
  ...HARNESS_TEAM_SELECTION_LABEL_KEYS,
  ...HARNESS_TEAM_SELECTION_DESCRIPTION_KEYS,
  ...HARNESS_TEAM_SELECTION_SUMMARY_KEYS,
  ...HARNESS_TEAM_SELECTION_ROLE_KEYS,
] as const;

function normalizeRuntimeIdentifier(value?: string | null): string {
  return value?.trim().toLowerCase() || "";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function omitHarnessPreferenceFromRequestMetadata(
  requestMetadata: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (!requestMetadata) {
    return requestMetadata;
  }

  const nestedHarness = requestMetadata.harness;
  const usesNestedHarness = isPlainRecord(nestedHarness);
  const harness = usesNestedHarness
    ? (nestedHarness as Record<string, unknown>)
    : requestMetadata;
  const preferences = harness.preferences;
  if (!isPlainRecord(preferences)) {
    return requestMetadata;
  }

  let changed = false;
  const nextPreferences = { ...preferences };
  for (const key of keys) {
    if (!(key in nextPreferences)) {
      continue;
    }
    delete nextPreferences[key];
    changed = true;
  }

  if (!changed) {
    return requestMetadata;
  }

  const nextHarness = { ...harness };
  if (Object.keys(nextPreferences).length === 0) {
    delete nextHarness.preferences;
  } else {
    nextHarness.preferences = nextPreferences;
  }

  if (!usesNestedHarness) {
    return nextHarness;
  }

  return {
    ...requestMetadata,
    harness: nextHarness,
  };
}

function readHarnessPreferenceFromRequestMetadata(
  requestMetadata: Record<string, unknown> | undefined,
  keys: readonly string[],
): boolean | null {
  if (!requestMetadata) {
    return null;
  }

  const nestedHarness = requestMetadata.harness;
  const harness = isPlainRecord(nestedHarness)
    ? (nestedHarness as Record<string, unknown>)
    : requestMetadata;
  const preferences = harness.preferences;
  if (!isPlainRecord(preferences)) {
    return null;
  }

  for (const key of keys) {
    if (typeof preferences[key] === "boolean") {
      return preferences[key] as boolean;
    }
  }

  return null;
}

function readHarnessStringFromRequestMetadata(
  requestMetadata: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | null {
  if (!requestMetadata) {
    return null;
  }

  const nestedHarness = requestMetadata.harness;
  const harness = isPlainRecord(nestedHarness)
    ? (nestedHarness as Record<string, unknown>)
    : requestMetadata;

  for (const key of keys) {
    if (typeof harness[key] === "string" && harness[key].trim()) {
      return harness[key] as string;
    }
  }

  return null;
}

function readHarnessArrayFromRequestMetadata(
  requestMetadata: Record<string, unknown> | undefined,
  keys: readonly string[],
): unknown[] | null {
  if (!requestMetadata) {
    return null;
  }

  const nestedHarness = requestMetadata.harness;
  const harness = isPlainRecord(nestedHarness)
    ? (nestedHarness as Record<string, unknown>)
    : requestMetadata;

  for (const key of keys) {
    if (Array.isArray(harness[key])) {
      return harness[key] as unknown[];
    }
  }

  return null;
}

function omitHarnessFieldsFromRequestMetadata(
  requestMetadata: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (!requestMetadata) {
    return requestMetadata;
  }

  const nestedHarness = requestMetadata.harness;
  const usesNestedHarness = isPlainRecord(nestedHarness);
  const harness = usesNestedHarness
    ? { ...(nestedHarness as Record<string, unknown>) }
    : { ...requestMetadata };
  let changed = false;

  for (const key of keys) {
    if (!(key in harness)) {
      continue;
    }
    delete harness[key];
    changed = true;
  }

  if (!changed) {
    return requestMetadata;
  }

  if (usesNestedHarness) {
    if (Object.keys(harness).length === 0) {
      const { harness: _removedHarness, ...rest } = requestMetadata;
      return Object.keys(rest).length > 0 ? rest : undefined;
    }
    return {
      ...requestMetadata,
      harness,
    };
  }

  return Object.keys(harness).length > 0 ? harness : undefined;
}

function normalizeComparableText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeComparableSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeComparableTeamRole(
  role: unknown,
): Record<string, unknown> | null {
  if (!isPlainRecord(role)) {
    return null;
  }

  return {
    id: normalizeComparableText(role["id"]),
    label: normalizeComparableText(role["label"]),
    summary: normalizeComparableText(role["summary"]),
    profileId: normalizeComparableText(role["profile_id"] ?? role["profileId"]),
    roleKey: normalizeComparableText(role["role_key"] ?? role["roleKey"]),
    skillIds: normalizeComparableSkillIds(
      role["skill_ids"] ?? role["skillIds"],
    ),
  };
}

function createComparableRequestTeamSelection(
  requestMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  const roles = readHarnessArrayFromRequestMetadata(
    requestMetadata,
    HARNESS_TEAM_SELECTION_ROLE_KEYS,
  );
  const normalizedRoles = roles
    ?.map((role) => normalizeComparableTeamRole(role))
    .filter((role): role is Record<string, unknown> => Boolean(role));
  const comparableSelection = {
    preferredTeamPresetId: normalizeComparableText(
      readHarnessStringFromRequestMetadata(
        requestMetadata,
        HARNESS_TEAM_SELECTION_PRESET_KEYS,
      ),
    ),
    selectedTeamId: normalizeComparableText(
      readHarnessStringFromRequestMetadata(
        requestMetadata,
        HARNESS_TEAM_SELECTION_ID_KEYS,
      ),
    ),
    selectedTeamSource: normalizeComparableText(
      readHarnessStringFromRequestMetadata(
        requestMetadata,
        HARNESS_TEAM_SELECTION_SOURCE_KEYS,
      ),
    ),
    selectedTeamLabel: normalizeComparableText(
      readHarnessStringFromRequestMetadata(
        requestMetadata,
        HARNESS_TEAM_SELECTION_LABEL_KEYS,
      ),
    ),
    selectedTeamDescription: normalizeComparableText(
      readHarnessStringFromRequestMetadata(
        requestMetadata,
        HARNESS_TEAM_SELECTION_DESCRIPTION_KEYS,
      ),
    ),
    selectedTeamSummary: normalizeComparableText(
      readHarnessStringFromRequestMetadata(
        requestMetadata,
        HARNESS_TEAM_SELECTION_SUMMARY_KEYS,
      ),
    ),
    selectedTeamRoles:
      normalizedRoles && normalizedRoles.length > 0 ? normalizedRoles : null,
  };

  return Object.values(comparableSelection).some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return value !== null;
  })
    ? comparableSelection
    : null;
}

function createComparableRuntimeTeamSelection(
  selection?: AsterSessionExecutionRuntimeRecentTeamSelection | null,
): Record<string, unknown> | null {
  if (!selection || selection.disabled) {
    return null;
  }

  const normalizedRoles = selection.selectedTeamRoles
    ?.map((role) => normalizeComparableTeamRole(role))
    .filter((role): role is Record<string, unknown> => Boolean(role));

  return {
    preferredTeamPresetId: normalizeComparableText(
      selection.preferredTeamPresetId,
    ),
    selectedTeamId: normalizeComparableText(selection.selectedTeamId),
    selectedTeamSource: normalizeComparableText(selection.selectedTeamSource),
    selectedTeamLabel: normalizeComparableText(selection.selectedTeamLabel),
    selectedTeamDescription: normalizeComparableText(
      selection.selectedTeamDescription,
    ),
    selectedTeamSummary: normalizeComparableText(selection.selectedTeamSummary),
    selectedTeamRoles:
      normalizedRoles && normalizedRoles.length > 0 ? normalizedRoles : null,
  };
}

export interface BuildSubmitOpRuntimeCompactionOptions {
  requestMetadata?: Record<string, unknown>;
  executionRuntime?: AsterSessionExecutionRuntime | null;
  syncedRecentPreferences?: ChatToolPreferences | null;
  syncedSessionModelPreference?: SessionModelPreference | null;
  syncedExecutionStrategy?: AsterExecutionStrategy | null;
  effectiveExecutionStrategy: AsterExecutionStrategy;
  effectiveProviderType: string;
  effectiveModel: string;
  modelOverride?: string;
  webSearch?: boolean;
  thinking?: boolean;
}

export interface SubmitOpRuntimeCompactionResult {
  metadata?: Record<string, unknown>;
  shouldSubmitProviderPreference: boolean;
  shouldSubmitModelPreference: boolean;
  shouldSubmitExecutionStrategy: boolean;
  shouldSubmitWebSearch: boolean;
  shouldSubmitThinking: boolean;
}

export function buildSubmitOpRuntimeCompaction(
  options: BuildSubmitOpRuntimeCompactionOptions,
): SubmitOpRuntimeCompactionResult {
  const {
    requestMetadata,
    executionRuntime,
    syncedRecentPreferences,
    syncedSessionModelPreference,
    syncedExecutionStrategy,
    effectiveExecutionStrategy,
    effectiveProviderType,
    effectiveModel,
    modelOverride,
    webSearch,
    thinking,
  } = options;

  const syncedProviderSelector =
    syncedSessionModelPreference?.providerType?.trim() || null;
  const syncedModelName = syncedSessionModelPreference?.model?.trim() || null;
  const runtimeProviderSelector =
    executionRuntime?.provider_selector?.trim() ||
    executionRuntime?.provider_name?.trim() ||
    null;
  const runtimeModelName = executionRuntime?.model_name?.trim() || null;
  const knownProviderSelector =
    syncedProviderSelector || runtimeProviderSelector;
  const knownModelName = syncedModelName || runtimeModelName;
  const shouldSubmitProviderPreference =
    !knownProviderSelector ||
    normalizeRuntimeIdentifier(knownProviderSelector) !==
      normalizeRuntimeIdentifier(effectiveProviderType);
  const shouldSubmitModelPreference =
    Boolean(modelOverride?.trim()) ||
    shouldSubmitProviderPreference ||
    !knownModelName ||
    normalizeRuntimeIdentifier(knownModelName) !==
      normalizeRuntimeIdentifier(effectiveModel);

  const knownExecutionStrategy =
    syncedExecutionStrategy?.trim() ||
    executionRuntime?.execution_strategy?.trim() ||
    null;
  const shouldSubmitExecutionStrategy =
    !knownExecutionStrategy ||
    normalizeRuntimeIdentifier(knownExecutionStrategy) !==
      normalizeRuntimeIdentifier(effectiveExecutionStrategy);

  const knownWebSearchPreference =
    typeof syncedRecentPreferences?.webSearch === "boolean"
      ? syncedRecentPreferences.webSearch
      : typeof executionRuntime?.recent_preferences?.webSearch === "boolean"
        ? executionRuntime.recent_preferences.webSearch
        : null;
  const knownTaskPreference =
    typeof syncedRecentPreferences?.task === "boolean"
      ? syncedRecentPreferences.task
      : typeof executionRuntime?.recent_preferences?.task === "boolean"
        ? executionRuntime.recent_preferences.task
        : null;
  const knownSubagentPreference =
    typeof syncedRecentPreferences?.subagent === "boolean"
      ? syncedRecentPreferences.subagent
      : typeof executionRuntime?.recent_preferences?.subagent === "boolean"
        ? executionRuntime.recent_preferences.subagent
        : null;
  const knownThinkingPreference =
    typeof syncedRecentPreferences?.thinking === "boolean"
      ? syncedRecentPreferences.thinking
      : typeof executionRuntime?.recent_preferences?.thinking === "boolean"
        ? executionRuntime.recent_preferences.thinking
        : null;
  const shouldSubmitWebSearch =
    typeof webSearch === "boolean" &&
    (knownWebSearchPreference === null ||
      knownWebSearchPreference !== webSearch);
  const shouldSubmitThinking =
    typeof thinking === "boolean" &&
    (knownThinkingPreference === null || knownThinkingPreference !== thinking);
  const requestTaskPreference = readHarnessPreferenceFromRequestMetadata(
    requestMetadata,
    HARNESS_TASK_PREFERENCE_KEYS,
  );
  const requestThinkingPreference = readHarnessPreferenceFromRequestMetadata(
    requestMetadata,
    HARNESS_THINKING_PREFERENCE_KEYS,
  );
  const requestSubagentPreference = readHarnessPreferenceFromRequestMetadata(
    requestMetadata,
    HARNESS_SUBAGENT_PREFERENCE_KEYS,
  );
  let metadata = shouldSubmitWebSearch
    ? requestMetadata
    : omitHarnessPreferenceFromRequestMetadata(
        requestMetadata,
        HARNESS_WEB_SEARCH_PREFERENCE_KEYS,
      );

  if (
    requestThinkingPreference !== null &&
    knownThinkingPreference !== null &&
    knownThinkingPreference === requestThinkingPreference
  ) {
    metadata = omitHarnessPreferenceFromRequestMetadata(
      metadata,
      HARNESS_THINKING_PREFERENCE_KEYS,
    );
  }
  if (
    requestTaskPreference !== null &&
    knownTaskPreference !== null &&
    knownTaskPreference === requestTaskPreference
  ) {
    metadata = omitHarnessPreferenceFromRequestMetadata(
      metadata,
      HARNESS_TASK_PREFERENCE_KEYS,
    );
  }
  if (
    requestSubagentPreference !== null &&
    knownSubagentPreference !== null &&
    knownSubagentPreference === requestSubagentPreference
  ) {
    metadata = omitHarnessPreferenceFromRequestMetadata(
      metadata,
      HARNESS_SUBAGENT_PREFERENCE_KEYS,
    );
  }

  if (
    JSON.stringify(createComparableRequestTeamSelection(metadata)) ===
    JSON.stringify(
      createComparableRuntimeTeamSelection(
        executionRuntime?.recent_team_selection ?? null,
      ),
    )
  ) {
    metadata = omitHarnessFieldsFromRequestMetadata(
      metadata,
      HARNESS_TEAM_SELECTION_KEYS,
    );
  }

  const requestContentId = normalizeComparableText(
    readHarnessStringFromRequestMetadata(metadata, HARNESS_CONTENT_ID_KEYS),
  );
  const knownRecentContentId = normalizeComparableText(
    executionRuntime?.recent_content_id,
  );
  if (
    requestContentId !== null &&
    knownRecentContentId !== null &&
    requestContentId === knownRecentContentId
  ) {
    metadata = omitHarnessFieldsFromRequestMetadata(
      metadata,
      HARNESS_CONTENT_ID_KEYS,
    );
  }

  const requestAccessMode = normalizeComparableText(
    readHarnessStringFromRequestMetadata(metadata, HARNESS_ACCESS_MODE_KEYS),
  );
  const knownRecentAccessMode = normalizeComparableText(
    executionRuntime?.recent_access_mode,
  );
  if (
    requestAccessMode !== null &&
    knownRecentAccessMode !== null &&
    requestAccessMode === knownRecentAccessMode
  ) {
    metadata = omitHarnessFieldsFromRequestMetadata(
      metadata,
      HARNESS_ACCESS_MODE_KEYS,
    );
  }

  const requestTheme = normalizeComparableText(
    readHarnessStringFromRequestMetadata(metadata, HARNESS_THEME_KEYS),
  );
  const knownRecentTheme = normalizeComparableText(
    executionRuntime?.recent_theme,
  );
  if (
    requestTheme !== null &&
    knownRecentTheme !== null &&
    requestTheme === knownRecentTheme
  ) {
    metadata = omitHarnessFieldsFromRequestMetadata(
      metadata,
      HARNESS_THEME_KEYS,
    );
  }

  const requestSessionMode = normalizeHarnessSessionMode(
    readHarnessStringFromRequestMetadata(metadata, HARNESS_SESSION_MODE_KEYS),
  );
  const knownRecentSessionMode = normalizeHarnessSessionMode(
    executionRuntime?.recent_session_mode,
  );
  if (
    requestSessionMode !== null &&
    knownRecentSessionMode !== null &&
    requestSessionMode === knownRecentSessionMode
  ) {
    metadata = omitHarnessFieldsFromRequestMetadata(
      metadata,
      HARNESS_SESSION_MODE_KEYS,
    );
  }

  const requestGateKey = normalizeComparableText(
    readHarnessStringFromRequestMetadata(metadata, HARNESS_GATE_KEY_KEYS),
  );
  const knownRecentGateKey = normalizeComparableText(
    executionRuntime?.recent_gate_key,
  );
  if (
    requestGateKey !== null &&
    knownRecentGateKey !== null &&
    requestGateKey === knownRecentGateKey
  ) {
    metadata = omitHarnessFieldsFromRequestMetadata(
      metadata,
      HARNESS_GATE_KEY_KEYS,
    );
  }

  const requestRunTitle = normalizeComparableText(
    readHarnessStringFromRequestMetadata(metadata, HARNESS_RUN_TITLE_KEYS),
  );
  const knownRecentRunTitle = normalizeComparableText(
    executionRuntime?.recent_run_title,
  );
  if (
    requestRunTitle !== null &&
    knownRecentRunTitle !== null &&
    requestRunTitle === knownRecentRunTitle
  ) {
    metadata = omitHarnessFieldsFromRequestMetadata(
      metadata,
      HARNESS_RUN_TITLE_KEYS,
    );
  }

  return {
    metadata,
    shouldSubmitProviderPreference,
    shouldSubmitModelPreference,
    shouldSubmitExecutionStrategy,
    shouldSubmitWebSearch,
    shouldSubmitThinking,
  };
}
