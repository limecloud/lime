import type {
  RunSiteAdapterRequest,
  SavedSiteAdapterContent,
  SaveSiteAdapterResultRequest,
  SiteAdapterCatalogStatus,
  SiteAdapterDefinition,
  SiteAdapterImportResult,
  SiteAdapterImportYamlBundleRequest,
  SiteAdapterLaunchReadinessRequest,
  SiteAdapterLaunchReadinessResult,
  SiteAdapterRecommendation,
  SiteAdapterRunResult,
} from "@/lib/webview-api";
import {
  invokeAgentRuntimeBridge,
  type AgentRuntimeBridgeInvoke,
} from "./transport";

export interface AgentRuntimeSiteClientDeps {
  bridgeInvoke?: AgentRuntimeBridgeInvoke;
}

export function createSiteClient({
  bridgeInvoke = invokeAgentRuntimeBridge,
}: AgentRuntimeSiteClientDeps = {}) {
  async function siteListAdapters(): Promise<SiteAdapterDefinition[]> {
    return await bridgeInvoke("site_list_adapters");
  }

  async function siteRecommendAdapters(
    limit?: number,
  ): Promise<SiteAdapterRecommendation[]> {
    return await bridgeInvoke("site_recommend_adapters", {
      request: { limit },
    });
  }

  async function siteSearchAdapters(
    query: string,
  ): Promise<SiteAdapterDefinition[]> {
    return await bridgeInvoke("site_search_adapters", {
      request: { query },
    });
  }

  async function siteGetAdapterInfo(
    name: string,
  ): Promise<SiteAdapterDefinition> {
    return await bridgeInvoke("site_get_adapter_info", {
      request: { name },
    });
  }

  async function siteGetAdapterLaunchReadiness(
    request: SiteAdapterLaunchReadinessRequest,
  ): Promise<SiteAdapterLaunchReadinessResult> {
    return await bridgeInvoke("site_get_adapter_launch_readiness", {
      request,
    });
  }

  async function siteGetAdapterCatalogStatus(): Promise<SiteAdapterCatalogStatus> {
    return await bridgeInvoke("site_get_adapter_catalog_status");
  }

  async function siteApplyAdapterCatalogBootstrap(
    payload: unknown,
  ): Promise<SiteAdapterCatalogStatus> {
    return await bridgeInvoke("site_apply_adapter_catalog_bootstrap", {
      request: {
        payload,
      },
    });
  }

  async function siteClearAdapterCatalogCache(): Promise<SiteAdapterCatalogStatus> {
    return await bridgeInvoke("site_clear_adapter_catalog_cache");
  }

  async function siteImportAdapterYamlBundle(
    request: SiteAdapterImportYamlBundleRequest,
  ): Promise<SiteAdapterImportResult> {
    return await bridgeInvoke("site_import_adapter_yaml_bundle", {
      request,
    });
  }

  async function siteRunAdapter(
    request: RunSiteAdapterRequest,
  ): Promise<SiteAdapterRunResult> {
    return await bridgeInvoke("site_run_adapter", { request });
  }

  async function siteDebugRunAdapter(
    request: RunSiteAdapterRequest,
  ): Promise<SiteAdapterRunResult> {
    return await bridgeInvoke("site_debug_run_adapter", {
      request,
    });
  }

  async function siteSaveAdapterResult(
    request: SaveSiteAdapterResultRequest,
  ): Promise<SavedSiteAdapterContent> {
    return await bridgeInvoke("site_save_adapter_result", {
      request,
    });
  }

  return {
    siteApplyAdapterCatalogBootstrap,
    siteClearAdapterCatalogCache,
    siteDebugRunAdapter,
    siteGetAdapterCatalogStatus,
    siteGetAdapterInfo,
    siteGetAdapterLaunchReadiness,
    siteImportAdapterYamlBundle,
    siteListAdapters,
    siteRecommendAdapters,
    siteRunAdapter,
    siteSaveAdapterResult,
    siteSearchAdapters,
  };
}

export const {
  siteApplyAdapterCatalogBootstrap,
  siteClearAdapterCatalogCache,
  siteDebugRunAdapter,
  siteGetAdapterCatalogStatus,
  siteGetAdapterInfo,
  siteGetAdapterLaunchReadiness,
  siteImportAdapterYamlBundle,
  siteListAdapters,
  siteRecommendAdapters,
  siteRunAdapter,
  siteSaveAdapterResult,
  siteSearchAdapters,
} = createSiteClient();
