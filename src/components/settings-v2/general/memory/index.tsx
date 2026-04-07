import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  Brain,
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
  getContextMemoryAutoIndex,
  getContextMemoryEffectiveSources,
  getContextMemoryOverview,
  ensureWorkspaceLocalAgentsGitignore,
  scaffoldRuntimeAgentsTemplate,
  toggleContextMemoryAuto,
  updateContextMemoryAutoNote,
  type AutoMemoryIndexResponse,
  type EffectiveMemorySourcesResponse,
  type MemoryAutoConfig,
  type MemoryConfig,
  type MemoryProfileConfig,
  type MemoryResolveConfig,
  type MemorySourcesConfig,
  type RuntimeAgentsTemplateTarget,
} from "@/lib/api/memoryRuntime";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import { getUnifiedMemoryStats } from "@/lib/api/unifiedMemory";
import { getProjectMemory } from "@/lib/api/memory";
import {
  getStoredResourceProjectId,
  onResourceProjectChange,
} from "@/lib/resourceProjectSelection";
import {
  buildLayerMetrics,
  type LayerMetricsResult,
} from "@/components/memory/memoryLayerMetrics";

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
    <div className="rounded-[20px] border border-white/90 bg-white/88 p-4 shadow-sm">
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
      <div className="h-[228px] animate-pulse rounded-[30px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(244,251,248,0.98)_0%,rgba(248,250,252,0.98)_45%,rgba(241,246,255,0.96)_100%)]" />
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
  const [projectId, setProjectId] = useState<string | null>(() =>
    getStoredResourceProjectId({ includeLegacy: true }),
  );
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
  const [message, setMessage] = useState<string | null>(null);

  const loadLayerMetrics = useCallback(
    async (targetProjectId?: string | null) => {
      const currentProjectId = targetProjectId ?? projectId;
      setLoadingLayerMetrics(true);
      try {
        const [unifiedStats, contextOverview, projectMemory] =
          await Promise.all([
            getUnifiedMemoryStats(),
            getContextMemoryOverview(200).catch(() => null),
            currentProjectId
              ? getProjectMemory(currentProjectId).catch(() => null)
              : Promise.resolve(null),
          ]);

        setLayerMetrics(
          buildLayerMetrics({
            unifiedTotalEntries: unifiedStats.total_entries,
            contextTotalEntries: contextOverview?.stats.total_entries ?? 0,
            projectId: currentProjectId ?? null,
            projectMemory,
          }),
        );
      } catch (error) {
        console.error("加载三层记忆状态失败:", error);
      } finally {
        setLoadingLayerMetrics(false);
      }
    },
    [projectId],
  );

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

  useEffect(() => {
    return onResourceProjectChange((detail) => {
      setProjectId(detail.projectId);
      loadLayerMetrics(detail.projectId);
    });
  }, [loadLayerMetrics]);

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
      setMessage(result.enabled ? "自动记忆已开启" : "自动记忆已关闭");
      setTimeout(() => setMessage(null), 2500);
      await loadSourceState();
    } catch (error) {
      console.error("切换自动记忆失败:", error);
      setMessage("切换自动记忆失败");
      setTimeout(() => setMessage(null), 2500);
    }
  };

  const handleUpdateAutoNote = async () => {
    const note = autoNote.trim();
    if (!note) {
      setMessage("请先输入要保存的自动记忆内容");
      setTimeout(() => setMessage(null), 2500);
      return;
    }

    setSavingAutoNote(true);
    try {
      const index = await updateContextMemoryAutoNote(
        note,
        autoTopic.trim() || undefined,
      );
      setAutoIndex(index);
      setAutoNote("");
      setMessage("已写入自动记忆");
      setTimeout(() => setMessage(null), 2500);
    } catch (error) {
      console.error("写入自动记忆失败:", error);
      setMessage("写入自动记忆失败");
      setTimeout(() => setMessage(null), 2500);
    } finally {
      setSavingAutoNote(false);
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
  const messageIsError = Boolean(
    message && (message.includes("失败") || message.includes("请先")),
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

      <section className="relative overflow-hidden rounded-[30px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(244,251,248,0.98)_0%,rgba(248,250,252,0.98)_45%,rgba(241,246,255,0.96)_100%)] shadow-sm shadow-slate-950/5">
        <div className="pointer-events-none absolute -left-20 top-[-72px] h-56 w-56 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="pointer-events-none absolute right-[-76px] top-[-24px] h-56 w-56 rounded-full bg-sky-200/28 blur-3xl" />

        <div className="relative grid gap-6 p-6 lg:p-8 xl:grid-cols-[minmax(0,1.12fr)_minmax(380px,0.88fr)]">
          <div className="space-y-5">
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 shadow-sm">
              MEMORY SNAPSHOT
            </span>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[28px] font-semibold tracking-tight text-slate-900">
                  让记忆真正参与上下文
                </p>
                <WorkbenchInfoTip
                  ariaLabel="记忆快照说明"
                  content="这页负责管理用户画像、三层记忆来源与自动记忆入口。目标不是堆更多配置，而是让代理在长期使用里更稳定地理解你的背景与偏好。"
                  tone="mint"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-white/90 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                画像完成度 {profileCompletionPercent}%
              </span>
              <span className="rounded-full border border-white/90 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                三层可用 {readyLayerLabel}
              </span>
              <span className="rounded-full border border-white/90 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                来源命中 {sourceHitLabel}
              </span>
              <span className="rounded-full border border-white/90 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                自动记忆 {autoStatusLabel}
              </span>
            </div>

            <p className="text-xs leading-5 text-slate-500">
              当前模式：{draft.enabled ? "记忆已启用" : "记忆已关闭"}。
              {dirty ? " 有未保存更改。" : " 当前配置与已保存版本一致。"}
            </p>
          </div>

          <article className="flex h-full flex-col rounded-[26px] border border-white/90 bg-white/84 p-5 shadow-sm shadow-slate-950/5 backdrop-blur-[2px]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                  <Brain className="h-4 w-4 text-sky-600" />
                  记忆控制台
                  <WorkbenchInfoTip
                    ariaLabel="记忆控制台说明"
                    content="统一管理开关、保存动作与核心状态摘要。"
                    tone="slate"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
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

            <div className="mt-5 flex items-center justify-between rounded-[20px] border border-slate-200 bg-slate-50/70 px-4 py-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    启用记忆
                  </p>
                  <WorkbenchInfoTip
                    ariaLabel="启用记忆说明"
                    content="启用对话记忆功能，以便更好地理解上下文。"
                    tone="slate"
                  />
                </div>
              </div>
              <Switch
                aria-label="启用记忆"
                checked={draft.enabled}
                onCheckedChange={(checked) =>
                  setDraft((prev) => ({ ...prev, enabled: checked }))
                }
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <SummaryStat
                label="画像完成度"
                value={`${profileCompletionPercent}%`}
                description="状态、擅长方向、解释偏好与拆解方式的完成比例。"
              />
              <SummaryStat
                label="三层可用"
                value={readyLayerLabel}
                description="统一记忆、上下文记忆与项目记忆的当前可用层数。"
              />
              <SummaryStat
                label="来源命中"
                value={sourceHitLabel}
                description="当前工作目录下已加载的记忆来源数量。"
              />
              <SummaryStat
                label="自动记忆"
                value={autoStatusLabel}
                description="Auto Memory 入口的当前启用与初始化状态。"
              />
            </div>
          </article>
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
            title="三层记忆可用性"
            description="持续检查统一记忆、上下文记忆与项目记忆的参与情况。"
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
                  第三层（项目记忆）的补全操作在「记忆」页面进行（支持一键初始化）。
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">正在加载三层状态...</p>
            )}
          </MemoryPanel>

          <MemoryPanel
            icon={FolderTree}
            title="来源状态总览"
            description="快速查看当前记忆解析策略和来源命中状态。"
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
        title="记忆来源策略"
        description="统一管理组织策略、项目规则目录和额外仓库记忆加载规则。"
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
              每行一个绝对路径，可添加 `aster-rust` 等外部仓库参与记忆解析。
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
              placeholder="例如 /Users/coso/Documents/dev/ai/astercloud/aster-rust"
            />
          </label>
        </div>
      </MemoryPanel>

      <MemoryPanel
        icon={Database}
        title="自动记忆（Auto Memory）"
        description="管理自动记忆入口、写入内容和当前索引预览。"
        aside={
          <button
            type="button"
            onClick={handleToggleAutoImmediately}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            {autoConfig.enabled ? "立即关闭" : "立即开启"}
          </button>
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
                自动记忆根目录
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
                写入自动记忆
              </div>
              <div className="mt-4 space-y-3">
                <input
                  type="text"
                  value={autoTopic}
                  onChange={(event) => setAutoTopic(event.target.value)}
                  className={INPUT_CLASS_NAME}
                  placeholder="可选：topic，例如 workflow"
                />
                <textarea
                  value={autoNote}
                  onChange={(event) => setAutoNote(event.target.value)}
                  className={TEXTAREA_CLASS_NAME}
                  placeholder="输入要写入自动记忆的内容"
                />
                <button
                  type="button"
                  onClick={handleUpdateAutoNote}
                  disabled={savingAutoNote}
                  className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {savingAutoNote ? "写入中..." : "写入自动记忆"}
                </button>
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
                  暂无自动记忆入口内容
                </p>
              )}
            </div>
          </div>
        </div>
      </MemoryPanel>

      <MemoryPanel
        icon={Files}
        title="记忆来源命中详情"
        description="逐项查看来源是否命中、是否已加载，以及实际预览内容。"
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
