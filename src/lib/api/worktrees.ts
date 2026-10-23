import {
  AppServerClient,
  type AppServerProjectGitWorktreeListResponse,
} from "./appServer";
import { notifyAgentRuntimeSessionsChanged } from "./agentRuntime/sessionClient";

export type ManagedWorktree =
  AppServerProjectGitWorktreeListResponse["worktrees"][number];

export async function listManagedWorktrees(): Promise<AppServerProjectGitWorktreeListResponse> {
  const { result } = await new AppServerClient().listProjectGitWorktrees({});
  if (
    !result ||
    typeof result.rootPath !== "string" ||
    !Array.isArray(result.worktrees)
  ) {
    throw new Error(
      "projectGit/worktree/list did not return managed worktrees",
    );
  }
  for (const entry of result.worktrees) {
    if (
      !entry ||
      typeof entry.worktreePath !== "string" ||
      typeof entry.repositoryRoot !== "string" ||
      typeof entry.headSha !== "string" ||
      (entry.branch !== null && typeof entry.branch !== "string") ||
      !Array.isArray(entry.threads) ||
      !entry.threads.every(
        (thread) =>
          thread &&
          typeof thread.threadId === "string" &&
          typeof thread.name === "string" &&
          typeof thread.pinned === "boolean" &&
          typeof thread.active === "boolean" &&
          typeof thread.archived === "boolean",
      )
    ) {
      throw new Error("projectGit/worktree/list returned an invalid worktree");
    }
  }
  return result;
}

export async function deleteManagedWorktree(rootPath: string): Promise<void> {
  try {
    const { result } = await new AppServerClient().deleteProjectGitWorktree({
      rootPath,
    });
    if (
      !result ||
      result.worktreePath !== rootPath ||
      !Array.isArray(result.archivedThreadIds) ||
      !result.archivedThreadIds.every((id) => typeof id === "string")
    ) {
      throw new Error(
        "projectGit/worktree/delete did not confirm the requested worktree",
      );
    }
  } finally {
    // 删除失败也可能已经归档部分关联聊天，重新读取唯一会话事实源。
    notifyAgentRuntimeSessionsChanged({ reason: "external" });
  }
}
