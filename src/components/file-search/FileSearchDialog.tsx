import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { getAgentRuntimeSession } from "@/lib/api/agentRuntime/sessionClient";
import {
  searchProjectFiles,
  type ProjectFileSearchResult,
} from "@/lib/api/fuzzyFileSearch";
import { getConversationTabsSnapshot } from "@/lib/conversationTabs";

const OPEN_EVENT = "lime:open-file-search";

export function FileSearchHost() {
  const { t } = useTranslation("navigation");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [results, setResults] = useState<ProjectFileSearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setSelected(0);
    const sessionId = getConversationTabsSnapshot().activeSessionId;
    if (!sessionId) {
      setRootPath(null);
      return;
    }
    let cancelled = false;
    void getAgentRuntimeSession(sessionId)
      .then((session) => {
        if (!cancelled) setRootPath(session?.working_dir?.trim() || null);
      })
      .catch(() => {
        if (!cancelled) setRootPath(null);
      });
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !rootPath || !query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchProjectFiles({
        query: query.trim(),
        rootPath,
        cancellationToken: `file-search:${Date.now()}`,
      })
        .then((files) => {
          if (!cancelled) {
            setResults(files);
            setSelected(0);
          }
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, rootPath]);

  const choose = useCallback(
    async (file: ProjectFileSearchResult) => {
      const absolute = file.path.startsWith("/")
        ? file.path
        : `${file.root.replace(/\/$/, "")}/${file.path}`;
      try {
        await navigator.clipboard.writeText(absolute);
        toast.success(t("fileSearch.copied", { path: file.path }));
      } catch {
        toast.error(t("fileSearch.copyFailed"));
      }
      setOpen(false);
    },
    [t],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-[18vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("fileSearch.title")}
        className="w-[min(680px,calc(100vw-32px))] overflow-hidden rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-[color:var(--lime-surface-border)] px-3">
          <Search className="h-4 w-4 text-[color:var(--lime-text-muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("fileSearch.placeholder")}
            aria-label={t("fileSearch.title")}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[color:var(--lime-text-strong)] outline-none"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((index) =>
                  results.length ? (index + 1) % results.length : 0,
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((index) =>
                  results.length
                    ? (index - 1 + results.length) % results.length
                    : 0,
                );
              } else if (event.key === "Enter" && results[selected]) {
                event.preventDefault();
                void choose(results[selected]);
              }
            }}
          />
        </div>
        <div className="max-h-[46vh] overflow-auto p-1">
          {!rootPath ? (
            <p className="px-3 py-6 text-sm text-[color:var(--lime-text-muted)]">
              {t("fileSearch.noWorkspace")}
            </p>
          ) : loading ? (
            <p className="px-3 py-6 text-sm text-[color:var(--lime-text-muted)]">
              {t("fileSearch.loading")}
            </p>
          ) : results.length ? (
            results.map((file, index) => (
              <button
                key={`${file.root}:${file.path}`}
                type="button"
                className={`flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-sm ${
                  index === selected
                    ? "bg-[color:var(--lime-surface-hover)]"
                    : ""
                }`}
                onMouseEnter={() => setSelected(index)}
                onClick={() => void choose(file)}
              >
                <span className="min-w-0 truncate text-[color:var(--lime-text-strong)]">
                  {file.file_name}
                </span>
                <span className="shrink-0 text-xs text-[color:var(--lime-text-muted)]">
                  {file.path}
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-6 text-sm text-[color:var(--lime-text-muted)]">
              {query.trim() ? t("fileSearch.empty") : t("fileSearch.hint")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
