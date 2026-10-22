import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Code2, Eye } from "lucide-react";
import { ArtifactPreviewHeader } from "@/components/artifact/ArtifactPreviewHeader";
import { createTextFileStorage } from "@/lib/api/textFileStorage";
import {
  startFileSystemWatch,
  type FileSystemWatchStop,
} from "@/lib/api/fileSystemWatch";
import type { ThreadSidePanelTab } from "../right-surface/threadSidePanelTabs";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import {
  FileEditorController,
  type FileEditorDraft,
} from "./FileEditorController";
import { CodeMirrorFileEditor } from "./CodeMirrorFileEditor";
import { getExternalReview } from "./fileDocument";
import {
  InlineFileDiffReview,
  type FileReviewAction,
} from "./InlineFileDiffReview";
import { useFileTabLifecycle } from "./fileTabLifecycleContext";
import { FileSourceBreadcrumb } from "./FileSourceBreadcrumb";
import type { FileTreeState } from "../right-surface/useFileTreeState";

export function TextFileEditorTabContent({
  path,
  tab,
  toolbarActions,
  initialDraft = null,
  onDraftChange,
  workspaceRoot,
  tree,
  onSelectFile,
}: {
  path: string;
  tab: ThreadSidePanelTab;
  toolbarActions?: ReactNode;
  initialDraft?: FileEditorDraft | null;
  onDraftChange?: (draft: FileEditorDraft | null) => void;
  workspaceRoot?: string | null;
  tree?: FileTreeState;
  onSelectFile?: (path: string) => void;
}) {
  const register = useFileTabLifecycle()?.register;
  const initialDraftRef = useRef(initialDraft);
  initialDraftRef.current = initialDraft;
  const [controller, setController] = useState<FileEditorController | null>(
    null,
  );
  useEffect(() => {
    let current = true;
    const instance = new FileEditorController(createTextFileStorage(path), {
      fileKind: /\.(md|markdown)$/i.test(path) ? "markdown" : "text",
      onDraftChange: (draft) => {
        if (current) onDraftChange?.(draft);
      },
    });
    setController(instance);
    const unregister = register?.(tab, {
      hasUnsavedChanges: () => {
        const state = instance.getSnapshot();
        return state.hasUnsavedChanges || state.isSaving;
      },
      saveUntilClean: instance.saveUntilClean,
      discard: instance.discard,
    });
    let stop: FileSystemWatchStop | undefined;
    void instance.load(initialDraftRef.current).then(() => {
      if (!current) return;
      void startFileSystemWatch(path, () => {
        void instance.syncExternalChange();
      })
        .then((dispose) => {
          if (current) stop = dispose;
          else void dispose().catch(() => undefined);
        })
        .catch(() => undefined);
    });
    const sync = () => {
      void instance.syncExternalChange();
    };
    window.addEventListener("focus", sync);
    return () => {
      instance.flushDraftSnapshot();
      current = false;
      unregister?.();
      window.removeEventListener("focus", sync);
      void stop?.().catch(() => undefined);
      instance.dispose();
    };
  }, [path, tab, register, onDraftChange]);
  return controller ? (
    <FileEditorContent
      controller={controller}
      path={path}
      toolbarActions={toolbarActions}
      workspaceRoot={workspaceRoot}
      tree={tree}
      onSelectFile={onSelectFile}
    />
  ) : null;
}

function FileEditorContent({
  controller,
  path,
  toolbarActions,
  workspaceRoot,
  tree,
  onSelectFile,
}: {
  controller: FileEditorController;
  path: string;
  toolbarActions?: ReactNode;
  workspaceRoot?: string | null;
  tree?: FileTreeState;
  onSelectFile?: (path: string) => void;
}) {
  const { t } = useTranslation("agent");
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const previewKind = /\.(md|markdown)$/i.test(path)
    ? "markdown"
    : /\.html?$/i.test(path)
      ? "html"
      : null;
  const [mode, setMode] = useState(previewKind ?? "code");
  const [focusRequest, setFocusRequest] = useState(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const switchTo = async () => {
    const previous = modeRef.current;
    if (
      controller.getSnapshot().hasUnsavedChanges &&
      !(await controller.saveUntilClean())
    )
      return;
    if (modeRef.current !== previous) return;
    setMode(previous === "code" ? (previewKind ?? "code") : "code");
  };
  const review = state.document
    ? getExternalReview(state.document, controller.getContent())
    : null;
  const onReviewAction = (action: FileReviewAction) => {
    controller.resolveExternalChange(action);
    if (action === "edit") {
      setMode("code");
      setFocusRequest((request) => request + 1);
    }
  };
  const filename = path.replace(/\\/g, "/").split("/").at(-1);
  return (
    <section
      data-testid="text-file-editor"
      data-file-path={path}
      data-dirty={state.hasUnsavedChanges}
      data-preview-mode={mode}
      className="flex h-full min-h-0 flex-col bg-[color:var(--lime-surface)] text-[color:var(--lime-text)]"
    >
      <FileSourceBreadcrumb
        path={path}
        workspaceRoot={workspaceRoot}
        tree={tree}
        onSelectFile={onSelectFile}
        trailingContent={
          <>
            {previewKind ? (
              <button
                type="button"
                data-testid="file-preview-mode-toggle"
                aria-label={t(
                  mode === "code"
                    ? "agentChat.filePreview.viewPreview"
                    : "agentChat.filePreview.viewSource",
                )}
                className="flex h-7 items-center gap-1 rounded-lg px-2 hover:bg-[color:var(--lime-chrome-tab-hover)]"
                onClick={() => {
                  void switchTo();
                }}
              >
                {mode === "code" ? <Eye size={14} /> : <Code2 size={14} />}
                {t(
                  mode === "code"
                    ? "agentChat.filePreview.viewPreview"
                    : "agentChat.filePreview.viewSource",
                )}
              </button>
            ) : null}
            {toolbarActions}
            <ArtifactPreviewHeader
              path={path}
              cwd={workspaceRoot}
              onBeforeFileAction={controller.saveUntilClean}
            />
          </>
        }
      />
      {state.loadState === "error" ? (
        <p role="alert" className="p-4 text-sm">
          {t("agentChat.fileEditor.loadError")}
        </p>
      ) : state.loadState === "loading" ? (
        <p className="p-4 text-sm">{t("agentChat.filePreview.loading")}</p>
      ) : (
        <>
          {state.isReadOnly ? (
            <div className="shrink-0 px-4 pt-3">
              <p className="rounded-lg border border-[color:var(--lime-surface-border)] px-3 py-2 text-sm text-[color:var(--lime-text-muted)]">
                {t("agentChat.fileEditor.readOnly")}
              </p>
            </div>
          ) : null}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              hidden={review !== null}
              {...(review !== null ? { inert: "" } : {})}
              className="h-full min-h-0"
            >
              <div
                hidden={mode !== "code"}
                className="h-full min-h-0 overflow-hidden"
              >
                <CodeMirrorFileEditor
                  controller={controller}
                  path={path}
                  label={t("agentChat.fileEditor.editorLabel", {
                    name: filename,
                  })}
                  focusRequest={focusRequest}
                />
              </div>
              {mode === "markdown" ? (
                <div
                  data-testid="file-preview-markdown"
                  className="h-full min-h-0 overflow-auto px-6 py-5"
                >
                  <MarkdownRenderer
                    content={state.content}
                    baseFilePath={path}
                  />
                </div>
              ) : null}
              {mode === "html" ? (
                <iframe
                  data-testid="file-preview-html"
                  title={filename}
                  srcDoc={state.content}
                  sandbox="allow-scripts allow-forms allow-popups allow-modals"
                  className="h-full min-h-0 w-full border-0"
                />
              ) : null}
            </div>
            {review ? (
              <div className="absolute inset-0">
                <InlineFileDiffReview
                  oldFile={{ name: path, contents: review.oldContent }}
                  newFile={{ name: path, contents: review.newContent }}
                  canEdit={!state.isReadOnly}
                  onAction={onReviewAction}
                />
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
