import type { SessionModelPreference } from "@/components/agent/chat/hooks/agentChatShared";
import {
  GLOBAL_MODEL_PREF_KEY,
  GLOBAL_PROVIDER_PREF_KEY,
  getAgentPreferenceKeys,
  loadPersistedString,
  resolveWorkspaceAgentPreferences,
} from "@/components/agent/chat/hooks/agentChatStorage";
import { createSessionModelPreferenceFromExecutionRuntime } from "@/components/agent/chat/utils/sessionExecutionRuntime";
import {
  getAgentRuntimeSession,
  listAgentRuntimeSessions,
} from "@/lib/api/agentRuntime";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";
import type { CompanionDefaultsConfig, Config } from "@/lib/api/appConfigTypes";
import {
  normalizeMediaGenerationPreference,
  type MediaGenerationPreference,
} from "@/lib/mediaGeneration";

export interface ResolvedCompanionQuickActionTarget {
  provider: ProviderWithKeysDisplay;
  modelName?: string;
  source: "companion-config" | "current-agent" | "auto";
}

function normalizeProviderId(value?: string | null): string {
  return value?.trim().toLowerCase() || "";
}

function hasEnabledApiKey(provider: ProviderWithKeysDisplay): boolean {
  return provider.enabled && provider.api_keys.some((item) => item.enabled);
}

function isKeylessChatProvider(provider: ProviderWithKeysDisplay): boolean {
  return (
    provider.enabled &&
    normalizeProviderId(provider.type) === "ollama" &&
    provider.api_host.trim().length > 0
  );
}

function findUsableProvider(
  providers: ProviderWithKeysDisplay[],
  providerId?: string | null,
): ProviderWithKeysDisplay | null {
  const normalizedProviderId = normalizeProviderId(providerId);
  if (!normalizedProviderId) {
    return null;
  }

  const provider =
    providers.find(
      (item) => normalizeProviderId(item.id) === normalizedProviderId,
    ) ?? null;

  if (!provider || !canUseCompanionQuickActionProvider(provider)) {
    return null;
  }

  return provider;
}

function loadPersistedCurrentAgentPreference(): SessionModelPreference | null {
  const { providerKey, modelKey } = getAgentPreferenceKeys(undefined);
  const rawProvider =
    loadPersistedString(providerKey) ||
    loadPersistedString("agent_pref_provider") ||
    loadPersistedString(GLOBAL_PROVIDER_PREF_KEY);
  const rawModel =
    loadPersistedString(modelKey) ||
    loadPersistedString("agent_pref_model") ||
    loadPersistedString(GLOBAL_MODEL_PREF_KEY);

  if (!rawProvider || !rawModel) {
    return null;
  }

  return resolveWorkspaceAgentPreferences(undefined);
}

async function loadRuntimeCurrentAgentPreference(): Promise<SessionModelPreference | null> {
  try {
    const latestSession = [...(await listAgentRuntimeSessions())].sort(
      (left, right) => right.updated_at - left.updated_at,
    )[0];

    if (!latestSession) {
      return null;
    }

    const detail = await getAgentRuntimeSession(latestSession.id);
    return createSessionModelPreferenceFromExecutionRuntime(
      detail.execution_runtime,
    );
  } catch (error) {
    console.warn(
      "[Companion] 读取最近当前 provider/model 失败，改用本地与自动回退:",
      error,
    );
    return null;
  }
}

export function getCompanionDefaultsFromConfig(
  config?: Pick<Config, "workspace_preferences"> | null,
): CompanionDefaultsConfig {
  return config?.workspace_preferences?.companion_defaults ?? {};
}

export function canUseCompanionQuickActionProvider(
  provider: ProviderWithKeysDisplay,
): boolean {
  return hasEnabledApiKey(provider) || isKeylessChatProvider(provider);
}

export function selectCompanionQuickActionProvider(
  providers: ProviderWithKeysDisplay[],
): ProviderWithKeysDisplay | null {
  return (
    [...providers]
      .filter((provider) => canUseCompanionQuickActionProvider(provider))
      .sort((left, right) => {
        if (left.sort_order !== right.sort_order) {
          return left.sort_order - right.sort_order;
        }
        return left.name.localeCompare(right.name, "zh-CN");
      })[0] ?? null
  );
}

export async function loadCurrentCompanionAgentPreference(): Promise<SessionModelPreference | null> {
  const runtimePreference = await loadRuntimeCurrentAgentPreference();
  if (runtimePreference) {
    return runtimePreference;
  }

  return loadPersistedCurrentAgentPreference();
}

export async function resolveCompanionQuickActionTarget(
  providers: ProviderWithKeysDisplay[],
  preference?: MediaGenerationPreference | null,
): Promise<ResolvedCompanionQuickActionTarget | null> {
  const normalizedPreference = normalizeMediaGenerationPreference(preference);

  if (normalizedPreference.preferredProviderId) {
    const configuredProvider = findUsableProvider(
      providers,
      normalizedPreference.preferredProviderId,
    );

    if (configuredProvider) {
      return {
        provider: configuredProvider,
        modelName: normalizedPreference.preferredModelId,
        source: "companion-config",
      };
    }

    if (normalizedPreference.allowFallback === false) {
      throw new Error(
        `桌宠通用模型 Provider 不可用：${normalizedPreference.preferredProviderId}`,
      );
    }
  }

  const currentPreference = await loadCurrentCompanionAgentPreference();
  if (currentPreference) {
    const currentProvider = findUsableProvider(
      providers,
      currentPreference.providerType,
    );
    if (currentProvider) {
      return {
        provider: currentProvider,
        modelName: currentPreference.model,
        source: "current-agent",
      };
    }
  }

  const autoProvider = selectCompanionQuickActionProvider(providers);
  if (!autoProvider) {
    return null;
  }

  return {
    provider: autoProvider,
    source: "auto",
  };
}
