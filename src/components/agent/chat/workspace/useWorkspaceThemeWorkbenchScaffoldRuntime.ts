import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { safeListen } from "@/lib/dev-bridge";
import {
  createInitialCanvasState,
  type CanvasStateUnion,
} from "@/lib/workspace/workbenchCanvas";
import { createInitialDocumentState } from "@/lib/workspace/workbenchCanvas";
import type { LayoutMode, ThemeType } from "@/lib/workspace/workbenchContract";
import type { ThemeWorkbenchCreationTaskEvent } from "../components/themeWorkbenchWorkflowData";
import { useTopicBranchBoard } from "../hooks";
import type { TopicBranchStatus } from "../hooks/useTopicBranchBoard";

const THEME_WORKBENCH_CREATION_TASK_EVENT_NAME =
  "lime://creation_task_submitted";
const MAX_THEME_WORKBENCH_CREATION_TASK_EVENTS = 120;

interface CreationTaskSubmittedPayload {
  task_id?: string;
  task_type?: string;
  path?: string;
  absolute_path?: string;
}

function normalizeThemeWorkbenchCreationTaskEvent(
  payload: CreationTaskSubmittedPayload,
): ThemeWorkbenchCreationTaskEvent | null {
  const taskId = payload.task_id?.trim();
  const taskType = payload.task_type?.trim();
  const path = payload.path?.trim();
  if (!taskId || !taskType || !path) {
    return null;
  }
  const createdAt = Date.now();
  return {
    taskId,
    taskType,
    path,
    absolutePath: payload.absolute_path?.trim() || undefined,
    createdAt,
    timeLabel: new Date(createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

interface UseWorkspaceThemeWorkbenchScaffoldRuntimeParams {
  isThemeWorkbench: boolean;
  mappedTheme: ThemeType;
  sessionId?: string | null;
  projectId?: string | null;
  canvasState: CanvasStateUnion | null;
  documentVersionStatusMap: Record<string, TopicBranchStatus>;
  setDocumentVersionStatusMap: Dispatch<
    SetStateAction<Record<string, TopicBranchStatus>>
  >;
  clearThemeSkillsRailState: () => void;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
}

export function useWorkspaceThemeWorkbenchScaffoldRuntime({
  isThemeWorkbench,
  mappedTheme,
  sessionId,
  projectId,
  canvasState,
  documentVersionStatusMap,
  setDocumentVersionStatusMap,
  clearThemeSkillsRailState,
  setCanvasState,
  setLayoutMode,
}: UseWorkspaceThemeWorkbenchScaffoldRuntimeParams) {
  const [themeWorkbenchSidebarCollapsed, setThemeWorkbenchSidebarCollapsed] =
    useState(false);
  const [
    themeWorkbenchCreationTaskEvents,
    setThemeWorkbenchCreationTaskEvents,
  ] = useState<ThemeWorkbenchCreationTaskEvent[]>([]);

  const shouldUseCompactThemeWorkbench =
    isThemeWorkbench && mappedTheme === "video";
  const shouldSkipThemeWorkbenchAutoGuideWithoutPrompt =
    isThemeWorkbench && shouldUseCompactThemeWorkbench;
  const enableThemeWorkbenchPanelCollapse =
    isThemeWorkbench && mappedTheme === "social-media";

  useEffect(() => {
    if (!isThemeWorkbench) {
      clearThemeSkillsRailState();
    }
  }, [isThemeWorkbench, clearThemeSkillsRailState]);

  useEffect(() => {
    return () => {
      clearThemeSkillsRailState();
    };
  }, [clearThemeSkillsRailState]);

  useEffect(() => {
    if (!isThemeWorkbench) {
      setThemeWorkbenchCreationTaskEvents([]);
    }
  }, [isThemeWorkbench]);

  useEffect(() => {
    if (!isThemeWorkbench || !sessionId) {
      return;
    }

    setThemeWorkbenchCreationTaskEvents([]);

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    safeListen<CreationTaskSubmittedPayload>(
      THEME_WORKBENCH_CREATION_TASK_EVENT_NAME,
      (event) => {
        if (cancelled) {
          return;
        }
        const normalized = normalizeThemeWorkbenchCreationTaskEvent(
          event.payload || {},
        );
        if (!normalized) {
          return;
        }
        setThemeWorkbenchCreationTaskEvents((previous) => {
          const deduplicated = previous.filter(
            (item) =>
              item.taskId !== normalized.taskId &&
              item.path !== normalized.path,
          );
          return [normalized, ...deduplicated].slice(
            0,
            MAX_THEME_WORKBENCH_CREATION_TASK_EVENTS,
          );
        });
      },
    )
      .then((dispose) => {
        if (cancelled) {
          void dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch((error) => {
        console.warn("[AgentChatPage] 监听任务提交事件失败:", error);
      });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [isThemeWorkbench, sessionId]);

  useEffect(() => {
    if (!isThemeWorkbench || canvasState) {
      return;
    }

    const initialThemeWorkbenchCanvas =
      createInitialCanvasState(mappedTheme, "") ||
      createInitialDocumentState("");
    if (!initialThemeWorkbenchCanvas) {
      return;
    }

    setCanvasState(initialThemeWorkbenchCanvas);
    setLayoutMode((previous) => (previous === "chat" ? "canvas" : previous));
  }, [canvasState, isThemeWorkbench, mappedTheme, setCanvasState, setLayoutMode]);

  useEffect(() => {
    if (enableThemeWorkbenchPanelCollapse) {
      return;
    }
    setThemeWorkbenchSidebarCollapsed(false);
  }, [enableThemeWorkbenchPanelCollapse]);

  const versionTopics = useMemo(() => {
    if (!isThemeWorkbench || !canvasState || canvasState.type !== "document") {
      return [];
    }
    return canvasState.versions.map((version, index) => ({
      id: version.id,
      title: version.description?.trim() || `版本 ${index + 1}`,
      messagesCount: version.content.trim() ? 2 : 0,
    }));
  }, [canvasState, isThemeWorkbench]);

  const currentVersionId =
    isThemeWorkbench && canvasState?.type === "document"
      ? canvasState.currentVersionId
      : null;

  const { branchItems, setTopicStatus } = useTopicBranchBoard({
    enabled: isThemeWorkbench && canvasState?.type === "document",
    projectId: projectId ?? undefined,
    currentTopicId: currentVersionId,
    topics: versionTopics,
    externalStatusMap: documentVersionStatusMap,
    onStatusMapChange: setDocumentVersionStatusMap,
  });

  return {
    shouldUseCompactThemeWorkbench,
    shouldSkipThemeWorkbenchAutoGuideWithoutPrompt,
    enableThemeWorkbenchPanelCollapse,
    themeWorkbenchSidebarCollapsed,
    setThemeWorkbenchSidebarCollapsed,
    themeWorkbenchCreationTaskEvents,
    branchItems,
    setTopicStatus,
  };
}
