import React, { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  resolveConfiguredProviderPromptCacheSupportNotice,
  useConfiguredProviders,
} from "@/hooks/useConfiguredProviders";
import type { InputbarRuntimeStatusLineModel } from "../../../utils/inputbarRuntimeStatusLine";
import {
  resolvePromptCacheActivity,
  resolvePromptCacheMetaText,
  resolveUsageInputOutputSummary,
} from "../../../utils/tokenUsageSummary";

interface InputbarRuntimeStatusLineProps {
  runtime: InputbarRuntimeStatusLineModel | null;
  providerType?: string | null;
  canStop?: boolean;
}

function resolveTimestamp(value?: string | number | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      seconds,
    ).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0",
  )}`;
}

function resolveStatusMeta(
  status: InputbarRuntimeStatusLineModel["status"],
): {
  label: string;
  toneClassName: string;
  dotClassName: string;
  pulse: boolean;
} {
  switch (status) {
    case "queued":
      return {
        label: "排队中",
        toneClassName: "text-slate-700",
        dotClassName: "bg-slate-400",
        pulse: false,
      };
    case "waiting_input":
      return {
        label: "等待补充",
        toneClassName: "text-amber-700",
        dotClassName: "bg-amber-500",
        pulse: false,
      };
    case "completed":
      return {
        label: "已完成",
        toneClassName: "text-emerald-700",
        dotClassName: "bg-emerald-500",
        pulse: false,
      };
    case "failed":
      return {
        label: "失败",
        toneClassName: "text-rose-700",
        dotClassName: "bg-rose-500",
        pulse: false,
      };
    case "aborted":
      return {
        label: "已中断",
        toneClassName: "text-slate-600",
        dotClassName: "bg-slate-400",
        pulse: false,
      };
    case "running":
    default:
      return {
        label: "处理中",
        toneClassName: "text-emerald-700",
        dotClassName: "bg-emerald-500",
        pulse: true,
      };
  }
}

export const InputbarRuntimeStatusLine: React.FC<
  InputbarRuntimeStatusLineProps
> = ({ runtime, providerType, canStop = false }) => {
  const [now, setNow] = useState(() => Date.now());
  const startedAtMs = useMemo(
    () => resolveTimestamp(runtime?.startedAt),
    [runtime?.startedAt],
  );
  const completedAtMs = useMemo(
    () => resolveTimestamp(runtime?.completedAt),
    [runtime?.completedAt],
  );
  const shouldInspectPromptCacheNotice = Boolean(
    providerType?.trim() &&
      runtime?.usage &&
      resolvePromptCacheActivity(runtime.usage) <= 0,
  );
  const { providers } = useConfiguredProviders({
    autoLoad: shouldInspectPromptCacheNotice,
  });
  const promptCacheNotice = useMemo(
    () =>
      shouldInspectPromptCacheNotice
        ? resolveConfiguredProviderPromptCacheSupportNotice(
            providers,
            providerType,
          )
        : null,
    [providerType, providers, shouldInspectPromptCacheNotice],
  );

  useEffect(() => {
    if (!runtime || !startedAtMs || completedAtMs) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [completedAtMs, runtime, startedAtMs]);

  useEffect(() => {
    if (runtime) {
      setNow(Date.now());
    }
  }, [runtime]);

  if (!runtime) {
    return null;
  }

  const statusMeta = resolveStatusMeta(runtime.status);
  const elapsedText =
    startedAtMs && (completedAtMs || now) >= startedAtMs
      ? formatElapsed((completedAtMs || now) - startedAtMs)
      : null;
  const usageSummary = resolveUsageInputOutputSummary(runtime.usage);
  const promptCacheMetaText = resolvePromptCacheMetaText(runtime.usage);
  const promptCacheNoticeLabel =
    resolvePromptCacheActivity(runtime.usage) <= 0
      ? promptCacheNotice?.label?.trim() || null
      : null;
  const detailText =
    runtime.status === "waiting_input" ||
    runtime.status === "failed" ||
    runtime.status === "aborted"
      ? runtime.detail?.trim() || null
      : null;
  const segments = [
    elapsedText,
    runtime.batchDescriptor ? `工具 ${runtime.batchDescriptor.countLabel}` : null,
    runtime.pendingRequestCount > 0 ? `待补 ${runtime.pendingRequestCount}` : null,
    runtime.queuedTurnCount > 0 ? `排队 ${runtime.queuedTurnCount}` : null,
    runtime.subtaskStats?.total
      ? `任务 ${runtime.subtaskStats.active}/${runtime.subtaskStats.total}`
      : null,
    usageSummary,
    promptCacheMetaText,
    promptCacheNoticeLabel,
    canStop && (runtime.status === "running" || runtime.status === "queued")
      ? "可随时停止"
      : null,
  ].filter(Boolean) as string[];

  return (
    <div
      data-testid="inputbar-runtime-status-line"
      className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-5 text-slate-500"
    >
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 font-medium",
          statusMeta.toneClassName,
        )}
      >
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            statusMeta.dotClassName,
            statusMeta.pulse ? "animate-pulse" : "",
          )}
        />
        {statusMeta.label}
      </span>

      {segments.map((segment) => (
        <React.Fragment key={segment}>
          <span aria-hidden className="text-slate-300">
            ·
          </span>
          <span className="whitespace-nowrap">{segment}</span>
        </React.Fragment>
      ))}

      {detailText ? (
        <>
          <span aria-hidden className="text-slate-300">
            ·
          </span>
          <span
            className="min-w-0 max-w-[300px] truncate text-slate-400"
            title={detailText}
          >
            {detailText}
          </span>
        </>
      ) : null}
    </div>
  );
};

export default InputbarRuntimeStatusLine;
