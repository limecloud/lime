import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  AppWindow,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  Home,
  List,
  Monitor,
  Package,
  Pin,
  PlusCircle,
  RefreshCw,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  getFileIconDataUrl,
  getFileManagerLocations,
  listDirectory,
  type FileEntry,
  type FileManagerLocation,
} from "@/lib/api/fileBrowser";
import {
  openPathWithDefaultApp,
  revealPathInFinder,
} from "@/lib/api/fileSystem";
import { cn } from "@/lib/utils";
import type { MessagePathReference } from "../../types";
import {
  clearRememberedPathReferencesForDrag,
  createPathReference,
  PATH_REFERENCE_DRAG_MIME,
  rememberPathReferencesForDrag,
  serializePathReferencesForDrag,
} from "../../utils/pathReferences";

const PINNED_LOCATIONS_STORAGE_KEY = "lime.file-manager.pinned-locations";
const APPLICATION_ENTRY_PATTERN = /\.(app|appref-ms|exe|lnk)$/i;
const MAX_ICON_PREFETCH_ENTRIES = 72;
const ICON_PREFETCH_CONCURRENCY = 2;

type ViewMode = "list" | "grid";

interface FileManagerSidebarProps {
  onClose: () => void;
  onAddPathReferences: (references: MessagePathReference[]) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

interface EntryGroup {
  key: string;
  label: string;
  entries: FileEntry[];
}

function asPinnedLocation(value: unknown): FileManagerLocation | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.label !== "string" ||
    typeof record.path !== "string" ||
    typeof record.kind !== "string"
  ) {
    return null;
  }
  return {
    id: record.id,
    label: record.label,
    path: record.path,
    kind: record.kind,
  };
}

function loadPinnedLocations(): FileManagerLocation[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PINNED_LOCATIONS_STORAGE_KEY) || "[]",
    ) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .map(asPinnedLocation)
          .filter((item): item is FileManagerLocation => Boolean(item))
      : [];
  } catch {
    return [];
  }
}

function savePinnedLocations(locations: FileManagerLocation[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    PINNED_LOCATIONS_STORAGE_KEY,
    JSON.stringify(locations),
  );
}

function getLocationIcon(kind: string): LucideIcon {
  switch (kind) {
    case "home":
      return Home;
    case "desktop":
      return Monitor;
    case "downloads":
      return Download;
    case "applications":
      return AppWindow;
    case "documents":
      return FileText;
    default:
      return Folder;
  }
}

function isApplicationEntry(
  entry: FileEntry,
  activeLocationKind: string,
): boolean {
  if (APPLICATION_ENTRY_PATTERN.test(entry.name)) {
    return true;
  }
  return activeLocationKind === "applications" && !entry.isDir;
}

function EntryIcon({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className: string;
}) {
  return <Icon className={className} aria-hidden strokeWidth={2.2} />;
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatEntryTime(modifiedAt: number): string {
  if (!modifiedAt) {
    return "未知时间";
  }
  return new Date(modifiedAt).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveEntryGroup(entry: FileEntry): string {
  const modifiedAt = entry.modifiedAt || 0;
  if (!modifiedAt) {
    return "更早";
  }
  const now = new Date();
  const value = new Date(modifiedAt);
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = now.getTime() - value.getTime();

  if (value.toDateString() === now.toDateString()) {
    return "今天";
  }
  if (diff < 7 * dayMs) {
    return "本周";
  }
  if (
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth()
  ) {
    return "本月";
  }
  if (value.getFullYear() === now.getFullYear()) {
    return "今年";
  }
  return "更早";
}

function groupEntries(entries: FileEntry[]): EntryGroup[] {
  const order = ["今天", "本周", "本月", "今年", "更早"];
  const map = new Map<string, FileEntry[]>();
  for (const entry of entries) {
    const key = resolveEntryGroup(entry);
    map.set(key, [...(map.get(key) || []), entry]);
  }
  return order
    .map((key) => ({ key, label: key, entries: map.get(key) || [] }))
    .filter((group) => group.entries.length > 0);
}

function createReferenceFromEntry(
  entry: FileEntry,
): MessagePathReference | null {
  return createPathReference({
    path: entry.path,
    name: entry.name,
    isDir: entry.isDir,
    size: entry.size,
    mimeType: entry.mimeType,
    source: "file_manager",
  });
}

async function copyText(value: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error("复制失败，请检查剪贴板权限");
  }
}

export const FileManagerSidebar: React.FC<FileManagerSidebarProps> = ({
  onClose,
  onAddPathReferences,
}) => {
  const [locations, setLocations] = useState<FileManagerLocation[]>([]);
  const [pinnedLocations, setPinnedLocations] = useState<FileManagerLocation[]>(
    () => loadPinnedLocations(),
  );
  const initialPinnedLocationsRef = useRef(pinnedLocations);
  const [activePath, setActivePath] = useState<string>("");
  const [activeLocationKind, setActiveLocationKind] = useState<string>("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const iconDataUrlCacheRef = useRef<Map<string, string>>(new Map());
  const entriesRef = useRef<FileEntry[]>([]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const entryPathSignature = useMemo(
    () => entries.map((entry) => entry.path).join("\u0000"),
    [entries],
  );

  useEffect(() => {
    let cancelled = false;
    void getFileManagerLocations()
      .then((result) => {
        if (cancelled) {
          return;
        }
        setLocations(result);
        const first = result[0] || initialPinnedLocationsRef.current[0];
        if (first) {
          setActivePath(first.path);
          setActiveLocationKind(first.kind);
          setViewMode(first.kind === "applications" ? "grid" : "list");
        }
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : String(loadError),
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadActiveDirectory = useCallback(async () => {
    if (!activePath.trim()) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const listing = await listDirectory(activePath);
      setEntries(listing.entries || []);
      setParentPath(listing.parentPath || null);
      if (listing.error) {
        setError(listing.error);
      }
    } catch (loadError) {
      setEntries([]);
      setParentPath(null);
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setLoading(false);
    }
  }, [activePath]);

  useEffect(() => {
    void loadActiveDirectory();
  }, [loadActiveDirectory]);

  useEffect(() => {
    const currentEntries = entriesRef.current;
    if (currentEntries.length === 0) {
      return;
    }

    let cancelled = false;
    const iconCache = iconDataUrlCacheRef.current;
    const pendingEntries = currentEntries
      .filter((entry) => !entry.iconDataUrl)
      .slice(0, MAX_ICON_PREFETCH_ENTRIES);
    const cachedUpdates = new Map<string, string>();
    const requestEntries: FileEntry[] = [];

    for (const entry of pendingEntries) {
      if (!iconCache.has(entry.path)) {
        requestEntries.push(entry);
        continue;
      }
      cachedUpdates.set(entry.path, iconCache.get(entry.path)!);
    }

    if (cachedUpdates.size > 0) {
      setEntries((current) =>
        current.map((entry) => {
          const iconDataUrl = cachedUpdates.get(entry.path);
          return iconDataUrl && !entry.iconDataUrl
            ? { ...entry, iconDataUrl }
            : entry;
        }),
      );
    }

    if (requestEntries.length === 0) {
      return;
    }

    const loadIcons = async () => {
      for (
        let offset = 0;
        offset < requestEntries.length && !cancelled;
        offset += ICON_PREFETCH_CONCURRENCY
      ) {
        const batch = requestEntries.slice(
          offset,
          offset + ICON_PREFETCH_CONCURRENCY,
        );
        const resolved = await Promise.all(
          batch.map(async (entry) => {
            try {
              const iconDataUrl = await getFileIconDataUrl(entry.path);
              return { path: entry.path, iconDataUrl: iconDataUrl || null };
            } catch {
              return { path: entry.path, iconDataUrl: null };
            }
          }),
        );

        if (cancelled) {
          return;
        }

        const updates = new Map<string, string>();
        for (const item of resolved) {
          if (item.iconDataUrl) {
            iconCache.set(item.path, item.iconDataUrl);
            updates.set(item.path, item.iconDataUrl);
          }
        }

        if (updates.size > 0) {
          setEntries((current) =>
            current.map((entry) => {
              const iconDataUrl = updates.get(entry.path);
              return iconDataUrl && !entry.iconDataUrl
                ? { ...entry, iconDataUrl }
                : entry;
            }),
          );
        }
      }
    };

    void loadIcons();
    return () => {
      cancelled = true;
    };
  }, [activePath, entryPathSignature]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const closeMenu = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };
    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const allLocations = useMemo(() => {
    const byPath = new Map<string, FileManagerLocation>();
    for (const location of locations) {
      byPath.set(location.path, location);
    }
    for (const location of pinnedLocations) {
      byPath.set(location.path, location);
    }
    return Array.from(byPath.values());
  }, [locations, pinnedLocations]);

  const activeTitle = useMemo(() => {
    return (
      allLocations.find((location) => location.path === activePath)?.label ||
      activePath.split(/[\\/]/).filter(Boolean).at(-1) ||
      "文件"
    );
  }, [activePath, allLocations]);

  const entryGroups = useMemo(() => groupEntries(entries), [entries]);

  const handleSelectLocation = useCallback((location: FileManagerLocation) => {
    setActivePath(location.path);
    setActiveLocationKind(location.kind);
    setViewMode(location.kind === "applications" ? "grid" : "list");
  }, []);

  const handleOpenEntry = useCallback(
    (entry: FileEntry) => {
      const isApplication = isApplicationEntry(entry, activeLocationKind);
      if (entry.isDir && !isApplication) {
        setActivePath(entry.path);
        setActiveLocationKind("");
        return;
      }
      void openPathWithDefaultApp(entry.path).catch((openError) => {
        toast.error(
          `打开失败：${openError instanceof Error ? openError.message : String(openError)}`,
        );
      });
    },
    [activeLocationKind],
  );

  const handleAddEntry = useCallback(
    (entry: FileEntry) => {
      const reference = createReferenceFromEntry(entry);
      if (!reference) {
        return;
      }
      onAddPathReferences([reference]);
      toast.success(`已添加到对话：${reference.name}`);
    },
    [onAddPathReferences],
  );

  const handlePinEntry = useCallback((entry: FileEntry) => {
    if (!entry.isDir) {
      toast.info("只有文件夹可以固定到侧栏");
      return;
    }
    const nextLocation: FileManagerLocation = {
      id: `pinned:${entry.path}`,
      label: entry.name,
      path: entry.path,
      kind: "pinned",
    };
    setPinnedLocations((current) => {
      const next = [
        ...current.filter((location) => location.path !== nextLocation.path),
        nextLocation,
      ];
      savePinnedLocations(next);
      return next;
    });
    toast.success(`已固定：${entry.name}`);
  }, []);

  const handleContextAction = useCallback(
    (action: string, entry: FileEntry) => {
      setContextMenu(null);
      switch (action) {
        case "open":
          handleOpenEntry(entry);
          break;
        case "reveal":
          void revealPathInFinder(entry.path).catch((revealError) => {
            toast.error(
              `显示失败：${revealError instanceof Error ? revealError.message : String(revealError)}`,
            );
          });
          break;
        case "copy-path":
          void copyText(entry.path, "已复制路径");
          break;
        case "copy-name":
          void copyText(entry.name, "已复制文件名");
          break;
        case "add":
          handleAddEntry(entry);
          break;
        case "pin":
          handlePinEntry(entry);
          break;
        case "refresh":
          void loadActiveDirectory();
          break;
      }
    },
    [handleAddEntry, handleOpenEntry, handlePinEntry, loadActiveDirectory],
  );

  const handleDragStart = useCallback(
    (event: React.DragEvent, entry: FileEntry) => {
      const reference = createReferenceFromEntry(entry);
      if (!reference) {
        event.preventDefault();
        return;
      }
      rememberPathReferencesForDrag([reference]);
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(
        PATH_REFERENCE_DRAG_MIME,
        serializePathReferencesForDrag([reference]),
      );
      event.dataTransfer.setData("text/plain", reference.path);
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    clearRememberedPathReferencesForDrag(1000);
  }, []);

  const renderEntry = (entry: FileEntry) => {
    const isApplication = isApplicationEntry(entry, activeLocationKind);
    const Icon = isApplication ? Package : entry.isDir ? Folder : FileText;
    const iconKind = isApplication
      ? "application"
      : entry.isDir
        ? "folder"
        : "file";
    const hasNativeIcon = Boolean(entry.iconDataUrl);
    return (
      <button
        key={entry.path}
        type="button"
        draggable
        data-testid="file-manager-entry"
        data-entry-kind={
          isApplication ? "application" : entry.isDir ? "directory" : "file"
        }
        data-file-path={entry.path}
        onClick={() => handleOpenEntry(entry)}
        onDragStart={(event) => handleDragStart(event, entry)}
        onDragEnd={handleDragEnd}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY, entry });
        }}
        className={cn(
          "group w-full rounded-[14px] border border-transparent text-left transition hover:border-amber-200 hover:bg-amber-50/72 focus:outline-none focus:ring-2 focus:ring-amber-200",
          viewMode === "grid"
            ? "flex min-h-[104px] flex-col items-center justify-center gap-2 px-3 py-3 text-center"
            : "flex items-center gap-3 px-3 py-2.5",
        )}
        title={entry.path}
      >
        <span
          data-testid="file-manager-entry-icon"
          data-icon-kind={iconKind}
          data-icon-source={hasNativeIcon ? "native" : "fallback"}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-[12px] border shadow-sm shadow-slate-950/5",
            viewMode === "grid" ? "h-11 w-11" : "h-8 w-8",
            hasNativeIcon
              ? "border-transparent bg-transparent text-slate-700 shadow-none"
              : isApplication
                ? "border-sky-100 bg-sky-50 text-sky-700"
                : entry.isDir
                  ? "border-amber-100 bg-amber-50 text-amber-700"
                  : "border-slate-200 bg-slate-50 text-slate-600",
          )}
        >
          {entry.iconDataUrl ? (
            <img
              data-testid="file-manager-entry-native-icon"
              src={entry.iconDataUrl}
              alt=""
              draggable={false}
              className="h-full w-full rounded-[12px] object-contain"
            />
          ) : (
            <EntryIcon
              icon={Icon}
              className={viewMode === "grid" ? "h-5 w-5" : "h-4 w-4"}
            />
          )}
        </span>
        <span
          className={cn("min-w-0", viewMode === "grid" ? "w-full" : "flex-1")}
        >
          <span className="block truncate text-[13px] font-semibold text-slate-800">
            {entry.name}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-slate-500">
            {entry.isDir
              ? formatEntryTime(entry.modifiedAt)
              : [formatEntryTime(entry.modifiedAt), formatFileSize(entry.size)]
                  .filter(Boolean)
                  .join(" · ")}
          </span>
        </span>
      </button>
    );
  };

  return (
    <aside
      className="flex h-full w-[312px] shrink-0 overflow-hidden rounded-[20px] border border-[color:var(--lime-surface-border)] bg-white shadow-sm shadow-slate-950/5"
      data-testid="file-manager-sidebar"
      data-tauri-no-drag
      data-lime-no-window-drag
    >
      <div
        className="flex w-[48px] shrink-0 flex-col items-center gap-1.5 border-r border-slate-100 bg-slate-50/90 py-2"
        data-testid="file-manager-location-rail"
      >
        {allLocations.map((location) => {
          const Icon = getLocationIcon(location.kind);
          const active = location.path === activePath;
          return (
            <button
              key={`${location.id}:${location.path}`}
              type="button"
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-[11px] border text-slate-500 transition",
                active
                  ? "border-amber-200 bg-amber-100 text-amber-800 shadow-sm shadow-amber-950/10"
                  : "border-transparent bg-transparent hover:border-slate-200 hover:bg-white hover:text-slate-800",
              )}
              title={location.label}
              aria-label={location.label}
              onClick={() => handleSelectLocation(location)}
            >
              <EntryIcon icon={Icon} className="h-[17px] w-[17px]" />
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-2 border-b border-slate-100 px-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-slate-900">
                {activeTitle}
              </h2>
              {loading ? (
                <span className="text-[11px] text-amber-700">加载中</span>
              ) : null}
            </div>
            <p
              className="mt-0.5 truncate text-[11px] text-slate-500"
              title={activePath}
            >
              {activePath || "正在准备文件位置"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
              aria-label="返回上级"
              title="返回上级"
              disabled={!parentPath}
              onClick={() => parentPath && setActivePath(parentPath)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="刷新"
              title="刷新"
              onClick={() => void loadActiveDirectory()}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="切换视图"
              title={viewMode === "list" ? "网格视图" : "列表视图"}
              onClick={() =>
                setViewMode((current) => (current === "list" ? "grid" : "list"))
              }
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
              aria-label="关闭文件管理器"
              title="关闭文件管理器"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {error ? (
          <div className="m-3 flex items-start gap-2 rounded-[16px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
          {!loading && entries.length === 0 ? (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-[18px] border border-dashed border-slate-200 bg-slate-50/70 px-4 text-center text-sm text-slate-500">
              <Folder className="mb-2 h-8 w-8 text-slate-300" />
              当前目录没有可显示项目
            </div>
          ) : null}

          <div className="space-y-3">
            {entryGroups.map((group) => (
              <section key={group.key}>
                <div className="mb-1.5 flex items-center gap-1 px-1 text-[11px] font-semibold text-slate-500">
                  <ChevronRight className="h-3 w-3" />
                  {group.label}
                </div>
                <div
                  className={cn(
                    viewMode === "grid"
                      ? "grid grid-cols-2 gap-2"
                      : "space-y-1",
                  )}
                >
                  {group.entries.map(renderEntry)}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      {contextMenu ? (
        <div
          data-testid="file-manager-context-menu"
          className="fixed z-[120] w-56 overflow-hidden rounded-[16px] border border-slate-200 bg-white p-1.5 text-sm text-slate-700 shadow-xl shadow-slate-950/12"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {[
            ["open", "打开", ExternalLink],
            ["reveal", "在系统文件管理器中显示", Folder],
            ["add", "添加到对话", PlusCircle],
            ["copy-path", "复制路径", Copy],
            ["copy-name", "复制文件名", FileText],
            ["pin", "固定到侧栏", Pin],
            ["refresh", "刷新", RefreshCw],
          ].map(([action, label, Icon]) => {
            const MenuIcon = Icon as LucideIcon;
            return (
              <button
                key={action as string}
                type="button"
                className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left transition hover:bg-amber-50 hover:text-amber-800"
                onClick={() =>
                  handleContextAction(action as string, contextMenu.entry)
                }
              >
                <MenuIcon className="h-4 w-4" />
                <span>{label as string}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
};
