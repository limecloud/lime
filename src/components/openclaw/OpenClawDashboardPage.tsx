import {
  ArrowLeft,
  ArrowUpCircle,
  Copy,
  ExternalLink,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
} from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { copyTextToClipboard } from "@/lib/crashDiagnostic";
import { cn } from "@/lib/utils";
import {
  openClawPanelClassName,
  openClawPrimaryButtonClassName,
  openClawSecondaryButtonClassName,
  openClawSubPanelClassName,
} from "./openclawStyles";

interface OpenClawDashboardPageProps {
  dashboardUrl: string | null;
  loading: boolean;
  running: boolean;
  windowBusy: boolean;
  windowOpen: boolean;
  hasUpdate?: boolean;
  latestVersion?: string | null;
  updating?: boolean;
  onBack: () => void;
  onOpenExternal: () => void;
  onOpenWindow: () => void;
  onRefresh: () => void;
  onUpdate?: () => void;
}

export function OpenClawDashboardPage({
  dashboardUrl,
  loading,
  running,
  windowBusy,
  windowOpen,
  hasUpdate = false,
  latestVersion = null,
  updating = false,
  onBack,
  onOpenExternal,
  onOpenWindow,
  onRefresh,
  onUpdate,
}: OpenClawDashboardPageProps) {
  const actionDisabled = !running || !dashboardUrl || loading || windowBusy;
  const hasDashboardToken = useMemo(() => {
    if (!dashboardUrl) {
      return false;
    }

    try {
      const url = new URL(dashboardUrl);
      return (
        url.searchParams.has("token") ||
        new URLSearchParams(url.hash.replace(/^#/, "")).has("token")
      );
    } catch {
      return /[#?&]token=/.test(dashboardUrl);
    }
  }, [dashboardUrl]);

  const maskedDashboardUrl = useMemo(() => {
    if (!dashboardUrl) {
      return "正在读取 Dashboard 地址...";
    }

    try {
      const url = new URL(dashboardUrl);
      const queryToken = url.searchParams.get("token");
      if (queryToken) {
        const visiblePrefix = queryToken.slice(0, 6);
        const visibleSuffix = queryToken.slice(-4);
        url.searchParams.set("token", `${visiblePrefix}***${visibleSuffix}`);
      }

      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
      const hashToken = hashParams.get("token");
      if (hashToken) {
        const visiblePrefix = hashToken.slice(0, 6);
        const visibleSuffix = hashToken.slice(-4);
        hashParams.set("token", `${visiblePrefix}***${visibleSuffix}`);
        url.hash = hashParams.toString();
      }
      return url.toString();
    } catch {
      return dashboardUrl.replace(
        /(token=)([^&#]+)/,
        (_match, prefix, value: string) => {
          const visiblePrefix = value.slice(0, 6);
          const visibleSuffix = value.slice(-4);
          return `${prefix}${visiblePrefix}***${visibleSuffix}`;
        },
      );
    }
  }, [dashboardUrl]);

  const handleCopyDashboardUrl = async () => {
    if (!dashboardUrl) {
      toast.error("当前没有可复制的 Dashboard 地址。");
      return;
    }

    try {
      await copyTextToClipboard(dashboardUrl, {
        fallbackErrorMessage: "复制 Dashboard 地址失败，请重试。",
        permissionDeniedMessage:
          "剪贴板权限被系统拒绝，请先点击 Lime 窗口后重试复制 Dashboard 地址。",
        inactiveWindowMessage:
          "当前窗口未激活，先点击 Lime 窗口后再复制 Dashboard 地址。",
      });
      toast.success("完整 Dashboard 地址已复制。");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "复制 Dashboard 地址失败。",
      );
    }
  };

  return (
    <div className="space-y-4">
      <section className={openClawPanelClassName}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-sky-700">
              DASHBOARD ACCESS
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
              Dashboard 访问方式
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              已移除内嵌模式。Dashboard 请通过桌面面板或系统浏览器访问，避免
              iframe 鉴权与兼容性问题。
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {windowOpen ? "桌面面板已打开" : "桌面面板未打开"}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {hasDashboardToken ? "已携带 token" : "未检测到 token"}
              </span>
            </div>
          </div>

          <div className="flex w-full flex-wrap gap-3 xl:max-w-[360px] xl:justify-end">
            {hasUpdate && onUpdate ? (
              <button
                type="button"
                onClick={onUpdate}
                disabled={updating || loading || windowBusy}
                className={cn(
                  openClawPrimaryButtonClassName,
                  "min-w-[132px] px-5 py-2.5",
                )}
              >
                {updating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUpCircle className="h-4 w-4" />
                )}
                升级到 {latestVersion || "最新版本"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || windowBusy}
              className={cn(
                openClawSecondaryButtonClassName,
                "min-w-[132px] px-5 py-2.5",
              )}
            >
              {loading || windowBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              刷新状态
            </button>
            <button
              type="button"
              onClick={onBack}
              className={cn(
                openClawSecondaryButtonClassName,
                "min-w-[132px] px-5 py-2.5",
              )}
            >
              <ArrowLeft className="h-4 w-4" />
              返回运行页
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className={openClawPanelClassName}>
          <div className="text-sm font-medium text-slate-900">访问方式</div>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            这里保留两种稳定方式：桌面面板和系统浏览器。桌面面板适合日常使用，浏览器更适合诊断
            token 与页面状态。
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={onOpenWindow}
              disabled={actionDisabled}
              className={cn(
                openClawPrimaryButtonClassName,
                "w-full px-5 py-3 text-base",
              )}
            >
              {windowBusy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <MonitorSmartphone className="h-5 w-5" />
              )}
              {windowOpen ? "聚焦桌面面板" : "打开桌面面板"}
            </button>

            <button
              type="button"
              onClick={onOpenExternal}
              disabled={actionDisabled}
              className={cn(
                openClawSecondaryButtonClassName,
                "w-full px-5 py-3 text-base",
              )}
            >
              <ExternalLink className="h-5 w-5" />
              在系统浏览器中打开
            </button>
          </div>
        </section>

        <section className={openClawPanelClassName}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                当前地址
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                页面中只显示脱敏地址；复制按钮会复制完整带 token 的访问链接。
              </p>
            </div>

            <button
              type="button"
              onClick={handleCopyDashboardUrl}
              disabled={!dashboardUrl}
              className={cn(
                openClawSecondaryButtonClassName,
                "px-3 py-2 text-xs",
              )}
            >
              <Copy className="h-4 w-4" />
              复制完整地址
            </button>
          </div>

          <div className="mt-4 grid gap-3">
            <div className={openClawSubPanelClassName}>
              <div className="text-xs font-medium text-slate-500">
                token 状态
              </div>
              <div className="mt-2 text-sm font-medium text-slate-900">
                {hasDashboardToken ? "已携带 token" : "未检测到 token"}
              </div>
            </div>

            <div className={openClawSubPanelClassName}>
              <div className="text-xs font-medium text-slate-500">脱敏地址</div>
              <div className="mt-2 break-all text-sm leading-6 text-slate-600">
                {maskedDashboardUrl}
              </div>
            </div>
          </div>

          <p className="mt-3 text-xs leading-6 text-slate-500">
            Gateway 重启后 token 可能变化；如遇 401
            或空白页，先点“刷新状态”再重新打开。
          </p>
        </section>
      </div>
    </div>
  );
}

export default OpenClawDashboardPage;
