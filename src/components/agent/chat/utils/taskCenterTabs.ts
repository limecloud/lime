import type { Topic } from "../hooks/agentChatShared";
import { isAuxiliaryAgentSessionId } from "@/lib/api/agentRuntime/sessionIdentity";
import { normalizeProjectId } from "./topicProjectResolution";

export const TASK_CENTER_OPEN_TAB_IDS_STORAGE_KEY =
  "lime_task_center_open_task_ids";
export const MAX_TASK_CENTER_OPEN_TABS = 6;
const TASK_CENTER_LEGACY_WORKSPACE_KEY = "__legacy__";

export type TaskCenterWorkspaceTabMap = Record<string, string[]>;
export interface TaskCenterLocalSessionOverride {
  sessionId: string;
  routeSessionId: string | null;
}

export interface TaskCenterRouteTabSyncIntent {
  shouldSync: boolean;
  routeChanged: boolean;
  shouldClearTransitionAndDetached: boolean;
  nextRouteSyncSessionId: string | null;
}

export interface TaskCenterTopicSwitchOptions {
  allowDetachedSession?: true;
  forceRefresh?: true;
  resumeSessionStartHooks?: true;
}

export interface TaskCenterTopicClosePlan {
  remainingIds: string[];
  isActiveTab: boolean;
  shouldClearDetachedTopic: boolean;
  shouldClearTransitionTopic: boolean;
  fallbackTopicId: string | null;
}

export function isTaskCenterTopicSwitchSuccess(result: unknown): boolean {
  return result === undefined || result === "success" || result === "deferred";
}

export type TaskCenterFallbackRestoreSkipReason =
  | "not-task-center"
  | "workspace-missing"
  | "session-restoring"
  | "session-hydrating"
  | "draft-surface-active"
  | "draft-tab-active"
  | "new-task-home"
  | "service-skill-launch-pending"
  | "initial-dispatch-pending"
  | "home-background-recovery"
  | "initial-session-pending"
  | "detached-session"
  | "unknown-session-with-messages"
  | "no-fallback-topic"
  | "recently-restored";

export type TaskCenterFallbackRestorePlan =
  | {
      action: "skip";
      reason: TaskCenterFallbackRestoreSkipReason;
    }
  | {
      action: "restore";
      fallbackTopicId: string;
      nextRestore: {
        topicId: string;
        startedAt: number;
      };
    };

export function isTaskCenterAgentEntry(agentEntry?: string | null): boolean {
  return agentEntry === "conversation" || agentEntry === "new-task";
}

export function shouldResumeTaskSession(
  topic?:
    | Pick<Topic, "status" | "statusReason">
    | {
        status?: Topic["status"];
        statusReason?: Topic["statusReason"];
      }
    | null,
): boolean {
  if (!topic) {
    return false;
  }

  return (
    topic.status === "running" ||
    topic.status === "waiting" ||
    (topic.status === "failed" && topic.statusReason === "workspace_error")
  );
}

export function resolveInitialTaskSessionSwitchOptions(
  topic?:
    | Pick<Topic, "status" | "statusReason" | "messagesCount">
    | {
        status?: Topic["status"];
        statusReason?: Topic["statusReason"];
        messagesCount?: number;
      }
    | null,
): {
  allowDetachedSession: true;
  forceRefresh?: true;
  resumeSessionStartHooks?: true;
} {
  const shouldForceRefresh =
    topic?.statusReason === "workspace_error" ||
    (typeof topic?.messagesCount === "number" && topic.messagesCount > 0);
  const shouldResume = shouldResumeTaskSession(topic);

  return {
    allowDetachedSession: true,
    ...(shouldForceRefresh ? { forceRefresh: true } : {}),
    ...(shouldResume ? { resumeSessionStartHooks: true } : {}),
  };
}

export function resolveTaskCenterTopicSwitchOptions(params: {
  allowDetachedSession?: boolean;
  shouldResume: boolean;
  forceRefresh?: boolean;
}): TaskCenterTopicSwitchOptions | undefined {
  if (
    params.allowDetachedSession !== true &&
    !params.shouldResume &&
    params.forceRefresh !== true
  ) {
    return undefined;
  }

  return {
    ...(params.allowDetachedSession === true
      ? { allowDetachedSession: true }
      : {}),
    ...(params.forceRefresh === true ? { forceRefresh: true } : {}),
    ...(params.shouldResume ? { resumeSessionStartHooks: true } : {}),
  };
}

export function shouldSkipTaskCenterActiveTopicReopen(params: {
  topicId: string;
  activeSessionId?: string | null;
  messagesLength: number;
  draftSurfaceActive: boolean;
  detachedTopicId?: string | null;
  shouldResume: boolean;
  forceRefresh?: boolean;
  preferResume?: boolean;
  replaceOpenTabs?: boolean;
}): boolean {
  return (
    params.topicId === (params.activeSessionId ?? null) &&
    params.messagesLength > 0 &&
    params.draftSurfaceActive === false &&
    (params.detachedTopicId ?? null) === null &&
    params.shouldResume === false &&
    params.forceRefresh !== true &&
    params.preferResume !== true &&
    params.replaceOpenTabs !== true
  );
}

export function clearTaskCenterLocalSessionOverrideForTopic(
  current: TaskCenterLocalSessionOverride | null,
  topicId: string,
): TaskCenterLocalSessionOverride | null {
  return current?.sessionId === topicId ? null : current;
}

export function clearTaskCenterTransitionTopicForTopic(
  currentTopicId: string | null,
  topicId: string,
): string | null {
  return currentTopicId === topicId ? null : currentTopicId;
}

export function rollbackTaskCenterOpenTabMapForFailedSwitch(params: {
  currentMap: TaskCenterWorkspaceTabMap;
  workspaceId?: string | null;
  topicId: string;
  wasOpenInTaskCenter: boolean;
  replaceOpenTabs?: boolean;
}): TaskCenterWorkspaceTabMap {
  if (params.wasOpenInTaskCenter || params.replaceOpenTabs === true) {
    return params.currentMap;
  }

  return updateTaskCenterTabIdsForWorkspace(
    params.currentMap,
    params.workspaceId,
    (currentIds) =>
      currentIds.filter((currentId) => currentId !== params.topicId),
  );
}

export function resolveTaskCenterTopicClosePlan(params: {
  closingTopicId: string;
  currentOpenTabIds: string[];
  sessionId?: string | null;
  detachedTopicId?: string | null;
  transitionTopicId?: string | null;
}): TaskCenterTopicClosePlan {
  const currentIndex = params.currentOpenTabIds.indexOf(params.closingTopicId);
  const remainingIds = params.currentOpenTabIds.filter(
    (item) => item !== params.closingTopicId,
  );
  const isActiveTab = params.sessionId === params.closingTopicId;
  const fallbackTopicId = isActiveTab
    ? (remainingIds[currentIndex] ??
      remainingIds[currentIndex - 1] ??
      remainingIds[0] ??
      null)
    : null;

  return {
    remainingIds,
    isActiveTab,
    shouldClearDetachedTopic: params.detachedTopicId === params.closingTopicId,
    shouldClearTransitionTopic:
      params.transitionTopicId === params.closingTopicId,
    fallbackTopicId,
  };
}

function normalizeTaskCenterTabIds(
  value: unknown,
  maxCount = MAX_TASK_CENTER_OPEN_TABS,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(
      (item, index, ids) =>
        Boolean(item) &&
        !isAuxiliaryAgentSessionId(item) &&
        ids.indexOf(item) === index,
    )
    .slice(0, maxCount);
}

function areTaskCenterWorkspaceTabMapsEqual(
  left: TaskCenterWorkspaceTabMap,
  right: TaskCenterWorkspaceTabMap,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key, index) => {
    const rightKey = rightKeys[index];
    return (
      key === rightKey &&
      areTaskCenterTabIdsEqual(left[key] ?? [], right[rightKey] ?? [])
    );
  });
}

function resolveTaskCenterWorkspaceKey(workspaceId?: string | null): string {
  return normalizeProjectId(workspaceId) ?? TASK_CENTER_LEGACY_WORKSPACE_KEY;
}

export function normalizeTaskCenterWorkspaceTabMap(
  value: unknown,
  options?: {
    workspaceId?: string | null;
    maxCount?: number;
  },
): TaskCenterWorkspaceTabMap {
  const maxCount = options?.maxCount ?? MAX_TASK_CENTER_OPEN_TABS;
  const normalizedWorkspaceId = normalizeProjectId(options?.workspaceId);
  const currentWorkspaceId =
    normalizedWorkspaceId === TASK_CENTER_LEGACY_WORKSPACE_KEY
      ? null
      : normalizedWorkspaceId;
  const nextMap: TaskCenterWorkspaceTabMap = {};

  const assignWorkspaceIds = (workspaceKey: string, ids: string[]) => {
    if (!ids.length) {
      return;
    }

    nextMap[workspaceKey] = ids;
  };

  if (Array.isArray(value)) {
    const legacyIds = normalizeTaskCenterTabIds(value, maxCount);
    if (legacyIds.length > 0) {
      assignWorkspaceIds(
        currentWorkspaceId ?? TASK_CENTER_LEGACY_WORKSPACE_KEY,
        legacyIds,
      );
    }
  } else if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(
      ([rawWorkspaceId, rawIds]) => {
        const normalizedIds = normalizeTaskCenterTabIds(rawIds, maxCount);
        if (!normalizedIds.length) {
          return;
        }

        if (rawWorkspaceId === TASK_CENTER_LEGACY_WORKSPACE_KEY) {
          assignWorkspaceIds(TASK_CENTER_LEGACY_WORKSPACE_KEY, normalizedIds);
          return;
        }

        const normalizedWorkspaceId = normalizeProjectId(rawWorkspaceId);
        if (!normalizedWorkspaceId) {
          return;
        }

        assignWorkspaceIds(normalizedWorkspaceId, normalizedIds);
      },
    );
  }

  if (
    currentWorkspaceId &&
    nextMap[TASK_CENTER_LEGACY_WORKSPACE_KEY] &&
    !nextMap[currentWorkspaceId]
  ) {
    nextMap[currentWorkspaceId] = nextMap[TASK_CENTER_LEGACY_WORKSPACE_KEY];
  }

  if (currentWorkspaceId && nextMap[TASK_CENTER_LEGACY_WORKSPACE_KEY]) {
    delete nextMap[TASK_CENTER_LEGACY_WORKSPACE_KEY];
  }

  return nextMap;
}

export function resolveTaskCenterTabIdsForWorkspace(
  tabMap: TaskCenterWorkspaceTabMap,
  workspaceId?: string | null,
  maxCount = MAX_TASK_CENTER_OPEN_TABS,
): string[] {
  const normalizedWorkspaceId = resolveTaskCenterWorkspaceKey(workspaceId);

  return normalizeTaskCenterTabIds(tabMap[normalizedWorkspaceId], maxCount);
}

export function updateTaskCenterTabIdsForWorkspace(
  tabMap: TaskCenterWorkspaceTabMap,
  workspaceId: string | null | undefined,
  nextValue: string[] | ((currentIds: string[]) => string[]),
  maxCount = MAX_TASK_CENTER_OPEN_TABS,
): TaskCenterWorkspaceTabMap {
  const normalizedWorkspaceId = resolveTaskCenterWorkspaceKey(workspaceId);
  const normalizedMap = normalizeTaskCenterWorkspaceTabMap(tabMap, {
    workspaceId: normalizedWorkspaceId,
    maxCount,
  });
  const normalizationChanged = !areTaskCenterWorkspaceTabMapsEqual(
    tabMap,
    normalizedMap,
  );

  const currentIds = resolveTaskCenterTabIdsForWorkspace(
    normalizedMap,
    normalizedWorkspaceId,
    maxCount,
  );
  const resolvedNextValue =
    typeof nextValue === "function" ? nextValue(currentIds) : nextValue;
  const nextIds = normalizeTaskCenterTabIds(resolvedNextValue, maxCount);

  if (areTaskCenterTabIdsEqual(currentIds, nextIds)) {
    return normalizationChanged ? normalizedMap : tabMap;
  }

  if (nextIds.length === 0) {
    if (!(normalizedWorkspaceId in normalizedMap)) {
      return normalizationChanged ? normalizedMap : tabMap;
    }

    const { [normalizedWorkspaceId]: _removed, ...remainingMap } =
      normalizedMap;
    return remainingMap;
  }

  return {
    ...normalizedMap,
    [normalizedWorkspaceId]: nextIds,
  };
}

export function replaceTaskCenterTabIdsForWorkspace(
  tabMap: TaskCenterWorkspaceTabMap,
  workspaceId: string | null | undefined,
  topicId: string,
  maxCount = MAX_TASK_CENTER_OPEN_TABS,
): TaskCenterWorkspaceTabMap {
  const nextIds = normalizeTaskCenterTabIds([topicId], 1);
  return updateTaskCenterTabIdsForWorkspace(
    tabMap,
    workspaceId,
    nextIds,
    maxCount,
  );
}

export function initializeTaskCenterOpenTabMap(params: {
  initialTabMap: TaskCenterWorkspaceTabMap;
  agentEntry?: string | null;
  workspaceId?: string | null;
  normalizedInitialSessionId?: string | null;
  maxCount?: number;
}): TaskCenterWorkspaceTabMap {
  const initialSessionId = params.normalizedInitialSessionId || null;
  if (!isTaskCenterAgentEntry(params.agentEntry) || !initialSessionId) {
    return params.initialTabMap;
  }

  return replaceTaskCenterTabIdsForWorkspace(
    params.initialTabMap,
    params.workspaceId,
    initialSessionId,
    params.maxCount,
  );
}

export function shouldRespectTaskCenterLocalSessionOverride(params: {
  localSessionOverride?: TaskCenterLocalSessionOverride | null;
  normalizedInitialSessionId?: string | null;
  sessionId?: string | null;
}): boolean {
  const localSessionOverride = params.localSessionOverride;
  if (!localSessionOverride) {
    return false;
  }

  const normalizedInitialSessionId = params.normalizedInitialSessionId ?? null;
  const sessionId = params.sessionId ?? null;

  return (
    (localSessionOverride.routeSessionId === normalizedInitialSessionId ||
      localSessionOverride.sessionId === normalizedInitialSessionId) &&
    (!sessionId ||
      localSessionOverride.sessionId === sessionId ||
      localSessionOverride.sessionId === normalizedInitialSessionId)
  );
}

export function resolveTaskCenterRouteTabSyncIntent(params: {
  agentEntry?: string | null;
  workspaceId?: string | null;
  normalizedInitialSessionId?: string | null;
  lastSyncedInitialSessionId?: string | null;
  shouldRespectLocalSession: boolean;
}): TaskCenterRouteTabSyncIntent {
  const initialSessionId = params.normalizedInitialSessionId || null;
  if (!isTaskCenterAgentEntry(params.agentEntry) || !initialSessionId) {
    return {
      shouldSync: false,
      routeChanged: false,
      shouldClearTransitionAndDetached: false,
      nextRouteSyncSessionId: params.lastSyncedInitialSessionId ?? null,
    };
  }

  const routeChanged =
    (params.lastSyncedInitialSessionId ?? null) !== initialSessionId;

  return {
    shouldSync: true,
    routeChanged,
    shouldClearTransitionAndDetached: params.shouldRespectLocalSession,
    nextRouteSyncSessionId: initialSessionId,
  };
}

export function applyTaskCenterRouteTabSyncToMap(params: {
  currentMap: TaskCenterWorkspaceTabMap;
  workspaceId?: string | null;
  normalizedInitialSessionId?: string | null;
  shouldRespectLocalSession: boolean;
  maxCount?: number;
}): TaskCenterWorkspaceTabMap {
  const initialSessionId = params.normalizedInitialSessionId || null;
  if (!initialSessionId) {
    return params.currentMap;
  }

  if (params.shouldRespectLocalSession) {
    return updateTaskCenterTabIdsForWorkspace(
      params.currentMap,
      params.workspaceId,
      (currentIds) =>
        [
          initialSessionId,
          ...currentIds.filter((topicId) => topicId !== initialSessionId),
        ].slice(0, params.maxCount ?? MAX_TASK_CENTER_OPEN_TABS),
      params.maxCount,
    );
  }

  return replaceTaskCenterTabIdsForWorkspace(
    params.currentMap,
    params.workspaceId,
    initialSessionId,
    params.maxCount,
  );
}

export function shouldWaitForTaskCenterInitialSessionTopic(params: {
  normalizedInitialSessionId?: string | null;
  hasInitialSessionTopic: boolean;
}): boolean {
  return Boolean(
    params.normalizedInitialSessionId && !params.hasInitialSessionTopic,
  );
}

export function resolveTaskCenterReconcileCurrentTopicId(params: {
  normalizedInitialSessionId?: string | null;
  sessionId?: string | null;
  shouldRespectLocalSession: boolean;
  localSessionOverride?: TaskCenterLocalSessionOverride | null;
  detachedTopicId?: string | null;
}): string | null {
  const initialSessionId = params.normalizedInitialSessionId ?? null;
  const sessionId = params.sessionId ?? null;
  const isInitialSessionRoutePending =
    Boolean(initialSessionId) &&
    initialSessionId !== sessionId &&
    !params.shouldRespectLocalSession;

  if (isInitialSessionRoutePending) {
    return null;
  }

  const effectiveCurrentTopicId =
    params.shouldRespectLocalSession &&
    params.localSessionOverride?.sessionId === initialSessionId
      ? initialSessionId
      : sessionId;

  if (params.detachedTopicId === effectiveCurrentTopicId) {
    return null;
  }

  return effectiveCurrentTopicId;
}

export function resolveTaskCenterVisibleTabIds(params: {
  openTabIds: string[];
  topics: Topic[];
  currentTopicId: string | null;
  maxCount?: number;
}): string[] {
  const {
    openTabIds,
    topics,
    currentTopicId,
    maxCount = MAX_TASK_CENTER_OPEN_TABS,
  } = params;
  const topicIdSet = new Set(
    topics
      .map((topic) => topic.id)
      .filter((topicId) => !isAuxiliaryAgentSessionId(topicId)),
  );
  const visibleOpenTabIds = normalizeTaskCenterTabIds(
    openTabIds,
    maxCount,
  ).filter((topicId) => topicIdSet.has(topicId));

  if (
    currentTopicId &&
    topicIdSet.has(currentTopicId) &&
    !visibleOpenTabIds.includes(currentTopicId)
  ) {
    return [currentTopicId];
  }

  return visibleOpenTabIds;
}

export function resolveTaskCenterFallbackTopicId(params: {
  sessionId?: string | null;
  switchingTopicId?: string | null;
  openTabIds: string[];
  topics: Pick<Topic, "id">[];
  maxCount?: number;
}): string | null {
  const switchingTopicId = params.switchingTopicId?.trim() || null;
  if (switchingTopicId) {
    return null;
  }

  const topicIdSet = new Set(
    params.topics
      .map((topic) => topic.id)
      .filter((topicId) => !isAuxiliaryAgentSessionId(topicId)),
  );
  const sessionId = params.sessionId?.trim() || null;
  if (sessionId && topicIdSet.has(sessionId)) {
    return null;
  }

  return (
    normalizeTaskCenterTabIds(
      params.openTabIds,
      params.maxCount ?? MAX_TASK_CENTER_OPEN_TABS,
    ).find((topicId) => topicIdSet.has(topicId)) ?? null
  );
}

export function resolveTaskCenterFallbackRestorePlan(params: {
  agentEntry?: string | null;
  workspaceId?: string | null;
  isAutoRestoringSession: boolean;
  isSessionHydrating: boolean;
  draftSurfaceActive: boolean;
  initialPendingServiceSkillLaunchSignature?: string | null;
  initialDispatchKey?: string | null;
  isBootstrapDispatchPending: boolean;
  isHomeSessionBackgroundRecovery?: boolean;
  messagesLength: number;
  isSending: boolean;
  queuedTurnsLength: number;
  shouldHideDetachedTaskCenterTabs: boolean;
  normalizedInitialSessionId?: string | null;
  sessionId?: string | null;
  currentSessionIsKnownTopic: boolean;
  hasDisplayMessages: boolean;
  switchingTopicId?: string | null;
  openTabIds: string[];
  topics: Pick<Topic, "id">[];
  previousRestore?: { topicId: string; startedAt: number } | null;
  now: number;
}): TaskCenterFallbackRestorePlan {
  if (!isTaskCenterAgentEntry(params.agentEntry)) {
    return { action: "skip", reason: "not-task-center" };
  }

  if (!params.workspaceId) {
    return { action: "skip", reason: "workspace-missing" };
  }

  if (params.isAutoRestoringSession) {
    return { action: "skip", reason: "session-restoring" };
  }

  if (params.isSessionHydrating) {
    return { action: "skip", reason: "session-hydrating" };
  }

  if (params.draftSurfaceActive) {
    return { action: "skip", reason: "draft-surface-active" };
  }

  if (params.initialPendingServiceSkillLaunchSignature) {
    return { action: "skip", reason: "service-skill-launch-pending" };
  }

  if (
    params.initialDispatchKey &&
    (params.isBootstrapDispatchPending ||
      params.messagesLength === 0 ||
      params.isSending ||
      params.queuedTurnsLength > 0)
  ) {
    return { action: "skip", reason: "initial-dispatch-pending" };
  }

  if (
    params.isHomeSessionBackgroundRecovery &&
    !params.normalizedInitialSessionId
  ) {
    return { action: "skip", reason: "home-background-recovery" };
  }

  if (params.agentEntry === "new-task" && !params.normalizedInitialSessionId) {
    return { action: "skip", reason: "new-task-home" };
  }

  if (
    params.normalizedInitialSessionId &&
    params.sessionId !== params.normalizedInitialSessionId
  ) {
    return { action: "skip", reason: "initial-session-pending" };
  }

  if (params.shouldHideDetachedTaskCenterTabs) {
    return { action: "skip", reason: "detached-session" };
  }

  if (
    !params.normalizedInitialSessionId &&
    params.sessionId &&
    !params.currentSessionIsKnownTopic &&
    params.hasDisplayMessages
  ) {
    return { action: "skip", reason: "unknown-session-with-messages" };
  }

  const fallbackTopicId = resolveTaskCenterFallbackTopicId({
    sessionId: params.sessionId,
    switchingTopicId: params.switchingTopicId,
    openTabIds: params.openTabIds,
    topics: params.topics,
  });
  if (!fallbackTopicId) {
    return { action: "skip", reason: "no-fallback-topic" };
  }

  const previousRestore = params.previousRestore ?? null;
  if (
    previousRestore?.topicId === fallbackTopicId &&
    params.now - previousRestore.startedAt < 2_000
  ) {
    return { action: "skip", reason: "recently-restored" };
  }

  return {
    action: "restore",
    fallbackTopicId,
    nextRestore: {
      topicId: fallbackTopicId,
      startedAt: params.now,
    },
  };
}

export function shouldHideTaskCenterTabsForDetachedSession(params: {
  sessionId?: string | null;
  initialSessionId?: string | null;
  detachedTopicId?: string | null;
  openTabIds?: string[];
}): boolean {
  const sessionId = params.sessionId?.trim() || null;
  if (!sessionId) {
    return false;
  }

  const detachedTopicId = params.detachedTopicId?.trim() || null;
  if (detachedTopicId === sessionId) {
    return true;
  }

  const initialSessionId = params.initialSessionId?.trim() || null;
  if (!initialSessionId || initialSessionId !== sessionId) {
    return false;
  }

  return !normalizeTaskCenterTabIds(params.openTabIds ?? []).includes(
    sessionId,
  );
}

export function resolveTaskCenterPreviewTopicId(params: {
  sessionId?: string | null;
  detachedTopicId?: string | null;
  switchingTopicId?: string | null;
}): string | null {
  const switchingTopicId = params.switchingTopicId?.trim() || null;
  if (switchingTopicId) {
    return switchingTopicId;
  }

  const sessionId = params.sessionId?.trim() || null;
  const detachedTopicId = params.detachedTopicId?.trim() || null;
  if (sessionId && detachedTopicId === sessionId) {
    return detachedTopicId;
  }

  return null;
}

export function isTaskCenterTopicSwitchPending(params: {
  sessionId?: string | null;
  switchingTopicId?: string | null;
}): boolean {
  const switchingTopicId = params.switchingTopicId?.trim() || null;
  if (!switchingTopicId) {
    return false;
  }

  return switchingTopicId !== (params.sessionId?.trim() || null);
}

export function reconcileTaskCenterTabIds(params: {
  existingIds: string[];
  topics: Topic[];
  currentTopicId: string | null;
  maxCount?: number;
}): string[] {
  const {
    existingIds,
    topics,
    currentTopicId,
    maxCount = MAX_TASK_CENTER_OPEN_TABS,
  } = params;
  const topicIdSet = new Set(
    topics
      .map((topic) => topic.id)
      .filter((topicId) => !isAuxiliaryAgentSessionId(topicId)),
  );
  const nextIds = existingIds.filter((topicId) => topicIdSet.has(topicId));

  if (currentTopicId && topicIdSet.has(currentTopicId)) {
    nextIds.unshift(currentTopicId);
  }

  const dedupedIds = nextIds.filter(
    (topicId, index, ids) => ids.indexOf(topicId) === index,
  );

  return dedupedIds.slice(0, maxCount);
}

export function areTaskCenterTabIdsEqual(
  left: string[],
  right: string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}
