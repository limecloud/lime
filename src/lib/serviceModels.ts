import type {
  ServiceModelPreferenceConfig,
  ServiceModelsConfig,
} from "@/lib/api/appConfigTypes";

export type ServiceModelConfigKey = keyof ServiceModelsConfig;

export interface ResolvedServiceModelExecutionPreference {
  enabled: boolean;
  providerOverride?: string;
  modelOverride?: string;
  customPrompt?: string;
}

function normalizeMaybeString(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function normalizeServiceModelPreference(
  preference?: ServiceModelPreferenceConfig | null,
): ServiceModelPreferenceConfig {
  return {
    preferredProviderId: normalizeMaybeString(preference?.preferredProviderId),
    preferredModelId: normalizeMaybeString(preference?.preferredModelId),
    enabled: preference?.enabled ?? true,
    customPrompt: normalizeMaybeString(preference?.customPrompt),
  };
}

export function resolveServiceModelExecutionPreference(
  preference?: ServiceModelPreferenceConfig | null,
): ResolvedServiceModelExecutionPreference {
  const normalized = normalizeServiceModelPreference(preference);
  const enabled = normalized.enabled !== false;

  return {
    enabled,
    providerOverride: enabled ? normalized.preferredProviderId : undefined,
    modelOverride: enabled ? normalized.preferredModelId : undefined,
    customPrompt: enabled ? normalized.customPrompt : undefined,
  };
}

export function mergeServiceModelPrompt(
  ...segments: Array<string | null | undefined>
): string | undefined {
  const normalizedSegments = segments
    .map((segment) => normalizeMaybeString(segment))
    .filter((segment): segment is string => Boolean(segment));

  if (normalizedSegments.length === 0) {
    return undefined;
  }

  const dedupedSegments = normalizedSegments.filter((segment, index) => {
    return normalizedSegments.findIndex((value) => value === segment) === index;
  });

  return dedupedSegments.join("\n\n");
}

export function hasServiceModelPreferenceOverride(
  preference?: ServiceModelPreferenceConfig | null,
): boolean {
  const normalized = normalizeServiceModelPreference(preference);
  return Boolean(
    normalized.preferredProviderId ||
    normalized.preferredModelId ||
    normalized.customPrompt ||
    normalized.enabled === false,
  );
}

export function buildPersistedServiceModelPreference(
  preference?: ServiceModelPreferenceConfig | null,
): ServiceModelPreferenceConfig | undefined {
  const normalized = normalizeServiceModelPreference(preference);

  if (!normalized.preferredProviderId) {
    normalized.preferredModelId = undefined;
  }

  if (!hasServiceModelPreferenceOverride(normalized)) {
    return undefined;
  }

  return {
    preferredProviderId: normalized.preferredProviderId,
    preferredModelId: normalized.preferredModelId,
    enabled: normalized.enabled ?? true,
    customPrompt: normalized.customPrompt,
  };
}
