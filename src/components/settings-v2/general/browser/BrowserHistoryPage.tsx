import { useContext, useEffect, useRef, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  clearBrowserHistory,
  listBrowserHistory,
  listenBrowserHistoryChanged,
  removeBrowserHistory,
  type BrowserHistoryPage as HistoryPage,
} from "@/lib/api/browserHistory";
import { BROWSER_SETTINGS_BUTTON } from "./BrowserSettingsFields";
import { BrowserHistoryNavigationContext } from "@/contexts/BrowserHistoryNavigationContext";

const HISTORY_PERIODS = [
  { value: "hour", labelKey: "browserHistory.hour" },
  { value: "day", labelKey: "browserHistory.day" },
  { value: "week", labelKey: "browserHistory.week" },
  { value: "all", labelKey: "browserHistory.all" },
] as const;

export function BrowserHistoryPage({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation("settings");
  const openAddress = useContext(BrowserHistoryNavigationContext);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [period, setPeriod] = useState("all");
  const [refresh, setRefresh] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState(false);
  const revision = useRef<number | null>(null);
  const request = useRef(0);
  const mounted = useRef(true);
  const pendingMutation = useRef(false);
  const pendingOpen = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    searchRef.current?.focus();
    let disposed = false;
    let stop: (() => void) | undefined;
    void listenBrowserHistoryChanged((next) => {
      if (revision.current !== next) setRefresh((value) => value + 1);
    })
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else stop = unsubscribe;
      })
      .catch(() => {
        if (!disposed) setError(true);
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  useEffect(() => {
    const version = ++request.current;
    setLoading(true);
    setError(false);
    setPage(null);
    const timer = setTimeout(
      () => {
        void listBrowserHistory({ query, limit: 50 })
          .then((result) => {
            if (version !== request.current || !mounted.current) return;
            revision.current = result.revision;
            setPage(result);
          })
          .catch(() => {
            if (version === request.current && mounted.current) setError(true);
          })
          .finally(() => {
            if (version === request.current && mounted.current)
              setLoading(false);
          });
      },
      query ? 150 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, refresh]);
  const loadMore = async () => {
    if (!page?.nextCursor || loading) return;
    const version = ++request.current;
    setLoading(true);
    setError(false);
    try {
      const next = await listBrowserHistory({
        query,
        cursor: page.nextCursor,
        limit: 50,
      });
      if (version === request.current && mounted.current) {
        revision.current = next.revision;
        setPage({ ...next, entries: [...page.entries, ...next.entries] });
      }
    } catch {
      if (version === request.current && mounted.current) {
        setError(true);
        setRefresh((value) => value + 1);
      }
    } finally {
      if (version === request.current && mounted.current) setLoading(false);
    }
  };
  const mutate = async (operation: () => Promise<unknown>) => {
    if (pendingMutation.current || pendingOpen.current) return;
    pendingMutation.current = true;
    setMutating(true);
    setError(false);
    try {
      await operation();
      if (mounted.current) {
        setConfirmation(false);
        setRefresh((value) => value + 1);
      }
    } catch {
      if (mounted.current) setError(true);
    } finally {
      pendingMutation.current = false;
      if (mounted.current) setMutating(false);
    }
  };
  const openEntry = async (id: string, url: string) => {
    if (!openAddress || pendingOpen.current || pendingMutation.current) return;
    pendingOpen.current = true;
    setOpening(id);
    setOpenError(false);
    try {
      await openAddress(url);
    } catch {
      if (mounted.current) setOpenError(true);
    } finally {
      pendingOpen.current = false;
      if (mounted.current) setOpening(null);
    }
  };
  return (
    <div
      className="mx-auto max-w-[640px] space-y-5 pb-8"
      data-testid="browser-history-page"
    >
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-3.5" />
        {t("browserHistory.back")}
      </button>
      <header>
        <h1 className="text-xl font-semibold">{t("browserHistory.title")}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("browserHistory.description")}
        </p>
      </header>
      <div className="flex items-center gap-2">
        <input
          ref={searchRef}
          type="search"
          aria-label={t("browserHistory.search")}
          placeholder={t("browserHistory.search")}
          value={query}
          onChange={(event) => {
            ++request.current;
            setQuery(event.target.value);
          }}
          className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
        />
        <button
          type="button"
          className={BROWSER_SETTINGS_BUTTON}
          disabled={mutating || opening !== null}
          onClick={() => setConfirmation(true)}
        >
          {t("browserHistory.clear")}
        </button>
      </div>
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 text-xs text-destructive"
        >
          {t("browserHistory.error")}
          <button
            type="button"
            className={BROWSER_SETTINGS_BUTTON}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("browserHistory.retry")}
          </button>
        </div>
      ) : null}
      {!openAddress ? (
        <p className="text-xs text-muted-foreground">
          {t("browserHistory.openUnavailable")}
        </p>
      ) : null}
      {openError ? (
        <p role="alert" className="text-xs text-destructive">
          {t("browserHistory.openError")}
        </p>
      ) : null}
      {confirmation ? (
        <section
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="browser-history-confirm"
          className="space-y-3 rounded-xl border border-border p-4"
        >
          <p id="browser-history-confirm" className="text-sm">
            {t("browserHistory.confirm")}
          </p>
          <select
            aria-label={t("browserHistory.period")}
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            disabled={mutating || opening !== null}
            className="h-8 rounded border border-border bg-background px-2 text-xs"
          >
            {HISTORY_PERIODS.map(({ value, labelKey }) => (
              <option key={value} value={value}>
                {t(labelKey)}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={BROWSER_SETTINGS_BUTTON}
              disabled={mutating || opening !== null}
              onClick={() => setConfirmation(false)}
            >
              {t("browserHistory.cancel")}
            </button>
            <button
              type="button"
              className={`${BROWSER_SETTINGS_BUTTON} text-destructive`}
              disabled={mutating || opening !== null}
              onClick={() =>
                void mutate(() =>
                  clearBrowserHistory(
                    period === "all"
                      ? {}
                      : {
                          since:
                            Date.now() -
                            ({ hour: 3600000, day: 86400000, week: 604800000 }[
                              period
                            ] ?? 0),
                        },
                  ),
                )
              }
            >
              {t("browserHistory.clear")}
            </button>
          </div>
        </section>
      ) : null}
      <div aria-busy={loading || mutating || opening !== null}>
        {!page?.entries.length ? (
          <p
            role="status"
            className="py-10 text-center text-sm text-muted-foreground"
          >
            {t(
              loading
                ? "browserHistory.loading"
                : query
                  ? "browserHistory.noResults"
                  : "browserHistory.empty",
            )}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {page.entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 py-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:text-primary disabled:cursor-default"
                  aria-label={t("browserHistory.open", {
                    title: entry.title || entry.url,
                  })}
                  aria-busy={opening === entry.id}
                  disabled={!openAddress || mutating || opening !== null}
                  onClick={() => void openEntry(entry.id, entry.url)}
                >
                  <span
                    className="block truncate text-sm"
                    title={entry.title || entry.url}
                  >
                    {entry.title || entry.url}
                  </span>
                  <span
                    className="block truncate text-xs text-muted-foreground"
                    title={entry.url}
                  >
                    {entry.url}
                  </span>
                  <time
                    dateTime={new Date(entry.lastVisitedAt).toISOString()}
                    className="block text-[11px] text-muted-foreground"
                  >
                    {new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(entry.lastVisitedAt)}
                  </time>
                </button>
                <button
                  type="button"
                  className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-40"
                  aria-label={t("browserHistory.remove", {
                    title: entry.title || entry.url,
                  })}
                  disabled={mutating || opening !== null}
                  onClick={() =>
                    void mutate(() => removeBrowserHistory([entry.id]))
                  }
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {page?.nextCursor ? (
          <button
            type="button"
            className={`${BROWSER_SETTINGS_BUTTON} mt-4 w-full`}
            disabled={loading || mutating}
            onClick={() => void loadMore()}
          >
            {t("browserHistory.loadMore")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
