import { describe, expect, it, vi } from "vitest";
import type { ExecutionScope } from "../hooks/executionScope";
import { ComposerWorktreeSubmission } from "./composerWorktreeSubmission";
import { runtimeReceipt } from "../hooks/agentSendResult.testFixtures";
import { ProjectGitWorktreeSetupError } from "@/lib/api/projectGit";

const request = {
  requestId: "r1",
  sourceWorkspaceId: "a",
  sourceWorkingDir: "/a",
};
const git = {
  rootPath: "/a",
  hasGitRepository: true,
  currentBranch: "main",
  branches: ["main"],
  uncommittedFileCount: 0,
};
function setup() {
  const readGit = vi.fn(async () => git);
  const readEnvironment = vi.fn(async (): Promise<string | null> => null);
  const createWorktree = vi.fn(async () => ({
    worktreePath: "/a-task",
    branch: "main",
    status: git,
  }));
  const ensureWorkspace = vi.fn(async () => ({ id: "b", rootPath: "/a-task" }));
  const owner = new ComposerWorktreeSubmission({
    readGit,
    readEnvironment,
    createWorktree,
    ensureWorkspace,
  } as unknown as ConstructorParameters<typeof ComposerWorktreeSubmission>[0]);
  const execute = vi.fn(
    async (executionScope: ExecutionScope) =>
      ({
        kind: "runtime-accepted",
        receipt: { ...runtimeReceipt("s1"), executionScope },
      }) as const,
  );
  return {
    owner,
    readGit,
    readEnvironment,
    createWorktree,
    ensureWorkspace,
    execute,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

describe("submit-time Worktree resource identity", () => {
  it("keeps the known failed worktree identity and never resubmits or recreates it implicitly", async () => {
    const h = setup();
    const error = new ProjectGitWorktreeSetupError("setup failed", "/a-failed");
    h.createWorktree.mockRejectedValueOnce(error);
    expect(await h.owner.submit(request, () => true, h.execute)).toEqual({
      kind: "rejected",
      error,
    });
    expect(await h.owner.submit(request, () => true, h.execute)).toEqual({
      kind: "rejected",
      error,
    });
    expect(h.createWorktree).toHaveBeenCalledOnce();
    expect(h.execute).not.toHaveBeenCalled();
    expect(error.message).toContain("/a-failed");
  });
  it("resolves the selected environment before creating and does not create after a late navigation", async () => {
    const h = setup();
    h.readEnvironment.mockResolvedValueOnce(
      "/a/.codex/environments/environment.toml",
    );
    await h.owner.submit(request, () => true, h.execute);
    expect(h.createWorktree).toHaveBeenCalledExactlyOnceWith("/a", {
      baseBranch: "main",
      localEnvironmentConfigPath: "/a/.codex/environments/environment.toml",
    });
    const other = setup(),
      selection = deferred<string | null>();
    let current = true;
    other.readEnvironment.mockReturnValueOnce(selection.promise);
    const result = other.owner.submit(request, () => current, other.execute);
    await Promise.resolve();
    current = false;
    selection.resolve(null);
    expect((await result).kind).toBe("rejected");
    expect(other.createWorktree).not.toHaveBeenCalled();
  });
  it("creates only on submit, keys dedupe by source and request, and sends canonical scope once", async () => {
    const h = setup();
    expect(h.createWorktree).not.toHaveBeenCalled();
    const pending = h.owner.submit(request, () => true, h.execute);
    expect(h.owner.submit({ ...request }, () => true, h.execute)).toBe(pending);
    expect((await pending).kind).toBe("runtime-accepted");
    await h.owner.submit(request, () => true, h.execute);
    expect(h.createWorktree).toHaveBeenCalledExactlyOnceWith("/a", {
      baseBranch: "main",
      localEnvironmentConfigPath: null,
    });
    expect(h.ensureWorkspace).toHaveBeenCalledExactlyOnceWith({
      rootPath: "/a-task",
      name: "a-task",
      workspaceType: "general",
    });
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({
      ...request,
      workspaceId: "b",
      workingDir: "/a-task",
    });
  });
  it("keeps the created checkout for ensure failure and explicit submission rejection retries", async () => {
    const h = setup();
    h.ensureWorkspace.mockRejectedValueOnce(new Error("ensure failed"));
    expect((await h.owner.submit(request, () => true, h.execute)).kind).toBe(
      "rejected",
    );
    const reject = vi.fn(async () => ({ kind: "rejected" }) as const);
    expect((await h.owner.submit(request, () => true, reject)).kind).toBe(
      "rejected",
    );
    expect((await h.owner.submit(request, () => true, h.execute)).kind).toBe(
      "runtime-accepted",
    );
    expect(h.createWorktree).toHaveBeenCalledOnce();
    expect(h.ensureWorkspace).toHaveBeenCalledTimes(2);
  });
  it("never repeats creation after a lost create response", async () => {
    const h = setup();
    h.createWorktree.mockRejectedValueOnce(
      new Error("response lost after git add"),
    );
    expect(await h.owner.submit(request, () => true, h.execute)).toEqual({
      kind: "unknown",
    });
    expect(await h.owner.submit(request, () => true, h.execute)).toEqual({
      kind: "unknown",
    });
    expect(h.createWorktree).toHaveBeenCalledOnce();
    expect(h.ensureWorkspace).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("keeps unknown submission deduplicated", async () => {
    const h = setup();
    const execute = vi.fn(async () => ({ kind: "unknown" }) as const);
    await h.owner.submit(request, () => true, execute);
    await h.owner.submit(request, () => true, execute);
    expect(execute).toHaveBeenCalledOnce();
    expect(h.createWorktree).toHaveBeenCalledOnce();
  });
  it("records a late created identity without ensuring, sending or deleting after cancellation", async () => {
    const h = setup();
    const wait = deferred<Awaited<ReturnType<typeof h.createWorktree>>>();
    h.createWorktree.mockReturnValueOnce(wait.promise);
    let current = true;
    const pending = h.owner.submit(request, () => current, h.execute);
    await Promise.resolve();
    current = false;
    wait.resolve({ worktreePath: "/a-task", branch: "main", status: git });
    expect((await pending).kind).toBe("rejected");
    expect(h.ensureWorkspace).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
    current = true;
    await h.owner.submit(request, () => current, h.execute);
    expect(h.createWorktree).toHaveBeenCalledOnce();
  });
  it("rejects pre-create unavailable Git and pre-submit mismatched workspace directories", async () => {
    const h = setup();
    h.readGit.mockResolvedValueOnce({ ...git, hasGitRepository: false });
    expect((await h.owner.submit(request, () => true, h.execute)).kind).toBe(
      "rejected",
    );
    expect(h.createWorktree).not.toHaveBeenCalled();
    h.ensureWorkspace.mockResolvedValueOnce({ id: "b", rootPath: "/wrong" });
    expect((await h.owner.submit(request, () => true, h.execute)).kind).toBe(
      "rejected",
    );
    expect(h.execute).not.toHaveBeenCalled();
    await h.owner.submit(request, () => true, h.execute);
    expect(h.ensureWorkspace).toHaveBeenCalledTimes(2);
    expect(h.createWorktree).toHaveBeenCalledOnce();
  });
  it("refuses a receipt attributed to a different execution scope", async () => {
    const h = setup();
    const execute = async (scope: ExecutionScope) =>
      ({
        kind: "runtime-accepted",
        receipt: {
          ...runtimeReceipt("s1"),
          executionScope: { ...scope, workspaceId: "wrong" },
        },
      }) as const;
    expect(await h.owner.submit(request, () => true, execute)).toEqual({
      kind: "unknown",
    });
  });
});
