import {
  AppServerClient,
  AppServerRpcError,
  APP_SERVER_METHOD_PROJECT_GIT_BLAME,
  APP_SERVER_METHOD_PROJECT_GIT_BRANCH_CHECKOUT,
  APP_SERVER_METHOD_PROJECT_GIT_BRANCH_CREATE,
  APP_SERVER_METHOD_PROJECT_GIT_COMMIT,
  APP_SERVER_METHOD_PROJECT_GIT_COMMITS_LIST,
  APP_SERVER_METHOD_PROJECT_GIT_DIFF,
  APP_SERVER_METHOD_PROJECT_GIT_PULL_REQUEST_CREATE,
  APP_SERVER_METHOD_PROJECT_GIT_PULL_REQUEST_MERGE,
  APP_SERVER_METHOD_PROJECT_GIT_PULL_REQUEST_OPEN,
  APP_SERVER_METHOD_PROJECT_GIT_PULL_REQUEST_STATUS,
  APP_SERVER_METHOD_PROJECT_GIT_STATUS,
  APP_SERVER_METHOD_PROJECT_GIT_WORKTREE_CREATE,
  APP_SERVER_METHOD_PROJECT_GIT_WORKTREE_ENVIRONMENT_SET,
  type AppServerProjectGitDiffBase,
  type AppServerProjectGitBlameLine,
  type AppServerProjectGitBlameResponse,
  type AppServerProjectGitCommitListResponse,
  type AppServerProjectGitCommitResponse,
  type AppServerProjectGitBranchCheckoutResponse,
  type AppServerProjectGitBranchCreateResponse,
  type AppServerProjectGitDiffResponse,
  type AppServerProjectGitPullRequestCreateResponse,
  type AppServerProjectGitPullRequestInfo,
  type AppServerProjectGitPullRequestMergeMethod,
  type AppServerProjectGitPullRequestMergeResponse,
  type AppServerProjectGitPullRequestOpenResponse,
  type AppServerProjectGitPullRequestStatusResponse,
  type AppServerProjectGitStatusResponse,
  type AppServerProjectGitWorktreeCreateResponse,
} from "@/lib/api/appServer";

export type ProjectGitStatus = AppServerProjectGitStatusResponse;
export type ProjectGitDiff = AppServerProjectGitDiffResponse;
export type ProjectGitDiffBase = AppServerProjectGitDiffBase;
export type ProjectGitCommitList = AppServerProjectGitCommitListResponse;
export type ProjectGitBlame = AppServerProjectGitBlameResponse;
export type ProjectGitBlameLine = AppServerProjectGitBlameLine;
export type ProjectGitCommit = AppServerProjectGitCommitResponse;
export type ProjectGitWorktree = AppServerProjectGitWorktreeCreateResponse;
export type ProjectGitPullRequestCreate =
  AppServerProjectGitPullRequestCreateResponse;
export type ProjectGitPullRequestOpen =
  AppServerProjectGitPullRequestOpenResponse;
export type ProjectGitPullRequestStatus =
  AppServerProjectGitPullRequestStatusResponse;
export type ProjectGitPullRequestInfo = AppServerProjectGitPullRequestInfo;
export type ProjectGitPullRequestMerge =
  AppServerProjectGitPullRequestMergeResponse;
export type ProjectGitPullRequestMergeMethod =
  AppServerProjectGitPullRequestMergeMethod;

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
  | "readProjectGitBlame"
  | "commitProjectGitChanges"
  | "checkoutProjectGitBranch"
  | "createProjectGitBranch"
  | "createProjectGitPullRequest"
  | "openProjectGitPullRequest"
  | "readProjectGitPullRequest"
  | "mergeProjectGitPullRequest"
  | "createProjectGitWorktree"
  | "setProjectGitWorktreeEnvironment"
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

export async function setProjectGitWorktreeEnvironment(
  rootPath: string,
  configPath: string | null,
  client: ProjectGitAppServerClient = createProjectGitAppServerClient(),
): Promise<ProjectGitStatus> {
  const response = await client.setProjectGitWorktreeEnvironment({
    rootPath,
    configPath,
  });
  assertProjectGitStatus(
    APP_SERVER_METHOD_PROJECT_GIT_WORKTREE_ENVIRONMENT_SET,
    response.result,
  );
  if (
    !response.result.isWorktree ||
    response.result.rootPath !== rootPath ||
    (response.result.localEnvironmentConfigPath ?? null) !== configPath
  )
    throw new Error("Worktree environment selection was not confirmed");
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

function assertProjectGitBlame(
  method: string,
  value: unknown,
): asserts value is ProjectGitBlame {
  if (
    !isRecord(value) ||
    typeof value.rootPath !== "string" ||
    !(
      value.repositoryRoot == null || typeof value.repositoryRoot === "string"
    ) ||
    !Array.isArray(value.lines) ||
    !value.lines.every(
      (line) =>
        isRecord(line) &&
        typeof line.lineNumber === "number" &&
        Number.isInteger(line.lineNumber) &&
        line.lineNumber > 0 &&
        typeof line.sha === "string" &&
        line.sha.trim().length > 0 &&
        typeof line.shortSha === "string" &&
        line.shortSha.trim().length > 0 &&
        typeof line.author === "string" &&
        typeof line.authorTime === "string" &&
        typeof line.summary === "string" &&
        typeof line.content === "string",
    )
  ) {
    throw new Error(`${method} did not return Git blame lines`);
  }
}

export async function readProjectGitBlame(
  rootPath: string,
  path: string,
  client: ProjectGitAppServerClient = createProjectGitAppServerClient(),
): Promise<ProjectGitBlame> {
  const response = await client.readProjectGitBlame({ rootPath, path });
  assertProjectGitBlame(APP_SERVER_METHOD_PROJECT_GIT_BLAME, response.result);
  if (response.result.rootPath !== rootPath) {
    throw new Error("Git blame returned a mismatched root path");
  }
  return response.result;
}

function assertProjectGitCommit(
  method: string,
  value: unknown,
): asserts value is ProjectGitCommit {
  if (
    !isRecord(value) ||
    typeof value.rootPath !== "string" ||
    !(
      value.repositoryRoot == null || typeof value.repositoryRoot === "string"
    ) ||
    typeof value.sha !== "string" ||
    !value.sha.trim() ||
    typeof value.shortSha !== "string" ||
    !value.shortSha.trim() ||
    typeof value.subject !== "string" ||
    value.status !== "committed"
  ) {
    throw new Error(`${method} did not return a Git commit`);
  }
}

export async function commitProjectGitChanges(
  rootPath: string,
  message: string,
  paths?: readonly string[],
  client: ProjectGitAppServerClient = createProjectGitAppServerClient(),
): Promise<ProjectGitCommit> {
  const normalizedPaths = paths
    ?.map((path) => path.trim())
    .filter((path) => path.length > 0);
  const response = await client.commitProjectGitChanges({
    rootPath,
    message,
    ...(normalizedPaths && normalizedPaths.length > 0
      ? { paths: normalizedPaths }
      : {}),
  });
  assertProjectGitCommit(APP_SERVER_METHOD_PROJECT_GIT_COMMIT, response.result);
  if (response.result.rootPath !== rootPath) {
    throw new Error("Git commit returned a mismatched root path");
  }
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
  const response = await client.createProjectGitBranch({
    rootPath,
    branch: branch.trim(),
  });
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

function assertProjectGitPullRequestCreate(
  method: string,
  value: unknown,
): asserts value is ProjectGitPullRequestCreate {
  if (
    !isRecord(value) ||
    typeof value.rootPath !== "string" ||
    !(value.url == null || typeof value.url === "string") ||
    !(
      value.number == null ||
      (typeof value.number === "number" &&
        Number.isInteger(value.number) &&
        value.number > 0)
    ) ||
    !(value.title == null || typeof value.title === "string") ||
    typeof value.draft !== "boolean"
  ) {
    throw new Error(`${method} did not return a created pull request`);
  }
}

function assertProjectGitPullRequestOpen(
  method: string,
  value: unknown,
): asserts value is ProjectGitPullRequestOpen {
  if (
    !isRecord(value) ||
    typeof value.rootPath !== "string" ||
    !(value.url == null || typeof value.url === "string")
  ) {
    throw new Error(`${method} did not return an opened pull request`);
  }
}

function assertProjectGitPullRequestInfo(
  method: string,
  value: unknown,
): asserts value is ProjectGitPullRequestInfo {
  if (
    !isRecord(value) ||
    typeof value.number !== "number" ||
    !Number.isInteger(value.number) ||
    value.number <= 0 ||
    typeof value.url !== "string" ||
    typeof value.title !== "string" ||
    typeof value.state !== "string" ||
    typeof value.isDraft !== "boolean" ||
    typeof value.baseRefName !== "string" ||
    typeof value.headRefName !== "string"
  ) {
    throw new Error(`${method} did not return pull request metadata`);
  }
}

function assertProjectGitPullRequestStatus(
  method: string,
  value: unknown,
): asserts value is ProjectGitPullRequestStatus {
  if (!isRecord(value) || typeof value.rootPath !== "string") {
    throw new Error(`${method} did not return pull request status`);
  }
  if (value.pullRequest != null) {
    assertProjectGitPullRequestInfo(method, value.pullRequest);
  }
}

export async function createProjectGitPullRequest(
  rootPath: string,
  input: {
    title: string;
    body: string;
    draft?: boolean;
    base?: string | null;
  },
  client: ProjectGitAppServerClient = createProjectGitAppServerClient(),
): Promise<ProjectGitPullRequestCreate> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Pull Request title is required");
  }
  const base = input.base?.trim();
  const response = await client.createProjectGitPullRequest({
    rootPath,
    title,
    body: input.body,
    draft: input.draft ?? false,
    ...(base ? { base } : {}),
  });
  assertProjectGitPullRequestCreate(
    APP_SERVER_METHOD_PROJECT_GIT_PULL_REQUEST_CREATE,
    response.result,
  );
  if (response.result.rootPath !== rootPath) {
    throw new Error("Pull request create returned a mismatched root path");
  }
  return response.result;
}

export async function openProjectGitPullRequest(
  rootPath: string,
  client: ProjectGitAppServerClient = createProjectGitAppServerClient(),
): Promise<ProjectGitPullRequestOpen> {
  const response = await client.openProjectGitPullRequest({ rootPath });
  assertProjectGitPullRequestOpen(
    APP_SERVER_METHOD_PROJECT_GIT_PULL_REQUEST_OPEN,
    response.result,
  );
  if (response.result.rootPath !== rootPath) {
    throw new Error("Pull request open returned a mismatched root path");
  }
  return response.result;
}

export async function readProjectGitPullRequest(
  rootPath: string,
  client: ProjectGitAppServerClient = createProjectGitAppServerClient(),
): Promise<ProjectGitPullRequestStatus> {
  const response = await client.readProjectGitPullRequest({ rootPath });
  assertProjectGitPullRequestStatus(
    APP_SERVER_METHOD_PROJECT_GIT_PULL_REQUEST_STATUS,
    response.result,
  );
  if (response.result.rootPath !== rootPath) {
    throw new Error("Pull request status returned a mismatched root path");
  }
  return response.result;
}

function assertProjectGitPullRequestMerge(
  method: string,
  value: unknown,
): asserts value is ProjectGitPullRequestMerge {
  if (
    !isRecord(value) ||
    typeof value.rootPath !== "string" ||
    !(
      value.method === "merge" ||
      value.method === "squash" ||
      value.method === "rebase"
    ) ||
    typeof value.deleteBranch !== "boolean" ||
    value.merged !== true ||
    !(
      value.number == null ||
      (typeof value.number === "number" &&
        Number.isInteger(value.number) &&
        value.number > 0)
    ) ||
    !(value.url == null || typeof value.url === "string")
  ) {
    throw new Error(`${method} did not merge a pull request`);
  }
}

export async function mergeProjectGitPullRequest(
  rootPath: string,
  input: {
    method?: ProjectGitPullRequestMergeMethod;
    deleteBranch?: boolean;
    prNumber?: number | null;
  } = {},
  client: ProjectGitAppServerClient = createProjectGitAppServerClient(),
): Promise<ProjectGitPullRequestMerge> {
  const prNumber = input.prNumber ?? null;
  if (prNumber !== null && (!Number.isInteger(prNumber) || prNumber <= 0)) {
    throw new Error("Pull request number must be a positive integer");
  }
  const response = await client.mergeProjectGitPullRequest({
    rootPath,
    method: input.method ?? "merge",
    deleteBranch: input.deleteBranch ?? false,
    ...(prNumber !== null ? { prNumber } : {}),
  });
  assertProjectGitPullRequestMerge(
    APP_SERVER_METHOD_PROJECT_GIT_PULL_REQUEST_MERGE,
    response.result,
  );
  if (response.result.rootPath !== rootPath) {
    throw new Error("Pull request merge returned a mismatched root path");
  }
  return response.result;
}
