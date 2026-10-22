import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { readFileBytes } from "@/lib/api/fileBrowser";
import { downloadBlob } from "@/lib/artifact/downloadBlob";
import type { Artifact } from "@/lib/artifact/types";
import type { CanvasStateUnion } from "@/components/workspace/canvas/canvasUtils";
import type { TaskFile } from "./TaskFiles";
import type { HarnessFilePreviewResult } from "./HarnessStatusPanel";
import { buildCanvasWorkbenchDiff } from "../utils/canvasWorkbenchDiff";
import { extractFileNameFromPath } from "../workspace/workspacePath";
import { useFileTreePanel } from "../workspace/useFileTreePanel";
import { type CanvasWorkbenchCopy } from "./CanvasWorkbenchLayoutViewModel";
import { type FilePreviewTarget } from "../workspace/filePreviewTarget";

import {
  CanvasWorkbenchShell,
  type CanvasWorkbenchChangeView,
} from "./canvas-workbench";
import {
  isFilePreviewMode,
  resolveFilePreviewModeState,
} from "../workspace/filePreviewModel";

import {
  WORKBENCH_GHOST_BUTTON_CLASSNAME,
  WORKBENCH_MUTED_PANEL_CLASSNAME,
  WORKBENCH_PANEL_CLASSNAME,
  WORKBENCH_SHELL_CLASSNAME,
  translateCanvasWorkbenchText,
  type CanvasWorkbenchDefaultPreview,
  type CanvasWorkbenchLayoutMode,
  type CanvasWorkbenchMode,
  type CanvasWorkbenchTab,
  type CanvasWorkbenchTranslation,
} from "./canvas-workbench/CanvasWorkbenchLayoutState";
import { useCanvasWorkbenchDocumentState } from "./canvas-workbench/useCanvasWorkbenchDocumentState";
import type { CanvasWorkbenchTopTab } from "./canvas-workbench/tabs/CanvasWorkbenchTopTabs";

export type {
  CanvasWorkbenchDefaultPreview,
  CanvasWorkbenchLayoutMode,
  CanvasWorkbenchMode,
  CanvasWorkbenchTab,
};

export interface CanvasWorkbenchPreviewOpenRequest {
  requestKey: string | number;
  selectionKey?: string | null;
  filePath?: string | null;
}

function getPreviewTargetPath(
  target: FilePreviewTarget | null | undefined,
  key: "filePath" | "absolutePath",
): string | undefined {
  if (!target || target.kind === "empty") {
    return undefined;
  }
  return key === "filePath" ? target.filePath : target.absolutePath;
}

export interface CanvasWorkbenchLayoutProps {
  artifacts: Artifact[];
  canvasState: CanvasStateUnion | null;
  taskFiles: TaskFile[];
  selectedFileId?: string;
  workspaceRoot?: string | null;
  defaultPreview: CanvasWorkbenchDefaultPreview | null;
  loadFilePreview: (path: string) => Promise<HarnessFilePreviewResult>;
  onOpenPath: (path: string) => Promise<void>;
  onRevealPath: (path: string) => Promise<void>;
  onClose?: () => void;
  onBeforeLeaveChange?: (guard: (() => Promise<boolean>) | null) => void;
  onLayoutModeChange?: (mode: CanvasWorkbenchLayoutMode) => void;
  workbenchMode?: CanvasWorkbenchMode;
  changeView?: CanvasWorkbenchChangeView | null;
  topRightTools?: ReactNode;
  previewOpenRequest?: CanvasWorkbenchPreviewOpenRequest | null;
  onPreviewOpenRequestHandled?: (requestKey: string | number) => void;
}

const STACKED_LAYOUT_BREAKPOINT = 1040;

function normalizePreviewOnlyPath(path: string | null | undefined): string {
  return path?.replace(/\\/g, "/").trim() || "";
}

function doesPreviewOnlyPathMatch(
  requestedPath: string | null | undefined,
  candidatePath: string | null | undefined,
): boolean {
  const requested = normalizePreviewOnlyPath(requestedPath);
  const candidate = normalizePreviewOnlyPath(candidatePath);
  if (!requested || !candidate) {
    return false;
  }
  return (
    requested === candidate ||
    requested.endsWith(`/${candidate}`) ||
    candidate.endsWith(`/${requested}`)
  );
}

export const CanvasWorkbenchLayout = memo(function CanvasWorkbenchLayout({
  artifacts,
  canvasState,
  taskFiles,
  selectedFileId,
  workspaceRoot,
  defaultPreview,
  loadFilePreview,
  onOpenPath,
  onRevealPath,
  onClose,
  onBeforeLeaveChange,
  onLayoutModeChange,
  workbenchMode = "default",
  changeView = null,
  topRightTools = null,
  previewOpenRequest = null,
  onPreviewOpenRequestHandled,
}: CanvasWorkbenchLayoutProps) {
  const { t } = useTranslation("agent");
  const canvasT = t as unknown as CanvasWorkbenchTranslation;
  const [shellNodeVersion, setShellNodeVersion] = useState(0);
  const canvasTRef = useRef(canvasT);
  canvasTRef.current = canvasT;
  const handleShellRef = useCallback((node: HTMLElement | null) => {
    shellRef.current = node;
    if (node) {
      setShellNodeVersion((version) => version + 1);
    }
  }, []);
  const translateWorkbench = useCallback(
    (key: string, options?: Record<string, unknown>) =>
      translateCanvasWorkbenchText(canvasTRef.current, key, options),
    [],
  );
  const workbenchCopy = useMemo<CanvasWorkbenchCopy>(
    () => ({
      kind: {
        artifact: translateWorkbench("agentChat.canvasWorkbench.kind.artifact"),
        currentDraft: translateWorkbench(
          "agentChat.canvasWorkbench.kind.currentDraft",
        ),
        currentVersion: translateWorkbench(
          "agentChat.canvasWorkbench.kind.currentVersion",
        ),
        defaultDraft: translateWorkbench(
          "agentChat.canvasWorkbench.kind.defaultDraft",
        ),
        taskDocument: translateWorkbench(
          "agentChat.canvasWorkbench.kind.taskDocument",
        ),
        taskFile: translateWorkbench("agentChat.canvasWorkbench.kind.taskFile"),
        version: translateWorkbench("agentChat.canvasWorkbench.kind.version"),
        versionTitle: (count: number) =>
          translateWorkbench("agentChat.canvasWorkbench.kind.versionTitle", {
            count,
          }),
      },
    }),
    [translateWorkbench],
  );
  const isCodingWorkbench = workbenchMode === "coding";
  const shellRef = useRef<HTMLElement | null>(null);
  const [isStackedLayout, setIsStackedLayout] = useState(false);
  const previewRequestIdentity = previewOpenRequest
    ? JSON.stringify([
        previewOpenRequest.requestKey,
        previewOpenRequest.selectionKey,
        previewOpenRequest.filePath,
      ])
    : null;
  const {
    activeTab,
    applyActiveTab,
    activePreviewContext,
    documentContext,
    documentSelectionKey,
    documentTransitionPending,
    previewModeState,
    fileAction,
    publicFilePath: sourcePath,
    resolveDocumentSelection,
    applyDocumentSelection,
  } = useCanvasWorkbenchDocumentState({
    artifacts,
    canvasState,
    taskFiles,
    selectedFileId,
    workspaceRoot,
    defaultPreview,
    workbenchCopy,
    isCodingWorkbench,
    changeView,
    previewRequestIdentity,
  });
  const { run: runFileAction, busy: fileActionBusy } = fileAction;
  const fileTree = useFileTreePanel();
  const [previewOnlyFilePath, setPreviewOnlyFilePath] = useState<string | null>(
    null,
  );
  const handledPreviewOpenRequestRef = useRef<string | null>(null);
  const previewOpenAttemptRef = useRef<{
    identity: string;
    launched: boolean;
  } | null>(null);
  const hasAutoFocusedInitialDocumentTabRef = useRef(
    Boolean(documentSelectionKey),
  );

  const beforeLeaveActionRef = useRef(() =>
    runFileAction(sourcePath, () => {}),
  );
  useLayoutEffect(() => {
    beforeLeaveActionRef.current = () => runFileAction(sourcePath, () => {});
  }, [runFileAction, sourcePath]);
  useLayoutEffect(() => {
    if (!onBeforeLeaveChange) return;
    onBeforeLeaveChange(() => beforeLeaveActionRef.current());
    return () => onBeforeLeaveChange(null);
  }, [onBeforeLeaveChange]);

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
  }, [shellNodeVersion]);

  useEffect(() => {
    onLayoutModeChange?.(isStackedLayout ? "stacked" : "split");
  }, [isStackedLayout, onLayoutModeChange]);

  useEffect(() => {
    const node = shellRef.current;
    if (!node) {
      return;
    }

    node.dataset.documentSelectionKey = documentSelectionKey || "";
    node.dataset.documentContextKey = documentContext?.selectionKey || "";
    node.dataset.previewRequestKey = String(
      previewOpenRequest?.requestKey ?? "",
    );
    node.dataset.previewRequestSelectionKey =
      previewOpenRequest?.selectionKey || "";
    node.dataset.artifactSelectionKeys = artifacts
      .map((artifact) => `artifact:${artifact.id}`)
      .join(",");
  }, [
    artifacts,
    documentContext?.selectionKey,
    documentSelectionKey,
    previewOpenRequest?.requestKey,
    previewOpenRequest?.selectionKey,
  ]);

  const activeSelectionPath = activePreviewContext?.selectionPath;
  const activeContent = activePreviewContext?.content || "";
  const closeWorkbenchLabel = translateCanvasWorkbenchText(
    canvasT,
    "agentChat.canvasWorkbench.close",
  );
  const headerActionsVisible = Boolean(
    activePreviewContext && (activeSelectionPath || activeContent.trim()),
  );

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
  const activeDocumentPaths = useMemo(
    () => [
      documentContext?.selectionPath,
      documentContext?.subtitle,
      getPreviewTargetPath(documentContext?.target, "filePath"),
      getPreviewTargetPath(documentContext?.target, "absolutePath"),
      documentContext?.title,
    ],
    [
      documentContext?.selectionPath,
      documentContext?.subtitle,
      documentContext?.target,
      documentContext?.title,
    ],
  );
  const isPreviewOnlyFileOpen = Boolean(
    previewOnlyFilePath &&
    activeDocumentPaths.some((candidatePath) =>
      doesPreviewOnlyPathMatch(previewOnlyFilePath, candidatePath),
    ),
  );
  const hasReviewSurface =
    isCodingWorkbench || Boolean(changeView) || documentDiffLines.length > 0;
  const resolvedChangeView = useMemo<CanvasWorkbenchChangeView | null>(() => {
    if (changeView) {
      return changeView;
    }
    if (!hasReviewSurface) {
      return null;
    }
    if (documentDiffLines.length > 0) {
      return null;
    }
    return {
      items: [],
      checkpointCount: 0,
      latestCheckpointPath: null,
    };
  }, [changeView, documentDiffLines.length, hasReviewSurface]);
  const changeItems = useMemo(() => changeView?.items ?? [], [changeView]);
  const changeItemCount = changeItems.length;
  const failedChangeItemCount = useMemo(
    () => changeItems.filter((item) => item.status === "failed").length,
    [changeItems],
  );

  const hasAutoFocusedCodingReviewRef = useRef(
    (changeView?.items?.length || 0) > 0 ||
      Boolean(defaultPreview?.previousContent),
  );

  useEffect(() => {
    if (previewOpenRequest && previewRequestIdentity) {
      const identity = JSON.stringify([workspaceRoot, previewRequestIdentity]);
      if (previewOpenAttemptRef.current?.identity !== identity) {
        previewOpenAttemptRef.current = { identity, launched: false };
      }
      if (
        fileActionBusy ||
        handledPreviewOpenRequestRef.current === identity ||
        previewOpenAttemptRef.current.launched
      ) {
        return;
      }
      const selectionKey =
        previewOpenRequest.selectionKey?.trim() ||
        defaultPreview?.selectionKey ||
        documentSelectionKey;
      const target = selectionKey
        ? resolveDocumentSelection(selectionKey)
        : documentContext;
      if (selectionKey && target?.selectionKey !== selectionKey) return;
      if (target?.target.kind === "loading") return;
      previewOpenAttemptRef.current.launched = true;
      void runFileAction(sourcePath, () => {
        const nextContext = selectionKey
          ? applyDocumentSelection(selectionKey)
          : target;
        if (selectionKey && !nextContext) {
          previewOpenAttemptRef.current!.launched = false;
          return;
        }
        applyActiveTab(resolveFilePreviewModeState(nextContext).defaultMode);
        setPreviewOnlyFilePath(previewOpenRequest.filePath?.trim() || null);
        handledPreviewOpenRequestRef.current = identity;
        onPreviewOpenRequestHandled?.(previewOpenRequest.requestKey);
      });
      return;
    }
    previewOpenAttemptRef.current = null;
    if (
      fileActionBusy ||
      documentTransitionPending ||
      (isFilePreviewMode(activeTab) &&
        !previewModeState.modes[activeTab].enabled)
    )
      return;
    if (
      !hasAutoFocusedInitialDocumentTabRef.current &&
      documentSelectionKey &&
      documentContext?.selectionKey === documentSelectionKey
    ) {
      hasAutoFocusedInitialDocumentTabRef.current = true;
      void runFileAction(sourcePath, () =>
        applyActiveTab(previewModeState.defaultMode),
      );
      return;
    }
    if (
      hasReviewSurface &&
      !isPreviewOnlyFileOpen &&
      !hasAutoFocusedCodingReviewRef.current &&
      (changeItemCount > 0 || documentDiffLines.length > 0)
    ) {
      hasAutoFocusedCodingReviewRef.current = true;
      void runFileAction(sourcePath, () => applyActiveTab("changes"));
    }
  }, [
    activeTab,
    applyActiveTab,
    applyDocumentSelection,
    changeItemCount,
    defaultPreview?.selectionKey,
    documentContext,
    documentDiffLines.length,
    documentSelectionKey,
    documentTransitionPending,
    fileActionBusy,
    hasReviewSurface,
    isPreviewOnlyFileOpen,
    onPreviewOpenRequestHandled,
    previewModeState,
    previewOpenRequest,
    previewRequestIdentity,
    resolveDocumentSelection,
    runFileAction,
    sourcePath,
    workspaceRoot,
  ]);

  const basePrimaryTabs = useMemo<CanvasWorkbenchTopTab[]>(
    () => [
      {
        key: "changes",
        label: translateCanvasWorkbenchText(
          canvasT,
          "agentChat.canvasWorkbench.coding.tabs.changes",
        ),
        badge:
          changeItemCount > 0
            ? changeItemCount > 99
              ? "99+"
              : String(changeItemCount)
            : documentDiffLines.length > 0
              ? String(documentDiffLines.length)
              : undefined,
        badgeTone:
          failedChangeItemCount > 0
            ? "rose"
            : changeItemCount > 0 || documentDiffLines.length > 0
              ? "sky"
              : "slate",
      },
    ],
    [changeItemCount, documentDiffLines.length, failedChangeItemCount, canvasT],
  );
  const primaryTabs = useMemo(() => {
    if (!documentContext) {
      return basePrimaryTabs;
    }

    return [
      {
        key: previewModeState.defaultMode,
        label: documentContext.tabLabel || documentContext.title,
      },
      ...basePrimaryTabs,
    ];
  }, [basePrimaryTabs, documentContext, previewModeState.defaultMode]);

  const handleCopyPath = useCallback(async () => {
    if (!activeSelectionPath) {
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error(
          translateWorkbench("agentChat.canvasWorkbench.clipboard.unsupported"),
        );
      }
      await navigator.clipboard.writeText(activeSelectionPath);
      toast.success(
        translateWorkbench("agentChat.canvasWorkbench.clipboard.copied"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translateWorkbench(
              "agentChat.canvasWorkbench.clipboard.copyFailed",
            ),
      );
    }
  }, [activeSelectionPath, translateWorkbench]);

  const handleDownload = useCallback(() => {
    if (!sourcePath && !activeContent.trim()) {
      return;
    }
    const filename = extractFileNameFromPath(
      activeSelectionPath || activePreviewContext?.title || "canvas.md",
    );
    void runFileAction(sourcePath, async (isCurrent) => {
      const content = sourcePath
        ? Uint8Array.from(await readFileBytes(sourcePath)).buffer
        : activeContent;
      if (isCurrent())
        downloadBlob(
          new Blob([content], {
            type: sourcePath
              ? "application/octet-stream"
              : "text/plain;charset=utf-8",
          }),
          filename,
        );
    });
  }, [
    activeContent,
    activePreviewContext?.title,
    activeSelectionPath,
    sourcePath,
    runFileAction,
  ]);

  const handleSelectTab = useCallback(
    (tab: CanvasWorkbenchTab) => {
      if (tab === activeTab) return;
      void runFileAction(sourcePath, () => applyActiveTab(tab));
    },
    [activeTab, applyActiveTab, runFileAction, sourcePath],
  );
  const handleClose = useCallback(() => {
    // 外层注册后统一在外层 await guard，避免同一锁被嵌套获取。
    if (onBeforeLeaveChange) {
      onClose?.();
      return;
    }
    void runFileAction(sourcePath, () => onClose?.());
  }, [onBeforeLeaveChange, onClose, runFileAction, sourcePath]);

  const topActiveTab: CanvasWorkbenchTab =
    documentContext && activeTab === "code"
      ? previewModeState.defaultMode
      : primaryTabs.some((tab) => tab.key === activeTab) ||
          (activeTab === "changes" && hasReviewSurface)
        ? activeTab
        : hasReviewSurface
          ? "changes"
          : primaryTabs[0]?.key || activeTab;

  return (
    <CanvasWorkbenchShell
      shellRef={handleShellRef}
      layoutMode={isStackedLayout ? "stacked" : "split"}
      activeTab={topActiveTab}
      contentTab={activeTab}
      tabs={primaryTabs}
      topRightTools={topRightTools}
      detailHeaderVisible={activeTab !== "changes"}
      translateWorkbench={translateWorkbench}
      onSelectTab={handleSelectTab}
      onClose={onClose ? handleClose : undefined}
      closeWorkbenchLabel={closeWorkbenchLabel}
      headerActionsVisible={headerActionsVisible}
      activeSelectionPath={activeSelectionPath}
      activeContent={activeContent}
      downloadEnabled={Boolean(sourcePath || activeContent.trim())}
      fileActionBusy={fileActionBusy}
      onCopyPath={() => {
        void handleCopyPath();
      }}
      onOpenPath={(path) => {
        void runFileAction(sourcePath, () => onOpenPath(sourcePath || path));
      }}
      onRevealPath={(path) => {
        void onRevealPath(path);
      }}
      onDownload={handleDownload}
      documentContext={documentContext}
      documentDiffLines={documentDiffLines}
      previewModeState={previewModeState}
      changeView={resolvedChangeView}
      changesFilesPanelOpen={fileTree.isOpen}
      loadFilePreview={loadFilePreview}
      workspaceRoot={workspaceRoot}
      shellClassName={WORKBENCH_SHELL_CLASSNAME}
      panelClassName={WORKBENCH_PANEL_CLASSNAME}
      mutedPanelClassName={WORKBENCH_MUTED_PANEL_CLASSNAME}
      ghostButtonClassName={WORKBENCH_GHOST_BUTTON_CLASSNAME}
      onSelectPreviewMode={handleSelectTab}
      onToggleChangesFilesPanel={
        fileTree.disabled ? undefined : () => void fileTree.toggle()
      }
    />
  );
});
