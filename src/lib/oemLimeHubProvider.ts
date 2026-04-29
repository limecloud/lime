import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";
import type { OemCloudRuntimeContext } from "@/lib/api/oemCloudRuntime";

export const OEM_LIME_HUB_PROVIDER_ID = "lime-hub";
export const DEFAULT_OEM_LIME_HUB_PROVIDER_NAME = "Lime Hub";

const LEGACY_PROXYCAST_PROVIDER_IDS = new Set([
  "lobehub",
  "proxycast-hub",
  "proxycasthub",
]);

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(value: unknown): string {
  return normalizeText(value).replace(/\/+$/, "");
}

function withLimeTenantFragment(baseUrl: string, tenantId: string): string {
  const normalizedTenantId = normalizeText(tenantId);
  if (!baseUrl || !normalizedTenantId) {
    return baseUrl;
  }

  const url = new URL(baseUrl);
  const params = new URLSearchParams(url.hash.replace(/^#/, ""));
  params.set("lime_tenant_id", normalizedTenantId);
  url.hash = params.toString();
  return url.toString().replace(/\/#/, "#");
}

export function buildOemLimeHubApiHost(
  runtime:
    | Pick<OemCloudRuntimeContext, "gatewayBaseUrl" | "tenantId">
    | null
    | undefined,
): string | null {
  const gatewayBaseUrl = normalizeBaseUrl(runtime?.gatewayBaseUrl);
  if (!gatewayBaseUrl) {
    return null;
  }

  try {
    return withLimeTenantFragment(gatewayBaseUrl, runtime?.tenantId ?? "");
  } catch {
    return gatewayBaseUrl;
  }
}

export function resolveOemLimeHubProviderName(
  runtime: Pick<OemCloudRuntimeContext, "hubProviderName"> | null | undefined,
): string {
  return (
    normalizeText(runtime?.hubProviderName) ||
    DEFAULT_OEM_LIME_HUB_PROVIDER_NAME
  );
}

export function isLegacyProxyCastHubProvider(
  provider: Pick<ProviderWithKeysDisplay, "id" | "name" | "api_host">,
): boolean {
  const providerId = normalizeText(provider.id).toLowerCase();
  if (providerId === OEM_LIME_HUB_PROVIDER_ID) {
    return false;
  }

  if (LEGACY_PROXYCAST_PROVIDER_IDS.has(providerId)) {
    return true;
  }

  const providerName = normalizeText(provider.name).toLowerCase();
  if (providerName.includes("proxycast")) {
    return true;
  }

  const apiHost = normalizeBaseUrl(provider.api_host).toLowerCase();
  return apiHost.includes("proxycast");
}

export function isOemManagedHubProvider(
  provider: Pick<ProviderWithKeysDisplay, "id" | "name" | "api_host">,
): boolean {
  const providerId = normalizeText(provider.id).toLowerCase();
  return (
    providerId === OEM_LIME_HUB_PROVIDER_ID ||
    isLegacyProxyCastHubProvider(provider)
  );
}
