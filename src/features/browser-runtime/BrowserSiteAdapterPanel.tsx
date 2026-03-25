import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listProjects, type Project } from "@/lib/api/project";
import {
  getStoredResourceProjectId,
  onResourceProjectChange,
  setStoredResourceProjectId,
} from "@/lib/resourceProjectSelection";
import type {
  BrowserProfileRecord,
  RunSiteAdapterRequest,
  SavedSiteAdapterContent,
  SiteAdapterDefinition,
  SiteAdapterCatalogStatus,
  SiteAdapterRunResult,
} from "./api";
import type { Page, PageParams } from "@/types/page";
import { browserRuntimeApi } from "./api";

type BrowserSiteAdapterPanelVariant = "workspace" | "debug";

interface BrowserSiteAdapterPanelProps {
  selectedProfileKey?: string;
  onMessage?: (message: { type: "success" | "error"; text: string }) => void;
  variant?: BrowserSiteAdapterPanelVariant;
  onNavigate?: (page: Page, params?: PageParams) => void;
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function matchesAdapter(adapter: SiteAdapterDefinition, keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return true;
  }

  return [
    adapter.name,
    adapter.domain,
    adapter.description,
    adapter.example,
    adapter.auth_hint ?? "",
    ...adapter.capabilities,
  ].some((value) => value.toLowerCase().includes(normalizedKeyword));
}

function summarizeResult(result: SiteAdapterRunResult | null) {
  if (
    !result?.data ||
    typeof result.data !== "object" ||
    Array.isArray(result.data)
  ) {
    return null;
  }

  const items = Array.isArray((result.data as { items?: unknown }).items)
    ? ((result.data as { items: unknown[] }).items?.length ?? 0)
    : null;
  const sections = Array.isArray(
    (result.data as { sections?: unknown }).sections,
  )
    ? ((result.data as { sections: unknown[] }).sections?.length ?? 0)
    : null;

  if (typeof items === "number") {
    return `返回 ${items} 条结构化记录`;
  }
  if (typeof sections === "number") {
    return `返回 ${sections} 个分段结果`;
  }
  return null;
}

function normalizeSaveTitleSegment(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalizedValue = value.trim().replace(/\s+/g, " ");
  if (!normalizedValue) {
    return null;
  }
  if (normalizedValue.length <= 48) {
    return normalizedValue;
  }
  return `${normalizedValue.slice(0, 45)}...`;
}

function buildSuggestedSaveTitle(input: {
  adapterName: string;
  args?: Record<string, unknown>;
}) {
  const query = normalizeSaveTitleSegment(input.args?.query);
  if (query) {
    return `站点采集 ${input.adapterName} · ${query}`;
  }

  const repo = normalizeSaveTitleSegment(input.args?.repo);
  if (repo) {
    return `站点采集 ${input.adapterName} · ${repo}`;
  }

  return `站点采集 ${input.adapterName}`;
}

function formatCatalogSyncedAt(value?: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", { hour12: false });
}

export function BrowserSiteAdapterPanel(props: BrowserSiteAdapterPanelProps) {
  const {
    selectedProfileKey,
    onMessage,
    variant = "debug",
    onNavigate,
  } = props;
  const [adapters, setAdapters] = useState<SiteAdapterDefinition[]>([]);
  const [profiles, setProfiles] = useState<BrowserProfileRecord[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<SiteAdapterCatalogStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const [selectedAdapterName, setSelectedAdapterName] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [profileInput, setProfileInput] = useState(selectedProfileKey || "");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [saveTitleInput, setSaveTitleInput] = useState("");
  const [lastSuggestedSaveTitle, setLastSuggestedSaveTitle] = useState("");
  const [argsInput, setArgsInput] = useState("{}");
  const [running, setRunning] = useState(false);
  const [savingResult, setSavingResult] = useState(false);
  const [result, setResult] = useState<SiteAdapterRunResult | null>(null);
  const [lastRunRequest, setLastRunRequest] =
    useState<RunSiteAdapterRequest | null>(null);
  const [savedDocument, setSavedDocument] =
    useState<SavedSiteAdapterContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProfileInput(selectedProfileKey || "");
  }, [selectedProfileKey]);

  useEffect(() => {
    let cancelled = false;

    const loadPanelData = async (showRefreshingState: boolean) => {
      if (showRefreshingState) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const [nextAdapters, nextProfiles, nextCatalogStatus] = await Promise.all([
          browserRuntimeApi.siteListAdapters(),
          browserRuntimeApi.listBrowserProfiles({ include_archived: false }),
          browserRuntimeApi.siteGetAdapterCatalogStatus(),
        ]);
        if (cancelled) {
          return;
        }

        setAdapters(nextAdapters);
        setCatalogStatus(nextCatalogStatus);
        setProfiles(
          nextProfiles.filter((profile) => profile.archived_at === null),
        );
        if (nextAdapters.length > 0) {
          setSelectedAdapterName((current) => current || nextAdapters[0].name);
        }
      } catch (nextError) {
        if (cancelled) {
          return;
        }
        const message =
          nextError instanceof Error ? nextError.message : String(nextError);
        setError(message);
      } finally {
        if (!cancelled) {
          if (showRefreshingState) {
            setRefreshing(false);
          } else {
            setLoading(false);
          }
        }
      }
    };

    void loadPanelData(false);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (variant !== "workspace") {
      return;
    }

    let cancelled = false;
    setProjectLoading(true);

    void listProjects()
      .then((items) => {
        if (cancelled) {
          return;
        }
        const availableProjects = items.filter(
          (project) => !project.isArchived,
        );
        setProjects(availableProjects);

        const storedProjectId = getStoredResourceProjectId({
          includeLegacy: true,
        });
        const preferredProject =
          availableProjects.find((project) => project.id === storedProjectId) ||
          availableProjects.find((project) => project.isDefault) ||
          availableProjects[0] ||
          null;
        setSelectedProjectId(
          (current) => current || preferredProject?.id || "",
        );
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }
        const message =
          nextError instanceof Error ? nextError.message : String(nextError);
        setError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setProjectLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [variant]);

  useEffect(() => {
    if (variant !== "workspace") {
      return;
    }

    return onResourceProjectChange((detail) => {
      if (!detail.projectId || detail.projectId === selectedProjectId) {
        return;
      }

      if (!projects.some((project) => project.id === detail.projectId)) {
        return;
      }

      setSelectedProjectId(detail.projectId);
    });
  }, [projects, selectedProjectId, variant]);

  const filteredAdapters = useMemo(
    () => adapters.filter((adapter) => matchesAdapter(adapter, searchKeyword)),
    [adapters, searchKeyword],
  );

  const selectedAdapter = useMemo(
    () =>
      filteredAdapters.find(
        (adapter) => adapter.name === selectedAdapterName,
      ) ||
      adapters.find((adapter) => adapter.name === selectedAdapterName) ||
      null,
    [adapters, filteredAdapters, selectedAdapterName],
  );

  const selectedProfile = useMemo(
    () =>
      profiles.find((profile) => profile.profile_key === profileInput.trim()) ||
      null,
    [profileInput, profiles],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const resultSummary = useMemo(() => summarizeResult(result), [result]);
  const catalogSyncedAtText = useMemo(
    () => formatCatalogSyncedAt(catalogStatus?.synced_at),
    [catalogStatus?.synced_at],
  );

  useEffect(() => {
    if (
      filteredAdapters.length > 0 &&
      !filteredAdapters.some((adapter) => adapter.name === selectedAdapterName)
    ) {
      setSelectedAdapterName(filteredAdapters[0].name);
    }
    if (filteredAdapters.length === 0) {
      setSelectedAdapterName("");
    }
  }, [filteredAdapters, selectedAdapterName]);

  useEffect(() => {
    if (!selectedAdapter) {
      return;
    }
    setArgsInput(stringifyJson(selectedAdapter.example_args));
    setSaveTitleInput("");
    setLastSuggestedSaveTitle("");
    setResult(null);
    setLastRunRequest(null);
    setSavedDocument(null);
    setError(null);
  }, [selectedAdapter]);

  const savedDocumentTitle = savedDocument?.title ?? null;

  const updateSuggestedSaveTitle = (nextSuggestedTitle: string) => {
    setSaveTitleInput((currentTitle) => {
      const normalizedCurrentTitle = currentTitle.trim();
      if (
        !normalizedCurrentTitle ||
        normalizedCurrentTitle === lastSuggestedSaveTitle
      ) {
        return nextSuggestedTitle;
      }
      return currentTitle;
    });
    setLastSuggestedSaveTitle(nextSuggestedTitle);
  };

  const handleRun = async () => {
    if (!selectedAdapter) {
      return;
    }
    setRunning(true);
    setError(null);
    setSavedDocument(null);
    try {
      const parsedArgs = JSON.parse(argsInput || "{}") as Record<
        string,
        unknown
      >;
      const suggestedSaveTitle = buildSuggestedSaveTitle({
        adapterName: selectedAdapter.name,
        args: parsedArgs,
      });
      const autoSaveEnabled = variant === "workspace" && !!selectedProjectId;
      const selectedProjectName = selectedProject?.name || selectedProjectId;
      const saveTitleForRun =
        autoSaveEnabled && (saveTitleInput.trim() || suggestedSaveTitle);
      const request: RunSiteAdapterRequest = {
        adapter_name: selectedAdapter.name,
        args: parsedArgs,
        profile_key: profileInput.trim() || selectedProfileKey || undefined,
        project_id: autoSaveEnabled ? selectedProjectId : undefined,
        save_title: saveTitleForRun || undefined,
      };
      const nextResult = await browserRuntimeApi.siteRunAdapter(request);

      if (nextResult.ok) {
        updateSuggestedSaveTitle(suggestedSaveTitle);
        if (nextResult.saved_content) {
          setSavedDocument(nextResult.saved_content);
          setStoredResourceProjectId(nextResult.saved_content.project_id, {
            source: "browser-runtime",
            emitEvent: true,
          });
        }
        if (nextResult.save_error_message) {
          setError(`执行成功，但自动保存失败：${nextResult.save_error_message}`);
        }
      }
      setLastRunRequest(request);
      setResult(nextResult);
      if (nextResult.ok) {
        onMessage?.({
          type: nextResult.save_error_message ? "error" : "success",
          text: nextResult.save_error_message
            ? `站点命令 ${nextResult.adapter} 执行完成，但自动保存失败: ${nextResult.save_error_message}`
            : nextResult.saved_content
              ? `站点命令 ${nextResult.adapter} 执行完成，已保存到资源项目：${selectedProjectName}`
              : `站点命令 ${nextResult.adapter} 执行完成`,
        });
      } else {
        onMessage?.({
          type: "error",
          text: `站点命令失败: ${
            nextResult.error_message || nextResult.error_code || "未知错误"
          }`,
        });
      }
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      onMessage?.({
        type: "error",
        text: `站点命令参数解析失败: ${message}`,
      });
    } finally {
      setRunning(false);
    }
  };

  const handleProjectChange = (nextProjectId: string) => {
    setSelectedProjectId(nextProjectId);
    setStoredResourceProjectId(nextProjectId || null, {
      source: "browser-runtime",
      emitEvent: true,
    });
  };

  const handleRefresh = async () => {
    setError(null);
    setRefreshing(true);
    try {
      const tasks: [
        Promise<SiteAdapterDefinition[]>,
        Promise<BrowserProfileRecord[]>,
        Promise<Project[]>?,
      ] = [
        browserRuntimeApi.siteListAdapters(),
        browserRuntimeApi.listBrowserProfiles({ include_archived: false }),
      ];
      if (variant === "workspace") {
        tasks.push(listProjects());
        setProjectLoading(true);
      }
      const [nextAdapters, nextProfiles, nextProjects] =
        await Promise.all(tasks);
      setAdapters(nextAdapters);
      setProfiles(
        nextProfiles.filter((profile) => profile.archived_at === null),
      );
      if (variant === "workspace" && nextProjects) {
        const availableProjects = nextProjects.filter(
          (project) => !project.isArchived,
        );
        setProjects(availableProjects);
        setSelectedProjectId((current) => {
          if (
            current &&
            availableProjects.some((project) => project.id === current)
          ) {
            return current;
          }
          const storedProjectId = getStoredResourceProjectId({
            includeLegacy: true,
          });
          return (
            availableProjects.find((project) => project.id === storedProjectId)
              ?.id ||
            availableProjects.find((project) => project.isDefault)?.id ||
            availableProjects[0]?.id ||
            ""
          );
        });
      }
      if (nextAdapters.length > 0) {
        setSelectedAdapterName((current) => {
          if (
            current &&
            nextAdapters.some((adapter) => adapter.name === current)
          ) {
            return current;
          }
          return nextAdapters[0].name;
        });
      }
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
    } finally {
      setProjectLoading(false);
      setRefreshing(false);
    }
  };

  const handleSaveResult = async () => {
    if (!result || !result.ok || !selectedProjectId || !lastRunRequest) {
      return;
    }

    setSavingResult(true);
    setError(null);
    try {
      const savedContent = await browserRuntimeApi.siteSaveAdapterResult({
        project_id: selectedProjectId,
        save_title: saveTitleInput.trim() || undefined,
        run_request: lastRunRequest,
        result,
      });

      setSavedDocument(savedContent);
      setStoredResourceProjectId(selectedProjectId, {
        source: "browser-runtime",
        emitEvent: true,
      });
      onMessage?.({
        type: "success",
        text: `已保存站点结果到资源项目：${selectedProject?.name || selectedProjectId}`,
      });
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      onMessage?.({
        type: "error",
        text: `保存站点结果失败: ${message}`,
      });
    } finally {
      setSavingResult(false);
    }
  };

  const handleOpenSavedDocument = () => {
    if (!savedDocument || !onNavigate) {
      return;
    }

    onNavigate("agent", {
      projectId: savedDocument.project_id,
      contentId: savedDocument.content_id,
      lockTheme: true,
      fromResources: true,
    });
  };

  const title = variant === "workspace" ? "站点采集工作台" : "站点命令调试";
  const description =
    variant === "workspace"
      ? "直接复用你在 Lime 里维护的浏览器资料，执行内置只读站点适配器，把公开页面转成结构化结果。"
      : "用真实浏览器登录态执行 Lime 内置只读站点适配器，验证结构化结果是否符合预期。";
  const rootClassName =
    variant === "workspace"
      ? "rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5"
      : "rounded-md border p-3";

  return (
    <div className={rootClassName} data-testid="browser-site-adapter-panel">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
            适配器 {adapters.length}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
            资料 {profiles.length}
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 hover:bg-slate-50 disabled:opacity-60"
            onClick={() => void handleRefresh()}
            disabled={refreshing || loading}
          >
            <RefreshCw
              className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
            />
            {refreshing ? "刷新中" : "刷新"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground">正在加载站点适配器…</div>
      ) : adapters.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          暂无可用站点适配器。
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_260px]">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">适配器</span>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={selectedAdapterName}
                onChange={(event) => setSelectedAdapterName(event.target.value)}
              >
                {filteredAdapters.length === 0 ? (
                  <option value="">没有匹配的适配器</option>
                ) : (
                  filteredAdapters.map((adapter) => (
                    <option key={adapter.name} value={adapter.name}>
                      {adapter.name}
                    </option>
                  ))
                )}
              </select>
              {filteredAdapters.length === 0 ? (
                <div className="text-[11px] text-muted-foreground">
                  当前关键词没有命中站点适配器，请尝试域名、能力或名称。
                </div>
              ) : null}
            </label>

            <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
              <div className="font-medium text-foreground">
                {selectedAdapter?.description}
              </div>
              <div className="mt-1 text-muted-foreground">
                域名：{selectedAdapter?.domain}
              </div>
              <div className="mt-1 text-muted-foreground">
                能力：{selectedAdapter?.capabilities.join(" / ") || "未标注"}
              </div>
              <div className="mt-2 break-all text-muted-foreground">
                示例：{selectedAdapter?.example}
              </div>
              {selectedAdapter?.auth_hint ? (
                <div className="mt-2 text-amber-700 dark:text-amber-300">
                  登录提示：{selectedAdapter.auth_hint}
                </div>
              ) : null}
            </div>

            <div className="rounded-md border bg-slate-50/80 px-3 py-2 text-xs">
              <label className="space-y-1">
                <span className="text-muted-foreground">关键词筛选</span>
                <input
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={searchKeyword}
                  onChange={(event) => setSearchKeyword(event.target.value)}
                  placeholder="搜索站点、能力或关键词"
                />
              </label>
              <label className="mt-3 block space-y-1">
                <span className="text-muted-foreground">浏览器资料 Key</span>
                <input
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  list="browser-site-adapter-profile-options"
                  value={profileInput}
                  onChange={(event) => setProfileInput(event.target.value)}
                  placeholder={selectedProfileKey || "default"}
                />
                <datalist id="browser-site-adapter-profile-options">
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.profile_key}>
                      {profile.name}
                    </option>
                  ))}
                </datalist>
              </label>
              <div className="mt-2 text-[11px] text-muted-foreground">
                当前将使用：
                {profileInput.trim() || selectedProfileKey || "default"}
              </div>
              {catalogStatus ? (
                <div className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-muted-foreground">
                  <div>
                    目录来源：
                    {catalogStatus.exists ? "服务端同步" : "应用内置"}
                  </div>
                  {catalogStatus.catalog_version ? (
                    <div>目录版本：{catalogStatus.catalog_version}</div>
                  ) : null}
                  {catalogStatus.tenant_id ? (
                    <div>租户：{catalogStatus.tenant_id}</div>
                  ) : null}
                  {catalogSyncedAtText ? (
                    <div>同步时间：{catalogSyncedAtText}</div>
                  ) : null}
                  <div>适配器数量：{catalogStatus.adapter_count}</div>
                </div>
              ) : null}
              {selectedProfile ? (
                <div className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-muted-foreground">
                  <div className="font-medium text-foreground">
                    {selectedProfile.name}
                  </div>
                  <div>模式：{selectedProfile.transport_kind}</div>
                  {selectedAdapter?.source_kind ? (
                    <div>
                      脚本来源：
                      {selectedAdapter.source_kind === "server_synced"
                        ? "服务端同步"
                        : "应用内置"}
                      {selectedAdapter.source_version
                        ? ` · ${selectedAdapter.source_version}`
                        : ""}
                    </div>
                  ) : null}
                  {selectedProfile.site_scope ? (
                    <div>站点：{selectedProfile.site_scope}</div>
                  ) : null}
                </div>
              ) : null}
              {selectedProfile?.transport_kind === "existing_session" ? (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  当前站点适配器会通过 Lime Browser Bridge 在你正在使用的 Chrome
                  中执行脚本，优先复用真实登录态。
                </div>
              ) : null}
            </div>
          </div>

          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">参数 JSON</span>
            <textarea
              className="h-40 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              value={argsInput}
              onChange={(event) => setArgsInput(event.target.value)}
              spellCheck={false}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
              onClick={() => void handleRun()}
              disabled={running || !selectedAdapter}
            >
              {running ? "执行中..." : "执行站点命令"}
            </button>
            {result?.source_url ? (
              <span className="text-[11px] text-muted-foreground">
                来源页：{result.source_url}
              </span>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          {result ? (
            <div
              className={`rounded-md border px-3 py-2 text-xs ${
                result.ok
                  ? "border-emerald-300/60 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/20"
                  : "border-destructive/40 bg-destructive/10"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {result.ok ? "执行成功" : "执行失败"}
                </span>
                <span className="text-muted-foreground">{result.adapter}</span>
                {result.error_code ? (
                  <span className="text-muted-foreground">
                    错误码：{result.error_code}
                  </span>
                ) : null}
              </div>
              {result.error_message ? (
                <div className="mb-2 text-destructive">
                  {result.error_message}
                </div>
              ) : null}
              {result.auth_hint ? (
                <div className="mb-2 text-amber-700 dark:text-amber-300">
                  {result.auth_hint}
                </div>
              ) : null}
              {resultSummary ? (
                <div className="mb-2 text-muted-foreground">
                  {resultSummary}
                </div>
              ) : null}
              <pre className="overflow-auto whitespace-pre-wrap break-all rounded bg-background/80 p-3 font-mono text-[11px]">
                {stringifyJson(result.data ?? result)}
              </pre>
            </div>
          ) : null}

          {variant === "workspace" ? (
            <div className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-3 text-xs">
              <div className="mb-2 text-sm font-medium text-foreground">
                保存到资源项目
              </div>
              <p className="mb-3 text-muted-foreground">
                工作台模式下，执行成功后会自动保存为文档资源；你也可以在这里补自定义标题或再次另存为。
              </p>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                <label className="space-y-1">
                  <span className="text-muted-foreground">目标项目</span>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={selectedProjectId}
                    onChange={(event) =>
                      handleProjectChange(event.target.value)
                    }
                    disabled={projectLoading}
                  >
                    {projects.length === 0 ? (
                      <option value="">
                        {projectLoading ? "正在加载项目..." : "暂无可用项目"}
                      </option>
                    ) : (
                      projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-muted-foreground">保存标题</span>
                  <input
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={saveTitleInput}
                    onChange={(event) => setSaveTitleInput(event.target.value)}
                    placeholder="留空则自动生成标题"
                  />
                </label>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                  onClick={() => void handleSaveResult()}
                  disabled={
                    savingResult ||
                    projectLoading ||
                    !selectedProjectId ||
                    !result?.ok ||
                    !lastRunRequest
                  }
                >
                  {savingResult
                    ? "保存中..."
                    : savedDocumentTitle
                      ? "另存为结果文档"
                      : "保存结果文档"}
                </button>
              </div>
              {!result ? (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  先执行一次站点采集，成功后会自动沉淀到当前资源项目。
                </div>
              ) : null}
              {result && !result.ok ? (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  当前执行失败，暂不支持直接保存失败结果文档。
                </div>
              ) : null}
              {savedDocumentTitle ? (
                <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-800">
                  已保存：{savedDocumentTitle}
                  {selectedProject ? ` · ${selectedProject.name}` : ""}
                </div>
              ) : null}
              {savedDocument && onNavigate ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50"
                    onClick={handleOpenSavedDocument}
                  >
                    打开已保存内容
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
