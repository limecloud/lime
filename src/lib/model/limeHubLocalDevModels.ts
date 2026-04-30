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
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";

export const LIME_HUB_LOCAL_DEV_MODEL_IDS = ["gpt-5.5", "gpt-5.4"];

interface LimeHubModelProviderInput {
  key: string;
  label: string;
  registryId: string;
  providerId?: string | null;
  type?: string | null;
}

export function shouldUseLimeHubLocalDevModels(): boolean {
  return Boolean(import.meta.env.DEV);
}

export function isLimeHubProviderId(
  key?: string | null,
  providerId?: string | null,
): boolean {
  return [key, providerId]
    .map((value) => (value || "").trim().toLowerCase())
    .includes("lime-hub");
}

export function buildLimeHubLocalDevModels(
  provider: LimeHubModelProviderInput,
): EnhancedModelMetadata[] {
  const now = Date.now() / 1000;
  const providerId = provider.registryId || provider.key;
  const providerName = provider.label || "Lime Hub";

  return LIME_HUB_LOCAL_DEV_MODEL_IDS.map((modelId) => {
    const taxonomyParams = {
      modelId,
      providerId,
      providerType: provider.type,
      deploymentSource: "oem_cloud" as const,
      managementPlane: "oem_control_plane" as const,
      aliasSource: "oem" as const,
    };

    return {
      id: modelId,
      display_name: modelId,
      provider_id: providerId,
      provider_name: providerName,
      family: null,
      tier: "pro" as const,
      capabilities: inferModelCapabilities(taxonomyParams),
      task_families: inferModelTaskFamilies(taxonomyParams),
      input_modalities: inferInputModalities(taxonomyParams),
      output_modalities: inferOutputModalities(taxonomyParams),
      runtime_features: inferRuntimeFeatures(taxonomyParams),
      deployment_source: inferModelDeploymentSource(taxonomyParams),
      management_plane: inferModelManagementPlane(taxonomyParams),
      canonical_model_id: null,
      provider_model_id: modelId,
      alias_source: inferModelAliasSource(taxonomyParams),
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
        "本地开发环境 Lime Hub 模型 mock，仅用于云端目录未就绪时验证模型选择器；正式版不会注入。",
      source: "local" as const,
      created_at: now,
      updated_at: now,
    };
  });
}
