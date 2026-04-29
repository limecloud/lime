import React, { useEffect, useState, useCallback, useMemo } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  checkForUpdates,
  downloadUpdate,
  type VersionInfo,
} from "@/lib/api/appUpdate";
import { notifyPluginUIChanged } from "@/lib/api/pluginUI";
import {
  cancelPluginTask,
  disablePlugin,
  enablePlugin,
  getPluginQueueStats,
  getPluginStatus,
  getPlugins,
  getPluginTask,
  listenPluginTaskEvent,
  listInstalledPlugins,
  listPluginTasks,
  reloadPlugins,
  unloadPlugin,
} from "@/lib/api/plugins";
import {
  Puzzle,
  RefreshCw,
  Power,
  PowerOff,
  Trash2,
  FolderOpen,
  AlertCircle,
  CheckCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Plus,
  Package,
  Ban,
  Download,
  ExternalLink,
} from "lucide-react";
import { PluginInstallDialog } from "./PluginInstallDialog";
import { PluginUninstallDialog } from "./PluginUninstallDialog";
import { PluginItemContextMenu } from "./PluginItemContextMenu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";

interface PluginState {
  name: string;
  status: string;
  loaded_at: string;
  last_executed: string | null;
  execution_count: number;
  error_count: number;
  last_error: string | null;
}

interface PluginConfig {
  enabled: boolean;
  timeout_ms: number;
  settings: Record<string, unknown>;
}

interface PluginInfo {
  name: string;
  version: string;
  description: string;
  author: string | null;
  status: string;
  path: string;
  hooks: string[];
  min_lime_version?: string | null;
  config_schema: Record<string, unknown> | null;
  config: PluginConfig;
  state: PluginState;
}

interface PluginServiceStatus {
  enabled: boolean;
  plugin_count: number;
  plugins_dir: string;
}

type PluginTaskState =
  | "queued"
  | "running"
  | "retrying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

type PluginTaskFilter = PluginTaskState | "all";
type PluginTaskTimeRangeFilter = "all" | "1h" | "24h" | "7d" | "custom";
type CustomRangeHistorySort = "recent" | "label";
type CustomRangeHistoryViewMode = "default" | "flat" | "only_pinned";

interface CustomRangeHistoryItem {
  id: string;
  start: string;
  end: string;
  updatedAt: string;
  label: string;
  pinned: boolean;
}

interface PersistedRuntimeFilters {
  taskFilter: PluginTaskFilter;
  globalPluginFilter: string;
  taskSearchKeyword: string;
  taskPageSize: number;
  timeRangeFilter: PluginTaskTimeRangeFilter;
  customStartTime: string;
  customEndTime: string;
  lastAppliedCustomStartTime: string;
  lastAppliedCustomEndTime: string;
  lastAppliedCustomUpdatedAt: string;
  customRangeHistory: CustomRangeHistoryItem[];
  customRangeHistorySearchKeyword: string;
  customRangeHistorySort: CustomRangeHistorySort;
  customRangeHistoryOnlyPinned: boolean;
  customRangeHistoryPinnedFirst: boolean;
}

interface EffectiveTaskTimeBounds {
  effectiveStartMs: number | null;
  effectiveEndMs: number | null;
  isCustomRangeSwapped: boolean;
  isCustomRangeEmpty: boolean;
}

interface PluginTaskError {
  code?: string;
  message: string;
  retryable: boolean;
}

interface PluginTaskRecord {
  taskId: string;
  pluginId: string;
  operation: string;
  state: PluginTaskState;
  attempt: number;
  maxRetries: number;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  error?: PluginTaskError;
}

interface PluginQueueStats {
  pluginId: string;
  running: number;
  waiting: number;
  rejected: number;
  completed: number;
  failed: number;
  cancelled: number;
  timedOut: number;
}

const getTaskStateLabel = (state: PluginTaskState): string => {
  switch (state) {
    case "queued":
      return "排队中";
    case "running":
      return "执行中";
    case "retrying":
      return "重试中";
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "timed_out":
      return "超时";
    default:
      return state;
  }
};

const getTaskStateClassName = (state: PluginTaskState): string => {
  switch (state) {
    case "succeeded":
      return "bg-green-100 text-green-700";
    case "running":
    case "retrying":
      return "bg-sky-100 text-sky-700";
    case "queued":
      return "bg-yellow-100 text-yellow-700";
    case "failed":
    case "timed_out":
      return "bg-red-100 text-red-700";
    case "cancelled":
      return "bg-gray-200 text-gray-700";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const canCancelTask = (task: PluginTaskRecord) =>
  task.state === "queued" ||
  task.state === "running" ||
  task.state === "retrying";

const formatTime = (value?: string) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const escapeCsvValue = (
  value: string | number | boolean | undefined | null,
) => {
  const text = String(value ?? "");
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
};

const RUNTIME_FILTER_STORAGE_KEY = "lime.pluginDiagnostics.filters.v1";
const DEFAULT_TASK_PAGE_SIZE = 10;
const TASK_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const TASK_TIME_RANGE_TO_MS: Record<
  Exclude<PluginTaskTimeRangeFilter, "all" | "custom">,
  number
> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};
const QUICK_CUSTOM_RANGE_MINUTES = [15, 30, 60] as const;
const MAX_CUSTOM_RANGE_HISTORY = 5;

const toDateTimeLocalValue = (value: Date): string => {
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(
    value.getHours(),
  )}:${pad(value.getMinutes())}`;
};

const buildCustomRangeHistoryId = (start: string, end: string): string =>
  `${start}|${end}`;

const fallbackCopyText = (text: string): boolean => {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
};

const writeTextToClipboard = async (text: string): Promise<void> => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (!fallbackCopyText(text)) {
    throw new Error("浏览器不支持复制");
  }
};

const isPluginTaskFilter = (value: unknown): value is PluginTaskFilter => {
  const validFilters: PluginTaskFilter[] = [
    "all",
    "queued",
    "running",
    "retrying",
    "succeeded",
    "failed",
    "cancelled",
    "timed_out",
  ];
  return (
    typeof value === "string" &&
    validFilters.includes(value as PluginTaskFilter)
  );
};

const isPluginTaskTimeRangeFilter = (
  value: unknown,
): value is PluginTaskTimeRangeFilter => {
  const validRanges: PluginTaskTimeRangeFilter[] = [
    "all",
    "1h",
    "24h",
    "7d",
    "custom",
  ];
  return (
    typeof value === "string" &&
    validRanges.includes(value as PluginTaskTimeRangeFilter)
  );
};

const toValidDateTimeLocalInput = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  if (!value) {
    return "";
  }
  return Number.isNaN(Date.parse(value)) ? "" : value;
};

const toValidIsoDateTimeInput = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  if (!value) {
    return "";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "";
  }
  return new Date(parsed).toISOString();
};

const isCustomRangeHistorySort = (
  value: unknown,
): value is CustomRangeHistorySort => value === "recent" || value === "label";

const toValidTaskPageSize = (value: unknown): number => {
  if (typeof value !== "number") {
    return DEFAULT_TASK_PAGE_SIZE;
  }
  return TASK_PAGE_SIZE_OPTIONS.includes(
    value as (typeof TASK_PAGE_SIZE_OPTIONS)[number],
  )
    ? value
    : DEFAULT_TASK_PAGE_SIZE;
};

const toValidCustomRangeHistory = (
  value: unknown,
): CustomRangeHistoryItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Partial<CustomRangeHistoryItem>;
      const start = toValidDateTimeLocalInput(record.start);
      const end = toValidDateTimeLocalInput(record.end);
      const updatedAt = toValidIsoDateTimeInput(record.updatedAt);
      const label = typeof record.label === "string" ? record.label.trim() : "";
      const pinned = Boolean(record.pinned);
      if (!start || !end || !updatedAt) {
        return null;
      }
      return {
        id: buildCustomRangeHistoryId(start, end),
        start,
        end,
        updatedAt,
        label,
        pinned,
      };
    })
    .filter((item): item is CustomRangeHistoryItem => item !== null)
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );

  const uniqueById = normalized.reduce<CustomRangeHistoryItem[]>(
    (acc, current) => {
      if (acc.some((item) => item.id === current.id)) {
        return acc;
      }
      acc.push(current);
      return acc;
    },
    [],
  );

  return uniqueById.slice(0, MAX_CUSTOM_RANGE_HISTORY);
};

const parseCustomRangeHistoryImport = (
  raw: unknown,
): CustomRangeHistoryItem[] => {
  if (Array.isArray(raw)) {
    return toValidCustomRangeHistory(raw);
  }
  if (raw && typeof raw === "object") {
    const payload = raw as {
      customRangeHistory?: unknown;
      history?: unknown;
    };
    return toValidCustomRangeHistory(
      payload.customRangeHistory ?? payload.history,
    );
  }
  return [];
};

const readPersistedRuntimeFilters = (): PersistedRuntimeFilters => {
  const fallback: PersistedRuntimeFilters = {
    taskFilter: "all",
    globalPluginFilter: "all",
    taskSearchKeyword: "",
    taskPageSize: DEFAULT_TASK_PAGE_SIZE,
    timeRangeFilter: "all",
    customStartTime: "",
    customEndTime: "",
    lastAppliedCustomStartTime: "",
    lastAppliedCustomEndTime: "",
    lastAppliedCustomUpdatedAt: "",
    customRangeHistory: [],
    customRangeHistorySearchKeyword: "",
    customRangeHistorySort: "recent",
    customRangeHistoryOnlyPinned: false,
    customRangeHistoryPinnedFirst: true,
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(RUNTIME_FILTER_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedRuntimeFilters>;
    return {
      taskFilter: isPluginTaskFilter(parsed.taskFilter)
        ? parsed.taskFilter
        : fallback.taskFilter,
      globalPluginFilter:
        typeof parsed.globalPluginFilter === "string"
          ? parsed.globalPluginFilter
          : fallback.globalPluginFilter,
      taskSearchKeyword:
        typeof parsed.taskSearchKeyword === "string"
          ? parsed.taskSearchKeyword
          : fallback.taskSearchKeyword,
      taskPageSize: toValidTaskPageSize(parsed.taskPageSize),
      timeRangeFilter: isPluginTaskTimeRangeFilter(parsed.timeRangeFilter)
        ? parsed.timeRangeFilter
        : fallback.timeRangeFilter,
      customStartTime: toValidDateTimeLocalInput(parsed.customStartTime),
      customEndTime: toValidDateTimeLocalInput(parsed.customEndTime),
      lastAppliedCustomStartTime: toValidDateTimeLocalInput(
        parsed.lastAppliedCustomStartTime,
      ),
      lastAppliedCustomEndTime: toValidDateTimeLocalInput(
        parsed.lastAppliedCustomEndTime,
      ),
      lastAppliedCustomUpdatedAt: toValidIsoDateTimeInput(
        parsed.lastAppliedCustomUpdatedAt,
      ),
      customRangeHistory: toValidCustomRangeHistory(parsed.customRangeHistory),
      customRangeHistorySearchKeyword:
        typeof parsed.customRangeHistorySearchKeyword === "string"
          ? parsed.customRangeHistorySearchKeyword
          : fallback.customRangeHistorySearchKeyword,
      customRangeHistorySort: isCustomRangeHistorySort(
        parsed.customRangeHistorySort,
      )
        ? parsed.customRangeHistorySort
        : fallback.customRangeHistorySort,
      customRangeHistoryOnlyPinned:
        typeof parsed.customRangeHistoryOnlyPinned === "boolean"
          ? parsed.customRangeHistoryOnlyPinned
          : fallback.customRangeHistoryOnlyPinned,
      customRangeHistoryPinnedFirst:
        typeof parsed.customRangeHistoryPinnedFirst === "boolean"
          ? parsed.customRangeHistoryPinnedFirst
          : fallback.customRangeHistoryPinnedFirst,
    };
  } catch (error) {
    console.warn("[PluginManager] 读取诊断筛选配置失败:", error);
    return fallback;
  }
};

type SemverLike = readonly [number, number, number];

const parseSemverLike = (value: string): SemverLike | null => {
  const normalized = value.trim().replace(/^[^\d]+/, "");
  if (!normalized) {
    return null;
  }

  const core = normalized.split(/[-+]/)[0];
  const [major = "0", minor = "0", patch = "0"] = core.split(".");
  const parsed = [major, minor, patch].map((part) => Number.parseInt(part, 10));
  if (parsed.some((part) => Number.isNaN(part))) {
    return null;
  }

  return [parsed[0], parsed[1], parsed[2]];
};

const compareSemverLike = (left: string, right: string): number | null => {
  const parsedLeft = parseSemverLike(left);
  const parsedRight = parseSemverLike(right);
  if (!parsedLeft || !parsedRight) {
    return null;
  }

  for (let index = 0; index < parsedLeft.length; index += 1) {
    if (parsedLeft[index] === parsedRight[index]) {
      continue;
    }
    return parsedLeft[index] > parsedRight[index] ? 1 : -1;
  }

  return 0;
};

/** 安装来源 */
interface InstallSource {
  type: "local" | "url" | "github";
  path?: string;
  url?: string;
  owner?: string;
  repo?: string;
  tag?: string;
}

/** 已安装插件信息（通过安装器安装的） */
interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string | null;
  install_path: string;
  installed_at: string;
  source: InstallSource;
  enabled: boolean;
}

interface PluginManagerProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
}

const WINDOWS_RELEASES_URL = "https://github.com/aiclientproxy/lime/releases";

export function PluginManager({ onNavigate }: PluginManagerProps = {}) {
  const initialRuntimeFilters = useMemo(
    () => readPersistedRuntimeFilters(),
    [],
  );
  const isWindows =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");
  const [status, setStatus] = useState<PluginServiceStatus | null>(null);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<PluginTaskFilter>(
    initialRuntimeFilters.taskFilter,
  );
  const [globalPluginFilter, setGlobalPluginFilter] = useState<string>(
    initialRuntimeFilters.globalPluginFilter,
  );
  const [taskSearchKeyword, setTaskSearchKeyword] = useState<string>(
    initialRuntimeFilters.taskSearchKeyword,
  );
  const [taskPage, setTaskPage] = useState<number>(1);
  const [taskPageSize, setTaskPageSize] = useState<number>(
    initialRuntimeFilters.taskPageSize,
  );
  const [timeRangeFilter, setTimeRangeFilter] =
    useState<PluginTaskTimeRangeFilter>(initialRuntimeFilters.timeRangeFilter);
  const [customStartTime, setCustomStartTime] = useState<string>(
    initialRuntimeFilters.customStartTime,
  );
  const [customEndTime, setCustomEndTime] = useState<string>(
    initialRuntimeFilters.customEndTime,
  );
  const [lastAppliedCustomStartTime, setLastAppliedCustomStartTime] =
    useState<string>(initialRuntimeFilters.lastAppliedCustomStartTime);
  const [lastAppliedCustomEndTime, setLastAppliedCustomEndTime] =
    useState<string>(initialRuntimeFilters.lastAppliedCustomEndTime);
  const [lastAppliedCustomUpdatedAt, setLastAppliedCustomUpdatedAt] =
    useState<string>(initialRuntimeFilters.lastAppliedCustomUpdatedAt);
  const [customRangeHistory, setCustomRangeHistory] = useState<
    CustomRangeHistoryItem[]
  >(initialRuntimeFilters.customRangeHistory);
  const [selectedCustomRangeHistoryId, setSelectedCustomRangeHistoryId] =
    useState<string>("");
  const [customRangeHistorySearchKeyword, setCustomRangeHistorySearchKeyword] =
    useState<string>(initialRuntimeFilters.customRangeHistorySearchKeyword);
  const [customRangeHistorySort, setCustomRangeHistorySort] =
    useState<CustomRangeHistorySort>(
      initialRuntimeFilters.customRangeHistorySort,
    );
  const [customRangeHistoryOnlyPinned, setCustomRangeHistoryOnlyPinned] =
    useState<boolean>(initialRuntimeFilters.customRangeHistoryOnlyPinned);
  const [customRangeHistoryPinnedFirst, setCustomRangeHistoryPinnedFirst] =
    useState<boolean>(initialRuntimeFilters.customRangeHistoryPinnedFirst);
  const [pluginTasks, setPluginTasks] = useState<
    Record<string, PluginTaskRecord[]>
  >({});
  const [allTasks, setAllTasks] = useState<PluginTaskRecord[]>([]);
  const [queueStats, setQueueStats] = useState<
    Record<string, PluginQueueStats>
  >({});
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [detailLoadingTaskId, setDetailLoadingTaskId] = useState<string | null>(
    null,
  );
  const [selectedTaskDetail, setSelectedTaskDetail] =
    useState<PluginTaskRecord | null>(null);
  const [versionInfo, setVersionInfo] = useState<VersionInfo>({
    current: "",
    latest: undefined,
    hasUpdate: false,
    downloadUrl: WINDOWS_RELEASES_URL,
    error: undefined,
  });
  const [updateLoading, setUpdateLoading] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const currentVersion = versionInfo.current;

  // 对话框状态
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [pluginToUninstall, setPluginToUninstall] =
    useState<InstalledPlugin | null>(null);

  const fetchRuntimeData = useCallback(async () => {
    try {
      const [taskList, queueStatsList] = await Promise.all([
        listPluginTasks<PluginTaskRecord>({
          taskState: taskFilter === "all" ? null : taskFilter,
          limit: 300,
        }).catch(() => []),
        getPluginQueueStats<PluginQueueStats>().catch(() => []),
      ]);

      const groupedTasks = taskList.reduce<Record<string, PluginTaskRecord[]>>(
        (acc, task) => {
          if (!acc[task.pluginId]) {
            acc[task.pluginId] = [];
          }
          acc[task.pluginId].push(task);
          return acc;
        },
        {},
      );
      setPluginTasks(groupedTasks);
      setAllTasks(taskList);

      const queueStatsMap = queueStatsList.reduce<
        Record<string, PluginQueueStats>
      >((acc, stats) => {
        acc[stats.pluginId] = stats;
        return acc;
      }, {});
      setQueueStats(queueStatsMap);
    } catch (err) {
      console.warn("[PluginManager] 加载插件运行态数据失败:", err);
    }
  }, [taskFilter]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [serviceStatus, pluginList, installedList] = await Promise.all([
        getPluginStatus<PluginServiceStatus>(),
        getPlugins<PluginInfo>(),
        listInstalledPlugins<InstalledPlugin>().catch(() => []),
      ]);
      setStatus(serviceStatus);
      setPlugins(pluginList);
      setInstalledPlugins(installedList);
      await fetchRuntimeData();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [fetchRuntimeData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refreshWindowsVersionInfo = useCallback(async () => {
    if (!isWindows) {
      return;
    }

    try {
      setUpdateLoading(true);
      const result = await checkForUpdates();
      setVersionInfo({
        ...result,
        downloadUrl: result.downloadUrl || WINDOWS_RELEASES_URL,
      });
    } catch (err) {
      setVersionInfo((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
        downloadUrl: prev.downloadUrl || WINDOWS_RELEASES_URL,
      }));
    } finally {
      setUpdateLoading(false);
    }
  }, [isWindows]);

  useEffect(() => {
    void refreshWindowsVersionInfo();
  }, [refreshWindowsVersionInfo]);

  useEffect(() => {
    fetchRuntimeData();
  }, [fetchRuntimeData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      fetchRuntimeData();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [fetchRuntimeData]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let delayedRefreshTimer: number | null = null;

    const setupTaskEventListener = async () => {
      try {
        unlisten = await listenPluginTaskEvent(() => {
          if (delayedRefreshTimer !== null) {
            window.clearTimeout(delayedRefreshTimer);
          }
          delayedRefreshTimer = window.setTimeout(() => {
            void fetchRuntimeData();
          }, 200);
        });
      } catch (err) {
        console.warn("[PluginManager] 监听 plugin-task-event 失败:", err);
      }
    };

    void setupTaskEventListener();

    return () => {
      if (delayedRefreshTimer !== null) {
        window.clearTimeout(delayedRefreshTimer);
      }
      if (unlisten) {
        void unlisten();
      }
    };
  }, [fetchRuntimeData]);

  useEffect(() => {
    try {
      const persisted: PersistedRuntimeFilters = {
        taskFilter,
        globalPluginFilter,
        taskSearchKeyword,
        taskPageSize,
        timeRangeFilter,
        customStartTime,
        customEndTime,
        lastAppliedCustomStartTime,
        lastAppliedCustomEndTime,
        lastAppliedCustomUpdatedAt,
        customRangeHistory,
        customRangeHistorySearchKeyword,
        customRangeHistorySort,
        customRangeHistoryOnlyPinned,
        customRangeHistoryPinnedFirst,
      };
      window.localStorage.setItem(
        RUNTIME_FILTER_STORAGE_KEY,
        JSON.stringify(persisted),
      );
    } catch (error) {
      console.warn("[PluginManager] 持久化诊断筛选配置失败:", error);
    }
  }, [
    taskFilter,
    globalPluginFilter,
    taskSearchKeyword,
    taskPageSize,
    timeRangeFilter,
    customStartTime,
    customEndTime,
    lastAppliedCustomStartTime,
    lastAppliedCustomEndTime,
    lastAppliedCustomUpdatedAt,
    customRangeHistory,
    customRangeHistorySearchKeyword,
    customRangeHistorySort,
    customRangeHistoryOnlyPinned,
    customRangeHistoryPinnedFirst,
  ]);

  useEffect(() => {
    if (loading || globalPluginFilter === "all") {
      return;
    }
    const exists = plugins.some((plugin) => plugin.name === globalPluginFilter);
    if (!exists) {
      setGlobalPluginFilter("all");
    }
  }, [loading, plugins, globalPluginFilter]);

  // 处理安装成功
  const handleInstallSuccess = useCallback(() => {
    fetchData();
    toast.success("插件安装成功");
    notifyPluginUIChanged();
  }, [fetchData]);

  const handleTogglePlugin = async (name: string, currentEnabled: boolean) => {
    try {
      if (currentEnabled) {
        await disablePlugin(name);
      } else {
        await enablePlugin(name);
      }
      await fetchData();
      notifyPluginUIChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReloadPlugins = async () => {
    try {
      await reloadPlugins();
      await fetchData();
      notifyPluginUIChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCancelTask = async (taskId: string) => {
    try {
      setCancellingTaskId(taskId);
      const cancelled = await cancelPluginTask(taskId);
      if (cancelled) {
        toast.success("任务取消请求已发送");
      } else {
        toast.warning("任务可能已结束，无法取消");
      }
      await fetchRuntimeData();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`取消任务失败: ${message}`);
    } finally {
      setCancellingTaskId(null);
    }
  };

  const handleLoadTaskDetail = async (taskId: string) => {
    try {
      setDetailLoadingTaskId(taskId);
      const detail = await getPluginTask<PluginTaskRecord>(taskId);
      if (!detail) {
        toast.warning("任务详情不存在，可能已被清理");
        return;
      }
      setSelectedTaskDetail(detail);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`加载任务详情失败: ${message}`);
    } finally {
      setDetailLoadingTaskId(null);
    }
  };

  const openWindowsDownloadPage = useCallback(async () => {
    const url = versionInfo.downloadUrl || WINDOWS_RELEASES_URL;
    try {
      await openExternal(url);
    } catch {
      window.open(url, "_blank");
    }
  }, [versionInfo.downloadUrl]);

  const handleOpenAboutPage = useCallback(() => {
    onNavigate?.("settings", { tab: SettingsTabs.About });
  }, [onNavigate]);

  const handleDownloadAppUpdate = useCallback(async () => {
    try {
      setDownloadingUpdate(true);
      const result = await downloadUpdate();
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "下载更新失败");
    } finally {
      setDownloadingUpdate(false);
    }
  }, []);

  const pluginVersionRequirementNotice = useMemo(() => {
    if (!isWindows || !currentVersion) {
      return null;
    }

    let affectedCount = 0;
    let highestRequiredVersion: string | null = null;

    for (const plugin of plugins) {
      const requiredVersion = plugin.min_lime_version?.trim();
      if (!requiredVersion) {
        continue;
      }

      const currentComparison = compareSemverLike(
        currentVersion,
        requiredVersion,
      );
      if (currentComparison === null || currentComparison >= 0) {
        continue;
      }

      affectedCount += 1;
      if (!highestRequiredVersion) {
        highestRequiredVersion = requiredVersion;
        continue;
      }

      const requiredComparison = compareSemverLike(
        highestRequiredVersion,
        requiredVersion,
      );
      if (requiredComparison === -1) {
        highestRequiredVersion = requiredVersion;
      }
    }

    if (!highestRequiredVersion || affectedCount === 0) {
      return null;
    }

    return {
      affectedCount,
      highestRequiredVersion,
    };
  }, [currentVersion, isWindows, plugins]);

  const windowsUpdateCard = useMemo(() => {
    if (updateLoading) {
      return {
        toneClassName: "border-slate-300 bg-slate-50/80",
        badgeClassName:
          "border border-sky-200 bg-white/90 text-sky-700 hover:bg-white/90",
        badgeText: "检查中",
        title: "正在检查 Windows 主程序版本",
        summary:
          "插件中心负责扩展能力；如果需要更新 Lime 主程序或切换安装包，也可以直接从这里进入。",
      };
    }

    if (versionInfo.hasUpdate) {
      return {
        toneClassName: "border-emerald-300 bg-emerald-50/80",
        badgeClassName: "bg-emerald-600 text-white hover:bg-emerald-600",
        badgeText: `发现新版本 ${versionInfo.latest}`,
        title: "建议先升级主程序，再继续安装或排查插件",
        summary: pluginVersionRequirementNotice
          ? `当前已加载插件中有 ${pluginVersionRequirementNotice.affectedCount} 个插件要求 Lime >= ${pluginVersionRequirementNotice.highestRequiredVersion}；优先从这里升级主程序会更直接。`
          : "插件扩展不包含主程序升级；若你正在处理安装失败、运行时缺失或版本不兼容，优先从这里更新主程序会更直接。",
      };
    }

    if (pluginVersionRequirementNotice) {
      return {
        toneClassName: "border-amber-300 bg-amber-50/80",
        badgeClassName: "bg-amber-500 text-white hover:bg-amber-500",
        badgeText: "插件要求更高版本",
        title: `部分已加载插件要求 Lime >= ${pluginVersionRequirementNotice.highestRequiredVersion}`,
        summary: `当前已加载插件中有 ${pluginVersionRequirementNotice.affectedCount} 个插件要求更高主程序版本。若安装、加载或运行异常，建议先升级 Windows 主程序。`,
      };
    }

    if (versionInfo.error) {
      return {
        toneClassName: "border-amber-300 bg-amber-50/80",
        badgeClassName: "bg-amber-500 text-white hover:bg-amber-500",
        badgeText: "检查失败",
        title: "暂时无法确认主程序版本状态",
        summary:
          "你仍可前往关于页或网页下载页获取最新的 Windows setup 安装包。",
      };
    }

    return {
      toneClassName: "border-sky-200 bg-sky-50/70",
      badgeClassName: "bg-sky-600 text-white hover:bg-sky-600",
      badgeText: "已是最新",
      title: "当前主程序版本可继续使用",
      summary:
        "插件中心负责扩展能力；如果只是需要重新下载或重装 Windows setup 安装包，也可以直接从这里进入下载入口。",
    };
  }, [
    pluginVersionRequirementNotice,
    updateLoading,
    versionInfo.error,
    versionInfo.hasUpdate,
    versionInfo.latest,
  ]);

  const exportDiagnosticTasks = () => {
    try {
      const headers = [
        "taskId",
        "pluginId",
        "operation",
        "state",
        "attempt",
        "maxRetries",
        "startedAt",
        "endedAt",
        "durationMs",
        "errorCode",
        "errorMessage",
        "retryable",
      ];
      const rows = diagnosticTasks.map((task) => [
        escapeCsvValue(task.taskId),
        escapeCsvValue(task.pluginId),
        escapeCsvValue(task.operation),
        escapeCsvValue(getTaskStateLabel(task.state)),
        escapeCsvValue(task.attempt),
        escapeCsvValue(task.maxRetries),
        escapeCsvValue(task.startedAt),
        escapeCsvValue(task.endedAt),
        escapeCsvValue(task.durationMs),
        escapeCsvValue(task.error?.code),
        escapeCsvValue(task.error?.message),
        escapeCsvValue(task.error?.retryable),
      ]);
      const csv = [headers.join(","), ...rows.map((row) => row.join(","))]
        .join("\n")
        .trim();

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `plugin-diagnostics-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("任务记录已导出为 CSV");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`导出 CSV 失败: ${message}`);
    }
  };

  const handleUnloadPlugin = async (name: string) => {
    try {
      await unloadPlugin(name);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "enabled":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "disabled":
        return <PowerOff className="h-4 w-4 text-gray-400" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "enabled":
        return "已启用";
      case "disabled":
        return "已禁用";
      case "error":
        return "错误";
      case "loaded":
        return "已加载";
      default:
        return status;
    }
  };

  const resetDiagnosticFilters = useCallback(() => {
    setTaskFilter("all");
    setGlobalPluginFilter("all");
    setTaskSearchKeyword("");
    setTaskPageSize(DEFAULT_TASK_PAGE_SIZE);
    setTimeRangeFilter("all");
    setCustomStartTime("");
    setCustomEndTime("");
    setSelectedCustomRangeHistoryId("");
    setCustomRangeHistorySearchKeyword("");
    setCustomRangeHistorySort("recent");
    setCustomRangeHistoryOnlyPinned(false);
    setCustomRangeHistoryPinnedFirst(true);
    setTaskPage(1);
  }, []);

  const applyQuickCustomTimeRange = useCallback((minutes: number) => {
    const now = new Date();
    const start = new Date(now.getTime() - minutes * 60 * 1000);
    setTimeRangeFilter("custom");
    setCustomStartTime(toDateTimeLocalValue(start));
    setCustomEndTime(toDateTimeLocalValue(now));
    setSelectedCustomRangeHistoryId("");
  }, []);

  const clearCustomTimeRange = useCallback(() => {
    setCustomStartTime("");
    setCustomEndTime("");
    setSelectedCustomRangeHistoryId("");
  }, []);

  const applyLastCustomTimeRange = useCallback(() => {
    if (!lastAppliedCustomStartTime || !lastAppliedCustomEndTime) {
      return;
    }
    setTimeRangeFilter("custom");
    setCustomStartTime(lastAppliedCustomStartTime);
    setCustomEndTime(lastAppliedCustomEndTime);
    setSelectedCustomRangeHistoryId("");
  }, [lastAppliedCustomStartTime, lastAppliedCustomEndTime]);

  const applyCustomRangeHistoryItem = useCallback(
    (historyId: string) => {
      setSelectedCustomRangeHistoryId(historyId);
      const target = customRangeHistory.find((item) => item.id === historyId);
      if (!target) {
        return;
      }
      setTimeRangeFilter("custom");
      setCustomStartTime(target.start);
      setCustomEndTime(target.end);
      setSelectedCustomRangeHistoryId("");
    },
    [customRangeHistory],
  );

  const removeCustomRangeHistoryItem = useCallback((historyId: string) => {
    setCustomRangeHistory((previous) =>
      previous.filter((item) => item.id !== historyId),
    );
    setSelectedCustomRangeHistoryId("");
  }, []);

  const clearCustomRangeHistory = useCallback(() => {
    setCustomRangeHistory([]);
    setSelectedCustomRangeHistoryId("");
  }, []);

  const togglePinCustomRangeHistoryItem = useCallback((historyId: string) => {
    setCustomRangeHistory((previous) =>
      previous.map((item) =>
        item.id === historyId ? { ...item, pinned: !item.pinned } : item,
      ),
    );
  }, []);

  const exportCustomRangeHistoryAsJson = useCallback(async () => {
    if (customRangeHistory.length === 0) {
      toast.warning("暂无可导出的历史区间");
      return;
    }
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      customRangeHistory,
    };
    try {
      await writeTextToClipboard(JSON.stringify(payload, null, 2));
      toast.success("已复制历史区间 JSON");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`导出历史 JSON 失败: ${message}`);
    }
  }, [customRangeHistory]);

  const importCustomRangeHistoryFromJson = useCallback(() => {
    const text = window.prompt("请粘贴历史区间 JSON");
    if (text === null) {
      return;
    }
    const normalizedText = text.trim();
    if (!normalizedText) {
      toast.warning("未输入任何 JSON 内容");
      return;
    }

    try {
      const parsed = JSON.parse(normalizedText) as unknown;
      const importedHistory = parseCustomRangeHistoryImport(parsed);
      if (importedHistory.length === 0) {
        toast.warning("JSON 中未包含有效历史区间");
        return;
      }
      setCustomRangeHistory(importedHistory);
      setSelectedCustomRangeHistoryId("");
      setCustomRangeHistorySearchKeyword("");
      setCustomRangeHistorySort("recent");
      toast.success(`已导入 ${importedHistory.length} 条历史区间`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`导入历史 JSON 失败: ${message}`);
    }
  }, []);

  const filteredCustomRangeHistory = useMemo(() => {
    const keyword = customRangeHistorySearchKeyword.trim().toLowerCase();
    const sorted = [...customRangeHistory].sort((left, right) => {
      if (customRangeHistoryPinnedFirst && left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1;
      }
      if (customRangeHistorySort === "label") {
        const leftKey = left.label || `${left.start}-${left.end}`;
        const rightKey = right.label || `${right.start}-${right.end}`;
        return leftKey.localeCompare(rightKey, "zh-Hans-CN");
      }
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });

    if (!keyword) {
      return customRangeHistoryOnlyPinned
        ? sorted.filter((item) => item.pinned)
        : sorted;
    }
    return sorted.filter((item) => {
      if (customRangeHistoryOnlyPinned && !item.pinned) {
        return false;
      }
      const searchable = [item.label, item.start, item.end]
        .join(" ")
        .toLowerCase();
      return searchable.includes(keyword);
    });
  }, [
    customRangeHistory,
    customRangeHistorySearchKeyword,
    customRangeHistorySort,
    customRangeHistoryOnlyPinned,
    customRangeHistoryPinnedFirst,
  ]);

  const pinnedCustomRangeHistoryCount = useMemo(
    () => customRangeHistory.filter((item) => item.pinned).length,
    [customRangeHistory],
  );

  const customRangeHistoryEmptyHintText = useMemo(() => {
    const hasSearchKeyword = customRangeHistorySearchKeyword.trim().length > 0;
    if (customRangeHistoryOnlyPinned) {
      if (pinnedCustomRangeHistoryCount === 0) {
        return "当前仅收藏模式下暂无历史区间";
      }
      return hasSearchKeyword
        ? "当前仅收藏模式与关键词下无匹配历史区间"
        : "当前仅收藏模式下无匹配历史区间";
    }
    return hasSearchKeyword ? "当前关键词下无匹配历史区间" : "暂无历史区间";
  }, [
    customRangeHistoryOnlyPinned,
    customRangeHistorySearchKeyword,
    pinnedCustomRangeHistoryCount,
  ]);

  const customRangeHistoryCountText = useMemo(() => {
    if (customRangeHistoryOnlyPinned) {
      return `总计 ${customRangeHistory.length} 条，收藏 ${pinnedCustomRangeHistoryCount} 条，仅收藏匹配 ${filteredCustomRangeHistory.length} 条`;
    }
    return `共 ${customRangeHistory.length} 条，匹配 ${filteredCustomRangeHistory.length} 条，收藏 ${pinnedCustomRangeHistoryCount} 条`;
  }, [
    customRangeHistory.length,
    customRangeHistoryOnlyPinned,
    filteredCustomRangeHistory.length,
    pinnedCustomRangeHistoryCount,
  ]);

  const customRangeHistoryViewMode = useMemo<CustomRangeHistoryViewMode>(() => {
    if (customRangeHistoryOnlyPinned) {
      return "only_pinned";
    }
    return customRangeHistoryPinnedFirst ? "default" : "flat";
  }, [customRangeHistoryOnlyPinned, customRangeHistoryPinnedFirst]);

  const handleCustomRangeHistoryViewModeChange = useCallback(
    (mode: CustomRangeHistoryViewMode) => {
      if (mode === "only_pinned") {
        setCustomRangeHistoryOnlyPinned(true);
        setCustomRangeHistoryPinnedFirst(true);
        return;
      }
      if (mode === "flat") {
        setCustomRangeHistoryOnlyPinned(false);
        setCustomRangeHistoryPinnedFirst(false);
        return;
      }
      setCustomRangeHistoryOnlyPinned(false);
      setCustomRangeHistoryPinnedFirst(true);
    },
    [],
  );

  const renameCustomRangeHistoryItem = useCallback(
    (historyId: string) => {
      const target = customRangeHistory.find((item) => item.id === historyId);
      if (!target) {
        return;
      }
      const nextLabel = window.prompt("请输入区间标签", target.label);
      if (nextLabel === null) {
        return;
      }
      const normalizedLabel = nextLabel.trim();
      setCustomRangeHistory((previous) =>
        previous.map((item) =>
          item.id === historyId ? { ...item, label: normalizedLabel } : item,
        ),
      );
    },
    [customRangeHistory],
  );

  const copyLastCustomTimeRange = useCallback(async () => {
    if (!lastAppliedCustomStartTime || !lastAppliedCustomEndTime) {
      toast.warning("暂无可复制的上次区间");
      return;
    }

    const rangeText = `上次区间: ${lastAppliedCustomStartTime} ~ ${lastAppliedCustomEndTime}`;
    try {
      await writeTextToClipboard(rangeText);
      toast.success("已复制上次区间");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`复制区间失败: ${message}`);
    }
  }, [lastAppliedCustomStartTime, lastAppliedCustomEndTime]);

  const copyLastCustomTimeRangeAsJson = useCallback(async () => {
    if (!lastAppliedCustomStartTime || !lastAppliedCustomEndTime) {
      toast.warning("暂无可复制的上次区间");
      return;
    }

    const payload = {
      start: lastAppliedCustomStartTime,
      end: lastAppliedCustomEndTime,
      updatedAt: lastAppliedCustomUpdatedAt || null,
    };

    try {
      await writeTextToClipboard(JSON.stringify(payload, null, 2));
      toast.success("已复制区间 JSON");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`复制 JSON 失败: ${message}`);
    }
  }, [
    lastAppliedCustomStartTime,
    lastAppliedCustomEndTime,
    lastAppliedCustomUpdatedAt,
  ]);

  const effectiveTimeBounds = useMemo<EffectiveTaskTimeBounds>(() => {
    if (timeRangeFilter === "all") {
      return {
        effectiveStartMs: null,
        effectiveEndMs: null,
        isCustomRangeSwapped: false,
        isCustomRangeEmpty: false,
      };
    }

    if (timeRangeFilter !== "custom") {
      return {
        effectiveStartMs: Date.now() - TASK_TIME_RANGE_TO_MS[timeRangeFilter],
        effectiveEndMs: null,
        isCustomRangeSwapped: false,
        isCustomRangeEmpty: false,
      };
    }

    const parsedStartMs = Date.parse(customStartTime);
    const parsedEndMs = Date.parse(customEndTime);
    const hasStart = !Number.isNaN(parsedStartMs);
    const hasEnd = !Number.isNaN(parsedEndMs);
    const isCustomRangeEmpty = !hasStart && !hasEnd;

    let effectiveStartMs = hasStart ? parsedStartMs : null;
    let effectiveEndMs = hasEnd ? parsedEndMs : null;
    let isCustomRangeSwapped = false;

    if (
      effectiveStartMs !== null &&
      effectiveEndMs !== null &&
      effectiveStartMs > effectiveEndMs
    ) {
      [effectiveStartMs, effectiveEndMs] = [effectiveEndMs, effectiveStartMs];
      isCustomRangeSwapped = true;
    }

    return {
      effectiveStartMs,
      effectiveEndMs,
      isCustomRangeSwapped,
      isCustomRangeEmpty,
    };
  }, [timeRangeFilter, customStartTime, customEndTime]);

  const customRangeHintText = useMemo(() => {
    if (timeRangeFilter !== "custom") {
      return "";
    }
    if (effectiveTimeBounds.isCustomRangeEmpty) {
      return "未设置开始/结束时间，当前展示全部任务。";
    }
    if (effectiveTimeBounds.isCustomRangeSwapped) {
      return "开始时间晚于结束时间，系统已自动按时间先后处理。";
    }
    if (
      effectiveTimeBounds.effectiveStartMs !== null &&
      effectiveTimeBounds.effectiveEndMs !== null
    ) {
      return "按开始与结束时间区间过滤。";
    }
    if (effectiveTimeBounds.effectiveStartMs !== null) {
      return "按开始时间向后过滤。";
    }
    return "按结束时间向前过滤。";
  }, [timeRangeFilter, effectiveTimeBounds]);

  useEffect(() => {
    if (timeRangeFilter !== "custom") {
      return;
    }
    const { effectiveStartMs, effectiveEndMs } = effectiveTimeBounds;
    if (effectiveStartMs === null || effectiveEndMs === null) {
      return;
    }
    const normalizedStart = toDateTimeLocalValue(new Date(effectiveStartMs));
    const normalizedEnd = toDateTimeLocalValue(new Date(effectiveEndMs));
    if (
      normalizedStart === lastAppliedCustomStartTime &&
      normalizedEnd === lastAppliedCustomEndTime
    ) {
      return;
    }
    const nowIso = new Date().toISOString();
    setLastAppliedCustomStartTime(normalizedStart);
    setLastAppliedCustomEndTime(normalizedEnd);
    setLastAppliedCustomUpdatedAt(nowIso);
    setCustomRangeHistory((previous) => {
      const historyId = buildCustomRangeHistoryId(
        normalizedStart,
        normalizedEnd,
      );
      const existed = previous.find((item) => item.id === historyId);
      const nextItem: CustomRangeHistoryItem = {
        id: historyId,
        start: normalizedStart,
        end: normalizedEnd,
        updatedAt: nowIso,
        label: existed?.label ?? "",
        pinned: existed?.pinned ?? false,
      };
      const filtered = previous.filter((item) => item.id !== nextItem.id);
      return [nextItem, ...filtered].slice(0, MAX_CUSTOM_RANGE_HISTORY);
    });
  }, [
    timeRangeFilter,
    effectiveTimeBounds,
    lastAppliedCustomStartTime,
    lastAppliedCustomEndTime,
  ]);

  const diagnosticTasks = useMemo(() => {
    const keyword = taskSearchKeyword.trim().toLowerCase();

    return allTasks.filter((task) => {
      if (
        globalPluginFilter !== "all" &&
        task.pluginId !== globalPluginFilter
      ) {
        return false;
      }

      if (
        effectiveTimeBounds.effectiveStartMs !== null ||
        effectiveTimeBounds.effectiveEndMs !== null
      ) {
        const startedAtMs = Date.parse(task.startedAt);
        if (Number.isNaN(startedAtMs)) {
          return false;
        }
        if (
          effectiveTimeBounds.effectiveStartMs !== null &&
          startedAtMs < effectiveTimeBounds.effectiveStartMs
        ) {
          return false;
        }
        if (
          effectiveTimeBounds.effectiveEndMs !== null &&
          startedAtMs > effectiveTimeBounds.effectiveEndMs
        ) {
          return false;
        }
      }

      if (!keyword) {
        return true;
      }

      const searchableText = [
        task.taskId,
        task.pluginId,
        task.operation,
        getTaskStateLabel(task.state),
        task.error?.code ?? "",
        task.error?.message ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return searchableText.includes(keyword);
    });
  }, [allTasks, globalPluginFilter, taskSearchKeyword, effectiveTimeBounds]);

  const totalTaskPages = Math.max(
    1,
    Math.ceil(diagnosticTasks.length / taskPageSize),
  );

  const pagedDiagnosticTasks = useMemo(() => {
    const safePage = Math.min(Math.max(taskPage, 1), totalTaskPages);
    const offset = (safePage - 1) * taskPageSize;
    return diagnosticTasks.slice(offset, offset + taskPageSize);
  }, [diagnosticTasks, taskPage, taskPageSize, totalTaskPages]);

  const taskRangeStart =
    diagnosticTasks.length === 0 ? 0 : (taskPage - 1) * taskPageSize + 1;
  const taskRangeEnd = Math.min(
    taskPage * taskPageSize,
    diagnosticTasks.length,
  );

  useEffect(() => {
    setTaskPage(1);
  }, [
    taskFilter,
    globalPluginFilter,
    taskSearchKeyword,
    taskPageSize,
    timeRangeFilter,
    customStartTime,
    customEndTime,
  ]);

  useEffect(() => {
    if (taskPage > totalTaskPages) {
      setTaskPage(totalTaskPages);
    }
  }, [taskPage, totalTaskPages]);

  useEffect(() => {
    if (!selectedTaskDetail) {
      return;
    }
    const exists = diagnosticTasks.some(
      (task) => task.taskId === selectedTaskDetail.taskId,
    );
    if (!exists) {
      setSelectedTaskDetail(null);
    }
  }, [diagnosticTasks, selectedTaskDetail]);

  const goPrevPage = () => {
    setTaskPage((previous) => Math.max(1, previous - 1));
  };

  const goNextPage = () => {
    setTaskPage((previous) => Math.min(totalTaskPages, previous + 1));
  };

  const visiblePages = useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(1, taskPage - 1);
    const end = Math.min(totalTaskPages, taskPage + 1);
    for (let current = start; current <= end; current += 1) {
      pages.push(current);
    }
    return pages;
  }, [taskPage, totalTaskPages]);

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isWindows && (
        <div
          className={`rounded-lg border p-4 ${windowsUpdateCard.toneClassName}`}
          data-testid="plugin-windows-update-card"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-semibold text-slate-900">
                  Windows 主程序更新与安装包
                </div>
                <Badge
                  className={windowsUpdateCard.badgeClassName}
                  data-testid="plugin-windows-update-status"
                >
                  {windowsUpdateCard.badgeText}
                </Badge>
              </div>
              <p className="text-sm font-medium text-slate-800">
                {windowsUpdateCard.title}
              </p>
              <p className="text-sm text-slate-700">
                {windowsUpdateCard.summary}
              </p>
              <div className="flex flex-wrap gap-2 text-xs text-slate-700">
                <div className="rounded-md border border-white/70 bg-white/70 px-2.5 py-1">
                  当前版本：{versionInfo.current || "未获取"}
                </div>
                <div className="rounded-md border border-white/70 bg-white/70 px-2.5 py-1">
                  最新版本：
                  {updateLoading
                    ? "检查中"
                    : versionInfo.latest || "当前已是最新"}
                </div>
                <div className="rounded-md border border-white/70 bg-white/70 px-2.5 py-1">
                  安装包类型：Windows setup
                </div>
              </div>
              <p className="text-xs text-slate-600">
                Windows 仅保留单一 setup
                安装包；需要重装或手动升级时直接使用它即可。
              </p>
              {pluginVersionRequirementNotice && (
                <div
                  className="rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-900"
                  data-testid="plugin-windows-version-requirement-notice"
                >
                  当前已加载插件中有{" "}
                  {pluginVersionRequirementNotice.affectedCount}{" "}
                  个插件要求更高主程序版本， 最高要求 Lime {"\u003e="}{" "}
                  {pluginVersionRequirementNotice.highestRequiredVersion}。
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {versionInfo.hasUpdate && (
                <Button
                  size="sm"
                  onClick={() => void handleDownloadAppUpdate()}
                  disabled={downloadingUpdate}
                  data-testid="plugin-windows-update-download"
                >
                  <Download className="mr-1 h-4 w-4" />
                  {downloadingUpdate ? "下载中..." : "下载更新"}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refreshWindowsVersionInfo()}
                disabled={updateLoading}
                data-testid="plugin-windows-update-refresh"
              >
                <RefreshCw
                  className={`mr-1 h-4 w-4 ${updateLoading ? "animate-spin" : ""}`}
                />
                重新检查
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleOpenAboutPage}
                disabled={!onNavigate}
                data-testid="plugin-windows-update-open-about"
              >
                前往关于页
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void openWindowsDownloadPage()}
                data-testid="plugin-windows-update-open-downloads"
              >
                <ExternalLink className="mr-1 h-4 w-4" />
                网页下载
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 状态概览 */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Puzzle className="h-4 w-4" />
            插件系统
          </h3>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setShowInstallDialog(true)}
              className="gap-1"
            >
              <Plus className="h-4 w-4" />
              安装插件
            </Button>
            <button
              onClick={handleReloadPlugins}
              className="p-1 hover:bg-muted rounded"
              title="重新加载插件"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-2 bg-red-50 text-red-600 rounded text-sm">
            {error}
          </div>
        )}

        {status && (
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{status.plugin_count}</div>
              <div className="text-xs text-muted-foreground">已加载插件</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">
                {installedPlugins.length}
              </div>
              <div className="text-xs text-muted-foreground">已安装插件</div>
            </div>
            <div className="text-center">
              <div
                className="text-sm font-mono truncate"
                title={status.plugins_dir}
              >
                <FolderOpen className="h-4 w-4 inline mr-1" />
                {status.plugins_dir.split("/").pop()}
              </div>
              <div className="text-xs text-muted-foreground">插件目录</div>
            </div>
          </div>
        )}
      </div>

      {/* 已安装插件列表（通过安装器安装的） */}
      {installedPlugins.length > 0 && (
        <div className="rounded-lg border bg-card">
          <div className="p-4 border-b flex items-center justify-between">
            <h4 className="font-semibold flex items-center gap-2">
              <Package className="h-4 w-4" />
              已安装插件包
            </h4>
          </div>
          <div className="divide-y">
            {installedPlugins.map((plugin) => (
              <PluginItemContextMenu
                key={plugin.id}
                plugin={plugin}
                onToggleEnabled={async () => {
                  try {
                    if (plugin.enabled) {
                      await disablePlugin(plugin.id);
                      toast.success("插件已禁用");
                    } else {
                      await enablePlugin(plugin.id);
                      toast.success("插件已启用");
                    }
                    fetchData();
                  } catch (_err) {
                    toast.error("操作失败");
                  }
                }}
                onUninstall={() => setPluginToUninstall(plugin)}
              >
                <div>
                  <InstalledPluginItem
                    plugin={plugin}
                    onUninstall={() => setPluginToUninstall(plugin)}
                  />
                </div>
              </PluginItemContextMenu>
            ))}
          </div>
        </div>
      )}

      {/* 插件列表 */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <h4 className="font-semibold">已加载插件</h4>
        </div>

        {plugins.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Puzzle className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>暂无已加载的插件</p>
            <p className="text-sm mt-1">点击"安装插件"按钮添加新插件</p>
          </div>
        ) : (
          <div className="divide-y">
            {plugins.map((plugin) => (
              <PluginItem
                key={plugin.name}
                plugin={plugin}
                expanded={expandedPlugin === plugin.name}
                onToggleExpand={() =>
                  setExpandedPlugin(
                    expandedPlugin === plugin.name ? null : plugin.name,
                  )
                }
                onToggleEnabled={() =>
                  handleTogglePlugin(plugin.name, plugin.config.enabled)
                }
                onUnload={() => handleUnloadPlugin(plugin.name)}
                tasks={pluginTasks[plugin.name] || []}
                queueStats={queueStats[plugin.name]}
                onCancelTask={handleCancelTask}
                cancellingTaskId={cancellingTaskId}
                getStatusIcon={getStatusIcon}
                getStatusText={getStatusText}
              />
            ))}
          </div>
        )}
      </div>

      {/* 运行诊断 */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b flex items-center justify-between">
          <h4 className="font-semibold">运行诊断</h4>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={exportDiagnosticTasks}
              data-testid="plugin-runtime-export-csv"
            >
              导出 CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={fetchRuntimeData}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              刷新运行态
            </Button>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              插件筛选
              <select
                value={globalPluginFilter}
                onChange={(event) => setGlobalPluginFilter(event.target.value)}
                className="text-xs border rounded px-2 py-1 bg-background"
                data-testid="plugin-runtime-plugin-filter"
              >
                <option value="all">全部插件</option>
                {plugins.map((plugin) => (
                  <option key={plugin.name} value={plugin.name}>
                    {plugin.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              关键词搜索
              <input
                value={taskSearchKeyword}
                onChange={(event) => setTaskSearchKeyword(event.target.value)}
                placeholder="任务ID/插件/操作/错误"
                className="text-xs border rounded px-2 py-1 bg-background w-full"
                data-testid="plugin-runtime-search-input"
              />
            </label>
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              每页条数
              <select
                value={taskPageSize}
                onChange={(event) =>
                  setTaskPageSize(Number(event.target.value))
                }
                className="text-xs border rounded px-2 py-1 bg-background"
                data-testid="plugin-runtime-page-size"
              >
                {TASK_PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              状态筛选
              <select
                value={taskFilter}
                onChange={(event) =>
                  setTaskFilter(event.target.value as PluginTaskFilter)
                }
                className="text-xs border rounded px-2 py-1 bg-background"
                data-testid="plugin-runtime-state-filter"
              >
                <option value="all">全部</option>
                <option value="running">执行中</option>
                <option value="retrying">重试中</option>
                <option value="queued">排队中</option>
                <option value="failed">失败</option>
                <option value="timed_out">超时</option>
                <option value="succeeded">成功</option>
                <option value="cancelled">已取消</option>
              </select>
            </label>
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              时间范围
              <select
                value={timeRangeFilter}
                onChange={(event) =>
                  setTimeRangeFilter(
                    event.target.value as PluginTaskTimeRangeFilter,
                  )
                }
                className="text-xs border rounded px-2 py-1 bg-background"
                data-testid="plugin-runtime-time-range-filter"
              >
                <option value="all">全部时间</option>
                <option value="1h">最近 1 小时</option>
                <option value="24h">最近 24 小时</option>
                <option value="7d">最近 7 天</option>
                <option value="custom">自定义区间</option>
              </select>
            </label>
            <div className="flex items-center">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={resetDiagnosticFilters}
                data-testid="plugin-runtime-reset-filters"
              >
                重置筛选
              </Button>
            </div>
          </div>
          {timeRangeFilter === "custom" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {QUICK_CUSTOM_RANGE_MINUTES.map((minutes) => (
                  <Button
                    key={minutes}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => applyQuickCustomTimeRange(minutes)}
                    data-testid={`plugin-runtime-quick-range-${minutes}m`}
                  >
                    近 {minutes} 分钟
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={applyLastCustomTimeRange}
                  disabled={
                    !lastAppliedCustomStartTime || !lastAppliedCustomEndTime
                  }
                  data-testid="plugin-runtime-custom-apply-last-range"
                >
                  应用上次区间
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => void copyLastCustomTimeRange()}
                  disabled={
                    !lastAppliedCustomStartTime || !lastAppliedCustomEndTime
                  }
                  data-testid="plugin-runtime-custom-copy-last-range"
                >
                  复制上次区间
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => void copyLastCustomTimeRangeAsJson()}
                  disabled={
                    !lastAppliedCustomStartTime || !lastAppliedCustomEndTime
                  }
                  data-testid="plugin-runtime-custom-copy-last-range-json"
                >
                  复制 JSON
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={clearCustomTimeRange}
                  data-testid="plugin-runtime-custom-clear-range"
                >
                  清空区间
                </Button>
              </div>
              <div
                className="text-xs text-muted-foreground"
                data-testid="plugin-runtime-custom-last-range"
              >
                {lastAppliedCustomStartTime && lastAppliedCustomEndTime
                  ? `上次区间：${formatTime(lastAppliedCustomStartTime)} - ${formatTime(lastAppliedCustomEndTime)}`
                  : "上次区间：暂无"}
              </div>
              <div
                className="text-xs text-muted-foreground"
                data-testid="plugin-runtime-custom-last-range-updated-at"
              >
                最近使用：
                {lastAppliedCustomUpdatedAt
                  ? formatTime(lastAppliedCustomUpdatedAt)
                  : "暂无"}
              </div>
              <label className="text-xs text-muted-foreground flex items-center gap-2">
                历史区间
                <input
                  value={customRangeHistorySearchKeyword}
                  onChange={(event) =>
                    setCustomRangeHistorySearchKeyword(event.target.value)
                  }
                  placeholder="搜索标签/时间"
                  className="text-xs border rounded px-2 py-1 bg-background"
                  data-testid="plugin-runtime-custom-history-search"
                />
                <select
                  value={customRangeHistorySort}
                  onChange={(event) =>
                    setCustomRangeHistorySort(
                      event.target.value as CustomRangeHistorySort,
                    )
                  }
                  className="text-xs border rounded px-2 py-1 bg-background"
                  data-testid="plugin-runtime-custom-history-sort"
                >
                  <option value="recent">最近使用</option>
                  <option value="label">按标签排序</option>
                </select>
                <select
                  value={customRangeHistoryViewMode}
                  onChange={(event) =>
                    handleCustomRangeHistoryViewModeChange(
                      event.target.value as CustomRangeHistoryViewMode,
                    )
                  }
                  className="text-xs border rounded px-2 py-1 bg-background"
                  data-testid="plugin-runtime-custom-history-view-mode"
                >
                  <option value="default">默认（收藏置顶）</option>
                  <option value="flat">纯排序（不置顶）</option>
                  <option value="only_pinned">仅收藏</option>
                </select>
                <select
                  value={selectedCustomRangeHistoryId}
                  onChange={(event) =>
                    applyCustomRangeHistoryItem(event.target.value)
                  }
                  className="text-xs border rounded px-2 py-1 bg-background"
                  data-testid="plugin-runtime-custom-history-select"
                >
                  <option value="">选择历史区间</option>
                  {filteredCustomRangeHistory.map((item) => (
                    <option key={item.id} value={item.id}>
                      {(item.pinned ? "★ " : "") +
                        (item.label
                          ? `${item.label}（${formatTime(item.start)} ~ ${formatTime(item.end)}）`
                          : `${formatTime(item.start)} ~ ${formatTime(item.end)}`)}
                    </option>
                  ))}
                </select>
                <span
                  className="text-muted-foreground/80"
                  data-testid="plugin-runtime-custom-history-count"
                >
                  {customRangeHistoryCountText}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={clearCustomRangeHistory}
                  disabled={customRangeHistory.length === 0}
                  data-testid="plugin-runtime-custom-history-clear-all"
                >
                  清空历史
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => void exportCustomRangeHistoryAsJson()}
                  disabled={customRangeHistory.length === 0}
                  data-testid="plugin-runtime-custom-history-export-json"
                >
                  导出 JSON
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={importCustomRangeHistoryFromJson}
                  data-testid="plugin-runtime-custom-history-import-json"
                >
                  导入 JSON
                </Button>
              </label>
              {filteredCustomRangeHistory.length > 0 && (
                <div
                  className="space-y-1"
                  data-testid="plugin-runtime-custom-history-list"
                >
                  {filteredCustomRangeHistory.map((item, index) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 text-xs text-muted-foreground rounded border px-2 py-1"
                      data-testid={`plugin-runtime-custom-history-item-${index}`}
                    >
                      <span className="truncate">
                        {(item.pinned ? "★ " : "") +
                          (item.label
                            ? `${item.label}：${formatTime(item.start)} ~ ${formatTime(item.end)}`
                            : `${formatTime(item.start)} ~ ${formatTime(item.end)}`)}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() =>
                            togglePinCustomRangeHistoryItem(item.id)
                          }
                          data-testid={`plugin-runtime-custom-history-pin-${index}`}
                        >
                          {item.pinned ? "取消收藏" : "收藏"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => renameCustomRangeHistoryItem(item.id)}
                          data-testid={`plugin-runtime-custom-history-rename-${index}`}
                        >
                          命名
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => removeCustomRangeHistoryItem(item.id)}
                          data-testid={`plugin-runtime-custom-history-delete-${index}`}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {filteredCustomRangeHistory.length === 0 &&
                customRangeHistory.length > 0 && (
                  <div
                    className="text-xs text-muted-foreground"
                    data-testid="plugin-runtime-custom-history-empty"
                  >
                    {customRangeHistoryEmptyHintText}
                  </div>
                )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <label className="text-xs text-muted-foreground flex items-center gap-2">
                  开始时间
                  <input
                    type="datetime-local"
                    value={customStartTime}
                    onChange={(event) => setCustomStartTime(event.target.value)}
                    className="text-xs border rounded px-2 py-1 bg-background w-full"
                    data-testid="plugin-runtime-custom-start-input"
                  />
                </label>
                <label className="text-xs text-muted-foreground flex items-center gap-2">
                  结束时间
                  <input
                    type="datetime-local"
                    value={customEndTime}
                    onChange={(event) => setCustomEndTime(event.target.value)}
                    className="text-xs border rounded px-2 py-1 bg-background w-full"
                    data-testid="plugin-runtime-custom-end-input"
                  />
                </label>
              </div>
              <div
                className="text-xs text-muted-foreground"
                data-testid="plugin-runtime-custom-range-hint"
              >
                {customRangeHintText}
              </div>
            </div>
          )}

          {diagnosticTasks.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              当前筛选下暂无任务记录
            </div>
          ) : (
            <div className="rounded border overflow-hidden space-y-0">
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <th className="px-2 py-2">插件</th>
                      <th className="px-2 py-2">操作</th>
                      <th className="px-2 py-2">状态</th>
                      <th className="px-2 py-2">尝试</th>
                      <th className="px-2 py-2">开始时间</th>
                      <th className="px-2 py-2">耗时</th>
                      <th className="px-2 py-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedDiagnosticTasks.map((task) => (
                      <tr
                        key={task.taskId}
                        className="border-t"
                        data-testid={`plugin-runtime-row-${task.taskId}`}
                      >
                        <td className="px-2 py-2">{task.pluginId}</td>
                        <td className="px-2 py-2">{task.operation}</td>
                        <td className="px-2 py-2">
                          <span
                            className={`px-2 py-0.5 rounded ${getTaskStateClassName(task.state)}`}
                          >
                            {getTaskStateLabel(task.state)}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          {task.attempt}/{task.maxRetries + 1}
                        </td>
                        <td className="px-2 py-2">
                          {formatTime(task.startedAt)}
                        </td>
                        <td className="px-2 py-2">{task.durationMs ?? 0}ms</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handleLoadTaskDetail(task.taskId)}
                              disabled={detailLoadingTaskId === task.taskId}
                              data-testid={`plugin-task-detail-${task.taskId}`}
                            >
                              {detailLoadingTaskId === task.taskId
                                ? "加载中..."
                                : "详情"}
                            </Button>
                            {canCancelTask(task) && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => handleCancelTask(task.taskId)}
                                disabled={cancellingTaskId === task.taskId}
                                data-testid={`plugin-task-cancel-${task.taskId}`}
                              >
                                取消
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t px-3 py-2 flex items-center justify-between text-xs bg-muted/20">
                <div className="text-muted-foreground">
                  显示 {taskRangeStart}-{taskRangeEnd} /{" "}
                  {diagnosticTasks.length}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2"
                    onClick={goPrevPage}
                    disabled={taskPage <= 1}
                    data-testid="plugin-runtime-prev-page"
                  >
                    上一页
                  </Button>
                  {visiblePages.map((page) => (
                    <Button
                      key={page}
                      size="sm"
                      variant={taskPage === page ? "default" : "outline"}
                      className="h-7 px-2"
                      onClick={() => setTaskPage(page)}
                      data-testid={`plugin-runtime-page-${page}`}
                    >
                      {page}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2"
                    onClick={goNextPage}
                    disabled={taskPage >= totalTaskPages}
                    data-testid="plugin-runtime-next-page"
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </div>
          )}

          {selectedTaskDetail && (
            <div
              className="rounded border p-3 bg-muted/20 text-xs space-y-2"
              data-testid="plugin-task-detail-panel"
            >
              <div className="flex items-center justify-between">
                <div className="font-medium">任务详情</div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => setSelectedTaskDetail(null)}
                >
                  关闭
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div>任务ID: {selectedTaskDetail.taskId}</div>
                <div>插件: {selectedTaskDetail.pluginId}</div>
                <div>操作: {selectedTaskDetail.operation}</div>
                <div>状态: {getTaskStateLabel(selectedTaskDetail.state)}</div>
                <div>
                  尝试: {selectedTaskDetail.attempt}/
                  {selectedTaskDetail.maxRetries + 1}
                </div>
                <div>耗时: {selectedTaskDetail.durationMs ?? 0}ms</div>
                <div>开始: {formatTime(selectedTaskDetail.startedAt)}</div>
                <div>结束: {formatTime(selectedTaskDetail.endedAt)}</div>
              </div>
              {selectedTaskDetail.error?.message && (
                <div className="text-red-600 break-all">
                  错误: {selectedTaskDetail.error.message}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 安装对话框 */}
      <PluginInstallDialog
        isOpen={showInstallDialog}
        onClose={() => {
          setShowInstallDialog(false);
        }}
        onSuccess={handleInstallSuccess}
      />

      {/* 卸载确认对话框 */}
      <PluginUninstallDialog
        isOpen={pluginToUninstall !== null}
        plugin={pluginToUninstall}
        onClose={() => setPluginToUninstall(null)}
        onSuccess={fetchData}
      />
    </div>
  );
}

interface PluginItemProps {
  plugin: PluginInfo;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onUnload: () => void;
  tasks: PluginTaskRecord[];
  queueStats?: PluginQueueStats;
  onCancelTask: (taskId: string) => Promise<void>;
  cancellingTaskId: string | null;
  getStatusIcon: (status: string) => React.ReactNode;
  getStatusText: (status: string) => string;
}

function PluginItem({
  plugin,
  expanded,
  onToggleExpand,
  onToggleEnabled,
  onUnload,
  tasks,
  queueStats,
  onCancelTask,
  cancellingTaskId,
  getStatusIcon,
  getStatusText,
}: PluginItemProps) {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleExpand}
            className="p-1 hover:bg-muted rounded"
            data-testid={`plugin-expand-${plugin.name}`}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{plugin.name}</span>
              {plugin.version && (
                <Badge variant="secondary" className="text-xs">
                  v{plugin.version}
                </Badge>
              )}
              <span className="flex items-center gap-1 text-xs">
                {getStatusIcon(plugin.status)}
                {getStatusText(plugin.status)}
              </span>
            </div>
            <div className="text-sm text-muted-foreground">
              {plugin.description || "无描述"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggleEnabled}
            className={`p-2 rounded ${
              plugin.config.enabled
                ? "bg-green-100 text-green-600 hover:bg-green-200"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
            title={plugin.config.enabled ? "禁用插件" : "启用插件"}
          >
            {plugin.config.enabled ? (
              <Power className="h-4 w-4" />
            ) : (
              <PowerOff className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={onUnload}
            className="p-2 rounded bg-red-100 text-red-600 hover:bg-red-200"
            title="卸载插件"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pl-8 space-y-3">
          {plugin.author && (
            <div className="text-sm">
              <span className="text-muted-foreground">作者：</span>
              {plugin.author}
            </div>
          )}

          <div className="text-sm">
            <span className="text-muted-foreground">路径：</span>
            <span className="font-mono text-xs">{plugin.path}</span>
          </div>

          {plugin.hooks.length > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">钩子：</span>
              <div className="flex gap-1 mt-1">
                {plugin.hooks.map((hook) => (
                  <span
                    key={hook}
                    className="rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-700"
                  >
                    {hook}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="text-sm">
            <span className="text-muted-foreground">统计：</span>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <div className="text-center p-2 bg-muted rounded">
                <div className="font-bold">{plugin.state.execution_count}</div>
                <div className="text-xs text-muted-foreground">执行次数</div>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <div className="font-bold text-red-500">
                  {plugin.state.error_count}
                </div>
                <div className="text-xs text-muted-foreground">错误次数</div>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <div className="font-bold">{plugin.config.timeout_ms}ms</div>
                <div className="text-xs text-muted-foreground">超时时间</div>
              </div>
            </div>
          </div>

          {plugin.state.last_error && (
            <div className="text-sm p-2 bg-red-50 text-red-600 rounded">
              <span className="font-medium">最后错误：</span>
              {plugin.state.last_error}
            </div>
          )}

          <div className="text-sm">
            <span className="text-muted-foreground">执行队列：</span>
            <div className="grid grid-cols-4 gap-2 mt-1">
              <div className="text-center p-2 bg-muted rounded">
                <div className="font-bold">{queueStats?.running ?? 0}</div>
                <div className="text-xs text-muted-foreground">运行中</div>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <div className="font-bold">{queueStats?.waiting ?? 0}</div>
                <div className="text-xs text-muted-foreground">排队中</div>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <div className="font-bold text-red-500">
                  {(queueStats?.failed ?? 0) + (queueStats?.timedOut ?? 0)}
                </div>
                <div className="text-xs text-muted-foreground">失败/超时</div>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <div className="font-bold">{queueStats?.rejected ?? 0}</div>
                <div className="text-xs text-muted-foreground">队列拒绝</div>
              </div>
            </div>
          </div>

          <div className="text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">最近任务：</span>
              <span className="text-xs text-muted-foreground">
                共 {tasks.length} 条
              </span>
            </div>
            {tasks.length === 0 ? (
              <div className="mt-2 text-xs text-muted-foreground">
                暂无任务记录
              </div>
            ) : (
              <div className="mt-2 space-y-2 max-h-64 overflow-y-auto pr-1">
                {tasks.slice(0, 8).map((task) => (
                  <div
                    key={task.taskId}
                    className="rounded border bg-background px-2 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{task.operation}</div>
                      <span
                        className={`px-2 py-0.5 rounded ${getTaskStateClassName(task.state)}`}
                      >
                        {getTaskStateLabel(task.state)}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                      <span>
                        尝试 {task.attempt}/{task.maxRetries + 1}
                      </span>
                      <span>开始 {formatTime(task.startedAt)}</span>
                      <span>耗时 {task.durationMs ?? 0}ms</span>
                    </div>
                    {task.error?.message && (
                      <div className="mt-1 text-red-600 break-all">
                        {task.error.message}
                      </div>
                    )}
                    {canCancelTask(task) && (
                      <div className="mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => onCancelTask(task.taskId)}
                          disabled={cancellingTaskId === task.taskId}
                          data-testid={`plugin-cancel-task-${task.taskId}`}
                        >
                          <Ban className="h-3 w-3 mr-1" />
                          {cancellingTaskId === task.taskId
                            ? "取消中..."
                            : "取消任务"}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 已安装插件项组件 */
interface InstalledPluginItemProps {
  plugin: InstalledPlugin;
  onUninstall: () => void;
}

function InstalledPluginItem({
  plugin,
  onUninstall,
}: InstalledPluginItemProps) {
  // 获取安装来源显示文本
  const getSourceText = (source: InstallSource): string => {
    switch (source.type) {
      case "local":
        return `本地文件: ${source.path?.split("/").pop() || "未知"}`;
      case "url":
        return `URL: ${source.url?.split("/").pop() || "未知"}`;
      case "github":
        return `GitHub: ${source.owner}/${source.repo}@${source.tag}`;
      default:
        return "未知来源";
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{plugin.name}</span>
            {plugin.version && (
              <Badge variant="secondary" className="text-xs">
                v{plugin.version}
              </Badge>
            )}
            {plugin.enabled ? (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircle className="h-3 w-3" />
                已启用
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <PowerOff className="h-3 w-3" />
                已禁用
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {plugin.description || "无描述"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {getSourceText(plugin.source)}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onUninstall}
            className="p-2 rounded bg-red-100 text-red-600 hover:bg-red-200"
            title="卸载插件"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
