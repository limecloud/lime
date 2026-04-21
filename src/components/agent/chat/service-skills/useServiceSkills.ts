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
  getServiceSkillActionLabel,
  getServiceSkillRunnerDescription,
  getServiceSkillRunnerLabel,
  getServiceSkillRunnerTone,
} from "./skillPresentation";
import { shouldExposeServiceSkillHomeItem } from "./homeEntrySkills";
import { scheduleMinimumDelayIdleTask } from "@/lib/utils/scheduleMinimumDelayIdleTask";
import { supportsServiceSkillLocalAutomation } from "./automationDraft";
import {
  getServiceSkillUsageMap,
  recordServiceSkillUsage,
  subscribeServiceSkillUsageChanged,
} from "./storage";
import type {
  RecordServiceSkillUsageInput,
  ServiceSkillAutomationStatus,
  ServiceSkillCatalogMeta,
  ServiceSkillHomeItem,
} from "./types";

const SERVICE_SKILLS_IDLE_TIMEOUT_MS = 1_500;

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
): ServiceSkillHomeItem[] {
  const usageMap = getServiceSkillUsageMap();
  const mapped: Array<ServiceSkillHomeItem & { _sortIndex: number }> =
    items.map((item, index) => {
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
        _sortIndex: index,
      };
    });

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

function buildCatalogMeta(catalog: SkillCatalog): ServiceSkillCatalogMeta {
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

interface UseServiceSkillsOptions {
  enabled?: boolean;
  loadMode?: "immediate" | "deferred";
  deferredDelayMs?: number;
}

export function useServiceSkills(
  options: UseServiceSkillsOptions | boolean = true,
): UseServiceSkillsResult {
  const normalizedOptions =
    typeof options === "boolean" ? { enabled: options } : options;
  const enabled = normalizedOptions.enabled ?? true;
  const loadMode = normalizedOptions.loadMode ?? "immediate";
  const deferredDelayMs =
    normalizedOptions.deferredDelayMs ?? SERVICE_SKILLS_IDLE_TIMEOUT_MS;
  const [items, setItems] = useState<SkillCatalogItem[]>([]);
  const [groups, setGroups] = useState<SkillCatalogGroup[]>([]);
  const [automationStatusMap, setAutomationStatusMap] = useState<
    Record<string, ServiceSkillAutomationStatus>
  >({});
  const [catalogMeta, setCatalogMeta] =
    useState<ServiceSkillCatalogMeta | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [usageVersion, setUsageVersion] = useState(0);
  const [automationLinkCount, setAutomationLinkCount] = useState(0);

  const applyCatalogSnapshot = useCallback(async (catalog: SkillCatalog) => {
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
        automationStatuses =
          buildServiceSkillAutomationStatusMap(automationJobs);
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
  }, []);

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
    if (loadMode === "deferred") {
      return scheduleMinimumDelayIdleTask(
        () => {
          void refresh();
        },
        {
          minimumDelayMs: deferredDelayMs,
          idleTimeoutMs: SERVICE_SKILLS_IDLE_TIMEOUT_MS,
        },
      );
    }

    void refresh();
    return;
  }, [deferredDelayMs, loadMode, refresh]);

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

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return subscribeServiceSkillUsageChanged(() => {
      setUsageVersion((previous) => previous + 1);
    });
  }, [enabled]);

  const recordUsageAndRefresh = useCallback(
    (input: RecordServiceSkillUsageInput) => {
      recordServiceSkillUsage(input);
    },
    [],
  );

  const skills = useMemo(() => {
    void usageVersion;
    return buildHomeItems(items, automationStatusMap);
  }, [items, usageVersion, automationStatusMap]);

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
