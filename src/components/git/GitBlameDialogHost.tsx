import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  readProjectGitBlame,
  type ProjectGitBlameLine,
} from "@/lib/api/projectGit";
import { GitBlameDialog } from "./GitBlameDialog";
import {
  GIT_BLAME_TOGGLE_EVENT,
  type GitBlameToggleDetail,
} from "./GitBlameCommand";

interface GitBlameDialogState {
  open: boolean;
  rootPath: string | null;
  path: string | null;
  lines: ProjectGitBlameLine[];
  pending: boolean;
  error: string | null;
  reloadToken: number;
}

const CLOSED_STATE: GitBlameDialogState = {
  open: false,
  rootPath: null,
  path: null,
  lines: [],
  pending: false,
  error: null,
  reloadToken: 0,
};

function readRequest(
  detail: unknown,
): { rootPath: string; path: string } | null {
  if (!detail || typeof detail !== "object") return null;
  const record = detail as Partial<GitBlameToggleDetail>;
  const rootPath =
    typeof record.rootPath === "string" ? record.rootPath.trim() : "";
  const path = typeof record.path === "string" ? record.path : "";
  if (!rootPath || !path) return null;
  return { rootPath, path };
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/**
 * `git.toggleBlame` 的唯一写入口：同一文件再次触发时关闭，其他文件直接切换。
 * 数据始终来自 App Server `project/git/blame`，不读本地伪造行。
 */
export function GitBlameDialogHost() {
  const { t } = useTranslation("agent");
  const [state, setState] = useState<GitBlameDialogState>(CLOSED_STATE);

  useEffect(() => {
    const handleRequest = (event: Event) => {
      const request = readRequest((event as CustomEvent).detail);
      if (!request) return;
      setState((current) => {
        if (
          current.open &&
          current.rootPath === request.rootPath &&
          current.path === request.path
        ) {
          return CLOSED_STATE;
        }
        return {
          open: true,
          rootPath: request.rootPath,
          path: request.path,
          lines: [],
          pending: true,
          error: null,
          reloadToken: 0,
        };
      });
    };
    window.addEventListener(GIT_BLAME_TOGGLE_EVENT, handleRequest);
    return () =>
      window.removeEventListener(GIT_BLAME_TOGGLE_EVENT, handleRequest);
  }, []);

  useEffect(() => {
    if (!state.open || !state.rootPath || !state.path) return;
    let cancelled = false;
    setState((current) =>
      current.open
        ? { ...current, pending: true, error: null, lines: [] }
        : current,
    );
    void readProjectGitBlame(state.rootPath, state.path)
      .then((blame) => {
        if (cancelled) return;
        setState((current) =>
          current.open &&
          current.rootPath === state.rootPath &&
          current.path === state.path
            ? { ...current, pending: false, error: null, lines: blame.lines }
            : current,
        );
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState((current) =>
          current.open &&
          current.rootPath === state.rootPath &&
          current.path === state.path
            ? {
                ...current,
                pending: false,
                lines: [],
                error: errorMessage(
                  cause,
                  String(t("agentChat.gitBlame.failed")),
                ),
              }
            : current,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [state.open, state.rootPath, state.path, state.reloadToken, t]);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setState(CLOSED_STATE);
  }, []);

  const handleRetry = useCallback(() => {
    setState((current) =>
      current.open
        ? { ...current, reloadToken: current.reloadToken + 1 }
        : current,
    );
  }, []);

  return (
    <GitBlameDialog
      open={state.open}
      rootPath={state.rootPath}
      path={state.path}
      lines={state.lines}
      pending={state.pending}
      error={state.error}
      onOpenChange={handleOpenChange}
      onRetry={handleRetry}
    />
  );
}
