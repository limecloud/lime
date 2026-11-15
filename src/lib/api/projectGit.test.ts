import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProjectGitBranch,
  createProjectGitPullRequest,
  createProjectGitWorktree,
  openProjectGitPullRequest,
  ProjectGitWorktreeSetupError,
  listProjectGitCommits,
  readProjectGitBlame,
  readProjectGitDiff,
  readProjectGitPullRequest,
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
  readProjectGitBlame: vi.fn(),
  checkoutProjectGitBranch: vi.fn(),
  createProjectGitBranch: vi.fn(),
  commitProjectGitChanges: vi.fn(),
  createProjectGitWorktree: vi.fn(),
  createProjectGitPullRequest: vi.fn(),
  openProjectGitPullRequest: vi.fn(),
  readProjectGitPullRequest: vi.fn(),
  mergeProjectGitPullRequest: vi.fn(),
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

  it("应通过 App Server current 主链读取 Git blame", async () => {
    vi.mocked(client.readProjectGitBlame).mockResolvedValueOnce(
      appServerResult({
        rootPath: "/workspace",
        repositoryRoot: "/workspace",
        lines: [
          {
            lineNumber: 3,
            sha: "0123456789abcdef0123456789abcdef01234567",
            shortSha: "0123456",
            author: "Fixture",
            authorTime: "2020-01-02T03:04:05Z",
            summary: "feat: blame",
            content: "const value = 1;",
          },
        ],
      }),
    );

    await expect(
      readProjectGitBlame("/workspace", "src/main.ts", client),
    ).resolves.toMatchObject({
      lines: [
        expect.objectContaining({
          lineNumber: 3,
          author: "Fixture",
          summary: "feat: blame",
        }),
      ],
    });
    expect(client.readProjectGitBlame).toHaveBeenCalledWith({
      rootPath: "/workspace",
      path: "src/main.ts",
    });
  });

  it("拒绝缺少 blame lines 的响应", async () => {
    vi.mocked(client.readProjectGitBlame).mockResolvedValueOnce(
      appServerResult({
        rootPath: "/workspace",
        lines: "not-lines",
      }) as never,
    );
    await expect(
      readProjectGitBlame("/workspace", "src/main.ts", client),
    ).rejects.toThrow("Git blame lines");
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

  it("trims branch names and returns the refreshed Git status", async () => {
    const result = {
      rootPath: "/repo",
      repositoryRoot: "/repo",
      hasGitRepository: true,
      currentBranch: "feature/demo",
      branches: ["feature/demo", "main"],
      uncommittedFileCount: 0,
    };
    vi.mocked(client.createProjectGitBranch).mockResolvedValueOnce(
      appServerResult(result),
    );

    await expect(
      createProjectGitBranch("/repo", "  feature/demo  ", client),
    ).resolves.toEqual(result);
    expect(client.createProjectGitBranch).toHaveBeenCalledWith({
      rootPath: "/repo",
      branch: "feature/demo",
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

  it("创建 Pull Request 时 trim 标题与目标分支并确认 rootPath", async () => {
    vi.mocked(client.createProjectGitPullRequest).mockResolvedValueOnce(
      appServerResult({
        rootPath: "/repo",
        url: "https://github.com/example/repo/pull/42",
        number: 42,
        title: "feat: demo",
        draft: true,
      }),
    );

    await expect(
      createProjectGitPullRequest(
        "/repo",
        {
          title: "  feat: demo  ",
          body: "Body",
          draft: true,
          base: "  main  ",
        },
        client,
      ),
    ).resolves.toMatchObject({ number: 42, draft: true });
    expect(client.createProjectGitPullRequest).toHaveBeenCalledWith({
      rootPath: "/repo",
      title: "feat: demo",
      body: "Body",
      draft: true,
      base: "main",
    });
  });

  it("创建 Pull Request 的空标题在调用 App Server 前失败", async () => {
    await expect(
      createProjectGitPullRequest("/repo", { title: "   ", body: "" }, client),
    ).rejects.toThrow("Pull Request title is required");
    expect(client.createProjectGitPullRequest).not.toHaveBeenCalled();
  });

  it("创建 Pull Request 响应形状异常时应 fail closed", async () => {
    vi.mocked(client.createProjectGitPullRequest).mockResolvedValueOnce(
      appServerResult({
        rootPath: "/repo",
        draft: "yes",
      } as unknown as Awaited<
        ReturnType<ProjectGitAppServerClient["createProjectGitPullRequest"]>
      >["result"]),
    );
    await expect(
      createProjectGitPullRequest(
        "/repo",
        { title: "title", body: "" },
        client,
      ),
    ).rejects.toThrow("did not return a created pull request");
  });

  it("打开 Pull Request 使用当前工作区并返回 URL", async () => {
    vi.mocked(client.openProjectGitPullRequest).mockResolvedValueOnce(
      appServerResult({
        rootPath: "/repo",
        url: "https://github.com/example/repo/pull/7",
      }),
    );
    await expect(openProjectGitPullRequest("/repo", client)).resolves.toEqual({
      rootPath: "/repo",
      url: "https://github.com/example/repo/pull/7",
    });
    expect(client.openProjectGitPullRequest).toHaveBeenCalledWith({
      rootPath: "/repo",
    });
  });

  it("读取当前分支 Pull Request 支持没有 PR", async () => {
    vi.mocked(client.readProjectGitPullRequest).mockResolvedValueOnce(
      appServerResult({ rootPath: "/repo" }),
    );
    await expect(readProjectGitPullRequest("/repo", client)).resolves.toEqual({
      rootPath: "/repo",
    });
  });

  it("读取 Pull Request 元数据形状异常时应 fail closed", async () => {
    vi.mocked(client.readProjectGitPullRequest).mockResolvedValueOnce(
      appServerResult({
        rootPath: "/repo",
        pullRequest: { number: "12" },
      } as unknown as Awaited<
        ReturnType<ProjectGitAppServerClient["readProjectGitPullRequest"]>
      >["result"]),
    );
    await expect(readProjectGitPullRequest("/repo", client)).rejects.toThrow(
      "did not return pull request metadata",
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
