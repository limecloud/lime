import type { Topic } from "../hooks/agentChatShared";
import { normalizeProjectId } from "./topicProjectResolution";

export const TASK_CENTER_OPEN_TAB_IDS_STORAGE_KEY =
  "lime_task_center_open_task_ids";
export const MAX_TASK_CENTER_OPEN_TABS = 6;
const TASK_CENTER_LEGACY_WORKSPACE_KEY = "__legacy__";

export type TaskCenterWorkspaceTabMap = Record<string, string[]>;

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
    topic.status === "waiting" ||
    (topic.status === "failed" && topic.statusReason === "workspace_error")
  );
}

function resolveTaskCenterTabPriority(
  topic: Topic,
  currentTopicId: string | null,
): number {
  if (topic.id === currentTopicId) {
    return 0;
  }

  if (topic.isPinned) {
    return 1;
  }

  if (shouldResumeTaskSession(topic)) {
    return 2;
  }

  if (topic.status === "running") {
    return 3;
  }

  if (topic.status === "done") {
    return 4;
  }

  return 5;
}

function sortTaskCenterTabCandidates(
  topics: Topic[],
  currentTopicId: string | null,
): Topic[] {
  const resolveUpdatedAtMs = (topic: Topic): number => {
    const candidate = (topic.updatedAt ?? topic.createdAt) as
      | Date
      | number
      | string
      | null
      | undefined;

    if (candidate instanceof Date) {
      return candidate.getTime();
    }

    const resolvedTime = new Date(candidate ?? 0).getTime();
    return Number.isFinite(resolvedTime) ? resolvedTime : 0;
  };

  return [...topics].sort((left, right) => {
    const priorityDiff =
      resolveTaskCenterTabPriority(left, currentTopicId) -
      resolveTaskCenterTabPriority(right, currentTopicId);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return resolveUpdatedAtMs(right) - resolveUpdatedAtMs(left);
  });
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
    .filter((item, index, ids) => Boolean(item) && ids.indexOf(item) === index)
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

export function normalizeTaskCenterWorkspaceTabMap(
  value: unknown,
  options?: {
    workspaceId?: string | null;
    maxCount?: number;
  },
): TaskCenterWorkspaceTabMap {
  const maxCount = options?.maxCount ?? MAX_TASK_CENTER_OPEN_TABS;
  const currentWorkspaceId = normalizeProjectId(options?.workspaceId);
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
  const normalizedWorkspaceId = normalizeProjectId(workspaceId);
  if (!normalizedWorkspaceId) {
    return [];
  }

  return normalizeTaskCenterTabIds(tabMap[normalizedWorkspaceId], maxCount);
}

export function updateTaskCenterTabIdsForWorkspace(
  tabMap: TaskCenterWorkspaceTabMap,
  workspaceId: string | null | undefined,
  nextValue: string[] | ((currentIds: string[]) => string[]),
  maxCount = MAX_TASK_CENTER_OPEN_TABS,
): TaskCenterWorkspaceTabMap {
  const normalizedWorkspaceId = normalizeProjectId(workspaceId);
  const normalizedMap = normalizeTaskCenterWorkspaceTabMap(tabMap, {
    workspaceId: normalizedWorkspaceId,
    maxCount,
  });
  const normalizationChanged = !areTaskCenterWorkspaceTabMapsEqual(
    tabMap,
    normalizedMap,
  );

  if (!normalizedWorkspaceId) {
    return normalizationChanged ? normalizedMap : tabMap;
  }

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

    const { [normalizedWorkspaceId]: _removed, ...remainingMap } = normalizedMap;
    return remainingMap;
  }

  return {
    ...normalizedMap,
    [normalizedWorkspaceId]: nextIds,
  };
}

export function buildDefaultTaskCenterTabIds(
  topics: Topic[],
  currentTopicId: string | null,
  maxCount = MAX_TASK_CENTER_OPEN_TABS,
): string[] {
  return sortTaskCenterTabCandidates(topics, currentTopicId)
    .map((topic) => topic.id)
    .filter((topicId, index, ids) => ids.indexOf(topicId) === index)
    .slice(0, maxCount);
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
  const topicIdSet = new Set(topics.map((topic) => topic.id));
  const nextIds = existingIds.filter((topicId) => topicIdSet.has(topicId));

  if (currentTopicId && topicIdSet.has(currentTopicId)) {
    nextIds.unshift(currentTopicId);
  }

  const dedupedIds = nextIds.filter(
    (topicId, index, ids) => ids.indexOf(topicId) === index,
  );

  if (dedupedIds.length === 0) {
    return buildDefaultTaskCenterTabIds(topics, currentTopicId, maxCount);
  }

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
