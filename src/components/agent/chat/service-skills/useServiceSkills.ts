import { useCallback, useEffect, useMemo, useState } from "react";
import { listServiceSkills } from "@/lib/api/serviceSkills";
import { getServiceSkillUsageMap, recordServiceSkillUsage } from "./storage";
import type {
  RecordServiceSkillUsageInput,
  ServiceSkillHomeItem,
  ServiceSkillItem,
  ServiceSkillRunnerType,
  ServiceSkillTone,
} from "./types";

const RUNNER_LABELS: Record<ServiceSkillRunnerType, string> = {
  instant: "本地即时执行",
  scheduled: "本地计划任务",
  managed: "本地持续跟踪",
};

const RUNNER_TONES: Record<ServiceSkillRunnerType, ServiceSkillTone> = {
  instant: "emerald",
  scheduled: "sky",
  managed: "amber",
};

const RUNNER_DESCRIPTIONS: Record<ServiceSkillRunnerType, string> = {
  instant: "客户端起步版可直接进入工作区执行。",
  scheduled: "当前先进入工作区生成首版任务方案，后续再接本地自动化。",
  managed: "当前先进入工作区生成首版跟踪方案，后续再接本地持续任务。",
};

const ACTION_LABELS: Record<ServiceSkillRunnerType, string> = {
  instant: "填写参数",
  scheduled: "先做方案",
  managed: "先定指标",
};

function getSkillBadge(item: ServiceSkillItem, isRecent: boolean): string {
  if (isRecent) {
    return "最近使用";
  }
  if (item.source === "cloud_catalog") {
    return "云目录";
  }
  return "本地技能";
}

function buildHomeItems(items: ServiceSkillItem[]): ServiceSkillHomeItem[] {
  const usageMap = getServiceSkillUsageMap();
  const mapped: Array<ServiceSkillHomeItem & { _sortIndex: number }> = items.map(
    (item, index) => {
      const recent = usageMap.get(item.id);
      const recentUsedAt = recent?.usedAt ?? null;
      const isRecent = typeof recentUsedAt === "number";

      return {
        ...item,
        badge: getSkillBadge(item, isRecent),
        recentUsedAt,
        isRecent,
        runnerLabel: RUNNER_LABELS[item.runnerType],
        runnerTone: RUNNER_TONES[item.runnerType],
        runnerDescription: RUNNER_DESCRIPTIONS[item.runnerType],
        actionLabel: ACTION_LABELS[item.runnerType],
        _sortIndex: index,
      };
    },
  );

  return mapped
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

interface UseServiceSkillsResult {
  skills: ServiceSkillHomeItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  recordUsage: (input: RecordServiceSkillUsageInput) => void;
}

export function useServiceSkills(enabled = true): UseServiceSkillsResult {
  const [items, setItems] = useState<ServiceSkillItem[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [usageVersion, setUsageVersion] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const nextItems = await listServiceSkills();
      setItems(nextItems);
      setError(null);
    } catch (reason) {
      setItems([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recordUsageAndRefresh = useCallback(
    (input: RecordServiceSkillUsageInput) => {
      recordServiceSkillUsage(input);
      setUsageVersion((previous) => previous + 1);
    },
    [],
  );

  const skills = useMemo(() => {
    void usageVersion;
    return buildHomeItems(items);
  }, [items, usageVersion]);

  return {
    skills,
    isLoading,
    error,
    refresh,
    recordUsage: recordUsageAndRefresh,
  };
}
