import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { requestChatHostOpenPath } from "@/components/agent/chat/host/chatHostCapabilities";
import {
  ensureProjectWorkspace,
  extractErrorMessage,
  getWorkspaceProjectsRoot,
  resolveProjectRootPath,
} from "@/lib/api/project";
import {
  checkoutProjectGitBranch,
  createProjectGitBranch,
  readProjectGitStatus,
  type ProjectGitStatus,
} from "@/lib/api/projectGit";
import { markProjectOpened } from "../../../hooks/agentProjectStorage";
import type {
  ComposerProject,
  ComposerUtilityBarCopy,
} from "./composerUtilityBarTypes";

type UtilityMutation = "blank" | "folder" | "checkout" | "createBranch";
type GitReadState = "unavailable" | "loading" | "ready" | "error";

interface ComposerUtilityActionsParams {
  rootPath: string;
  showModeControls: boolean;
  copy: ComposerUtilityBarCopy;
  onProjectChange?: (projectId: string | null) => void;
  onProjectOpenChange: (open: boolean) => void;
  onBranchOpenChange: (open: boolean) => void;
  onBranchSearchChange: (query: string) => void;
}

function directoryName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop()?.trim() || path.trim();
}

// The caller keys each mounted workspace by project ID and root path.
export function useComposerUtilityActions({
  rootPath,
  showModeControls,
  copy,
  onProjectChange,
  onProjectOpenChange,
  onBranchOpenChange,
  onBranchSearchChange,
}: ComposerUtilityActionsParams) {
  const activeRef = useRef(false);
  const requestRef = useRef<object | null>(null);
  const [mutation, setMutation] = useState<UtilityMutation | null>(null);
  const [gitStatus, setGitStatus] = useState<ProjectGitStatus | null>(null);
  const [gitReadState, setGitReadState] = useState<GitReadState>(
    showModeControls && rootPath ? "loading" : "unavailable",
  );
  const [readRevision, setReadRevision] = useState(0);

  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      requestRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!showModeControls || !rootPath) {
      setGitStatus(null);
      setGitReadState("unavailable");
      return;
    }
    let cancelled = false;
    setGitStatus(null);
    setGitReadState("loading");
    void readProjectGitStatus(rootPath)
      .then((status) => {
        if (!cancelled && activeRef.current) {
          setGitStatus(status);
          setGitReadState("ready");
        }
      })
      .catch(() => {
        if (!cancelled && activeRef.current) {
          setGitStatus(null);
          setGitReadState("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, showModeControls, readRevision]);

  useEffect(() => {
    const handleBranchCreated = (event: Event) => {
      const detail = (event as CustomEvent<{ rootPath?: unknown }>).detail;
      const createdRoot =
        typeof detail?.rootPath === "string" ? detail.rootPath.trim() : "";
      if (!createdRoot || !rootPath) return;
      if (
        createdRoot.replace(/[\\/]+$/u, "") !==
        rootPath.trim().replace(/[\\/]+$/u, "")
      )
        return;
      setReadRevision((revision) => revision + 1);
    };
    window.addEventListener("lime:git-branch-created", handleBranchCreated);
    return () =>
      window.removeEventListener(
        "lime:git-branch-created",
        handleBranchCreated,
      );
  }, [rootPath]);

  const selectProject = (project: ComposerProject | null) => {
    if (!activeRef.current) {
      return;
    }
    if (project) {
      markProjectOpened(project.id);
    }
    onProjectChange?.(project?.id ?? null);
    onProjectOpenChange(false);
  };

  const runMutation = async (
    action: UtilityMutation,
    errorLabel: string,
    operation: (isCurrent: () => boolean) => Promise<void>,
  ) => {
    if (!activeRef.current || requestRef.current) {
      return;
    }
    const request = {};
    requestRef.current = request;
    setMutation(action);
    const isCurrent = () => activeRef.current && requestRef.current === request;
    try {
      await operation(isCurrent);
    } catch (error) {
      if (isCurrent()) {
        toast.error(`${errorLabel}: ${extractErrorMessage(error)}`);
      }
    } finally {
      if (isCurrent()) {
        requestRef.current = null;
        setMutation(null);
      }
    }
  };

  const createBlankProject = () =>
    runMutation("blank", copy.projectCreateFailed, async (isCurrent) => {
      const projectsRoot = await getWorkspaceProjectsRoot();
      if (!isCurrent()) return;
      const name = copy.newProjectNameFallback.trim();
      const projectRoot = await resolveProjectRootPath(name, projectsRoot);
      if (!isCurrent()) return;
      const project = await ensureProjectWorkspace({
        name,
        rootPath: projectRoot,
        workspaceType: "general",
      });
      if (!isCurrent()) return;
      selectProject(project);
      toast.success(copy.projectCreated);
    });

  const openExistingFolder = () =>
    runMutation("folder", copy.projectOpenFailed, async (isCurrent) => {
      const selectedPath = await requestChatHostOpenPath({
        directory: true,
        multiple: false,
        title: copy.selectFolderDialogTitle,
      });
      if (
        !isCurrent() ||
        typeof selectedPath !== "string" ||
        !selectedPath.trim()
      ) {
        return;
      }
      const projectRoot = selectedPath.trim();
      const project = await ensureProjectWorkspace({
        name: directoryName(projectRoot) || copy.newProjectNameFallback.trim(),
        rootPath: projectRoot,
        workspaceType: "general",
      });
      if (!isCurrent()) return;
      selectProject(project);
      toast.success(copy.projectOpened);
    });

  const checkoutBranch = (branch: string) => {
    if (!rootPath || !gitStatus?.hasGitRepository || requestRef.current) return;
    if (branch === gitStatus.currentBranch) {
      if (activeRef.current) onBranchOpenChange(false);
      return;
    }
    return runMutation(
      "checkout",
      copy.branchSwitchFailed,
      async (isCurrent) => {
        const status = await checkoutProjectGitBranch(rootPath, branch);
        if (!isCurrent()) return;
        setGitStatus(status);
        onBranchOpenChange(false);
        toast.success(copy.branchSwitched);
      },
    );
  };

  const createBranch = (branch: string) => {
    const name = branch.trim();
    if (
      !rootPath ||
      !gitStatus?.hasGitRepository ||
      !name ||
      gitStatus.currentBranch === name ||
      gitStatus.branches.includes(name)
    )
      return;
    return runMutation(
      "createBranch",
      copy.branchCreateFailed,
      async (isCurrent) => {
        const status = await createProjectGitBranch(rootPath, name);
        if (!isCurrent()) return;
        setGitStatus(status);
        onBranchSearchChange("");
        onBranchOpenChange(false);
        toast.success(copy.branchCreated);
      },
    );
  };

  const retryGitStatus = () => {
    if (activeRef.current && !requestRef.current && gitReadState === "error") {
      setReadRevision((revision) => revision + 1);
    }
  };

  const projectActionsRef = useRef({
    createBlankProject,
    openExistingFolder,
  });
  projectActionsRef.current = { createBlankProject, openExistingFolder };

  useEffect(() => {
    const handleNewProject = () => {
      void projectActionsRef.current.createBlankProject();
    };
    const handleOpenFolder = () => {
      void projectActionsRef.current.openExistingFolder();
    };
    window.addEventListener("lime:new-project", handleNewProject);
    window.addEventListener("lime:open-folder", handleOpenFolder);
    return () => {
      window.removeEventListener("lime:new-project", handleNewProject);
      window.removeEventListener("lime:open-folder", handleOpenFolder);
    };
  }, []);

  return {
    mutation,
    gitStatus,
    gitReadState,
    selectProject,
    createBlankProject,
    openExistingFolder,
    checkoutBranch,
    createBranch,
    retryGitStatus,
  };
}
