import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  mergeProjectGitPullRequest,
  readProjectGitPullRequest,
  readProjectGitStatus,
  type ProjectGitPullRequestInfo,
  type ProjectGitPullRequestMerge,
} from "@/lib/api/projectGit";
import {
  GitPullRequestMergeDialog,
  type GitPullRequestMergeInput,
} from "./GitPullRequestMergeDialog";

export const GIT_PULL_REQUEST_MERGE_REQUEST_EVENT =
  "lime:git-pull-request-merge";

export interface GitPullRequestMergeRequestDetail {
  rootPath: string;
}

interface GitPullRequestMergeDialogState {
  open: boolean;
  rootPath: string | null;
  branch: string | null;
  pullRequest: ProjectGitPullRequestInfo | null;
  loading: boolean;
  loadError: string | null;
  pending: boolean;
  error: string | null;
  merged: ProjectGitPullRequestMerge | null;
}

const CLOSED_STATE: GitPullRequestMergeDialogState = {
  open: false,
  rootPath: null,
  branch: null,
  pullRequest: null,
  loading: false,
  loadError: null,
  pending: false,
  error: null,
  merged: null,
};

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function GitPullRequestMergeDialogHost() {
  const { t } = useTranslation("agent");
  const [state, setState] =
    useState<GitPullRequestMergeDialogState>(CLOSED_STATE);

  useEffect(() => {
    const handleRequest = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | Partial<GitPullRequestMergeRequestDetail>
        | undefined;
      const rootPath =
        typeof detail?.rootPath === "string" ? detail.rootPath.trim() : "";
      if (!rootPath) {
        toast.error(
          String(t("agentChat.gitPullRequest.mergeMissingWorkspace")),
        );
        return;
      }
      setState({
        open: true,
        rootPath,
        branch: null,
        pullRequest: null,
        loading: true,
        loadError: null,
        pending: false,
        error: null,
        merged: null,
      });
      void Promise.all([
        readProjectGitStatus(rootPath),
        readProjectGitPullRequest(rootPath),
      ])
        .then(([status, pullRequestStatus]) => {
          setState((current) =>
            current.open && current.rootPath === rootPath
              ? {
                  ...current,
                  branch: status.currentBranch ?? null,
                  pullRequest: pullRequestStatus.pullRequest ?? null,
                  loading: false,
                }
              : current,
          );
        })
        .catch((cause: unknown) => {
          setState((current) =>
            current.open && current.rootPath === rootPath
              ? {
                  ...current,
                  loading: false,
                  loadError: errorMessage(
                    cause,
                    String(t("agentChat.gitPullRequest.mergeLoadFailed")),
                  ),
                }
              : current,
          );
        });
    };
    window.addEventListener(
      GIT_PULL_REQUEST_MERGE_REQUEST_EVENT,
      handleRequest,
    );
    return () =>
      window.removeEventListener(
        GIT_PULL_REQUEST_MERGE_REQUEST_EVENT,
        handleRequest,
      );
  }, [t]);

  const handleOpenChange = useCallback((open: boolean) => {
    setState((current) => {
      if (!open && current.pending) return current;
      if (!open) return CLOSED_STATE;
      return { ...current, open };
    });
  }, []);

  const handleConfirm = useCallback(
    async (input: GitPullRequestMergeInput) => {
      if (!state.rootPath || state.pending || state.merged) return;
      const rootPath = state.rootPath;
      setState((current) => ({ ...current, pending: true, error: null }));
      let merged: ProjectGitPullRequestMerge;
      try {
        merged = await mergeProjectGitPullRequest(rootPath, {
          method: input.method,
          deleteBranch: input.deleteBranch,
        });
      } catch (cause) {
        setState((current) => ({
          ...current,
          pending: false,
          error: errorMessage(
            cause,
            String(t("agentChat.gitPullRequest.mergeFailed")),
          ),
        }));
        return;
      }
      toast.success(
        merged.number
          ? String(
              t("agentChat.gitPullRequest.mergeToastWithNumber", {
                number: merged.number,
              }),
            )
          : String(t("agentChat.gitPullRequest.mergeToast")),
      );
      setState((current) => ({
        ...current,
        pending: false,
        error: null,
        merged,
      }));
    },
    [state.merged, state.pending, state.rootPath, t],
  );

  return (
    <GitPullRequestMergeDialog
      open={state.open}
      rootPath={state.rootPath}
      branch={state.branch}
      pullRequest={state.pullRequest}
      loading={state.loading}
      loadError={state.loadError}
      pending={state.pending}
      error={state.error}
      merged={state.merged}
      onOpenChange={handleOpenChange}
      onConfirm={handleConfirm}
    />
  );
}
