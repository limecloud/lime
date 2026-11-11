import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import {
  CircleAlert,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type {
  AppServerPluginDetail,
  AppServerPluginSummary,
  AppServerPluginMarketplaceEntry,
} from "@/lib/api/appServerTypes";
import {
  addMarketplace,
  installPlugin,
  listPlugins,
  reconcilePlugins,
  removeMarketplace,
  readPlugin,
  setPluginEnabled,
  uninstallPlugin,
  upgradeMarketplace,
} from "@/lib/api/pluginCatalog";
import type { PluginsPageParams } from "@/types/page";
import { getProject } from "@/lib/api/project";
import {
  cloudAccountIdentity,
  getCloudAccount,
  subscribeCloudAccount,
} from "@/lib/cloudAccount";
import { PluginCatalogCard } from "./PluginCatalogCard";
import { PluginCatalogDialogs } from "./PluginCatalogDialogs";
import { PluginShareDialog } from "./PluginShareDialog";
import { mergePluginShareCatalog } from "./PluginShareViewModel";
import { listPluginShares } from "@/lib/api/pluginShare";
import { PluginDetailPanel } from "./PluginDetailPanel";
import {
  filterPluginCatalog,
  pluginCatalogEntries,
  pluginLocation,
  type PluginCatalogEntry,
  type PluginCatalogView,
} from "./PluginCatalogPageViewModel";

function groupPluginsByCategory(
  entries: PluginCatalogEntry[],
  otherLabel: string,
): Array<{ category: string; entries: PluginCatalogEntry[] }> {
  const groups = new Map<string, PluginCatalogEntry[]>();
  for (const entry of entries) {
    const category =
      entry.plugin.interface?.category?.trim() || otherLabel;
    const bucket = groups.get(category);
    if (bucket) bucket.push(entry);
    else groups.set(category, [entry]);
  }
  return [...groups.entries()].map(([category, groupEntries]) => ({
    category,
    entries: groupEntries,
  }));
}

export function PluginCatalogPage({
  pageParams,
}: {
  pageParams?: PluginsPageParams;
}) {
  const { t } = useTranslation("agent");
  const accountIdentity = useSyncExternalStore(
    subscribeCloudAccount,
    () => cloudAccountIdentity(getCloudAccount()),
    () => null,
  );
  const [marketplaces, setMarketplaces] = useState<
    AppServerPluginMarketplaceEntry[]
  >([]);
  const entries = useMemo(
    () => pluginCatalogEntries(marketplaces),
    [marketplaces],
  );
  const plugins = useMemo(
    () => entries.map((entry) => entry.plugin),
    [entries],
  );
  const [addMarketplaceOpen, setAddMarketplaceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [marketplaceRemoving, setMarketplaceRemoving] = useState<string | null>(
    null,
  );
  const [marketplaceUpgrading, setMarketplaceUpgrading] = useState<
    string | null
  >(null);
  const [marketplaceSource, setMarketplaceSource] = useState("");
  const [marketplaceAdding, setMarketplaceAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    pageParams?.selectedPluginId ?? null,
  );
  const [detail, setDetail] = useState<AppServerPluginDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(
    Boolean(pageParams?.selectedPluginId),
  );
  const [view, setView] = useState<PluginCatalogView>(
    pageParams?.statusFilter === "installed" ? "installed" : "all",
  );
  const [query, setQuery] = useState(pageParams?.query ?? "");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<PluginCatalogEntry | null>(
    null,
  );
  const [uninstallTarget, setUninstallTarget] =
    useState<AppServerPluginSummary | null>(null);
  const [shareTarget, setShareTarget] = useState<{
    entry: PluginCatalogEntry;
    accountIdentity: string;
  } | null>(null);
  const projectId = pageParams?.currentProjectId;
  const refreshRequest = useRef<symbol | null>(null);
  const catalogAccount = useRef<string | null>();

  // 侧栏在同一页面内切换目录、安装态和详情时同步路由参数。
  useEffect(() => {
    setSelectedId(pageParams?.selectedPluginId ?? null);
    setView(pageParams?.statusFilter === "installed" ? "installed" : "all");
    setQuery(pageParams?.query ?? "");
  }, [pageParams]);

  const refresh = useCallback(async () => {
    const request = Symbol();
    refreshRequest.current = request;
    setLoading(true);
    setError(null);
    try {
      const project = projectId ? await getProject(projectId) : null;
      if (request !== refreshRequest.current) return;
      const params = project?.rootPath ? { cwds: [project.rootPath] } : {};
      if (accountIdentity) {
        await reconcilePlugins({ reason: "plugin-catalog-refresh" });
        if (
          request !== refreshRequest.current ||
          accountIdentity !== cloudAccountIdentity(getCloudAccount())
        )
          return;
      }
      const response = { ...(await listPlugins(params)) };
      if (
        request !== refreshRequest.current ||
        accountIdentity !== cloudAccountIdentity(getCloudAccount())
      )
        return;
      const remoteErrors: string[] = [];
      if (accountIdentity) {
        const [remote, shares] = await Promise.allSettled([
          listPlugins({
            ...params,
            marketplaceKinds: [
              "workspace-directory",
              "created-by-me-remote",
              "shared-with-me",
            ],
          }),
          listPluginShares(),
        ]);
        if (remote.status === "fulfilled") {
          response.marketplaces = [
            ...response.marketplaces,
            ...remote.value.marketplaces,
          ];
          response.marketplaceLoadErrors = [
            ...(response.marketplaceLoadErrors ?? []),
            ...(remote.value.marketplaceLoadErrors ?? []),
          ];
        } else
          remoteErrors.push(
            remote.reason instanceof Error
              ? remote.reason.message
              : String(remote.reason),
          );
        if (shares.status === "fulfilled") {
          response.marketplaces = mergePluginShareCatalog(
            response.marketplaces,
            shares.value,
            t("plugin.share.createdByMe"),
          );
        } else
          remoteErrors.push(
            shares.reason instanceof Error
              ? shares.reason.message
              : String(shares.reason),
          );
      }
      if (request !== refreshRequest.current) return;
      if (accountIdentity !== cloudAccountIdentity(getCloudAccount())) return;
      catalogAccount.current = accountIdentity;
      setMarketplaces(response.marketplaces);
      const plugins = response.marketplaces.flatMap(
        (marketplace) => marketplace.plugins,
      );
      const loadErrors = [
        ...(response.marketplaceLoadErrors ?? []).map((error) => error.message),
        ...remoteErrors,
      ];
      if (loadErrors.length) setError(loadErrors.join("\n"));
      setSelectedId((current) => {
        if (current && plugins.some((plugin) => plugin.id === current)) {
          return current;
        }
        return plugins[0]?.id ?? null;
      });
    } catch (cause) {
      if (
        request !== refreshRequest.current ||
        accountIdentity !== cloudAccountIdentity(getCloudAccount())
      )
        return;
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
    } finally {
      if (request === refreshRequest.current) setLoading(false);
    }
  }, [projectId, accountIdentity, t]);

  useEffect(() => {
    catalogAccount.current = undefined;
    setMarketplaces([]);
    setInstallTarget(null);
    setShareTarget(null);
    setUninstallTarget(null);
    setActionMenuId(null);
    void refresh();
    return () => {
      refreshRequest.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const selected = entries.find(({ plugin }) => plugin.id === selectedId);
    if (!selected || catalogAccount.current !== accountIdentity) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    void Promise.resolve()
      .then(() =>
        readPlugin(
          pluginLocation(selected, t("plugin.catalog.v2.invalidRemoteId")),
        ),
      )
      .then((response) => {
        if (
          !cancelled &&
          accountIdentity === cloudAccountIdentity(getCloudAccount())
        ) {
          setDetail(response.plugin);
        }
      })
      .catch((cause) => {
        if (
          !cancelled &&
          accountIdentity === cloudAccountIdentity(getCloudAccount())
        ) {
          setDetail(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [entries, selectedId, accountIdentity, t]);

  const filteredPlugins = useMemo(
    () => filterPluginCatalog(entries, { query, source: "all", view }),
    [entries, query, view],
  );
  const selectedSummary =
    plugins.find((plugin) => plugin.id === selectedId) ?? null;

  const handleInstall = useCallback(async () => {
    if (!installTarget) {
      return;
    }
    const pluginId = installTarget.plugin.id;
    setBusyId(pluginId);
    try {
      const response = await installPlugin({
        ...pluginLocation(
          installTarget,
          t("plugin.catalog.v2.invalidRemoteId"),
        ),
        installAttemptId: crypto.randomUUID(),
      });
      if (accountIdentity !== cloudAccountIdentity(getCloudAccount())) return;
      await refresh();
      if (accountIdentity !== cloudAccountIdentity(getCloudAccount())) return;
      setSelectedId(pluginId);
      if (response.appsNeedingAuth.length) {
        toast.info(
          t("plugin.catalog.v2.appsNeedAuth", {
            names: response.appsNeedingAuth.map((app) => app.name).join(", "),
          }),
        );
      }
      setInstallTarget(null);
      toast.success(t("plugin.catalog.v2.installSuccess"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }, [installTarget, refresh, t, accountIdentity]);

  const handleToggle = useCallback(
    async (plugin: AppServerPluginSummary) => {
      setBusyId(plugin.id);
      setActionMenuId(null);
      try {
        if (accountIdentity !== cloudAccountIdentity(getCloudAccount())) return;
        if (plugin.source.type === "remote" && !plugin.remotePluginId) {
          throw new Error("remote plugin preference requires a plugin ID");
        }
        await setPluginEnabled(
          plugin.source.type === "remote"
            ? {
                remotePluginId: plugin.remotePluginId!,
                enabled: !plugin.enabled,
              }
            : { pluginId: plugin.id, enabled: !plugin.enabled },
        );
        await refresh();
      } catch {
        if (accountIdentity === cloudAccountIdentity(getCloudAccount())) {
          setError(t("plugin.catalog.v2.toggleFailed"));
        }
      } finally {
        setBusyId(null);
      }
    },
    [refresh, accountIdentity, t],
  );

  const handleUninstall = useCallback(async () => {
    if (!uninstallTarget) {
      return;
    }
    const pluginId = uninstallTarget.id;
    setBusyId(pluginId);
    try {
      await uninstallPlugin({ pluginId });
      await refresh();
      setSelectedId((current) => (current === pluginId ? null : current));
      setDetail(null);
      toast.success(t("plugin.catalog.v2.uninstallSuccess"));
      setUninstallTarget(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }, [refresh, t, uninstallTarget]);

  const clearError = () => setError(null);

  return (
    <div className="lime-workbench-theme-scope lime-workbench-surface-scope flex min-h-0 flex-1 flex-col overflow-auto bg-[color:var(--lime-surface-soft)]">
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-6 py-7 xl:px-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold leading-8 text-[color:var(--lime-text-strong)]">
              {t("plugin.catalog.v2.title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-[color:var(--lime-text-muted)]">
              {t("plugin.catalog.v2.description")}
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative min-w-0 sm:w-[240px]">
              <Search
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--lime-text-muted)]"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                className="h-9 w-full rounded-full border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] pl-9 pr-4 text-sm text-[color:var(--lime-text-strong)] outline-none placeholder:text-[color:var(--lime-text-muted)] focus:border-[color:var(--lime-surface-border-strong)]"
                placeholder={t("plugin.catalog.v2.searchPlaceholder")}
                aria-label={t("plugin.catalog.v2.searchLabel")}
                data-testid="plugin-catalog-search"
              />
            </label>
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] text-[color:var(--lime-text-muted)] transition hover:bg-[color:var(--lime-surface-hover)] hover:text-[color:var(--lime-text-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void refresh()}
              disabled={loading}
              title={t("plugin.catalog.v2.refresh")}
              aria-label={t("plugin.catalog.v2.refresh")}
              data-testid="plugin-catalog-refresh"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] text-[color:var(--lime-text-muted)] transition hover:bg-[color:var(--lime-surface-hover)] hover:text-[color:var(--lime-text-strong)]"
              onClick={() => setSettingsOpen(true)}
              aria-label={t("plugin.catalog.v2.settings")}
              title={t("plugin.catalog.v2.settings")}
              data-testid="plugin-catalog-settings"
            >
              <Settings size={16} />
            </button>
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[color:var(--lime-text-strong)] px-4 text-sm font-semibold text-[color:var(--lime-surface)] shadow-none hover:opacity-90"
              onClick={() => setAddMarketplaceOpen(true)}
              data-testid="plugin-catalog-add"
            >
              <Plus size={16} />
              {t("plugin.catalog.v2.add")}
            </button>
          </div>
        </header>

        <section className="flex flex-wrap items-center gap-2 border-b border-[color:var(--lime-surface-border)] pb-3">
          {(["all", "installed"] as const).map((nextView) => (
            <button
              key={nextView}
              type="button"
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition ${
                view === nextView
                  ? "bg-[color:var(--lime-surface-hover)] text-[color:var(--lime-text-strong)]"
                  : "text-[color:var(--lime-text-muted)] hover:text-[color:var(--lime-text-strong)]"
              }`}
              onClick={() => setView(nextView)}
              data-testid={`plugin-catalog-view-${nextView}`}
            >
              {t(`plugin.catalog.v2.view.${nextView}`)}
              <span className="text-xs opacity-70">
                {nextView === "all"
                  ? plugins.length
                  : plugins.filter((plugin) => plugin.installed).length}
              </span>
            </button>
          ))}
        </section>

        {error ? (
          <div
            className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
            role="alert"
            data-testid="plugin-catalog-error"
          >
            <div className="flex min-w-0 items-start gap-2">
              <CircleAlert size={17} className="mt-0.5 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-full p-1 hover:bg-rose-100"
              onClick={clearError}
              title={t("plugin.catalog.v2.dismissError")}
              aria-label={t("plugin.catalog.v2.dismissError")}
            >
              <X size={15} />
            </button>
          </div>
        ) : null}

        {loading && entries.length === 0 ? (
          <div
            className="flex min-h-[280px] items-center justify-center text-sm text-[color:var(--lime-text-muted)]"
            data-testid="plugin-catalog-loading"
          >
            <LoaderCircle size={18} className="mr-2 animate-spin" />
            {t("plugin.catalog.v2.loading")}
          </div>
        ) : filteredPlugins.length === 0 ? (
          <div
            className="flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-dashed border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] px-6 text-center"
            data-testid="plugin-catalog-empty"
          >
            <Sparkles
              size={24}
              className="text-[color:var(--lime-text-muted)]"
            />
            <p className="mt-3 text-sm font-semibold text-[color:var(--lime-text-strong)]">
              {plugins.length === 0
                ? t("plugin.catalog.v2.empty.noPlugins")
                : t("plugin.catalog.v2.empty.noMatches")}
            </p>
            <p className="mt-1 max-w-md text-sm leading-6 text-[color:var(--lime-text-muted)]">
              {t("plugin.catalog.v2.empty.description")}
            </p>
          </div>
        ) : detailOpen && selectedSummary ? (
          <PluginDetailPanel
            summary={selectedSummary}
            detail={detail}
            t={t}
            onClose={() => {
              setDetailOpen(false);
              setSelectedId(null);
            }}
            onInstall={
              selectedSummary.installed
                ? undefined
                : () => {
                    const entry = entries.find(
                      (candidate) =>
                        candidate.plugin.id === selectedSummary.id,
                    );
                    if (entry) setInstallTarget(entry);
                  }
            }
            onToggle={() => {
              void handleToggle(selectedSummary);
            }}
            onUninstall={() => setUninstallTarget(selectedSummary)}
            busy={busyId === selectedSummary.id}
          />
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-5">
            <div
              className="flex min-w-0 flex-col gap-6"
              data-testid="plugin-catalog-list"
            >
              {groupPluginsByCategory(
                filteredPlugins,
                t("plugin.catalog.v2.category.other"),
              ).map((group) => (
                <section key={group.category} className="min-w-0">
                  <h2 className="mb-3 text-[17px] font-semibold text-[color:var(--lime-text-strong)]">
                    {group.category}
                  </h2>
                  <div className="grid min-w-0 grid-cols-1 content-start gap-3 md:grid-cols-2">
                    {group.entries.map((entry) => (
                      <PluginCatalogCard
                  key={entry.plugin.id}
                  entry={entry}
                  isSelected={detailOpen && selectedId === entry.plugin.id}
                  busyId={busyId}
                  menuOpen={actionMenuId === entry.plugin.id}
                  onSelect={() => {
                    setSelectedId(entry.plugin.id);
                    setDetailOpen(true);
                  }}
                  onMenuToggle={() =>
                    setActionMenuId((current) =>
                      current === entry.plugin.id ? null : entry.plugin.id,
                    )
                  }
                  onToggle={() => void handleToggle(entry.plugin)}
                  onUninstall={() => {
                    setActionMenuId(null);
                    setUninstallTarget(entry.plugin);
                  }}
                  onInstall={() => setInstallTarget(entry)}
                  onShare={
                    accountIdentity &&
                    (entry.plugin.source.type === "local" ||
                      entry.plugin.shareContext)
                      ? () => setShareTarget({ entry, accountIdentity })
                      : undefined
                  }
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </div>

      {settingsOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/25 px-4"
          role="presentation"
        >
          <div
            className="w-full max-w-[520px] rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plugin-catalog-settings-title"
            data-testid="plugin-catalog-settings-dialog"
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                className="text-base font-semibold text-[color:var(--lime-text-strong)]"
                id="plugin-catalog-settings-title"
              >
                {t("plugin.catalog.v2.settingsTitle")}
              </h2>
              <button
                type="button"
                className="rounded-full p-1 text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)]"
                aria-label={t("plugin.catalog.v2.settingsClose")}
                onClick={() => setSettingsOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-[color:var(--lime-text-muted)]">
              {t("plugin.catalog.v2.settingsMarkets")}
            </h3>
            {marketplaces.length === 0 ? (
              <p className="mt-2 text-sm text-[color:var(--lime-text-muted)]">
                {t("plugin.catalog.v2.settingsEmpty")}
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-[color:var(--lime-surface-border)]">
                {marketplaces.map((marketplace) => (
                  <li
                    key={marketplace.name}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[color:var(--lime-text-strong)]">
                        {marketplace.interface?.displayName ||
                          marketplace.name}
                      </div>
                      <div className="truncate text-[11px] text-[color:var(--lime-text-muted)]">
                        {t("plugin.catalog.v2.settingsPluginCount", {
                          count: marketplace.plugins.length,
                        })}
                        {marketplace.path ? ` · ${marketplace.path}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-full border border-[color:var(--lime-surface-border)] px-3 py-1.5 text-xs font-medium text-[color:var(--lime-text)] disabled:opacity-50"
                      disabled={
                        marketplaceUpgrading === marketplace.name ||
                        marketplaceRemoving === marketplace.name
                      }
                      data-testid={`plugin-catalog-upgrade-marketplace-${marketplace.name}`}
                      onClick={() => {
                        if (marketplaceUpgrading || marketplaceRemoving) return;
                        setMarketplaceUpgrading(marketplace.name);
                        void upgradeMarketplace({
                          marketplaceName: marketplace.name,
                        })
                          .then(async () => {
                            toast.success(
                              t("plugin.catalog.v2.settingsUpdateSuccess"),
                            );
                            await refresh();
                          })
                          .catch(() => {
                            toast.error(
                              t("plugin.catalog.v2.settingsUpdateFailed"),
                            );
                          })
                          .finally(() => setMarketplaceUpgrading(null));
                      }}
                    >
                      {t("plugin.catalog.v2.settingsUpdate")}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded-full border border-[color:var(--lime-surface-border)] px-3 py-1.5 text-xs font-medium text-[color:var(--lime-warning)] disabled:opacity-50"
                      disabled={
                        marketplaceRemoving === marketplace.name ||
                        marketplaceUpgrading === marketplace.name
                      }
                      data-testid={`plugin-catalog-remove-marketplace-${marketplace.name}`}
                      onClick={() => {
                        if (marketplaceRemoving) return;
                        setMarketplaceRemoving(marketplace.name);
                        void removeMarketplace({
                          marketplaceName: marketplace.name,
                        })
                          .then(async () => {
                            toast.success(
                              t("plugin.catalog.v2.settingsRemoveSuccess"),
                            );
                            await refresh();
                          })
                          .catch(() => {
                            toast.error(
                              t("plugin.catalog.v2.settingsRemoveFailed"),
                            );
                          })
                          .finally(() => setMarketplaceRemoving(null));
                      }}
                    >
                      {t("plugin.catalog.v2.settingsRemove")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex items-center justify-between gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[color:var(--lime-surface-border)] px-4 text-sm font-medium text-[color:var(--lime-text)]"
                data-testid="plugin-catalog-settings-add"
                onClick={() => {
                  setSettingsOpen(false);
                  setAddMarketplaceOpen(true);
                }}
              >
                <Plus size={15} />
                {t("plugin.catalog.v2.addTitle")}
              </button>
              <button
                type="button"
                className="h-9 rounded-full border border-[color:var(--lime-surface-border)] px-4 text-sm font-medium text-[color:var(--lime-text)]"
                onClick={() => setSettingsOpen(false)}
              >
                {t("plugin.catalog.v2.settingsClose")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {addMarketplaceOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/25 px-4"
          role="presentation"
        >
          <div
            className="w-full max-w-[480px] rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plugin-catalog-add-marketplace-title"
            data-testid="plugin-catalog-add-marketplace"
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                className="text-base font-semibold text-[color:var(--lime-text-strong)]"
                id="plugin-catalog-add-marketplace-title"
              >
                {t("plugin.catalog.v2.addTitle")}
              </h2>
              <button
                type="button"
                className="rounded-full p-1 text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)]"
                aria-label={t("plugin.catalog.v2.addCancel")}
                onClick={() => setAddMarketplaceOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <label className="mt-4 block">
              <span className="text-xs font-medium text-[color:var(--lime-text-muted)]">
                {t("plugin.catalog.v2.addSourceLabel")}
              </span>
              <input
                value={marketplaceSource}
                onChange={(event) =>
                  setMarketplaceSource(event.currentTarget.value)
                }
                className="mt-1 h-10 w-full rounded-lg border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] px-3 text-sm text-[color:var(--lime-text-strong)] outline-none focus:border-[color:var(--lime-surface-border-strong)]"
                placeholder={t("plugin.catalog.v2.addSourcePlaceholder")}
                aria-label={t("plugin.catalog.v2.addSourceLabel")}
                data-testid="plugin-catalog-add-source"
              />
            </label>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="h-9 rounded-full border border-[color:var(--lime-surface-border)] px-4 text-sm font-medium text-[color:var(--lime-text)]"
                onClick={() => setAddMarketplaceOpen(false)}
              >
                {t("plugin.catalog.v2.addCancel")}
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[color:var(--lime-text-strong)] px-4 text-sm font-semibold text-[color:var(--lime-surface)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  marketplaceAdding || marketplaceSource.trim().length === 0
                }
                data-testid="plugin-catalog-add-confirm"
                onClick={() => {
                  const source = marketplaceSource.trim();
                  if (!source || marketplaceAdding) return;
                  setMarketplaceAdding(true);
                  void addMarketplace({ source })
                    .then(async () => {
                      toast.success(t("plugin.catalog.v2.addSuccess"));
                      setAddMarketplaceOpen(false);
                      setMarketplaceSource("");
                      await refresh();
                    })
                    .catch(() => {
                      toast.error(t("plugin.catalog.v2.addFailed"));
                    })
                    .finally(() => setMarketplaceAdding(false));
                }}
              >
                {marketplaceAdding ? (
                  <LoaderCircle size={15} className="animate-spin" />
                ) : null}
                {t("plugin.catalog.v2.addConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PluginCatalogDialogs
        installTarget={installTarget}
        uninstallTarget={uninstallTarget}
        busyId={busyId}
        onInstall={() => void handleInstall()}
        onUninstall={() => void handleUninstall()}
        onCancelInstall={() => setInstallTarget(null)}
        onCancelUninstall={() => setUninstallTarget(null)}
      />
      {shareTarget && shareTarget.accountIdentity === accountIdentity ? (
        <PluginShareDialog
          key={`${shareTarget.accountIdentity}:${shareTarget.entry.plugin.id}`}
          entry={shareTarget.entry}
          accountIdentity={shareTarget.accountIdentity}
          onClose={() => {
            setShareTarget(null);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}
