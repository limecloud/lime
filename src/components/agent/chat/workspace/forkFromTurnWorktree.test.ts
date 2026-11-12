import { describe, expect, it, vi } from "vitest";
import { prepareWorktreeFork } from "./forkFromTurnWorktree";

function deps() {
  return {
    readLocalEnvironmentConfigPath: vi.fn(async () => "/tmp/config.json"),
    createWorktree: vi.fn(async () => ({
      worktreePath: "/tmp/worktrees/lime-fork",
    })),
    ensureProject: vi.fn(async () => ({ id: "project-worktree" })),
    fallbackName: "fallback",
  };
}

describe("prepareWorktreeFork", () => {
  it("creates a worktree and registers its project", async () => {
    const d = deps();
    await expect(prepareWorktreeFork("/repo/app", d)).resolves.toEqual({
      cwd: "/tmp/worktrees/lime-fork",
      projectId: "project-worktree",
    });
    expect(d.createWorktree).toHaveBeenCalledWith("/repo/app", {
      localEnvironmentConfigPath: "/tmp/config.json",
    });
    expect(d.ensureProject).toHaveBeenCalledWith({
      name: "lime-fork",
      rootPath: "/tmp/worktrees/lime-fork",
      workspaceType: "general",
    });
  });

  it("fails before creating a worktree without a project root", async () => {
    const d = deps();
    await expect(prepareWorktreeFork("   ", d)).rejects.toThrow(
      "project root is unavailable",
    );
    expect(d.createWorktree).not.toHaveBeenCalled();
  });
});
