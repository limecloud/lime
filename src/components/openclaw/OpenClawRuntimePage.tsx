import {
  ArrowUpCircle,
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
  OpenClawUpdateInfo,
} from "@/lib/api/openclaw";
import { cn } from "@/lib/utils";
import {
  openClawPanelClassName,
  openClawPrimaryButtonClassName,
  openClawSecondaryButtonClassName,
  openClawSubPanelClassName,
} from "./openclawStyles";

interface OpenClawRuntimePageProps {
  gatewayStatus: OpenClawGatewayStatus;
  gatewayPort: number;
  healthInfo: OpenClawHealthInfo | null;
  updateInfo: OpenClawUpdateInfo | null;
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
  updating: boolean;
  dashboardWindowOpen: boolean;
  dashboardWindowBusy: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onOpenDashboard: () => void;
  onOpenDashboardPage: () => void;
  onBackToConfigure: () => void;
  onCheckHealth: () => void;
  onCheckUpdate: () => void;
  onUpdate: () => void;
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
  updating,
  dashboardWindowOpen,
  dashboardWindowBusy,
  onStart,
  onStop,
  onRestart,
  onOpenDashboard,
  onOpenDashboardPage,
  onBackToConfigure,
  onCheckHealth,
  onCheckUpdate,
  onUpdate,
}: OpenClawRuntimePageProps) {
  const running = gatewayStatus === "running";
  const healthText = healthInfo
    ? `${healthInfo.status}${healthInfo.version ? ` · ${healthInfo.version}` : ""}${healthInfo.uptime ? ` · 运行 ${healthInfo.uptime}s` : ""}`
    : "尚未执行健康检查";
  const versionText = updateInfo?.currentVersion || healthInfo?.version || "未检测到";
  const updateStatusLabel = updateInfo?.hasUpdate ? "可升级" : "已检查";
  const updateDescription = updateInfo?.hasUpdate
    ? `检测到新版本 ${updateInfo.latestVersion || "待确认"}。`
    : updateInfo?.message
      ? updateInfo.message
      : "可在工作台内直接检查和执行 OpenClaw 升级。";

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

          <div className="flex w-full flex-wrap gap-3 xl:max-w-[520px] xl:justify-end">
            <button
              type="button"
              onClick={onStart}
              disabled={!canStart || starting}
              className={cn(
                openClawPrimaryButtonClassName,
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
              disabled={!canStop || stopping}
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
              disabled={!canRestart || restarting}
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
                disabled={checkingHealth || !running}
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
              Dashboard 访问方式
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              建议优先使用桌面面板；如果需要调试 token 或地址，再进入 Dashboard
              访问页查看详情。
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={onOpenDashboard}
                disabled={!running || dashboardWindowBusy}
                className={cn(
                  openClawPrimaryButtonClassName,
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
                <div className="text-sm font-medium text-slate-900">版本升级</div>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  在工作台内检查并升级 OpenClaw 本体，升级完成后会自动刷新版本状态。
                </p>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {updateStatusLabel}
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">当前版本</div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {versionText}
                </div>
              </div>
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">更新通道</div>
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
                <div className="text-xs font-medium text-slate-500">升级状态</div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {updateInfo?.hasUpdate
                    ? `可升级至 ${updateInfo.latestVersion || "待确认"}`
                    : "当前未检测到新版本"}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500">
                  {updateDescription}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onCheckUpdate}
                disabled={
                  checkingUpdate || updating || starting || stopping || restarting
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
                  updating || checkingUpdate || starting || stopping || restarting
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
                {updateInfo?.hasUpdate ? "升级到最新版本" : "执行升级"}
              </button>
            </div>
          </section>

          <section className={openClawPanelClassName}>
            <div className="text-sm font-medium text-slate-900">当前运行摘要</div>
            <div className="mt-4 grid gap-3">
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">Gateway</div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {running ? "运行中" : gatewayStatus} · 端口 {gatewayPort}
                </div>
              </div>
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">桌面面板</div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {dashboardWindowOpen ? "已打开，可直接聚焦" : "尚未打开"}
                </div>
              </div>
              <div className={openClawSubPanelClassName}>
                <div className="text-xs font-medium text-slate-500">建议动作</div>
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

export default OpenClawRuntimePage;
