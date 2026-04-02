export const PROVIDER_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

export function isProviderModelsCacheExpired(
  cachedAt: number,
  now: number = Date.now(),
): boolean {
  return now - cachedAt >= PROVIDER_MODELS_CACHE_TTL_MS;
}

function normalizeCacheSegment(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

export function buildProviderModelsCacheKey(input: {
  providerId?: string | null;
  providerType?: string | null;
  apiHost?: string | null;
}): string {
  return [
    normalizeCacheSegment(input.providerId),
    normalizeCacheSegment(input.providerType),
    normalizeCacheSegment(input.apiHost),
  ].join(":");
}
