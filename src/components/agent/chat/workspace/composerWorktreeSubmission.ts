import { ensureProjectWorkspace } from "@/lib/api/project";
import { readLocalEnvironmentSelection } from "@/lib/api/localEnvironmentSelection";
import {
  createProjectGitWorktree,
  ProjectGitWorktreeSetupError,
  readProjectGitStatus,
} from "@/lib/api/projectGit";
import {
  executionScopeKey,
  normalizeExecutionDirectory,
  requireExecutionScope,
  type ExecutionScope,
} from "../hooks/executionScope";
import type { RuntimeSubmissionResult } from "../hooks/agentSendResult";

export interface ComposerWorktreeRequest {
  readonly requestId: string;
  readonly sourceWorkspaceId: string;
  readonly sourceWorkingDir: string;
}
interface Dependencies {
  readGit: typeof readProjectGitStatus;
  readEnvironment: typeof readLocalEnvironmentSelection;
  createWorktree: typeof createProjectGitWorktree;
  ensureWorkspace: typeof ensureProjectWorkspace;
}
type Entry = {
  request: ComposerWorktreeRequest;
  path?: string;
  scope?: ExecutionScope;
  pending?: Promise<RuntimeSubmissionResult>;
  result?: RuntimeSubmissionResult;
  setupError?: ProjectGitWorktreeSetupError;
};

/** Owns submit-time resource identity, never canonical session or turn state. */
export class ComposerWorktreeSubmission {
  private entries = new Map<string, Entry>();
  constructor(
    private dependencies: Dependencies = {
      readGit: readProjectGitStatus,
      readEnvironment: readLocalEnvironmentSelection,
      createWorktree: createProjectGitWorktree,
      ensureWorkspace: ensureProjectWorkspace,
    },
  ) {}

  submit(
    request: ComposerWorktreeRequest,
    isCurrent: () => boolean,
    execute: (scope: ExecutionScope) => Promise<RuntimeSubmissionResult>,
  ): Promise<RuntimeSubmissionResult> {
    const key = JSON.stringify([
      request.sourceWorkspaceId,
      normalizeExecutionDirectory(request.sourceWorkingDir),
      request.requestId,
    ]);
    let entry = this.entries.get(key);
    if (entry?.pending) return entry.pending;
    if (entry?.setupError)
      return Promise.resolve({ kind: "rejected", error: entry.setupError });
    if (entry?.result && entry.result.kind !== "rejected")
      return Promise.resolve(entry.result);
    if (!entry) {
      entry = { request: Object.freeze({ ...request }) };
      this.entries.set(key, entry);
    }
    const target = entry;
    const requireCurrent = () => {
      if (!isCurrent())
        throw new DOMException(
          "Worktree submission was superseded",
          "AbortError",
        );
    };
    target.pending = (async () => {
      let creating = false;
      let submitting = false;
      try {
        requireCurrent();
        if (!target.path) {
          const git = await this.dependencies.readGit(request.sourceWorkingDir);
          requireCurrent();
          if (!git.hasGitRepository)
            throw new Error("Worktree requires a Git repository");
          const localEnvironmentConfigPath =
            await this.dependencies.readEnvironment(request.sourceWorkingDir);
          requireCurrent();
          creating = true;
          const worktree = await this.dependencies.createWorktree(
            request.sourceWorkingDir,
            {
              baseBranch: git.currentBranch ?? undefined,
              localEnvironmentConfigPath,
            },
          );
          target.path = normalizeExecutionDirectory(worktree.worktreePath);
          creating = false;
          requireCurrent();
        }
        if (!target.scope) {
          const project = await this.dependencies.ensureWorkspace({
            rootPath: target.path,
            name: target.path.split("/").filter(Boolean).pop() || target.path,
            workspaceType: "general",
          });
          const scope = requireExecutionScope({
            ...request,
            workspaceId: project.id,
            workingDir: target.path,
          });
          if (
            normalizeExecutionDirectory(project.rootPath) !== scope.workingDir
          )
            throw new Error("Worktree workspace directory mismatch");
          target.scope = scope;
          requireCurrent();
        }
        requireCurrent();
        submitting = true;
        const result = await execute(target.scope);
        if (
          result.kind === "runtime-accepted" &&
          (result.receipt.kind !== "start" ||
            !result.receipt.executionScope ||
            executionScopeKey(result.receipt.executionScope) !==
              executionScopeKey(target.scope))
        )
          return { kind: "unknown" } as const;
        return result;
      } catch (error) {
        if (creating && error instanceof ProjectGitWorktreeSetupError) {
          target.path = normalizeExecutionDirectory(error.worktreePath);
          target.setupError = error;
          return { kind: "rejected", error } as const;
        }
        // The current Git producer may add a checkout before its response fails.
        // Without a confirmed identity, repeating creation or submission is unsafe.
        return creating || submitting
          ? ({ kind: "unknown" } as const)
          : ({ kind: "rejected", error } as const);
      }
    })().then((result) => {
      target.result = result;
      target.pending = undefined;
      return result;
    });
    return target.pending;
  }
}
