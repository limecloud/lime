import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import { DEFAULT_CANVAS_STATE } from "@/components/general-chat/bridge";
import type { CreationMode, LayoutMode, ThemeType } from "@/lib/workspace/workbenchContract";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { TaskFile } from "../components/TaskFiles";
import type { BrowserTaskPreflight } from "../hooks/handleSendTypes";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import type { Project } from "@/lib/api/project";
import type { Character, ProjectMemory } from "@/lib/api/memory";
import type { Page, PageParams } from "@/types/page";

type SetStringState = Dispatch<SetStateAction<string>>;

interface ClearMessagesOptions {
  showToast?: boolean;
}

interface UseWorkspaceResetRuntimeParams {
  clearMessages: (options?: ClearMessagesOptions) => void;
  clearRuntimeTeamState: () => void;
  clearProjectSelectionRuntime: () => void;
  resetRestoredSessionState: () => void;
  resetProjectSelection: () => void;
  resetGuideState: () => void;
  hasHandledNewChatRequest: (requestKey: string) => boolean;
  markNewChatRequestHandled: (requestKey: string) => void;
  createFreshSession: (sessionName?: string) => Promise<string | null>;
  defaultTopicSidebarVisible: boolean;
  normalizedInitialTheme: ThemeType;
  initialCreationMode?: CreationMode;
  newChatAt?: number;
  initialSessionName?: string;
  projectId?: string;
  externalProjectId?: string | null;
  onNavigate?: (page: Page, params?: PageParams) => void;
  autoCollapsedTopicSidebarRef: MutableRefObject<boolean>;
  processedMessageIdsRef: MutableRefObject<Set<string>>;
  setInput: SetStringState;
  setSelectedText: SetStringState;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
  setShowSidebar: Dispatch<SetStateAction<boolean>>;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
  setGeneralCanvasState: Dispatch<SetStateAction<typeof DEFAULT_CANVAS_STATE>>;
  setTaskFiles: Dispatch<SetStateAction<TaskFile[]>>;
  setSelectedFileId: Dispatch<SetStateAction<string | undefined>>;
  setBrowserTaskPreflight: Dispatch<
    SetStateAction<BrowserTaskPreflight | null>
  >;
  setMentionedCharacters: Dispatch<SetStateAction<Character[]>>;
  setProject: Dispatch<SetStateAction<Project | null>>;
  setProjectMemory: Dispatch<SetStateAction<ProjectMemory | null>>;
  setActiveTheme: Dispatch<SetStateAction<string>>;
  setCreationMode: Dispatch<SetStateAction<CreationMode>>;
}

export function useWorkspaceResetRuntime({
  clearMessages,
  clearRuntimeTeamState,
  clearProjectSelectionRuntime,
  resetRestoredSessionState,
  resetProjectSelection,
  resetGuideState,
  hasHandledNewChatRequest,
  markNewChatRequestHandled,
  createFreshSession,
  defaultTopicSidebarVisible,
  normalizedInitialTheme,
  initialCreationMode,
  newChatAt,
  initialSessionName,
  projectId,
  externalProjectId,
  onNavigate,
  autoCollapsedTopicSidebarRef,
  processedMessageIdsRef,
  setInput,
  setSelectedText,
  setLayoutMode,
  setShowSidebar,
  setCanvasState,
  setGeneralCanvasState,
  setTaskFiles,
  setSelectedFileId,
  setBrowserTaskPreflight,
  setMentionedCharacters,
  setProject,
  setProjectMemory,
  setActiveTheme,
  setCreationMode,
}: UseWorkspaceResetRuntimeParams) {
  const resetWorkbenchSurface = useCallback(() => {
    setLayoutMode("chat");
    setCanvasState(null);
    setGeneralCanvasState(DEFAULT_CANVAS_STATE);
    setTaskFiles([]);
    setSelectedFileId(undefined);
    processedMessageIdsRef.current.clear();
  }, [
    processedMessageIdsRef,
    setCanvasState,
    setGeneralCanvasState,
    setLayoutMode,
    setSelectedFileId,
    setTaskFiles,
  ]);

  const resetTopicLocalState = useCallback(() => {
    resetWorkbenchSurface();
    clearRuntimeTeamState();
    setBrowserTaskPreflight(null);
    resetRestoredSessionState();
    resetGuideState();
  }, [
    clearRuntimeTeamState,
    resetGuideState,
    resetRestoredSessionState,
    resetWorkbenchSurface,
    setBrowserTaskPreflight,
  ]);

  const handleBackHome = useCallback(() => {
    clearMessages({
      showToast: false,
    });
    setInput("");
    setSelectedText("");
    setShowSidebar(true);
    resetWorkbenchSurface();
    resetProjectSelection();
    setProject(null);
    setProjectMemory(null);
    setActiveTheme("general");
    setCreationMode("guided");
    onNavigate?.("agent", buildHomeAgentParams());
  }, [
    clearMessages,
    onNavigate,
    resetProjectSelection,
    resetWorkbenchSurface,
    setActiveTheme,
    setCreationMode,
    setInput,
    setProject,
    setProjectMemory,
    setSelectedText,
    setShowSidebar,
  ]);

  useEffect(() => {
    if (!newChatAt) {
      return;
    }

    const requestKey = String(newChatAt);
    if (hasHandledNewChatRequest(requestKey)) {
      return;
    }
    markNewChatRequestHandled(requestKey);

    clearMessages({
      showToast: false,
    });
    setInput("");
    setSelectedText("");
    setBrowserTaskPreflight(null);
    autoCollapsedTopicSidebarRef.current = false;
    setShowSidebar(defaultTopicSidebarVisible);
    resetWorkbenchSurface();
    setMentionedCharacters([]);
    clearProjectSelectionRuntime();
    resetRestoredSessionState();
    resetGuideState();

    if (!externalProjectId) {
      resetProjectSelection();
      setProject(null);
      setProjectMemory(null);
      setActiveTheme(normalizedInitialTheme);
      setCreationMode(initialCreationMode ?? "guided");
    }

    const canCreateFreshSession = Boolean(projectId?.trim());
    if (!canCreateFreshSession) {
      return;
    }

    let disposed = false;

    void (async () => {
      const newSessionId = await createFreshSession(initialSessionName);
      if (disposed) {
        return;
      }

      if (newSessionId) {
        return;
      }

      toast.error("创建新任务失败，请重试。");
    })();

    return () => {
      disposed = true;
    };
  }, [
    autoCollapsedTopicSidebarRef,
    clearMessages,
    clearProjectSelectionRuntime,
    createFreshSession,
    defaultTopicSidebarVisible,
    externalProjectId,
    hasHandledNewChatRequest,
    initialCreationMode,
    initialSessionName,
    markNewChatRequestHandled,
    newChatAt,
    normalizedInitialTheme,
    projectId,
    resetGuideState,
    resetProjectSelection,
    resetRestoredSessionState,
    resetWorkbenchSurface,
    setActiveTheme,
    setBrowserTaskPreflight,
    setCreationMode,
    setInput,
    setMentionedCharacters,
    setProject,
    setProjectMemory,
    setSelectedText,
    setShowSidebar,
  ]);

  return {
    handleBackHome,
    resetTopicLocalState,
  };
}
