import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileText,
  FolderOpen,
  ListChecks,
  Loader2,
  MessageSquareText,
  PackageCheck,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  compileKnowledgePack,
  getKnowledgePack,
  importKnowledgeSource,
  listKnowledgePacks,
  resolveKnowledgeContext,
  setDefaultKnowledgePack,
  updateKnowledgePackStatus,
  type KnowledgeContextResolution,
  type KnowledgePackDetail,
  type KnowledgePackFileEntry,
  type KnowledgePackStatus,
  type KnowledgePackSummary,
} from "@/lib/api/knowledge";
import type { KnowledgePageParams, Page, PageParams } from "@/types/page";
import { cn } from "@/lib/utils";

interface KnowledgePageProps {
  onNavigate?: (page: Page, pageParams?: PageParams) => void;
  pageParams?: KnowledgePageParams;
}

type AsyncStatus = "idle" | "loading" | "ready" | "error";
type KnowledgeView = "overview" | "import" | "detail" | "chat";
type DetailTab =
  | "overview"
  | "content"
  | "sources"
  | "runtime"
  | "risks"
  | "runs";

const WORKING_DIR_STORAGE_KEY = "lime.knowledge.working-dir";
const DEFAULT_PACK_NAME = "founder-personal-ip";
const DEFAULT_SOURCE_FILE_NAME = "source.md";
const KNOWLEDGE_BUILDER_SKILL_NAME = "knowledge_builder";

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  ready: "已确认",
  "needs-review": "待确认",
  stale: "可能过期",
  disputed: "有争议",
  archived: "已归档",
};

const STATUS_CLASS_NAMES: Record<string, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
  "needs-review": "border-amber-200 bg-amber-50 text-amber-700",
  stale: "border-amber-200 bg-amber-50 text-amber-700",
  disputed: "border-rose-200 bg-rose-50 text-rose-700",
  archived: "border-slate-200 bg-slate-100 text-slate-500",
};

const PACK_TYPES = [
  {
    value: "personal-ip",
    label: "个人 IP",
    description: "创始人介绍、故事素材、表达风格和商务话术。",
  },
  {
    value: "brand-product",
    label: "品牌产品",
    description: "品牌定位、产品事实、功效边界和客服口径。",
  },
  {
    value: "organization-knowhow",
    label: "组织 Know-how",
    description: "团队 SOP、交付方法、升级路径和不可回答边界。",
  },
  {
    value: "growth-strategy",
    label: "增长策略",
    description: "渠道策略、投放假设、转化漏斗和复盘结论。",
  },
];

const VIEW_TABS: Array<{
  id: KnowledgeView;
  label: string;
  description: string;
}> = [
  { id: "overview", label: "总览", description: "默认包和待确认" },
  { id: "import", label: "新建知识包", description: "导入与编译" },
  { id: "detail", label: "详情", description: "内容和风险" },
  { id: "chat", label: "聊天使用", description: "带知识包发送" },
];

const DETAIL_TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "概览" },
  { id: "content", label: "内容" },
  { id: "sources", label: "来源" },
  { id: "runtime", label: "运行时视图" },
  { id: "risks", label: "缺口与风险" },
  { id: "runs", label: "编译记录" },
];

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

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

function formatCount(value: number, unit: string): string {
  return `${value.toLocaleString("zh-CN")} ${unit}`;
}

function formatUpdatedAt(value: number): string {
  if (!value) {
    return "未记录";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function resolveStatusLabel(status: KnowledgePackStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function resolveStatusClassName(status: KnowledgePackStatus): string {
  return STATUS_CLASS_NAMES[status] ?? STATUS_CLASS_NAMES.draft;
}

function normalizePackNameInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function buildInitialWorkingDir(pageParams?: KnowledgePageParams): string {
  return pageParams?.workingDir?.trim() || readStoredWorkingDir();
}

function getPackTitle(
  pack: KnowledgePackSummary | KnowledgePackDetail,
): string {
  return pack.metadata.description || pack.metadata.name;
}

function getPackTypeLabel(value?: string | null): string {
  return (
    PACK_TYPES.find((type) => type.value === value)?.label ?? value ?? "自定义"
  );
}

function buildPackMetrics(pack: KnowledgePackSummary | KnowledgePackDetail) {
  return [
    { label: "来源", value: pack.sourceCount, caption: "sources/" },
    { label: "Wiki", value: pack.wikiCount, caption: "wiki/" },
    { label: "运行视图", value: pack.compiledCount, caption: "compiled/" },
    { label: "编译记录", value: pack.runCount, caption: "runs/" },
  ];
}

function buildPackUsageLine(
  pack: KnowledgePackSummary | KnowledgePackDetail,
): string {
  return `来源 ${pack.sourceCount} 个 · 运行时视图 ${pack.compiledCount} 个 · 最近更新 ${formatUpdatedAt(
    pack.updatedAt,
  )}`;
}

function buildKnowledgeBuilderPrompt(params: {
  workingDir: string;
  packName: string;
  packType?: string;
  description?: string;
}) {
  const lines = [
    `请使用 Skill(${KNOWLEDGE_BUILDER_SKILL_NAME}) 为这个知识包生成可审阅的项目知识草稿。`,
    "",
    `working_dir: ${params.workingDir}`,
    `pack_name: ${params.packName}`,
  ];

  if (params.packType?.trim()) {
    lines.push(`pack_type: ${params.packType.trim()}`);
  }
  if (params.description?.trim()) {
    lines.push(`description: ${params.description.trim()}`);
  }

  lines.push(
    "",
    "请优先读取该知识包的 sources/、KNOWLEDGE.md 和已有 wiki/，生成 KNOWLEDGE.md、wiki/、compiled/brief.md 与 runs/compile-*.md 的草稿内容。",
    "只基于来源资料提炼事实；缺失内容标为待补充，不要编造。",
  );

  return lines.join("\n");
}

function buildKnowledgeRequestMetadata(params: {
  workingDir: string;
  packName: string;
  pack?: KnowledgePackSummary | KnowledgePackDetail | null;
  task?: string;
  contextPreview?: KnowledgeContextResolution | null;
}) {
  return {
    knowledge_pack: {
      pack_name: params.packName,
      working_dir: params.workingDir,
      source: "knowledge_page",
      status: params.pack?.metadata.status,
      grounding: params.pack?.metadata.grounding ?? "recommended",
      task: params.task?.trim() || undefined,
      selected_views: params.contextPreview?.selectedViews.map(
        (view) => view.relativePath,
      ),
      token_estimate: params.contextPreview?.tokenEstimate,
    },
  };
}

function StatusPill({ status }: { status: KnowledgePackStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
        resolveStatusClassName(status),
      )}
    >
      {resolveStatusLabel(status)}
    </span>
  );
}

function FileEntryList({
  title,
  entries,
  emptyLabel,
}: {
  title: string;
  entries: KnowledgePackFileEntry[];
  emptyLabel: string;
}) {
  return (
    <section className="rounded-[20px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-500">
          {entries.length} 个
        </span>
      </div>
      <div className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
        {entries.length === 0 ? (
          <div className="m-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
            {emptyLabel}
          </div>
        ) : (
          entries.map((entry) => (
            <article
              key={entry.relativePath}
              className="px-4 py-3 transition hover:bg-slate-50"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 truncate font-mono text-xs font-semibold text-slate-800">
                  {entry.relativePath}
                </div>
                <div className="shrink-0 text-xs text-slate-400">
                  {formatCount(entry.bytes, "B")}
                </div>
              </div>
              {entry.preview ? (
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                  {entry.preview}
                </p>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function PackCard({
  pack,
  actionBusy,
  variant = "default",
  onOpen,
  onSetDefault,
  onUse,
  onReview,
  onRisk,
}: {
  pack: KnowledgePackSummary;
  actionBusy: boolean;
  variant?: "default" | "pending" | "compact";
  onOpen: () => void;
  onSetDefault: () => void;
  onUse: () => void;
  onReview?: () => void;
  onRisk?: () => void;
}) {
  const isReady = pack.metadata.status === "ready";
  return (
    <article className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-950">
              {getPackTitle(pack)}
            </h3>
            <StatusPill status={pack.metadata.status} />
            {pack.defaultForWorkspace ? (
              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                默认
              </span>
            ) : null}
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            {pack.preview ||
              pack.metadata.scope ||
              "等待 Builder 提炼适用场景、事实和边界。"}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {buildPackUsageLine(pack)}
          </p>
        </div>
      </div>
      {variant === "pending" ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
          需要人工确认后才可设为默认；若存在事实缺口或合规风险，请先查看风险。
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-9 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          <BookOpen className="h-4 w-4" />
          打开
        </button>
        {variant === "pending" ? (
          <>
            <button
              type="button"
              onClick={onReview}
              className="inline-flex h-9 items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
            >
              <ClipboardCheck className="h-4 w-4" />
              继续确认
            </button>
            <button
              type="button"
              onClick={onRisk}
              className="inline-flex h-9 items-center gap-2 rounded-2xl border border-amber-200 bg-white px-3 text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
            >
              <AlertTriangle className="h-4 w-4" />
              查看风险
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onSetDefault}
              disabled={actionBusy || !isReady}
              title={isReady ? undefined : "未确认知识包不能设为默认"}
              className="inline-flex h-9 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              设为默认
            </button>
            <button
              type="button"
              onClick={onUse}
              className="inline-flex h-9 items-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <MessageSquareText className="h-4 w-4" />
              用于生成
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export function KnowledgePage({ onNavigate, pageParams }: KnowledgePageProps) {
  const [workingDirInput, setWorkingDirInput] = useState(() =>
    buildInitialWorkingDir(pageParams),
  );
  const [workingDir, setWorkingDir] = useState(() =>
    buildInitialWorkingDir(pageParams),
  );
  const [activeView, setActiveView] = useState<KnowledgeView>("overview");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [catalogStatus, setCatalogStatus] = useState<AsyncStatus>(
    workingDir ? "loading" : "idle",
  );
  const [catalogError, setCatalogError] = useState<string | null>(null);
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
  const [packDescription, setPackDescription] =
    useState("创始人个人 IP 知识库");
  const [packType, setPackType] = useState("personal-ip");
  const [sourceFileName, setSourceFileName] = useState(
    DEFAULT_SOURCE_FILE_NAME,
  );
  const [sourceText, setSourceText] = useState("");
  const [contextTask, setContextTask] = useState("写一段东莞企业家沙龙开场白");
  const [contextPreview, setContextPreview] =
    useState<KnowledgeContextResolution | null>(null);

  const selectedSummary = useMemo(
    () =>
      packs.find((pack) => pack.metadata.name === selectedPackName) ??
      selectedPack ??
      null,
    [packs, selectedPack, selectedPackName],
  );

  const defaultPack = useMemo(
    () => packs.find((pack) => pack.defaultForWorkspace) ?? null,
    [packs],
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

  const refreshCatalog = useCallback(
    async (nextWorkingDir = workingDir) => {
      const normalizedWorkingDir = nextWorkingDir.trim();
      if (!normalizedWorkingDir) {
        setCatalogStatus("idle");
        setCatalogError(null);
        setPacks([]);
        setSelectedPack(null);
        return;
      }

      setCatalogStatus("loading");
      setCatalogError(null);
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
        setCatalogError(getErrorMessage(error, "读取知识包列表失败"));
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
    if (!workingDir) {
      return;
    }

    void refreshCatalog(workingDir);
  }, [refreshCatalog, workingDir]);

  useEffect(() => {
    if (!workingDir || !selectedPackName) {
      setSelectedPack(null);
      setDetailStatus("idle");
      return;
    }

    let cancelled = false;
    setDetailStatus("loading");
    setContextPreview(null);
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
        setNotice(getErrorMessage(error, "读取知识包详情失败"));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPackName, workingDir]);

  const handleApplyWorkingDir = useCallback(() => {
    const normalized = workingDirInput.trim();
    setWorkingDir(normalized);
    persistWorkingDir(normalized);
    setSelectedPackName("");
    setSelectedPack(null);
    setContextPreview(null);
    void refreshCatalog(normalized);
  }, [refreshCatalog, workingDirInput]);

  const openPack = useCallback(
    (packName: string, nextTab: DetailTab = "overview") => {
      setSelectedPackName(packName);
      setDetailTab(nextTab);
      setActiveView("detail");
    },
    [],
  );

  const usePackInChat = useCallback((packName: string) => {
    setSelectedPackName(packName);
    setActiveView("chat");
  }, []);

  const runImportSource = useCallback(
    async (statusKey: string): Promise<KnowledgePackDetail | null> => {
      const normalizedWorkingDir = workingDir.trim();
      const normalizedPackName = normalizePackNameInput(packNameInput);
      if (!normalizedWorkingDir) {
        setNotice("请先填写项目根目录");
        return null;
      }
      if (!normalizedPackName) {
        setNotice("知识包标识仅支持小写字母、数字和连字符");
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
        setNotice("来源资料已导入知识包，进入待确认流程");
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
            ? `已编译，提示：${response.warnings.join("；")}`
            : "知识包运行时视图已编译，等待人工确认",
        );
        await refreshCatalog(workingDir);
        return response.pack;
      } catch (error) {
        setNotice(getErrorMessage(error, "编译知识包失败"));
        return null;
      } finally {
        setActionStatus(null);
      }
    },
    [refreshCatalog, workingDir],
  );

  const handleCompile = useCallback(async () => {
    if (!selectedPackName) {
      setNotice("请先选择知识包");
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
      setNotice("请先导入来源资料或选择知识包");
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
        setNotice("已设为当前项目默认知识包");
        await refreshCatalog(workingDir);
      } catch (error) {
        setNotice(getErrorMessage(error, "设置默认知识包失败"));
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
            ? "知识包已人工确认，可以设为默认或用于生成"
            : response.clearedDefault
              ? "知识包已归档，并已清理当前项目默认标记"
              : "知识包已归档",
        );
        await refreshCatalog(workingDir);
        if (status === "archived") {
          setActiveView("overview");
        }
      } catch (error) {
        setNotice(getErrorMessage(error, "更新知识包状态失败"));
      } finally {
        setActionStatus(null);
      }
    },
    [refreshCatalog, selectedPackName, workingDir],
  );

  const handleResolveContext = useCallback(async () => {
    const packName = selectedPackName || selectedSummary?.metadata.name || "";
    if (!workingDir || !packName) {
      return;
    }

    setActionStatus("resolve");
    setNotice(null);
    try {
      const resolved = await resolveKnowledgeContext({
        workingDir,
        name: packName,
        task: contextTask.trim() || undefined,
        maxChars: 12_000,
      });
      setContextPreview(resolved);
      setNotice("已生成知识上下文预览");
    } catch (error) {
      setNotice(getErrorMessage(error, "解析知识上下文失败"));
    } finally {
      setActionStatus(null);
    }
  }, [contextTask, selectedPackName, selectedSummary, workingDir]);

  const handleOpenBuilder = useCallback(() => {
    const normalizedPackName =
      selectedPackName || normalizePackNameInput(packNameInput);
    if (!workingDir || !normalizedPackName) {
      setNotice("请先填写项目根目录和知识包标识");
      return;
    }

    const prompt = buildKnowledgeBuilderPrompt({
      workingDir,
      packName: normalizedPackName,
      packType: selectedPack?.metadata.type ?? packType,
      description: selectedPack?.metadata.description ?? packDescription,
    });
    const requestMetadata = {
      knowledge_builder: {
        skill_name: KNOWLEDGE_BUILDER_SKILL_NAME,
        pack_name: normalizedPackName,
        working_dir: workingDir,
        source: "knowledge_page",
      },
    };

    onNavigate?.("agent", {
      agentEntry: "claw",
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
    workingDir,
  ]);

  const handleSendWithKnowledge = useCallback(() => {
    const packName = selectedPackName || selectedSummary?.metadata.name || "";
    if (!workingDir || !packName) {
      setNotice("请先选择知识包");
      return;
    }

    const requestMetadata = buildKnowledgeRequestMetadata({
      workingDir,
      packName,
      pack: selectedSummary,
      task: contextTask,
      contextPreview,
    });

    onNavigate?.("agent", {
      agentEntry: "claw",
      initialUserPrompt: contextTask.trim() || "请基于当前知识包生成内容",
      initialRequestMetadata: requestMetadata,
      initialAutoSendRequestMetadata: requestMetadata,
      autoRunInitialPromptOnMount: true,
    });
  }, [
    contextPreview,
    contextTask,
    onNavigate,
    selectedPackName,
    selectedSummary,
    workingDir,
  ]);

  const packMetrics = selectedSummary ? buildPackMetrics(selectedSummary) : [];
  const actionBusy = Boolean(actionStatus);
  const selectedPackReady = selectedSummary?.metadata.status === "ready";
  const selectedPackTitle = selectedSummary
    ? getPackTitle(selectedSummary)
    : "未选择知识包";

  return (
    <main className="flex h-full min-h-0 flex-1 overflow-auto bg-[linear-gradient(180deg,#f8fafc_0%,#eef7f2_100%)]">
      <div className="mx-auto flex min-h-full w-full max-w-[1440px] flex-col gap-5 px-6 py-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <Database className="h-3.5 w-3.5" />
              项目知识
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-slate-950">
              知识库
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              导入资料，编译成可审阅知识包，人工确认后再用于生成。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveView("import")}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm shadow-slate-950/5 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <Upload className="h-4 w-4" />
              导入资料
            </button>
            <button
              type="button"
              onClick={() => setActiveView("chat")}
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm shadow-slate-950/10 transition hover:bg-slate-800"
            >
              <MessageSquareText className="h-4 w-4" />
              聊天使用
            </button>
          </div>
        </header>

        <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-950/5">
          <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <FolderOpen className="h-4 w-4 text-emerald-600" />
              项目根目录
            </div>
            <input
              value={workingDirInput}
              onChange={(event) => setWorkingDirInput(event.target.value)}
              placeholder="粘贴项目根目录路径，例如 /Users/me/project"
              className="h-10 rounded-2xl border border-slate-200 bg-slate-50 px-3 font-mono text-sm text-slate-800 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-2 focus:ring-emerald-100"
            />
            <button
              type="button"
              onClick={handleApplyWorkingDir}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
          </div>
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
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
              <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">
                      当前项目默认知识包
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      只有已确认知识包可以默认用于生成。
                    </p>
                  </div>
                  {catalogStatus === "loading" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  ) : null}
                </div>
                <div className="mt-4">
                  {!workingDir ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm leading-6 text-slate-500">
                      先填写项目根目录，知识包会写入该项目下的
                      <span className="font-mono text-xs text-slate-700">
                        {" ".concat(".lime/knowledge/packs")}
                      </span>
                      。
                    </div>
                  ) : catalogStatus === "error" ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-700">
                      {catalogError}
                    </div>
                  ) : defaultPack ? (
                    <PackCard
                      pack={defaultPack}
                      actionBusy={actionBusy}
                      onOpen={() => openPack(defaultPack.metadata.name)}
                      onSetDefault={() =>
                        handleSetDefaultForPack(defaultPack.metadata.name)
                      }
                      onUse={() => usePackInChat(defaultPack.metadata.name)}
                    />
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm leading-6 text-slate-500">
                      当前项目还没有默认知识包。请先导入资料、编译并人工确认。
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">
                      待确认
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      草稿、待确认、过期或争议知识包不会自动成为默认上下文。
                    </p>
                  </div>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                    {pendingPacks.length} 个
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  {pendingPacks.length > 0 ? (
                    pendingPacks.map((pack) => (
                      <PackCard
                        key={pack.metadata.name}
                        pack={pack}
                        actionBusy={actionBusy}
                        variant="pending"
                        onOpen={() => openPack(pack.metadata.name)}
                        onSetDefault={() =>
                          handleSetDefaultForPack(pack.metadata.name)
                        }
                        onUse={() => usePackInChat(pack.metadata.name)}
                        onReview={() => openPack(pack.metadata.name)}
                        onRisk={() => openPack(pack.metadata.name, "risks")}
                      />
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-500">
                      暂无待确认知识包。可以从“导入资料”创建新的知识包。
                    </div>
                  )}
                </div>
              </section>
            </div>

            <aside className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">
                    知识包目录
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {catalogStatus === "ready"
                      ? `${packs.length} 个知识包`
                      : "读取 catalog"}
                  </p>
                </div>
                <PackageCheck className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-4 space-y-2">
                {packs.length === 0 && catalogStatus !== "loading" ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-500">
                    当前项目还没有知识包。
                  </div>
                ) : (
                  packs.map((pack) => {
                    const active = pack.metadata.name === selectedPackName;
                    return (
                      <button
                        key={pack.metadata.name}
                        type="button"
                        onClick={() => openPack(pack.metadata.name)}
                        className={cn(
                          "w-full rounded-[18px] border px-3 py-3 text-left transition",
                          active
                            ? "border-emerald-300 bg-emerald-50"
                            : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
                            {getPackTitle(pack)}
                          </span>
                          {pack.defaultForWorkspace ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                          ) : null}
                        </div>
                        <div className="mt-1 truncate font-mono text-xs text-slate-500">
                          {pack.metadata.name}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <StatusPill status={pack.metadata.status} />
                          <span className="text-xs text-slate-400">
                            {getPackTypeLabel(pack.metadata.type)}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>
          </section>
        ) : null}

        {activeView === "import" ? (
          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">
                  新建知识包
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  按 PRD 的五步链路执行：选择类型、添加来源、选择
                  Builder、编译预览、人工确认。
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
                开始编译
              </button>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                {[
                  [
                    "1",
                    "选择类型",
                    PACK_TYPES.map((type) => type.label).join(" · "),
                  ],
                  ["2", "添加来源", "DOCX / MD / TXT，或粘贴文本"],
                  ["3", "选择 Builder", KNOWLEDGE_BUILDER_SKILL_NAME],
                  ["4", "编译预览", "wiki 草稿 / 运行时视图 / 待补充清单"],
                  ["5", "人工确认", "确认后才可默认用于生成"],
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
                      1 选择类型
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
                      2 添加来源
                    </h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1.5 text-xs font-medium text-slate-600">
                        知识包标识
                        <input
                          value={packNameInput}
                          onChange={(event) =>
                            setPackNameInput(
                              normalizePackNameInput(event.target.value),
                            )
                          }
                          className="h-10 rounded-2xl border border-slate-200 bg-slate-50 px-3 font-mono text-sm text-slate-800 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                        />
                      </label>
                      <label className="grid gap-1.5 text-xs font-medium text-slate-600">
                        文件名
                        <input
                          value={sourceFileName}
                          onChange={(event) =>
                            setSourceFileName(event.target.value)
                          }
                          className="h-10 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                        />
                      </label>
                    </div>
                    <label className="mt-3 grid gap-1.5 text-xs font-medium text-slate-600">
                      知识包说明
                      <input
                        value={packDescription}
                        onChange={(event) =>
                          setPackDescription(event.target.value)
                        }
                        className="h-10 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                      />
                    </label>
                    <label className="mt-3 grid gap-1.5 text-xs font-medium text-slate-600">
                      来源正文
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
                      导入到知识包
                    </button>
                  </section>
                </div>

                <aside className="space-y-4">
                  <section className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-emerald-600" />
                      <h3 className="text-sm font-semibold text-slate-950">
                        3 选择 Builder
                      </h3>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      使用正式 Skill：
                      <span className="font-mono text-xs text-slate-900">
                        {" ".concat(KNOWLEDGE_BUILDER_SKILL_NAME)}
                      </span>
                      。它负责生成 wiki 草稿、运行时视图和待补充清单。
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenBuilder}
                      className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-700 bg-emerald-700 px-3 text-sm font-semibold text-white transition hover:bg-emerald-600"
                    >
                      <Sparkles className="h-4 w-4" />
                      Builder 生成
                    </button>
                  </section>

                  <section className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2">
                      <ListChecks className="h-4 w-4 text-sky-600" />
                      <h3 className="text-sm font-semibold text-slate-950">
                        4 编译预览
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
                      编译只生成可审阅草稿；进入 ready
                      前不会默认污染生成上下文。
                    </p>
                  </section>

                  <section className="rounded-[22px] border border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className="h-4 w-4 text-amber-700" />
                      <h3 className="text-sm font-semibold text-amber-900">
                        5 人工确认
                      </h3>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-amber-800">
                      确认动作会写回 KNOWLEDGE.md frontmatter 的 status，并把
                      trust 标记为 user-confirmed。
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
                    先从总览选择一个知识包
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    详情页会展示内容、来源、运行时视图、风险和编译记录。
                  </p>
                </div>
              </div>
            ) : detailStatus === "loading" ? (
              <div className="flex min-h-[420px] items-center justify-center text-sm text-slate-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在读取知识包详情...
              </div>
            ) : selectedPack ? (
              <div>
                <section className="border-b border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-5 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={selectedPack.metadata.status} />
                        <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                          {selectedPack.metadata.trust ?? "unreviewed"}
                        </span>
                        {selectedPack.defaultForWorkspace ? (
                          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                            默认知识包
                          </span>
                        ) : null}
                      </div>
                      <h2 className="mt-3 text-xl font-semibold text-slate-950">
                        {getPackTitle(selectedPack)}
                      </h2>
                      <p className="mt-2 font-mono text-xs text-slate-500">
                        {selectedPack.metadata.name} ·{" "}
                        {getPackTypeLabel(selectedPack.metadata.type)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled
                        title="文件编辑器入口尚未接入；当前避免做假编辑按钮"
                        className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-400"
                      >
                        <Pencil className="h-4 w-4" />
                        编辑 KNOWLEDGE.md
                      </button>
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
                        重新编译
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
                          {selectedPack.guide || "等待 Builder 生成适用场景。"}
                        </p>
                      </section>
                      <section className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                        <h3 className="text-sm font-semibold text-slate-950">
                          当前运行时视图
                        </h3>
                        <div className="mt-3 space-y-2">
                          {selectedPack.compiled.length > 0 ? (
                            selectedPack.compiled.map((entry) => (
                              <div
                                key={entry.relativePath}
                                className="rounded-2xl border border-slate-200 bg-white px-3 py-3"
                              >
                                <div className="font-mono text-xs font-semibold text-slate-800">
                                  {entry.relativePath}
                                </div>
                                <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                                  {entry.preview || "运行时视图"}
                                </p>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
                              重新编译后会生成 compiled/brief.md。
                            </div>
                          )}
                        </div>
                      </section>
                    </div>
                  ) : null}

                  {detailTab === "content" ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <FileEntryList
                        title="KNOWLEDGE.md 指南"
                        entries={[
                          {
                            relativePath: "KNOWLEDGE.md",
                            absolutePath: selectedPack.knowledgePath,
                            bytes: selectedPack.guide.length,
                            updatedAt: selectedPack.updatedAt,
                            preview: selectedPack.guide,
                          },
                        ]}
                        emptyLabel="缺少 KNOWLEDGE.md。"
                      />
                      <FileEntryList
                        title="Wiki 草稿"
                        entries={selectedPack.wiki}
                        emptyLabel="Builder 生成后会补充结构化 wiki。"
                      />
                    </div>
                  ) : null}

                  {detailTab === "sources" ? (
                    <FileEntryList
                      title="来源资料"
                      entries={selectedPack.sources}
                      emptyLabel="还没有导入来源资料。"
                    />
                  ) : null}

                  {detailTab === "runtime" ? (
                    <FileEntryList
                      title="运行时视图"
                      entries={selectedPack.compiled}
                      emptyLabel="编译后会生成 compiled/brief.md。"
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
                              : "缺少来源资料，不能作为可靠知识包用于生成。"}
                          </li>
                          <li>
                            {selectedPack.compiledCount > 0
                              ? "已有运行时视图，可先查看引用再发送。"
                              : "缺少运行时视图，请先重新编译。"}
                          </li>
                        </ul>
                      </section>
                      <section className="rounded-[22px] border border-slate-200 bg-white p-4">
                        <h3 className="text-sm font-semibold text-slate-950">
                          安全边界
                        </h3>
                        <p className="mt-3 text-sm leading-6 text-slate-600">
                          Runtime 只通过 knowledge_resolve_context 注入 fenced
                          context。来源中的“忽略系统规则”等指令式文本只能作为数据，不能覆盖系统规则。
                        </p>
                      </section>
                    </div>
                  ) : null}

                  {detailTab === "runs" ? (
                    <FileEntryList
                      title="编译记录"
                      entries={selectedPack.runs}
                      emptyLabel="编译和自动化运行记录会在这里出现。"
                    />
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="m-5 rounded-[20px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                未能读取知识包详情，请刷新目录后重试。
              </div>
            )}
          </section>
        ) : null}

        {activeView === "chat" ? (
          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="rounded-[22px] border border-slate-200 bg-white p-4">
                <label className="grid gap-2 text-sm font-semibold text-slate-900">
                  聊天任务
                  <textarea
                    value={contextTask}
                    onChange={(event) => setContextTask(event.target.value)}
                    className="min-h-[120px] resize-y rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-base leading-7 text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-100"
                  />
                </label>

                <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">
                        知识包：{selectedPackTitle}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        使用方式：推荐上下文 · 约{" "}
                        {contextPreview?.tokenEstimate ?? 8000} tokens
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveView("overview")}
                        className="inline-flex h-9 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        更换
                      </button>
                      <button
                        type="button"
                        onClick={handleResolveContext}
                        disabled={
                          actionBusy || (!selectedPackName && !selectedSummary)
                        }
                        className="inline-flex h-9 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                      >
                        {actionStatus === "resolve" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ListChecks className="h-4 w-4" />
                        )}
                        查看引用
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
                    提示：
                    {selectedPackReady
                      ? "已确认知识包可直接发送；缺失事实仍会标记为待确认。"
                      : "当前知识包未确认，建议先人工确认后再用于正式生成。"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSendWithKnowledge}
                  disabled={!selectedPackName && !selectedSummary}
                  className="mt-4 inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <MessageSquareText className="h-4 w-4" />
                  发送
                </button>
              </div>

              <aside className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-sky-600" />
                  <h3 className="text-sm font-semibold text-slate-950">
                    引用预览
                  </h3>
                </div>
                {contextPreview ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                        {contextPreview.tokenEstimate} tokens
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                        {contextPreview.selectedViews.length} 个视图
                      </span>
                    </div>
                    {contextPreview.warnings.length > 0 ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                        {contextPreview.warnings.join("；")}
                      </div>
                    ) : null}
                    <pre className="max-h-[360px] overflow-auto rounded-2xl border border-slate-200 bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                      {contextPreview.fencedContext}
                    </pre>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm leading-6 text-slate-500">
                    点击“查看引用”后会展示 knowledge_resolve_context
                    返回的数据围栏。
                  </div>
                )}
              </aside>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
