import {
  getAliasConfigKey,
  isAliasProvider,
} from "@/lib/constants/providerMappings";
import { inferModelCapabilities } from "@/lib/model/inferModelCapabilities";
import type {
  EnhancedModelMetadata,
  ProviderAliasConfig,
} from "@/lib/types/modelRegistry";

export interface ProviderModelsCatalogProvider {
  key: string;
  label: string;
  registryId: string;
  fallbackRegistryId?: string;
  customModels?: string[];
}

export interface BuiltProviderModelsResult {
  modelIds: string[];
  models: EnhancedModelMetadata[];
  hasLocalModels: boolean;
}

function sortModels(models: EnhancedModelMetadata[]): EnhancedModelMetadata[] {
  return [...models].sort((a, b) => {
    if (a.is_latest && !b.is_latest) return -1;
    if (!a.is_latest && b.is_latest) return 1;

    if (a.release_date && b.release_date) {
      return b.release_date.localeCompare(a.release_date);
    }
    if (a.release_date && !b.release_date) return -1;
    if (!a.release_date && b.release_date) return 1;

    return a.display_name.localeCompare(b.display_name);
  });
}

function convertCustomModelsToMetadata(
  models: string[],
  providerId: string,
  providerName: string,
): EnhancedModelMetadata[] {
  return models.map((modelName): EnhancedModelMetadata => {
    return {
      id: modelName,
      display_name: modelName,
      provider_id: providerId,
      provider_name: providerName,
      family: null,
      tier: "pro" as const,
      capabilities: inferModelCapabilities({
        modelId: modelName,
        providerId,
      }),
      pricing: null,
      limits: {
        context_length: null,
        max_output_tokens: null,
        requests_per_minute: null,
        tokens_per_minute: null,
      },
      status: "active" as const,
      release_date: null,
      is_latest: false,
      description: `自定义模型: ${modelName}`,
      source: "custom" as const,
      created_at: Date.now() / 1000,
      updated_at: Date.now() / 1000,
    };
  });
}

function convertAliasModelsToMetadata(
  models: string[],
  aliasConfig: ProviderAliasConfig,
  providerId: string,
  providerName: string,
): EnhancedModelMetadata[] {
  return models.map((modelName): EnhancedModelMetadata => {
    const aliasInfo = aliasConfig.aliases[modelName];
    return {
      id: modelName,
      display_name: modelName,
      provider_id: providerId,
      provider_name: providerName,
      family: aliasInfo?.provider || null,
      tier: "pro" as const,
      capabilities: inferModelCapabilities({
        modelId: modelName,
        providerId: aliasInfo?.provider || providerId,
        family: aliasInfo?.provider || null,
        description: aliasInfo?.description || null,
      }),
      pricing: null,
      limits: {
        context_length: null,
        max_output_tokens: null,
        requests_per_minute: null,
        tokens_per_minute: null,
      },
      status: "active" as const,
      release_date: null,
      is_latest: false,
      description:
        aliasInfo?.description || `${aliasInfo?.actual || modelName}`,
      source: "custom" as const,
      created_at: Date.now() / 1000,
      updated_at: Date.now() / 1000,
    };
  });
}

function buildLocalProviderModels(
  selectedProvider: ProviderModelsCatalogProvider | undefined | null,
  registryModels: EnhancedModelMetadata[],
  aliasConfig: ProviderAliasConfig | null,
): BuiltProviderModelsResult {
  if (!selectedProvider) {
    return { modelIds: [], models: [], hasLocalModels: false };
  }

  let allModels: EnhancedModelMetadata[] = [];
  let allModelIds: string[] = [];

  if (selectedProvider.customModels && selectedProvider.customModels.length > 0) {
    const customModels = convertCustomModelsToMetadata(
      selectedProvider.customModels,
      selectedProvider.key,
      selectedProvider.label,
    );
    allModels = [...customModels];
    allModelIds = [...selectedProvider.customModels];
  }

  const findModelIndexById = (modelId: string): number => {
    const targetId = modelId.toLowerCase();
    return allModels.findIndex((model) => model.id.toLowerCase() === targetId);
  };

  if (isAliasProvider(selectedProvider.key) && aliasConfig) {
    const aliasModels = convertAliasModelsToMetadata(
      aliasConfig.models,
      aliasConfig,
      selectedProvider.key,
      selectedProvider.label,
    );
    const newAliasModels = aliasModels.filter(
      (model) =>
        !allModelIds.some(
          (existingModelId) =>
            existingModelId.toLowerCase() === model.id.toLowerCase(),
        ),
    );
    allModels = [...allModels, ...newAliasModels];
    allModelIds = [...allModelIds, ...newAliasModels.map((model) => model.id)];
  }

  const registryFilteredModels = registryModels.filter(
    (model) => model.provider_id === selectedProvider.registryId,
  );
  const sortedRegistryModels = sortModels(registryFilteredModels);

  for (const registryModel of sortedRegistryModels) {
    const existingIndex = findModelIndexById(registryModel.id);
    if (existingIndex >= 0) {
      allModels[existingIndex] = registryModel;
      continue;
    }

    allModels.push(registryModel);
    allModelIds.push(registryModel.id);
  }

  const hasLocalModels = Boolean(
    sortedRegistryModels.length > 0 ||
      (isAliasProvider(selectedProvider.key) &&
        aliasConfig &&
        aliasConfig.models.length > 0),
  );

  return {
    modelIds: allModelIds,
    models: allModels,
    hasLocalModels,
  };
}

export function buildProviderModelsFromRegistry(
  selectedProvider: ProviderModelsCatalogProvider | undefined | null,
  registryModels: EnhancedModelMetadata[],
  aliasConfig: ProviderAliasConfig | null,
): BuiltProviderModelsResult {
  const localResult = buildLocalProviderModels(
    selectedProvider,
    registryModels,
    aliasConfig,
  );

  if (!selectedProvider) {
    return localResult;
  }

  if (localResult.hasLocalModels || localResult.models.length > 0) {
    return localResult;
  }

  if (!selectedProvider.fallbackRegistryId) {
    return localResult;
  }

  const fallbackModels = sortModels(
    registryModels.filter(
      (model) => model.provider_id === selectedProvider.fallbackRegistryId,
    ),
  );

  if (fallbackModels.length === 0) {
    return localResult;
  }

  return {
    modelIds: fallbackModels.map((model) => model.id),
    models: fallbackModels,
    hasLocalModels: false,
  };
}

export async function loadAliasConfigForProvider(
  provider: Pick<ProviderModelsCatalogProvider, "key">,
  loadAliasConfig: (providerKey: string) => Promise<ProviderAliasConfig | null>,
): Promise<ProviderAliasConfig | null> {
  if (!isAliasProvider(provider.key)) {
    return null;
  }

  return loadAliasConfig(getAliasConfigKey(provider.key));
}
