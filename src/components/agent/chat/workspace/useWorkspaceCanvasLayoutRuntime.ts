import { useCallback, useEffect, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { createInitialCanvasState, type CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import { createInitialDocumentState } from "@/lib/workspace/workbenchCanvas";
import type { CanvasState as GeneralCanvasState } from "@/components/general-chat/bridge";
import type { LayoutMode, ThemeType } from "@/lib/workspace/workbenchContract";
import { isContentCreationTheme } from "@/lib/workspace/workbenchContract";
import type { CanvasWorkbenchLayoutMode } from "../components/CanvasWorkbenchLayout";
import { hasRenderableGeneralCanvasPreview } from "./generalCanvasPreviewState";

const FALLBACK_CANVAS_CONTENT = "# 新文档\n\n在这里开始编写内容...";

interface UseWorkspaceCanvasLayoutRuntimeParams {
  activeTheme: string;
  isThemeWorkbench: boolean;
  hasPendingA2UIForm: boolean;
  layoutMode: LayoutMode;
  showChatPanel: boolean;
  showSidebar: boolean;
  defaultTopicSidebarVisible: boolean;
  hasMessages: boolean;
  canvasWorkbenchLayoutMode: CanvasWorkbenchLayoutMode;
  autoCollapsedTopicSidebarRef: MutableRefObject<boolean>;
  mappedTheme: ThemeType;
  normalizedEntryTheme: ThemeType;
  shouldBootstrapCanvasOnEntry: boolean;
  canvasState: CanvasStateUnion | null;
  generalCanvasState: GeneralCanvasState;
  showTeamWorkspaceBoard: boolean;
  hasCurrentCanvasArtifact: boolean;
  currentCanvasArtifactType?: string | null;
  currentImageWorkbenchActive: boolean;
  isBrowserAssistCanvasVisible: boolean;
  onHasMessagesChange?: (hasMessages: boolean) => void;
  dismissActiveTeamWorkbenchAutoOpen: () => void;
  suppressGeneralCanvasArtifactAutoOpen: () => void;
  suppressBrowserAssistCanvasAutoOpen: () => void;
  setShowSidebar: Dispatch<SetStateAction<boolean>>;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
  setGeneralCanvasState: Dispatch<SetStateAction<GeneralCanvasState>>;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
  setCanvasWorkbenchLayoutMode: Dispatch<
    SetStateAction<CanvasWorkbenchLayoutMode>
  >;
  setNovelChapterListCollapsed: Dispatch<SetStateAction<boolean>>;
}

export function useWorkspaceCanvasLayoutRuntime({
  activeTheme,
  isThemeWorkbench,
  hasPendingA2UIForm,
  layoutMode,
  showChatPanel,
  showSidebar,
  defaultTopicSidebarVisible,
  hasMessages,
  canvasWorkbenchLayoutMode,
  autoCollapsedTopicSidebarRef,
  mappedTheme,
  normalizedEntryTheme,
  shouldBootstrapCanvasOnEntry,
  canvasState,
  generalCanvasState,
  showTeamWorkspaceBoard,
  hasCurrentCanvasArtifact,
  currentCanvasArtifactType,
  currentImageWorkbenchActive,
  isBrowserAssistCanvasVisible,
  onHasMessagesChange,
  dismissActiveTeamWorkbenchAutoOpen,
  suppressGeneralCanvasArtifactAutoOpen,
  suppressBrowserAssistCanvasAutoOpen,
  setShowSidebar,
  setLayoutMode,
  setGeneralCanvasState,
  setCanvasState,
  setCanvasWorkbenchLayoutMode,
  setNovelChapterListCollapsed,
}: UseWorkspaceCanvasLayoutRuntimeParams) {
  useEffect(() => {
    if (!canvasState || canvasState.type !== "novel") {
      setNovelChapterListCollapsed(false);
    }
  }, [canvasState, setNovelChapterListCollapsed]);

  useEffect(() => {
    autoCollapsedTopicSidebarRef.current = false;
    setShowSidebar(defaultTopicSidebarVisible);
  }, [
    autoCollapsedTopicSidebarRef,
    defaultTopicSidebarVisible,
    setShowSidebar,
  ]);

  useEffect(() => {
    if (showChatPanel) {
      setLayoutMode((previous) =>
        previous === "canvas" ? "chat-canvas" : previous,
      );
      return;
    }

    setShowSidebar(false);

    if (layoutMode === "canvas") {
      return;
    }

    if (layoutMode === "chat-canvas") {
      setLayoutMode("canvas");
      return;
    }

    if (activeTheme === "general") {
      setGeneralCanvasState((previous) => ({
        ...previous,
        isOpen: true,
        contentType:
          previous.contentType === "empty" ? "markdown" : previous.contentType,
        content: previous.content || FALLBACK_CANVAS_CONTENT,
      }));
    } else if (!canvasState) {
      const initialState =
        createInitialCanvasState(mappedTheme, FALLBACK_CANVAS_CONTENT) ||
        createInitialDocumentState(FALLBACK_CANVAS_CONTENT);
      setCanvasState(initialState);
    }

    setLayoutMode("canvas");
  }, [
    activeTheme,
    canvasState,
    layoutMode,
    mappedTheme,
    setCanvasState,
    setGeneralCanvasState,
    setLayoutMode,
    setShowSidebar,
    showChatPanel,
  ]);

  useEffect(() => {
    if (!hasPendingA2UIForm) {
      return;
    }

    dismissActiveTeamWorkbenchAutoOpen();
    suppressGeneralCanvasArtifactAutoOpen();
    suppressBrowserAssistCanvasAutoOpen();

    if (isThemeWorkbench && showSidebar) {
      setShowSidebar(false);
    }

    if (layoutMode !== "chat") {
      setLayoutMode("chat");
    }

    if (activeTheme === "general") {
      setGeneralCanvasState((previous) =>
        previous.isOpen ? { ...previous, isOpen: false } : previous,
      );
    }
  }, [
    activeTheme,
    dismissActiveTeamWorkbenchAutoOpen,
    hasPendingA2UIForm,
    isThemeWorkbench,
    layoutMode,
    setGeneralCanvasState,
    setLayoutMode,
    setShowSidebar,
    showSidebar,
    suppressBrowserAssistCanvasAutoOpen,
    suppressGeneralCanvasArtifactAutoOpen,
  ]);

  useEffect(() => {
    if (
      isThemeWorkbench ||
      activeTheme !== "general" ||
      layoutMode !== "chat-canvas"
    ) {
      setCanvasWorkbenchLayoutMode("split");
    }
  }, [
    activeTheme,
    isThemeWorkbench,
    layoutMode,
    setCanvasWorkbenchLayoutMode,
  ]);

  useEffect(() => {
    if (activeTheme !== "general") {
      return;
    }

    if (
      !hasCurrentCanvasArtifact &&
      !currentImageWorkbenchActive &&
      !isBrowserAssistCanvasVisible
    ) {
      return;
    }

    setGeneralCanvasState((previous) =>
      previous.isOpen ? { ...previous, isOpen: false } : previous,
    );
  }, [
    activeTheme,
    currentImageWorkbenchActive,
    hasCurrentCanvasArtifact,
    isBrowserAssistCanvasVisible,
    setGeneralCanvasState,
  ]);

  useEffect(() => {
    if (
      activeTheme !== "general" ||
      !showChatPanel ||
      layoutMode === "chat" ||
      showTeamWorkspaceBoard ||
      hasCurrentCanvasArtifact ||
      currentImageWorkbenchActive ||
      isBrowserAssistCanvasVisible
    ) {
      return;
    }

    if (hasRenderableGeneralCanvasPreview(generalCanvasState)) {
      return;
    }

    setLayoutMode("chat");
  }, [
    activeTheme,
    currentImageWorkbenchActive,
    generalCanvasState,
    hasCurrentCanvasArtifact,
    isBrowserAssistCanvasVisible,
    layoutMode,
    setLayoutMode,
    showChatPanel,
    showTeamWorkspaceBoard,
  ]);

  useEffect(() => {
    const shouldAutoHideTopicSidebar =
      showChatPanel &&
      !isThemeWorkbench &&
      activeTheme === "general" &&
      layoutMode === "chat-canvas" &&
      canvasWorkbenchLayoutMode === "stacked";

    if (shouldAutoHideTopicSidebar) {
      if (showSidebar) {
        autoCollapsedTopicSidebarRef.current = true;
        setShowSidebar(false);
      }
      return;
    }

    const shouldRestoreAutoCollapsedSidebar =
      autoCollapsedTopicSidebarRef.current &&
      !showSidebar &&
      (!showChatPanel ||
        isThemeWorkbench ||
        activeTheme !== "general" ||
        layoutMode !== "chat-canvas");

    if (shouldRestoreAutoCollapsedSidebar) {
      autoCollapsedTopicSidebarRef.current = false;
      setShowSidebar(true);
    }
  }, [
    activeTheme,
    autoCollapsedTopicSidebarRef,
    canvasWorkbenchLayoutMode,
    isThemeWorkbench,
    layoutMode,
    setShowSidebar,
    showChatPanel,
    showSidebar,
  ]);

  useEffect(() => {
    onHasMessagesChange?.(hasMessages);
  }, [hasMessages, onHasMessagesChange]);

  const handleToggleSidebar = useCallback(() => {
    if (!showChatPanel) {
      return;
    }
    setShowSidebar((previous) => !previous);
  }, [setShowSidebar, showChatPanel]);

  const handleToggleNovelChapterList = useCallback(() => {
    setNovelChapterListCollapsed((previous) => !previous);
  }, [setNovelChapterListCollapsed]);

  const handleAddNovelChapter = useCallback(() => {
    setCanvasState((previous) => {
      if (!previous || previous.type !== "novel") {
        return previous;
      }

      const now = Date.now();
      const chapterNumber = previous.chapters.length + 1;
      const title = `第${chapterNumber}章`;
      const newChapter = {
        id: crypto.randomUUID(),
        number: chapterNumber,
        title,
        content: `# ${title}\n\n`,
        wordCount: 0,
        status: "draft" as const,
        createdAt: now,
        updatedAt: now,
      };

      return {
        ...previous,
        chapters: [...previous.chapters, newChapter],
        currentChapterId: newChapter.id,
      };
    });
    setNovelChapterListCollapsed(false);
  }, [setCanvasState, setNovelChapterListCollapsed]);

  const handleToggleCanvas = useCallback(() => {
    if (activeTheme === "general") {
      const shouldManageStandaloneGeneralCanvas =
        !showTeamWorkspaceBoard &&
        !hasCurrentCanvasArtifact &&
        !currentImageWorkbenchActive;

      if (layoutMode !== "chat") {
        dismissActiveTeamWorkbenchAutoOpen();
        suppressGeneralCanvasArtifactAutoOpen();
        if (isBrowserAssistCanvasVisible) {
          suppressBrowserAssistCanvasAutoOpen();
        }
        if (shouldManageStandaloneGeneralCanvas) {
          setGeneralCanvasState((previous) => ({ ...previous, isOpen: false }));
        }
        setLayoutMode("chat");
        return;
      }

      if (shouldManageStandaloneGeneralCanvas) {
        setGeneralCanvasState((previous) => ({
          ...previous,
          isOpen: true,
          contentType:
            previous.contentType === "empty" ? "markdown" : previous.contentType,
          content: previous.content || FALLBACK_CANVAS_CONTENT,
        }));
      }
      setLayoutMode("chat-canvas");
      return;
    }

    setLayoutMode((previous) => {
      if (previous === "chat") {
        if (!canvasState) {
          const initialState =
            createInitialCanvasState(mappedTheme, FALLBACK_CANVAS_CONTENT) ||
            createInitialDocumentState(FALLBACK_CANVAS_CONTENT);
          setCanvasState(initialState);
        }
        return "chat-canvas";
      }

      return "chat";
    });
  }, [
    activeTheme,
    canvasState,
    currentImageWorkbenchActive,
    dismissActiveTeamWorkbenchAutoOpen,
    hasCurrentCanvasArtifact,
    isBrowserAssistCanvasVisible,
    layoutMode,
    mappedTheme,
    setCanvasState,
    setGeneralCanvasState,
    setLayoutMode,
    showTeamWorkspaceBoard,
    suppressBrowserAssistCanvasAutoOpen,
    suppressGeneralCanvasArtifactAutoOpen,
  ]);

  const handleCloseCanvas = useCallback(() => {
    if (activeTheme === "general") {
      dismissActiveTeamWorkbenchAutoOpen();
      suppressGeneralCanvasArtifactAutoOpen();
      if (currentCanvasArtifactType === "browser_assist") {
        suppressBrowserAssistCanvasAutoOpen();
      }
    }
    setLayoutMode("chat");
    setNovelChapterListCollapsed(false);
    if (activeTheme === "general") {
      setGeneralCanvasState((previous) => ({ ...previous, isOpen: false }));
    }
  }, [
    activeTheme,
    currentCanvasArtifactType,
    dismissActiveTeamWorkbenchAutoOpen,
    setGeneralCanvasState,
    setLayoutMode,
    setNovelChapterListCollapsed,
    suppressBrowserAssistCanvasAutoOpen,
    suppressGeneralCanvasArtifactAutoOpen,
  ]);

  const resolvedCanvasState = useMemo<CanvasStateUnion | null>(() => {
    if (canvasState) {
      return canvasState;
    }

    if (shouldBootstrapCanvasOnEntry) {
      return (
        createInitialCanvasState(normalizedEntryTheme, "") ||
        createInitialDocumentState("")
      );
    }

    if (isThemeWorkbench && isContentCreationTheme(activeTheme)) {
      return (
        createInitialCanvasState(mappedTheme, "") ||
        createInitialDocumentState("")
      );
    }

    return null;
  }, [
    activeTheme,
    canvasState,
    isThemeWorkbench,
    mappedTheme,
    normalizedEntryTheme,
    shouldBootstrapCanvasOnEntry,
  ]);

  const showNovelNavbarControls =
    layoutMode !== "chat" && resolvedCanvasState?.type === "novel";

  return {
    handleToggleSidebar,
    handleToggleNovelChapterList,
    handleAddNovelChapter,
    handleToggleCanvas,
    handleCloseCanvas,
    resolvedCanvasState,
    showNovelNavbarControls,
  };
}
