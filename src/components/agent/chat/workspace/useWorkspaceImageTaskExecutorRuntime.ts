import { useEffect, useRef } from "react";
import type { MediaTaskArtifactOutput } from "@/lib/api/agentRuntime/mediaTaskTypes";
import type {
  ImageWorkbenchTask,
  SessionImageWorkbenchState,
} from "./imageWorkbenchHelpers";
import { buildImageTaskLookupRequest } from "./imageTaskLocator";

interface UseWorkspaceImageTaskExecutorRuntimeParams {
  enabled?: boolean;
  projectRootPath?: string | null;
  currentImageWorkbenchState: SessionImageWorkbenchState;
  getImageTask: (request: {
    projectRootPath: string;
    taskRef: string;
  }) => Promise<MediaTaskArtifactOutput>;
}

function shouldObserveImageTask(task: ImageWorkbenchTask): boolean {
  return (
    task.status === "queued" ||
    task.status === "routing" ||
    task.status === "running"
  );
}

function resolveTaskRef(task: ImageWorkbenchTask): string | null {
  return task.taskFilePath?.trim() || task.artifactPath?.trim() || task.id;
}

export function useWorkspaceImageTaskExecutorRuntime({
  enabled = true,
  projectRootPath,
  currentImageWorkbenchState,
  getImageTask,
}: UseWorkspaceImageTaskExecutorRuntimeParams) {
  const inFlightTaskIdsRef = useRef(new Set<string>());
  const observedTaskIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled || !projectRootPath?.trim()) {
      return;
    }

    const normalizedProjectRootPath = projectRootPath.trim();
    const task = currentImageWorkbenchState.tasks.find((candidate) => {
      if (!shouldObserveImageTask(candidate)) {
        return false;
      }
      if (candidate.outputIds.length > 0 || candidate.hookImageIds.length > 0) {
        return false;
      }
      if (observedTaskIdsRef.current.has(candidate.id)) {
        return false;
      }
      return !inFlightTaskIdsRef.current.has(candidate.id);
    });
    if (!task) {
      return;
    }

    const lookup = buildImageTaskLookupRequest({
      taskId: task.id,
      taskFilePath: task.taskFilePath,
      artifactPath: task.artifactPath,
      projectRootPath: normalizedProjectRootPath,
    });
    const taskRef = lookup?.taskRef || resolveTaskRef(task);
    if (!lookup || !taskRef) {
      return;
    }

    inFlightTaskIdsRef.current.add(task.id);
    observedTaskIdsRef.current.add(task.id);

    void (async () => {
      try {
        await getImageTask(lookup);
      } catch (error) {
        console.warn("[LocalConversationPage] 图片任务状态读取失败:", error);
      } finally {
        inFlightTaskIdsRef.current.delete(task.id);
      }
    })();
  }, [
    currentImageWorkbenchState.tasks,
    enabled,
    getImageTask,
    projectRootPath,
  ]);
}
