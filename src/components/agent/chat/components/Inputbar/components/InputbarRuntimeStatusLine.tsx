import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  resolveConfiguredProviderPromptCacheSupportNotice,
  useConfiguredProviders,
} from "@/hooks/useConfiguredProviders";
import type { AgentI18nKey } from "@/i18n/agentResources";
import type { InputbarRuntimeStatusLineModel } from "../../../utils/inputbarRuntimeStatusLine";
import {
  buildTokenUsageSummaryCopy,
  resolvePromptCacheActivity,
  resolvePromptCacheMetaText,
  resolveUsageInputOutputSummary,
} from "../../../utils/tokenUsageSummary";

interface InputbarRuntimeStatusLineProps {
  runtime: InputbarRuntimeStatusLineModel | null;
  providerType?: string | null;
  canStop?: boolean;
}

const RUNTIME_STATUS_LABEL_KEYS = {
  queued: "agentChat.inputbar.runtimeStatus.status.queued",
  running: "agentChat.inputbar.runtimeStatus.status.running",
  waiting_input: "agentChat.inputbar.runtimeStatus.status.waitingInput",
  completed: "agentChat.inputbar.runtimeStatus.status.completed",
  failed: "agentChat.inputbar.runtimeStatus.status.failed",
  aborted: "agentChat.inputbar.runtimeStatus.status.aborted",
} as const satisfies Record<InputbarRuntimeStatusLineModel["status"], string>;

const ACTIVE_RUNTIME_PHASE_LABEL_KEYS = {
  retrying: "agentChat.inputbar.runtimeStatus.phase.retrying",
  continuing: "agentChat.inputbar.runtimeStatus.phase.continuing",
  synthesizing: "agentChat.inputbar.runtimeStatus.phase.synthesizing",
} as const satisfies Record<string, string>;

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

function resolveStatusMeta(status: InputbarRuntimeStatusLineModel["status"]): {
  toneClassName: string;
  dotClassName: string;
  pulse: boolean;
} {
  switch (status) {
    case "queued":
      return {
        toneClassName: "text-slate-700",
        dotClassName: "bg-slate-400",
        pulse: false,
      };
    case "waiting_input":
      return {
        toneClassName: "text-amber-700",
        dotClassName: "bg-amber-500",
        pulse: false,
      };
    case "completed":
      return {
        toneClassName: "text-emerald-700",
        dotClassName: "bg-emerald-500",
        pulse: false,
      };
    case "failed":
      return {
        toneClassName: "text-rose-700",
        dotClassName: "bg-rose-500",
        pulse: false,
      };
    case "aborted":
      return {
        toneClassName: "text-slate-600",
        dotClassName: "bg-slate-400",
        pulse: false,
      };
    case "running":
    default:
      return {
        toneClassName: "text-emerald-700",
        dotClassName: "bg-emerald-500",
        pulse: true,
      };
  }
}

export const InputbarRuntimeStatusLine: React.FC<
  InputbarRuntimeStatusLineProps
> = ({ runtime, providerType, canStop = false }) => {
  const { t } = useTranslation("agent");
  const tokenUsageCopy = useMemo(
    () =>
      buildTokenUsageSummaryCopy((key, values) =>
        t(key as AgentI18nKey, values ?? {}),
      ),
    [t],
  );
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
  const activePhase =
    runtime.latestRuntimePhase &&
    runtime.latestRuntimePhase in ACTIVE_RUNTIME_PHASE_LABEL_KEYS
      ? runtime.latestRuntimePhase
      : null;
  const statusLabel = activePhase
    ? t(
        ACTIVE_RUNTIME_PHASE_LABEL_KEYS[
          activePhase as keyof typeof ACTIVE_RUNTIME_PHASE_LABEL_KEYS
        ] as AgentI18nKey,
        {},
      )
    : t(RUNTIME_STATUS_LABEL_KEYS[runtime.status] as AgentI18nKey, {});
  const elapsedText =
    startedAtMs && (completedAtMs || now) >= startedAtMs
      ? formatElapsed((completedAtMs || now) - startedAtMs)
      : null;
  const usageSummary = resolveUsageInputOutputSummary(
    runtime.usage,
    tokenUsageCopy,
  );
  const promptCacheMetaText = resolvePromptCacheMetaText(
    runtime.usage,
    tokenUsageCopy,
  );
  const promptCacheNoticeLabel =
    resolvePromptCacheActivity(runtime.usage) <= 0
      ? promptCacheNotice?.label?.trim() || null
      : null;
  const detailText =
    (runtime.status === "running" && activePhase) ||
    runtime.status === "waiting_input" ||
    runtime.status === "aborted"
      ? runtime.detail?.trim() ||
        (runtime.status === "aborted"
          ? t(
              "agentChat.inputbar.runtimeStatus.detail.aborted" as AgentI18nKey,
              {},
            )
          : null)
      : null;
  const segments: string[] = [];
  if (elapsedText) {
    segments.push(elapsedText);
  }
  if (runtime.batchDescriptor) {
    segments.push(
      t("agentChat.inputbar.runtimeStatus.segment.tools" as AgentI18nKey, {
        countLabel: runtime.batchDescriptor.countLabel,
      }),
    );
  }
  if (runtime.pendingRequestCount > 0) {
    segments.push(
      t(
        "agentChat.inputbar.runtimeStatus.segment.pendingRequests" as AgentI18nKey,
        {
          count: runtime.pendingRequestCount,
        },
      ),
    );
  }
  if (runtime.subtaskStats?.total) {
    segments.push(
      t("agentChat.inputbar.runtimeStatus.segment.subtasks" as AgentI18nKey, {
        active: runtime.subtaskStats.active,
        total: runtime.subtaskStats.total,
      }),
    );
  }
  if (usageSummary) {
    segments.push(usageSummary);
  }
  if (promptCacheMetaText) {
    segments.push(promptCacheMetaText);
  }
  if (promptCacheNoticeLabel) {
    segments.push(promptCacheNoticeLabel);
  }
  if (
    canStop &&
    (runtime.status === "running" || runtime.status === "queued")
  ) {
    segments.push(
      t("agentChat.inputbar.runtimeStatus.segment.canStop" as AgentI18nKey, {}),
    );
  }

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
        {statusLabel}
      </span>

      {segments.map((segment) => (
        <React.Fragment key={segment}>
          <span aria-hidden className="text-slate-300">
            {" "}
          </span>
          <span className="whitespace-nowrap">{segment}</span>
        </React.Fragment>
      ))}

      {detailText ? (
        <>
          <span aria-hidden className="text-slate-300">
            {" "}
          </span>
          <span
            className="min-w-0 max-w-[300px] truncate text-slate-400"
            aria-label={detailText}
          >
            {detailText}
          </span>
        </>
      ) : null}
    </div>
  );
};
