import { toast } from "sonner";
import { ensureProjectWorkspace } from "@/lib/api/project";
import { ProjectGitWorktreeSetupError } from "@/lib/api/projectGit";
import { areLocalEnvironmentPathsEqual } from "@/lib/localEnvironmentSelection";
import { markProjectOpened } from "../hooks/agentProjectStorage";

/** Offers recovery for the confirmed checkout without retrying setup or submitting a turn. */
export function worktreeSetupErrorOptions(
  error: unknown,
  label: string,
  onRecovered?: (projectId: string) => void,
) {
  if (!(error instanceof ProjectGitWorktreeSetupError)) return undefined;
  let opening = false;
  return {
    description: error.message,
    ...(onRecovered
      ? {
          action: {
            label,
            onClick: () => {
              if (opening) return;
              opening = true;
              void ensureProjectWorkspace({
                rootPath: error.worktreePath,
                name:
                  error.worktreePath.split(/[\\/]/).filter(Boolean).pop() ||
                  error.worktreePath,
                workspaceType: "general",
              })
                .then((project) => {
                  if (
                    !areLocalEnvironmentPathsEqual(
                      project.rootPath,
                      error.worktreePath,
                    )
                  )
                    throw Error("Worktree workspace directory mismatch");
                  markProjectOpened(project.id);
                  onRecovered(project.id);
                })
                .catch((failure: unknown) => {
                  toast.error(
                    failure instanceof Error
                      ? failure.message
                      : String(failure),
                  );
                })
                .finally(() => {
                  opening = false;
                });
            },
          },
        }
      : {}),
  };
}
