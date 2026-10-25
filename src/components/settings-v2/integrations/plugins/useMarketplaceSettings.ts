import { useCallback, useEffect, useRef, useState } from "react";
import { getConfig } from "@/lib/api/appConfig";
import { listProjects } from "@/lib/api/project";
import {
  listPlugins,
  listInstalledPlugins,
  removeMarketplace,
  upgradeMarketplace,
  uninstallPlugin,
  PLUGIN_CATALOG_CHANGED_EVENT,
} from "@/lib/api/pluginCatalog";
import type { Config } from "@/lib/api/appConfigTypes";
import type {
  AppServerPluginMarketplaceEntry,
  AppServerPluginSummary,
} from "@/lib/api/appServerTypes";

export type SettingsMarketplace = AppServerPluginMarketplaceEntry;
export const marketplaceKey = (marketplace: SettingsMarketplace) =>
  JSON.stringify([marketplace.name, marketplace.path]);
type Removal = {
  marketplace: SettingsMarketplace;
  plugins: AppServerPluginSummary[] | null;
  completed: string[];
  error: "load" | "uninstall" | "remove" | "refresh" | null;
  saved: boolean;
};

export function useMarketplaceSettings() {
  const [marketplaces, setMarketplaces] = useState<SettingsMarketplace[]>([]);
  const [configured, setConfigured] = useState<Config["marketplaces"]>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"load" | "upgrade" | "refresh" | null>(
    null,
  );
  const [removal, setRemoval] = useState<Removal | null>(null);
  const epoch = useRef(0);
  const busy = useRef(false);
  const queued = useRef(false);
  const removalRef = useRef<Removal | null>(null);
  const failedUpgrade = useRef<{
    marketplace: SettingsMarketplace;
    saved: boolean;
  } | null>(null);
  const updateRemoval = (next: Removal | null) => {
    removalRef.current = next;
    setRemoval(next);
  };
  const read = useCallback(async () => {
    const [projects, config] = await Promise.all([
      listProjects(),
      getConfig({ forceRefresh: true }),
    ]);
    const cwds = [
      ...new Set(
        projects
          .filter((p) => !p.isArchived)
          .map((p) => p.rootPath)
          .filter(Boolean),
      ),
    ];
    const response = await listPlugins({
      cwds,
      marketplaceKinds: ["local"],
      forceRefetch: true,
    });
    if (response.marketplaceLoadErrors?.length)
      throw new Error("Incomplete marketplace catalog");
    const unique = new Map(
      response.marketplaces.map((item) => [marketplaceKey(item), item]),
    );
    return {
      marketplaces: [...unique.values()],
      configured: config.marketplaces ?? {},
      cwds,
    };
  }, []);
  const accept = useCallback((next: Awaited<ReturnType<typeof read>>) => {
    setMarketplaces(next.marketplaces);
    setConfigured(next.configured);
  }, []);
  const reload = useCallback(async () => {
    if (busy.current) return;
    const request = epoch.current;
    busy.current = true;
    queued.current = false;
    setLoading(true);
    try {
      const next = await read();
      if (request !== epoch.current) return;
      accept(next);
      setError((previous) => (previous === "load" ? null : previous));
    } catch {
      if (request === epoch.current) setError("load");
    } finally {
      if (request === epoch.current) {
        busy.current = false;
        setLoading(false);
        if (queued.current) void reload();
      }
    }
  }, [accept, read]);
  const invalidate = useCallback(() => {
    ++epoch.current;
    busy.current = false;
    queued.current = false;
  }, []);
  useEffect(() => {
    ++epoch.current;
    busy.current = false;
    setPending(false);
    removalRef.current = null;
    setRemoval(null);
    void reload();
    const changed = () => {
      queued.current = true;
      void reload();
    };
    window.addEventListener(PLUGIN_CATALOG_CHANGED_EVENT, changed);
    return () => {
      invalidate();
      window.removeEventListener(PLUGIN_CATALOG_CHANGED_EVENT, changed);
    };
  }, [invalidate, reload]);
  const canRemove = (marketplace: SettingsMarketplace) =>
    Object.hasOwn(configured ?? {}, marketplace.name) &&
    marketplaces.some(
      (item) => marketplaceKey(item) === marketplaceKey(marketplace),
    ) &&
    marketplaces.filter((item) => item.name === marketplace.name).length === 1;
  const canUpgrade = (marketplace: SettingsMarketplace) =>
    canRemove(marketplace) &&
    configured?.[marketplace.name]?.source_type === "git";

  const finish = (request: number) => {
    if (request !== epoch.current) return;
    busy.current = false;
    setPending(false);
    if (queued.current) void reload();
  };
  const prepareRemoval = async (marketplace: SettingsMarketplace) => {
    if (busy.current || !canRemove(marketplace)) return;
    const request = epoch.current;
    busy.current = true;
    setPending(true);
    const next: Removal = {
      marketplace,
      plugins: null,
      completed: [],
      error: null,
      saved: false,
    };
    updateRemoval(next);
    try {
      const catalog = await read();
      if (request !== epoch.current) return;
      const matching = catalog.marketplaces.filter(
        (item) => item.name === marketplace.name,
      );
      if (
        !Object.hasOwn(catalog.configured, marketplace.name) ||
        matching.length !== 1 ||
        marketplaceKey(matching[0]) !== marketplaceKey(marketplace)
      )
        throw new Error("Marketplace identity changed");
      const installed = await listInstalledPlugins({ cwds: catalog.cwds });
      if (request !== epoch.current) return;
      if (installed.marketplaceLoadErrors?.length)
        throw new Error("Incomplete installed plugins");
      const plugins = new Map(
        installed.marketplaces
          .filter(
            (item) => marketplaceKey(item) === marketplaceKey(marketplace),
          )
          .flatMap((item) => item.plugins)
          .filter((plugin) => plugin.installed)
          .map((plugin) => [plugin.id, plugin]),
      );
      updateRemoval({ ...next, plugins: [...plugins.values()] });
    } catch {
      if (request === epoch.current) updateRemoval({ ...next, error: "load" });
    } finally {
      finish(request);
    }
  };
  const remove = async () => {
    let next = removalRef.current;
    if (!next || next.plugins === null || busy.current) return;
    const request = epoch.current;
    busy.current = true;
    setPending(true);
    next = { ...next, error: null };
    updateRemoval(next);
    try {
      if (!next.saved) {
        for (const plugin of next.plugins!) {
          if (next.completed.includes(plugin.id)) continue;
          try {
            await uninstallPlugin({ pluginId: plugin.id });
          } catch {
            if (request === epoch.current)
              updateRemoval({ ...next, error: "uninstall" });
            return;
          }
          if (request !== epoch.current) return;
          next = { ...next, completed: [...next.completed, plugin.id] };
          updateRemoval(next);
        }
        try {
          await removeMarketplace({ marketplaceName: next.marketplace.name });
        } catch {
          if (request === epoch.current)
            updateRemoval({ ...next, error: "remove" });
          return;
        }
        if (request !== epoch.current) return;
        next = { ...next, saved: true };
        updateRemoval(next);
      }
      const catalog = await read();
      if (request !== epoch.current) return;
      accept(catalog);
      if (Object.hasOwn(catalog.configured, next.marketplace.name))
        throw new Error("Marketplace removal not confirmed");
      updateRemoval(null);
    } catch {
      if (request === epoch.current)
        updateRemoval({ ...next, error: "refresh" });
    } finally {
      finish(request);
    }
  };
  const upgrade = async (
    marketplace: SettingsMarketplace,
    confirmOnly = false,
  ) => {
    if (
      busy.current ||
      removalRef.current ||
      (!confirmOnly && !canUpgrade(marketplace))
    )
      return;
    const request = epoch.current;
    busy.current = true;
    setPending(true);
    setError(null);
    let saved = confirmOnly;
    try {
      if (!confirmOnly) {
        const result = await upgradeMarketplace({
          marketplaceName: marketplace.name,
        });
        if (request !== epoch.current) return;
        if (
          result.errors.length ||
          !result.selectedMarketplaces.includes(marketplace.name)
        )
          throw new Error("Marketplace upgrade incomplete");
        saved = true;
      }
      const catalog = await read();
      if (request !== epoch.current) return;
      accept(catalog);
      failedUpgrade.current = null;
    } catch {
      if (request === epoch.current) {
        failedUpgrade.current = { marketplace, saved };
        setError(saved ? "refresh" : "upgrade");
      }
    } finally {
      finish(request);
    }
  };
  const closeRemoval = () => {
    if (!busy.current) updateRemoval(null);
  };
  const retry = () =>
    (error === "upgrade" || error === "refresh") && failedUpgrade.current
      ? upgrade(failedUpgrade.current.marketplace, failedUpgrade.current.saved)
      : reload();
  return {
    marketplaces,
    loading,
    pending,
    error,
    reload,
    retry,
    canRemove,
    canUpgrade,
    upgrade,
    removal,
    prepareRemoval,
    remove,
    closeRemoval,
  };
}

export type MarketplaceSettingsController = ReturnType<
  typeof useMarketplaceSettings
>;
