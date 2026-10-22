import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  searchProjectFiles,
  type ProjectFileSearchResult,
} from "@/lib/api/fuzzyFileSearch";
import type { FileTreeState } from "./useFileTreeState";
import { WorkspaceDirectoryTree } from "./WorkspaceDirectoryTree";
import type { FileSelectionOptions } from "./threadSidePanelTabs";
import { FileTree } from "./FileTree";
import { createSearchFileTree, getSearchFileTreeRows } from "./fileTreeRows";

type SearchResult = {
  root: string;
  query: string;
} & (
  | { status: "loading" }
  | { status: "ready"; files: readonly ProjectFileSearchResult[] }
  | { status: "error"; message: string }
);

function SearchResultsTree({
  root,
  query,
  files,
  onSelectFile,
}: {
  root: string;
  query: string;
  files: readonly ProjectFileSearchResult[];
  onSelectFile: (path: string, options?: FileSelectionOptions) => void;
}) {
  const tree = useMemo(() => createSearchFileTree(root, files), [root, files]);
  const [expanded, setExpanded] = useState(tree.expandedDirectories);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const rows = useMemo(
    () => getSearchFileTreeRows(tree, expanded),
    [tree, expanded],
  );
  return (
    <FileTree
      scope={JSON.stringify([root, query])}
      cwd={root}
      rows={rows}
      filePaths={tree.filePaths}
      expandedDirectories={expanded}
      selectedPath={selectedPath}
      resetKey={tree}
      onToggleDirectory={(path) =>
        setExpanded((previous) => ({ ...previous, [path]: !previous[path] }))
      }
      onSelectFile={(path, options) => {
        setSelectedPath(path);
        onSelectFile(path, options);
      }}
    />
  );
}

export function WorkspaceFileTree({
  root,
  state,
  selectedPath,
  onSelectFile,
}: {
  root: string;
  state: FileTreeState;
  selectedPath: string | null;
  onSelectFile: (path: string, options?: FileSelectionOptions) => void;
}) {
  const { t } = useTranslation("agent");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  useEffect(() => {
    if (!query.trim()) {
      setResult(null);
      return;
    }
    let current = true;
    const scope = { root, query };
    setResult({ ...scope, status: "loading" });
    void searchProjectFiles({
      query,
      rootPath: root,
      cancellationToken: crypto.randomUUID(),
    }).then(
      (files) => {
        if (current) setResult({ ...scope, status: "ready", files });
      },
      (error: unknown) => {
        if (current) {
          setResult({
            ...scope,
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [query, root]);
  const visibleResult =
    result?.root === root && result.query === query ? result : null;
  const searching =
    Boolean(query.trim()) &&
    (!visibleResult || visibleResult.status === "loading");
  const searchError =
    visibleResult?.status === "error" ? visibleResult.message : null;
  const files = visibleResult?.status === "ready" ? visibleResult.files : [];
  return (
    <aside
      data-file-tree-panel
      data-testid="workspace-file-tree"
      className="flex min-h-0 min-w-0 flex-col border-l border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] text-[color:var(--lime-text)]"
    >
      <label className="m-2 flex items-center gap-2 rounded-lg border border-[color:var(--lime-surface-border)] px-2">
        <Search
          size={14}
          className="shrink-0 text-[color:var(--lime-text-muted)]"
        />
        <input
          autoFocus={!selectedPath}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("agentChat.rightSurface.files.search")}
          aria-label={t("agentChat.rightSurface.files.search")}
          className="h-8 w-full min-w-0 bg-transparent text-xs outline-none"
        />
      </label>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden px-1 pb-2"
        data-tab-preview-pin-exempt
      >
        {searching ? (
          <p role="status" className="flex items-center gap-2 p-3 text-xs">
            <Loader2 size={14} className="animate-spin" />
            {t("agentChat.canvasWorkbench.workspace.loading")}
          </p>
        ) : null}
        {searchError ? (
          <p role="alert" className="break-words p-3 text-xs">
            {searchError}
          </p>
        ) : null}
        {query.trim() ? (
          <>
            {files.length ? (
              <SearchResultsTree
                key={JSON.stringify([root, query])}
                root={root}
                query={query}
                files={files}
                onSelectFile={onSelectFile}
              />
            ) : null}
            {!searching && !files.length && !searchError ? (
              <p className="p-3 text-xs text-[color:var(--lime-text-muted)]">
                {t("agentChat.rightSurface.files.noResults")}
              </p>
            ) : null}
          </>
        ) : (
          <WorkspaceDirectoryTree
            directoryPath={root}
            state={state}
            expandedDirectories={state.expandedDirectories}
            selectedPath={selectedPath}
            onToggleDirectory={state.toggleDirectory}
            onSelectFile={onSelectFile}
          />
        )}
      </div>
    </aside>
  );
}
