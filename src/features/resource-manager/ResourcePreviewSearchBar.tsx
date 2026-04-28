import { forwardRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

interface ResourcePreviewSearchBarProps {
  query: string;
  matchCount: number;
  activeMatchIndex: number;
  onQueryChange: (query: string) => void;
  onPreviousMatch: () => void;
  onNextMatch: () => void;
  placeholder: string;
}

export const ResourcePreviewSearchBar = forwardRef<
  HTMLInputElement,
  ResourcePreviewSearchBarProps
>(function ResourcePreviewSearchBar(
  {
    query,
    matchCount,
    activeMatchIndex,
    onQueryChange,
    onPreviousMatch,
    onNextMatch,
    placeholder,
  },
  ref,
) {
  const hasQuery = query.trim().length > 0;
  const hasMatches = hasQuery && matchCount > 0;
  const matchLabel = hasQuery
    ? hasMatches
      ? `${activeMatchIndex + 1}/${matchCount}`
      : "0 处"
    : "";

  return (
    <div className="relative flex h-8 min-w-0 items-center gap-1">
      <div className="relative flex h-8 min-w-0 items-center">
        <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-slate-400" />
        <input
          ref={ref}
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (event.shiftKey) {
            onPreviousMatch();
            return;
          }
          onNextMatch();
        }}
        data-testid="resource-preview-search-input"
          className="h-8 w-52 rounded-lg border border-slate-200 bg-white pl-8 pr-16 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#13c95b] focus:ring-2 focus:ring-[#13c95b]/15"
          placeholder={placeholder}
          aria-label={placeholder}
        />
        <span className="pointer-events-none absolute right-7 text-[11px] text-slate-400">
          {matchLabel}
        </span>
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="absolute right-2 inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="清空预览查找"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onPreviousMatch}
        disabled={!hasMatches}
        data-testid="resource-preview-search-previous"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-black/5 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="上一个搜索命中"
        title="上一个搜索命中"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onNextMatch}
        disabled={!hasMatches}
        data-testid="resource-preview-search-next"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-black/5 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="下一个搜索命中"
        title="下一个搜索命中"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
    </div>
  );
});
