import { useMemo, useState } from "react";
import { ChevronDown, Cpu, Package, TerminalSquare } from "lucide-react";
import type { OpenClawRuntimeCandidate } from "@/lib/api/openclaw";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { openClawSubPanelClassName } from "./openclawStyles";
import { compactPathLabel } from "./pathDisplay";

const AUTO_RUNTIME_VALUE = "__auto_runtime__";

interface OpenClawExecutionEnvironmentCardProps {
  candidates: OpenClawRuntimeCandidate[];
  preferredRuntimeId: string | null;
  busy?: boolean;
  description: string;
  className?: string;
  onChange: (runtimeId: string | null) => void;
}

function formatRuntimeHeading(
  candidate: OpenClawRuntimeCandidate | null,
): string {
  if (!candidate) {
    return "自动选择";
  }

  return `${candidate.source} · Node ${candidate.nodeVersion || "未识别"}`;
}

function formatRuntimeSelectionLabel(
  candidate: OpenClawRuntimeCandidate | null,
  preferredRuntimeId: string | null,
): string {
  if (!candidate) {
    return "自动选择";
  }

  return preferredRuntimeId
    ? `固定：${formatRuntimeHeading(candidate)}`
    : `自动：${formatRuntimeHeading(candidate)}`;
}

function formatOpenClawStatus(
  candidate: OpenClawRuntimeCandidate | null,
): string {
  if (!candidate) {
    return "尚未检测到可用运行时";
  }

  if (candidate.openclawVersion) {
    return `OpenClaw ${candidate.openclawVersion}`;
  }

  if (candidate.openclawPath) {
    return "已检测到 OpenClaw 命令";
  }

  if (candidate.openclawPackagePath) {
    return "已检测到 OpenClaw 包";
  }

  return "当前运行时尚未安装 OpenClaw";
}

function buildEnvironmentDetails(
  candidate: OpenClawRuntimeCandidate | null,
): Array<{ label: string; value: string }> {
  if (!candidate) {
    return [];
  }

  return [
    { label: "Node.js 可执行文件", value: candidate.nodePath },
    { label: "运行时 bin 目录", value: candidate.binDir },
    { label: "npm 命令", value: candidate.npmPath || "" },
    { label: "npm 全局前缀", value: candidate.npmGlobalPrefix || "" },
    { label: "OpenClaw 命令", value: candidate.openclawPath || "" },
    { label: "OpenClaw 包路径", value: candidate.openclawPackagePath || "" },
  ].filter((item) => item.value.trim().length > 0);
}

export function OpenClawExecutionEnvironmentCard({
  candidates,
  preferredRuntimeId,
  busy = false,
  description,
  className,
  onChange,
}: OpenClawExecutionEnvironmentCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const currentCandidate =
    (preferredRuntimeId
      ? candidates.find((candidate) => candidate.id === preferredRuntimeId)
      : null) ||
    candidates.find((candidate) => candidate.isPreferred) ||
    candidates.find((candidate) => candidate.isActive) ||
    candidates[0] ||
    null;
  const selectValue = preferredRuntimeId || AUTO_RUNTIME_VALUE;
  const showSelector = candidates.length > 0;
  const environmentDetails = useMemo(
    () => buildEnvironmentDetails(currentCandidate),
    [currentCandidate],
  );

  return (
    <div className={cn(openClawSubPanelClassName, className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-slate-500">执行环境</div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {formatRuntimeSelectionLabel(currentCandidate, preferredRuntimeId)}
          </div>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-500">
          {preferredRuntimeId ? "已固定" : "自动选择"}
        </span>
      </div>

      <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>

      {showSelector ? (
        <div className="mt-4">
          <Select
            value={selectValue}
            onValueChange={(value) =>
              onChange(value === AUTO_RUNTIME_VALUE ? null : value)
            }
            disabled={busy}
          >
            <SelectTrigger className="h-auto rounded-2xl border-slate-200/80 bg-white px-4 py-3 text-left shadow-none focus:ring-slate-300">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">
                  {formatRuntimeSelectionLabel(
                    currentCandidate,
                    preferredRuntimeId,
                  )}
                </div>
                <div
                  className="mt-1 truncate text-xs text-slate-500"
                  title={currentCandidate?.binDir || undefined}
                >
                  {currentCandidate?.binDir
                    ? compactPathLabel(currentCandidate.binDir, 56)
                    : "由 Lime 自动选择最合适的运行时"}
                </div>
              </div>
            </SelectTrigger>
            <SelectContent className="rounded-2xl border-slate-200 bg-white p-2 shadow-xl shadow-slate-950/8">
              <SelectItem
                value={AUTO_RUNTIME_VALUE}
                className="rounded-xl px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">
                    自动选择
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    自动优先使用兼容且更合适的 Node/OpenClaw 运行时。
                  </div>
                </div>
              </SelectItem>
              {candidates.map((candidate) => (
                <SelectItem
                  key={candidate.id}
                  value={candidate.id}
                  className="rounded-xl px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {formatRuntimeHeading(candidate)}
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">
                      {candidate.openclawVersion
                        ? `OpenClaw ${candidate.openclawVersion}`
                        : candidate.openclawPackagePath
                          ? "已检测到 OpenClaw 包"
                          : "当前运行时未安装 OpenClaw"}
                    </div>
                    <div
                      className="mt-1 truncate text-[11px] text-slate-400"
                      title={candidate.binDir}
                    >
                      {compactPathLabel(candidate.binDir, 56)}
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white px-3 py-3">
          <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
            <Cpu className="h-3.5 w-3.5" />
            Node.js
          </div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {currentCandidate?.nodeVersion || "未识别"}
          </div>
          <div
            className="mt-1 truncate text-[11px] leading-5 text-slate-500"
            title={currentCandidate?.nodePath || undefined}
          >
            {currentCandidate?.nodePath
              ? compactPathLabel(currentCandidate.nodePath, 46)
              : "未检测到"}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white px-3 py-3">
          <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
            <Package className="h-3.5 w-3.5" />
            OpenClaw
          </div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {formatOpenClawStatus(currentCandidate)}
          </div>
          <div
            className="mt-1 truncate text-[11px] leading-5 text-slate-500"
            title={
              currentCandidate?.openclawPath ||
              currentCandidate?.openclawPackagePath ||
              undefined
            }
          >
            {currentCandidate?.openclawPath
              ? compactPathLabel(currentCandidate.openclawPath, 46)
              : currentCandidate?.openclawPackagePath
                ? compactPathLabel(currentCandidate.openclawPackagePath, 46)
                : "切换到该运行时后可直接安装 OpenClaw。"}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white px-3 py-3">
          <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
            <TerminalSquare className="h-3.5 w-3.5" />
            npm 前缀
          </div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {currentCandidate?.source || "未识别"}
          </div>
          <div
            className="mt-1 truncate text-[11px] leading-5 text-slate-500"
            title={
              currentCandidate?.npmGlobalPrefix ||
              currentCandidate?.npmPath ||
              undefined
            }
          >
            {currentCandidate?.npmGlobalPrefix
              ? compactPathLabel(currentCandidate.npmGlobalPrefix, 46)
              : currentCandidate?.npmPath
                ? compactPathLabel(currentCandidate.npmPath, 46)
                : "当前未检测到 npm 全局前缀"}
          </div>
        </div>
      </div>

      {environmentDetails.length > 0 ? (
        <Collapsible
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          className="mt-4"
        >
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80">
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900">
                  环境详情
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  默认只保留运行时摘要，排查路径与前缀冲突时再展开完整信息。
                </p>
              </div>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  {detailsOpen ? "收起详情" : "查看详情"}
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      detailsOpen ? "rotate-180" : "rotate-0",
                    )}
                  />
                </button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent>
              <div className="border-t border-slate-200/80 px-4 py-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {environmentDetails.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-3"
                    >
                      <div className="text-[11px] font-medium text-slate-500">
                        {item.label}
                      </div>
                      <div className="mt-1 break-all text-xs leading-6 text-slate-700">
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ) : null}
    </div>
  );
}

export default OpenClawExecutionEnvironmentCard;
