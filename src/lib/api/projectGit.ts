import {
  AppServerClient,
  AppServerRpcError,
  APP_SERVER_METHOD_PROJECT_GIT_BRANCH_CHECKOUT,
  APP_SERVER_METHOD_PROJECT_GIT_BRANCH_CREATE,
  APP_SERVER_METHOD_PROJECT_GIT_COMMITS_LIST,
  APP_SERVER_METHOD_PROJECT_GIT_DIFF,
  APP_SERVER_METHOD_PROJECT_GIT_STATUS,
  APP_SERVER_METHOD_PROJECT_GIT_WORKTREE_CREATE,
  type AppServerProjectGitDiffBase,
  type AppServerProjectGitCommitListResponse,
  type AppServerProjectGitBranchCheckoutResponse,
  type AppServerProjectGitBranchCreateResponse,
  type AppServerProjectGitDiffResponse,
  type AppServerProjectGitStatusResponse,
  type AppServerProjectGitWorktreeCreateResponse,
} from "@/lib/api/appServer";

export type ProjectGitStatus = AppServerProjectGitStatusResponse;
export type ProjectGitDiff = AppServerProjectGitDiffResponse;
export type ProjectGitDiffBase = AppServerProjectGitDiffBase;
export type ProjectGitCommitList = AppServerProjectGitCommitListResponse;
export type ProjectGitWorktree = AppServerProjectGitWorktreeCreateResponse;

export class ProjectGitWorktreeSetupError extends Error {
  constructor(
    message: string,
    readonly worktreePath: string,
  ) {
    super(`${message}\n${worktreePath}`);
    this.name = "ProjectGitWorktreeSetupError";
  }
}

export type ProjectGitAppServerClient = Pick<
  AppServerClient,
  | "readProjectGitStatus"
  | "readProjectGitDiff"
  | "listProjectGitCommits"
  | "checkoutProjectGitBranch"
  | "createProjectGitBranch"
  | "createProjectGitWorktree"
>;

function createProjectGitAppServerClient(): ProjectGitAppServerClient {
  return new AppServerClient();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertProjectGitStatus(
  method: string,
  value: unknown,
): asserts value is ProjectGitStatus {
  if (
    !isRecord(value) ||
    typeof value.rootPath !== "string" ||
    typeof value.hasGitRepository !== "boolean" ||
    !(
      value.isWorktree === undefined || typeof value.isWorktree === "boolean"
    ) ||
    !(
      value.localEnvironmentConfigPath == null ||
      typeof value.localEnvironmentConfigPath === "string"
    ) ||
    !Array.isArray(value.branches) ||
    !value.branches.every((branch) => typeof branch === "string") ||
    typeof value.uncommittedFileCount !== "number"
  ) {
    throw new Error(`${method} did not return project Git status`);
  }
}

function assertProjectGitDiff(
  method: string,
  value: unknown,
): asserts value is ProjectGitDiff {
  if (
    !isRecord(value) ||
    typeof value.rootPath !== "string" ||
    typeof value.hasGitRepository !== "boolean" ||
    typeof value.patch !== "string" ||
    typeof value.uncommittedFileCount !== "number" ||
    !(value.currentRef == null || typeof value.currentRef === "string") ||
    !(
      value.comparisonBaseRef == null ||
      typeof value.comparisonBaseRef === "string"
    )
  ) {
    throw new Error(`${method} did not return project Git diff`);
  }
}

function assertProjectGitWorktree(
  method: string,
  value: unknown,
): asserts value is ProjectGitWorktree {
  if (
    !isRecord(value) ||
    typeof value.worktreePath !== "string" ||
    typeof value.branch !== "string"
  ) {
    throw new Error(`${method} did not return project Git worktree`);
  }
  assertProjectGitStatus(method, value.status);
}

export async function readProjectGitStatus(
  rootPath: string,
  client: ProjectGitAppServerClient = createProjectGitAppServerClient(),
): Promise<ProjectGitStatus> {
  const response = await client.readProjectGitStatus({ rootPath });
  assertProjectGitStatus(APP_SERVER_METHOD_PROJECT_GIT_STATUS, response.result);
  return response.result;
}

export async function readProjectGitDiff(
  rootPath: string,
  contextLines = 3,
  baseOrClient?: ProjectGitDiffBase | ProjectGitAppServerClient,
  commitShaOrClient?: string | ProjectGitAppServerClient,
  maybeClient?: ProjectGitAppServerClient,
): Promise<ProjectGitDiff> {
  const base = typeof baseOrClient === "string" ? baseOrClient : undefined;
  const commitSha =
    typeof commitShaOrClient === "string" ? commitShaOrClient : undefined;
  const client =
    typeof baseOrClient === "string"
      ? (typeof commitShaOrClient === "object" && commitShaOrClient) ||
        maybeClient ||
        createProjectGitAppServerClient()
      : baseOrClient || createProjectGitAppServerClient();
  const response = await client.readProjectGitDiff({
    rootPath,
    contextLines,
    ...(base ? { base } : {}),
    ...(commitSha ? { commitSha } : {}),
  });
  assertProjectGitDiff(APP_SERVER_METHOD_PROJECT_GIT_DIFF, response.result);
  return response.result;
}

function assertProjectGitCommitList(
  method: string,
  value: unknown,
): asserts value is ProjectGitCommitList {
  if (
    !isRecord(value) ||
    typeof value.rootPath !== "string" ||
    typeof value.hasGitRepository !== "boolean" ||
    !Array.isArray(value.commits) ||
    !value.commits.every(
      (commit) =>
        isRecord(commit) &&
        typeof commit.sha === "string" &&
        typeof commit.shortSha === "string" &&
        typeof commit.subject === "string" &&
        typeof commit.authorName === "string" &&
        typeof commit.authorEmail === "string" &&
        typeof commit.committedAt === "string",
    )
  ) {
    throw new Error(`${method} did not return project Git commits`);
  }
}

export async function listProjectGitCommits(
  rootPath: string,
  limit = 30,
  client: ProjectGitAppServerClient = createProjectGitAppServerClient(),
): Promise<ProjectGitCommitList> {
  const response = await client.listProjectGitCommits({ rootPath, limit });
  assertProjectGitCommitList(
    APP_SERVER_METHOD_PROJECT_GIT_COMMITS_LIST,
    response.result,
  );
  return response.result;
}

export async function checkoutProjectGitBranch(
  rootPath: string,
  branch: string,
  client: ProjectGitAppServerClient = createProjectGitAppServerClient(),
): Promise<AppServerProjectGitBranchCheckoutResponse> {
  const response = await client.checkoutProjectGitBranch({ rootPath, branch });
  assertProjectGitStatus(
    APP_SERVER_METHOD_PROJECT_GIT_BRANCH_CHECKOUT,
    response.result,
  );
  return response.result;
}

export async function createProjectGitBranch(
  rootPath: string,
  branch: string,
  client: ProjectGitAppServerClient = createProjectGitAppServerClient(),
): Promise<AppServerProjectGitBranchCreateResponse> {
  const response = await client.createProjectGitBranch({ rootPath, branch });
  assertProjectGitStatus(
    APP_SERVER_METHOD_PROJECT_GIT_BRANCH_CREATE,
    response.result,
  );
  return response.result;
}

export async function createProjectGitWorktree(
  rootPath: string,
  options: {
    name?: string;
    baseBranch?: string;
    localEnvironmentConfigPath: string | null;
  },
  client: ProjectGitAppServerClient = createProjectGitAppServerClient(),
): Promise<ProjectGitWorktree> {
  let response;
  try {
    response = await client.createProjectGitWorktree({ rootPath, ...options });
  } catch (error) {
    if (
      error instanceof AppServerRpcError &&
      error.code === -32000 &&
      isRecord(error.data) &&
      typeof error.data.worktreePath === "string" &&
      /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(error.data.worktreePath)
    )
      throw new ProjectGitWorktreeSetupError(
        error.message,
        error.data.worktreePath,
      );
    throw error;
  }
  assertProjectGitWorktree(
    APP_SERVER_METHOD_PROJECT_GIT_WORKTREE_CREATE,
    response.result,
  );
  return response.result;
}
