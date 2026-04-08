import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listProjects, type Project } from "@/lib/api/project";
import {
  getStoredResourceProjectId,
  onResourceProjectChange,
  setStoredResourceProjectId,
} from "@/lib/resourceProjectSelection";
import { subscribeSiteAdapterCatalogChanged } from "@/lib/siteAdapterCatalogBootstrap";
import type {
  BrowserProfileRecord,
  ChromeBridgeStatusSnapshot,
  RunSiteAdapterRequest,
  SavedSiteAdapterContent,
  SiteAdapterDefinition,
  SiteAdapterCatalogStatus,
  SiteAdapterRecommendation,
  SiteAdapterRunResult,
} from "./api";
import {
  buildEffectiveSiteProfileKey,
  pickPreferredAttachedSiteAdapterProfile,
  pickPreferredSiteAdapterProfile,
} from "./siteProfileSelection";
import type { Page, PageParams } from "@/types/page";
import { browserRuntimeApi } from "./api";

type BrowserSiteAdapterPanelVariant = "workspace" | "debug";
const SITE_RECOMMENDATION_LIMIT = 4;

interface BrowserSiteAdapterPanelProps {
  selectedProfileKey?: string;
  onMessage?: (message: { type: "success" | "error"; text: string }) => void;
  variant?: BrowserSiteAdapterPanelVariant;
  onNavigate?: (page: Page, params?: PageParams) => void;
  currentProjectId?: string;
  currentContentId?: string;
  initialAdapterName?: string;
  initialArgs?: Record<string, unknown>;
  initialAutoRun?: boolean;
  initialRequireAttachedSession?: boolean;
  initialSaveTitle?: string;
}

interface PendingInitialLaunchState {
  signature: string;
  adapterName: string;
  args?: Record<string, unknown>;
  autoRun: boolean;
  saveTitle?: string;
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

function getCatalogSourceLabel(status: SiteAdapterCatalogStatus | null) {
  if (!status) {
    return "加载中";
  }

  return status.exists || status.source_kind === "server_synced"
    ? "服务端同步"
    : "应用内置";
}

function buildInitialLaunchSignature(input: {
  initialAdapterName?: string;
  initialArgs?: Record<string, unknown>;
  initialAutoRun?: boolean;
  initialRequireAttachedSession?: boolean;
  initialSaveTitle?: string;
}) {
  if (!input.initialAdapterName) {
    return "";
  }

  return JSON.stringify({
    adapterName: input.initialAdapterName,
    args: input.initialArgs ?? null,
    autoRun: Boolean(input.initialAutoRun),
    requireAttachedSession: Boolean(input.initialRequireAttachedSession),
    saveTitle: input.initialSaveTitle?.trim() || null,
  });
}

export function BrowserSiteAdapterPanel(props: BrowserSiteAdapterPanelProps) {
  const {
    selectedProfileKey,
    onMessage,
    variant = "debug",
    onNavigate,
    currentProjectId,
    currentContentId,
    initialAdapterName,
    initialArgs,
    initialAutoRun,
    initialRequireAttachedSession = false,
    initialSaveTitle,
  } = props;
  const [adapters, setAdapters] = useState<SiteAdapterDefinition[]>([]);
  const [recommendations, setRecommendations] = useState<
    SiteAdapterRecommendation[]
  >([]);
  const [profiles, setProfiles] = useState<BrowserProfileRecord[]>([]);
  const [bridgeStatus, setBridgeStatus] =
    useState<ChromeBridgeStatusSnapshot | null>(null);
  const [catalogStatus, setCatalogStatus] =
    useState<SiteAdapterCatalogStatus | null>(null);
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
  const pendingInitialLaunchRef = useRef<PendingInitialLaunchState | null>(
    null,
  );
  const appliedInitialLaunchSignatureRef = useRef("");
  const completedAutoRunSignatureRef = useRef("");
  const savedDocumentMarkdownRelativePath =
    savedDocument?.markdown_relative_path?.trim() || "";
  const [pendingAutoRunSignature, setPendingAutoRunSignature] = useState<
    string | null
  >(null);
  const normalizedCurrentProjectId = currentProjectId?.trim() || "";
  const normalizedCurrentContentId = currentContentId?.trim() || "";
  const shouldWriteToCurrentContent =
    variant === "workspace" && !!normalizedCurrentContentId;
  const initialLaunchSignature = useMemo(
    () =>
      buildInitialLaunchSignature({
        initialAdapterName,
        initialArgs,
        initialAutoRun,
        initialRequireAttachedSession,
        initialSaveTitle,
      }),
    [
      initialAdapterName,
      initialArgs,
      initialAutoRun,
      initialRequireAttachedSession,
      initialSaveTitle,
    ],
  );

  useEffect(() => {
    setProfileInput(selectedProfileKey || "");
  }, [selectedProfileKey]);

  const loadPanelData = useCallback(async (showRefreshingState: boolean) => {
    if (showRefreshingState) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [
        nextAdapters,
        nextRecommendations,
        nextProfiles,
        nextCatalogStatus,
        nextBridgeStatus,
      ] = await Promise.all([
        browserRuntimeApi.siteListAdapters(),
        browserRuntimeApi.siteRecommendAdapters(SITE_RECOMMENDATION_LIMIT),
        browserRuntimeApi.listBrowserProfiles({ include_archived: false }),
        browserRuntimeApi.siteGetAdapterCatalogStatus(),
        browserRuntimeApi.getChromeBridgeStatus().catch(() => null),
      ]);

      setAdapters(nextAdapters);
      setRecommendations(nextRecommendations);
      setCatalogStatus(nextCatalogStatus);
      setBridgeStatus(nextBridgeStatus);
      setProfiles(
        nextProfiles.filter((profile) => profile.archived_at === null),
      );
      if (nextAdapters.length > 0) {
        setSelectedAdapterName(
          (current) =>
            pendingInitialLaunchRef.current?.adapterName ||
            (current && nextAdapters.some((adapter) => adapter.name === current)
              ? current
              : nextRecommendations[0]?.adapter.name || nextAdapters[0].name),
        );
      }
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
    } finally {
      if (showRefreshingState) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadPanelData(false);
    return () => undefined;
  }, [loadPanelData]);

  useEffect(() => {
    return subscribeSiteAdapterCatalogChanged(() => {
      void loadPanelData(true);
    });
  }, [loadPanelData]);

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
          availableProjects.find(
            (project) => project.id === normalizedCurrentProjectId,
          ) ||
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
  }, [normalizedCurrentProjectId, variant]);

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
  const visibleRecommendations = useMemo(
    () =>
      recommendations.filter((recommendation) =>
        matchesAdapter(recommendation.adapter, searchKeyword),
      ),
    [recommendations, searchKeyword],
  );
  const profilesByKey = useMemo(
    () => new Map(profiles.map((profile) => [profile.profile_key, profile])),
    [profiles],
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

  const recommendedProfile = useMemo(
    () =>
      pickPreferredSiteAdapterProfile({
        profiles,
        adapterDomain: selectedAdapter?.domain,
        bridgeStatus,
      }),
    [bridgeStatus, profiles, selectedAdapter?.domain],
  );

  const attachedProfile = useMemo(
    () =>
      pickPreferredAttachedSiteAdapterProfile({
        profiles,
        adapterDomain: selectedAdapter?.domain,
        bridgeStatus,
      }),
    [bridgeStatus, profiles, selectedAdapter?.domain],
  );

  const effectiveProfileKey = useMemo(
    () =>
      buildEffectiveSiteProfileKey({
        manualProfileKey: profileInput,
        selectedProfileKey,
        recommendedProfile,
      }),
    [profileInput, recommendedProfile, selectedProfileKey],
  );

  const hasAttachedChromeObserver = (bridgeStatus?.observer_count ?? 0) > 0;
  const hasAttachedSessionAvailable =
    hasAttachedChromeObserver || attachedProfile !== null;

  const runProfileKey = useMemo(() => {
    if (!initialRequireAttachedSession) {
      return effectiveProfileKey || undefined;
    }

    if (!hasAttachedSessionAvailable) {
      return undefined;
    }

    const effectiveProfile = effectiveProfileKey
      ? profilesByKey.get(effectiveProfileKey) || null
      : null;
    if (effectiveProfile?.transport_kind === "existing_session") {
      return effectiveProfile.profile_key;
    }

    return attachedProfile?.profile_key || undefined;
  }, [
    attachedProfile,
    effectiveProfileKey,
    hasAttachedSessionAvailable,
    initialRequireAttachedSession,
    profilesByKey,
  ]);

  const executionProfileLabel = useMemo(() => {
    if (!initialRequireAttachedSession) {
      return effectiveProfileKey || "default";
    }

    if (!hasAttachedSessionAvailable) {
      return "需要先附着当前 Chrome";
    }

    return runProfileKey || "自动选择已连接会话";
  }, [
    effectiveProfileKey,
    hasAttachedSessionAvailable,
    initialRequireAttachedSession,
    runProfileKey,
  ]);

  const executionProfile = useMemo(() => {
    if (!runProfileKey) {
      return null;
    }

    return profilesByKey.get(runProfileKey) || null;
  }, [profilesByKey, runProfileKey]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const resultSummary = useMemo(() => summarizeResult(result), [result]);
  const catalogSyncedAtText = useMemo(
    () => formatCatalogSyncedAt(catalogStatus?.synced_at),
    [catalogStatus?.synced_at],
  );
  const catalogSourceLabel = useMemo(
    () => getCatalogSourceLabel(catalogStatus),
    [catalogStatus],
  );
  const effectiveAdapterCount = adapters.length;
  const syncedAdapterCount = catalogStatus?.exists
    ? catalogStatus.adapter_count
    : 0;

  const updateSuggestedSaveTitle = useCallback(
    (nextSuggestedTitle: string) => {
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
    },
    [lastSuggestedSaveTitle],
  );

  const applyInitialLaunchState = useCallback(
    (launch: PendingInitialLaunchState) => {
      setArgsInput(stringifyJson(launch.args ?? {}));
      if (shouldWriteToCurrentContent) {
        setSaveTitleInput("");
        setLastSuggestedSaveTitle("");
      } else {
        const nextSaveTitle = launch.saveTitle?.trim() || "";
        setSaveTitleInput(nextSaveTitle);
        setLastSuggestedSaveTitle(nextSaveTitle);
      }
      setResult(null);
      setLastRunRequest(null);
      setSavedDocument(null);
      setError(null);
      if (launch.autoRun) {
        setPendingAutoRunSignature(launch.signature);
      }
    },
    [shouldWriteToCurrentContent],
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
    if (!initialLaunchSignature || !initialAdapterName) {
      return;
    }

    if (appliedInitialLaunchSignatureRef.current === initialLaunchSignature) {
      return;
    }

    const launch: PendingInitialLaunchState = {
      signature: initialLaunchSignature,
      adapterName: initialAdapterName,
      args: initialArgs,
      autoRun: Boolean(initialAutoRun),
      saveTitle: initialSaveTitle,
    };

    appliedInitialLaunchSignatureRef.current = initialLaunchSignature;
    completedAutoRunSignatureRef.current = "";
    setPendingAutoRunSignature(null);
    setSearchKeyword("");

    if (selectedAdapterName === initialAdapterName) {
      pendingInitialLaunchRef.current = null;
      applyInitialLaunchState(launch);
      return;
    }

    pendingInitialLaunchRef.current = launch;
    setSelectedAdapterName(initialAdapterName);
    setResult(null);
    setLastRunRequest(null);
    setSavedDocument(null);
    setError(null);
  }, [
    applyInitialLaunchState,
    initialAdapterName,
    initialArgs,
    initialAutoRun,
    initialLaunchSignature,
    initialSaveTitle,
    selectedAdapterName,
  ]);

  useEffect(() => {
    if (
      !loading &&
      initialAdapterName &&
      adapters.length > 0 &&
      !adapters.some((adapter) => adapter.name === initialAdapterName)
    ) {
      setError(`当前目录未找到站点脚本：${initialAdapterName}`);
    }
  }, [adapters, initialAdapterName, loading]);

  useEffect(() => {
    if (!selectedAdapter) {
      return;
    }

    const pendingLaunch = pendingInitialLaunchRef.current;
    if (pendingLaunch) {
      if (pendingLaunch.adapterName === selectedAdapter.name) {
        pendingInitialLaunchRef.current = null;
        applyInitialLaunchState(pendingLaunch);
        return;
      }

      if (
        adapters.some(
          (adapter) => adapter.name === pendingLaunch.adapterName,
        ) &&
        selectedAdapterName !== pendingLaunch.adapterName
      ) {
        setSelectedAdapterName(pendingLaunch.adapterName);
        return;
      }
    }

    setArgsInput(stringifyJson(selectedAdapter.example_args));
    setSaveTitleInput("");
    setLastSuggestedSaveTitle("");
    setResult(null);
    setLastRunRequest(null);
    setSavedDocument(null);
    setError(null);
  }, [adapters, applyInitialLaunchState, selectedAdapter, selectedAdapterName]);

  const savedDocumentTitle = savedDocument?.title ?? null;
  const selectedProjectName = selectedProject?.name || selectedProjectId;

  const handleSelectRecommendation = (
    recommendation: SiteAdapterRecommendation,
  ) => {
    setSelectedAdapterName(recommendation.adapter.name);
    if (recommendation.profile_key) {
      setProfileInput(recommendation.profile_key);
    }
    setError(null);
    setResult(null);
    setLastRunRequest(null);
    setSavedDocument(null);
  };

  const handleRun = useCallback(async () => {
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
      const autoSaveEnabled =
        variant === "workspace" &&
        (shouldWriteToCurrentContent || !!selectedProjectId);
      const saveTitleForRun =
        autoSaveEnabled &&
        !shouldWriteToCurrentContent &&
        (saveTitleInput.trim() || suggestedSaveTitle);
      if (initialRequireAttachedSession && !hasAttachedSessionAvailable) {
        const message =
          "当前技能要求复用已附着的 Chrome 会话，请先连接当前 Chrome 并保持目标站点登录态。";
        setError(message);
        onMessage?.({
          type: "error",
          text: message,
        });
        return;
      }
      const request: RunSiteAdapterRequest = {
        adapter_name: selectedAdapter.name,
        args: parsedArgs,
        profile_key: runProfileKey,
        require_attached_session: initialRequireAttachedSession || undefined,
        content_id: shouldWriteToCurrentContent
          ? normalizedCurrentContentId
          : undefined,
        project_id:
          autoSaveEnabled && !shouldWriteToCurrentContent
            ? selectedProjectId
            : undefined,
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
          setError(
            `执行成功，但自动保存失败：${nextResult.save_error_message}`,
          );
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
              ? shouldWriteToCurrentContent
                ? `站点命令 ${nextResult.adapter} 执行完成，已写回当前主稿`
                : `站点命令 ${nextResult.adapter} 执行完成，已保存到资源项目：${selectedProjectName}`
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
  }, [
    argsInput,
    hasAttachedSessionAvailable,
    initialRequireAttachedSession,
    normalizedCurrentContentId,
    onMessage,
    runProfileKey,
    saveTitleInput,
    selectedAdapter,
    selectedProjectId,
    selectedProjectName,
    shouldWriteToCurrentContent,
    updateSuggestedSaveTitle,
    variant,
  ]);

  useEffect(() => {
    if (!pendingAutoRunSignature || loading || running || !selectedAdapter) {
      return;
    }

    if (completedAutoRunSignatureRef.current === pendingAutoRunSignature) {
      setPendingAutoRunSignature(null);
      return;
    }

    if (
      variant === "workspace" &&
      !shouldWriteToCurrentContent &&
      !selectedProjectId
    ) {
      return;
    }

    completedAutoRunSignatureRef.current = pendingAutoRunSignature;
    setPendingAutoRunSignature(null);
    void handleRun();
  }, [
    handleRun,
    loading,
    pendingAutoRunSignature,
    running,
    selectedAdapter,
    selectedProjectId,
    shouldWriteToCurrentContent,
    variant,
  ]);

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
      if (variant === "workspace") {
        setProjectLoading(true);
      }
      const [
        nextAdapters,
        nextRecommendations,
        nextProfiles,
        nextCatalogStatus,
        nextBridgeStatus,
        nextProjects,
      ] = await Promise.all([
        browserRuntimeApi.siteListAdapters(),
        browserRuntimeApi.siteRecommendAdapters(SITE_RECOMMENDATION_LIMIT),
        browserRuntimeApi.listBrowserProfiles({ include_archived: false }),
        browserRuntimeApi.siteGetAdapterCatalogStatus(),
        browserRuntimeApi.getChromeBridgeStatus().catch(() => null),
        variant === "workspace" ? listProjects() : Promise.resolve(null),
      ]);
      setAdapters(nextAdapters);
      setRecommendations(nextRecommendations);
      setCatalogStatus(nextCatalogStatus);
      setBridgeStatus(nextBridgeStatus);
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
            availableProjects.find(
              (project) => project.id === normalizedCurrentProjectId,
            )?.id ||
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
          return nextRecommendations[0]?.adapter.name || nextAdapters[0].name;
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
    if (
      !result ||
      !result.ok ||
      !lastRunRequest ||
      (!shouldWriteToCurrentContent && !selectedProjectId)
    ) {
      return;
    }

    setSavingResult(true);
    setError(null);
    try {
      const savedContent = await browserRuntimeApi.siteSaveAdapterResult({
        content_id: shouldWriteToCurrentContent
          ? normalizedCurrentContentId
          : undefined,
        project_id: shouldWriteToCurrentContent ? undefined : selectedProjectId,
        save_title: shouldWriteToCurrentContent
          ? undefined
          : saveTitleInput.trim() || undefined,
        run_request: lastRunRequest,
        result,
      });

      setSavedDocument(savedContent);
      setStoredResourceProjectId(savedContent.project_id, {
        source: "browser-runtime",
        emitEvent: true,
      });
      onMessage?.({
        type: "success",
        text: shouldWriteToCurrentContent
          ? "已写回当前主稿"
          : `已保存站点结果到资源项目：${selectedProject?.name || selectedProjectId}`,
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
      fromResources: savedDocument.content_id !== normalizedCurrentContentId,
      ...(savedDocumentMarkdownRelativePath
        ? {
            initialProjectFileOpenTarget: {
              relativePath: savedDocumentMarkdownRelativePath,
              requestKey: Date.now(),
            },
          }
        : {}),
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
          {visibleRecommendations.length > 0 ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="mb-2">
                <div className="text-sm font-medium text-foreground">
                  推荐适配器
                </div>
                <p className="text-[11px] text-muted-foreground">
                  基于当前浏览器资料、已连接标签页和站点范围排序，优先复用现有登录态。
                </p>
              </div>
              <div className="grid gap-2 xl:grid-cols-2">
                {visibleRecommendations.map((recommendation) => {
                  const recommendedProfile = recommendation.profile_key
                    ? profilesByKey.get(recommendation.profile_key) || null
                    : null;
                  const isActive =
                    recommendation.adapter.name === selectedAdapterName;
                  return (
                    <button
                      key={`${recommendation.adapter.name}:${recommendation.profile_key || "auto"}`}
                      type="button"
                      className={`rounded-md border px-3 py-2 text-left transition-colors ${
                        isActive
                          ? "border-slate-900 bg-white shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                      onClick={() => handleSelectRecommendation(recommendation)}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium text-foreground">
                          {recommendation.adapter.name}
                        </div>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-muted-foreground">
                          评分 {recommendation.score}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {recommendation.reason}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                          {recommendedProfile
                            ? `资料 ${recommendedProfile.name}`
                            : recommendation.profile_key
                              ? `资料 ${recommendation.profile_key}`
                              : "自动选择资料"}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                          {recommendation.target_id
                            ? "已匹配标签页"
                            : "将打开入口页"}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                          {recommendation.adapter.domain}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

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
                  placeholder={effectiveProfileKey || "default"}
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
                当前将使用：{executionProfileLabel}
              </div>
              {!profileInput.trim() &&
              !selectedProfileKey &&
              recommendedProfile ? (
                <div className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-muted-foreground">
                  未手动指定资料，已优先选择：
                  <span className="ml-1 font-medium text-foreground">
                    {recommendedProfile.name}
                  </span>
                  <span className="ml-1">
                    ({recommendedProfile.profile_key})
                  </span>
                </div>
              ) : null}
              {catalogStatus ? (
                <div className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-muted-foreground">
                  <div>目录来源：{catalogSourceLabel}</div>
                  {catalogStatus.catalog_version ? (
                    <div>目录版本：{catalogStatus.catalog_version}</div>
                  ) : null}
                  {catalogStatus.tenant_id ? (
                    <div>租户：{catalogStatus.tenant_id}</div>
                  ) : null}
                  {catalogSyncedAtText ? (
                    <div>同步时间：{catalogSyncedAtText}</div>
                  ) : null}
                  <div>生效适配器：{effectiveAdapterCount}</div>
                  {catalogStatus.exists ? (
                    <div>服务端目录项：{syncedAdapterCount}</div>
                  ) : null}
                </div>
              ) : null}
              {executionProfile ? (
                <div className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-muted-foreground">
                  <div className="font-medium text-foreground">
                    {executionProfile.name}
                  </div>
                  <div>模式：{executionProfile.transport_kind}</div>
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
                  {executionProfile.site_scope ? (
                    <div>站点：{executionProfile.site_scope}</div>
                  ) : null}
                </div>
              ) : null}
              {executionProfile?.transport_kind === "existing_session" ? (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  当前站点适配器会通过 Lime Browser Bridge 在你正在使用的 Chrome
                  中执行脚本，优先复用真实登录态。
                </div>
              ) : null}
              {initialRequireAttachedSession ? (
                <div
                  className={`mt-2 rounded-md border px-2 py-1.5 text-[11px] ${
                    hasAttachedSessionAvailable
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {hasAttachedSessionAvailable
                    ? runProfileKey
                      ? "当前技能要求附着会话，执行时会优先复用已连接的 existing_session。"
                      : "当前技能要求附着会话，执行时会忽略托管资料，自动选择已连接的 Chrome 会话。"
                    : "当前技能要求附着会话；如果还没连接当前 Chrome，自动执行会被阻止。"}
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
              {result.report_hint ? (
                <div className="mb-2 text-muted-foreground">
                  建议：{result.report_hint}
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
                {shouldWriteToCurrentContent
                  ? "写回当前主稿"
                  : "保存到资源项目"}
              </div>
              <p className="mb-3 text-muted-foreground">
                {shouldWriteToCurrentContent
                  ? "工作台模式下，执行成功后会优先写回当前主稿；如果需要手动重写一次，也可以在这里再次写回。"
                  : "工作台模式下，执行成功后会自动保存为文档资源；你也可以在这里补自定义标题或再次另存为。"}
              </p>
              {shouldWriteToCurrentContent ? (
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[11px] text-muted-foreground">
                    <div>
                      当前主稿：
                      <span className="ml-1 font-medium text-foreground">
                        {savedDocumentTitle || "未命名内容"}
                      </span>
                    </div>
                    {normalizedCurrentProjectId ? (
                      <div>
                        所属项目：
                        {selectedProject?.name || normalizedCurrentProjectId}
                      </div>
                    ) : null}
                    <div className="break-all">
                      内容 ID：{normalizedCurrentContentId}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                    onClick={() => void handleSaveResult()}
                    disabled={savingResult || !result?.ok || !lastRunRequest}
                  >
                    {savingResult
                      ? "写回中..."
                      : savedDocumentTitle
                        ? "再次写回当前主稿"
                        : "写回当前主稿"}
                  </button>
                </div>
              ) : (
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
                      onChange={(event) =>
                        setSaveTitleInput(event.target.value)
                      }
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
              )}
              {!result ? (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {shouldWriteToCurrentContent
                    ? "先执行一次站点采集，成功后会自动沉淀到当前主稿。"
                    : "先执行一次站点采集，成功后会自动沉淀到当前资源项目。"}
                </div>
              ) : null}
              {result && !result.ok ? (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {shouldWriteToCurrentContent
                    ? "当前执行失败，暂不支持把失败结果直接写回当前主稿。"
                    : "当前执行失败，暂不支持直接保存失败结果文档。"}
                </div>
              ) : null}
              {savedDocumentTitle ? (
                <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-800">
                  {shouldWriteToCurrentContent ? "已写回：" : "已保存："}
                  {savedDocumentTitle}
                  {shouldWriteToCurrentContent
                    ? " · 当前主稿"
                    : selectedProject
                      ? ` · ${selectedProject.name}`
                      : ""}
                </div>
              ) : null}
              {savedDocument && onNavigate ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50"
                    onClick={handleOpenSavedDocument}
                  >
                    {savedDocumentMarkdownRelativePath
                      ? "打开导出结果"
                      : shouldWriteToCurrentContent
                      ? "打开当前主稿"
                      : "打开已保存内容"}
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
