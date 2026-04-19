import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { logAgentDebug } from "@/lib/agentDebug";
import {
  getProject,
  getDefaultProject,
  getOrCreateDefaultProject,
} from "@/lib/api/project";
import { normalizeProjectId } from "../utils/topicProjectResolution";
import { resolveTopicSwitchProject } from "../utils/topicProjectSwitch";

interface PendingTopicSwitchState {
  topicId: string;
  targetProjectId: string;
  forceRefresh?: boolean;
}

interface TopicSwitchOptions {
  forceRefresh?: boolean;
}

interface UseWorkspaceTopicSwitchParams {
  projectId?: string;
  externalProjectId?: string | null;
  originalSwitchTopic: (
    topicId: string,
    options?: TopicSwitchOptions,
  ) => Promise<unknown>;
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
  startTopicProjectResolution,
  finishTopicProjectResolution,
  deferTopicSwitch,
  consumePendingTopicSwitch,
  rememberProjectId,
  getRememberedProjectId,
  loadTopicBoundProjectId,
  resetTopicLocalState,
}: UseWorkspaceTopicSwitchParams) {
  const runTopicSwitch = useCallback(
    async (topicId: string, options?: TopicSwitchOptions) => {
      const forwardedOptions =
        options?.forceRefresh === true ? { forceRefresh: true } : undefined;
      const startedAt = Date.now();
      logAgentDebug("AgentChatPage", "runTopicSwitch.start", {
        currentProjectId: projectId ?? null,
        forceRefresh: options?.forceRefresh === true,
        topicId,
      });
      resetTopicLocalState();
      try {
        if (forwardedOptions) {
          await originalSwitchTopic(topicId, forwardedOptions);
        } else {
          await originalSwitchTopic(topicId);
        }
        logAgentDebug("AgentChatPage", "runTopicSwitch.success", {
          durationMs: Date.now() - startedAt,
          forceRefresh: options?.forceRefresh === true,
          topicId,
        });
      } catch (error) {
        logAgentDebug(
          "AgentChatPage",
          "runTopicSwitch.error",
          {
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
    [originalSwitchTopic, projectId, resetTopicLocalState],
  );

  const switchTopic = useCallback(
    async (topicId: string, options?: TopicSwitchOptions) => {
      if (!startTopicProjectResolution()) {
        logAgentDebug(
          "AgentChatPage",
          "switchTopic.skipWhileResolving",
          {
            forceRefresh: options?.forceRefresh === true,
            topicId,
          },
          { level: "warn", throttleMs: 1000 },
        );
        return;
      }

      try {
        logAgentDebug("AgentChatPage", "switchTopic.start", {
          currentProjectId: projectId ?? null,
          externalProjectId: externalProjectId ?? null,
          forceRefresh: options?.forceRefresh === true,
          topicId,
        });
        const decision = await resolveTopicSwitchProject({
          lockedProjectId: externalProjectId ?? null,
          topicBoundProjectId: loadTopicBoundProjectId(topicId),
          lastProjectId: getRememberedProjectId(),
          loadProjectById: async (candidateProjectId) => {
            const project = await getProject(candidateProjectId);
            return project
              ? { id: project.id, isArchived: project.isArchived }
              : null;
          },
          loadDefaultProject: async () => {
            const project = await getDefaultProject();
            return project
              ? { id: project.id, isArchived: project.isArchived }
              : null;
          },
          createDefaultProject: async () => {
            const project = await getOrCreateDefaultProject();
            return project
              ? { id: project.id, isArchived: project.isArchived }
              : null;
          },
        });
        logAgentDebug("AgentChatPage", "switchTopic.decision", {
          createdDefault:
            decision.status === "ok" ? decision.createdDefault : false,
          decisionStatus: decision.status,
          projectId: decision.status === "ok" ? decision.projectId : null,
          topicId,
        });

        if (decision.status === "blocked") {
          toast.error("该任务绑定了其他项目，请先切换到对应项目");
          return;
        }

        if (decision.status === "missing") {
          toast.error("未找到可用项目，请先创建项目");
          return;
        }

        const targetProjectId = decision.projectId;
        if (decision.createdDefault) {
          toast.info("未找到可用项目，已自动创建默认项目");
        }

        const currentProjectId = normalizeProjectId(projectId);
        if (currentProjectId !== targetProjectId) {
          deferTopicSwitch(topicId, targetProjectId, options);
          logAgentDebug("AgentChatPage", "switchTopic.deferUntilProjectReady", {
            currentProjectId,
            forceRefresh: options?.forceRefresh === true,
            targetProjectId,
            topicId,
          });
          return;
        }

        rememberProjectId(targetProjectId);
        await runTopicSwitch(topicId, options);
      } catch (error) {
        console.error("[AgentChatPage] 解析任务项目失败:", error);
        logAgentDebug(
          "AgentChatPage",
          "switchTopic.error",
          {
            error,
            forceRefresh: options?.forceRefresh === true,
            projectId: projectId ?? null,
            topicId,
          },
          { level: "error" },
        );
        toast.error("切换会话失败，请稍后重试");
      } finally {
        finishTopicProjectResolution();
      }
    },
    [
      deferTopicSwitch,
      externalProjectId,
      finishTopicProjectResolution,
      getRememberedProjectId,
      loadTopicBoundProjectId,
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

    const currentProjectId = normalizeProjectId(projectId);
    logAgentDebug("AgentChatPage", "switchTopic.resumePending", {
      forceRefresh: pending.forceRefresh === true,
      projectId: currentProjectId,
      topicId: pending.topicId,
    });
    runTopicSwitch(pending.topicId, {
      forceRefresh: pending.forceRefresh === true,
    }).catch((error) => {
      console.error("[AgentChatPage] 执行待切换任务失败:", error);
      logAgentDebug(
        "AgentChatPage",
        "switchTopic.resumePendingError",
        {
          error,
          forceRefresh: pending.forceRefresh === true,
          projectId: currentProjectId,
          topicId: pending.topicId,
        },
        { level: "error" },
      );
      toast.error("加载会话失败，请重试");
    });
  }, [consumePendingTopicSwitch, projectId, runTopicSwitch]);

  return {
    runTopicSwitch,
    switchTopic,
  };
}
