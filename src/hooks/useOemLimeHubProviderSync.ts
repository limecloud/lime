import { useEffect, useRef } from "react";
import {
  apiKeyProviderApi,
  type UpdateProviderRequest,
} from "@/lib/api/apiKeyProvider";
import {
  createClientAccessToken,
  type OemCloudBootstrapResponse,
  listClientProviderOfferModels,
} from "@/lib/api/oemCloudControlPlane";
import { resolveOemCloudRuntimeContext } from "@/lib/api/oemCloudRuntime";
import {
  getOemCloudBootstrapSnapshot,
  subscribeOemCloudBootstrapChanged,
  subscribeOemCloudSessionChanged,
} from "@/lib/oemCloudSession";
import {
  buildOemLimeHubApiHost,
  OEM_LIME_HUB_PROVIDER_ID,
  resolveOemLimeHubProviderName,
} from "@/lib/oemLimeHubProvider";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";

function buildSyncSignature(
  runtime: ReturnType<typeof resolveOemCloudRuntimeContext>,
  customModels: string[],
  localApiKeyReady: boolean,
): string {
  return JSON.stringify({
    gatewayBaseUrl: runtime?.gatewayBaseUrl ?? null,
    hubProviderName: runtime?.hubProviderName ?? null,
    tenantId: runtime?.tenantId ?? null,
    sessionToken: runtime?.sessionToken ?? null,
    customModels,
    localApiKeyReady,
  });
}

function normalizeCustomModels(
  modelIds: string[],
  defaultModel?: string,
): string[] {
  const normalized = [defaultModel ?? "", ...modelIds]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  return normalized.filter(
    (value, index) => normalized.indexOf(value) === index,
  );
}

async function resolveSyncedCustomModels(
  runtime: NonNullable<ReturnType<typeof resolveOemCloudRuntimeContext>>,
): Promise<string[]> {
  if (!runtime.sessionToken) {
    return [];
  }

  const snapshot = getOemCloudBootstrapSnapshot<OemCloudBootstrapResponse>();
  const preference = snapshot?.providerPreference;
  const offers = Array.isArray(snapshot?.providerOffersSummary)
    ? snapshot.providerOffersSummary.filter(
        (offer) => offer.source === "oem_cloud" && offer.providerKey,
      )
    : [];
  const cloudPreference =
    preference?.providerSource === "oem_cloud" && preference.providerKey
      ? preference
      : null;
  if (!cloudPreference && offers.length === 0) {
    return [];
  }

  const offerKeys = Array.from(
    new Set([
      cloudPreference?.providerKey,
      ...offers.map((offer) => offer.providerKey),
    ].filter((value): value is string => Boolean(value))),
  );
  const modelGroups = await Promise.all(
    offerKeys.map(async (providerKey) => {
      const matchedOffer = offers.find(
        (offer) => offer.providerKey === providerKey,
      );
      const models = await listClientProviderOfferModels(
        runtime.tenantId,
        providerKey,
      );
      return {
        defaultModel:
          providerKey === cloudPreference?.providerKey
            ? cloudPreference.defaultModel || matchedOffer?.defaultModel
            : matchedOffer?.defaultModel,
        modelIds: models.map((model) => model.modelId),
      };
    }),
  );

  return normalizeCustomModels(
    modelGroups.flatMap((group) => [
      group.defaultModel ?? "",
      ...group.modelIds,
    ]),
    cloudPreference?.defaultModel,
  );
}

function hasUsableLocalApiKey(provider: {
  api_key_count?: number;
  api_keys?: Array<{ enabled?: boolean }>;
}): boolean {
  if (Array.isArray(provider.api_keys)) {
    return provider.api_keys.some((apiKey) => apiKey.enabled !== false);
  }
  return (
    typeof provider.api_key_count === "number" && provider.api_key_count > 0
  );
}

async function ensureLocalLimeHubApiKey(input: {
  runtime: NonNullable<ReturnType<typeof resolveOemCloudRuntimeContext>>;
  customModels: string[];
  localApiKeyReady: boolean;
}): Promise<boolean> {
  const { runtime, customModels, localApiKeyReady } = input;
  if (localApiKeyReady || !runtime.sessionToken || customModels.length === 0) {
    return localApiKeyReady;
  }

  const response = await createClientAccessToken(runtime.tenantId, {
    name: "Lime Desktop Cloud Model Key",
    scopes: ["llm:invoke"],
    allowedModels: customModels,
  });
  const apiKey = response.apiKey || response.rawToken;
  if (!apiKey) {
    return false;
  }

  await apiKeyProviderApi.addApiKey({
    provider_id: OEM_LIME_HUB_PROVIDER_ID,
    api_key: apiKey,
    alias: "Lime 云端模型",
  });
  return true;
}

export function useOemLimeHubProviderSync() {
  const syncEnabled = hasTauriInvokeCapability();
  const lastAppliedSignatureRef = useRef<string>("");

  useEffect(() => {
    if (!syncEnabled) {
      return;
    }

    let disposed = false;

    async function syncProviders() {
      try {
        const runtime = resolveOemCloudRuntimeContext();
        if (!runtime) {
          lastAppliedSignatureRef.current = buildSyncSignature(null, [], false);
          return;
        }

        const providers = await apiKeyProviderApi.getProviders({
          forceRefresh: true,
        });
        if (disposed) {
          return;
        }

        const limeHubProvider = providers.find(
          (provider) => provider.id === OEM_LIME_HUB_PROVIDER_ID,
        );
        if (!limeHubProvider) {
          lastAppliedSignatureRef.current = buildSyncSignature(
            runtime,
            [],
            false,
          );
          return;
        }

        const nextProviderName = resolveOemLimeHubProviderName(runtime);
        const nextApiHost = buildOemLimeHubApiHost(runtime);
        const currentCustomModels = Array.isArray(limeHubProvider.custom_models)
          ? limeHubProvider.custom_models
          : [];
        let nextCustomModels: string[] = [];
        try {
          nextCustomModels = await resolveSyncedCustomModels(runtime);
        } catch (error) {
          nextCustomModels = currentCustomModels;
          console.warn(
            "[Lime 云端] 同步模型目录失败，保留现有模型配置:",
            error,
          );
        }
        if (disposed) {
          return;
        }
        const localApiKeyReady = hasUsableLocalApiKey(limeHubProvider);

        const signature = buildSyncSignature(
          runtime,
          nextCustomModels,
          localApiKeyReady,
        );
        if (lastAppliedSignatureRef.current === signature) {
          return;
        }

        const updateRequest: UpdateProviderRequest = {};

        if (limeHubProvider.name !== nextProviderName) {
          updateRequest.name = nextProviderName;
        }
        if (nextApiHost && limeHubProvider.api_host !== nextApiHost) {
          updateRequest.api_host = nextApiHost;
        }
        if (limeHubProvider.type !== "openai") {
          updateRequest.type = "openai";
        }
        if (!limeHubProvider.enabled) {
          updateRequest.enabled = true;
        }
        if (limeHubProvider.sort_order !== 0) {
          updateRequest.sort_order = 0;
        }
        const customModelsChanged =
          currentCustomModels.length !== nextCustomModels.length ||
          currentCustomModels.some(
            (modelId, index) => modelId !== nextCustomModels[index],
          );
        if (customModelsChanged) {
          updateRequest.custom_models = nextCustomModels;
        }

        if (Object.keys(updateRequest).length > 0) {
          await apiKeyProviderApi.updateProvider(
            OEM_LIME_HUB_PROVIDER_ID,
            updateRequest,
          );
        }

        const nextLocalApiKeyReady = await ensureLocalLimeHubApiKey({
          runtime,
          customModels: nextCustomModels,
          localApiKeyReady,
        });

        lastAppliedSignatureRef.current = buildSyncSignature(
          runtime,
          nextCustomModels,
          nextLocalApiKeyReady,
        );
      } catch (error) {
        console.warn("[Lime 云端] 同步 Provider 失败:", error);
      }
    }

    void syncProviders();

    const unsubscribeSession = subscribeOemCloudSessionChanged(() => {
      void syncProviders();
    });
    const unsubscribeBootstrap = subscribeOemCloudBootstrapChanged(() => {
      void syncProviders();
    });

    return () => {
      disposed = true;
      unsubscribeSession();
      unsubscribeBootstrap();
    };
  }, [syncEnabled]);
}
