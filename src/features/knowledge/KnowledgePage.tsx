import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BookOpen,
  Check,
  ClipboardCheck,
  Database,
  FileText,
  FolderOpen,
  ListChecks,
  Loader2,
  MessageSquareText,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { ProjectSelector } from "@/components/projects/ProjectSelector";
import {
  compileKnowledgePack,
  getKnowledgePack,
  importKnowledgeSource,
  listKnowledgePacks,
  setDefaultKnowledgePack,
  updateKnowledgePackStatus,
  type KnowledgePackDetail,
  type KnowledgePackStatus,
  type KnowledgePackSummary,
} from "@/lib/api/knowledge";
import {
  getDefaultProject,
  getProject,
  getProjectByRootPath,
} from "@/lib/api/project";
import type { KnowledgePageParams, Page, PageParams } from "@/types/page";
import { cn } from "@/lib/utils";
import {
  DETAIL_TABS,
  PACK_TYPES,
  VIEW_TABS,
  resolveStatusLabel,
  type DetailTab,
  type KnowledgeView,
} from "./domain/knowledgeLabels";
import {
  buildPackMetrics,
  getErrorMessage,
  getPackTitle,
  getUserFacingPackTypeLabel,
  normalizePackNameInput,
  sanitizeKnowledgePreview,
} from "./domain/knowledgeVisibility";
import { buildKnowledgeBuilderPrompt } from "./agent/knowledgePromptBuilder";
import {
  buildKnowledgeBuilderMetadata,
  buildKnowledgeRequestMetadata,
} from "./agent/knowledgeMetadata";
import { FileEntryList } from "./components/FileEntryList";
import { KnowledgePackCard } from "./components/KnowledgePackCard";
import { KnowledgeStatusRail } from "./components/KnowledgeStatusRail";
import { KnowledgeTroubleshootingPanel } from "./components/KnowledgeTroubleshootingPanel";
import { StatusPill } from "./components/StatusPill";

interface KnowledgePageProps {
  onNavigate?: (page: Page, pageParams?: PageParams) => void;
  pageParams?: KnowledgePageParams;
}

type AsyncStatus = "idle" | "loading" | "ready" | "error";

const WORKING_DIR_STORAGE_KEY = "lime.knowledge.working-dir";
const LAST_PROJECT_ID_STORAGE_KEY = "agent_last_project_id";
const DEFAULT_PACK_NAME = "project-material";
const DEFAULT_SOURCE_FILE_NAME = "source.md";

function readStoredWorkingDir(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(WORKING_DIR_STORAGE_KEY)?.trim() ?? "";
}

function persistWorkingDir(value: string): void {
  if (typeof window === "undefined") {
    return;
  }

  if (value.trim()) {
    window.localStorage.setItem(WORKING_DIR_STORAGE_KEY, value.trim());
  } else {
    window.localStorage.removeItem(WORKING_DIR_STORAGE_KEY);
  }
}

function isLikelyTransientWorkingDir(value: string): boolean {
  const normalized = value.trim().replace(/\\/g, "/").toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("/tmp/") ||
    normalized.includes("/var/folders/") ||
    normalized.includes("lime-knowledge-smoke") ||
    normalized.includes("lime-knowledge-")
  );
}

function readReusableStoredWorkingDir(): string {
  const storedWorkingDir = readStoredWorkingDir();
  return isLikelyTransientWorkingDir(storedWorkingDir) ? "" : storedWorkingDir;
}

function readLastProjectId(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const rawValue = window.localStorage
    .getItem(LAST_PROJECT_ID_STORAGE_KEY)
    ?.trim();
  if (!rawValue) {
    return "";
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return typeof parsed === "string" ? parsed.trim() : "";
  } catch {
    return rawValue;
  }
}

export function KnowledgePage({ onNavigate, pageParams }: KnowledgePageProps) {
  const initialWorkingDir = pageParams?.workingDir?.trim() ?? "";
  const initialStoredWorkingDir =
    initialWorkingDir || readReusableStoredWorkingDir();
  const [workingDirInput, setWorkingDirInput] = useState(() =>
    initialStoredWorkingDir,
  );
  const [workingDir, setWorkingDir] = useState(() => initialStoredWorkingDir);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [selectedProjectName, setSelectedProjectName] = useState<string>("");
  const [manualPathOpen, setManualPathOpen] = useState(false);
  const [activeView, setActiveView] = useState<KnowledgeView>("overview");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [catalogStatus, setCatalogStatus] = useState<AsyncStatus>(
    workingDir ? "loading" : "idle",
  );
  const [packs, setPacks] = useState<KnowledgePackSummary[]>([]);
  const [selectedPackName, setSelectedPackName] = useState(
    () => pageParams?.selectedPackName?.trim() ?? "",
  );
  const [selectedPack, setSelectedPack] = useState<KnowledgePackDetail | null>(
    null,
  );
  const [detailStatus, setDetailStatus] = useState<AsyncStatus>("idle");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [packNameInput, setPackNameInput] = useState(
    pageParams?.selectedPackName?.trim() || DEFAULT_PACK_NAME,
  );
  const [packDescription, setPackDescription] = useState("项目资料");
  const [packType, setPackType] = useState("brand-product");
  const sourceFileName = DEFAULT_SOURCE_FILE_NAME;
  const [sourceText, setSourceText] = useState("");

  const selectedSummary = useMemo(
    () =>
      packs.find((pack) => pack.metadata.name === selectedPackName) ??
      selectedPack ??
      null,
    [packs, selectedPack, selectedPackName],
  );

  const pendingPacks = useMemo(
    () =>
      packs.filter(
        (pack) =>
          pack.metadata.status !== "ready" &&
          pack.metadata.status !== "archived",
      ),
    [packs],
  );
  const refreshCatalog = useCallback(
    async (nextWorkingDir = workingDir) => {
      const normalizedWorkingDir = nextWorkingDir.trim();
      if (!normalizedWorkingDir) {
        setCatalogStatus("idle");
        setPacks([]);
        setSelectedPack(null);
        return;
      }

      setCatalogStatus("loading");
      try {
        const response = await listKnowledgePacks({
          workingDir: normalizedWorkingDir,
        });
        setPacks(response.packs);
        setCatalogStatus("ready");
        setSelectedPackName((current) => {
          if (
            current &&
            response.packs.some((pack) => pack.metadata.name === current)
          ) {
            return current;
          }

          return (
            response.packs.find((pack) => pack.defaultForWorkspace)?.metadata
              .name ??
            response.packs[0]?.metadata.name ??
            ""
          );
        });
      } catch (error) {
        setCatalogStatus("error");
        setNotice(getErrorMessage(error, "读取资料列表失败"));
      }
    },
    [workingDir],
  );

  useEffect(() => {
    const normalizedFromParams = pageParams?.workingDir?.trim();
    if (!normalizedFromParams || normalizedFromParams === workingDir) {
      return;
    }

    setWorkingDirInput(normalizedFromParams);
    setWorkingDir(normalizedFromParams);
    persistWorkingDir(normalizedFromParams);
  }, [pageParams?.workingDir, workingDir]);

  useEffect(() => {
    if (workingDir || pageParams?.workingDir?.trim()) {
      return;
    }

    let cancelled = false;
    const lastProjectId = readLastProjectId();
    const projectPromise = lastProjectId
      ? getProject(lastProjectId)
          .catch(() => null)
          .then((project) => project ?? getDefaultProject())
      : getDefaultProject();

    void projectPromise
      .then((project) => {
        const nextWorkingDir = project?.rootPath.trim() ?? "";
        if (cancelled || !project || !nextWorkingDir) {
          return;
        }

        setSelectedProjectId(project.id);
        setSelectedProjectName(project.name);
        setWorkingDirInput(nextWorkingDir);
        setWorkingDir(nextWorkingDir);
        persistWorkingDir(nextWorkingDir);
      })
      .catch(() => {
        // 没有默认项目时保持空态，让用户通过项目选择器进入。
      });

    return () => {
      cancelled = true;
    };
  }, [pageParams?.workingDir, workingDir]);

  useEffect(() => {
    if (!workingDir) {
      return;
    }

    void refreshCatalog(workingDir);
  }, [refreshCatalog, workingDir]);

  useEffect(() => {
    const normalizedWorkingDir = workingDir.trim();
    if (!normalizedWorkingDir) {
      return;
    }

    let cancelled = false;
    void getProjectByRootPath(normalizedWorkingDir)
      .then((project) => {
        if (cancelled || !project) {
          return;
        }

        setSelectedProjectId(project.id);
        setSelectedProjectName(project.name);
      })
      .catch(() => {
        // 路径可能来自排障设置；解析不到项目时继续允许手动管理资料。
      });

    return () => {
      cancelled = true;
    };
  }, [workingDir]);

  useEffect(() => {
    if (!workingDir || !selectedPackName) {
      setSelectedPack(null);
      setDetailStatus("idle");
      return;
    }

    let cancelled = false;
    setDetailStatus("loading");
    void getKnowledgePack(workingDir, selectedPackName)
      .then((pack) => {
        if (cancelled) {
          return;
        }
        setSelectedPack(pack);
        setDetailStatus("ready");
        setPackNameInput(pack.metadata.name);
        setPackDescription(pack.metadata.description);
        setPackType(pack.metadata.type || "personal-ip");
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setDetailStatus("error");
        setNotice(getErrorMessage(error, "读取资料详情失败"));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPackName, workingDir]);

  const handleApplyWorkingDir = useCallback(() => {
    const normalized = workingDirInput.trim();
    setSelectedProjectId(null);
    setSelectedProjectName("");
    setWorkingDir(normalized);
    persistWorkingDir(normalized);
    setSelectedPackName("");
    setSelectedPack(null);
    void refreshCatalog(normalized);
  }, [refreshCatalog, workingDirInput]);

  const handleProjectChange = useCallback(
    async (projectId: string) => {
      setNotice(null);

      try {
        const project = await getProject(projectId);
        const nextWorkingDir = project?.rootPath.trim() ?? "";

        if (!nextWorkingDir) {
          setNotice("这个项目还没有可用目录，请先在项目管理中修复目录。");
          return;
        }

        setSelectedProjectId(projectId);
        setSelectedProjectName(project?.name ?? "");
        setWorkingDirInput(nextWorkingDir);
        setWorkingDir(nextWorkingDir);
        persistWorkingDir(nextWorkingDir);
        setSelectedPackName("");
        setSelectedPack(null);
        await refreshCatalog(nextWorkingDir);
      } catch (error) {
        setNotice(getErrorMessage(error, "选择项目失败"));
      }
    },
    [refreshCatalog],
  );

  const openPack = useCallback(
    (packName: string, nextTab: DetailTab = "overview") => {
      setSelectedPackName(packName);
      setDetailTab(nextTab);
      setActiveView("detail");
    },
    [],
  );

  const runImportSource = useCallback(
    async (statusKey: string): Promise<KnowledgePackDetail | null> => {
      const normalizedWorkingDir = workingDir.trim();
      const normalizedPackName = normalizePackNameInput(packNameInput);
      if (!normalizedWorkingDir) {
        setNotice("请先选择项目");
        return null;
      }
      if (!normalizedPackName) {
        setNotice("请填写资料名称");
        return null;
      }
      if (!sourceText.trim()) {
        setNotice("请先粘贴来源资料");
        return null;
      }

      setActionStatus(statusKey);
      setNotice(null);
      try {
        const response = await importKnowledgeSource({
          workingDir: normalizedWorkingDir,
          packName: normalizedPackName,
          description: packDescription.trim() || undefined,
          packType: packType.trim() || undefined,
          sourceFileName: sourceFileName.trim() || undefined,
          sourceText,
        });
        setSelectedPack(response.pack);
        setSelectedPackName(response.pack.metadata.name);
        setPackNameInput(response.pack.metadata.name);
        setSourceText("");
        setNotice("资料已导入，进入待确认流程");
        await refreshCatalog(normalizedWorkingDir);
        return response.pack;
      } catch (error) {
        setNotice(getErrorMessage(error, "导入来源资料失败"));
        return null;
      } finally {
        setActionStatus(null);
      }
    },
    [
      packDescription,
      packNameInput,
      packType,
      refreshCatalog,
      sourceFileName,
      sourceText,
      workingDir,
    ],
  );

  const handleImportSource = useCallback(async () => {
    await runImportSource("import");
  }, [runImportSource]);

  const compileByName = useCallback(
    async (packName: string) => {
      if (!workingDir || !packName) {
        return null;
      }

      setActionStatus("compile");
      setNotice(null);
      try {
        const response = await compileKnowledgePack(workingDir, packName);
        setSelectedPack(response.pack);
        setSelectedPackName(response.pack.metadata.name);
        setNotice(
          response.warnings.length > 0
            ? `已整理，提示：${response.warnings.join("；")}`
            : "引用摘要已生成，等待人工确认",
        );
        await refreshCatalog(workingDir);
        return response.pack;
      } catch (error) {
        setNotice(getErrorMessage(error, "整理资料失败"));
        return null;
      } finally {
        setActionStatus(null);
      }
    },
    [refreshCatalog, workingDir],
  );

  const handleCompile = useCallback(async () => {
    if (!selectedPackName) {
      setNotice("请先选择资料");
      return;
    }
    await compileByName(selectedPackName);
  }, [compileByName, selectedPackName]);

  const handleStartWizardCompile = useCallback(async () => {
    let packName = selectedPackName || normalizePackNameInput(packNameInput);
    if (sourceText.trim()) {
      const imported = await runImportSource("compile-import");
      if (!imported) {
        return;
      }
      packName = imported.metadata.name;
    }
    if (!packName) {
      setNotice("请先导入资料或选择已有资料");
      return;
    }
    const compiled = await compileByName(packName);
    if (compiled) {
      setActiveView("detail");
      setDetailTab("runtime");
    }
  }, [
    compileByName,
    packNameInput,
    runImportSource,
    selectedPackName,
    sourceText,
  ]);

  const handleSetDefaultForPack = useCallback(
    async (packName = selectedPackName) => {
      if (!workingDir || !packName) {
        return;
      }

      setActionStatus("default");
      setNotice(null);
      try {
        await setDefaultKnowledgePack(workingDir, packName);
        setNotice("已设为当前项目默认资料");
        await refreshCatalog(workingDir);
      } catch (error) {
        setNotice(getErrorMessage(error, "设置默认资料失败"));
      } finally {
        setActionStatus(null);
      }
    },
    [refreshCatalog, selectedPackName, workingDir],
  );

  const handleUpdateStatus = useCallback(
    async (status: KnowledgePackStatus) => {
      if (!workingDir || !selectedPackName) {
        return;
      }

      setActionStatus(status === "ready" ? "confirm" : "archive");
      setNotice(null);
      try {
        const response = await updateKnowledgePackStatus({
          workingDir,
          name: selectedPackName,
          status,
        });
        setSelectedPack(response.pack);
        setSelectedPackName(response.pack.metadata.name);
        setNotice(
          status === "ready"
            ? "资料已人工确认，可以设为默认或用于生成"
            : response.clearedDefault
              ? "资料已归档，并已清理当前项目默认标记"
              : "资料已归档",
        );
        await refreshCatalog(workingDir);
        if (status === "archived") {
          setActiveView("overview");
        }
      } catch (error) {
        setNotice(getErrorMessage(error, "更新资料状态失败"));
      } finally {
        setActionStatus(null);
      }
    },
    [refreshCatalog, selectedPackName, workingDir],
  );

  const handleOpenBuilder = useCallback(() => {
    const normalizedPackName =
      selectedPackName || normalizePackNameInput(packNameInput);
    if (!workingDir || !normalizedPackName) {
      setNotice("请先选择项目和资料名称");
      return;
    }

    const prompt = buildKnowledgeBuilderPrompt({
      workingDir,
      packName: normalizedPackName,
      packType: selectedPack?.metadata.type ?? packType,
      description: selectedPack?.metadata.description ?? packDescription,
    });
    const requestMetadata = buildKnowledgeBuilderMetadata({
      workingDir,
      packName: normalizedPackName,
      source: "knowledge_page",
    });

    onNavigate?.("agent", {
      agentEntry: "claw",
      projectId: selectedProjectId ?? undefined,
      initialUserPrompt: prompt,
      initialRequestMetadata: requestMetadata,
      initialAutoSendRequestMetadata: requestMetadata,
      autoRunInitialPromptOnMount: true,
    });
  }, [
    onNavigate,
    packDescription,
    packNameInput,
    packType,
    selectedPack,
    selectedPackName,
    selectedProjectId,
    workingDir,
  ]);

  const handleOpenAgentKnowledgeHub = useCallback(() => {
    onNavigate?.("agent", {
      agentEntry: "claw",
      projectId: selectedProjectId ?? undefined,
      initialInputCapability: {
        capabilityRoute: {
          kind: "builtin_command",
          commandKey: "knowledge_pack",
          commandPrefix: "@资料",
        },
        requestKey: Date.now(),
      },
    });
  }, [onNavigate, selectedProjectId]);

  const handleSendWithKnowledge = useCallback((packNameOverride?: string) => {
    const packName =
      packNameOverride?.trim() ||
      selectedPackName ||
      selectedSummary?.metadata.name ||
      "";
    if (!workingDir || !packName) {
      setNotice("请先选择资料");
      return;
    }
    const packForRequest =
      packs.find((pack) => pack.metadata.name === packName) ??
      (selectedSummary?.metadata.name === packName ? selectedSummary : null);

    const requestMetadata = buildKnowledgeRequestMetadata({
      workingDir,
      packName,
      pack: packForRequest,
    });

    onNavigate?.("agent", {
      agentEntry: "claw",
      projectId: selectedProjectId ?? undefined,
      initialUserPrompt: "请基于当前项目资料生成内容",
      initialRequestMetadata: requestMetadata,
      initialKnowledgePackSelection: {
        enabled: true,
        packName,
        workingDir,
        label: packForRequest ? getPackTitle(packForRequest) : packName,
        status: packForRequest?.metadata.status,
      },
      autoRunInitialPromptOnMount: false,
    });
  }, [
    onNavigate,
    packs,
    selectedPackName,
    selectedSummary,
    selectedProjectId,
    workingDir,
  ]);

  const packMetrics = selectedSummary ? buildPackMetrics(selectedSummary) : [];
  const actionBusy = Boolean(actionStatus);
  const selectedPackReady = selectedSummary?.metadata.status === "ready";
  const sourceBackedPackCount = packs.filter(
    (pack) => pack.sourceCount > 0,
  ).length;
  const compiledPackCount = packs.filter(
    (pack) => pack.compiledCount > 0,
  ).length;
  const readyPackCount = packs.filter(
    (pack) => pack.metadata.status === "ready",
  ).length;
  return (
    <main className="flex h-full min-h-0 flex-1 overflow-auto bg-[linear-gradient(180deg,#f8fafc_0%,#eef7f2_100%)]">
      <div className="mx-auto flex min-h-full w-full max-w-[1440px] flex-col gap-5 px-6 py-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <Database className="h-3.5 w-3.5" />
              管理与确认
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-slate-950">
              项目资料
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              日常添加和使用请回到 Agent 输入框；这里只处理检查、确认、设为默认和归档。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleOpenAgentKnowledgeHub}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm shadow-slate-950/5 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <MessageSquareText className="h-4 w-4" />
              回到 Agent 添加
            </button>
            {selectedPackReady ? (
              <button
                type="button"
                onClick={() => handleSendWithKnowledge()}
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm shadow-slate-950/10 transition hover:bg-slate-800"
              >
                <MessageSquareText className="h-4 w-4" />
                用于生成
              </button>
            ) : null}
          </div>
        </header>

        <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm shadow-slate-950/5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-emerald-200 bg-emerald-50 text-emerald-700">
                <FolderOpen className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-950">
                    当前项目
                  </h2>
                  {selectedProjectName ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      {selectedProjectName}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  资料会保存到当前项目，之后生成内容时可直接引用。
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ProjectSelector
                value={selectedProjectId}
                onChange={handleProjectChange}
                placeholder="选择项目"
                dropdownSide="bottom"
                dropdownAlign="end"
                enableManagement
                density="compact"
                skipDefaultWorkspaceReadyCheck
                autoSelectFallback={false}
              />
              <button
                type="button"
                onClick={() => setActiveView("import")}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                <Upload className="h-4 w-4" />
                补充导入
              </button>
            </div>
          </div>

          <KnowledgeTroubleshootingPanel
            open={manualPathOpen}
            workingDir={workingDir}
            workingDirInput={workingDirInput}
            onToggle={() => setManualPathOpen((open) => !open)}
            onWorkingDirInputChange={setWorkingDirInput}
            onApplyWorkingDir={handleApplyWorkingDir}
          />

          {notice ? (
            <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700">
              {notice}
            </div>
          ) : null}
        </section>

        <nav className="grid gap-2 rounded-[24px] border border-slate-200 bg-white p-2 shadow-sm shadow-slate-950/5 md:grid-cols-4">
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveView(tab.id)}
              className={cn(
                "rounded-[18px] px-3 py-3 text-left transition",
                activeView === tab.id
                  ? "bg-slate-900 text-white shadow-sm shadow-slate-950/10"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
              )}
            >
              <div className="text-sm font-semibold">{tab.label}</div>
              <div
                className={cn(
                  "mt-1 text-xs",
                  activeView === tab.id ? "text-slate-200" : "text-slate-400",
                )}
              >
                {tab.description}
              </div>
            </button>
          ))}
        </nav>

        {activeView === "overview" ? (
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-5">
              <KnowledgeStatusRail
                sourceCount={sourceBackedPackCount}
                compiledCount={compiledPackCount}
                readyCount={readyPackCount}
              />

              {pendingPacks.length > 0 ? (
                <section className="rounded-[24px] border border-amber-200 bg-amber-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-amber-950">
                        等你确认的资料
                      </h2>
                      <p className="mt-1 text-sm text-amber-800">
                        这些资料还不会默认用于正式生成，请先检查缺口和风险提醒。
                      </p>
                    </div>
                    <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-700">
                      {pendingPacks.length} 份
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {pendingPacks.map((pack) => (
                      <button
                        key={pack.metadata.name}
                        type="button"
                        onClick={() => openPack(pack.metadata.name, "risks")}
                        className="rounded-[18px] border border-amber-200 bg-white px-3 py-3 text-left transition hover:bg-amber-50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
                            {getPackTitle(pack)}
                          </span>
                          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-amber-800">
                          {sanitizeKnowledgePreview(pack.preview) ||
                            "请检查后确认。"}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">
                      全部项目资料
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      在 Agent 输入框整理资料后，到这里检查、确认、设为默认或归档。
                    </p>
                  </div>
                  {catalogStatus === "loading" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  ) : null}
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {packs.length === 0 && catalogStatus !== "loading" ? (
                    <div className="lg:col-span-2 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-950">
                            还没有项目资料
                          </h3>
                          <p className="mt-1 text-sm leading-6 text-slate-500">
                            项目资料从日常工作里沉淀：先把内容交给当前 Agent，整理确认后再用于生成。
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={handleOpenAgentKnowledgeHub}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-800"
                          >
                            <MessageSquareText className="h-3.5 w-3.5" />
                            回到 Agent 添加
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveView("import")}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            <Upload className="h-3.5 w-3.5" />
                            补充导入
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-2 md:grid-cols-3">
                        {[
                          [
                            "从输入框添加",
                            "粘贴资料或写清目标，点击输入框下方的项目资料图标整理。",
                            MessageSquareText,
                          ],
                          [
                            "从文件管理器添加",
                            "在文件管理器选择文本或 Markdown 文件，直接设为项目资料。",
                            FolderOpen,
                          ],
                          [
                            "从结果继续沉淀",
                            "Agent 输出里出现可复用事实时，点击“沉淀为项目资料”。",
                            ClipboardCheck,
                          ],
                        ].map(([title, description, GuideIcon]) => {
                          const Icon = GuideIcon as typeof MessageSquareText;
                          return (
                            <div
                              key={title as string}
                              className="rounded-2xl border border-slate-200 bg-white px-3 py-3"
                            >
                              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                                <Icon className="h-3.5 w-3.5 text-emerald-600" />
                                {title as string}
                              </div>
                              <p className="mt-2 text-xs leading-5 text-slate-500">
                                {description as string}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    packs.map((pack) => (
                      <KnowledgePackCard
                        key={pack.metadata.name}
                        pack={pack}
                        actionBusy={actionBusy}
                        onOpen={(packName) => openPack(packName)}
                        onSetDefault={handleSetDefaultForPack}
                        onUse={handleSendWithKnowledge}
                      />
                    ))
                  )}
                </div>
              </section>
            </div>

            <aside className="space-y-4">
              <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
                <div className="flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4 text-emerald-600" />
                  <h2 className="text-sm font-semibold text-slate-950">
                    日常使用入口
                  </h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  资料整理、补充和生成使用都在 Agent 输入框完成；这里保留管理动作。
                </p>
                <button
                  type="button"
                  onClick={handleOpenAgentKnowledgeHub}
                  className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  <MessageSquareText className="h-4 w-4" />
                  回到 Agent
                </button>
              </section>

              <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-950">
                      管理概览
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {catalogStatus === "ready"
                        ? `${packs.length} 份项目资料`
                        : "读取中"}
                    </p>
                  </div>
                  <PackageCheck className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-xs text-slate-500">待确认</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">
                      {pendingPacks.length}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-xs text-slate-500">已确认</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">
                      {packs.filter((pack) => pack.metadata.status === "ready").length}
                    </div>
                  </div>
                </div>
              </section>
            </aside>
          </section>
        ) : null}

        {activeView === "import" ? (
          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">
                  补充导入资料
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  需要补充另一份资料时，可以在这里手动指定资料类型并导入。
                </p>
              </div>
              <button
                type="button"
                onClick={handleStartWizardCompile}
                disabled={actionBusy}
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {actionStatus === "compile" ||
                actionStatus === "compile-import" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                导入并整理
              </button>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                {[
                  [
                    "1",
                    "选择资料类型",
                    PACK_TYPES.map((type) => type.label).join(" · "),
                  ],
                  ["2", "粘贴资料", "访谈稿、产品资料、SOP 或 FAQ"],
                  ["3", "自动整理", "提炼事实、场景和风险提醒"],
                  ["4", "检查确认", "确认后才可默认用于生成"],
                ].map(([index, title, description]) => (
                  <div key={index} className="flex gap-3 pb-4 last:pb-0">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-700">
                      {index}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {title}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">
                        {description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-5">
                  <section className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <h3 className="text-sm font-semibold text-slate-950">
                      1 选择资料类型
                    </h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {PACK_TYPES.map((type) => {
                        const active = packType === type.value;
                        return (
                          <button
                            key={type.value}
                            type="button"
                            onClick={() => setPackType(type.value)}
                            className={cn(
                              "rounded-[18px] border p-3 text-left transition",
                              active
                                ? "border-emerald-300 bg-emerald-50 shadow-sm shadow-emerald-950/5"
                                : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white",
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-slate-900">
                                {type.label}
                              </span>
                              {active ? (
                                <Check className="h-4 w-4 text-emerald-600" />
                              ) : null}
                            </div>
                            <p className="mt-2 text-xs leading-5 text-slate-500">
                              {type.description}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <h3 className="text-sm font-semibold text-slate-950">
                      2 添加资料
                    </h3>
                    <label className="mt-3 grid gap-1.5 text-xs font-medium text-slate-600">
                      资料名称
                      <input
                        value={packDescription}
                        onChange={(event) => {
                          const nextName = event.target.value;
                          setPackDescription(nextName);
                          setPackNameInput(normalizePackNameInput(nextName));
                        }}
                        placeholder="例如：品牌产品资料"
                        className="h-10 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                      />
                    </label>
                    <label className="mt-3 grid gap-1.5 text-xs font-medium text-slate-600">
                      资料正文
                      <textarea
                        value={sourceText}
                        onChange={(event) => setSourceText(event.target.value)}
                        placeholder="粘贴访谈稿、产品资料、历史文案、SOP 或合规边界"
                        className="min-h-[180px] resize-y rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleImportSource}
                      disabled={actionBusy}
                      className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {actionStatus === "import" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                      导入资料
                    </button>
                  </section>
                </div>

                <aside className="space-y-4">
                  <section className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-emerald-600" />
                      <h3 className="text-sm font-semibold text-slate-950">
                        3 自动整理
                      </h3>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Lime 会把原始资料整理成可审阅摘要、适用场景、事实边界和待补充清单。
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenBuilder}
                      className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-700 bg-emerald-700 px-3 text-sm font-semibold text-white transition hover:bg-emerald-600"
                    >
                      <Sparkles className="h-4 w-4" />
                      整理资料
                    </button>
                  </section>

                  <section className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2">
                      <ListChecks className="h-4 w-4 text-sky-600" />
                      <h3 className="text-sm font-semibold text-slate-950">
                        4 检查确认
                      </h3>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {(selectedSummary
                        ? buildPackMetrics(selectedSummary)
                        : buildPackMetrics({
                            sourceCount: 0,
                            wikiCount: 0,
                            compiledCount: 0,
                            runCount: 0,
                          } as KnowledgePackSummary)
                      ).map((metric) => (
                        <div
                          key={metric.label}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
                        >
                          <div className="text-xs text-slate-500">
                            {metric.label}
                          </div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">
                            {metric.value}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      整理后先检查摘要、缺口和风险提醒；人工确认前不会默认用于正式生成。
                    </p>
                  </section>

                  <section className="rounded-[22px] border border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="h-4 w-4 text-amber-700" />
                      <h3 className="text-sm font-semibold text-amber-900">
                        人工确认
                      </h3>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-amber-800">
                      请先检查内容缺口、风险提醒和引用摘要；确认后才会成为可默认使用的项目资料。
                    </p>
                  </section>
                </aside>
              </div>
            </div>
          </section>
        ) : null}

        {activeView === "detail" ? (
          <section className="rounded-[24px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
            {!selectedPackName ? (
              <div className="grid min-h-[420px] place-items-center p-8 text-center">
                <div className="max-w-md">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white text-slate-400">
                    <BookOpen className="h-6 w-6" />
                  </div>
                  <h2 className="mt-4 text-base font-semibold text-slate-900">
                    先从全部资料中选择一份资料
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    详情页会展示内容、原始资料、引用摘要、风险提醒和整理记录。
                  </p>
                </div>
              </div>
            ) : detailStatus === "loading" ? (
              <div className="flex min-h-[420px] items-center justify-center text-sm text-slate-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在读取资料详情...
              </div>
            ) : selectedPack ? (
              <div>
                <section className="border-b border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-5 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={selectedPack.metadata.status} />
                        <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                          {selectedPack.metadata.status === "ready"
                            ? "已人工确认"
                            : "待人工确认"}
                        </span>
                        {selectedPack.defaultForWorkspace ? (
                          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                            默认资料
                          </span>
                        ) : null}
                      </div>
                      <h2 className="mt-3 text-xl font-semibold text-slate-950">
                        {getPackTitle(selectedPack)}
                      </h2>
                      <p className="mt-2 text-xs text-slate-500">
                        {getUserFacingPackTypeLabel(selectedPack.metadata.type)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleCompile}
                        disabled={actionBusy}
                        className="inline-flex h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {actionStatus === "compile" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        重新整理
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetDefaultForPack()}
                        disabled={actionBusy || !selectedPackReady}
                        title={
                          selectedPackReady
                            ? undefined
                            : "人工确认后才能设为默认"
                        }
                        className="inline-flex h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ShieldCheck className="h-4 w-4" />
                        设为默认
                      </button>
                      {selectedPack.metadata.status !== "ready" ? (
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus("ready")}
                          disabled={actionBusy}
                          className="inline-flex h-10 items-center gap-2 rounded-2xl border border-emerald-700 bg-emerald-700 px-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-60"
                        >
                          {actionStatus === "confirm" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ClipboardCheck className="h-4 w-4" />
                          )}
                          人工确认
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus("archived")}
                        disabled={actionBusy}
                        className="inline-flex h-10 items-center gap-2 rounded-2xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                      >
                        <Archive className="h-4 w-4" />
                        归档
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-4">
                    {packMetrics.map((metric) => (
                      <div
                        key={metric.label}
                        className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm shadow-slate-950/5"
                      >
                        <div className="text-xs font-medium text-slate-500">
                          {metric.label}
                        </div>
                        <div className="mt-1 text-xl font-semibold text-slate-900">
                          {metric.value}
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-slate-400">
                          {metric.caption}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <div className="border-b border-slate-200 px-5 py-3">
                  <div className="flex flex-wrap gap-2">
                    {DETAIL_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setDetailTab(tab.id)}
                        className={cn(
                          "h-9 rounded-2xl px-3 text-sm font-semibold transition",
                          detailTab === tab.id
                            ? "bg-slate-900 text-white"
                            : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                        )}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-5">
                  {detailTab === "overview" ? (
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                      <section className="rounded-[22px] border border-slate-200 bg-white p-4">
                        <h3 className="text-sm font-semibold text-slate-950">
                          适用场景
                        </h3>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                          {sanitizeKnowledgePreview(selectedPack.guide) ||
                            "等待整理适用场景。"}
                        </p>
                      </section>
                      <section className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                        <h3 className="text-sm font-semibold text-slate-950">
                          当前引用摘要
                        </h3>
                        <div className="mt-3 space-y-2">
                          {selectedPack.compiled.length > 0 ? (
                            selectedPack.compiled.map((entry) => (
                              <div
                                key={entry.relativePath}
                                className="rounded-2xl border border-slate-200 bg-white px-3 py-3"
                              >
                                <div className="text-xs font-semibold text-slate-800">
                                  引用摘要
                                </div>
                                <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                                  {sanitizeKnowledgePreview(entry.preview) ||
                                    "引用摘要已生成，可在 Agent 生成时作为参考。"}
                                </p>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
                              重新整理后会生成可用于生成的引用摘要。
                            </div>
                          )}
                        </div>
                      </section>
                    </div>
                  ) : null}

                  {detailTab === "content" ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <FileEntryList
                        title="资料说明"
                        entries={[
                          {
                            relativePath: "资料说明",
                            absolutePath: selectedPack.knowledgePath,
                            bytes: selectedPack.guide.length,
                            updatedAt: selectedPack.updatedAt,
                            preview: selectedPack.guide,
                          },
                        ]}
                        emptyLabel="缺少资料说明。"
                      />
                      <FileEntryList
                        title="整理内容"
                        entries={selectedPack.wiki}
                        emptyLabel="整理后会补充结构化内容。"
                      />
                    </div>
                  ) : null}

                  {detailTab === "sources" ? (
                    <FileEntryList
                      title="原始资料"
                      entries={selectedPack.sources}
                      emptyLabel="还没有导入来源资料。"
                    />
                  ) : null}

                  {detailTab === "runtime" ? (
                    <FileEntryList
                      title="引用摘要"
                      entries={selectedPack.compiled}
                      emptyLabel="整理后会生成引用摘要。"
                    />
                  ) : null}

                  {detailTab === "risks" ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <section className="rounded-[22px] border border-amber-200 bg-amber-50 p-4">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-700" />
                          <h3 className="text-sm font-semibold text-amber-900">
                            缺口与风险
                          </h3>
                        </div>
                        <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-800">
                          <li>
                            状态：
                            {resolveStatusLabel(selectedPack.metadata.status)}
                          </li>
                          <li>
                            {selectedPack.sourceCount > 0
                              ? "已记录来源锚点，输出时仍需避免编造未提供事实。"
                              : "缺少原始资料，不能作为可靠资料用于生成。"}
                          </li>
                          <li>
                            {selectedPack.compiledCount > 0
                              ? "已有引用摘要，可回到 Agent 输入框用于生成。"
                              : "缺少引用摘要，请先重新整理。"}
                          </li>
                        </ul>
                      </section>
                      <section className="rounded-[22px] border border-slate-200 bg-white p-4">
                        <h3 className="text-sm font-semibold text-slate-950">
                          安全边界
                        </h3>
                        <p className="mt-3 text-sm leading-6 text-slate-600">
                          来源资料只会作为参考内容使用。资料里出现的指令式文本不会覆盖 Lime 的系统规则。
                        </p>
                      </section>
                    </div>
                  ) : null}

                  {detailTab === "runs" ? (
                    <FileEntryList
                      title="整理记录"
                      entries={selectedPack.runs}
                      emptyLabel="整理和质量检查记录会在这里出现。"
                    />
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="m-5 rounded-[20px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                未能读取资料详情，请刷新后重试。
              </div>
            )}
          </section>
        ) : null}

      </div>
    </main>
  );
}
