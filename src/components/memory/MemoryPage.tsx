import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  BrainCircuit,
  Database,
  FolderKanban,
  GitBranch,
  ScrollText,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import {
  getContextMemoryAutoIndex,
  getContextMemoryEffectiveSources,
  getContextMemoryExtractionStatus,
  getContextWorkingMemory,
  prefetchContextMemoryForTurn,
  type AutoMemoryIndexResponse,
  type EffectiveMemorySourcesResponse,
  type MemoryExtractionStatusResponse,
  type MemoryConfig,
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
import { buildMemoryEntryCreationReplayRequestMetadata } from "@/components/agent/chat/utils/creationReplayMetadata";
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
import { buildLayerMetrics } from "./memoryLayerMetrics";
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
type ClaudeMemoryType = "user" | "feedback" | "project" | "reference";
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

const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  max_entries: 1000,
  retention_days: 30,
  auto_cleanup: true,
};

const SECTION_META: Array<{
  key: PrimarySection;
  label: string;
  icon: typeof BrainCircuit;
  description: string;
}> = [
  {
    key: "home",
    label: "记忆总览",
    icon: BrainCircuit,
    description: "按 Claude Code 的来源与作用域查看当前记忆。",
  },
  {
    key: "rules",
    label: "记忆来源",
    icon: ScrollText,
    description: "Managed、User、Project、Local、Rules、Auto 与 /memories。",
  },
  {
    key: "working",
    label: "会话记忆",
    icon: FolderKanban,
    description: "当前 session 的计划、摘录和工作文件。",
  },
  {
    key: "durable",
    label: "记忆类型",
    icon: Database,
    description: "Claude 四类记忆视角与 Lime 当前存量映射。",
  },
  {
    key: "team",
    label: "Team Memory",
    icon: Users,
    description: "repo 作用域的协作影子与分工快照。",
  },
  {
    key: "compaction",
    label: "会话压缩",
    icon: GitBranch,
    description: "长会话压缩后保留下来的可续接摘要。",
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

const CLAUDE_MEMORY_TYPE_META: Array<{
  key: ClaudeMemoryType;
  label: string;
  description: string;
  useCase: string;
}> = [
  {
    key: "user",
    label: "User memory",
    description: "记录用户角色、职责、目标与长期偏好，用来调整协作方式。",
    useCase: "例如用户的经验背景、沟通偏好、对解释深浅的期待。",
  },
  {
    key: "feedback",
    label: "Feedback memory",
    description: "记录用户反复强调的做事方式，包括纠偏和验证通过的做法。",
    useCase: "例如“不要做额外重构”“回复保持简洁”“测试要打真实链路”。",
  },
  {
    key: "project",
    label: "Project memory",
    description: "记录项目内不易从代码直接推导的目标、约束、时间点和背景。",
    useCase: "例如当前主线、冻结窗口、重构动机、团队分工和交付背景。",
  },
  {
    key: "reference",
    label: "Reference memory",
    description: "记录外部资料和系统入口，帮助下次知道去哪里查最新事实。",
    useCase: "例如文档地址、监控面板、工单系统、知识库目录。",
  },
];

const CLAUDE_MEMORY_TYPE_LABELS: Record<ClaudeMemoryType, string> = {
  user: "用户记忆",
  feedback: "反馈记忆",
  project: "项目记忆",
  reference: "参考记忆",
};

const LEGACY_CATEGORY_TO_CLAUDE_TYPE: Record<MemoryCategory, ClaudeMemoryType> =
  {
    identity: "user",
    preference: "feedback",
    experience: "project",
    activity: "project",
    context: "reference",
  };

const CLAUDE_TYPE_BADGE_CLASS_NAMES: Record<ClaudeMemoryType, string> = {
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
    label: "Managed memory",
    scope: "全局托管",
    description: "平台托管的基础政策与默认行为，优先级最高。",
    kinds: ["managed_policy"],
    emptyState: "当前未发现托管策略文件。",
  },
  {
    key: "user",
    label: "User memory",
    scope: "用户级",
    description: "全局用户记忆，通常对应当前用户的长期偏好与个人规则。",
    kinds: ["user_memory"],
    emptyState: "当前未发现用户级记忆文件。",
  },
  {
    key: "project",
    label: "Project memory",
    scope: "项目级",
    description: "项目共享记忆，通常来自仓库内主记忆文件。",
    kinds: ["project_memory", "workspace_agents"],
    emptyState: "当前未发现项目级主记忆文件。",
  },
  {
    key: "local",
    label: "Local memory",
    scope: "本地项目级",
    description: "仅在当前工作区本地生效，不应替代共享主记忆。",
    kinds: ["project_local"],
    emptyState: "当前未发现本地 local memory 文件。",
  },
  {
    key: "rules",
    label: "Project rules",
    scope: "项目规则目录",
    description: "规则目录与细粒度规则文件，会在项目范围内参与注入。",
    kinds: ["project_rule", "project_rules"],
    emptyState: "当前未发现项目规则目录或规则文件。",
  },
  {
    key: "auto",
    label: "Auto memory",
    scope: "自动归档",
    description: "自动记忆目录与入口文件，承接持续沉淀的 note 与索引。",
    kinds: ["auto_memory"],
    emptyState: "当前未启用或未发现 auto memory 入口。",
  },
  {
    key: "durable",
    label: "/memories",
    scope: "跨会话",
    description: "可跨会话访问的 durable memory 根目录，用于共享结构化沉淀。",
    kinds: ["durable_memory"],
    emptyState: "当前未发现 durable memory 根目录。",
  },
  {
    key: "additional",
    label: "Additional memory",
    scope: "附加目录",
    description: "额外扫描目录中的补充记忆来源，避免直接混入主链。",
    kinds: ["additional_memory"],
    emptyState: "当前没有额外目录记忆来源。",
  },
];

const MEMORY_SCOPE_CARD_META: Array<{
  key: "user" | "project" | "local" | "auto" | "durable" | "team";
  label: string;
  description: string;
}> = [
  {
    key: "user",
    label: "User memory",
    description: "面向当前用户的长期偏好与协作方式。",
  },
  {
    key: "project",
    label: "Project memory",
    description: "仓库共享记忆，承接项目背景和约束。",
  },
  {
    key: "local",
    label: "Local memory",
    description: "只在本地工作区生效的附加指令与补充说明。",
  },
  {
    key: "auto",
    label: "Auto memory folder",
    description: "自动整理的 MEMORY 入口和主题 note。",
  },
  {
    key: "durable",
    label: "/memories",
    description: "跨会话可读取的 durable 记忆根目录。",
  },
  {
    key: "team",
    label: "Team memory",
    description: "repo-scoped 协作影子，补充团队分工和上下文。",
  },
];

const MEMORY_DO_NOT_SAVE = [
  "代码模式、约定、架构、文件路径或项目结构，这些应直接从当前仓库读取。",
  "Git 历史、最近改动、谁改了什么，`git log` 和 `git blame` 才是事实源。",
  "调试步骤、修复配方或一次性操作过程，真正的结果应该回到代码和提交记录。",
  "已经写进 `AGENTS.md`、项目规则或其他记忆文件的内容，不要重复保存。",
  "临时任务状态、当前会话上下文、一次性的待办列表，这些属于 working memory，不是 durable memory。",
];

const MEMORY_READ_GUARDRAILS = [
  "用户明确要求回忆、检查或记住时，必须读取记忆来源，不要只凭模型记忆作答。",
  "如果记忆提到某个文件、函数或 flag 存在，先检查当前仓库是否仍然成立，再给建议。",
  "记忆和当前事实冲突时，以当前代码、文件和外部资源的最新状态为准，并及时修正旧记忆。",
];

const MEMORY_PAGE_LAYER_COPY: Record<
  "rules" | "working" | "durable" | "team" | "compaction",
  {
    title: string;
    description: string;
  }
> = {
  rules: {
    title: "来源链",
    description: "当前已解析到可注入的规则与记忆来源文件。",
  },
  working: {
    title: "会话记忆",
    description: "当前会话的 plan、摘录和工作文件正在沉淀。",
  },
  durable: {
    title: "持久记忆",
    description: "跨会话可复用的结构化沉淀已进入 durable memory 视图。",
  },
  team: {
    title: "Team Memory",
    description: "repo 作用域的 Team memory 快照可用于补足协作上下文。",
  },
  compaction: {
    title: "会话压缩",
    description: "长会话压缩摘要可用于后续续接。",
  },
};

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
  team: "Team 层",
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
const SLATE_BADGE_CLASS_NAME =
  "border-slate-200 bg-slate-100 text-slate-700";

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
      return `Team Memory ${change.previous || "无"} -> ${change.current || "无"}`;
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
  return source === "thread_reliability" ? "来自线程面板" : "来自记忆工作台";
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

function getMemoryAvailabilityBadge(status: "loaded" | "exists" | "missing"): {
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

function resolveClaudeMemoryType(category: MemoryCategory): ClaudeMemoryType {
  return LEGACY_CATEGORY_TO_CLAUDE_TYPE[category];
}

function resolveSourceKindLabel(kind: string): string {
  switch (kind) {
    case "managed_policy":
      return "Managed memory";
    case "user_memory":
      return "User memory";
    case "project_memory":
    case "workspace_agents":
      return "Project memory";
    case "project_local":
      return "Local memory";
    case "project_rule":
    case "project_rules":
      return "Project rules";
    case "auto_memory":
      return "Auto memory";
    case "durable_memory":
      return "/memories";
    case "additional_memory":
      return "Additional memory";
    default:
      return kind;
  }
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
  const [config, setConfig] = useState<Config | null>(null);
  const [memoryConfig, setMemoryConfig] = useState<MemoryConfig>(
    DEFAULT_MEMORY_CONFIG,
  );
  const [savingConfig, setSavingConfig] = useState(false);
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
  const [unifiedStats, setUnifiedStats] =
    useState<UnifiedMemoryStatsResponse | null>(null);
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
  const [runtimeHistoryScope, setRuntimeHistoryScope] =
    useState<RuntimeMemoryPrefetchHistoryScope>("all");
  const [
    runtimeComparisonBaselineSignature,
    setRuntimeComparisonBaselineSignature,
  ] = useState<string | null>(null);

  const runtimeSessionId = pageParams?.runtimeSessionId?.trim() || "";
  const runtimeWorkingDir = pageParams?.runtimeWorkingDir?.trim() || "";
  const runtimeUserMessage = pageParams?.runtimeUserMessage?.trim() || "";
  const hasRuntimeContext = Boolean(runtimeSessionId && runtimeWorkingDir);

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
          nextConfig,
          nextRulesSources,
          nextAutoIndex,
          nextWorkingView,
          nextExtractionStatus,
          nextUnifiedStats,
          nextUnifiedMemories,
        ] = await Promise.all([
          getConfig(),
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

        setConfig(nextConfig);
        setMemoryConfig(nextConfig.memory || DEFAULT_MEMORY_CONFIG);
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

  const filteredMemories = useMemo(() => {
    if (durableFilter === "all") {
      return unifiedMemories;
    }
    return unifiedMemories.filter(
      (memory) => memory.category === durableFilter,
    );
  }, [durableFilter, unifiedMemories]);

  const layerMetrics = useMemo(
    () =>
      buildLayerMetrics({
        rulesSourceCount: rulesSources?.loaded_sources || 0,
        workingEntryCount: workingView?.total_entries || 0,
        durableEntryCount: unifiedStats?.total_entries || 0,
        teamSnapshotCount: teamSnapshots.length,
        compactionCount: extractionStatus?.recent_compactions.length || 0,
      }),
    [
      extractionStatus?.recent_compactions.length,
      rulesSources?.loaded_sources,
      teamSnapshots.length,
      unifiedStats?.total_entries,
      workingView?.total_entries,
    ],
  );

  const durableCountsByCategory = useMemo(() => {
    const counts = new Map<MemoryCategory, number>();
    unifiedStats?.categories.forEach((item) => {
      counts.set(item.category, item.count);
    });
    return counts;
  }, [unifiedStats?.categories]);

  const sourceBuckets = useMemo(
    () =>
      SOURCE_BUCKET_META.map((bucket) => {
        const sources =
          rulesSources?.sources.filter((source) =>
            bucket.kinds.includes(source.kind),
          ) || [];
        const loadedCount = sources.filter((source) => source.loaded).length;
        const existsCount = sources.filter((source) => source.exists).length;
        const status: "loaded" | "exists" | "missing" =
          loadedCount > 0 ? "loaded" : existsCount > 0 ? "exists" : "missing";
        return {
          ...bucket,
          sources,
          loadedCount,
          existsCount,
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

  const sourceBucketMap = useMemo(
    () => new Map(sourceBuckets.map((bucket) => [bucket.key, bucket])),
    [sourceBuckets],
  );

  const memoryScopeCards = useMemo(() => {
    return MEMORY_SCOPE_CARD_META.map((card) => {
      if (card.key === "team") {
        const status = teamSnapshots.length > 0 ? "loaded" : "missing";
        return {
          ...card,
          status,
          detail:
            teamSnapshots.length > 0
              ? `${teamSnapshots.length} 个 repo 作用域快照`
              : "当前没有本地 Team memory 快照",
          helper:
            teamSnapshots.length > 0
              ? "用于补充团队分工与协作影子，不替代共享记忆文件。"
              : "等待在会话或工作台中产生协作影子后再显示。",
        };
      }

      const bucketKey =
        card.key === "project"
          ? "project"
          : card.key === "local"
            ? "local"
            : card.key === "auto"
              ? "auto"
              : card.key === "durable"
                ? "durable"
                : "user";
      const bucket = sourceBucketMap.get(bucketKey);
      const status = bucket?.status || "missing";

      if (card.key === "auto") {
        return {
          ...card,
          status:
            autoIndex?.entry_exists || bucket?.loadedCount
              ? "loaded"
              : autoIndex?.enabled
                ? "exists"
                : "missing",
          detail:
            autoIndex?.root_dir ||
            bucket?.primaryPath ||
            "未发现 auto memory 根目录",
          helper: autoIndex?.entrypoint
            ? `入口文件：${autoIndex.entrypoint} · 已索引 ${autoIndex.items.length} 个主题`
            : bucket?.emptyState || "当前未启用 auto memory。",
        };
      }

      if (card.key === "durable") {
        return {
          ...card,
          status:
            (bucket?.loadedCount || 0) > 0 ||
            (unifiedStats?.total_entries || 0) > 0
              ? "loaded"
              : bucket?.status || "missing",
          detail: bucket?.primaryPath || "/memories",
          helper: `当前可见 ${unifiedStats?.total_entries || 0} 条结构化条目`,
        };
      }

      return {
        ...card,
        status,
        detail:
          bucket?.primaryPath || bucket?.emptyState || "当前未发现对应来源",
        helper:
          status === "loaded"
            ? `当前已命中 ${bucket?.loadedCount || 0} 条来源`
            : bucket?.emptyState || "当前未发现对应来源",
      };
    });
  }, [
    autoIndex,
    sourceBucketMap,
    teamSnapshots.length,
    unifiedStats?.total_entries,
  ]);

  const claudeTypeCards = useMemo(
    () =>
      CLAUDE_MEMORY_TYPE_META.map((item) => {
        const mappedCategories = (
          Object.keys(LEGACY_CATEGORY_TO_CLAUDE_TYPE) as MemoryCategory[]
        ).filter((category) => resolveClaudeMemoryType(category) === item.key);
        const count = mappedCategories.reduce(
          (total, category) =>
            total + (durableCountsByCategory.get(category) || 0),
          0,
        );

        return {
          ...item,
          count,
          legacyLabels: mappedCategories
            .map((category) => CATEGORY_LABELS[category])
            .join("、"),
        };
      }),
    [durableCountsByCategory],
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

  async function handleToggleMemory(enabled: boolean) {
    if (!config) {
      return;
    }

    setSavingConfig(true);
    setError(null);
    try {
      const nextConfig: Config = {
        ...config,
        memory: {
          ...(config.memory || DEFAULT_MEMORY_CONFIG),
          enabled,
        },
      };
      await saveConfig(nextConfig);
      setConfig(nextConfig);
      setMemoryConfig(nextConfig.memory || DEFAULT_MEMORY_CONFIG);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "保存记忆配置失败",
      );
    } finally {
      setSavingConfig(false);
    }
  }

  function buildMemoryPageParams(
    section: MemoryPageSection,
    overrides: Partial<MemoryPageParams> = {},
  ): MemoryPageParams {
    return {
      section,
      runtimeSessionId:
        (overrides.runtimeSessionId ?? runtimeSessionId) || undefined,
      runtimeWorkingDir:
        (overrides.runtimeWorkingDir ?? runtimeWorkingDir) || undefined,
      runtimeUserMessage:
        (overrides.runtimeUserMessage ?? runtimeUserMessage) || undefined,
    };
  }

  function navigateToMemorySection(nextSection: MemoryPageSection) {
    const resolved = resolveSectionState(nextSection);
    setActiveSection(resolved.section);
    setDurableFilter(resolved.durableFilter);
    onNavigate("memory", buildMemoryPageParams(nextSection));
  }

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

  const currentSectionMeta = SECTION_META.find(
    (item) => item.key === activeSection,
  );
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
        看来源链
      </button>
      <button
        type="button"
        className={cn(BUTTON_CLASS_NAME, EMERALD_BUTTON_CLASS_NAME)}
        onClick={() => navigateToMemorySection("working")}
      >
        看会话记忆
      </button>
      <button
        type="button"
        className={cn(BUTTON_CLASS_NAME, EMERALD_BUTTON_CLASS_NAME)}
        onClick={() => navigateToMemorySection("durable")}
      >
        看记忆类型
      </button>
      <button
        type="button"
        className={cn(BUTTON_CLASS_NAME, EMERALD_BUTTON_CLASS_NAME)}
        onClick={() => navigateToMemorySection("team")}
      >
        看 Team Memory
      </button>
      <button
        type="button"
        className={cn(BUTTON_CLASS_NAME, EMERALD_BUTTON_CLASS_NAME)}
        onClick={() => navigateToMemorySection("compaction")}
      >
        看会话压缩
      </button>
    </div>
  ) : null;

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.08),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(148,163,184,0.12),_transparent_24%),linear-gradient(180deg,_#f8fafc_0%,_#f4f8f5_58%,_#eef5ef_100%)] px-6 py-6">
      <div className="mx-auto grid max-w-[1480px] gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className={cn(PANEL_CLASS_NAME, "h-fit")}>
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Claude Code Memory
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">
              记忆工作台
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              把来源链、会话记忆、记忆类型、Team Memory
              和会话压缩收口到一处查看。
            </p>
          </div>

          <div className="space-y-2">
            {SECTION_META.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    "flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition",
                    active
                      ? "border-emerald-200 bg-emerald-50/80 text-slate-900 shadow-sm shadow-emerald-950/5"
                      : "border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-white",
                  )}
                  onClick={() => navigateToMemorySection(item.key)}
                >
                  <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">
                      {item.label}
                    </span>
                    <span
                      className={cn(
                        "mt-1 block text-xs leading-5",
                        active ? "text-slate-600" : "text-slate-500",
                      )}
                    >
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="space-y-6">
          <MemorySurfacePanel
            title={currentSectionMeta?.label || "记忆工作台"}
            description={currentSectionMeta?.description}
            actions={
              <label className="inline-flex items-center gap-3 text-sm text-slate-600">
                <span>启用记忆</span>
                <input
                  type="checkbox"
                  checked={memoryConfig.enabled}
                  disabled={savingConfig}
                  onChange={(event) =>
                    void handleToggleMemory(event.target.checked)
                  }
                />
              </label>
            }
          >
            <div className="flex flex-wrap gap-4 text-sm text-slate-500">
              <span>
                记忆状态：{memoryConfig.enabled ? "已启用" : "已关闭"}
              </span>
              <span>
                来源加载：{rulesSources?.loaded_sources || 0}/
                {rulesSources?.total_sources || 0}
              </span>
              <span>
                Auto memory：{autoIndex?.enabled ? "已启用" : "未启用"}
              </span>
              <span>
                抽取状态：{extractionStatus?.status_summary || "等待加载"}
              </span>
            </div>
          </MemorySurfacePanel>

          {loading ? (
            <div className={PANEL_CLASS_NAME}>
              <p className="text-sm text-slate-500">正在加载记忆工作台...</p>
            </div>
          ) : error ? (
            <div
              className={cn(PANEL_CLASS_NAME, "border-rose-200 bg-rose-50/80")}
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
                      Team Memory：
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
                              {runtimeComparisonDiff.layerChanges.rulesDelta > 0
                                ? "+"
                                : ""}
                              {runtimeComparisonDiff.layerChanges.rulesDelta}
                            </Badge>
                          ) : null}
                          {runtimeComparisonDiff.layerChanges.workingChanged !==
                          "same" ? (
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
                              {runtimeComparisonDiff.layerChanges.durableDelta >
                              0
                                ? "+"
                                : ""}
                              {runtimeComparisonDiff.layerChanges.durableDelta}
                            </Badge>
                          ) : null}
                          {runtimeComparisonDiff.layerChanges.teamDelta !==
                          0 ? (
                            <Badge
                              variant="outline"
                              className={EMERALD_BADGE_CLASS_NAME}
                            >
                              Team{" "}
                              {runtimeComparisonDiff.layerChanges.teamDelta > 0
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

              <MemorySurfacePanel
                title="最近运行时命中"
                description="这里保留最近几次记忆命中快照，方便回看上下文为什么命中、以及命中层是否发生变化。"
                actions={
                  <div className="flex flex-wrap justify-end gap-2">
                    {hasRuntimeContext
                      ? RUNTIME_HISTORY_SCOPE_META.map((item) => (
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
                        ))
                      : null}
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
                    <span>当前范围：{activeRuntimeHistoryScopeMeta.label}</span>
                    <span>命中记录：{runtimeHistorySummary.totalEntries}</span>
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
                        Team 层 {runtimeHistorySummary.layerEntryHits.team}/
                        {runtimeHistorySummary.totalEntries}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="border-slate-200 bg-white text-slate-700"
                      >
                        压缩层 {runtimeHistorySummary.layerEntryHits.compaction}
                        /{runtimeHistorySummary.totalEntries}
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
                                    className={EMERALD_OUTLINE_BADGE_CLASS_NAME}
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
                                        {diff.layerChanges.rulesDelta !== 0 ? (
                                          <Badge
                                            variant="outline"
                                            className={EMERALD_BADGE_CLASS_NAME}
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
                                            className={EMERALD_BADGE_CLASS_NAME}
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
                                            className={EMERALD_BADGE_CLASS_NAME}
                                          >
                                            持久{" "}
                                            {diff.layerChanges.durableDelta > 0
                                              ? "+"
                                              : ""}
                                            {diff.layerChanges.durableDelta}
                                          </Badge>
                                        ) : null}
                                        {diff.layerChanges.teamDelta !== 0 ? (
                                          <Badge
                                            variant="outline"
                                            className={EMERALD_BADGE_CLASS_NAME}
                                          >
                                            Team{" "}
                                            {diff.layerChanges.teamDelta > 0
                                              ? "+"
                                              : ""}
                                            {diff.layerChanges.teamDelta}
                                          </Badge>
                                        ) : null}
                                        {diff.layerChanges.compactionChanged !==
                                        "same" ? (
                                          <Badge
                                            variant="outline"
                                            className={EMERALD_BADGE_CLASS_NAME}
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
                        hasRuntimeContext &&
                        runtimeHistoryScope !== "all"
                          ? "当前筛选范围还没有命中历史，可以切到“全部”查看最近记录。"
                          : "当前还没有运行时命中历史。先在对话工作台触发几轮记忆预演，这里会自动沉淀最近记录。"}
                      </p>
                    </div>
                  )}
                </div>
              </MemorySurfacePanel>

              <MemorySurfacePanel
                title="Claude Code 记忆作用域"
                description="Claude Code 把记忆理解为文件、作用域和类型，而不是单一大仪表盘。这里先看当前 Lime 已经具备的入口。"
              >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {memoryScopeCards.map((card) => {
                    const badge = getMemoryAvailabilityBadge(card.status);
                    return (
                      <article
                        key={card.key}
                        className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {card.label}
                            </p>
                            <p className="mt-2 text-sm leading-6 text-slate-500">
                              {card.description}
                            </p>
                          </div>
                          <Badge variant="outline" className={badge.className}>
                            {badge.label}
                          </Badge>
                        </div>
                        <p className="mt-4 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                          {card.detail}
                        </p>
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          {card.helper}
                        </p>
                      </article>
                    );
                  })}
                </div>
              </MemorySurfacePanel>

              <MemorySurfacePanel
                title="不要写进记忆的内容"
                description="Claude Code 的 durable memory 只保存当前状态里不容易重新推导的长期信息，以下内容更适合留在代码、规则或工作记忆中。"
              >
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.95fr)]">
                  <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      What NOT to save
                    </p>
                    <div className="mt-3 space-y-3">
                      {MEMORY_DO_NOT_SAVE.map((item) => (
                        <p
                          key={item}
                          className="text-sm leading-6 text-slate-600"
                        >
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      使用记忆前的校验
                    </p>
                    <div className="mt-3 space-y-3">
                      {MEMORY_READ_GUARDRAILS.map((item) => (
                        <p
                          key={item}
                          className="text-sm leading-6 text-slate-600"
                        >
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </MemorySurfacePanel>

              <MemorySurfacePanel
                title="运行时层就绪度"
                description={`当前已有 ${layerMetrics.readyLayers}/${layerMetrics.totalLayers} 个运行时层处于可用状态，可继续对照 Claude 风格来源链与 Lime 的真实命中层。`}
              >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  {layerMetrics.cards.map((card) => (
                    <article
                      key={card.key}
                      className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {MEMORY_PAGE_LAYER_COPY[card.key].title}
                      </p>
                      <p className="mt-3 text-2xl font-semibold text-slate-900">
                        {card.value}
                        <span className="ml-1 text-sm font-medium text-slate-500">
                          {card.unit}
                        </span>
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        {card.available
                          ? MEMORY_PAGE_LAYER_COPY[card.key].description
                          : card.key === "rules"
                            ? "当前还没有加载到有效来源。"
                            : card.key === "working"
                              ? "当前还没有会话记忆条目。"
                              : card.key === "durable"
                                ? "当前还没有可复用的持久记忆。"
                                : card.key === "team"
                                  ? "当前仓库还没有 Team Memory 快照。"
                                  : "当前还没有可复用的会话压缩摘要。"}
                      </p>
                    </article>
                  ))}
                </div>
              </MemorySurfacePanel>
            </>
          ) : null}

          {!loading && !error && activeSection === "rules" ? (
            <>
              <MemorySurfacePanel
                title="Claude Code 记忆来源链"
                description="按 Claude Code 的来源心智重排当前 Lime 的可注入来源，优先看作用域、入口和当前命中状态。"
              >
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
                        ? `入口文件：${autoIndex?.entrypoint || "MEMORY.md"} · 已索引 ${autoIndex?.items.length || 0} 个主题`
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
                          <Badge variant="outline" className={badge.className}>
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
                      </article>
                    );
                  })}
                </div>
              </MemorySurfacePanel>

              <MemorySurfacePanel
                title="当前命中来源明细"
                description="下面是运行时实际解析到的来源明细。Lime 底层已经支持 managed、user、project、local、rules、auto 和 /memories 等来源。"
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
                        ，共 {source.line_count} 行，导入 {source.import_count}{" "}
                        个。
                      </p>
                      {source.preview ? (
                        <pre className="mt-3 overflow-x-auto rounded-2xl bg-slate-950 p-3 text-xs leading-6 text-slate-100">
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
                title="会话记忆文件"
                description={
                  extractionStatus?.status_summary ||
                  "这里查看 session 级的 task plan、摘录和工作文件，它们属于会话记忆而非 durable memory。"
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
              <MemorySurfacePanel
                title="Claude Code 记忆类型"
                description="Claude Code 把 durable memory 限制在四类：user、feedback、project、reference。当前 Lime 先用映射视角展示存量。"
              >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {claudeTypeCards.map((item) => (
                    <article
                      key={item.key}
                      className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {item.label}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-slate-500">
                            {item.description}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={CLAUDE_TYPE_BADGE_CLASS_NAMES[item.key]}
                        >
                          {item.count} 条
                        </Badge>
                      </div>
                      <p className="mt-4 text-sm leading-6 text-slate-600">
                        {item.useCase}
                      </p>
                      <p className="mt-3 text-sm text-slate-500">
                        当前映射：{item.legacyLabels}
                      </p>
                    </article>
                  ))}
                </div>
              </MemorySurfacePanel>

              <MemorySurfacePanel
                title="当前存量条目"
                description="当前 Lime 仍按旧分类保存 unified memory。下面展示的是 Claude Code 视角下的映射结果，同时保留原始分类过滤与带回创作输入。"
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
                        </button>
                      ),
                    )}
                  </div>
                }
              >
                <div className="mb-4 flex flex-wrap gap-4 text-sm text-slate-500">
                  <span>总条数：{unifiedStats?.total_entries || 0}</span>
                  <span>记忆库：{unifiedStats?.memory_count || 0}</span>
                  <span>过滤口径：当前仍按 Lime 存量分类</span>
                </div>
                <div className="space-y-4">
                  {filteredMemories.length ? (
                    filteredMemories.map((memory) => (
                      <article
                        key={memory.id}
                        className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant="outline"
                                className={
                                  CLAUDE_TYPE_BADGE_CLASS_NAMES[
                                    resolveClaudeMemoryType(memory.category)
                                  ]
                                }
                              >
                                {
                                  CLAUDE_MEMORY_TYPE_LABELS[
                                    resolveClaudeMemoryType(memory.category)
                                  ]
                                }
                              </Badge>
                              <span className="rounded-full bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white">
                                原分类：{CATEGORY_LABELS[memory.category]}
                              </span>
                              <h3 className="text-base font-semibold text-slate-900">
                                {memory.title}
                              </h3>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-500">
                              {memory.summary}
                            </p>
                            <p className="mt-2 text-sm leading-6 text-slate-600">
                              {memory.content}
                            </p>
                            {memory.tags.length > 0 ? (
                              <p className="mt-3 text-sm text-slate-500">
                                标签：{memory.tags.join("、")}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <span className="text-xs text-slate-400">
                              {formatRelativeTime(memory.updated_at)}
                            </span>
                            <button
                              type="button"
                              className={cn(
                                BUTTON_CLASS_NAME,
                                EMERALD_BUTTON_CLASS_NAME,
                              )}
                              onClick={() => handleBringToCreation(memory)}
                            >
                              带回创作输入
                            </button>
                          </div>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">
                      当前筛选下还没有可映射的 durable memory 条目。
                    </p>
                  )}
                </div>
              </MemorySurfacePanel>
            </>
          ) : null}

          {!loading && !error && activeSection === "team" ? (
            <MemorySurfacePanel
              title="Team Memory 快照"
              description="这里展示本地 localStorage 中保存的 repo-scoped Team memory 影子，便于核对最近一次团队分工。"
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
                    当前没有本地 Team memory 快照。
                  </p>
                )}
              </div>
            </MemorySurfacePanel>
          ) : null}

          {!loading && !error && activeSection === "compaction" ? (
            <MemorySurfacePanel
              title="会话压缩摘要"
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
    </div>
  );
}
