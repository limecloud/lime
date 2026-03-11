import type { ReactNode } from "react";
import {
  Download,
  ExternalLink,
  GitBranch,
  Loader2,
  Package,
  RefreshCw,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import type {
  OpenClawDependencyStatus,
  OpenClawEnvironmentStatus,
} from "@/lib/api/openclaw";
import { OpenClawMark } from "./OpenClawMark";

interface OpenClawInstallPageProps {
  environmentStatus: OpenClawEnvironmentStatus | null;
  busy: boolean;
  installing: boolean;
  installingNode: boolean;
  installingGit: boolean;
  cleaningTemp: boolean;
  onInstall: () => void;
  onInstallNode: () => void;
  onInstallGit: () => void;
  onRefresh: () => void;
  onCleanupTemp: () => void;
  onOpenDocs: () => void;
  onDownloadNode: () => void;
  onDownloadGit: () => void;
}

function resolveStatusTone(status: OpenClawDependencyStatus["status"]): string {
  switch (status) {
    case "ok":
      return "text-emerald-600";
    case "version_low":
      return "text-amber-600";
    case "missing":
      return "text-rose-600";
    default:
      return "text-muted-foreground";
  }
}

function resolveStatusLabel(
  status: OpenClawDependencyStatus["status"],
): string {
  switch (status) {
    case "ok":
      return "已就绪";
    case "version_low":
      return "版本过低";
    case "missing":
      return "未检测到";
    default:
      return status;
  }
}

function DependencyCard({
  title,
  icon,
  status,
  busy,
  primaryLabel,
  onPrimaryAction,
  secondaryLabel,
  onSecondaryAction,
}: {
  title: string;
  icon: ReactNode;
  status: OpenClawDependencyStatus | null;
  busy: boolean;
  primaryLabel?: string;
  onPrimaryAction?: () => void;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
}) {
  const resolvedStatus = status || {
    status: "unknown",
    version: null,
    path: null,
    message: "尚未检测",
    autoInstallSupported: false,
  };
  const pathText = resolvedStatus.path || "当前未检测到路径";

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </div>
        <span
          className={`text-xs font-medium ${resolveStatusTone(resolvedStatus.status)}`}
        >
          {resolveStatusLabel(resolvedStatus.status)}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {resolvedStatus.message}
      </p>

      <div className="mt-3 rounded-xl bg-muted/50 px-3 py-2 text-xs leading-6 text-muted-foreground">
        <div>版本：{resolvedStatus.version || "未检测到"}</div>
        <div className="break-all">路径：{pathText}</div>
      </div>

      {(primaryLabel || secondaryLabel) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {primaryLabel && onPrimaryAction ? (
            <button
              type="button"
              onClick={onPrimaryAction}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {primaryLabel}
            </button>
          ) : null}
          {secondaryLabel && onSecondaryAction ? (
            <button
              type="button"
              onClick={onSecondaryAction}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs hover:bg-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {secondaryLabel}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function OpenClawInstallPage({
  environmentStatus,
  busy,
  installing,
  installingNode,
  installingGit,
  cleaningTemp,
  onInstall,
  onInstallNode,
  onInstallGit,
  onRefresh,
  onCleanupTemp,
  onOpenDocs,
  onDownloadNode,
  onDownloadGit,
}: OpenClawInstallPageProps) {
  const nodeReady = environmentStatus?.node.status === "ok";
  const gitReady = environmentStatus?.git.status === "ok";
  const openclawReady = environmentStatus?.openclaw.status === "ok";
  const installLabel = openclawReady
    ? "重新安装 OpenClaw"
    : nodeReady && gitReady
      ? "安装 OpenClaw"
      : "一键修复环境并安装 OpenClaw";

  return (
    <div className="flex min-h-0 flex-col items-center px-6 py-10">
      <div className="w-full max-w-5xl space-y-8">
        <div className="flex flex-col items-center text-center">
          <OpenClawMark size="lg" />
          <h1 className="mt-6 text-4xl font-semibold tracking-tight">
            OpenClaw 环境安装
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            {environmentStatus?.summary ||
              "正在检查 Node.js、Git 与 OpenClaw 环境，稍后会给出一键修复建议。"}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onInstall}
              disabled={busy}
              className="inline-flex min-w-[220px] items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm text-primary-foreground disabled:opacity-60"
            >
              {installing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {installLabel}
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={busy}
              className="inline-flex min-w-[132px] items-center justify-center gap-2 rounded-lg border px-5 py-2.5 text-sm hover:bg-muted disabled:opacity-60"
            >
              <RefreshCw className="h-4 w-4" />
              重新检测
            </button>
            <button
              type="button"
              onClick={onCleanupTemp}
              disabled={busy}
              className="inline-flex min-w-[132px] items-center justify-center gap-2 rounded-lg border px-5 py-2.5 text-sm hover:bg-muted disabled:opacity-60"
            >
              {cleaningTemp ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              清理临时文件
            </button>
            <button
              type="button"
              onClick={onOpenDocs}
              className="inline-flex min-w-[140px] items-center justify-center gap-2 rounded-lg border px-5 py-2.5 text-sm hover:bg-muted"
            >
              <ExternalLink className="h-4 w-4" />
              查看文档
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <DependencyCard
            title="Node.js"
            icon={<TerminalSquare className="h-4 w-4" />}
            status={environmentStatus?.node ?? null}
            busy={busy && installingNode}
            primaryLabel={
              environmentStatus?.node.autoInstallSupported &&
              environmentStatus?.node.status !== "ok"
                ? "一键安装 Node.js"
                : undefined
            }
            onPrimaryAction={onInstallNode}
            secondaryLabel="手动下载 Node.js"
            onSecondaryAction={onDownloadNode}
          />

          <DependencyCard
            title="Git"
            icon={<GitBranch className="h-4 w-4" />}
            status={environmentStatus?.git ?? null}
            busy={busy && installingGit}
            primaryLabel={
              environmentStatus?.git.autoInstallSupported &&
              environmentStatus?.git.status !== "ok"
                ? "一键安装 Git"
                : undefined
            }
            onPrimaryAction={onInstallGit}
            secondaryLabel="手动下载 Git"
            onSecondaryAction={onDownloadGit}
          />

          <DependencyCard
            title="OpenClaw"
            icon={<Package className="h-4 w-4" />}
            status={environmentStatus?.openclaw ?? null}
            busy={busy && installing}
            primaryLabel={!openclawReady ? "安装 OpenClaw" : undefined}
            onPrimaryAction={!openclawReady ? onInstall : undefined}
          />
        </div>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="text-sm font-medium">当前安装策略</div>
          <div className="mt-3 text-sm leading-7 text-muted-foreground">
            <p>- 优先复用系统里已满足要求的 Node.js / Git，避免重复安装。</p>
            <p>
              -
              缺失依赖时，优先尝试应用内一键安装；若当前平台不支持，则自动降级到手动下载引导。
            </p>
            <p>- 安装完成后会自动重新检测环境，并继续执行 OpenClaw 安装。</p>
          </div>

          {environmentStatus?.tempArtifacts?.length ? (
            <div className="mt-4 rounded-xl bg-muted/50 px-4 py-3 text-xs leading-6 text-muted-foreground">
              <div className="font-medium text-foreground">
                可清理的临时文件
              </div>
              <div className="mt-2 space-y-1">
                {environmentStatus.tempArtifacts.map((item) => (
                  <div key={item} className="break-all">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export default OpenClawInstallPage;
