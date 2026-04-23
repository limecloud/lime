import type { OemCloudProviderModelItem } from "@/lib/api/oemCloudControlPlane";
import {
  inferInputModalities,
  inferModelAliasSource,
  inferModelCapabilities,
  inferModelDeploymentSource,
  inferModelManagementPlane,
  inferModelTaskFamilies,
  inferOutputModalities,
  inferRuntimeFeatures,
} from "@/lib/model/inferModelCapabilities";
import type {
  EnhancedModelMetadata,
  ModelTaskFamily,
} from "@/lib/types/modelRegistry";

export type OemCloudResolvedModelMetadata = Pick<
  EnhancedModelMetadata,
  | "id"
  | "provider_id"
  | "family"
  | "description"
  | "source"
  | "capabilities"
  | "task_families"
  | "input_modalities"
  | "output_modalities"
  | "runtime_features"
  | "deployment_source"
  | "management_plane"
  | "provider_model_id"
  | "canonical_model_id"
  | "alias_source"
>;

const OEM_ABILITY_TASK_FAMILY_MAP: Record<string, ModelTaskFamily[]> = {
  llm: ["chat"],
  chat: ["chat"],
  dialog: ["chat"],
  conversation: ["chat"],
  reasoning: ["chat", "reasoning"],
  vlm: ["vision_understanding"],
  vision: ["vision_understanding"],
  multimodal: ["vision_understanding"],
  omni: ["vision_understanding"],
  vision_understanding: ["vision_understanding"],
  "vision-language": ["vision_understanding"],
  image: ["image_generation"],
  image_generation: ["image_generation"],
  text_to_image: ["image_generation"],
  drawing: ["image_generation"],
  image_edit: ["image_edit"],
  edit: ["image_edit"],
  img2img: ["image_edit"],
  inpaint: ["image_edit"],
  outpaint: ["image_edit"],
  audio: ["speech_to_text", "text_to_speech"],
  speech_to_text: ["speech_to_text"],
  stt: ["speech_to_text"],
  asr: ["speech_to_text"],
  transcribe: ["speech_to_text"],
  transcription: ["speech_to_text"],
  text_to_speech: ["text_to_speech"],
  tts: ["text_to_speech"],
  speech_synthesis: ["text_to_speech"],
  embedding: ["embedding"],
  embed: ["embedding"],
  rerank: ["rerank"],
  retrieval: ["rerank"],
  moderation: ["moderation"],
  safety: ["moderation"],
};

function normalize(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function uniqueTaskFamilies(values: ModelTaskFamily[]): ModelTaskFamily[] {
  return Array.from(new Set(values));
}

function hasValues<T>(values?: T[] | null): values is T[] {
  return Array.isArray(values) && values.length > 0;
}

function stripProviderPrefix(value?: string | null): string | null {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return null;
  }

  const segments = normalized.split("/");
  return segments[segments.length - 1]?.trim() ?? null;
}

function extractProviderPrefix(value?: string | null): string | null {
  const normalized = (value ?? "").trim();
  if (!normalized || !normalized.includes("/")) {
    return null;
  }

  const [providerId] = normalized.split("/", 1);
  const nextProviderId = providerId?.trim().toLowerCase();
  return nextProviderId || null;
}

function resolveCanonicalModelId(
  model: OemCloudProviderModelItem,
): string | null {
  return model.canonical_model_id ?? model.upstreamMapping ?? null;
}

function resolveProviderModelId(model: OemCloudProviderModelItem): string {
  return model.provider_model_id ?? model.modelId;
}

function resolveInferenceProviderId(
  model: OemCloudProviderModelItem,
  canonicalModelId: string | null,
): string {
  return (
    extractProviderPrefix(canonicalModelId) ??
    extractProviderPrefix(model.provider_model_id) ??
    "oem_cloud"
  );
}

function resolveModelFamily(
  model: OemCloudProviderModelItem,
  canonicalModelId: string | null,
): string | null {
  return (
    stripProviderPrefix(canonicalModelId) ??
    stripProviderPrefix(model.provider_model_id) ??
    stripProviderPrefix(model.modelId)
  );
}

export function inferOemCloudModelTaskFamiliesFromAbilities(
  abilities?: string[] | null,
): ModelTaskFamily[] {
  return uniqueTaskFamilies(
    (abilities ?? []).flatMap((ability) => {
      const normalized = normalize(ability);
      return OEM_ABILITY_TASK_FAMILY_MAP[normalized] ?? [];
    }),
  );
}

function buildOemCloudTaxonomyParams(model: OemCloudProviderModelItem) {
  const explicitTaskFamilies = hasValues(model.task_families)
    ? model.task_families
    : inferOemCloudModelTaskFamiliesFromAbilities(model.abilities);
  const canonicalModelId = resolveCanonicalModelId(model);
  const providerModelId = resolveProviderModelId(model);
  const providerId = resolveInferenceProviderId(model, canonicalModelId);
  const aliasSource =
    model.alias_source ??
    (canonicalModelId &&
    normalize(canonicalModelId) !== normalize(providerModelId)
      ? "oem"
      : null);

  return {
    modelId: model.modelId,
    providerId,
    providerType: providerId,
    family: resolveModelFamily(model, canonicalModelId),
    description: model.description ?? null,
    explicitTaskFamilies:
      explicitTaskFamilies.length > 0 ? explicitTaskFamilies : undefined,
    explicitInputModalities: hasValues(model.input_modalities)
      ? model.input_modalities
      : undefined,
    explicitOutputModalities: hasValues(model.output_modalities)
      ? model.output_modalities
      : undefined,
    explicitRuntimeFeatures: hasValues(model.runtime_features)
      ? model.runtime_features
      : undefined,
    deploymentSource: model.deployment_source ?? "oem_cloud",
    managementPlane: model.management_plane ?? "oem_control_plane",
    providerModelId,
    canonicalModelId,
    aliasSource,
  };
}

export function createOemCloudModelMetadata(
  model: OemCloudProviderModelItem,
): OemCloudResolvedModelMetadata {
  const params = buildOemCloudTaxonomyParams(model);

  return {
    id: model.modelId,
    provider_id: params.providerId,
    family: params.family,
    description: model.description ?? null,
    source: "api",
    capabilities: inferModelCapabilities(params),
    task_families: inferModelTaskFamilies(params),
    input_modalities: inferInputModalities(params),
    output_modalities: inferOutputModalities(params),
    runtime_features: inferRuntimeFeatures(params),
    deployment_source: inferModelDeploymentSource(params),
    management_plane: inferModelManagementPlane(params),
    provider_model_id: params.providerModelId,
    canonical_model_id: params.canonicalModelId,
    alias_source: inferModelAliasSource(params),
  };
}
