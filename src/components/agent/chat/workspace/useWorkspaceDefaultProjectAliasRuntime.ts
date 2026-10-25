import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  ensureWorkspaceReady,
  getProject,
  type Project,
} from "@/lib/api/project";
import { logAgentDebug } from "@/lib/agentDebug";
import {
  isDefaultProjectIdAlias,
  isLegacyDefaultProjectId,
} from "../utils/topicProjectResolution";

interface UseWorkspaceDefaultProjectAliasRuntimeParams {
  applyProjectSelection: (projectId?: string | null) => void;
  externalProjectId?: string | null;
  getRememberedProjectId: () => string | null;
  projectId?: string | null;
  resetProjectSelection: () => void;
  setProject: Dispatch<SetStateAction<Project | null>>;
}

export function shouldResolveDefaultProjectAlias(
  externalProjectId?: string | null,
  projectId?: string | null,
): boolean {
  return (
    !projectId &&
    (isDefaultProjectIdAlias(externalProjectId) ||
      isLegacyDefaultProjectId(externalProjectId))
  );
}

export function useWorkspaceDefaultProjectAliasRuntime({
  applyProjectSelection,
  externalProjectId,
  getRememberedProjectId,
  projectId,
  resetProjectSelection,
  setProject,
}: UseWorkspaceDefaultProjectAliasRuntimeParams): void {
  useEffect(() => {
    if (!shouldResolveDefaultProjectAlias(externalProjectId, projectId)) {
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    const perfT0 = performance.now();
    logAgentDebug("LocalConversationPage", "resolveDefaultProjectAlias.start", {
      externalProjectId: externalProjectId ?? null,
    });

    void (async () => {
      try {
        const rememberedProjectId = getRememberedProjectId();
        if (rememberedProjectId) {
          const rememberedProject = await getProject(rememberedProjectId);
          if (rememberedProject && !rememberedProject.isArchived) {
            let resolvedRootPath = rememberedProject.rootPath;

            try {
              const ensuredWorkspace = await ensureWorkspaceReady(
                rememberedProject.id,
              );
              resolvedRootPath = ensuredWorkspace.rootPath || resolvedRootPath;
            } catch (error) {
              logAgentDebug(
                "LocalConversationPage",
                "resolveDefaultProjectAlias.ensureRememberedWorkspaceReadyError",
                {
                  error,
                  projectId: rememberedProject.id,
                },
                { level: "warn" },
              );
            }

            if (cancelled) {
              return;
            }

            applyProjectSelection(rememberedProject.id);
            setProject((current) =>
              current?.id === rememberedProject.id &&
              current.rootPath === resolvedRootPath
                ? current
                : {
                    ...rememberedProject,
                    rootPath: resolvedRootPath,
                  },
            );
            logAgentDebug(
              "LocalConversationPage",
              "resolveDefaultProjectAlias.fromRememberedProject",
              {
                durationMs: Date.now() - startedAt,
                projectId: rememberedProject.id,
                rootPath: resolvedRootPath,
              },
            );
            return;
          }
        }

        if (cancelled) {
          return;
        }

        resetProjectSelection();
        setProject(null);
        logAgentDebug("LocalConversationPage", "resolveDefaultProjectAlias.detached", {
          durationMs: Date.now() - startedAt,
        });
        console.info(
          `[PERF] resolveDefaultProjectAlias: ${(performance.now() - perfT0).toFixed(0)}ms`,
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.warn("[LocalConversationPage] 默认工作区别名解析失败:", error);
        logAgentDebug(
          "LocalConversationPage",
          "resolveDefaultProjectAlias.error",
          {
            durationMs: Date.now() - startedAt,
            error,
            externalProjectId: externalProjectId ?? null,
          },
          { level: "warn" },
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    applyProjectSelection,
    externalProjectId,
    getRememberedProjectId,
    projectId,
    resetProjectSelection,
    setProject,
  ]);
}
