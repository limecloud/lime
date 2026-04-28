import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { DEFAULT_CANVAS_STATE } from "@/components/general-chat/bridge";
import type {
  CreationMode,
  LayoutMode,
  ThemeType,
} from "@/lib/workspace/workbenchContract";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { TaskFile } from "../components/TaskFiles";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import type { Character } from "@/lib/api/memory";
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
  resetGuideState: () => void;
  hasHandledNewChatRequest: (requestKey: string) => boolean;
  markNewChatRequestHandled: (requestKey: string) => void;
  defaultTopicSidebarVisible: boolean;
  normalizedInitialTheme: ThemeType;
  initialCreationMode?: CreationMode;
  newChatAt?: number;
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
  setMentionedCharacters: Dispatch<SetStateAction<Character[]>>;
  setActiveTheme: Dispatch<SetStateAction<string>>;
  setCreationMode: Dispatch<SetStateAction<CreationMode>>;
}

export function useWorkspaceResetRuntime({
  clearMessages,
  clearRuntimeTeamState,
  clearProjectSelectionRuntime,
  resetRestoredSessionState,
  resetGuideState,
  hasHandledNewChatRequest,
  markNewChatRequestHandled,
  defaultTopicSidebarVisible,
  normalizedInitialTheme,
  initialCreationMode,
  newChatAt,
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
  setMentionedCharacters,
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
    resetRestoredSessionState();
    resetGuideState();
  }, [
    clearRuntimeTeamState,
    resetGuideState,
    resetRestoredSessionState,
    resetWorkbenchSurface,
  ]);

  const handleBackHome = useCallback(() => {
    clearMessages({
      showToast: false,
    });
    setInput("");
    setSelectedText("");
    setShowSidebar(true);
    resetWorkbenchSurface();
    setActiveTheme("general");
    setCreationMode("guided");
    onNavigate?.("agent", buildHomeAgentParams());
  }, [
    clearMessages,
    onNavigate,
    resetWorkbenchSurface,
    setActiveTheme,
    setCreationMode,
    setInput,
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
    autoCollapsedTopicSidebarRef.current = false;
    setShowSidebar(defaultTopicSidebarVisible);
    resetWorkbenchSurface();
    setMentionedCharacters([]);
    clearProjectSelectionRuntime();
    resetRestoredSessionState();
    resetGuideState();

    if (!externalProjectId) {
      setActiveTheme(normalizedInitialTheme);
      setCreationMode(initialCreationMode ?? "guided");
    }
  }, [
    autoCollapsedTopicSidebarRef,
    clearMessages,
    clearProjectSelectionRuntime,
    defaultTopicSidebarVisible,
    externalProjectId,
    hasHandledNewChatRequest,
    initialCreationMode,
    markNewChatRequestHandled,
    newChatAt,
    normalizedInitialTheme,
    resetGuideState,
    resetRestoredSessionState,
    resetWorkbenchSurface,
    setActiveTheme,
    setCreationMode,
    setInput,
    setMentionedCharacters,
    setSelectedText,
    setShowSidebar,
  ]);

  return {
    handleBackHome,
    resetTopicLocalState,
  };
}
