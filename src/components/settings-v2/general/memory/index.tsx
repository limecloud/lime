import { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getMemoryAutoIndex,
  getMemoryEffectiveSources,
  toggleMemoryAuto,
  updateMemoryAutoNote,
  type AutoMemoryIndexResponse,
  type EffectiveMemorySourcesResponse,
  type MemoryAutoConfig,
  type MemoryConfig,
  type MemoryProfileConfig,
  type MemoryResolveConfig,
  type MemorySourcesConfig,
  getMemoryOverview as getContextMemoryOverview,
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
        : ["AGENTS.md", ".agents/AGENTS.md"],
    project_rule_dirs:
      sources?.project_rule_dirs?.length &&
      sources.project_rule_dirs.filter((item) => item.trim().length > 0)
        ? sources.project_rule_dirs
        : [".agents/rules"],
    user_memory_path: sources?.user_memory_path ?? "~/.proxycast/AGENTS.md",
    project_local_memory_path:
      sources?.project_local_memory_path ?? "AGENTS.local.md",
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
}

function MultiSelectSection({
  title,
  subtitle,
  options,
  value,
  onToggle,
}: MultiSelectSectionProps) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onToggle(option)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs transition-colors",
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-muted",
              )}
            >
              {option}
            </button>
          );
        })}
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
        getMemoryEffectiveSources().catch(() => null),
        getMemoryAutoIndex().catch(() => null),
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
      const result = await toggleMemoryAuto(next);
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
      const index = await updateMemoryAutoNote(
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        正在加载记忆设置...
      </div>
    );
  }

  const profile = normalizeProfile(draft.profile);
  const sourcesConfig = normalizeSources(draft.sources);
  const autoConfig = normalizeAuto(draft.auto);
  const resolveConfig = normalizeResolve(draft.resolve);

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="rounded-lg border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            <Brain className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <h3 className="text-sm font-medium">记忆</h3>
              <p className="text-xs text-muted-foreground mt-1">
                启用对话记忆功能，以便更好地理解上下文
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={!dirty || saving}
              className="rounded border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-md border p-3">
          <div className="text-sm">启用记忆</div>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, enabled: event.target.checked }))
            }
            className="h-4 w-4 rounded border-gray-300"
          />
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="text-sm font-medium">
          以下哪个选项最能形容你现在的状态?
        </h3>
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((option) => {
            const selected = profile.current_status === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setStatus(option)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs transition-colors",
                  selected
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-muted",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>

      <MultiSelectSection
        title="你觉得自己有哪些方面比较擅长?"
        subtitle="（可多选）"
        options={STRENGTH_OPTIONS}
        value={profile.strengths || []}
        onToggle={(option) => toggleMulti("strengths", option)}
      />

      <MultiSelectSection
        title="我解释事情时通常更喜欢:"
        subtitle="（可多选）"
        options={EXPLANATION_STYLE_OPTIONS}
        value={profile.explanation_style || []}
        onToggle={(option) => toggleMulti("explanation_style", option)}
      />

      <MultiSelectSection
        title="当你遇到难题/概念时，你更倾向于:"
        subtitle="（可多选）"
        options={CHALLENGE_OPTIONS}
        value={profile.challenge_preference || []}
        onToggle={(option) => toggleMulti("challenge_preference", option)}
      />

      <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">三层记忆可用性</h3>
          <button
            type="button"
            onClick={() => loadLayerMetrics()}
            disabled={loadingLayerMetrics}
            className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw
              className={cn("h-3 w-3", loadingLayerMetrics && "animate-spin")}
            />
            刷新
          </button>
        </div>

        {layerMetrics ? (
          <>
            <div className="text-xs text-muted-foreground">
              已可用 {layerMetrics.readyLayers}/{layerMetrics.totalLayers} 层
            </div>
            <div className="space-y-2">
              {layerMetrics.cards.map((card) => (
                <div
                  key={card.key}
                  className="rounded border bg-background/60 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{card.title}</span>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px]",
                        card.available
                          ? "text-green-700 border-green-200 bg-green-50"
                          : "text-muted-foreground border-muted",
                      )}
                    >
                      {card.available ? "已生效" : "待完善"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                    {card.description}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              第三层（项目记忆）的补全操作在「记忆」页面进行（支持一键初始化）。
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">正在加载三层状态...</p>
        )}
      </div>

      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">记忆来源策略</h3>
          <button
            type="button"
            onClick={() => loadSourceState()}
            disabled={loadingSourceState}
            className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw
              className={cn("h-3 w-3", loadingSourceState && "animate-spin")}
            />
            刷新来源
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">组织策略文件</span>
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
              className="w-full rounded border bg-background px-2 py-1.5 text-xs"
              placeholder="例如 /Library/Application Support/ProxyCast/AGENTS.md"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">用户记忆文件</span>
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
              className="w-full rounded border bg-background px-2 py-1.5 text-xs"
              placeholder="例如 ~/.proxycast/AGENTS.md"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">
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
                    project_local_memory_path: event.target.value || undefined,
                  },
                }))
              }
              className="w-full rounded border bg-background px-2 py-1.5 text-xs"
              placeholder="例如 AGENTS.local.md"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">最大导入深度</span>
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
              className="w-full rounded border bg-background px-2 py-1.5 text-xs"
            />
          </label>
        </div>

        <label className="space-y-1 block">
          <span className="text-xs text-muted-foreground">
            项目记忆文件（每行一个相对路径）
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
            className="w-full rounded border bg-background px-2 py-1.5 text-xs min-h-20"
          />
        </label>

        <label className="space-y-1 block">
          <span className="text-xs text-muted-foreground">
            项目规则目录（每行一个相对路径）
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
            className="w-full rounded border bg-background px-2 py-1.5 text-xs min-h-16"
          />
        </label>

        <label className="space-y-1 block">
          <span className="text-xs text-muted-foreground">
            额外目录（每行一个绝对路径，可添加 aster-rust 等外部仓库）
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
            className="w-full rounded border bg-background px-2 py-1.5 text-xs min-h-16"
            placeholder="例如 /Users/coso/Documents/dev/ai/astercloud/aster-rust"
          />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-center justify-between rounded border px-3 py-2 text-xs">
            <span>跟随 @import</span>
            <input
              type="checkbox"
              checked={resolveConfig.follow_imports ?? true}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  resolve: {
                    ...normalizeResolve(prev.resolve),
                    follow_imports: event.target.checked,
                  },
                }))
              }
              className="h-4 w-4 rounded border-gray-300"
            />
          </label>

          <label className="flex items-center justify-between rounded border px-3 py-2 text-xs">
            <span>加载额外目录记忆</span>
            <input
              type="checkbox"
              checked={resolveConfig.load_additional_dirs_memory ?? false}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  resolve: {
                    ...normalizeResolve(prev.resolve),
                    load_additional_dirs_memory: event.target.checked,
                  },
                }))
              }
              className="h-4 w-4 rounded border-gray-300"
            />
          </label>
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">自动记忆（Auto Memory）</h3>
          <button
            type="button"
            onClick={handleToggleAutoImmediately}
            className="rounded border px-2 py-1 text-[11px] hover:bg-muted"
          >
            {autoConfig.enabled ? "立即关闭" : "立即开启"}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">入口文件</span>
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
              className="w-full rounded border bg-background px-2 py-1.5 text-xs"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">加载行数上限</span>
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
              className="w-full rounded border bg-background px-2 py-1.5 text-xs"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">
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
              className="w-full rounded border bg-background px-2 py-1.5 text-xs"
              placeholder="默认自动推导，可留空"
            />
          </label>
        </div>

        <div className="rounded border p-3 space-y-2">
          <div className="text-xs text-muted-foreground">写入自动记忆</div>
          <input
            type="text"
            value={autoTopic}
            onChange={(event) => setAutoTopic(event.target.value)}
            className="w-full rounded border bg-background px-2 py-1.5 text-xs"
            placeholder="可选：topic，例如 workflow"
          />
          <textarea
            value={autoNote}
            onChange={(event) => setAutoNote(event.target.value)}
            className="w-full rounded border bg-background px-2 py-1.5 text-xs min-h-20"
            placeholder="输入要写入自动记忆的内容"
          />
          <button
            type="button"
            onClick={handleUpdateAutoNote}
            disabled={savingAutoNote}
            className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {savingAutoNote ? "写入中..." : "写入自动记忆"}
          </button>
        </div>

        <div className="rounded border p-3 space-y-2">
          <div className="text-xs text-muted-foreground">
            当前索引：{autoIndex?.entry_exists ? "已存在" : "未初始化"}
            {autoIndex ? `，${autoIndex.total_lines} 行` : ""}
          </div>
          {autoIndex?.preview_lines?.length ? (
            <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words bg-muted/30 rounded p-2 max-h-44 overflow-auto">
              {autoIndex.preview_lines.join("\n")}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground">
              暂无自动记忆入口内容
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">记忆来源命中详情</h3>
          <div className="text-xs text-muted-foreground">
            {effectiveSources
              ? `命中 ${effectiveSources.loaded_sources}/${effectiveSources.total_sources}`
              : "--"}
          </div>
        </div>

        {effectiveSources ? (
          <div className="space-y-2">
            {effectiveSources.sources.map((source) => (
              <div
                key={`${source.kind}-${source.path}`}
                className="rounded border bg-background/60 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{source.kind}</span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px]",
                      source.loaded
                        ? "text-green-700 border-green-200 bg-green-50"
                        : "text-muted-foreground border-muted",
                    )}
                  >
                    {source.loaded
                      ? "已加载"
                      : source.exists
                        ? "存在未命中"
                        : "未发现"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground break-all">
                  {source.path}
                </p>
                {source.preview && (
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
                    {source.preview}
                  </p>
                )}
                {source.warnings?.length > 0 && (
                  <p className="mt-1 text-[11px] text-amber-600">
                    {source.warnings.join("；")}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            正在加载来源命中结果...
          </p>
        )}
      </div>

      {message && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {message}
        </div>
      )}
    </div>
  );
}

export default MemorySettings;
