import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Artifact } from "@/lib/artifact/types";
import { isAbsoluteLocalFilePath } from "@/lib/api/fileSystem";
import { usePublicFileAction } from "@/components/artifact/usePublicFileAction";
import type { CanvasStateUnion } from "@/components/workspace/canvas/canvasUtils";
import type { TaskFile } from "../TaskFiles";
import {
  buildEntries,
  resolveSelectionContext,
  type CanvasWorkbenchCopy,
  type CanvasWorkbenchResolvedSelection,
} from "../CanvasWorkbenchLayoutViewModel";
import {
  isFilePreviewMode,
  resolveFilePreviewModeState,
  type FilePreviewModeState,
} from "../../workspace/filePreviewModel";
import {
  resolveInitialCanvasWorkbenchTab,
  type CanvasWorkbenchDefaultPreview,
  type CanvasWorkbenchTab,
} from "./CanvasWorkbenchLayoutState";
import type { CanvasWorkbenchChangeView } from "./changes/CanvasWorkbenchChangesPanelViewModel";
import { resolveAbsoluteWorkspacePath } from "../../workspace/workspacePath";

interface UseCanvasWorkbenchDocumentStateParams {
  artifacts: Artifact[];
  canvasState: CanvasStateUnion | null;
  taskFiles: TaskFile[];
  selectedFileId?: string;
  workspaceRoot?: string | null;
  defaultPreview: CanvasWorkbenchDefaultPreview | null;
  workbenchCopy: CanvasWorkbenchCopy;
  isCodingWorkbench: boolean;
  changeView?: CanvasWorkbenchChangeView | null;
  previewRequestIdentity?: string | null;
}

interface UseCanvasWorkbenchDocumentStateResult {
  activeTab: CanvasWorkbenchTab;
  applyActiveTab: Dispatch<SetStateAction<CanvasWorkbenchTab>>;
  activePreviewContext: CanvasWorkbenchResolvedSelection | null;
  documentContext: CanvasWorkbenchResolvedSelection | null;
  documentSelectionKey: string | null;
  documentTransitionPending: boolean;
  previewModeState: FilePreviewModeState;
  fileAction: ReturnType<typeof usePublicFileAction>;
  publicFilePath: string | null;
  resolveDocumentSelection: (
    selectionKey: string,
  ) => CanvasWorkbenchResolvedSelection | null;
  applyDocumentSelection: (
    selectionKey: string,
  ) => CanvasWorkbenchResolvedSelection | null;
}

function resolvePublicFilePath(
  context: CanvasWorkbenchResolvedSelection | null,
  workspaceRoot?: string | null,
): string | null {
  const target = context?.target;
  const path = resolveAbsoluteWorkspacePath(
    workspaceRoot,
    target && target.kind !== "empty"
      ? target.absolutePath || target.filePath || context?.selectionPath
      : context?.selectionPath,
  );
  return path && isAbsoluteLocalFilePath(path) ? path : null;
}

function selectionIdentity(
  context: CanvasWorkbenchResolvedSelection | null,
  workspaceRoot?: string | null,
): string {
  return JSON.stringify([
    context?.selectionKey,
    resolvePublicFilePath(context, workspaceRoot),
  ]);
}

export function useCanvasWorkbenchDocumentState({
  artifacts,
  canvasState,
  taskFiles,
  selectedFileId,
  workspaceRoot,
  defaultPreview,
  workbenchCopy,
  isCodingWorkbench,
  changeView,
  previewRequestIdentity = null,
}: UseCanvasWorkbenchDocumentStateParams): UseCanvasWorkbenchDocumentStateResult {
  const entries = useMemo(
    () =>
      buildEntries(
        artifacts,
        canvasState,
        taskFiles,
        workbenchCopy,
        workspaceRoot,
      ),
    [artifacts, canvasState, taskFiles, workbenchCopy, workspaceRoot],
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
  const initialDocumentPath =
    defaultPreview?.filePath ||
    defaultPreview?.absolutePath ||
    defaultPreview?.title ||
    (initialDocumentSelectionKey
      ? entryMap.get(initialDocumentSelectionKey)?.filePath ||
        entryMap.get(initialDocumentSelectionKey)?.absolutePath ||
        entryMap.get(initialDocumentSelectionKey)?.title
      : null);
  const workspaceKey = workspaceRoot?.trim() || "";
  const [selection, setSelection] = useState({
    workspaceKey,
    key: initialDocumentSelectionKey,
  });
  const selectedKey =
    selection.workspaceKey === workspaceKey
      ? selection.key
      : initialDocumentSelectionKey;
  useLayoutEffect(() => {
    if (selection.workspaceKey !== workspaceKey) {
      setSelection({ workspaceKey, key: initialDocumentSelectionKey });
    }
  }, [initialDocumentSelectionKey, selection.workspaceKey, workspaceKey]);
  const [activeTab, setActiveTab] = useState<CanvasWorkbenchTab>(() => {
    return resolveInitialCanvasWorkbenchTab(
      defaultPreview,
      changeView,
      initialDocumentPath || initialDocumentSelectionKey,
      isCodingWorkbench,
    );
  });

  const isKnownSelectionKey = useCallback(
    (selectionKey: string | null) => {
      if (!selectionKey) {
        return false;
      }
      return (
        entryMap.has(selectionKey) ||
        selectionKey === defaultPreview?.selectionKey
      );
    },
    [defaultPreview?.selectionKey, entryMap],
  );

  const documentSelectionKey = useMemo(() => {
    return selectedKey || fallbackSelectionKey;
  }, [fallbackSelectionKey, selectedKey]);

  const resolveDocumentSelection = useCallback(
    (selectionKey: string | null) =>
      resolveSelectionContext({
        selectionKey,
        defaultPreview,
        entryMap,
        canvasState,
        artifacts,
        copy: workbenchCopy,
        workspaceRoot,
      }),
    [
      artifacts,
      canvasState,
      defaultPreview,
      entryMap,
      workbenchCopy,
      workspaceRoot,
    ],
  );
  const projectedContext = useMemo(
    () => resolveDocumentSelection(documentSelectionKey),
    [documentSelectionKey, resolveDocumentSelection],
  );
  const selectionResolverRef = useRef(resolveDocumentSelection);
  useLayoutEffect(() => {
    selectionResolverRef.current = resolveDocumentSelection;
  }, [resolveDocumentSelection]);
  // 只保留已显示的 canonical context 身份快照，编辑稿仍归文件 controller。
  const [acceptedSelection, setAcceptedSelection] = useState({
    workspaceKey,
    context: projectedContext,
  });
  const projectedIdentity = selectionIdentity(projectedContext, workspaceRoot);
  const acceptedIdentity = selectionIdentity(
    acceptedSelection.context,
    workspaceRoot,
  );
  const sameWorkspace = acceptedSelection.workspaceKey === workspaceKey;
  const documentContext =
    !sameWorkspace ||
    (projectedIdentity === acceptedIdentity &&
      projectedContext?.target.kind !== "loading")
      ? projectedContext
      : acceptedSelection.context;

  useLayoutEffect(() => {
    if (
      !sameWorkspace ||
      (projectedIdentity === acceptedIdentity &&
        projectedContext?.target.kind !== "loading" &&
        acceptedSelection.context !== projectedContext)
    ) {
      setAcceptedSelection({ workspaceKey, context: projectedContext });
    }
  }, [
    acceptedIdentity,
    acceptedSelection.context,
    projectedContext,
    projectedIdentity,
    sameWorkspace,
    workspaceKey,
  ]);

  const previewModeState = useMemo(
    () => resolveFilePreviewModeState(documentContext),
    [documentContext],
  );

  const activePreviewContext = isFilePreviewMode(activeTab)
    ? documentContext
    : null;
  const publicFilePath = resolvePublicFilePath(
    activePreviewContext,
    workspaceRoot,
  );
  const navigationScope = JSON.stringify([
    workspaceKey,
    activeTab,
    documentSelectionKey,
    publicFilePath,
    projectedIdentity,
    previewRequestIdentity,
  ]);
  const fileAction = usePublicFileAction(navigationScope);
  const { run: runFileAction, busy: fileActionBusy } = fileAction;

  // 原始状态事务只供已通过同一个 fileAction 的调用方使用。
  const applyDocumentSelection = useCallback(
    (selectionKey: string) => {
      const context = selectionResolverRef.current(selectionKey);
      if (context?.selectionKey !== selectionKey) return null;
      setSelection({ workspaceKey, key: selectionKey });
      setAcceptedSelection({ workspaceKey, context });
      setActiveTab(resolveFilePreviewModeState(context).defaultMode);
      return context;
    },
    [workspaceKey],
  );
  const attemptedFallbackRef = useRef<string | null>(null);
  useEffect(() => {
    // 显式打开请求优先；保存失败不由 busy 的变化触发无限重试。
    if (!sameWorkspace || previewRequestIdentity || fileActionBusy) return;
    const unknownSelection =
      selectedKey &&
      !isKnownSelectionKey(selectedKey) &&
      !/^(artifact|task|version):/.test(selectedKey);
    const nextSelectionKey = unknownSelection
      ? fallbackSelectionKey
      : documentSelectionKey;
    const canAcceptProjection =
      projectedIdentity !== acceptedIdentity &&
      projectedContext?.selectionKey === nextSelectionKey;
    const nextTab =
      isFilePreviewMode(activeTab) && !previewModeState.modes[activeTab].enabled
        ? previewModeState.defaultMode
        : activeTab;
    if (!unknownSelection && !canAcceptProjection && nextTab === activeTab) {
      attemptedFallbackRef.current = null;
      return;
    }
    const attempt = JSON.stringify([
      navigationScope,
      nextSelectionKey,
      nextTab,
    ]);
    if (attemptedFallbackRef.current === attempt) return;
    attemptedFallbackRef.current = attempt;
    void runFileAction(publicFilePath, () => {
      if (unknownSelection) {
        setSelection({ workspaceKey, key: nextSelectionKey });
      }
      if (canAcceptProjection) {
        setAcceptedSelection({ workspaceKey, context: projectedContext });
      }
      setActiveTab(nextTab);
    });
  }, [
    acceptedIdentity,
    activeTab,
    documentContext,
    documentSelectionKey,
    fallbackSelectionKey,
    fileActionBusy,
    isKnownSelectionKey,
    navigationScope,
    previewModeState,
    previewRequestIdentity,
    projectedContext,
    projectedIdentity,
    publicFilePath,
    runFileAction,
    sameWorkspace,
    selectedKey,
    workspaceKey,
  ]);

  return {
    activeTab,
    applyActiveTab: setActiveTab,
    activePreviewContext,
    documentContext,
    documentSelectionKey,
    documentTransitionPending:
      sameWorkspace && projectedIdentity !== acceptedIdentity,
    previewModeState,
    fileAction,
    publicFilePath,
    resolveDocumentSelection,
    applyDocumentSelection,
  };
}
