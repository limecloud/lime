import { getProviderLabel } from "@/lib/constants/providerMappings";
import type {
  AsterSessionExecutionRuntime,
  AsterSessionExecutionRuntimePreferences,
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
    !recentPreferences
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
