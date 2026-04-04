import {
  apiKeyProviderApi,
  type ProviderWithKeysDisplay,
} from "@/lib/api/apiKeyProvider";
import {
  providerPoolApi,
  type ProviderPoolOverview,
} from "@/lib/api/providerPool";
import { getProviderLabel } from "@/lib/constants/providerMappings";

export interface CompanionProviderSummary {
  provider_type: string;
  display_name: string;
  total_count: number;
  healthy_count: number;
  available: boolean;
  needs_attention: boolean;
}

export interface CompanionProviderOverviewPayload {
  providers: CompanionProviderSummary[];
  total_provider_count: number;
  available_provider_count: number;
  needs_attention_provider_count: number;
}

interface LoadCompanionProviderOverviewOptions {
  forceRefresh?: boolean;
}

function buildProviderSummary(
  pool: ProviderPoolOverview,
): CompanionProviderSummary {
  const totalCount = pool.stats.total;
  const healthyCount = pool.stats.healthy;
  const hasUnhealthyCredential = pool.stats.unhealthy > 0;
  const hasDisabledCredential = pool.stats.disabled > 0;

  return {
    provider_type: pool.provider_type,
    display_name: getProviderLabel(pool.provider_type),
    total_count: totalCount,
    healthy_count: healthyCount,
    available: healthyCount > 0,
    needs_attention:
      totalCount > 0 &&
      (healthyCount === 0 || hasUnhealthyCredential || hasDisabledCredential),
  };
}

function normalizeProviderKey(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

function hasConfiguredKeylessAccess(
  provider: ProviderWithKeysDisplay,
): boolean {
  return (
    normalizeProviderKey(provider.type) === "ollama" &&
    provider.api_host.trim().length > 0
  );
}

function buildApiKeyProviderSummary(
  provider: ProviderWithKeysDisplay,
): CompanionProviderSummary | null {
  const keylessAccessConfigured = hasConfiguredKeylessAccess(provider);
  const totalCount =
    provider.api_keys.length > 0 ? provider.api_keys.length : keylessAccessConfigured ? 1 : 0;

  if (totalCount === 0) {
    return null;
  }

  const enabledApiKeyCount = provider.enabled
    ? provider.api_keys.filter((item) => item.enabled).length
    : 0;
  const healthyCount =
    enabledApiKeyCount > 0
      ? enabledApiKeyCount
      : provider.enabled && keylessAccessConfigured
        ? 1
        : 0;
  const displayName = provider.name.trim() || getProviderLabel(provider.id);

  return {
    provider_type: provider.id,
    display_name: displayName,
    total_count: totalCount,
    healthy_count: healthyCount,
    available: healthyCount > 0,
    needs_attention: totalCount > healthyCount,
  };
}

function mergeProviderSummary(
  current: CompanionProviderSummary | undefined,
  incoming: CompanionProviderSummary,
): CompanionProviderSummary {
  if (!current) {
    return incoming;
  }

  const totalCount = current.total_count + incoming.total_count;
  const healthyCount = current.healthy_count + incoming.healthy_count;

  return {
    provider_type: current.provider_type,
    display_name: current.display_name || incoming.display_name,
    total_count: totalCount,
    healthy_count: healthyCount,
    available: healthyCount > 0,
    needs_attention:
      current.needs_attention ||
      incoming.needs_attention ||
      totalCount > healthyCount,
  };
}

export function buildCompanionProviderOverview(
  overview: ProviderPoolOverview[],
  apiKeyProviders: ProviderWithKeysDisplay[] = [],
): CompanionProviderOverviewPayload {
  const providerMap = new Map<string, CompanionProviderSummary>();

  overview
    .filter((pool) => pool.stats.total > 0)
    .map(buildProviderSummary)
    .forEach((summary) => {
      const key = normalizeProviderKey(summary.provider_type);
      providerMap.set(key, mergeProviderSummary(providerMap.get(key), summary));
    });

  apiKeyProviders
    .map(buildApiKeyProviderSummary)
    .filter((summary): summary is CompanionProviderSummary => summary !== null)
    .forEach((summary) => {
      const key = normalizeProviderKey(summary.provider_type);
      providerMap.set(key, mergeProviderSummary(providerMap.get(key), summary));
    });

  const providers = Array.from(providerMap.values()).sort((left, right) =>
    left.display_name.localeCompare(right.display_name, "zh-CN"),
  );

  return {
    providers,
    total_provider_count: providers.length,
    available_provider_count: providers.filter((pool) => pool.available).length,
    needs_attention_provider_count: providers.filter(
      (pool) => pool.needs_attention,
    ).length,
  };
}

export async function loadCompanionProviderOverview(
  options: LoadCompanionProviderOverviewOptions = {},
): Promise<CompanionProviderOverviewPayload> {
  const sourceOptions = options.forceRefresh ? { forceRefresh: true } : undefined;
  const [overview, apiKeyProviders] = await Promise.all([
    providerPoolApi.getOverview(sourceOptions),
    apiKeyProviderApi.getProviders(sourceOptions),
  ]);

  return buildCompanionProviderOverview(overview, apiKeyProviders);
}
