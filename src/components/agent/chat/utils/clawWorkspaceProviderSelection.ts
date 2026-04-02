import {
  loadConfiguredProviders,
  type ConfiguredProvider,
} from "@/hooks/useConfiguredProviders";
import { loadProviderModels } from "@/hooks/useProviderModels";
import { resolveProviderModelLoadOptions } from "@/lib/model/providerModelLoadOptions";
import { type EnhancedModelMetadata } from "@/lib/types/modelRegistry";
import { filterModelsByTheme } from "./modelThemePolicy";
import { resolveProviderModelCompatibility } from "./providerModelCompatibility";

export interface ResolveClawWorkspaceProviderSelectionInput {
  currentProviderType?: string | null;
  currentModel?: string | null;
  theme?: string;
}

export interface ClawWorkspaceProviderSelection {
  providerType: string;
  model: string;
}

function normalizeValue(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

function resolveExactModelId(
  models: EnhancedModelMetadata[],
  targetModelId?: string | null,
): string | null {
  const normalizedTarget = normalizeValue(targetModelId);
  if (!normalizedTarget) {
    return null;
  }

  const matchedModel = models.find(
    (model) => normalizeValue(model.id) === normalizedTarget,
  );
  return matchedModel?.id ?? null;
}

function resolvePreferredModelId(
  provider: ConfiguredProvider,
  models: EnhancedModelMetadata[],
  currentModel?: string | null,
  theme?: string,
): string | null {
  if (models.length === 0) {
    return null;
  }

  const themedModels = filterModelsByTheme(theme, models).models;
  const candidateModels = themedModels.length > 0 ? themedModels : models;

  if (candidateModels.length === 0) {
    return null;
  }

  const resolveCompatibleModelId = (modelId?: string | null): string | null => {
    const exactModelId = resolveExactModelId(candidateModels, modelId);
    const compatibilityResult = resolveProviderModelCompatibility({
      providerType: provider.key,
      configuredProviderType: provider.type,
      model: exactModelId ?? modelId ?? "",
    });

    return (
      resolveExactModelId(candidateModels, compatibilityResult.model) ??
      exactModelId
    );
  };

  const retainedCurrentModel = resolveCompatibleModelId(currentModel);
  if (retainedCurrentModel) {
    return retainedCurrentModel;
  }

  for (const candidateModel of candidateModels) {
    const compatibleModelId = resolveCompatibleModelId(candidateModel.id);
    if (compatibleModelId) {
      return compatibleModelId;
    }
  }

  return candidateModels[0]?.id ?? null;
}

export async function resolveClawWorkspaceProviderSelection(
  input: ResolveClawWorkspaceProviderSelectionInput,
): Promise<ClawWorkspaceProviderSelection | null> {
  const { currentProviderType, currentModel, theme } = input;
  const configuredProviders = await loadConfiguredProviders();

  if (configuredProviders.length === 0) {
    return null;
  }

  const currentProvider = configuredProviders.find(
    (provider) => provider.key === currentProviderType,
  );
  const orderedProviders = currentProvider
    ? [
        currentProvider,
        ...configuredProviders.filter(
          (provider) => provider.key !== currentProvider.key,
        ),
      ]
    : configuredProviders;

  for (const provider of orderedProviders) {
    const providerModels = await loadProviderModels(
      provider,
      resolveProviderModelLoadOptions({
        providerId: provider.providerId,
        providerType: provider.type,
        apiHost: provider.apiHost,
      }),
    );
    const preferredModel = resolvePreferredModelId(
      provider,
      providerModels,
      provider.key === currentProvider?.key ? currentModel : null,
      theme,
    );

    if (!preferredModel) {
      continue;
    }

    return {
      providerType: provider.key,
      model: preferredModel,
    };
  }

  return null;
}
