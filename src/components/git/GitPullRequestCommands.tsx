import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useCommand } from "@/lib/commands/useCommand";
import type { CommandRegistration } from "@/lib/commands/registry";
import { openProjectGitPullRequest } from "@/lib/api/projectGit";
import { GIT_PULL_REQUEST_CREATE_REQUEST_EVENT } from "./GitPullRequestDialogHost";
import { GIT_PULL_REQUEST_MERGE_REQUEST_EVENT } from "./GitPullRequestMergeDialogHost";

function dispatchCreateRequest(rootPath: string, draft: boolean) {
  window.dispatchEvent(
    new CustomEvent(GIT_PULL_REQUEST_CREATE_REQUEST_EVENT, {
      detail: { rootPath, draft },
    }),
  );
}

function dispatchMergeRequest(rootPath: string) {
  window.dispatchEvent(
    new CustomEvent(GIT_PULL_REQUEST_MERGE_REQUEST_EVENT, {
      detail: { rootPath },
    }),
  );
}

/**
 * 只在拿到真实工作目录时注册 Pull Request 命令；创建与合并命令只打开确认框，
 * 打开命令直接调用 App Server，由 `gh pr view --web` 交给系统浏览器。
 */
export function GitPullRequestCommands({ cwd }: { cwd?: string | null }) {
  const { t } = useTranslation("agent");
  const rootPath = cwd?.trim() || null;

  const createCommand = useMemo<CommandRegistration>(
    () => ({
      id: "git.createPullRequest",
      titleKey: "commands.gitCreatePullRequest.title",
      descriptionKey: "commands.gitCreatePullRequest.description",
      section: "workspace",
      bindings: [],
      enabled: Boolean(rootPath),
      handler: () => {
        if (!rootPath) return;
        dispatchCreateRequest(rootPath, false);
      },
    }),
    [rootPath],
  );

  const createDraftCommand = useMemo<CommandRegistration>(
    () => ({
      id: "git.createDraftPullRequest",
      titleKey: "commands.gitCreateDraftPullRequest.title",
      descriptionKey: "commands.gitCreateDraftPullRequest.description",
      section: "workspace",
      bindings: [],
      enabled: Boolean(rootPath),
      handler: () => {
        if (!rootPath) return;
        dispatchCreateRequest(rootPath, true);
      },
    }),
    [rootPath],
  );

  const openCommand = useMemo<CommandRegistration>(
    () => ({
      id: "git.openPullRequest",
      titleKey: "commands.gitOpenPullRequest.title",
      descriptionKey: "commands.gitOpenPullRequest.description",
      section: "workspace",
      bindings: [],
      enabled: Boolean(rootPath),
      handler: () => {
        if (!rootPath) return;
        void openProjectGitPullRequest(rootPath)
          .then((result) => {
            toast.success(
              result.url
                ? String(
                    t("agentChat.gitPullRequest.openedWithUrl", {
                      url: result.url,
                    }),
                  )
                : String(t("agentChat.gitPullRequest.opened")),
            );
          })
          .catch((cause: unknown) => {
            toast.error(
              cause instanceof Error && cause.message
                ? cause.message
                : String(t("agentChat.gitPullRequest.openFailed")),
            );
          });
      },
    }),
    [rootPath, t],
  );

  const mergeCommand = useMemo<CommandRegistration>(
    () => ({
      id: "git.mergePullRequest",
      titleKey: "commands.gitMergePullRequest.title",
      descriptionKey: "commands.gitMergePullRequest.description",
      section: "workspace",
      bindings: [],
      enabled: Boolean(rootPath),
      handler: () => {
        if (!rootPath) return;
        dispatchMergeRequest(rootPath);
      },
    }),
    [rootPath],
  );

  useCommand(createCommand);
  useCommand(createDraftCommand);
  useCommand(mergeCommand);
  useCommand(openCommand);
  return null;
}
