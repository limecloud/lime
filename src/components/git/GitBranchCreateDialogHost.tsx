import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  createProjectGitBranch,
  type ProjectGitStatus,
} from "@/lib/api/projectGit";
import { GitBranchCreateDialog } from "./GitBranchCreateDialog";
import {
  GIT_BRANCH_NAME_MAX_LENGTH,
  validateGitBranchName,
  type GitBranchNameValidation,
} from "./gitBranchName";

export const GIT_BRANCH_CREATE_REQUEST_EVENT = "lime:git-branch-create";
export const GIT_BRANCH_CREATED_EVENT = "lime:git-branch-created";

export interface GitBranchCreatedDetail {
  rootPath: string;
  branch: string;
  status: ProjectGitStatus;
}

interface GitBranchCreateDialogState {
  open: boolean;
  rootPath: string | null;
  pending: boolean;
  error: string | null;
}

const CLOSED_STATE: GitBranchCreateDialogState = {
  open: false,
  rootPath: null,
  pending: false,
  error: null,
};

function readRootPath(detail: unknown): string {
  if (!detail || typeof detail !== "object") return "";
  const value = (detail as { rootPath?: unknown }).rootPath;
  return typeof value === "string" ? value.trim() : "";
}

function branchValidationMessageKey(validation: GitBranchNameValidation) {
  if (validation === "required") {
    return "agentChat.gitBranchCreate.branchRequired";
  }
  if (validation === "tooLong") {
    return "agentChat.gitBranchCreate.branchTooLong";
  }
  return "agentChat.gitBranchCreate.branchInvalid";
}

export function GitBranchCreateDialogHost() {
  const { t } = useTranslation("agent");
  const [state, setState] = useState<GitBranchCreateDialogState>(CLOSED_STATE);

  useEffect(() => {
    const handleRequest = (event: Event) => {
      const rootPath = readRootPath((event as CustomEvent).detail);
      if (!rootPath) {
        toast.error(String(t("agentChat.gitBranchCreate.missingWorkspace")));
        return;
      }
      setState({ open: true, rootPath, pending: false, error: null });
    };
    window.addEventListener(GIT_BRANCH_CREATE_REQUEST_EVENT, handleRequest);
    return () =>
      window.removeEventListener(
        GIT_BRANCH_CREATE_REQUEST_EVENT,
        handleRequest,
      );
  }, [t]);

  const handleOpenChange = useCallback((open: boolean) => {
    setState((current) => {
      if (!open && current.pending) return current;
      if (!open) return CLOSED_STATE;
      return { ...current, open, error: null };
    });
  }, []);

  const handleConfirm = useCallback(
    async (branch: string) => {
      if (!state.rootPath || state.pending) return;
      const validation = validateGitBranchName(branch);
      if (validation) {
        setState((current) => ({
          ...current,
          error: String(
            t(branchValidationMessageKey(validation), {
              max: GIT_BRANCH_NAME_MAX_LENGTH,
            }),
          ),
        }));
        return;
      }
      const rootPath = state.rootPath;
      const normalizedBranch = branch.trim();
      setState((current) => ({ ...current, pending: true, error: null }));
      let status: ProjectGitStatus;
      try {
        status = await createProjectGitBranch(rootPath, normalizedBranch);
      } catch (cause) {
        const fallback = String(t("agentChat.gitBranchCreate.failed"));
        setState((current) => ({
          ...current,
          pending: false,
          error:
            cause instanceof Error && cause.message ? cause.message : fallback,
        }));
        return;
      }
      toast.success(
        String(
          t("agentChat.gitBranchCreate.success", {
            branch: normalizedBranch,
          }),
        ),
      );
      window.dispatchEvent(
        new CustomEvent<GitBranchCreatedDetail>(GIT_BRANCH_CREATED_EVENT, {
          detail: { rootPath, branch: normalizedBranch, status },
        }),
      );
      setState(CLOSED_STATE);
    },
    [state.pending, state.rootPath, t],
  );

  return (
    <GitBranchCreateDialog
      open={state.open}
      rootPath={state.rootPath}
      pending={state.pending}
      error={state.error}
      onOpenChange={handleOpenChange}
      onConfirm={handleConfirm}
    />
  );
}
