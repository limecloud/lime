import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import { Badge } from "@/components/ui/badge";
import { listDirectory, type DirectoryListing } from "@/lib/api/fileBrowser";
import type { Artifact } from "@/lib/artifact/types";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { DocumentVersion } from "@/lib/workspace/workbenchCanvas";
import type { TaskFile } from "./TaskFiles";
import type { HarnessFilePreviewResult } from "./HarnessStatusPanel";
import {
  buildArtifactFromWrite,
  formatArtifactWritePhaseLabel,
  resolveArtifactPreviewText,
  resolveArtifactWritePhase,
} from "../utils/messageArtifacts";
import { resolveContentPostArtifactDisplayTitle } from "../utils/contentPostSkill";
import {
  buildCanvasWorkbenchDiff,
  type CanvasWorkbenchDiffLine,
} from "../utils/canvasWorkbenchDiff";
import {
  extractFileNameFromPath,
  normalizeManagedWorkspacePathForDisplay,
  resolveAbsoluteWorkspacePath,
} from "../workspace/workspacePath";
import { filterWorkspaceDirectoryListing } from "../workspace/workspaceTreeVisibility";
import {
  ArtifactWorkbenchDocumentInspector,
  type ArtifactWorkbenchDocumentController,
} from "../workspace/artifactWorkbenchDocument";

type CanvasWorkbenchTab =
  | "session"
  | "workspace"
  | "team"
  | `document:${string}`;
type CanvasWorkbenchDocumentViewMode = "preview" | "changes";
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

export type CanvasWorkbenchHeaderBadgeTone = "default" | "accent" | "success";

export interface CanvasWorkbenchHeaderBadge {
  key: string;
  label: string;
  tone?: CanvasWorkbenchHeaderBadgeTone;
}

export interface CanvasWorkbenchSummaryStat {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone?: CanvasWorkbenchHeaderBadgeTone;
}

export interface CanvasWorkbenchPanelCopy {
  introText?: string;
  emptyText?: string;
  unavailableText?: string;
  sectionEyebrow?: string;
  loadingText?: string;
  emptyDirectoryText?: string;
}

export interface CanvasWorkbenchHeaderView {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  badges?: CanvasWorkbenchHeaderBadge[];
  summaryStats?: CanvasWorkbenchSummaryStat[];
  tabLabel?: string;
  tabBadge?: string;
  tabBadgeTone?: "slate" | "sky" | "rose";
  panelCopy?: CanvasWorkbenchPanelCopy;
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

export interface CanvasWorkbenchTeamView extends CanvasWorkbenchHeaderView {
  enabled: boolean;
  autoFocusToken?: string | number | null;
  preferFullscreenPreview?: boolean;
  preferFixedPanel?: boolean;
  triggerState?: {
    tone: "idle" | "active" | "error";
    label?: string | null;
  } | null;
  renderPreview: (options?: {
    stackedWorkbenchTrigger?: ReactNode;
  }) => ReactNode;
  renderPanel?: () => ReactNode;
  renderFooter?: () => ReactNode;
}

export interface CanvasWorkbenchSessionView extends CanvasWorkbenchHeaderView {
  renderPanel: () => ReactNode;
}

interface WorkspaceFileSelection {
  path: string;
  title: string;
  status: "loading" | "ready" | "error" | "binary";
  content?: string;
  error?: string | null;
  size?: number;
}

interface CanvasWorkbenchResolvedSelection {
  selectionKey: string | null;
  entrySource:
    | CanvasWorkbenchEntry["source"]
    | "workspace-file"
    | "default-preview";
  title: string;
  tabLabel: string;
  subtitle?: string;
  kindLabel: string;
  badgeLabel?: string;
  target: CanvasWorkbenchPreviewTarget;
  content: string;
  previousContent: string | null;
  selectionPath?: string;
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
      onArtifactDocumentControllerChange?: (
        controller: ArtifactWorkbenchDocumentController | null,
      ) => void;
    },
  ) => ReactNode;
  onLayoutModeChange?: (mode: CanvasWorkbenchLayoutMode) => void;
  workspaceView?: CanvasWorkbenchHeaderView | null;
  teamView?: CanvasWorkbenchTeamView | null;
  sessionView?: CanvasWorkbenchSessionView | null;
}

const WORKBENCH_SHELL_CLASSNAME =
  "rounded-[28px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5";

const WORKBENCH_PANEL_CLASSNAME =
  "rounded-[24px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5";

const WORKBENCH_MUTED_PANEL_CLASSNAME =
  "rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500";

const WORKBENCH_BUTTON_CLASSNAME =
  "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900";

const WORKBENCH_ACTIVE_BUTTON_CLASSNAME =
  "border-slate-300 bg-white text-slate-950 shadow-sm shadow-slate-950/5";

const WORKBENCH_GHOST_BUTTON_CLASSNAME =
  "border-slate-200/80 text-slate-500 hover:bg-slate-50 hover:text-slate-900";

const STACKED_LAYOUT_BREAKPOINT = 1040;

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function resolveWorkspaceRelativeDisplayPath(
  workspaceRoot: string | null | undefined,
  path: string | null | undefined,
): string | undefined {
  const normalizedPath = normalizePath(path?.trim() || "");
  if (!normalizedPath) {
    return undefined;
  }

  const normalizedRoot = normalizePath(workspaceRoot?.trim() || "");
  if (!normalizedRoot) {
    return normalizedPath;
  }

  if (normalizedPath === normalizedRoot) {
    return extractFileNameFromPath(normalizedPath);
  }

  const prefix = `${normalizedRoot}/`;
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }

  return normalizedPath;
}

function resolveWorkspaceRelativePath(
  workspaceRoot: string | null | undefined,
  path: string | null | undefined,
): string | null {
  const normalizedPath = normalizePath(path?.trim() || "");
  if (!normalizedPath) {
    return null;
  }

  const normalizedRoot = normalizePath(workspaceRoot?.trim() || "");
  if (!normalizedRoot) {
    return normalizedPath;
  }

  if (normalizedPath === normalizedRoot) {
    return "";
  }

  const prefix = `${normalizedRoot}/`;
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }

  if (!/^(\/|[A-Za-z]:\/|\\\\)/.test(normalizedPath)) {
    return normalizedPath;
  }

  return null;
}

function resolveSavedContentBundleRoot(
  workspaceRoot: string | null | undefined,
  selectionPath: string | null | undefined,
): string | null {
  const relativePath = resolveWorkspaceRelativePath(workspaceRoot, selectionPath);
  if (!relativePath) {
    return null;
  }

  const match = relativePath.match(/^(exports\/[^/]+\/[^/]+)/);
  if (!match?.[1]) {
    return null;
  }

  return resolveAbsoluteWorkspacePath(workspaceRoot, match[1]) || null;
}

function resolveWorkspacePanelDisplayPath(
  workspaceRoot: string | null | undefined,
  panelRootPath: string | null | undefined,
): string | undefined {
  const normalizedPanelRoot = normalizePath(panelRootPath?.trim() || "");
  if (!normalizedPanelRoot) {
    return undefined;
  }

  const normalizedWorkspaceRoot = normalizePath(workspaceRoot?.trim() || "");
  if (
    normalizedWorkspaceRoot &&
    normalizedPanelRoot !== normalizedWorkspaceRoot
  ) {
    return (
      resolveWorkspaceRelativeDisplayPath(workspaceRoot, panelRootPath) ||
      normalizeManagedWorkspacePathForDisplay(normalizedPanelRoot)
    );
  }

  return normalizeManagedWorkspacePathForDisplay(normalizedPanelRoot);
}

function isSavedContentBundleDirectory(
  workspaceRoot: string | null | undefined,
  listingPath: string,
): boolean {
  const relativePath = resolveWorkspaceRelativePath(workspaceRoot, listingPath);
  return Boolean(relativePath?.match(/^exports\/[^/]+\/[^/]+(?:\/.*)?$/));
}

function compareWorkspaceTreeEntryName(left: string, right: string): number {
  return left.localeCompare(right, "zh-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function sortWorkspaceListingEntries(
  entries: DirectoryListing["entries"],
  listingPath: string,
  workspaceRoot: string | null | undefined,
): DirectoryListing["entries"] {
  const isBundleDirectory = isSavedContentBundleDirectory(
    workspaceRoot,
    listingPath,
  );

  const resolveRank = (entry: DirectoryListing["entries"][number]) => {
    const normalizedName = (entry.name || "").trim().toLowerCase();

    if (isBundleDirectory) {
      if (normalizedName === "index.md") {
        return 0;
      }
      if (normalizedName === "agents.md") {
        return 1;
      }
      if (entry.isDir && normalizedName === "skills") {
        return 2;
      }
      if (entry.isDir && (normalizedName === "images" || normalizedName === "assets")) {
        return 3;
      }
      if (entry.isDir) {
        return 4;
      }
      if (/\.(md|markdown|mdx)$/i.test(normalizedName)) {
        return 5;
      }
      if (/\.(png|jpe?g|webp|gif|svg)$/i.test(normalizedName)) {
        return 6;
      }
      if (/\.json$/i.test(normalizedName)) {
        return 8;
      }
      return 7;
    }

    if (entry.isDir) {
      return 0;
    }
    if (/\.(md|markdown|mdx)$/i.test(normalizedName)) {
      return 1;
    }
    return 2;
  };

  return [...entries].sort((left, right) => {
    const rankDiff = resolveRank(left) - resolveRank(right);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return compareWorkspaceTreeEntryName(left.name, right.name);
  });
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
  const currentPath = normalizePath(resolveArtifactProtocolFilePath(artifact));

  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const candidate = artifacts[index];
    if (candidate.id === artifact.id) {
      continue;
    }
    const candidatePath = normalizePath(
      resolveArtifactProtocolFilePath(candidate),
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
      const versionPath = resolveAbsoluteWorkspacePath(
        workspaceRoot,
        version.metadata?.sourceFileName,
      );
      return versionPath
        ? normalizePath(versionPath) === normalizedTarget
        : false;
    });
    if (matchedVersion) {
      return resolvePreviousVersionContent(
        matchedVersion,
        canvasState.versions,
      );
    }
  }

  const matchedArtifact = artifacts.find((artifact) => {
    const artifactPath = resolveAbsoluteWorkspacePath(
      workspaceRoot,
      resolveArtifactProtocolFilePath(artifact),
    );
    return artifactPath
      ? normalizePath(artifactPath) === normalizedTarget
      : false;
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
  const taskFileEntries: CanvasWorkbenchTaskFileEntry[] = taskFiles
    .slice()
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((taskFile) => ({
      key: `task:${taskFile.id}`,
      source: "task-file" as const,
      taskFile,
      title: resolveContentPostArtifactDisplayTitle({
        title: extractFileNameFromPath(taskFile.name),
        filePath: taskFile.name,
        metadata: taskFile.metadata,
      }),
      subtitle: taskFile.name,
      filePath: taskFile.name,
      absolutePath: resolveAbsoluteWorkspacePath(
        workspaceRoot,
        taskFile.name,
      ),
      previewText: taskFile.content?.trim().slice(0, 180),
      createdAt: taskFile.updatedAt,
      badgeLabel: taskFile.type === "document" ? "文档" : undefined,
      kindLabel: "任务文件",
    }));

  const taskFilePathSet = new Set(
    taskFileEntries
      .map((entry) => normalizePath(entry.absolutePath || entry.filePath || ""))
      .filter(Boolean),
  );
  const seenArtifactPaths = new Set<string>();

  const entries: CanvasWorkbenchEntry[] = artifacts
    .slice()
    .reverse()
    .flatMap((artifact) => {
      const filePath = resolveArtifactProtocolFilePath(artifact);
      const writePhase = resolveArtifactWritePhase(artifact);
      const absolutePath = resolveAbsoluteWorkspacePath(workspaceRoot, filePath);
      const pathKey = normalizePath(absolutePath || filePath || "");
      if (pathKey) {
        if (taskFilePathSet.has(pathKey) || seenArtifactPaths.has(pathKey)) {
          return [];
        }
        seenArtifactPaths.add(pathKey);
      }

      return [{
        key: `artifact:${artifact.id}`,
        source: "artifact",
        artifact,
        title: resolveContentPostArtifactDisplayTitle({
          title: artifact.title,
          filePath,
          metadata: artifact.meta,
        }),
        subtitle: filePath,
        filePath,
        absolutePath,
        previewText: resolveArtifactPreviewText(artifact),
        createdAt: artifact.updatedAt || artifact.createdAt,
        badgeLabel: writePhase
          ? formatArtifactWritePhaseLabel(writePhase)
          : undefined,
        kindLabel: "产物",
      }];
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
          absolutePath: resolveAbsoluteWorkspacePath(
            workspaceRoot,
            version.metadata?.sourceFileName,
          ),
          previewText: version.content.trim().slice(0, 180),
          createdAt: version.createdAt,
          isCurrent: version.id === canvasState.currentVersionId,
          badgeLabel:
            version.id === canvasState.currentVersionId ? "当前" : undefined,
          kindLabel: "版本",
        })),
    );
  }

  entries.push(...taskFileEntries);

  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.key)) {
      return false;
    }
    seen.add(entry.key);
    return true;
  });
}

function renderDiffState(diffLines: CanvasWorkbenchDiffLine[]): ReactNode {
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
            <span className="whitespace-pre-wrap break-all">
              {line.value || " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildDocumentTabKey(selectionKey: string): `document:${string}` {
  return `document:${selectionKey}`;
}

function isDocumentTabKey(
  value: CanvasWorkbenchTab | string,
): value is `document:${string}` {
  return value.startsWith("document:");
}

function parseDocumentTabKey(tabKey: `document:${string}` | string): string {
  return tabKey.replace(/^document:/, "");
}

function resolvePreviewContent(target: CanvasWorkbenchPreviewTarget): string {
  if (target.kind === "default-canvas") {
    return target.content;
  }

  if (target.kind === "artifact" || target.kind === "synthetic-artifact") {
    return target.artifact.content;
  }

  return "";
}

function resolvePreviewPath(
  target: CanvasWorkbenchPreviewTarget,
): string | undefined {
  if (
    target.kind === "default-canvas" ||
    target.kind === "artifact" ||
    target.kind === "synthetic-artifact" ||
    target.kind === "loading" ||
    target.kind === "unsupported"
  ) {
    return target.absolutePath || target.filePath;
  }

  return undefined;
}

function buildDefaultPreviewSelection(
  defaultPreview: CanvasWorkbenchDefaultPreview,
): CanvasWorkbenchResolvedSelection {
  const target: CanvasWorkbenchPreviewTarget = {
    kind: "default-canvas",
    title: defaultPreview.title,
    content: defaultPreview.content,
    filePath: defaultPreview.filePath,
    absolutePath: defaultPreview.absolutePath,
  };
  const fileLabel = extractFileNameFromPath(
    defaultPreview.filePath || defaultPreview.title,
  );

  return {
    selectionKey: defaultPreview.selectionKey || null,
    entrySource: "default-preview",
    title: defaultPreview.title,
    tabLabel: fileLabel || defaultPreview.title,
    subtitle: defaultPreview.filePath,
    kindLabel: "主稿",
    target,
    content: defaultPreview.content,
    previousContent: defaultPreview.previousContent || null,
    selectionPath: resolvePreviewPath(target),
  };
}

function resolveSelectionContext({
  selectionKey,
  defaultPreview,
  entryMap,
  workspaceFileSelections,
  canvasState,
  artifacts,
  workspaceRoot,
}: {
  selectionKey: string | null;
  defaultPreview: CanvasWorkbenchDefaultPreview | null;
  entryMap: Map<string, CanvasWorkbenchEntry>;
  workspaceFileSelections: Record<string, WorkspaceFileSelection>;
  canvasState: CanvasStateUnion | null;
  artifacts: Artifact[];
  workspaceRoot?: string | null;
}): CanvasWorkbenchResolvedSelection | null {
  if (
    selectionKey &&
    defaultPreview &&
    selectionKey === defaultPreview.selectionKey &&
    defaultPreview.content.trim()
  ) {
    return buildDefaultPreviewSelection(defaultPreview);
  }

  if (!selectionKey) {
    return defaultPreview ? buildDefaultPreviewSelection(defaultPreview) : null;
  }

  if (selectionKey.startsWith("workspace-file:")) {
    const rawPath = selectionKey.replace(/^workspace-file:/, "");
    const workspaceFile = workspaceFileSelections[selectionKey] || {
      path: rawPath,
      title: extractFileNameFromPath(rawPath),
      status: "loading" as const,
    };

    let target: CanvasWorkbenchPreviewTarget;
    if (workspaceFile.status === "loading") {
      target = {
        kind: "loading",
        title: workspaceFile.title,
        filePath: workspaceFile.path,
        absolutePath: workspaceFile.path,
      };
    } else if (workspaceFile.status === "binary") {
      target = {
        kind: "unsupported",
        title: workspaceFile.title,
        reason: "该文件为二进制内容，暂不支持画布文本预览。",
        filePath: workspaceFile.path,
        absolutePath: workspaceFile.path,
      };
    } else if (workspaceFile.status === "error") {
      target = {
        kind: "unsupported",
        title: workspaceFile.title,
        reason: workspaceFile.error || "读取文件失败",
        filePath: workspaceFile.path,
        absolutePath: workspaceFile.path,
      };
    } else {
      target = {
        kind: "default-canvas",
        title: workspaceFile.title,
        content: workspaceFile.content || "",
        filePath: workspaceFile.path,
        absolutePath: workspaceFile.path,
      };
    }

    const displayPath = resolveWorkspaceRelativeDisplayPath(
      workspaceRoot,
      workspaceFile.path,
    );

    return {
      selectionKey,
      entrySource: "workspace-file",
      title: workspaceFile.title,
      tabLabel:
        extractFileNameFromPath(workspaceFile.path) || workspaceFile.title,
      subtitle: displayPath,
      kindLabel: "文件",
      target,
      content: resolvePreviewContent(target),
      previousContent:
        workspaceFile.status === "ready"
          ? resolveMappedPreviousContentForPath(
              workspaceFile.path,
              canvasState,
              artifacts,
              workspaceRoot,
            )
          : null,
      selectionPath: resolvePreviewPath(target),
    };
  }

  const entry = entryMap.get(selectionKey) || null;
  if (!entry) {
    return defaultPreview ? buildDefaultPreviewSelection(defaultPreview) : null;
  }

  let target: CanvasWorkbenchPreviewTarget;
  if (entry.source === "artifact") {
    target = {
      kind: "artifact",
      title: entry.title,
      artifact: entry.artifact,
      filePath: entry.filePath,
      absolutePath: entry.absolutePath,
    };
  } else if (entry.source === "document-version") {
    target = {
      kind: "synthetic-artifact",
      title: entry.title,
      artifact: buildSyntheticArtifact(
        `canvas-workbench:version:${entry.version.id}`,
        entry.filePath || `${entry.title}.md`,
        entry.version.content,
      ),
      filePath: entry.filePath,
      absolutePath: entry.absolutePath,
    };
  } else {
    target = {
      kind: "synthetic-artifact",
      title: entry.title,
      artifact: buildSyntheticArtifact(
        `canvas-workbench:task:${entry.taskFile.id}`,
        entry.filePath || entry.title,
        entry.taskFile.content || "",
      ),
      filePath: entry.filePath,
      absolutePath: entry.absolutePath,
    };
  }

  let previousContent: string | null = null;
  if (entry.source === "artifact") {
    previousContent = resolvePreviousArtifactContent(entry.artifact, artifacts);
  } else if (
    entry.source === "document-version" &&
    isDocumentCanvasState(canvasState)
  ) {
    previousContent = resolvePreviousVersionContent(
      entry.version,
      canvasState.versions,
    );
  } else if (entry.absolutePath) {
    previousContent = resolveMappedPreviousContentForPath(
      entry.absolutePath,
      canvasState,
      artifacts,
      workspaceRoot,
    );
  }

  return {
    selectionKey,
    entrySource: entry.source,
    title: entry.title,
    tabLabel:
      extractFileNameFromPath(entry.filePath || entry.title) || entry.title,
    subtitle: entry.subtitle,
    kindLabel: entry.kindLabel,
    badgeLabel: entry.badgeLabel,
    target,
    content: resolvePreviewContent(target),
    previousContent,
    selectionPath: resolvePreviewPath(target),
  };
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
  workspaceView = null,
  teamView = null,
  sessionView = null,
}: CanvasWorkbenchLayoutProps) {
  const shouldPreferTeamTabByDefault =
    teamView?.enabled === true && !defaultPreview;
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [isStackedLayout, setIsStackedLayout] = useState(false);
  const [documentPreviewMode, setDocumentPreviewMode] =
    useState<CanvasWorkbenchDocumentViewMode>("preview");
  const [documentInspectorCollapsed, setDocumentInspectorCollapsed] =
    useState(true);
  const [artifactDocumentController, setArtifactDocumentController] =
    useState<ArtifactWorkbenchDocumentController | null>(null);
  const [directoryCache, setDirectoryCache] = useState<
    Record<string, DirectoryListing>
  >({});
  const [loadingDirectories, setLoadingDirectories] = useState<
    Record<string, boolean>
  >({});
  const [expandedDirectories, setExpandedDirectories] = useState<
    Record<string, boolean>
  >({});
  const [workspaceFileSelections, setWorkspaceFileSelections] = useState<
    Record<string, WorkspaceFileSelection>
  >({});

  const entries = useMemo(
    () => buildEntries(artifacts, canvasState, taskFiles, workspaceRoot),
    [artifacts, canvasState, taskFiles, workspaceRoot],
  );

  const entryMap = useMemo(
    () => new Map(entries.map((entry) => [entry.key, entry])),
    [entries],
  );

  const fallbackSelectionKey = useMemo(() => {
    if (
      defaultPreview?.selectionKey &&
      entryMap.has(defaultPreview.selectionKey)
    ) {
      return defaultPreview.selectionKey;
    }

    if (selectedFileId) {
      const selectedTaskKey = `task:${selectedFileId}`;
      if (entryMap.has(selectedTaskKey)) {
        return selectedTaskKey;
      }
    }

    return entries[0]?.key || null;
  }, [defaultPreview?.selectionKey, entries, entryMap, selectedFileId]);

  const initialDocumentSelectionKey =
    defaultPreview?.selectionKey || fallbackSelectionKey;
  const shouldPreferSessionTabOnMount = Boolean(
    sessionView?.renderPanel && !initialDocumentSelectionKey,
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(
    initialDocumentSelectionKey,
  );
  const [openDocumentTabs, setOpenDocumentTabs] = useState<
    Array<`document:${string}`>
  >(() =>
    initialDocumentSelectionKey
      ? [buildDocumentTabKey(initialDocumentSelectionKey)]
      : [],
  );
  const [activeTab, setActiveTab] = useState<CanvasWorkbenchTab>(() => {
    if (shouldPreferSessionTabOnMount) {
      return "session";
    }
    if (initialDocumentSelectionKey) {
      return buildDocumentTabKey(initialDocumentSelectionKey);
    }
    return shouldPreferTeamTabByDefault ? "team" : "session";
  });
  const hasAutoFocusedInitialDocumentTabRef = useRef(
    Boolean(initialDocumentSelectionKey),
  );

  const isKnownSelectionKey = useCallback(
    (selectionKey: string | null) => {
      if (!selectionKey) {
        return false;
      }
      if (selectionKey.startsWith("workspace-file:")) {
        return true;
      }
      return (
        entryMap.has(selectionKey) ||
        selectionKey === defaultPreview?.selectionKey
      );
    },
    [defaultPreview?.selectionKey, entryMap],
  );

  useEffect(() => {
    if (!selectedKey || isKnownSelectionKey(selectedKey)) {
      return;
    }
    setSelectedKey(fallbackSelectionKey);
  }, [fallbackSelectionKey, isKnownSelectionKey, selectedKey]);

  useEffect(() => {
    const seedSelectionKeys = [
      defaultPreview?.selectionKey || null,
      fallbackSelectionKey,
    ].filter((value): value is string => Boolean(value));

    if (seedSelectionKeys.length === 0) {
      return;
    }

    setOpenDocumentTabs((previous) => {
      const next = [...previous];
      let changed = false;
      seedSelectionKeys.forEach((selectionKey) => {
        const tabKey = buildDocumentTabKey(selectionKey);
        if (!next.includes(tabKey)) {
          next.push(tabKey);
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [defaultPreview?.selectionKey, fallbackSelectionKey]);

  useEffect(() => {
    setOpenDocumentTabs((previous) => {
      const next = previous.filter((tabKey) =>
        isKnownSelectionKey(parseDocumentTabKey(tabKey)),
      );
      return next.length === previous.length ? previous : next;
    });
  }, [isKnownSelectionKey]);

  useEffect(() => {
    if (activeTab !== "team" || teamView?.enabled) {
      return;
    }
    setActiveTab(openDocumentTabs[0] || "session");
  }, [activeTab, openDocumentTabs, teamView?.enabled]);

  useEffect(() => {
    if (!isDocumentTabKey(activeTab)) {
      return;
    }
    const selectionKey = parseDocumentTabKey(activeTab);
    if (!isKnownSelectionKey(selectionKey)) {
      setActiveTab(openDocumentTabs[0] || "session");
      return;
    }
    if (selectedKey !== selectionKey) {
      setSelectedKey(selectionKey);
    }
  }, [activeTab, isKnownSelectionKey, openDocumentTabs, selectedKey]);

  useEffect(() => {
    if (hasAutoFocusedInitialDocumentTabRef.current) {
      return;
    }
    if (!sessionView?.renderPanel || activeTab !== "session") {
      return;
    }
    const initialDocumentTab = openDocumentTabs[0];
    if (!initialDocumentTab) {
      return;
    }
    hasAutoFocusedInitialDocumentTabRef.current = true;
    setActiveTab(initialDocumentTab);
  }, [activeTab, openDocumentTabs, sessionView?.renderPanel]);

  useEffect(() => {
    const node = shellRef.current;
    if (!node) {
      return;
    }

    const updateLayout = (width: number) => {
      if (width <= 0) {
        return;
      }
      setIsStackedLayout(width < STACKED_LAYOUT_BREAKPOINT);
    };

    const fallbackWidth =
      node.getBoundingClientRect().width ||
      node.clientWidth ||
      window.innerWidth;
    updateLayout(fallbackWidth);

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((observerEntries) => {
      const contentRect = observerEntries[0]?.contentRect;
      const nextWidth =
        contentRect?.width ||
        node.getBoundingClientRect().width ||
        node.clientWidth;
      updateLayout(nextWidth);
    });

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    onLayoutModeChange?.(isStackedLayout ? "stacked" : "split");
  }, [isStackedLayout, onLayoutModeChange]);

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!path.trim()) {
        return;
      }
      setLoadingDirectories((previous) => ({ ...previous, [path]: true }));
      try {
        const listing = filterWorkspaceDirectoryListing(
          await listDirectory(path),
          workspaceRoot,
        );
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
    },
    [workspaceRoot],
  );

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
  }, [teamView?.autoFocusToken, teamView?.enabled]);

  const handleOpenDocumentSelection = useCallback((selectionKey: string) => {
    setSelectedKey(selectionKey);
    const tabKey = buildDocumentTabKey(selectionKey);
    setOpenDocumentTabs((previous) =>
      previous.includes(tabKey) ? previous : [...previous, tabKey],
    );
    setActiveTab(tabKey);
  }, []);

  const handleCloseDocumentTab = useCallback(
    (tabKey: `document:${string}`) => {
      const selectionKey = parseDocumentTabKey(tabKey);
      setOpenDocumentTabs((previous) =>
        previous.filter((currentTabKey) => currentTabKey !== tabKey),
      );

      if (selectedKey === selectionKey) {
        setSelectedKey(fallbackSelectionKey);
      }

      if (activeTab === tabKey) {
        const fallbackTab =
          openDocumentTabs.find((currentTabKey) => currentTabKey !== tabKey) ||
          (teamView?.enabled && shouldPreferTeamTabByDefault
            ? "team"
            : "session");
        setActiveTab(fallbackTab as CanvasWorkbenchTab);
      }
    },
    [
      activeTab,
      fallbackSelectionKey,
      openDocumentTabs,
      selectedKey,
      shouldPreferTeamTabByDefault,
      teamView?.enabled,
    ],
  );

  const handleToggleDirectory = useCallback(
    (path: string) => {
      const willExpand = !expandedDirectories[path];
      setExpandedDirectories((previous) => ({
        ...previous,
        [path]: willExpand,
      }));
      if (willExpand) {
        void loadDirectory(path);
      }
    },
    [expandedDirectories, loadDirectory],
  );

  const refreshDirectorySubtree = useCallback(
    async (rootPath: string) => {
      const normalizedRootPath = normalizePath(rootPath.trim());
      if (!normalizedRootPath) {
        return;
      }

      const expandedDescendants = Object.entries(expandedDirectories)
        .filter(
          ([path, expanded]) =>
            expanded &&
            normalizePath(path).startsWith(`${normalizedRootPath}/`),
        )
        .map(([path]) => path);

      await Promise.all([
        loadDirectory(rootPath),
        ...expandedDescendants.map((path) => loadDirectory(path)),
      ]);
    },
    [expandedDirectories, loadDirectory],
  );

  const handleSelectWorkspaceFile = useCallback(
    async (path: string) => {
      const title = extractFileNameFromPath(path);
      const selectionKey = `workspace-file:${path}`;
      handleOpenDocumentSelection(selectionKey);
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
    [handleOpenDocumentSelection, loadFilePreview],
  );

  const documentSelectionKey = useMemo(() => {
    if (isDocumentTabKey(activeTab)) {
      return parseDocumentTabKey(activeTab);
    }
    return selectedKey || fallbackSelectionKey;
  }, [activeTab, fallbackSelectionKey, selectedKey]);

  const documentContext = useMemo(
    () =>
      resolveSelectionContext({
        selectionKey: documentSelectionKey,
        defaultPreview,
        entryMap,
        workspaceFileSelections,
        canvasState,
        artifacts,
        workspaceRoot,
      }),
    [
      artifacts,
      canvasState,
      defaultPreview,
      documentSelectionKey,
      entryMap,
      workspaceFileSelections,
      workspaceRoot,
    ],
  );

  const sessionContext = useMemo(() => {
    if (defaultPreview?.content.trim()) {
      return buildDefaultPreviewSelection(defaultPreview);
    }
    return documentContext;
  }, [defaultPreview, documentContext]);

  const workspacePanelRootPath = useMemo(
    () =>
      resolveSavedContentBundleRoot(
        workspaceRoot,
        documentContext?.selectionPath || sessionContext?.selectionPath,
      ) || workspaceRoot || null,
    [
      documentContext?.selectionPath,
      sessionContext?.selectionPath,
      workspaceRoot,
    ],
  );

  const workspacePanelDisplayPath = useMemo(
    () =>
      resolveWorkspacePanelDisplayPath(workspaceRoot, workspacePanelRootPath),
    [workspacePanelRootPath, workspaceRoot],
  );

  useEffect(() => {
    if (!workspacePanelRootPath?.trim() || workspaceUnavailable) {
      return;
    }
    if (directoryCache[workspacePanelRootPath]) {
      return;
    }
    void loadDirectory(workspacePanelRootPath);
  }, [
    directoryCache,
    loadDirectory,
    workspacePanelRootPath,
    workspaceUnavailable,
  ]);

  const teamTarget = useMemo<CanvasWorkbenchPreviewTarget | null>(() => {
    if (!teamView?.enabled) {
      return null;
    }
    return {
      kind: "team-workbench",
      title: teamView.title || "任务工作台",
    };
  }, [teamView]);

  const hasCustomSessionView = Boolean(sessionView?.renderPanel);

  const activePreviewContext =
    activeTab === "session"
      ? hasCustomSessionView
        ? null
        : sessionContext
      : isDocumentTabKey(activeTab)
        ? documentContext
        : null;

  const activeSelectionPath = activePreviewContext?.selectionPath;
  const activeContent = activePreviewContext?.content || "";

  const documentDiffLines = useMemo(
    () =>
      documentContext && documentContext.previousContent !== null
        ? buildCanvasWorkbenchDiff(
            documentContext.previousContent,
            documentContext.content,
          )
        : [],
    [documentContext],
  );

  useEffect(() => {
    setDocumentPreviewMode("preview");
  }, [documentSelectionKey]);

  const handleArtifactDocumentControllerChange = useCallback(
    (controller: ArtifactWorkbenchDocumentController | null) => {
      setArtifactDocumentController((previous) =>
        previous === controller ? previous : controller,
      );
    },
    [],
  );

  useEffect(() => {
    if (activeTab !== "session" && !isDocumentTabKey(activeTab)) {
      setArtifactDocumentController(null);
      return;
    }

    const previewTarget = activePreviewContext?.target;
    if (previewTarget?.kind !== "artifact") {
      setArtifactDocumentController(null);
    }
  }, [activePreviewContext?.target, activeTab]);

  useEffect(() => {
    setDocumentInspectorCollapsed(true);
  }, [documentSelectionKey, artifactDocumentController?.document?.artifactId]);

  const documentTabs = useMemo(
    () =>
      openDocumentTabs.map((tabKey) => {
        const context = resolveSelectionContext({
          selectionKey: parseDocumentTabKey(tabKey),
          defaultPreview,
          entryMap,
          workspaceFileSelections,
          canvasState,
          artifacts,
          workspaceRoot,
        });

        if (context) {
          return {
            key: tabKey,
            label: context.tabLabel,
            title: context.title,
            badgeLabel: context.badgeLabel,
            kindLabel: context.kindLabel,
          };
        }

        const selectionKey = parseDocumentTabKey(tabKey);
        const fallbackLabel = selectionKey.startsWith("workspace-file:")
          ? extractFileNameFromPath(
              selectionKey.replace(/^workspace-file:/, ""),
            )
          : selectionKey;
        return {
          key: tabKey,
          label: fallbackLabel,
          title: fallbackLabel,
          badgeLabel: undefined,
          kindLabel: undefined,
        };
      }),
    [
      artifacts,
      canvasState,
      defaultPreview,
      entryMap,
      openDocumentTabs,
      workspaceFileSelections,
      workspaceRoot,
    ],
  );

  const primaryTabs = useMemo<
    Array<{
      key: CanvasWorkbenchTab;
      label: string;
      badge?: string;
      badgeTone?: "slate" | "sky" | "rose";
    }>
  >(
    () => [
      {
        key: "session" as const,
        label: sessionView?.tabLabel?.trim() || "Session · Main",
        badge: sessionView?.tabBadge?.trim() || undefined,
        badgeTone: sessionView?.tabBadgeTone,
      },
      {
        key: "workspace" as const,
        label: workspaceView?.tabLabel?.trim() || "文件",
        badge:
          workspaceView?.tabBadge?.trim() ||
          (workspacePanelRootPath?.trim() &&
          directoryCache[workspacePanelRootPath]?.entries.length
            ? String(
                Math.min(
                  directoryCache[workspacePanelRootPath].entries.length,
                  99,
                ),
              )
            : undefined),
        badgeTone: workspaceView?.tabBadgeTone,
      },
      ...(teamView?.enabled
        ? [
            {
              key: "team" as const,
              label:
                teamView.tabLabel?.trim() ||
                teamView.title?.trim() ||
                "任务工作台",
              badge:
                teamView.tabBadge?.trim() ||
                teamView.triggerState?.label?.trim() ||
                undefined,
              badgeTone:
                teamView.tabBadgeTone ||
                (teamView.triggerState?.tone === "error"
                  ? ("rose" as const)
                  : teamView.triggerState?.tone === "active"
                    ? ("sky" as const)
                    : ("slate" as const)),
            },
          ]
        : []),
    ],
    [
      directoryCache,
      sessionView?.tabBadge,
      sessionView?.tabBadgeTone,
      sessionView?.tabLabel,
      teamView,
      workspacePanelRootPath,
      workspaceView?.tabBadge,
      workspaceView?.tabBadgeTone,
      workspaceView?.tabLabel,
    ],
  );

  const handleCopyPath = useCallback(async () => {
    if (!activeSelectionPath) {
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("当前环境不支持剪贴板写入");
      }
      await navigator.clipboard.writeText(activeSelectionPath);
      toast.success("已复制路径");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制路径失败");
    }
  }, [activeSelectionPath]);

  const handleDownload = useCallback(() => {
    if (!activeContent.trim()) {
      return;
    }
    const filename = extractFileNameFromPath(
      activeSelectionPath || activePreviewContext?.title || "canvas.md",
    );
    downloadText(filename, activeContent);
  }, [activeContent, activePreviewContext?.title, activeSelectionPath]);

  const renderDocumentInspector = () => {
    if (
      !isDocumentTabKey(activeTab) ||
      !artifactDocumentController?.document ||
      !documentContext
    ) {
      return null;
    }

    const documentTitle =
      artifactDocumentController.document.title?.trim() ||
      documentContext.title;
    const documentSummary =
      artifactDocumentController.document.summary?.trim() ||
      "当前结构化文稿已接入文档检查器，可继续查看概览、来源、版本与编辑状态。";
    const versionCount = artifactDocumentController.versionHistory.length || 0;
    const sourceCount = artifactDocumentController.sourceLinks.length || 0;
    const diffCount =
      artifactDocumentController.currentVersionDiff?.changedBlocks.length || 0;
    const currentVersionLabel = artifactDocumentController.currentVersion
      ? `v${artifactDocumentController.currentVersion.versionNo}`
      : null;

    return (
      <section
        className={cn(WORKBENCH_PANEL_CLASSNAME, "overflow-hidden bg-slate-50")}
      >
        <button
          type="button"
          aria-label={
            documentInspectorCollapsed
              ? "展开当前文稿检查器"
              : "折叠当前文稿检查器"
          }
          aria-expanded={!documentInspectorCollapsed}
          aria-controls="canvas-workbench-document-inspector-panel"
          onClick={() => setDocumentInspectorCollapsed((current) => !current)}
          className="flex w-full items-start justify-between gap-3 border-b border-slate-200/80 bg-white px-4 py-3 text-left transition-colors hover:bg-slate-50"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              当前文稿
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <div className="truncate text-sm font-semibold text-slate-900">
                {documentTitle}
              </div>
              {currentVersionLabel ? (
                <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                  {currentVersionLabel}
                </span>
              ) : null}
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
              {documentSummary}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
              <span>来源 {sourceCount}</span>
              <span>版本 {versionCount}</span>
              <span>差异 {diffCount}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 pt-1 text-slate-500">
            <span className="text-[11px] font-medium">
              {documentInspectorCollapsed ? "展开" : "收起"}
            </span>
            {documentInspectorCollapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0" />
            )}
          </div>
        </button>

        {documentInspectorCollapsed ? (
          <div className="px-4 py-3 text-xs leading-5 text-slate-500">
            默认先收起概览、来源、版本与编辑，避免主画布被说明区挤压；需要时再展开查看。
          </div>
        ) : (
          <ArtifactWorkbenchDocumentInspector
            controller={artifactDocumentController}
            testId="canvas-workbench-document-inspector"
            containerClassName="min-h-0 overflow-hidden bg-slate-50"
            tabsClassName="flex h-full min-h-0 flex-col p-4"
          />
        )}
      </section>
    );
  };

  const renderDirectoryNode = (path: string, depth = 0): ReactNode => {
    const listing = directoryCache[path];
    if (!listing) {
      return null;
    }

    return sortWorkspaceListingEntries(
      listing.entries,
      path,
      workspaceRoot,
    ).map((entry) => {
      const rowKey = entry.path;
      const isDirectory = entry.isDir;
      const isExpanded = Boolean(expandedDirectories[entry.path]);
      const fileSelectionKey = `workspace-file:${entry.path}`;
      const isSelected = documentSelectionKey === fileSelectionKey;

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
                : "text-slate-500 hover:bg-white hover:text-slate-900",
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
            ) : entry.name.match(
                /\.(ts|tsx|js|jsx|rs|json|yml|yaml|toml)$/i,
              ) ? (
              <FileCode2 className="h-4 w-4 shrink-0 text-sky-600" />
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-slate-500" />
            )}
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {loadingDirectories[entry.path] ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : null}
          </button>
          {isDirectory && isExpanded
            ? renderDirectoryNode(entry.path, depth + 1)
            : null}
        </div>
      );
    });
  };

  const renderHeaderActionButton = ({
    label,
    onClick,
    disabled,
    icon,
  }: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    icon: ReactNode;
  }) => (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        WORKBENCH_GHOST_BUTTON_CLASSNAME,
      )}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );

  const renderTopTab = ({
    key,
    label,
    badge,
    badgeTone,
    closable = false,
  }: {
    key: CanvasWorkbenchTab;
    label: string;
    badge?: string;
    badgeTone?: "slate" | "sky" | "rose";
    closable?: boolean;
  }) => {
    const active = activeTab === key;
    const badgeClassName =
      badgeTone === "rose"
        ? "bg-rose-50 text-rose-700"
        : badgeTone === "sky"
          ? "bg-sky-50 text-sky-700"
          : "bg-slate-100 text-slate-600";
    const leading =
      key === "session" ? (
        <span className="h-2 w-2 rounded-full bg-slate-400" />
      ) : key === "workspace" ? (
        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
      ) : key === "team" ? (
        <span className="h-2 w-2 rounded-full bg-sky-400" />
      ) : label.match(/\.(ts|tsx|js|jsx|rs|json|yml|yaml|toml)$/i) ? (
        <FileCode2 className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <FileText className="h-3.5 w-3.5 shrink-0" />
      );

    return (
      <button
        key={key}
        type="button"
        aria-label={`切换画布标签-${label}`}
        data-canvas-tab-key={key}
        onClick={() => setActiveTab(key)}
        className={cn(
          "inline-flex shrink-0 items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition-colors",
          active
            ? "border-slate-200 bg-white text-slate-950 shadow-sm shadow-slate-950/5"
            : "border-transparent bg-transparent text-slate-600 hover:border-slate-200/80 hover:bg-white hover:text-slate-900",
        )}
      >
        <span className={cn(active ? "text-slate-500" : "text-slate-400")}>
          {leading}
        </span>
        <span className="truncate">{label}</span>
        {badge ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              badgeClassName,
            )}
          >
            {badge}
          </span>
        ) : null}
        {closable && isDocumentTabKey(key) ? (
          <span
            role="button"
            aria-label={`关闭文件标签-${label}`}
            onClick={(event) => {
              event.stopPropagation();
              handleCloseDocumentTab(key);
            }}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3 w-3" />
          </span>
        ) : null}
      </button>
    );
  };

  const renderWorkspacePanel = () => {
    if (workspaceUnavailable) {
      return (
        <div data-testid="canvas-workbench-panel-workspace" className="p-5">
          <div className={WORKBENCH_MUTED_PANEL_CLASSNAME}>
            {workspaceView?.panelCopy?.unavailableText ||
              "当前工作区路径不可用，暂时无法浏览项目文件。"}
          </div>
        </div>
      );
    }

    if (!workspacePanelRootPath?.trim()) {
      return (
        <div data-testid="canvas-workbench-panel-workspace" className="p-5">
          <div className={WORKBENCH_MUTED_PANEL_CLASSNAME}>
            {workspaceView?.panelCopy?.emptyText ||
              "当前会话没有绑定可浏览的工作区目录。"}
          </div>
        </div>
      );
    }

    const rootListing = directoryCache[workspacePanelRootPath];
    const workspacePanelEyebrow =
      workspacePanelRootPath !== workspaceRoot ? "结果目录" : null;

    return (
      <section
        data-testid="canvas-workbench-panel-workspace"
        className="flex h-full min-h-0 flex-col p-5"
      >
        <div
          className={cn(
            WORKBENCH_PANEL_CLASSNAME,
            "min-h-0 flex-1 overflow-hidden",
          )}
        >
          <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
                {workspaceView?.panelCopy?.sectionEyebrow ||
                  workspacePanelEyebrow ||
                  "项目目录"}
              </div>
              <div className="mt-1 truncate text-sm font-medium text-slate-900">
                {workspacePanelDisplayPath || workspacePanelRootPath}
              </div>
            </div>
            <button
              type="button"
              aria-label="刷新工作区文件树"
              onClick={() => void refreshDirectorySubtree(workspacePanelRootPath)}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-colors",
                WORKBENCH_GHOST_BUTTON_CLASSNAME,
              )}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
            {loadingDirectories[workspacePanelRootPath] && !rootListing ? (
              <div className="flex items-center gap-2 px-2 py-4 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {workspaceView?.panelCopy?.loadingText || "正在加载目录..."}
              </div>
            ) : rootListing ? (
              renderDirectoryNode(workspacePanelRootPath)
            ) : (
              <div className="px-2 py-4 text-sm text-slate-500">
                {workspaceView?.panelCopy?.emptyDirectoryText || "暂无目录内容。"}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  };

  const renderSessionPanel = () => {
    if (sessionContext) {
      return (
        <div
          data-testid="canvas-workbench-panel-session"
          className="h-full min-h-0 p-4"
        >
          <div
            data-testid="canvas-workbench-preview-region"
            className="h-full min-h-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white"
          >
            {renderPreview(sessionContext.target)}
          </div>
        </div>
      );
    }

    if (sessionView?.renderPanel) {
      return (
        <div
          data-testid="canvas-workbench-panel-session"
          className="h-full min-h-0 overflow-auto p-5"
        >
          {sessionView.renderPanel()}
        </div>
      );
    }

    return (
      <div data-testid="canvas-workbench-panel-session" className="p-5">
        <div className={WORKBENCH_MUTED_PANEL_CLASSNAME}>
          当前没有可展示的会话主画布。
        </div>
      </div>
    );
  };

  const renderTeamPanel = () => {
    if (!teamView?.enabled || !teamTarget) {
      return (
        <div data-testid="canvas-workbench-panel-team" className="p-5">
          <div className={WORKBENCH_MUTED_PANEL_CLASSNAME}>
            {teamView?.panelCopy?.emptyText ||
              "当前没有可展示的任务工作台。"}
          </div>
        </div>
      );
    }

    return (
      <section
        data-testid="canvas-workbench-panel-team"
        className="flex h-full min-h-0 flex-col gap-4 p-4"
      >
        <div
          data-testid="canvas-workbench-preview-region"
          className="min-h-0 flex-1 overflow-hidden rounded-[24px] border border-slate-200 bg-white"
        >
          {renderPreview(teamTarget)}
        </div>
        {teamView.renderPanel ? (
          <div
            className={cn(
              WORKBENCH_PANEL_CLASSNAME,
              "min-h-0 overflow-auto p-4",
            )}
          >
            {teamView.renderPanel()}
          </div>
        ) : null}
        {teamView.renderFooter ? (
          <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
            {teamView.renderFooter()}
          </div>
        ) : null}
      </section>
    );
  };

  const renderDocumentPanel = () => {
    if (!documentContext) {
      return (
        <div data-testid="canvas-workbench-panel-document" className="p-5">
          <div className={WORKBENCH_MUTED_PANEL_CLASSNAME}>
            当前标签没有对应的可展示内容。
          </div>
        </div>
      );
    }

    const canShowDiff = documentContext.previousContent !== null;
    const showDiff = canShowDiff && documentPreviewMode === "changes";

    return (
      <section
        data-testid="canvas-workbench-panel-document"
        className="flex h-full min-h-0 flex-col gap-4 p-4"
      >
        <div className={cn(WORKBENCH_PANEL_CLASSNAME, "px-4 py-3")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                  {documentContext.kindLabel}
                </span>
                {documentContext.badgeLabel ? (
                  <Badge variant="outline">{documentContext.badgeLabel}</Badge>
                ) : null}
              </div>
              <div className="mt-2 truncate text-sm font-semibold text-slate-900">
                {documentContext.title}
              </div>
              {documentContext.subtitle ? (
                <div className="mt-1 truncate text-xs text-slate-500">
                  {documentContext.subtitle}
                </div>
              ) : documentContext.selectionPath ? (
                <div className="mt-1 truncate text-xs text-slate-500">
                  {documentContext.selectionPath}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="切换文档视图-正文"
                onClick={() => setDocumentPreviewMode("preview")}
                className={cn(
                  "rounded-xl border px-3 py-1.5 text-xs transition-colors",
                  documentPreviewMode === "preview"
                    ? WORKBENCH_ACTIVE_BUTTON_CLASSNAME
                    : WORKBENCH_BUTTON_CLASSNAME,
                )}
              >
                正文
              </button>
              {canShowDiff ? (
                <button
                  type="button"
                  aria-label="切换文档视图-变更"
                  onClick={() => setDocumentPreviewMode("changes")}
                  className={cn(
                    "rounded-xl border px-3 py-1.5 text-xs transition-colors",
                    documentPreviewMode === "changes"
                      ? WORKBENCH_ACTIVE_BUTTON_CLASSNAME
                      : WORKBENCH_BUTTON_CLASSNAME,
                  )}
                >
                  变更
                </button>
              ) : null}
            </div>
          </div>
          {canShowDiff ? (
            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
              <GitCompare className="h-3.5 w-3.5" />
              已关联上一版本，可直接在当前文件标签内切换查看 diff。
            </div>
          ) : null}
        </div>

        {renderDocumentInspector()}

        <div className="min-h-0 flex-1">
          {showDiff ? (
            renderDiffState(documentDiffLines)
          ) : (
            <div
              data-testid="canvas-workbench-preview-region"
              className="h-full min-h-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white"
            >
              {renderPreview(documentContext.target, {
                onArtifactDocumentControllerChange:
                  handleArtifactDocumentControllerChange,
              })}
            </div>
          )}
        </div>
      </section>
    );
  };

  return (
    <section
      ref={shellRef}
      data-testid="canvas-workbench-shell"
      data-layout-mode={isStackedLayout ? "stacked" : "split"}
      className={cn(
        WORKBENCH_SHELL_CLASSNAME,
        "relative flex h-full min-h-0 flex-col overflow-hidden",
      )}
    >
      <header className="border-b border-slate-200/80 bg-white px-4 py-3">
        <div
          className={cn(
            "flex items-center justify-between gap-3",
            isStackedLayout && "flex-col items-stretch",
          )}
        >
          <div className="min-w-0 flex-1 rounded-[24px] border border-slate-200 bg-slate-100 p-1.5">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {primaryTabs.map((tab) =>
                renderTopTab({
                  key: tab.key,
                  label: tab.label,
                  badge: tab.badge,
                  badgeTone: tab.badgeTone,
                }),
              )}

              {documentTabs.length > 0 ? (
                <div className="mx-1 h-6 w-px shrink-0 bg-slate-300/80" />
              ) : null}

              {documentTabs.map((tab) =>
                renderTopTab({
                  key: tab.key,
                  label: tab.label,
                  badge: tab.badgeLabel || tab.kindLabel,
                  closable: true,
                }),
              )}
            </div>
          </div>

          {activeTab !== "team" && activePreviewContext ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {renderHeaderActionButton({
                label: "复制当前路径",
                disabled: !activeSelectionPath,
                onClick: () => {
                  void handleCopyPath();
                },
                icon: <Copy className="h-4 w-4" />,
              })}
              {renderHeaderActionButton({
                label: "定位当前文件",
                disabled: !activeSelectionPath,
                onClick: () => {
                  if (activeSelectionPath) {
                    void onRevealPath(activeSelectionPath);
                  }
                },
                icon: <FolderOpen className="h-4 w-4" />,
              })}
              {renderHeaderActionButton({
                label: "系统打开当前文件",
                disabled: !activeSelectionPath,
                onClick: () => {
                  if (activeSelectionPath) {
                    void onOpenPath(activeSelectionPath);
                  }
                },
                icon: <ExternalLink className="h-4 w-4" />,
              })}
              {renderHeaderActionButton({
                label: "下载当前画布项",
                disabled: !activeContent.trim(),
                onClick: handleDownload,
                icon: <Download className="h-4 w-4" />,
              })}
            </div>
          ) : null}
        </div>
      </header>

      <div
        data-testid="canvas-workbench-layout"
        data-panel-placement="canvas"
        className="min-h-0 flex-1 overflow-hidden bg-slate-50"
      >
        {activeTab === "workspace"
          ? renderWorkspacePanel()
          : activeTab === "team"
              ? renderTeamPanel()
              : activeTab === "session"
                ? renderSessionPanel()
                : renderDocumentPanel()}
      </div>
    </section>
  );
});

export default CanvasWorkbenchLayout;
