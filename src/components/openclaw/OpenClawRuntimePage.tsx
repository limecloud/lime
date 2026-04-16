import {
  ArrowUpCircle,
  Copy,
  ExternalLink,
  Loader2,
  MonitorSmartphone,
  Play,
  Power,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type {
  OpenClawGatewayStatus,
  OpenClawHealthInfo,
  OpenClawRuntimeCandidate,
  OpenClawUpdateInfo,
} from "@/lib/api/openclaw";
import { cn } from "@/lib/utils";
import { OpenClawExecutionEnvironmentCard } from "./OpenClawExecutionEnvironmentCard";
import {
  openClawPanelClassName,
  openClawPrimaryButtonClassName,
  openClawSecondaryButtonClassName,
  openClawSubPanelClassName,
} from "./openclawStyles";

interface OpenClawUpdateRuntimeNotice {
  tone: "warning" | "error";
  title: string;
  description: string;
  actionLabel?: string;
}

interface OpenClawRuntimePageProps {
  gatewayStatus: OpenClawGatewayStatus;
  gatewayPort: number;
  healthInfo: OpenClawHealthInfo | null;
  updateInfo: OpenClawUpdateInfo | null;
  installedVersion: string | null;
  runningVersion: string | null;
  versionMismatch: boolean;
  updateRuntimeNotice: OpenClawUpdateRuntimeNotice | null;
  runtimeCandidates: OpenClawRuntimeCandidate[];
  preferredRuntimeId: string | null;
  channelCount: number;
  startReady: boolean;
  canStart: boolean;
  canStop: boolean;
  canRestart: boolean;
  starting: boolean;
  stopping: boolean;
  restarting: boolean;
  checkingHealth: boolean;
  checkingUpdate: boolean;
  switchingRuntime: boolean;
  updating: boolean;
  dashboardWindowOpen: boolean;
  dashboardWindowBusy: boolean;
  recentOperationLabel: string | null;
  recentOperationMessage: string | null;
  recentOperationUpdatedAt: string | null;
  recentOperationSucceeded: boolean | null;
  recentLogCount: number;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onOpenDashboard: () => void;
  onOpenDashboardPage: () => void;
  onBackToConfigure: () => void;
  onCheckHealth: () => void;
  onCheckUpdate: () => void;
  onUpdate: () => void;
  onUseRecommendedUpdateRuntime: () => void;
  onSelectPreferredRuntime: (runtimeId: string | null) => void;
  onOpenRecentLogs: () => void;
  onCopyRecentLogs: () => void;
  onCopyRecentDiagnosticBundle: () => void;
}

function titleForStatus(status: OpenClawGatewayStatus): string {
  switch (status) {
    case "running":
      return "Gateway 已准备就绪";
    case "starting":
      return "Gateway 正在启动";
    case "error":
      return "Gateway 状态异常";
    default:
      return "Gateway 当前未运行";
  }
}

function descriptionForStatus(status: OpenClawGatewayStatus): string {
  switch (status) {
    case "running":
      return "可以直接打开桌面面板，或进入 Dashboard 访问页查看完整界面。";
    case "starting":
      return "请稍等片刻，启动完成后再打开桌面面板或访问 Dashboard。";
    case "error":
      return "建议先检查健康状态，再决定是否回到配置页重新同步模型并重启。";
    default:
      return "完成启动后即可打开 Dashboard；如果还未同步模型配置，请先回到配置页。";
  }
}

export function OpenClawRuntimePage({
  gatewayStatus,
  gatewayPort,
  healthInfo,
  updateInfo,
  installedVersion,
  runningVersion,
  versionMismatch,
  updateRuntimeNotice,
  runtimeCandidates,
  preferredRuntimeId,
  channelCount,
  startReady,
  canStart,
  canStop,
  canRestart,
  starting,
  stopping,
  restarting,
  checkingHealth,
  checkingUpdate,
  switchingRuntime,
  updating,
  dashboardWindowOpen,
  dashboardWindowBusy,
  recentOperationLabel,
  recentOperationMessage,
  recentOperationUpdatedAt,
  recentOperationSucceeded,
  recentLogCount,
  onStart,
  onStop,
  onRestart,
  onOpenDashboard,
  onOpenDashboardPage,
  onBackToConfigure,
  onCheckHealth,
  onCheckUpdate,
  onUpdate,
  onUseRecommendedUpdateRuntime,
  onSelectPreferredRuntime,
  onOpenRecentLogs,
  onCopyRecentLogs,
  onCopyRecentDiagnosticBundle,
}: OpenClawRuntimePageProps) {
  const running = gatewayStatus === "running";
  const dashboardActionLabel = dashboardWindowOpen
    ? "聚焦桌面面板"
    : "打开桌面面板";
  const dashboardActionHint = running
    ? dashboardWindowOpen
      ? "桌面版已经打开，点击即可快速回到 OpenClaw。"
      : "Gateway 已运行，现在可以一键直达桌面版。"
    : gatewayStatus === "starting"
      ? "Gateway 正在启动，完成后这里会变成一键打开入口。"
      : startReady
        ? "先启动 Gateway，运行后即可在顶部一键打开桌面版。"
        : "先回到配置页完成模型同步，再启动后打开桌面版。";
  const dashboardActionDisabled = !running || dashboardWindowBusy;
  const healthText = healthInfo
    ? `${healthInfo.status}${healthInfo.version ? ` · ${healthInfo.version}` : ""}${healthInfo.uptime ? ` · 运行 ${healthInfo.uptime}s` : ""}`
    : "尚未执行健康检查";
  const installedVersionText = installedVersion || "未检测到";
  const runningVersionText = running
    ? runningVersion || "暂未识别"
    : gatewayStatus === "starting"
      ? "启动中"
      : "Gateway 未运行";
  const updateStatusLabel = versionMismatch
    ? "待生效"
    : updateInfo?.hasUpdate
      ? "可升级"
      : "已检查";
  const updateDescription = versionMismatch
    ? `已安装 ${installedVersionText}，但当前 Gateway 仍在运行 ${runningVersionText}。请重启 Gateway，让桌面版切到新版本。`
    : updateInfo?.hasUpdate
      ? `检测到新版本 ${updateInfo.latestVersion || "待确认"}。`
      : updateInfo?.message
        ? updateInfo.message
        : "可在工作台内直接检查和执行 OpenClaw 升级。";
  const recentOperationTimeText = recentOperationUpdatedAt
    ? new Date(recentOperationUpdatedAt).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="space-y-4">
      <section className={openClawPanelClassName}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-amber-700">
              RUNTIME
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
              {titleForStatus(gatewayStatus)}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {descriptionForStatus(gatewayStatus)}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {running ? "运行中" : gatewayStatus} · {gatewayPort}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {running ? `${channelCount} 个通道` : "等待启动后发现通道"}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {dashboardWindowOpen ? "桌面面板已打开" : "桌面面板未打开"}
              </span>
            </div>
          </div>

          <div className="flex w-full flex-col gap-3 xl:max-w-[520px] xl:items-stretch">
            <div className="rounded-[22px] border border-sky-200/80 bg-gradient-to-r from-sky-50 via-white to-white p-3 shadow-sm shadow-sky-100/40">
              <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-sky-700">
                DESKTOP ACCESS
              </div>
              <button
                type="button"
                onClick={onOpenDashboard}
                disabled={dashboardActionDisabled}
                className={cn(
                  running
                    ? openClawPrimaryButtonClassName
                    : openClawSecondaryButtonClassName,
                  "w-full justify-between rounded-[18px] px-5 py-4 text-left",
                )}
              >
                <span className="flex items-start gap-3">
                  {dashboardWindowBusy ? (
                    <Loader2 className="mt-0.5 h-5 w-5 animate-spin" />
                  ) : (
                    <MonitorSmartphone
                      className={cn(
                        "mt-0.5 h-5 w-5 shrink-0",
                        running ? "text-sky-200" : "text-slate-400",
                      )}
                    />
                  )}
                  <span className="flex flex-col items-start">
                    <span className="text-sm font-semibold">
                      {dashboardActionLabel}
                    </span>
                    <span
                      className={cn(
                        "mt-1 text-xs leading-5",
                        running ? "text-slate-300" : "text-slate-500",
                      )}
                    >
                      {dashboardActionHint}
                    </span>
                  </span>
                </span>
                <ExternalLink
                  className={cn(
                    "h-4 w-4 shrink-0",
                    running ? "text-slate-300" : "text-slate-400",
                  )}
                />
              </button>
            </div>

            <div className="flex flex-wrap gap-3 xl:justify-end">
              <button
                type="button"
                onClick={onStart}
                disabled={!canStart || starting || switchingRuntime}
                className={cn(
                  !running
                    ? openClawPrimaryButtonClassName
                    : openClawSecondaryButtonClassName,
                  "min-w-[140px] px-5 py-2.5",
                )}
              >
                {starting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                启动
              </button>
              <button
                type="button"
                onClick={onStop}
                disabled={!canStop || stopping || switchingRuntime}
                className={cn(
                  openClawSecondaryButtonClassName,
                  "min-w-[120px] px-5 py-2.5",
                )}
              >
                {stopping ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Power className="h-4 w-4" />
                )}
                停止
              </button>
              <button
                type="button"
                onClick={onRestart}
                disabled={!canRestart || restarting || switchingRuntime}
                className={cn(
                  openClawSecondaryButtonClassName,
                  "min-w-[120px] px-5 py-2.5",
                )}
              >
                {restarting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                重启
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <section className={openClawPanelClassName}>
              <div className="text-sm font-medium text-slate-900">健康状态</div>
              <div className="mt-3 text-sm leading-7 text-slate-500">
                {healthText}
              </div>
              <button
                type="button"
                onClick={onCheckHealth}
                disabled={checkingHealth || !running || switchingRuntime}
                className={cn(
                  openClawSecondaryButtonClassName,
                  "mt-4 px-3 py-2 text-xs",
                )}
              >
                {checkingHealth ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                检查
              </button>
            </section>

            <section className={openClawPanelClassName}>
              <div className="text-sm font-medium text-slate-900">通道状态</div>
              <div className="mt-3 text-sm leading-7 text-slate-500">
                {running
                  ? `当前已发现 ${channelCount} 个通道，可通过桌面面板或浏览器访问 Dashboard。`
                  : startReady
                    ? "Gateway 启动后会自动刷新可用通道数量。"
                    : "当前尚未完成模型配置同步，请先返回配置页选择模型后再启动 Gateway。"}
              </div>
              <button
                type="button"
                onClick={onBackToConfigure}
                className={cn(
                  openClawSecondaryButtonClassName,
                  "mt-4 px-3 py-2 text-xs",
                )}
              >
                返回配置页
              </button>
            </section>
          </div>

          <section className={openClawPanelClassName}>
            <div className="text-sm font-medium text-slate-900">
              更多访问方式
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              顶部已经提供桌面版快捷入口；这里保留桌面面板和 Dashboard
              访问页两种方式，便于日常使用与诊断 token、地址。
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={onOpenDashboard}
                disabled={!running || dashboardWindowBusy}
                className={cn(
                  openClawSecondaryButtonClassName,
                  "w-full px-5 py-3 text-base",
                )}
              >
                {dashboardWindowBusy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <MonitorSmartphone className="h-5 w-5" />
                )}
                {dashboardWindowOpen ? "聚焦桌面面板" : "打开桌面面板"}
              </button>

              <button
                type="button"
                onClick={onOpenDashboardPage}
                disabled={!running}
                className={cn(
                  openClawSecondaryButtonClassName,
                  "w-full px-5 py-3 text-base",
                )}
              >
                <ExternalLink className="h-5 w-5" />
                进入 Dashboard 访问页
              </button>
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className={openClawPanelClassName}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-900">
                  版本升级
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  在工作台内执行智能升级。系统会优先走官方 `openclaw
                  update`，失败时自动尝试同运行时的全局安装升级兜底。
                </p>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {updateStatusLabel}
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">
                  已安装版本
                </div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {installedVersionText}
                </div>
              </div>
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">
                  运行中版本
                </div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {runningVersionText}
                </div>
              </div>
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">
                  更新通道
                </div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {updateInfo?.channel || "stable"}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500">
                  {updateInfo?.installKind
                    ? `${updateInfo.installKind}${updateInfo.packageManager ? ` · ${updateInfo.packageManager}` : ""}`
                    : "等待检测安装来源"}
                </div>
              </div>
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">
                  升级状态
                </div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {versionMismatch
                    ? "新版本已安装，等待运行态切换"
                    : updateInfo?.hasUpdate
                      ? `可升级至 ${updateInfo.latestVersion || "待确认"}`
                      : "当前未检测到新版本"}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500">
                  {updateDescription}
                </div>
              </div>
              {updateRuntimeNotice ? (
                <div
                  className={cn(
                    openClawSubPanelClassName,
                    updateRuntimeNotice.tone === "warning"
                      ? "border-sky-200 bg-sky-50/80"
                      : "border-rose-200 bg-rose-50/80",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium text-slate-500">
                        升级执行环境
                      </div>
                      <div
                        className={cn(
                          "mt-2 text-sm font-medium",
                          updateRuntimeNotice.tone === "warning"
                            ? "text-sky-700"
                            : "text-rose-700",
                        )}
                      >
                        {updateRuntimeNotice.title}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">
                        {updateRuntimeNotice.description}
                      </div>
                    </div>
                    {updateRuntimeNotice.actionLabel ? (
                      <button
                        type="button"
                        onClick={onUseRecommendedUpdateRuntime}
                        disabled={switchingRuntime || updating}
                        className={cn(
                          openClawSecondaryButtonClassName,
                          "px-3 py-2 text-xs",
                        )}
                      >
                        {switchingRuntime ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        {updateRuntimeNotice.actionLabel}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div
                className={cn(
                  openClawSubPanelClassName,
                  versionMismatch
                    ? "border-amber-200 bg-amber-50/80"
                    : "border-emerald-200 bg-emerald-50/70",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      版本生效状态
                    </div>
                    <div
                      className={cn(
                        "mt-2 text-sm font-medium",
                        versionMismatch ? "text-amber-700" : "text-emerald-700",
                      )}
                    >
                      {versionMismatch
                        ? "新版本已安装，运行态未切换"
                        : "当前运行版本已对齐"}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">
                      {versionMismatch
                        ? "这通常表示 Gateway 还在跑旧进程。重启后，桌面面板和 Dashboard 才会进入新版本。"
                        : running
                          ? "已安装版本与运行中版本一致。"
                          : "Gateway 启动后会继续确认版本是否已生效。"}
                    </div>
                  </div>
                  {versionMismatch ? (
                    <button
                      type="button"
                      onClick={onRestart}
                      disabled={!canRestart || restarting || switchingRuntime}
                      className={cn(
                        openClawSecondaryButtonClassName,
                        "px-3 py-2 text-xs",
                      )}
                    >
                      {restarting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      立即重启生效
                    </button>
                  ) : null}
                </div>
              </div>

              <OpenClawExecutionEnvironmentCard
                candidates={runtimeCandidates}
                preferredRuntimeId={preferredRuntimeId}
                busy={
                  switchingRuntime ||
                  checkingUpdate ||
                  updating ||
                  starting ||
                  stopping ||
                  restarting
                }
                description="升级会直接复用这里指定的 Node/OpenClaw 运行时。多版本 Node 共存时，建议先固定到实际安装 OpenClaw 的那个运行时，再执行一键升级。"
                onChange={onSelectPreferredRuntime}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onCheckUpdate}
                disabled={
                  switchingRuntime ||
                  checkingUpdate ||
                  updating ||
                  starting ||
                  stopping ||
                  restarting
                }
                className={cn(
                  openClawSecondaryButtonClassName,
                  "px-3 py-2 text-xs",
                )}
              >
                {checkingUpdate ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                检查更新
              </button>
              <button
                type="button"
                onClick={onUpdate}
                disabled={
                  switchingRuntime ||
                  updating ||
                  checkingUpdate ||
                  starting ||
                  stopping ||
                  restarting
                }
                className={cn(
                  openClawSecondaryButtonClassName,
                  "px-3 py-2 text-xs",
                )}
              >
                {updating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUpCircle className="h-3.5 w-3.5" />
                )}
                {updateInfo?.hasUpdate ? "智能升级到最新版本" : "智能升级"}
              </button>
            </div>
          </section>

          <section className={openClawPanelClassName}>
            <div className="text-sm font-medium text-slate-900">
              当前运行摘要
            </div>
            <div className="mt-4 grid gap-3">
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">
                  Gateway
                </div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {running ? "运行中" : gatewayStatus} · 端口 {gatewayPort}
                </div>
              </div>
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">
                  桌面面板
                </div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {dashboardWindowOpen ? "已打开，可直接聚焦" : "尚未打开"}
                </div>
              </div>
              <div className={openClawSubPanelClassName}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      最近一次操作日志
                    </div>
                    <div className="mt-2 text-sm font-medium text-slate-900">
                      {recentOperationLabel
                        ? `${recentOperationLabel} · ${recentLogCount} 条日志`
                        : "暂无最近操作记录"}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">
                      {recentOperationMessage ||
                        "执行安装、升级、重启等操作后，这里会保留一个查看日志入口。"}
                    </div>
                    {recentOperationTimeText ? (
                      <div className="mt-2 text-[11px] leading-5 text-slate-400">
                        {recentOperationSucceeded === null
                          ? "最近一次记录"
                          : recentOperationSucceeded
                            ? "最近一次成功操作"
                            : "最近一次失败操作"}
                        {` · ${recentOperationTimeText}`}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={onOpenRecentLogs}
                      disabled={!recentOperationLabel || recentLogCount === 0}
                      className={cn(
                        openClawSecondaryButtonClassName,
                        "px-3 py-2 text-xs",
                      )}
                    >
                      查看日志
                    </button>
                    <button
                      type="button"
                      onClick={onCopyRecentLogs}
                      disabled={!recentOperationLabel || recentLogCount === 0}
                      className={cn(
                        openClawSecondaryButtonClassName,
                        "px-3 py-2 text-xs",
                      )}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      复制日志
                    </button>
                    <button
                      type="button"
                      onClick={onCopyRecentDiagnosticBundle}
                      disabled={!recentOperationLabel || recentLogCount === 0}
                      className={cn(
                        openClawSecondaryButtonClassName,
                        "px-3 py-2 text-xs",
                      )}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      复制诊断包
                    </button>
                  </div>
                </div>
              </div>
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">
                  建议动作
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-600">
                  {running
                    ? "直接打开桌面面板查看 Dashboard；如页面异常，先做健康检查再尝试重启。"
                    : startReady
                      ? "可以先启动 Gateway；如果之前已经开过桌面面板，启动成功后再重新聚焦。"
                      : "先回到配置页选择 Provider 与模型，并完成一次同步。"}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
