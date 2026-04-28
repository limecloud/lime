/**
 * @file ExperimentalSettings.tsx
 * @description 实验室设置页面 - 管理实验性功能的开关和配置
 * @module components/settings-v2/system/experimental
 *
 * 需求: 6.1, 6.2, 6.3, 6.5 - 实验室标签页，截图对话功能开关，快捷键设置，权限警告
 */

import {
  Suspense,
  lazy,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  Globe,
  AlertCircle,
  Camera,
  AlertTriangle,
  RefreshCw,
  Bug,
  Wrench,
  ShieldAlert,
  Sparkles,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getConfig,
  saveConfig,
  type Config,
  type CrashReportingConfig,
  type ToolCallingConfig,
} from "@/lib/api/appConfig";
import {
  DEFAULT_EXPERIMENTAL_FEATURES,
  getExperimentalConfig,
  saveExperimentalConfig,
  updateScreenshotShortcut,
  validateShortcut,
  type ExperimentalFeatures,
} from "@/lib/api/experimentalFeatures";
import { getLogs, getPersistedLogsTail } from "@/lib/api/logs";
import {
  getLogStorageDiagnostics,
  getServerDiagnostics,
  getWindowsStartupDiagnostics,
} from "@/lib/api/serverRuntime";
import { applyCrashReportingSettings } from "@/lib/crashReporting";
import {
  buildCrashDiagnosticPayload,
  collectRuntimeSnapshotForDiagnostic,
  collectGeneralWorkbenchDocumentStateForDiagnostic,
  copyCrashDiagnosticJsonToClipboard,
  copyCrashDiagnosticToClipboard,
  DEFAULT_CRASH_REPORTING_CONFIG,
  exportCrashDiagnosticToJson,
  isClipboardPermissionDeniedError,
  normalizeCrashReportingConfig,
  openCrashDiagnosticDownloadDirectory,
} from "@/lib/crashDiagnostic";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_TOOL_CALLING_CONFIG,
  normalizeToolCallingConfig,
} from "./tool-calling-config";

const ShortcutSettings = lazy(() =>
  import("@/components/smart-input/ShortcutSettings").then((module) => ({
    default: module.ShortcutSettings,
  })),
);
const UpdateCheckSettings = lazy(() =>
  import("./UpdateCheckSettings").then((module) => ({
    default: module.UpdateCheckSettings,
  })),
);
const ClipboardPermissionGuideCard = lazy(() =>
  import("../shared/ClipboardPermissionGuideCard").then((module) => ({
    default: module.ClipboardPermissionGuideCard,
  })),
);
const WorkspaceRepairHistoryCard = lazy(() =>
  import("../shared/WorkspaceRepairHistoryCard").then((module) => ({
    default: module.WorkspaceRepairHistoryCard,
  })),
);

// ============================================================
// 组件
// ============================================================

interface SurfacePanelProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
  aside?: ReactNode;
}

function SurfacePanel({
  icon: Icon,
  title,
  description,
  children,
  aside,
}: SurfacePanelProps) {
  return (
    <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Icon className="h-4 w-4 text-sky-600" />
            {title}
          </div>
          {description ? (
            <p className="text-sm leading-6 text-slate-500">{description}</p>
          ) : null}
        </div>
        {aside ? (
          <div className="flex flex-wrap items-center gap-2">{aside}</div>
        ) : null}
      </div>

      <div className="mt-5">{children}</div>
    </article>
  );
}

function CompactSwitchRow({
  title,
  description,
  checked,
  disabled,
  ariaLabel,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[22px] border border-slate-200/80 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="text-sm leading-6 text-slate-500">{description}</p>
      </div>
      <Switch
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(Boolean(value))}
      />
    </div>
  );
}

function AdvancedDetails({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-sky-100 bg-sky-50 text-sky-700">
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">
              {title}
            </span>
            <span className="block truncate text-sm text-slate-500">
              {description}
            </span>
          </span>
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500 transition group-open:bg-slate-950 group-open:text-white">
          展开
        </span>
      </summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  );
}

const SECONDARY_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full border border-slate-950 bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-slate-950/15 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";
const FIELD_CLASS_NAME =
  "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm shadow-slate-950/5 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200";

function DeferredPanelFallback({ label }: { label: string }) {
  return (
    <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-500">
      正在准备{label}...
    </div>
  );
}

export function ExperimentalSettings() {
  // 状态
  const [config, setConfig] = useState<ExperimentalFeatures | null>(null);
  const [toolCallingConfig, setToolCallingConfig] = useState<ToolCallingConfig>(
    DEFAULT_TOOL_CALLING_CONFIG,
  );
  const [crashConfig, setCrashConfig] = useState<CrashReportingConfig>(
    DEFAULT_CRASH_REPORTING_CONFIG,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showClipboardGuide, setShowClipboardGuide] = useState(false);

  // 检测是否为 macOS（使用 userAgentData 或 userAgent 替代已弃用的 platform）
  const isMacOS = navigator.userAgent.includes("Mac");

  // 加载配置
  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [experimentalConfig, fullConfig] = await Promise.all([
        getExperimentalConfig(),
        getConfig(),
      ]);
      setConfig(experimentalConfig);
      setToolCallingConfig(normalizeToolCallingConfig(fullConfig.tool_calling));
      setCrashConfig(normalizeCrashReportingConfig(fullConfig.crash_reporting));
    } catch (err) {
      console.error("加载实验室配置失败:", err);
      setError(err instanceof Error ? err.message : "加载配置失败");
      setConfig(DEFAULT_EXPERIMENTAL_FEATURES);
      setCrashConfig(DEFAULT_CRASH_REPORTING_CONFIG);
      setToolCallingConfig(DEFAULT_TOOL_CALLING_CONFIG);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // 切换截图对话功能开关
  const handleToggleSmartInput = useCallback(async () => {
    if (!config) return;

    const newEnabled = !config.screenshot_chat.enabled;
    const newConfig: ExperimentalFeatures = {
      ...config,
      screenshot_chat: {
        ...config.screenshot_chat,
        enabled: newEnabled,
      },
    };

    setSaving(true);
    setMessage(null);

    try {
      await saveExperimentalConfig(newConfig);
      setConfig(newConfig);
      setMessage({
        type: "success",
        text: newEnabled ? "截图对话功能已启用" : "截图对话功能已禁用",
      });
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      console.error("保存配置失败:", err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "保存失败",
      });
    } finally {
      setSaving(false);
    }
  }, [config]);

  const handleToggleWebMcp = useCallback(async () => {
    if (!config) return;

    const newEnabled = !(config.webmcp?.enabled ?? false);
    const newConfig: ExperimentalFeatures = {
      ...config,
      webmcp: {
        enabled: newEnabled,
      },
    };

    setSaving(true);
    setMessage(null);

    try {
      await saveExperimentalConfig(newConfig);
      setConfig(newConfig);
      setMessage({
        type: "success",
        text: newEnabled ? "WebMCP 预留入口已启用" : "WebMCP 预留入口已禁用",
      });
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      console.error("保存 WebMCP 配置失败:", err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "保存失败",
      });
    } finally {
      setSaving(false);
    }
  }, [config]);

  // 更新快捷键
  const handleShortcutChange = useCallback(
    async (newShortcut: string) => {
      if (!config) return;

      await updateScreenshotShortcut(newShortcut);
      setConfig({
        ...config,
        screenshot_chat: {
          ...config.screenshot_chat,
          shortcut: newShortcut,
        },
      });
      setMessage({ type: "success", text: "快捷键已更新" });
      setTimeout(() => setMessage(null), 2000);
    },
    [config],
  );

  // 验证快捷键
  const handleValidateShortcut = useCallback(async (shortcut: string) => {
    try {
      return await validateShortcut(shortcut);
    } catch {
      return false;
    }
  }, []);

  const persistToolCallingConfig = useCallback(
    async (next: ToolCallingConfig, successText: string) => {
      setSaving(true);
      setMessage(null);
      try {
        const latestConfig = await getConfig();
        const updatedConfig: Config = {
          ...latestConfig,
          tool_calling: next,
        };
        await saveConfig(updatedConfig);
        setToolCallingConfig(next);
        setMessage({ type: "success", text: successText });
        setTimeout(() => setMessage(null), 2000);
      } catch (err) {
        console.error("保存 Tool Calling 配置失败:", err);
        setMessage({
          type: "error",
          text:
            err instanceof Error ? err.message : "保存 Tool Calling 配置失败",
        });
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const handleToggleToolCallingEnabled = useCallback(() => {
    const next = {
      ...toolCallingConfig,
      enabled: !toolCallingConfig.enabled,
    };
    void persistToolCallingConfig(
      next,
      next.enabled ? "Tool Calling 2.0 已启用" : "Tool Calling 2.0 已禁用",
    );
  }, [persistToolCallingConfig, toolCallingConfig]);

  const handleToggleDynamicFiltering = useCallback(() => {
    const next = {
      ...toolCallingConfig,
      dynamic_filtering: !toolCallingConfig.dynamic_filtering,
    };
    void persistToolCallingConfig(
      next,
      next.dynamic_filtering ? "动态过滤已启用" : "动态过滤已禁用",
    );
  }, [persistToolCallingConfig, toolCallingConfig]);

  const handleToggleNativeInputExamples = useCallback(() => {
    const next = {
      ...toolCallingConfig,
      native_input_examples: !toolCallingConfig.native_input_examples,
    };
    void persistToolCallingConfig(
      next,
      next.native_input_examples
        ? "原生 input_examples 透传已启用"
        : "原生 input_examples 透传已禁用",
    );
  }, [persistToolCallingConfig, toolCallingConfig]);

  const persistCrashConfig = useCallback(async (next: CrashReportingConfig) => {
    setSaving(true);
    setMessage(null);
    try {
      const latestConfig = await getConfig();
      const normalized = normalizeCrashReportingConfig(next);
      const updatedConfig: Config = {
        ...latestConfig,
        crash_reporting: normalized,
      };
      await saveConfig(updatedConfig);
      await applyCrashReportingSettings(normalized);
      setCrashConfig(normalized);
      setMessage({ type: "success", text: "崩溃上报配置已更新" });
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      console.error("保存崩溃上报配置失败:", err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "保存崩溃上报配置失败",
      });
    } finally {
      setSaving(false);
    }
  }, []);

  const handleCrashEnabledToggle = useCallback(() => {
    const nextConfig = {
      ...crashConfig,
      enabled: !crashConfig.enabled,
    };
    void persistCrashConfig(nextConfig);
  }, [crashConfig, persistCrashConfig]);

  const handleCrashFieldChange = useCallback(
    (
      field: keyof CrashReportingConfig,
      value: string | boolean | number | null,
    ) => {
      setCrashConfig((previous) => ({
        ...previous,
        [field]: value,
      }));
    },
    [],
  );

  const handleSaveCrashConfig = useCallback(() => {
    void persistCrashConfig(crashConfig);
  }, [crashConfig, persistCrashConfig]);

  const buildDiagnosticPayload = useCallback(async () => {
    const [
      logs,
      persistedLogs,
      generalWorkbenchDocumentState,
      serverDiagnostics,
      logStorageDiagnostics,
      windowsStartupDiagnostics,
      runtimeSnapshotResult,
    ] = await Promise.all([
      getLogs(),
      getPersistedLogsTail(200),
      collectGeneralWorkbenchDocumentStateForDiagnostic(),
      getServerDiagnostics().catch(() => null),
      getLogStorageDiagnostics().catch(() => null),
      getWindowsStartupDiagnostics().catch(() => null),
      collectRuntimeSnapshotForDiagnostic(),
    ]);
    return buildCrashDiagnosticPayload({
      crashConfig,
      logs,
      persistedLogTail: persistedLogs,
      collectionNotes: runtimeSnapshotResult.collectionNotes,
      generalWorkbenchDocumentState,
      serverDiagnostics,
      logStorageDiagnostics,
      windowsStartupDiagnostics,
      runtimeSnapshot: runtimeSnapshotResult.runtimeSnapshot,
      appVersion: import.meta.env.VITE_APP_VERSION,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
    });
  }, [crashConfig]);

  const copyCrashDiagnostic = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      const payload = await buildDiagnosticPayload();
      await copyCrashDiagnosticToClipboard(payload);
      setMessage({
        type: "success",
        text: "诊断信息已复制，可直接发给开发者",
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      console.error("复制诊断信息失败:", err);
      const isPermissionDenied = isClipboardPermissionDeniedError(err);
      setShowClipboardGuide(isPermissionDenied);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "复制诊断信息失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, [buildDiagnosticPayload]);

  const copyCrashDiagnosticJson = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      const payload = await buildDiagnosticPayload();
      await copyCrashDiagnosticJsonToClipboard(payload);
      setMessage({
        type: "success",
        text: "纯 JSON 诊断信息已复制",
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      console.error("复制纯 JSON 失败:", err);
      const isPermissionDenied = isClipboardPermissionDeniedError(err);
      setShowClipboardGuide(isPermissionDenied);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "复制纯 JSON 失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, [buildDiagnosticPayload]);

  const exportCrashDiagnostic = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      const payload = await buildDiagnosticPayload();
      const result = exportCrashDiagnosticToJson(payload, {
        sceneTag: "settings-experimental",
      });
      let openedPath: string | null = null;
      try {
        const opened = await openCrashDiagnosticDownloadDirectory();
        openedPath = opened.openedPath;
      } catch {
        openedPath = null;
      }
      setMessage({
        type: "success",
        text: openedPath
          ? `诊断文件已导出：${result.fileName}，并已打开目录：${openedPath}`
          : `诊断文件已导出：${result.fileName}（位置：${result.locationHint}）`,
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      console.error("导出诊断信息失败:", err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "导出诊断信息失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, [buildDiagnosticPayload]);

  const openCrashDownloadDirectory = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      const result = await openCrashDiagnosticDownloadDirectory();
      setMessage({
        type: "success",
        text: `已打开下载目录：${result.openedPath}`,
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      console.error("打开下载目录失败:", err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "打开下载目录失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 pb-8">
        <div className="h-[228px] animate-pulse rounded-[30px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(244,251,248,0.98)_0%,rgba(248,250,252,0.98)_45%,rgba(241,246,255,0.96)_100%)]" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)]">
          <div className="h-[320px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
          <div className="h-[320px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        </div>
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="rounded-[26px] border border-rose-200 bg-rose-50/80 p-5 shadow-sm shadow-slate-950/5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-600" />
          <div>
            <p className="text-sm font-semibold text-rose-700">加载配置失败</p>
            <p className="mt-1 text-sm leading-6 text-rose-600">{error}</p>
            <button
              type="button"
              onClick={() => void loadConfig()}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100/70"
            >
              <RefreshCw className="h-4 w-4" />
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  const busyLabel = saving ? "保存中" : diagnosticBusy ? "诊断执行中" : null;

  return (
    <div className="space-y-5 pb-8">
      {message && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-[20px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50/90 text-emerald-700"
              : "border-rose-200 bg-rose-50/90 text-rose-700",
          )}
        >
          <AlertCircle className="h-4 w-4" />
          {message.text}
        </div>
      )}

      <section className="rounded-[26px] border border-slate-200/80 bg-white px-5 py-4 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-1.5">
            <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">
              实验功能
            </h1>
            <p className="text-sm text-slate-500">
              不稳定能力集中开关，用完及时关回。
            </p>
          </div>

          {busyLabel ? (
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                {busyLabel}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.96fr)_minmax(360px,1.04fr)]">
        <div className="space-y-5">
          <SurfacePanel
            icon={Wrench}
            title="Tool Calling 2.0"
            description="控制工具调用、动态过滤和 input examples。"
          >
            <div className="space-y-3">
              <CompactSwitchRow
                title="启用 Tool Calling 2.0"
                description="使用新的工具调用策略。"
                checked={toolCallingConfig.enabled}
                onCheckedChange={handleToggleToolCallingEnabled}
                disabled={saving}
                ariaLabel="切换 Tool Calling 2.0"
              />

              <div className="grid gap-3 md:grid-cols-2">
                <CompactSwitchRow
                  title="动态过滤"
                  description="过滤网页抓取噪音。"
                  checked={toolCallingConfig.dynamic_filtering}
                  onCheckedChange={handleToggleDynamicFiltering}
                  disabled={saving || !toolCallingConfig.enabled}
                  ariaLabel="切换动态过滤"
                />

                <CompactSwitchRow
                  title="原生 input examples"
                  description="向支持的协议透传示例。"
                  checked={toolCallingConfig.native_input_examples}
                  onCheckedChange={handleToggleNativeInputExamples}
                  disabled={saving || !toolCallingConfig.enabled}
                  ariaLabel="切换原生 input examples 透传"
                />
              </div>
            </div>
          </SurfacePanel>

          <SurfacePanel
            icon={Camera}
            title="截图对话"
            description="用快捷键截图后进入对话。"
          >
            <div className="space-y-3">
              <CompactSwitchRow
                title="启用截图对话"
                description="开启后可用全局快捷键唤起截图。"
                checked={config?.screenshot_chat.enabled ?? false}
                onCheckedChange={handleToggleSmartInput}
                disabled={saving}
                ariaLabel="切换截图对话"
              />

              {config?.screenshot_chat.enabled ? (
                <div className="rounded-[22px] border border-slate-200/80 bg-slate-50 p-4">
                  <Suspense
                    fallback={<DeferredPanelFallback label="截图快捷键设置" />}
                  >
                    <ShortcutSettings
                      currentShortcut={config.screenshot_chat.shortcut}
                      onShortcutChange={handleShortcutChange}
                      onValidate={handleValidateShortcut}
                      disabled={saving}
                    />
                  </Suspense>
                </div>
              ) : null}

              {isMacOS && config?.screenshot_chat.enabled ? (
                <div className="rounded-[22px] border border-amber-200 bg-amber-50/85 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">
                        需要屏幕录制权限
                      </p>
                      <p className="mt-1 text-sm leading-6 text-amber-700">
                        如果截图只显示桌面背景而不是窗口内容，通常说明系统尚未授予屏幕录制权限。
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const { open } =
                              await import("@tauri-apps/plugin-shell");
                            await open(
                              "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
                            );
                          } catch (e) {
                            console.error("打开系统设置失败:", e);
                          }
                        }}
                        className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
                      >
                        打开系统设置
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </SurfacePanel>
        </div>

        <div className="space-y-5">
          <AdvancedDetails
            icon={Globe}
            title="WebMCP（预留）"
            description="仅保留配置位，当前不切换执行链。"
          >
            <CompactSwitchRow
              title="允许未来接入 WebMCP"
              description="开启后只写入配置，不改变浏览器执行路径。"
              checked={config?.webmcp?.enabled ?? false}
              onCheckedChange={handleToggleWebMcp}
              disabled={saving}
              ariaLabel="切换 WebMCP 预留入口"
            />
          </AdvancedDetails>

          <AdvancedDetails
            icon={Bug}
            title="崩溃上报与诊断"
            description="复制诊断包，或配置远端崩溃上报。"
          >
            <div className="space-y-3">
              <CompactSwitchRow
                title="启用崩溃上报"
                description="DSN 为空时仅保留本地诊断。"
                checked={Boolean(crashConfig.enabled)}
                onCheckedChange={handleCrashEnabledToggle}
                disabled={saving}
                ariaLabel="切换崩溃上报"
              />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium text-slate-700">
                    DSN
                  </label>
                  <input
                    value={crashConfig.dsn ?? ""}
                    onChange={(event) =>
                      handleCrashFieldChange("dsn", event.target.value || null)
                    }
                    disabled={saving}
                    placeholder="https://xxx@o0.ingest.sentry.io/0"
                    className={FIELD_CLASS_NAME}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">
                    Environment
                  </label>
                  <input
                    value={crashConfig.environment ?? "production"}
                    onChange={(event) =>
                      handleCrashFieldChange("environment", event.target.value)
                    }
                    disabled={saving}
                    className={FIELD_CLASS_NAME}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">
                    采样率 (0-1)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={Number(crashConfig.sample_rate ?? 1)}
                    onChange={(event) =>
                      handleCrashFieldChange(
                        "sample_rate",
                        Number(event.target.value || 1),
                      )
                    }
                    disabled={saving}
                    className={FIELD_CLASS_NAME}
                  />
                </div>
              </div>

              <CompactSwitchRow
                title="发送默认 PII 字段"
                description="默认关闭，仅排障需要时打开。"
                checked={Boolean(crashConfig.send_pii)}
                onCheckedChange={(checked) =>
                  handleCrashFieldChange("send_pii", checked)
                }
                disabled={saving}
                ariaLabel="切换发送默认 PII 字段"
              />

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void copyCrashDiagnostic()}
                  disabled={saving || diagnosticBusy}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  <Bug className="h-4 w-4" />
                  复制诊断信息
                </button>
                <button
                  type="button"
                  onClick={() => void copyCrashDiagnosticJson()}
                  disabled={saving || diagnosticBusy}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  <Sparkles className="h-4 w-4" />
                  复制纯 JSON
                </button>
                <button
                  type="button"
                  onClick={() => void exportCrashDiagnostic()}
                  disabled={saving || diagnosticBusy}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  <FolderOpen className="h-4 w-4" />
                  导出诊断 JSON
                </button>
                <button
                  type="button"
                  onClick={() => void openCrashDownloadDirectory()}
                  disabled={saving || diagnosticBusy}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  <FolderOpen className="h-4 w-4" />
                  打开下载目录
                </button>
                <button
                  type="button"
                  onClick={handleSaveCrashConfig}
                  disabled={saving || diagnosticBusy}
                  className={PRIMARY_BUTTON_CLASS_NAME}
                >
                  保存配置
                </button>
              </div>
            </div>
          </AdvancedDetails>

          {showClipboardGuide ? (
            <SurfacePanel
              icon={ShieldAlert}
              title="剪贴板权限指引"
              description="复制诊断失败时按系统提示恢复。"
            >
              <Suspense
                fallback={<DeferredPanelFallback label="剪贴板权限指引" />}
              >
                <ClipboardPermissionGuideCard />
              </Suspense>
            </SurfacePanel>
          ) : null}

          <AdvancedDetails
            icon={RefreshCw}
            title="更新提醒"
            description="检查自动更新与提醒配置。"
          >
            <Suspense fallback={<DeferredPanelFallback label="更新提醒设置" />}>
              <UpdateCheckSettings />
            </Suspense>
          </AdvancedDetails>

          <AdvancedDetails
            icon={ShieldAlert}
            title="Workspace 自愈记录"
            description="查看最近自动修复和迁移动作。"
          >
            <Suspense
              fallback={<DeferredPanelFallback label="Workspace 自愈记录" />}
            >
              <WorkspaceRepairHistoryCard
                className="rounded-[22px] border-slate-200/80 bg-white p-4"
                description="最近自动修复/迁移记录"
              />
            </Suspense>
          </AdvancedDetails>
        </div>
      </div>
    </div>
  );
}
