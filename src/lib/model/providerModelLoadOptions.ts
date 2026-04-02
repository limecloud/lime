import { getProviderModelAutoFetchCapability } from "./providerModelFetchSupport";

export interface ProviderModelLoadOptionInput {
  providerId?: string | null;
  providerType?: string | null;
  apiHost?: string | null;
}

export interface ProviderModelLoadOptions {
  liveFetchOnly: boolean;
  hasApiKey: boolean;
}

function hasManagedProviderId(providerId?: string | null): boolean {
  return (providerId || "").trim().length > 0;
}

export function resolveProviderModelLoadOptions(
  input?: ProviderModelLoadOptionInput | null,
): ProviderModelLoadOptions {
  if (!input) {
    return {
      liveFetchOnly: false,
      hasApiKey: false,
    };
  }

  const managedProvider = hasManagedProviderId(input.providerId);
  const capability = getProviderModelAutoFetchCapability({
    providerId: input.providerId,
    providerType: input.providerType,
    apiHost: input.apiHost,
  });

  return {
    liveFetchOnly: managedProvider && capability.supported,
    hasApiKey: managedProvider,
  };
}
