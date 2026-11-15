import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { openExternalUrlWithSystemBrowser } from "@/lib/api/externalUrl";
import {
  createProjectGitPullRequest,
  type ProjectGitPullRequestCreate,
} from "@/lib/api/projectGit";
import { GitPullRequestDialog, type GitPullRequestDraft } from "./GitPullRequestDialog";

export const GIT_PULL_REQUEST_CREATE_REQUEST_EVENT =
  "lime:git-pull-request-create";
export const GIT_PULL_REQUEST_CREATED_EVENT = "lime:git-pull-request-created";

export interface GitPullRequestRequestDetail {
  rootPath: string;
  draft?: boolean;
}

export interface GitPullRequestCreatedDetail {
  rootPath: string;
  created: ProjectGitPullRequestCreate;
}

interface GitPullRequestDialogState {
  open: boolean;
  rootPath: string | null;
  draft: boolean;
  pending: boolean;
  error: string | null;
  created: ProjectGitPullRequestCreate | null;
}

const CLOSED_STATE: GitPullRequestDialogState = {
  open: false,
  rootPath: null,
  draft: false,
  pending: false,
  error: null,
  created: null,
};

function readRequest(detail: unknown): {
  rootPath: string;
  draft: boolean;
} {
  if (!detail || typeof detail !== "object") {
    return { rootPath: "", draft: false };
  }
  const record = detail as { rootPath?: unknown; draft?: unknown };
  return {
    rootPath: typeof record.rootPath === "string" ? record.rootPath.trim() : "",
    draft: record.draft === true,
  };
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function GitPullRequestDialogHost() {
  const { t } = useTranslation("agent");
  const [state, setState] = useState<GitPullRequestDialogState>(CLOSED_STATE);

  useEffect(() => {
    const handleRequest = (event: Event) => {
      const { rootPath, draft } = readRequest((event as CustomEvent).detail);
      if (!rootPath) {
        toast.error(String(t("agentChat.gitPullRequest.missingWorkspace")));
        return;
      }
      setState({
        open: true,
        rootPath,
        draft,
        pending: false,
        error: null,
        created: null,
      });
    };
    window.addEventListener(GIT_PULL_REQUEST_CREATE_REQUEST_EVENT, handleRequest);
    return () =>
      window.removeEventListener(
        GIT_PULL_REQUEST_CREATE_REQUEST_EVENT,
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
    async (input: GitPullRequestDraft) => {
      if (!state.rootPath || state.pending || state.created) return;
      const rootPath = state.rootPath;
      setState((current) => ({ ...current, pending: true, error: null }));
      let created: ProjectGitPullRequestCreate;
      try {
        created = await createProjectGitPullRequest(rootPath, {
          title: input.title,
          body: input.body,
          draft: input.draft,
          base: input.base ?? null,
        });
      } catch (cause) {
        setState((current) => ({
          ...current,
          pending: false,
          error: errorMessage(
            cause,
            String(t("agentChat.gitPullRequest.failed")),
          ),
        }));
        return;
      }
      toast.success(
        created.number
          ? String(
              t("agentChat.gitPullRequest.createdToastWithNumber", {
                number: created.number,
              }),
            )
          : String(t("agentChat.gitPullRequest.createdToast")),
      );
      window.dispatchEvent(
        new CustomEvent<GitPullRequestCreatedDetail>(
          GIT_PULL_REQUEST_CREATED_EVENT,
          {
            detail: { rootPath, created },
          },
        ),
      );
      setState((current) => ({
        ...current,
        pending: false,
        error: null,
        created,
      }));
    },
    [state.created, state.pending, state.rootPath, t],
  );

  const handleOpenCreated = useCallback(
    async (url: string) => {
      try {
        await openExternalUrlWithSystemBrowser(url);
      } catch (cause) {
        toast.error(
          errorMessage(
            cause,
            String(t("agentChat.gitPullRequest.openFailed")),
          ),
        );
      }
    },
    [t],
  );

  return (
    <GitPullRequestDialog
      open={state.open}
      rootPath={state.rootPath}
      initialDraft={state.draft}
      pending={state.pending}
      error={state.error}
      created={state.created}
      onOpenChange={handleOpenChange}
      onConfirm={handleConfirm}
      onOpenCreated={handleOpenCreated}
    />
  );
}
