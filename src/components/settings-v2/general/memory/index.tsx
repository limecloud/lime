import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Files,
  FolderTree,
  Layers3,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  cleanupContextMemdir,
  getContextMemoryAutoIndex,
  getContextMemoryEffectiveSources,
  getContextMemoryExtractionStatus,
  getContextWorkingMemory,
  ensureWorkspaceLocalAgentsGitignore,
  scaffoldContextMemdir,
  scaffoldRuntimeAgentsTemplate,
  toggleContextMemoryAuto,
  updateContextMemoryAutoNote,
  type AutoMemoryIndexResponse,
  type EffectiveMemorySourcesResponse,
  type MemdirMemoryType,
  type MemoryAutoConfig,
  type MemoryConfig,
  type MemoryProfileConfig,
  type MemoryResolveConfig,
  type MemorySourcesConfig,
  type RuntimeAgentsTemplateTarget,
} from "@/lib/api/memoryRuntime";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import { getUnifiedMemoryStats } from "@/lib/api/unifiedMemory";
import {
  buildLayerMetrics,
  type LayerMetricsResult,
} from "@/components/memory/memoryLayerMetrics";
import { listTeamMemorySnapshots } from "@/lib/teamMemorySync";

const STATUS_OPTIONS = [
  "高中生",
  "大学生/本科生",
  "研究生",
  "自学者/专业人士",
  "其他",
];

const STRENGTH_OPTIONS = [
  "数学/逻辑推理",
  "计算机科学/编程",
  "自然科学（物理学、化学、生物学）",
  "写作/阅读/人文",
  "商业/经济学",
  "没有——我还在探索中。",
];

const EXPLANATION_STYLE_OPTIONS = [
  "将晦涩难懂的概念变得直观易懂",
  "先举例，后讲理论",
  "概念结构与全局观",
  "类比和隐喻",
  "考试导向型讲解",
  "我没有偏好——随机应变",
];

const CHALLENGE_OPTIONS = [
  "照本宣科——把所有细节都直接告诉我（我能应付）",
  "一步一步地分解",
  "先从简单的例子或类比入手",
  "先解释重点和难点在哪里",
  "多种解释/角度",
];

const MEMDIR_MEMORY_TYPE_OPTIONS: Array<{
  value: MemdirMemoryType;
  label: string;
  description: string;
}> = [
  {
    value: "project",
    label: "项目记忆",
    description: "默认推荐，用于项目背景、约束、时间点与分工。",
  },
  {
    value: "feedback",
    label: "反馈记忆",
    description: "记录被确认有效的做法与需要持续遵守的规则。",
  },
  {
    value: "user",
    label: "用户记忆",
    description: "记录用户背景、长期偏好与协作方式。",
  },
  {
    value: "reference",
    label: "参考记忆",
    description: "记录文档、工单、监控和知识库入口。",
  },
];

const MEMDIR_WRITE_GUIDES: Record<
  MemdirMemoryType,
  {
    description: string;
    topicPlaceholder: string;
    placeholder: string;
    requiredSections: string[];
    note: string;
  }
> = {
  user: {
    description:
      "记录用户背景、长期偏好和协作方式，帮助 Lime 调整解释深浅与默认协作节奏。",
    topicPlaceholder:
      "可选：topic，例如 communication-style、domain-background",
    placeholder:
      "例如：用户熟悉 Rust，但第一次接触这个前端；解释前先给结论，再给必要上下文。",
    requiredSections: [],
    note: "适合沉淀长期稳定的人物画像，不要记录临时任务状态。",
  },
  feedback: {
    description:
      "沉淀被反复验证有效的做法与明确要避免的模式，避免同一个纠偏再次发生。",
    topicPlaceholder: "可选：topic，例如 workflow、testing-policy",
    placeholder:
      "Why:\n- 这条反馈为什么成立，避免了什么问题\n\nHow to apply:\n- 以后什么时候执行\n- 有哪些边界条件",
    requiredSections: ["Why", "How to apply"],
    note: "反馈记忆必须说明原因和使用方式，只写一句结论很容易失真。",
  },
  project: {
    description:
      "补足代码之外的项目背景、里程碑、冻结窗口和协作关系，帮助下一次快速进入上下文。",
    topicPlaceholder: "可选：topic，例如 release-window、ownership-map",
    placeholder:
      "Why:\n- 这个背景/约束为什么重要\n\nHow to apply:\n- 这会如何影响当前实现或交付\n- 绝对日期：2026-04-15 / 2026-04-15 14:00",
    requiredSections: ["Why", "How to apply", "绝对日期"],
    note: "项目记忆不要写“今天/明天/下周”，请改成绝对日期，避免过期后误导后续决策。",
  },
  reference: {
    description:
      "记录外部文档、工单、监控、知识库或系统入口，方便下次知道去哪里查最新事实。",
    topicPlaceholder: "可选：topic，例如 grafana-dashboard、runbook",
    placeholder:
      "例如：发布值班看板在 Grafana /d/release-ops；改协议前先查 release runbook 第 3 节。",
    requiredSections: [],
    note: "参考记忆应优先保存事实源入口，而不是把外部文档内容整段复制进来。",
  },
};

const MEMORY_SOURCE_BUCKET_LABELS: Record<string, string> = {
  managed: "托管记忆",
  user: "用户记忆",
  project: "项目记忆",
  local: "本地记忆",
  rules: "项目规则",
  auto: "记忆目录（memdir）",
  durable: "/memories",
  additional: "附加目录",
};

const PROJECT_RELATIVE_DATE_TOKENS = [
  "今天",
  "明天",
  "昨天",
  "后天",
  "今晚",
  "今早",
  "本周",
  "下周",
  "上周",
  "本月",
  "下个月",
  "上个月",
  "本季度",
  "下季度",
  "上季度",
];

const PROJECT_RELATIVE_DATE_ASCII_TOKENS = [
  "today",
  "tomorrow",
  "yesterday",
  "tonight",
  "this week",
  "next week",
  "last week",
  "this month",
  "next month",
  "last month",
  "this quarter",
  "next quarter",
  "last quarter",
];

function normalizeProfile(profile?: MemoryProfileConfig): MemoryProfileConfig {
  return {
    current_status: profile?.current_status || undefined,
    strengths: profile?.strengths || [],
    explanation_style: profile?.explanation_style || [],
    challenge_preference: profile?.challenge_preference || [],
  };
}

function normalizeSources(sources?: MemorySourcesConfig): MemorySourcesConfig {
  return {
    managed_policy_path: sources?.managed_policy_path ?? undefined,
    project_memory_paths:
      sources?.project_memory_paths?.length &&
      sources.project_memory_paths.filter((item) => item.trim().length > 0)
        ? sources.project_memory_paths
        : [".lime/AGENTS.md"],
    project_rule_dirs:
      sources?.project_rule_dirs?.length &&
      sources.project_rule_dirs.filter((item) => item.trim().length > 0)
        ? sources.project_rule_dirs
        : [".agents/rules"],
    user_memory_path: sources?.user_memory_path ?? undefined,
    project_local_memory_path:
      sources?.project_local_memory_path ?? ".lime/AGENTS.local.md",
  };
}

function normalizeAuto(auto?: MemoryAutoConfig): MemoryAutoConfig {
  return {
    enabled: auto?.enabled ?? true,
    entrypoint: auto?.entrypoint || "MEMORY.md",
    max_loaded_lines: auto?.max_loaded_lines ?? 200,
    root_dir: auto?.root_dir ?? undefined,
  };
}

function normalizeResolve(resolve?: MemoryResolveConfig): MemoryResolveConfig {
  return {
    additional_dirs: resolve?.additional_dirs || [],
    follow_imports: resolve?.follow_imports ?? true,
    import_max_depth: resolve?.import_max_depth ?? 5,
    load_additional_dirs_memory: resolve?.load_additional_dirs_memory ?? false,
  };
}

function normalizeMemoryConfig(memory?: MemoryConfig): MemoryConfig {
  return {
    enabled: memory?.enabled ?? true,
    max_entries: memory?.max_entries ?? 1000,
    retention_days: memory?.retention_days ?? 30,
    auto_cleanup: memory?.auto_cleanup ?? true,
    profile: normalizeProfile(memory?.profile),
    sources: normalizeSources(memory?.sources),
    auto: normalizeAuto(memory?.auto),
    resolve: normalizeResolve(memory?.resolve),
  };
}

function parseLines(input: string): string[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function resolveMemdirTypeLabel(type?: MemdirMemoryType | null): string {
  return (
    MEMDIR_MEMORY_TYPE_OPTIONS.find((option) => option.value === type)?.label ||
    "未分类"
  );
}

function resolveSourceBucketLabel(bucket?: string | null): string {
  if (!bucket) {
    return "未分类";
  }
  return MEMORY_SOURCE_BUCKET_LABELS[bucket] || bucket;
}

function formatRelativeTimeLabel(timestamp?: number | null): string {
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

function normalizeStructuredLine(line: string): string {
  return line
    .trim()
    .replace(/^[#*\-\s]+/u, "")
    .replace(/：/gu, ":")
    .toLowerCase();
}

function noteHasSection(note: string, headings: string[]): boolean {
  return note.split("\n").some((line) => {
    const normalized = normalizeStructuredLine(line);
    return headings.some((heading) => normalized.startsWith(heading));
  });
}

function containsAsciiPhrase(text: string, phrase: string): boolean {
  let searchStart = 0;
  while (searchStart < text.length) {
    const index = text.indexOf(phrase, searchStart);
    if (index < 0) {
      return false;
    }
    const before = index === 0 ? "" : text[index - 1];
    const after =
      index + phrase.length >= text.length ? "" : text[index + phrase.length];
    const beforeOk = before === "" || !/[a-z0-9_]/i.test(before);
    const afterOk = after === "" || !/[a-z0-9_]/i.test(after);
    if (beforeOk && afterOk) {
      return true;
    }
    searchStart = index + phrase.length;
  }
  return false;
}

function findProjectRelativeDateToken(note: string): string | null {
  for (const token of PROJECT_RELATIVE_DATE_TOKENS) {
    if (note.includes(token)) {
      return token;
    }
  }

  const asciiNote = note.replace(/：/gu, ":").toLowerCase();
  for (const token of PROJECT_RELATIVE_DATE_ASCII_TOKENS) {
    if (containsAsciiPhrase(asciiNote, token)) {
      return token;
    }
  }

  return null;
}

function validateMemdirNote(
  note: string,
  memoryType: MemdirMemoryType,
): string | null {
  if (memoryType === "feedback" || memoryType === "project") {
    if (!noteHasSection(note, ["why", "为什么", "原因"])) {
      return "反馈/项目记忆必须包含 `Why:` 段落。";
    }
    if (!noteHasSection(note, ["how to apply", "如何使用", "如何应用"])) {
      return "反馈/项目记忆必须包含 `How to apply:` 段落。";
    }
  }

  if (memoryType === "project") {
    const relativeDateToken = findProjectRelativeDateToken(note);
    if (relativeDateToken) {
      return `项目记忆不能使用相对时间词“${relativeDateToken}”，请改成绝对日期，例如 2026-04-15。`;
    }
  }

  return null;
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

function formatMemdirCleanupMessage(result: {
  updated_files: number;
  curated_topic_files: number;
  removed_duplicate_links: number;
  dropped_missing_links: number;
  removed_duplicate_notes: number;
  trimmed_notes: number;
}): string {
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

interface MultiSelectSectionProps {
  title: string;
  subtitle?: string;
  options: string[];
  value: string[];
  onToggle: (value: string) => void;
  multiple?: boolean;
  className?: string;
}

interface MemoryPanelProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

const INPUT_CLASS_NAME =
  "w-full rounded-[16px] border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white";
const TEXTAREA_CLASS_NAME = `${INPUT_CLASS_NAME} min-h-24`;
const TOGGLE_ROW_CLASS_NAME =
  "flex items-center justify-between rounded-[18px] border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-700";

function MemoryPanel({
  icon: Icon,
  title,
  description,
  aside,
  className,
  children,
}: MemoryPanelProps) {
  return (
    <article
      className={cn(
        "rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5",
        className,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
            <Icon className="h-4 w-4 text-sky-600" />
            {title}
            {description ? (
              <WorkbenchInfoTip
                ariaLabel={`${title}说明`}
                content={description}
                tone="slate"
              />
            ) : null}
          </div>
        </div>
        {aside ? (
          <div className="flex flex-wrap items-center gap-2">{aside}</div>
        ) : null}
      </div>

      <div className="mt-5">{children}</div>
    </article>
  );
}

function MultiSelectSection({
  title,
  subtitle,
  options,
  value,
  onToggle,
  multiple = true,
  className,
}: MultiSelectSectionProps) {
  const badgeText = multiple
    ? value.length > 0
      ? `${value.length} 个已选`
      : "可多选"
    : value.length > 0
      ? "已选择"
      : "待选择";

  return (
    <article
      className={cn(
        "rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            {subtitle ? (
              <WorkbenchInfoTip
                ariaLabel={`${title}说明`}
                content={subtitle}
                tone="slate"
              />
            ) : null}
          </div>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
          {badgeText}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2.5">
        {options.map((option) => {
          const selected = value.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onToggle(option)}
              className={cn(
                "rounded-full border px-3.5 py-2 text-sm transition shadow-sm",
                selected
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </article>
  );
}

function SourceStatusPill({
  loaded,
  exists,
}: {
  loaded: boolean;
  exists: boolean;
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
        loaded
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : exists
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-slate-200 bg-slate-100 text-slate-500",
      )}
    >
      {loaded ? "已加载" : exists ? "存在未命中" : "未发现"}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 pb-8">
      <div className="h-[176px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.92fr)]">
        <div className="h-[420px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        <div className="space-y-6">
          <div className="h-[240px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
          <div className="h-[220px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(0,0.82fr)]">
        <div className="h-[420px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        <div className="h-[420px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
      </div>
    </div>
  );
}

export function MemorySettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [draft, setDraft] = useState<MemoryConfig>(() =>
    normalizeMemoryConfig(),
  );
  const [snapshot, setSnapshot] = useState<MemoryConfig>(() =>
    normalizeMemoryConfig(),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingLayerMetrics, setLoadingLayerMetrics] = useState(false);
  const [loadingSourceState, setLoadingSourceState] = useState(false);
  const [savingAutoNote, setSavingAutoNote] = useState(false);
  const [scaffoldingTarget, setScaffoldingTarget] =
    useState<RuntimeAgentsTemplateTarget | null>(null);
  const [ensuringGitignore, setEnsuringGitignore] = useState(false);
  const [layerMetrics, setLayerMetrics] = useState<LayerMetricsResult | null>(
    null,
  );
  const [effectiveSources, setEffectiveSources] =
    useState<EffectiveMemorySourcesResponse | null>(null);
  const [autoIndex, setAutoIndex] = useState<AutoMemoryIndexResponse | null>(
    null,
  );
  const [autoTopic, setAutoTopic] = useState("");
  const [autoNote, setAutoNote] = useState("");
  const [autoMemoryType, setAutoMemoryType] =
    useState<MemdirMemoryType>("project");
  const [scaffoldingMemdir, setScaffoldingMemdir] = useState(false);
  const [cleaningMemdir, setCleaningMemdir] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadLayerMetrics = useCallback(async () => {
    setLoadingLayerMetrics(true);
    try {
      const [unifiedStats, sources, workingView, extractionStatus] =
        await Promise.all([
          getUnifiedMemoryStats(),
          getContextMemoryEffectiveSources().catch(() => null),
          getContextWorkingMemory(undefined, 24).catch(() => null),
          getContextMemoryExtractionStatus().catch(() => null),
        ]);
      const teamSnapshotCount =
        typeof window !== "undefined"
          ? listTeamMemorySnapshots(window.localStorage).length
          : 0;

      setLayerMetrics(
        buildLayerMetrics({
          rulesSourceCount: sources?.loaded_sources ?? 0,
          workingEntryCount: workingView?.total_entries ?? 0,
          durableEntryCount: unifiedStats.total_entries,
          teamSnapshotCount,
          compactionCount: extractionStatus?.recent_compactions.length ?? 0,
        }),
      );
    } catch (error) {
      console.error("加载记忆命中层状态失败:", error);
    } finally {
      setLoadingLayerMetrics(false);
    }
  }, []);

  const loadSourceState = useCallback(async () => {
    setLoadingSourceState(true);
    try {
      const [sources, index] = await Promise.all([
        getContextMemoryEffectiveSources().catch(() => null),
        getContextMemoryAutoIndex().catch(() => null),
      ]);
      setEffectiveSources(sources);
      setAutoIndex(index);
    } finally {
      setLoadingSourceState(false);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const nextConfig = await getConfig();
        const nextMemory = normalizeMemoryConfig(nextConfig.memory);
        setConfig(nextConfig);
        setDraft(nextMemory);
        setSnapshot(nextMemory);
      } catch (error) {
        console.error("加载记忆设置失败:", error);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  useEffect(() => {
    loadLayerMetrics();
    loadSourceState();
  }, [loadLayerMetrics, loadSourceState]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(snapshot),
    [draft, snapshot],
  );

  const toggleMulti = (
    key: "strengths" | "explanation_style" | "challenge_preference",
    option: string,
  ) => {
    setDraft((prev) => {
      const profile = normalizeProfile(prev.profile);
      const current = profile[key] || [];
      const exists = current.includes(option);
      return {
        ...prev,
        profile: {
          ...profile,
          [key]: exists
            ? current.filter((item) => item !== option)
            : [...current, option],
        },
      };
    });
  };

  const setStatus = (value: string) => {
    setDraft((prev) => ({
      ...prev,
      profile: {
        ...normalizeProfile(prev.profile),
        current_status: value,
      },
    }));
  };

  const handleCancel = () => {
    setDraft(snapshot);
    setMessage("已恢复为上次保存内容");
    setTimeout(() => setMessage(null), 2500);
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updatedConfig: Config = {
        ...config,
        memory: draft,
      };
      await saveConfig(updatedConfig);
      setConfig(updatedConfig);
      setSnapshot(draft);
      setMessage("记忆设置已保存");
      setTimeout(() => setMessage(null), 2500);
      await loadSourceState();
    } catch (error) {
      console.error("保存记忆设置失败:", error);
      setMessage("保存失败，请稍后重试");
      setTimeout(() => setMessage(null), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAutoImmediately = async () => {
    const current = normalizeAuto(draft.auto).enabled ?? true;
    const next = !current;
    try {
      const result = await toggleContextMemoryAuto(next);
      setDraft((prev) => ({
        ...prev,
        auto: {
          ...normalizeAuto(prev.auto),
          enabled: result.enabled,
        },
      }));
      setSnapshot((prev) => ({
        ...prev,
        auto: {
          ...normalizeAuto(prev.auto),
          enabled: result.enabled,
        },
      }));
      setMessage(result.enabled ? "记忆目录已开启" : "记忆目录已关闭");
      setTimeout(() => setMessage(null), 2500);
      await loadSourceState();
    } catch (error) {
      console.error("切换记忆目录失败:", error);
      setMessage("切换记忆目录失败");
      setTimeout(() => setMessage(null), 2500);
    }
  };

  const handleUpdateAutoNote = async () => {
    const note = autoNote.trim();
    if (!note) {
      setMessage("请先输入要保存的 memdir 内容");
      setTimeout(() => setMessage(null), 2500);
      return;
    }

    const validationError = validateMemdirNote(note, autoMemoryType);
    if (validationError) {
      setMessage(validationError);
      setTimeout(() => setMessage(null), 3000);
      return;
    }

    setSavingAutoNote(true);
    try {
      const index = await updateContextMemoryAutoNote(
        note,
        autoTopic.trim() || undefined,
        undefined,
        autoMemoryType,
      );
      setAutoIndex(index);
      setAutoNote("");
      setMessage("已写入 memdir");
      setTimeout(() => setMessage(null), 2500);
    } catch (error) {
      console.error("写入 memdir 失败:", error);
      setMessage(resolveActionErrorMessage(error, "写入 memdir 失败"));
      setTimeout(() => setMessage(null), 3500);
    } finally {
      setSavingAutoNote(false);
    }
  };

  const handleScaffoldMemdir = async () => {
    const workingDir = effectiveSources?.working_dir?.trim() || undefined;
    if (!workingDir) {
      setMessage("当前未获取到 workspace 路径，暂无法初始化 memdir");
      setTimeout(() => setMessage(null), 2500);
      return;
    }

    setScaffoldingMemdir(true);
    try {
      const result = await scaffoldContextMemdir(workingDir, false);
      const createdCount = result.files.filter(
        (file) => file.status === "created" || file.status === "overwritten",
      ).length;
      setMessage(
        createdCount > 0
          ? `已初始化 memdir：${result.root_dir}`
          : `memdir 已存在：${result.root_dir}`,
      );
      setTimeout(() => setMessage(null), 3000);
      const [nextIndex, nextSources] = await Promise.all([
        getContextMemoryAutoIndex().catch(() => null),
        getContextMemoryEffectiveSources().catch(() => null),
      ]);
      if (nextIndex) {
        setAutoIndex(nextIndex);
      }
      if (nextSources) {
        setEffectiveSources(nextSources);
      }
    } catch (error) {
      console.error("初始化 memdir 失败:", error);
      setMessage("初始化 memdir 失败");
      setTimeout(() => setMessage(null), 2500);
    } finally {
      setScaffoldingMemdir(false);
    }
  };

  const handleCleanupMemdir = async () => {
    const workingDir = effectiveSources?.working_dir?.trim() || undefined;
    if (!workingDir) {
      setMessage("当前未获取到 workspace 路径，暂无法整理 memdir");
      setTimeout(() => setMessage(null), 2500);
      return;
    }

    setCleaningMemdir(true);
    try {
      const result = await cleanupContextMemdir(workingDir);
      setMessage(formatMemdirCleanupMessage(result));
      setTimeout(() => setMessage(null), 3500);
      const [nextIndex, nextSources] = await Promise.all([
        getContextMemoryAutoIndex().catch(() => null),
        getContextMemoryEffectiveSources().catch(() => null),
      ]);
      if (nextIndex) {
        setAutoIndex(nextIndex);
      }
      if (nextSources) {
        setEffectiveSources(nextSources);
      }
    } catch (error) {
      console.error("整理 memdir 失败:", error);
      setMessage(resolveActionErrorMessage(error, "整理 memdir 失败"));
      setTimeout(() => setMessage(null), 3000);
    } finally {
      setCleaningMemdir(false);
    }
  };

  const handleScaffoldRuntimeAgentsTemplate = async (
    target: RuntimeAgentsTemplateTarget,
  ) => {
    const workingDir = effectiveSources?.working_dir?.trim() || undefined;
    const targetLabelMap: Record<RuntimeAgentsTemplateTarget, string> = {
      global: "全局",
      workspace: "Workspace",
      workspace_local: "本机私有",
    };

    if (target !== "global" && !workingDir) {
      setMessage(
        `当前未获取到 workspace 路径，暂无法生成${targetLabelMap[target]}模板`,
      );
      setTimeout(() => setMessage(null), 2500);
      return;
    }

    setScaffoldingTarget(target);
    try {
      const result = await scaffoldRuntimeAgentsTemplate(
        target,
        workingDir,
        false,
      );
      if (result.status === "exists") {
        setMessage(
          `${targetLabelMap[target]}模板已存在，未覆盖：${result.path}`,
        );
      } else {
        setMessage(`已生成${targetLabelMap[target]}模板：${result.path}`);
      }
      setTimeout(() => setMessage(null), 3000);
      await Promise.all([loadSourceState(), loadLayerMetrics()]);
    } catch (error) {
      console.error("生成运行时 AGENTS 模板失败:", error);
      setMessage(`生成${targetLabelMap[target]}模板失败`);
      setTimeout(() => setMessage(null), 2500);
    } finally {
      setScaffoldingTarget(null);
    }
  };

  const handleEnsureWorkspaceLocalGitignore = async () => {
    const workingDir = effectiveSources?.working_dir?.trim() || undefined;
    if (!workingDir) {
      setMessage("当前未获取到 workspace 路径，暂无法更新 .gitignore");
      setTimeout(() => setMessage(null), 2500);
      return;
    }

    setEnsuringGitignore(true);
    try {
      const result = await ensureWorkspaceLocalAgentsGitignore(workingDir);
      const actionText =
        result.status === "exists" ? "已存在，无需重复添加" : "已写入";
      setMessage(`${actionText} .gitignore：${result.path}`);
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error("更新 .gitignore 失败:", error);
      setMessage("更新 .gitignore 失败");
      setTimeout(() => setMessage(null), 2500);
    } finally {
      setEnsuringGitignore(false);
    }
  };

  if (loading) {
    return <LoadingSkeleton />;
  }

  const profile = normalizeProfile(draft.profile);
  const sourcesConfig = normalizeSources(draft.sources);
  const autoConfig = normalizeAuto(draft.auto);
  const resolveConfig = normalizeResolve(draft.resolve);
  const profileAnsweredCount = [
    profile.current_status,
    profile.strengths?.length ? "strengths" : "",
    profile.explanation_style?.length ? "explanation_style" : "",
    profile.challenge_preference?.length ? "challenge_preference" : "",
  ].filter(Boolean).length;
  const profileCompletionPercent = Math.round((profileAnsweredCount / 4) * 100);
  const readyLayerLabel = layerMetrics
    ? `${layerMetrics.readyLayers}/${layerMetrics.totalLayers}`
    : "--";
  const sourceHitLabel = effectiveSources
    ? `${effectiveSources.loaded_sources}/${effectiveSources.total_sources}`
    : "--";
  const autoStatusLabel = autoConfig.enabled
    ? autoIndex?.entry_exists
      ? "已初始化"
      : "待初始化"
    : "已关闭";
  const selectedMemdirGuide = MEMDIR_WRITE_GUIDES[autoMemoryType];
  const messageIsError = Boolean(
    message && /失败|请先|必须|不能|绝对日期/u.test(message),
  );

  return (
    <div className="space-y-6 pb-8">
      {message ? (
        <div
          className={cn(
            "flex items-center gap-3 rounded-[20px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
            messageIsError
              ? "border-rose-200 bg-rose-50/90 text-rose-700"
              : "border-emerald-200 bg-emerald-50/90 text-emerald-700",
          )}
        >
          {messageIsError ? (
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          )}
          <span>{message}</span>
        </div>
      ) : null}

      <section className="rounded-[26px] border border-slate-200/80 bg-white px-5 py-4 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">
                  记忆
                </h1>
                <WorkbenchInfoTip
                  ariaLabel="记忆设置说明"
                  content="管理用户画像、来源链策略与记忆目录入口，让代理在长期使用里更稳定地续接规则、会话与协作状态。"
                  tone="mint"
                />
              </div>
              <p className="text-sm text-slate-500">
                管理用户画像、来源链策略与记忆目录入口。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                画像完成度：{profileCompletionPercent}%
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                命中层可用：{readyLayerLabel}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                来源命中：{sourceHitLabel}
              </span>
              <span
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium",
                  autoConfig.enabled
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700",
                )}
              >
                记忆目录：{autoStatusLabel}
              </span>
              <span
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium",
                  dirty
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700",
                )}
              >
                配置状态：{dirty ? "待保存" : "已同步"}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    记忆总开关
                  </p>
                  <WorkbenchInfoTip
                    ariaLabel="启用记忆说明"
                    content="启用对话记忆功能，以便更好地理解上下文。"
                    tone="slate"
                  />
                </div>
                <p className="text-xs leading-5 text-slate-500">
                  当前模式：{draft.enabled ? "记忆已启用" : "记忆已关闭"}。
                  {dirty
                    ? " 当前有未保存更改。"
                    : " 当前配置与已保存版本一致。"}
                </p>
              </div>

              <div className="flex items-center gap-3 self-start rounded-full border border-slate-200 bg-white px-3 py-2">
                <span className="text-xs font-medium text-slate-600">
                  {draft.enabled ? "已启用" : "已关闭"}
                </span>
                <Switch
                  aria-label="启用记忆"
                  checked={draft.enabled}
                  onCheckedChange={(checked) =>
                    setDraft((prev) => ({ ...prev, enabled: checked }))
                  }
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <button
                type="button"
                onClick={handleCancel}
                disabled={!dirty || saving}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || saving}
                className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.28fr)_minmax(340px,0.92fr)]">
        <MemoryPanel
          icon={Sparkles}
          title="偏好画像"
          description="用更清晰的问卷型结构沉淀你的身份、擅长方向与偏好解释方式。"
          aside={
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
              4 个维度
            </span>
          }
        >
          <div className="space-y-4">
            <MultiSelectSection
              title="以下哪个选项最能形容你现在的状态?"
              subtitle="单选，用于帮助代理判断你的知识密度和上下文称呼。"
              options={STATUS_OPTIONS}
              value={profile.current_status ? [profile.current_status] : []}
              onToggle={(option) => setStatus(option)}
              multiple={false}
            />

            <div className="grid gap-4 xl:grid-cols-2">
              <MultiSelectSection
                title="你觉得自己有哪些方面比较擅长?"
                subtitle="可多选，用于强化优先理解的领域。"
                options={STRENGTH_OPTIONS}
                value={profile.strengths || []}
                onToggle={(option) => toggleMulti("strengths", option)}
              />

              <MultiSelectSection
                title="我解释事情时通常更喜欢:"
                subtitle="可多选，用于调整表达风格与组织方式。"
                options={EXPLANATION_STYLE_OPTIONS}
                value={profile.explanation_style || []}
                onToggle={(option) => toggleMulti("explanation_style", option)}
              />

              <MultiSelectSection
                title="当你遇到难题/概念时，你更倾向于:"
                subtitle="可多选，用于决定先讲例子、难点还是拆解步骤。"
                options={CHALLENGE_OPTIONS}
                value={profile.challenge_preference || []}
                onToggle={(option) =>
                  toggleMulti("challenge_preference", option)
                }
                className="xl:col-span-2"
              />
            </div>
          </div>
        </MemoryPanel>

        <div className="space-y-6">
          <MemoryPanel
            icon={Layers3}
            title="记忆命中层可用性"
            description="持续检查来源链、会话记忆、持久记忆、团队记忆与会话压缩的参与情况。"
            aside={
              <button
                type="button"
                onClick={() => loadLayerMetrics()}
                disabled={loadingLayerMetrics}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    loadingLayerMetrics && "animate-spin",
                  )}
                />
                刷新
              </button>
            }
          >
            {layerMetrics ? (
              <div className="space-y-3">
                <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-600">
                  已可用 {layerMetrics.readyLayers}/{layerMetrics.totalLayers}{" "}
                  层
                </div>
                {layerMetrics.cards.map((card) => (
                  <div
                    key={card.key}
                    className="rounded-[20px] border border-slate-200/80 bg-slate-50/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {card.title}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {card.description}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          card.available
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-100 text-slate-500",
                        )}
                      >
                        {card.available ? "已生效" : "待完善"}
                      </span>
                    </div>
                    <div className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
                      {card.value}
                      <span className="ml-1 text-sm font-medium text-slate-500">
                        {card.unit}
                      </span>
                    </div>
                  </div>
                ))}
                <p className="text-xs leading-5 text-slate-500">
                  更完整的分层详情、压缩摘要与项目资料附属层都在「记忆」页面查看。
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                正在加载记忆命中层状态...
              </p>
            )}
          </MemoryPanel>

          <MemoryPanel
            icon={FolderTree}
            title="来源链状态总览"
            description="快速查看当前来源链解析策略和命中状态。"
            aside={
              <button
                type="button"
                onClick={() => loadSourceState()}
                disabled={loadingSourceState}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    loadingSourceState && "animate-spin",
                  )}
                />
                刷新来源
              </button>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                <p className="text-xs font-medium text-slate-500">命中来源</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                  {sourceHitLabel}
                </p>
              </div>
              <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                <p className="text-xs font-medium text-slate-500">
                  @import 策略
                </p>
                <p className="mt-2 text-lg font-semibold tracking-tight text-slate-900">
                  {resolveConfig.follow_imports ? "跟随导入" : "关闭导入"}
                </p>
              </div>
              <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                <p className="text-xs font-medium text-slate-500">
                  最大导入深度
                </p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                  {resolveConfig.import_max_depth ?? 5}
                </p>
              </div>
              <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                <p className="text-xs font-medium text-slate-500">
                  额外目录记忆
                </p>
                <p className="mt-2 text-lg font-semibold tracking-tight text-slate-900">
                  {resolveConfig.load_additional_dirs_memory
                    ? "已加载"
                    : "未加载"}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-[20px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Files className="h-3.5 w-3.5 text-slate-400" />
                当前工作目录
              </div>
              <p className="mt-2 break-all text-sm leading-6 text-slate-700">
                {effectiveSources?.working_dir || "未返回工作目录"}
              </p>
            </div>
          </MemoryPanel>
        </div>
      </section>

      <MemoryPanel
        icon={Database}
        title="来源链策略"
        description="统一管理组织策略、项目规则目录和额外仓库记忆的加载规则。"
      >
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
              <p className="text-sm font-semibold text-slate-900">基础路径</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-xs font-medium text-slate-500">
                    组织策略文件
                  </span>
                  <input
                    type="text"
                    value={sourcesConfig.managed_policy_path || ""}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        sources: {
                          ...normalizeSources(prev.sources),
                          managed_policy_path: event.target.value || undefined,
                        },
                      }))
                    }
                    className={INPUT_CLASS_NAME}
                    placeholder="例如 ~/.lime/AGENTS.md"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-medium text-slate-500">
                    用户记忆文件
                  </span>
                  <input
                    type="text"
                    value={sourcesConfig.user_memory_path || ""}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        sources: {
                          ...normalizeSources(prev.sources),
                          user_memory_path: event.target.value || undefined,
                        },
                      }))
                    }
                    className={INPUT_CLASS_NAME}
                    placeholder="留空时使用应用默认 ~/.lime/AGENTS.md 路径"
                  />
                </label>

                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-medium text-slate-500">
                    项目本地私有文件
                  </span>
                  <input
                    type="text"
                    value={sourcesConfig.project_local_memory_path || ""}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        sources: {
                          ...normalizeSources(prev.sources),
                          project_local_memory_path:
                            event.target.value || undefined,
                        },
                      }))
                    }
                    className={INPUT_CLASS_NAME}
                    placeholder="例如 .lime/AGENTS.local.md"
                  />
                </label>
              </div>

              <div className="mt-4 rounded-[20px] border border-slate-200/80 bg-white/80 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      显式生成模板
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      只在你点击时创建模板文件，不会静默生成，也不会默认覆盖已有内容。
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-500">
                    当前 Workspace：{effectiveSources?.working_dir || "未解析"}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      void handleScaffoldRuntimeAgentsTemplate("global")
                    }
                    disabled={scaffoldingTarget !== null}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
                  >
                    {scaffoldingTarget === "global"
                      ? "生成中..."
                      : "生成全局模板"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleScaffoldRuntimeAgentsTemplate("workspace")
                    }
                    disabled={
                      scaffoldingTarget !== null ||
                      !effectiveSources?.working_dir
                    }
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
                  >
                    {scaffoldingTarget === "workspace"
                      ? "生成中..."
                      : "生成 Workspace 模板"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleScaffoldRuntimeAgentsTemplate(
                        "workspace_local",
                      )
                    }
                    disabled={
                      scaffoldingTarget !== null ||
                      !effectiveSources?.working_dir
                    }
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
                  >
                    {scaffoldingTarget === "workspace_local"
                      ? "生成中..."
                      : "生成本机模板"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleEnsureWorkspaceLocalGitignore()}
                    disabled={
                      ensuringGitignore || !effectiveSources?.working_dir
                    }
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
                  >
                    {ensuringGitignore
                      ? "写入中..."
                      : "将本机模板加入 .gitignore"}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
              <p className="text-sm font-semibold text-slate-900">解析规则</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-xs font-medium text-slate-500">
                    最大导入深度
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={resolveConfig.import_max_depth ?? 5}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setDraft((prev) => ({
                        ...prev,
                        resolve: {
                          ...normalizeResolve(prev.resolve),
                          import_max_depth: Number.isFinite(value)
                            ? Math.max(1, Math.min(20, value))
                            : 5,
                        },
                      }));
                    }}
                    className={INPUT_CLASS_NAME}
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-medium text-slate-500">
                    额外目录数量
                  </span>
                  <div className="rounded-[16px] border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700">
                    {(resolveConfig.additional_dirs || []).length}
                  </div>
                </label>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className={TOGGLE_ROW_CLASS_NAME}>
                  <span>跟随 @import</span>
                  <Switch
                    aria-label="跟随 @import"
                    checked={resolveConfig.follow_imports ?? true}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => ({
                        ...prev,
                        resolve: {
                          ...normalizeResolve(prev.resolve),
                          follow_imports: checked,
                        },
                      }))
                    }
                  />
                </label>

                <label className={TOGGLE_ROW_CLASS_NAME}>
                  <span>加载额外目录记忆</span>
                  <Switch
                    aria-label="加载额外目录记忆"
                    checked={resolveConfig.load_additional_dirs_memory ?? false}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => ({
                        ...prev,
                        resolve: {
                          ...normalizeResolve(prev.resolve),
                          load_additional_dirs_memory: checked,
                        },
                      }))
                    }
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <label className="space-y-2 rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
              <span className="text-sm font-semibold text-slate-900">
                项目记忆文件
              </span>
              <span className="text-xs leading-5 text-slate-500">
                每行一个相对路径，例如 `.lime/AGENTS.md`。
              </span>
              <textarea
                value={(sourcesConfig.project_memory_paths || []).join("\n")}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    sources: {
                      ...normalizeSources(prev.sources),
                      project_memory_paths: parseLines(event.target.value),
                    },
                  }))
                }
                className={TEXTAREA_CLASS_NAME}
              />
            </label>

            <label className="space-y-2 rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
              <span className="text-sm font-semibold text-slate-900">
                项目规则目录
              </span>
              <span className="text-xs leading-5 text-slate-500">
                每行一个相对路径，用于定义仓库级规则目录。
              </span>
              <textarea
                value={(sourcesConfig.project_rule_dirs || []).join("\n")}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    sources: {
                      ...normalizeSources(prev.sources),
                      project_rule_dirs: parseLines(event.target.value),
                    },
                  }))
                }
                className={TEXTAREA_CLASS_NAME}
              />
            </label>
          </div>

          <label className="space-y-2 rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
            <span className="text-sm font-semibold text-slate-900">
              额外目录
            </span>
            <span className="text-xs leading-5 text-slate-500">
              每行一个绝对路径，可添加当前仓库之外的参考目录参与记忆解析。
            </span>
            <textarea
              value={(resolveConfig.additional_dirs || []).join("\n")}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  resolve: {
                    ...normalizeResolve(prev.resolve),
                    additional_dirs: parseLines(event.target.value),
                  },
                }))
              }
              className={TEXTAREA_CLASS_NAME}
              placeholder="例如 /absolute/path/to/extra-repo"
            />
          </label>
        </div>
      </MemoryPanel>

      <MemoryPanel
        icon={Database}
        title="记忆目录（memdir）"
        description="管理 MEMORY.md 入口、四类记忆文件、类型化写入和当前索引预览。"
        aside={
          <>
            <button
              type="button"
              onClick={handleScaffoldMemdir}
              disabled={scaffoldingMemdir}
              className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:border-emerald-300 hover:text-emerald-800 disabled:opacity-60"
            >
              {scaffoldingMemdir ? "初始化中..." : "初始化 memdir"}
            </button>
            <button
              type="button"
              onClick={handleCleanupMemdir}
              disabled={cleaningMemdir}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 disabled:opacity-60"
            >
              {cleaningMemdir ? "整理中..." : "整理 memdir"}
            </button>
            <button
              type="button"
              onClick={handleToggleAutoImmediately}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              {autoConfig.enabled ? "立即关闭" : "立即开启"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-3">
            <label className="space-y-2 rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
              <span className="text-sm font-semibold text-slate-900">
                入口文件
              </span>
              <input
                type="text"
                value={autoConfig.entrypoint || "MEMORY.md"}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    auto: {
                      ...normalizeAuto(prev.auto),
                      entrypoint: event.target.value,
                    },
                  }))
                }
                className={INPUT_CLASS_NAME}
              />
            </label>

            <label className="space-y-2 rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
              <span className="text-sm font-semibold text-slate-900">
                加载行数上限
              </span>
              <input
                type="number"
                min={20}
                max={1000}
                value={autoConfig.max_loaded_lines ?? 200}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setDraft((prev) => ({
                    ...prev,
                    auto: {
                      ...normalizeAuto(prev.auto),
                      max_loaded_lines: Number.isFinite(value)
                        ? Math.max(20, Math.min(1000, value))
                        : 200,
                    },
                  }));
                }}
                className={INPUT_CLASS_NAME}
              />
            </label>

            <label className="space-y-2 rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
              <span className="text-sm font-semibold text-slate-900">
                memdir 根目录
              </span>
              <input
                type="text"
                value={autoConfig.root_dir || ""}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    auto: {
                      ...normalizeAuto(prev.auto),
                      root_dir: event.target.value || undefined,
                    },
                  }))
                }
                className={INPUT_CLASS_NAME}
                placeholder="默认自动推导，可留空"
              />
            </label>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.06fr)_minmax(360px,0.94fr)]">
            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Database className="h-4 w-4 text-emerald-600" />
                写入 memdir
              </div>
              <div className="mt-4 space-y-3">
                <div className="grid gap-2">
                  <p className="text-xs leading-5 text-slate-500">
                    先选择这条记忆应归入哪一类，再决定是否额外拆 topic 文件。
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {MEMDIR_MEMORY_TYPE_OPTIONS.map((option) => {
                      const active = autoMemoryType === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setAutoMemoryType(option.value)}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                            active
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
                          )}
                          title={option.description}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-[18px] border border-white/90 bg-white/88 px-4 py-3 shadow-sm">
                  <p className="text-sm font-medium text-slate-900">
                    {resolveMemdirTypeLabel(autoMemoryType)}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {selectedMemdirGuide.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedMemdirGuide.requiredSections.length > 0 ? (
                      selectedMemdirGuide.requiredSections.map((section) => (
                        <span
                          key={section}
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                        >
                          必须包含 {section}
                        </span>
                      ))
                    ) : (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                        可直接写自然语言，不强制模板
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    {selectedMemdirGuide.note}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    同一 topic
                    会被视为同一条当前记忆并覆盖更新；如果要保留多条并行结论，请拆成不同
                    topic。
                  </p>
                </div>
                <input
                  type="text"
                  value={autoTopic}
                  onChange={(event) => setAutoTopic(event.target.value)}
                  className={INPUT_CLASS_NAME}
                  placeholder={selectedMemdirGuide.topicPlaceholder}
                />
                <textarea
                  value={autoNote}
                  onChange={(event) => setAutoNote(event.target.value)}
                  className={TEXTAREA_CLASS_NAME}
                  placeholder={selectedMemdirGuide.placeholder}
                />
                <button
                  type="button"
                  onClick={handleUpdateAutoNote}
                  disabled={savingAutoNote}
                  className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {savingAutoNote ? "写入中..." : "写入 memdir"}
                </button>
                <p className="text-xs leading-5 text-slate-500">
                  “整理 memdir” 会去重入口链接、裁剪 README 历史段落，并把旧的
                  topic 日志收口成当前有效版本。
                </p>
              </div>
            </div>

            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Files className="h-4 w-4 text-sky-600" />
                当前索引
              </div>
              <div className="mt-4 rounded-[18px] border border-white/90 bg-white/88 px-4 py-3 shadow-sm">
                <p className="text-xs leading-5 text-slate-500">
                  {autoIndex?.entry_exists ? "已存在" : "未初始化"}
                  {autoIndex ? ` · ${autoIndex.total_lines} 行` : ""}
                </p>
              </div>
              {autoIndex?.preview_lines?.length ? (
                <pre className="mt-4 max-h-52 overflow-auto rounded-[18px] border border-white/90 bg-white/88 p-3 text-[11px] leading-relaxed text-slate-600 whitespace-pre-wrap break-words shadow-sm">
                  {autoIndex.preview_lines.join("\n")}
                </pre>
              ) : (
                <p className="mt-4 text-sm leading-6 text-slate-500">
                  暂无 memdir 入口内容
                </p>
              )}
              {autoIndex?.items?.length ? (
                <div className="mt-4 space-y-2">
                  {autoIndex.items.slice(0, 6).map((item) => (
                    <div
                      key={item.relative_path}
                      className="rounded-[16px] border border-slate-200/80 bg-slate-50/70 px-3 py-2"
                    >
                      <p className="text-sm font-medium text-slate-900">
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {item.relative_path}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.memory_type ? (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                            {resolveMemdirTypeLabel(item.memory_type)}
                          </span>
                        ) : null}
                        {item.provider ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                            provider：{item.provider}
                          </span>
                        ) : null}
                        {item.updated_at ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                            更新于 {formatRelativeTimeLabel(item.updated_at)}
                          </span>
                        ) : null}
                      </div>
                      {item.summary ? (
                        <p className="mt-1 text-sm leading-6 text-slate-600">
                          {item.summary}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </MemoryPanel>

      <MemoryPanel
        icon={Files}
        title="来源链命中详情"
        description="逐项查看来源链是否命中、是否已加载，以及实际预览内容。"
        aside={
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
            {effectiveSources
              ? `命中 ${effectiveSources.loaded_sources}/${effectiveSources.total_sources}`
              : "--"}
          </span>
        }
      >
        {effectiveSources ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                工作目录：{effectiveSources.working_dir}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                跟随 @import：{effectiveSources.follow_imports ? "是" : "否"}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                导入深度：{effectiveSources.import_max_depth}
              </span>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              {effectiveSources.sources.map((source) => (
                <div
                  key={`${source.kind}-${source.path}`}
                  className="rounded-[20px] border border-slate-200/80 bg-slate-50/60 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-900">
                      {source.kind}
                    </span>
                    <SourceStatusPill
                      loaded={source.loaded}
                      exists={source.exists}
                    />
                  </div>
                  <p className="mt-2 break-all text-xs leading-5 text-slate-500">
                    {source.path}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                      来源分类：{resolveSourceBucketLabel(source.source_bucket)}
                    </span>
                    {source.provider ? (
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                        provider：{source.provider}
                      </span>
                    ) : null}
                    {source.memory_type ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                        {resolveMemdirTypeLabel(source.memory_type)}
                      </span>
                    ) : null}
                    {source.updated_at ? (
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                        最近更新：{formatRelativeTimeLabel(source.updated_at)}
                      </span>
                    ) : null}
                  </div>
                  {source.preview ? (
                    <p className="mt-3 text-sm leading-6 text-slate-600 line-clamp-3">
                      {source.preview}
                    </p>
                  ) : null}
                  {source.warnings?.length > 0 ? (
                    <p className="mt-3 text-xs leading-5 text-amber-600">
                      {source.warnings.join("；")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">正在加载来源命中结果...</p>
        )}
      </MemoryPanel>
    </div>
  );
}
