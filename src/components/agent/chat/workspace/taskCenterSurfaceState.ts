import type { TaskCenterDraftSendRequest } from "../homePendingPreview";
import {
  isTaskCenterDraftSendPendingForLayout,
  resolveTaskCenterHomeSurfaceState,
  shouldSuppressTaskCenterDraftContentForLayout,
  type TaskCenterHomeSurfaceState,
} from "./agentChatWorkspaceHelpers";

interface ResolveTaskCenterDraftSurfaceStateParams {
  agentEntry: string;
  isTaskCenterEntry: boolean;
  draftSurfaceActive: boolean;
  initialSessionId?: string | null;
  sessionId?: string | null;
  draftSendRequest: TaskCenterDraftSendRequest | null;
  hasHomePendingPreview?: boolean;
  displayMessageCount: number;
  threadItemCount: number;
  hasLocalSessionOverride?: boolean;
  hasPendingA2UIForm: boolean;
  isPreparingSend: boolean;
  isSending: boolean;
  queuedTurnCount: number;
}

export interface TaskCenterDraftSurfaceState {
  isTaskCenterDraftSurfaceActive: boolean;
  isTaskCenterDraftSendInFlight: boolean;
  hasVisibleSessionActivityForDraftSurface: boolean;
  shouldSuppressTaskCenterDraftContent: boolean;
}

export function hasTaskCenterPendingPreviewActivity(
  isHomePendingPreviewActive: boolean,
  bootstrapPendingPreviewMessageCount: number,
): boolean {
  return isHomePendingPreviewActive || bootstrapPendingPreviewMessageCount > 0;
}

export function shouldPrioritizeTaskCenterInitialSessionRoute({
  agentEntry,
  initialSessionId,
  sessionId,
}: {
  agentEntry: string;
  initialSessionId?: string | null;
  sessionId?: string | null;
}): boolean {
  const normalizedInitialSessionId = initialSessionId?.trim() || null;
  const normalizedSessionId = sessionId?.trim() || null;
  return Boolean(
    agentEntry === "conversation" &&
    normalizedInitialSessionId &&
    normalizedInitialSessionId !== normalizedSessionId,
  );
}

interface ResolveTaskCenterHomeChromeStateParams {
  agentEntry: string;
  draftSurfaceActive: boolean;
  shouldSuppressDraftContent: boolean;
  draftSendRequest: TaskCenterDraftSendRequest | null;
  sessionSwitchPending: boolean;
  hasInitialSessionRoute: boolean;
  isHomeSessionBackgroundRecovery?: boolean;
  displayMessageCount: number;
  threadItemCount: number;
  hasPendingA2UIForm: boolean;
  isPreparingSend: boolean;
  isSending: boolean;
  isHomePendingPreviewActive: boolean;
  isHomeSendStarting?: boolean;
  queuedTurnCount: number;
  hasLocalSessionOverride?: boolean;
  sessionId?: string | null;
  embeddedHomeSessionIds: ReadonlySet<string>;
  isAutoRestoringSession: boolean;
  isSessionHydrating: boolean;
  shouldUseBrowserWorkspaceHomeChrome: boolean;
}

export interface TaskCenterHomeChromeState {
  hasCurrentSessionActivity: boolean;
  hasHomeConversationActivity: boolean;
  taskCenterHomeSurfaceState: TaskCenterHomeSurfaceState;
  isTaskCenterDraftSendPending: boolean;
  shouldRenderTaskCenterEmbeddedHome: boolean;
  suppressHomeNavbarUtilityActions: boolean;
}

export function resolveTaskCenterDraftSurfaceState({
  agentEntry,
  isTaskCenterEntry,
  draftSurfaceActive,
  initialSessionId,
  sessionId,
  draftSendRequest,
  hasHomePendingPreview = false,
  displayMessageCount,
  threadItemCount,
  hasLocalSessionOverride = false,
  hasPendingA2UIForm,
  isPreparingSend,
  isSending,
  queuedTurnCount,
}: ResolveTaskCenterDraftSurfaceStateParams): TaskCenterDraftSurfaceState {
  const shouldPrioritizeInitialSessionRoute =
    shouldPrioritizeTaskCenterInitialSessionRoute({
      agentEntry,
      initialSessionId,
      sessionId,
    });
  const isTaskCenterDraftSurfaceActive =
    isTaskCenterEntry &&
    draftSurfaceActive &&
    !shouldPrioritizeInitialSessionRoute;
  const isTaskCenterDraftSendInFlight = Boolean(draftSendRequest);
  const hasVisibleSessionActivityForDraftSurface =
    Boolean(draftSendRequest) ||
    hasHomePendingPreview ||
    isPreparingSend ||
    isSending ||
    displayMessageCount > 0 ||
    threadItemCount > 0 ||
    hasLocalSessionOverride ||
    hasPendingA2UIForm ||
    queuedTurnCount > 0;
  const shouldSuppressTaskCenterDraftContent =
    shouldSuppressTaskCenterDraftContentForLayout({
      draftSurfaceActive: isTaskCenterDraftSurfaceActive,
      draftSendInFlight: isTaskCenterDraftSendInFlight,
      hasVisibleSessionActivity: hasVisibleSessionActivityForDraftSurface,
    });

  return {
    isTaskCenterDraftSurfaceActive,
    isTaskCenterDraftSendInFlight,
    hasVisibleSessionActivityForDraftSurface,
    shouldSuppressTaskCenterDraftContent,
  };
}

export function resolveTaskCenterHomeChromeState({
  agentEntry,
  draftSurfaceActive,
  shouldSuppressDraftContent,
  draftSendRequest,
  sessionSwitchPending,
  hasInitialSessionRoute,
  isHomeSessionBackgroundRecovery = false,
  displayMessageCount,
  threadItemCount,
  hasPendingA2UIForm,
  isPreparingSend,
  isSending,
  isHomePendingPreviewActive,
  isHomeSendStarting = false,
  queuedTurnCount,
  hasLocalSessionOverride = false,
  sessionId,
  embeddedHomeSessionIds,
  isAutoRestoringSession,
  isSessionHydrating,
  shouldUseBrowserWorkspaceHomeChrome,
}: ResolveTaskCenterHomeChromeStateParams): TaskCenterHomeChromeState {
  const hasForegroundLocalSession =
    hasLocalSessionOverride &&
    Boolean(sessionId) &&
    !draftSurfaceActive &&
    !shouldSuppressDraftContent;
  const isTaskCenterDraftSendPending = isTaskCenterDraftSendPendingForLayout({
    hasDraftSendRequest: Boolean(draftSendRequest),
    hasDisplayMessages: displayMessageCount > 0 || threadItemCount > 0,
    isSending,
    queuedTurnCount,
  });
  const shouldTreatCurrentSessionAsBackground =
    isHomeSessionBackgroundRecovery &&
    !hasInitialSessionRoute &&
    !hasForegroundLocalSession &&
    !isTaskCenterDraftSendPending;
  const hasCurrentSessionActivity =
    !shouldTreatCurrentSessionAsBackground &&
    (displayMessageCount > 0 ||
      threadItemCount > 0 ||
      Boolean(draftSendRequest) ||
      hasForegroundLocalSession ||
      hasPendingA2UIForm ||
      isHomeSendStarting ||
      isPreparingSend ||
      isSending ||
      isHomePendingPreviewActive ||
      queuedTurnCount > 0);
  const hasHomeConversationActivity =
    !shouldTreatCurrentSessionAsBackground &&
    !shouldSuppressDraftContent &&
    (hasCurrentSessionActivity || Boolean(draftSendRequest));
  const taskCenterHomeSurfaceState = resolveTaskCenterHomeSurfaceState({
    agentEntry,
    draftSurfaceActive,
    shouldSuppressDraftContent,
    sessionSwitchPending,
    hasInitialSessionRoute,
    hasConversationActivity: hasHomeConversationActivity,
    hasCurrentSessionActivity,
    sessionId,
    embeddedHomeSessionIds,
    isAutoRestoringSession,
    isSessionHydrating,
    isHomeSessionBackgroundRecovery: shouldTreatCurrentSessionAsBackground,
  });
  const shouldRenderTaskCenterEmbeddedHome =
    taskCenterHomeSurfaceState.shouldRenderEmbeddedHome;
  const hasNavbarUtilityActivity =
    hasHomeConversationActivity ||
    displayMessageCount > 0 ||
    threadItemCount > 0 ||
    Boolean(draftSendRequest) ||
    hasPendingA2UIForm ||
    isHomeSendStarting ||
    isPreparingSend ||
    isSending ||
    isHomePendingPreviewActive ||
    queuedTurnCount > 0;

  return {
    hasCurrentSessionActivity,
    hasHomeConversationActivity,
    taskCenterHomeSurfaceState,
    isTaskCenterDraftSendPending,
    shouldRenderTaskCenterEmbeddedHome,
    suppressHomeNavbarUtilityActions:
      (shouldUseBrowserWorkspaceHomeChrome && !hasNavbarUtilityActivity) ||
      shouldRenderTaskCenterEmbeddedHome,
  };
}
