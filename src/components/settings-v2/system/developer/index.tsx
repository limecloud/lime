import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  Bug,
  DatabaseZap,
  Code2,
  Globe,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useComponentDebug } from "@/contexts/ComponentDebugContext";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import { getLogs, getPersistedLogsTail } from "@/lib/api/logs";
import {
  getLogStorageDiagnostics,
  getServerDiagnostics,
  getWindowsStartupDiagnostics,
} from "@/lib/api/serverRuntime";
import {
  buildCrashDiagnosticPayload,
  clearCrashDiagnosticHistory,
  collectRuntimeSnapshotForDiagnostic,
  collectGeneralWorkbenchDocumentStateForDiagnostic,
  CLEAR_CRASH_DIAGNOSTIC_HISTORY_CONFIRM_TEXT,
  copyCrashDiagnosticJsonToClipboard,
  copyCrashDiagnosticToClipboard,
  exportCrashDiagnosticToJson,
  isClipboardPermissionDeniedError,
  normalizeCrashReportingConfig,
  openCrashDiagnosticDownloadDirectory,
} from "@/lib/crashDiagnostic";
import { cn } from "@/lib/utils";
import {
  isWorkspaceHarnessEnabled,
  normalizeDeveloperConfig,
} from "@/lib/developerFeatures";
import {
  DANGER_BUTTON_CLASS_NAME,
  SECONDARY_BUTTON_CLASS_NAME,
} from "./shared";

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
const ServiceSkillCatalogTools = lazy(() =>
  import("./ServiceSkillCatalogTools").then((module) => ({
    default: module.ServiceSkillCatalogTools,
  })),
);
const SiteAdapterCatalogTools = lazy(() =>
  import("./SiteAdapterCatalogTools").then((module) => ({
    default: module.SiteAdapterCatalogTools,
  })),
);

interface SurfacePanelProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
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

function DeferredPanelFallback({ label }: { label: string }) {
  return (
    <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-500">
      正在准备{label}...
    </div>
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

interface DeveloperSettingsProps {
  embedded?: boolean;
}

export function DeveloperSettings({
  embedded = false,
}: DeveloperSettingsProps = {}) {
  const { enabled, setEnabled } = useComponentDebug();
  const [appConfig, setAppConfig] = useState<Config | null>(null);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [workspaceHarnessSaving, setWorkspaceHarnessSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showClipboardGuide, setShowClipboardGuide] = useState(false);

  const loadAppConfig = useCallback(async () => {
    try {
      const config = await getConfig();
      setAppConfig(config);
      return config;
    } catch (error) {
      console.error("加载开发者配置失败:", error);
      setAppConfig(null);
      return null;
    }
  }, []);

  useEffect(() => {
    void loadAppConfig();
  }, [loadAppConfig]);

  const buildDiagnosticPayload = useCallback(async () => {
    const configPromise = getConfig();
    const runtimeSnapshotPromise = configPromise.then((config) =>
      collectRuntimeSnapshotForDiagnostic(config),
    );
    const [
      config,
      logs,
      persistedLogs,
      generalWorkbenchDocumentState,
      serverDiagnostics,
      logStorageDiagnostics,
      windowsStartupDiagnostics,
      runtimeSnapshotResult,
    ] = await Promise.all([
      configPromise,
      getLogs(),
      getPersistedLogsTail(200),
      collectGeneralWorkbenchDocumentStateForDiagnostic(),
      getServerDiagnostics().catch(() => null),
      getLogStorageDiagnostics().catch(() => null),
      getWindowsStartupDiagnostics().catch(() => null),
      runtimeSnapshotPromise,
    ]);
    return buildCrashDiagnosticPayload({
      crashConfig: normalizeCrashReportingConfig(config.crash_reporting),
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
  }, []);

  const handleCopyDiagnostic = useCallback(async () => {
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
    } catch (error) {
      console.error("复制诊断信息失败:", error);
      const isPermissionDenied = isClipboardPermissionDeniedError(error);
      setShowClipboardGuide(isPermissionDenied);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "复制诊断信息失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, [buildDiagnosticPayload]);

  const handleCopyDiagnosticJson = useCallback(async () => {
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
    } catch (error) {
      console.error("复制纯 JSON 失败:", error);
      const isPermissionDenied = isClipboardPermissionDeniedError(error);
      setShowClipboardGuide(isPermissionDenied);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "复制纯 JSON 失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, [buildDiagnosticPayload]);

  const handleExportDiagnostic = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      const payload = await buildDiagnosticPayload();
      const result = exportCrashDiagnosticToJson(payload, {
        sceneTag: "settings-developer",
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
    } catch (error) {
      console.error("导出诊断信息失败:", error);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "导出诊断信息失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, [buildDiagnosticPayload]);

  const handleOpenDownloadDirectory = useCallback(async () => {
    setDiagnosticBusy(true);
    setMessage(null);
    try {
      const result = await openCrashDiagnosticDownloadDirectory();
      setMessage({
        type: "success",
        text: `已打开下载目录：${result.openedPath}`,
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (error) {
      console.error("打开下载目录失败:", error);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "打开下载目录失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, []);

  const handleClearDiagnosticHistory = useCallback(async () => {
    const confirmed =
      typeof window === "undefined" ||
      window.confirm(CLEAR_CRASH_DIAGNOSTIC_HISTORY_CONFIRM_TEXT);
    if (!confirmed) {
      return;
    }

    setDiagnosticBusy(true);
    setMessage(null);
    setShowClipboardGuide(false);
    try {
      await clearCrashDiagnosticHistory();
      setMessage({
        type: "success",
        text: "已清空旧诊断信息，后续复制将只包含新的诊断数据",
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (error) {
      console.error("清空旧诊断信息失败:", error);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "清空旧诊断信息失败",
      });
    } finally {
      setDiagnosticBusy(false);
    }
  }, []);

  const handleWorkspaceHarnessEnabledChange = useCallback(
    async (nextEnabled: boolean) => {
      setWorkspaceHarnessSaving(true);
      setMessage(null);
      try {
        const latestConfig = appConfig ?? (await getConfig());
        const nextConfig: Config = {
          ...latestConfig,
          developer: {
            ...normalizeDeveloperConfig(latestConfig.developer),
            workspace_harness_enabled: nextEnabled,
          },
        };
        await saveConfig(nextConfig);
        setAppConfig(nextConfig);
        setMessage({
          type: "success",
          text: nextEnabled
            ? "已开启处理工作台调试信息收集，工具库存与环境摘要会随 Harness 打开加载"
            : "已关闭处理工作台调试信息收集，Harness 入口仍会保留",
        });
        setTimeout(() => setMessage(null), 2500);
      } catch (error) {
        console.error("保存处理工作台开关失败:", error);
        setMessage({
          type: "error",
          text:
            error instanceof Error ? error.message : "保存处理工作台开关失败",
        });
      } finally {
        setWorkspaceHarnessSaving(false);
      }
    },
    [appConfig],
  );

  const workspaceHarnessEnabled = isWorkspaceHarnessEnabled(appConfig);

  return (
    <div className={cn("space-y-5", embedded ? "pb-0" : "pb-8")}>
      {message ? (
        <div
          className={cn(
            "flex items-center gap-2 rounded-[20px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700",
          )}
        >
          <AlertCircle className="h-4 w-4" />
          <span>{message.text}</span>
        </div>
      ) : null}

      <section className="rounded-[26px] border border-slate-200/80 bg-white px-5 py-4 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-1.5">
            {embedded ? (
              <h2 className="text-[20px] font-semibold tracking-tight text-slate-900">
                开发者工具
              </h2>
            ) : (
              <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">
                开发者
              </h1>
            )}
            <p className="text-sm text-slate-500">
              排查问题时打开，用完关回去。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <StatusPill
              active={workspaceHarnessEnabled}
              activeLabel="工作台调试已开"
              inactiveLabel="工作台调试已关"
            />
            <StatusPill
              active={enabled}
              activeLabel="组件调试已开"
              inactiveLabel="组件调试已关"
            />
            {diagnosticBusy ? (
              <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                诊断执行中
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(360px,1.08fr)]">
        <div className="space-y-5">
          <SurfacePanel
            icon={Sparkles}
            title="调试开关"
            description="默认保持关闭，只在排查页面结构或运行态问题时开启。"
          >
            <div className="space-y-3">
              <CompactSwitchRow
                title="工作台调试信息"
                description={
                  workspaceHarnessSaving
                    ? "正在保存..."
                    : "收集运行态摘要、工具库存和环境摘要。"
                }
                checked={workspaceHarnessEnabled}
                disabled={workspaceHarnessSaving}
                ariaLabel="切换处理工作台调试信息"
                onCheckedChange={(checked) => {
                  void handleWorkspaceHarnessEnabledChange(checked);
                }}
              />
              <CompactSwitchRow
                title="组件视图调试"
                description="Alt 悬浮看组件轮廓，Alt 点击看组件来源。"
                checked={enabled}
                ariaLabel="切换组件视图调试"
                onCheckedChange={setEnabled}
              />
            </div>
          </SurfacePanel>

          <SurfacePanel
            icon={Bug}
            title="诊断日志"
            description="复制或导出当前诊断包；复现前可先清空旧记录。"
          >
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleClearDiagnosticHistory()}
                disabled={diagnosticBusy}
                className={DANGER_BUTTON_CLASS_NAME}
              >
                <Trash2 className="h-4 w-4" />
                清空旧诊断信息
              </button>
              <button
                type="button"
                onClick={() => void handleCopyDiagnostic()}
                disabled={diagnosticBusy}
                className={SECONDARY_BUTTON_CLASS_NAME}
              >
                <Bug className="h-4 w-4" />
                复制诊断信息
              </button>
              <button
                type="button"
                onClick={() => void handleCopyDiagnosticJson()}
                disabled={diagnosticBusy}
                className={SECONDARY_BUTTON_CLASS_NAME}
              >
                <Code2 className="h-4 w-4" />
                复制纯 JSON
              </button>
              <button
                type="button"
                onClick={() => void handleExportDiagnostic()}
                disabled={diagnosticBusy}
                className={SECONDARY_BUTTON_CLASS_NAME}
              >
                <ScrollText className="h-4 w-4" />
                导出诊断 JSON
              </button>
              <button
                type="button"
                onClick={() => void handleOpenDownloadDirectory()}
                disabled={diagnosticBusy}
                className={SECONDARY_BUTTON_CLASS_NAME}
              >
                <Sparkles className="h-4 w-4" />
                打开下载目录
              </button>
            </div>

            {showClipboardGuide ? (
              <div className="mt-4">
                <Suspense
                  fallback={<DeferredPanelFallback label="剪贴板权限指引" />}
                >
                  <ClipboardPermissionGuideCard />
                </Suspense>
              </div>
            ) : null}
          </SurfacePanel>
        </div>

        <div className="space-y-5">
          <AdvancedDetails
            icon={DatabaseZap}
            title="服务型技能目录联调"
            description="查看、注入或清空 service skill 目录。"
          >
            <Suspense
              fallback={<DeferredPanelFallback label="服务型技能目录联调" />}
            >
              <ServiceSkillCatalogTools />
            </Suspense>
          </AdvancedDetails>

          <AdvancedDetails
            icon={Globe}
            title="站点脚本目录联调"
            description="验证站点适配器目录与外部 YAML 导入。"
          >
            <Suspense
              fallback={<DeferredPanelFallback label="站点脚本目录联调" />}
            >
              <SiteAdapterCatalogTools />
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
