import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getLimeI18n } from "@/i18n/createI18n";
import { createProjectGitWorktree } from "@/lib/api/projectGit";
import { readLocalEnvironmentSelection } from "@/lib/api/localEnvironmentSelection";
import { ensureProjectWorkspace } from "@/lib/api/project";
import { assignThreadProject } from "@/lib/api/projectDirectory";
import { subscribeForkThreadAtTurn } from "@/lib/threadForkEvents";
import type { ForkFromTurnMode } from "./ForkFromTurnDialog";
import { prepareWorktreeFork } from "./forkFromTurnWorktree";
import { requiresForkConfirmation } from "./forkFromTurnConfirmation";

interface ForkRequest {
  threadId: string;
  turnId: string;
}

export function useWorkspaceForkFromTurnRuntime({
  sceneSessionId,
  getThreadIdForSubmit,
  forkTopic,
  project,
  threadRead,
  openForkedSession,
}: {
  sceneSessionId: string | null;
  getThreadIdForSubmit: (sessionId: string) => string | null | undefined;
  forkTopic: (
    sessionId: string,
    options?: { beforeTurnId?: string; cwd?: string },
  ) => Promise<string | null>;
  project?: { name?: string | null; rootPath?: string | null } | null;
  threadRead?: { thread_turns?: { id?: string }[] } | null;
  openForkedSession: (sessionId: string) => Promise<void>;
}) {
  const [pendingForkFromTurn, setPendingForkFromTurn] =
    useState<ForkRequest | null>(null);

  const runForkFromTurn = useCallback(
    async (request: ForkRequest, mode: ForkFromTurnMode = "local") => {
      if (!sceneSessionId) return;
      const activeThreadId = getThreadIdForSubmit(sceneSessionId)?.trim();
      if (
        activeThreadId &&
        request.threadId &&
        request.threadId !== activeThreadId
      ) {
        return;
      }
      let cwd: string | undefined;
      let forkedProjectId: string | undefined;
      if (mode === "worktree") {
        const rootPath = project?.rootPath?.trim();
        if (!rootPath) {
          toast.error(
            String(
              getLimeI18n().t(
                "agentChat.forkFromOlderTurn.worktreeFailed",
                "",
                { error: "project root is unavailable" },
              ),
            ),
          );
          return;
        }
        try {
          const target = await prepareWorktreeFork(rootPath, {
            readLocalEnvironmentConfigPath: readLocalEnvironmentSelection,
            createWorktree: createProjectGitWorktree,
            ensureProject: ensureProjectWorkspace,
            fallbackName: project?.name || "worktree",
          });
          cwd = target.cwd;
          forkedProjectId = target.projectId;
        } catch (error) {
          toast.error(
            String(
              getLimeI18n().t(
                "agentChat.forkFromOlderTurn.worktreeFailed",
                "",
                {
                  error:
                    error instanceof Error ? error.message : String(error),
                },
              ),
            ),
          );
          return;
        }
      }
      const forkedSessionId = await forkTopic(sceneSessionId, {
        beforeTurnId: request.turnId,
        ...(cwd ? { cwd } : {}),
      });
      if (!forkedSessionId) return;
      if (forkedProjectId) {
        try {
          const forkedThreadId = getThreadIdForSubmit(forkedSessionId);
          if (forkedThreadId) {
            await assignThreadProject(forkedThreadId, forkedProjectId);
          }
        } catch (error) {
          toast.error(
            String(
              getLimeI18n().t(
                "agentChat.forkFromOlderTurn.forkSynchronizationFailed",
                "",
                {
                  error:
                    error instanceof Error ? error.message : String(error),
                },
              ),
            ),
          );
        }
      }
      try {
        await openForkedSession(forkedSessionId);
      } catch (error) {
        toast.error(
          String(
            getLimeI18n().t("agentChat.forkFromOlderTurn.syncFailed", "", {
              error: error instanceof Error ? error.message : String(error),
            }),
          ),
        );
      }
    },
    [
      forkTopic,
      getThreadIdForSubmit,
      openForkedSession,
      project?.name,
      project?.rootPath,
      sceneSessionId,
    ],
  );

  useEffect(
    () =>
      subscribeForkThreadAtTurn((request) => {
        const latestTurnId =
          threadRead?.thread_turns?.[threadRead.thread_turns.length - 1]?.id
            ?.trim() || "";
        if (
          requiresForkConfirmation({
            latestTurnId,
            turnId: request.turnId,
          })
        ) {
          setPendingForkFromTurn(request);
          return;
        }
        void runForkFromTurn(request);
      }),
    [runForkFromTurn, threadRead],
  );

  return {
    pendingForkFromTurn,
    setPendingForkFromTurn,
    runForkFromTurn,
  };
}
