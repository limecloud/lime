import { memo, type DragEvent, type RefObject } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileUp,
  Globe,
  Link2,
  Loader2,
  PencilLine,
  Plus,
  Search,
  Share2,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type {
  GeneralWorkbenchContextBudget,
  GeneralWorkbenchContextItem,
} from "./generalWorkbenchContextData";

interface GeneralWorkbenchContextPanelProps {
  contextItems: GeneralWorkbenchContextItem[];
  searchContextItems: GeneralWorkbenchContextItem[];
  orderedContextItems: GeneralWorkbenchContextItem[];
  selectedSearchResult: GeneralWorkbenchContextItem | null;
  latestSearchLabel: string;
  contextBudget: GeneralWorkbenchContextBudget;
  contextSearchQuery: string;
  contextSearchMode: "web" | "social";
  contextSearchLoading: boolean;
  contextSearchError?: string | null;
  contextSearchBlockedReason?: string | null;
  isSearchActionDisabled: boolean;
  searchInputRef: RefObject<HTMLInputElement>;
  onContextSearchQueryChange: (value: string) => void;
  onContextSearchModeChange: (value: "web" | "social") => void;
  onSubmitContextSearch: () => Promise<void> | void;
  onOpenAddContextDialog: () => void;
  onSelectSearchResult: (contextId: string | null) => void;
  onToggleContextActive: (contextId: string) => void;
  onViewContextDetail?: (contextId: string) => void;
  addContextDialogOpen: boolean;
  addTextDialogOpen: boolean;
  addLinkDialogOpen: boolean;
  contextDraftText: string;
  contextDraftLink: string;
  contextCreateLoading: boolean;
  contextCreateError?: string | null;
  contextDropActive: boolean;
  onCloseAllContextDialogs: () => void;
  onChooseContextFile: () => Promise<void> | void;
  onDropContextFile: (event: DragEvent<HTMLDivElement>) => Promise<void> | void;
  onOpenTextContextDialog: () => void;
  onOpenLinkContextDialog: () => void;
  onContextDraftTextChange: (value: string) => void;
  onContextDraftLinkChange: (value: string) => void;
  onContextDropActiveChange: (active: boolean) => void;
  onSubmitTextContext: () => Promise<void> | void;
  onSubmitLinkContext: () => Promise<void> | void;
}

const CONTEXT_SECTION_CLASSNAME = "border-b border-slate-200/70 px-4 py-3";

const CONTEXT_SECTION_TITLE_CLASSNAME =
  "mb-2.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500";

const CONTEXT_SECTION_BADGE_CLASSNAME =
  "inline-flex min-h-4 min-w-4 items-center justify-center rounded-full border border-slate-200 bg-white px-1.5 text-[10px] font-semibold text-slate-500";

const CONTEXT_META_TEXT_CLASSNAME =
  "mt-1.5 text-[11px] leading-5 text-slate-500";

const CONTEXT_ADD_BUTTON_CLASSNAME =
  "flex h-9 w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-slate-200/90 bg-white/90 px-3 text-sm font-medium text-slate-700 shadow-sm shadow-slate-950/5 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900";

const CONTEXT_SEARCH_CARD_CLASSNAME =
  "mt-2.5 rounded-[14px] border border-slate-200/80 bg-white px-3 py-3";

const CONTEXT_SEARCH_INPUT_WRAP_CLASSNAME = "relative";

const CONTEXT_SEARCH_INPUT_CLASSNAME =
  "h-7 w-full border-0 bg-transparent pl-7 text-[13px] leading-5 text-slate-900 placeholder:text-slate-400 focus:outline-none";

const CONTEXT_SEARCH_ICON_CLASSNAME =
  "absolute left-0 top-[5px] text-slate-400";

const CONTEXT_SEARCH_ACTION_ROW_CLASSNAME =
  "mt-2.5 flex items-center justify-between gap-2.5";

const CONTEXT_SEARCH_MODE_TRIGGER_CLASSNAME =
  "inline-flex h-8 min-w-[90px] items-center gap-[7px] rounded-full border border-slate-200 bg-white px-3 text-xs text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900";

const CONTEXT_SEARCH_MODE_ROW_CLASSNAME = "flex w-full items-center gap-2";

const CONTEXT_SEARCH_MODE_CHECK_CLASSNAME = "ml-auto text-sky-600";

const CONTEXT_QUERY_CLASSNAME = "mt-2 text-[11px] leading-5 text-slate-500";

const CONTEXT_LIST_CLASSNAME = "flex flex-col gap-2";

const CONTEXT_ROW_BASE_CLASSNAME =
  "flex items-center gap-2.5 rounded-[10px] border px-3.5 py-3 transition-colors";

const CONTEXT_OPEN_BUTTON_CLASSNAME =
  "flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left text-inherit";

const CONTEXT_INFO_CLASSNAME = "min-w-0 flex-1";

const CONTEXT_NAME_CLASSNAME =
  "truncate text-[13px] font-medium leading-[1.4] text-slate-900";

const CONTEXT_ROW_META_CLASSNAME =
  "mt-1 truncate text-[11px] leading-[1.3] text-slate-500/90";

const CONTEXT_ICON_WRAP_CLASSNAME =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 text-sky-700";

const CONTEXT_CHECKBOX_CLASSNAME =
  "h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 accent-slate-900";

const CONTEXT_DETAIL_TOP_BAR_CLASSNAME =
  "flex items-center justify-between gap-2";

const CONTEXT_DETAIL_BACK_BUTTON_CLASSNAME =
  "inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[11px] leading-[1.2] text-slate-500 transition-colors hover:text-slate-900";

const CONTEXT_DETAIL_CARD_CLASSNAME =
  "rounded-[14px] border border-slate-200/80 bg-white p-3";

const CONTEXT_DETAIL_TITLE_CLASSNAME =
  "text-lg font-bold leading-[1.35] text-slate-900";

const CONTEXT_DETAIL_META_CLASSNAME =
  "mt-2 text-[11px] leading-5 text-slate-500";

const CONTEXT_DETAIL_SECTION_CLASSNAME =
  "mt-3 rounded-[12px] border border-slate-200/80 bg-slate-50/80 p-2.5";

const CONTEXT_DETAIL_SECTION_LABEL_CLASSNAME =
  "text-[11px] font-semibold text-slate-900";

const CONTEXT_DETAIL_BODY_CLASSNAME =
  "mt-2.5 whitespace-pre-wrap text-[13px] leading-7 text-slate-900";

const CONTEXT_DETAIL_SOURCE_LIST_CLASSNAME = "mt-2 flex flex-col gap-1.5";

const CONTEXT_DETAIL_SOURCE_ITEM_CLASSNAME =
  "flex items-center gap-1.5 text-[11px] text-sky-700 hover:underline";

const CONTEXT_MODAL_OVERLAY_CLASSNAME =
  "fixed inset-0 z-[70] flex items-center justify-center bg-[linear-gradient(180deg,rgba(240,249,255,0.82)_0%,rgba(236,253,245,0.74)_52%,rgba(255,255,255,0.86)_100%)] p-6 backdrop-blur-[2px]";

const CONTEXT_MODAL_CARD_CLASSNAME =
  "w-[min(500px,calc(100vw-48px))] overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_24px_48px_rgba(15,23,42,0.22)]";

const CONTEXT_MODAL_HEADER_CLASSNAME =
  "flex h-[66px] items-center justify-between border-b border-slate-200/80 px-5";

const CONTEXT_MODAL_TITLE_CLASSNAME =
  "m-0 text-xl font-bold leading-none text-slate-900";

const CONTEXT_MODAL_TITLE_CENTERED_CLASSNAME =
  "m-0 flex-1 text-center text-xl font-bold leading-none text-slate-900";

const CONTEXT_MODAL_HEADER_ACTIONS_CLASSNAME = "inline-flex items-center gap-2";

const CONTEXT_MODAL_HEADER_BUTTON_CLASSNAME =
  "inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900";

const CONTEXT_MODAL_BODY_CLASSNAME = "px-4 pb-4 pt-3.5";

const CONTEXT_DROP_AREA_BASE_CLASSNAME =
  "flex min-h-[186px] flex-col items-center justify-center gap-3.5 rounded-[14px] border border-dashed px-3 py-4 transition-colors";

const CONTEXT_DROP_HINT_CLASSNAME = "text-xs text-slate-500";

const CONTEXT_MODAL_ACTION_GRID_CLASSNAME =
  "flex flex-wrap items-center justify-center gap-2.5";

const CONTEXT_MODAL_ACTION_BUTTON_CLASSNAME =
  "inline-flex h-[34px] items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 text-[13px] text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400";

const CONTEXT_MODAL_ERROR_TEXT_CLASSNAME =
  "mt-3 text-center text-xs leading-[1.45] text-rose-600";

const CONTEXT_TEXTAREA_CLASSNAME =
  "min-h-[228px] w-full resize-none rounded-[18px] border-2 border-slate-500/60 bg-white px-3 py-3.5 text-[13px] leading-6 text-slate-900 placeholder:text-slate-400 focus:border-sky-400/60 focus:outline-none";

const CONTEXT_LINK_INPUT_CLASSNAME =
  "h-[42px] w-full rounded-[12px] border-2 border-slate-500/55 bg-white px-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-sky-400/60 focus:outline-none";

const CONTEXT_MODAL_FOOTER_CLASSNAME = "mt-3 flex justify-end";

const CONTEXT_DETAIL_ACTION_ROW_CLASSNAME = "mt-1.5 flex gap-[5px]";

const CONTEXT_DETAIL_ACTION_BUTTON_CLASSNAME =
  "inline-flex h-6 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900";

function formatContextCreatedAt(createdAt?: number): string | null {
  if (!createdAt || !Number.isFinite(createdAt)) {
    return null;
  }
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveContextSourceSubLabel(
  source: GeneralWorkbenchContextItem["source"],
  searchMode?: GeneralWorkbenchContextItem["searchMode"],
): string {
  if (source === "material") {
    return "素材库";
  }
  if (source === "content") {
    return "历史内容";
  }
  return searchMode === "social" ? "社交媒体" : "网络搜索";
}

function getContextRowClassName(active: boolean, interactive: boolean) {
  return cn(
    CONTEXT_ROW_BASE_CLASSNAME,
    active ? "border-sky-300/60 bg-sky-50/70" : "border-slate-200/80 bg-white",
    interactive
      ? "cursor-pointer hover:border-slate-300 hover:bg-slate-50"
      : "cursor-default",
  );
}

function getContextSearchSubmitButtonClassName(disabled: boolean) {
  return cn(
    "inline-flex h-7 w-7 items-center justify-center rounded-full transition-transform",
    disabled
      ? "cursor-not-allowed bg-slate-200 text-slate-400"
      : "bg-slate-100 text-sky-700 hover:scale-[1.03] hover:bg-slate-200 hover:text-slate-900",
  );
}

function getContextHintTextClassName(error?: boolean) {
  return cn(
    "mt-2.5 text-[11px] leading-5",
    error ? "text-rose-600" : "text-slate-500",
  );
}

function getContextDropAreaClassName(dragging: boolean) {
  return cn(
    CONTEXT_DROP_AREA_BASE_CLASSNAME,
    dragging
      ? "border-sky-400/60 bg-sky-50/70"
      : "border-slate-200/90 bg-slate-50/70",
  );
}

function getContextConfirmButtonClassName(disabled: boolean) {
  return cn(
    "inline-flex h-[38px] min-w-[86px] items-center justify-center rounded-full px-4 text-xl font-semibold leading-none transition-opacity",
    disabled
      ? "cursor-not-allowed bg-slate-200 text-slate-400"
      : "bg-slate-200 text-slate-600 hover:opacity-90",
  );
}

function renderContextList(
  items: GeneralWorkbenchContextItem[],
  emptyText: string,
  onSelectSearchResult: (contextId: string | null) => void,
  onToggleContextActive: (contextId: string) => void,
  onViewContextDetail?: (contextId: string) => void,
) {
  if (items.length === 0) {
    return <div className={CONTEXT_META_TEXT_CLASSNAME}>{emptyText}</div>;
  }

  return (
    <div className={CONTEXT_LIST_CLASSNAME}>
      {items.map((item) => {
        const interactive = item.source === "search";
        const createdAtLabel = formatContextCreatedAt(item.createdAt);
        return (
          <div
            key={item.id}
            className={getContextRowClassName(item.active, interactive)}
          >
            <button
              type="button"
              aria-label={
                interactive
                  ? `查看搜索结果 ${item.name}`
                  : `查看上下文 ${item.name}`
              }
              className={CONTEXT_OPEN_BUTTON_CLASSNAME}
              onClick={() => {
                if (interactive) {
                  onSelectSearchResult(item.id);
                  return;
                }
                onViewContextDetail?.(item.id);
              }}
            >
              <div className={CONTEXT_ICON_WRAP_CLASSNAME}>
                {item.source === "search" ? (
                  item.searchMode === "social" ? (
                    <Share2 size={12} />
                  ) : (
                    <Globe size={12} />
                  )
                ) : (
                  <CheckCircle2 size={12} />
                )}
              </div>
              <div className={CONTEXT_INFO_CLASSNAME}>
                <div className={CONTEXT_NAME_CLASSNAME}>{item.name}</div>
                <div className={CONTEXT_ROW_META_CLASSNAME}>
                  {resolveContextSourceSubLabel(item.source, item.searchMode)}
                  {createdAtLabel ? ` · ${createdAtLabel}` : ""}
                </div>
              </div>
              <ChevronRight size={13} />
            </button>
            <input
              type="checkbox"
              className={CONTEXT_CHECKBOX_CLASSNAME}
              checked={item.active}
              aria-label={`切换上下文 ${item.name}`}
              onChange={() => onToggleContextActive(item.id)}
            />
          </div>
        );
      })}
    </div>
  );
}

function GeneralWorkbenchContextPanelComponent({
  contextItems,
  searchContextItems,
  orderedContextItems,
  selectedSearchResult,
  latestSearchLabel,
  contextBudget,
  contextSearchQuery,
  contextSearchMode,
  contextSearchLoading,
  contextSearchError,
  contextSearchBlockedReason,
  isSearchActionDisabled,
  searchInputRef,
  onContextSearchQueryChange,
  onContextSearchModeChange,
  onSubmitContextSearch,
  onOpenAddContextDialog,
  onSelectSearchResult,
  onToggleContextActive,
  onViewContextDetail,
  addContextDialogOpen,
  addTextDialogOpen,
  addLinkDialogOpen,
  contextDraftText,
  contextDraftLink,
  contextCreateLoading,
  contextCreateError,
  contextDropActive,
  onCloseAllContextDialogs,
  onChooseContextFile,
  onDropContextFile,
  onOpenTextContextDialog,
  onOpenLinkContextDialog,
  onContextDraftTextChange,
  onContextDraftLinkChange,
  onContextDropActiveChange,
  onSubmitTextContext,
  onSubmitLinkContext,
}: GeneralWorkbenchContextPanelProps) {
  return (
    <>
      <section className={CONTEXT_SECTION_CLASSNAME}>
        <div className={CONTEXT_SECTION_TITLE_CLASSNAME}>
          <span>搜索上下文</span>
          <span className={CONTEXT_SECTION_BADGE_CLASSNAME}>
            {latestSearchLabel}
          </span>
        </div>
        <button
          type="button"
          className={CONTEXT_ADD_BUTTON_CLASSNAME}
          onClick={onOpenAddContextDialog}
        >
          <Plus size={13} />
          添加上下文
        </button>
        <div className={CONTEXT_SEARCH_CARD_CLASSNAME}>
          <div className={CONTEXT_SEARCH_INPUT_WRAP_CLASSNAME}>
            <Search className={CONTEXT_SEARCH_ICON_CLASSNAME} size={14} />
            <input
              ref={searchInputRef}
              className={CONTEXT_SEARCH_INPUT_CLASSNAME}
              value={contextSearchQuery}
              placeholder="搜索网络添加新上下文"
              onChange={(event) =>
                onContextSearchQueryChange(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !isSearchActionDisabled) {
                  event.preventDefault();
                  void onSubmitContextSearch();
                }
              }}
            />
          </div>
          <div className={CONTEXT_SEARCH_ACTION_ROW_CLASSNAME}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="选择上下文搜索来源"
                  className={CONTEXT_SEARCH_MODE_TRIGGER_CLASSNAME}
                >
                  {contextSearchMode === "social" ? (
                    <Share2 size={13} />
                  ) : (
                    <Globe size={13} />
                  )}
                  <span>
                    {contextSearchMode === "social" ? "社交媒体" : "网络搜索"}
                  </span>
                  <ChevronDown size={13} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-36 p-1">
                <DropdownMenuItem
                  onClick={() => onContextSearchModeChange("web")}
                >
                  <div className={CONTEXT_SEARCH_MODE_ROW_CLASSNAME}>
                    <Globe size={14} />
                    <span>网络搜索</span>
                    {contextSearchMode === "web" ? (
                      <div className={CONTEXT_SEARCH_MODE_CHECK_CLASSNAME}>
                        <Check size={13} />
                      </div>
                    ) : null}
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onContextSearchModeChange("social")}
                >
                  <div className={CONTEXT_SEARCH_MODE_ROW_CLASSNAME}>
                    <Share2 size={14} />
                    <span>社交媒体</span>
                    {contextSearchMode === "social" ? (
                      <div className={CONTEXT_SEARCH_MODE_CHECK_CLASSNAME}>
                        <Check size={14} />
                      </div>
                    ) : null}
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              aria-label="提交上下文搜索"
              className={getContextSearchSubmitButtonClassName(
                isSearchActionDisabled,
              )}
              disabled={isSearchActionDisabled}
              onClick={() => {
                if (!isSearchActionDisabled) {
                  void onSubmitContextSearch();
                }
              }}
            >
              {contextSearchLoading ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                <ArrowRight size={14} strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
        {contextSearchError ? (
          <div className={getContextHintTextClassName(true)}>
            {contextSearchError}
          </div>
        ) : contextSearchLoading ? (
          <div className={getContextHintTextClassName()}>
            正在联网检索并整理上下文...
          </div>
        ) : contextSearchBlockedReason ? (
          <div className={getContextHintTextClassName()}>
            {contextSearchBlockedReason}
          </div>
        ) : (
          <div className={getContextHintTextClassName()}>
            输入关键词后按 Enter，可直接把检索结果加入当前上下文。
          </div>
        )}
      </section>

      {selectedSearchResult ? (
        <section className={cn(CONTEXT_SECTION_CLASSNAME, "border-b-0")}>
          <div className={CONTEXT_DETAIL_TOP_BAR_CLASSNAME}>
            <div className={cn(CONTEXT_SECTION_TITLE_CLASSNAME, "mb-0")}>
              <span>搜索结果详情</span>
            </div>
            <button
              type="button"
              className={CONTEXT_DETAIL_BACK_BUTTON_CLASSNAME}
              onClick={() => onSelectSearchResult(null)}
            >
              <ArrowLeft size={13} />
              返回列表
            </button>
          </div>
          <div className={CONTEXT_DETAIL_CARD_CLASSNAME}>
            <div className={CONTEXT_DETAIL_TITLE_CLASSNAME}>
              {selectedSearchResult.name}
            </div>
            <div className={CONTEXT_DETAIL_META_CLASSNAME}>
              {resolveContextSourceSubLabel(
                selectedSearchResult.source,
                selectedSearchResult.searchMode,
              )}
              {formatContextCreatedAt(selectedSearchResult.createdAt)
                ? ` · ${formatContextCreatedAt(selectedSearchResult.createdAt)}`
                : ""}
              {selectedSearchResult.active ? " · 已启用" : " · 未启用"}
            </div>
            <div className={CONTEXT_DETAIL_SECTION_CLASSNAME}>
              <div className={CONTEXT_DETAIL_SECTION_LABEL_CLASSNAME}>
                Source guide
              </div>
              {selectedSearchResult.query ? (
                <div className={CONTEXT_QUERY_CLASSNAME}>
                  检索词：{selectedSearchResult.query}
                </div>
              ) : null}
              {selectedSearchResult.citations &&
              selectedSearchResult.citations.length > 0 ? (
                <div className={CONTEXT_DETAIL_SOURCE_LIST_CLASSNAME}>
                  {selectedSearchResult.citations.map((citation) => (
                    <a
                      key={`${selectedSearchResult.id}-${citation.url}`}
                      href={citation.url}
                      target="_blank"
                      rel="noreferrer"
                      className={CONTEXT_DETAIL_SOURCE_ITEM_CLASSNAME}
                    >
                      <ExternalLink size={11} />
                      <span>{citation.title}</span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className={CONTEXT_META_TEXT_CLASSNAME}>暂无来源链接</div>
              )}
            </div>
            <div className={CONTEXT_DETAIL_BODY_CLASSNAME}>
              {selectedSearchResult.previewText || "暂无可展示的搜索结果正文"}
            </div>
            <div className={CONTEXT_DETAIL_ACTION_ROW_CLASSNAME}>
              <button
                type="button"
                className={CONTEXT_DETAIL_ACTION_BUTTON_CLASSNAME}
                onClick={() => onToggleContextActive(selectedSearchResult.id)}
              >
                {selectedSearchResult.active ? "移出上下文" : "加入上下文"}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className={cn(CONTEXT_SECTION_CLASSNAME, "border-b-0")}>
          <div className={CONTEXT_SECTION_TITLE_CLASSNAME}>
            <span>上下文列表</span>
            <span className={CONTEXT_SECTION_BADGE_CLASSNAME}>
              {contextItems.length} 条
            </span>
          </div>
          <div className={CONTEXT_META_TEXT_CLASSNAME}>
            已生效 {contextBudget.activeCount}/{contextBudget.activeCountLimit}{" "}
            条 · 检索结果 {searchContextItems.length} 条 · 估算{" "}
            {contextBudget.estimatedTokens}/{contextBudget.tokenLimit} tokens
          </div>
          <div className={CONTEXT_META_TEXT_CLASSNAME}>
            搜索结果可点击查看详情，其他上下文可直接勾选启用。
          </div>
          {renderContextList(
            orderedContextItems,
            "当前还没有上下文，先添加项目资料或搜索一个主题试试",
            onSelectSearchResult,
            onToggleContextActive,
            onViewContextDetail,
          )}
        </section>
      )}

      {addContextDialogOpen ? (
        <div
          className={CONTEXT_MODAL_OVERLAY_CLASSNAME}
          onClick={() => {
            if (!contextCreateLoading) {
              onCloseAllContextDialogs();
            }
          }}
        >
          <div
            className={CONTEXT_MODAL_CARD_CLASSNAME}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={CONTEXT_MODAL_HEADER_CLASSNAME}>
              <h3 className={CONTEXT_MODAL_TITLE_CLASSNAME}>添加新上下文</h3>
              <div className={CONTEXT_MODAL_HEADER_ACTIONS_CLASSNAME}>
                <button
                  type="button"
                  aria-label="关闭添加上下文弹窗"
                  className={CONTEXT_MODAL_HEADER_BUTTON_CLASSNAME}
                  onClick={() => {
                    if (!contextCreateLoading) {
                      onCloseAllContextDialogs();
                    }
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className={CONTEXT_MODAL_BODY_CLASSNAME}>
              <div
                className={getContextDropAreaClassName(contextDropActive)}
                onDragOver={(event) => {
                  event.preventDefault();
                  onContextDropActiveChange(true);
                }}
                onDragLeave={() => onContextDropActiveChange(false)}
                onDrop={(event) => {
                  void onDropContextFile(event);
                }}
              >
                <div className={CONTEXT_DROP_HINT_CLASSNAME}>
                  or drop your files here
                </div>
                <div className={CONTEXT_MODAL_ACTION_GRID_CLASSNAME}>
                  <button
                    type="button"
                    aria-label="上传文件上下文"
                    className={CONTEXT_MODAL_ACTION_BUTTON_CLASSNAME}
                    disabled={contextCreateLoading}
                    onClick={() => {
                      if (!contextCreateLoading) {
                        void onChooseContextFile();
                      }
                    }}
                  >
                    <FileUp size={15} />
                    上传文件
                  </button>
                  <button
                    type="button"
                    aria-label="添加网站链接上下文"
                    className={CONTEXT_MODAL_ACTION_BUTTON_CLASSNAME}
                    disabled={contextCreateLoading}
                    onClick={() => {
                      if (!contextCreateLoading) {
                        onOpenLinkContextDialog();
                      }
                    }}
                  >
                    <Link2 size={15} />
                    网站链接
                  </button>
                  <button
                    type="button"
                    aria-label="输入文本上下文"
                    className={CONTEXT_MODAL_ACTION_BUTTON_CLASSNAME}
                    disabled={contextCreateLoading}
                    onClick={() => {
                      if (!contextCreateLoading) {
                        onOpenTextContextDialog();
                      }
                    }}
                  >
                    <PencilLine size={15} />
                    输入文本
                  </button>
                </div>
              </div>
              {contextCreateError ? (
                <div className={CONTEXT_MODAL_ERROR_TEXT_CLASSNAME}>
                  {contextCreateError}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {addTextDialogOpen ? (
        <div
          className={CONTEXT_MODAL_OVERLAY_CLASSNAME}
          onClick={() => {
            if (!contextCreateLoading) {
              onCloseAllContextDialogs();
            }
          }}
        >
          <div
            className={CONTEXT_MODAL_CARD_CLASSNAME}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={CONTEXT_MODAL_HEADER_CLASSNAME}>
              <div className={CONTEXT_MODAL_HEADER_ACTIONS_CLASSNAME}>
                <button
                  type="button"
                  aria-label="返回添加上下文"
                  className={CONTEXT_MODAL_HEADER_BUTTON_CLASSNAME}
                  onClick={() => {
                    if (!contextCreateLoading) {
                      onOpenAddContextDialog();
                    }
                  }}
                >
                  <ArrowLeft size={20} />
                </button>
              </div>
              <h3 className={CONTEXT_MODAL_TITLE_CENTERED_CLASSNAME}>
                添加文本内容
              </h3>
              <div className={CONTEXT_MODAL_HEADER_ACTIONS_CLASSNAME}>
                <button
                  type="button"
                  aria-label="关闭文本上下文弹窗"
                  className={CONTEXT_MODAL_HEADER_BUTTON_CLASSNAME}
                  onClick={() => {
                    if (!contextCreateLoading) {
                      onCloseAllContextDialogs();
                    }
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className={CONTEXT_MODAL_BODY_CLASSNAME}>
              <textarea
                className={CONTEXT_TEXTAREA_CLASSNAME}
                value={contextDraftText}
                placeholder="在此粘贴或输入文本..."
                onChange={(event) =>
                  onContextDraftTextChange(event.target.value)
                }
              />
              {contextCreateError ? (
                <div className={CONTEXT_MODAL_ERROR_TEXT_CLASSNAME}>
                  {contextCreateError}
                </div>
              ) : null}
              <div className={CONTEXT_MODAL_FOOTER_CLASSNAME}>
                <button
                  type="button"
                  aria-label="确认添加文本上下文"
                  className={getContextConfirmButtonClassName(
                    contextCreateLoading ||
                      contextDraftText.trim().length === 0,
                  )}
                  disabled={
                    contextCreateLoading || contextDraftText.trim().length === 0
                  }
                  onClick={() => {
                    void onSubmitTextContext();
                  }}
                >
                  {contextCreateLoading ? (
                    <Loader2 size={22} className="animate-spin" />
                  ) : (
                    "确认"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {addLinkDialogOpen ? (
        <div
          className={CONTEXT_MODAL_OVERLAY_CLASSNAME}
          onClick={() => {
            if (!contextCreateLoading) {
              onCloseAllContextDialogs();
            }
          }}
        >
          <div
            className={CONTEXT_MODAL_CARD_CLASSNAME}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={CONTEXT_MODAL_HEADER_CLASSNAME}>
              <div className={CONTEXT_MODAL_HEADER_ACTIONS_CLASSNAME}>
                <button
                  type="button"
                  aria-label="返回添加上下文"
                  className={CONTEXT_MODAL_HEADER_BUTTON_CLASSNAME}
                  onClick={() => {
                    if (!contextCreateLoading) {
                      onOpenAddContextDialog();
                    }
                  }}
                >
                  <ArrowLeft size={20} />
                </button>
              </div>
              <h3 className={CONTEXT_MODAL_TITLE_CENTERED_CLASSNAME}>
                添加网站链接
              </h3>
              <div className={CONTEXT_MODAL_HEADER_ACTIONS_CLASSNAME}>
                <button
                  type="button"
                  aria-label="关闭链接上下文弹窗"
                  className={CONTEXT_MODAL_HEADER_BUTTON_CLASSNAME}
                  onClick={() => {
                    if (!contextCreateLoading) {
                      onCloseAllContextDialogs();
                    }
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className={CONTEXT_MODAL_BODY_CLASSNAME}>
              <input
                className={CONTEXT_LINK_INPUT_CLASSNAME}
                value={contextDraftLink}
                placeholder="请输入网站链接"
                onChange={(event) =>
                  onContextDraftLinkChange(event.target.value)
                }
              />
              {contextCreateError ? (
                <div className={CONTEXT_MODAL_ERROR_TEXT_CLASSNAME}>
                  {contextCreateError}
                </div>
              ) : null}
              <div className={CONTEXT_MODAL_FOOTER_CLASSNAME}>
                <button
                  type="button"
                  aria-label="确认添加链接上下文"
                  className={getContextConfirmButtonClassName(
                    contextCreateLoading ||
                      contextDraftLink.trim().length === 0,
                  )}
                  disabled={
                    contextCreateLoading || contextDraftLink.trim().length === 0
                  }
                  onClick={() => {
                    void onSubmitLinkContext();
                  }}
                >
                  {contextCreateLoading ? (
                    <Loader2 size={22} className="animate-spin" />
                  ) : (
                    "确认"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export const GeneralWorkbenchContextPanel = memo(
  GeneralWorkbenchContextPanelComponent,
);
