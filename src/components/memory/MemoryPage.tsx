import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BrainCircuit, Database, FolderKanban, GitBranch, ScrollText, Users } from "lucide-react";
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
import { getProjectMemory, type ProjectMemory } from "@/lib/api/memory";
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
import type { MemoryPageParams, MemoryPageSection, Page, PageParams } from "@/types/page";

type DurableCategoryFilter = MemoryCategory | "all";
type PrimarySection = "home" | "rules" | "working" | "durable" | "team" | "compaction";

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
    label: "总览",
    icon: BrainCircuit,
    description: "看清五层记忆是否已经接上。",
  },
  {
    key: "rules",
    label: "规则",
    icon: ScrollText,
    description: "AGENTS、规则来源与自动记忆入口。",
  },
  {
    key: "working",
    label: "工作记忆",
    icon: FolderKanban,
    description: "会话级计划、发现、进度与错误文件。",
  },
  {
    key: "durable",
    label: "长期记忆",
    icon: Database,
    description: "统一记忆库中的结构化沉淀。",
  },
  {
    key: "team",
    label: "Team 影子",
    icon: Users,
    description: "repo 作用域的协作影子与分工痕迹。",
  },
  {
    key: "compaction",
    label: "压缩边界",
    icon: GitBranch,
    description: "最近一次上下文压缩留下的可续接摘要。",
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
  "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5";
const BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900";
const ACTIVE_BUTTON_CLASS_NAME =
  "border-slate-900 bg-slate-900 text-white hover:border-slate-900 hover:text-white";

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
      return `长期记忆 ${change.previous || "无"} -> ${change.current || "无"}`;
    case "team":
      return `Team 影子 ${change.previous || "无"} -> ${change.current || "无"}`;
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
      badgeClassName: "border-emerald-200 bg-white text-emerald-700",
    };
  }

  if (layer.missEntries === 0) {
    return {
      title: "持续命中",
      description: `最近 ${totalEntries} 次都命中${title}，但层值发生了 ${layer.valueChanges} 次变化。`,
      className: "border-amber-200 bg-amber-50/70",
      badgeClassName: "border-amber-200 bg-white text-amber-700",
    };
  }

  return {
    title: "间歇命中",
    description: `最近 ${totalEntries} 次里命中${title} ${layer.hitEntries} 次，发生 ${layer.valueChanges} 次状态变化。`,
    className: "border-sky-200 bg-sky-50/70",
    badgeClassName: "border-sky-200 bg-white text-sky-700",
  };
}

function resolveRuntimeComparisonAssessmentBadgeClassName(
  assessment: RuntimeMemoryPrefetchHistoryDiffAssessment,
): string {
  switch (assessment.status) {
    case "stronger":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "weaker":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "mixed":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "same":
    default:
      return "border-slate-200 bg-white text-slate-700";
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

function buildCreationPrompt(entry: UnifiedMemory, categoryLabel: string): string {
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

function countProjectCoverage(projectMemory: ProjectMemory | null): string {
  if (!projectMemory) {
    return "未选择项目";
  }

  const characterCount = projectMemory.characters.length;
  const outlineCount = projectMemory.outline.length;
  const hasWorldBuilding = !!projectMemory.world_building?.description?.trim();

  return `角色 ${characterCount} / 世界观 ${hasWorldBuilding ? "已填写" : "未填写"} / 大纲 ${outlineCount}`;
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
          <h2 className="text-lg font-semibold text-slate-900">{props.title}</h2>
          {props.description ? (
            <p className="mt-1 text-sm leading-6 text-slate-500">{props.description}</p>
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
  const [memoryConfig, setMemoryConfig] = useState<MemoryConfig>(DEFAULT_MEMORY_CONFIG);
  const [savingConfig, setSavingConfig] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rulesSources, setRulesSources] = useState<EffectiveMemorySourcesResponse | null>(null);
  const [autoIndex, setAutoIndex] = useState<AutoMemoryIndexResponse | null>(null);
  const [workingView, setWorkingView] = useState<WorkingMemoryView | null>(null);
  const [extractionStatus, setExtractionStatus] =
    useState<MemoryExtractionStatusResponse | null>(null);
  const [unifiedStats, setUnifiedStats] = useState<UnifiedMemoryStatsResponse | null>(null);
  const [unifiedMemories, setUnifiedMemories] = useState<UnifiedMemory[]>([]);
  const [projectId, setProjectId] = useState<string | null>(
    getStoredResourceProjectId(),
  );
  const [projectMemory, setProjectMemory] = useState<ProjectMemory | null>(null);
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
  const [runtimeComparisonBaselineSignature, setRuntimeComparisonBaselineSignature] =
    useState<string | null>(null);

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
  }, [hasRuntimeContext, runtimeSessionId, runtimeWorkingDir, runtimeUserMessage]);

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

        const nextProjectMemory = projectId
          ? await getProjectMemory(projectId).catch(() => null)
          : null;
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
        setProjectMemory(nextProjectMemory);
        setTeamSnapshots(nextTeamSnapshots);
        setRuntimePrefetchHistory(nextRuntimePrefetchHistory);
      } catch (loadError) {
        if (disposed) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "记忆页面加载失败");
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
  }, [projectId]);

  const filteredMemories = useMemo(() => {
    if (durableFilter === "all") {
      return unifiedMemories;
    }
    return unifiedMemories.filter((memory) => memory.category === durableFilter);
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
    [extractionStatus?.recent_compactions.length, rulesSources?.loaded_sources, teamSnapshots.length, unifiedStats?.total_entries, workingView?.total_entries],
  );

  const runtimeTeamSnapshot = useMemo(() => {
    if (!runtimeWorkingDir) {
      return null;
    }

    const normalizedWorkingDir = normalizeTeamMemoryRepoScope(runtimeWorkingDir);
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
      setError(saveError instanceof Error ? saveError.message : "保存记忆配置失败");
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
    const initialRequestMetadata = buildMemoryEntryCreationReplayRequestMetadata({
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

  const currentSectionMeta = SECTION_META.find((item) => item.key === activeSection);
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
  const displayedRuntimePrefetchHistory = filteredRuntimePrefetchHistory.slice(0, 6);
  const activeRuntimeHistoryScopeMeta =
    RUNTIME_HISTORY_SCOPE_META.find((item) => item.key === runtimeHistoryScope) ||
    RUNTIME_HISTORY_SCOPE_META[0];
  const isRuntimeHistoryEntryActive = useCallback(
    (entry: RuntimeMemoryPrefetchHistoryEntry) =>
      entry.sessionId === runtimeSessionId &&
      normalizeTeamMemoryRepoScope(entry.workingDir) === normalizedRuntimeWorkingDir &&
      (entry.userMessage || "") === runtimeUserMessage,
    [runtimeSessionId, normalizedRuntimeWorkingDir, runtimeUserMessage],
  );
  const currentRuntimeHistoryEntry = useMemo(
    () =>
      runtimePrefetchHistory.find((entry) => isRuntimeHistoryEntryActive(entry)) || null,
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

    setRuntimeComparisonBaselineSignature(runtimeComparisonCandidates[0].signature);
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
        className={cn(BUTTON_CLASS_NAME, "border-sky-200 text-sky-700")}
        onClick={() => navigateToMemorySection("rules")}
      >
        看规则
      </button>
      <button
        type="button"
        className={cn(BUTTON_CLASS_NAME, "border-sky-200 text-sky-700")}
        onClick={() => navigateToMemorySection("working")}
      >
        看工作记忆
      </button>
      <button
        type="button"
        className={cn(BUTTON_CLASS_NAME, "border-sky-200 text-sky-700")}
        onClick={() => navigateToMemorySection("durable")}
      >
        看长期记忆
      </button>
      <button
        type="button"
        className={cn(BUTTON_CLASS_NAME, "border-sky-200 text-sky-700")}
        onClick={() => navigateToMemorySection("team")}
      >
        看 Team
      </button>
      <button
        type="button"
        className={cn(BUTTON_CLASS_NAME, "border-sky-200 text-sky-700")}
        onClick={() => navigateToMemorySection("compaction")}
      >
        看压缩边界
      </button>
    </div>
  ) : null;

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.08),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] px-6 py-6">
      <div className="mx-auto grid max-w-[1480px] gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className={cn(PANEL_CLASS_NAME, "h-fit")}>
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">
              Memory Runtime
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">记忆工作台</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              把规则、工作记忆、长期记忆、Team 影子和压缩边界收口到一处查看。
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
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-white",
                  )}
                  onClick={() => navigateToMemorySection(item.key)}
                >
                  <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{item.label}</span>
                    <span
                      className={cn(
                        "mt-1 block text-xs leading-5",
                        active ? "text-slate-200" : "text-slate-500",
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
                  onChange={(event) => void handleToggleMemory(event.target.checked)}
                />
              </label>
            }
          >
            <div className="flex flex-wrap gap-4 text-sm text-slate-500">
              <span>记忆状态：{memoryConfig.enabled ? "已启用" : "已关闭"}</span>
              <span>项目资料：{countProjectCoverage(projectMemory)}</span>
              <span>抽取状态：{extractionStatus?.status_summary || "等待加载"}</span>
            </div>
          </MemorySurfacePanel>

          {loading ? (
            <div className={PANEL_CLASS_NAME}>
              <p className="text-sm text-slate-500">正在加载记忆工作台...</p>
            </div>
          ) : error ? (
            <div className={cn(PANEL_CLASS_NAME, "border-rose-200 bg-rose-50/80")}>
              <p className="text-sm text-rose-700">{error}</p>
            </div>
          ) : null}

          {!loading && !error && hasRuntimeContext && activeSection !== "home" ? (
            <MemorySurfacePanel
              title="当前运行时对照模式"
              description="你正在带着当前会话的运行时上下文查看记忆库存；切换分区不会丢失这轮对照。"
              actions={
                <button
                  type="button"
                  className={cn(BUTTON_CLASS_NAME, "border-sky-200 text-sky-700")}
                  onClick={() => navigateToMemorySection("home")}
                >
                  返回总览预演
                </button>
              }
            >
              <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                <span>会话：{runtimeSessionId}</span>
                <span>工作区：{runtimeWorkingDir}</span>
                {runtimeUserMessage ? <span>本轮输入：{runtimeUserMessage}</span> : null}
              </div>
              {runtimePrefetchState.result ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge
                    variant="outline"
                    className="border-sky-200 bg-white text-sky-700"
                  >
                    {formatRuntimeLayerStatusLabel(
                      "规则",
                      runtimePrefetchState.result.rules_source_paths.length,
                    )}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-sky-200 bg-white text-sky-700"
                  >
                    {formatRuntimeLayerStatusLabel(
                      "工作",
                      null,
                      Boolean(runtimePrefetchState.result.working_memory_excerpt),
                    )}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-sky-200 bg-white text-sky-700"
                  >
                    {formatRuntimeLayerStatusLabel(
                      "持久",
                      runtimePrefetchState.result.durable_memories.length,
                    )}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-sky-200 bg-white text-sky-700"
                  >
                    {formatRuntimeLayerStatusLabel(
                      "Team",
                      runtimePrefetchState.result.team_memory_entries.length,
                    )}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-sky-200 bg-white text-sky-700"
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
                      Team shadow：
                      {runtimeTeamSnapshot ? runtimeTeamSnapshot.repoScope : "未命中本地快照"}
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
                      className={cn(BUTTON_CLASS_NAME, "border-slate-300 text-slate-700")}
                      onClick={() => setRuntimeComparisonBaselineSignature(null)}
                    >
                      改用最近基线
                    </button>
                  }
                >
                  <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                    <span>当前会话：{currentRuntimeHistoryEntry.sessionId}</span>
                    <span>基线时间：{formatRelativeTime(runtimeComparisonBaselineEntry.capturedAt)}</span>
                    <span>基线来源：{resolveRuntimeHistorySourceLabel(runtimeComparisonBaselineEntry.source)}</span>
                  </div>
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-sm font-medium text-slate-900">
                      基线摘要
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {resolveRuntimeHistorySummary(runtimeComparisonBaselineEntry)}
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
                          {runtimeComparisonDiff.layerChanges.rulesDelta !== 0 ? (
                            <Badge
                              variant="outline"
                              className="border-sky-200 bg-sky-50 text-sky-700"
                            >
                              规则 {runtimeComparisonDiff.layerChanges.rulesDelta > 0 ? "+" : ""}
                              {runtimeComparisonDiff.layerChanges.rulesDelta}
                            </Badge>
                          ) : null}
                          {runtimeComparisonDiff.layerChanges.workingChanged !== "same" ? (
                            <Badge
                              variant="outline"
                              className="border-sky-200 bg-sky-50 text-sky-700"
                            >
                              工作
                              {runtimeComparisonDiff.layerChanges.workingChanged === "added"
                                ? " 新命中"
                                : " 取消命中"}
                            </Badge>
                          ) : null}
                          {runtimeComparisonDiff.layerChanges.durableDelta !== 0 ? (
                            <Badge
                              variant="outline"
                              className="border-sky-200 bg-sky-50 text-sky-700"
                            >
                              持久 {runtimeComparisonDiff.layerChanges.durableDelta > 0 ? "+" : ""}
                              {runtimeComparisonDiff.layerChanges.durableDelta}
                            </Badge>
                          ) : null}
                          {runtimeComparisonDiff.layerChanges.teamDelta !== 0 ? (
                            <Badge
                              variant="outline"
                              className="border-sky-200 bg-sky-50 text-sky-700"
                            >
                              Team {runtimeComparisonDiff.layerChanges.teamDelta > 0 ? "+" : ""}
                              {runtimeComparisonDiff.layerChanges.teamDelta}
                            </Badge>
                          ) : null}
                          {runtimeComparisonDiff.layerChanges.compactionChanged !== "same" ? (
                            <Badge
                              variant="outline"
                              className="border-sky-200 bg-sky-50 text-sky-700"
                            >
                              压缩
                              {runtimeComparisonDiff.layerChanges.compactionChanged === "added"
                                ? " 新命中"
                                : " 取消命中"}
                            </Badge>
                          ) : null}
                        </div>
                        {runtimeComparisonDiff.previewChanges.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            {runtimeComparisonDiff.previewChanges.slice(0, 4).map((change, changeIndex) => (
                              <p
                                key={`${change.key}:${changeIndex}`}
                                className="text-sm leading-6 text-slate-600"
                              >
                                {resolveRuntimeHistoryPreviewChangeLabel(change)}
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
                description="这里保留最近几次五层命中快照，方便回看上下文为什么命中、以及命中层是否发生变化。"
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
                        className={cn(BUTTON_CLASS_NAME, "border-amber-200 text-amber-700")}
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
                    <span>工作区：{runtimeHistorySummary.uniqueWorkingDirs}</span>
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
                        压缩层 {runtimeHistorySummary.layerEntryHits.compaction}/
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
                        const presentation = resolveRuntimeLayerStabilityPresentation(
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
                      const previousEntry = filteredRuntimePrefetchHistory[index + 1];
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
                              ? "border-sky-300 bg-sky-50/70"
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
                                  {resolveRuntimeHistorySourceLabel(entry.source)}
                                </Badge>
                                {isRuntimeHistoryEntryActive(entry) ? (
                                  <Badge
                                    variant="outline"
                                    className="border-sky-200 bg-white text-sky-700"
                                  >
                                    当前对照
                                  </Badge>
                                ) : null}
                                {!isRuntimeHistoryEntryActive(entry) &&
                                runtimeComparisonBaselineEntry?.signature === entry.signature ? (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-200 bg-white text-amber-700"
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
                                            className="border-sky-200 bg-sky-50 text-sky-700"
                                          >
                                            规则 {diff.layerChanges.rulesDelta > 0 ? "+" : ""}
                                            {diff.layerChanges.rulesDelta}
                                          </Badge>
                                        ) : null}
                                        {diff.layerChanges.workingChanged !== "same" ? (
                                          <Badge
                                            variant="outline"
                                            className="border-sky-200 bg-sky-50 text-sky-700"
                                          >
                                            工作
                                            {diff.layerChanges.workingChanged === "added"
                                              ? " 新命中"
                                              : " 取消命中"}
                                          </Badge>
                                        ) : null}
                                        {diff.layerChanges.durableDelta !== 0 ? (
                                          <Badge
                                            variant="outline"
                                            className="border-sky-200 bg-sky-50 text-sky-700"
                                          >
                                            持久 {diff.layerChanges.durableDelta > 0 ? "+" : ""}
                                            {diff.layerChanges.durableDelta}
                                          </Badge>
                                        ) : null}
                                        {diff.layerChanges.teamDelta !== 0 ? (
                                          <Badge
                                            variant="outline"
                                            className="border-sky-200 bg-sky-50 text-sky-700"
                                          >
                                            Team {diff.layerChanges.teamDelta > 0 ? "+" : ""}
                                            {diff.layerChanges.teamDelta}
                                          </Badge>
                                        ) : null}
                                        {diff.layerChanges.compactionChanged !== "same" ? (
                                          <Badge
                                            variant="outline"
                                            className="border-sky-200 bg-sky-50 text-sky-700"
                                          >
                                            压缩
                                            {diff.layerChanges.compactionChanged === "added"
                                              ? " 新命中"
                                              : " 取消命中"}
                                          </Badge>
                                        ) : null}
                                      </div>
                                      {diff.previewChanges.length > 0 ? (
                                        <div className="mt-3 space-y-2">
                                          {diff.previewChanges.slice(0, 2).map((change, changeIndex) => (
                                            <p
                                              key={`${change.key}:${changeIndex}`}
                                              className="text-sm leading-6 text-slate-600"
                                            >
                                              {resolveRuntimeHistoryPreviewChangeLabel(change)}
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
                                    runtimeComparisonBaselineEntry?.signature === entry.signature
                                      ? "border-amber-300 bg-amber-50 text-amber-700"
                                      : "border-amber-200 text-amber-700",
                                  )}
                                  onClick={() =>
                                    setRuntimeComparisonBaselineSignature(entry.signature)
                                  }
                                >
                                  {runtimeComparisonBaselineEntry?.signature === entry.signature
                                    ? "当前基线"
                                    : "设为对照基线"}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={cn(
                                  BUTTON_CLASS_NAME,
                                  "border-sky-200 text-sky-700",
                                )}
                                onClick={() => handleOpenRuntimeHistoryEntry(entry)}
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
                title="五层总览"
                description={`当前已有 ${layerMetrics.readyLayers}/${layerMetrics.totalLayers} 层记忆处于可用状态。`}
              >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  {layerMetrics.cards.map((card) => (
                    <article
                      key={card.key}
                      className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {card.title}
                      </p>
                      <p className="mt-3 text-2xl font-semibold text-slate-900">
                        {card.value}
                        <span className="ml-1 text-sm font-medium text-slate-500">{card.unit}</span>
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-500">{card.description}</p>
                    </article>
                  ))}
                </div>
              </MemorySurfacePanel>

              <MemorySurfacePanel
                title="项目资料附属层"
                description="项目角色 / 世界观 / 大纲不作为新的主真相层，但会继续作为创作资料辅助使用。"
              >
                <div className="grid gap-4 md:grid-cols-3">
                  <article className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-sm font-semibold text-slate-900">角色</p>
                    <p className="mt-2 text-sm text-slate-500">
                      {projectMemory?.characters.length || 0} 个
                    </p>
                  </article>
                  <article className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-sm font-semibold text-slate-900">世界观</p>
                    <p className="mt-2 text-sm text-slate-500">
                      {projectMemory?.world_building?.description ? "已填写" : "未填写"}
                    </p>
                  </article>
                  <article className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-sm font-semibold text-slate-900">大纲</p>
                    <p className="mt-2 text-sm text-slate-500">
                      {projectMemory?.outline.length || 0} 个节点
                    </p>
                  </article>
                </div>
              </MemorySurfacePanel>
            </>
          ) : null}

          {!loading && !error && activeSection === "rules" ? (
            <>
              <MemorySurfacePanel
                title="有效规则来源"
                description="这部分仍然是运行时规则注入的主链，不和工作记忆混用。"
              >
                <div className="space-y-3">
                  {rulesSources?.sources.map((source) => (
                    <article
                      key={`${source.kind}:${source.path}`}
                      className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-medium text-white">
                          {source.kind}
                        </span>
                        <span className="font-medium text-slate-900">{source.path}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        {source.loaded ? "已加载" : "未加载"}，共 {source.line_count} 行，导入 {source.import_count} 个。
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

              <MemorySurfacePanel
                title="自动记忆入口"
                description="不额外新造 MEMORY.md 真相，只把自动记忆入口作为规则来源的一部分展示。"
              >
                <div className="space-y-3 text-sm text-slate-500">
                  <p>
                    入口文件：{autoIndex?.entrypoint || "MEMORY.md"} / 根目录：
                    {autoIndex?.root_dir || "未检测到"}
                  </p>
                  <p>
                    状态：{autoIndex?.enabled ? "已启用" : "未启用"} / 已索引项目：
                    {autoIndex?.items.length || 0}
                  </p>
                  {autoIndex?.preview_lines?.length ? (
                    <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-3 text-xs leading-6 text-slate-100">
                      {autoIndex.preview_lines.join("\n")}
                    </pre>
                  ) : null}
                </div>
              </MemorySurfacePanel>
            </>
          ) : null}

          {!loading && !error && activeSection === "working" ? (
            <>
              <MemorySurfacePanel
                title="工作记忆会话"
                description={extractionStatus?.status_summary}
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
                              {session.total_entries} 条工作记忆，更新于 {formatRelativeTime(session.updated_at)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          {session.files.map((file) => (
                            <div
                              key={`${session.session_id}:${file.file_type}`}
                              className="rounded-2xl border border-slate-200 bg-white p-3"
                            >
                              <p className="text-sm font-medium text-slate-900">{file.file_type}</p>
                              <p className="mt-1 text-xs leading-5 text-slate-500">{file.path}</p>
                              <p className="mt-2 text-sm leading-6 text-slate-500">{file.summary}</p>
                            </div>
                          ))}
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">当前还没有检测到工作记忆文件。</p>
                  )}
                </div>
              </MemorySurfacePanel>
            </>
          ) : null}

          {!loading && !error && activeSection === "durable" ? (
            <>
              <MemorySurfacePanel
                title="长期结构化记忆"
                description="旧的 identity/context/preference/experience/activity 仍保留为长期记忆内部分类。"
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
                    {(Object.keys(CATEGORY_LABELS) as MemoryCategory[]).map((category) => (
                      <button
                        key={category}
                        type="button"
                        className={cn(
                          BUTTON_CLASS_NAME,
                          durableFilter === category && ACTIVE_BUTTON_CLASS_NAME,
                        )}
                        onClick={() => navigateToMemorySection(category)}
                      >
                        {CATEGORY_LABELS[category]}
                      </button>
                    ))}
                  </div>
                }
              >
                <div className="mb-4 flex flex-wrap gap-4 text-sm text-slate-500">
                  <span>总条数：{unifiedStats?.total_entries || 0}</span>
                  <span>记忆库：{unifiedStats?.memory_count || 0}</span>
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
                              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-medium text-white">
                                {CATEGORY_LABELS[memory.category]}
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
                              className={cn(BUTTON_CLASS_NAME, "border-sky-200 text-sky-700")}
                              onClick={() => handleBringToCreation(memory)}
                            >
                              带回创作输入
                            </button>
                          </div>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">当前筛选下还没有长期记忆条目。</p>
                  )}
                </div>
              </MemorySurfacePanel>
            </>
          ) : null}

          {!loading && !error && activeSection === "team" ? (
            <MemorySurfacePanel
              title="Team Shadow 快照"
              description="这里展示本地 localStorage 中保存的 repo-scoped Team 协作影子，便于核对最近一次团队分工。"
            >
              <div className="space-y-4">
                {teamSnapshots.length ? (
                  teamSnapshots.map((snapshot) => (
                    <article
                      key={snapshot.repoScope}
                      className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4"
                    >
                      <p className="text-sm font-semibold text-slate-900">{snapshot.repoScope}</p>
                      <div className="mt-3 space-y-2">
                        {Object.values(snapshot.entries).map((entry) => (
                          <div
                            key={entry.key}
                            className="rounded-2xl border border-slate-200 bg-white p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-sm font-medium text-slate-900">{entry.key}</span>
                              <span className="text-xs text-slate-400">
                                {formatRelativeTime(entry.updatedAt)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-500">{entry.content}</p>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">当前没有本地 Team shadow 快照。</p>
                )}
              </div>
            </MemorySurfacePanel>
          ) : null}

          {!loading && !error && activeSection === "compaction" ? (
            <MemorySurfacePanel
              title="上下文压缩边界"
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
                            turns={snapshot.turn_count || 0} / {formatRelativeTime(snapshot.created_at)}
                          </p>
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-600">
                        {snapshot.summary_preview}
                      </p>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">当前还没有上下文压缩摘要。</p>
                )}
              </div>
            </MemorySurfacePanel>
          ) : null}
        </main>
      </div>
    </div>
  );
}
