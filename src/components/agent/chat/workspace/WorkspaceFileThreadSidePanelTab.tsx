import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { FileSearch, PanelRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { readFilePreview } from "@/lib/api/fileBrowser";
import { ReviewThreadSidePanelProjectionContext } from "./ReviewThreadSidePanelProjection";
import {
  resolvePreviewContent,
  type FilePreviewContext,
} from "./filePreviewTarget";

import { useFileTreeState } from "./right-surface/useFileTreeState";
import { resolveFilePreviewTarget } from "./filePreviewTarget";
import { useFileTreeResize } from "./right-surface/useFileTreeResize";
import { FilePreviewTabContent } from "./FilePreviewTabContent";
import {
  resolveFilePreviewModeState,
  resolvePreferredFilePreviewMode,
  type FilePreviewMode,
} from "./filePreviewModel";
import { WorkspaceFileTree } from "./right-surface/WorkspaceFileTree";
import type {
  FileSelectionOptions,
  ThreadSidePanelTab,
} from "./right-surface/threadSidePanelTabs";
import { useFileTreePanel } from "./useFileTreePanel";
import { TextFileEditorTabContent } from "./text-file-editor/TextFileEditorTabContent";
import { useFileTabDrafts } from "./text-file-editor/fileTabDraftContext";
import type { FileEditorDraft } from "./text-file-editor/FileEditorController";

export function WorkspaceFileThreadSidePanelTab({
  filePath,
  tab,
  active = true,
  onSelectFile,
  projectRootPath,
}: {
  filePath: string | null;
  tab: ThreadSidePanelTab;
  active?: boolean;
  onSelectFile: (path: string, options?: FileSelectionOptions) => void;
  projectRootPath?: string | null;
}) {
  const { t } = useTranslation("agent");
  const drafts = useFileTabDrafts();
  const onDraftChange = useCallback(
    (draft: FileEditorDraft | null) => drafts?.setFileDraft(tab, draft),
    [drafts, tab],
  );
  const projection = useContext(ReviewThreadSidePanelProjectionContext);
  const root = projection?.workspaceRoot ?? projectRootPath ?? null;
  const translate = useCallback(
    (key: string, options?: Record<string, unknown>) => t(key, options ?? {}),
    [t],
  );
  const projectedLoadFilePreview = projection?.loadFilePreview;
  const loadFilePreview = useCallback(
    async (path: string) => {
      try {
        return await (projectedLoadFilePreview?.(path) ??
          readFilePreview(path, 2 * 1024 * 1024));
      } catch (error) {
        return {
          path,
          content: null,
          isBinary: false,
          size: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [projectedLoadFilePreview],
  );
  const tree = useFileTreeState({
    loadFilePreview,
    translate,
  });
  const { selectWorkspaceFile, loadDirectory } = tree;
  const selectedPath = filePath;
  const fileTree = useFileTreePanel();
  const treeOpen = fileTree.isOpen && Boolean(root);
  const setTreeOpen = fileTree.setOpen;
  const [mode, setMode] = useState<FilePreviewMode>(() =>
    resolvePreferredFilePreviewMode(filePath),
  );
  useEffect(() => {
    if (root) void loadDirectory(root);
  }, [root, loadDirectory]);
  useEffect(() => {
    if (filePath) void selectWorkspaceFile(filePath);
  }, [filePath, selectWorkspaceFile]);
  const selectionKey = selectedPath ? `workspace-file:${selectedPath}` : null;
  const file = selectionKey ? tree.workspaceFileSelections[selectionKey] : null;
  const context = useMemo<FilePreviewContext | null>(() => {
    if (!file) return null;
    const target = resolveFilePreviewTarget(file, {
      workspaceFile: {
        readFailed: t("agentChat.canvasWorkbench.workspaceFile.readFailed"),
        binaryUnsupported: t(
          "agentChat.canvasWorkbench.workspaceFile.binaryUnsupported",
        ),
      },
    });
    return {
      selectionKey,

      title: file.title,

      selectionPath: file.path,
      content: resolvePreviewContent(target),

      target,
    };
  }, [file, selectionKey, t]);
  const modeState = resolveFilePreviewModeState(context);
  const resize = useFileTreeResize(treeOpen, () => setTreeOpen(false));
  const toggle = (
    <button
      type="button"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg hover:bg-[color:var(--lime-chrome-tab-hover)]"
      aria-label={t("agentChat.rightSurface.files.toggleTree")}
      aria-pressed={treeOpen}
      disabled={fileTree.disabled}
      onClick={() => void fileTree.toggle()}
    >
      <PanelRight size={16} />
    </button>
  );
  return (
    <section
      data-testid="workspace-files-surface"
      data-file-tree-container
      className="grid h-full min-h-0 min-w-0 bg-[color:var(--lime-surface)] text-[color:var(--lime-text)]"
      style={
        resize.filesPanelGridStyle ?? {
          gridTemplateColumns: treeOpen
            ? "minmax(0,1fr) min(60%,250px)"
            : "minmax(0,1fr)",
        }
      }
    >
      <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
        {treeOpen ? (
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label={t("agentChat.filePreview.resizeFilesPanel")}
            aria-valuenow={resize.filesPanelWidth}
            className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-[color:var(--lime-brand)] focus-visible:bg-[color:var(--lime-brand)]"
            onPointerDown={resize.handleFilesPanelResizeStart}
            onPointerMove={resize.handleFilesPanelResizeMove}
            onPointerUp={resize.handleFilesPanelResizeEnd}
            onPointerCancel={resize.handleFilesPanelResizeEnd}
            onLostPointerCapture={resize.handleFilesPanelResizeEnd}
            onKeyDown={resize.handleFilesPanelResizeKeyDown}
            onDoubleClick={resize.resetFilesPanelWidth}
          />
        ) : null}
        {filePath && file && context?.target.kind === "text" ? (
          <TextFileEditorTabContent
            key={filePath}
            path={filePath}
            tab={tab}
            toolbarActions={toggle}
            workspaceRoot={root}
            tree={tree}
            onSelectFile={onSelectFile}
            initialDraft={drafts?.getFileDraft(tab) ?? null}
            onDraftChange={onDraftChange}
          />
        ) : context ? (
          <FilePreviewTabContent
            tab={tab}
            active={active}
            context={context}
            mode={modeState.modes[mode]?.enabled ? mode : modeState.defaultMode}
            modeState={modeState}
            onSelectMode={setMode}
            translate={translate}
            toolbarActions={toggle}
          />
        ) : (
          <>
            <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[color:var(--lime-surface-border)] px-3 text-xs">
              <span>{t("agentChat.rightSurface.files.openFile")}</span>
              {toggle}
            </div>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <FileSearch
                size={24}
                className="text-[color:var(--lime-text-muted)]"
              />
              <button
                type="button"
                disabled={fileTree.disabled || !root}
                onClick={() => void setTreeOpen(true)}
                className="rounded-lg border border-[color:var(--lime-surface-border)] px-3 py-1.5 text-sm font-medium hover:bg-[color:var(--lime-chrome-tab-hover)] disabled:opacity-50"
              >
                {t("agentChat.rightSurface.files.openFile")}
              </button>
              <p className="text-xs text-[color:var(--lime-text-muted)]">
                {t(
                  root
                    ? "agentChat.rightSurface.files.selectFile"
                    : "agentChat.canvasWorkbench.workspace.unavailable",
                )}
              </p>
            </div>
          </>
        )}
      </div>
      {treeOpen && root ? (
        <WorkspaceFileTree
          root={root}
          state={tree}
          selectedPath={selectedPath}
          onSelectFile={(path, options) =>
            onSelectFile(path, {
              isPreview: Boolean(filePath) && options?.isPreview,
            })
          }
        />
      ) : null}
    </section>
  );
}
