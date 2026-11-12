import type {
  ProviderWithKeysDisplay,
  UpdateProviderRequest,
} from "@/lib/api/apiKeyProvider";
import {
  buildEnabledModelItems,
  type EnabledModelItem,
} from "./ModelProviderList.utils";

export interface ApiKeyProviderSectionViewModel {
  enabledModelItems: EnabledModelItem[];
}

export type ProviderSelectionPlan =
  | { type: "none" }
  | { type: "select"; providerId: string | null };

export type DeleteProviderConfigPlan =
  | { type: "missing" }
  | { type: "delete-custom"; providerId: string }
  | {
      type: "reset-system";
      providerId: string;
      apiKeyIds: string[];
      update: Pick<UpdateProviderRequest, "enabled" | "models">;
      clearSelection: boolean;
    };

export function buildApiKeyProviderSectionViewModel({ providers }: {
  providers: ProviderWithKeysDisplay[];
}): ApiKeyProviderSectionViewModel {
  return { enabledModelItems: buildEnabledModelItems(providers) };
}

export function planEnabledModelSelection({
  enabledModelItems,
  selectedProviderId,
  showAddModelFlow,
}: {
  enabledModelItems: Array<Pick<EnabledModelItem, "id" | "status">>;
  selectedProviderId: string | null;
  showAddModelFlow: boolean;
}): ProviderSelectionPlan {
  if (showAddModelFlow) {
    return { type: "none" };
  }

  if (enabledModelItems.length === 0) {
    return selectedProviderId
      ? { type: "select", providerId: null }
      : { type: "none" };
  }

  if (
    selectedProviderId &&
    enabledModelItems.some((item) => item.id === selectedProviderId)
  ) {
    return { type: "none" };
  }

  return { type: "select", providerId: enabledModelItems[0]!.id };
}

export function planDeleteProviderConfig({
  providers,
  providerId,
  selectedProviderId,
}: {
  providers: ProviderWithKeysDisplay[];
  providerId: string;
  selectedProviderId: string | null;
}): DeleteProviderConfigPlan {
  const targetProvider = providers.find((provider) => provider.id === providerId);
  if (!targetProvider) {
    return { type: "missing" };
  }

  if (!targetProvider.is_system) {
    return { type: "delete-custom", providerId };
  }

  return {
    type: "reset-system",
    providerId,
    apiKeyIds: (targetProvider.api_keys ?? []).map((apiKey) => apiKey.id),
    update: {
      enabled: false,
      models: [],
    },
    clearSelection: selectedProviderId === providerId,
  };
}
