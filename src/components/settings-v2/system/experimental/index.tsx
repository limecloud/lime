/**
 * @file ExperimentalSettings.tsx
 * @description 实验室设置页面 - 管理实验性功能的开关和配置
 * @module components/settings-v2/system/experimental
 *
 * 需求: 6.1, 6.2, 6.3, 6.5 - 实验室标签页，截图对话功能开关，快捷键设置，权限警告
 */

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import {
  Globe,
  AlertCircle,
  FlaskConical,
  Camera,
  AlertTriangle,
  RefreshCw,
  Bug,
  Wrench,
  Mic,
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
import { ShortcutSettings } from "@/components/smart-input/ShortcutSettings";
import { UpdateCheckSettings } from "./UpdateCheckSettings";
import { VoiceSettings } from "@/components/voice";
import {
  getVoiceInputConfig,
  saveVoiceInputConfig,
  VoiceInputConfig,
} from "@/lib/api/asrProvider";
import { applyCrashReportingSettings } from "@/lib/crashReporting";
import {
  buildCrashDiagnosticPayload,
  collectRuntimeSnapshotForDiagnostic,
  collectThemeWorkbenchDocumentStateForDiagnostic,
  copyCrashDiagnosticJsonToClipboard,
  copyCrashDiagnosticToClipboard,
  DEFAULT_CRASH_REPORTING_CONFIG,
  exportCrashDiagnosticToJson,
  isClipboardPermissionDeniedError,
  normalizeCrashReportingConfig,
  openCrashDiagnosticDownloadDirectory,
} from "@/lib/crashDiagnostic";
import { ClipboardPermissionGuideCard } from "../shared/ClipboardPermissionGuideCard";
import { WorkspaceRepairHistoryCard } from "../shared/WorkspaceRepairHistoryCard";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_TOOL_CALLING_CONFIG,
  normalizeToolCallingConfig,
} from "./tool-calling-config";

// ============================================================
// 组件
// ============================================================

interface ExperimentalPanelProps {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
  aside?: ReactNode;
}

function ExperimentalPanel({
  icon: Icon,
  title,
  description,
  children,
  aside,
}: ExperimentalPanelProps) {
  return (
    <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Icon className="h-4 w-4 text-sky-600" />
            {title}
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
        {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
      </div>

      <div className="mt-5">{children}</div>
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
    <div className="rounded-[22px] border border-white/90 bg-white/86 p-4 shadow-sm">
      <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function StatusPill({
  active,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium",
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-100 text-slate-500",
      )}
    >
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}

const SECONDARY_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";
const FIELD_CLASS_NAME =
  "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm shadow-slate-950/5 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200";

export function ExperimentalSettings() {
  // 状态
  const [config, setConfig] = useState<ExperimentalFeatures | null>(null);
  const [toolCallingConfig, setToolCallingConfig] = useState<ToolCallingConfig>(
    DEFAULT_TOOL_CALLING_CONFIG,
  );
  const [voiceConfig, setVoiceConfig] = useState<VoiceInputConfig | null>(null);
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
      const [experimentalConfig, voiceInputConfig, fullConfig] =
        await Promise.all([
          getExperimentalConfig(),
          getVoiceInputConfig(),
          getConfig(),
        ]);
      setConfig(experimentalConfig);
      setToolCallingConfig(normalizeToolCallingConfig(fullConfig.tool_calling));
      setVoiceConfig(voiceInputConfig);
      setCrashConfig(normalizeCrashReportingConfig(fullConfig.crash_reporting));
    } catch (err) {
      console.error("加载实验室配置失败:", err);
      setError(err instanceof Error ? err.message : "加载配置失败");
      setConfig(DEFAULT_EXPERIMENTAL_FEATURES);
      setVoiceConfig({
        enabled: false,
        shortcut: "CommandOrControl+Shift+V",
        processor: {
          polish_enabled: true,
          default_instruction_id: "default",
        },
        output: {
          mode: "type",
          type_delay_ms: 10,
        },
        instructions: [],
        sound_enabled: true,
        translate_instruction_id: "default",
      });
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

  // 更新语音输入配置
  const handleVoiceConfigChange = useCallback(
    async (newConfig: VoiceInputConfig) => {
      setSaving(true);
      setMessage(null);
      try {
        await saveVoiceInputConfig(newConfig);
        setVoiceConfig(newConfig);
        setMessage({
          type: "success",
          text: newConfig.enabled ? "语音输入功能已启用" : "语音输入功能已禁用",
        });
        setTimeout(() => setMessage(null), 2000);
      } catch (err) {
        console.error("保存语音配置失败:", err);
        setMessage({
          type: "error",
          text: err instanceof Error ? err.message : "保存失败",
        });
      } finally {
        setSaving(false);
      }
    },
    [],
  );

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
      themeWorkbenchDocumentState,
      serverDiagnostics,
      logStorageDiagnostics,
      windowsStartupDiagnostics,
      runtimeSnapshotResult,
    ] = await Promise.all([
      getLogs(),
      getPersistedLogsTail(200),
      collectThemeWorkbenchDocumentStateForDiagnostic(),
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
      themeWorkbenchDocumentState,
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

  const summary = useMemo(
    () => ({
      toolCallingLabel: toolCallingConfig.enabled ? "已启用" : "未启用",
      screenshotLabel: config?.screenshot_chat.enabled ? "已启用" : "未启用",
      voiceLabel: voiceConfig?.enabled ? "已启用" : "未启用",
      crashLabel: crashConfig.enabled ? "已启用" : "未启用",
    }),
    [
      config?.screenshot_chat.enabled,
      crashConfig.enabled,
      toolCallingConfig.enabled,
      voiceConfig?.enabled,
    ],
  );

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

  return (
    <div className="space-y-6 pb-8">
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

      <section className="relative overflow-hidden rounded-[30px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(244,251,248,0.98)_0%,rgba(248,250,252,0.98)_45%,rgba(241,246,255,0.96)_100%)] shadow-sm shadow-slate-950/5">
        <div className="pointer-events-none absolute -left-20 top-[-72px] h-56 w-56 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="pointer-events-none absolute right-[-76px] top-[-24px] h-56 w-56 rounded-full bg-sky-200/28 blur-3xl" />

        <div className="relative flex flex-col gap-6 p-6 lg:p-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
            <div className="max-w-3xl space-y-5">
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 shadow-sm">
                EXPERIMENT LAB
              </span>
              <div className="space-y-2">
                <p className="text-[28px] font-semibold tracking-tight text-slate-900">
                  把还在试验中的能力统一放到一处管理，但不要把风险提示藏起来
                </p>
                <p className="max-w-2xl text-sm leading-7 text-slate-600">
                  实验功能的重点不是堆更多开关，而是明确告诉你哪些能力正在变化、哪些配置和诊断动作应该优先验证。
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-white/90 bg-white/88 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                  建议先在个人环境验证后再推广给团队
                </span>
                <span className="rounded-full border border-white/90 bg-white/88 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                  诊断动作会采集日志、运行态快照与系统自检信息
                </span>
                <span className="rounded-full border border-white/90 bg-white/88 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                  屏幕录制、剪贴板等权限问题会在本页集中提示
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
              <SummaryStat
                label="Tool Calling"
                value={summary.toolCallingLabel}
                description="控制编程式工具调用与动态过滤链路。"
              />
              <SummaryStat
                label="截图对话"
                value={summary.screenshotLabel}
                description="决定是否允许通过全局快捷键进入截图问答流程。"
              />
              <SummaryStat
                label="语音输入"
                value={summary.voiceLabel}
                description="实验语音链路是否已启用并允许快捷键输入。"
              />
              <SummaryStat
                label="崩溃上报"
                value={summary.crashLabel}
                description="控制 Sentry 上报和诊断导出相关能力。"
              />
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-[24px] border border-white/90 bg-white/80 p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                active={toolCallingConfig.enabled}
                activeLabel="Tool Calling 已启用"
                inactiveLabel="Tool Calling 未启用"
              />
              <StatusPill
                active={Boolean(config?.screenshot_chat.enabled)}
                activeLabel="截图对话已启用"
                inactiveLabel="截图对话未启用"
              />
              <StatusPill
                active={Boolean(config?.webmcp?.enabled)}
                activeLabel="WebMCP 预留已启用"
                inactiveLabel="WebMCP 预留未启用"
              />
              <StatusPill
                active={Boolean(crashConfig.enabled)}
                activeLabel="崩溃上报已启用"
                inactiveLabel="崩溃上报未启用"
              />
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                {saving ? "保存中" : diagnosticBusy ? "诊断执行中" : "当前空闲"}
              </span>
            </div>
            <p className="text-sm leading-6 text-slate-600">
              先确认是否真的需要启用实验能力，再决定是否导出完整诊断包；这样更容易控制噪音范围。
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)]">
        <div className="space-y-6">
          <ExperimentalPanel
            icon={Wrench}
            title="Tool Calling 2.0"
            description="控制编程式工具调用、动态过滤和 input examples 透传。"
            aside={
              <StatusPill
                active={toolCallingConfig.enabled}
                activeLabel="已启用"
                inactiveLabel="未启用"
              />
            }
          >
            <div className="space-y-4">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4 text-sm leading-6 text-slate-500">
                这部分更适合用于调优复杂工具调用链路。若当前主要排查 UI 或
                Provider 问题，不建议先改这里。
              </div>

              <div className="flex items-center justify-between rounded-[22px] border border-slate-200/80 bg-white p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    启用 Tool Calling 2.0
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    开启后才会使用新的工具调用策略与相关优化。
                  </p>
                </div>
                <Switch
                  checked={toolCallingConfig.enabled}
                  onCheckedChange={handleToggleToolCallingEnabled}
                  disabled={saving}
                  aria-label="切换 Tool Calling 2.0"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        动态过滤
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        自动过滤网页抓取中的 HTML 噪音，减少上下文无关内容。
                      </p>
                    </div>
                    <Switch
                      checked={toolCallingConfig.dynamic_filtering}
                      onCheckedChange={handleToggleDynamicFiltering}
                      disabled={saving || !toolCallingConfig.enabled}
                      aria-label="切换动态过滤"
                    />
                  </div>
                </div>

                <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        原生 input examples 透传
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        在支持的模型协议中直接携带工具调用示例，提升复杂参数准确率。
                      </p>
                    </div>
                    <Switch
                      checked={toolCallingConfig.native_input_examples}
                      onCheckedChange={handleToggleNativeInputExamples}
                      disabled={saving || !toolCallingConfig.enabled}
                      aria-label="切换原生 input examples 透传"
                    />
                  </div>
                </div>
              </div>
            </div>
          </ExperimentalPanel>

          <ExperimentalPanel
            icon={Camera}
            title="截图对话"
            description="用全局快捷键截取屏幕区域，并直接进入问答或上下文分析。"
            aside={
              <StatusPill
                active={Boolean(config?.screenshot_chat.enabled)}
                activeLabel="已启用"
                inactiveLabel="未启用"
              />
            }
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-[22px] border border-slate-200/80 bg-white p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    启用截图对话
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    开启后可使用全局快捷键唤起截图交互。
                  </p>
                </div>
                <Switch
                  checked={config?.screenshot_chat.enabled ?? false}
                  onCheckedChange={handleToggleSmartInput}
                  disabled={saving}
                  aria-label="切换截图对话"
                />
              </div>

              {config?.screenshot_chat.enabled ? (
                <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                  <ShortcutSettings
                    currentShortcut={config.screenshot_chat.shortcut}
                    onShortcutChange={handleShortcutChange}
                    onValidate={handleValidateShortcut}
                    disabled={saving}
                  />
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
          </ExperimentalPanel>

          <ExperimentalPanel
            icon={Globe}
            title="WebMCP（预留）"
            description="面向未来浏览器原生结构化工具协议的预留入口，当前默认关闭，不参与实际执行链。"
            aside={
              <StatusPill
                active={Boolean(config?.webmcp?.enabled)}
                activeLabel="已启用"
                inactiveLabel="未启用"
              />
            }
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-[22px] border border-slate-200/80 bg-white p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    允许未来接入 WebMCP
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    当前版本开启后也不会切换执行链，只保留实验配置位，供后续小范围验证使用。
                  </p>
                </div>
                <Switch
                  checked={config?.webmcp?.enabled ?? false}
                  onCheckedChange={handleToggleWebMcp}
                  disabled={saving}
                  aria-label="切换 WebMCP 预留入口"
                />
              </div>

              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4 text-sm leading-6 text-slate-500">
                现阶段浏览器业务仍走 Bridge / CDP
                主线。这里不做运行时检测，也不接入任何 WebMCP
                执行能力，避免把当前主线做散。
              </div>
            </div>
          </ExperimentalPanel>

          <ExperimentalPanel
            icon={Bug}
            title="崩溃上报与诊断"
            description="收集前端错误、崩溃信息与运行态诊断，用于定位闪退和异常启动问题。"
            aside={
              <StatusPill
                active={Boolean(crashConfig.enabled)}
                activeLabel="已启用"
                inactiveLabel="未启用"
              />
            }
          >
            <div className="space-y-4">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4 text-sm leading-6 text-slate-500">
                DSN
                为空时会自动退化为仅本地记录。导出诊断包前建议先完成复现，减少历史噪音。
              </div>

              <div className="flex items-center justify-between rounded-[22px] border border-slate-200/80 bg-white p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    启用崩溃上报
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    控制远端上报与本地诊断采集策略。
                  </p>
                </div>
                <Switch
                  checked={Boolean(crashConfig.enabled)}
                  onCheckedChange={handleCrashEnabledToggle}
                  disabled={saving}
                  aria-label="切换崩溃上报"
                />
              </div>

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

              <div className="flex items-center justify-between rounded-[22px] border border-slate-200/80 bg-slate-50/60 px-4 py-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    发送默认 PII 字段
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    默认关闭，仅在明确需要时再打开。
                  </p>
                </div>
                <Switch
                  checked={Boolean(crashConfig.send_pii)}
                  onCheckedChange={(checked) =>
                    handleCrashFieldChange("send_pii", checked)
                  }
                  disabled={saving}
                  aria-label="切换发送默认 PII 字段"
                />
              </div>

              <div className="space-y-3">
                <p className="text-xs leading-5 text-slate-500">
                  复制、导出与打开目录的用途不同。直接发给开发者时优先“复制诊断信息”；需要归档或程序化比对时再选
                  JSON。
                </p>
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
            </div>
          </ExperimentalPanel>
        </div>

        <div className="space-y-6">
          <ExperimentalPanel
            icon={Sparkles}
            title="实验提醒"
            description="先判断当前问题类型，再决定应该动哪个实验开关，避免盲目联调。"
          >
            <div className="space-y-3">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  先做小范围验证
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  实验功能优先在个人环境或少量账号上验证，不建议直接推给全部工作流。
                </p>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  排障时减少变量
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  如果问题和工具链无关，不要同时改 Tool
                  Calling、截图和语音配置。
                </p>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  需要复现场景时先清理旧样本
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  导出前优先确认刚刚复现的问题是否已覆盖旧诊断历史，避免误导。
                </p>
              </div>
            </div>
          </ExperimentalPanel>

          {showClipboardGuide ? (
            <ExperimentalPanel
              icon={ShieldAlert}
              title="剪贴板权限指引"
              description="复制诊断失败且属于权限问题时，可按下面的系统提示恢复。"
            >
              <ClipboardPermissionGuideCard />
            </ExperimentalPanel>
          ) : null}

          <ExperimentalPanel
            icon={RefreshCw}
            title="更新提醒实验"
            description="管理自动更新检查和提醒验证，便于排查更新链路。"
          >
            <UpdateCheckSettings />
          </ExperimentalPanel>

          {voiceConfig ? (
            <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
              <div className="mb-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Mic className="h-4 w-4 text-sky-600" />
                  语音输入实验
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  语音快捷键、润色和翻译指令属于实验链路，适合单独验证输入体验。
                </p>
              </div>
              <VoiceSettings
                config={voiceConfig}
                onConfigChange={handleVoiceConfigChange}
                onValidateShortcut={handleValidateShortcut}
                disabled={saving}
              />
            </div>
          ) : null}

          <WorkspaceRepairHistoryCard
            className="rounded-[26px] border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5"
            title="Workspace 自愈记录（实验室）"
            description="用于排查路径不存在、自动迁移和修复事件。"
          />

          <ExperimentalPanel
            icon={FlaskConical}
            title="更多实验能力"
            description="新实验功能会继续放在这里，但不会为了占位而提前暴露无效入口。"
          >
            <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50/60 p-4 text-sm leading-6 text-slate-500">
              更多实验功能即将推出，新增前会优先明确适用场景、风险提示和降级路径。
            </div>
          </ExperimentalPanel>
        </div>
      </div>
    </div>
  );
}

export default ExperimentalSettings;
