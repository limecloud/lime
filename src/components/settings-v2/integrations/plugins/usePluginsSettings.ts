import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { listProjects } from "@/lib/api/project";
import {
  listInstalledPlugins,
  PLUGIN_CATALOG_CHANGED_EVENT,
  setPluginEnabled,
  uninstallPlugin,
} from "@/lib/api/pluginCatalog";
import type { AppServerPluginSummary } from "@/lib/api/appServerTypes";
import {
  cloudAccountIdentity,
  cloudAccountIdentityVersion,
  getCloudAccount,
  subscribeCloudAccount,
} from "@/lib/cloudAccount";

export function usePluginsSettings() {
  const accountVersion = useSyncExternalStore(
    subscribeCloudAccount,
    cloudAccountIdentityVersion,
    () => 0,
  );
  const identity = cloudAccountIdentity(getCloudAccount());
  const [plugins, setPlugins] = useState<AppServerPluginSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<
    "load" | "save" | "refresh" | "overridden" | null
  >(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const queued = useRef(false);
  const unconfirmed = useRef<{ id: string; enabled?: boolean } | null>(null);
  const roots = useRef<string[]>([]);

  const read = useCallback(async (cwds: string[]) => {
    const response = await listInstalledPlugins(cwds.length ? { cwds } : {});
    // 多个项目可能发现同一安装；启停与卸载始终按 canonical ID 去重。
    const installed = new Map<string, AppServerPluginSummary>();
    for (const marketplace of response.marketplaces) {
      for (const plugin of marketplace.plugins) {
        if (plugin.installed && !installed.has(plugin.id))
          installed.set(plugin.id, plugin);
      }
    }
    return {
      plugins: [...installed.values()],
      errors: response.marketplaceLoadErrors ?? [],
    };
  }, []);

  const accept = useCallback((next: AppServerPluginSummary[]) => {
    setPlugins(next);
    const expected = unconfirmed.current;
    unconfirmed.current = null;
    const effective =
      expected && next.find((plugin) => plugin.id === expected.id);
    const confirmed =
      !expected ||
      (expected.enabled === undefined
        ? !effective
        : effective?.enabled === expected.enabled);
    setError(confirmed ? null : "overridden");
    return confirmed;
  }, []);

  const reload = useCallback(async () => {
    if (busy.current) return null;
    const request = ++generation.current;
    busy.current = true;
    queued.current = false;
    setLoading(true);
    setError(null);
    try {
      const projects = await listProjects();
      if (generation.current !== request) return null;
      const cwds = [
        ...new Set(
          projects
            .filter((project) => !project.isArchived)
            .map((project) => project.rootPath)
            .filter(Boolean),
        ),
      ];
      const response = await read(cwds);
      if (
        generation.current !== request ||
        identity !== cloudAccountIdentity(getCloudAccount()) ||
        accountVersion !== cloudAccountIdentityVersion()
      )
        return null;
      roots.current = cwds;
      if (response.errors.length) {
        setError(unconfirmed.current ? "refresh" : "load");
        return null;
      }
      accept(response.plugins);
      return response.plugins;
    } catch {
      if (generation.current === request)
        setError(unconfirmed.current ? "refresh" : "load");
      return null;
    } finally {
      if (generation.current === request) {
        busy.current = false;
        setLoading(false);
        if (queued.current) void reload();
      }
    }
  }, [accountVersion, identity, read, accept]);

  const invalidate = useCallback(() => {
    ++generation.current;
    busy.current = false;
    queued.current = false;
    unconfirmed.current = null;
  }, []);

  useEffect(() => {
    busy.current = false;
    setPending(false);
    setPlugins([]);
    void reload();
    const onChange = () => {
      queued.current = true;
      if (!busy.current) void reload();
    };
    window.addEventListener(PLUGIN_CATALOG_CHANGED_EVENT, onChange);
    return () => {
      invalidate();
      window.removeEventListener(PLUGIN_CATALOG_CHANGED_EVENT, onChange);
    };
  }, [reload, invalidate]);

  const mutate = async (plugin: AppServerPluginSummary, enabled?: boolean) => {
    if (
      busy.current ||
      unconfirmed.current ||
      identity !== cloudAccountIdentity(getCloudAccount()) ||
      accountVersion !== cloudAccountIdentityVersion()
    )
      return false;
    const installed = plugins.find((item) => item.id === plugin.id);
    if (
      !installed ||
      installed.availability === "DISABLED_BY_ADMIN" ||
      installed.disabledReason === "disabled_by_admin"
    )
      return false;
    const request = generation.current;
    busy.current = true;
    setPending(true);
    setError(null);
    let saved = false;
    try {
      if (enabled === undefined)
        await uninstallPlugin({ pluginId: installed.id });
      else if (installed.source.type === "remote") {
        if (!installed.remotePluginId)
          throw new Error("Remote plugin identity unavailable");
        await setPluginEnabled({
          remotePluginId: installed.remotePluginId,
          enabled,
        });
      } else await setPluginEnabled({ pluginId: installed.id, enabled });
      saved = true;
      if (
        generation.current !== request ||
        identity !== cloudAccountIdentity(getCloudAccount()) ||
        accountVersion !== cloudAccountIdentityVersion()
      )
        return false;
      unconfirmed.current = { id: installed.id, enabled };
      // 写入结束前的通知由接下来的完整读回覆盖，读取期间的新通知仍需补读。
      queued.current = false;
      const response = await read(roots.current);
      if (
        generation.current !== request ||
        identity !== cloudAccountIdentity(getCloudAccount()) ||
        accountVersion !== cloudAccountIdentityVersion()
      )
        return false;
      if (response.errors.length) {
        setError("refresh");
        return false;
      }
      return accept(response.plugins);
    } catch {
      if (generation.current === request) setError(saved ? "refresh" : "save");
      return false;
    } finally {
      if (generation.current === request) {
        busy.current = false;
        setPending(false);
        if (queued.current) void reload();
      }
    }
  };

  return {
    accountVersion,
    plugins,
    loading,
    pending,
    awaitingConfirmation: unconfirmed.current !== null,
    error,
    clearError: () => setError(null),
    reload,
    mutate,
  };
}
