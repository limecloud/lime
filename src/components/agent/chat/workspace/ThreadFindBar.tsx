import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

const HIGHLIGHT_NAME = "lime-thread-find";
const ACTIVE_HIGHLIGHT_NAME = "lime-thread-find-active";
const MAX_MATCHES = 500;

function collectMatches(root: Element, query: string): Range[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && ranges.length < MAX_MATCHES) {
    const text = node.nodeValue ?? "";
    const lower = text.toLocaleLowerCase();
    let offset = 0;
    while (ranges.length < MAX_MATCHES) {
      const index = lower.indexOf(normalized, offset);
      if (index < 0) break;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + normalized.length);
      ranges.push(range);
      offset = index + normalized.length;
    }
    node = walker.nextNode();
  }
  return ranges;
}

function applyHighlights(ranges: Range[], activeIndex: number) {
  const registry = (
    window as typeof window & {
      CSS?: { highlights?: Map<string, unknown> };
      Highlight?: new (...ranges: Range[]) => unknown;
    }
  ).CSS?.highlights;
  const HighlightCtor = (
    window as typeof window & {
      Highlight?: new (...ranges: Range[]) => unknown;
    }
  ).Highlight;
  if (!registry || !HighlightCtor) return;
  if (ranges.length === 0) {
    registry.delete(HIGHLIGHT_NAME);
    registry.delete(ACTIVE_HIGHLIGHT_NAME);
    return;
  }
  registry.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges));
  const active = ranges[activeIndex];
  if (active) {
    registry.set(ACTIVE_HIGHLIGHT_NAME, new HighlightCtor(active));
  } else {
    registry.delete(ACTIVE_HIGHLIGHT_NAME);
  }
}

function clearHighlights() {
  const registry = (
    window as typeof window & {
      CSS?: { highlights?: Map<string, unknown> };
    }
  ).CSS?.highlights;
  registry?.delete(HIGHLIGHT_NAME);
  registry?.delete(ACTIVE_HIGHLIGHT_NAME);
}

export function ThreadFindBar() {
  const { t } = useTranslation("agent");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [ranges, setRanges] = useState<Range[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setRanges([]);
    setActiveIndex(0);
    clearHighlights();
  }, []);

  useEffect(() => {
    const openFind = () => {
      setOpen(true);
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    };
    window.addEventListener("lime:open-thread-find", openFind);
    return () => window.removeEventListener("lime:open-thread-find", openFind);
  }, []);

  useEffect(() => {
    if (!open) return;
    const root = document.querySelector('[data-testid="message-list"]');
    const next = root ? collectMatches(root, query) : [];
    setRanges(next);
    setActiveIndex(0);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    applyHighlights(ranges, activeIndex);
    const active = ranges[activeIndex];
    const element = active?.startContainer.parentElement;
    element?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [activeIndex, open, ranges]);

  useEffect(() => () => clearHighlights(), []);

  if (!open) return null;
  const total = ranges.length;
  const current = total === 0 ? 0 : activeIndex + 1;

  const move = (delta: number) => {
    if (total === 0) return;
    setActiveIndex((index) => (index + delta + total) % total);
  };

  return (
    <div
      className="fixed right-6 top-14 z-[80] flex w-[min(360px,calc(100vw-32px))] items-center gap-1 rounded-lg border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] px-2 py-1.5 shadow-lg"
      data-testid="thread-find-bar"
      role="search"
    >
      <Search size={14} className="shrink-0 text-[color:var(--lime-text-muted)]" />
      <input
        ref={inputRef}
        className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none"
        placeholder={t("threadFind.placeholder")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if (event.key === "Enter") {
            event.preventDefault();
            move(event.shiftKey ? -1 : 1);
          }
        }}
        aria-label={t("threadFind.placeholder")}
        data-testid="thread-find-input"
      />
      <span className="shrink-0 px-1 text-xs text-[color:var(--lime-text-muted)]" data-testid="thread-find-count">
        {query.trim()
          ? total === 0
            ? t("threadFind.noResults")
            : t("threadFind.count", { current, total })
          : ""}
      </span>
      <button
        type="button"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)] disabled:opacity-40"
        onClick={() => move(-1)}
        disabled={total === 0}
        aria-label={t("threadFind.previous")}
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)] disabled:opacity-40"
        onClick={() => move(1)}
        disabled={total === 0}
        aria-label={t("threadFind.next")}
      >
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)]"
        onClick={close}
        aria-label={t("threadFind.close")}
      >
        <X size={14} />
      </button>
    </div>
  );
}
