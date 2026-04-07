import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  Search,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { SearchResultPreviewItem } from "../utils/searchResultPreview";

function SearchResultHoverCard({
  item,
  onOpenUrl,
  popoverSide = "right",
  popoverAlign = "start",
}: {
  item: SearchResultPreviewItem;
  onOpenUrl: (url: string) => void | Promise<void>;
  popoverSide?: "top" | "right" | "bottom" | "left";
  popoverAlign?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleOpenPreview = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const handleCloseNow = useCallback(() => {
    clearCloseTimer();
    setOpen(false);
  }, [clearCloseTimer]);

  const handleScheduleClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      return;
    }
    if (typeof window === "undefined") {
      handleCloseNow();
      return;
    }
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 120);
  }, [handleCloseNow]);

  const isWithinHoverRegion = useCallback((target: EventTarget | null) => {
    const node = target instanceof Node ? target : null;
    if (!node) {
      return false;
    }
    return Boolean(
      triggerRef.current?.contains(node) || contentRef.current?.contains(node),
    );
  }, []);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }

    const handleDocumentMouseMove = (event: MouseEvent) => {
      if (isWithinHoverRegion(event.target)) {
        clearCloseTimer();
        return;
      }
      handleScheduleClose();
    };

    const handleWindowBlur = () => {
      handleCloseNow();
    };

    document.addEventListener("mousemove", handleDocumentMouseMove, true);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      document.removeEventListener("mousemove", handleDocumentMouseMove, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
    clearCloseTimer,
    handleCloseNow,
    handleScheduleClose,
    isWithinHoverRegion,
    open,
  ]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`预览搜索结果：${item.title}`}
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/60"
          onMouseEnter={handleOpenPreview}
          onMouseLeave={handleScheduleClose}
          onFocus={handleOpenPreview}
          onBlur={handleScheduleClose}
          onClick={() => void onOpenUrl(item.url)}
        >
          <div className="flex items-start gap-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {item.title}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{item.hostname}</span>
              </div>
            </div>
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        side={popoverSide}
        align={popoverAlign}
        sideOffset={8}
        collisionPadding={20}
        className="w-[min(24rem,calc(100vw-3rem))] rounded-2xl border border-border/80 bg-background p-0 shadow-xl"
        onMouseEnter={handleOpenPreview}
        onMouseLeave={handleScheduleClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-muted p-2 text-muted-foreground">
              <Search className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">
                {item.title}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{item.hostname}</span>
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-muted/50 px-3 py-3 text-sm leading-6 text-muted-foreground">
            {item.snippet || "暂无摘要，点击可直接打开来源。"}
          </div>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2 text-left text-xs text-primary transition-colors hover:bg-muted/60"
            onClick={() => void onOpenUrl(item.url)}
          >
            <span className="truncate">{item.url}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SearchResultPreviewList({
  items,
  onOpenUrl,
  popoverSide = "right",
  popoverAlign = "start",
  className,
  collapsedCount = 4,
}: {
  items: SearchResultPreviewItem[];
  onOpenUrl: (url: string) => void | Promise<void>;
  popoverSide?: "top" | "right" | "bottom" | "left";
  popoverAlign?: "start" | "center" | "end";
  className?: string;
  collapsedCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const identityKey = useMemo(
    () => items.map((item) => item.id).join("|"),
    [items],
  );

  useEffect(() => {
    setExpanded(false);
  }, [identityKey]);

  if (items.length === 0) {
    return null;
  }

  const shouldCollapse = items.length > collapsedCount;
  const visibleItems =
    shouldCollapse && !expanded ? items.slice(0, collapsedCount) : items;
  const hiddenCount = items.length - visibleItems.length;

  return (
    <div className={cn("space-y-2", className)}>
      {visibleItems.map((item) => (
        <SearchResultHoverCard
          key={item.id}
          item={item}
          onOpenUrl={onOpenUrl}
          popoverSide={popoverSide}
          popoverAlign={popoverAlign}
        />
      ))}
      {shouldCollapse ? (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          onClick={() => setExpanded((prev) => !prev)}
          aria-label={expanded ? "收起搜索结果" : "展开搜索结果"}
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              expanded && "rotate-180",
            )}
          />
          <span>
            {expanded ? "收起结果" : `展开其余 ${hiddenCount} 条结果`}
          </span>
        </button>
      ) : null}
    </div>
  );
}
