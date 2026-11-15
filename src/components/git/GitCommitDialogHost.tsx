import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  commitProjectGitChanges,
  type ProjectGitCommit,
} from "@/lib/api/projectGit";
import { GitCommitDialog } from "./GitCommitDialog";

export const GIT_COMMIT_REQUEST_EVENT = "lime:git-commit";
export const GIT_COMMIT_COMPLETED_EVENT = "lime:git-commit-completed";

export interface GitCommitCompletedDetail {
  rootPath: string;
  sha: string;
  shortSha: string;
  subject: string;
}

interface GitCommitDialogState {
  open: boolean;
  rootPath: string | null;
  pending: boolean;
  error: string | null;
}

const CLOSED_STATE: GitCommitDialogState = {
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

export function GitCommitDialogHost() {
  const { t } = useTranslation("agent");
  const [state, setState] = useState<GitCommitDialogState>(CLOSED_STATE);

  useEffect(() => {
    const handleRequest = (event: Event) => {
      const rootPath = readRootPath((event as CustomEvent).detail);
      if (!rootPath) {
        toast.error(String(t("agentChat.gitCommit.missingWorkspace")));
        return;
      }
      setState({ open: true, rootPath, pending: false, error: null });
    };
    window.addEventListener(GIT_COMMIT_REQUEST_EVENT, handleRequest);
    return () =>
      window.removeEventListener(GIT_COMMIT_REQUEST_EVENT, handleRequest);
  }, [t]);

  const handleOpenChange = useCallback((open: boolean) => {
    setState((current) => {
      if (!open && current.pending) return current;
      if (!open) return CLOSED_STATE;
      return { ...current, open, error: null };
    });
  }, []);

  const handleConfirm = useCallback(
    async (message: string) => {
      if (!state.rootPath || state.pending) return;
      const rootPath = state.rootPath;
      setState((current) => ({ ...current, pending: true, error: null }));
      let commit: ProjectGitCommit;
      try {
        commit = await commitProjectGitChanges(rootPath, message);
      } catch (cause) {
        const fallback = String(t("agentChat.gitCommit.failed"));
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
          t("agentChat.gitCommit.success", {
            shortSha: commit.shortSha,
            subject: commit.subject,
          }),
        ),
      );
      window.dispatchEvent(
        new CustomEvent<GitCommitCompletedDetail>(GIT_COMMIT_COMPLETED_EVENT, {
          detail: {
            rootPath,
            sha: commit.sha,
            shortSha: commit.shortSha,
            subject: commit.subject,
          },
        }),
      );
      setState(CLOSED_STATE);
    },
    [state.pending, state.rootPath, t],
  );

  return (
    <GitCommitDialog
      open={state.open}
      rootPath={state.rootPath}
      pending={state.pending}
      error={state.error}
      onOpenChange={handleOpenChange}
      onConfirm={handleConfirm}
    />
  );
}
