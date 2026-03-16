import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  MonitorSmartphone,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ConfiguredProvider } from "@/hooks/useConfiguredProviders";
import { useProviderModels } from "@/hooks/useProviderModels";
import { useApiKeyProvider } from "@/hooks/useApiKeyProvider";
import { getRegistryIdFromType } from "@/lib/constants/providerMappings";
import {
  detectDesktopPlatform,
  type DesktopPlatform,
} from "@/lib/crashDiagnostic";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";
import type {
  OpenClawPageParams,
  OpenClawSubpage,
  Page,
  PageParams,
} from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import {
  openclawApi,
  type OpenClawBinaryAvailabilityStatus,
  type OpenClawBinaryInstallStatus,
  type OpenClawChannelInfo,
  type OpenClawEnvironmentStatus,
  type OpenClawGatewayStatus,
  type OpenClawHealthInfo,
  type OpenClawInstallProgressEvent,
  type OpenClawNodeCheckResult,
  type OpenClawSyncModelEntry,
  type OpenClawUpdateInfo,
} from "@/lib/api/openclaw";
import { getOrCreateDefaultProject } from "@/lib/api/project";
import { cn } from "@/lib/utils";

import { OpenClawConfigurePage } from "./OpenClawConfigurePage";
import { OpenClawDashboardPage } from "./OpenClawDashboardPage";
import { OpenClawInstallPage } from "./OpenClawInstallPage";
import { OpenClawMark } from "./OpenClawMark";
import { OpenClawProgressPage } from "./OpenClawProgressPage";
import { OpenClawRuntimePage } from "./OpenClawRuntimePage";
import { OpenClawSceneNav } from "./OpenClawSceneNav";
import {
  type OpenClawOperationKind,
  type OpenClawOperationState,
  type OpenClawScene,
  type OpenClawSceneDefinition,
  type OpenClawSceneStatus,
  type OpenClawSubpage as LocalOpenClawSubpage,
} from "./types";
import { useOpenClawStore } from "./useOpenClawStore";
import { openUrl } from "./openUrl";
import { useOpenClawDashboardWindow } from "./useOpenClawDashboardWindow";
import {
  openClawPanelClassName,
  openClawSecondaryButtonClassName,
  openClawSubPanelClassName,
} from "./openclawStyles";

const OPENCLAW_DOCS_URL = "https://docs.openclaw.ai/";
const SUPPORTED_PROVIDER_TYPES = new Set([
  "openai",
  "openai-response",
  "codex",
  "anthropic",
  "anthropic-compatible",
  "gemini",
  "new-api",
  "gateway",
  "ollama",
  "fal",
]);

const progressSubpageByAction: Record<OpenClawOperationKind, OpenClawSubpage> =
  {
    install: "installing",
    repair: "installing",
    uninstall: "uninstalling",
    restart: "restarting",
    update: "updating",
  };

const progressActionBySubpage: Partial<
  Record<OpenClawSubpage, OpenClawOperationKind>
> = {
  installing: "install",
  updating: "update",
  uninstalling: "uninstall",
  restarting: "restart",
};

const openClawScenes: OpenClawSceneDefinition[] = [
  {
    id: "setup",
    title: "安装环境",
    description: "检查 Node.js、Git 与 OpenClaw 安装状态。",
  },
  {
    id: "sync",
    title: "配置模型",
    description: "选择 Provider、模型并同步独立副本配置。",
  },
  {
    id: "dashboard",
    title: "运行与访问",
    description: "启动 Gateway，打开桌面面板或进入 Dashboard。",
  },
];

function isOpenClawSubpage(value: unknown): value is OpenClawSubpage {
  return [
    "install",
    "installing",
    "configure",
    "runtime",
    "updating",
    "restarting",
    "uninstalling",
    "dashboard",
  ].includes(String(value));
}

function formatNodeStatus(nodeStatus: OpenClawNodeCheckResult | null): string {
  if (!nodeStatus) return "未检查";
  if (nodeStatus.status === "ok") {
    return `可用${nodeStatus.version ? ` · ${nodeStatus.version}` : ""}`;
  }
  if (nodeStatus.status === "version_low") {
    return `版本过低${nodeStatus.version ? ` · ${nodeStatus.version}` : ""}`;
  }
  return "未检测到 Node.js";
}

function formatBinaryStatus(
  status: OpenClawBinaryAvailabilityStatus | null,
  successLabel: string,
  failureLabel: string,
): string {
  if (!status) return "未检查";
  return status.available
    ? `${successLabel}${status.path ? ` · ${status.path}` : ""}`
    : failureLabel;
}

function buildCompatibleProviders(
  providers: ReturnType<typeof useApiKeyProvider>["providers"],
): ConfiguredProvider[] {
  return providers
    .filter(
      (provider) =>
        provider.enabled &&
        provider.api_key_count > 0 &&
        SUPPORTED_PROVIDER_TYPES.has(provider.type),
    )
    .map((provider) => ({
      key: provider.id,
      label: provider.name,
      registryId: provider.id,
      fallbackRegistryId: getRegistryIdFromType(provider.type),
      type: provider.type,
      providerId: provider.id,
      customModels: provider.custom_models,
      credentialType: `${provider.type}_key`,
    }));
}

function toSyncModels(
  models: EnhancedModelMetadata[],
): OpenClawSyncModelEntry[] {
  return models.map((model) => ({
    id: model.id,
    name: model.display_name,
    contextWindow: model.limits.context_length ?? undefined,
  }));
}

function openClawOperationLabel(kind: OpenClawOperationKind | null): string {
  switch (kind) {
    case "install":
      return "安装";
    case "repair":
      return "修复环境";
    case "update":
      return "升级";
    case "uninstall":
      return "卸载";
    case "restart":
      return "重启";
    default:
      return "处理";
  }
}

function buildOpenClawRepairPrompt(
  kind: OpenClawOperationKind | null,
  message: string | null,
  logs: OpenClawInstallProgressEvent[],
  systemInfo: {
    os: string;
    userAgent: string;
    installPath: string;
    nodeStatus: string;
    gitStatus: string;
    gatewayStatus: string;
    gatewayPort: number;
    healthStatus: string;
    dashboardUrl: string;
  },
): string {
  const operationLabel = openClawOperationLabel(kind);
  const visibleLogs = logs.slice(-40);
  const summarizedError =
    visibleLogs
      .slice()
      .reverse()
      .find((log) => log.level === "error" || log.level === "warn")?.message ||
    message ||
    "安装/运行过程中出现异常";
  const logText =
    visibleLogs.length > 0
      ? visibleLogs
          .map((log) => `[${log.level.toUpperCase()}] ${log.message}`)
          .join("\n")
      : "暂无日志输出";

  return [
    `我正在${operationLabel} openclaw，但在过程中遇到了这个问题：${summarizedError}。`,
    "",
    "请帮我：",
    "1. 判断最可能的根因",
    "2. 给出最小可执行的修复步骤",
    "3. 如果需要修改环境变量、Node/npm、PATH、全局包冲突，请明确指出",
    "4. 如果可以在当前 ProxyCast / Tauri 项目中修复，也请给出具体修改建议",
    "",
    "当前系统信息：",
    `- 操作系统: ${systemInfo.os}`,
    `- User Agent: ${systemInfo.userAgent}`,
    `- OpenClaw 安装路径: ${systemInfo.installPath}`,
    `- Node.js 状态: ${systemInfo.nodeStatus}`,
    `- Git 状态: ${systemInfo.gitStatus}`,
    `- Gateway 状态: ${systemInfo.gatewayStatus}`,
    `- Gateway 端口: ${systemInfo.gatewayPort}`,
    `- 健康检查: ${systemInfo.healthStatus}`,
    `- Dashboard 地址: ${systemInfo.dashboardUrl}`,
    "",
    "以下是完整日志：",
    logText,
  ].join("\n");
}

function renderBlockedPage(
  title: string,
  description: string,
  actionLabel: string,
  onAction: () => void,
) {
  return (
    <section className={cn(openClawPanelClassName, "px-8 py-10 text-center")}>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        {title}
      </h1>
      <p className="mt-3 text-sm leading-7 text-slate-500">{description}</p>
      <button
        type="button"
        onClick={onAction}
        className={cn(openClawSecondaryButtonClassName, "mt-6 px-4 py-2.5")}
      >
        {actionLabel}
      </button>
    </section>
  );
}

function resolveOpenClawSubpage(
  candidate: OpenClawSubpage,
  installed: boolean,
  gatewayRunning: boolean,
  gatewayStarting: boolean,
  operationState: OpenClawOperationState,
): OpenClawSubpage {
  if (operationState.running && operationState.kind) {
    return progressSubpageByAction[operationState.kind];
  }

  if (!installed) {
    return "install";
  }

  if (
    candidate === "install" ||
    candidate === "installing" ||
    candidate === "updating"
  ) {
    return "runtime";
  }

  if (candidate === "dashboard" && !gatewayRunning && !gatewayStarting) {
    return "runtime";
  }

  if (
    (candidate === "uninstalling" || candidate === "restarting") &&
    !operationState.running
  ) {
    return gatewayRunning || gatewayStarting ? "runtime" : "configure";
  }

  return candidate;
}

interface OpenClawPageProps {
  pageParams?: OpenClawPageParams;
  onNavigate?: (page: Page, params?: PageParams) => void;
  isActive?: boolean;
}

export function OpenClawPage({
  pageParams,
  onNavigate,
  isActive = false,
}: OpenClawPageProps) {
  const desktopPlatform = useMemo<DesktopPlatform>(
    () => detectDesktopPlatform(),
    [],
  );
  const isWindowsPlatform = desktopPlatform === "windows";
  const {
    providers,
    loading: providersLoading,
    refresh: refreshProviders,
  } = useApiKeyProvider();
  const compatibleProviders = useMemo(
    () => buildCompatibleProviders(providers),
    [providers],
  );

  const selectedProviderId = useOpenClawStore(
    (state) => state.selectedProviderId,
  );
  const selectedModelId = useOpenClawStore((state) => state.selectedModelId);
  const gatewayPort = useOpenClawStore((state) => state.gatewayPort);
  const lastSynced = useOpenClawStore((state) => state.lastSynced);
  const setSelectedProviderId = useOpenClawStore(
    (state) => state.setSelectedProviderId,
  );
  const setSelectedModelId = useOpenClawStore(
    (state) => state.setSelectedModelId,
  );
  const setGatewayPort = useOpenClawStore((state) => state.setGatewayPort);
  const setLastSynced = useOpenClawStore((state) => state.setLastSynced);
  const clearLastSynced = useOpenClawStore((state) => state.clearLastSynced);

  const [fallbackSubpage, setFallbackSubpage] =
    useState<LocalOpenClawSubpage>("install");
  const [statusResolved, setStatusResolved] = useState(false);
  const [installedStatus, setInstalledStatus] =
    useState<OpenClawBinaryInstallStatus | null>(null);
  const [environmentStatus, setEnvironmentStatus] =
    useState<OpenClawEnvironmentStatus | null>(null);
  const [nodeStatus, setNodeStatus] = useState<OpenClawNodeCheckResult | null>(
    null,
  );
  const [gitStatus, setGitStatus] =
    useState<OpenClawBinaryAvailabilityStatus | null>(null);
  const [gatewayStatus, setGatewayStatus] =
    useState<OpenClawGatewayStatus>("stopped");
  const [healthInfo, setHealthInfo] = useState<OpenClawHealthInfo | null>(null);
  const [updateInfo, setUpdateInfo] = useState<OpenClawUpdateInfo | null>(null);
  const [channels, setChannels] = useState<OpenClawChannelInfo[]>([]);
  const [installLogs, setInstallLogs] = useState<
    OpenClawInstallProgressEvent[]
  >([]);
  const [syncing, setSyncing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [cleaningTemp, setCleaningTemp] = useState(false);
  const [handingOffToAgent, setHandingOffToAgent] = useState(false);
  const [operationState, setOperationState] = useState<OpenClawOperationState>({
    kind: null,
    target: null,
    running: false,
    title: null,
    description: null,
    message: null,
    returnSubpage: "install",
  });

  const requestedSubpage = isOpenClawSubpage(pageParams?.subpage)
    ? pageParams.subpage
    : null;

  const selectedProvider = useMemo(
    () =>
      compatibleProviders.find(
        (provider) => provider.key === selectedProviderId,
      ),
    [compatibleProviders, selectedProviderId],
  );

  const {
    models: providerModels,
    loading: modelsLoading,
    error: modelsError,
  } = useProviderModels(selectedProvider, { returnFullMetadata: true });

  const installed = installedStatus?.installed ?? false;
  const gatewayRunning = gatewayStatus === "running";
  const gatewayStarting = gatewayStatus === "starting";
  const canStartGateway = installed && !gatewayRunning && !gatewayStarting;
  const canStopGateway = installed && gatewayStatus !== "stopped";
  const canRestartGateway = installed && gatewayRunning;
  const updating = operationState.running && operationState.kind === "update";
  const hasSelectedConfig =
    Boolean(selectedProvider) && selectedModelId.trim().length > 0;
  const canSync = installed && hasSelectedConfig;
  const canStartFromConfigure =
    canStartGateway && (hasSelectedConfig || !!lastSynced);
  const missingInstallDependencies = useMemo(() => {
    if (!environmentStatus) {
      return [] as string[];
    }

    return [
      environmentStatus.node.status !== "ok" ? "Node.js" : null,
      environmentStatus.git.status !== "ok" ? "Git" : null,
    ].filter(Boolean) as string[];
  }, [environmentStatus]);
  const installBlockMessage = useMemo(() => {
    if (environmentStatus?.openclaw.status === "needs_reload") {
      return environmentStatus.openclaw.message;
    }

    if (!isWindowsPlatform || missingInstallDependencies.length === 0) {
      return null;
    }

    return `Windows 下请先手动安装 ${missingInstallDependencies.join(" / ")}，完成后点击“重新检测”，再安装 OpenClaw。`;
  }, [environmentStatus, isWindowsPlatform, missingInstallDependencies]);
  const {
    dashboardLoading,
    dashboardUrl,
    dashboardWindowBusy,
    dashboardWindowOpen,
    refreshDashboardUrl,
    refreshDashboardWindowState,
    handleOpenDashboardWindow,
    handleOpenDashboardExternal,
    closeDashboardWindowSilently,
  } = useOpenClawDashboardWindow({ gatewayStatus });

  const defaultSubpage = useMemo<OpenClawSubpage>(() => {
    if (operationState.running && operationState.kind) {
      return progressSubpageByAction[operationState.kind];
    }

    if (!installed) {
      return "install";
    }

    return "runtime";
  }, [installed, operationState.kind, operationState.running]);

  const requestedOrFallbackSubpage =
    requestedSubpage ?? (onNavigate ? defaultSubpage : fallbackSubpage);
  const currentSubpage = useMemo(
    () =>
      resolveOpenClawSubpage(
        requestedOrFallbackSubpage,
        installed,
        gatewayRunning,
        gatewayStarting,
        operationState,
      ),
    [
      gatewayRunning,
      gatewayStarting,
      installed,
      operationState,
      requestedOrFallbackSubpage,
    ],
  );

  const currentScene = useMemo<OpenClawScene>(() => {
    if (
      currentSubpage === "install" ||
      currentSubpage === "installing" ||
      currentSubpage === "uninstalling"
    ) {
      return "setup";
    }

    if (currentSubpage === "configure") {
      return "sync";
    }

    return "dashboard";
  }, [currentSubpage]);

  const currentSubpageLabel = useMemo(() => {
    switch (currentSubpage) {
      case "install":
        return "安装环境";
      case "installing":
        return "正在安装";
      case "configure":
        return "配置模型";
      case "runtime":
        return "运行状态";
      case "updating":
        return "正在升级";
      case "restarting":
        return "正在重启";
      case "uninstalling":
        return "正在卸载";
      case "dashboard":
        return "Dashboard 访问";
      default:
        return "OpenClaw";
    }
  }, [currentSubpage]);

  const navigateSubpage = useCallback(
    (subpage: OpenClawSubpage) => {
      if (onNavigate) {
        onNavigate("openclaw", { subpage });
      } else {
        setFallbackSubpage(subpage);
      }
    },
    [onNavigate],
  );

  useEffect(() => {
    if (compatibleProviders.length === 0) {
      if (selectedProviderId) {
        setSelectedProviderId(null);
      }
      return;
    }

    if (!selectedProviderId || !selectedProvider) {
      setSelectedProviderId(compatibleProviders[0].key);
    }
  }, [
    compatibleProviders,
    selectedProvider,
    selectedProviderId,
    setSelectedProviderId,
  ]);

  useEffect(() => {
    if (!selectedProviderId || modelsLoading || providerModels.length === 0) {
      return;
    }

    if (!selectedModelId) {
      setSelectedModelId(providerModels[0].id);
    }
  }, [
    modelsLoading,
    providerModels,
    selectedModelId,
    selectedProviderId,
    setSelectedModelId,
  ]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    void openclawApi
      .listenInstallProgress((payload) => {
        if (!active) return;
        setInstallLogs((prev) => [...prev, payload].slice(-400));
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((error) => {
        console.warn("[OpenClaw] 安装日志监听失败:", error);
      });

    return () => {
      active = false;
      if (unlisten) {
        void unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (!operationState.running) {
      return;
    }

    let cancelled = false;

    const syncProgressLogs = async () => {
      try {
        const logs = await openclawApi.getProgressLogs();
        if (!cancelled && logs.length > 0) {
          setInstallLogs(logs);
        }
      } catch {
        // 忽略轮询失败，保留事件流或已有日志
      }
    };

    void syncProgressLogs();
    const timer = window.setInterval(() => {
      void syncProgressLogs();
    }, 400);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [operationState.running]);

  const refreshGatewayRuntime = useCallback(async () => {
    const status = await openclawApi.getStatus();
    setGatewayStatus(status.status);
    if (status.port !== gatewayPort) {
      setGatewayPort(status.port);
    }

    await refreshDashboardUrl({ silent: true });

    if (status.status === "running") {
      const [healthResult, channelListResult] = await Promise.allSettled([
        openclawApi.checkHealth(),
        openclawApi.getChannels(),
      ]);
      setHealthInfo(
        healthResult.status === "fulfilled" ? healthResult.value : null,
      );
      setChannels(
        channelListResult.status === "fulfilled" ? channelListResult.value : [],
      );
    } else {
      setHealthInfo(null);
      setChannels([]);
    }
  }, [gatewayPort, refreshDashboardUrl, setGatewayPort]);

  const refreshUpdateStatus = useCallback(
    async ({ showToast = false } = {}) => {
      if (!installed) {
        setUpdateInfo(null);
        return null;
      }

      const result = await openclawApi.checkUpdate();
      setUpdateInfo(result);

      if (showToast) {
        if (result.hasUpdate) {
          toast.info(`检测到 OpenClaw 新版本 ${result.latestVersion || ""}`.trim(), {
            description: result.currentVersion
              ? `当前版本 ${result.currentVersion}`
              : "可以在当前工作台直接执行升级。",
          });
        } else if (result.message) {
          toast.warning("暂时无法确认更新状态。", {
            description: result.message,
          });
        } else {
          toast.success("当前 OpenClaw 已是最新状态。");
        }
      }

      return result;
    },
    [installed],
  );

  const refreshAll = useCallback(async () => {
    try {
      const environment = await openclawApi.getEnvironmentStatus();
      setEnvironmentStatus(environment);
      setInstalledStatus({
        installed: environment.openclaw.status === "ok",
        path: environment.openclaw.path,
      });
      setNodeStatus({
        status:
          environment.node.status === "missing"
            ? "not_found"
            : environment.node.status,
        version: environment.node.version,
        path: environment.node.path,
      });
      setGitStatus({
        available: environment.git.status === "ok",
        path: environment.git.path,
      });
      if (environment.openclaw.status === "ok") {
        const updateResult = await openclawApi.checkUpdate().catch(() => null);
        setUpdateInfo(updateResult);
      } else {
        setUpdateInfo(null);
      }
      await Promise.all([
        refreshGatewayRuntime(),
        refreshDashboardWindowState(),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setStatusResolved(true);
    }
  }, [refreshDashboardWindowState, refreshGatewayRuntime]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    void refreshAll();
  }, [isActive, refreshAll]);

  useEffect(() => {
    if (!statusResolved || requestedSubpage || operationState.running) {
      return;
    }

    const resolvedSubpage = !installed ? "install" : "runtime";

    if (!onNavigate && fallbackSubpage !== resolvedSubpage) {
      setFallbackSubpage(resolvedSubpage);
    }
  }, [
    fallbackSubpage,
    gatewayRunning,
    gatewayStarting,
    installed,
    onNavigate,
    operationState.running,
    requestedSubpage,
    statusResolved,
  ]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    if (gatewayStatus !== "running" && gatewayStatus !== "starting") {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshGatewayRuntime().catch((error) => {
        console.warn("[OpenClaw] 轮询状态失败:", error);
      });
    }, 5000);

    return () => window.clearInterval(timer);
  }, [gatewayStatus, isActive, refreshGatewayRuntime]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    if (currentSubpage === "dashboard" && gatewayRunning && !dashboardUrl) {
      void refreshDashboardUrl({ silent: true, showLoading: true });
    }
  }, [
    currentSubpage,
    dashboardUrl,
    gatewayRunning,
    isActive,
    refreshDashboardUrl,
  ]);

  const syncProviderConfig = useCallback(
    async ({ showSuccessToast = true, trackLoading = true } = {}) => {
      if (!selectedProvider) {
        toast.error("请先选择 Provider。");
        return false;
      }

      const primaryModelId = selectedModelId.trim();
      if (!primaryModelId) {
        toast.error("请先选择或输入主模型 ID。");
        return false;
      }

      if (trackLoading) {
        setSyncing(true);
      }

      try {
        const requestModels = toSyncModels(providerModels);
        if (!requestModels.some((model) => model.id === primaryModelId)) {
          requestModels.unshift({
            id: primaryModelId,
            name: primaryModelId,
          });
        }

        const result = await openclawApi.syncProviderConfig({
          providerId: selectedProvider.key,
          primaryModelId,
          models: requestModels,
        });

        if (!result.success) {
          toast.error(result.message);
          return false;
        }

        setLastSynced({
          providerId: selectedProvider.key,
          modelId: primaryModelId,
        });

        if (showSuccessToast) {
          toast.success(result.message);
        }

        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        if (trackLoading) {
          setSyncing(false);
        }
      }
    },
    [providerModels, selectedModelId, selectedProvider, setLastSynced],
  );

  const runProgressOperation = useCallback(
    async (options: {
      kind: OpenClawOperationKind;
      target?: OpenClawOperationState["target"];
      title?: string;
      description?: string;
      action: () => Promise<{ success: boolean; message: string }>;
      successSubpage: OpenClawSubpage;
      returnSubpage: OpenClawSubpage;
      initialLogs?: OpenClawInstallProgressEvent[];
      onSuccess?: () => void;
    }) => {
      const {
        kind,
        target = "environment",
        title = null,
        description = null,
        action,
        successSubpage,
        returnSubpage,
        initialLogs = [],
        onSuccess,
      } = options;

      setInstallLogs(initialLogs);
      setOperationState({
        kind,
        target,
        running: true,
        title,
        description,
        message: null,
        returnSubpage,
      });
      navigateSubpage(progressSubpageByAction[kind]);
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      try {
        const result = await action();
        setOperationState({
          kind,
          target,
          running: false,
          title,
          description,
          message: result.message,
          returnSubpage,
        });

        if (!result.success) {
          toast.error(result.message);
          await refreshAll();
          return;
        }

        toast.success(result.message);
        onSuccess?.();
        await refreshAll();
        navigateSubpage(successSubpage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setOperationState({
          kind,
          target,
          running: false,
          title,
          description,
          message,
          returnSubpage,
        });
        toast.error(message);
        await refreshAll();
      }
    },
    [navigateSubpage, refreshAll],
  );

  const handleDownloadNode = useCallback(async () => {
    try {
      const url = await openclawApi.getNodeDownloadUrl();
      await openUrl(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleDownloadGit = useCallback(async () => {
    try {
      const url = await openclawApi.getGitDownloadUrl();
      await openUrl(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleInstall = useCallback(async () => {
    if (installBlockMessage) {
      toast.error(installBlockMessage);
      return;
    }

    await runProgressOperation({
      kind: "install",
      target: "openclaw",
      title: isWindowsPlatform ? "正在安装 OpenClaw" : "正在修复环境并安装 OpenClaw",
      description: isWindowsPlatform
        ? "当前环境已通过检测，正在继续安装 OpenClaw。"
        : "ProxyCast 会先自动检查并修复 Node.js / Git，再继续安装 OpenClaw。",
      action: () => openclawApi.install(),
      successSubpage: "runtime",
      returnSubpage: "install",
      initialLogs: [
        {
          level: "info",
          message: isWindowsPlatform
            ? "已发送安装请求，正在安装 OpenClaw..."
            : "已发送安装请求，正在检查并修复 OpenClaw 运行环境...",
        },
      ],
    });
  }, [installBlockMessage, isWindowsPlatform, runProgressOperation]);

  const handleUninstall = useCallback(async () => {
    if (!window.confirm("确定要卸载 OpenClaw 吗？")) {
      return;
    }

    await closeDashboardWindowSilently();
    const preview = await openclawApi
      .getCommandPreview("uninstall")
      .catch(() => null);

    await runProgressOperation({
      kind: "uninstall",
      target: "openclaw",
      action: () => openclawApi.uninstall(),
      successSubpage: "install",
      returnSubpage: installed ? "configure" : "install",
      initialLogs: preview
        ? [
            { level: "info", message: preview.title },
            ...preview.command
              .split("\n")
              .map((line) => ({ level: "info" as const, message: line })),
          ]
        : [
            {
              level: "info",
              message: "已发送卸载请求，正在等待后端返回卸载命令...",
            },
          ],
      onSuccess: () => {
        clearLastSynced();
        setSelectedModelId("");
      },
    });
  }, [
    clearLastSynced,
    closeDashboardWindowSilently,
    installed,
    runProgressOperation,
    setSelectedModelId,
  ]);

  const handleRestart = useCallback(async () => {
    await closeDashboardWindowSilently();
    const preview = await openclawApi
      .getCommandPreview("restart", gatewayPort)
      .catch(() => null);

    await runProgressOperation({
      kind: "restart",
      target: "openclaw",
      action: () => openclawApi.restartGateway(),
      successSubpage: "runtime",
      returnSubpage: "runtime",
      initialLogs: preview
        ? [
            { level: "info", message: preview.title },
            ...preview.command
              .split("\n")
              .map((line) => ({ level: "info" as const, message: line })),
          ]
        : [
            {
              level: "info",
              message: "已发送重启请求，正在停止并重新拉起 Gateway...",
            },
          ],
    });
  }, [closeDashboardWindowSilently, gatewayPort, runProgressOperation]);

  const handleInstallNode = useCallback(async () => {
    if (isWindowsPlatform) {
      toast.info("Windows 下请先手动下载安装 Node.js 22+，安装完成后重新检测。");
      await handleDownloadNode();
      return;
    }

    await runProgressOperation({
      kind: "repair",
      target: "node",
      title: "正在安装 Node.js 环境",
      description: "ProxyCast 会优先尝试应用内一键安装或修复 Node.js。",
      action: () => openclawApi.installDependency("node"),
      successSubpage: "install",
      returnSubpage: "install",
      initialLogs: [
        {
          level: "info",
          message: "已发送 Node.js 修复请求，正在准备安装流程...",
        },
      ],
    });
  }, [handleDownloadNode, isWindowsPlatform, runProgressOperation]);

  const handleInstallGit = useCallback(async () => {
    if (isWindowsPlatform) {
      toast.info(
        "Windows 下请先手动下载安装 Git，并在安装时勾选加入 PATH，完成后重新检测。",
      );
      await handleDownloadGit();
      return;
    }

    await runProgressOperation({
      kind: "repair",
      target: "git",
      title: "正在安装 Git 环境",
      description: "ProxyCast 会优先尝试应用内一键安装或修复 Git。",
      action: () => openclawApi.installDependency("git"),
      successSubpage: "install",
      returnSubpage: "install",
      initialLogs: [
        {
          level: "info",
          message: "已发送 Git 修复请求，正在准备安装流程...",
        },
      ],
    });
  }, [handleDownloadGit, isWindowsPlatform, runProgressOperation]);

  const handleSync = useCallback(async () => {
    await syncProviderConfig();
  }, [syncProviderConfig]);

  const handleStart = useCallback(async () => {
    if (!lastSynced && !hasSelectedConfig) {
      toast.error("请先选择 Provider 和模型，或先完成一次配置同步。");
      return;
    }

    setStarting(true);
    try {
      const primaryModelId = selectedModelId.trim();
      const needsSync =
        hasSelectedConfig &&
        selectedProvider &&
        (!lastSynced ||
          lastSynced.providerId !== selectedProvider.key ||
          lastSynced.modelId !== primaryModelId);

      if (needsSync) {
        const synced = await syncProviderConfig({
          showSuccessToast: false,
          trackLoading: false,
        });
        if (!synced) {
          return;
        }
      }

      const result = await openclawApi.startGateway(gatewayPort);
      if (!result.success) {
        toast.error(result.message);
        await refreshGatewayRuntime();
        return;
      }

      toast.success(result.message);
      await refreshGatewayRuntime();
      await refreshDashboardUrl({
        silent: false,
        showLoading: false,
      });
      navigateSubpage("runtime");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }, [
    gatewayPort,
    hasSelectedConfig,
    lastSynced,
    navigateSubpage,
    refreshDashboardUrl,
    refreshGatewayRuntime,
    selectedModelId,
    selectedProvider,
    syncProviderConfig,
  ]);

  const handleStop = useCallback(async () => {
    setStopping(true);
    try {
      const result = await openclawApi.stopGateway();
      if (!result.success) {
        toast.error(result.message);
        return;
      }

      await closeDashboardWindowSilently();
      toast.success(result.message);
      await refreshGatewayRuntime();
      navigateSubpage("configure");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setStopping(false);
    }
  }, [closeDashboardWindowSilently, navigateSubpage, refreshGatewayRuntime]);

  const handleCheckHealth = useCallback(async () => {
    setCheckingHealth(true);
    try {
      const health = await openclawApi.checkHealth();
      setHealthInfo(health);
      if (health.status === "healthy") {
        toast.success("Gateway 健康检查通过。");
      } else {
        toast.warning("Gateway 当前不可用。", {
          description: "请确认已同步配置并成功启动。",
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingHealth(false);
    }
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      await refreshUpdateStatus({ showToast: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingUpdate(false);
    }
  }, [refreshUpdateStatus]);

  const handlePerformUpdate = useCallback(async () => {
    await closeDashboardWindowSilently();
    await runProgressOperation({
      kind: "update",
      target: "openclaw",
      title: "正在升级 OpenClaw",
      description:
        "将调用 openclaw update 执行本体升级，完成后会自动刷新版本与运行状态。",
      action: () => openclawApi.performUpdate(),
      successSubpage: "runtime",
      returnSubpage: "runtime",
      initialLogs: [
        {
          level: "info",
          message: updateInfo?.hasUpdate
            ? `已检测到新版本 ${updateInfo.latestVersion || "待确认"}，开始升级...`
            : "开始执行 OpenClaw 升级命令...",
        },
      ],
    });
  }, [
    closeDashboardWindowSilently,
    runProgressOperation,
    updateInfo?.hasUpdate,
    updateInfo?.latestVersion,
  ]);

  const handleCleanupTempArtifacts = useCallback(async () => {
    setCleaningTemp(true);
    try {
      const result = await openclawApi.cleanupTempArtifacts();
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.warning(result.message);
      }
      await refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCleaningTemp(false);
    }
  }, [refreshAll]);

  const handleCopyPath = useCallback(async () => {
    const path = installedStatus?.path;
    if (!path) {
      toast.error("当前没有可复制的安装路径。");
      return;
    }

    try {
      await navigator.clipboard.writeText(path);
      toast.success("安装路径已复制。");
    } catch {
      toast.error("复制安装路径失败。");
    }
  }, [installedStatus?.path]);

  const handleCloseProgress = useCallback(() => {
    navigateSubpage(operationState.returnSubpage);
  }, [navigateSubpage, operationState.returnSubpage]);

  const openClawRepairPrompt = useMemo(
    () =>
      buildOpenClawRepairPrompt(
        operationState.kind,
        operationState.message,
        installLogs,
        {
          os:
            typeof navigator !== "undefined"
              ? `${navigator.platform || "unknown"} / ${navigator.language || "unknown"}`
              : "unknown",
          userAgent:
            typeof navigator !== "undefined"
              ? navigator.userAgent || "unknown"
              : "unknown",
          installPath: installedStatus?.path || "未检测到安装路径",
          nodeStatus: formatNodeStatus(nodeStatus),
          gitStatus: formatBinaryStatus(gitStatus, "可用", "未检测到 Git"),
          gatewayStatus,
          gatewayPort,
          healthStatus: healthInfo
            ? `${healthInfo.status}${healthInfo.version ? ` · ${healthInfo.version}` : ""}`
            : "尚未执行健康检查",
          dashboardUrl: dashboardUrl || "尚未生成 Dashboard 地址",
        },
      ),
    [
      dashboardUrl,
      gatewayPort,
      gatewayStatus,
      gitStatus,
      healthInfo,
      installLogs,
      installedStatus?.path,
      nodeStatus,
      operationState.kind,
      operationState.message,
    ],
  );

  const openClawRawLogsText = useMemo(
    () =>
      installLogs.length > 0
        ? installLogs
            .map((log) => `[${log.level.toUpperCase()}] ${log.message}`)
            .join("\n")
        : "",
    [installLogs],
  );

  const openClawDiagnosticBundleJson = useMemo(
    () =>
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: "openclaw-progress",
          operation: operationState.kind,
          running: operationState.running,
          message: operationState.message,
          system: {
            os:
              typeof navigator !== "undefined"
                ? `${navigator.platform || "unknown"} / ${navigator.language || "unknown"}`
                : "unknown",
            userAgent:
              typeof navigator !== "undefined"
                ? navigator.userAgent || "unknown"
                : "unknown",
            installPath: installedStatus?.path || "未检测到安装路径",
            nodeStatus: formatNodeStatus(nodeStatus),
            gitStatus: formatBinaryStatus(gitStatus, "可用", "未检测到 Git"),
            gatewayStatus,
            gatewayPort,
            healthStatus: healthInfo
              ? `${healthInfo.status}${healthInfo.version ? ` · ${healthInfo.version}` : ""}`
              : "尚未执行健康检查",
            dashboardUrl: dashboardUrl || "尚未生成 Dashboard 地址",
          },
          logs: installLogs,
        },
        null,
        2,
      ),
    [
      dashboardUrl,
      gatewayPort,
      gatewayStatus,
      gitStatus,
      healthInfo,
      installLogs,
      installedStatus?.path,
      nodeStatus,
      operationState.kind,
      operationState.message,
      operationState.running,
    ],
  );

  const handleCopyOpenClawRepairPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(openClawRepairPrompt);
      toast.success("OpenClaw 修复提示词已复制。");
    } catch {
      toast.error("复制修复提示词失败。");
    }
  }, [openClawRepairPrompt]);

  const handleCopyOpenClawLogs = useCallback(async () => {
    if (!openClawRawLogsText.trim()) {
      toast.error("当前没有可复制的日志。");
      return;
    }

    try {
      await navigator.clipboard.writeText(openClawRawLogsText);
      toast.success("OpenClaw 纯日志已复制。");
    } catch {
      toast.error("复制纯日志失败。");
    }
  }, [openClawRawLogsText]);

  const handleCopyOpenClawDiagnosticBundle = useCallback(async () => {
    if (!openClawRawLogsText.trim()) {
      toast.error("当前没有可复制的诊断内容。");
      return;
    }

    try {
      await navigator.clipboard.writeText(openClawDiagnosticBundleJson);
      toast.success("OpenClaw JSON 诊断包已复制。");
    } catch {
      toast.error("复制 JSON 诊断包失败。");
    }
  }, [openClawDiagnosticBundleJson, openClawRawLogsText]);

  const handleAskAgentFixOpenClaw = useCallback(async () => {
    const prompt = openClawRepairPrompt.trim();
    if (!prompt) {
      toast.error("当前没有可用于诊断的日志内容。");
      return;
    }

    setHandingOffToAgent(true);
    toast.info("正在创建新话题并转交给 AI...", {
      id: "openclaw-agent-handoff",
    });

    const project = await getOrCreateDefaultProject().catch((error) => {
      toast.error(
        error instanceof Error ? error.message : "创建默认项目失败。",
      );
      setHandingOffToAgent(false);
      return null;
    });

    if (!project) {
      return;
    }

    onNavigate?.("agent", {
      projectId: project.id,
      initialUserPrompt: prompt,
      initialSessionName: "OpenClaw 修复",
      entryBannerMessage: "已从 OpenClaw 故障诊断进入，诊断请求已自动发送。",
      newChatAt: Date.now(),
      theme: "general",
      lockTheme: false,
    });
    setHandingOffToAgent(false);
  }, [onNavigate, openClawRepairPrompt]);
  const resolveSceneStatus = useCallback(
    (scene: OpenClawScene): OpenClawSceneStatus => {
      switch (scene) {
        case "setup":
          if (
            operationState.running &&
            (operationState.kind === "install" ||
              operationState.kind === "repair" ||
              operationState.kind === "uninstall")
          ) {
            return { label: "处理中", tone: "starting" };
          }
          if (installed) {
            return { label: "已安装", tone: "done" };
          }
          if (environmentStatus?.openclaw.status === "needs_reload") {
            return { label: "待刷新", tone: "active" };
          }
          return { label: "待安装", tone: "idle" };
        case "sync":
          if (!installed) {
            return { label: "等待安装", tone: "idle" };
          }
          if (syncing) {
            return { label: "同步中", tone: "starting" };
          }
          if (lastSynced) {
            return { label: "已同步", tone: "done" };
          }
          if (hasSelectedConfig) {
            return { label: "待同步", tone: "active" };
          }
          return compatibleProviders.length > 0
            ? { label: "待选择", tone: "active" }
            : { label: "缺少 Provider", tone: "error" };
        case "dashboard":
          if (!installed) {
            return { label: "等待安装", tone: "idle" };
          }
          if (operationState.running && operationState.kind === "update") {
            return { label: "升级中", tone: "starting" };
          }
          if (operationState.running && operationState.kind === "restart") {
            return { label: "重启中", tone: "starting" };
          }
          if (gatewayStatus === "error") {
            return { label: "异常", tone: "error" };
          }
          if (gatewayRunning) {
            return {
              label: dashboardWindowOpen ? "面板已开" : "运行中",
              tone: dashboardWindowOpen ? "connected" : "healthy",
            };
          }
          if (gatewayStarting || starting) {
            return { label: "启动中", tone: "starting" };
          }
          if (canStartFromConfigure || !!lastSynced) {
            return { label: "待启动", tone: "active" };
          }
          return { label: "待配置", tone: "idle" };
        default:
          return { label: "待处理", tone: "idle" };
      }
    },
    [
      canStartFromConfigure,
      compatibleProviders.length,
      dashboardWindowOpen,
      environmentStatus?.openclaw.status,
      gatewayRunning,
      gatewayStarting,
      gatewayStatus,
      hasSelectedConfig,
      installed,
      lastSynced,
      operationState.kind,
      operationState.running,
      starting,
      syncing,
    ],
  );

  const pageDescription = useMemo(() => {
    if (!statusResolved && !operationState.running) {
      return "正在检测本地安装、Gateway 与配置状态，稍后会自动进入正确页面。";
    }

    switch (currentSubpage) {
      case "install":
        return (
          environmentStatus?.summary ||
          "先确认 Node.js、Git 与 OpenClaw 本体状态，再决定是否执行一键修复。"
        );
      case "installing":
      case "uninstalling":
      case "updating":
      case "restarting":
        return (
          operationState.description ||
          "当前正在执行 OpenClaw 操作，日志会持续更新。"
        );
      case "configure":
        return "在一个工作台里完成 Provider 选择、模型同步与启动前准备，避免在设置与运行页之间来回跳转。";
      case "runtime":
        return gatewayRunning
          ? "Gateway 已准备就绪，可以直接打开桌面面板，或进入 Dashboard 访问页进一步检查地址与 token。"
          : "这里集中处理启动、停止、重启与健康检查。启动前如未同步模型，请先回到配置页。";
      case "dashboard":
        return "通过桌面面板或系统浏览器访问 OpenClaw Dashboard，并在这里确认地址、token 与面板状态。";
      default:
        return "统一管理 OpenClaw 的安装、模型同步、Gateway 运行与 Dashboard 访问。";
    }
  }, [
    currentSubpage,
    environmentStatus?.summary,
    gatewayRunning,
    operationState.description,
    operationState.running,
    statusResolved,
  ]);

  const summaryCards = useMemo<
    Array<{
      key: string;
      title: string;
      value: string;
      description: string;
      icon: LucideIcon;
      iconClassName: string;
      valueClassName?: string;
    }>
  >(
    () => [
      {
        key: "setup",
        title: "安装环境",
        value: installed ? "已安装" : operationState.running ? "处理中" : "待安装",
        description: environmentStatus?.openclaw.path || "等待检测安装路径",
        icon: Wrench,
        iconClassName: "border-slate-200 bg-slate-100 text-slate-700",
      },
      {
        key: "sync",
        title: "模型同步",
        value: lastSynced?.modelId || selectedModelId.trim() || "未选择",
        description: lastSynced
          ? `最近同步：${lastSynced.providerId}`
          : selectedProvider?.label || "先选择 Provider 与模型",
        icon: Settings2,
        iconClassName: "border-sky-200 bg-sky-100 text-sky-700",
        valueClassName: "text-xl leading-8",
      },
      {
        key: "runtime",
        title: "Gateway",
        value: gatewayRunning ? "运行中" : gatewayStatus,
        description: `端口 ${gatewayPort} · ${
          channels.length > 0 ? `${channels.length} 个通道` : "等待通道发现"
        }`,
        icon: ShieldCheck,
        iconClassName: "border-emerald-200 bg-emerald-100 text-emerald-700",
      },
      {
        key: "dashboard",
        title: "桌面面板",
        value: dashboardWindowOpen ? "已打开" : "未打开",
        description: dashboardUrl ? "Dashboard 地址已生成" : "等待生成 Dashboard 地址",
        icon: MonitorSmartphone,
        iconClassName: "border-amber-200 bg-amber-100 text-amber-700",
      },
    ],
    [
      channels.length,
      dashboardUrl,
      dashboardWindowOpen,
      environmentStatus?.openclaw.path,
      gatewayPort,
      gatewayRunning,
      gatewayStatus,
      installed,
      lastSynced,
      operationState.running,
      selectedModelId,
      selectedProvider?.label,
    ],
  );

  const handleSelectScene = useCallback(
    (scene: OpenClawScene) => {
      if (scene === "setup") {
        navigateSubpage("install");
        return;
      }
      if (scene === "sync") {
        navigateSubpage("configure");
        return;
      }
      navigateSubpage(gatewayRunning ? "dashboard" : "runtime");
    },
    [gatewayRunning, navigateSubpage],
  );

  let pageContent;
  if (!statusResolved && !operationState.running) {
    pageContent = (
      <section className={cn(openClawPanelClassName, "px-8 py-10 text-center")}>
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-900" />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900">
          正在检查 OpenClaw 状态
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          正在检测本地安装、Gateway 与配置状态，稍后会自动进入正确页面。
        </p>
      </section>
    );
  } else if (currentSubpage === "install") {
    pageContent = (
      <OpenClawInstallPage
        environmentStatus={environmentStatus}
        desktopPlatform={desktopPlatform}
        busy={operationState.running}
        installing={
          operationState.running &&
          operationState.kind === "install" &&
          operationState.target === "openclaw"
        }
        installingNode={
          operationState.running &&
          operationState.kind === "repair" &&
          operationState.target === "node"
        }
        installingGit={
          operationState.running &&
          operationState.kind === "repair" &&
          operationState.target === "git"
        }
        cleaningTemp={cleaningTemp}
        onInstall={() => void handleInstall()}
        onInstallNode={() => void handleInstallNode()}
        onInstallGit={() => void handleInstallGit()}
        onRefresh={() => void refreshAll()}
        onCleanupTemp={() => void handleCleanupTempArtifacts()}
        onOpenDocs={() => void openUrl(OPENCLAW_DOCS_URL)}
        onDownloadNode={() => void handleDownloadNode()}
        onDownloadGit={() => void handleDownloadGit()}
      />
    );
  } else if (
    currentSubpage === "installing" ||
    currentSubpage === "uninstalling" ||
    currentSubpage === "updating" ||
    currentSubpage === "restarting"
  ) {
    pageContent = (
      <OpenClawProgressPage
        kind={
          operationState.kind ??
          progressActionBySubpage[currentSubpage] ??
          "install"
        }
        title={operationState.title}
        description={operationState.description}
        handingOffToAgent={handingOffToAgent}
        running={
          operationState.running &&
          currentSubpage ===
            progressSubpageByAction[operationState.kind ?? "install"]
        }
        message={operationState.message}
        logs={installLogs}
        repairPrompt={openClawRepairPrompt}
        onClose={handleCloseProgress}
        onCopyLogs={() => void handleCopyOpenClawLogs()}
        onCopyDiagnosticBundle={() => void handleCopyOpenClawDiagnosticBundle()}
        onCopyRepairPrompt={() => void handleCopyOpenClawRepairPrompt()}
        onAskAgentFix={handleAskAgentFixOpenClaw}
      />
    );
  } else if (!installed) {
    pageContent = (
      <OpenClawInstallPage
        environmentStatus={environmentStatus}
        desktopPlatform={desktopPlatform}
        busy={operationState.running}
        installing={
          operationState.running &&
          operationState.kind === "install" &&
          operationState.target === "openclaw"
        }
        installingNode={
          operationState.running &&
          operationState.kind === "repair" &&
          operationState.target === "node"
        }
        installingGit={
          operationState.running &&
          operationState.kind === "repair" &&
          operationState.target === "git"
        }
        cleaningTemp={cleaningTemp}
        onInstall={() => void handleInstall()}
        onInstallNode={() => void handleInstallNode()}
        onInstallGit={() => void handleInstallGit()}
        onRefresh={() => void refreshAll()}
        onCleanupTemp={() => void handleCleanupTempArtifacts()}
        onOpenDocs={() => void openUrl(OPENCLAW_DOCS_URL)}
        onDownloadNode={() => void handleDownloadNode()}
        onDownloadGit={() => void handleDownloadGit()}
      />
    );
  } else if (currentSubpage === "configure") {
    pageContent = (
      <OpenClawConfigurePage
        installPath={installedStatus?.path}
        uninstalling={
          operationState.running && operationState.kind === "uninstall"
        }
        syncing={syncing}
        starting={starting}
        canSync={canSync}
        canStart={canStartFromConfigure}
        providersLoading={providersLoading}
        modelsLoading={modelsLoading}
        modelsError={modelsError ?? null}
        selectedProviderKey={selectedProvider?.key ?? ""}
        selectedModelId={selectedModelId}
        compatibleProviders={compatibleProviders}
        providerModels={providerModels}
        lastSynced={lastSynced}
        gatewayStatus={gatewayStatus}
        gatewayPort={gatewayPort}
        healthInfo={healthInfo}
        gatewayRunning={gatewayRunning}
        onCopyPath={() => void handleCopyPath()}
        onUninstall={() => void handleUninstall()}
        onOpenDocs={() => void openUrl(OPENCLAW_DOCS_URL)}
        onSelectProvider={(providerId) => {
          setSelectedProviderId(providerId || null);
          setSelectedModelId("");
        }}
        onSelectModel={setSelectedModelId}
        onInputModel={setSelectedModelId}
        onRefreshProviders={() => void refreshProviders()}
        onSync={() => void handleSync()}
        onStart={() => void handleStart()}
        onOpenRuntime={() => navigateSubpage("runtime")}
        onGoProviderSettings={() =>
          onNavigate?.("settings", { tab: SettingsTabs.Providers })
        }
      />
    );
  } else if (currentSubpage === "runtime") {
    pageContent = (
      <OpenClawRuntimePage
        gatewayStatus={gatewayStatus}
        gatewayPort={gatewayPort}
        healthInfo={healthInfo}
        channelCount={channels.length}
        startReady={hasSelectedConfig || !!lastSynced}
        canStart={canStartGateway}
        canStop={canStopGateway}
        canRestart={canRestartGateway}
        starting={starting}
        stopping={stopping}
        updateInfo={updateInfo}
        restarting={operationState.running && operationState.kind === "restart"}
        checkingHealth={checkingHealth}
        checkingUpdate={checkingUpdate}
        updating={updating}
        dashboardWindowOpen={dashboardWindowOpen}
        dashboardWindowBusy={dashboardWindowBusy}
        onStart={() => void handleStart()}
        onStop={() => void handleStop()}
        onRestart={() => void handleRestart()}
        onOpenDashboard={() => void handleOpenDashboardWindow()}
        onOpenDashboardPage={() => navigateSubpage("dashboard")}
        onBackToConfigure={() => navigateSubpage("configure")}
        onCheckHealth={() => void handleCheckHealth()}
        onCheckUpdate={() => void handleCheckUpdate()}
        onUpdate={() => void handlePerformUpdate()}
      />
    );
  } else if (currentSubpage === "dashboard") {
    if (!gatewayRunning && !gatewayStarting) {
      pageContent = renderBlockedPage(
        "Dashboard 暂不可用",
        "Gateway 当前未运行，请先进入运行页启动后再打开 Dashboard。",
        "返回运行页",
        () => navigateSubpage("runtime"),
      );
    } else {
      pageContent = (
        <OpenClawDashboardPage
          dashboardUrl={dashboardUrl}
          loading={dashboardLoading}
          running={gatewayRunning}
          windowBusy={dashboardWindowBusy}
          windowOpen={dashboardWindowOpen}
          onBack={() => navigateSubpage("runtime")}
          onOpenExternal={() => void handleOpenDashboardExternal()}
          onOpenWindow={() => void handleOpenDashboardWindow()}
          onRefresh={() =>
            void Promise.all([
              refreshDashboardUrl({ silent: false, showLoading: true }),
              refreshDashboardWindowState(),
            ])
          }
        />
      );
    }
  } else {
    pageContent = renderBlockedPage(
      "页面状态异常",
      "当前 OpenClaw 页面状态无法识别，请返回配置页重试。",
      "返回配置页",
      () => navigateSubpage("configure"),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(248,250,252,1)_0%,rgba(247,250,248,0.97)_52%,rgba(248,250,252,1)_100%)]">
      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[1480px] flex-col gap-6 px-4 py-5 lg:px-6 lg:py-6">
          <section className="relative overflow-hidden rounded-[30px] border border-amber-200/70 bg-[linear-gradient(135deg,rgba(249,248,244,0.98)_0%,rgba(248,250,252,0.98)_46%,rgba(243,248,247,0.96)_100%)] shadow-sm shadow-slate-950/5">
            <div className="pointer-events-none absolute -left-20 top-[-72px] h-56 w-56 rounded-full bg-amber-200/30 blur-3xl" />
            <div className="pointer-events-none absolute right-[-76px] top-[-24px] h-56 w-56 rounded-full bg-sky-200/24 blur-3xl" />

            <div className="relative flex flex-col gap-6 p-6 lg:p-8">
              <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl space-y-4">
                  <div className="flex items-center gap-4">
                    <OpenClawMark size="md" className="shadow-red-500/10" />
                    <div>
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-amber-700 shadow-sm">
                        OPENCLAW WORKSPACE
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                      OpenClaw 工作台
                    </h1>
                    <p className="max-w-2xl text-sm leading-6 text-slate-600">
                      {pageDescription}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="rounded-full border border-white/90 bg-white/90 px-3 py-1 text-slate-700 shadow-sm hover:bg-white">
                      {currentSubpageLabel}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="rounded-full border-slate-200 bg-white/75 px-3 py-1 text-slate-600"
                    >
                      {installed ? "环境已安装" : "环境待安装"}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="rounded-full border-slate-200 bg-white/75 px-3 py-1 text-slate-600"
                    >
                      OpenClaw {updateInfo?.currentVersion || environmentStatus?.openclaw.version || "未检测到版本"}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="rounded-full border-slate-200 bg-white/75 px-3 py-1 text-slate-600"
                    >
                      Gateway {gatewayRunning ? "运行中" : gatewayStatus}
                    </Badge>
                    {updateInfo?.hasUpdate ? (
                      <Badge
                        variant="outline"
                        className="rounded-full border-amber-200 bg-amber-50 px-3 py-1 text-amber-700"
                      >
                        可升级至 {updateInfo.latestVersion || "新版本"}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <div className="w-full max-w-[360px] rounded-[24px] border border-white/90 bg-white/88 p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        当前摘要
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        安装、模型同步、Gateway 和 Dashboard 状态会在这里持续汇总。
                      </p>
                    </div>
                    {operationState.running ? (
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        处理中
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                        已就绪
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1">
                      {compatibleProviders.length} 个 Provider
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1">
                      {channels.length} 个通道
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1">
                      端口 {gatewayPort}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {summaryCards.map((card) => {
                  const CardIcon = card.icon;
                  return (
                    <div
                      key={card.key}
                      className="rounded-[22px] border border-white/90 bg-white/85 p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            {card.title}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            {card.description}
                          </p>
                        </div>
                        <div
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border",
                            card.iconClassName,
                          )}
                        >
                          <CardIcon className="h-[18px] w-[18px]" />
                        </div>
                      </div>
                      <p
                        className={cn(
                          "mt-4 break-words text-2xl font-semibold tracking-tight text-slate-900",
                          card.valueClassName,
                        )}
                      >
                        {card.value}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <OpenClawSceneNav
                scenes={openClawScenes}
                currentScene={currentScene}
                onSelect={handleSelectScene}
                resolveStatus={resolveSceneStatus}
              />

              <section className={openClawPanelClassName}>
                <div className="text-sm font-semibold text-slate-900">
                  系统摘要
                </div>
                <div className="mt-4 space-y-3">
                  <div className={openClawSubPanelClassName}>
                    <div className="text-xs font-medium text-slate-500">
                      安装路径
                    </div>
                    <div className="mt-2 break-all text-sm leading-6 text-slate-700">
                      {installedStatus?.path || "尚未检测到安装路径"}
                    </div>
                  </div>
                  <div className={openClawSubPanelClassName}>
                    <div className="text-xs font-medium text-slate-500">
                      当前 Provider / 模型
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-700">
                      {selectedProvider?.label || "未选择 Provider"}
                      <br />
                      {selectedModelId.trim() || "未选择模型"}
                    </div>
                  </div>
                  <div className={openClawSubPanelClassName}>
                    <div className="text-xs font-medium text-slate-500">
                      Dashboard
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-700">
                      {dashboardWindowOpen
                        ? "桌面面板已打开"
                        : dashboardUrl
                          ? "访问地址已生成"
                          : "尚未生成访问地址"}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void refreshAll()}
                    className={cn(
                      openClawSecondaryButtonClassName,
                      "px-3 py-2 text-xs",
                    )}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    刷新状态
                  </button>
                  <button
                    type="button"
                    onClick={() => void openUrl(OPENCLAW_DOCS_URL)}
                    className={cn(
                      openClawSecondaryButtonClassName,
                      "px-3 py-2 text-xs",
                    )}
                  >
                    查看文档
                  </button>
                </div>
              </section>
            </aside>

            <section className="min-w-0">{pageContent}</section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OpenClawPage;
