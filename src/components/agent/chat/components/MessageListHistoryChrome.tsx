import React from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LIME_BRAND_LOGO_SRC, LIME_BRAND_NAME } from "@/lib/branding";

interface PersistedHistoryWindowProps {
  loadedEntries: number;
  hasMore: boolean;
  isLoadingFull?: boolean;
  error?: string | null;
  onLoadFullHistory?: () => void | Promise<void>;
}

export function PersistedHistoryWindow({
  loadedEntries,
  hasMore,
  isLoadingFull = false,
  error = null,
  onLoadFullHistory,
}: PersistedHistoryWindowProps) {
  const { t } = useTranslation("agent");

  return (
    <div
      data-testid="message-list-persisted-history-window"
      className="flex flex-wrap items-center gap-3 py-1 text-sm text-slate-500"
    >
      <button
        type="button"
        data-testid="message-list-load-full-history"
        className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!hasMore || isLoadingFull || !onLoadFullHistory}
        onClick={() => {
          void onLoadFullHistory?.();
        }}
      >
        {isLoadingFull
          ? t("agentChat.messageList.history.loadingMore")
          : t("agentChat.messageList.history.showEarlier", {
              count: loadedEntries,
            })}
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {error ? <span className="text-red-600">{error}</span> : null}
    </div>
  );
}

export function RestoringSessionEmptyState() {
  const { t } = useTranslation("agent");

  return (
    <div
      className="w-full px-6 pb-10 pt-8"
      data-testid="message-list-restoring-session"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex w-full max-w-[672px] flex-col gap-8">
        <span className="sr-only">
          {t("agentChat.messageList.restoring.title")}
        </span>
        <span className="sr-only">
          {t("agentChat.messageList.restoring.description")}
        </span>
        {[0, 1, 2].map((row) => (
          <div key={row} className="animate-pulse space-y-3">
            <div className="h-3 w-28 rounded-full bg-[var(--lime-surface-border)] opacity-60" />
            <div className="space-y-2">
              <div className="h-3 w-full rounded-full bg-[var(--lime-surface-border)] opacity-40" />
              <div className="h-3 w-[88%] rounded-full bg-[var(--lime-surface-border)] opacity-40" />
              {row !== 1 ? (
                <div className="h-3 w-[64%] rounded-full bg-[var(--lime-surface-border)] opacity-40" />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TaskCenterEmptyState() {
  const { t } = useTranslation("agent");

  return (
    <div className="flex min-h-[18rem] items-center justify-center px-6 py-8">
      <section
        data-testid="message-list-empty-task-center"
        className="w-full max-w-[560px] text-left"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-slate-200/80 bg-slate-50/80">
            <img
              src={LIME_BRAND_LOGO_SRC}
              alt={LIME_BRAND_NAME}
              className="h-5 w-5 opacity-80"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-500">
                {t("agentChat.messageList.taskCenterEmpty.badge")}
              </div>
              <h2 className="text-xl font-semibold text-slate-900">
                {t("agentChat.messageList.taskCenterEmpty.title")}
              </h2>
              <p className="max-w-[34rem] text-sm leading-6 text-slate-600">
                {t("agentChat.messageList.taskCenterEmpty.description")}
              </p>
              <p className="text-sm leading-6 text-slate-500">
                {t("agentChat.messageList.taskCenterEmpty.helper")}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-1.5 pl-12 text-xs text-slate-500">
          <span>{t("agentChat.messageList.taskCenterEmpty.chip.pending")}</span>
          <span>
            {t("agentChat.messageList.taskCenterEmpty.chip.organized")}
          </span>
          <span>{t("agentChat.messageList.taskCenterEmpty.chip.restore")}</span>
        </div>
      </section>
    </div>
  );
}
