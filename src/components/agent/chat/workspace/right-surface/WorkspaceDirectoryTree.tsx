import { useMemo } from "react";
import type { FileTreeState } from "./useFileTreeState";
import { FileTree } from "./FileTree";
import { getDirectoryTreeRows } from "./fileTreeRows";
import type { FileSelectionOptions } from "./threadSidePanelTabs";

type DirectoryTreeState = Pick<
  FileTreeState,
  "directoryCache" | "loadingDirectories"
>;

export function WorkspaceDirectoryTree({
  directoryPath,
  state,
  expandedDirectories,
  selectedPath,
  onToggleDirectory,
  onSelectFile,
}: {
  directoryPath: string;
  state: DirectoryTreeState;
  expandedDirectories: Record<string, boolean>;
  selectedPath: string | null;
  onToggleDirectory: (path: string) => void;
  onSelectFile: (path: string, options?: FileSelectionOptions) => void;
}) {
  const filePaths = useMemo(
    () =>
      new Set(
        Object.values(state.directoryCache).flatMap((listing) =>
          listing.entries
            .filter((entry) => !entry.isDir)
            .map((entry) => entry.path),
        ),
      ),
    [state.directoryCache],
  );
  const rows = useMemo(
    () =>
      getDirectoryTreeRows(
        directoryPath,
        state.directoryCache,
        state.loadingDirectories,
        expandedDirectories,
      ),
    [directoryPath, state, expandedDirectories],
  );
  return (
    <FileTree
      scope={directoryPath}
      cwd={directoryPath}
      rows={rows}
      filePaths={filePaths}
      expandedDirectories={expandedDirectories}
      selectedPath={selectedPath}
      resetKey={state.directoryCache}
      onToggleDirectory={onToggleDirectory}
      onSelectFile={onSelectFile}
    />
  );
}
