import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileJson,
  FileText,
  Eye,
  EyeOff,
  Filter,
  FilterX,
  Folder,
  FolderOpen,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type {
  CanvasWorkbenchChangeItem,
  CanvasWorkbenchChangeTreeNode,
} from "./CanvasWorkbenchChangesPanelViewModel";
import { CanvasWorkbenchChangeStatusMark } from "./CanvasWorkbenchChangeStatusMark";
import {
  countCanvasWorkbenchDiffStats,
  flattenCanvasWorkbenchChangeFileTree,
  resolveChangeDisplayMeta,
} from "./CanvasWorkbenchChangesPanelViewModel";
import { useCanvasWorkbenchViewedChanges } from "./CanvasWorkbenchViewedChangesContext";
import { resolveCanvasWorkbenchChangeTreeNodeMeta } from "./CanvasWorkbenchChangeTreeMeta";

type CanvasWorkbenchTranslation = (
  key: string,
  options?: Record<string, unknown>,
) => string;

interface RenderChangeTreeNodeOptions {
  nodes: CanvasWorkbenchChangeTreeNode[];
  selectedChangeItem: CanvasWorkbenchChangeItem | undefined;
  collapsedFolderIds: Set<string>;
  onSelectChangeItem?: (item: CanvasWorkbenchChangeItem) => void;
  onToggleFolder: (nodeId: string) => void;
  translateWorkbench: CanvasWorkbenchTranslation;
  viewedChangeIds: Set<string>;
  onToggleViewed: (changeId: string) => void;
  onContextMenu: (event: MouseEvent, item: CanvasWorkbenchChangeItem) => void;
  onDeleteFile?: (item: CanvasWorkbenchChangeItem) => void | Promise<void>;
  onRevealFile?: (item: CanvasWorkbenchChangeItem) => void;
}

function resolveFileIcon(path: string) {
  const normalizedPath = path.toLowerCase();
  if (normalizedPath.endsWith(".json")) {
    return FileJson;
  }
  if (
    normalizedPath.endsWith(".ts") ||
    normalizedPath.endsWith(".tsx") ||
    normalizedPath.endsWith(".js") ||
    normalizedPath.endsWith(".jsx") ||
    normalizedPath.endsWith(".css") ||
    normalizedPath.endsWith(".html")
  ) {
    return FileCode;
  }
  return FileText;
}

function resolveFileBadge(path: string): string | null {
  const extension = path.split(".").pop()?.trim().toLowerCase();
  if (!extension) {
    return null;
  }
  if (extension === "tsx" || extension === "ts") {
    return "TS";
  }
  if (extension === "jsx" || extension === "js" || extension === "mjs") {
    return "JS";
  }
  if (extension === "md" || extension === "mdx") {
    return "MD";
  }
  if (extension === "rs") {
    return "RS";
  }
  if (extension === "json") {
    return "{}";
  }
  return extension.length <= 3 ? extension.toUpperCase() : null;
}

function renderChangeTreeNodes({
  nodes,
  selectedChangeItem,
  collapsedFolderIds,
  onSelectChangeItem,
  onToggleFolder,
  translateWorkbench,
  viewedChangeIds,
  onToggleViewed,
  onContextMenu,
  onDeleteFile,
  onRevealFile,
}: RenderChangeTreeNodeOptions): ReactNode {
  return nodes.map((node) => {
    const paddingLeft = 8 + node.depth * 14;
    const meta = resolveCanvasWorkbenchChangeTreeNodeMeta(node);

    if (node.type === "folder") {
      const collapsed = collapsedFolderIds.has(node.id);
      const FolderIcon = collapsed ? Folder : FolderOpen;
      return (
        <div key={node.id}>
          <button
            type="button"
            className="flex h-7 w-full items-center gap-1 rounded-[6px] pr-2 text-left text-[13px] font-medium text-[color:var(--lime-text)] transition-colors hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)]"
            style={{ paddingLeft }}
            onClick={() => onToggleFolder(node.id)}
            data-testid="canvas-workbench-change-folder"
            data-change-folder-id={node.id}
            title={node.path}
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text-muted)]" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text-muted)]" />
            )}
            <FolderIcon className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text-muted)]" />
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            <CanvasWorkbenchChangeStatusMark
              meta={meta}
              translateWorkbench={translateWorkbench}
              className="sr-only"
            />
          </button>
          {collapsed
            ? null
            : renderChangeTreeNodes({
                nodes: node.children,
                selectedChangeItem,
                collapsedFolderIds,
                onSelectChangeItem,
                onToggleFolder,
                translateWorkbench,
                viewedChangeIds,
                onToggleViewed,
                onContextMenu,
                onDeleteFile,
                onRevealFile,
              })}
        </div>
      );
    }

    const item = node.item;
    const active = item.id === selectedChangeItem?.id;
    const stats = countCanvasWorkbenchDiffStats(item.diffLines ?? []);
    const viewed = viewedChangeIds.has(item.id);
    const FileIcon = resolveFileIcon(item.path);
    const fileBadge = resolveFileBadge(item.path);

    return (
      <div
        key={node.id}
        role="button"
        tabIndex={onSelectChangeItem ? 0 : -1}
        aria-disabled={onSelectChangeItem ? undefined : true}
        className={cn(
          "group flex min-h-8 w-full items-start gap-1.5 rounded-[6px] py-1 pr-2 text-left text-[13px] transition-colors",
          active
            ? "bg-[color:var(--lime-brand-soft)] text-[color:var(--lime-text-strong)] shadow-[inset_2px_0_0_var(--lime-brand)]"
            : "text-[color:var(--lime-text)] hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)]",
          viewed && !active && "opacity-60",
        )}
        style={{ paddingLeft }}
        onClick={() => onSelectChangeItem?.(item)}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(event, item);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectChangeItem?.(item);
          }
        }}
        data-testid="canvas-workbench-change-item"
        data-change-id={item.id}
        data-review-path={item.path}
        aria-pressed={active}
        title={item.path}
      >
        {fileBadge ? (
          <span
            className={cn(
              "mt-0.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[4px] bg-[color:var(--lime-info-soft)] px-0.5 font-mono text-[9px] font-bold leading-none text-[color:var(--lime-info)]",
              active &&
                "bg-[color:var(--lime-surface)] text-[color:var(--lime-info)]",
            )}
          >
            {fileBadge}
          </span>
        ) : (
          <FileIcon
            className={cn(
              "mt-0.5 h-3.5 w-3.5 shrink-0",
              active
                ? "text-[color:var(--lime-text-strong)]"
                : "text-[color:var(--lime-text-muted)]",
            )}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{node.name}</span>
          {item.preview ? (
            <span
              className={cn(
                "mt-0.5 block truncate font-mono text-[11px]",
                active
                  ? "text-[color:var(--lime-brand)]"
                  : "text-[color:var(--lime-text-muted)]",
              )}
            >
              {item.preview}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className="ml-1 mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[color:var(--lime-text-muted)] opacity-0 transition-opacity hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)] group-hover:opacity-100 focus-visible:opacity-100"
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
          data-testid={`canvas-workbench-change-viewed-${item.id}`}
          data-viewed={viewed ? "true" : "false"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleViewed(item.id);
          }}
        >
          {viewed ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </button>
        <span
          className="ml-1 mt-0.5 inline-flex shrink-0 items-center gap-1 font-mono text-[10px]"
          data-testid="canvas-workbench-change-stats"
          data-change-id={item.id}
        >
          <span className="text-[color:var(--lime-diff-add-border)]">
            +{stats.additions}
          </span>
          <span className="text-[color:var(--lime-diff-remove-border)]">
            -{stats.removals}
          </span>
        </span>
        <button
          type="button"
          className="ml-1 mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[color:var(--lime-text-muted)] opacity-0 transition-opacity hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)] group-hover:opacity-100 group-focus-within:opacity-100"
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
          data-testid={`canvas-workbench-change-viewed-${item.id}`}
          data-viewed={viewed ? "true" : "false"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleViewed(item.id);
          }}
        >
          {viewed ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </button>
        <CanvasWorkbenchChangeStatusMark
          meta={meta}
          translateWorkbench={translateWorkbench}
          className="sr-only"
        />
      </div>
    );
  });
}

const GENERATED_PATH_PATTERN =
  /(^|\/)(dist|build|out|coverage|node_modules|\.next|\.turbo|target|generated)\//i;
const GENERATED_FILE_PATTERN =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i;

function isGeneratedChangePath(path: string): boolean {
  return (
    GENERATED_PATH_PATTERN.test(path) || GENERATED_FILE_PATTERN.test(path)
  );
}

function filterGeneratedNodes(
  nodes: CanvasWorkbenchChangeTreeNode[],
): CanvasWorkbenchChangeTreeNode[] {
  const result: CanvasWorkbenchChangeTreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "folder") {
      const children = filterGeneratedNodes(node.children);
      if (children.length > 0) {
        result.push({ ...node, children });
      }
      continue;
    }
    if (!isGeneratedChangePath(node.item.path)) {
      result.push(node);
    }
  }
  return result;
}

export function CanvasWorkbenchChangesFileList({
  fileTree,
  selectedChangeItem,
  fileFilter,
  disabled,
  translateWorkbench,
  onFileFilterChange,
  onSelectChangeItem,
  onOpenFile,
  onDeleteFile,
  onRevealFile,
}: {
  fileTree: CanvasWorkbenchChangeTreeNode[];
  selectedChangeItem: CanvasWorkbenchChangeItem | undefined;
  fileFilter: string;
  disabled?: boolean;
  translateWorkbench: CanvasWorkbenchTranslation;
  onFileFilterChange?: (value: string) => void;
  onSelectChangeItem?: (item: CanvasWorkbenchChangeItem) => void;
  onOpenFile?: (path: string) => void | Promise<void>;
  onDeleteFile?: (
    item: CanvasWorkbenchChangeItem,
  ) => void | Promise<void>;
  onRevealFile?: (item: CanvasWorkbenchChangeItem) => void;
}) {
  const filterDisabled = Boolean(disabled || !onFileFilterChange);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const { viewedChangeIds, toggleViewedChange } =
    useCanvasWorkbenchViewedChanges();
  const [hideGenerated, setHideGenerated] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpQuery, setJumpQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: CanvasWorkbenchChangeItem;
  } | null>(null);
  const allChangeItems = useMemo(
    () => flattenCanvasWorkbenchChangeFileTree(fileTree),
    [fileTree],
  );
  const jumpMatches = useMemo(() => {
    const keyword = jumpQuery.trim().toLowerCase();
    if (!keyword) return allChangeItems.slice(0, 20);
    return allChangeItems
      .filter((item) => item.path.toLowerCase().includes(keyword))
      .slice(0, 20);
  }, [allChangeItems, jumpQuery]);
  const selectedChangeId = selectedChangeItem?.id;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      setJumpQuery("");
      setJumpOpen(true);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  useEffect(() => {
    if (!selectedChangeId) return;
    const ancestors = new Set<string>();
    const findSelected = (nodes: CanvasWorkbenchChangeTreeNode[]): boolean => {
      let found = false;
      for (const node of nodes) {
        if (node.type === "file") {
          found ||= node.item.id === selectedChangeId;
        } else if (findSelected(node.children)) {
          ancestors.add(node.id);
          found = true;
        }
      }
      return found;
    };
    findSelected(fileTree);
    setCollapsedFolderIds((current) => {
      if (![...ancestors].some((id) => current.has(id))) return current;
      return new Set([...current].filter((id) => !ancestors.has(id)));
    });
  }, [fileTree, selectedChangeId]);
  const handleToggleFolder = (nodeId: string) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  return (
    <aside
      className="flex min-h-0 flex-col border-l border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)]"
      data-testid="canvas-workbench-changes-file-list"
      data-file-tree-panel
    >
      <div className="px-2 py-2">
        <label className="flex h-8 items-center gap-2 rounded-[8px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] px-2.5 text-xs text-[color:var(--lime-text-muted)] shadow-sm">
          <Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text-muted)]" />
          <input
            value={fileFilter}
            disabled={filterDisabled}
            onChange={(event) => onFileFilterChange?.(event.target.value)}
            placeholder={translateWorkbench(
              "agentChat.canvasWorkbench.coding.changes.filterFiles",
            )}
            className="min-w-0 flex-1 bg-transparent text-xs text-[color:var(--lime-text-strong)] outline-none placeholder:text-[color:var(--lime-text-muted)] disabled:cursor-not-allowed"
            data-testid="canvas-workbench-changes-file-filter"
          />
        </label>
      </div>
      <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1">
        <span
          className="text-[11px] font-medium text-[color:var(--lime-text-muted)]"
          data-testid="canvas-workbench-changes-tree-heading"
        >
          {translateWorkbench(
            "agentChat.canvasWorkbench.coding.changes.changedFiles",
          )}
        </span>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)]"
          aria-label={translateWorkbench(
            "agentChat.canvasWorkbench.coding.changes.jumpToFile",
          )}
          title={`${translateWorkbench(
            "agentChat.canvasWorkbench.coding.changes.jumpToFile",
          )} (⌘P)`}
          data-testid="canvas-workbench-jump-to-file"
          onClick={() => {
            setJumpQuery("");
            setJumpOpen(true);
          }}
        >
          <Search className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={cn(
            "inline-flex h-5 w-5 items-center justify-center rounded text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)]",
            hideGenerated &&
              "bg-[color:var(--lime-surface-subtle)] text-[color:var(--lime-text-strong)]",
          )}
          aria-pressed={hideGenerated}
          aria-label={translateWorkbench(
            hideGenerated
              ? "agentChat.canvasWorkbench.coding.changes.showGeneratedFiles"
              : "agentChat.canvasWorkbench.coding.changes.hideGeneratedFiles",
          )}
          title={translateWorkbench(
            hideGenerated
              ? "agentChat.canvasWorkbench.coding.changes.showGeneratedFiles"
              : "agentChat.canvasWorkbench.coding.changes.hideGeneratedFiles",
          )}
          data-testid="canvas-workbench-changes-toggle-generated"
          onClick={() => setHideGenerated((value) => !value)}
        >
          {hideGenerated ? (
            <FilterX className="h-3.5 w-3.5" />
          ) : (
            <Filter className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {fileTree.length > 0 ? (
          <div className="space-y-px">
            {renderChangeTreeNodes({
              nodes: hideGenerated ? filterGeneratedNodes(fileTree) : fileTree,
              selectedChangeItem,
              collapsedFolderIds,
              onSelectChangeItem,
              onToggleFolder: handleToggleFolder,
              translateWorkbench,
              viewedChangeIds,
              onToggleViewed: toggleViewedChange,
              onContextMenu: (event, item) => {
                setContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  item,
                });
              },
              onDeleteFile,
              onRevealFile,
            })}
          </div>
        ) : (
          <div className="px-2 py-3 text-xs text-[color:var(--lime-text-muted)]">
            {translateWorkbench(
              "agentChat.canvasWorkbench.coding.changes.filterEmpty",
            )}
          </div>
        )}
      </div>
      {jumpOpen ? (
        <div
          className="fixed inset-0 z-[94] flex items-start justify-center bg-slate-950/10 px-4 pt-[12vh]"
          onClick={() => setJumpOpen(false)}
        >
          <div
            className="w-full max-w-[440px] overflow-hidden rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            data-testid="canvas-workbench-jump-to-file-dialog"
          >
            <div className="border-b border-[color:var(--lime-surface-border)] p-2">
              <input
                autoFocus
                value={jumpQuery}
                onChange={(event) => setJumpQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setJumpOpen(false);
                  if (event.key === "Enter" && jumpMatches[0]) {
                    onSelectChangeItem?.(jumpMatches[0]);
                    setJumpOpen(false);
                  }
                }}
                placeholder={translateWorkbench(
                  "agentChat.canvasWorkbench.coding.changes.jumpToFile",
                )}
                className="h-9 w-full rounded-lg border border-[color:var(--lime-surface-border)] bg-transparent px-3 text-sm text-[color:var(--lime-text-strong)] outline-none"
                data-testid="canvas-workbench-jump-to-file-input"
              />
            </div>
            <div className="max-h-[320px] overflow-auto p-1">
              {jumpMatches.length > 0 ? (
                jumpMatches.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex h-8 w-full items-center rounded-lg px-2 text-left text-[13px] text-[color:var(--lime-text)] hover:bg-[color:var(--lime-surface-subtle)]"
                    onClick={() => {
                      onSelectChangeItem?.(item);
                      setJumpOpen(false);
                    }}
                  >
                    <span className="truncate">{item.path}</span>
                  </button>
                ))
              ) : (
                <p className="px-2 py-3 text-xs text-[color:var(--lime-text-muted)]">
                  {translateWorkbench(
                    "agentChat.canvasWorkbench.coding.changes.filterEmpty",
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {contextMenu ? (
        <>
          <div
            className="fixed inset-0 z-[90]"
            onClick={() => setContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            role="menu"
            className="fixed z-[91] min-w-[180px] rounded-[10px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-1.5 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            data-testid="canvas-workbench-change-context-menu"
          >
            <button
              type="button"
              role="menuitem"
              className="flex h-8 w-full items-center rounded-[7px] px-2 text-left text-[13px] font-medium text-[color:var(--lime-text)] hover:bg-[color:var(--lime-surface-subtle)]"
              data-testid="canvas-workbench-change-context-copy-path"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText?.(contextMenu.item.path)
                  .then(() =>
                    toast.success(
                      translateWorkbench(
                        "agentChat.canvasWorkbench.coding.changes.toast.copyPathSuccess",
                      ),
                    ),
                  )
                  .catch(() => undefined);
                setContextMenu(null);
              }}
            >
              {translateWorkbench(
                "agentChat.canvasWorkbench.coding.changes.contextMenu.copyPath",
              )}
            </button>
            {onOpenFile ? (
              <button
                type="button"
                role="menuitem"
                className="flex h-8 w-full items-center rounded-[7px] px-2 text-left text-[13px] font-medium text-[color:var(--lime-text)] hover:bg-[color:var(--lime-surface-subtle)]"
                data-testid="canvas-workbench-change-context-open-editor"
                onClick={() => {
                  void onOpenFile(contextMenu.item.path);
                  setContextMenu(null);
                }}
              >
                {translateWorkbench(
                  "agentChat.canvasWorkbench.coding.changes.contextMenu.openInEditor",
                )}
              </button>
            ) : null}
            {onRevealFile && contextMenu?.item.absolutePath?.trim() ? (
              <button
                type="button"
                role="menuitem"
                className="flex h-8 w-full items-center rounded-[7px] px-2 text-left text-[13px] font-medium text-[color:var(--lime-text)] hover:bg-[color:var(--lime-surface-subtle)]"
                data-testid="canvas-workbench-change-context-reveal"
                onClick={() => {
                  onRevealFile(contextMenu.item);
                  setContextMenu(null);
                }}
              >
                {translateWorkbench(
                  "agentChat.canvasWorkbench.coding.changes.contextMenu.revealFile",
                )}
              </button>
            ) : null}
            {onDeleteFile &&
            contextMenu &&
            resolveChangeDisplayMeta(contextMenu.item).kind === "added" ? (
              <button
                type="button"
                role="menuitem"
                className="flex h-8 w-full items-center rounded-[7px] px-2 text-left text-[13px] font-medium text-[color:var(--lime-danger)] hover:bg-[color:var(--lime-danger-soft)]"
                data-testid="canvas-workbench-change-context-delete"
                onClick={() => {
                  void onDeleteFile(contextMenu.item);
                  setContextMenu(null);
                }}
              >
                {translateWorkbench(
                  "agentChat.canvasWorkbench.coding.changes.contextMenu.deleteFile",
                )}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </aside>
  );
}
