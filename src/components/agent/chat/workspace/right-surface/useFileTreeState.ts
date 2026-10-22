import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { listDirectory, type DirectoryListing } from "@/lib/api/fileBrowser";
import type { HarnessFilePreviewResult } from "../../components/HarnessStatusPanel";
import { normalizeWorkspacePath } from "../workspacePath";
import { type WorkspaceFileSelection } from "../filePreviewTarget";

import { extractFileNameFromPath } from "../workspacePath";

type FileTreeTranslation = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export interface FileTreeState {
  directoryCache: Record<string, DirectoryListing>;
  expandedDirectories: Record<string, boolean>;
  loadingDirectories: Record<string, boolean>;
  workspaceFileSelections: Record<string, WorkspaceFileSelection>;
  loadDirectory: (path: string) => Promise<void>;
  refreshDirectorySubtree: (rootPath: string) => Promise<void>;
  toggleDirectory: (path: string) => void;
  selectWorkspaceFile: (path: string) => Promise<string>;
}

export function useFileTreeState({
  loadFilePreview,
  translate,
}: {
  loadFilePreview: (path: string) => Promise<HarnessFilePreviewResult>;
  translate: FileTreeTranslation;
}): FileTreeState {
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
  const directoryRequests = useRef(new Map<string, Promise<void>>());

  const loadDirectory = useCallback(
    (path: string): Promise<void> => {
      if (!path.trim()) {
        return Promise.resolve();
      }
      const pending = directoryRequests.current.get(path);
      if (pending) return pending;
      const request = (async () => {
        setLoadingDirectories((previous) => ({ ...previous, [path]: true }));
        try {
          const listing = await listDirectory(path);
          setDirectoryCache((previous) => ({ ...previous, [path]: listing }));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          setDirectoryCache((previous) => ({
            ...previous,
            [path]: { path, parentPath: null, entries: [], error: message },
          }));
          toast.error(
            translate("agentChat.canvasWorkbench.workspace.loadFailed", {
              message,
            }),
          );
        } finally {
          directoryRequests.current.delete(path);
          setLoadingDirectories((previous) => ({ ...previous, [path]: false }));
        }
      })();
      directoryRequests.current.set(path, request);
      return request;
    },
    [translate],
  );

  const toggleDirectory = useCallback(
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
      const normalizedRootPath = normalizeWorkspacePath(rootPath.trim());
      if (!normalizedRootPath) {
        return;
      }

      const expandedDescendants = Object.entries(expandedDirectories)
        .filter(
          ([path, expanded]) =>
            expanded &&
            normalizeWorkspacePath(path).startsWith(`${normalizedRootPath}/`),
        )
        .map(([path]) => path);

      await Promise.all([
        loadDirectory(rootPath),
        ...expandedDescendants.map((path) => loadDirectory(path)),
      ]);
    },
    [expandedDirectories, loadDirectory],
  );

  const selectWorkspaceFile = useCallback(
    async (path: string) => {
      const title = extractFileNameFromPath(path);
      const selectionKey = `workspace-file:${path}`;
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

      return selectionKey;
    },
    [loadFilePreview],
  );

  return {
    directoryCache,
    expandedDirectories,
    loadingDirectories,
    workspaceFileSelections,
    loadDirectory,
    refreshDirectorySubtree,
    toggleDirectory,
    selectWorkspaceFile,
  };
}
