import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  listProjectGitCommits,
  readProjectGitDiff,
  readProjectGitStatus,
  type ProjectGitCommitList,
} from "@/lib/api/projectGit";
import { resolveAbsoluteWorkspacePath } from "../../../workspace/workspacePath";
import type { HarnessFilePreviewResult } from "../../HarnessStatusPanel";
import type {
  CanvasWorkbenchChangeItem,
  CanvasWorkbenchChangeView,
} from "./CanvasWorkbenchChangesPanelViewModel";
import {
  buildCanvasWorkbenchGitApplyPatch,
  parseCanvasWorkbenchGitPatchToChangeItems,
} from "./CanvasWorkbenchChangesPanelViewModel";
import { expandCanvasWorkbenchPatchDiffLines } from "./canvasWorkbenchPatch";
import type {
  CanvasWorkbenchReviewBase,
  CanvasWorkbenchReviewCommitOption,
  CanvasWorkbenchTranslation,
} from "./CanvasWorkbenchChangesTypes";

interface CanvasWorkbenchReviewStateInput {
  changeView: CanvasWorkbenchChangeView | null | undefined;
  workspaceRoot?: string | null;
  loadFilePreview?: (path: string) => Promise<HarnessFilePreviewResult>;
  translateWorkbench: CanvasWorkbenchTranslation;
  initialBase?: CanvasWorkbenchReviewBase;
}

function buildGitApplyCommand(patch: string): string {
  return `git apply <<'PATCH'\n${patch.trimEnd()}\nPATCH\n`;
}

function resolveBackendPatchForCopy(
  selectedBase: CanvasWorkbenchReviewBase,
  backendPatch: string | null,
  fallbackPatch: string,
): string {
  return selectedBase === "previousConversation"
    ? fallbackPatch
    : backendPatch || "";
}

function projectGitCommitsToReviewOptions(
  commits: ProjectGitCommitList["commits"],
): CanvasWorkbenchReviewCommitOption[] {
  return commits.map((commit) => ({
    sha: commit.sha,
    shortSha: commit.shortSha,
    subject: commit.subject,
    committedAt: commit.committedAt,
  }));
}

export function useCanvasWorkbenchReviewState({
  changeView,
  workspaceRoot,
  loadFilePreview,
  translateWorkbench,
  initialBase = "previousConversation",
}: CanvasWorkbenchReviewStateInput) {
  const [selectedBase, setSelectedBase] =
    useState<CanvasWorkbenchReviewBase>(initialBase);
  const [busyActions, setBusyActions] = useState({
    diff: false,
    file: false,
    action: false,
  });
  const reviewActionBusy = Object.values(busyActions).some(Boolean);
  const setActionBusy = useCallback(
    (kind: keyof typeof busyActions, busy: boolean) => {
      setBusyActions((current) => ({ ...current, [kind]: busy }));
    },
    [],
  );
  const [backendPatch, setBackendPatch] = useState<string | null>(null);
  const [backendChangeItems, setBackendChangeItems] = useState<
    CanvasWorkbenchChangeItem[]
  >([]);
  const [backendHasGitRepository, setBackendHasGitRepository] = useState<
    boolean | null
  >(null);
  const [backendRepositoryRoot, setBackendRepositoryRoot] = useState<
    string | null
  >(null);
  const [gitCurrentRef, setGitCurrentRef] = useState<string | null>(null);
  const [gitComparisonBaseRef, setGitComparisonBaseRef] = useState<
    string | null
  >(null);
  const [gitUncommittedFileCount, setGitUncommittedFileCount] = useState(0);
  const [branchCompareLabel, setBranchCompareLabel] = useState<string | null>(
    null,
  );
  const [commitOptions, setCommitOptions] = useState<
    CanvasWorkbenchReviewCommitOption[]
  >([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(
    null,
  );
  const [fullFileContentById, setFullFileContentById] = useState<
    Record<string, string>
  >({});
  const [loadFullFile, setLoadFullFile] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const retryRequestRef = useRef<(() => void | Promise<unknown>) | null>(null);
  const autoLoadIdentityRef = useRef<string | null>(null);
  const ownerIdentity = `${workspaceRoot?.trim() ?? ""}\u0000${changeView?.reviewThreadId ?? ""}`;
  const ownerIdentityRef = useRef(ownerIdentity);
  ownerIdentityRef.current = ownerIdentity;
  const mountedRef = useRef(false);
  const requestVersions = useRef({ diff: 0, commits: 0, file: 0, action: 0 });
  const beginRequest = useCallback(
    (kind: "diff" | "commits" | "file" | "action") => {
      const identity = ownerIdentityRef.current;
      const version = ++requestVersions.current[kind];
      return () =>
        mountedRef.current &&
        identity === ownerIdentityRef.current &&
        version === requestVersions.current[kind];
    },
    [],
  );

  const selectedBaseUsesGit = selectedBase !== "previousConversation";

  const resetGitProjection = useCallback(() => {
    setBackendPatch(null);
    setBackendChangeItems([]);
    setBackendHasGitRepository(null);
    setBackendRepositoryRoot(null);
    setGitCurrentRef(null);
    setGitComparisonBaseRef(null);
    setGitUncommittedFileCount(0);
    setBranchCompareLabel(null);
  }, []);

  useLayoutEffect(() => {
    const versions = requestVersions.current;
    mountedRef.current = true;
    setSelectedBase(initialBase);
    setSelectedCommitSha(null);
    setCommitOptions([]);
    setCommitsLoading(false);
    setBusyActions({ diff: false, file: false, action: false });
    setRequestError(null);
    retryRequestRef.current = null;
    autoLoadIdentityRef.current = null;
    resetGitProjection();
    return () => {
      mountedRef.current = false;
      for (const kind of Object.keys(versions) as Array<
        keyof typeof versions
      >) {
        versions[kind] += 1;
      }
    };
  }, [initialBase, ownerIdentity, resetGitProjection]);

  useLayoutEffect(() => {
    requestVersions.current.file += 1;
    setFullFileContentById({});
    setLoadFullFile(false);
    setActionBusy("file", false);
  }, [
    ownerIdentity,
    changeView?.items,
    changeView?.currentTurnId,
    changeView?.turnDiff,
    setActionBusy,
  ]);

  const applyGitDiffProjection = useCallback(
    (
      diff: Awaited<ReturnType<typeof readProjectGitDiff>>,
      status: Awaited<ReturnType<typeof readProjectGitStatus>>,
      base?: CanvasWorkbenchReviewBase,
    ) => {
      setBackendPatch(diff.patch);
      setBackendHasGitRepository(
        diff.hasGitRepository && status.hasGitRepository,
      );
      setBackendRepositoryRoot(
        status.repositoryRoot ?? diff.repositoryRoot ?? null,
      );
      setGitCurrentRef(diff.currentRef ?? status.currentBranch ?? null);
      setGitComparisonBaseRef(diff.comparisonBaseRef ?? null);
      setGitUncommittedFileCount(
        status.uncommittedFileCount ?? diff.uncommittedFileCount ?? 0,
      );
      setBranchCompareLabel(
        base === "branch" && diff.currentRef && diff.comparisonBaseRef
          ? `${diff.currentRef} -> ${diff.comparisonBaseRef}`
          : null,
      );
      setBackendChangeItems(
        parseCanvasWorkbenchGitPatchToChangeItems(diff.patch),
      );
    },
    [],
  );
  const changeItems = useMemo(
    () =>
      selectedBaseUsesGit ? backendChangeItems : (changeView?.items ?? []),
    [backendChangeItems, changeView, selectedBaseUsesGit],
  );
  const fallbackPatch = useMemo(
    () =>
      changeView?.turnDiff !== undefined
        ? changeView.turnDiff
        : buildCanvasWorkbenchGitApplyPatch(changeItems),
    [changeItems, changeView?.turnDiff],
  );

  const loadGitDiffBase = useCallback(
    async (base: CanvasWorkbenchReviewBase, commitSha?: string) => {
      if (base === "previousConversation") {
        requestVersions.current.diff += 1;
        requestVersions.current.file += 1;
        resetGitProjection();
        setSelectedBase(base);
        setSelectedCommitSha(null);
        setActionBusy("diff", false);
        setActionBusy("file", false);
        setRequestError(null);
        setFullFileContentById({});
        setLoadFullFile(false);
        return true;
      }
      if (!workspaceRoot) {
        toast.error(
          translateWorkbench(
            "agentChat.canvasWorkbench.coding.changes.toast.missingWorkspaceRoot",
          ),
        );
        return false;
      }

      const isCurrent = beginRequest("diff");
      requestVersions.current.file += 1;
      setSelectedBase(base);
      setSelectedCommitSha(base === "commit" ? (commitSha ?? null) : null);
      resetGitProjection();
      setFullFileContentById({});
      setLoadFullFile(false);
      setRequestError(null);
      setActionBusy("file", false);
      setActionBusy("diff", true);
      try {
        const [diff, status] = await Promise.all([
          readProjectGitDiff(workspaceRoot, 3, base, commitSha),
          readProjectGitStatus(workspaceRoot),
        ]);
        if (!isCurrent()) return false;
        applyGitDiffProjection(diff, status, base);
        setSelectedBase(base);
        if (base !== "commit") {
          setSelectedCommitSha(null);
        }
        toast.success(
          translateWorkbench(
            "agentChat.canvasWorkbench.coding.changes.toast.refreshed",
          ),
        );
        return true;
      } catch (error) {
        if (!isCurrent()) return false;
        resetGitProjection();
        setRequestError(
          error instanceof Error
            ? error.message
            : translateWorkbench(
                "agentChat.canvasWorkbench.coding.changes.toast.refreshFailed",
              ),
        );
        retryRequestRef.current = () => loadGitDiffBase(base, commitSha);
        toast.error(
          error instanceof Error
            ? error.message
            : translateWorkbench(
                "agentChat.canvasWorkbench.coding.changes.toast.refreshFailed",
              ),
        );
        return false;
      } finally {
        if (isCurrent()) setActionBusy("diff", false);
      }
    },
    [
      applyGitDiffProjection,
      beginRequest,
      setActionBusy,
      resetGitProjection,
      translateWorkbench,
      workspaceRoot,
    ],
  );

  const loadGitCommits = useCallback(async () => {
    if (!workspaceRoot) {
      toast.error(
        translateWorkbench(
          "agentChat.canvasWorkbench.coding.changes.toast.missingWorkspaceRoot",
        ),
      );
      return false;
    }
    const isCurrent = beginRequest("commits");
    setCommitsLoading(true);
    try {
      const result = await listProjectGitCommits(workspaceRoot, 30);
      if (!isCurrent()) return false;
      setCommitOptions(projectGitCommitsToReviewOptions(result.commits));
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      setCommitOptions([]);
      toast.error(
        error instanceof Error
          ? error.message
          : translateWorkbench(
              "agentChat.canvasWorkbench.coding.changes.toast.refreshFailed",
            ),
      );
      return false;
    } finally {
      if (isCurrent()) setCommitsLoading(false);
    }
  }, [beginRequest, translateWorkbench, workspaceRoot]);

  useLayoutEffect(() => {
    if (
      initialBase === "previousConversation" ||
      !workspaceRoot ||
      autoLoadIdentityRef.current === ownerIdentity
    )
      return;
    autoLoadIdentityRef.current = ownerIdentity;
    void loadGitDiffBase(initialBase);
  }, [initialBase, loadGitDiffBase, ownerIdentity, workspaceRoot]);

  const selectBase = useCallback(
    async (base: CanvasWorkbenchReviewBase) => {
      if (base === "commit") {
        return false;
      }
      return loadGitDiffBase(base);
    },
    [loadGitDiffBase],
  );

  const openCommitMenu = useCallback(() => {
    if (commitOptions.length === 0 && !commitsLoading) {
      void loadGitCommits();
    }
  }, [commitOptions.length, commitsLoading, loadGitCommits]);

  const selectCommit = useCallback(
    (commit: CanvasWorkbenchReviewCommitOption) => {
      setSelectedCommitSha(commit.sha);
      void loadGitDiffBase("commit", commit.sha);
    },
    [loadGitDiffBase],
  );

  const refreshChanges = useCallback(async () => {
    if (selectedBase === "commit") {
      if (selectedCommitSha) {
        await loadGitDiffBase("commit", selectedCommitSha);
      } else {
        await loadGitCommits();
      }
      return;
    }
    if (selectedBaseUsesGit) {
      await loadGitDiffBase(selectedBase);
      return;
    }
    if (!workspaceRoot) {
      toast.error(
        translateWorkbench(
          "agentChat.canvasWorkbench.coding.changes.toast.missingWorkspaceRoot",
        ),
      );
      return;
    }

    const isCurrent = beginRequest("diff");
    setRequestError(null);
    setActionBusy("diff", true);
    try {
      const [diff, status] = await Promise.all([
        readProjectGitDiff(workspaceRoot, 3),
        readProjectGitStatus(workspaceRoot),
      ]);
      if (!isCurrent()) return;
      applyGitDiffProjection(diff, status, selectedBase);
      toast.success(
        translateWorkbench(
          "agentChat.canvasWorkbench.coding.changes.toast.refreshed",
        ),
      );
    } catch (error) {
      if (!isCurrent()) return;
      setRequestError(
        error instanceof Error
          ? error.message
          : translateWorkbench(
              "agentChat.canvasWorkbench.coding.changes.toast.refreshFailed",
            ),
      );
      retryRequestRef.current = refreshChanges;
      toast.error(
        error instanceof Error
          ? error.message
          : translateWorkbench(
              "agentChat.canvasWorkbench.coding.changes.toast.refreshFailed",
            ),
      );
    } finally {
      if (isCurrent()) setActionBusy("diff", false);
    }
  }, [
    loadGitDiffBase,
    beginRequest,
    setActionBusy,
    applyGitDiffProjection,
    loadGitCommits,
    selectedBase,
    selectedBaseUsesGit,
    selectedCommitSha,
    translateWorkbench,
    workspaceRoot,
  ]);

  // 提交/建分支成功后由全局 Git 流程发出；只刷新同一工作区的审阅投影。
  useEffect(() => {
    const handleGitMutation = (event: Event) => {
      const detail = (event as CustomEvent<{ rootPath?: unknown }>).detail;
      const mutatedRoot =
        typeof detail?.rootPath === "string" ? detail.rootPath.trim() : "";
      if (!mutatedRoot || !workspaceRoot) return;
      if (
        mutatedRoot.replace(/[\\/]+$/u, "") !==
        workspaceRoot.trim().replace(/[\\/]+$/u, "")
      )
        return;
      void refreshChanges();
    };
    window.addEventListener("lime:git-commit-completed", handleGitMutation);
    window.addEventListener("lime:git-branch-created", handleGitMutation);
    return () => {
      window.removeEventListener(
        "lime:git-commit-completed",
        handleGitMutation,
      );
      window.removeEventListener("lime:git-branch-created", handleGitMutation);
    };
  }, [refreshChanges, workspaceRoot]);

  const copyGitApply = useCallback(async () => {
    const patch = resolveBackendPatchForCopy(
      selectedBase,
      backendPatch,
      fallbackPatch,
    );
    if (!patch.trim()) {
      toast.error(
        translateWorkbench(
          "agentChat.canvasWorkbench.coding.changes.toast.noPatch",
        ),
      );
      return;
    }
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error(
        translateWorkbench("agentChat.canvasWorkbench.clipboard.unsupported"),
      );
      return;
    }

    const isCurrent = beginRequest("action");
    setActionBusy("action", true);
    try {
      await navigator.clipboard.writeText(buildGitApplyCommand(patch));
      if (!isCurrent()) return;
      toast.success(
        translateWorkbench(
          "agentChat.canvasWorkbench.coding.changes.toast.gitApplyCopied",
        ),
      );
    } catch (error) {
      if (!isCurrent()) return;
      toast.error(
        error instanceof Error
          ? error.message
          : translateWorkbench(
              "agentChat.canvasWorkbench.coding.changes.toast.gitApplyCopyFailed",
            ),
      );
    } finally {
      if (isCurrent()) setActionBusy("action", false);
    }
  }, [
    backendPatch,
    beginRequest,
    fallbackPatch,
    selectedBase,
    setActionBusy,
    translateWorkbench,
  ]);

  const toggleLoadFullFile = useCallback(
    async (
      selectedChangeItem: CanvasWorkbenchChangeItem | undefined,
      isSelectionCurrent: () => boolean = () => true,
    ) => {
      if (
        selectedChangeItem &&
        loadFullFile &&
        fullFileContentById[selectedChangeItem.id] != null
      ) {
        setLoadFullFile(false);
        return;
      }
      if (!selectedChangeItem || !loadFilePreview) {
        toast.error(
          translateWorkbench(
            "agentChat.canvasWorkbench.coding.changes.toast.fullFileLoadFailed",
          ),
        );
        return;
      }
      if (fullFileContentById[selectedChangeItem.id] != null) {
        setLoadFullFile(true);
        return;
      }

      const previewPath = resolveAbsoluteWorkspacePath(
        workspaceRoot,
        selectedChangeItem.destinationPath ||
          selectedChangeItem.absolutePath ||
          selectedChangeItem.path,
      );
      if (!previewPath) {
        toast.error(
          translateWorkbench(
            "agentChat.canvasWorkbench.coding.changes.toast.fullFileLoadFailed",
          ),
        );
        setLoadFullFile(false);
        return;
      }

      const isCurrentRequest = beginRequest("file");
      const isCurrent = () => isCurrentRequest() && isSelectionCurrent();
      setRequestError(null);
      setActionBusy("file", true);
      try {
        const preview = await loadFilePreview(previewPath);
        if (!isCurrent()) return;
        if (
          preview.error ||
          preview.isBinary ||
          preview.content == null ||
          (selectedChangeItem.diffLines?.length &&
            expandCanvasWorkbenchPatchDiffLines(
              selectedChangeItem.diffLines,
              preview.content,
            ) === null)
        ) {
          setRequestError(
            preview.error ||
              translateWorkbench(
                "agentChat.canvasWorkbench.coding.changes.toast.fullFileLoadFailed",
              ),
          );
          retryRequestRef.current = () =>
            toggleLoadFullFile(selectedChangeItem, isSelectionCurrent);
          toast.error(
            preview.error ||
              translateWorkbench(
                "agentChat.canvasWorkbench.coding.changes.toast.fullFileLoadFailed",
              ),
          );
          setLoadFullFile(false);
          return;
        }
        setFullFileContentById((current) => ({
          ...current,
          [selectedChangeItem.id]: preview.content || "",
        }));
        setLoadFullFile(true);
      } catch (error) {
        if (!isCurrent()) return;
        setRequestError(
          error instanceof Error
            ? error.message
            : translateWorkbench(
                "agentChat.canvasWorkbench.coding.changes.toast.fullFileLoadFailed",
              ),
        );
        retryRequestRef.current = () =>
          toggleLoadFullFile(selectedChangeItem, isSelectionCurrent);
        toast.error(
          error instanceof Error
            ? error.message
            : translateWorkbench(
                "agentChat.canvasWorkbench.coding.changes.toast.fullFileLoadFailed",
              ),
        );
        setLoadFullFile(false);
      } finally {
        if (isCurrentRequest()) setActionBusy("file", false);
      }
    },
    [
      fullFileContentById,
      beginRequest,
      setActionBusy,
      loadFilePreview,
      loadFullFile,
      translateWorkbench,
      workspaceRoot,
    ],
  );

  const invalidateFileRequest = useCallback(() => {
    requestVersions.current.file += 1;
    setActionBusy("file", false);
    setRequestError(null);
    retryRequestRef.current = null;
  }, [setActionBusy]);

  return {
    backendHasGitRepository,
    backendPatch,
    backendRepositoryRoot,
    branchCompareLabel,
    gitCurrentRef,
    gitComparisonBaseRef,
    gitUncommittedFileCount,
    changeItems,
    commitOptions,
    commitsLoading,
    copyGitApply,
    fallbackPatch,
    fullFileContentById,
    loadFullFile,
    invalidateFileRequest,
    openCommitMenu,
    refreshChanges,
    reviewActionBusy,
    requestError,
    retryRequest: () => retryRequestRef.current?.(),
    selectBase,
    selectCommit,
    selectedBase,
    selectedBaseUsesGit,
    selectedCommitSha,
    toggleLoadFullFile,
  };
}
