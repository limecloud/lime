import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BookOpen,
  Check,
  ClipboardCheck,
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
  resolveKnowledgePackRuntimeMode,
  resolveKnowledgeRequestCompanionPacks,
  type KnowledgeRequestCompanionPack,
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
  const [workingDirInput, setWorkingDirInput] = useState(
    () => initialStoredWorkingDir,
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
  const [knowledgeComposerOpen, setKnowledgeComposerOpen] = useState(false);
  const [composerPersonaPackName, setComposerPersonaPackName] = useState<
    string | null
  >(null);
  const [composerDataPackNames, setComposerDataPackNames] = useState<string[]>(
    [],
  );

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
  const readyPacks = useMemo(
    () => packs.filter((pack) => pack.metadata.status === "ready"),
    [packs],
  );
  const readyPersonaPacks = useMemo(
    () =>
      readyPacks.filter(
        (pack) => resolveKnowledgePackRuntimeMode(pack) === "persona",
      ),
    [readyPacks],
  );
  const readyDataPacks = useMemo(
    () =>
      readyPacks.filter(
        (pack) => resolveKnowledgePackRuntimeMode(pack) === "data",
      ),
    [readyPacks],
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
            ? "已整理，下一步请检查引用摘要、缺口和风险边界"
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
      packType: selectedPack?.metadata.type ?? packType,
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

  const handleOpenKnowledgeComposer = useCallback(
    (packNameOverride?: string) => {
      const packName =
        packNameOverride?.trim() ||
        selectedPackName ||
        selectedSummary?.metadata.name ||
        "";
      if (!workingDir || !packName) {
        setNotice("请先选择资料");
        return;
      }
      const seedPack =
        packs.find((pack) => pack.metadata.name === packName) ??
        (selectedSummary?.metadata.name === packName ? selectedSummary : null);
      const defaultPersonaPack =
        readyPersonaPacks.find((pack) => pack.defaultForWorkspace) ??
        readyPersonaPacks[0] ??
        null;
      const seedRuntimeMode = seedPack
        ? resolveKnowledgePackRuntimeMode(seedPack)
        : "data";

      setComposerPersonaPackName(
        seedRuntimeMode === "persona"
          ? packName
          : defaultPersonaPack?.metadata.name ?? null,
      );
      setComposerDataPackNames(seedRuntimeMode === "data" ? [packName] : []);
      setKnowledgeComposerOpen(true);
    },
    [
      packs,
      readyPersonaPacks,
      selectedPackName,
      selectedSummary,
      workingDir,
    ],
  );

  const handleToggleComposerDataPack = useCallback((packName: string) => {
    setComposerDataPackNames((current) =>
      current.includes(packName)
        ? current.filter((item) => item !== packName)
        : [...current, packName],
    );
  }, []);

  const handleConfirmKnowledgeComposer = useCallback(() => {
    if (!workingDir) {
      setNotice("请先选择项目");
      return;
    }

    const selectedDataNames = composerDataPackNames.filter((packName) =>
      readyDataPacks.some((pack) => pack.metadata.name === packName),
    );
    const selectedPersonaName =
      composerPersonaPackName &&
      readyPersonaPacks.some(
        (pack) => pack.metadata.name === composerPersonaPackName,
      )
        ? composerPersonaPackName
        : null;
    const packName = selectedDataNames[0] ?? selectedPersonaName;

    if (!packName) {
      setNotice("请至少选择一份已确认资料");
      return;
    }

    const companionPacks: KnowledgeRequestCompanionPack[] = [];
    if (selectedPersonaName && selectedPersonaName !== packName) {
      companionPacks.push({
        name: selectedPersonaName,
        activation: "explicit",
      });
    }
    for (const dataPackName of selectedDataNames) {
      if (dataPackName === packName) {
        continue;
      }
      companionPacks.push({
        name: dataPackName,
        activation: "explicit",
      });
    }

    const packForRequest =
      packs.find((pack) => pack.metadata.name === packName) ?? null;

    const requestMetadata = buildKnowledgeRequestMetadata({
      workingDir,
      packName,
      pack: packForRequest,
      packs: companionPacks,
    });

    setKnowledgeComposerOpen(false);
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
        ...(companionPacks.length ? { companionPacks } : {}),
      },
      autoRunInitialPromptOnMount: false,
    });
  }, [
    composerDataPackNames,
    composerPersonaPackName,
    onNavigate,
    packs,
    readyDataPacks,
    readyPersonaPacks,
    selectedProjectId,
    workingDir,
  ]);

  const getCompanionLabelsForPack = useCallback(
    (packName: string) =>
      resolveKnowledgeRequestCompanionPacks({
        primaryPackName: packName,
        packs,
      }).map((companionPack) => {
        const pack = packs.find(
          (candidate) => candidate.metadata.name === companionPack.name,
        );
        return pack ? getPackTitle(pack) : companionPack.name;
      }),
    [packs],
  );

  const selectedPackCompanionLabels = useMemo(() => {
    if (!selectedSummary) {
      return [];
    }
    return getCompanionLabelsForPack(selectedSummary.metadata.name);
  }, [getCompanionLabelsForPack, selectedSummary]);

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
  const defaultPersonaPack =
    readyPersonaPacks.find((pack) => pack.defaultForWorkspace) ??
    readyPersonaPacks[0] ??
    null;
  const defaultDataPack =
    readyDataPacks.find((pack) => pack.defaultForWorkspace) ??
    readyDataPacks[0] ??
    null;
  const composerSelectedCount =
    (composerPersonaPackName ? 1 : 0) + composerDataPackNames.length;
  return (
    <main className="flex h-full min-h-0 flex-1 overflow-auto bg-[linear-gradient(180deg,#f8fafc_0%,#eef7f2_100%)]">
      <div className="mx-auto flex min-h-full w-full max-w-[1440px] flex-col gap-5 px-6 py-5">
        <header className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0 max-w-3xl">
              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                Knowledge v2 · Skills-first
              </span>
              <h1 className="mt-3 text-2xl font-semibold text-slate-950">
                Agent Knowledge 工作台
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Agent Skills 负责怎么生产和维护知识；Agent Knowledge
                负责知识产物长什么样，以及如何安全进入上下文。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleOpenAgentKnowledgeHub}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <MessageSquareText className="h-4 w-4" />
                回到 Agent 整理
              </button>
              {selectedPackReady ? (
                <button
                  type="button"
                  onClick={() => handleOpenKnowledgeComposer()}
                  className="inline-flex h-10 items-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                >
                  <MessageSquareText className="h-4 w-4" />
                  选择用于生成
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid gap-3 md:grid-cols-3">
              {[
                {
                  title: "Builder Skills",
                  description: "个人 IP、品牌产品、内容运营等 Skill 生产线",
                  value: `${PACK_TYPES.length} 类`,
                  icon: Sparkles,
                },
                {
                  title: "Knowledge Packs",
                  description: "沉淀后的知识产物，先审阅再启用",
                  value: `${packs.length} 份`,
                  icon: PackageCheck,
                },
                {
                  title: "安全上下文",
                  description: "按 1 persona + N data 组合进入 Agent",
                  value: `${readyPersonaPacks.length} + ${readyDataPacks.length}`,
                  icon: ShieldCheck,
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-slate-500">
                        {item.title}
                      </div>
                      <Icon className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-slate-950">
                      {item.value}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {item.description}
                    </p>
                  </div>
                );
              })}
            </div>

            <section className="rounded-[22px] border border-emerald-200 bg-emerald-50 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-emerald-950">
                    当前项目
                    {selectedProjectName ? (
                      <span className="ml-2 text-emerald-700">
                        {selectedProjectName}
                      </span>
                    ) : null}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-emerald-800">
                    资料会保存到当前项目，并作为该项目的默认知识上下文候选。
                  </p>
                </div>
                <FolderOpen className="h-4 w-4 shrink-0 text-emerald-700" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
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
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-emerald-700 bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-600"
                >
                  <Upload className="h-4 w-4" />
                  启动 Builder
                </button>
              </div>
            </section>
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
        </header>

        <nav className="grid gap-2 rounded-[22px] border border-slate-200 bg-white p-2 shadow-sm md:grid-cols-3">
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveView(tab.id)}
              className={cn(
                "rounded-lg px-3 py-2.5 text-left transition",
                activeView === tab.id
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <div className="text-sm font-medium">{tab.label}</div>
              <div
                className={cn(
                  "mt-0.5 text-xs",
                  activeView === tab.id ? "text-slate-300" : "text-slate-500",
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
              <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold text-emerald-700">
                      Knowledge v2 上下文组合
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-slate-950">
                      1 persona + N data
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                      persona 决定表达语境，data 提供事实、SOP、运营节奏和边界；只有已确认资料才会进入
                      Agent 上下文。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      selectedPackReady
                        ? handleOpenKnowledgeComposer()
                        : handleOpenAgentKnowledgeHub()
                    }
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    <MessageSquareText className="h-4 w-4" />
                    {selectedPackReady ? "选择本轮上下文" : "先去 Agent 整理"}
                  </button>
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-[22px] border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-emerald-950">
                        Persona 人设层
                      </h3>
                      <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        {readyPersonaPacks.length} 份可用
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-emerald-800">
                      {defaultPersonaPack
                        ? `默认使用：${getPackTitle(defaultPersonaPack)}`
                        : "还没有已确认 persona；个人 IP 或品牌人设资料确认后会显示在这里。"}
                    </p>
                  </div>

                  <div className="rounded-[22px] border border-sky-200 bg-sky-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-sky-950">
                        Data 运营资料层
                      </h3>
                      <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-xs font-semibold text-sky-700">
                        {readyDataPacks.length} 份可用
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-sky-800">
                      {defaultDataPack
                        ? `可叠加：${getPackTitle(defaultDataPack)}${
                            readyDataPacks.length > 1
                              ? ` 等 ${readyDataPacks.length} 份`
                              : ""
                          }`
                        : "品牌产品、内容运营、私域、直播、活动和增长策略等资料确认后会进入 data 层。"}
                    </p>
                  </div>
                </div>
              </section>

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
                        审阅闸门：等你确认的资料
                      </h2>
                      <p className="mt-1 text-sm text-amber-800">
                        这些 Knowledge Pack 还不会进入 Agent 上下文，请先检查缺口和风险提醒。
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
                      Knowledge Pack 清单
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      这里不是文件夹管理器，而是知识产物目录：检查状态、确认边界、选择用于生成。
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
                            还没有 Knowledge Pack
                          </h3>
                          <p className="mt-1 text-sm leading-6 text-slate-500">
                            先把访谈稿、SOP、产品资料或运营复盘交给 Builder
                            Skill；生成的 Knowledge Pack 人工确认后再用于生成。
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={handleOpenAgentKnowledgeHub}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-800"
                          >
                            <MessageSquareText className="h-3.5 w-3.5" />
                            回到 Agent 整理
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveView("import")}
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            <Upload className="h-3.5 w-3.5" />
                            启动 Builder
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-2 md:grid-cols-3">
                        {[
                          [
                            "从 Agent 启动",
                            "在输入框选择项目资料入口，让对应 Builder Skill 整理资料。",
                            MessageSquareText,
                          ],
                          [
                            "选择资料类型",
                            "个人 IP、品牌产品、内容运营、私域、直播、活动和增长策略走不同 Skill。",
                            FolderOpen,
                          ],
                          [
                            "确认后入上下文",
                            "只有人工确认的 Knowledge Pack 才能被 Resolver 选入上下文。",
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
                        companionLabels={getCompanionLabelsForPack(
                          pack.metadata.name,
                        )}
                        onOpen={(packName) => openPack(packName)}
                        onSetDefault={handleSetDefaultForPack}
                        onUse={handleOpenKnowledgeComposer}
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
                    Skills 生产线
                  </h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  资料整理和维护回到 Agent 执行；页面只负责查看产物、审阅状态和上下文启用。
                </p>
                <button
                  type="button"
                  onClick={handleOpenAgentKnowledgeHub}
                  className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  <MessageSquareText className="h-4 w-4" />
                  回到 Agent 整理
                </button>
              </section>

              <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-950">
                      v2 闭环概览
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {catalogStatus === "ready"
                        ? `${packs.length} 份 Knowledge Pack`
                        : "读取中"}
                    </p>
                  </div>
                  <PackageCheck className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-xs text-slate-500">审阅中</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">
                      {pendingPacks.length}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-xs text-slate-500">可入上下文</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">
                      {
                        packs.filter((pack) => pack.metadata.status === "ready")
                          .length
                      }
                    </div>
                  </div>
                </div>
                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-xs font-semibold text-slate-700">
                    运营类资料覆盖
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    内容运营、私域 / 社群运营、直播运营、活动 / Campaign、增长策略都按
                    data pack 接入，不再只围绕个人 IP。
                  </p>
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
                  Builder Skills 整理台
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  选择一类 Builder Skill，把原始材料整理成 Knowledge Pack；这里保留手动补充入口，但生产逻辑仍回到 Skills。
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
                导入并生成 Pack
              </button>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                {[
                  [
                    "1",
                    "选择 Builder Skill",
                    "按资料类型选择对应生产线",
                  ],
                  ["2", "导入原始材料", "访谈稿、产品资料、SOP 或运营复盘"],
                  ["3", "生成 Knowledge Pack", "提炼事实、场景、边界和引用摘要"],
                  ["4", "审阅后入上下文", "确认后才能默认用于生成"],
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
                      1 选择 Builder Skill
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
                      2 导入原始材料
                    </h3>
                    <label className="mt-3 grid gap-1.5 text-xs font-medium text-slate-600">
                      Pack 显示名
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
                      原始材料正文
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
                      只导入材料
                    </button>
                  </section>
                </div>

                <aside className="space-y-4">
                  <section className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-emerald-600" />
                      <h3 className="text-sm font-semibold text-slate-950">
                        3 交给 Builder Skill
                      </h3>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Lime 会把当前材料交给对应 Builder Skill，产出可审阅摘要、适用场景、事实边界和待补充清单。
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenBuilder}
                      className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-700 bg-emerald-700 px-3 text-sm font-semibold text-white transition hover:bg-emerald-600"
                    >
                      <Sparkles className="h-4 w-4" />
                      交给 Builder Skill
                    </button>
                  </section>

                  <section className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2">
                      <ListChecks className="h-4 w-4 text-sky-600" />
                      <h3 className="text-sm font-semibold text-slate-950">
                        4 审阅与入上下文
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
                      先检查摘要、缺口和风险提醒；人工确认前不会默认进入 Agent 上下文。
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
                      请先检查内容缺口、风险提醒和引用摘要；确认后才会成为可默认使用的 Knowledge Pack。
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
                      {selectedPackCompanionLabels.length > 0 ? (
                        <p className="mt-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">
                          用于生成时会自动搭配人设资料：
                          {selectedPackCompanionLabels.join("、")}
                        </p>
                      ) : null}
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
                          来源资料只会作为参考内容使用。资料里出现的指令式文本不会覆盖
                          Lime 的系统规则。
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
      {knowledgeComposerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/25 px-4 py-6">
          <section
            className="max-h-[86vh] w-full max-w-3xl overflow-auto rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-950/20"
            role="dialog"
            aria-modal="true"
            aria-labelledby="knowledge-composer-title"
            data-testid="knowledge-composer-chooser"
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <p className="text-xs font-semibold text-emerald-700">
                  1 persona + N data
                </p>
                <h2
                  id="knowledge-composer-title"
                  className="mt-1 text-xl font-semibold text-slate-950"
                >
                  选择本轮 Knowledge 上下文
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  人设资料决定表达语境，data 资料提供事实、SOP、运营节奏和边界。确认后会按
                  persona 先、data 后进入 Resolver，再安全注入 Agent 上下文。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setKnowledgeComposerOpen(false)}
                className="inline-flex h-9 items-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                取消
              </button>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
              <section className="rounded-[22px] border border-emerald-100 bg-emerald-50 p-4">
                <h3 className="text-sm font-semibold text-emerald-950">
                  Persona（最多 1 个）
                </h3>
                <p className="mt-2 text-xs leading-5 text-emerald-800">
                  用来确定语气、口吻、价值观和不可越过的表达边界。
                </p>
                <div className="mt-4 grid gap-2">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!composerPersonaPackName}
                    onClick={() => setComposerPersonaPackName(null)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left text-sm transition",
                      !composerPersonaPackName
                        ? "border-emerald-300 bg-white text-emerald-900"
                        : "border-emerald-100 bg-emerald-50 text-emerald-800 hover:bg-white",
                    )}
                  >
                    <span>暂不搭配人设</span>
                    {!composerPersonaPackName ? (
                      <Check className="h-4 w-4" />
                    ) : null}
                  </button>
                  {readyPersonaPacks.map((pack) => {
                    const checked =
                      composerPersonaPackName === pack.metadata.name;
                    return (
                      <button
                        key={pack.metadata.name}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        data-testid={`knowledge-composer-persona-${pack.metadata.name}`}
                        onClick={() =>
                          setComposerPersonaPackName(pack.metadata.name)
                        }
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left text-sm transition",
                          checked
                            ? "border-emerald-300 bg-white text-emerald-950"
                            : "border-emerald-100 bg-emerald-50 text-emerald-800 hover:bg-white",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">
                            {getPackTitle(pack)}
                          </span>
                          <span className="mt-0.5 block text-xs text-emerald-700">
                            {getUserFacingPackTypeLabel(pack.metadata.type)}
                          </span>
                        </span>
                        {checked ? <Check className="h-4 w-4" /> : null}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">
                      Data（可多选）
                    </h3>
                    <p className="mt-2 text-xs leading-5 text-slate-600">
                      多选产品事实、运营 playbook、SOP 或活动资料，作为本轮生成事实源。
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                    已选 {composerDataPackNames.length}
                  </span>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {readyDataPacks.length > 0 ? (
                    readyDataPacks.map((pack) => {
                      const checked = composerDataPackNames.includes(
                        pack.metadata.name,
                      );
                      return (
                        <button
                          key={pack.metadata.name}
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          data-testid={`knowledge-composer-data-${pack.metadata.name}`}
                          onClick={() =>
                            handleToggleComposerDataPack(pack.metadata.name)
                          }
                          className={cn(
                            "min-w-0 rounded-2xl border px-3 py-3 text-left transition",
                            checked
                              ? "border-slate-900 bg-white shadow-sm shadow-slate-950/5"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                          )}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-slate-950">
                              {getPackTitle(pack)}
                            </span>
                            {checked ? (
                              <Check className="h-4 w-4 text-emerald-600" />
                            ) : null}
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {getUserFacingPackTypeLabel(pack.metadata.type)}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-500">
                      还没有已确认的 data 资料。可以先只用 persona，或回到 Agent
                      添加运营 / 产品资料。
                    </p>
                  )}
                </div>
              </section>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <p className="text-xs leading-5 text-slate-500">
                当前选择 {composerSelectedCount} 份资料；确认后会回到 Agent
                输入框，可继续编辑提示词。
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setKnowledgeComposerOpen(false)}
                  className="inline-flex h-10 items-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirmKnowledgeComposer}
                  disabled={composerSelectedCount === 0}
                  className="inline-flex h-10 items-center rounded-2xl border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  确认启用
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
