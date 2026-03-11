import {
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
} from "@/lib/api/openclaw";
import { OpenClawMark } from "./OpenClawMark";

interface OpenClawRuntimePageProps {
  gatewayStatus: OpenClawGatewayStatus;
  gatewayPort: number;
  healthInfo: OpenClawHealthInfo | null;
  channelCount: number;
  startReady: boolean;
  canStart: boolean;
  canStop: boolean;
  canRestart: boolean;
  starting: boolean;
  stopping: boolean;
  restarting: boolean;
  checkingHealth: boolean;
  dashboardWindowOpen: boolean;
  dashboardWindowBusy: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onOpenDashboard: () => void;
  onOpenDashboardPage: () => void;
  onBackToConfigure: () => void;
  onCheckHealth: () => void;
}

function titleForStatus(status: OpenClawGatewayStatus): string {
  switch (status) {
    case "running":
      return "OpenClaw";
    case "starting":
      return "OpenClaw 启动中";
    case "error":
      return "OpenClaw 启动异常";
    default:
      return "OpenClaw";
  }
}

function descriptionForStatus(status: OpenClawGatewayStatus): string {
  switch (status) {
    case "running":
      return "Gateway 已经准备就绪，现在可以直接打开桌面面板。";
    case "starting":
      return "Gateway 正在启动，请稍等片刻后打开 Dashboard。";
    case "error":
      return "Gateway 当前状态异常，建议先检查健康状态或返回配置页重新启动。";
    default:
      return "Gateway 当前未运行，完成启动后即可打开 Dashboard。";
  }
}

export function OpenClawRuntimePage({
  gatewayStatus,
  gatewayPort,
  healthInfo,
  channelCount,
  startReady,
  canStart,
  canStop,
  canRestart,
  starting,
  stopping,
  restarting,
  checkingHealth,
  dashboardWindowOpen,
  dashboardWindowBusy,
  onStart,
  onStop,
  onRestart,
  onOpenDashboard,
  onOpenDashboardPage,
  onBackToConfigure,
  onCheckHealth,
}: OpenClawRuntimePageProps) {
  const running = gatewayStatus === "running";
  const healthText = healthInfo
    ? `${healthInfo.status}${healthInfo.version ? ` · ${healthInfo.version}` : ""}${healthInfo.uptime ? ` · 运行 ${healthInfo.uptime}s` : ""}`
    : "尚未执行健康检查";

  return (
    <div className="flex min-h-0 flex-col items-center px-6 py-10">
      <div className="w-full max-w-[760px] space-y-6">
        <div className="flex flex-col items-center text-center">
          <OpenClawMark size="lg" />
          <h1 className="mt-6 text-4xl font-semibold tracking-tight">
            {titleForStatus(gatewayStatus)}
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            {descriptionForStatus(gatewayStatus)}
          </p>
        </div>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="rounded-full border bg-background px-4 py-2 text-sm text-muted-foreground">
              <span
                className={
                  running ? "text-emerald-600" : "text-muted-foreground"
                }
              >
                ●
              </span>{" "}
              {running ? "运行中" : gatewayStatus} · {gatewayPort}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onStart}
                disabled={!canStart || starting}
                className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
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
                className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
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
                className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
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

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="text-sm font-medium">健康状态</div>
            <div className="mt-3 text-sm leading-7 text-muted-foreground">
              {healthText}
            </div>
            <button
              type="button"
              onClick={onCheckHealth}
              disabled={checkingHealth || !running}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
            >
              {checkingHealth ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              检查
            </button>
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="text-sm font-medium">通道状态</div>
            <div className="mt-3 text-sm leading-7 text-muted-foreground">
              {running
                ? `当前已发现 ${channelCount} 个通道，可通过桌面面板或浏览器访问 Dashboard。`
                : startReady
                  ? "Gateway 启动后会自动刷新可用通道数量。"
                  : "当前尚未完成模型配置同步，请先返回配置页选择模型后再启动 Gateway。"}
            </div>
            <button
              type="button"
              onClick={onBackToConfigure}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs hover:bg-muted"
            >
              返回配置页
            </button>
          </section>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={onOpenDashboard}
            disabled={!running || dashboardWindowBusy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-base text-primary-foreground disabled:opacity-60"
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
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border px-5 py-3 text-base hover:bg-muted disabled:opacity-60"
          >
            <ExternalLink className="h-5 w-5" />
            进入 Dashboard 访问页
          </button>
        </div>
      </div>
    </div>
  );
}

export default OpenClawRuntimePage;
