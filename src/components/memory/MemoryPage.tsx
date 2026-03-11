/**
 * 独立记忆页面
 *
 * 参考成熟产品的信息架构：
 * - 左侧分类导航（搜索 / 首页 / 身份 / 情境 / 偏好 / 经验 / 活动）
 * - 右侧主内容区（总览、分析、条目列表、详情）
 *
 * 所有数据均来自真实后端接口，不使用 Mock 数据。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  Database,
  HeartPulse,
  Home,
  Info,
  LayoutGrid,
  Lightbulb,
  List,
  Loader2,
  MessagesSquare,
  RefreshCw,
  Search,
  Settings2,
  Signature,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MemoryPageParams, Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import {
  getMemoryOverview as getContextMemoryOverview,
  type MemoryConfig as TauriMemoryConfig,
} from "@/lib/api/memoryRuntime";
import {
  createCharacter,
  createOutlineNode,
  getProjectMemory,
  type ProjectMemory,
  updateStyleGuide,
  updateWorldBuilding,
} from "@/lib/api/memory";
import {
  analyzeUnifiedMemories,
  deleteUnifiedMemory,
  getUnifiedMemoryStats,
  listUnifiedMemories,
  type MemoryCategory,
  type UnifiedMemory,
  type UnifiedMemoryAnalysisResult,
  type UnifiedMemoryStatsResponse,
} from "@/lib/api/unifiedMemory";
import {
  getStoredResourceProjectId,
  onResourceProjectChange,
} from "@/lib/resourceProjectSelection";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import { CanvasBreadcrumbHeader } from "@/components/content-creator/canvas/shared/CanvasBreadcrumbHeader";
import { buildLayerMetrics } from "./memoryLayerMetrics";
import { hasStyleGuideContent } from "@/lib/style-guide";

type CategoryType = MemoryCategory;
type CategoryFilter = "all" | CategoryType;
type MemorySection = "home" | CategoryType;
type ViewMode = "list" | "grid";

interface MemoryStatsResponse {
  total_entries: number;
  storage_used: number;
  memory_count: number;
}

interface MemoryCategoryStat {
  category: CategoryType;
  count: number;
}

interface MemoryEntryPreview {
  id: string;
  session_id: string;
  memory_type: string;
  source: string;
  category: CategoryType;
  title: string;
  summary: string;
  content: string;
  updated_at: number;
  created_at: number;
  tags: string[];
}

interface MemoryOverviewResponse {
  stats: MemoryStatsResponse;
  categories: MemoryCategoryStat[];
  entries: MemoryEntryPreview[];
}

interface ContextLayerStats {
  total_entries: number;
}

const CATEGORY_META: Record<
  CategoryType,
  { label: string; description: string; icon: LucideIcon }
> = {
  identity: {
    label: "身份",
    description: "关于你是谁的稳定信息",
    icon: Signature,
  },
  context: {
    label: "情境",
    description: "对话背景与当前约束",
    icon: MessagesSquare,
  },
  preference: {
    label: "偏好",
    description: "你的习惯、口味与偏爱",
    icon: HeartPulse,
  },
  experience: {
    label: "经验",
    description: "过往经历与可复用知识",
    icon: Lightbulb,
  },
  activity: {
    label: "活动",
    description: "近期计划与进行中的事项",
    icon: CalendarClock,
  },
};

const CATEGORY_ORDER: CategoryType[] = [
  "identity",
  "context",
  "preference",
  "experience",
  "activity",
];

const MEMORY_NAV_ITEMS: Array<{
  key: MemorySection;
  label: string;
  icon: LucideIcon;
  description: string;
}> = [
  {
    key: "home",
    label: "首页",
    icon: Home,
    description: "全部记忆",
  },
  {
    key: "identity",
    label: "身份",
    icon: CATEGORY_META.identity.icon,
    description: CATEGORY_META.identity.description,
  },
  {
    key: "context",
    label: "情境",
    icon: CATEGORY_META.context.icon,
    description: CATEGORY_META.context.description,
  },
  {
    key: "preference",
    label: "偏好",
    icon: CATEGORY_META.preference.icon,
    description: CATEGORY_META.preference.description,
  },
  {
    key: "experience",
    label: "经验",
    icon: CATEGORY_META.experience.icon,
    description: CATEGORY_META.experience.description,
  },
  {
    key: "activity",
    label: "活动",
    icon: CATEGORY_META.activity.icon,
    description: CATEGORY_META.activity.description,
  },
];

const SECTION_SHORTCUTS: Record<string, MemorySection> = {
  "1": "home",
  "2": "identity",
  "3": "context",
  "4": "preference",
  "5": "experience",
  "6": "activity",
};

function resolveMemorySection(
  section?: MemoryPageParams["section"],
): MemorySection {
  if (
    section === "home" ||
    section === "identity" ||
    section === "context" ||
    section === "preference" ||
    section === "experience" ||
    section === "activity"
  ) {
    return section;
  }

  return "home";
}

const DEFAULT_MEMORY_CONFIG: TauriMemoryConfig = {
  enabled: true,
  max_entries: 1000,
  retention_days: 30,
  auto_cleanup: true,
};

function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function normalizeTimestampMs(timestampMs: number): number {
  if (!timestampMs) return 0;
  return timestampMs > 1_000_000_000_000 ? timestampMs : timestampMs * 1000;
}

function formatRelativeTimestamp(timestampMs: number): string {
  const normalized = normalizeTimestampMs(timestampMs);
  if (!normalized) return "未知时间";

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return "未知时间";
  }

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} 天前`;

  return `${date.getMonth() + 1}/${date.getDate()} ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function formatAbsoluteTimestamp(timestampMs: number): string {
  const normalized = normalizeTimestampMs(timestampMs);
  if (!normalized) return "未知时间";

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return "未知时间";
  }

  return `${date.getFullYear()}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")} ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function parseDateStartTimestamp(dateText: string): number | undefined {
  if (!dateText) return undefined;
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.getTime();
}

function parseDateEndTimestamp(dateText: string): number | undefined {
  if (!dateText) return undefined;
  const date = new Date(`${dateText}T23:59:59.999`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.getTime();
}

function memoryTypeLabel(memoryType: string): string {
  switch (memoryType) {
    case "conversation":
      return "对话记忆";
    case "project":
      return "项目记忆";
    default:
      return "未知类型";
  }
}

function memorySourceLabel(source: string): string {
  switch (source) {
    case "auto_extracted":
      return "自动提取";
    case "manual":
      return "手动创建";
    case "imported":
      return "外部导入";
    default:
      return "未知来源";
  }
}

function toMemoryEntryPreview(memory: UnifiedMemory): MemoryEntryPreview {
  return {
    id: memory.id,
    session_id: memory.session_id,
    memory_type: memory.memory_type,
    source: memory.metadata.source,
    category: memory.category,
    title: memory.title,
    summary: memory.summary,
    content: memory.content,
    updated_at: memory.updated_at,
    created_at: memory.created_at,
    tags: memory.tags,
  };
}

function normalizeCategoryStats(
  stats: UnifiedMemoryStatsResponse,
): MemoryCategoryStat[] {
  const categoryMap = new Map(
    stats.categories.map((item) => [item.category, item.count]),
  );
  return CATEGORY_ORDER.map((category) => ({
    category,
    count: categoryMap.get(category) ?? 0,
  }));
}

function EmptyMemoryState({
  onAnalyze,
  loading,
  disabled,
}: {
  onAnalyze: () => void;
  loading: boolean;
  disabled: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center bg-muted/20">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <BrainCircuit className="h-6 w-6 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-2">暂无记忆</h3>
      <p className="text-sm text-muted-foreground mx-auto max-w-xl mb-6 leading-relaxed">
        记忆提取是渐进式能力。积累更多真实对话后，系统会抽取并沉淀更稳定的可用信息。
      </p>
      <button
        onClick={onAnalyze}
        disabled={loading || disabled}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            分析中...
          </>
        ) : (
          <>
            <CalendarClock className="h-4 w-4" />
            {disabled ? "记忆功能已关闭" : "请求记忆分析"}
          </>
        )}
      </button>
    </div>
  );
}

function MemoryEntryCollection({
  entries,
  viewMode,
  selectedEntryId,
  onSelect,
}: {
  entries: MemoryEntryPreview[];
  viewMode: ViewMode;
  selectedEntryId: string | null;
  onSelect: (entryId: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        当前筛选条件下暂无记忆条目
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {entries.map((entry) => {
          const meta = CATEGORY_META[entry.category];
          const selected = selectedEntryId === entry.id;

          return (
            <button
              key={entry.id}
              onClick={() => onSelect(entry.id)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                selected
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/50 hover:border-muted-foreground/30",
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {entry.title}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {meta.label} · {entry.session_id}
                  </div>
                </div>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                  {formatRelativeTimestamp(entry.updated_at)}
                </span>
              </div>

              <p className="text-xs text-muted-foreground line-clamp-3">
                {entry.summary || "暂无摘要"}
              </p>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="rounded-lg border divide-y">
      {entries.map((entry) => {
        const meta = CATEGORY_META[entry.category];
        const selected = selectedEntryId === entry.id;

        return (
          <button
            key={entry.id}
            onClick={() => onSelect(entry.id)}
            className={cn(
              "w-full p-4 space-y-2 text-left transition-colors",
              selected ? "bg-primary/5" : "hover:bg-muted/50",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  {entry.title}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {meta.label} · {entry.session_id}
                </div>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatRelativeTimestamp(entry.updated_at)}
              </span>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
              {entry.summary || "暂无摘要"}
            </p>

            {entry.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {entry.tags.slice(0, 4).map((tag) => (
                  <span
                    key={`${entry.id}-${tag}`}
                    className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function MemoryDetailPanel({
  entry,
  deleting,
  onDelete,
}: {
  entry: MemoryEntryPreview | null;
  deleting: boolean;
  onDelete: (entry: MemoryEntryPreview) => void;
}) {
  if (!entry) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground xl:sticky xl:top-4">
        请选择一条记忆查看详情
      </div>
    );
  }

  const meta = CATEGORY_META[entry.category];

  return (
    <div className="rounded-lg border p-4 space-y-4 xl:sticky xl:top-4">
      <div>
        <div className="text-xs text-muted-foreground mb-1">记忆标题</div>
        <div className="text-sm font-medium leading-relaxed">{entry.title}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-muted-foreground mb-1">记忆类型</div>
          <div className="font-medium">
            {memoryTypeLabel(entry.memory_type)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-1">记忆来源</div>
          <div className="font-medium">{memorySourceLabel(entry.source)}</div>
        </div>
        <div>
          <div className="text-muted-foreground mb-1">会话 ID</div>
          <div className="font-medium break-all">{entry.session_id}</div>
        </div>
        <div>
          <div className="text-muted-foreground mb-1">更新时间</div>
          <div className="font-medium">
            {formatAbsoluteTimestamp(entry.updated_at)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-1">创建时间</div>
          <div className="font-medium">
            {formatAbsoluteTimestamp(entry.created_at)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-1">分类</div>
          <div className="font-medium">{meta.label}</div>
        </div>
      </div>

      <div>
        <div className="text-xs text-muted-foreground mb-1">摘要内容</div>
        <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words rounded bg-muted/30 p-3">
          {entry.summary || "暂无摘要"}
        </div>
      </div>

      <div>
        <div className="text-xs text-muted-foreground mb-1">详细内容</div>
        <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words rounded bg-muted/30 p-3">
          {entry.content || "暂无内容"}
        </div>
      </div>

      <div>
        <div className="text-xs text-muted-foreground mb-2">标签</div>
        {entry.tags.length === 0 ? (
          <div className="text-xs text-muted-foreground">暂无标签</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {entry.tags.map((tag) => (
              <span
                key={`${entry.id}-detail-${tag}`}
                className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => onDelete(entry)}
        disabled={deleting}
        className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600 hover:bg-red-100 disabled:opacity-60"
      >
        {deleting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            删除中...
          </>
        ) : (
          <>
            <Trash2 className="h-4 w-4" />
            删除记忆（不可恢复）
          </>
        )}
      </button>
    </div>
  );
}

interface MemoryPageProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
  pageParams?: MemoryPageParams;
}

export function MemoryPage({ onNavigate, pageParams }: MemoryPageProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [config, setConfig] = useState<Config | null>(null);
  const [memoryConfig, setMemoryConfig] = useState<TauriMemoryConfig>(
    DEFAULT_MEMORY_CONFIG,
  );

  const [overview, setOverview] = useState<MemoryOverviewResponse | null>(null);
  const [contextLayerStats, setContextLayerStats] =
    useState<ContextLayerStats | null>(null);
  const [projectId, setProjectId] = useState<string | null>(() =>
    getStoredResourceProjectId({ includeLegacy: true }),
  );
  const [projectMemory, setProjectMemory] = useState<ProjectMemory | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [initializingProjectMemory, setInitializingProjectMemory] =
    useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<MemorySection>(() =>
    resolveMemorySection(pageParams?.section),
  );
  const [searchKeyword, setSearchKeyword] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const [analysisFromDate, setAnalysisFromDate] = useState("");
  const [analysisToDate, setAnalysisToDate] = useState("");
  const [analysisResult, setAnalysisResult] =
    useState<UnifiedMemoryAnalysisResult | null>(null);

  const maxEntriesOptions = [100, 500, 1000, 2000, 5000];
  const retentionDaysOptions = [7, 14, 30, 60, 90];

  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const showMessage = useCallback((type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3500);
  }, []);

  const handleBackHome = useCallback(() => {
    onNavigate?.("agent", buildHomeAgentParams());
  }, [onNavigate]);

  const stats: MemoryStatsResponse = useMemo(
    () =>
      overview?.stats ?? {
        total_entries: 0,
        storage_used: 0,
        memory_count: 0,
      },
    [overview],
  );

  const categories = useMemo(() => {
    if (!overview?.categories) {
      return CATEGORY_ORDER.map((category) => ({ category, count: 0 }));
    }

    const categoryMap = new Map(
      overview.categories.map((item) => [item.category, item.count]),
    );

    return CATEGORY_ORDER.map((category) => ({
      category,
      count: categoryMap.get(category) ?? 0,
    }));
  }, [overview]);

  const categoryCountMap = useMemo(
    () => new Map(categories.map((item) => [item.category, item.count])),
    [categories],
  );

  const entries = useMemo(() => overview?.entries ?? [], [overview]);
  const hasMemoryData = stats.total_entries > 0;
  const layerMetrics = useMemo(
    () =>
      buildLayerMetrics({
        unifiedTotalEntries: stats.total_entries,
        contextTotalEntries: contextLayerStats?.total_entries ?? 0,
        projectId,
        projectMemory,
      }),
    [
      contextLayerStats?.total_entries,
      projectId,
      projectMemory,
      stats.total_entries,
    ],
  );

  const activeCategoryFilter: CategoryFilter =
    activeSection === "home" ? "all" : activeSection;

  const filteredEntries = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();

    return entries.filter((entry) => {
      if (
        activeCategoryFilter !== "all" &&
        entry.category !== activeCategoryFilter
      ) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      const content =
        `${entry.title} ${entry.summary} ${entry.tags.join(" ")}`.toLowerCase();
      return content.includes(keyword);
    });
  }, [activeCategoryFilter, entries, searchKeyword]);

  useEffect(() => {
    if (filteredEntries.length === 0) {
      if (selectedEntryId !== null) {
        setSelectedEntryId(null);
      }
      return;
    }

    if (
      !selectedEntryId ||
      !filteredEntries.some((entry) => entry.id === selectedEntryId)
    ) {
      setSelectedEntryId(filteredEntries[0].id);
    }
  }, [filteredEntries, selectedEntryId]);

  const selectedEntry = useMemo(
    () => filteredEntries.find((entry) => entry.id === selectedEntryId) ?? null,
    [filteredEntries, selectedEntryId],
  );

  const loadConfig = useCallback(async () => {
    const loadedConfig = await getConfig();
    setConfig(loadedConfig);
    setMemoryConfig(loadedConfig.memory || DEFAULT_MEMORY_CONFIG);
  }, []);

  const loadOverview = useCallback(async () => {
    const [statsResult, memories, contextOverviewResult, projectMemoryResult] =
      await Promise.all([
        getUnifiedMemoryStats(),
        listUnifiedMemories({
          archived: false,
          sort_by: "updated_at",
          order: "desc",
          limit: 1000,
        }),
        getContextMemoryOverview(200).catch((error) => {
          console.warn("加载上下文记忆总览失败:", error);
          return null;
        }),
        projectId
          ? getProjectMemory(projectId).catch((error) => {
              console.warn("加载项目记忆失败:", error);
              return null;
            })
          : Promise.resolve(null),
      ]);

    const normalizedStats: MemoryOverviewResponse = {
      stats: {
        total_entries: statsResult.total_entries,
        storage_used: statsResult.storage_used,
        memory_count: statsResult.memory_count,
      },
      categories: normalizeCategoryStats(statsResult),
      entries: memories.map(toMemoryEntryPreview),
    };

    setOverview(normalizedStats);
    setContextLayerStats(
      contextOverviewResult
        ? { total_entries: contextOverviewResult.stats.total_entries }
        : null,
    );
    setProjectMemory(projectMemoryResult);
  }, [projectId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadConfig(), loadOverview()]);
    } catch (error) {
      console.error("加载记忆数据失败:", error);
      showMessage("error", "加载记忆失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [loadConfig, loadOverview, showMessage]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    return onResourceProjectChange((detail) => {
      setProjectId(detail.projectId);
    });
  }, []);

  useEffect(() => {
    const nextSection = resolveMemorySection(pageParams?.section);
    setActiveSection((previous) =>
      previous === nextSection ? previous : nextSection,
    );
  }, [pageParams?.section]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName.toLowerCase();
        if (
          tagName === "input" ||
          tagName === "textarea" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      const shortcutSection = SECTION_SHORTCUTS[event.key];
      if (shortcutSection) {
        event.preventDefault();
        setActiveSection(shortcutSection);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadOverview();
    } catch (error) {
      console.error("刷新记忆总览失败:", error);
      showMessage("error", "刷新失败");
    } finally {
      setRefreshing(false);
    }
  }, [loadOverview, showMessage]);

  const handleBootstrapProjectMemory = useCallback(async () => {
    if (!projectId) {
      showMessage("error", "请先在资源页或项目页选择一个项目");
      return;
    }

    if (initializingProjectMemory) {
      return;
    }

    const hasCharacters = (projectMemory?.characters.length ?? 0) > 0;
    const hasWorldBuilding =
      !!projectMemory?.world_building?.description?.trim();
    const hasStyleGuide = hasStyleGuideContent(projectMemory?.style_guide);
    const hasOutline = (projectMemory?.outline.length ?? 0) > 0;

    if (hasCharacters && hasWorldBuilding && hasStyleGuide && hasOutline) {
      showMessage("success", "第三层项目记忆已完善");
      return;
    }

    setInitializingProjectMemory(true);
    try {
      const tasks: Promise<unknown>[] = [];

      if (!hasCharacters) {
        tasks.push(
          createCharacter({
            project_id: projectId,
            name: "默认主角",
            description: "待补充角色设定",
            is_main: true,
          }),
        );
      }

      if (!hasWorldBuilding) {
        tasks.push(
          updateWorldBuilding(projectId, {
            description: "待补充世界观背景与规则",
          }),
        );
      }

      if (!hasStyleGuide) {
        tasks.push(
          updateStyleGuide(projectId, {
            style: "待补充写作风格与语气",
          }),
        );
      }

      if (!hasOutline) {
        tasks.push(
          createOutlineNode({
            project_id: projectId,
            title: "第一章",
            content: "待补充章节内容",
          }),
        );
      }

      if (tasks.length > 0) {
        await Promise.all(tasks);
      }

      await loadOverview();
      showMessage("success", "已初始化第三层项目记忆，请按需继续完善");
    } catch (error) {
      console.error("初始化项目记忆失败:", error);
      showMessage("error", "初始化项目记忆失败，请稍后重试");
    } finally {
      setInitializingProjectMemory(false);
    }
  }, [
    initializingProjectMemory,
    loadOverview,
    projectId,
    projectMemory?.characters.length,
    projectMemory?.outline.length,
    projectMemory?.style_guide,
    projectMemory?.world_building?.description,
    showMessage,
  ]);

  const handleAnalyze = useCallback(async () => {
    if (
      analysisFromDate &&
      analysisToDate &&
      analysisFromDate > analysisToDate
    ) {
      showMessage("error", "开始日期不能晚于结束日期");
      return;
    }

    if (!memoryConfig.enabled) {
      showMessage("error", "记忆功能已关闭，请先开启");
      return;
    }

    setAnalyzing(true);
    try {
      const fromTimestamp = parseDateStartTimestamp(analysisFromDate);
      const toTimestamp = parseDateEndTimestamp(analysisToDate);

      const result = await analyzeUnifiedMemories(fromTimestamp, toTimestamp);
      setAnalysisResult(result);
      await loadOverview();

      if (result.generated_entries > 0) {
        showMessage(
          "success",
          `分析完成：新增 ${result.generated_entries} 条记忆（去重 ${result.deduplicated_entries} 条）`,
        );
      } else {
        showMessage("success", "分析完成：暂无新的可提取记忆");
      }
    } catch (error) {
      console.error("记忆分析失败:", error);
      showMessage("error", "记忆分析失败，请稍后重试");
    } finally {
      setAnalyzing(false);
    }
  }, [
    analysisFromDate,
    analysisToDate,
    loadOverview,
    memoryConfig.enabled,
    showMessage,
  ]);

  const handleDeleteEntry = useCallback(
    async (entry: MemoryEntryPreview) => {
      const confirmed = window.confirm(
        `确定永久删除这条记忆吗？\n\n标题：${entry.title}\n\n该操作不可恢复。`,
      );
      if (!confirmed) {
        return;
      }

      setDeletingEntryId(entry.id);
      try {
        const deleted = await deleteUnifiedMemory(entry.id);
        if (!deleted) {
          showMessage("error", "删除失败，记忆可能不存在");
          return;
        }

        await loadOverview();
        showMessage("success", "记忆已删除");
      } catch (error) {
        console.error("删除记忆失败:", error);
        showMessage("error", "删除失败，请稍后重试");
      } finally {
        setDeletingEntryId(null);
      }
    },
    [loadOverview, showMessage],
  );

  const saveMemoryConfig = useCallback(
    async (key: keyof TauriMemoryConfig, value: boolean | number) => {
      if (!config) {
        showMessage("error", "配置尚未加载完成");
        return;
      }

      setSaving(true);
      try {
        const nextMemoryConfig: TauriMemoryConfig = {
          ...memoryConfig,
          [key]: value,
        };

        const nextConfig: Config = {
          ...config,
          memory: nextMemoryConfig,
        };

        await saveConfig(nextConfig);
        setConfig(nextConfig);
        setMemoryConfig(nextMemoryConfig);
        showMessage("success", "记忆设置已保存");
      } catch (error) {
        console.error("保存记忆设置失败:", error);
        showMessage("error", "记忆设置保存失败");
      } finally {
        setSaving(false);
      }
    },
    [config, memoryConfig, showMessage],
  );

  const sectionTitle =
    activeSection === "home"
      ? "记忆首页"
      : `${CATEGORY_META[activeSection].label}记忆`;

  const sectionDescription =
    activeSection === "home"
      ? "查看全部记忆并触发分析任务"
      : CATEGORY_META[activeSection].description;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex items-center border-b bg-background px-6 py-3">
        <CanvasBreadcrumbHeader label="记忆" onBackHome={handleBackHome} />
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-[248px] min-w-[248px] border-r bg-card/40 p-3 flex flex-col gap-3">
          <div className="px-2 py-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BrainCircuit className="h-4 w-4 text-primary" />
              记忆
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              按 / 搜索，按 1-6 切换视图
            </div>
          </div>

          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              ref={searchInputRef}
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              placeholder="搜索标题、摘要或标签"
              className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm text-foreground"
            />
          </label>

          <div className="space-y-1">
            {MEMORY_NAV_ITEMS.map((item) => {
              const active = activeSection === item.key;
              const count =
                item.key === "home"
                  ? stats.total_entries
                  : (categoryCountMap.get(item.key as CategoryType) ?? 0);

              return (
                <button
                  key={item.key}
                  onClick={() => setActiveSection(item.key)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                    active
                      ? "border-primary bg-primary/10"
                      : "border-transparent hover:bg-muted/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-sm font-medium">
                      <item.icon className="h-4 w-4 text-muted-foreground" />
                      {item.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {count}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground line-clamp-1">
                    {item.description}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-auto rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground leading-relaxed">
            记忆页面已接入统一记忆数据库：浏览、分析、删除都直接操作真实数据，不使用
            Mock 数据。
          </div>
        </aside>

        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto max-w-6xl p-6 space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold">{sectionTitle}</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {sectionDescription}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    onNavigate?.("settings", { tab: SettingsTabs.Memory })
                  }
                  className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  记忆设置
                </button>

                <button
                  onClick={handleRefresh}
                  disabled={refreshing || analyzing || loading}
                  className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
                >
                  <RefreshCw
                    className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
                  />
                  刷新
                </button>

                <button
                  onClick={handleAnalyze}
                  disabled={analyzing || loading || !memoryConfig.enabled}
                  className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      分析中...
                    </>
                  ) : (
                    <>
                      <CalendarClock className="h-3.5 w-3.5" />
                      请求记忆分析
                    </>
                  )}
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                正在加载记忆数据...
              </div>
            ) : (
              <>
                <div className="rounded-xl border p-4 bg-gradient-to-br from-primary/5 to-primary/10">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-lg bg-background/60 p-3">
                      <div className="text-xs text-muted-foreground mb-1">
                        记忆条数
                      </div>
                      <div className="text-2xl font-semibold text-primary">
                        {stats.total_entries}
                      </div>
                    </div>
                    <div className="rounded-lg bg-background/60 p-3">
                      <div className="text-xs text-muted-foreground mb-1">
                        存储空间
                      </div>
                      <div className="text-2xl font-semibold text-primary">
                        {formatStorageSize(stats.storage_used)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-background/60 p-3">
                      <div className="text-xs text-muted-foreground mb-1">
                        记忆库数
                      </div>
                      <div className="text-2xl font-semibold text-primary">
                        {stats.memory_count}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border p-4 bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="text-sm font-medium">三层记忆可用性</div>
                    <div className="text-xs text-muted-foreground">
                      已可用 {layerMetrics.readyLayers}/
                      {layerMetrics.totalLayers} 层
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {layerMetrics.cards.map((card) => (
                      <div
                        key={card.key}
                        className="rounded-lg border bg-background/60 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-muted-foreground">
                            {card.title}
                          </div>
                          <span
                            className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full border",
                              card.available
                                ? "text-green-700 border-green-200 bg-green-50 dark:text-green-400 dark:border-green-800 dark:bg-green-900/20"
                                : "text-muted-foreground border-muted",
                            )}
                          >
                            {card.available ? "已生效" : "待完善"}
                          </span>
                        </div>
                        <div className="text-xl font-semibold text-primary mt-1">
                          {card.value}
                          <span className="text-sm text-muted-foreground ml-1">
                            {card.unit}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          {card.description}
                        </div>
                        {card.key === "project" && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {!projectId ? (
                              <button
                                onClick={() => onNavigate?.("projects")}
                                className="rounded border px-2 py-1 text-[11px] hover:bg-muted"
                              >
                                去选择项目
                              </button>
                            ) : (
                              <>
                                {!card.available && (
                                  <button
                                    onClick={handleBootstrapProjectMemory}
                                    disabled={initializingProjectMemory}
                                    className="rounded border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-60"
                                  >
                                    {initializingProjectMemory
                                      ? "初始化中..."
                                      : "一键初始化"}
                                  </button>
                                )}
                                <button
                                  onClick={() => onNavigate?.("style")}
                                  className="rounded border px-2 py-1 text-[11px] hover:bg-muted"
                                >
                                  前往风格资产
                                </button>
                                <button
                                  onClick={() =>
                                    onNavigate?.("project-detail", {
                                      projectId,
                                    })
                                  }
                                  className="rounded border px-2 py-1 text-[11px] hover:bg-muted"
                                >
                                  前往项目工作台
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Database className="h-4 w-4 text-muted-foreground" />
                    分析范围（可选）
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="text-xs text-muted-foreground space-y-1">
                      <span className="block">开始日期</span>
                      <input
                        type="date"
                        value={analysisFromDate}
                        onChange={(event) =>
                          setAnalysisFromDate(event.target.value)
                        }
                        className="w-full rounded border bg-background px-2.5 py-2 text-sm text-foreground"
                        disabled={analyzing}
                      />
                    </label>

                    <label className="text-xs text-muted-foreground space-y-1">
                      <span className="block">结束日期</span>
                      <input
                        type="date"
                        value={analysisToDate}
                        onChange={(event) =>
                          setAnalysisToDate(event.target.value)
                        }
                        className="w-full rounded border bg-background px-2.5 py-2 text-sm text-foreground"
                        disabled={analyzing}
                      />
                    </label>

                    <button
                      onClick={() => {
                        setAnalysisFromDate("");
                        setAnalysisToDate("");
                      }}
                      disabled={
                        analyzing || (!analysisFromDate && !analysisToDate)
                      }
                      className="self-end inline-flex items-center justify-center rounded border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
                    >
                      清空范围
                    </button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    未选择日期时，会分析全部可用历史对话。
                  </p>
                </div>

                {analysisResult && (
                  <div className="rounded-lg border p-3 bg-muted/20">
                    <div className="text-xs text-muted-foreground mb-1">
                      最近一次分析结果
                    </div>
                    <div className="text-sm">
                      分析会话 {analysisResult.analyzed_sessions} 个，扫描消息{" "}
                      {analysisResult.analyzed_messages} 条，新增记忆{" "}
                      {analysisResult.generated_entries} 条，去重{" "}
                      {analysisResult.deduplicated_entries} 条。
                    </div>
                  </div>
                )}

                {!hasMemoryData ? (
                  <EmptyMemoryState
                    onAnalyze={handleAnalyze}
                    loading={analyzing}
                    disabled={!memoryConfig.enabled}
                  />
                ) : (
                  <>
                    {activeSection === "home" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                        {categories.map((item) => {
                          const meta = CATEGORY_META[item.category];
                          const Icon = meta.icon;

                          return (
                            <button
                              key={item.category}
                              onClick={() => setActiveSection(item.category)}
                              className="rounded-lg border p-3 bg-card text-left transition-colors hover:bg-muted/30"
                            >
                              <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                                <Icon className="h-3.5 w-3.5" />
                                {meta.label}
                              </div>
                              <div className="text-2xl font-semibold text-primary leading-none mb-1">
                                {item.count}
                              </div>
                              <div className="text-xs text-muted-foreground line-clamp-2">
                                {meta.description}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="rounded-lg border p-3 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium">记忆条目</div>

                        <div className="inline-flex rounded border overflow-hidden">
                          <button
                            onClick={() => setViewMode("list")}
                            className={cn(
                              "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs",
                              viewMode === "list"
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-muted",
                            )}
                          >
                            <List className="h-3.5 w-3.5" />
                            列表
                          </button>
                          <button
                            onClick={() => setViewMode("grid")}
                            className={cn(
                              "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs",
                              viewMode === "grid"
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-muted",
                            )}
                          >
                            <LayoutGrid className="h-3.5 w-3.5" />
                            网格
                          </button>
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground">
                        当前筛选：
                        {activeCategoryFilter === "all"
                          ? "全部分类"
                          : CATEGORY_META[activeCategoryFilter].label}
                        ，共 {filteredEntries.length} 条结果
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
                      <MemoryEntryCollection
                        entries={filteredEntries}
                        viewMode={viewMode}
                        selectedEntryId={selectedEntryId}
                        onSelect={setSelectedEntryId}
                      />
                      <MemoryDetailPanel
                        entry={selectedEntry}
                        deleting={
                          !!selectedEntry &&
                          deletingEntryId === selectedEntry.id
                        }
                        onDelete={handleDeleteEntry}
                      />
                    </div>
                  </>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-lg border p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <h3 className="text-sm font-medium">启用记忆功能</h3>
                          <p className="text-xs text-muted-foreground">
                            控制是否允许系统提取并使用记忆
                          </p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={memoryConfig.enabled}
                        onChange={(event) =>
                          saveMemoryConfig("enabled", event.target.checked)
                        }
                        disabled={saving}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium">最大记忆条数</h4>
                        <span className="text-sm text-primary font-medium">
                          {memoryConfig.max_entries || 1000}
                        </span>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        {maxEntriesOptions.map((option) => (
                          <button
                            key={option}
                            onClick={() =>
                              saveMemoryConfig("max_entries", option)
                            }
                            className={cn(
                              "rounded border px-2 py-1.5 text-xs",
                              memoryConfig.max_entries === option
                                ? "bg-primary text-primary-foreground border-primary"
                                : "hover:bg-muted",
                            )}
                            disabled={saving}
                          >
                            {option >= 1000 ? `${option / 1000}k` : option}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border p-4 space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium">记忆保留天数</h4>
                        <span className="text-sm text-primary font-medium">
                          {memoryConfig.retention_days || 30} 天
                        </span>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        {retentionDaysOptions.map((option) => (
                          <button
                            key={option}
                            onClick={() =>
                              saveMemoryConfig("retention_days", option)
                            }
                            className={cn(
                              "rounded border px-2 py-1.5 text-xs",
                              memoryConfig.retention_days === option
                                ? "bg-primary text-primary-foreground border-primary"
                                : "hover:bg-muted",
                            )}
                            disabled={saving}
                          >
                            {option} 天
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium">
                          自动清理过期记忆
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          定期移除超出保留时长的历史记忆
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={memoryConfig.auto_cleanup ?? true}
                        onChange={(event) =>
                          saveMemoryConfig("auto_cleanup", event.target.checked)
                        }
                        disabled={saving}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <p>
                    记忆关闭后将停止新增条目；历史条目仍可浏览。删除操作为物理删除，不可恢复。
                  </p>
                </div>
              </>
            )}

            {message && (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-lg p-3",
                  message.type === "success"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                )}
              >
                {message.type === "success" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                <span className="text-sm">{message.text}</span>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default MemoryPage;
