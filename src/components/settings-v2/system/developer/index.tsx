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
  Eye,
  Globe,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
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
  description: string;
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
    <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm leading-6 text-slate-500">
      正在准备{label}...
    </div>
  );
}

export function DeveloperSettings() {
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

      <section className="rounded-[26px] border border-slate-200/80 bg-white px-5 py-4 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">
                  开发者
                </h1>
                <WorkbenchInfoTip
                  ariaLabel="开发者设置首屏说明"
                  content="首屏先保留处理工作台、组件调试和诊断动作，目录联调、自愈记录与权限卡片按需加载，减少进入设置后的等待感。"
                  tone="mint"
                />
              </div>
              <p className="text-sm text-slate-500">
                管理处理工作台、组件调试和诊断动作。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <StatusPill
                active={workspaceHarnessEnabled}
                activeLabel="工作台调试信息已启用"
                inactiveLabel="工作台调试信息已关闭"
              />
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
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                诊断动作：5 项
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                技能目录联调：按需加载
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                站点脚本联调：按需加载
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-[22px] border border-slate-200/80 bg-slate-50/60 px-4 py-3 text-sm text-slate-500">
            <span>{diagnosticBusy ? "诊断任务执行中" : "当前空闲"}</span>
            <span className="text-slate-300">/</span>
            <span>首屏说明已收纳</span>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.14fr)_minmax(320px,0.86fr)]">
        <div className="space-y-6">
          <SurfacePanel
            icon={Sparkles}
            title="处理工作台调试信息"
            description="控制通用对话里运行态摘要、工具库存、环境摘要等开发调试信息收集链路。Harness 入口会常驻保留。"
            aside={
              <StatusPill
                active={workspaceHarnessEnabled}
                activeLabel="已启用"
                inactiveLabel="已关闭"
              />
            }
          >
            <div className="space-y-4">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        允许收集处理工作台调试信息
                      </p>
                      <WorkbenchInfoTip
                        ariaLabel="处理工作台调试信息说明"
                        content="关闭时仍保留 Harness 入口，但不会继续读取工具库存或整理额外环境摘要。"
                        tone="slate"
                      />
                    </div>
                  </div>
                  <Switch
                    aria-label="切换处理工作台调试信息"
                    checked={workspaceHarnessEnabled}
                    disabled={workspaceHarnessSaving}
                    onCheckedChange={(checked) => {
                      void handleWorkspaceHarnessEnabledChange(
                        Boolean(checked),
                      );
                    }}
                  />
                </div>
              </div>

              <div className="rounded-[22px] border border-slate-200/80 bg-white p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[18px] border border-slate-200/80 bg-slate-50/60 p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      关闭时
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      通用对话仍保留 Harness 入口，额外工具库存读取与调试信息收集会短路。
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-slate-200/80 bg-slate-50/60 p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      开启时
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      仅用于开发排查，可查看运行态摘要、待处理事项、工具库存和协作成员状态。
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-6 text-slate-500">
                  {workspaceHarnessSaving
                    ? "正在保存处理工作台调试信息开关..."
                    : "建议默认保持关闭，排查完成后再关回去，避免给普通使用路径增加运行时噪音。"}
                </p>
              </div>
            </div>
          </SurfacePanel>

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
            <Suspense
              fallback={<DeferredPanelFallback label="服务型技能目录联调" />}
            >
              <ServiceSkillCatalogTools />
            </Suspense>
          </SurfacePanel>

          <SurfacePanel
            icon={Globe}
            title="站点脚本目录联调"
            description="用于验证站点适配器目录的服务端下发、外部来源导入和本地缓存回退。重点看真正生效的适配器列表，而不是只看缓存元数据。"
          >
            <Suspense
              fallback={<DeferredPanelFallback label="站点脚本目录联调" />}
            >
              <SiteAdapterCatalogTools />
            </Suspense>
          </SurfacePanel>

          <SurfacePanel
            icon={Bug}
            title="崩溃诊断日志（开发协作）"
            description="用于定位 Windows 闪退与初装异常，汇总前端崩溃、调用轨迹、服务器/日志诊断和启动自检信息。"
          >
            <div className="space-y-4">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4 text-sm leading-6 text-slate-500">
                导出的内容会自动对 DSN
                做脱敏处理。适合在复现问题后立刻复制或导出，减少信息丢失。
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

          <Suspense
            fallback={<DeferredPanelFallback label="Workspace 自愈记录" />}
          >
            <WorkspaceRepairHistoryCard
              className="rounded-[26px] border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5"
              description="仅用于开发排查，记录最近自动修复/迁移（不打断用户操作）"
            />
          </Suspense>
        </div>

        <div className="space-y-6">
          {showClipboardGuide ? (
            <SurfacePanel
              icon={ShieldAlert}
              title="剪贴板权限指引"
              description="如果复制诊断失败且属于权限问题，可按下面的系统指引恢复。"
            >
              <Suspense
                fallback={<DeferredPanelFallback label="剪贴板权限指引" />}
              >
                <ClipboardPermissionGuideCard />
              </Suspense>
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
                  在 Workspace
                  自动修复记录里看最近动作，再决定是否需要清理旧诊断历史。
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
                  适合直接发给开发者或贴到 issue
                  中，包含结构化摘要和关键上下文。
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
