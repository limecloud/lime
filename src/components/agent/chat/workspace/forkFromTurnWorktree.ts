export interface WorktreeForkTarget {
  cwd: string;
  projectId: string;
}

export async function prepareWorktreeFork(
  rootPath: string | null | undefined,
  deps: {
    readLocalEnvironmentConfigPath: (rootPath: string) => Promise<string | null>;
    createWorktree: (
      rootPath: string,
      options: { localEnvironmentConfigPath: string | null },
    ) => Promise<{ worktreePath: string }>;
    ensureProject: (request: {
      name: string;
      rootPath: string;
      workspaceType: "general";
    }) => Promise<{ id: string }>;
    fallbackName: string;
  },
): Promise<WorktreeForkTarget> {
  const normalizedRoot = rootPath?.trim();
  if (!normalizedRoot) {
    throw new Error("project root is unavailable");
  }
  const localEnvironmentConfigPath = await deps.readLocalEnvironmentConfigPath(
    normalizedRoot,
  );
  const worktree = await deps.createWorktree(normalizedRoot, {
    localEnvironmentConfigPath,
  });
  const worktreePath = worktree.worktreePath.trim();
  if (!worktreePath) {
    throw new Error("worktree path is empty");
  }
  const name =
    worktreePath.split(/[\\/]/).filter(Boolean).at(-1) || deps.fallbackName;
  const project = await deps.ensureProject({
    name,
    rootPath: worktreePath,
    workspaceType: "general",
  });
  return { cwd: worktreePath, projectId: project.id };
}
