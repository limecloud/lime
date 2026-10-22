import {
  resolvePreviewContent,
  resolvePreviewPath,
  type FilePreviewTarget,
  type FilePreviewContext,
} from "../workspace/filePreviewTarget";
import { normalizeWorkspacePath } from "../workspace/workspacePath";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import type { Artifact } from "@/lib/artifact/types";
import type { CanvasStateUnion } from "@/components/workspace/canvas/canvasUtils";
import type { DocumentVersion } from "@/components/workspace/canvas/canvasUtils";
import {
  extractFileNameFromPath,
  resolveAbsoluteWorkspacePath,
} from "../workspace/workspacePath";
import {
  buildArtifactFromWrite,
  formatArtifactWritePhaseLabel,
  resolveArtifactPreviewText,
  resolveArtifactWritePhase,
} from "../utils/messageArtifacts";
import { resolveContentPostArtifactDisplayTitle } from "../utils/contentPostSkill";

export interface CanvasWorkbenchTaskFile {
  id: string;
  name: string;
  type: "document" | "image" | "audio" | "video" | "other";
  content?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  metadata?: Record<string, unknown>;
}

export interface CanvasWorkbenchEntryBase {
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

export interface CanvasWorkbenchArtifactEntry extends CanvasWorkbenchEntryBase {
  source: "artifact";
  artifact: Artifact;
}

export interface CanvasWorkbenchDocumentVersionEntry extends CanvasWorkbenchEntryBase {
  source: "document-version";
  version: DocumentVersion;
}

export interface CanvasWorkbenchTaskFileEntry extends CanvasWorkbenchEntryBase {
  source: "task-file";
  taskFile: CanvasWorkbenchTaskFile;
}

export type CanvasWorkbenchEntry =
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

export interface CanvasWorkbenchCopy {
  kind: {
    artifact: string;
    currentDraft: string;
    currentVersion: string;
    defaultDraft: string;
    taskDocument: string;
    taskFile: string;
    version: string;
    versionTitle: (count: number) => string;
  };
}

export interface CanvasWorkbenchSelectionContextLike {
  selectionPath?: string;
  subtitle?: string;
  title?: string;
  tabLabel?: string;
  target: FilePreviewTarget;
}

export interface CanvasWorkbenchResolvedSelection extends FilePreviewContext {
  selectionKey: string | null;
  entrySource:
    | CanvasWorkbenchEntry["source"]
    | "workspace-file"
    | "default-preview";
  tabLabel: string;
  kindLabel: string;
  badgeLabel?: string;
  previousContent: string | null;
}

function extractFileNameFromNormalizedPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.split("/").filter(Boolean).pop() || trimmed;
}

export function resolveWorkspaceRelativeDisplayPath(
  workspaceRoot: string | null | undefined,
  path: string | null | undefined,
): string | undefined {
  const normalizedPath = normalizeWorkspacePath(path?.trim() || "");
  if (!normalizedPath) {
    return undefined;
  }

  const normalizedRoot = normalizeWorkspacePath(workspaceRoot?.trim() || "");
  if (!normalizedRoot) {
    return normalizedPath;
  }

  if (normalizedPath === normalizedRoot) {
    return extractFileNameFromNormalizedPath(normalizedPath);
  }

  const prefix = `${normalizedRoot}/`;
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }

  return normalizedPath;
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
  const currentPath = normalizeWorkspacePath(
    resolveArtifactProtocolFilePath(artifact),
  );

  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const candidate = artifacts[index];
    if (candidate.id === artifact.id) {
      continue;
    }
    const candidatePath = normalizeWorkspacePath(
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
  const normalizedTarget = normalizeWorkspacePath(absolutePath);
  if (isDocumentCanvasState(canvasState)) {
    const matchedVersion = canvasState.versions.find((version) => {
      const versionPath = resolveAbsoluteWorkspacePath(
        workspaceRoot,
        version.metadata?.sourceFileName,
      );
      return versionPath
        ? normalizeWorkspacePath(versionPath) === normalizedTarget
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
      ? normalizeWorkspacePath(artifactPath) === normalizedTarget
      : false;
  });

  return matchedArtifact
    ? resolvePreviousArtifactContent(matchedArtifact, artifacts)
    : null;
}

export function buildEntries(
  artifacts: Artifact[],
  canvasState: CanvasStateUnion | null,
  taskFiles: CanvasWorkbenchTaskFile[],
  copy: CanvasWorkbenchCopy,
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
      absolutePath: resolveAbsoluteWorkspacePath(workspaceRoot, taskFile.name),
      previewText: taskFile.content?.trim().slice(0, 180),
      createdAt: taskFile.updatedAt,
      badgeLabel:
        taskFile.type === "document" ? copy.kind.taskDocument : undefined,
      kindLabel: copy.kind.taskFile,
    }));

  const taskFilePathSet = new Set(
    taskFileEntries
      .map((entry) =>
        normalizeWorkspacePath(entry.absolutePath || entry.filePath || ""),
      )
      .filter(Boolean),
  );
  const seenArtifactPaths = new Set<string>();

  const entries: CanvasWorkbenchEntry[] = artifacts
    .slice()
    .reverse()
    .flatMap((artifact) => {
      const filePath = resolveArtifactProtocolFilePath(artifact);
      const writePhase = resolveArtifactWritePhase(artifact);
      const absolutePath = resolveAbsoluteWorkspacePath(
        workspaceRoot,
        filePath,
      );
      const pathKey = normalizeWorkspacePath(absolutePath || filePath || "");
      if (pathKey) {
        if (taskFilePathSet.has(pathKey) || seenArtifactPaths.has(pathKey)) {
          return [];
        }
        seenArtifactPaths.add(pathKey);
      }

      return [
        {
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
          kindLabel: copy.kind.artifact,
        },
      ];
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
            copy.kind.versionTitle(canvasState.versions.length - index),
          subtitle: version.metadata?.sourceFileName || copy.kind.currentDraft,
          filePath: version.metadata?.sourceFileName,
          absolutePath: resolveAbsoluteWorkspacePath(
            workspaceRoot,
            version.metadata?.sourceFileName,
          ),
          previewText: version.content.trim().slice(0, 180),
          createdAt: version.createdAt,
          isCurrent: version.id === canvasState.currentVersionId,
          badgeLabel:
            version.id === canvasState.currentVersionId
              ? copy.kind.currentVersion
              : undefined,
          kindLabel: copy.kind.version,
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

export function isHtmlPreviewContext(
  context: CanvasWorkbenchSelectionContextLike | null | undefined,
): boolean {
  const path = (
    context?.selectionPath ||
    context?.subtitle ||
    context?.title ||
    ""
  )
    .trim()
    .toLowerCase();
  return /\.(html|htm)$/.test(path);
}

export function resolveCodingPreviewTabLabel(
  context: CanvasWorkbenchSelectionContextLike | null | undefined,
  fallback: string,
): string {
  const label = context?.tabLabel?.trim() || context?.title?.trim();
  return label ? `${fallback} · ${label}` : fallback;
}

export function buildDefaultPreviewSelection(
  defaultPreview: CanvasWorkbenchDefaultPreview,
  copy: CanvasWorkbenchCopy,
): CanvasWorkbenchResolvedSelection {
  const target: FilePreviewTarget = {
    kind: "text",
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
    kindLabel: copy.kind.defaultDraft,
    target,
    content: defaultPreview.content,
    previousContent: defaultPreview.previousContent || null,
    selectionPath: resolvePreviewPath(target),
  };
}

export function resolveSelectionContext({
  selectionKey,
  defaultPreview,
  entryMap,
  canvasState,
  artifacts,
  copy,
  workspaceRoot,
}: {
  selectionKey: string | null;
  defaultPreview: CanvasWorkbenchDefaultPreview | null;
  entryMap: Map<string, CanvasWorkbenchEntry>;
  canvasState: CanvasStateUnion | null;
  artifacts: Artifact[];
  copy: CanvasWorkbenchCopy;
  workspaceRoot?: string | null;
}): CanvasWorkbenchResolvedSelection | null {
  if (
    selectionKey &&
    defaultPreview &&
    selectionKey === defaultPreview.selectionKey &&
    defaultPreview.content.trim()
  ) {
    return buildDefaultPreviewSelection(defaultPreview, copy);
  }

  if (!selectionKey) {
    return defaultPreview
      ? buildDefaultPreviewSelection(defaultPreview, copy)
      : null;
  }

  const entry = entryMap.get(selectionKey) || null;
  if (!entry) {
    return defaultPreview
      ? buildDefaultPreviewSelection(defaultPreview, copy)
      : null;
  }

  let target: FilePreviewTarget;
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
