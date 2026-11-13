import type {
  AppServerAppInfo,
  AppServerInstalledApp,
  AppServerAppSummary,
  AppServerPluginDetail,
  AppServerPluginSummary,
  AppServerPluginMarketplaceEntry,
} from "@/lib/api/appServerTypes";

export type PluginCatalogView = "all" | "installed";

export interface PluginCatalogFilterState {
  query: string;
  source: string;
  view: PluginCatalogView;
}

export type PluginCatalogAppReadinessStatus = "disabled" | "pending" | "ready";

export interface PluginCatalogAppReadinessItem {
  callable: boolean;
  enabled: boolean;
  id: string;
  name: string;
  status: PluginCatalogAppReadinessStatus;
}

export interface PluginCatalogEntry {
  marketplace: AppServerPluginMarketplaceEntry;
  plugin: AppServerPluginSummary;
}

export function pluginCatalogEntries(
  marketplaces: AppServerPluginMarketplaceEntry[],
): PluginCatalogEntry[] {
  return marketplaces.flatMap((marketplace) =>
    marketplace.plugins.map((plugin) => ({ marketplace, plugin })),
  );
}

export function filterPluginCatalog(
  entries: PluginCatalogEntry[],
  filters: PluginCatalogFilterState,
): PluginCatalogEntry[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return entries.filter(({ plugin, marketplace }) => {
    if (filters.view === "installed" && !plugin.installed) return false;
    if (filters.source !== "all" && marketplace.name !== filters.source)
      return false;
    return (
      !query ||
      [
        plugin.id,
        plugin.name,
        marketplace.name,
        plugin.interface?.displayName,
        plugin.interface?.shortDescription,
        ...(plugin.keywords ?? []),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query)
    );
  });
}

export function pluginDisplayName(plugin: AppServerPluginSummary): string {
  return plugin.interface?.displayName?.trim() || plugin.name;
}

export function pluginDescription(plugin: AppServerPluginSummary): string {
  return plugin.interface?.shortDescription?.trim() || "";
}

export function pluginLocation(
  { marketplace, plugin }: PluginCatalogEntry,
  invalidMessage = "invalid remote plugin id",
) {
  if (
    !marketplace.path &&
    !/^[A-Za-z0-9_~-]+$/.test(plugin.remotePluginId ?? "")
  ) {
    throw new Error(invalidMessage);
  }
  return {
    pluginName: marketplace.path ? plugin.name : plugin.remotePluginId!,
    ...(marketplace.path
      ? { marketplacePath: marketplace.path }
      : {
          remoteMarketplaceName: marketplace.name,
          ...(plugin.remoteRelease
            ? { remoteRelease: plugin.remoteRelease }
            : {}),
        }),
  };
}

export function isSelectedReleaseInstalled(
  plugin: AppServerPluginSummary,
): boolean {
  if (!plugin.installed) return false;
  if (!plugin.remoteRelease) return true;
  const local = plugin.localRelease;
  return Boolean(
    local &&
    local.id === plugin.remoteRelease.id &&
    local.manifestSha256 === plugin.remoteRelease.manifestSha256 &&
    local.archiveSha256 === plugin.remoteRelease.archiveSha256,
  );
}

export function detailCapabilityCount(detail: AppServerPluginDetail): number {
  return (
    detail.skills.length +
    detail.mcpServers.length +
    detail.apps.length +
    detail.hooks.length
  );
}

export function projectPluginCatalogApps(
  capabilities: AppServerAppSummary[],
  catalog: AppServerAppInfo[],
  installed: AppServerInstalledApp[],
): PluginCatalogAppReadinessItem[] {
  const catalogById = new Map(catalog.map((app) => [app.id, app]));
  const installedById = new Map(installed.map((app) => [app.id, app]));

  return capabilities.map((capability) => {
    const app = catalogById.get(capability.id);
    const runtime = installedById.get(capability.id);
    const enabled = runtime?.enabled ?? app?.isEnabled ?? false;
    const callable = runtime?.callable === true;
    return {
      callable,
      enabled,
      id: capability.id,
      name: app?.name ?? capability.name,
      status: !runtime
        ? "pending"
        : !enabled
          ? "disabled"
          : callable
            ? "ready"
            : "pending",
    };
  });
}
