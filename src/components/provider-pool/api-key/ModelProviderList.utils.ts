import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";

export interface EnabledModelItem {
  id: string;
  provider: ProviderWithKeysDisplay;
  providerName: string;
  modelId: string | null;
  isDefault: boolean;
  enabledApiKeyCount: number;
}

function getEnabledApiKeyCount(provider: ProviderWithKeysDisplay): number {
  return provider.api_keys?.filter((apiKey) => apiKey.enabled).length ?? 0;
}

function getProviderDefaultModel(provider: ProviderWithKeysDisplay): string | null {
  return provider.custom_models?.find((model) => model.trim().length > 0)?.trim() ?? null;
}

function isKeylessLocalProvider(provider: ProviderWithKeysDisplay): boolean {
  return (
    provider.enabled &&
    provider.type === "ollama" &&
    provider.api_host.trim().length > 0
  );
}

export function isProviderVisibleInEnabledModelList(
  provider: ProviderWithKeysDisplay,
): boolean {
  if (!provider.enabled) {
    return false;
  }

  return (
    getEnabledApiKeyCount(provider) > 0 ||
    Boolean(getProviderDefaultModel(provider)) ||
    isKeylessLocalProvider(provider)
  );
}

export function buildEnabledModelItems(
  providers: ProviderWithKeysDisplay[],
): EnabledModelItem[] {
  return providers
    .filter(isProviderVisibleInEnabledModelList)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((provider, index) => ({
      id: provider.id,
      provider,
      providerName: provider.name,
      modelId: getProviderDefaultModel(provider),
      isDefault: index === 0,
      enabledApiKeyCount: getEnabledApiKeyCount(provider),
    }));
}
