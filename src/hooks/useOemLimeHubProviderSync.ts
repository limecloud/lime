import { useEffect, useRef } from "react";
import { apiKeyProviderApi, type UpdateProviderRequest } from "@/lib/api/apiKeyProvider";
import {
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
): string {
  return JSON.stringify({
    gatewayBaseUrl: runtime?.gatewayBaseUrl ?? null,
    hubProviderName: runtime?.hubProviderName ?? null,
    tenantId: runtime?.tenantId ?? null,
    sessionToken: runtime?.sessionToken ?? null,
    customModels,
  });
}

function normalizeCustomModels(
  modelIds: string[],
  defaultModel?: string,
): string[] {
  const normalized = [defaultModel ?? "", ...modelIds]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  return normalized.filter((value, index) => normalized.indexOf(value) === index);
}

async function resolveSyncedCustomModels(
  runtime: NonNullable<ReturnType<typeof resolveOemCloudRuntimeContext>>,
): Promise<string[]> {
  if (!runtime.sessionToken) {
    return [];
  }

  const snapshot =
    getOemCloudBootstrapSnapshot<OemCloudBootstrapResponse>();
  const preference = snapshot?.providerPreference;
  if (preference?.providerSource !== "oem_cloud" || !preference.providerKey) {
    return [];
  }

  const matchedOffer = snapshot?.providerOffersSummary?.find(
    (offer) => offer.providerKey === preference.providerKey,
  );
  const models = await listClientProviderOfferModels(
    runtime.tenantId,
    preference.providerKey,
  );

  return normalizeCustomModels(
    models.map((model) => model.modelId),
    preference.defaultModel || matchedOffer?.defaultModel,
  );
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
          lastAppliedSignatureRef.current = buildSyncSignature(null, []);
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
          lastAppliedSignatureRef.current = buildSyncSignature(runtime, []);
          return;
        }

        const nextProviderName = resolveOemLimeHubProviderName(runtime);
        const nextApiHost = buildOemLimeHubApiHost(runtime);
        let nextCustomModels: string[] = [];
        try {
          nextCustomModels = await resolveSyncedCustomModels(runtime);
        } catch (error) {
          console.warn("[OEM] 同步云端模型目录失败，保留现有内部模型配置:", error);
        }
        if (disposed) {
          return;
        }

        const signature = buildSyncSignature(runtime, nextCustomModels);
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
        const currentCustomModels = Array.isArray(limeHubProvider.custom_models)
          ? limeHubProvider.custom_models
          : [];
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

        lastAppliedSignatureRef.current = signature;
      } catch (error) {
        console.warn("[OEM] 同步 Lime Hub Provider 失败:", error);
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
