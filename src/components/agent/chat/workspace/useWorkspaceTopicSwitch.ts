import { useCallback, useEffect, useRef } from "react";
import type { DraftScope } from "@/lib/api/persistedAtomTypes";
import type { ComposerDraftCoordinator } from "@/components/input-kit/ComposerDraftCoordinator";
import { toast } from "sonner";
import { logAgentDebug } from "@/lib/agentDebug";
import { getProject } from "@/lib/api/project";
import { normalizeProjectId } from "../utils/topicProjectResolution";
import { resolveTopicSwitchProject } from "../utils/topicProjectSwitch";

interface PendingTopicSwitchState {
  topicId: string;
  targetProjectId: string;
  forceRefresh?: boolean;
  resumeSessionStartHooks?: boolean;
  allowDetachedSession?: boolean;
}

interface TopicSwitchOptions {
  forceRefresh?: boolean;
  resumeSessionStartHooks?: boolean;
  allowDetachedSession?: boolean;
}

/** Local hydration lifecycle; never forwarded to runtime session options. */
export interface WorkspaceTopicSwitchLifecycle {
  onHydrated: () => void;
}

interface ComposerDraftNavigationSource {
  coordinator: ComposerDraftCoordinator | undefined;
  sourceGeneration: number | undefined;
  sourceScope: DraftScope | null;
  navigationEpoch: number | undefined;
}

export type WorkspaceTopicSwitchResult =
  | "success"
  | "deferred"
  | "blocked"
  | "missing"
  | "busy"
  | "error"
  | "superseded";

interface UseWorkspaceTopicSwitchParams {
  projectId?: string;
  externalProjectId?: string | null;
  originalSwitchTopic: (
    topicId: string,
    options?: TopicSwitchOptions,
  ) => Promise<unknown>;
  onBeforeTopicSwitch?: (topicId: string) => void;
  onAfterTopicSwitch?: (
    topicId: string,
    workspaceId: string | null,
    capturedNavigationEpoch?: number,
  ) => void;
  composerDraftCoordinator?: ComposerDraftCoordinator;
  getComposerDraftNavigationEpoch?: () => number;
  startTopicProjectResolution: () => boolean;
  finishTopicProjectResolution: () => void;
  deferTopicSwitch: (
    topicId: string,
    targetProjectId: string,
    options?: TopicSwitchOptions,
  ) => void;
  consumePendingTopicSwitch: (
    currentProjectId?: string | null,
  ) => PendingTopicSwitchState | null;
  rememberProjectId: (nextProjectId?: string | null) => void;
  getRememberedProjectId: () => string | null;
  loadTopicBoundProjectId: (topicId: string) => string | null;
  resetTopicLocalState: () => void;
}

export function useWorkspaceTopicSwitch({
  projectId,
  externalProjectId,
  originalSwitchTopic,
  onBeforeTopicSwitch,
  onAfterTopicSwitch,
  composerDraftCoordinator,
  getComposerDraftNavigationEpoch,
  startTopicProjectResolution,
  finishTopicProjectResolution,
  deferTopicSwitch,
  consumePendingTopicSwitch,
  rememberProjectId,
  getRememberedProjectId,
  loadTopicBoundProjectId,
  resetTopicLocalState,
}: UseWorkspaceTopicSwitchParams) {
  const topicSwitchRequestVersionRef = useRef(0);
  const currentDraftRuntimeRef = useRef({
    composerDraftCoordinator,
    getComposerDraftNavigationEpoch,
  });
  currentDraftRuntimeRef.current = {
    composerDraftCoordinator,
    getComposerDraftNavigationEpoch,
  };
  const deferredNavigationRef = useRef<
    | (ComposerDraftNavigationSource & {
        topicId: string;
        requestVersion: number;
        lifecycle?: WorkspaceTopicSwitchLifecycle;
      })
    | null
  >(null);
  const captureNavigationSource =
    useCallback((): ComposerDraftNavigationSource => {
      const runtime = currentDraftRuntimeRef.current;
      const snapshot = runtime.composerDraftCoordinator?.getSnapshot();
      return {
        coordinator: runtime.composerDraftCoordinator,
        sourceGeneration: snapshot?.generation,
        sourceScope: snapshot?.scope ?? null,
        navigationEpoch: runtime.getComposerDraftNavigationEpoch?.(),
      };
    }, []);
  const isNavigationSourceCurrent = useCallback(
    (source: ComposerDraftNavigationSource) => {
      const current = captureNavigationSource();
      return (
        source.coordinator === current.coordinator &&
        source.sourceGeneration === current.sourceGeneration &&
        source.navigationEpoch === current.navigationEpoch &&
        source.sourceScope?.workspaceId === current.sourceScope?.workspaceId &&
        source.sourceScope?.kind === current.sourceScope?.kind &&
        source.sourceScope?.id === current.sourceScope?.id
      );
    },
    [captureNavigationSource],
  );
  const runTopicSwitch = useCallback(
    async (
      topicId: string,
      options?: TopicSwitchOptions,
      runOptions?: {
        skipBeforeSwitch?: boolean;
        requestVersion?: number;
        source?: ComposerDraftNavigationSource;
        lifecycle?: WorkspaceTopicSwitchLifecycle;
      },
    ) => {
      const requestVersion =
        runOptions?.requestVersion ?? ++topicSwitchRequestVersionRef.current;
      const source = runOptions?.source ?? captureNavigationSource();
      if (!isNavigationSourceCurrent(source)) return "superseded" as const;
      const committedWorkspaceId = normalizeProjectId(projectId);
      const forwardedOptions =
        options?.forceRefresh === true ||
        options?.resumeSessionStartHooks === true ||
        options?.allowDetachedSession === true
          ? {
              ...(options?.forceRefresh === true ? { forceRefresh: true } : {}),
              ...(options?.resumeSessionStartHooks === true
                ? { resumeSessionStartHooks: true }
                : {}),
              ...(options?.allowDetachedSession === true
                ? { allowDetachedSession: true }
                : {}),
            }
          : undefined;
      const startedAt = Date.now();
      logAgentDebug("LocalConversationPage", "runTopicSwitch.start", {
        allowDetachedSession: options?.allowDetachedSession === true,
        currentProjectId: projectId ?? null,
        forceRefresh: options?.forceRefresh === true,
        topicId,
      });
      if (runOptions?.skipBeforeSwitch !== true) {
        composerDraftCoordinator?.prepareNavigation();
        onBeforeTopicSwitch?.(topicId);
      }
      try {
        const hydrationResult = forwardedOptions
          ? await originalSwitchTopic(topicId, forwardedOptions)
          : await originalSwitchTopic(topicId);
        if (hydrationResult !== undefined && hydrationResult !== "success") {
          logAgentDebug(
            "LocalConversationPage",
            "runTopicSwitch.error",
            {
              allowDetachedSession: options?.allowDetachedSession === true,
              durationMs: Date.now() - startedAt,
              forceRefresh: options?.forceRefresh === true,
              hydrationResult,
              topicId,
            },
            { level: "error" },
          );
          return hydrationResult === "blocked" ||
            hydrationResult === "busy" ||
            hydrationResult === "deferred" ||
            hydrationResult === "missing" ||
            hydrationResult === "superseded"
            ? hydrationResult
            : ("error" as const);
        }
        if (
          requestVersion !== topicSwitchRequestVersionRef.current ||
          !isNavigationSourceCurrent(source)
        ) {
          return "superseded" as const;
        }
        resetTopicLocalState();
        runOptions?.lifecycle?.onHydrated();
        if (source.navigationEpoch === undefined) {
          onAfterTopicSwitch?.(topicId, committedWorkspaceId);
        } else {
          onAfterTopicSwitch?.(
            topicId,
            committedWorkspaceId,
            source.navigationEpoch,
          );
        }
        logAgentDebug("LocalConversationPage", "runTopicSwitch.success", {
          allowDetachedSession: options?.allowDetachedSession === true,
          durationMs: Date.now() - startedAt,
          forceRefresh: options?.forceRefresh === true,
          topicId,
        });
        return "success" as const;
      } catch (error) {
        logAgentDebug(
          "LocalConversationPage",
          "runTopicSwitch.error",
          {
            allowDetachedSession: options?.allowDetachedSession === true,
            durationMs: Date.now() - startedAt,
            error,
            forceRefresh: options?.forceRefresh === true,
            topicId,
          },
          { level: "error" },
        );
        throw error;
      }
    },
    [
      composerDraftCoordinator,
      captureNavigationSource,
      isNavigationSourceCurrent,
      onAfterTopicSwitch,
      onBeforeTopicSwitch,
      originalSwitchTopic,
      projectId,
      resetTopicLocalState,
    ],
  );

  const switchTopic = useCallback(
    async (
      topicId: string,
      options?: TopicSwitchOptions,
      lifecycle?: WorkspaceTopicSwitchLifecycle,
    ) => {
      composerDraftCoordinator?.prepareNavigation();
      if (!startTopicProjectResolution()) {
        logAgentDebug(
          "LocalConversationPage",
          "switchTopic.skipWhileResolving",
          {
            allowDetachedSession: options?.allowDetachedSession === true,
            forceRefresh: options?.forceRefresh === true,
            topicId,
          },
          { level: "warn", throttleMs: 1000 },
        );
        return "busy" as const;
      }

      const requestVersion = ++topicSwitchRequestVersionRef.current;
      const source = captureNavigationSource();
      let resolutionActive = true;
      const finishResolutionIfNeeded = () => {
        if (!resolutionActive) {
          return;
        }
        resolutionActive = false;
        finishTopicProjectResolution();
      };

      try {
        onBeforeTopicSwitch?.(topicId);
        const currentProjectId = normalizeProjectId(projectId);
        const topicBoundProjectId = normalizeProjectId(
          loadTopicBoundProjectId(topicId),
        );
        logAgentDebug("LocalConversationPage", "switchTopic.start", {
          allowDetachedSession: options?.allowDetachedSession === true,
          currentProjectId: currentProjectId ?? null,
          externalProjectId: externalProjectId ?? null,
          forceRefresh: options?.forceRefresh === true,
          topicId,
        });

        if (
          options?.allowDetachedSession === true &&
          !currentProjectId &&
          !topicBoundProjectId
        ) {
          logAgentDebug(
            "LocalConversationPage",
            "switchTopic.detachedSessionFastPath",
            {
              topicId,
            },
          );
          finishResolutionIfNeeded();
          return await runTopicSwitch(topicId, options, {
            skipBeforeSwitch: true,
            requestVersion,
            source,
            lifecycle,
          });
        }

        if (
          currentProjectId &&
          (!topicBoundProjectId || topicBoundProjectId === currentProjectId)
        ) {
          rememberProjectId(currentProjectId);
          logAgentDebug("LocalConversationPage", "switchTopic.fastPathCurrentProject", {
            allowDetachedSession: options?.allowDetachedSession === true,
            currentProjectId,
            externalProjectId: externalProjectId ?? null,
            forceRefresh: options?.forceRefresh === true,
            topicBoundProjectId: topicBoundProjectId ?? null,
            topicId,
          });
          finishResolutionIfNeeded();
          return await runTopicSwitch(topicId, options, {
            skipBeforeSwitch: true,
            requestVersion,
            source,
            lifecycle,
          });
        }

        const decision = await resolveTopicSwitchProject({
          lockedProjectId: externalProjectId ?? null,
          topicBoundProjectId,
          lastProjectId: getRememberedProjectId(),
          loadProjectById: async (candidateProjectId) => {
            const project = await getProject(candidateProjectId);
            return project
              ? { id: project.id, isArchived: project.isArchived }
              : null;
          },
        });
        if (
          requestVersion !== topicSwitchRequestVersionRef.current ||
          !isNavigationSourceCurrent(source)
        ) {
          return "superseded" as const;
        }
        logAgentDebug("LocalConversationPage", "switchTopic.decision", {
          decisionStatus: decision.status,
          projectId: decision.status === "ok" ? decision.projectId : null,
          topicId,
        });

        if (decision.status === "blocked") {
          return "blocked" as const;
        }

        if (decision.status === "missing") {
          toast.error("未找到可用项目，请先创建项目");
          return "missing" as const;
        }

        const targetProjectId = decision.projectId;
        if (currentProjectId !== targetProjectId) {
          deferredNavigationRef.current = {
            topicId,
            requestVersion,
            lifecycle,
            ...source,
          };
          deferTopicSwitch(topicId, targetProjectId, options);
          logAgentDebug("LocalConversationPage", "switchTopic.deferUntilProjectReady", {
            allowDetachedSession: options?.allowDetachedSession === true,
            currentProjectId,
            forceRefresh: options?.forceRefresh === true,
            targetProjectId,
            topicId,
          });
          return "deferred" as const;
        }

        rememberProjectId(targetProjectId);
        finishResolutionIfNeeded();
        return await runTopicSwitch(topicId, options, {
          skipBeforeSwitch: true,
          requestVersion,
          source,
          lifecycle,
        });
      } catch (error) {
        console.error("[LocalConversationPage] 解析任务项目失败:", error);
        logAgentDebug(
          "LocalConversationPage",
          "switchTopic.error",
          {
            allowDetachedSession: options?.allowDetachedSession === true,
            error,
            forceRefresh: options?.forceRefresh === true,
            projectId: projectId ?? null,
            topicId,
          },
          { level: "error" },
        );
        toast.error("切换会话失败，请稍后重试");
        return "error" as const;
      } finally {
        finishResolutionIfNeeded();
      }
    },
    [
      composerDraftCoordinator,
      captureNavigationSource,
      isNavigationSourceCurrent,
      deferTopicSwitch,
      externalProjectId,
      finishTopicProjectResolution,
      getRememberedProjectId,
      loadTopicBoundProjectId,
      onBeforeTopicSwitch,
      projectId,
      rememberProjectId,
      runTopicSwitch,
      startTopicProjectResolution,
    ],
  );

  useEffect(() => {
    const pending = consumePendingTopicSwitch(projectId);
    if (!pending) {
      return;
    }

    const source = deferredNavigationRef.current;
    deferredNavigationRef.current = null;
    if (
      source &&
      (source.topicId !== pending.topicId ||
        source.requestVersion !== topicSwitchRequestVersionRef.current ||
        !isNavigationSourceCurrent(source))
    ) {
      return;
    }
    const currentProjectId = normalizeProjectId(projectId);
    logAgentDebug("LocalConversationPage", "switchTopic.resumePending", {
      allowDetachedSession: pending.allowDetachedSession === true,
      forceRefresh: pending.forceRefresh === true,
      resumeSessionStartHooks: pending.resumeSessionStartHooks === true,
      projectId: currentProjectId,
      topicId: pending.topicId,
    });
    runTopicSwitch(
      pending.topicId,
      {
        allowDetachedSession: pending.allowDetachedSession === true,
        forceRefresh: pending.forceRefresh === true,
        resumeSessionStartHooks: pending.resumeSessionStartHooks === true,
      },
      source
        ? {
            requestVersion: source.requestVersion,
            source,
            lifecycle: source.lifecycle,
          }
        : undefined,
    ).catch((error) => {
      console.error("[LocalConversationPage] 执行待切换任务失败:", error);
      logAgentDebug(
        "LocalConversationPage",
        "switchTopic.resumePendingError",
        {
          allowDetachedSession: pending.allowDetachedSession === true,
          error,
          forceRefresh: pending.forceRefresh === true,
          resumeSessionStartHooks: pending.resumeSessionStartHooks === true,
          projectId: currentProjectId,
          topicId: pending.topicId,
        },
        { level: "error" },
      );
      toast.error("加载会话失败，请重试");
    });
  }, [
    composerDraftCoordinator,
    getComposerDraftNavigationEpoch,
    isNavigationSourceCurrent,
    consumePendingTopicSwitch,
    projectId,
    runTopicSwitch,
  ]);

  return {
    runTopicSwitch,
    switchTopic,
  };
}
