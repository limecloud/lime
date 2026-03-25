import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Bug,
  DatabaseZap,
  Code2,
  Eye,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useComponentDebug } from "@/contexts/ComponentDebugContext";
import { getConfig } from "@/lib/api/appConfig";
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
  collectThemeWorkbenchDocumentStateForDiagnostic,
  CLEAR_CRASH_DIAGNOSTIC_HISTORY_CONFIRM_TEXT,
  copyCrashDiagnosticJsonToClipboard,
  copyCrashDiagnosticToClipboard,
  exportCrashDiagnosticToJson,
  isClipboardPermissionDeniedError,
  normalizeCrashReportingConfig,
  openCrashDiagnosticDownloadDirectory,
} from "@/lib/crashDiagnostic";
import {
  clearServiceSkillCatalogCache,
  getServiceSkillCatalog,
  subscribeServiceSkillCatalogChanged,
  type ServiceSkillCatalog,
} from "@/lib/api/serviceSkills";
import {
  emitServiceSkillCatalogBootstrap,
  extractServiceSkillCatalogFromBootstrapPayload,
} from "@/lib/serviceSkillCatalogBootstrap";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardPermissionGuideCard } from "../shared/ClipboardPermissionGuideCard";
import { WorkspaceRepairHistoryCard } from "../shared/WorkspaceRepairHistoryCard";

interface SurfacePanelProps {
  icon: LucideIcon;
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
}

interface SummaryStatProps {
  label: string;
  value: string;
  description: string;
}

const SECONDARY_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50";
const DANGER_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50";

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
          <p className="text-sm leading-6 text-slate-500">{description}</p>
        </div>
        {aside ? (
          <div className="flex flex-wrap items-center gap-2">{aside}</div>
        ) : null}
      </div>

      <div className="mt-5">{children}</div>
    </article>
  );
}

function SummaryStat({ label, value, description }: SummaryStatProps) {
  return (
    <div className="rounded-[22px] border border-white/90 bg-white/88 p-4 shadow-sm">
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

export function DeveloperSettings() {
  const { enabled, setEnabled } = useComponentDebug();
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [serviceCatalogBusy, setServiceCatalogBusy] = useState(false);
  const [catalogEditorValue, setCatalogEditorValue] = useState("");
  const [serviceCatalog, setServiceCatalog] = useState<ServiceSkillCatalog | null>(
    null,
  );
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showClipboardGuide, setShowClipboardGuide] = useState(false);

  const loadServiceSkillCatalog = useCallback(async () => {
    const catalog = await getServiceSkillCatalog();
    setServiceCatalog(catalog);
    return catalog;
  }, []);

  useEffect(() => {
    void loadServiceSkillCatalog();
  }, [loadServiceSkillCatalog]);

  useEffect(() => {
    return subscribeServiceSkillCatalogChanged(() => {
      void loadServiceSkillCatalog();
    });
  }, [loadServiceSkillCatalog]);

  const buildDiagnosticPayload = useCallback(async () => {
    const configPromise = getConfig();
    const runtimeSnapshotPromise = configPromise.then((config) =>
      collectRuntimeSnapshotForDiagnostic(config),
    );
    const [
      config,
      logs,
      persistedLogs,
      themeWorkbenchDocumentState,
      serverDiagnostics,
      logStorageDiagnostics,
      windowsStartupDiagnostics,
      runtimeSnapshotResult,
    ] = await Promise.all([
      configPromise,
      getLogs(),
      getPersistedLogsTail(200),
      collectThemeWorkbenchDocumentStateForDiagnostic(),
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
      themeWorkbenchDocumentState,
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

  const handleHydrateCatalogEditor = useCallback(async () => {
    setServiceCatalogBusy(true);
    setMessage(null);
    try {
      const catalog = await loadServiceSkillCatalog();
      setCatalogEditorValue(
        JSON.stringify(
          {
            serviceSkillCatalog: catalog,
          },
          null,
          2,
        ),
      );
      setMessage({
        type: "success",
        text: "已把当前目录写入调试编辑器",
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (error) {
      console.error("读取服务型技能目录失败:", error);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "读取服务型技能目录失败",
      });
    } finally {
      setServiceCatalogBusy(false);
    }
  }, [loadServiceSkillCatalog]);

  const handleApplyCatalogPayload = useCallback(async () => {
    const raw = catalogEditorValue.trim();
    if (!raw) {
      setMessage({
        type: "error",
        text: "请先输入 serviceSkillCatalog JSON",
      });
      return;
    }

    setServiceCatalogBusy(true);
    setMessage(null);
    try {
      const parsed = JSON.parse(raw) as unknown;
      const previewCatalog =
        extractServiceSkillCatalogFromBootstrapPayload(parsed);
      if (!previewCatalog) {
        throw new Error(
          "JSON 中未找到合法的 serviceSkillCatalog，可传目录本体或 { serviceSkillCatalog: ... }",
        );
      }

      emitServiceSkillCatalogBootstrap(parsed);
      setMessage({
        type: "success",
        text: `已通过 bootstrap 事件注入目录：${previewCatalog.items.length} 项`,
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (error) {
      console.error("注入服务型技能目录失败:", error);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "注入服务型技能目录失败",
      });
    } finally {
      setServiceCatalogBusy(false);
    }
  }, [catalogEditorValue]);

  const handleClearServiceSkillCatalog = useCallback(async () => {
    setServiceCatalogBusy(true);
    setMessage(null);
    try {
      clearServiceSkillCatalogCache();
      const catalog = await loadServiceSkillCatalog();
      setMessage({
        type: "success",
        text: `已清空远端目录缓存，当前回退到 seeded：${catalog.items.length} 项`,
      });
      setTimeout(() => setMessage(null), 2500);
    } catch (error) {
      console.error("清空服务型技能目录缓存失败:", error);
      setMessage({
        type: "error",
        text:
          error instanceof Error ? error.message : "清空服务型技能目录缓存失败",
      });
    } finally {
      setServiceCatalogBusy(false);
    }
  }, [loadServiceSkillCatalog]);

  const summary = useMemo(
    () => ({
      diagnosticActionCount: 5,
      debugModeLabel: enabled ? "已启用" : "未启用",
      clipboardLabel: showClipboardGuide ? "待处理" : "正常",
      serviceCatalogLabel: serviceCatalog
        ? `${serviceCatalog.items.length} 项`
        : "加载中",
    }),
    [enabled, serviceCatalog, showClipboardGuide],
  );

  return (
    <div className="space-y-6 pb-8">
      {message ? (
        <div
          className={cn(
            "flex items-center gap-2 rounded-[20px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50/90 text-emerald-700"
              : "border-rose-200 bg-rose-50/90 text-rose-700",
          )}
        >
          <AlertCircle className="h-4 w-4" />
          <span>{message.text}</span>
        </div>
      ) : null}

      <section className="relative overflow-hidden rounded-[30px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(244,251,248,0.98)_0%,rgba(248,250,252,0.98)_45%,rgba(241,246,255,0.96)_100%)] shadow-sm shadow-slate-950/5">
        <div className="pointer-events-none absolute -left-20 top-[-72px] h-56 w-56 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="pointer-events-none absolute right-[-76px] top-[-24px] h-56 w-56 rounded-full bg-sky-200/28 blur-3xl" />

        <div className="relative flex flex-col gap-6 p-6 lg:p-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
            <div className="max-w-3xl space-y-5">
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 shadow-sm">
                DEVELOPER DESK
              </span>
              <div className="space-y-2">
                <p className="text-[28px] font-semibold tracking-tight text-slate-900">
                  把组件调试、崩溃诊断和自愈记录放到同一个开发工作台里
                </p>
                <p className="max-w-2xl text-sm leading-7 text-slate-600">
                  这里优先服务排障和开发协作，重点是快速收集可用信息，而不是堆更多低价值表单。
                  组件调试和诊断按钮仍保持原有行为，只是重新组织了信息层次。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/90 bg-white/88 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                  组件视图调试适合开发模式下看轮廓和路径
                </span>
                <span className="rounded-full border border-white/90 bg-white/88 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                  诊断动作会采集日志、运行态快照和系统自检信息
                </span>
                <span className="rounded-full border border-white/90 bg-white/88 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                  Workspace 自愈记录用于追踪自动修复链路
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 xl:content-start">
              <SummaryStat
                label="组件调试"
                value={summary.debugModeLabel}
                description="控制组件轮廓显示与 Alt 点击诊断，不改变运行逻辑。"
              />
              <SummaryStat
                label="诊断动作"
                value={summary.diagnosticActionCount.toString()}
                description="当前提供清空、复制、纯 JSON、导出和打开目录五个动作。"
              />
              <SummaryStat
                label="剪贴板权限"
                value={summary.clipboardLabel}
                description="复制诊断失败且属于权限问题时，会在本页展示系统设置指引。"
              />
              <SummaryStat
                label="技能目录"
                value={summary.serviceCatalogLabel}
                description="显示当前生效的服务型技能目录项数，便于联调 bootstrap 下发。"
              />
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-[24px] border border-white/90 bg-white/80 p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill
                  active={enabled}
                  activeLabel="组件调试已启用"
                  inactiveLabel="组件调试未启用"
                />
                <StatusPill
                  active={!showClipboardGuide}
                  activeLabel="剪贴板权限正常"
                  inactiveLabel="需检查剪贴板权限"
                />
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                  {diagnosticBusy ? "诊断任务执行中" : "当前空闲"}
                </span>
              </div>
              <p className="text-sm leading-6 text-slate-600">
                建议先打开组件调试看清页面结构，再根据问题类型决定是否复制或导出完整诊断包。
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.14fr)_minmax(320px,0.86fr)]">
        <div className="space-y-6">
          <SurfacePanel
            icon={Eye}
            title="组件视图调试"
            description="显示组件轮廓并支持 Alt 点击查看组件信息，适合开发模式下定位复杂界面。"
            aside={
              <StatusPill
                active={enabled}
                activeLabel="已启用"
                inactiveLabel="未启用"
              />
            }
          >
            <div className="space-y-4">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900">
                      开启组件轮廓与信息查看
                    </p>
                    <p className="text-sm leading-6 text-slate-500">
                      不影响业务行为，只在调试时提供轮廓高亮和组件来源查看能力。
                    </p>
                  </div>
                  <Switch
                    aria-label="切换组件视图调试"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                  />
                </div>
              </div>

              {enabled ? (
                <div className="rounded-[22px] border border-slate-200/80 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-900">
                    使用说明
                  </p>
                  <div className="mt-3 space-y-2 text-sm leading-6 text-slate-500">
                    <p>1. 按住 Alt 键并悬浮，可查看组件轮廓。</p>
                    <p>2. Alt + 点击组件，可查看名称和文件路径。</p>
                    <p>3. 文件路径仅在开发模式 `npm run tauri dev` 下可用。</p>
                  </div>
                </div>
              ) : null}
            </div>
          </SurfacePanel>

          <SurfacePanel
            icon={DatabaseZap}
            title="服务型技能目录联调"
            description="仅用于客户端联调 serviceSkillCatalog。支持查看当前目录、手工注入 bootstrap payload，以及清缓存回退 seeded 目录。"
          >
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                  <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
                    Tenant
                  </p>
                  <p className="mt-3 text-lg font-semibold text-slate-900">
                    {serviceCatalog?.tenantId ?? "加载中"}
                  </p>
                </div>
                <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                  <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
                    Version
                  </p>
                  <p className="mt-3 text-lg font-semibold text-slate-900">
                    {serviceCatalog?.version ?? "加载中"}
                  </p>
                </div>
                <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                  <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
                    Items
                  </p>
                  <p className="mt-3 text-lg font-semibold text-slate-900">
                    {serviceCatalog?.items.length ?? 0}
                  </p>
                </div>
                <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                  <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
                    Synced At
                  </p>
                  <p className="mt-3 text-sm font-semibold text-slate-900">
                    {serviceCatalog?.syncedAt ?? "加载中"}
                  </p>
                </div>
              </div>

              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900">
                      当前目录摘要
                    </p>
                    <p className="text-sm leading-6 text-slate-500">
                      这里展示当前客户端实际生效的目录。若首页服务型技能没刷新，先看这里是否已经同步。
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                    {serviceCatalogBusy ? "目录操作执行中" : "目录状态空闲"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(serviceCatalog?.items ?? []).slice(0, 4).map((item) => (
                    <span
                      key={item.id}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
                    >
                      {item.title}
                    </span>
                  ))}
                  {(serviceCatalog?.items.length ?? 0) > 4 ? (
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500">
                      还有 {(serviceCatalog?.items.length ?? 0) - 4} 项
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3 rounded-[22px] border border-slate-200/80 bg-white p-4">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-900">
                    Bootstrap Payload 调试输入
                  </p>
                  <p className="text-sm leading-6 text-slate-500">
                    支持两种格式：目录本体，或
                    <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                      {"{ serviceSkillCatalog: ... }"}
                    </code>
                    包装对象。点击“通过事件注入”会走和服务端运行时推送相同的客户端链路。
                  </p>
                </div>

                <Textarea
                  aria-label="服务型技能目录调试输入"
                  value={catalogEditorValue}
                  onChange={(event) => setCatalogEditorValue(event.target.value)}
                  placeholder='{\n  "serviceSkillCatalog": {\n    "version": "tenant-2026-03-24",\n    "tenantId": "tenant-demo",\n    "syncedAt": "2026-03-24T12:00:00.000Z",\n    "items": []\n  }\n}'
                  className="min-h-[240px] rounded-[18px] border-slate-200/80 bg-slate-50/60 font-mono text-xs leading-6 text-slate-700"
                />

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void handleHydrateCatalogEditor()}
                    disabled={serviceCatalogBusy}
                    className={SECONDARY_BUTTON_CLASS_NAME}
                  >
                    <ScrollText className="h-4 w-4" />
                    载入当前目录
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleApplyCatalogPayload()}
                    disabled={serviceCatalogBusy}
                    className={SECONDARY_BUTTON_CLASS_NAME}
                  >
                    <DatabaseZap className="h-4 w-4" />
                    通过事件注入
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleClearServiceSkillCatalog()}
                    disabled={serviceCatalogBusy}
                    className={DANGER_BUTTON_CLASS_NAME}
                  >
                    <Trash2 className="h-4 w-4" />
                    清空目录缓存
                  </button>
                </div>
              </div>
            </div>
          </SurfacePanel>

          <SurfacePanel
            icon={Bug}
            title="崩溃诊断日志（开发协作）"
            description="用于定位 Windows 闪退与初装异常，汇总前端崩溃、调用轨迹、服务器/日志诊断和启动自检信息。"
          >
            <div className="space-y-4">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4 text-sm leading-6 text-slate-500">
                导出的内容会自动对 DSN 做脱敏处理。适合在复现问题后立刻复制或导出，减少信息丢失。
              </div>

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
            </div>
          </SurfacePanel>

          <WorkspaceRepairHistoryCard
            className="rounded-[26px] border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5"
            description="仅用于开发排查，记录最近自动修复/迁移（不打断用户操作）"
          />
        </div>

        <div className="space-y-6">
          {showClipboardGuide ? (
            <SurfacePanel
              icon={ShieldAlert}
              title="剪贴板权限指引"
              description="如果复制诊断失败且属于权限问题，可按下面的系统指引恢复。"
            >
              <ClipboardPermissionGuideCard />
            </SurfacePanel>
          ) : null}

          <SurfacePanel
            icon={Sparkles}
            title="诊断建议"
            description="先缩小问题范围，再决定要收集哪种信息，避免一次性导出过多噪音。"
          >
            <div className="space-y-3">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  页面结构问题
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  先打开组件调试，确认具体组件边界和来源文件，再回到对应页面修。
                </p>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  闪退或启动异常
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  优先复制或导出完整诊断信息，这类问题更依赖启动自检和运行态快照。
                </p>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  自愈链路核对
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  在 Workspace 自动修复记录里看最近动作，再决定是否需要清理旧诊断历史。
                </p>
              </div>
            </div>
          </SurfacePanel>

          <SurfacePanel
            icon={Code2}
            title="动作清单"
            description="不同诊断动作解决的问题不同，不建议每次都盲目全导出。"
          >
            <div className="space-y-3">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  复制诊断信息
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  适合直接发给开发者或贴到 issue 中，包含结构化摘要和关键上下文。
                </p>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  复制纯 JSON / 导出 JSON
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  更适合程序化比对和归档，内容完整，但阅读成本更高。
                </p>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  清空旧诊断信息
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  用于复现场景前清理历史噪音。执行后不可恢复，只保留新的问题样本。
                </p>
              </div>
            </div>
          </SurfacePanel>
        </div>
      </div>
    </div>
  );
}
