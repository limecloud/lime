import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { ensureWorkspaceReady, type Project } from "@/lib/api/project";
import { logAgentDebug } from "@/lib/agentDebug";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";
import { scheduleMinimumDelayIdleTask } from "@/lib/utils/scheduleMinimumDelayIdleTask";
import type { WorkspacePathMissingState } from "../hooks/agentChatShared";
import { isWorkspacePathErrorMessage } from "../hooks/agentChatCoreUtils";
import { normalizeProjectId } from "../utils/topicProjectResolution";
import {
  isTransientWorkspaceBridgeError,
  SESSION_ENTRY_AUXILIARY_DEFERRED_LOAD_MS,
  shouldAutoRecoverWorkspacePathMissing,
} from "./agentChatWorkspaceHelpers";

type WorkspaceHealthProject =
  | Pick<Project, "id" | "workspaceType">
  | null
  | undefined;

interface UseWorkspaceHealthRuntimeParams {
  enabled?: boolean;
  project: WorkspaceHealthProject;
  projectId?: string | null;
  workspacePathMissing: WorkspacePathMissingState | boolean | null;
  shouldDeferWorkspaceAuxiliaryLoads: boolean;
  deferredWorkspaceAuxiliaryLoadMs?: number;
}

export interface UseWorkspaceHealthRuntimeResult {
  workspaceHealthError: boolean;
  setWorkspaceHealthError: Dispatch<SetStateAction<boolean>>;
}

interface WorkspacePathAutoRecoveryKeyInput {
  workspaceId: string;
  content: string;
  imageCount: number;
}

export function buildWorkspacePathAutoRecoveryKey({
  workspaceId,
  content,
  imageCount,
}: WorkspacePathAutoRecoveryKeyInput): string {
  return [workspaceId, content, imageCount].join(":");
}

export function useWorkspaceHealthRuntime({
  enabled = true,
  project,
  projectId,
  workspacePathMissing,
  shouldDeferWorkspaceAuxiliaryLoads,
  deferredWorkspaceAuxiliaryLoadMs,
}: UseWorkspaceHealthRuntimeParams): UseWorkspaceHealthRuntimeResult {
  const [workspaceHealthError, setWorkspaceHealthError] = useState(false);

  useEffect(() => {
    setWorkspaceHealthError(false);
    if (!enabled) {
      return;
    }

    const normalizedId = normalizeProjectId(projectId);
    if (!normalizedId) {
      return;
    }

    let cancelled = false;
    const runWorkspaceCheck = () => {
      const startedAt = Date.now();
      logAgentDebug("LocalConversationPage", "workspaceCheck.start", {
        projectId: normalizedId,
      });
      void ensureWorkspaceReady(normalizedId)
        .then(({ repaired, rootPath }) => {
          if (cancelled) {
            return;
          }
          if (repaired) {
            recordWorkspaceRepair({
              workspaceId: normalizedId,
              rootPath,
              source: "agent_chat_page",
            });
            console.info("[LocalConversationPage] workspace 目录已自动修复:", rootPath);
          }
          logAgentDebug("LocalConversationPage", "workspaceCheck.success", {
            durationMs: Date.now() - startedAt,
            projectId: normalizedId,
            repaired,
            rootPath,
          });
        })
        .catch((err: unknown) => {
          if (cancelled) {
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          console.warn("[LocalConversationPage] workspace 目录检查失败:", message);
          logAgentDebug(
            "LocalConversationPage",
            "workspaceCheck.error",
            {
              durationMs: Date.now() - startedAt,
              error: err,
              projectId: normalizedId,
            },
            { level: "warn" },
          );
          if (
            isWorkspacePathErrorMessage(message) ||
            !isTransientWorkspaceBridgeError(message)
          ) {
            setWorkspaceHealthError(true);
          }
        });
    };

    const cancelDeferredCheck = shouldDeferWorkspaceAuxiliaryLoads
      ? scheduleMinimumDelayIdleTask(runWorkspaceCheck, {
          minimumDelayMs:
            deferredWorkspaceAuxiliaryLoadMs ??
            SESSION_ENTRY_AUXILIARY_DEFERRED_LOAD_MS,
          idleTimeoutMs: 1_500,
        })
      : null;

    if (!cancelDeferredCheck) {
      runWorkspaceCheck();
    }

    return () => {
      cancelled = true;
      cancelDeferredCheck?.();
    };
  }, [
    deferredWorkspaceAuxiliaryLoadMs,
    enabled,
    projectId,
    shouldDeferWorkspaceAuxiliaryLoads,
  ]);

  useEffect(() => {
    if (!workspacePathMissing || typeof workspacePathMissing === "boolean") {
      return;
    }
    if (!shouldAutoRecoverWorkspacePathMissing(project, workspacePathMissing)) {
      return;
    }

    const sourceWorkspaceId = normalizeProjectId(project?.id);
    if (!sourceWorkspaceId) {
      return;
    }

    const recoveryKey = buildWorkspacePathAutoRecoveryKey({
      workspaceId: sourceWorkspaceId,
      content: workspacePathMissing.content,
      imageCount: workspacePathMissing.images.length,
    });
    logAgentDebug(
      "LocalConversationPage",
      "workspacePathAutoRecovery.skippedNoDefaultProjectFallback",
      {
        projectId: sourceWorkspaceId,
        recoveryKey,
      },
      { level: "warn" },
    );
  }, [project, workspacePathMissing]);

  return {
    workspaceHealthError,
    setWorkspaceHealthError,
  };
}
