import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeProjectId } from "../utils/topicProjectResolution";

const TOPIC_BRANCH_STATUS_KEY_PREFIX = "agent_topic_branch_status_";

export type TopicBranchStatus =
  | "in_progress"
  | "pending"
  | "merged"
  | "candidate";

export interface TopicBranchItem {
  id: string;
  title: string;
  status: TopicBranchStatus;
  isCurrent: boolean;
}

interface TopicLike {
  id: string;
  title: string;
  messagesCount?: number;
}

interface UseTopicBranchBoardOptions {
  enabled: boolean;
  projectId?: string;
  currentTopicId: string | null;
  topics: TopicLike[];
  externalStatusMap?: Record<string, TopicBranchStatus>;
  onStatusMapChange?: (next: Record<string, TopicBranchStatus>) => void;
}

function buildStorageKey(projectId: string): string {
  return `${TOPIC_BRANCH_STATUS_KEY_PREFIX}${projectId}`;
}

function loadBranchStatusMap(
  storageKey: string,
): Record<string, TopicBranchStatus> {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const next: Record<string, TopicBranchStatus> = {};
    for (const [topicId, status] of Object.entries(parsed)) {
      if (
        status === "in_progress" ||
        status === "pending" ||
        status === "merged" ||
        status === "candidate"
      ) {
        next[topicId] = status;
      }
    }
    return next;
  } catch {
    return {};
  }
}

function saveBranchStatusMap(
  storageKey: string,
  value: Record<string, TopicBranchStatus>,
): void {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function resolveDefaultStatus(
  topic: TopicLike,
  isCurrent: boolean,
): TopicBranchStatus {
  if (isCurrent) {
    return "in_progress";
  }
  if ((topic.messagesCount ?? 0) >= 2) {
    return "pending";
  }
  return "candidate";
}

export function useTopicBranchBoard({
  enabled,
  projectId,
  currentTopicId,
  topics,
  externalStatusMap,
  onStatusMapChange,
}: UseTopicBranchBoardOptions) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const storageKey = normalizedProjectId
    ? buildStorageKey(normalizedProjectId)
    : null;
  const [innerStatusMap, setInnerStatusMap] = useState<
    Record<string, TopicBranchStatus>
  >({});
  const useExternalState = !!(externalStatusMap && onStatusMapChange);
  const statusMap = useExternalState ? externalStatusMap : innerStatusMap;

  const updateStatusMap = useCallback(
    (
      updater:
        | Record<string, TopicBranchStatus>
        | ((
            previous: Record<string, TopicBranchStatus>,
          ) => Record<string, TopicBranchStatus>),
    ) => {
      if (useExternalState) {
        const previous = externalStatusMap || {};
        const next =
          typeof updater === "function" ? updater(previous) : updater;
        onStatusMapChange?.(next);
        return;
      }

      setInnerStatusMap((previous) =>
        typeof updater === "function" ? updater(previous) : updater,
      );
    },
    [externalStatusMap, onStatusMapChange, useExternalState],
  );

  useEffect(() => {
    if (useExternalState) {
      return;
    }
    if (!enabled || !storageKey) {
      setInnerStatusMap({});
      return;
    }
    setInnerStatusMap(loadBranchStatusMap(storageKey));
  }, [enabled, storageKey, useExternalState]);

  useEffect(() => {
    if (useExternalState) {
      return;
    }
    if (!enabled || !storageKey) {
      return;
    }
    saveBranchStatusMap(storageKey, statusMap);
  }, [enabled, statusMap, storageKey, useExternalState]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    updateStatusMap((previous) => {
      const next: Record<string, TopicBranchStatus> = {};
      for (const topic of topics) {
        const isCurrent = topic.id === currentTopicId;
        if (isCurrent) {
          next[topic.id] = "in_progress";
          continue;
        }
        next[topic.id] =
          previous[topic.id] || resolveDefaultStatus(topic, false);
      }

      const previousKeys = Object.keys(previous);
      const nextKeys = Object.keys(next);
      if (previousKeys.length === nextKeys.length) {
        const unchanged = nextKeys.every((key) => previous[key] === next[key]);
        if (unchanged) {
          return previous;
        }
      }

      return next;
    });
  }, [currentTopicId, enabled, topics, updateStatusMap]);

  const setTopicStatus = useCallback(
    (topicId: string, status: TopicBranchStatus) => {
      if (!enabled) {
        return;
      }
      updateStatusMap((previous) => ({
        ...previous,
        [topicId]: status,
      }));
    },
    [enabled, updateStatusMap],
  );

  const branchItems = useMemo<TopicBranchItem[]>(
    () =>
      topics.map((topic) => {
        const isCurrent = topic.id === currentTopicId;
        return {
          id: topic.id,
          title: topic.title,
          status: statusMap[topic.id] || resolveDefaultStatus(topic, isCurrent),
          isCurrent,
        };
      }),
    [currentTopicId, statusMap, topics],
  );

  return {
    branchItems,
    setTopicStatus,
  };
}
