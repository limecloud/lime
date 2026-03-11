import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Terminal,
  Trash2,
  Variable,
  Eye,
  EyeOff,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  getConfig,
  getEnvironmentPreview,
  saveConfig,
  type Config,
  type EnvironmentConfig,
  type EnvironmentPreview,
  type EnvironmentVariableOverride,
} from "@/lib/api/appConfig";

function normalizeEnvironmentConfig(config: Config | null): EnvironmentConfig {
  return {
    shell_import: {
      enabled: config?.environment?.shell_import?.enabled ?? false,
      timeout_ms: config?.environment?.shell_import?.timeout_ms ?? 1500,
    },
    variables: [...(config?.environment?.variables ?? [])],
  };
}

function createEmptyVariable(): EnvironmentVariableOverride {
  return {
    key: "",
    value: "",
    enabled: true,
  };
}

function formatSourceLabel(source: string): string {
  switch (source) {
    case "override":
      return "环境变量覆盖";
    case "shell_import":
      return "Shell 环境导入";
    case "web_search":
      return "网络搜索配置";
    default:
      return source;
  }
}

export function EnvironmentSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [preview, setPreview] = useState<EnvironmentPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingPreview, setRefreshingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showValues, setShowValues] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const environment = useMemo(
    () => normalizeEnvironmentConfig(config),
    [config],
  );

  const loadPageData = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [nextConfig, nextPreview] = await Promise.all([
        getConfig(),
        getEnvironmentPreview(),
      ]);
      setConfig(nextConfig);
      setPreview(nextPreview);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "加载环境变量配置失败",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPreview = useCallback(async () => {
    setRefreshingPreview(true);
    try {
      const nextPreview = await getEnvironmentPreview();
      setPreview(nextPreview);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "刷新环境预览失败",
      });
    } finally {
      setRefreshingPreview(false);
    }
  }, []);

  useEffect(() => {
    void loadPageData();
  }, [loadPageData]);

  const updateEnvironment = useCallback(
    (updater: (prev: EnvironmentConfig) => EnvironmentConfig) => {
      setConfig((prev) => {
        const baseConfig = prev ?? ({} as Config);
        const nextEnvironment = updater(normalizeEnvironmentConfig(prev));
        return {
          ...baseConfig,
          environment: nextEnvironment,
        };
      });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!config) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await saveConfig({
        ...config,
        environment,
      });
      const [nextConfig, nextPreview] = await Promise.all([
        getConfig(),
        getEnvironmentPreview(),
      ]);
      setConfig(nextConfig);
      setPreview(nextPreview);
      setMessage({
        type: "success",
        text: "环境变量配置已保存并应用到当前运行时",
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "保存环境变量配置失败",
      });
    } finally {
      setSaving(false);
    }
  }, [config, environment]);

  const updateVariable = useCallback(
    (index: number, patch: Partial<EnvironmentVariableOverride>) => {
      updateEnvironment((prev) => ({
        ...prev,
        variables: prev.variables.map((item, currentIndex) =>
          currentIndex === index ? { ...item, ...patch } : item,
        ),
      }));
    },
    [updateEnvironment],
  );

  const addVariable = useCallback(() => {
    updateEnvironment((prev) => ({
      ...prev,
      variables: [...prev.variables, createEmptyVariable()],
    }));
  }, [updateEnvironment]);

  const removeVariable = useCallback(
    (index: number) => {
      updateEnvironment((prev) => ({
        ...prev,
        variables: prev.variables.filter(
          (_, currentIndex) => currentIndex !== index,
        ),
      }));
    },
    [updateEnvironment],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
        正在加载环境变量配置...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Variable className="h-5 w-5 text-primary" />
              <h3 className="text-base font-semibold">统一环境变量控制</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              按 Shell
              环境导入与显式环境变量覆盖统一管理运行时环境。模型、搜索和
              OpenClaw 等模块只消费这里的结果，不再各自维护独立环境逻辑。
            </p>
            <p className="text-xs text-muted-foreground">
              兼容说明：旧入口仍可编辑，但底层已统一写入同一份环境配置。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshPreview()}
              disabled={refreshingPreview}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshingPreview ? "animate-spin" : ""}`}
              />
              刷新预览
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? "保存中..." : "保存并应用"}
            </button>
          </div>
        </div>
      </div>

      {message ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <section className="rounded-xl border bg-card">
        <div className="border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-primary" />
            <h4 className="font-semibold">Shell 环境导入</h4>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            可选地从登录 Shell 读取 PATH、代理等环境变量，再与显式覆盖项合并。
          </p>
        </div>
        <div className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_220px]">
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">启用 Shell 环境导入</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  适合需要继承登录 Shell 中 PATH、代理、Node
                  版本管理器配置的场景。
                </p>
              </div>
              <Switch
                checked={environment.shell_import.enabled}
                onCheckedChange={(checked) =>
                  updateEnvironment((prev) => ({
                    ...prev,
                    shell_import: {
                      ...prev.shell_import,
                      enabled: checked,
                    },
                  }))
                }
              />
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <label className="mb-2 block text-sm font-medium">
              导入超时（ms）
            </label>
            <input
              type="number"
              min={100}
              max={30000}
              step={100}
              value={environment.shell_import.timeout_ms}
              onChange={(event) =>
                updateEnvironment((prev) => ({
                  ...prev,
                  shell_import: {
                    ...prev.shell_import,
                    timeout_ms: Math.min(
                      30000,
                      Math.max(
                        100,
                        Number.parseInt(event.target.value, 10) || 1500,
                      ),
                    ),
                  },
                }))
              }
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              超时后会回退为仅使用显式覆盖，不阻塞整体运行。
            </p>
          </div>
        </div>
        {preview ? (
          <div className="border-t px-5 py-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">当前状态：</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  preview.shellImport.status === "ok"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                    : preview.shellImport.status === "disabled"
                      ? "bg-muted text-muted-foreground"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                }`}
              >
                {preview.shellImport.status}
              </span>
              <span className="text-muted-foreground">
                {preview.shellImport.message}
              </span>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border bg-card">
        <div className="border-b px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Variable className="h-5 w-5 text-primary" />
                <h4 className="font-semibold">环境变量覆盖</h4>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                显式设置或覆盖运行时环境变量。这里的配置优先级高于 Shell
                导入与旧入口兼容逻辑。
              </p>
            </div>
            <button
              type="button"
              onClick={addVariable}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
            >
              <Plus className="h-4 w-4" />
              添加变量
            </button>
          </div>
        </div>
        <div className="space-y-3 px-5 py-4">
          {environment.variables.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              暂无显式环境变量覆盖，当前仅使用 Shell
              导入与业务模块推导的运行时变量。
            </div>
          ) : (
            environment.variables.map((entry, index) => (
              <div
                key={`${entry.key}-${index}`}
                className="grid gap-3 rounded-lg border p-4 lg:grid-cols-[140px_1fr_160px_56px]"
              >
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-muted-foreground">
                    变量名
                  </label>
                  <input
                    type="text"
                    value={entry.key}
                    onChange={(event) =>
                      updateVariable(index, { key: event.target.value })
                    }
                    placeholder="例如 OPENAI_BASE_URL"
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-muted-foreground">
                    变量值
                  </label>
                  <input
                    type="text"
                    value={entry.value}
                    onChange={(event) =>
                      updateVariable(index, { value: event.target.value })
                    }
                    placeholder="变量值"
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex items-end justify-between gap-3 lg:justify-start">
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-muted-foreground">
                      启用
                    </label>
                    <Switch
                      checked={entry.enabled}
                      onCheckedChange={(checked) =>
                        updateVariable(index, { enabled: checked })
                      }
                    />
                  </div>
                </div>
                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    onClick={() => removeVariable(index)}
                    className="rounded-lg border p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="删除变量"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-xl border bg-card">
        <div className="border-b px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-primary" />
                <h4 className="font-semibold">生效预览</h4>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                展示当前统一环境层最终提供给运行时的关键变量，以及它们的来源。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowValues((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
            >
              {showValues ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              {showValues ? "隐藏值" : "显示值"}
            </button>
          </div>
        </div>
        <div className="px-5 py-4">
          {!preview || preview.entries.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              暂无可预览的环境变量。
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[220px_1fr_160px] border-b bg-muted/40 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span>变量</span>
                <span>当前值</span>
                <span>来源</span>
              </div>
              <div className="divide-y">
                {preview.entries.map((entry) => (
                  <div
                    key={entry.key}
                    className="grid grid-cols-[220px_1fr_160px] items-start gap-3 px-4 py-3 text-sm"
                  >
                    <div className="font-mono font-medium">{entry.key}</div>
                    <div className="space-y-1">
                      <div className="font-mono break-all text-muted-foreground">
                        {showValues || !entry.sensitive
                          ? entry.value
                          : entry.maskedValue}
                      </div>
                      {entry.overriddenSources.length > 0 ? (
                        <div className="text-xs text-amber-600 dark:text-amber-300">
                          已覆盖来源：
                          {entry.overriddenSources
                            .map(formatSourceLabel)
                            .join("、")}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {entry.sourceLabel}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
