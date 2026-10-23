import { beforeEach, expect, it, vi } from "vitest";
const client = vi.hoisted(() => ({
  listProjectGitWorktrees: vi.fn(),
  deleteProjectGitWorktree: vi.fn(),
  sessionsChanged: vi.fn(),
}));
vi.mock("./agentRuntime/sessionClient", () => ({
  notifyAgentRuntimeSessionsChanged: client.sessionsChanged,
}));
vi.mock("./appServer", () => ({
  AppServerClient: class {
    listProjectGitWorktrees = client.listProjectGitWorktrees;
    deleteProjectGitWorktree = client.deleteProjectGitWorktree;
  },
}));
import { listManagedWorktrees, deleteManagedWorktree } from "./worktrees";

beforeEach(() => vi.resetAllMocks());
it("uses typed list and delete contracts without a force-discard option", async () => {
  client.listProjectGitWorktrees.mockResolvedValue({
    result: { rootPath: "/managed", worktrees: [] },
  });
  expect(await listManagedWorktrees()).toEqual({
    rootPath: "/managed",
    worktrees: [],
  });
  expect(client.listProjectGitWorktrees).toHaveBeenCalledWith({});
  client.deleteProjectGitWorktree.mockResolvedValue({
    result: { worktreePath: "/managed/one", archivedThreadIds: ["thread-1"] },
  });
  await deleteManagedWorktree("/managed/one");
  expect(client.deleteProjectGitWorktree).toHaveBeenCalledWith({
    rootPath: "/managed/one",
  });
  expect(client.sessionsChanged).toHaveBeenCalledWith({ reason: "external" });
});
it("refreshes canonical session caches even when deletion rejects after partial archiving", async () => {
  client.deleteProjectGitWorktree.mockRejectedValue(
    new Error("files changed after archive"),
  );
  await expect(deleteManagedWorktree("/managed/one")).rejects.toThrow(
    "files changed after archive",
  );
  expect(client.sessionsChanged).toHaveBeenCalledOnce();
});
it.each([
  null,
  { rootPath: "/managed", worktrees: [null] },
  {
    rootPath: "/managed",
    worktrees: [
      {
        worktreePath: "/managed/one",
        repositoryRoot: "/repo",
        headSha: "abc",
        branch: false,
        threads: [],
      },
    ],
  },
])("rejects malformed list results", async (result) => {
  client.listProjectGitWorktrees.mockResolvedValue({ result });
  await expect(listManagedWorktrees()).rejects.toThrow(
    "projectGit/worktree/list",
  );
});
it.each([
  { worktreePath: "/other", archivedThreadIds: [] },
  { worktreePath: "/managed/one", archivedThreadIds: [false] },
])("refuses a mismatched deletion receipt", async (result) => {
  client.deleteProjectGitWorktree.mockResolvedValue({ result });
  await expect(deleteManagedWorktree("/managed/one")).rejects.toThrow(
    "did not confirm",
  );
});
