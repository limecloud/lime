import { useCallback, useEffect, useMemo, useState } from "react";
import { listClawSolutions } from "@/lib/api/clawSolutions";
import { getClawSolutionUsageMap, recordClawSolutionUsage } from "./storage";
import type {
  ClawSolutionHomeItem,
  ClawSolutionReadiness,
  ClawSolutionTone,
  ClawSolutionSummary,
  RecordClawSolutionUsageInput,
} from "./types";

function getReadinessLabel(readiness: ClawSolutionReadiness): string {
  if (readiness === "needs_setup") {
    return "先配置模型";
  }
  if (readiness === "needs_capability") {
    return "补齐能力后开始";
  }
  return "可直接开始";
}

function getReadinessTone(readiness: ClawSolutionReadiness): ClawSolutionTone {
  if (readiness === "needs_setup") {
    return "amber";
  }
  if (readiness === "needs_capability") {
    return "sky";
  }
  return "emerald";
}

function getSolutionBadge(
  summary: ClawSolutionSummary,
  isRecent: boolean,
): string {
  if (isRecent) {
    return "最近使用";
  }
  if (summary.id === "social-post-starter") {
    return "社媒方案";
  }
  if (summary.id === "browser-assist-task") {
    return "浏览器协助";
  }
  if (summary.id === "team-breakdown") {
    return "多代理";
  }
  return "Claw 方案";
}

function buildHomeItems(
  summaries: ClawSolutionSummary[],
): ClawSolutionHomeItem[] {
  const usageMap = getClawSolutionUsageMap();
  const items: InternalClawSolutionHomeItem[] = summaries.map(
    (summary, index) => {
      const recent = usageMap.get(summary.id);
      const recentUsedAt = recent?.usedAt ?? null;
      const isRecent = typeof recentUsedAt === "number";

      return {
        ...summary,
        badge: getSolutionBadge(summary, isRecent),
        recentUsedAt,
        isRecent,
        readinessLabel: getReadinessLabel(summary.readiness),
        readinessTone: getReadinessTone(summary.readiness),
        _sortIndex: index,
      };
    },
  );

  return items
    .sort((left, right) => {
      if (left.recentUsedAt && right.recentUsedAt) {
        if (left.recentUsedAt !== right.recentUsedAt) {
          return right.recentUsedAt - left.recentUsedAt;
        }
      } else if (left.recentUsedAt) {
        return -1;
      } else if (right.recentUsedAt) {
        return 1;
      }

      return left._sortIndex - right._sortIndex;
    })
    .map(({ _sortIndex, ...item }) => item);
}

type InternalClawSolutionHomeItem = ClawSolutionHomeItem & {
  _sortIndex: number;
};

interface UseClawSolutionsResult {
  solutions: ClawSolutionHomeItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  recordUsage: (input: RecordClawSolutionUsageInput) => void;
}

export function useClawSolutions(enabled = true): UseClawSolutionsResult {
  const [summaries, setSummaries] = useState<ClawSolutionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [usageVersion, setUsageVersion] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setSummaries([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const nextSummaries = await listClawSolutions();
      setSummaries(nextSummaries);
      setError(null);
    } catch (reason) {
      setSummaries([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recordUsageAndRefresh = useCallback(
    (input: RecordClawSolutionUsageInput) => {
      recordClawSolutionUsage(input);
      setUsageVersion((previous) => previous + 1);
    },
    [],
  );

  const solutions = useMemo(() => {
    void usageVersion;
    return buildHomeItems(summaries);
  }, [summaries, usageVersion]);

  return {
    solutions,
    isLoading,
    error,
    refresh,
    recordUsage: recordUsageAndRefresh,
  };
}
