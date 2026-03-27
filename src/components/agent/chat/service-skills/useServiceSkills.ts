import { useCallback, useEffect, useMemo, useState } from "react";
import { getAutomationJobs } from "@/lib/api/automation";
import {
  getServiceSkillCatalog,
  isSeededServiceSkillCatalog,
  refreshServiceSkillCatalogFromRemote,
  subscribeServiceSkillCatalogChanged,
} from "@/lib/api/serviceSkills";
import { isServiceSkillSiteCapabilityBound } from "./siteCapabilityBinding";
import {
  buildServiceSkillAutomationStatusMap,
  listServiceSkillAutomationLinks,
  resolveServiceSkillAutomationLinks,
  subscribeServiceSkillAutomationLinksChanged,
} from "./automationLinkStorage";
import {
  getServiceSkillCloudRunStatusMap,
  subscribeServiceSkillCloudRunsChanged,
} from "./cloudRunStorage";
import { supportsServiceSkillLocalAutomation } from "./automationDraft";
import { getServiceSkillUsageMap, recordServiceSkillUsage } from "./storage";
import type {
  RecordServiceSkillUsageInput,
  ServiceSkillAutomationStatus,
  ServiceSkillCatalog,
  ServiceSkillCatalogMeta,
  ServiceSkillCloudRunStatus,
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
  scheduled: "可直接创建本地定时任务，并回流到任务中心与工作区。",
  managed: "可直接创建本地持续跟踪任务，并回流到任务中心与工作区。",
};

const LOCAL_ACTION_LABELS: Record<ServiceSkillRunnerType, string> = {
  instant: "填写参数",
  scheduled: "创建任务",
  managed: "创建跟踪",
};

function getRunnerLabel(item: ServiceSkillItem): string {
  if (item.executionLocation === "cloud_required") {
    return "云端托管执行";
  }
  if (isServiceSkillSiteCapabilityBound(item)) {
    return "浏览器站点执行";
  }
  return RUNNER_LABELS[item.runnerType];
}

function getRunnerTone(item: ServiceSkillItem): ServiceSkillTone {
  if (item.executionLocation === "cloud_required") {
    return "slate";
  }
  return RUNNER_TONES[item.runnerType];
}

function getRunnerDescription(item: ServiceSkillItem): string {
  if (item.executionLocation === "cloud_required") {
    return "提交到 OEM 云端执行，结果由服务端异步返回。";
  }
  if (isServiceSkillSiteCapabilityBound(item)) {
    return "直接进入浏览器工作台，复用真实登录态执行站点脚本并沉淀结果。";
  }
  return RUNNER_DESCRIPTIONS[item.runnerType];
}

function getActionLabel(item: ServiceSkillItem): string {
  if (item.executionLocation === "cloud_required") {
    return "提交云端";
  }
  if (isServiceSkillSiteCapabilityBound(item)) {
    return "启动采集";
  }
  return LOCAL_ACTION_LABELS[item.runnerType];
}

function getSkillBadge(item: ServiceSkillItem, isRecent: boolean): string {
  if (isRecent) {
    return "最近使用";
  }
  if (item.source === "cloud_catalog") {
    return "云目录";
  }
  return "本地技能";
}

function buildHomeItems(
  items: ServiceSkillItem[],
  automationStatusMap: Record<string, ServiceSkillAutomationStatus>,
  cloudRunStatusMap: Record<string, ServiceSkillCloudRunStatus>,
): ServiceSkillHomeItem[] {
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
        runnerLabel: getRunnerLabel(item),
        runnerTone: getRunnerTone(item),
        runnerDescription: getRunnerDescription(item),
        actionLabel: getActionLabel(item),
        automationStatus: automationStatusMap[item.id] ?? null,
        cloudStatus:
          item.executionLocation === "cloud_required"
            ? cloudRunStatusMap[item.id] ?? null
            : null,
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

function buildCatalogMeta(
  catalog: ServiceSkillCatalog,
): ServiceSkillCatalogMeta {
  const isSeeded = isSeededServiceSkillCatalog(catalog);

  return {
    tenantId: catalog.tenantId,
    version: catalog.version,
    syncedAt: catalog.syncedAt,
    itemCount: catalog.items.length,
    sourceLabel: isSeeded ? "本地 Seeded 目录" : "租户云目录",
    isSeeded,
  };
}

interface UseServiceSkillsResult {
  skills: ServiceSkillHomeItem[];
  catalogMeta: ServiceSkillCatalogMeta | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  recordUsage: (input: RecordServiceSkillUsageInput) => void;
}

export function useServiceSkills(enabled = true): UseServiceSkillsResult {
  const [items, setItems] = useState<ServiceSkillItem[]>([]);
  const [automationStatusMap, setAutomationStatusMap] = useState<
    Record<string, ServiceSkillAutomationStatus>
  >({});
  const [cloudRunStatusMap, setCloudRunStatusMap] = useState<
    Record<string, ServiceSkillCloudRunStatus>
  >({});
  const [catalogMeta, setCatalogMeta] = useState<ServiceSkillCatalogMeta | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [usageVersion, setUsageVersion] = useState(0);
  const [automationLinkCount, setAutomationLinkCount] = useState(0);

  const applyCatalogSnapshot = useCallback(async (catalog: ServiceSkillCatalog) => {
    const automationLinks = listServiceSkillAutomationLinks();
    let automationStatuses: Record<string, ServiceSkillAutomationStatus> = {};
    let resolvedAutomationLinkCount = automationLinks.length;

    const hasLocalAutomationSkills = catalog.items.some((item) =>
      supportsServiceSkillLocalAutomation(item),
    );

    if (automationLinks.length > 0 || hasLocalAutomationSkills) {
      try {
        const automationJobs = await getAutomationJobs();
        automationStatuses = buildServiceSkillAutomationStatusMap(automationJobs);
        resolvedAutomationLinkCount =
          resolveServiceSkillAutomationLinks(automationJobs).length;
      } catch {
        automationStatuses = {};
      }
    }

    setItems(catalog.items);
    setAutomationLinkCount(resolvedAutomationLinkCount);
    setAutomationStatusMap(automationStatuses);
    setCatalogMeta(buildCatalogMeta(catalog));
  }, []);

  const loadCurrentCatalog = useCallback(async () => {
    const catalog = await getServiceSkillCatalog();
    await applyCatalogSnapshot(catalog);
    return catalog;
  }, [applyCatalogSnapshot]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setAutomationStatusMap({});
      setAutomationLinkCount(0);
      setCatalogMeta(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let currentCatalog: ServiceSkillCatalog | null = null;

    try {
      currentCatalog = await loadCurrentCatalog();
      setError(null);
      setIsLoading(false);

      try {
        const remoteCatalog = await refreshServiceSkillCatalogFromRemote();
        if (remoteCatalog) {
          await applyCatalogSnapshot(remoteCatalog);
        }
      } catch (reason) {
        if (!currentCatalog) {
          throw reason;
        }
      }
    } catch (reason) {
      setItems([]);
      setAutomationStatusMap({});
      setAutomationLinkCount(0);
      setCatalogMeta(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsLoading(false);
    }
  }, [applyCatalogSnapshot, enabled, loadCurrentCatalog]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const unsubscribeCatalog = subscribeServiceSkillCatalogChanged(() => {
      void loadCurrentCatalog();
    });
    const unsubscribeAutomationLinks =
      subscribeServiceSkillAutomationLinksChanged(() => {
        void loadCurrentCatalog();
      });

    return () => {
      unsubscribeCatalog();
      unsubscribeAutomationLinks();
    };
  }, [enabled, loadCurrentCatalog]);

  useEffect(() => {
    if (!enabled) {
      setCloudRunStatusMap({});
      return;
    }

    const syncCloudRuns = () => {
      setCloudRunStatusMap(getServiceSkillCloudRunStatusMap());
    };

    syncCloudRuns();
    const unsubscribeCloudRuns = subscribeServiceSkillCloudRunsChanged(() => {
      syncCloudRuns();
    });

    return () => {
      unsubscribeCloudRuns();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || automationLinkCount === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      void refresh();
    }, 15_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [automationLinkCount, enabled, refresh]);

  const recordUsageAndRefresh = useCallback(
    (input: RecordServiceSkillUsageInput) => {
      recordServiceSkillUsage(input);
      setUsageVersion((previous) => previous + 1);
    },
    [],
  );

  const skills = useMemo(() => {
    void usageVersion;
    return buildHomeItems(items, automationStatusMap, cloudRunStatusMap);
  }, [items, usageVersion, automationStatusMap, cloudRunStatusMap]);

  return {
    skills,
    catalogMeta,
    isLoading,
    error,
    refresh,
    recordUsage: recordUsageAndRefresh,
  };
}
