/**
 * 独立记忆页面
 *
 * 参考成熟产品的信息架构：
 * - 左侧分类导航（搜索 / 首页 / 身份 / 情境 / 偏好 / 经验 / 活动）
 * - 右侧主内容区（总览、分析、条目列表、详情）
 *
 * 所有数据均来自真实后端接口，不使用 Mock 数据。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { Switch } from "@/components/ui/switch";
import type { MemoryPageParams, Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import {
  getContextMemoryOverview,
  type MemoryConfig as TauriMemoryConfig,
} from "@/lib/api/memoryRuntime";
import {
  createCharacter,
  createOutlineNode,
  getProjectMemory,
  type ProjectMemory,
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
import {
  buildClawAgentParams,
  buildHomeAgentParams,
} from "@/lib/workspace/navigation";
import { CanvasBreadcrumbHeader } from "@/lib/workspace/workbenchUi";
import { buildLayerMetrics } from "./memoryLayerMetrics";

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
    label: "风格",
    description: "常用语气、风格方向与稳定审美",
    icon: Signature,
  },
  context: {
    label: "参考",
    description: "值得反复参考的背景、约束与素材线索",
    icon: MessagesSquare,
  },
  preference: {
    label: "偏好",
    description: "常用习惯、口味与输出偏好",
    icon: HeartPulse,
  },
  experience: {
    label: "成果",
    description: "已验证可复用的结果与经验",
    icon: Lightbulb,
  },
  activity: {
    label: "收藏",
    description: "先留住准备回头再用的内容",
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
    label: "总览",
    icon: Home,
    description: "全部灵感",
  },
  {
    key: "identity",
    label: CATEGORY_META.identity.label,
    icon: CATEGORY_META.identity.icon,
    description: CATEGORY_META.identity.description,
  },
  {
    key: "context",
    label: CATEGORY_META.context.label,
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
    label: CATEGORY_META.experience.label,
    icon: CATEGORY_META.experience.icon,
    description: CATEGORY_META.experience.description,
  },
  {
    key: "activity",
    label: CATEGORY_META.activity.label,
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

const PRIMARY_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60";
const INPUT_CLASS_NAME =
  "w-full rounded-[16px] border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-60";
const PANEL_CLASS_NAME =
  "rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5";

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

function SurfacePanel({
  icon: Icon,
  title,
  description,
  aside,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(PANEL_CLASS_NAME, className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
            <Icon className="h-4 w-4 text-sky-600" />
            {title}
            <WorkbenchInfoTip
              ariaLabel={`${title}说明`}
              content={description}
              tone="slate"
            />
          </div>
        </div>
        {aside ? (
          <div className="flex flex-wrap items-center gap-2">{aside}</div>
        ) : null}
      </div>

      <div className="mt-5">{children}</div>
    </section>
  );
}

function SummaryStat({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/90 bg-white/88 p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium tracking-[0.12em] text-slate-500">
        <span>{label}</span>
        <WorkbenchInfoTip
          ariaLabel={`${label}说明`}
          content={description}
          tone="slate"
        />
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
    </div>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "neutral" | "success" | "warning";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium",
        tone === "success" &&
          "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warning" &&
          "border-amber-200 bg-amber-50 text-amber-700",
        tone === "neutral" &&
          "border-slate-200 bg-white text-slate-500",
      )}
    >
      {children}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 pb-8">
      <div className="h-[244px] animate-pulse rounded-[30px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(244,251,248,0.98)_0%,rgba(248,250,252,0.98)_45%,rgba(241,246,255,0.96)_100%)]" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.16fr)_minmax(340px,0.84fr)]">
        <div className="h-[340px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        <div className="h-[340px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
      </div>
      <div className="h-[540px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="h-[280px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        <div className="h-[280px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
      </div>
    </div>
  );
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
    <div className="rounded-[30px] border border-dashed border-slate-200 bg-[linear-gradient(135deg,rgba(244,251,248,0.96)_0%,rgba(255,255,255,0.94)_100%)] p-8 text-center shadow-sm shadow-slate-950/5">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
        <BrainCircuit className="h-6 w-6 text-emerald-600" />
      </div>
      <h3 className="mb-2 text-lg font-semibold text-slate-900">暂无灵感沉淀</h3>
      <p className="mx-auto mb-6 max-w-xl text-sm leading-7 text-slate-500">
        沉淀是渐进式能力。积累更多真实对话、参考和成果后，系统会逐步整理出更稳定、可复用的内容。
      </p>
      <button
        type="button"
        onClick={onAnalyze}
        disabled={loading || disabled}
        className={PRIMARY_BUTTON_CLASS_NAME}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            分析中...
          </>
        ) : (
          <>
            <CalendarClock className="h-4 w-4" />
            {disabled ? "沉淀功能已关闭" : "开始整理灵感"}
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
      <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 p-6 text-sm leading-6 text-slate-500">
        当前筛选条件下暂无沉淀条目
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {entries.map((entry) => {
          const meta = CATEGORY_META[entry.category];
          const selected = selectedEntryId === entry.id;

          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect(entry.id)}
              className={cn(
                "rounded-[24px] border p-4 text-left transition shadow-sm",
                selected
                  ? "border-sky-200 bg-sky-50/70 shadow-slate-950/5"
                  : "border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/80 hover:shadow-slate-950/5",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                      {meta.label}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                      {memorySourceLabel(entry.source)}
                    </span>
                  </div>
                  <div className="truncate text-base font-semibold text-slate-900">
                    {entry.title}
                  </div>
                </div>
                <span className="whitespace-nowrap text-[11px] text-slate-400">
                  {formatRelativeTimestamp(entry.updated_at)}
                </span>
              </div>

              <p className="mt-3 text-sm leading-6 text-slate-500 line-clamp-3">
                {entry.summary || "暂无摘要"}
              </p>

              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-slate-400">
                  {entry.session_id}
                </span>
                <span className="text-xs font-medium text-slate-500">
                  {memoryTypeLabel(entry.memory_type)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => {
        const meta = CATEGORY_META[entry.category];
        const selected = selectedEntryId === entry.id;

        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelect(entry.id)}
            className={cn(
              "w-full rounded-[24px] border p-4 text-left transition shadow-sm",
              selected
                ? "border-sky-200 bg-sky-50/70 shadow-slate-950/5"
                : "border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/80 hover:shadow-slate-950/5",
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                    {meta.label}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                    {memorySourceLabel(entry.source)}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                    {memoryTypeLabel(entry.memory_type)}
                  </span>
                </div>
                <div className="truncate text-base font-semibold text-slate-900">
                  {entry.title}
                </div>
                <div className="truncate text-xs text-slate-400">
                  {entry.session_id}
                </div>
              </div>
              <span className="whitespace-nowrap text-xs text-slate-400">
                {formatRelativeTimestamp(entry.updated_at)}
              </span>
            </div>

            <p className="text-sm leading-6 text-slate-500 line-clamp-2">
              {entry.summary || "暂无摘要"}
            </p>

            {entry.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {entry.tags.slice(0, 4).map((tag) => (
                  <span
                    key={`${entry.id}-${tag}`}
                    className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500"
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
      <div className="rounded-[26px] border border-dashed border-slate-200 bg-white/80 p-6 text-sm leading-6 text-slate-500 shadow-sm shadow-slate-950/5 xl:sticky xl:top-4">
        请选择一条沉淀查看详情
      </div>
    );
  }

  const meta = CATEGORY_META[entry.category];

  return (
    <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5 xl:sticky xl:top-4">
      <div className="space-y-5">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
              {meta.label}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
              {memoryTypeLabel(entry.memory_type)}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
              {memorySourceLabel(entry.source)}
            </span>
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-400">条目标题</div>
            <div className="text-lg font-semibold leading-8 text-slate-900">
              {entry.title}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs text-slate-600">
          <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 p-3">
            <div className="mb-1 text-slate-400">会话 ID</div>
            <div className="break-all font-medium">{entry.session_id}</div>
          </div>
          <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 p-3">
            <div className="mb-1 text-slate-400">更新时间</div>
            <div className="font-medium">
              {formatAbsoluteTimestamp(entry.updated_at)}
            </div>
          </div>
          <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 p-3">
            <div className="mb-1 text-slate-400">创建时间</div>
            <div className="font-medium">
              {formatAbsoluteTimestamp(entry.created_at)}
            </div>
          </div>
          <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 p-3">
            <div className="mb-1 text-slate-400">分类</div>
            <div className="font-medium">{meta.label}</div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs text-slate-400">摘要内容</div>
          <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 p-4 text-sm leading-7 text-slate-700 whitespace-pre-wrap break-words">
            {entry.summary || "暂无摘要"}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs text-slate-400">详细内容</div>
          <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 p-4 text-sm leading-7 text-slate-700 whitespace-pre-wrap break-words">
            {entry.content || "暂无内容"}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs text-slate-400">标签</div>
          {entry.tags.length === 0 ? (
            <div className="text-xs text-slate-500">暂无标签</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {entry.tags.map((tag) => (
                <span
                  key={`${entry.id}-detail-${tag}`}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onDelete(entry)}
          disabled={deleting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              删除中...
            </>
          ) : (
            <>
              <Trash2 className="h-4 w-4" />
              删除条目（不可恢复）
            </>
          )}
        </button>
      </div>
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
      showMessage("error", "加载灵感库失败，请稍后重试");
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
    const hasOutline = (projectMemory?.outline.length ?? 0) > 0;

    if (hasCharacters && hasWorldBuilding && hasOutline) {
      showMessage("success", "第三层项目沉淀已完善");
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
      showMessage("success", "已初始化第三层项目沉淀，请按需继续完善");
    } catch (error) {
      console.error("初始化项目记忆失败:", error);
      showMessage("error", "初始化项目沉淀失败，请稍后重试");
    } finally {
      setInitializingProjectMemory(false);
    }
  }, [
    initializingProjectMemory,
    loadOverview,
    projectId,
    projectMemory?.characters.length,
    projectMemory?.outline.length,
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
      showMessage("error", "沉淀功能已关闭，请先开启");
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
          `整理完成：新增 ${result.generated_entries} 条沉淀（去重 ${result.deduplicated_entries} 条）`,
        );
      } else {
        showMessage("success", "整理完成：暂无新的可提取沉淀");
      }
    } catch (error) {
      console.error("记忆分析失败:", error);
      showMessage("error", "灵感整理失败，请稍后重试");
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
        `确定永久删除这条沉淀吗？\n\n标题：${entry.title}\n\n该操作不可恢复。`,
      );
      if (!confirmed) {
        return;
      }

      setDeletingEntryId(entry.id);
      try {
        const deleted = await deleteUnifiedMemory(entry.id);
        if (!deleted) {
          showMessage("error", "删除失败，条目可能不存在");
          return;
        }

        await loadOverview();
        showMessage("success", "条目已删除");
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
        showMessage("success", "灵感设置已保存");
      } catch (error) {
        console.error("保存记忆设置失败:", error);
        showMessage("error", "灵感设置保存失败");
      } finally {
        setSaving(false);
      }
    },
    [config, memoryConfig, showMessage],
  );

  const sectionTitle =
    activeSection === "home"
      ? "灵感总览"
      : CATEGORY_META[activeSection].label;

  const sectionDescription =
    activeSection === "home"
      ? "查看已沉淀的风格、参考、成果与偏好"
      : CATEGORY_META[activeSection].description;

  const activeSectionCount =
    activeCategoryFilter === "all"
      ? stats.total_entries
      : (categoryCountMap.get(activeCategoryFilter) ?? 0);
  const analysisScopeLabel =
    analysisFromDate || analysisToDate
      ? `${analysisFromDate || "最早"} - ${analysisToDate || "今天"}`
      : "全部历史";
  const projectLayerCard =
    layerMetrics?.cards.find((card) => card.key === "project") ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50/70">
      <div className="flex items-center border-b border-slate-200/80 bg-white/90 px-6 py-3">
        <CanvasBreadcrumbHeader label="灵感库" onBackHome={handleBackHome} />
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="flex w-[272px] min-w-[272px] flex-col gap-4 border-r border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(248,250,252,0.96)_100%)] p-4">
          <div className="rounded-[24px] border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-950/5">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
              <BrainCircuit className="h-4 w-4 text-sky-600" />
              灵感库
              <WorkbenchInfoTip
                ariaLabel="灵感库导航说明"
                content="按 / 搜索，按 1-6 切换视图。"
                tone="slate"
              />
            </div>
          </div>

          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              ref={searchInputRef}
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              placeholder="搜索标题、摘要或标签"
              className="w-full rounded-[16px] border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
            />
          </label>

          <div className="space-y-2">
            {MEMORY_NAV_ITEMS.map((item) => {
              const active = activeSection === item.key;
              const count =
                item.key === "home"
                  ? stats.total_entries
                  : (categoryCountMap.get(item.key as CategoryType) ?? 0);

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveSection(item.key)}
                  className={cn(
                    "w-full rounded-[18px] border px-3 py-3 text-left transition shadow-sm",
                    active
                      ? "border-slate-300 bg-white shadow-slate-950/5"
                      : "border-transparent bg-transparent hover:border-slate-200 hover:bg-white/80 hover:shadow-slate-950/5",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-900">
                      <item.icon className="h-4 w-4 text-slate-400" />
                      {item.label}
                    </span>
                    <span className="text-xs text-slate-400">{count}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500 line-clamp-1">
                    {item.description}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-auto flex items-center justify-between gap-3 rounded-[22px] border border-slate-200/80 bg-white/90 p-4 text-xs leading-6 text-slate-500 shadow-sm shadow-slate-950/5">
            <span>当前沉淀数据库</span>
            <WorkbenchInfoTip
              ariaLabel="沉淀数据库说明"
              content="灵感库当前直接读取真实沉淀数据：浏览、整理和删除都直接操作真实内容，不使用 Mock 数据。"
              tone="slate"
              variant="pill"
              label="说明"
            />
          </div>
        </aside>

        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto max-w-[1440px] p-6 lg:p-8">
            <div className="space-y-6">
              {message ? (
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-[20px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
                    message.type === "success"
                      ? "border-emerald-200 bg-emerald-50/90 text-emerald-700"
                      : "border-rose-200 bg-rose-50/90 text-rose-700",
                  )}
                >
                  {message.type === "success" ? (
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  )}
                  <span>{message.text}</span>
                </div>
              ) : null}

              {loading ? (
                <LoadingSkeleton />
              ) : (
                <>
                  <section className="relative overflow-hidden rounded-[30px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(244,251,248,0.98)_0%,rgba(248,250,252,0.98)_45%,rgba(241,246,255,0.96)_100%)] shadow-sm shadow-slate-950/5">
                    <div className="pointer-events-none absolute -left-20 top-[-72px] h-56 w-56 rounded-full bg-emerald-200/30 blur-3xl" />
                    <div className="pointer-events-none absolute right-[-76px] top-[-24px] h-56 w-56 rounded-full bg-sky-200/28 blur-3xl" />

                    <div className="relative flex flex-col gap-6 p-6 lg:p-8">
                      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(380px,0.88fr)] xl:items-stretch">
                        <div className="max-w-3xl space-y-5">
                          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 shadow-sm">
                            灵感沉淀
                          </span>

                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-[28px] font-semibold tracking-tight text-slate-900">
                                {sectionTitle}
                              </p>
                              <WorkbenchInfoTip
                                ariaLabel={`${sectionTitle}说明`}
                                content={`${sectionDescription}${
                                  activeSection === "home"
                                    ? " 风格、收藏、参考、成果与偏好会在这里汇总展示。"
                                    : " 这里会聚焦当前分类下可反复参考的沉淀条目与整理结果。"
                                }`}
                                tone="mint"
                              />
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <StatusPill
                              tone={memoryConfig.enabled ? "success" : "warning"}
                            >
                              {memoryConfig.enabled ? "沉淀已启用" : "沉淀已暂停"}
                            </StatusPill>
                            <StatusPill tone="neutral">
                              当前范围 {analysisScopeLabel}
                            </StatusPill>
                            <StatusPill tone={projectId ? "success" : "warning"}>
                              {projectId ? "已选项目" : "未选项目"}
                            </StatusPill>
                            <StatusPill tone="neutral">
                              搜索结果 {filteredEntries.length}
                            </StatusPill>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2 xl:content-start">
                          <SummaryStat
                            label="灵感条数"
                            value={stats.total_entries.toString()}
                            description="当前沉淀库中的全部可用条目。"
                          />
                          <SummaryStat
                            label="存储空间"
                            value={formatStorageSize(stats.storage_used)}
                            description="沉淀数据库当前已占用的存储体积。"
                          />
                          <SummaryStat
                            label="沉淀库数"
                            value={stats.memory_count.toString()}
                            description="后端返回的沉淀库数量，用于观察整体规模。"
                          />
                          <SummaryStat
                            label="当前结果"
                            value={activeSectionCount.toString()}
                            description="当前分类和搜索条件下可浏览的沉淀条目数。"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-4 rounded-[24px] border border-white/90 bg-white/80 p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusPill tone="neutral">
                              当前视图{" "}
                              {activeSection === "home"
                                ? "全部分类"
                                : CATEGORY_META[activeSection].label}
                            </StatusPill>
                            <StatusPill tone="neutral">
                              搜索词 {searchKeyword.trim() || "未设置"}
                            </StatusPill>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <WorkbenchInfoTip
                            ariaLabel="灵感刷新与整理说明"
                            content="刷新会重取总览、分类和项目沉淀状态。整理灵感会按当前日期范围扫描真实历史对话。"
                            tone="slate"
                            variant="pill"
                            label="操作说明"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              onNavigate?.("settings", {
                                tab: SettingsTabs.Memory,
                              })
                            }
                            className={SECONDARY_BUTTON_CLASS_NAME}
                          >
                            <Settings2 className="h-4 w-4" />
                            灵感设置
                          </button>
                          <button
                            type="button"
                            onClick={handleRefresh}
                            disabled={refreshing || analyzing}
                            className={SECONDARY_BUTTON_CLASS_NAME}
                          >
                            <RefreshCw
                              className={cn(
                                "h-4 w-4",
                                refreshing && "animate-spin",
                              )}
                            />
                            刷新
                          </button>
                          <button
                            type="button"
                            onClick={handleAnalyze}
                            disabled={analyzing || !memoryConfig.enabled}
                            className={PRIMARY_BUTTON_CLASS_NAME}
                          >
                            {analyzing ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                分析中...
                              </>
                            ) : (
                              <>
                                <CalendarClock className="h-4 w-4" />
                                整理灵感
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>

                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.16fr)_minmax(340px,0.84fr)]">
                    <SurfacePanel
                      icon={BrainCircuit}
                      title="沉淀可用性"
                      description="持续检查统一沉淀、上下文与项目沉淀是否已经参与当前工作流。"
                      aside={
                        <div className="flex items-center gap-2">
                          <StatusPill
                            tone={
                              (layerMetrics?.readyLayers ?? 0) > 0
                                ? "success"
                                : "warning"
                            }
                          >
                            已可用 {layerMetrics?.readyLayers ?? 0}/
                            {layerMetrics?.totalLayers ?? 3} 层
                          </StatusPill>
                          <button
                            type="button"
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className={SECONDARY_BUTTON_CLASS_NAME}
                          >
                            <RefreshCw
                              className={cn(
                                "h-4 w-4",
                                refreshing && "animate-spin",
                              )}
                            />
                            刷新
                          </button>
                        </div>
                      }
                    >
                      <div className="grid gap-4 lg:grid-cols-3">
                        {(layerMetrics?.cards ?? []).map((card) => (
                          <div
                            key={card.key}
                            className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_100%)] p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <p className="text-sm font-semibold text-slate-900">
                                  {card.title}
                                </p>
                                <p className="text-sm leading-6 text-slate-500">
                                  {card.description}
                                </p>
                              </div>
                              <StatusPill
                                tone={card.available ? "success" : "warning"}
                              >
                                {card.available ? "已生效" : "待完善"}
                              </StatusPill>
                            </div>

                            <div className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
                              {card.value}
                              <span className="ml-1 text-sm font-medium text-slate-500">
                                {card.unit}
                              </span>
                            </div>

                            {card.key === "project" ? (
                              <div className="mt-4 flex flex-wrap items-center gap-2">
                                {!projectId ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onNavigate?.("agent", buildHomeAgentParams())
                                    }
                                    className={SECONDARY_BUTTON_CLASS_NAME}
                                  >
                                    去选择项目
                                  </button>
                                ) : (
                                  <>
                                    {!card.available ? (
                                      <button
                                        type="button"
                                        onClick={handleBootstrapProjectMemory}
                                        disabled={initializingProjectMemory}
                                        className={SECONDARY_BUTTON_CLASS_NAME}
                                      >
                                        {initializingProjectMemory
                                          ? "初始化中..."
                                          : "一键初始化"}
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onNavigate?.(
                                          "agent",
                                          buildClawAgentParams({ projectId }),
                                        )
                                      }
                                      className={SECONDARY_BUTTON_CLASS_NAME}
                                    >
                                      前往项目工作台
                                    </button>
                                  </>
                                )}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </SurfacePanel>

                    <SurfacePanel
                      icon={Database}
                      title="整理工作台"
                      description="先确定时间范围，再整理灵感。最近一次整理结果也会在这里汇总。"
                    >
                      <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="space-y-2">
                            <span className="text-xs font-medium text-slate-500">
                              开始日期
                            </span>
                            <input
                              type="date"
                              value={analysisFromDate}
                              onChange={(event) =>
                                setAnalysisFromDate(event.target.value)
                              }
                              className={INPUT_CLASS_NAME}
                              disabled={analyzing}
                            />
                          </label>

                          <label className="space-y-2">
                            <span className="text-xs font-medium text-slate-500">
                              结束日期
                            </span>
                            <input
                              type="date"
                              value={analysisToDate}
                              onChange={(event) =>
                                setAnalysisToDate(event.target.value)
                              }
                              className={INPUT_CLASS_NAME}
                              disabled={analyzing}
                            />
                          </label>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill
                            tone={memoryConfig.enabled ? "success" : "warning"}
                          >
                            {memoryConfig.enabled
                              ? "当前允许整理"
                              : "请先开启沉淀"}
                          </StatusPill>
                          <StatusPill tone="neutral">
                            分析范围 {analysisScopeLabel}
                          </StatusPill>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={handleAnalyze}
                            disabled={analyzing || !memoryConfig.enabled}
                            className={PRIMARY_BUTTON_CLASS_NAME}
                          >
                            {analyzing ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                分析中...
                              </>
                            ) : (
                              <>
                                <CalendarClock className="h-4 w-4" />
                                立即整理
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAnalysisFromDate("");
                              setAnalysisToDate("");
                            }}
                            disabled={
                              analyzing || (!analysisFromDate && !analysisToDate)
                            }
                            className={SECONDARY_BUTTON_CLASS_NAME}
                          >
                            清空范围
                          </button>
                        </div>

                        {analysisResult ? (
                          <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                            <div className="text-xs font-medium tracking-[0.12em] text-slate-500">
                              最近一次整理结果
                            </div>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <div className="rounded-[18px] border border-slate-200/80 bg-white/90 p-3">
                                <p className="text-xs text-slate-500">分析会话</p>
                                <p className="mt-2 text-2xl font-semibold text-slate-900">
                                  {analysisResult.analyzed_sessions}
                                </p>
                              </div>
                              <div className="rounded-[18px] border border-slate-200/80 bg-white/90 p-3">
                                <p className="text-xs text-slate-500">扫描消息</p>
                                <p className="mt-2 text-2xl font-semibold text-slate-900">
                                  {analysisResult.analyzed_messages}
                                </p>
                              </div>
                              <div className="rounded-[18px] border border-slate-200/80 bg-white/90 p-3">
                                <p className="text-xs text-slate-500">新增沉淀</p>
                                <p className="mt-2 text-2xl font-semibold text-slate-900">
                                  {analysisResult.generated_entries}
                                </p>
                              </div>
                              <div className="rounded-[18px] border border-slate-200/80 bg-white/90 p-3">
                                <p className="text-xs text-slate-500">去重数量</p>
                                <p className="mt-2 text-2xl font-semibold text-slate-900">
                                  {analysisResult.deduplicated_entries}
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm leading-6 text-slate-500">
                            还没有最近一次整理结果。未选择日期时，会整理全部可用历史对话。
                          </div>
                        )}
                      </div>
                    </SurfacePanel>
                  </div>

                  {!hasMemoryData ? (
                    <EmptyMemoryState
                      onAnalyze={handleAnalyze}
                      loading={analyzing}
                      disabled={!memoryConfig.enabled}
                    />
                  ) : (
                    <>
                      {activeSection === "home" ? (
                        <SurfacePanel
                          icon={Home}
                          title="分类概览"
                          description="从首页快速切换到具体分类，避免在同一堆条目里横向查找。"
                        >
                          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                            {categories.map((item) => {
                              const meta = CATEGORY_META[item.category];
                              const Icon = meta.icon;

                              return (
                                <button
                                  key={item.category}
                                  type="button"
                                  onClick={() => setActiveSection(item.category)}
                                  className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_100%)] p-4 text-left transition hover:border-slate-300 hover:shadow-sm"
                                >
                                  <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                                    <Icon className="h-3.5 w-3.5" />
                                    {meta.label}
                                  </div>
                                  <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                                    {item.count}
                                  </div>
                                  <div className="mt-2 text-sm leading-6 text-slate-500 line-clamp-2">
                                    {meta.description}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </SurfacePanel>
                      ) : null}

                      <SurfacePanel
                        icon={viewMode === "list" ? List : LayoutGrid}
                        title="沉淀条目"
                        description="列表和详情保持同屏，方便批量浏览与逐条校验。"
                        aside={
                          <div className="inline-flex overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm">
                            <button
                              type="button"
                              onClick={() => setViewMode("list")}
                              className={cn(
                                "inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition",
                                viewMode === "list"
                                  ? "bg-slate-900 text-white"
                                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
                              )}
                            >
                              <List className="h-3.5 w-3.5" />
                              列表
                            </button>
                            <button
                              type="button"
                              onClick={() => setViewMode("grid")}
                              className={cn(
                                "inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition",
                                viewMode === "grid"
                                  ? "bg-slate-900 text-white"
                                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
                              )}
                            >
                              <LayoutGrid className="h-3.5 w-3.5" />
                              网格
                            </button>
                          </div>
                        }
                      >
                        <div className="mb-5 flex flex-wrap items-center gap-2">
                          <StatusPill tone="neutral">
                            当前筛选{" "}
                            {activeCategoryFilter === "all"
                              ? "全部分类"
                              : CATEGORY_META[activeCategoryFilter].label}
                          </StatusPill>
                          <StatusPill tone="neutral">
                            共 {filteredEntries.length} 条结果
                          </StatusPill>
                          <StatusPill tone="neutral">
                            搜索词 {searchKeyword.trim() || "未设置"}
                          </StatusPill>
                        </div>

                        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
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
                      </SurfacePanel>
                    </>
                  )}

                  <div className="grid gap-6 xl:grid-cols-2">
                    <SurfacePanel
                      icon={Settings2}
                      title="运行策略"
                      description="这里的开关会立即保存并作用到当前沉淀运行时。"
                      aside={
                        <StatusPill tone={saving ? "warning" : "neutral"}>
                          {saving ? "保存中..." : "即时生效"}
                        </StatusPill>
                      }
                    >
                      <div className="space-y-4">
                        <div className="flex items-start justify-between gap-4 rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-slate-900">
                              启用沉淀功能
                            </p>
                            <p className="text-sm leading-6 text-slate-500">
                              控制是否允许系统继续提取并使用新的沉淀内容。
                            </p>
                          </div>
                          <Switch
                            aria-label="启用沉淀功能"
                            checked={memoryConfig.enabled}
                            onCheckedChange={(checked) =>
                              void saveMemoryConfig("enabled", checked)
                            }
                            disabled={saving}
                          />
                        </div>

                        <div className="flex items-start justify-between gap-4 rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-slate-900">
                              自动清理过期沉淀
                            </p>
                            <p className="text-sm leading-6 text-slate-500">
                              定期移除超出保留时长的历史沉淀，保持长期库干净。
                            </p>
                          </div>
                          <Switch
                            aria-label="自动清理过期沉淀"
                            checked={memoryConfig.auto_cleanup ?? true}
                            onCheckedChange={(checked) =>
                              void saveMemoryConfig("auto_cleanup", checked)
                            }
                            disabled={saving}
                          />
                        </div>

                        <div className="rounded-[22px] border border-slate-200/80 bg-white/90 p-4 text-sm leading-6 text-slate-500">
                          沉淀关闭后会停止新增条目，但历史条目仍可浏览。删除操作是物理删除，不可恢复。
                        </div>
                      </div>
                    </SurfacePanel>

                    <SurfacePanel
                      icon={Database}
                      title="容量与保留策略"
                      description="控制长期沉淀的规模和历史保留窗口，避免无限增长。"
                      aside={
                        <button
                          type="button"
                          onClick={() =>
                            onNavigate?.("settings", { tab: SettingsTabs.Memory })
                          }
                          className={SECONDARY_BUTTON_CLASS_NAME}
                        >
                          <Settings2 className="h-4 w-4" />
                          更多设置
                        </button>
                      }
                    >
                      <div className="space-y-5">
                        <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                最大沉淀条数
                              </p>
                              <p className="text-sm leading-6 text-slate-500">
                                超出上限后，系统会按策略处理旧条目。
                              </p>
                            </div>
                            <span className="text-sm font-semibold text-slate-900">
                              {memoryConfig.max_entries || 1000}
                            </span>
                          </div>
                          <div className="grid grid-cols-5 gap-2">
                            {maxEntriesOptions.map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() =>
                                  void saveMemoryConfig("max_entries", option)
                                }
                                className={cn(
                                  "rounded-full border px-3 py-2 text-xs font-medium transition",
                                  memoryConfig.max_entries === option
                                    ? "border-slate-900 bg-slate-900 text-white"
                                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900",
                                )}
                                disabled={saving}
                              >
                                {option >= 1000 ? `${option / 1000}k` : option}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                沉淀保留天数
                              </p>
                              <p className="text-sm leading-6 text-slate-500">
                                只保留最近一段时间内仍有价值的历史沉淀。
                              </p>
                            </div>
                            <span className="text-sm font-semibold text-slate-900">
                              {memoryConfig.retention_days || 30} 天
                            </span>
                          </div>
                          <div className="grid grid-cols-5 gap-2">
                            {retentionDaysOptions.map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() =>
                                  void saveMemoryConfig("retention_days", option)
                                }
                                className={cn(
                                  "rounded-full border px-3 py-2 text-xs font-medium transition",
                                  memoryConfig.retention_days === option
                                    ? "border-slate-900 bg-slate-900 text-white"
                                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900",
                                )}
                                disabled={saving}
                              >
                                {option} 天
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </SurfacePanel>
                  </div>

                  <div className="flex items-start gap-3 rounded-[22px] border border-slate-200/80 bg-white/90 p-4 text-sm leading-6 text-slate-500 shadow-sm shadow-slate-950/5">
                    <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-600" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span>工作台说明</span>
                      <WorkbenchInfoTip
                        ariaLabel="灵感库工作台说明"
                        content={`当前页面是灵感库工作台，适合浏览、整理和做快速策略调整；更细的来源、画像和自动沉淀配置仍然在“灵感设置”页维护。第三层项目沉淀当前状态：${
                          projectLayerCard
                            ? ` ${projectLayerCard.value}${projectLayerCard.unit}，${projectLayerCard.description}`
                            : " 暂未加载。"
                        }`}
                        tone="slate"
                        variant="pill"
                        label="查看说明"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
