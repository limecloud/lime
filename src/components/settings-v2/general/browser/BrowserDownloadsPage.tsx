import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  clearBrowserDownloads,
  manageBrowserDownload,
  type BrowserDownloadEntry,
} from "@/lib/api/browserDownloads";
import { BROWSER_SETTINGS_BUTTON } from "./BrowserSettingsFields";
import { useBrowserDownloads } from "./useBrowserDownloads";
import { BrowserDownloadRow } from "./BrowserDownloadRow";
import { BrowserManagementHeader } from "./BrowserManagementHeader";

function localDay(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function BrowserDownloadsPage({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation("settings");
  const downloads = useBrowserDownloads();
  const [pending, setPending] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<{
    query: string;
    days: ReadonlySet<string>;
  } | null>(null);
  const mounted = useRef(false);
  const activeOperation = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const more = useRef<HTMLDivElement>(null);
  const groupPrefix = useId();
  const loadMore = downloads.loadMore;
  const canLoadMore =
    downloads.page?.nextOffset != null &&
    !downloads.loading &&
    !downloads.loadingMore &&
    !downloads.moreError &&
    pending === null;
  useEffect(() => {
    mounted.current = true;
    search.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (
      !more.current ||
      !canLoadMore ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    let disposed = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!disposed && entries.some((entry) => entry.isIntersecting))
          void loadMore();
      },
      { rootMargin: "160px" },
    );
    observer.observe(more.current);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [canLoadMore, loadMore]);
  const groups = useMemo(() => {
    const grouped = new Map<string, BrowserDownloadEntry[]>();
    for (const entry of downloads.page?.entries ?? []) {
      const day = localDay(entry.startedAt);
      const entries = grouped.get(day) ?? [];
      entries.push(entry);
      grouped.set(day, entries);
    }
    return [...grouped];
  }, [downloads.page]);
  const operate = async (key: string, operation: () => Promise<void>) => {
    if (activeOperation.current) return;
    activeOperation.current = true;
    setPending(key);
    try {
      await operation();
      if (mounted.current) {
        await downloads.refresh();
      }
    } catch {
      if (mounted.current)
        toast.error(
          t(
            key === "clear"
              ? "browserDownloads.clearError"
              : "browserDownloads.operationError",
          ),
        );
    } finally {
      activeOperation.current = false;
      if (mounted.current) setPending(null);
    }
  };
  const loadFailed = downloads.error || downloads.listenError;
  return (
    <div
      className="mx-auto w-full max-w-[640px] space-y-5 pb-8"
      data-testid="browser-downloads-page"
    >
      <BrowserManagementHeader
        title={t("browserDownloads.title")}
        onBack={onBack}
      />
      <div className="sticky top-0 z-10 bg-background py-2">
        <input
          ref={search}
          type="search"
          aria-label={t("browserDownloads.search")}
          placeholder={t("browserDownloads.search")}
          value={downloads.query}
          onChange={(event) => downloads.setQuery(event.target.value)}
          className="h-8 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm"
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{t("browserDownloads.allTime")}</h2>
        <button
          type="button"
          className={BROWSER_SETTINGS_BUTTON}
          disabled={pending !== null || !downloads.canClear}
          aria-busy={pending === "clear"}
          onClick={() => void operate("clear", clearBrowserDownloads)}
        >
          {t("browserDownloads.clear")}
        </button>
      </div>
      {loadFailed ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 text-xs text-destructive"
        >
          {t(
            downloads.listenError
              ? "browserDownloads.liveError"
              : "browserDownloads.loadError",
          )}
          <button
            type="button"
            className={BROWSER_SETTINGS_BUTTON}
            disabled={downloads.loading}
            onClick={downloads.retry}
          >
            {t("browserDownloads.retry")}
          </button>
        </div>
      ) : null}
      <div
        aria-busy={
          downloads.loading || downloads.loadingMore || pending !== null
        }
      >
        {!downloads.page?.entries.length ? (
          !loadFailed ? (
            <div
              role="status"
              className="py-10 text-center text-sm text-muted-foreground"
            >
              <p>
                {t(
                  downloads.loading
                    ? "browserDownloads.loading"
                    : downloads.query
                      ? "browserDownloads.noResults"
                      : "browserDownloads.empty",
                )}
              </p>
              {!downloads.loading ? (
                <p className="mt-1 text-xs">
                  {t(
                    downloads.query
                      ? "browserDownloads.noResultsDescription"
                      : "browserDownloads.emptyDescription",
                  )}
                </p>
              ) : null}
            </div>
          ) : null
        ) : (
          groups.map(([day, entries], index) => {
            const isExpanded =
              expanded?.query === downloads.query
                ? expanded.days.has(day)
                : index === 0;
            const groupId = `${groupPrefix}-${day}`;
            return (
              <section
                key={day}
                className="border-b border-border last:border-b-0"
              >
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={groupId}
                  className="flex w-full items-center gap-2 rounded py-3 text-left text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() =>
                    setExpanded((previous) => {
                      const days = new Set(
                        previous?.query === downloads.query
                          ? previous.days
                          : groups[0]
                            ? [groups[0][0]]
                            : [],
                      );
                      if (isExpanded) days.delete(day);
                      else days.add(day);
                      return { query: downloads.query, days };
                    })
                  }
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={`size-3.5 ${isExpanded ? "rotate-90" : ""}`}
                  />
                  {new Intl.DateTimeFormat(i18n.language, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }).format(entries[0].startedAt)}
                </button>
                <ul
                  id={groupId}
                  hidden={!isExpanded}
                  className="divide-y divide-border"
                >
                  {entries.map((entry) => (
                    <BrowserDownloadRow
                      key={entry.id}
                      entry={entry}
                      busy={pending === entry.id}
                      disabled={pending !== null}
                      onAction={(action) =>
                        void operate(entry.id, () =>
                          manageBrowserDownload(entry.id, action),
                        )
                      }
                    />
                  ))}
                </ul>
              </section>
            );
          })
        )}
        {Boolean(downloads.page?.entries.length) && downloads.loading ? (
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            {t("browserDownloads.refreshing")}
          </p>
        ) : null}
        {downloads.moreError ? (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {t("browserDownloads.moreError")}
          </p>
        ) : null}
        {downloads.page?.nextOffset !== null && downloads.page ? (
          <div ref={more} data-testid="browser-downloads-more">
            <button
              type="button"
              className={
                downloads.moreError ||
                typeof IntersectionObserver === "undefined"
                  ? `${BROWSER_SETTINGS_BUTTON} mt-4 w-full`
                  : "sr-only focus:not-sr-only"
              }
              disabled={
                downloads.loading || downloads.loadingMore || pending !== null
              }
              onClick={() => void downloads.loadMore()}
            >
              {t(
                downloads.loadingMore
                  ? "browserDownloads.loading"
                  : downloads.moreError
                    ? "browserDownloads.retryMore"
                    : "browserDownloads.loadMore",
              )}
            </button>
            {downloads.loadingMore ? (
              <p
                role="status"
                className="py-3 text-center text-xs text-muted-foreground"
              >
                {t("browserDownloads.loading")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
