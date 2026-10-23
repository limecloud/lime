import { useCallback, useEffect, useRef, useState } from "react";
import {
  listBrowserDownloads,
  listenBrowserDownloadsChanged,
  type BrowserDownloadEntry,
  type BrowserDownloadsPage,
} from "@/lib/api/browserDownloads";
import { isFinishedDownload } from "./browserDownloadsView";
import { BrowserDownloadsProjection } from "./browserDownloadsProjection";

const PAGE_SIZE = 100;

function mergeEntries(entries: BrowserDownloadEntry[]): BrowserDownloadEntry[] {
  const unique = new Map<string, BrowserDownloadEntry>();
  for (const entry of entries) {
    const previous = unique.get(entry.id);
    if (!previous || entry.updatedAt >= previous.updatedAt)
      unique.set(entry.id, entry);
  }
  return [...unique.values()].sort(
    (left, right) =>
      right.startedAt - left.startedAt || left.id.localeCompare(right.id),
  );
}

export function useBrowserDownloads() {
  const [query, setQueryState] = useState("");
  const [page, setPage] = useState<BrowserDownloadsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [listenError, setListenError] = useState(false);
  const [canClear, setCanClear] = useState(false);
  const [subscription, setSubscription] = useState(0);
  const mounted = useRef(false);
  const request = useRef(0);
  const queryRef = useRef("");
  const pageRef = useRef<BrowserDownloadsPage | null>(null);
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const morePending = useRef(false);
  const refreshPending = useRef(false);
  const firstQuery = useRef(true);
  const loadedPages = useRef(1);
  const live = useRef(new BrowserDownloadsProjection());

  const refresh = useCallback(async () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const currentQuery = queryRef.current;
    const version = ++request.current;
    const wanted = loadedPages.current;
    const isCurrent = () =>
      mounted.current &&
      version === request.current &&
      currentQuery === queryRef.current;
    morePending.current = false;
    refreshPending.current = true;
    setLoading(true);
    setLoadingMore(false);
    setError(false);
    setMoreError(false);
    try {
      let result: BrowserDownloadsPage | null = null;
      const entries: BrowserDownloadEntry[] = [];
      let offset = 0;
      let fetched = 0;
      do {
        const [next, unfiltered] = await Promise.all([
          listBrowserDownloads({
            query: currentQuery,
            offset,
            limit: PAGE_SIZE,
          }),
          fetched === 0 && currentQuery
            ? listBrowserDownloads({ query: "", offset: 0, limit: PAGE_SIZE })
            : Promise.resolve(null),
        ]);
        if (!isCurrent()) return;
        if (
          next.revision < revision.current ||
          next.historyRevision < live.current.historyRevision ||
          (result &&
            (result.historyRevision !== next.historyRevision ||
              next.revision < result.revision))
        )
          throw new Error("Download list changed during pagination");
        live.current.read(next);
        if (fetched === 0) {
          const history = unfiltered ?? next;
          setCanClear(
            history.nextOffset !== null ||
              history.entries.some(isFinishedDownload),
          );
        }
        entries.push(...next.entries);
        result = { ...next, entries: mergeEntries(entries) };
        ++fetched;
        if (next.nextOffset === null) break;
        if (next.nextOffset <= offset)
          throw new Error("Download pagination did not advance");
        offset = next.nextOffset;
      } while (fetched < wanted);
      result = live.current.project(result);
      revision.current = result.revision;
      loadedPages.current = fetched;
      pageRef.current = result;
      setPage(result);
    } catch {
      if (isCurrent()) setError(true);
    } finally {
      if (isCurrent()) {
        refreshPending.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    ++request.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const delay = firstQuery.current ? 0 : 200;
    firstQuery.current = false;
    timer.current = setTimeout(() => {
      timer.current = null;
      void refresh();
    }, delay);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [query, refresh]);
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    setListenError(false);
    void listenBrowserDownloadsChanged((change) => {
      if (disposed) return;
      const update = live.current.change(change);
      if (update === "stale") return;
      if (update === "progress") {
        if (pageRef.current) {
          pageRef.current = live.current.project(pageRef.current);
          setPage(pageRef.current);
        }
        return;
      }
      ++request.current;
      if (timer.current === null) void refresh();
    })
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
      })
      .catch(() => {
        if (!disposed) setListenError(true);
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [refresh, subscription]);

  const setQuery = useCallback((value: string) => {
    if (queryRef.current === value) return;
    ++request.current;
    queryRef.current = value;
    pageRef.current = null;
    loadedPages.current = 1;
    morePending.current = false;
    refreshPending.current = false;
    setPage(null);
    setLoading(true);
    setLoadingMore(false);
    setError(false);
    setMoreError(false);
    setQueryState(value);
  }, []);

  const loadMore = useCallback(async () => {
    const previous = pageRef.current;
    if (
      !previous ||
      previous.nextOffset === null ||
      morePending.current ||
      refreshPending.current
    )
      return;
    const currentQuery = queryRef.current;
    const version = ++request.current;
    const isCurrent = () =>
      mounted.current &&
      version === request.current &&
      currentQuery === queryRef.current;
    morePending.current = true;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const next = await listBrowserDownloads({
        query: currentQuery,
        offset: previous.nextOffset,
        limit: PAGE_SIZE,
      });
      if (!isCurrent()) return;
      if (
        next.historyRevision !== previous.historyRevision ||
        next.historyRevision < live.current.historyRevision ||
        next.revision < revision.current
      ) {
        await refresh();
        return;
      }
      live.current.read(next);
      const merged = live.current.project({
        ...next,
        entries: mergeEntries([
          ...(pageRef.current ?? previous).entries,
          ...next.entries,
        ]),
      });
      revision.current = next.revision;
      ++loadedPages.current;
      pageRef.current = merged;
      setPage(merged);
    } catch {
      if (isCurrent()) setMoreError(true);
    } finally {
      if (isCurrent()) {
        morePending.current = false;
        setLoadingMore(false);
      }
    }
  }, [refresh]);

  const retry = useCallback(() => {
    if (listenError) setSubscription((value) => value + 1);
    void refresh();
  }, [listenError, refresh]);
  return {
    query,
    setQuery,
    page,
    loading,
    loadingMore,
    error,
    moreError,
    listenError,
    canClear,
    retry,
    refresh,
    loadMore,
  };
}
