import { useContext, useEffect, useRef, useState } from "react";
import { BrowserHistoryNavigationContext } from "@/contexts/BrowserHistoryNavigationContext";
import {
  listBrowserHistoryVisits,
  listenBrowserHistoryChanged,
  removeBrowserHistoryVisits,
} from "@/lib/api/browserHistory";
import { getBrowsingDataSettings } from "@/lib/api/browserData";
import {
  browserHistoryVisitKey,
  type BrowserHistorySource,
  type BrowserHistoryVisitRow,
  type BrowserHistoryVisitTarget,
  type BrowserHistoryVisitsPage,
} from "@/lib/api/browserHistoryVisits";

export function useBrowserHistory() {
  const openAddress = useContext(BrowserHistoryNavigationContext);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<BrowserHistorySource>("all");
  const [page, setPage] = useState<BrowserHistoryVisitsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<
    "load" | "more" | "remove" | "open" | null
  >(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [operation, setOperation] = useState<"remove" | "open" | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [canRemove, setCanRemove] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const lifecycle = useRef({
    mounted: true,
    request: 0,
    loading: false,
    canRemove: false,
    operation: null as "remove" | "open" | null,
    revision: -1,
  });
  const state = lifecycle.current;
  useEffect(() => {
    state.mounted = true;
    let disposed = false;
    let stop: (() => void) | undefined;
    void getBrowsingDataSettings()
      .then((settings) => {
        if (disposed) return;
        state.canRemove = settings.dataRemovalPermitted.history;
        setCanRemove(state.canRemove);
        setSettingsReady(true);
      })
      .catch(() => undefined);
    void listenBrowserHistoryChanged((revision) => {
      if (!disposed && state.revision !== revision)
        setRefresh((value) => value + 1);
    })
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else stop = unsubscribe;
      })
      .catch(() => {
        if (!disposed) setError("load");
      });
    return () => {
      disposed = true;
      state.mounted = false;
      state.request++;
      stop?.();
    };
  }, [state]);
  useEffect(() => {
    const request = ++state.request;
    state.loading = true;
    setLoading(true);
    setError(null);
    const timer = setTimeout(
      () => {
        void listBrowserHistoryVisits({ query, source, limit: 100 })
          .then((next) => {
            if (!state.mounted || state.request !== request) return;
            state.revision = next.revision;
            setPage(next);
            const keys = new Set(next.entries.map(browserHistoryVisitKey));
            setSelected(
              (previous) =>
                new Set([...previous].filter((key) => keys.has(key))),
            );
          })
          .catch(() => {
            if (state.mounted && state.request === request) setError("load");
          })
          .finally(() => {
            if (state.mounted && state.request === request) {
              state.loading = false;
              setLoading(false);
            }
          });
      },
      query ? 200 : 0,
    );
    return () => {
      clearTimeout(timer);
      state.request++;
    };
  }, [query, source, refresh, state]);

  const changeScope = (nextQuery: string, nextSource: BrowserHistorySource) => {
    if (state.operation || (query === nextQuery && source === nextSource))
      return;
    state.request++;
    setPage(null);
    setSelected(new Set());
    setExpanded(null);
    setError(null);
    setQuery(nextQuery);
    setSource(nextSource);
  };
  const loadMore = async () => {
    if (!page?.nextCursor || state.loading || state.operation) return;
    const request = ++state.request;
    state.loading = true;
    setLoading(true);
    setError(null);
    try {
      const next = await listBrowserHistoryVisits({
        query,
        source,
        cursor: page.nextCursor,
        limit: 100,
      });
      if (state.mounted && state.request === request) {
        state.revision = next.revision;
        setPage({ ...next, entries: [...page.entries, ...next.entries] });
      }
    } catch {
      if (state.mounted && state.request === request) setError("more");
    } finally {
      if (state.mounted && state.request === request) {
        state.loading = false;
        setLoading(false);
      }
    }
  };
  const remove = async (entries: BrowserHistoryVisitTarget[]) => {
    if (
      !state.mounted ||
      !state.canRemove ||
      state.operation ||
      !entries.length
    )
      return;
    state.operation = "remove";
    setOperation("remove");
    setError(null);
    try {
      await removeBrowserHistoryVisits(entries);
      if (state.mounted) {
        setSelected(new Set());
        setRefresh((value) => value + 1);
      }
    } catch {
      if (state.mounted) setError("remove");
    } finally {
      state.operation = null;
      if (state.mounted) setOperation(null);
    }
  };
  const open = async (entry: BrowserHistoryVisitRow) => {
    if (!state.mounted || !openAddress || state.operation) return;
    state.operation = "open";
    setOperation("open");
    setError(null);
    try {
      await openAddress(entry.url);
    } catch {
      if (state.mounted) setError("open");
    } finally {
      state.operation = null;
      if (state.mounted) setOperation(null);
    }
  };
  return {
    query,
    source,
    page,
    loading,
    error,
    selected,
    expanded,
    busy: operation !== null,
    canOpen: Boolean(openAddress),
    canRemove,
    settingsReady,
    changeQuery: (value: string) => changeScope(value, source),
    changeSource: (value: BrowserHistorySource) => changeScope(query, value),
    toggleSelection: (entry: BrowserHistoryVisitRow) => {
      if (state.operation || !state.canRemove) return;
      const key = browserHistoryVisitKey(entry);
      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    toggleGroup: (key: string, firstKey: string) =>
      setExpanded((previous) => {
        const next = new Set(previous ?? [firstKey]);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    retry: () => {
      if (!state.operation) {
        setError(null);
        setRefresh((value) => value + 1);
      }
    },
    loadMore,
    remove,
    open,
  };
}
