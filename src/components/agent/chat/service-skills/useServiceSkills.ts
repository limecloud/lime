import { useCallback, useEffect, useMemo, useState } from "react";
import { getAutomationJobs } from "@/lib/api/automation";
import {
  getSkillCatalog,
  isSeededSkillCatalog,
  refreshSkillCatalogFromRemote,
  subscribeSkillCatalogChanged,
  type SkillCatalog,
  type SkillCatalogItem,
  type SkillCatalogGroup,
} from "@/lib/api/skillCatalog";
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
import {
  getServiceSkillActionLabel,
  getServiceSkillRunnerDescription,
  getServiceSkillRunnerLabel,
  getServiceSkillRunnerTone,
} from "./skillPresentation";
import { supportsServiceSkillLocalAutomation } from "./automationDraft";
import { getServiceSkillUsageMap, recordServiceSkillUsage } from "./storage";
import type {
  RecordServiceSkillUsageInput,
  ServiceSkillAutomationStatus,
  ServiceSkillCatalogMeta,
  ServiceSkillCloudRunStatus,
  ServiceSkillHomeItem,
} from "./types";

function shouldExposeServiceSkillHomeItem(item: SkillCatalogItem): boolean {
  if (item.execution.kind === "site_adapter") {
    return false;
  }

  if (
    item.defaultExecutorBinding === "browser_assist" ||
    item.siteCapabilityBinding
  ) {
    return false;
  }

  return true;
}

function getSkillBadge(item: SkillCatalogItem, isRecent: boolean): string {
  if (isRecent) {
    return "最近使用";
  }
  if (item.source === "cloud_catalog") {
    return "云目录";
  }
  return "本地技能";
}

function buildHomeItems(
  items: SkillCatalogItem[],
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
        groupKey: item.groupKey,
        executionKind: item.execution.kind,
        badge: getSkillBadge(item, isRecent),
        recentUsedAt,
        isRecent,
        runnerLabel: getServiceSkillRunnerLabel(item),
        runnerTone: getServiceSkillRunnerTone(item),
        runnerDescription: getServiceSkillRunnerDescription(item),
        actionLabel: getServiceSkillActionLabel(item),
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
  catalog: SkillCatalog,
): ServiceSkillCatalogMeta {
  const isSeeded = isSeededSkillCatalog(catalog);

  return {
    tenantId: catalog.tenantId,
    version: catalog.version,
    syncedAt: catalog.syncedAt,
    itemCount: catalog.items.length,
    groupCount: catalog.groups.length,
    sourceLabel: isSeeded ? "本地 Seeded 目录" : "租户技能目录",
    isSeeded,
  };
}

interface UseServiceSkillsResult {
  skills: ServiceSkillHomeItem[];
  groups: SkillCatalogGroup[];
  catalogMeta: ServiceSkillCatalogMeta | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  recordUsage: (input: RecordServiceSkillUsageInput) => void;
}

export function useServiceSkills(enabled = true): UseServiceSkillsResult {
  const [items, setItems] = useState<SkillCatalogItem[]>([]);
  const [groups, setGroups] = useState<SkillCatalogGroup[]>([]);
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

  const applyCatalogSnapshot = useCallback(
    async (catalog: SkillCatalog) => {
      const visibleItems = catalog.items.filter(shouldExposeServiceSkillHomeItem);
      const visibleGroupKeys = new Set(visibleItems.map((item) => item.groupKey));
      const visibleGroups = catalog.groups.filter((group) =>
        visibleGroupKeys.has(group.key),
      );
      const automationLinks = listServiceSkillAutomationLinks();
      let automationStatuses: Record<string, ServiceSkillAutomationStatus> = {};
      let resolvedAutomationLinkCount = automationLinks.length;

      const hasLocalAutomationSkills = visibleItems.some((item) =>
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

      setItems(visibleItems);
      setGroups(visibleGroups);
      setAutomationLinkCount(resolvedAutomationLinkCount);
      setAutomationStatusMap(automationStatuses);
      setCatalogMeta(
        buildCatalogMeta({
          ...catalog,
          groups: visibleGroups,
          items: visibleItems,
        }),
      );
    },
    [],
  );

  const loadCurrentCatalog = useCallback(async () => {
    const catalog = await getSkillCatalog();
    await applyCatalogSnapshot(catalog);
    return catalog;
  }, [applyCatalogSnapshot]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setGroups([]);
      setAutomationStatusMap({});
      setAutomationLinkCount(0);
      setCatalogMeta(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let currentCatalog: SkillCatalog | null = null;

    try {
      currentCatalog = await loadCurrentCatalog();
      setError(null);
      setIsLoading(false);

      try {
        const remoteCatalog = await refreshSkillCatalogFromRemote();
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
      setGroups([]);
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

    const unsubscribeCatalog = subscribeSkillCatalogChanged(() => {
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
    groups,
    catalogMeta,
    isLoading,
    error,
    refresh,
    recordUsage: recordUsageAndRefresh,
  };
}
