import { useMemo } from "react";
import { useCommand } from "@/lib/commands/useCommand";
import type { CommandRegistration } from "@/lib/commands/registry";
import { GIT_COMMIT_REQUEST_EVENT } from "./GitCommitDialogHost";

/**
 * 只在拿到真实工作目录时注册 `git.commit`，避免在首页等无仓库上下文里
 * 打开一个无法提交的确认框。
 */
export function GitCommitCommand({ cwd }: { cwd?: string | null }) {
  const rootPath = cwd?.trim() || null;
  const command = useMemo<CommandRegistration>(
    () => ({
      id: "git.commit",
      titleKey: "commands.gitCommit.title",
      descriptionKey: "commands.gitCommit.description",
      section: "workspace",
      bindings: [],
      enabled: Boolean(rootPath),
      handler: () => {
        if (!rootPath) return;
        window.dispatchEvent(
          new CustomEvent(GIT_COMMIT_REQUEST_EVENT, {
            detail: { rootPath },
          }),
        );
      },
    }),
    [rootPath],
  );
  useCommand(command);
  return null;
}
