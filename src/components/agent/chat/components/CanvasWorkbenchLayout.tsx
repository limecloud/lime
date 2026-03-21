import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  GitCompare,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { listDirectory, type DirectoryListing } from "@/lib/api/fileBrowser";
import type { Artifact } from "@/lib/artifact/types";
import type { CanvasStateUnion } from "@/components/content-creator/canvas/canvasUtils";
import type { DocumentVersion } from "@/components/content-creator/canvas/document/types";
import type { TaskFile } from "./TaskFiles";
import type { HarnessFilePreviewResult } from "./HarnessStatusPanel";
import {
  buildArtifactFromWrite,
  formatArtifactWritePhaseLabel,
  resolveArtifactPreviewText,
  resolveArtifactWritePhase,
} from "../utils/messageArtifacts";
import {
  buildCanvasWorkbenchDiff,
  type CanvasWorkbenchDiffLine,
} from "../utils/canvasWorkbenchDiff";

type CanvasWorkbenchTab =
  | "artifacts"
  | "files"
  | "changes"
  | "preview"
  | "team";
export type CanvasWorkbenchLayoutMode = "split" | "stacked";

interface CanvasWorkbenchEntryBase {
  key: string;
  title: string;
  subtitle?: string;
  filePath?: string;
  absolutePath?: string;
  previewText?: string;
  createdAt?: number;
  isCurrent?: boolean;
  badgeLabel?: string;
  kindLabel: string;
}

interface CanvasWorkbenchArtifactEntry extends CanvasWorkbenchEntryBase {
  source: "artifact";
  artifact: Artifact;
}

interface CanvasWorkbenchDocumentVersionEntry extends CanvasWorkbenchEntryBase {
  source: "document-version";
  version: DocumentVersion;
}

interface CanvasWorkbenchTaskFileEntry extends CanvasWorkbenchEntryBase {
  source: "task-file";
  taskFile: TaskFile;
}

type CanvasWorkbenchEntry =
  | CanvasWorkbenchArtifactEntry
  | CanvasWorkbenchDocumentVersionEntry
  | CanvasWorkbenchTaskFileEntry;

export interface CanvasWorkbenchDefaultPreview {
  selectionKey?: string | null;
  title: string;
  content: string;
  filePath?: string;
  absolutePath?: string;
  previousContent?: string | null;
}

export type CanvasWorkbenchPreviewTarget =
  | {
      kind: "default-canvas";
      title: string;
      content: string;
      filePath?: string;
      absolutePath?: string;
    }
  | {
      kind: "artifact";
      title: string;
      artifact: Artifact;
      filePath?: string;
      absolutePath?: string;
    }
  | {
      kind: "synthetic-artifact";
      title: string;
      artifact: Artifact;
      filePath?: string;
      absolutePath?: string;
    }
  | {
      kind: "loading";
      title: string;
      filePath?: string;
      absolutePath?: string;
    }
  | {
      kind: "unsupported";
      title: string;
      reason: string;
      filePath?: string;
      absolutePath?: string;
    }
  | {
      kind: "empty";
      title: string;
    }
  | {
      kind: "team-workbench";
      title: string;
    };

export interface CanvasWorkbenchTeamView {
  enabled: boolean;
  title?: string;
  subtitle?: string;
  autoFocusToken?: string | number | null;
  triggerState?: {
    tone: "idle" | "active" | "error";
    label?: string | null;
  } | null;
  renderPreview: (options?: { stackedWorkbenchTrigger?: ReactNode }) => ReactNode;
  renderPanel?: () => ReactNode;
  renderFooter?: () => ReactNode;
}

interface WorkspaceFileSelection {
  path: string;
  title: string;
  status: "loading" | "ready" | "error" | "binary";
  content?: string;
  error?: string | null;
  size?: number;
}

export interface CanvasWorkbenchLayoutProps {
  artifacts: Artifact[];
  canvasState: CanvasStateUnion | null;
  taskFiles: TaskFile[];
  selectedFileId?: string;
  workspaceRoot?: string | null;
  workspaceUnavailable?: boolean;
  defaultPreview: CanvasWorkbenchDefaultPreview | null;
  loadFilePreview: (path: string) => Promise<HarnessFilePreviewResult>;
  onOpenPath: (path: string) => Promise<void>;
  onRevealPath: (path: string) => Promise<void>;
  renderPreview: (
    target: CanvasWorkbenchPreviewTarget,
    options?: {
      stackedWorkbenchTrigger?: ReactNode;
    },
  ) => ReactNode;
  onLayoutModeChange?: (mode: CanvasWorkbenchLayoutMode) => void;
  teamView?: CanvasWorkbenchTeamView | null;
}

const WORKBENCH_PANEL_CLASSNAME =
  "rounded-[24px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5";

const WORKBENCH_MUTED_PANEL_CLASSNAME =
  "rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500";

const WORKBENCH_BUTTON_CLASSNAME =
  "border-slate-200/80 bg-white/90 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900";

const WORKBENCH_ACTIVE_BUTTON_CLASSNAME =
  "border-slate-300 bg-slate-100 text-slate-900";

const WORKBENCH_GHOST_BUTTON_CLASSNAME =
  "border-slate-200/80 text-slate-500 hover:bg-slate-50 hover:text-slate-900";

const STACKED_LAYOUT_BREAKPOINT = 1040;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveStackedWorkbenchMetrics(shellHeight: number): {
  minHeight: number;
  maxHeight: number;
  defaultHeight: number;
} {
  const safeShellHeight = shellHeight > 0 ? shellHeight : 720;
  const minHeight = Math.max(220, Math.min(300, Math.round(safeShellHeight * 0.32)));
  const maxHeight = Math.max(
    minHeight + 80,
    Math.min(560, safeShellHeight - 56),
  );
  const defaultHeight = clamp(
    Math.round(safeShellHeight * 0.48),
    minHeight,
    maxHeight,
  );
  return {
    minHeight,
    maxHeight,
    defaultHeight,
  };
}

function resolveStackedTriggerClassName(
  tone: "idle" | "active" | "error",
): string {
  switch (tone) {
    case "active":
      return "border-sky-200 bg-sky-50 text-sky-700 shadow-sky-950/10 hover:bg-sky-100 hover:text-sky-800";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700 shadow-rose-950/10 hover:bg-rose-100 hover:text-rose-800";
    case "idle":
    default:
      return "border-slate-200 bg-white text-slate-600 shadow-slate-950/10 hover:bg-slate-50 hover:text-slate-900";
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isAbsoluteLikePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\")
  );
}

function joinWorkspacePath(rootPath: string, filePath: string): string {
  return `${rootPath.replace(/[\\/]+$/, "")}/${filePath.replace(/^[\\/]+/, "")}`;
}

function resolveWorkspacePath(
  workspaceRoot: string | null | undefined,
  filePath: string | null | undefined,
): string | undefined {
  const normalized = filePath?.trim();
  if (!normalized) {
    return undefined;
  }
  if (isAbsoluteLikePath(normalized)) {
    return normalized;
  }
  if (!workspaceRoot?.trim()) {
    return normalized;
  }
  return joinWorkspacePath(workspaceRoot.trim(), normalized);
}

function resolveFileName(path: string | null | undefined): string {
  const normalized = normalizePath(path?.trim() || "");
  if (!normalized) {
    return "未命名文件";
  }
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function buildSyntheticArtifact(
  id: string,
  filePath: string,
  content: string,
): Artifact {
  return buildArtifactFromWrite({
    filePath,
    content,
    context: {
      artifactId: id,
      status: "complete",
      metadata: {
        previewText: content,
      },
    },
  });
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function resolvePreviousVersionContent(
  version: DocumentVersion,
  versions: DocumentVersion[],
): string | null {
  const parentVersionId = version.metadata?.parentVersionId?.trim();
  if (parentVersionId) {
    const parentVersion = versions.find((item) => item.id === parentVersionId);
    if (parentVersion) {
      return parentVersion.content;
    }
  }

  const currentIndex = versions.findIndex((item) => item.id === version.id);
  if (currentIndex > 0) {
    return versions[currentIndex - 1]?.content || null;
  }

  return null;
}

function resolvePreviousArtifactContent(
  artifact: Artifact,
  artifacts: Artifact[],
): string | null {
  const currentPath = normalizePath(
    typeof artifact.meta.filePath === "string"
      ? artifact.meta.filePath
      : artifact.meta.filename || artifact.title,
  );

  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const candidate = artifacts[index];
    if (candidate.id === artifact.id) {
      continue;
    }
    const candidatePath = normalizePath(
      typeof candidate.meta.filePath === "string"
        ? candidate.meta.filePath
        : candidate.meta.filename || candidate.title,
    );
    if (candidatePath === currentPath && candidate.content.trim()) {
      return candidate.content;
    }
  }

  return null;
}

function isDocumentCanvasState(
  state: CanvasStateUnion | null,
): state is Extract<CanvasStateUnion, { type: "document" }> {
  return Boolean(state && state.type === "document");
}

function resolveMappedPreviousContentForPath(
  absolutePath: string,
  canvasState: CanvasStateUnion | null,
  artifacts: Artifact[],
  workspaceRoot?: string | null,
): string | null {
  const normalizedTarget = normalizePath(absolutePath);
  if (isDocumentCanvasState(canvasState)) {
    const matchedVersion = canvasState.versions.find((version) => {
      const versionPath = resolveWorkspacePath(
        workspaceRoot,
        version.metadata?.sourceFileName,
      );
      return versionPath ? normalizePath(versionPath) === normalizedTarget : false;
    });
    if (matchedVersion) {
      return resolvePreviousVersionContent(matchedVersion, canvasState.versions);
    }
  }

  const matchedArtifact = artifacts.find((artifact) => {
    const artifactPath = resolveWorkspacePath(
      workspaceRoot,
      typeof artifact.meta.filePath === "string"
        ? artifact.meta.filePath
        : artifact.meta.filename || artifact.title,
    );
    return artifactPath ? normalizePath(artifactPath) === normalizedTarget : false;
  });

  return matchedArtifact
    ? resolvePreviousArtifactContent(matchedArtifact, artifacts)
    : null;
}

function buildEntries(
  artifacts: Artifact[],
  canvasState: CanvasStateUnion | null,
  taskFiles: TaskFile[],
  workspaceRoot?: string | null,
): CanvasWorkbenchEntry[] {
  const entries: CanvasWorkbenchEntry[] = artifacts
    .slice()
    .reverse()
    .map((artifact) => {
      const filePath =
        typeof artifact.meta.filePath === "string"
          ? artifact.meta.filePath
          : artifact.meta.filename || artifact.title;
      const writePhase = resolveArtifactWritePhase(artifact);
      return {
        key: `artifact:${artifact.id}`,
        source: "artifact",
        artifact,
        title: artifact.title,
        subtitle: filePath,
        filePath,
        absolutePath: resolveWorkspacePath(workspaceRoot, filePath),
        previewText: resolveArtifactPreviewText(artifact),
        createdAt: artifact.updatedAt || artifact.createdAt,
        badgeLabel: writePhase ? formatArtifactWritePhaseLabel(writePhase) : undefined,
        kindLabel: "产物",
      };
    });

  if (isDocumentCanvasState(canvasState)) {
    entries.push(
      ...canvasState.versions
        .slice()
        .reverse()
        .map((version, index) => ({
          key: `version:${version.id}`,
          source: "document-version" as const,
          version,
          title:
            version.description?.trim() ||
            `文稿版本 ${canvasState.versions.length - index}`,
          subtitle: version.metadata?.sourceFileName || "当前文稿",
          filePath: version.metadata?.sourceFileName,
          absolutePath: resolveWorkspacePath(
            workspaceRoot,
            version.metadata?.sourceFileName,
          ),
          previewText: version.content.trim().slice(0, 180),
          createdAt: version.createdAt,
          isCurrent: version.id === canvasState.currentVersionId,
          badgeLabel: version.id === canvasState.currentVersionId ? "当前" : undefined,
          kindLabel: "版本",
        })),
    );
  }

  entries.push(
    ...taskFiles
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((taskFile) => ({
        key: `task:${taskFile.id}`,
        source: "task-file" as const,
        taskFile,
        title: resolveFileName(taskFile.name),
        subtitle: taskFile.name,
        filePath: taskFile.name,
        absolutePath: resolveWorkspacePath(workspaceRoot, taskFile.name),
        previewText: taskFile.content?.trim().slice(0, 180),
        createdAt: taskFile.updatedAt,
        badgeLabel: taskFile.type === "document" ? "文档" : undefined,
        kindLabel: "任务文件",
      })),
  );

  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.key)) {
      return false;
    }
    seen.add(entry.key);
    return true;
  });
}

function renderDiffState(
  diffLines: CanvasWorkbenchDiffLine[],
): ReactNode {
  return (
    <div className={cn("overflow-hidden", WORKBENCH_PANEL_CLASSNAME)}>
      <div className="max-h-[28rem] overflow-auto">
        {diffLines.map((line, index) => (
          <div
            key={`${line.type}-${index}`}
            className={cn(
              "grid grid-cols-[20px_1fr] gap-3 px-3 py-2 font-mono text-[12px] leading-6",
              line.type === "add" && "bg-emerald-50 text-emerald-900",
              line.type === "remove" && "bg-rose-50 text-rose-900",
              line.type === "context" && "text-slate-500",
            )}
          >
            <span className="select-none text-center">
              {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
            </span>
            <span className="whitespace-pre-wrap break-all">{line.value || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const CanvasWorkbenchLayout = memo(function CanvasWorkbenchLayout({
  artifacts,
  canvasState,
  taskFiles,
  selectedFileId,
  workspaceRoot,
  workspaceUnavailable = false,
  defaultPreview,
  loadFilePreview,
  onOpenPath,
  onRevealPath,
  renderPreview,
  onLayoutModeChange,
  teamView = null,
}: CanvasWorkbenchLayoutProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const stackedResizeCleanupRef = useRef<(() => void) | null>(null);
  const [activeTab, setActiveTab] = useState<CanvasWorkbenchTab>(() =>
    teamView?.enabled && !defaultPreview ? "team" : "artifacts",
  );
  const [collapsed, setCollapsed] = useState(false);
  const [isStackedLayout, setIsStackedLayout] = useState(false);
  const [stackedWorkbenchOpen, setStackedWorkbenchOpen] = useState(false);
  const [shellHeight, setShellHeight] = useState(720);
  const [stackedWorkbenchHeight, setStackedWorkbenchHeight] = useState<number | null>(
    null,
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [directoryCache, setDirectoryCache] = useState<Record<string, DirectoryListing>>(
    {},
  );
  const [loadingDirectories, setLoadingDirectories] = useState<Record<string, boolean>>(
    {},
  );
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>(
    {},
  );
  const [workspaceFileSelections, setWorkspaceFileSelections] = useState<
    Record<string, WorkspaceFileSelection>
  >({});
  const availableTabs = useMemo<Array<{ key: CanvasWorkbenchTab; label: string }>>(
    () => [
      ...(teamView?.enabled ? [{ key: "team" as const, label: "Team" }] : []),
      { key: "artifacts" as const, label: "产物" },
      { key: "files" as const, label: "全部文件" },
      { key: "changes" as const, label: "变更" },
      { key: "preview" as const, label: "预览" },
    ],
    [teamView?.enabled],
  );

  const entries = useMemo(
    () => buildEntries(artifacts, canvasState, taskFiles, workspaceRoot),
    [artifacts, canvasState, taskFiles, workspaceRoot],
  );

  const entryMap = useMemo(
    () => new Map(entries.map((entry) => [entry.key, entry])),
    [entries],
  );

  const fallbackEntryKey = useMemo(() => {
    if (defaultPreview) {
      if (
        defaultPreview.selectionKey &&
        entryMap.has(defaultPreview.selectionKey)
      ) {
        return defaultPreview.selectionKey;
      }
      return null;
    }

    if (selectedFileId) {
      const selectedTaskKey = `task:${selectedFileId}`;
      if (entryMap.has(selectedTaskKey)) {
        return selectedTaskKey;
      }
    }

    return entries[0]?.key || null;
  }, [defaultPreview, entries, entryMap, selectedFileId]);

  useEffect(() => {
    if (selectedKey && (entryMap.has(selectedKey) || selectedKey.startsWith("workspace-file:"))) {
      return;
    }
    setSelectedKey(fallbackEntryKey);
  }, [entryMap, fallbackEntryKey, selectedKey]);

  const loadDirectory = useCallback(async (path: string) => {
    if (!path.trim()) {
      return;
    }
    setLoadingDirectories((previous) => ({ ...previous, [path]: true }));
    try {
      const listing = await listDirectory(path);
      setDirectoryCache((previous) => ({
        ...previous,
        [path]: listing,
      }));
    } catch (error) {
      toast.error(
        `读取目录失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLoadingDirectories((previous) => ({ ...previous, [path]: false }));
    }
  }, []);

  useEffect(() => {
    if (!workspaceRoot?.trim() || workspaceUnavailable) {
      return;
    }
    if (directoryCache[workspaceRoot]) {
      return;
    }
    void loadDirectory(workspaceRoot);
  }, [
    directoryCache,
    loadDirectory,
    workspaceRoot,
    workspaceUnavailable,
  ]);

  useEffect(() => {
    const node = shellRef.current;
    if (!node) {
      return;
    }

    const updateLayout = (width: number, height: number) => {
      if (width <= 0) {
        return;
      }
      setIsStackedLayout(width < STACKED_LAYOUT_BREAKPOINT);
      if (height > 0) {
        setShellHeight(height);
      }
    };

    const fallbackWidth =
      node.getBoundingClientRect().width || node.clientWidth || window.innerWidth;
    const fallbackHeight =
      node.getBoundingClientRect().height || node.clientHeight || window.innerHeight;
    updateLayout(fallbackWidth, fallbackHeight);

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const contentRect = entries[0]?.contentRect;
      const nextWidth =
        contentRect?.width ||
        node.getBoundingClientRect().width ||
        node.clientWidth;
      const nextHeight =
        contentRect?.height ||
        node.getBoundingClientRect().height ||
        node.clientHeight;
      updateLayout(nextWidth, nextHeight);
    });

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    onLayoutModeChange?.(isStackedLayout ? "stacked" : "split");
  }, [isStackedLayout, onLayoutModeChange]);

  useEffect(() => {
    if (isStackedLayout) {
      setStackedWorkbenchOpen(false);
    }
  }, [isStackedLayout]);

  const stackedWorkbenchMetrics = useMemo(
    () => resolveStackedWorkbenchMetrics(shellHeight),
    [shellHeight],
  );

  useEffect(() => {
    setStackedWorkbenchHeight((previous) =>
      previous == null
        ? stackedWorkbenchMetrics.defaultHeight
        : clamp(
            previous,
            stackedWorkbenchMetrics.minHeight,
            stackedWorkbenchMetrics.maxHeight,
          ),
    );
  }, [stackedWorkbenchMetrics]);

  useEffect(() => {
    return () => {
      stackedResizeCleanupRef.current?.();
      stackedResizeCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!availableTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(availableTabs[0]?.key || "artifacts");
    }
  }, [activeTab, availableTabs]);

  const teamAutoFocusTokenRef = useRef<string | number | null | undefined>(
    teamView?.autoFocusToken,
  );

  useEffect(() => {
    if (!teamView?.enabled || teamView.autoFocusToken == null) {
      return;
    }

    if (teamAutoFocusTokenRef.current === teamView.autoFocusToken) {
      return;
    }

    teamAutoFocusTokenRef.current = teamView.autoFocusToken;
    setActiveTab("team");
    setCollapsed(false);
    if (isStackedLayout) {
      setStackedWorkbenchOpen(true);
    }
  }, [isStackedLayout, teamView?.autoFocusToken, teamView?.enabled]);

  const handleToggleDirectory = useCallback(
    (path: string) => {
      setExpandedDirectories((previous) => {
        const nextExpanded = !previous[path];
        return {
          ...previous,
          [path]: nextExpanded,
        };
      });
      if (!directoryCache[path]) {
        void loadDirectory(path);
      }
    },
    [directoryCache, loadDirectory],
  );

  const handleSelectWorkspaceFile = useCallback(
    async (path: string) => {
      const title = resolveFileName(path);
      const selectionKey = `workspace-file:${path}`;
      setSelectedKey(selectionKey);
      setWorkspaceFileSelections((previous) => ({
        ...previous,
        [selectionKey]: {
          path,
          title,
          status: "loading",
        },
      }));

      const preview = await loadFilePreview(path);
      setWorkspaceFileSelections((previous) => {
        if (preview.isBinary) {
          return {
            ...previous,
            [selectionKey]: {
              path,
              title,
              status: "binary",
              error: preview.error ?? null,
              size: preview.size,
            },
          };
        }

        if (preview.error) {
          return {
            ...previous,
            [selectionKey]: {
              path,
              title,
              status: "error",
              error: preview.error,
              size: preview.size,
            },
          };
        }

        return {
          ...previous,
          [selectionKey]: {
            path,
            title,
            status: "ready",
            content: preview.content || "",
            size: preview.size,
          },
        };
      });
    },
    [loadFilePreview],
  );

  const effectiveKey = selectedKey || fallbackEntryKey;
  const selectedEntry = effectiveKey ? entryMap.get(effectiveKey) || null : null;
  const selectedWorkspaceFile = effectiveKey?.startsWith("workspace-file:")
    ? workspaceFileSelections[effectiveKey] || null
    : null;

  const currentTarget = useMemo<CanvasWorkbenchPreviewTarget>(() => {
    if (activeTab === "team" && teamView?.enabled) {
      return {
        kind: "team-workbench",
        title: teamView.title || "Team Workbench",
      };
    }

    if (selectedWorkspaceFile) {
      if (selectedWorkspaceFile.status === "loading") {
        return {
          kind: "loading",
          title: selectedWorkspaceFile.title,
          filePath: selectedWorkspaceFile.path,
          absolutePath: selectedWorkspaceFile.path,
        };
      }

      if (selectedWorkspaceFile.status === "binary") {
        return {
          kind: "unsupported",
          title: selectedWorkspaceFile.title,
          reason: "该文件为二进制内容，暂不支持画布文本预览。",
          filePath: selectedWorkspaceFile.path,
          absolutePath: selectedWorkspaceFile.path,
        };
      }

      if (selectedWorkspaceFile.status === "error") {
        return {
          kind: "unsupported",
          title: selectedWorkspaceFile.title,
          reason: selectedWorkspaceFile.error || "读取文件失败",
          filePath: selectedWorkspaceFile.path,
          absolutePath: selectedWorkspaceFile.path,
        };
      }

      return {
        kind: "synthetic-artifact",
        title: selectedWorkspaceFile.title,
        artifact: buildSyntheticArtifact(
          `canvas-workbench:file:${selectedWorkspaceFile.path}`,
          selectedWorkspaceFile.path,
          selectedWorkspaceFile.content || "",
        ),
        filePath: selectedWorkspaceFile.path,
        absolutePath: selectedWorkspaceFile.path,
      };
    }

    if (selectedEntry) {
      if (
        defaultPreview &&
        selectedEntry.key === defaultPreview.selectionKey &&
        defaultPreview.content.trim()
      ) {
        return {
          kind: "default-canvas",
          title: defaultPreview.title,
          content: defaultPreview.content,
          filePath: defaultPreview.filePath,
          absolutePath: defaultPreview.absolutePath,
        };
      }

      if (selectedEntry.source === "artifact") {
        return {
          kind: "artifact",
          title: selectedEntry.title,
          artifact: selectedEntry.artifact,
          filePath: selectedEntry.filePath,
          absolutePath: selectedEntry.absolutePath,
        };
      }

      if (selectedEntry.source === "document-version") {
        return {
          kind: "synthetic-artifact",
          title: selectedEntry.title,
          artifact: buildSyntheticArtifact(
            `canvas-workbench:version:${selectedEntry.version.id}`,
            selectedEntry.filePath || `${selectedEntry.title}.md`,
            selectedEntry.version.content,
          ),
          filePath: selectedEntry.filePath,
          absolutePath: selectedEntry.absolutePath,
        };
      }

      return {
        kind: "synthetic-artifact",
        title: selectedEntry.title,
        artifact: buildSyntheticArtifact(
          `canvas-workbench:task:${selectedEntry.taskFile.id}`,
          selectedEntry.filePath || selectedEntry.title,
          selectedEntry.taskFile.content || "",
        ),
        filePath: selectedEntry.filePath,
        absolutePath: selectedEntry.absolutePath,
      };
    }

    if (defaultPreview) {
      return {
        kind: "default-canvas",
        title: defaultPreview.title,
        content: defaultPreview.content,
        filePath: defaultPreview.filePath,
        absolutePath: defaultPreview.absolutePath,
      };
    }

    return {
      kind: "empty",
      title: "暂无可预览内容",
    };
  }, [activeTab, defaultPreview, selectedEntry, selectedWorkspaceFile, teamView]);

  const currentContent = useMemo(() => {
    if (currentTarget.kind === "default-canvas") {
      return currentTarget.content;
    }
    if (
      currentTarget.kind === "artifact" ||
      currentTarget.kind === "synthetic-artifact"
    ) {
      return currentTarget.artifact.content;
    }
    return "";
  }, [currentTarget]);

  const previousContent = useMemo(() => {
    if (selectedWorkspaceFile?.status === "ready") {
      return resolveMappedPreviousContentForPath(
        selectedWorkspaceFile.path,
        canvasState,
        artifacts,
        workspaceRoot,
      );
    }

    if (!selectedEntry) {
      return defaultPreview?.previousContent || null;
    }

    if (
      defaultPreview &&
      selectedEntry.key === defaultPreview.selectionKey &&
      defaultPreview.content.trim()
    ) {
      return defaultPreview.previousContent || null;
    }

    if (selectedEntry.source === "artifact") {
      return resolvePreviousArtifactContent(selectedEntry.artifact, artifacts);
    }

    if (selectedEntry.source === "document-version" && isDocumentCanvasState(canvasState)) {
      return resolvePreviousVersionContent(selectedEntry.version, canvasState.versions);
    }

    if (selectedEntry.absolutePath) {
      return resolveMappedPreviousContentForPath(
        selectedEntry.absolutePath,
        canvasState,
        artifacts,
        workspaceRoot,
      );
    }

    return null;
  }, [
    artifacts,
    canvasState,
    defaultPreview,
    selectedEntry,
    selectedWorkspaceFile,
    workspaceRoot,
  ]);

  const diffLines = useMemo(
    () =>
      previousContent !== null
        ? buildCanvasWorkbenchDiff(previousContent, currentContent)
        : [],
    [currentContent, previousContent],
  );

  const selectionPath =
    currentTarget.kind === "default-canvas" ||
    currentTarget.kind === "artifact" ||
    currentTarget.kind === "synthetic-artifact" ||
    currentTarget.kind === "loading" ||
    currentTarget.kind === "unsupported"
      ? currentTarget.absolutePath || currentTarget.filePath
      : undefined;

  const handleCopyPath = useCallback(async () => {
    if (!selectionPath) {
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("当前环境不支持剪贴板写入");
      }
      await navigator.clipboard.writeText(selectionPath);
      toast.success("已复制路径");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "复制路径失败",
      );
    }
  }, [selectionPath]);

  const handleDownload = useCallback(() => {
    if (!currentContent.trim()) {
      return;
    }
    const filename = resolveFileName(selectionPath || currentTarget.title);
    downloadText(filename, currentContent);
  }, [currentContent, currentTarget.title, selectionPath]);

  const renderEntriesTab = () => {
    if (entries.length === 0) {
      return (
        <div className={WORKBENCH_MUTED_PANEL_CLASSNAME}>
          暂无产物记录，可先生成一份文稿或从文件树中选择已有文件。
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {entries.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-label={`选择画布产物-${entry.title}`}
            onClick={() => setSelectedKey(entry.key)}
            className={cn(
              "w-full rounded-[22px] border px-3.5 py-3.5 text-left shadow-sm shadow-slate-950/5 transition-colors",
              effectiveKey === entry.key
                ? WORKBENCH_ACTIVE_BUTTON_CLASSNAME
                : WORKBENCH_BUTTON_CLASSNAME,
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-slate-200/80 bg-slate-50/90 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                    {entry.kindLabel}
                  </span>
                  {entry.isCurrent ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                      当前
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 truncate text-sm font-medium text-foreground">
                  {entry.title}
                </div>
                {entry.subtitle ? (
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {entry.subtitle}
                  </div>
                ) : null}
                {entry.previewText ? (
                  <div className="mt-2 line-clamp-3 text-xs leading-5 text-slate-500">
                    {entry.previewText}
                  </div>
                ) : null}
              </div>
              {entry.badgeLabel ? (
                <Badge variant="outline" className="shrink-0">
                  {entry.badgeLabel}
                </Badge>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    );
  };

  const renderDirectoryNode = (path: string, depth = 0): ReactNode => {
    const listing = directoryCache[path];
    if (!listing) {
      return null;
    }

    return listing.entries.map((entry) => {
      const rowKey = entry.path;
      const isDirectory = entry.isDir;
      const isExpanded = Boolean(expandedDirectories[entry.path]);
      const fileSelectionKey = `workspace-file:${entry.path}`;
      const isSelected = effectiveKey === fileSelectionKey;

      return (
        <div key={rowKey}>
          <button
            type="button"
            aria-label={
              isDirectory
                ? `${isExpanded ? "折叠" : "展开"}目录-${entry.name}`
                : `选择工作区文件-${entry.name}`
            }
            onClick={() => {
              if (isDirectory) {
                handleToggleDirectory(entry.path);
                return;
              }
              void handleSelectWorkspaceFile(entry.path);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors",
              isSelected
                ? "bg-slate-100 text-slate-900"
                : "text-slate-500 hover:bg-white/84 hover:text-slate-900",
            )}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            {isDirectory ? (
              isExpanded ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )
            ) : (
              <span className="w-4 shrink-0" />
            )}
            {isDirectory ? (
              isExpanded ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-amber-600" />
              ) : (
                <Folder className="h-4 w-4 shrink-0 text-amber-600" />
              )
            ) : entry.name.match(/\.(ts|tsx|js|jsx|rs|json|yml|yaml|toml)$/i) ? (
              <FileCode2 className="h-4 w-4 shrink-0 text-sky-600" />
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-slate-500" />
            )}
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {loadingDirectories[entry.path] ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : null}
          </button>
          {isDirectory && isExpanded ? renderDirectoryNode(entry.path, depth + 1) : null}
        </div>
      );
    });
  };

  const renderFilesTab = () => {
    if (workspaceUnavailable) {
      return (
        <div className={WORKBENCH_MUTED_PANEL_CLASSNAME}>
          当前工作区路径不可用，暂时无法浏览全部文件。
        </div>
      );
    }

    if (!workspaceRoot?.trim()) {
      return (
        <div className={WORKBENCH_MUTED_PANEL_CLASSNAME}>
          当前会话没有绑定可浏览的工作区目录。
        </div>
      );
    }

    const rootListing = directoryCache[workspaceRoot];
    return (
      <div className={WORKBENCH_PANEL_CLASSNAME}>
        <div className="flex items-center justify-between border-b border-slate-200/80 px-3 py-3">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
              Workspace Root
            </div>
            <div className="mt-1 truncate text-sm text-foreground">{workspaceRoot}</div>
          </div>
          <button
            type="button"
            aria-label="刷新工作区文件树"
            onClick={() => void loadDirectory(workspaceRoot)}
            className={cn(
              "rounded-xl border px-2.5 py-1.5 text-xs transition-colors",
              WORKBENCH_GHOST_BUTTON_CLASSNAME,
            )}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="max-h-[30rem] overflow-auto px-2 py-2">
          {loadingDirectories[workspaceRoot] && !rootListing ? (
            <div className="flex items-center gap-2 px-2 py-4 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载目录...
            </div>
          ) : rootListing ? (
            renderDirectoryNode(workspaceRoot)
          ) : (
            <div className="px-2 py-4 text-sm text-slate-500">
              暂无目录内容。
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderChangesTab = () => {
    if (!currentContent.trim()) {
      return (
        <div className={WORKBENCH_MUTED_PANEL_CLASSNAME}>
          当前选中项没有可比较的正文内容。
        </div>
      );
    }

    if (previousContent === null) {
      return (
        <div className={WORKBENCH_MUTED_PANEL_CLASSNAME}>
          当前选中项没有可用的上一版本，暂时无法展示变更。
        </div>
      );
    }

    return renderDiffState(diffLines);
  };

  const renderPreviewTab = () => {
    if (currentTarget.kind === "loading") {
      return (
        <div className="flex items-center gap-2 rounded-[24px] border border-slate-200/80 bg-white/86 px-4 py-6 text-sm text-slate-500 shadow-sm shadow-slate-950/5">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取文件内容...
        </div>
      );
    }

    if (currentTarget.kind === "unsupported") {
      return (
        <div className={WORKBENCH_MUTED_PANEL_CLASSNAME}>
          {currentTarget.reason}
        </div>
      );
    }

    if (!currentContent.trim()) {
      return (
        <div className={WORKBENCH_MUTED_PANEL_CLASSNAME}>
          当前选中项暂无可展示内容。
        </div>
      );
    }

    return (
      <div className={cn("overflow-hidden", WORKBENCH_PANEL_CLASSNAME)}>
        <div className="max-h-[30rem] overflow-auto px-4 py-4">
          <pre className="whitespace-pre-wrap break-all text-xs leading-6 text-foreground">
            {currentContent}
          </pre>
        </div>
      </div>
    );
  };

  const renderTeamTab = () => {
    if (!teamView?.enabled) {
      return (
        <div className={WORKBENCH_MUTED_PANEL_CLASSNAME}>
          当前没有可展示的 Team 工作台。
        </div>
      );
    }

    return teamView.renderPanel ? (
      teamView.renderPanel()
    ) : (
      <div className={WORKBENCH_MUTED_PANEL_CLASSNAME}>
        Team 工作台已启用。
      </div>
    );
  };

  const renderTabButtons = (stacked: boolean) => (
    stacked ? (
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {availableTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-label={`切换画布标签-${tab.label}`}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === tab.key
                ? WORKBENCH_ACTIVE_BUTTON_CLASSNAME
                : WORKBENCH_BUTTON_CLASSNAME,
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    ) : (
      <div
        className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
        style={{
          gridTemplateColumns: `repeat(${Math.min(
            Math.max(availableTabs.length, 1),
            5,
          )}, minmax(0, 1fr))`,
        }}
      >
        {availableTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-label={`切换画布标签-${tab.label}`}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "rounded-2xl border px-2 py-2 text-xs font-medium transition-colors",
              activeTab === tab.key
                ? WORKBENCH_ACTIVE_BUTTON_CLASSNAME
                : WORKBENCH_BUTTON_CLASSNAME,
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    )
  );

  const renderWorkbenchHeader = (
    stacked: boolean,
    options?: {
      showCollapseButton?: boolean;
    },
  ) => (
    <div
      className={cn(
        "border-b border-slate-200/80",
        stacked ? "px-3 py-3" : "px-4 py-4",
      )}
    >
      {stacked ? (
        <div className="mb-3 flex justify-center">
          <span className="h-1.5 w-10 rounded-full bg-slate-200" />
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {activeTab === "team" ? "Team Workbench" : "Canvas Workbench"}
          </div>
          <div
            className={cn(
              "mt-1 text-sm font-semibold text-foreground",
              stacked ? "line-clamp-2" : "truncate",
            )}
          >
            {activeTab === "team"
              ? teamView?.title || currentTarget.title
              : currentTarget.title}
          </div>
          {activeTab === "team" && teamView?.subtitle ? (
            <div
              className={cn(
                "mt-1 text-xs text-slate-500",
                stacked ? "line-clamp-2" : "truncate",
              )}
            >
              {teamView.subtitle}
            </div>
          ) : null}
          {activeTab !== "team" && selectionPath ? (
            <div
              className={cn(
                "mt-1 text-xs text-slate-500",
                stacked ? "line-clamp-2 break-all" : "truncate",
              )}
            >
              {selectionPath}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {activeTab !== "team" ? (
            <button
              type="button"
              aria-label="下载当前画布项"
              disabled={!currentContent.trim()}
              onClick={handleDownload}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-xl border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                WORKBENCH_GHOST_BUTTON_CLASSNAME,
              )}
            >
              <Download className="h-4 w-4" />
            </button>
          ) : null}
          {stacked || options?.showCollapseButton ? (
            <button
              type="button"
              aria-label="折叠画布工作台"
              onClick={() => {
                if (stacked) {
                  setStackedWorkbenchOpen(false);
                  return;
                }
                setCollapsed(true);
              }}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-xl border transition-colors",
                WORKBENCH_GHOST_BUTTON_CLASSNAME,
              )}
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
      {renderTabButtons(stacked)}
    </div>
  );

  const renderWorkbenchFooter = (stacked: boolean) => (
    activeTab === "team" && teamView?.renderFooter ? (
      <div
        className={cn(
          "border-t border-slate-200/80",
          stacked ? "px-3 py-3" : "px-4 py-3",
        )}
      >
        {teamView.renderFooter()}
      </div>
    ) : (
    <div
      className={cn(
        "border-t border-slate-200/80",
        stacked ? "px-3 py-3" : "px-4 py-3",
      )}
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-label="复制当前路径"
          disabled={!selectionPath}
          onClick={() => {
            void handleCopyPath();
          }}
          className={cn(
            "inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            WORKBENCH_GHOST_BUTTON_CLASSNAME,
          )}
        >
          <Copy className="h-3.5 w-3.5" />
          复制路径
        </button>
        <button
          type="button"
          aria-label="定位当前文件"
          disabled={!selectionPath}
          onClick={() => {
            if (selectionPath) {
              void onRevealPath(selectionPath);
            }
          }}
          className={cn(
            "inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            WORKBENCH_GHOST_BUTTON_CLASSNAME,
          )}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          定位
        </button>
        <button
          type="button"
          aria-label="系统打开当前文件"
          disabled={!selectionPath}
          onClick={() => {
            if (selectionPath) {
              void onOpenPath(selectionPath);
            }
          }}
          className={cn(
            "inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            WORKBENCH_GHOST_BUTTON_CLASSNAME,
          )}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          打开
        </button>
      </div>
      {previousContent !== null ? (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
          <GitCompare className="h-3.5 w-3.5" />
          已关联到上一版本，可在“变更”中查看差异。
        </div>
      ) : null}
    </div>
    )
  );

  const renderActiveTab = () =>
    activeTab === "team"
      ? renderTeamTab()
      : activeTab === "artifacts"
      ? renderEntriesTab()
      : activeTab === "files"
        ? renderFilesTab()
        : activeTab === "changes"
          ? renderChangesTab()
          : renderPreviewTab();

  const handleStartStackedResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!isStackedLayout || !stackedWorkbenchOpen) {
        return;
      }

      event.preventDefault();
      stackedResizeCleanupRef.current?.();

      const startY = event.clientY;
      const startHeight =
        stackedWorkbenchHeight ?? stackedWorkbenchMetrics.defaultHeight;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const nextHeight = clamp(
          startHeight + (startY - moveEvent.clientY),
          stackedWorkbenchMetrics.minHeight,
          stackedWorkbenchMetrics.maxHeight,
        );
        setStackedWorkbenchHeight(nextHeight);
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        stackedResizeCleanupRef.current = null;
      };

      stackedResizeCleanupRef.current = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [
      isStackedLayout,
      stackedWorkbenchHeight,
      stackedWorkbenchMetrics.defaultHeight,
      stackedWorkbenchMetrics.maxHeight,
      stackedWorkbenchMetrics.minHeight,
      stackedWorkbenchOpen,
    ],
  );

  const stackedWorkbenchTrigger =
    isStackedLayout && !stackedWorkbenchOpen ? (
      <button
        type="button"
        aria-label="展开画布工作台"
        title="工作台"
        onClick={() => setStackedWorkbenchOpen(true)}
        data-testid="canvas-workbench-trigger"
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-medium shadow-lg transition-all hover:-translate-y-0.5",
          resolveStackedTriggerClassName(teamView?.triggerState?.tone || "idle"),
        )}
      >
        <PanelRightOpen className="h-4 w-4" />
        <span>{activeTab === "team" ? "Team 工作台" : "工作台"}</span>
        {teamView?.triggerState?.label ? (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none",
              teamView.triggerState.tone === "error"
                ? "border-rose-200 bg-white/90 text-rose-700"
                : teamView.triggerState.tone === "active"
                  ? "border-sky-200 bg-white/90 text-sky-700"
                  : "border-slate-200 bg-white/90 text-slate-600",
            )}
          >
            {teamView.triggerState.label}
          </span>
        ) : null}
      </button>
    ) : undefined;

  return (
    <div
      ref={shellRef}
      data-testid="canvas-workbench-shell"
      data-layout-mode={isStackedLayout ? "stacked" : "split"}
      className={cn(
        "relative h-full min-h-0 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5",
        isStackedLayout ? "block" : "flex flex-row",
      )}
    >
      <div
        className={cn(
          "min-w-0 overflow-hidden",
          isStackedLayout ? "h-full" : "flex-1",
        )}
      >
      {activeTab === "team" && teamView?.enabled
        ? teamView.renderPreview({
            stackedWorkbenchTrigger,
          })
        : renderPreview(currentTarget, {
            stackedWorkbenchTrigger,
          })}
      </div>

      {isStackedLayout ? (
        stackedWorkbenchOpen ? (
          <>
            <button
              type="button"
              aria-label="折叠画布工作台遮罩"
              onClick={() => setStackedWorkbenchOpen(false)}
              className="absolute inset-0 z-10 bg-slate-950/5"
            />
            <section
              data-testid="canvas-workbench-layout"
              data-panel-placement="overlay-bottom"
              className="absolute inset-x-3 bottom-3 z-20 flex max-w-full flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.16)]"
              style={{
                height: `${stackedWorkbenchHeight ?? stackedWorkbenchMetrics.defaultHeight}px`,
                minHeight: `${stackedWorkbenchMetrics.minHeight}px`,
                maxHeight: `${stackedWorkbenchMetrics.maxHeight}px`,
              }}
            >
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="调整画布工作台高度"
                data-testid="canvas-workbench-resize-handle"
                onMouseDown={handleStartStackedResize}
                className="flex h-5 shrink-0 cursor-row-resize items-center justify-center border-b border-slate-200/80 bg-white"
              >
                <span className="h-1.5 w-10 rounded-full bg-slate-200" />
              </div>
              {renderWorkbenchHeader(true)}
              <div className="flex-1 overflow-auto px-3 py-3">
                {renderActiveTab()}
              </div>
              {renderWorkbenchFooter(true)}
            </section>
          </>
        ) : null
      ) : (
        <aside
          data-testid="canvas-workbench-layout"
          data-panel-placement="side"
          className={cn(
            "relative flex h-full flex-col border-l border-slate-200/80 bg-white transition-[width] duration-200",
            collapsed ? "w-12" : "w-[360px]",
          )}
        >
          {collapsed ? (
            <div className="flex h-full flex-col items-center gap-3 px-2 py-4">
              <button
                type="button"
                aria-label="展开画布工作台"
                onClick={() => setCollapsed(false)}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-xl border transition-colors",
                  WORKBENCH_GHOST_BUTTON_CLASSNAME,
                )}
              >
                <PanelRightOpen className="h-4 w-4" />
              </button>
              {availableTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  aria-label={`切换画布标签-${tab.label}`}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "rounded-xl border px-2 py-1.5 text-[11px] transition-colors",
                    activeTab === tab.key
                      ? WORKBENCH_ACTIVE_BUTTON_CLASSNAME
                      : WORKBENCH_BUTTON_CLASSNAME,
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : (
            <>
              {renderWorkbenchHeader(false, {
                showCollapseButton: true,
              })}
              <div className="flex-1 overflow-auto px-4 py-4">{renderActiveTab()}</div>
              {renderWorkbenchFooter(false)}
            </>
          )}
        </aside>
      )}
    </div>
  );
});

export default CanvasWorkbenchLayout;
