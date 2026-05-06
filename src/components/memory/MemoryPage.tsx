import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  BrainCircuit,
  Database,
  FolderKanban,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  cleanupContextMemdir,
  getContextMemoryAutoIndex,
  getContextMemoryEffectiveSources,
  getContextMemoryExtractionStatus,
  getContextWorkingMemory,
  prefetchContextMemoryForTurn,
  scaffoldContextMemdir,
  type AutoMemoryIndexResponse,
  type EffectiveMemorySourcesResponse,
  type MemdirCleanupResult,
  type MemdirScaffoldResult,
  type MemoryExtractionStatusResponse,
  type TurnMemoryPrefetchResult,
  type WorkingMemoryView,
} from "@/lib/api/memoryRuntime";
import {
  getUnifiedMemoryStats,
  listUnifiedMemories,
  type MemoryCategory,
  type UnifiedMemory,
  type UnifiedMemoryStatsResponse,
} from "@/lib/api/unifiedMemory";
import {
  getStoredResourceProjectId,
  onResourceProjectChange,
} from "@/lib/resourceProjectSelection";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import { AgentThreadMemoryPrefetchPreview } from "@/components/agent/chat/components/AgentThreadMemoryPrefetchPreview";
import { CuratedTaskLauncherDialog } from "@/components/agent/chat/components/CuratedTaskLauncherDialog";
import { buildMemoryEntryCreationReplayRequestMetadata } from "@/components/agent/chat/utils/creationReplayMetadata";
import {
  buildCuratedTaskLaunchPrompt,
  listFeaturedHomeCuratedTaskTemplates,
  recordCuratedTaskTemplateUsage,
  resolveCuratedTaskTemplateLaunchPrefill,
  type CuratedTaskInputValues,
  type CuratedTaskTemplateItem,
} from "@/components/agent/chat/utils/curatedTaskTemplates";
import {
  buildCuratedTaskLaunchRequestMetadata,
  buildCuratedTaskReferenceEntries,
  extractCuratedTaskReferenceMemoryIds,
  mergeCuratedTaskReferenceEntries,
  normalizeCuratedTaskLaunchInputValues,
  normalizeCuratedTaskReferenceMemoryIds,
  type CuratedTaskReferenceEntry,
  type CuratedTaskReferenceSelection,
} from "@/components/agent/chat/utils/curatedTaskReferenceSelection";
import { subscribeCuratedTaskRecommendationSignalsChanged } from "@/components/agent/chat/utils/curatedTaskRecommendationSignals";
import {
  buildTeamMemoryShadowRequestMetadata,
  listTeamMemorySnapshots,
  normalizeTeamMemoryRepoScope,
  type TeamMemorySnapshot,
} from "@/lib/teamMemorySync";
import {
  assessRuntimeMemoryPrefetchHistoryDiff,
  clearRuntimeMemoryPrefetchHistory,
  compareRuntimeMemoryPrefetchHistoryEntries,
  describeRuntimeMemoryPrefetchHistoryDiffAssessment,
  filterRuntimeMemoryPrefetchHistory,
  formatRuntimeMemoryPrefetchHistoryDiffStatusLabel,
  listRuntimeMemoryPrefetchHistory,
  recordRuntimeMemoryPrefetchHistory,
  summarizeRuntimeMemoryPrefetchHistory,
  type RuntimeMemoryPrefetchHistoryDiff,
  type RuntimeMemoryPrefetchHistoryDiffAssessment,
  type RuntimeMemoryPrefetchHistoryEntry,
  type RuntimeMemoryPrefetchHistoryLayerStability,
  type RuntimeMemoryPrefetchHistoryScope,
} from "@/lib/runtimeMemoryPrefetchHistory";
import { MemoryCuratedTaskSuggestionPanel } from "./MemoryCuratedTaskSuggestionPanel";
import {
  buildInspirationProjectionEntries,
  buildInspirationTasteSummary,
  buildScenePrefillFromInspiration,
  INSPIRATION_PROJECTION_META,
} from "./inspirationProjection";
import type {
  MemoryPageParams,
  MemoryPageSection,
  Page,
  PageParams,
} from "@/types/page";

type DurableCategoryFilter = MemoryCategory | "all";
type PrimarySection =
  | "home"
  | "rules"
  | "working"
  | "durable"
  | "team"
  | "compaction";
type MemoryKnowledgeType = "user" | "feedback" | "project" | "reference";
type SourceBucketKey =
  | "managed"
  | "user"
  | "project"
  | "local"
  | "rules"
  | "auto"
  | "durable"
  | "additional";

interface MemoryPageProps {
  onNavigate: (page: Page, pageParams?: PageParams) => void;
  pageParams?: MemoryPageParams;
}

interface RuntimeMemoryPrefetchState {
  status: "idle" | "loading" | "ready" | "error";
  result: TurnMemoryPrefetchResult | null;
  error: string | null;
}

interface MemdirActionNotice {
  tone: "success" | "error";
  message: string;
}

function resolveActionErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function formatMemdirCleanupMessage(result: MemdirCleanupResult): string {
  const touchedCount =
    result.curated_topic_files +
    result.removed_duplicate_links +
    result.dropped_missing_links +
    result.removed_duplicate_notes +
    result.trimmed_notes;

  if (result.updated_files === 0 || touchedCount === 0) {
    return "memdir 已经是干净状态，无需整理";
  }

  return `已整理 memdir：更新 ${result.updated_files} 个文件，收口 ${result.curated_topic_files} 个 topic，清掉 ${result.removed_duplicate_links + result.dropped_missing_links + result.removed_duplicate_notes + result.trimmed_notes} 处重复或过期内容`;
}

function formatMemdirScaffoldMessage(result: MemdirScaffoldResult): string {
  const createdCount = result.files.filter(
    (file) => file.status === "created" || file.status === "overwritten",
  ).length;

  return createdCount > 0
    ? `已初始化 memdir：${result.root_dir}`
    : `memdir 已存在：${result.root_dir}`;
}

const SECTION_META: Array<{
  key: PrimarySection;
  label: string;
  icon: typeof BrainCircuit;
  description: string;
}> = [
  {
    key: "home",
    label: "灵感",
    icon: BrainCircuit,
    description: "创作灵感和线索",
  },
  {
    key: "durable",
    label: "参考",
    icon: Database,
    description: "参考素材和风格",
  },
];

const LEGACY_DURABLE_SECTIONS = new Set<MemoryCategory>([
  "identity",
  "context",
  "preference",
  "experience",
  "activity",
]);

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  identity: "风格",
  context: "参考",
  preference: "偏好",
  experience: "成果",
  activity: "收藏",
};

const MEMORY_TYPE_LABELS: Record<MemoryKnowledgeType, string> = {
  user: "用户记忆",
  feedback: "反馈记忆",
  project: "项目记忆",
  reference: "参考记忆",
};

const LEGACY_CATEGORY_TO_MEMORY_TYPE: Record<
  MemoryCategory,
  MemoryKnowledgeType
> = {
  identity: "user",
  preference: "feedback",
  experience: "project",
  activity: "project",
  context: "reference",
};

const MEMORY_TYPE_BADGE_CLASS_NAMES: Record<MemoryKnowledgeType, string> = {
  user: "border-emerald-200 bg-emerald-50 text-emerald-800",
  feedback: "border-emerald-200 bg-emerald-50 text-emerald-800",
  project: "border-emerald-200 bg-emerald-50 text-emerald-800",
  reference: "border-slate-200 bg-slate-100 text-slate-700",
};

const SOURCE_BUCKET_META: Array<{
  key: SourceBucketKey;
  label: string;
  scope: string;
  description: string;
  kinds: string[];
  emptyState: string;
}> = [
  {
    key: "managed",
    label: "托管记忆",
    scope: "全局托管",
    description: "平台托管的基础政策与默认行为，优先级最高。",
    kinds: ["managed_policy"],
    emptyState: "当前未发现托管策略文件。",
  },
  {
    key: "user",
    label: "用户记忆",
    scope: "用户级",
    description: "全局用户记忆，通常对应当前用户的长期偏好与个人规则。",
    kinds: ["user_memory"],
    emptyState: "当前未发现用户级记忆文件。",
  },
  {
    key: "project",
    label: "项目记忆",
    scope: "项目级",
    description: "项目共享记忆，通常来自仓库内主记忆文件。",
    kinds: ["project_memory", "workspace_agents"],
    emptyState: "当前未发现项目级主记忆文件。",
  },
  {
    key: "local",
    label: "本地记忆",
    scope: "本地项目级",
    description: "仅在当前工作区本地生效，不应替代共享主记忆。",
    kinds: ["project_local"],
    emptyState: "当前未发现本地记忆文件。",
  },
  {
    key: "rules",
    label: "项目规则",
    scope: "项目规则目录",
    description: "规则目录与细粒度规则文件，会在项目范围内参与注入。",
    kinds: ["project_rule", "project_rules"],
    emptyState: "当前未发现项目规则目录或规则文件。",
  },
  {
    key: "auto",
    label: "记忆目录（memdir）",
    scope: "memdir 根目录",
    description:
      "以 MEMORY.md 为入口，承接四类记忆文件、自动沉淀 note 与索引。",
    kinds: ["auto_memory", "auto_memory_item"],
    emptyState: "当前未启用或未发现 memdir 入口。",
  },
  {
    key: "durable",
    label: "/memories",
    scope: "跨会话",
    description: "可跨会话访问的长期记忆根目录，用于共享结构化沉淀。",
    kinds: ["durable_memory"],
    emptyState: "当前未发现 /memories 根目录。",
  },
  {
    key: "additional",
    label: "附加目录",
    scope: "附加目录",
    description: "额外扫描目录中的补充记忆来源，避免直接混入主链。",
    kinds: ["additional_memory"],
    emptyState: "当前没有额外目录记忆来源。",
  },
];

type MemoryAvailabilityStatus = "loaded" | "exists" | "missing";

const RUNTIME_HISTORY_SCOPE_META: Array<{
  key: RuntimeMemoryPrefetchHistoryScope;
  label: string;
}> = [
  {
    key: "all",
    label: "全部",
  },
  {
    key: "workspace",
    label: "当前工作区",
  },
  {
    key: "session",
    label: "当前会话",
  },
];

const RUNTIME_HISTORY_LAYER_LABELS: Record<
  RuntimeMemoryPrefetchHistoryLayerStability["key"],
  string
> = {
  rules: "规则层",
  working: "工作层",
  durable: "持久层",
  team: "团队层",
  compaction: "压缩层",
};

const PANEL_CLASS_NAME =
  "rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm shadow-slate-950/5";
const BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900";
const ACTIVE_BUTTON_CLASS_NAME =
  "border-emerald-200 bg-emerald-50 text-emerald-900 shadow-sm shadow-emerald-950/5 hover:border-emerald-300 hover:bg-emerald-100 hover:text-emerald-900";
const EMERALD_BUTTON_CLASS_NAME =
  "border-emerald-700 bg-emerald-700 text-white hover:border-emerald-800 hover:bg-emerald-800 hover:text-white";
const EMERALD_OUTLINE_BADGE_CLASS_NAME =
  "border-emerald-200 bg-white text-emerald-700";
const EMERALD_BADGE_CLASS_NAME =
  "border-emerald-200 bg-emerald-50 text-emerald-700";
const SLATE_OUTLINE_BADGE_CLASS_NAME =
  "border-slate-200 bg-white text-slate-700";
const SLATE_BADGE_CLASS_NAME = "border-slate-200 bg-slate-100 text-slate-700";

function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) {
    return "未知时间";
  }
  const normalized =
    timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return "未知时间";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) {
    return "刚刚";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays} 天前`;
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function resolveMemorySourceLabel(entry: UnifiedMemory): string {
  switch (entry.metadata.source) {
    case "manual":
      return "手动整理";
    case "imported":
      return "外部导入";
    case "auto_extracted":
    default:
      return "自动沉淀";
  }
}

function buildMemoryPreviewLines(entry: UnifiedMemory): string[] {
  const summary = normalizeOptionalText(entry.summary)?.toLocaleLowerCase();

  return entry.content
    .split(/\n+/)
    .map((line) => normalizeOptionalText(line))
    .filter((line): line is string => {
      if (!line) {
        return false;
      }
      if (summary && line.toLocaleLowerCase() === summary) {
        return false;
      }
      return true;
    })
    .slice(0, 4);
}

function formatRuntimeLayerStatusLabel(
  label: string,
  count?: number | null,
  active?: boolean,
): string {
  if (typeof count === "number") {
    return `${label} ${count}`;
  }
  return `${label} ${active ? "已命中" : "未命中"}`;
}

function resolveRuntimeHistorySummary(
  entry: RuntimeMemoryPrefetchHistoryEntry,
): string {
  return (
    entry.preview.durableTitle ||
    entry.preview.workingExcerpt ||
    entry.preview.compactionSummary ||
    entry.preview.firstRuleSourcePath ||
    entry.preview.teamKey ||
    "这次命中没有留下可展示摘要。"
  );
}

function resolveRuntimeHistoryPreviewChangeLabel(
  change: RuntimeMemoryPrefetchHistoryDiff["previewChanges"][number],
): string {
  switch (change.key) {
    case "rule":
      return `规则来源 ${change.previous || "无"} -> ${change.current || "无"}`;
    case "working":
      return `工作摘录 ${change.previous || "无"} -> ${change.current || "无"}`;
    case "durable":
      return `持久记忆 ${change.previous || "无"} -> ${change.current || "无"}`;
    case "team":
      return `团队记忆 ${change.previous || "无"} -> ${change.current || "无"}`;
    case "compaction":
      return `压缩摘要 ${change.previous || "无"} -> ${change.current || "无"}`;
    case "user_message":
      return `输入 ${change.previous || "无"} -> ${change.current || "无"}`;
    default:
      return `${change.previous || "无"} -> ${change.current || "无"}`;
  }
}

function resolveRuntimeHistorySourceLabel(
  source: RuntimeMemoryPrefetchHistoryEntry["source"],
): string {
  return source === "thread_reliability" ? "来自线程面板" : "来自灵感库";
}

function formatRuntimeLayerLatestValue(
  layer: RuntimeMemoryPrefetchHistoryLayerStability,
): string {
  if (layer.key === "working" || layer.key === "compaction") {
    return layer.latestValue > 0 ? "当前已命中" : "当前未命中";
  }
  return `当前 ${layer.latestValue}`;
}

function resolveRuntimeLayerStabilityPresentation(
  layer: RuntimeMemoryPrefetchHistoryLayerStability,
  totalEntries: number,
): {
  title: string;
  description: string;
  className: string;
  badgeClassName: string;
} {
  const title = RUNTIME_HISTORY_LAYER_LABELS[layer.key];

  if (totalEntries <= 0) {
    return {
      title: "暂无历史",
      description: "先触发几轮运行时预演，这里再判断层稳定性。",
      className: "border-slate-200 bg-slate-50/70",
      badgeClassName: "border-slate-200 bg-white text-slate-700",
    };
  }

  if (layer.state === "steady_miss") {
    return {
      title: "一直缺失",
      description: `最近 ${totalEntries} 次里都没有命中${title}。`,
      className: "border-slate-200 bg-slate-50/70",
      badgeClassName: "border-slate-200 bg-white text-slate-700",
    };
  }

  if (layer.state === "steady_hit") {
    return {
      title: "稳定命中",
      description: `最近 ${totalEntries} 次都命中${title}，且没有出现层值变化。`,
      className: "border-emerald-200 bg-emerald-50/70",
      badgeClassName: EMERALD_OUTLINE_BADGE_CLASS_NAME,
    };
  }

  if (layer.missEntries === 0) {
    return {
      title: "持续命中",
      description: `最近 ${totalEntries} 次都命中${title}，但层值发生了 ${layer.valueChanges} 次变化。`,
      className: "border-emerald-200 bg-emerald-50/40",
      badgeClassName: EMERALD_OUTLINE_BADGE_CLASS_NAME,
    };
  }

  return {
    title: "间歇命中",
    description: `最近 ${totalEntries} 次里命中${title} ${layer.hitEntries} 次，发生 ${layer.valueChanges} 次状态变化。`,
    className: "border-slate-200 bg-emerald-50/30",
    badgeClassName: SLATE_OUTLINE_BADGE_CLASS_NAME,
  };
}

function resolveRuntimeComparisonAssessmentBadgeClassName(
  assessment: RuntimeMemoryPrefetchHistoryDiffAssessment,
): string {
  switch (assessment.status) {
    case "stronger":
      return EMERALD_BADGE_CLASS_NAME;
    case "weaker":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "mixed":
      return SLATE_BADGE_CLASS_NAME;
    case "same":
    default:
      return SLATE_OUTLINE_BADGE_CLASS_NAME;
  }
}

function resolveSectionState(section?: MemoryPageSection): {
  section: PrimarySection;
  durableFilter: DurableCategoryFilter;
} {
  if (section && LEGACY_DURABLE_SECTIONS.has(section as MemoryCategory)) {
    return {
      section: "durable",
      durableFilter: section as MemoryCategory,
    };
  }

  if (
    section === "home" ||
    section === "rules" ||
    section === "working" ||
    section === "durable" ||
    section === "team" ||
    section === "compaction"
  ) {
    return {
      section,
      durableFilter: "all",
    };
  }

  return {
    section: "home",
    durableFilter: "all",
  };
}

function buildCreationPrompt(
  entry: UnifiedMemory,
  categoryLabel: string,
): string {
  const lines = [
    "请把这条记忆整理成当前创作输入，并保留关键约束。",
    `灵感分类：${categoryLabel}`,
    `灵感标题：${entry.title}`,
    `摘要：${entry.summary}`,
    `内容：${entry.content}`,
  ];
  if (entry.tags.length > 0) {
    lines.push(`标签：${entry.tags.join("、")}`);
  }
  return lines.join("\n");
}

function getMemoryAvailabilityBadge(status: MemoryAvailabilityStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "loaded":
      return {
        label: "已加载",
        className: EMERALD_BADGE_CLASS_NAME,
      };
    case "exists":
      return {
        label: "已发现",
        className: SLATE_BADGE_CLASS_NAME,
      };
    case "missing":
    default:
      return {
        label: "未发现",
        className: SLATE_OUTLINE_BADGE_CLASS_NAME,
      };
  }
}

function resolveMemoryType(category: MemoryCategory): MemoryKnowledgeType {
  return LEGACY_CATEGORY_TO_MEMORY_TYPE[category];
}

function resolveSourceKindLabel(kind: string): string {
  switch (kind) {
    case "managed_policy":
      return "托管记忆";
    case "user_memory":
      return "用户记忆";
    case "project_memory":
    case "workspace_agents":
      return "项目记忆";
    case "project_local":
      return "本地记忆";
    case "project_rule":
    case "project_rules":
      return "项目规则";
    case "auto_memory":
      return "记忆目录入口";
    case "auto_memory_item":
      return "memdir 条目";
    case "durable_memory":
      return "/memories";
    case "additional_memory":
      return "附加目录";
    default:
      return kind;
  }
}

function resolveSourceBucketLabel(bucket?: string | null): string {
  if (!bucket) {
    return "未分类";
  }
  return (
    SOURCE_BUCKET_META.find((item) => item.key === bucket)?.label || bucket
  );
}

function MemorySurfacePanel(props: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={PANEL_CLASS_NAME}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {props.title}
          </h2>
          {props.description ? (
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {props.description}
            </p>
          ) : null}
        </div>
        {props.actions}
      </div>
      {props.children}
    </section>
  );
}

export function MemoryPage({ onNavigate, pageParams }: MemoryPageProps) {
  const initialState = resolveSectionState(pageParams?.section);
  const [activeSection, setActiveSection] = useState<PrimarySection>(
    initialState.section,
  );
  const [durableFilter, setDurableFilter] = useState<DurableCategoryFilter>(
    initialState.durableFilter,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rulesSources, setRulesSources] =
    useState<EffectiveMemorySourcesResponse | null>(null);
  const [autoIndex, setAutoIndex] = useState<AutoMemoryIndexResponse | null>(
    null,
  );
  const [workingView, setWorkingView] = useState<WorkingMemoryView | null>(
    null,
  );
  const [extractionStatus, setExtractionStatus] =
    useState<MemoryExtractionStatusResponse | null>(null);
  const [, setUnifiedStats] = useState<UnifiedMemoryStatsResponse | null>(null);
  const [unifiedMemories, setUnifiedMemories] = useState<UnifiedMemory[]>([]);
  const [projectId, setProjectId] = useState<string | null>(
    getStoredResourceProjectId(),
  );
  const [teamSnapshots, setTeamSnapshots] = useState<TeamMemorySnapshot[]>([]);
  const [runtimePrefetchHistory, setRuntimePrefetchHistory] = useState<
    RuntimeMemoryPrefetchHistoryEntry[]
  >([]);
  const [runtimePrefetchState, setRuntimePrefetchState] =
    useState<RuntimeMemoryPrefetchState>({
      status: "idle",
      result: null,
      error: null,
    });
  const [memdirActionNotice, setMemdirActionNotice] =
    useState<MemdirActionNotice | null>(null);
  const [memdirActionType, setMemdirActionType] = useState<
    "scaffold" | "cleanup" | null
  >(null);
  const [runtimeHistoryScope, setRuntimeHistoryScope] =
    useState<RuntimeMemoryPrefetchHistoryScope>("all");
  const [
    runtimeComparisonBaselineSignature,
    setRuntimeComparisonBaselineSignature,
  ] = useState<string | null>(null);
  const [memoryLauncherTask, setMemoryLauncherTask] =
    useState<CuratedTaskTemplateItem | null>(null);
  const [
    memoryLauncherInitialInputValues,
    setMemoryLauncherInitialInputValues,
  ] = useState<CuratedTaskInputValues | null>(null);
  const [
    memoryLauncherInitialReferenceMemoryIds,
    setMemoryLauncherInitialReferenceMemoryIds,
  ] = useState<string[] | null>(null);
  const [
    memoryLauncherInitialReferenceEntries,
    setMemoryLauncherInitialReferenceEntries,
  ] = useState<CuratedTaskReferenceEntry[] | null>(null);
  const [
    memoryLauncherPrefillHintOverride,
    setMemoryLauncherPrefillHintOverride,
  ] = useState<string | null>(null);
  const [selectedDurableMemoryId, setSelectedDurableMemoryId] = useState<
    string | null
  >(null);
  const [, setCuratedTaskRecommendationSignalsVersion] = useState(0);
  const durableEntryRefs = useRef<Record<string, HTMLElement | null>>({});
  const lastAutoFocusedDurableMemoryIdRef = useRef<string | null>(null);

  const runtimeSessionId = pageParams?.runtimeSessionId?.trim() || "";
  const runtimeWorkingDir = pageParams?.runtimeWorkingDir?.trim() || "";
  const runtimeUserMessage = pageParams?.runtimeUserMessage?.trim() || "";
  const hasRuntimeContext = Boolean(runtimeSessionId && runtimeWorkingDir);
  const memdirWorkingDir =
    runtimeWorkingDir || rulesSources?.working_dir?.trim() || undefined;

  useEffect(() => {
    const resolved = resolveSectionState(pageParams?.section);
    setActiveSection(resolved.section);
    setDurableFilter(resolved.durableFilter);
  }, [pageParams?.section]);

  useEffect(() => {
    return onResourceProjectChange((detail) => {
      setProjectId(detail.projectId);
    });
  }, []);

  useEffect(() => {
    setRuntimeHistoryScope(hasRuntimeContext ? "workspace" : "all");
  }, [hasRuntimeContext, runtimeSessionId, runtimeWorkingDir]);

  useEffect(() => {
    if (!hasRuntimeContext) {
      setRuntimeComparisonBaselineSignature(null);
    }
  }, [
    hasRuntimeContext,
    runtimeSessionId,
    runtimeWorkingDir,
    runtimeUserMessage,
  ]);

  useEffect(() => {
    let disposed = false;

    async function loadAll() {
      setLoading(true);
      setError(null);

      try {
        const [
          nextRulesSources,
          nextAutoIndex,
          nextWorkingView,
          nextExtractionStatus,
          nextUnifiedStats,
          nextUnifiedMemories,
        ] = await Promise.all([
          getContextMemoryEffectiveSources(),
          getContextMemoryAutoIndex(),
          getContextWorkingMemory(undefined, 24),
          getContextMemoryExtractionStatus(),
          getUnifiedMemoryStats(),
          listUnifiedMemories({ limit: 120 }),
        ]);
        const nextTeamSnapshots =
          typeof window !== "undefined"
            ? listTeamMemorySnapshots(window.localStorage)
            : [];
        const nextRuntimePrefetchHistory =
          typeof window !== "undefined"
            ? listRuntimeMemoryPrefetchHistory()
            : [];

        if (disposed) {
          return;
        }

        setRulesSources(nextRulesSources);
        setAutoIndex(nextAutoIndex);
        setWorkingView(nextWorkingView);
        setExtractionStatus(nextExtractionStatus);
        setUnifiedStats(nextUnifiedStats);
        setUnifiedMemories(nextUnifiedMemories);
        setTeamSnapshots(nextTeamSnapshots);
        setRuntimePrefetchHistory(nextRuntimePrefetchHistory);
      } catch (loadError) {
        if (disposed) {
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : "记忆页面加载失败",
        );
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    }

    void loadAll();

    return () => {
      disposed = true;
    };
  }, []);

  const refreshMemdirSurface = useCallback(async (workingDir?: string) => {
    const [nextRulesSources, nextAutoIndex] = await Promise.all([
      getContextMemoryEffectiveSources(workingDir).catch(() => null),
      getContextMemoryAutoIndex(workingDir).catch(() => null),
    ]);

    if (nextRulesSources) {
      setRulesSources(nextRulesSources);
    }
    if (nextAutoIndex) {
      setAutoIndex(nextAutoIndex);
    }
  }, []);

  const refreshUnifiedMemorySurface = useCallback(
    async (isActive?: () => boolean) => {
      const [nextUnifiedStats, nextUnifiedMemories] = await Promise.all([
        getUnifiedMemoryStats(),
        listUnifiedMemories({ limit: 120 }),
      ]);

      if (isActive && !isActive()) {
        return;
      }

      setUnifiedStats(nextUnifiedStats);
      setUnifiedMemories(nextUnifiedMemories);
    },
    [],
  );

  useEffect(() => {
    let active = true;

    const unsubscribe = subscribeCuratedTaskRecommendationSignalsChanged(() => {
      setCuratedTaskRecommendationSignalsVersion((previous) => previous + 1);
      void refreshUnifiedMemorySurface(() => active).catch(() => undefined);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [refreshUnifiedMemorySurface]);

  const filteredMemories = useMemo(() => {
    if (durableFilter === "all") {
      return unifiedMemories;
    }
    return unifiedMemories.filter(
      (memory) => memory.category === durableFilter,
    );
  }, [durableFilter, unifiedMemories]);
  const focusMemoryTitle =
    normalizeOptionalText(pageParams?.focusMemoryTitle)?.toLocaleLowerCase() ||
    "";
  const focusedDurableMemory = useMemo(() => {
    if (activeSection !== "durable" || !focusMemoryTitle) {
      return null;
    }

    return (
      filteredMemories.find((memory) => {
        if (
          pageParams?.focusMemoryCategory &&
          memory.category !== pageParams.focusMemoryCategory
        ) {
          return false;
        }

        return (
          normalizeOptionalText(memory.title)?.toLocaleLowerCase() ===
          focusMemoryTitle
        );
      }) ?? null
    );
  }, [
    activeSection,
    filteredMemories,
    focusMemoryTitle,
    pageParams?.focusMemoryCategory,
  ]);

  useEffect(() => {
    const focusedMemoryId = focusedDurableMemory?.id ?? null;
    if (!focusedMemoryId) {
      lastAutoFocusedDurableMemoryIdRef.current = null;
      return;
    }

    if (lastAutoFocusedDurableMemoryIdRef.current === focusedMemoryId) {
      return;
    }

    lastAutoFocusedDurableMemoryIdRef.current = focusedMemoryId;
    const target = durableEntryRefs.current[focusedMemoryId];
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }
  }, [focusedDurableMemory?.id]);

  const inspirationEntries = useMemo(
    () => buildInspirationProjectionEntries(unifiedMemories),
    [unifiedMemories],
  );

  const inspirationEntryMap = useMemo(
    () => new Map(inspirationEntries.map((entry) => [entry.id, entry])),
    [inspirationEntries],
  );
  const durableCategoryCounts = useMemo(() => {
    return unifiedMemories.reduce(
      (result, memory) => {
        result.all += 1;
        result[memory.category] += 1;
        return result;
      },
      {
        all: 0,
        identity: 0,
        context: 0,
        preference: 0,
        experience: 0,
        activity: 0,
      } as Record<DurableCategoryFilter, number>,
    );
  }, [unifiedMemories]);

  useEffect(() => {
    if (focusedDurableMemory?.id) {
      setSelectedDurableMemoryId(focusedDurableMemory.id);
      return;
    }

    setSelectedDurableMemoryId((current) => {
      if (
        current &&
        filteredMemories.some((memory) => memory.id === current)
      ) {
        return current;
      }
      return filteredMemories[0]?.id ?? null;
    });
  }, [filteredMemories, focusedDurableMemory?.id]);

  const selectedDurableMemory = useMemo(
    () =>
      filteredMemories.find((memory) => memory.id === selectedDurableMemoryId) ??
      focusedDurableMemory ??
      filteredMemories[0] ??
      null,
    [filteredMemories, focusedDurableMemory, selectedDurableMemoryId],
  );
  const selectedDurableProjection = useMemo(
    () =>
      selectedDurableMemory
        ? inspirationEntryMap.get(selectedDurableMemory.id) ?? null
        : null,
    [inspirationEntryMap, selectedDurableMemory],
  );
  const selectedDurablePreviewLines = useMemo(
    () =>
      selectedDurableMemory ? buildMemoryPreviewLines(selectedDurableMemory) : [],
    [selectedDurableMemory],
  );

  const inspirationProjectionCounts = useMemo(() => {
    return inspirationEntries.reduce(
      (result, entry) => {
        result[entry.projectionKind] += 1;
        return result;
      },
      {
        style: 0,
        reference: 0,
        preference: 0,
        outcome: 0,
        collection: 0,
      } as Record<keyof typeof INSPIRATION_PROJECTION_META, number>,
    );
  }, [inspirationEntries]);

  const featuredInspirationEntries = useMemo(
    () => inspirationEntries.slice(0, 4),
    [inspirationEntries],
  );
  const featuredMemoryReferenceEntries = useMemo(
    () => buildCuratedTaskReferenceEntries(unifiedMemories).slice(0, 3),
    [unifiedMemories],
  );
  const focusedRecommendationReferenceEntries = useMemo(
    () =>
      focusedDurableMemory
        ? buildCuratedTaskReferenceEntries([focusedDurableMemory])
        : [],
    [focusedDurableMemory],
  );
  const activeRecommendationReferenceEntries = useMemo(
    () =>
      mergeCuratedTaskReferenceEntries([
        ...focusedRecommendationReferenceEntries,
        ...featuredMemoryReferenceEntries,
      ]).slice(0, 3),
    [featuredMemoryReferenceEntries, focusedRecommendationReferenceEntries],
  );
  const homeContinuationReferenceEntry = useMemo(
    () =>
      !focusedDurableMemory
        ? activeRecommendationReferenceEntries.find(
            (entry) =>
              entry.category === "experience" &&
              Object.keys(entry.taskPrefillByTaskId ?? {}).length > 0,
          )
        : undefined,
    [activeRecommendationReferenceEntries, focusedDurableMemory],
  );

  const tasteSummary = useMemo(
    () => buildInspirationTasteSummary(inspirationEntries),
    [inspirationEntries],
  );
  const featuredMemoryCuratedTasks = useMemo(
    () =>
      listFeaturedHomeCuratedTaskTemplates(undefined, {
        projectId,
        sessionId: runtimeSessionId || undefined,
        referenceEntries: activeRecommendationReferenceEntries,
        limit: 3,
      }),
    [activeRecommendationReferenceEntries, projectId, runtimeSessionId],
  );
  const focusedMemoryCuratedTasks = useMemo(
    () => featuredMemoryCuratedTasks.slice(0, 2),
    [featuredMemoryCuratedTasks],
  );
  const featuredMemoryReferenceSummary = useMemo(() => {
    if (activeRecommendationReferenceEntries.length === 0) {
      return "";
    }

    const visibleTitles = activeRecommendationReferenceEntries
      .slice(0, 2)
      .map((entry) => entry.title)
      .join("、");

    return `${
      focusedDurableMemory ? "会优先带上" : "默认会带上"
    }：${visibleTitles}${
      activeRecommendationReferenceEntries.length > 2
        ? ` 等 ${activeRecommendationReferenceEntries.length} 条参考对象`
        : ""
    }`;
  }, [activeRecommendationReferenceEntries, focusedDurableMemory]);
  const memoryLauncherPrefill = useMemo(
    () => resolveCuratedTaskTemplateLaunchPrefill(memoryLauncherTask),
    [memoryLauncherTask],
  );
  const effectiveMemoryLauncherInputValues =
    memoryLauncherInitialInputValues ?? memoryLauncherPrefill?.inputValues;
  const memoryLauncherReferenceEntries = useMemo(
    () =>
      mergeCuratedTaskReferenceEntries([
        ...activeRecommendationReferenceEntries,
        ...(memoryLauncherInitialReferenceEntries ?? []),
        ...(memoryLauncherPrefill?.referenceEntries ?? []),
      ]),
    [
      activeRecommendationReferenceEntries,
      memoryLauncherInitialReferenceEntries,
      memoryLauncherPrefill?.referenceEntries,
    ],
  );
  const memoryLauncherReferenceMemoryIds = useMemo(
    () =>
      normalizeCuratedTaskReferenceMemoryIds([
        ...(memoryLauncherInitialReferenceMemoryIds ?? []),
        ...(extractCuratedTaskReferenceMemoryIds(
          activeRecommendationReferenceEntries,
        ) ?? []),
        ...(memoryLauncherPrefill?.referenceMemoryIds ?? []),
        ...(extractCuratedTaskReferenceMemoryIds(
          memoryLauncherPrefill?.referenceEntries ?? [],
        ) ?? []),
      ]) ?? [],
    [
      activeRecommendationReferenceEntries,
      memoryLauncherInitialReferenceMemoryIds,
      memoryLauncherPrefill?.referenceEntries,
      memoryLauncherPrefill?.referenceMemoryIds,
    ],
  );
  const effectiveMemoryLauncherPrefillHint =
    memoryLauncherPrefillHintOverride ?? memoryLauncherPrefill?.hint;

  const sourceBuckets = useMemo(
    () =>
      SOURCE_BUCKET_META.map((bucket) => {
        const sources =
          rulesSources?.sources.filter((source) =>
            bucket.kinds.includes(source.kind),
          ) || [];
        const loadedCount = sources.filter((source) => source.loaded).length;
        const existsCount = sources.filter((source) => source.exists).length;
        const latestUpdatedAt =
          sources.reduce((latest, source) => {
            if (!source.updated_at) {
              return latest;
            }
            return Math.max(latest, source.updated_at);
          }, 0) || null;
        const status: "loaded" | "exists" | "missing" =
          loadedCount > 0 ? "loaded" : existsCount > 0 ? "exists" : "missing";
        return {
          ...bucket,
          sources,
          loadedCount,
          existsCount,
          latestUpdatedAt,
          provider:
            sources.find((source) => source.provider)?.provider ||
            (bucket.key === "auto" ? "memdir" : null),
          status,
          primaryPath: sources[0]?.path || null,
          preview:
            bucket.key === "auto" && autoIndex?.preview_lines?.length
              ? autoIndex.preview_lines.join("\n")
              : (sources.find((source) => source.preview)?.preview ?? null),
        };
      }),
    [autoIndex?.preview_lines, rulesSources?.sources],
  );

  const runtimeTeamSnapshot = useMemo(() => {
    if (!runtimeWorkingDir) {
      return null;
    }

    const normalizedWorkingDir =
      normalizeTeamMemoryRepoScope(runtimeWorkingDir);
    return (
      teamSnapshots.find(
        (snapshot) =>
          normalizeTeamMemoryRepoScope(snapshot.repoScope) ===
          normalizedWorkingDir,
      ) || null
    );
  }, [runtimeWorkingDir, teamSnapshots]);

  const runtimeTeamShadowMetadata = useMemo(
    () => buildTeamMemoryShadowRequestMetadata(runtimeTeamSnapshot),
    [runtimeTeamSnapshot],
  );

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!runtimeSessionId || !runtimeWorkingDir) {
      setRuntimePrefetchState({
        status: "idle",
        result: null,
        error: null,
      });
      return;
    }

    let disposed = false;
    setRuntimePrefetchState({
      status: "loading",
      result: null,
      error: null,
    });

    void prefetchContextMemoryForTurn({
      session_id: runtimeSessionId,
      working_dir: runtimeWorkingDir,
      user_message: runtimeUserMessage || undefined,
      request_metadata: runtimeTeamShadowMetadata
        ? {
            team_memory_shadow: runtimeTeamShadowMetadata,
          }
        : undefined,
    })
      .then((result) => {
        if (disposed) {
          return;
        }
        setRuntimePrefetchHistory(
          recordRuntimeMemoryPrefetchHistory({
            sessionId: runtimeSessionId,
            workingDir: runtimeWorkingDir,
            userMessage: runtimeUserMessage || null,
            source: "memory_page",
            result,
          }),
        );
        setRuntimePrefetchState({
          status: "ready",
          result,
          error: null,
        });
      })
      .catch((runtimeError) => {
        if (disposed) {
          return;
        }
        setRuntimePrefetchState({
          status: "error",
          result: null,
          error:
            runtimeError instanceof Error
              ? runtimeError.message
              : "运行时记忆预演失败，请稍后重试",
        });
      });

    return () => {
      disposed = true;
    };
  }, [
    loading,
    runtimeSessionId,
    runtimeTeamShadowMetadata,
    runtimeUserMessage,
    runtimeWorkingDir,
  ]);

  const handleScaffoldMemdir = useCallback(async () => {
    if (!memdirWorkingDir) {
      setMemdirActionNotice({
        tone: "error",
        message: "当前未获取到 workspace 路径，暂无法初始化 memdir",
      });
      return;
    }

    setMemdirActionType("scaffold");
    setMemdirActionNotice(null);
    try {
      const result = await scaffoldContextMemdir(memdirWorkingDir, false);
      setMemdirActionNotice({
        tone: "success",
        message: formatMemdirScaffoldMessage(result),
      });
      await refreshMemdirSurface(memdirWorkingDir);
    } catch (actionError) {
      console.error("初始化 memdir 失败:", actionError);
      setMemdirActionNotice({
        tone: "error",
        message: resolveActionErrorMessage(actionError, "初始化 memdir 失败"),
      });
    } finally {
      setMemdirActionType(null);
    }
  }, [memdirWorkingDir, refreshMemdirSurface]);

  const handleCleanupMemdir = useCallback(async () => {
    if (!memdirWorkingDir) {
      setMemdirActionNotice({
        tone: "error",
        message: "当前未获取到 workspace 路径，暂无法整理 memdir",
      });
      return;
    }

    setMemdirActionType("cleanup");
    setMemdirActionNotice(null);
    try {
      const result = await cleanupContextMemdir(memdirWorkingDir);
      setMemdirActionNotice({
        tone: "success",
        message: formatMemdirCleanupMessage(result),
      });
      await refreshMemdirSurface(memdirWorkingDir);
    } catch (actionError) {
      console.error("整理 memdir 失败:", actionError);
      setMemdirActionNotice({
        tone: "error",
        message: resolveActionErrorMessage(actionError, "整理 memdir 失败"),
      });
    } finally {
      setMemdirActionType(null);
    }
  }, [memdirWorkingDir, refreshMemdirSurface]);

  const buildMemoryPageParams = useCallback(
    (
      section: MemoryPageSection,
      overrides: Partial<MemoryPageParams> = {},
    ): MemoryPageParams => ({
      section,
      runtimeSessionId:
        (overrides.runtimeSessionId ?? runtimeSessionId) || undefined,
      runtimeWorkingDir:
        (overrides.runtimeWorkingDir ?? runtimeWorkingDir) || undefined,
      runtimeUserMessage:
        (overrides.runtimeUserMessage ?? runtimeUserMessage) || undefined,
    }),
    [runtimeSessionId, runtimeUserMessage, runtimeWorkingDir],
  );

  const navigateToMemorySection = useCallback(
    (nextSection: MemoryPageSection) => {
      const resolved = resolveSectionState(nextSection);
      setActiveSection(resolved.section);
      setDurableFilter(resolved.durableFilter);
      onNavigate("memory", buildMemoryPageParams(nextSection));
    },
    [buildMemoryPageParams, onNavigate],
  );

  const handleOpenProjectResources = useCallback(() => {
    onNavigate("resources");
  }, [onNavigate]);

  function handleBringToCreation(entry: UnifiedMemory) {
    const categoryLabel = CATEGORY_LABELS[entry.category];
    const entryBannerMessage = `已从灵感库带入“${categoryLabel}”条目，可继续改写后发送。`;
    const initialRequestMetadata =
      buildMemoryEntryCreationReplayRequestMetadata({
        id: entry.id,
        projectId: projectId || undefined,
        category: entry.category,
        title: entry.title,
        summary: entry.summary,
        content: entry.content,
        tags: entry.tags,
      });

    onNavigate(
      "agent",
      buildHomeAgentParams({
        projectId: projectId || undefined,
        entryBannerMessage,
        initialUserPrompt: buildCreationPrompt(entry, categoryLabel),
        initialRequestMetadata,
      }),
    );
  }

  function handleOpenInScene(entry: UnifiedMemory) {
    const projectedEntry = inspirationEntryMap.get(entry.id);
    const prefillIntent = projectedEntry
      ? buildScenePrefillFromInspiration(projectedEntry)
      : `围绕这条灵感继续创作：${entry.title}`;

    onNavigate("sceneapps", {
      view: "catalog",
      projectId: projectId || undefined,
      referenceMemoryIds: [entry.id],
      search: entry.title,
      prefillIntent,
    });
  }

  const handleSelectDurableMemory = useCallback((memoryId: string) => {
    setSelectedDurableMemoryId(memoryId);
  }, []);

  const handleMemoryLauncherOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setMemoryLauncherTask(null);
      setMemoryLauncherInitialInputValues(null);
      setMemoryLauncherInitialReferenceMemoryIds(null);
      setMemoryLauncherInitialReferenceEntries(null);
      setMemoryLauncherPrefillHintOverride(null);
    }
  }, []);
  const handleApplyMemoryLauncherReviewSuggestion = useCallback(
    (
      task: CuratedTaskTemplateItem,
      options: {
        inputValues: CuratedTaskInputValues;
        referenceSelection: CuratedTaskReferenceSelection;
      },
    ) => {
      setMemoryLauncherTask(task);
      setMemoryLauncherInitialInputValues(options.inputValues);
      setMemoryLauncherInitialReferenceMemoryIds(
        normalizeCuratedTaskReferenceMemoryIds(
          options.referenceSelection.referenceMemoryIds,
        ) ?? [],
      );
      setMemoryLauncherInitialReferenceEntries(
        mergeCuratedTaskReferenceEntries(
          options.referenceSelection.referenceEntries,
        ),
      );
      setMemoryLauncherPrefillHintOverride(
        "已按最近判断切到更适合的结果模板，你可以继续改后再进入生成。",
      );
    },
    [],
  );

  const handleMemoryCuratedTaskConfirm = useCallback(
    (
      task: CuratedTaskTemplateItem,
      inputValues: Record<string, string>,
      referenceSelection: CuratedTaskReferenceSelection,
    ) => {
      const normalizedLaunchInputValues =
        normalizeCuratedTaskLaunchInputValues(inputValues);

      recordCuratedTaskTemplateUsage({
        templateId: task.id,
        launchInputValues: inputValues,
        referenceMemoryIds: referenceSelection.referenceMemoryIds,
        referenceEntries: referenceSelection.referenceEntries,
      });

      setMemoryLauncherTask(null);
      setMemoryLauncherInitialInputValues(null);
      setMemoryLauncherInitialReferenceMemoryIds(null);
      setMemoryLauncherInitialReferenceEntries(null);
      setMemoryLauncherPrefillHintOverride(null);

      const requestMetadata = buildCuratedTaskLaunchRequestMetadata({
        taskId: task.id,
        taskTitle: task.title,
        inputValues,
        referenceMemoryIds: referenceSelection.referenceMemoryIds,
        referenceEntries: referenceSelection.referenceEntries,
      });

      onNavigate(
        "agent",
        buildHomeAgentParams({
          projectId: projectId || undefined,
          initialRequestMetadata: requestMetadata,
          initialInputCapability: {
            capabilityRoute: {
              kind: "curated_task",
              taskId: task.id,
              taskTitle: task.title,
              prompt: buildCuratedTaskLaunchPrompt({
                task,
                inputValues,
                referenceEntries: referenceSelection.referenceEntries,
              }),
              ...(normalizedLaunchInputValues
                ? {
                    launchInputValues: normalizedLaunchInputValues,
                  }
                : {}),
              ...(referenceSelection.referenceMemoryIds.length > 0
                ? {
                    referenceMemoryIds: referenceSelection.referenceMemoryIds,
                  }
                : {}),
              ...(referenceSelection.referenceEntries.length > 0
                ? {
                    referenceEntries: referenceSelection.referenceEntries,
                  }
                : {}),
            },
            requestKey: Date.now(),
          },
          entryBannerMessage: `已带着灵感库推荐“${task.title}”的启动信息回到生成，接着把这轮做下去就行。`,
        }),
      );
    },
    [onNavigate, projectId],
  );

  function handleOpenRuntimeHistoryEntry(
    entry: RuntimeMemoryPrefetchHistoryEntry,
  ) {
    onNavigate(
      "memory",
      buildMemoryPageParams("home", {
        runtimeSessionId: entry.sessionId,
        runtimeWorkingDir: entry.workingDir,
        runtimeUserMessage: entry.userMessage || undefined,
      }),
    );
  }

  const normalizedRuntimeWorkingDir = runtimeWorkingDir
    ? normalizeTeamMemoryRepoScope(runtimeWorkingDir)
    : "";
  const filteredRuntimePrefetchHistory = useMemo(
    () =>
      filterRuntimeMemoryPrefetchHistory(runtimePrefetchHistory, {
        scope: hasRuntimeContext ? runtimeHistoryScope : "all",
        sessionId: runtimeSessionId,
        workingDir: runtimeWorkingDir,
      }),
    [
      hasRuntimeContext,
      runtimeHistoryScope,
      runtimePrefetchHistory,
      runtimeSessionId,
      runtimeWorkingDir,
    ],
  );
  const runtimeHistorySummary = useMemo(
    () => summarizeRuntimeMemoryPrefetchHistory(filteredRuntimePrefetchHistory),
    [filteredRuntimePrefetchHistory],
  );
  const displayedRuntimePrefetchHistory = filteredRuntimePrefetchHistory.slice(
    0,
    6,
  );
  const activeRuntimeHistoryScopeMeta =
    RUNTIME_HISTORY_SCOPE_META.find(
      (item) => item.key === runtimeHistoryScope,
    ) || RUNTIME_HISTORY_SCOPE_META[0];
  const isRuntimeHistoryEntryActive = useCallback(
    (entry: RuntimeMemoryPrefetchHistoryEntry) =>
      entry.sessionId === runtimeSessionId &&
      normalizeTeamMemoryRepoScope(entry.workingDir) ===
        normalizedRuntimeWorkingDir &&
      (entry.userMessage || "") === runtimeUserMessage,
    [runtimeSessionId, normalizedRuntimeWorkingDir, runtimeUserMessage],
  );
  const currentRuntimeHistoryEntry = useMemo(
    () =>
      runtimePrefetchHistory.find((entry) =>
        isRuntimeHistoryEntryActive(entry),
      ) || null,
    [runtimePrefetchHistory, isRuntimeHistoryEntryActive],
  );
  const runtimeComparisonCandidates = useMemo(
    () =>
      filteredRuntimePrefetchHistory.filter(
        (entry) => !isRuntimeHistoryEntryActive(entry),
      ),
    [filteredRuntimePrefetchHistory, isRuntimeHistoryEntryActive],
  );
  const runtimeComparisonBaselineEntry = useMemo(() => {
    if (!runtimeComparisonBaselineSignature) {
      return runtimeComparisonCandidates[0] || null;
    }
    return (
      runtimeComparisonCandidates.find(
        (entry) => entry.signature === runtimeComparisonBaselineSignature,
      ) ||
      runtimeComparisonCandidates[0] ||
      null
    );
  }, [runtimeComparisonBaselineSignature, runtimeComparisonCandidates]);
  const runtimeComparisonDiff =
    currentRuntimeHistoryEntry && runtimeComparisonBaselineEntry
      ? compareRuntimeMemoryPrefetchHistoryEntries(
          currentRuntimeHistoryEntry,
          runtimeComparisonBaselineEntry,
        )
      : null;
  const runtimeComparisonAssessment = useMemo(
    () =>
      runtimeComparisonDiff
        ? assessRuntimeMemoryPrefetchHistoryDiff(runtimeComparisonDiff)
        : null,
    [runtimeComparisonDiff],
  );
  useEffect(() => {
    if (runtimeComparisonCandidates.length === 0) {
      if (runtimeComparisonBaselineSignature !== null) {
        setRuntimeComparisonBaselineSignature(null);
      }
      return;
    }

    if (
      runtimeComparisonBaselineSignature &&
      runtimeComparisonCandidates.some(
        (entry) => entry.signature === runtimeComparisonBaselineSignature,
      )
    ) {
      return;
    }

    setRuntimeComparisonBaselineSignature(
      runtimeComparisonCandidates[0].signature,
    );
  }, [runtimeComparisonBaselineSignature, runtimeComparisonCandidates]);
  function handleClearRuntimeHistory() {
    clearRuntimeMemoryPrefetchHistory();
    setRuntimePrefetchHistory([]);
    setRuntimeComparisonBaselineSignature(null);
  }
  const runtimeDrilldownActions = hasRuntimeContext ? (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className={cn(BUTTON_CLASS_NAME, EMERALD_BUTTON_CLASS_NAME)}
        onClick={() => navigateToMemorySection("rules")}
      >
        看底层来源
      </button>
      <button
        type="button"
        className={cn(BUTTON_CLASS_NAME, EMERALD_BUTTON_CLASS_NAME)}
        onClick={() => navigateToMemorySection("working")}
      >
        看会话工作记忆
      </button>
      <button
        type="button"
        className={cn(BUTTON_CLASS_NAME, EMERALD_BUTTON_CLASS_NAME)}
        onClick={() => navigateToMemorySection("durable")}
      >
        看参考与风格
      </button>
      <button
        type="button"
        className={cn(BUTTON_CLASS_NAME, EMERALD_BUTTON_CLASS_NAME)}
        onClick={() => navigateToMemorySection("team")}
      >
        看团队影子
      </button>
      <button
        type="button"
        className={cn(BUTTON_CLASS_NAME, EMERALD_BUTTON_CLASS_NAME)}
        onClick={() => navigateToMemorySection("compaction")}
      >
        看压缩摘要
      </button>
    </div>
  ) : null;
  const homeOverviewCards = useMemo(
    () => [
      {
        key: "library",
        title: "可继续用的想法",
        value: `${inspirationEntries.length} 条`,
        detail: inspirationEntries[0]
          ? `最近：${inspirationEntries[0].title}`
          : "还没有沉淀好的灵感条目",
        onClick: () => navigateToMemorySection("durable"),
      },
      {
        key: "reference",
        title: "可带上的素材",
        value: `${inspirationProjectionCounts.reference} 条`,
        detail:
          tasteSummary.referenceKeywords.length > 0
            ? `已整理 ${tasteSummary.referenceKeywords.length} 个参考关键词`
            : "还没有明确参考素材",
        onClick: () => navigateToMemorySection("durable"),
      },
      {
        key: "taste",
        title: "稳定的表达偏好",
        value: tasteSummary.styleKeywords.length
          ? `${tasteSummary.styleKeywords.length} 个`
          : `${inspirationProjectionCounts.style + inspirationProjectionCounts.preference} 条风格线索`,
        detail:
          tasteSummary.styleKeywords.length > 0
            ? `最近：${tasteSummary.styleKeywords.slice(0, 2).join(" / ")}`
            : tasteSummary.summary,
        onClick: () => navigateToMemorySection("durable"),
      },
    ],
    [
      inspirationEntries,
      inspirationProjectionCounts.preference,
      inspirationProjectionCounts.reference,
      inspirationProjectionCounts.style,
      navigateToMemorySection,
      tasteSummary.referenceKeywords.length,
      tasteSummary.styleKeywords,
      tasteSummary.summary,
    ],
  );

  return (
    <div className="lime-workbench-theme-scope min-h-full bg-[image:var(--lime-stage-surface)] px-6 py-6">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-5">
        <header className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm shadow-slate-950/5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">灵感</h1>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                收藏过的想法、参考和风格，都从这里继续用。
              </p>
            </div>

            <button
              type="button"
              onClick={handleOpenProjectResources}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              data-testid="memory-project-resources-button"
            >
              <FolderKanban className="h-4 w-4" />
              项目资料
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <nav
            className="mt-5 flex flex-wrap gap-2"
            aria-label="灵感分区"
            data-testid="memory-section-tabs"
          >
            {SECTION_META.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition",
                    active
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900 shadow-sm shadow-emerald-950/5"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900",
                  )}
                  onClick={() => navigateToMemorySection(item.key)}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </header>

        <main className="space-y-5">
            {loading ? (
              <div className={PANEL_CLASS_NAME}>
                <p className="text-sm text-slate-500">正在加载灵感库...</p>
              </div>
            ) : error ? (
              <div
                className={cn(
                  PANEL_CLASS_NAME,
                  "border-rose-200 bg-rose-50/80",
                )}
              >
                <p className="text-sm text-rose-700">{error}</p>
              </div>
            ) : null}

            {!loading &&
            !error &&
            hasRuntimeContext &&
            activeSection !== "home" ? (
              <MemorySurfacePanel
                title="当前运行时对照模式"
                description="你正在带着当前会话的运行时上下文查看记忆库存；切换分区不会丢失这轮对照。"
                actions={
                  <button
                    type="button"
                    className={cn(BUTTON_CLASS_NAME, EMERALD_BUTTON_CLASS_NAME)}
                    onClick={() => navigateToMemorySection("home")}
                  >
                    返回总览预演
                  </button>
                }
              >
                <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                  <span>会话：{runtimeSessionId}</span>
                  <span>工作区：{runtimeWorkingDir}</span>
                  {runtimeUserMessage ? (
                    <span>本轮输入：{runtimeUserMessage}</span>
                  ) : null}
                </div>
                {runtimePrefetchState.result ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge
                      variant="outline"
                      className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
                    >
                      {formatRuntimeLayerStatusLabel(
                        "规则",
                        runtimePrefetchState.result.rules_source_paths.length,
                      )}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
                    >
                      {formatRuntimeLayerStatusLabel(
                        "工作",
                        null,
                        Boolean(
                          runtimePrefetchState.result.working_memory_excerpt,
                        ),
                      )}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
                    >
                      {formatRuntimeLayerStatusLabel(
                        "持久",
                        runtimePrefetchState.result.durable_memories.length,
                      )}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
                    >
                      {formatRuntimeLayerStatusLabel(
                        "Team",
                        runtimePrefetchState.result.team_memory_entries.length,
                      )}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
                    >
                      {formatRuntimeLayerStatusLabel(
                        "压缩",
                        null,
                        Boolean(runtimePrefetchState.result.latest_compaction),
                      )}
                    </Badge>
                  </div>
                ) : null}
              </MemorySurfacePanel>
            ) : null}

            {!loading && !error && activeSection === "home" ? (
              <>
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(300px,0.82fr)]">
                  <div className="space-y-5">
                    <MemorySurfacePanel title="先拿结果">
                      <div className="space-y-3">
                        {homeContinuationReferenceEntry ||
                        activeRecommendationReferenceEntries.length > 0 ? (
                          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5">
                            <div className="flex flex-wrap items-center gap-2">
                              {homeContinuationReferenceEntry ? (
                                <Badge
                                  variant="outline"
                                  className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
                                >
                                  当前续接成果
                                </Badge>
                              ) : null}
                              {activeRecommendationReferenceEntries.length > 0 ? (
                                <Badge
                                  variant="outline"
                                  className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
                                >
                                  {activeRecommendationReferenceEntries.length} 条参考对象
                                </Badge>
                              ) : null}
                            </div>
                            {homeContinuationReferenceEntry ? (
                              <p className="mt-2 text-sm font-medium text-slate-900">
                                {homeContinuationReferenceEntry.title}
                              </p>
                            ) : null}
                            {featuredMemoryReferenceSummary ? (
                              <p className="mt-1 text-xs leading-5 text-slate-600">
                                {featuredMemoryReferenceSummary}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {featuredMemoryCuratedTasks.length > 0 ? (
                          <div
                            className="grid gap-3 xl:grid-cols-2"
                            data-testid="memory-home-suggestion-panel"
                          >
                            {featuredMemoryCuratedTasks.map((featured) => {
                              const task = featured.template;
                              const description =
                                featured.reasonSummary || task.summary;

                              return (
                                <article
                                  key={task.id}
                                  data-testid={`memory-home-suggestion-panel-task-${task.id}`}
                                  className="flex h-full flex-col rounded-2xl border border-slate-200 bg-slate-50 p-4"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className="border-sky-200 bg-sky-50 text-sky-700"
                                    >
                                      {featured.badgeLabel}
                                    </Badge>
                                  </div>

                                  <div className="mt-3 min-w-0 flex-1">
                                    <h3 className="text-sm font-semibold text-slate-900">
                                      {task.title}
                                    </h3>
                                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">
                                      {description}
                                    </p>
                                  </div>

                                  <div className="mt-4 flex items-center justify-between gap-3">
                                    <p className="text-xs leading-5 text-slate-500">
                                      {task.summary}
                                    </p>
                                    <button
                                      type="button"
                                      className={cn(
                                        BUTTON_CLASS_NAME,
                                        EMERALD_BUTTON_CLASS_NAME,
                                      )}
                                      onClick={() => setMemoryLauncherTask(task)}
                                    >
                                      开始这一步
                                      <ArrowRight className="h-4 w-4" />
                                    </button>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 p-4">
                            <p className="text-sm leading-6 text-slate-500">
                              当前还没有足够灵感可直接推下一步。先收藏一条风格、参考或成果，再回来这里继续起手。
                            </p>
                          </div>
                        )}
                      </div>
                    </MemorySurfacePanel>

                    <MemorySurfacePanel title="最近灵感">
                      {featuredInspirationEntries.length > 0 ? (
                        <div className="space-y-2">
                          {featuredInspirationEntries.map((entry) => (
                            <article
                              key={entry.id}
                              className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5"
                            >
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className="border-emerald-200 bg-emerald-50 text-emerald-700"
                                    >
                                      {entry.projectionLabel}
                                    </Badge>
                                    <Badge
                                      variant="outline"
                                      className={SLATE_OUTLINE_BADGE_CLASS_NAME}
                                    >
                                      {entry.categoryLabel}
                                    </Badge>
                                    <span className="text-xs text-slate-400">
                                      {formatRelativeTime(entry.updatedAt)}
                                    </span>
                                  </div>
                                  <h3 className="mt-2 text-sm font-semibold text-slate-900">
                                    {entry.title}
                                  </h3>
                                  <p className="mt-1 line-clamp-1 text-sm text-slate-600">
                                    {entry.summary}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className={cn(
                                      BUTTON_CLASS_NAME,
                                      EMERALD_BUTTON_CLASS_NAME,
                                    )}
                                    onClick={() => {
                                      const sourceEntry = unifiedMemories.find(
                                        (memory) => memory.id === entry.id,
                                      );
                                      if (!sourceEntry) {
                                        return;
                                      }
                                      handleBringToCreation(sourceEntry);
                                    }}
                                  >
                                    带回输入
                                  </button>
                                  <button
                                    type="button"
                                    className={BUTTON_CLASS_NAME}
                                    onClick={() => {
                                      const sourceEntry = unifiedMemories.find(
                                        (memory) => memory.id === entry.id,
                                      );
                                      if (!sourceEntry) {
                                        return;
                                      }
                                      handleOpenInScene(sourceEntry);
                                    }}
                                  >
                                    去 Skills
                                  </button>
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 p-4">
                          <p className="text-sm leading-6 text-slate-500">
                            当前还没有正式沉淀下来的灵感对象。先在对话结果里收藏一条参考、风格或成果，再回到这里继续复用。
                          </p>
                        </div>
                      )}
                    </MemorySurfacePanel>
                  </div>

                  <div className="space-y-5">
                    <MemorySurfacePanel title="灵感概览">
                      <div
                        className="space-y-2"
                        data-testid="memory-home-default-overview"
                      >
                        {homeOverviewCards.map((card) => (
                          <button
                            key={card.key}
                            type="button"
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-300 hover:bg-white"
                            onClick={card.onClick}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900">
                                  {card.title}
                                </p>
                                <p className="mt-1 line-clamp-1 text-sm text-slate-500">
                                  {card.detail}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="text-lg font-semibold text-slate-950">
                                  {card.value}
                                </p>
                                <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                                  查看
                                  <ArrowRight className="h-3.5 w-3.5" />
                                </span>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </MemorySurfacePanel>

                    <MemorySurfacePanel title="风格摘要">
                      <p className="text-sm leading-6 text-slate-600">
                        {tasteSummary.summary}
                      </p>
                      <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-1">
                        <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-sm font-semibold text-slate-900">
                            像这样写
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {tasteSummary.styleKeywords.length > 0 ? (
                              tasteSummary.styleKeywords.map((keyword) => (
                                <Badge
                                  key={keyword}
                                  variant="outline"
                                  className="border-emerald-200 bg-emerald-50 text-emerald-700"
                                >
                                  {keyword}
                                </Badge>
                              ))
                            ) : (
                              <p className="text-sm leading-6 text-slate-500">
                                还没有提炼出明确的风格关键词。
                              </p>
                            )}
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-sm font-semibold text-slate-900">
                            常用参考
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {tasteSummary.referenceKeywords.length > 0 ? (
                              tasteSummary.referenceKeywords.map((keyword) => (
                                <Badge
                                  key={keyword}
                                  variant="outline"
                                  className={SLATE_OUTLINE_BADGE_CLASS_NAME}
                                >
                                  {keyword}
                                </Badge>
                              ))
                            ) : (
                              <p className="text-sm leading-6 text-slate-500">
                                还没有整理出短标签。
                              </p>
                            )}
                          </div>
                        </article>

                        <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-sm font-semibold text-slate-900">
                            先避开
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {tasteSummary.avoidKeywords.length > 0 ? (
                              tasteSummary.avoidKeywords.map((keyword) => (
                                <Badge
                                  key={keyword}
                                  variant="outline"
                                  className="border-amber-200 bg-amber-50 text-amber-700"
                                >
                                  {keyword}
                                </Badge>
                              ))
                            ) : (
                              <p className="text-sm leading-6 text-slate-500">
                                当前还没有明显避让词。
                              </p>
                            )}
                          </div>
                        </article>
                      </div>
                    </MemorySurfacePanel>
                  </div>
                </div>

                {hasRuntimeContext ? (
                  <MemorySurfacePanel
                    title="当前运行时预演"
                    description="这份预演复用了当前会话的运行时预取结果，便于把库存和本轮真实命中对上。"
                    actions={runtimeDrilldownActions}
                  >
                    <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                      <span>会话：{runtimeSessionId}</span>
                      <span>工作区：{runtimeWorkingDir}</span>
                      <span>
                        团队记忆：
                        {runtimeTeamSnapshot
                          ? runtimeTeamSnapshot.repoScope
                          : "未命中本地快照"}
                      </span>
                    </div>
                    <AgentThreadMemoryPrefetchPreview
                      className="mt-4"
                      status={runtimePrefetchState.status}
                      result={runtimePrefetchState.result}
                      error={runtimePrefetchState.error}
                    />
                  </MemorySurfacePanel>
                ) : null}

                {hasRuntimeContext &&
                currentRuntimeHistoryEntry &&
                runtimeComparisonBaselineEntry &&
                runtimeComparisonDiff ? (
                  <MemorySurfacePanel
                    title="当前预演 vs 历史基线"
                    description="把当前这次真实预演和历史里的一次命中正面对照，便于判断这轮是补强了还是退化了。"
                    actions={
                      <button
                        type="button"
                        className={cn(
                          BUTTON_CLASS_NAME,
                          "border-slate-300 text-slate-700",
                        )}
                        onClick={() =>
                          setRuntimeComparisonBaselineSignature(null)
                        }
                      >
                        改用最近基线
                      </button>
                    }
                  >
                    <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                      <span>
                        当前会话：{currentRuntimeHistoryEntry.sessionId}
                      </span>
                      <span>
                        基线时间：
                        {formatRelativeTime(
                          runtimeComparisonBaselineEntry.capturedAt,
                        )}
                      </span>
                      <span>
                        基线来源：
                        {resolveRuntimeHistorySourceLabel(
                          runtimeComparisonBaselineEntry.source,
                        )}
                      </span>
                    </div>
                    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <p className="text-sm font-medium text-slate-900">
                        基线摘要
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {resolveRuntimeHistorySummary(
                          runtimeComparisonBaselineEntry,
                        )}
                      </p>
                      {runtimeComparisonBaselineEntry.userMessage ? (
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          基线输入：{runtimeComparisonBaselineEntry.userMessage}
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-xs font-medium text-slate-500">
                          相对基线判断
                        </div>
                        {runtimeComparisonAssessment ? (
                          <Badge
                            variant="outline"
                            className={resolveRuntimeComparisonAssessmentBadgeClassName(
                              runtimeComparisonAssessment,
                            )}
                          >
                            {formatRuntimeMemoryPrefetchHistoryDiffStatusLabel(
                              runtimeComparisonAssessment.status,
                            )}
                          </Badge>
                        ) : null}
                      </div>
                      {runtimeComparisonAssessment ? (
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {describeRuntimeMemoryPrefetchHistoryDiffAssessment(
                            runtimeComparisonAssessment,
                          )}
                        </p>
                      ) : null}
                      {runtimeComparisonDiff.changed ? (
                        <>
                          <div className="mt-3 text-xs font-medium text-slate-500">
                            具体变化
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {runtimeComparisonDiff.layerChanges.rulesDelta !==
                            0 ? (
                              <Badge
                                variant="outline"
                                className={EMERALD_BADGE_CLASS_NAME}
                              >
                                规则{" "}
                                {runtimeComparisonDiff.layerChanges.rulesDelta >
                                0
                                  ? "+"
                                  : ""}
                                {runtimeComparisonDiff.layerChanges.rulesDelta}
                              </Badge>
                            ) : null}
                            {runtimeComparisonDiff.layerChanges
                              .workingChanged !== "same" ? (
                              <Badge
                                variant="outline"
                                className={EMERALD_BADGE_CLASS_NAME}
                              >
                                工作
                                {runtimeComparisonDiff.layerChanges
                                  .workingChanged === "added"
                                  ? " 新命中"
                                  : " 取消命中"}
                              </Badge>
                            ) : null}
                            {runtimeComparisonDiff.layerChanges.durableDelta !==
                            0 ? (
                              <Badge
                                variant="outline"
                                className={EMERALD_BADGE_CLASS_NAME}
                              >
                                持久{" "}
                                {runtimeComparisonDiff.layerChanges
                                  .durableDelta > 0
                                  ? "+"
                                  : ""}
                                {
                                  runtimeComparisonDiff.layerChanges
                                    .durableDelta
                                }
                              </Badge>
                            ) : null}
                            {runtimeComparisonDiff.layerChanges.teamDelta !==
                            0 ? (
                              <Badge
                                variant="outline"
                                className={EMERALD_BADGE_CLASS_NAME}
                              >
                                Team{" "}
                                {runtimeComparisonDiff.layerChanges.teamDelta >
                                0
                                  ? "+"
                                  : ""}
                                {runtimeComparisonDiff.layerChanges.teamDelta}
                              </Badge>
                            ) : null}
                            {runtimeComparisonDiff.layerChanges
                              .compactionChanged !== "same" ? (
                              <Badge
                                variant="outline"
                                className={EMERALD_BADGE_CLASS_NAME}
                              >
                                压缩
                                {runtimeComparisonDiff.layerChanges
                                  .compactionChanged === "added"
                                  ? " 新命中"
                                  : " 取消命中"}
                              </Badge>
                            ) : null}
                          </div>
                          {runtimeComparisonDiff.previewChanges.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {runtimeComparisonDiff.previewChanges
                                .slice(0, 4)
                                .map((change, changeIndex) => (
                                  <p
                                    key={`${change.key}:${changeIndex}`}
                                    className="text-sm leading-6 text-slate-600"
                                  >
                                    {resolveRuntimeHistoryPreviewChangeLabel(
                                      change,
                                    )}
                                  </p>
                                ))}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          当前预演与这条基线相比没有明显变化。
                        </p>
                      )}
                    </div>
                  </MemorySurfacePanel>
                ) : null}

                {hasRuntimeContext ? (
                  <MemorySurfacePanel
                    title="最近命中记录"
                    description="只在当前会话对照时显示。"
                    actions={
                      <div className="flex flex-wrap justify-end gap-2">
                        {RUNTIME_HISTORY_SCOPE_META.map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            className={cn(
                              BUTTON_CLASS_NAME,
                              runtimeHistoryScope === item.key &&
                                ACTIVE_BUTTON_CLASS_NAME,
                            )}
                            onClick={() => setRuntimeHistoryScope(item.key)}
                          >
                            {item.label}
                          </button>
                        ))}
                        {runtimePrefetchHistory.length > 0 ? (
                            <button
                              type="button"
                              className={cn(
                                BUTTON_CLASS_NAME,
                                "border-amber-200 text-amber-700",
                              )}
                              onClick={handleClearRuntimeHistory}
                            >
                              清空历史
                            </button>
                        ) : null}
                      </div>
                    }
                  >
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                        <span>
                          当前范围：{activeRuntimeHistoryScopeMeta.label}
                        </span>
                        <span>
                          命中记录：{runtimeHistorySummary.totalEntries}
                        </span>
                        <span>会话：{runtimeHistorySummary.uniqueSessions}</span>
                        <span>
                          工作区：{runtimeHistorySummary.uniqueWorkingDirs}
                        </span>
                      </div>
                      {runtimeHistorySummary.totalEntries > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          <Badge
                            variant="outline"
                            className="border-slate-200 bg-white text-slate-700"
                          >
                            规则层 {runtimeHistorySummary.layerEntryHits.rules}/
                            {runtimeHistorySummary.totalEntries}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="border-slate-200 bg-white text-slate-700"
                          >
                            工作层 {runtimeHistorySummary.layerEntryHits.working}/
                            {runtimeHistorySummary.totalEntries}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="border-slate-200 bg-white text-slate-700"
                          >
                            持久层 {runtimeHistorySummary.layerEntryHits.durable}/
                            {runtimeHistorySummary.totalEntries}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="border-slate-200 bg-white text-slate-700"
                          >
                            团队层 {runtimeHistorySummary.layerEntryHits.team}/
                            {runtimeHistorySummary.totalEntries}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="border-slate-200 bg-white text-slate-700"
                          >
                            压缩层{" "}
                            {runtimeHistorySummary.layerEntryHits.compaction}/
                            {runtimeHistorySummary.totalEntries}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="border-slate-200 bg-white text-slate-700"
                          >
                            发生变化 {runtimeHistorySummary.changedEntries} 次
                          </Badge>
                        </div>
                      ) : null}
                      {runtimeHistorySummary.totalEntries > 0 ? (
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                        {runtimeHistorySummary.layerStability.map((layer) => {
                          const presentation =
                            resolveRuntimeLayerStabilityPresentation(
                              layer,
                              runtimeHistorySummary.totalEntries,
                            );
                          return (
                            <article
                              key={layer.key}
                              className={cn(
                                "rounded-3xl border p-4",
                                presentation.className,
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">
                                    {RUNTIME_HISTORY_LAYER_LABELS[layer.key]}
                                  </p>
                                  <p className="mt-2 text-xs text-slate-500">
                                    {formatRuntimeLayerLatestValue(layer)}
                                  </p>
                                </div>
                                <Badge
                                  variant="outline"
                                  className={presentation.badgeClassName}
                                >
                                  {presentation.title}
                                </Badge>
                              </div>
                              <p className="mt-3 text-sm leading-6 text-slate-600">
                                {presentation.description}
                              </p>
                            </article>
                          );
                        })}
                      </div>
                      ) : null}
                      {displayedRuntimePrefetchHistory.length > 0 ? (
                      displayedRuntimePrefetchHistory.map((entry, index) => {
                        const previousEntry =
                          filteredRuntimePrefetchHistory[index + 1];
                        const diff = previousEntry
                          ? compareRuntimeMemoryPrefetchHistoryEntries(
                              entry,
                              previousEntry,
                            )
                          : null;
                        const diffAssessment = diff
                          ? assessRuntimeMemoryPrefetchHistoryDiff(diff)
                          : null;

                        return (
                          <article
                            key={`${entry.signature}:${entry.capturedAt}`}
                            className={cn(
                              "rounded-3xl border p-4 transition",
                              isRuntimeHistoryEntryActive(entry)
                                ? "border-emerald-200 bg-emerald-50/60"
                                : "border-slate-200 bg-slate-50/70",
                            )}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-slate-900">
                                    {entry.sessionId}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className="border-slate-200 bg-white text-slate-700"
                                  >
                                    {resolveRuntimeHistorySourceLabel(
                                      entry.source,
                                    )}
                                  </Badge>
                                  {isRuntimeHistoryEntryActive(entry) ? (
                                    <Badge
                                      variant="outline"
                                      className={
                                        EMERALD_OUTLINE_BADGE_CLASS_NAME
                                      }
                                    >
                                      当前对照
                                    </Badge>
                                  ) : null}
                                  {!isRuntimeHistoryEntryActive(entry) &&
                                  runtimeComparisonBaselineEntry?.signature ===
                                    entry.signature ? (
                                    <Badge
                                      variant="outline"
                                      className={SLATE_OUTLINE_BADGE_CLASS_NAME}
                                    >
                                      对照基线
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="mt-2 text-sm leading-6 text-slate-500">
                                  {entry.workingDir}
                                </p>
                                {entry.userMessage ? (
                                  <p className="mt-2 text-sm leading-6 text-slate-700">
                                    {entry.userMessage}
                                  </p>
                                ) : null}
                                <p className="mt-2 text-sm leading-6 text-slate-600">
                                  {resolveRuntimeHistorySummary(entry)}
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Badge
                                    variant="outline"
                                    className="border-slate-200 bg-white text-slate-700"
                                  >
                                    {formatRuntimeLayerStatusLabel(
                                      "规则",
                                      entry.counts.rules,
                                    )}
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className="border-slate-200 bg-white text-slate-700"
                                  >
                                    {formatRuntimeLayerStatusLabel(
                                      "工作",
                                      null,
                                      entry.counts.working,
                                    )}
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className="border-slate-200 bg-white text-slate-700"
                                  >
                                    {formatRuntimeLayerStatusLabel(
                                      "持久",
                                      entry.counts.durable,
                                    )}
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className="border-slate-200 bg-white text-slate-700"
                                  >
                                    {formatRuntimeLayerStatusLabel(
                                      "Team",
                                      entry.counts.team,
                                    )}
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className="border-slate-200 bg-white text-slate-700"
                                  >
                                    {formatRuntimeLayerStatusLabel(
                                      "压缩",
                                      null,
                                      entry.counts.compaction,
                                    )}
                                  </Badge>
                                </div>

                                {diff ? (
                                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <div className="text-xs font-medium text-slate-500">
                                        较上一条判断
                                      </div>
                                      {diffAssessment ? (
                                        <Badge
                                          variant="outline"
                                          className={resolveRuntimeComparisonAssessmentBadgeClassName(
                                            diffAssessment,
                                          )}
                                        >
                                          {formatRuntimeMemoryPrefetchHistoryDiffStatusLabel(
                                            diffAssessment.status,
                                          )}
                                        </Badge>
                                      ) : null}
                                    </div>
                                    {diffAssessment ? (
                                      <p className="mt-2 text-sm leading-6 text-slate-600">
                                        {describeRuntimeMemoryPrefetchHistoryDiffAssessment(
                                          diffAssessment,
                                        )}
                                      </p>
                                    ) : null}
                                    {diff.changed ? (
                                      <>
                                        <div className="mt-3 text-xs font-medium text-slate-500">
                                          具体变化
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {diff.layerChanges.rulesDelta !==
                                          0 ? (
                                            <Badge
                                              variant="outline"
                                              className={
                                                EMERALD_BADGE_CLASS_NAME
                                              }
                                            >
                                              规则{" "}
                                              {diff.layerChanges.rulesDelta > 0
                                                ? "+"
                                                : ""}
                                              {diff.layerChanges.rulesDelta}
                                            </Badge>
                                          ) : null}
                                          {diff.layerChanges.workingChanged !==
                                          "same" ? (
                                            <Badge
                                              variant="outline"
                                              className={
                                                EMERALD_BADGE_CLASS_NAME
                                              }
                                            >
                                              工作
                                              {diff.layerChanges
                                                .workingChanged === "added"
                                                ? " 新命中"
                                                : " 取消命中"}
                                            </Badge>
                                          ) : null}
                                          {diff.layerChanges.durableDelta !==
                                          0 ? (
                                            <Badge
                                              variant="outline"
                                              className={
                                                EMERALD_BADGE_CLASS_NAME
                                              }
                                            >
                                              持久{" "}
                                              {diff.layerChanges.durableDelta >
                                              0
                                                ? "+"
                                                : ""}
                                              {diff.layerChanges.durableDelta}
                                            </Badge>
                                          ) : null}
                                          {diff.layerChanges.teamDelta !== 0 ? (
                                            <Badge
                                              variant="outline"
                                              className={
                                                EMERALD_BADGE_CLASS_NAME
                                              }
                                            >
                                              Team{" "}
                                              {diff.layerChanges.teamDelta > 0
                                                ? "+"
                                                : ""}
                                              {diff.layerChanges.teamDelta}
                                            </Badge>
                                          ) : null}
                                          {diff.layerChanges
                                            .compactionChanged !== "same" ? (
                                            <Badge
                                              variant="outline"
                                              className={
                                                EMERALD_BADGE_CLASS_NAME
                                              }
                                            >
                                              压缩
                                              {diff.layerChanges
                                                .compactionChanged === "added"
                                                ? " 新命中"
                                                : " 取消命中"}
                                            </Badge>
                                          ) : null}
                                        </div>
                                        {diff.previewChanges.length > 0 ? (
                                          <div className="mt-3 space-y-2">
                                            {diff.previewChanges
                                              .slice(0, 2)
                                              .map((change, changeIndex) => (
                                                <p
                                                  key={`${change.key}:${changeIndex}`}
                                                  className="text-sm leading-6 text-slate-600"
                                                >
                                                  {resolveRuntimeHistoryPreviewChangeLabel(
                                                    change,
                                                  )}
                                                </p>
                                              ))}
                                          </div>
                                        ) : null}
                                      </>
                                    ) : (
                                      <p className="mt-2 text-sm leading-6 text-slate-500">
                                        和上一条相比没有明显变化。
                                      </p>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                <span className="text-xs text-slate-400">
                                  {formatRelativeTime(entry.capturedAt)}
                                </span>
                                {!isRuntimeHistoryEntryActive(entry) ? (
                                  <button
                                    type="button"
                                    className={cn(
                                      BUTTON_CLASS_NAME,
                                      runtimeComparisonBaselineEntry?.signature ===
                                        entry.signature
                                        ? "border-slate-300 bg-slate-100 text-slate-700"
                                        : "border-slate-200 text-slate-700",
                                    )}
                                    onClick={() =>
                                      setRuntimeComparisonBaselineSignature(
                                        entry.signature,
                                      )
                                    }
                                  >
                                    {runtimeComparisonBaselineEntry?.signature ===
                                    entry.signature
                                      ? "当前基线"
                                      : "设为对照基线"}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className={cn(
                                    BUTTON_CLASS_NAME,
                                    EMERALD_BUTTON_CLASS_NAME,
                                  )}
                                  onClick={() =>
                                    handleOpenRuntimeHistoryEntry(entry)
                                  }
                                >
                                  切换到这次对照
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })
                      ) : (
                        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 p-4">
                          <p className="text-sm leading-6 text-slate-500">
                            {runtimePrefetchHistory.length > 0 &&
                            runtimeHistoryScope !== "all"
                              ? "当前筛选范围还没有命中历史，可以切到“全部”查看最近记录。"
                              : "当前还没有运行时命中历史。先在对话工作台触发几轮记忆预演，这里会自动沉淀最近记录。"}
                          </p>
                        </div>
                      )}
                    </div>
                  </MemorySurfacePanel>
                ) : null}
              </>
            ) : null}

            {!loading && !error && activeSection === "rules" ? (
              <>
                <MemorySurfacePanel
                  title="底层记忆来源与 memdir"
                  description="这里是支撑灵感库与风格层的底层事实源，优先看作用域、入口和当前命中状态。"
                  actions={
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className={cn(
                          BUTTON_CLASS_NAME,
                          EMERALD_BUTTON_CLASS_NAME,
                          !memdirWorkingDir || memdirActionType !== null
                            ? "cursor-not-allowed opacity-60"
                            : "",
                        )}
                        disabled={
                          !memdirWorkingDir || memdirActionType !== null
                        }
                        onClick={() => void handleScaffoldMemdir()}
                      >
                        {memdirActionType === "scaffold"
                          ? "初始化中..."
                          : "初始化 memdir"}
                      </button>
                      <button
                        type="button"
                        className={cn(
                          BUTTON_CLASS_NAME,
                          EMERALD_BUTTON_CLASS_NAME,
                          !memdirWorkingDir || memdirActionType !== null
                            ? "cursor-not-allowed opacity-60"
                            : "",
                        )}
                        disabled={
                          !memdirWorkingDir || memdirActionType !== null
                        }
                        onClick={() => void handleCleanupMemdir()}
                      >
                        {memdirActionType === "cleanup"
                          ? "整理中..."
                          : "整理 memdir"}
                      </button>
                    </div>
                  }
                >
                  <div className="mb-4 rounded-3xl border border-emerald-200 bg-emerald-50/80 p-4">
                    <p className="text-sm font-medium text-emerald-900">
                      同一 topic 会覆盖旧内容；“整理 memdir”
                      会去重入口链接、裁剪 README 历史段落，并把旧 topic
                      日志收口为当前版本。
                    </p>
                    <p className="mt-2 text-sm leading-6 text-emerald-800/90">
                      {memdirWorkingDir
                        ? `当前工作区：${memdirWorkingDir}`
                        : "当前未获取到 workspace 路径，暂无法执行 memdir 治理动作。"}
                    </p>
                  </div>
                  {memdirActionNotice ? (
                    <div
                      className={cn(
                        "mb-4 rounded-3xl border px-4 py-3 text-sm",
                        memdirActionNotice.tone === "success"
                          ? "border-emerald-200 bg-emerald-50/80 text-emerald-900"
                          : "border-rose-200 bg-rose-50/80 text-rose-700",
                      )}
                    >
                      {memdirActionNotice.message}
                    </div>
                  ) : null}
                  <div className="grid gap-4 xl:grid-cols-2">
                    {sourceBuckets.map((bucket) => {
                      const badge = getMemoryAvailabilityBadge(
                        bucket.key === "auto" &&
                          autoIndex?.enabled &&
                          bucket.status === "missing"
                          ? "exists"
                          : bucket.status,
                      );
                      const detail =
                        bucket.key === "auto"
                          ? autoIndex?.root_dir ||
                            bucket.primaryPath ||
                            bucket.emptyState
                          : bucket.primaryPath || bucket.emptyState;
                      const helper =
                        bucket.key === "auto"
                          ? `入口文件：${autoIndex?.entrypoint || "MEMORY.md"} · 已索引 ${autoIndex?.items.length || 0} 个条目`
                          : bucket.status === "loaded"
                            ? `已加载 ${bucket.loadedCount} 条来源`
                            : bucket.status === "exists"
                              ? `已发现 ${bucket.existsCount} 条来源，但当前未注入`
                              : bucket.emptyState;
                      return (
                        <article
                          key={bucket.key}
                          className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {bucket.label}
                              </p>
                              <p className="mt-2 text-sm leading-6 text-slate-500">
                                {bucket.description}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={badge.className}
                            >
                              {badge.label}
                            </Badge>
                          </div>
                          <p className="mt-4 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                            {bucket.scope}
                          </p>
                          <p className="mt-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                            {detail}
                          </p>
                          <p className="mt-3 text-sm leading-6 text-slate-500">
                            {helper}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge
                              variant="outline"
                              className={SLATE_OUTLINE_BADGE_CLASS_NAME}
                            >
                              来源分类：{bucket.label}
                            </Badge>
                            {bucket.provider ? (
                              <Badge
                                variant="outline"
                                className={SLATE_OUTLINE_BADGE_CLASS_NAME}
                              >
                                provider：{bucket.provider}
                              </Badge>
                            ) : null}
                            {bucket.latestUpdatedAt ? (
                              <Badge
                                variant="outline"
                                className={SLATE_OUTLINE_BADGE_CLASS_NAME}
                              >
                                最近更新：
                                {formatRelativeTime(bucket.latestUpdatedAt)}
                              </Badge>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </MemorySurfacePanel>

                <MemorySurfacePanel
                  title="当前命中来源明细"
                  description="下面是运行时实际解析到的来源明细。Lime 底层已经支持托管策略、用户/项目/本地记忆、规则目录、memdir 与 /memories 等来源。"
                >
                  <div className="space-y-3">
                    {rulesSources?.sources.map((source) => (
                      <article
                        key={`${source.kind}:${source.path}`}
                        className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="rounded-full bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white">
                            {resolveSourceKindLabel(source.kind)}
                          </span>
                          <Badge
                            variant="outline"
                            className={SLATE_OUTLINE_BADGE_CLASS_NAME}
                          >
                            {resolveSourceBucketLabel(source.source_bucket)}
                          </Badge>
                          {source.provider ? (
                            <Badge
                              variant="outline"
                              className={SLATE_OUTLINE_BADGE_CLASS_NAME}
                            >
                              provider：{source.provider}
                            </Badge>
                          ) : null}
                          {source.memory_type ? (
                            <Badge
                              variant="outline"
                              className={
                                MEMORY_TYPE_BADGE_CLASS_NAMES[
                                  source.memory_type
                                ]
                              }
                            >
                              {MEMORY_TYPE_LABELS[source.memory_type]}
                            </Badge>
                          ) : null}
                          <span className="font-medium text-slate-900">
                            {source.path}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          {source.loaded
                            ? "已加载"
                            : source.exists
                              ? "已发现但当前未加载"
                              : "文件不存在"}
                          ，共 {source.line_count} 行，导入{" "}
                          {source.import_count} 个。
                          {source.updated_at
                            ? ` 最近更新于 ${formatRelativeTime(source.updated_at)}。`
                            : ""}
                        </p>
                        {source.preview ? (
                          <pre className="mt-3 overflow-x-auto rounded-2xl border border-sky-100 bg-[image:var(--lime-card-subtle)] p-3 text-xs leading-6 text-slate-700 shadow-sm shadow-sky-950/5">
                            {source.preview}
                          </pre>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </MemorySurfacePanel>
              </>
            ) : null}

            {!loading && !error && activeSection === "working" ? (
              <>
                <MemorySurfacePanel
                  title="会话工作记忆"
                  description={
                    extractionStatus?.status_summary ||
                    "这里查看 session 级的 task plan、摘录和工作文件；它们服务当前回合，不直接等同于灵感库长期对象。"
                  }
                >
                  <div className="space-y-4">
                    {workingView?.sessions.length ? (
                      workingView.sessions.map((session) => (
                        <article
                          key={session.session_id}
                          className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {session.session_id}
                              </p>
                              <p className="mt-1 text-sm text-slate-500">
                                {session.total_entries} 条会话记忆，更新于{" "}
                                {formatRelativeTime(session.updated_at)}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            {session.files.map((file) => (
                              <div
                                key={`${session.session_id}:${file.file_type}`}
                                className="rounded-2xl border border-slate-200 bg-white p-3"
                              >
                                <p className="text-sm font-medium text-slate-900">
                                  {file.file_type}
                                </p>
                                <p className="mt-1 text-xs leading-5 text-slate-500">
                                  {file.path}
                                </p>
                                <p className="mt-2 text-sm leading-6 text-slate-500">
                                  {file.summary}
                                </p>
                              </div>
                            ))}
                          </div>
                        </article>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">
                        当前还没有检测到会话记忆文件。
                      </p>
                    )}
                  </div>
                </MemorySurfacePanel>
              </>
            ) : null}

            {!loading && !error && activeSection === "durable" ? (
              <>
                {focusedDurableMemory ? (
                  <MemorySurfacePanel
                    title="围绕这条成果继续"
                    description="这轮结果已经进了灵感库，下一步先从这里接着做，不用重新回首页找入口。"
                  >
                    <MemoryCuratedTaskSuggestionPanel
                      panelTestId="memory-focused-suggestion-panel"
                      tasks={focusedMemoryCuratedTasks}
                      referenceEntryCount={
                        activeRecommendationReferenceEntries.length
                      }
                      referenceSummary={featuredMemoryReferenceSummary}
                      gridClassName="grid gap-4 xl:grid-cols-2"
                      contextCard={{
                        badgeLabel: "当前续接成果",
                        title: focusedDurableMemory.title,
                        summary: focusedDurableMemory.summary,
                      }}
                      emptyState="当前这条成果还没有编出更合适的下一步，先补一条参考或偏好再继续。"
                      onStartTask={setMemoryLauncherTask}
                    />
                  </MemorySurfacePanel>
                ) : null}

                <MemorySurfacePanel
                  title="灵感条目"
                  description="左侧挑一条，右侧直接继续。"
                  actions={
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={cn(
                          BUTTON_CLASS_NAME,
                          durableFilter === "all" && ACTIVE_BUTTON_CLASS_NAME,
                        )}
                        onClick={() => navigateToMemorySection("durable")}
                      >
                        全部
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                          {durableCategoryCounts.all}
                        </span>
                      </button>
                      {(Object.keys(CATEGORY_LABELS) as MemoryCategory[]).map(
                        (category) => (
                          <button
                            key={category}
                            type="button"
                            className={cn(
                              BUTTON_CLASS_NAME,
                              durableFilter === category &&
                                ACTIVE_BUTTON_CLASS_NAME,
                            )}
                            onClick={() => navigateToMemorySection(category)}
                          >
                            {CATEGORY_LABELS[category]}
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                              {durableCategoryCounts[category]}
                            </span>
                          </button>
                        ),
                      )}
                    </div>
                  }
                >
                  {filteredMemories.length ? (
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(320px,0.88fr)]">
                      <div className="space-y-2">
                        {filteredMemories.map((memory) => {
                          const isFocused = focusedDurableMemory?.id === memory.id;
                          const isSelected =
                            selectedDurableMemory?.id === memory.id;

                          return (
                            <button
                              key={memory.id}
                              type="button"
                              ref={(element) => {
                                durableEntryRefs.current[memory.id] = element;
                              }}
                              data-memory-entry-id={memory.id}
                              data-testid={`memory-durable-entry-${memory.id}`}
                              className={cn(
                                "block w-full rounded-2xl border bg-white p-4 text-left transition hover:border-slate-300 hover:bg-slate-50",
                                isFocused
                                  ? "border-emerald-300 bg-emerald-50/80 shadow-sm shadow-emerald-950/5"
                                  : isSelected
                                    ? "border-slate-300 bg-slate-50 shadow-sm shadow-slate-950/5"
                                    : "border-slate-200",
                              )}
                              onClick={() => handleSelectDurableMemory(memory.id)}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className={
                                        MEMORY_TYPE_BADGE_CLASS_NAMES[
                                          resolveMemoryType(memory.category)
                                        ]
                                      }
                                    >
                                      {CATEGORY_LABELS[memory.category]}
                                    </Badge>
                                    {isFocused ? (
                                      <Badge
                                        variant="outline"
                                        className={EMERALD_BADGE_CLASS_NAME}
                                      >
                                        当前续接
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <h3 className="mt-2 truncate text-sm font-semibold text-slate-900">
                                    {memory.title}
                                  </h3>
                                  <p className="mt-1 line-clamp-1 text-sm text-slate-500">
                                    {memory.summary}
                                  </p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="text-xs text-slate-400">
                                    {formatRelativeTime(memory.updated_at)}
                                  </p>
                                  <span className="mt-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                                    <ArrowRight className="h-3.5 w-3.5" />
                                  </span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {selectedDurableMemory ? (
                        <article className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm shadow-slate-950/5">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
                            >
                              {selectedDurableProjection?.projectionLabel ||
                                "灵感对象"}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={SLATE_OUTLINE_BADGE_CLASS_NAME}
                            >
                              {resolveMemorySourceLabel(selectedDurableMemory)}
                            </Badge>
                            {focusedDurableMemory?.id ===
                            selectedDurableMemory.id ? (
                              <Badge
                                variant="outline"
                                className={EMERALD_BADGE_CLASS_NAME}
                              >
                                当前续接
                              </Badge>
                            ) : null}
                          </div>

                          <div className="mt-4">
                            <h3 className="text-xl font-semibold text-slate-900">
                              {selectedDurableMemory.title}
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-slate-600">
                              {selectedDurableMemory.summary}
                            </p>
                          </div>

                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-3">
                              <p className="text-xs font-medium text-slate-400">
                                分类
                              </p>
                              <p className="mt-1 text-sm font-medium text-slate-900">
                                {CATEGORY_LABELS[selectedDurableMemory.category]}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-3">
                              <p className="text-xs font-medium text-slate-400">
                                更新时间
                              </p>
                              <p className="mt-1 text-sm font-medium text-slate-900">
                                {formatRelativeTime(
                                  selectedDurableMemory.updated_at,
                                )}
                              </p>
                            </div>
                          </div>

                          {selectedDurablePreviewLines.length > 0 ? (
                            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                              <p className="text-xs font-medium text-slate-400">
                                预览
                              </p>
                              <div className="mt-2 space-y-2">
                                {selectedDurablePreviewLines.map((line) => (
                                  <p
                                    key={line}
                                    className="text-sm leading-6 text-slate-600"
                                  >
                                    {line}
                                  </p>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {selectedDurableProjection?.tags.length ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {selectedDurableProjection.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : null}

                          <div className="mt-5 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={cn(
                                BUTTON_CLASS_NAME,
                                EMERALD_BUTTON_CLASS_NAME,
                              )}
                              onClick={() =>
                                handleBringToCreation(selectedDurableMemory)
                              }
                            >
                              带回创作输入
                            </button>
                            <button
                              type="button"
                              className={BUTTON_CLASS_NAME}
                              onClick={() =>
                                handleOpenInScene(selectedDurableMemory)
                              }
                            >
                              去全部 Skills
                            </button>
                          </div>
                        </article>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      当前筛选下还没有可复用的灵感条目。
                    </p>
                  )}
                </MemorySurfacePanel>
              </>
            ) : null}

            {!loading && !error && activeSection === "team" ? (
              <MemorySurfacePanel
                title="团队影子快照"
                description="这里展示本地 localStorage 中保存的 repo-scoped 团队影子，便于核对最近一次团队分工。"
              >
                <div className="space-y-4">
                  {teamSnapshots.length ? (
                    teamSnapshots.map((snapshot) => (
                      <article
                        key={snapshot.repoScope}
                        className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
                      >
                        <p className="text-sm font-semibold text-slate-900">
                          {snapshot.repoScope}
                        </p>
                        <div className="mt-3 space-y-2">
                          {Object.values(snapshot.entries).map((entry) => (
                            <div
                              key={entry.key}
                              className="rounded-2xl border border-slate-200 bg-white p-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-sm font-medium text-slate-900">
                                  {entry.key}
                                </span>
                                <span className="text-xs text-slate-400">
                                  {formatRelativeTime(entry.updatedAt)}
                                </span>
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-500">
                                {entry.content}
                              </p>
                            </div>
                          ))}
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">
                      当前没有本地团队记忆快照。
                    </p>
                  )}
                </div>
              </MemorySurfacePanel>
            ) : null}

            {!loading && !error && activeSection === "compaction" ? (
              <MemorySurfacePanel
                title="压缩摘要"
                description="这些摘要来自 Aster summary cache，用于在长会话中续接更早的历史。"
              >
                <div className="space-y-4">
                  {extractionStatus?.recent_compactions.length ? (
                    extractionStatus.recent_compactions.map((snapshot) => (
                      <article
                        key={`${snapshot.session_id}:${snapshot.created_at}`}
                        className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {snapshot.session_id}
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              turns={snapshot.turn_count || 0} /{" "}
                              {formatRelativeTime(snapshot.created_at)}
                            </p>
                          </div>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-slate-600">
                          {snapshot.summary_preview}
                        </p>
                      </article>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">
                      当前还没有上下文压缩摘要。
                    </p>
                  )}
                </div>
              </MemorySurfacePanel>
            ) : null}
        </main>
      </div>

      <CuratedTaskLauncherDialog
        open={Boolean(memoryLauncherTask)}
        task={memoryLauncherTask}
        projectId={projectId}
        sessionId={runtimeSessionId || undefined}
        initialInputValues={effectiveMemoryLauncherInputValues}
        initialReferenceMemoryIds={memoryLauncherReferenceMemoryIds}
        initialReferenceEntries={memoryLauncherReferenceEntries}
        prefillHint={effectiveMemoryLauncherPrefillHint}
        onOpenChange={handleMemoryLauncherOpenChange}
        onApplyReviewSuggestion={handleApplyMemoryLauncherReviewSuggestion}
        onConfirm={handleMemoryCuratedTaskConfirm}
      />
    </div>
  );
}
