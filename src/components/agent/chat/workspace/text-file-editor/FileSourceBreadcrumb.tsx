import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HeaderToolbar } from "@/components/app-shell/HeaderToolbar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { FileTreeState } from "../right-surface/useFileTreeState";
import { WorkspaceDirectoryTree } from "../right-surface/WorkspaceDirectoryTree";
import { WorkspaceFileContextMenu } from "../right-surface/WorkspaceFileContextMenu";
import {
  getFilePathBreadcrumb,
  getSelectedBreadcrumbText,
  joinFileBreadcrumbPath,
  type FilePathBreadcrumbInput,
  type FilePathBreadcrumbTarget,
} from "./filePathBreadcrumb";

function DirectoryContents({
  root,
  target,
  expandActive,
  state,
  onSelectFile,
}: {
  root: string;
  target: FilePathBreadcrumbTarget;
  expandActive: boolean;
  state: FileTreeState;
  onSelectFile: (path: string) => void;
}) {
  const directoryPath = joinFileBreadcrumbPath(root, target.directoryPath);
  const activePath = joinFileBreadcrumbPath(root, target.activePath);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    expandActive && target.activePath != null ? { [activePath]: true } : {},
  );
  const { loadDirectory } = state;
  useEffect(() => {
    void loadDirectory(directoryPath);
    if (expandActive && target.activePath != null)
      void loadDirectory(activePath);
  }, [
    directoryPath,
    activePath,
    expandActive,
    target.activePath,
    loadDirectory,
  ]);
  return (
    <div className="h-full min-h-0 w-full p-1">
      <WorkspaceDirectoryTree
        directoryPath={directoryPath}
        state={state}
        expandedDirectories={expanded}
        selectedPath={activePath}
        onToggleDirectory={(path) => {
          const willExpand = !expanded[path];
          setExpanded((previous) => ({ ...previous, [path]: willExpand }));
          if (willExpand) void loadDirectory(path);
        }}
        onSelectFile={onSelectFile}
      />
    </div>
  );
}

function DirectoryBreadcrumb({
  label,
  last,
  root,
  target,
  state,
  onSelectFile,
  cwd,
}: {
  label: string;
  last: boolean;
  root: string;
  target: FilePathBreadcrumbTarget;
  state: FileTreeState;
  onSelectFile: (path: string) => void;
  cwd?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <WorkspaceFileContextMenu
        scope={JSON.stringify([root, target.activePath])}
        filePath={joinFileBreadcrumbPath(root, target.activePath)}
        cwd={cwd ?? root}
        openMode={last ? "file" : "workspace"}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "whitespace-nowrap outline-none hover:text-[color:var(--lime-text)] focus-visible:ring-2 focus-visible:ring-ring",
              last && "font-medium text-[color:var(--lime-text)]",
            )}
          >
            {label}
          </button>
        </PopoverTrigger>
      </WorkspaceFileContextMenu>
      <PopoverContent
        align="start"
        sideOffset={1}
        className="h-80 p-0"
        data-file-breadcrumb-directory
      >
        <DirectoryContents
          root={root}
          target={target}
          expandActive={!last}
          state={state}
          onSelectFile={(path) => {
            setOpen(false);
            onSelectFile(path);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function FileSourceBreadcrumb({
  path,
  cwd,
  workspaceRoot,
  tree,
  onSelectFile,
  pathActions,
  trailingContent,
}: FilePathBreadcrumbInput & {
  tree?: FileTreeState;
  onSelectFile?: (path: string) => void;
  pathActions?: ReactNode;
  trailingContent?: ReactNode;
}) {
  const { t } = useTranslation("agent");
  const { displayPath, segments, targets } = getFilePathBreadcrumb({
    path,
    cwd,
    workspaceRoot,
  });
  return (
    <HeaderToolbar
      size="pane"
      inset={false}
      className="shrink-0 border-b border-[color:var(--lime-surface-border)]"
    >
      <nav
        aria-label={t("agentChat.fileEditor.breadcrumb.ariaLabel")}
        data-file-path-breadcrumb
        className="flex h-full min-w-0 flex-1 flex-row-reverse items-center overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
      >
        <ol
          className="flex flex-1 select-text items-center gap-1 text-sm text-[color:var(--lime-text-muted)]"
          onCopy={(event) => {
            const selected = getSelectedBreadcrumbText(event.currentTarget);
            if (selected == null) return;
            event.preventDefault();
            event.clipboardData.setData(
              "text/plain",
              selected === segments.join("/") ? displayPath : selected,
            );
          }}
        >
          {segments.map((label, index) => {
            const last = index === segments.length - 1;
            const target = targets?.[index];
            return (
              <li
                key={`${index}:${label}`}
                className="flex shrink-0 items-center gap-1"
              >
                {target != null &&
                workspaceRoot != null &&
                tree != null &&
                onSelectFile != null ? (
                  <DirectoryBreadcrumb
                    label={label}
                    last={last}
                    root={workspaceRoot}
                    target={target}
                    state={tree}
                    onSelectFile={onSelectFile}
                    cwd={cwd}
                  />
                ) : (
                  <span
                    className={cn(
                      "whitespace-nowrap",
                      last && "font-medium text-[color:var(--lime-text)]",
                    )}
                  >
                    {label}
                  </span>
                )}
                {!last ? (
                  <ChevronRight size={12} className="shrink-0" aria-hidden />
                ) : null}
              </li>
            );
          })}
        </ol>
      </nav>
      {pathActions}
      {trailingContent != null ? (
        <HeaderToolbar.Actions compact className="pe-2">
          {trailingContent}
        </HeaderToolbar.Actions>
      ) : null}
    </HeaderToolbar>
  );
}
