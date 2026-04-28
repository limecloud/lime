import type { Ref } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getItemTitle,
  getKindFilterLabel,
  getKindIcon,
  getKindLabel,
  type ResourceManagerKindFilter,
} from "./resourceManagerPresentation";
import { getResourceDocumentProfile } from "./resourceDocumentProfiles";
import {
  getResourceFormatLabel,
  getResourcePreviewTarget,
} from "./resourceFormatCatalog";
import type { ResourceManagerItem } from "./types";

interface ResourceManagerSidebarProps {
  sourceLabel?: string | null;
  items: ResourceManagerItem[];
  visibleEntries: Array<{ item: ResourceManagerItem; index: number }>;
  activeIndex: number;
  searchQuery: string;
  kindFilter: ResourceManagerKindFilter;
  availableKindFilters: ResourceManagerKindFilter[];
  searchInputRef: Ref<HTMLInputElement>;
  onSearchQueryChange: (query: string) => void;
  onKindFilterChange: (kind: ResourceManagerKindFilter) => void;
  onSelectIndex: (index: number) => void;
  onClearFilters: () => void;
}

export function ResourceManagerSidebar({
  sourceLabel,
  items,
  visibleEntries,
  activeIndex,
  searchQuery,
  kindFilter,
  availableKindFilters,
  searchInputRef,
  onSearchQueryChange,
  onKindFilterChange,
  onSelectIndex,
  onClearFilters,
}: ResourceManagerSidebarProps) {
  return (
    <aside
      data-testid="resource-manager-item-list"
      className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-[#f7f7f7]"
    >
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="text-xs font-medium text-slate-500">
          {sourceLabel || "资源会话"}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-sm font-semibold text-slate-900">
          <span>{items.length} 个资源</span>
          {visibleEntries.length !== items.length ? (
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500">
              匹配 {visibleEntries.length}
            </span>
          ) : null}
        </div>
      </div>
      <div className="space-y-2 border-b border-slate-200 bg-[#f3f3f3] px-3 py-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
            data-testid="resource-manager-search-input"
            className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#13c95b] focus:ring-2 focus:ring-[#13c95b]/15"
            placeholder="搜索资源"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {availableKindFilters.map((kind) => {
            const active = kind === kindFilter;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => onKindFilterChange(kind)}
                data-testid={`resource-manager-kind-filter-${kind}`}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                  active
                    ? "border-[#13c95b] bg-[#13c95b] text-white"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800",
                )}
                aria-pressed={active}
              >
                {getKindFilterLabel(kind)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-width:thin]">
        {visibleEntries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-5 text-center text-sm text-slate-500">
            <Search className="h-8 w-8 text-slate-300" />
            <div className="mt-3 font-medium text-slate-700">没有匹配资源</div>
            <p className="mt-1 text-xs leading-5">
              试试更短的关键词，或清空类型筛选。
            </p>
            <button
              type="button"
              onClick={onClearFilters}
              className="mt-4 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-[#13c95b] hover:text-[#13c95b]"
            >
              清空筛选
            </button>
          </div>
        ) : (
          visibleEntries.map(({ item, index }) => {
            const active = index === activeIndex;
            const ItemIcon =
              item.kind === "office"
                ? getResourceDocumentProfile(item).Icon
                : getKindIcon(item.kind);
            const subtitleLabel =
              getResourceFormatLabel(item) ?? getKindLabel(item.kind);
            const canRenderImageThumbnail =
              item.kind === "image" &&
              Boolean(item.src) &&
              getResourcePreviewTarget(item) === "webview";
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectIndex(index)}
                data-testid="resource-manager-resource-list-item"
                className={cn(
                  "mb-1 flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition",
                  active
                    ? "border-[#13c95b] bg-white shadow-sm shadow-slate-950/5"
                    : "border-transparent hover:border-slate-200 hover:bg-white/70",
                )}
                aria-label={`查看第 ${index + 1} 个资源`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-500">
                  {canRenderImageThumbnail ? (
                    <img
                      src={item.src ?? undefined}
                      alt={getItemTitle(item)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ItemIcon className="h-4 w-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">
                    {getItemTitle(item)}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {subtitleLabel}
                    {item.filePath ? ` · ${item.filePath}` : ""}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
