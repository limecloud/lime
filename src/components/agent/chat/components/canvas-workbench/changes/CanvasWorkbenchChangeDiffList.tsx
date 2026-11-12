import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  MoreHorizontal,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  collapseCanvasWorkbenchDiffContext,
  type CanvasWorkbenchDisplayedDiffLine,
} from "../../../utils/canvasWorkbenchDiff";
import { CanvasWorkbenchDiffState } from "./CanvasWorkbenchDiffState";
import { DiffStats } from "./CanvasWorkbenchChangeStats";
import {
  buildCanvasWorkbenchChangeDiffLines,
  countCanvasWorkbenchChangeItemStats,
  resolveChangeDisplayMeta,
  type CanvasWorkbenchChangeItem,
} from "./CanvasWorkbenchChangesPanelViewModel";
import { CanvasWorkbenchChangeStatusMark } from "./CanvasWorkbenchChangeStatusMark";
import { useCanvasWorkbenchViewedChanges } from "./CanvasWorkbenchViewedChangesContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CanvasWorkbenchTranslation } from "./CanvasWorkbenchChangesTypes";

const LARGE_DIFF_LINE_THRESHOLD = 3000;

interface CanvasWorkbenchChangeDiffListProps {
  items: CanvasWorkbenchChangeItem[];
  selectedChangeItem?: CanvasWorkbenchChangeItem;
  selectionRequestKey?: number;
  fullFileContentById?: Record<string, string>;
  loadFullFile?: boolean;
  collapseDiffContext: boolean;
  textDiffEnabled: boolean;
  panelClassName: string;
  diffVariant: "inline" | "split";
  showWhitespace: boolean;
  wordWrapEnabled: boolean;
  translateWorkbench: CanvasWorkbenchTranslation;
  onSelectChangeItem?: (item: CanvasWorkbenchChangeItem) => void;
  onOpenFile?: (path: string) => void | Promise<void>;
  onRevealFile?: (item: CanvasWorkbenchChangeItem) => void;
  onDeleteFile?: (item: CanvasWorkbenchChangeItem) => void | Promise<void>;
}

function buildVisibleDiffLines(
  item: CanvasWorkbenchChangeItem,
  fullFileContentById: Record<string, string> | undefined,
  loadFullFile: boolean,
  collapseDiffContext: boolean,
  textDiffEnabled: boolean,
): CanvasWorkbenchDisplayedDiffLine[] {
  const loadedContent = loadFullFile
    ? fullFileContentById?.[item.id]
    : undefined;
  const diffLines = buildCanvasWorkbenchChangeDiffLines(item, loadedContent);
  if (collapseDiffContext) {
    return collapseCanvasWorkbenchDiffContext(diffLines);
  }
  if (textDiffEnabled) {
    return diffLines;
  }
  return diffLines.filter((line) => line.type !== "context");
}

export function CanvasWorkbenchChangeDiffList({
  items,
  selectedChangeItem,
  selectionRequestKey = 0,
  fullFileContentById,
  loadFullFile = false,
  collapseDiffContext,
  textDiffEnabled,
  panelClassName,
  diffVariant,
  showWhitespace,
  wordWrapEnabled,
  translateWorkbench,
  onSelectChangeItem,
  onOpenFile,
  onRevealFile,
  onDeleteFile,
}: CanvasWorkbenchChangeDiffListProps) {
  const fileElements = useRef(new Map<string, HTMLElement>());
  const selectedChangeId = selectedChangeItem?.id;
  const { viewedChangeIds, toggleViewedChange } =
    useCanvasWorkbenchViewedChanges();
  const [collapsedChangeIds, setCollapsedChangeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleCollapsed = (changeId: string) => {
    setCollapsedChangeIds((current) => {
      const next = new Set(current);
      if (next.has(changeId)) next.delete(changeId);
      else next.add(changeId);
      return next;
    });
  };
  const largeDiff =
    items.reduce((total, item) => total + (item.diffLines?.length ?? 0), 0) >
    LARGE_DIFF_LINE_THRESHOLD;
  const activeIndex = Math.max(
    0,
    selectedChangeId
      ? items.findIndex((item) => item.id === selectedChangeId)
      : 0,
  );
  const renderedItems = largeDiff ? items.slice(activeIndex, activeIndex + 1) : items;
  useLayoutEffect(() => {
    if (!selectionRequestKey || !selectedChangeId) return;
    fileElements.current
      .get(selectedChangeId)
      ?.scrollIntoView?.({ block: "start", inline: "nearest" });
  }, [selectedChangeId, selectionRequestKey]);
  return (
    <div
      className="h-full min-h-0 overflow-auto bg-[color:var(--lime-surface)]"
      data-testid="canvas-workbench-change-diff-list"
    >
      <div className={diffVariant === "split" ? "min-w-[760px]" : "min-w-0"}>
        {largeDiff ? (
          <div
            className="flex min-h-10 items-center gap-2 border-b border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-3 text-xs text-[color:var(--lime-text-muted)]"
            data-testid="canvas-workbench-large-diff-banner"
          >
            <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {translateWorkbench(
                "agentChat.canvasWorkbench.coding.changes.largeDiff.banner",
              )}
            </span>
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)] disabled:opacity-40"
              disabled={activeIndex <= 0}
              aria-label={translateWorkbench(
                "agentChat.canvasWorkbench.coding.changes.largeDiff.previousFile",
              )}
              data-testid="canvas-workbench-large-diff-previous"
              onClick={() => onSelectChangeItem?.(items[activeIndex - 1])}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)] disabled:opacity-40"
              disabled={activeIndex >= items.length - 1}
              aria-label={translateWorkbench(
                "agentChat.canvasWorkbench.coding.changes.largeDiff.nextFile",
              )}
              data-testid="canvas-workbench-large-diff-next"
              onClick={() => onSelectChangeItem?.(items[activeIndex + 1])}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        {renderedItems.map((item) => {
          const diffLines = buildCanvasWorkbenchChangeDiffLines(
            item,
            loadFullFile ? fullFileContentById?.[item.id] : undefined,
          );
          const visibleDiffLines = buildVisibleDiffLines(
            item,
            fullFileContentById,
            loadFullFile,
            collapseDiffContext,
            textDiffEnabled,
          );
          const stats = countCanvasWorkbenchChangeItemStats(item);
          const meta = resolveChangeDisplayMeta(item);
          const active = item.id === selectedChangeItem?.id;
          const viewed = viewedChangeIds.has(item.id);
          const collapsed = collapsedChangeIds.has(item.id);

          return (
            <section
              key={item.id}
              data-testid="canvas-workbench-change-diff-file"
              data-change-id={item.id}
              data-review-path={item.path}
              data-selected={active}
              ref={(element) => {
                if (element) fileElements.current.set(item.id, element);
                else fileElements.current.delete(item.id);
              }}
              className={cn(
                "border-b border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)]",
                active && "shadow-[inset_3px_0_0_var(--lime-brand)]",
                viewed && !active && "opacity-60",
              )}
            >
              <div
                role="button"
                tabIndex={0}
                className={cn(
                  "flex h-9 w-full items-center justify-between gap-2 border-b border-[color:var(--lime-surface-border)] px-3 text-left transition-colors hover:bg-[color:var(--lime-surface-subtle)]",
                  active
                    ? "bg-[color:var(--lime-surface-subtle)]"
                    : "bg-[color:var(--lime-surface)]",
                )}
                onClick={() => onSelectChangeItem?.(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectChangeItem?.(item);
                  }
                }}
                aria-pressed={active}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)]"
                    aria-label={translateWorkbench(
                      collapsed
                        ? "agentChat.canvasWorkbench.coding.changes.expandFile"
                        : "agentChat.canvasWorkbench.coding.changes.collapseFile",
                    )}
                    title={translateWorkbench(
                      collapsed
                        ? "agentChat.canvasWorkbench.coding.changes.expandFile"
                        : "agentChat.canvasWorkbench.coding.changes.collapseFile",
                    )}
                    data-testid={`canvas-workbench-diff-collapse-${item.id}`}
                    aria-expanded={!collapsed}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleCollapsed(item.id);
                    }}
                  >
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        collapsed && "-rotate-90",
                      )}
                    />
                  </button>
                  <CanvasWorkbenchChangeStatusMark
                    meta={meta}
                    translateWorkbench={translateWorkbench}
                  />
                  <span className="truncate text-[13px] font-medium text-[color:var(--lime-text-strong)]">
                    {item.path}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[12px] font-semibold">
                    <DiffStats stats={stats} />
                  </span>
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)]"
                    aria-label={translateWorkbench(
                      "agentChat.canvasWorkbench.coding.changes.contextMenu.copyPath",
                    )}
                    title={translateWorkbench(
                      "agentChat.canvasWorkbench.coding.changes.contextMenu.copyPath",
                    )}
                    data-testid={`canvas-workbench-diff-copy-${item.id}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void navigator.clipboard
                        ?.writeText?.(item.path)
                        .then(() =>
                          toast.success(
                            translateWorkbench(
                              "agentChat.canvasWorkbench.coding.changes.toast.copyPathSuccess",
                            ),
                          ),
                        );
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)]"
                    aria-label={translateWorkbench(
                      viewed
                        ? "agentChat.canvasWorkbench.coding.changes.markUnviewed"
                        : "agentChat.canvasWorkbench.coding.changes.markViewed",
                    )}
                    title={translateWorkbench(
                      viewed
                        ? "agentChat.canvasWorkbench.coding.changes.markUnviewed"
                        : "agentChat.canvasWorkbench.coding.changes.markViewed",
                    )}
                    data-testid={`canvas-workbench-diff-viewed-${item.id}`}
                    data-viewed={viewed ? "true" : "false"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleViewedChange(item.id);
                    }}
                  >
                    {viewed ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)]"
                        aria-label={translateWorkbench(
                          "agentChat.canvasWorkbench.coding.changes.fileActions",
                        )}
                        data-testid={`canvas-workbench-diff-more-${item.id}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 p-1">
                      <DropdownMenuItem
                        className="whitespace-nowrap"
                        data-testid="canvas-workbench-diff-copy-path"
                        onClick={() => {
                          void navigator.clipboard
                            ?.writeText?.(item.path)
                            .then(() =>
                              toast.success(
                                translateWorkbench(
                                  "agentChat.canvasWorkbench.coding.changes.toast.copyPathSuccess",
                                ),
                              ),
                            )
                            .catch(() => undefined);
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {translateWorkbench(
                          "agentChat.canvasWorkbench.coding.changes.contextMenu.copyPath",
                        )}
                      </DropdownMenuItem>
                      {onOpenFile ? (
                        <DropdownMenuItem
                          className="whitespace-nowrap"
                          onClick={() => {
                            void onOpenFile(item.path);
                          }}
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                          {translateWorkbench(
                            "agentChat.canvasWorkbench.coding.changes.contextMenu.openInEditor",
                          )}
                        </DropdownMenuItem>
                      ) : null}
                      {onRevealFile && item.absolutePath?.trim() ? (
                        <DropdownMenuItem
                          className="whitespace-nowrap"
                          onClick={() => onRevealFile(item)}
                        >
                          {translateWorkbench(
                            "agentChat.canvasWorkbench.coding.changes.contextMenu.revealFile",
                          )}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="whitespace-nowrap"
                        onClick={() => toggleCollapsed(item.id)}
                      >
                        {translateWorkbench(
                          collapsed
                            ? "agentChat.canvasWorkbench.coding.changes.expandFile"
                            : "agentChat.canvasWorkbench.coding.changes.collapseFile",
                        )}
                      </DropdownMenuItem>
                      {onDeleteFile &&
                      resolveChangeDisplayMeta(item).kind === "added" ? (
                        <DropdownMenuItem
                          className="whitespace-nowrap text-[color:var(--lime-danger)]"
                          onClick={() => {
                            void onDeleteFile(item);
                          }}
                        >
                          {translateWorkbench(
                            "agentChat.canvasWorkbench.coding.changes.contextMenu.deleteFile",
                          )}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </div>
              {!collapsed && diffLines.length > 0 ? (
                <div className="min-h-[72px]">
                  <CanvasWorkbenchDiffState
                    diffLines={visibleDiffLines}
                    panelClassName={panelClassName}
                    variant={diffVariant}
                    filePath={item.path}
                    showWhitespace={showWhitespace}
                    wordWrapEnabled={wordWrapEnabled}
                    omittedLabel={(count) =>
                      translateWorkbench(
                        "agentChat.canvasWorkbench.coding.changes.omittedLines",
                        { count },
                      )
                    }
                    beforeLabel={translateWorkbench(
                      "agentChat.canvasWorkbench.coding.changes.beforeLabel",
                    )}
                    afterLabel={translateWorkbench(
                      "agentChat.canvasWorkbench.coding.changes.afterLabel",
                    )}
                  />
                </div>
              ) : item.preview ? (
                <pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-6 text-[color:var(--lime-text-strong)]">
                  {item.preview}
                </pre>
              ) : (
                <div className="px-4 py-3 text-xs text-[color:var(--lime-text-muted)]">
                  {translateWorkbench(
                    "agentChat.canvasWorkbench.coding.changes.noDiff",
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
