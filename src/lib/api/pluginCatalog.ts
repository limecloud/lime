import {
  METHOD_CONFIG_BATCH_WRITE,
  type ConfigBatchWriteParams,
  type ConfigWriteResponse,
} from "@limecloud/app-server-client";
import { invalidateAppConfigCache } from "./appConfig";
import { AppServerClient } from "@/lib/api/appServer";
import type {
  AppServerMarketplaceAddParams,
  AppServerMarketplaceAddResponse,
  AppServerMarketplaceRemoveParams,
  AppServerMarketplaceRemoveResponse,
  AppServerMarketplaceUpgradeParams,
  AppServerMarketplaceUpgradeResponse,
  AppServerPluginInstallParams,
  AppServerPluginInstallResponse,
  AppServerPluginInstalledParams,
  AppServerPluginInstalledResponse,
  AppServerPluginReconcileParams,
  AppServerPluginReconcileResponse,
  AppServerPluginListParams,
  AppServerPluginListResponse,
  AppServerPluginReadParams,
  AppServerPluginReadResponse,
  AppServerPluginSkillReadParams,
  AppServerPluginSkillReadResponse,
  AppServerRequestOptions,
  AppServerPluginUninstallParams,
  AppServerPluginUninstallResponse,
  AppServerPluginSearchParams,
  AppServerPluginSearchResponse,
} from "@/lib/api/appServerTypes";

export type PluginCatalogClient = Pick<
  AppServerClient,
  | "listPlugins"
  | "searchPlugins"
  | "request"
  | "readPlugin"
  | "installPlugin"
  | "uninstallPlugin"
  | "listInstalledPlugins"
  | "requestCloud"
  | "readAccount"
>;

export const PLUGIN_CATALOG_CHANGED_EVENT = "lime:plugin-catalog-changed";

export async function reconcilePlugins(
  params: AppServerPluginReconcileParams = {},
  client: Pick<AppServerClient, "reconcilePlugins"> = new AppServerClient(),
): Promise<AppServerPluginReconcileResponse> {
  const response = (await client.reconcilePlugins(params)).result;
  invalidateAppConfigCache();
  emitPluginCatalogChanged();
  return response;
}

export function emitPluginCatalogChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PLUGIN_CATALOG_CHANGED_EVENT));
  }
}

export async function listPlugins(
  params: AppServerPluginListParams = {},
  client: PluginCatalogClient = new AppServerClient(),
): Promise<AppServerPluginListResponse> {
  return (await client.listPlugins(params)).result;
}

export async function searchPluginCatalog(
  params: AppServerPluginSearchParams,
  client: PluginCatalogClient = new AppServerClient(),
): Promise<AppServerPluginSearchResponse> {
  return (await client.searchPlugins(params)).result;
}

export async function setPluginEnabled(
  params: { pluginId: string; enabled: boolean },
  client: Pick<AppServerClient, "request"> = new AppServerClient(),
): Promise<void> {
  await client.request<ConfigWriteResponse>(METHOD_CONFIG_BATCH_WRITE, {
    edits: [{ keyPath: `plugins.${JSON.stringify(params.pluginId)}.enabled`, value: params.enabled, mergeStrategy: "replace" }],
    reloadUserConfig: true,
  } satisfies ConfigBatchWriteParams);
  invalidateAppConfigCache();
  emitPluginCatalogChanged();
}

export async function setPluginSkillEnabled(
  params: { path: string; enabled: boolean },
  client: Pick<AppServerClient, "writeSkillsConfig"> = new AppServerClient(),
): Promise<void> {
  await client.writeSkillsConfig(params);
  emitPluginCatalogChanged();
}

export async function readPlugin(
  params: AppServerPluginReadParams,
  client: PluginCatalogClient = new AppServerClient(),
): Promise<AppServerPluginReadResponse> {
  return (await client.readPlugin(params)).result;
}

export async function readPluginSkill(
  params: AppServerPluginSkillReadParams,
  options?: AppServerRequestOptions,
  client: Pick<AppServerClient, "readPluginSkill"> = new AppServerClient(),
): Promise<AppServerPluginSkillReadResponse> {
  return (await client.readPluginSkill(params, options)).result;
}

export async function installPlugin(
  params: AppServerPluginInstallParams,
  client: PluginCatalogClient = new AppServerClient(),
): Promise<AppServerPluginInstallResponse> {
  const result = (await client.installPlugin(params)).result;
  emitPluginCatalogChanged();
  return result;
}

export async function uninstallPlugin(
  params: AppServerPluginUninstallParams,
  client: PluginCatalogClient = new AppServerClient(),
): Promise<AppServerPluginUninstallResponse> {
  const result = (await client.uninstallPlugin(params)).result;
  emitPluginCatalogChanged();
  return result;
}

export async function listInstalledPlugins(
  params: AppServerPluginInstalledParams = {},
  client: PluginCatalogClient = new AppServerClient(),
): Promise<AppServerPluginInstalledResponse> {
  return (await client.listInstalledPlugins(params)).result;
}

export type MarketplaceClient = Pick<
  AppServerClient,
  "addMarketplace" | "removeMarketplace" | "upgradeMarketplace"
>;

export async function addMarketplace(
  params: AppServerMarketplaceAddParams,
  client: MarketplaceClient = new AppServerClient(),
): Promise<AppServerMarketplaceAddResponse> {
  const result = (await client.addMarketplace(params)).result;
  invalidateAppConfigCache();
  emitPluginCatalogChanged();
  return result;
}

export async function removeMarketplace(
  params: AppServerMarketplaceRemoveParams,
  client: MarketplaceClient = new AppServerClient(),
): Promise<AppServerMarketplaceRemoveResponse> {
  const result = (await client.removeMarketplace(params)).result;
  invalidateAppConfigCache();
  emitPluginCatalogChanged();
  return result;
}

export async function upgradeMarketplace(
  params: AppServerMarketplaceUpgradeParams,
  client: MarketplaceClient = new AppServerClient(),
): Promise<AppServerMarketplaceUpgradeResponse> {
  const result = (await client.upgradeMarketplace(params)).result;
  invalidateAppConfigCache();
  emitPluginCatalogChanged();
  return result;
}
