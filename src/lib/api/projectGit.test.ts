import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProjectGitWorktree,
  ProjectGitWorktreeSetupError,
  listProjectGitCommits,
  readProjectGitDiff,
  readProjectGitStatus,
  setProjectGitWorktreeEnvironment,
  type ProjectGitAppServerClient,
} from "./projectGit";
import { AppServerRpcError } from "./appServer";

function appServerResult<T>(result: T) {
  return {
    id: 1,
    result,
    response: { jsonrpc: "2.0" as const, id: 1, result },
    notifications: [],
    messages: [],
  };
}

const client: ProjectGitAppServerClient = {
  readProjectGitStatus: vi.fn(),
  readProjectGitDiff: vi.fn(),
  listProjectGitCommits: vi.fn(),
  checkoutProjectGitBranch: vi.fn(),
  createProjectGitBranch: vi.fn(),
  createProjectGitWorktree: vi.fn(),
  setProjectGitWorktreeEnvironment: vi.fn(),
};

describe("projectGit API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([null, "/tree/.lime/environments/environment.toml"])(
    "confirms explicit worktree selection %s over the current App Server method",
    async (configPath) => {
      const result = {
        rootPath: "/tree",
        hasGitRepository: true,
        isWorktree: true,
        localEnvironmentConfigPath: configPath,
        branches: [],
        uncommittedFileCount: 0,
      };
      vi.mocked(client.setProjectGitWorktreeEnvironment).mockResolvedValueOnce(
        appServerResult(result),
      );
      await expect(
        setProjectGitWorktreeEnvironment("/tree", configPath, client),
      ).resolves.toEqual(result);
      expect(
        client.setProjectGitWorktreeEnvironment,
      ).toHaveBeenCalledExactlyOnceWith({ rootPath: "/tree", configPath });
    },
  );

  it("rejects foreign or unconfirmed worktree selection receipts", async () => {
    vi.mocked(client.setProjectGitWorktreeEnvironment).mockResolvedValue(
      appServerResult({
        rootPath: "/other",
        hasGitRepository: true,
        isWorktree: true,
        localEnvironmentConfigPath: null,
        branches: [],
        uncommittedFileCount: 0,
      }),
    );
    await expect(
      setProjectGitWorktreeEnvironment("/tree", null, client),
    ).rejects.toThrow("not confirmed");
  });

  it("keeps checkout identity and Git-scoped environment selection in the current response", async () => {
    const status = {
      rootPath: "/tree/packages/app",
      repositoryRoot: "/tree",
      hasGitRepository: true,
      isWorktree: true,
      localEnvironmentConfigPath: "/tree/.lime/environments/environment.toml",
      branches: [],
      uncommittedFileCount: 0,
    };
    vi.mocked(client.readProjectGitStatus).mockResolvedValueOnce(
      appServerResult(status),
    );
    await expect(
      readProjectGitStatus(status.rootPath, client),
    ).resolves.toEqual(status);
  });

  it.each([{ isWorktree: "true" }, { localEnvironmentConfigPath: 42 }])(
    "rejects malformed worktree selection: %j",
    async (invalid) => {
      vi.mocked(client.readProjectGitStatus).mockResolvedValueOnce(
        appServerResult({
          rootPath: "/tree",
          hasGitRepository: true,
          branches: [],
          uncommittedFileCount: 0,
          ...invalid,
        }) as never,
      );
      await expect(readProjectGitStatus("/tree", client)).rejects.toThrow(
        "project Git status",
      );
    },
  );

  it.each([null, "/workspace/.lime/environments/dev.toml"])(
    "passes the explicit environment choice %s to the current worktree method",
    async (localEnvironmentConfigPath) => {
      vi.mocked(client.createProjectGitWorktree).mockResolvedValueOnce(
        appServerResult({
          worktreePath: "/checkout",
          branch: "task",
          status: {
            rootPath: "/checkout",
            hasGitRepository: true,
            branches: ["task"],
            uncommittedFileCount: 0,
          },
        }),
      );
      await expect(
        createProjectGitWorktree(
          "/workspace",
          { baseBranch: "main", localEnvironmentConfigPath },
          client,
        ),
      ).resolves.toMatchObject({ worktreePath: "/checkout" });
      expect(client.createProjectGitWorktree).toHaveBeenCalledExactlyOnceWith({
        rootPath: "/workspace",
        baseBranch: "main",
        localEnvironmentConfigPath,
      });
    },
  );

  it("preserves a confirmed checkout when setup fails", async () => {
    const error = new AppServerRpcError({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32000,
        message: "setup exited 1",
        data: { worktreePath: "/checkout" },
      },
    });
    vi.mocked(client.createProjectGitWorktree).mockRejectedValueOnce(error);
    const result = createProjectGitWorktree(
      "/workspace",
      { localEnvironmentConfigPath: null },
      client,
    );
    await expect(result).rejects.toBeInstanceOf(ProjectGitWorktreeSetupError);
    await expect(result).rejects.toMatchObject({
      worktreePath: "/checkout",
      message: "setup exited 1\n/checkout",
    });
  });

  it.each([
    [-32800, "/checkout"],
    [-32000, "relative/checkout"],
    [-32000, null],
  ])(
    "keeps unconfirmed/cancelled errors unchanged (%s, %s)",
    async (code, worktreePath) => {
      const error = new AppServerRpcError({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: code as number,
          message: "failed",
          data: { worktreePath },
        },
      });
      vi.mocked(client.createProjectGitWorktree).mockRejectedValueOnce(error);
      await expect(
        createProjectGitWorktree(
          "/workspace",
          { localEnvironmentConfigPath: null },
          client,
        ),
      ).rejects.toBe(error);
    },
  );

  it("应通过 App Server current 主链读取 Git 状态", async () => {
    vi.mocked(client.readProjectGitStatus).mockResolvedValueOnce(
      appServerResult({
        rootPath: "/workspace",
        repositoryRoot: "/workspace",
        hasGitRepository: true,
        currentBranch: "main",
        branches: ["main"],
        uncommittedFileCount: 1,
      }),
    );

    await expect(readProjectGitStatus("/workspace", client)).resolves.toEqual(
      expect.objectContaining({
        hasGitRepository: true,
        uncommittedFileCount: 1,
      }),
    );
    expect(client.readProjectGitStatus).toHaveBeenCalledWith({
      rootPath: "/workspace",
    });
  });

  it("应通过 App Server current 主链读取 Git diff", async () => {
    vi.mocked(client.readProjectGitDiff).mockResolvedValueOnce(
      appServerResult({
        rootPath: "/workspace",
        repositoryRoot: "/workspace",
        hasGitRepository: true,
        currentRef: "main",
        comparisonBaseRef: "origin/main",
        patch: "diff --git a/README.md b/README.md\n+hello",
        uncommittedFileCount: 1,
      }),
    );

    await expect(readProjectGitDiff("/workspace", 5, client)).resolves.toEqual(
      expect.objectContaining({
        currentRef: "main",
        comparisonBaseRef: "origin/main",
        patch: expect.stringContaining("diff --git"),
        uncommittedFileCount: 1,
      }),
    );
    expect(client.readProjectGitDiff).toHaveBeenCalledWith({
      rootPath: "/workspace",
      contextLines: 5,
    });
  });

  it("读取 Git diff 时应透传审查基准", async () => {
    vi.mocked(client.readProjectGitDiff).mockResolvedValueOnce(
      appServerResult({
        rootPath: "/workspace",
        repositoryRoot: "/workspace",
        hasGitRepository: true,
        patch: "diff --git a/README.md b/README.md\n+hello",
        uncommittedFileCount: 1,
      }),
    );

    await expect(
      readProjectGitDiff("/workspace", 5, "staged", client),
    ).resolves.toEqual(
      expect.objectContaining({
        patch: expect.stringContaining("diff --git"),
      }),
    );
    expect(client.readProjectGitDiff).toHaveBeenCalledWith({
      rootPath: "/workspace",
      contextLines: 5,
      base: "staged",
    });
  });

  it("读取提交 Git diff 时应透传 commitSha", async () => {
    vi.mocked(client.readProjectGitDiff).mockResolvedValueOnce(
      appServerResult({
        rootPath: "/workspace",
        repositoryRoot: "/workspace",
        hasGitRepository: true,
        patch: "diff --git a/README.md b/README.md\n+commit",
        uncommittedFileCount: 0,
      }),
    );

    await expect(
      readProjectGitDiff("/workspace", 3, "commit", "abc123", client),
    ).resolves.toEqual(
      expect.objectContaining({
        patch: expect.stringContaining("diff --git"),
      }),
    );
    expect(client.readProjectGitDiff).toHaveBeenCalledWith({
      rootPath: "/workspace",
      contextLines: 3,
      base: "commit",
      commitSha: "abc123",
    });
  });

  it("应通过 App Server current 主链读取 Git 提交列表", async () => {
    vi.mocked(client.listProjectGitCommits).mockResolvedValueOnce(
      appServerResult({
        rootPath: "/workspace",
        repositoryRoot: "/workspace",
        hasGitRepository: true,
        commits: [
          {
            sha: "abc123456789",
            shortSha: "abc1234",
            subject: "demo commit",
            authorName: "Test User",
            authorEmail: "test@example.com",
            committedAt: "2026-06-14T10:00:00Z",
          },
        ],
      }),
    );

    await expect(
      listProjectGitCommits("/workspace", 20, client),
    ).resolves.toEqual(
      expect.objectContaining({
        commits: [
          expect.objectContaining({
            shortSha: "abc1234",
            subject: "demo commit",
          }),
        ],
      }),
    );
    expect(client.listProjectGitCommits).toHaveBeenCalledWith({
      rootPath: "/workspace",
      limit: 20,
    });
  });

  it("Git diff 响应形状异常时应 fail closed", async () => {
    vi.mocked(client.readProjectGitDiff).mockResolvedValueOnce(
      appServerResult({
        rootPath: "/workspace",
        hasGitRepository: true,
      } as unknown as Awaited<
        ReturnType<ProjectGitAppServerClient["readProjectGitDiff"]>
      >["result"]),
    );

    await expect(readProjectGitDiff("/workspace", 3, client)).rejects.toThrow(
      "projectGit/diff did not return project Git diff",
    );
  });

  it("Git 提交列表响应形状异常时应 fail closed", async () => {
    vi.mocked(client.listProjectGitCommits).mockResolvedValueOnce(
      appServerResult({
        rootPath: "/workspace",
        hasGitRepository: true,
        commits: [{ sha: "abc123" }],
      } as unknown as Awaited<
        ReturnType<ProjectGitAppServerClient["listProjectGitCommits"]>
      >["result"]),
    );

    await expect(
      listProjectGitCommits("/workspace", 30, client),
    ).rejects.toThrow(
      "projectGit/commits/list did not return project Git commits",
    );
  });
});
