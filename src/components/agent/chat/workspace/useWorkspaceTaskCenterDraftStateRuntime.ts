import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ComposerDraftCoordinator } from "@/components/input-kit/ComposerDraftCoordinator";
import type { TaskCenterDraftSendRequest } from "../homePendingPreview";
import { shouldPauseTaskCenterInitialSessionNavigation } from "./agentChatWorkspaceHelpers";

interface UseWorkspaceTaskCenterDraftStateRuntimeParams {
  agentEntry?: string;
  deferSessionRecentMetadataSyncForNavigation: (sessionId: string) => void;
  effectiveThreadItemCount: number;
  hasInitialSessionTopic: boolean;
  initialSessionMessagesCount?: number | null;
  messagesLength: number;
  normalizedInitialSessionId: string | null;
  sessionId?: string | null;
  resetComposerDraft?: () => void;
  composerDraftCoordinator?: ComposerDraftCoordinator;
}

interface WorkspaceTaskCenterDraftStateRuntime {
  homePendingPreviewRequest: TaskCenterDraftSendRequest | null;
  setHomePendingPreviewRequest: Dispatch<
    SetStateAction<TaskCenterDraftSendRequest | null>
  >;
  setTaskCenterDraftSendRequest: Dispatch<
    SetStateAction<TaskCenterDraftSendRequest | null>
  >;
  shouldHydrateEmptyMatchedInitialSession: boolean;
  shouldPauseInitialSessionNavigationForTaskCenterDraft: boolean;
  taskCenterDraftSendRequest: TaskCenterDraftSendRequest | null;
  taskCenterHomeSurfaceActiveRef: MutableRefObject<boolean>;
  handleBeforeTopicSwitch: (topicId: string) => void;
  handleTopicSwitchCommitted: (topicId: string) => void;
}

export function useWorkspaceTaskCenterDraftStateRuntime({
  agentEntry,
  deferSessionRecentMetadataSyncForNavigation,
  effectiveThreadItemCount,
  hasInitialSessionTopic,
  initialSessionMessagesCount,
  messagesLength,
  normalizedInitialSessionId,
  sessionId,
  resetComposerDraft,
  composerDraftCoordinator,
}: UseWorkspaceTaskCenterDraftStateRuntimeParams): WorkspaceTaskCenterDraftStateRuntime {
  const [taskCenterDraftSendRequest, setTaskCenterDraftSendRequest] =
    useState<TaskCenterDraftSendRequest | null>(null);
  const [homePendingPreviewRequest, setHomePendingPreviewRequest] =
    useState<TaskCenterDraftSendRequest | null>(null);
  const taskCenterHomeSurfaceActiveRef = useRef(!normalizedInitialSessionId);
  const previousAgentEntryRef = useRef(agentEntry);

  useLayoutEffect(() => {
    const previousAgentEntry = previousAgentEntryRef.current;
    previousAgentEntryRef.current = agentEntry;

    if (previousAgentEntry !== "new-task" || agentEntry !== "conversation") {
      return;
    }

    composerDraftCoordinator?.prepareNavigation();
    if (!composerDraftCoordinator) resetComposerDraft?.();
    taskCenterHomeSurfaceActiveRef.current = false;
  }, [agentEntry, composerDraftCoordinator, resetComposerDraft]);

  const handleBeforeTopicSwitch = useCallback(
    (topicId: string) => {
      composerDraftCoordinator?.prepareNavigation();
      deferSessionRecentMetadataSyncForNavigation(topicId);
    },
    [composerDraftCoordinator, deferSessionRecentMetadataSyncForNavigation],
  );

  const handleTopicSwitchCommitted = useCallback(
    (topicId: string) => {
      if (
        !composerDraftCoordinator &&
        (topicId.trim() !== sessionId?.trim() ||
          taskCenterHomeSurfaceActiveRef.current)
      ) {
        resetComposerDraft?.();
      }
      taskCenterHomeSurfaceActiveRef.current = topicId.trim() === "";
      setTaskCenterDraftSendRequest(null);
      setHomePendingPreviewRequest(null);
    },
    [composerDraftCoordinator, resetComposerDraft, sessionId],
  );

  const hasTaskCenterHomeHotpathPending = Boolean(
    taskCenterDraftSendRequest || homePendingPreviewRequest,
  );
  const shouldPauseInitialSessionNavigationForTaskCenterDraft =
    shouldPauseTaskCenterInitialSessionNavigation({
      agentEntry,
      draftSurfaceActive: taskCenterHomeSurfaceActiveRef.current,
      hasHomeHotpathPending: hasTaskCenterHomeHotpathPending,
    });
  const shouldHydrateEmptyMatchedInitialSession =
    !hasTaskCenterHomeHotpathPending &&
    Boolean(normalizedInitialSessionId) &&
    normalizedInitialSessionId === (sessionId?.trim() || null) &&
    messagesLength === 0 &&
    effectiveThreadItemCount === 0 &&
    (!hasInitialSessionTopic || (initialSessionMessagesCount ?? 0) > 0);

  return {
    handleBeforeTopicSwitch,
    handleTopicSwitchCommitted,
    homePendingPreviewRequest,
    setHomePendingPreviewRequest,
    setTaskCenterDraftSendRequest,
    shouldHydrateEmptyMatchedInitialSession,
    shouldPauseInitialSessionNavigationForTaskCenterDraft,
    taskCenterDraftSendRequest,
    taskCenterHomeSurfaceActiveRef,
  };
}
