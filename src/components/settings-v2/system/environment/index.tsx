import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Eye,
  EyeOff,
  Layers3,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Terminal,
  Trash2,
  Variable,
  type LucideIcon,
} from "lucide-react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  getConfig,
  getEnvironmentPreview,
  saveConfig,
  type Config,
  type EnvironmentConfig,
  type EnvironmentPreview,
  type EnvironmentVariableOverride,
} from "@/lib/api/appConfig";

interface SurfacePanelProps {
  icon: LucideIcon;
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
}

interface FieldBlockProps {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}

const INPUT_CLASS_NAME =
  "w-full rounded-[16px] border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-2 focus:ring-slate-200";
const SECONDARY_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";

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

function resolveShellImportMeta(status?: string) {
  switch (status) {
    case "ok":
      return {
        label: "已导入",
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    case "disabled":
      return {
        label: "已停用",
        className: "border-slate-200 bg-slate-100 text-slate-500",
      };
    case "error":
      return {
        label: "异常",
        className: "border-rose-200 bg-rose-50 text-rose-700",
      };
    default:
      return {
        label: "待检查",
        className: "border-amber-200 bg-amber-50 text-amber-700",
      };
  }
}

function formatDuration(durationMs?: number | null) {
  if (durationMs == null || durationMs < 0) {
    return "未记录";
  }
  return `${durationMs} ms`;
}

function SurfacePanel({
  icon: Icon,
  title,
  description,
  aside,
  children,
}: SurfacePanelProps) {
  return (
    <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
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
    </article>
  );
}

function FieldBlock({ label, htmlFor, hint, children }: FieldBlockProps) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-2 text-sm font-medium text-slate-900"
      >
        <span>{label}</span>
        {hint ? (
          <WorkbenchInfoTip
            ariaLabel={`${label}说明`}
            content={hint}
            tone="slate"
          />
        ) : null}
      </label>
      {children}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 pb-8">
      <div className="h-[132px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.16fr)_minmax(320px,0.84fr)]">
        <div className="space-y-6">
          <div className="h-[290px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
          <div className="h-[360px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        </div>
        <div className="space-y-6">
          <div className="h-[240px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
          <div className="h-[220px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        </div>
      </div>
      <div className="h-[360px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
    </div>
  );
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

  const summary = useMemo(() => {
    const enabledOverrides = environment.variables.filter(
      (entry) => entry.enabled && entry.key.trim(),
    ).length;
    const shellImportMeta = resolveShellImportMeta(preview?.shellImport.status);

    return {
      shellImportMeta,
      overrideCount: environment.variables.length,
      enabledOverrides,
      previewCount: preview?.entries.length ?? 0,
    };
  }, [environment.variables, preview]);

  if (loading) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="space-y-6 pb-8">
      {message ? (
        <div
          className={cn(
            "flex items-center justify-between gap-4 rounded-[20px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50/90 text-emerald-700"
              : "border-rose-200 bg-rose-50/90 text-rose-700",
          )}
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            <span>{message.text}</span>
          </div>
          {message.type === "error" ? (
            <button
              type="button"
              onClick={() => void loadPageData()}
              className="rounded-full border border-current/20 bg-white px-3 py-1.5 text-xs font-medium transition hover:bg-white/90"
            >
              重新加载
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="rounded-[26px] border border-slate-200/80 bg-white px-5 py-4 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">
                环境变量
              </h1>
              <WorkbenchInfoTip
                ariaLabel="环境变量设置总览说明"
                content="管理 Shell 导入、显式覆盖和最终环境预览；敏感值默认保持掩码，减少在设置页误暴露的风险。"
                tone="mint"
              />
            </div>
            <p className="text-sm text-slate-500">
              管理 Shell 导入、显式覆盖和最终环境预览。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <span
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium",
                summary.shellImportMeta.className,
              )}
            >
              Shell 导入：{summary.shellImportMeta.label}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
              覆盖项：{summary.enabledOverrides}/{summary.overrideCount}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
              预览变量：{summary.previewCount}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4 rounded-[20px] border border-slate-200/80 bg-slate-50/60 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                已导入 {preview?.shellImport.importedCount ?? 0} 项
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                耗时 {formatDuration(preview?.shellImport.durationMs)}
              </span>
            </div>
            <p className="text-sm leading-6 text-slate-600">
              {preview?.shellImport.message ||
                "保存后会重新计算当前统一环境层的结果。"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshPreview()}
              disabled={refreshingPreview}
              className={SECONDARY_BUTTON_CLASS_NAME}
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshingPreview ? "animate-spin" : "")}
              />
              刷新预览
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className={PRIMARY_BUTTON_CLASS_NAME}
            >
              <Save className="h-4 w-4" />
              {saving ? "保存中..." : "保存并应用"}
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.16fr)_minmax(320px,0.84fr)]">
        <div className="space-y-6">
          <SurfacePanel
            icon={Terminal}
            title="Shell 环境导入"
            description="可选地从登录 Shell 读取 PATH、代理和版本管理器环境，再与显式覆盖项合并。"
            aside={
              <span
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium",
                  summary.shellImportMeta.className,
                )}
              >
                {summary.shellImportMeta.label}
              </span>
            }
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        启用 Shell 环境导入
                      </p>
                      <WorkbenchInfoTip
                        ariaLabel="启用 Shell 环境导入说明"
                        content="适合需要继承 PATH、代理、Node 版本管理器等登录 Shell 环境的场景。"
                        tone="slate"
                      />
                    </div>
                  </div>
                  <Switch
                    aria-label="启用 Shell 环境导入"
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

              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <FieldBlock
                  label="导入超时（ms）"
                  htmlFor="environment-shell-import-timeout"
                  hint="超时后会回退为仅使用显式覆盖，不阻塞整体运行。"
                >
                  <input
                    id="environment-shell-import-timeout"
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
                    className={INPUT_CLASS_NAME}
                  />
                </FieldBlock>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-[22px] border border-slate-200/80 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">导入状态</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {preview?.shellImport.message ||
                    "尚未获取导入状态，保存后可查看最终结果。"}
                </p>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">已导入项</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                  {preview?.shellImport.importedCount ?? 0}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  当前从 Shell 收集到的环境变量数量。
                </p>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">最近耗时</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                  {formatDuration(preview?.shellImport.durationMs)}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  用于判断当前 Shell 导入是否过慢。
                </p>
              </div>
            </div>
          </SurfacePanel>

          <SurfacePanel
            icon={Variable}
            title="环境变量覆盖"
            description="显式设置或覆盖运行时环境变量，优先级高于 Shell 导入与旧入口兼容逻辑。"
            aside={
              <button
                type="button"
                onClick={addVariable}
                className={SECONDARY_BUTTON_CLASS_NAME}
              >
                <Plus className="h-4 w-4" />
                添加变量
              </button>
            }
          >
            {environment.variables.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center">
                <p className="text-sm font-medium text-slate-700">
                  暂无显式环境变量覆盖
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  当前仅使用 Shell
                  导入与业务模块推导的运行时变量，适合先观察实际生效结果。
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {environment.variables.map((entry, index) => (
                  <article
                    key={`${entry.key}-${index}`}
                    className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4"
                  >
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_180px_56px]">
                      <FieldBlock
                        label="变量名"
                        htmlFor={`environment-variable-key-${index}`}
                      >
                        <input
                          id={`environment-variable-key-${index}`}
                          type="text"
                          value={entry.key}
                          onChange={(event) =>
                            updateVariable(index, { key: event.target.value })
                          }
                          placeholder="例如 OPENAI_BASE_URL"
                          className={INPUT_CLASS_NAME}
                        />
                      </FieldBlock>

                      <FieldBlock
                        label="变量值"
                        htmlFor={`environment-variable-value-${index}`}
                      >
                        <input
                          id={`environment-variable-value-${index}`}
                          type="text"
                          value={entry.value}
                          onChange={(event) =>
                            updateVariable(index, { value: event.target.value })
                          }
                          placeholder="变量值"
                          className={INPUT_CLASS_NAME}
                        />
                      </FieldBlock>

                      <div className="flex flex-col justify-between gap-3 rounded-[18px] border border-slate-200 bg-white p-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-slate-900">
                              是否启用
                            </p>
                            <WorkbenchInfoTip
                              ariaLabel={`变量 ${index + 1} 启用说明`}
                              content="关闭后会保留该条目，但不参与最终合并。"
                              tone="slate"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                              entry.enabled
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 bg-slate-100 text-slate-500",
                            )}
                          >
                            {entry.enabled ? "已启用" : "未启用"}
                          </span>
                          <Switch
                            aria-label={`启用变量 ${index + 1}`}
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
                          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                          title="删除变量"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </SurfacePanel>
        </div>

        <div className="space-y-6">
          <SurfacePanel
            icon={Layers3}
            title="合并规则"
            description="先看清楚优先级，再决定变量应放在 Shell 里还是显式覆盖里。"
          >
            <div className="space-y-3">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      优先级 1
                    </p>
                    <WorkbenchInfoTip
                      ariaLabel="优先级 1 说明"
                      content="显式环境变量覆盖会直接覆盖同名值，适合保存代理、API Host 或调试开关。"
                      tone="slate"
                    />
                  </div>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    最终生效
                  </span>
                </div>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      优先级 2
                    </p>
                    <WorkbenchInfoTip
                      ariaLabel="优先级 2 说明"
                      content="Shell 导入负责继承登录环境里的 PATH、代理与工具链变量，适合减少重复录入。"
                      tone="slate"
                    />
                  </div>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                    补充来源
                  </span>
                </div>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      兼容入口
                    </p>
                    <WorkbenchInfoTip
                      ariaLabel="兼容入口说明"
                      content="网络搜索等旧入口仍可编辑，但最终都会回到同一份环境配置，避免来源打架。"
                      tone="slate"
                    />
                  </div>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                    已统一
                  </span>
                </div>
              </div>
            </div>
          </SurfacePanel>

          <SurfacePanel
            icon={ShieldAlert}
            title="使用提示"
            description="这页主要服务于需要稳定管理运行时环境的桌面场景。"
          >
            <div className="space-y-3">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    敏感值默认掩码
                  </p>
                  <WorkbenchInfoTip
                    ariaLabel="敏感值默认掩码说明"
                    content="预览区默认展示掩码，只有在明确点击“显示值”后才会直接显示敏感内容。"
                    tone="slate"
                  />
                </div>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    先改覆盖，再看预览
                  </p>
                  <WorkbenchInfoTip
                    ariaLabel="先改覆盖再看预览说明"
                    content="如果只是想覆盖少量变量，优先直接添加覆盖项，然后通过底部预览确认来源是否正确。"
                    tone="slate"
                  />
                </div>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    跨平台注意
                  </p>
                  <WorkbenchInfoTip
                    ariaLabel="跨平台注意说明"
                    content="Shell 导入会受到当前系统 Shell 与登录环境差异影响。若需要稳定结果，优先使用显式覆盖项。"
                    tone="slate"
                  />
                </div>
              </div>
            </div>
          </SurfacePanel>
        </div>
      </div>

      <SurfacePanel
        icon={ShieldAlert}
        title="生效预览"
        description="展示统一环境层最终提供给运行时的关键变量，以及它们当前来自哪里。"
        aside={
          <>
            <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
              {showValues ? "已显示真实值" : "敏感值默认掩码"}
            </span>
            <button
              type="button"
              onClick={() => setShowValues((prev) => !prev)}
              className={SECONDARY_BUTTON_CLASS_NAME}
            >
              {showValues ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              {showValues ? "隐藏值" : "显示值"}
            </button>
          </>
        }
      >
        {!preview || preview.entries.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center">
            <p className="text-sm font-medium text-slate-700">
              暂无可预览的环境变量
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              保存配置后会重新计算统一环境层，届时可在这里确认最终生效值与来源。
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white">
            <div className="hidden grid-cols-[220px_minmax(0,1fr)_180px] border-b border-slate-200/80 bg-slate-50/80 px-5 py-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-500 md:grid">
              <span>变量</span>
              <span>当前值</span>
              <span>来源</span>
            </div>
            <div className="divide-y divide-slate-200/80">
              {preview.entries.map((entry) => (
                <article
                  key={entry.key}
                  className="grid gap-4 px-5 py-4 md:grid-cols-[220px_minmax(0,1fr)_180px] md:items-start"
                >
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400 md:hidden">
                      变量
                    </p>
                    <p className="font-mono text-sm font-medium text-slate-900">
                      {entry.key}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400 md:hidden">
                      当前值
                    </p>
                    <p className="rounded-[16px] border border-slate-200/80 bg-slate-50/70 px-3 py-2 font-mono text-sm break-all text-slate-600">
                      {showValues || !entry.sensitive
                        ? entry.value
                        : entry.maskedValue}
                    </p>
                    {entry.overriddenSources.length > 0 ? (
                      <p className="text-xs leading-5 text-amber-600">
                        已覆盖来源：
                        {entry.overriddenSources
                          .map(formatSourceLabel)
                          .join("、")}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400 md:hidden">
                      来源
                    </p>
                    <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                      {entry.sourceLabel}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </SurfacePanel>
    </div>
  );
}
