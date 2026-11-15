import { useMemo } from "react";
import { useCommand } from "@/lib/commands/useCommand";
import type { CommandRegistration } from "@/lib/commands/registry";
import { GIT_BRANCH_CREATE_REQUEST_EVENT } from "./GitBranchCreateDialogHost";

/**
 * 只在拿到真实工作目录时注册 `git.createBranch`。命令只打开确认框，
 * 不会在命令执行时直接创建分支。
 */
export function GitBranchCreateCommand({ cwd }: { cwd?: string | null }) {
  const rootPath = cwd?.trim() || null;
  const command = useMemo<CommandRegistration>(
    () => ({
      id: "git.createBranch",
      titleKey: "commands.gitBranchCreate.title",
      descriptionKey: "commands.gitBranchCreate.description",
      section: "workspace",
      bindings: [],
      enabled: Boolean(rootPath),
      handler: () => {
        if (!rootPath) return;
        window.dispatchEvent(
          new CustomEvent(GIT_BRANCH_CREATE_REQUEST_EVENT, {
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
