import type { ProviderPoolOverview } from "@/lib/api/providerPool";
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

export function buildCompanionProviderOverview(
  overview: ProviderPoolOverview[],
): CompanionProviderOverviewPayload {
  const providers = overview
    .filter((pool) => pool.stats.total > 0)
    .sort((left, right) => left.provider_type.localeCompare(right.provider_type))
    .map(buildProviderSummary);

  return {
    providers,
    total_provider_count: providers.length,
    available_provider_count: providers.filter((pool) => pool.available).length,
    needs_attention_provider_count: providers.filter(
      (pool) => pool.needs_attention,
    ).length,
  };
}
