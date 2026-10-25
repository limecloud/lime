import {
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";

export interface ConversationSidebarKeyParams {
  contentId?: string | null;
  externalProjectId?: string | null;
  newChatAt?: number | null;
  normalizedEntryTheme: string;
  sessionId?: string | null;
  shouldCollapseConversationSidebar: boolean;
}

export interface UseConversationSidebarParams extends ConversationSidebarKeyParams {
  setShowSidebar: Dispatch<SetStateAction<boolean>>;
}

export function buildConversationSidebarKey({
  contentId,
  externalProjectId,
  newChatAt,
  normalizedEntryTheme,
  sessionId,
  shouldCollapseConversationSidebar,
}: ConversationSidebarKeyParams): string | null {
  if (!shouldCollapseConversationSidebar) {
    return null;
  }

  return JSON.stringify({
    projectId: externalProjectId ?? null,
    contentId: contentId ?? null,
    sessionId: sessionId ?? null,
    theme: normalizedEntryTheme,
    newChatAt: newChatAt ?? null,
  });
}

export function useConversationSidebar({
  contentId,
  externalProjectId,
  newChatAt,
  normalizedEntryTheme,
  sessionId,
  shouldCollapseConversationSidebar,
  setShowSidebar,
}: UseConversationSidebarParams) {
  const autoCollapsedTopicSidebarRef = useRef(false);
  const entryResetKey = useMemo(
    () =>
      buildConversationSidebarKey({
        contentId,
        externalProjectId,
        newChatAt,
        normalizedEntryTheme,
        sessionId,
        shouldCollapseConversationSidebar,
      }),
    [
      contentId,
      externalProjectId,
      newChatAt,
      normalizedEntryTheme,
      sessionId,
      shouldCollapseConversationSidebar,
    ],
  );

  useEffect(() => {
    if (!shouldCollapseConversationSidebar) {
      return;
    }

    autoCollapsedTopicSidebarRef.current = false;
    setShowSidebar(false);
  }, [entryResetKey, setShowSidebar, shouldCollapseConversationSidebar]);

  return {
    autoCollapsedTopicSidebarRef,
  };
}
