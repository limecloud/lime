import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { ConfiguredProvider } from "@/hooks/useConfiguredProviders";
import { useProviderModels } from "@/hooks/useProviderModels";
import { useApiKeyProvider } from "@/hooks/useApiKeyProvider";
import { getRegistryIdFromType } from "@/lib/constants/providerMappings";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";
import type {
  OpenClawPageParams,
  OpenClawSubpage,
  Page,
  PageParams,
} from "@/types/page";
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
} from "@/lib/api/openclaw";
import { getOrCreateDefaultProject } from "@/lib/api/project";

import { OpenClawConfigurePage } from "./OpenClawConfigurePage";
import { OpenClawDashboardPage } from "./OpenClawDashboardPage";
import { OpenClawInstallPage } from "./OpenClawInstallPage";
import { OpenClawProgressPage } from "./OpenClawProgressPage";
import { OpenClawRuntimePage } from "./OpenClawRuntimePage";
import {
  type OpenClawOperationKind,
  type OpenClawOperationState,
  type OpenClawSubpage as LocalOpenClawSubpage,
} from "./types";
import { useOpenClawStore } from "./useOpenClawStore";
import { openUrl } from "./openUrl";
import { useOpenClawDashboardWindow } from "./useOpenClawDashboardWindow";

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
  };

const progressActionBySubpage: Partial<
  Record<OpenClawSubpage, OpenClawOperationKind>
> = {
  installing: "install",
  uninstalling: "uninstall",
  restarting: "restart",
};

function isOpenClawSubpage(value: unknown): value is OpenClawSubpage {
  return [
    "install",
    "installing",
    "configure",
    "runtime",
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
    <div className="flex min-h-0 flex-col items-center px-6 py-10">
      <section className="w-full max-w-2xl rounded-2xl border bg-card p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          {description}
        </p>
        <button
          type="button"
          onClick={onAction}
          className="mt-6 inline-flex items-center justify-center rounded-lg border px-4 py-2 text-sm hover:bg-muted"
        >
          {actionLabel}
        </button>
      </section>
    </div>
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

  if (candidate === "install" || candidate === "installing") {
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
  const [channels, setChannels] = useState<OpenClawChannelInfo[]>([]);
  const [installLogs, setInstallLogs] = useState<
    OpenClawInstallProgressEvent[]
  >([]);
  const [syncing, setSyncing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
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
  const hasSelectedConfig =
    Boolean(selectedProvider) && selectedModelId.trim().length > 0;
  const canSync = installed && hasSelectedConfig;
  const canStartFromConfigure =
    canStartGateway && (hasSelectedConfig || !!lastSynced);
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

  const handleInstall = useCallback(async () => {
    await runProgressOperation({
      kind: "install",
      target: "openclaw",
      title: "正在修复环境并安装 OpenClaw",
      description:
        "ProxyCast 会先自动检查并修复 Node.js / Git，再继续安装 OpenClaw。",
      action: () => openclawApi.install(),
      successSubpage: "runtime",
      returnSubpage: "install",
      initialLogs: [
        {
          level: "info",
          message: "已发送安装请求，正在检查并修复 OpenClaw 运行环境...",
        },
      ],
    });
  }, [runProgressOperation]);

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
  }, [runProgressOperation]);

  const handleInstallGit = useCallback(async () => {
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
  }, [runProgressOperation]);

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

  if (!statusResolved && !operationState.running) {
    return (
      <div className="flex min-h-0 flex-col items-center px-6 py-10">
        <div className="flex w-full max-w-xl flex-col items-center rounded-2xl border bg-card px-8 py-10 text-center shadow-sm">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            正在检查 OpenClaw 状态
          </h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            正在检测本地安装、Gateway 与配置状态，稍后会自动进入正确页面。
          </p>
        </div>
      </div>
    );
  }

  if (currentSubpage === "install") {
    return (
      <OpenClawInstallPage
        environmentStatus={environmentStatus}
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
        onDownloadNode={() =>
          void openclawApi
            .getNodeDownloadUrl()
            .then((url) => openUrl(url))
            .catch((error) => toast.error(String(error)))
        }
        onDownloadGit={() =>
          void openclawApi
            .getGitDownloadUrl()
            .then((url) => openUrl(url))
            .catch((error) => toast.error(String(error)))
        }
      />
    );
  }

  if (
    currentSubpage === "installing" ||
    currentSubpage === "uninstalling" ||
    currentSubpage === "restarting"
  ) {
    return (
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
  }

  if (!installed) {
    return (
      <OpenClawInstallPage
        environmentStatus={environmentStatus}
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
        onDownloadNode={() =>
          void openclawApi
            .getNodeDownloadUrl()
            .then((url) => openUrl(url))
            .catch((error) => toast.error(String(error)))
        }
        onDownloadGit={() =>
          void openclawApi
            .getGitDownloadUrl()
            .then((url) => openUrl(url))
            .catch((error) => toast.error(String(error)))
        }
      />
    );
  }

  if (currentSubpage === "configure") {
    return (
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
        onGoProviderPool={() => onNavigate?.("provider-pool")}
      />
    );
  }

  if (currentSubpage === "runtime") {
    return (
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
        restarting={operationState.running && operationState.kind === "restart"}
        checkingHealth={checkingHealth}
        dashboardWindowOpen={dashboardWindowOpen}
        dashboardWindowBusy={dashboardWindowBusy}
        onStart={() => void handleStart()}
        onStop={() => void handleStop()}
        onRestart={() => void handleRestart()}
        onOpenDashboard={() => void handleOpenDashboardWindow()}
        onOpenDashboardPage={() => navigateSubpage("dashboard")}
        onBackToConfigure={() => navigateSubpage("configure")}
        onCheckHealth={() => void handleCheckHealth()}
      />
    );
  }

  if (currentSubpage === "dashboard") {
    if (!gatewayRunning && !gatewayStarting) {
      return renderBlockedPage(
        "Dashboard 暂不可用",
        "Gateway 当前未运行，请先进入运行页启动后再打开 Dashboard。",
        "返回运行页",
        () => navigateSubpage("runtime"),
      );
    }

    return (
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

  return renderBlockedPage(
    "页面状态异常",
    "当前 OpenClaw 页面状态无法识别，请返回配置页重试。",
    "返回配置页",
    () => navigateSubpage("configure"),
  );
}

export default OpenClawPage;
