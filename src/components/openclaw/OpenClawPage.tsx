import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowUpCircle,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { ConfiguredProvider } from "@/hooks/useConfiguredProviders";
import { useProviderModels } from "@/hooks/useProviderModels";
import { useApiKeyProvider } from "@/hooks/useApiKeyProvider";
import { getRegistryIdFromType } from "@/lib/constants/providerMappings";
import {
  copyTextToClipboard,
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
  type OpenClawRuntimeCandidate,
  type OpenClawSyncModelEntry,
  type OpenClawUpdateInfo,
} from "@/lib/api/openclaw";
import { wechatChannelSetRuntimeModel } from "@/lib/api/channelsRuntime";
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
  type OpenClawOperationHistoryEntry,
  type OpenClawOperationState,
  type OpenClawScene,
  type OpenClawSceneDefinition,
  type OpenClawSceneStatus,
  type OpenClawSubpage as LocalOpenClawSubpage,
} from "./types";
import { useOpenClawStore } from "./useOpenClawStore";
import { openUrl } from "./openUrl";
import { compactPathLabel } from "./pathDisplay";
import { useOpenClawDashboardWindow } from "./useOpenClawDashboardWindow";
import {
  openClawPanelClassName,
  openClawPrimaryButtonClassName,
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

type OpenClawRefreshSnapshot = {
  appliedRuntimeId: string | null;
  environment: OpenClawEnvironmentStatus;
  runtimes: OpenClawRuntimeCandidate[];
  updateInfo: OpenClawUpdateInfo | null;
  gatewayStatus: OpenClawGatewayStatus;
  gatewayPort: number;
  healthInfo: OpenClawHealthInfo | null;
  channels: OpenClawChannelInfo[];
  dashboardWindowOpen: boolean;
};

type OpenClawSnapshotVersionState = {
  runtimeCandidate: OpenClawRuntimeCandidate | null;
  installedVersion: string | null;
  runningVersion: string | null;
  versionMismatch: boolean;
};

function selectCurrentRuntimeCandidate(
  runtimeCandidates: OpenClawRuntimeCandidate[],
  preferredRuntimeId: string | null,
): OpenClawRuntimeCandidate | null {
  return (
    (preferredRuntimeId
      ? runtimeCandidates.find(
          (candidate) => candidate.id === preferredRuntimeId,
        )
      : null) ||
    runtimeCandidates.find((candidate) => candidate.isPreferred) ||
    runtimeCandidates.find((candidate) => candidate.isActive) ||
    null
  );
}

function runtimeCandidateHasOpenClawInstallation(
  candidate: OpenClawRuntimeCandidate | null | undefined,
): boolean {
  return Boolean(
    candidate?.openclawVersion ||
    candidate?.openclawPath ||
    candidate?.openclawPackagePath,
  );
}

function formatRuntimeCandidateLabel(
  candidate: OpenClawRuntimeCandidate | null | undefined,
): string {
  if (!candidate) {
    return "自动选择";
  }

  return `${candidate.source} · Node ${candidate.nodeVersion || "未识别"}`;
}

function formatRuntimeCandidateOpenClawSummary(
  candidate: OpenClawRuntimeCandidate | null | undefined,
): string {
  if (!candidate) {
    return "未识别执行环境";
  }

  if (candidate.openclawVersion) {
    return `${formatRuntimeCandidateLabel(candidate)} · OpenClaw ${candidate.openclawVersion}`;
  }

  if (candidate.openclawPath) {
    return `${formatRuntimeCandidateLabel(candidate)} · 已检测到 OpenClaw 命令`;
  }

  if (candidate.openclawPackagePath) {
    return `${formatRuntimeCandidateLabel(candidate)} · 已检测到 OpenClaw 包`;
  }

  return `${formatRuntimeCandidateLabel(candidate)} · 未检测到 OpenClaw`;
}

function trimOpenClawVersion(
  version: string | null | undefined,
): string | null {
  const trimmed = version?.trim();
  return trimmed ? trimmed : null;
}

function normalizeComparableOpenClawVersion(
  version: string | null | undefined,
): string | null {
  const trimmed = trimOpenClawVersion(version);
  if (!trimmed) {
    return null;
  }

  return trimmed
    .replace(/^v/i, "")
    .replace(/-zh(?:\.\d+)?$/i, "")
    .trim();
}

function resolveInstalledOpenClawVersion(params: {
  updateInfo?: OpenClawUpdateInfo | null;
  environmentStatus?: OpenClawEnvironmentStatus | null;
  runtimeCandidate?: OpenClawRuntimeCandidate | null;
}): string | null {
  return (
    trimOpenClawVersion(params.updateInfo?.currentVersion) ||
    trimOpenClawVersion(params.runtimeCandidate?.openclawVersion) ||
    trimOpenClawVersion(params.environmentStatus?.openclaw.version)
  );
}

function resolveRunningOpenClawVersion(params: {
  gatewayRunning: boolean;
  healthInfo?: OpenClawHealthInfo | null;
}): string | null {
  if (!params.gatewayRunning) {
    return null;
  }

  return trimOpenClawVersion(params.healthInfo?.version);
}

function hasOpenClawVersionMismatch(params: {
  gatewayRunning: boolean;
  installedVersion: string | null;
  runningVersion: string | null;
}): boolean {
  if (!params.gatewayRunning) {
    return false;
  }

  const installedComparable = normalizeComparableOpenClawVersion(
    params.installedVersion,
  );
  const runningComparable = normalizeComparableOpenClawVersion(
    params.runningVersion,
  );

  return Boolean(
    installedComparable &&
    runningComparable &&
    installedComparable !== runningComparable,
  );
}

function resolveSnapshotOpenClawVersionState(
  snapshot: OpenClawRefreshSnapshot,
): OpenClawSnapshotVersionState {
  const runtimeCandidate = selectCurrentRuntimeCandidate(
    snapshot.runtimes,
    snapshot.appliedRuntimeId,
  );
  const installedVersion = resolveInstalledOpenClawVersion({
    updateInfo: snapshot.updateInfo,
    environmentStatus: snapshot.environment,
    runtimeCandidate,
  });
  const runningVersion = resolveRunningOpenClawVersion({
    gatewayRunning: snapshot.gatewayStatus === "running",
    healthInfo: snapshot.healthInfo,
  });

  return {
    runtimeCandidate,
    installedVersion,
    runningVersion,
    versionMismatch: hasOpenClawVersionMismatch({
      gatewayRunning: snapshot.gatewayStatus === "running",
      installedVersion,
      runningVersion,
    }),
  };
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
      fallbackRegistryId: getRegistryIdFromType(
        provider.type,
        provider.api_host,
      ),
      type: provider.type,
      providerId: provider.id,
      apiHost: provider.api_host,
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
    runtime: string;
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
    "4. 如果可以在当前 Lime / Tauri 项目中修复，也请给出具体修改建议",
    "",
    "当前系统信息：",
    `- 操作系统: ${systemInfo.os}`,
    `- User Agent: ${systemInfo.userAgent}`,
    `- 执行环境: ${systemInfo.runtime}`,
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

function buildOpenClawRawLogsText(
  logs: OpenClawInstallProgressEvent[],
): string {
  return logs.length > 0
    ? logs
        .map((log) => `[${log.level.toUpperCase()}] ${log.message}`)
        .join("\n")
    : "";
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
  workflowReady: boolean,
  gatewayRunning: boolean,
  gatewayStarting: boolean,
  operationState: OpenClawOperationState,
  options?: {
    allowInstallPage?: boolean;
  },
): OpenClawSubpage {
  const allowInstallPage = options?.allowInstallPage ?? false;
  if (operationState.running && operationState.kind) {
    return progressSubpageByAction[operationState.kind];
  }

  if (
    operationState.kind &&
    operationState.message &&
    candidate === progressSubpageByAction[operationState.kind]
  ) {
    return candidate;
  }

  if (!workflowReady) {
    return "install";
  }

  if (candidate === "install") {
    return allowInstallPage ? "install" : "runtime";
  }

  if (candidate === "installing" || candidate === "updating") {
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
  const preferredRuntimeId = useOpenClawStore(
    (state) => state.preferredRuntimeId,
  );
  const lastSynced = useOpenClawStore((state) => state.lastSynced);
  const recentOperation = useOpenClawStore((state) => state.recentOperation);
  const setSelectedProviderId = useOpenClawStore(
    (state) => state.setSelectedProviderId,
  );
  const setSelectedModelId = useOpenClawStore(
    (state) => state.setSelectedModelId,
  );
  const setGatewayPort = useOpenClawStore((state) => state.setGatewayPort);
  const setPreferredRuntimeId = useOpenClawStore(
    (state) => state.setPreferredRuntimeId,
  );
  const setLastSynced = useOpenClawStore((state) => state.setLastSynced);
  const setRecentOperation = useOpenClawStore(
    (state) => state.setRecentOperation,
  );
  const clearLastSynced = useOpenClawStore((state) => state.clearLastSynced);

  const [fallbackSubpage, setFallbackSubpage] =
    useState<LocalOpenClawSubpage>("install");
  const hasManualFallbackNavigationRef = useRef(false);
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
  const [runtimeCandidates, setRuntimeCandidates] = useState<
    OpenClawRuntimeCandidate[]
  >([]);
  const [channels, setChannels] = useState<OpenClawChannelInfo[]>([]);
  const [installLogs, setInstallLogs] = useState<
    OpenClawInstallProgressEvent[]
  >([]);
  const installLogsRef = useRef<OpenClawInstallProgressEvent[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [switchingRuntime, setSwitchingRuntime] = useState(false);
  const [cleaningTemp, setCleaningTemp] = useState(false);
  const [handingOffToAgent, setHandingOffToAgent] = useState(false);
  const lastWechatRuntimeModelSyncRef = useRef<string | null>(null);
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
  const updating = operationState.running && operationState.kind === "update";
  const hasSelectedConfig =
    Boolean(selectedProvider) && selectedModelId.trim().length > 0;
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
  const currentRuntimeCandidate = useMemo(
    () => selectCurrentRuntimeCandidate(runtimeCandidates, preferredRuntimeId),
    [preferredRuntimeId, runtimeCandidates],
  );
  const currentRuntimeSummary = useMemo(() => {
    if (!currentRuntimeCandidate) {
      return preferredRuntimeId
        ? "已固定执行环境，但当前未检测到对应运行时"
        : "自动选择执行环境";
    }

    return `${currentRuntimeCandidate.source} · Node ${
      currentRuntimeCandidate.nodeVersion || "未识别"
    }${
      currentRuntimeCandidate.openclawVersion
        ? ` · OpenClaw ${currentRuntimeCandidate.openclawVersion}`
        : ""
    }`;
  }, [currentRuntimeCandidate, preferredRuntimeId]);
  const currentRuntimeHasOpenClawInstallation = useMemo(
    () => runtimeCandidateHasOpenClawInstallation(currentRuntimeCandidate),
    [currentRuntimeCandidate],
  );
  const recommendedUpdateRuntimeCandidate = useMemo(() => {
    if (currentRuntimeHasOpenClawInstallation) {
      return currentRuntimeCandidate;
    }

    return (
      runtimeCandidates.find((candidate) =>
        runtimeCandidateHasOpenClawInstallation(candidate),
      ) || null
    );
  }, [
    currentRuntimeCandidate,
    currentRuntimeHasOpenClawInstallation,
    runtimeCandidates,
  ]);
  const updateRuntimeRequiresSwitch = useMemo(() => {
    if (currentRuntimeHasOpenClawInstallation) {
      return false;
    }

    return Boolean(
      recommendedUpdateRuntimeCandidate &&
      recommendedUpdateRuntimeCandidate.id !== currentRuntimeCandidate?.id,
    );
  }, [
    currentRuntimeCandidate?.id,
    currentRuntimeHasOpenClawInstallation,
    recommendedUpdateRuntimeCandidate,
  ]);
  const updateRuntimeReady = useMemo(
    () =>
      currentRuntimeHasOpenClawInstallation ||
      Boolean(recommendedUpdateRuntimeCandidate),
    [currentRuntimeHasOpenClawInstallation, recommendedUpdateRuntimeCandidate],
  );
  const updateRuntimeNotice = useMemo(() => {
    if (updateRuntimeRequiresSwitch && recommendedUpdateRuntimeCandidate) {
      return {
        tone: "warning" as const,
        title: "升级前会自动切到已安装 OpenClaw 的执行环境",
        description: `当前执行环境没有检测到 OpenClaw。推荐使用 ${formatRuntimeCandidateOpenClawSummary(
          recommendedUpdateRuntimeCandidate,
        )}；点击“智能升级”时 Lime 也会自动切换。`,
        actionLabel: "立即切换",
      };
    }

    if (!updateRuntimeReady) {
      return {
        tone: "error" as const,
        title: "当前还没识别到可升级的执行环境",
        description:
          "未在任何运行时中检测到 OpenClaw 命令或安装包。智能升级仍会尝试自动识别，但建议先重新检测或完成安装。",
      };
    }

    return null;
  }, [
    recommendedUpdateRuntimeCandidate,
    updateRuntimeReady,
    updateRuntimeRequiresSwitch,
  ]);
  const softInstalled = useMemo(
    () =>
      environmentStatus?.openclaw.status === "needs_reload" &&
      (gatewayRunning ||
        gatewayStarting ||
        Boolean(updateInfo?.currentVersion) ||
        Boolean(currentRuntimeCandidate?.openclawPath) ||
        Boolean(currentRuntimeCandidate?.openclawVersion)),
    [
      currentRuntimeCandidate?.openclawPath,
      currentRuntimeCandidate?.openclawVersion,
      environmentStatus?.openclaw.status,
      gatewayRunning,
      gatewayStarting,
      updateInfo?.currentVersion,
    ],
  );
  const installedVersion = useMemo(
    () =>
      resolveInstalledOpenClawVersion({
        updateInfo,
        environmentStatus,
        runtimeCandidate: currentRuntimeCandidate,
      }),
    [currentRuntimeCandidate, environmentStatus, updateInfo],
  );
  const runningVersion = useMemo(
    () =>
      resolveRunningOpenClawVersion({
        gatewayRunning,
        healthInfo,
      }),
    [gatewayRunning, healthInfo],
  );
  const versionMismatch = useMemo(
    () =>
      hasOpenClawVersionMismatch({
        gatewayRunning,
        installedVersion,
        runningVersion,
      }),
    [gatewayRunning, installedVersion, runningVersion],
  );
  const versionStatusSummary = useMemo(() => {
    if (!installedVersion) {
      return {
        label: "未识别安装版本",
        description: "尚未检测到 OpenClaw 已安装版本。",
      };
    }

    if (versionMismatch) {
      return {
        label: "运行中仍是旧版本",
        description: `已安装 ${installedVersion}，但当前 Gateway 仍在运行 ${runningVersion || "未知版本"}。请重启 Gateway 让新版本生效。`,
      };
    }

    if (gatewayRunning) {
      return {
        label: runningVersion ? "版本已生效" : "运行中待校验",
        description: runningVersion
          ? `当前 Gateway 已运行 ${runningVersion}。`
          : "Gateway 已运行，但暂未识别运行中的版本号。",
      };
    }

    if (gatewayStarting) {
      return {
        label: "启动中待校验",
        description: `已安装 ${installedVersion}，等待 Gateway 启动后确认运行中版本。`,
      };
    }

    return {
      label: "待启动确认",
      description: `已安装 ${installedVersion}，启动 Gateway 后即可确认新版本是否已生效。`,
    };
  }, [
    gatewayRunning,
    gatewayStarting,
    installedVersion,
    runningVersion,
    versionMismatch,
  ]);
  const dashboardProfileVersionKey = useMemo(
    () =>
      normalizeComparableOpenClawVersion(runningVersion || installedVersion),
    [installedVersion, runningVersion],
  );
  const openclawWorkflowReady = installed || softInstalled;
  const canStartGateway =
    openclawWorkflowReady && !gatewayRunning && !gatewayStarting;
  const canStopGateway = openclawWorkflowReady && gatewayStatus !== "stopped";
  const canRestartGateway = openclawWorkflowReady && gatewayRunning;
  const canSync = openclawWorkflowReady && hasSelectedConfig;
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
  } = useOpenClawDashboardWindow({
    gatewayStatus,
    profileVersionKey: dashboardProfileVersionKey,
  });

  const defaultSubpage = useMemo<OpenClawSubpage>(() => {
    if (operationState.running && operationState.kind) {
      return progressSubpageByAction[operationState.kind];
    }

    if (!openclawWorkflowReady) {
      return "install";
    }

    return "runtime";
  }, [openclawWorkflowReady, operationState.kind, operationState.running]);

  const requestedOrFallbackSubpage =
    requestedSubpage ?? (onNavigate ? defaultSubpage : fallbackSubpage);
  const allowInstallPage =
    environmentStatus?.openclaw.status === "needs_reload";
  const currentSubpage = useMemo(
    () =>
      resolveOpenClawSubpage(
        requestedOrFallbackSubpage,
        openclawWorkflowReady,
        gatewayRunning,
        gatewayStarting,
        operationState,
        { allowInstallPage },
      ),
    [
      gatewayRunning,
      gatewayStarting,
      allowInstallPage,
      openclawWorkflowReady,
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
        hasManualFallbackNavigationRef.current = true;
        setFallbackSubpage(subpage);
      }
    },
    [onNavigate],
  );

  useEffect(() => {
    installLogsRef.current = installLogs;
  }, [installLogs]);

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
    const providerId = selectedProvider?.key?.trim() || "";
    const modelId = selectedModelId.trim();
    const selectionKey =
      providerId && modelId ? `${providerId}/${modelId}` : null;

    if (!selectionKey) {
      lastWechatRuntimeModelSyncRef.current = null;
      return;
    }

    if (lastWechatRuntimeModelSyncRef.current === selectionKey) {
      return;
    }

    let cancelled = false;
    void wechatChannelSetRuntimeModel({ providerId, modelId })
      .then(() => {
        if (!cancelled) {
          lastWechatRuntimeModelSyncRef.current = selectionKey;
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[OpenClaw] 同步微信运行时模型失败:", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedModelId, selectedProvider?.key]);

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

    let nextHealthInfo: OpenClawHealthInfo | null = null;
    let nextChannels: OpenClawChannelInfo[] = [];

    if (status.status === "running") {
      const [healthResult, channelListResult] = await Promise.allSettled([
        openclawApi.checkHealth(),
        openclawApi.getChannels(),
      ]);
      nextHealthInfo =
        healthResult.status === "fulfilled" ? healthResult.value : null;
      nextChannels =
        channelListResult.status === "fulfilled" &&
        Array.isArray(channelListResult.value)
          ? channelListResult.value
          : [];
      setHealthInfo(nextHealthInfo);
      setChannels(nextChannels);
    } else {
      setHealthInfo(null);
      setChannels([]);
    }

    return {
      status,
      healthInfo: nextHealthInfo,
      channels: nextChannels,
    };
  }, [gatewayPort, refreshDashboardUrl, setGatewayPort]);

  const refreshUpdateStatus = useCallback(
    async ({ showToast = false } = {}) => {
      if (!openclawWorkflowReady) {
        setUpdateInfo(null);
        return null;
      }

      const result = await openclawApi.checkUpdate();
      setUpdateInfo(result);

      if (showToast) {
        if (result.hasUpdate) {
          toast.info(
            `检测到 OpenClaw 新版本 ${result.latestVersion || ""}`.trim(),
            {
              description: result.currentVersion
                ? `当前版本 ${result.currentVersion}`
                : "可以在当前工作台直接执行升级。",
            },
          );
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
    [openclawWorkflowReady],
  );

  const syncPreferredRuntimeSelection = useCallback(
    async (
      runtimeId: string | null,
      options?: { allowAutoReset?: boolean },
    ) => {
      const allowAutoReset = options?.allowAutoReset ?? false;
      if (!runtimeId && !allowAutoReset) {
        return {
          appliedRuntimeId: null,
          message: "当前使用自动选择执行环境。",
          recoveredToAuto: false,
        };
      }

      const result = await openclawApi.setPreferredRuntime(runtimeId);
      if (result.success) {
        return {
          appliedRuntimeId: runtimeId,
          message: result.message,
          recoveredToAuto: false,
        };
      }

      if (runtimeId) {
        setPreferredRuntimeId(null);
        const autoResult = await openclawApi
          .setPreferredRuntime(null)
          .catch(() => null);
        return {
          appliedRuntimeId: null,
          message: autoResult?.message || result.message,
          recoveredToAuto: true,
          recoveryReason: result.message,
        };
      }

      throw new Error(result.message);
    },
    [setPreferredRuntimeId],
  );

  const refreshAll = useCallback(
    async (runtimeIdOverride?: string | null) => {
      try {
        const effectiveRuntimeId =
          runtimeIdOverride === undefined
            ? preferredRuntimeId
            : runtimeIdOverride;
        const runtimeSync =
          await syncPreferredRuntimeSelection(effectiveRuntimeId);
        if (runtimeSync.recoveredToAuto && runtimeSync.recoveryReason) {
          toast.warning("已恢复为自动选择执行环境。", {
            description: runtimeSync.recoveryReason,
          });
        }

        const [environment, runtimes] = await Promise.all([
          openclawApi.getEnvironmentStatus(),
          openclawApi.listRuntimeCandidates(),
        ]);
        setRuntimeCandidates(runtimes);
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
        const updateResult =
          environment.openclaw.status === "ok"
            ? await openclawApi.checkUpdate().catch(() => null)
            : null;
        setUpdateInfo(updateResult);
        const [gatewayRuntime, dashboardWindowOpenState] = await Promise.all([
          refreshGatewayRuntime(),
          refreshDashboardWindowState(),
        ]);
        return {
          appliedRuntimeId: runtimeSync.appliedRuntimeId,
          environment,
          runtimes,
          updateInfo: updateResult,
          gatewayStatus: gatewayRuntime.status.status,
          gatewayPort: gatewayRuntime.status.port,
          healthInfo: gatewayRuntime.healthInfo,
          channels: gatewayRuntime.channels,
          dashboardWindowOpen: dashboardWindowOpenState,
        } satisfies OpenClawRefreshSnapshot;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
        return null;
      } finally {
        setStatusResolved(true);
      }
    },
    [
      preferredRuntimeId,
      refreshDashboardWindowState,
      refreshGatewayRuntime,
      syncPreferredRuntimeSelection,
    ],
  );

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

    if (
      operationState.kind &&
      operationState.message &&
      fallbackSubpage === progressSubpageByAction[operationState.kind]
    ) {
      return;
    }

    const preserveInstallPage =
      allowInstallPage &&
      hasManualFallbackNavigationRef.current &&
      fallbackSubpage === "install";
    const resolvedSubpage = !openclawWorkflowReady ? "install" : "runtime";

    if (
      !onNavigate &&
      !preserveInstallPage &&
      fallbackSubpage !== resolvedSubpage
    ) {
      setFallbackSubpage(resolvedSubpage);
    }
  }, [
    allowInstallPage,
    fallbackSubpage,
    gatewayRunning,
    gatewayStarting,
    openclawWorkflowReady,
    onNavigate,
    operationState.kind,
    operationState.message,
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

  const createOpenClawOperationHistoryEntry = useCallback(
    (params: {
      kind: OpenClawOperationKind;
      target: OpenClawOperationState["target"];
      title: string | null;
      description: string | null;
      message: string | null;
      returnSubpage: OpenClawSubpage;
      logs: OpenClawInstallProgressEvent[];
      success: boolean;
    }): OpenClawOperationHistoryEntry => {
      const {
        kind,
        target,
        title,
        description,
        message,
        returnSubpage,
        logs,
        success,
      } = params;
      const rawLogsText = buildOpenClawRawLogsText(logs);
      const repairPrompt = buildOpenClawRepairPrompt(kind, message, logs, {
        os:
          typeof navigator !== "undefined"
            ? `${navigator.platform || "unknown"} / ${navigator.language || "unknown"}`
            : "unknown",
        userAgent:
          typeof navigator !== "undefined"
            ? navigator.userAgent || "unknown"
            : "unknown",
        runtime: currentRuntimeSummary,
        installPath: installedStatus?.path || "未检测到安装路径",
        nodeStatus: formatNodeStatus(nodeStatus),
        gitStatus: formatBinaryStatus(gitStatus, "可用", "未检测到 Git"),
        gatewayStatus,
        gatewayPort,
        healthStatus: healthInfo
          ? `${healthInfo.status}${healthInfo.version ? ` · ${healthInfo.version}` : ""}`
          : "尚未执行健康检查",
        dashboardUrl: dashboardUrl || "尚未生成 Dashboard 地址",
      });

      const diagnosticBundleJson = JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: "openclaw-progress",
          operation: kind,
          running: false,
          message,
          system: {
            os:
              typeof navigator !== "undefined"
                ? `${navigator.platform || "unknown"} / ${navigator.language || "unknown"}`
                : "unknown",
            userAgent:
              typeof navigator !== "undefined"
                ? navigator.userAgent || "unknown"
                : "unknown",
            runtime: currentRuntimeSummary,
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
          logs,
        },
        null,
        2,
      );

      return {
        kind,
        target,
        title,
        description,
        message,
        returnSubpage,
        success,
        updatedAt: new Date().toISOString(),
        logs,
        rawLogsText,
        diagnosticBundleJson,
        repairPrompt,
      };
    },
    [
      currentRuntimeSummary,
      dashboardUrl,
      gatewayPort,
      gatewayStatus,
      gitStatus,
      healthInfo,
      installedStatus?.path,
      nodeStatus,
    ],
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
      successToast?:
        | false
        | ((context: {
            result: { success: boolean; message: string };
            snapshot: OpenClawRefreshSnapshot | null;
            logs: OpenClawInstallProgressEvent[];
          }) => void);
      afterSuccessRefresh?: (context: {
        result: { success: boolean; message: string };
        snapshot: OpenClawRefreshSnapshot | null;
        logs: OpenClawInstallProgressEvent[];
      }) => Promise<void> | void;
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
        successToast,
        afterSuccessRefresh,
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
        const latestLogs = await openclawApi
          .getProgressLogs()
          .catch(() => installLogsRef.current);
        const historyLogs =
          latestLogs.length > 0
            ? latestLogs
            : installLogsRef.current.length > 0
              ? installLogsRef.current
              : initialLogs;

        setInstallLogs(historyLogs);
        setRecentOperation(
          createOpenClawOperationHistoryEntry({
            kind,
            target,
            title,
            description,
            message: result.message,
            returnSubpage,
            logs: historyLogs,
            success: result.success,
          }),
        );
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

        onSuccess?.();
        const refreshSnapshot = await refreshAll();
        if (successToast === false) {
          // 由调用方自行处理成功提示
        } else if (typeof successToast === "function") {
          successToast({
            result,
            snapshot: refreshSnapshot,
            logs: historyLogs,
          });
        } else {
          toast.success(result.message);
        }
        await afterSuccessRefresh?.({
          result,
          snapshot: refreshSnapshot,
          logs: historyLogs,
        });
        navigateSubpage(successSubpage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const latestLogs = await openclawApi
          .getProgressLogs()
          .catch(() => installLogsRef.current);
        const historyLogs =
          latestLogs.length > 0
            ? latestLogs
            : installLogsRef.current.length > 0
              ? installLogsRef.current
              : initialLogs;

        setInstallLogs(historyLogs);
        setRecentOperation(
          createOpenClawOperationHistoryEntry({
            kind,
            target,
            title,
            description,
            message,
            returnSubpage,
            logs: historyLogs,
            success: false,
          }),
        );
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
    [
      createOpenClawOperationHistoryEntry,
      navigateSubpage,
      refreshAll,
      setRecentOperation,
    ],
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
      title: isWindowsPlatform
        ? "正在安装 OpenClaw"
        : "正在修复环境并安装 OpenClaw",
      description: isWindowsPlatform
        ? "当前环境已通过检测，正在继续安装 OpenClaw。"
        : "Lime 会先自动检查并修复 Node.js / Git，再继续安装 OpenClaw。",
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
      toast.info(
        "Windows 下请先手动下载安装 Node.js 22+，安装完成后重新检测。",
      );
      await handleDownloadNode();
      return;
    }

    await runProgressOperation({
      kind: "repair",
      target: "node",
      title: "正在安装 Node.js 环境",
      description: "Lime 会优先尝试应用内一键安装或修复 Node.js。",
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
      description: "Lime 会优先尝试应用内一键安装或修复 Git。",
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

  const handleSelectPreferredRuntime = useCallback(
    async (runtimeId: string | null) => {
      setSwitchingRuntime(true);
      try {
        const result = await syncPreferredRuntimeSelection(runtimeId, {
          allowAutoReset: runtimeId === null,
        });
        setPreferredRuntimeId(result.appliedRuntimeId);
        await refreshAll(result.appliedRuntimeId);
        toast.success(result.message);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setSwitchingRuntime(false);
      }
    },
    [refreshAll, setPreferredRuntimeId, syncPreferredRuntimeSelection],
  );

  const ensureUpdateRuntimeReady = useCallback(async () => {
    if (currentRuntimeHasOpenClawInstallation) {
      return true;
    }

    if (!recommendedUpdateRuntimeCandidate) {
      toast.warning("当前执行环境里还没有检测到 OpenClaw。", {
        description:
          "智能升级会继续尝试自动识别安装来源；如果仍失败，请先在执行环境卡片里切到已安装 OpenClaw 的 Node 运行时。",
      });
      return true;
    }

    setSwitchingRuntime(true);
    try {
      const result = await syncPreferredRuntimeSelection(
        recommendedUpdateRuntimeCandidate.id,
      );
      if (result.appliedRuntimeId !== recommendedUpdateRuntimeCandidate.id) {
        throw new Error(result.recoveryReason || result.message);
      }

      setPreferredRuntimeId(result.appliedRuntimeId);
      toast.info("已自动切换到检测到 OpenClaw 的执行环境。", {
        description: formatRuntimeCandidateOpenClawSummary(
          recommendedUpdateRuntimeCandidate,
        ),
      });
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setSwitchingRuntime(false);
    }
  }, [
    currentRuntimeHasOpenClawInstallation,
    recommendedUpdateRuntimeCandidate,
    setPreferredRuntimeId,
    syncPreferredRuntimeSelection,
  ]);

  const handleUseRecommendedUpdateRuntime = useCallback(async () => {
    if (!recommendedUpdateRuntimeCandidate) {
      return;
    }

    await handleSelectPreferredRuntime(recommendedUpdateRuntimeCandidate.id);
  }, [handleSelectPreferredRuntime, recommendedUpdateRuntimeCandidate]);

  const handlePerformUpdate = useCallback(async () => {
    const runtimePrepared = await ensureUpdateRuntimeReady();
    if (!runtimePrepared) {
      return;
    }

    const reopenDashboardAfterUpdate = dashboardWindowOpen;
    await closeDashboardWindowSilently();
    await runProgressOperation({
      kind: "update",
      target: "openclaw",
      title: "正在智能升级 OpenClaw",
      description:
        "将优先调用 openclaw update；如果官方自更新无法识别安装来源，Lime 会自动尝试同运行时的全局安装升级兜底。",
      action: () => openclawApi.performUpdate(),
      successSubpage: "runtime",
      returnSubpage: "runtime",
      initialLogs: [
        {
          level: "info",
          message: updateInfo?.hasUpdate
            ? `已检测到新版本 ${updateInfo.latestVersion || "待确认"}，开始智能升级...`
            : "开始执行 OpenClaw 智能升级...",
        },
      ],
      successToast: ({ result, snapshot }) => {
        if (!snapshot) {
          toast.success(result.message);
          return;
        }

        const snapshotVersionState =
          resolveSnapshotOpenClawVersionState(snapshot);

        if (snapshotVersionState.versionMismatch) {
          toast.warning("新版本已经安装，但当前仍在运行旧版 Gateway。", {
            description: `已安装 ${snapshotVersionState.installedVersion || "新版本"}，当前运行中 ${snapshotVersionState.runningVersion || "未知版本"}。请点击“重启 Gateway”让桌面版切换到新版本。`,
          });
          return;
        }

        toast.success(
          snapshotVersionState.installedVersion
            ? `OpenClaw 已升级到 ${snapshotVersionState.installedVersion}。`
            : result.message,
          {
            description:
              snapshot.gatewayStatus === "running"
                ? `当前运行中 ${snapshotVersionState.runningVersion || snapshotVersionState.installedVersion || "新版本"}。`
                : "Gateway 未运行，启动后即可进入新版本桌面版。",
          },
        );
      },
      afterSuccessRefresh: async ({ snapshot }) => {
        if (!snapshot) {
          return;
        }

        if (
          reopenDashboardAfterUpdate &&
          snapshot.gatewayStatus === "running" &&
          !resolveSnapshotOpenClawVersionState(snapshot).versionMismatch
        ) {
          await handleOpenDashboardWindow();
        }
      },
    });
  }, [
    dashboardWindowOpen,
    closeDashboardWindowSilently,
    ensureUpdateRuntimeReady,
    handleOpenDashboardWindow,
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
    if (!path?.trim()) {
      toast.error("当前没有可复制的安装路径。");
      return;
    }

    try {
      await copyTextToClipboard(path, {
        fallbackErrorMessage: "复制安装路径失败，请重试。",
        permissionDeniedMessage:
          "剪贴板权限被系统拒绝，请先点击 Lime 窗口后重试复制安装路径。",
        inactiveWindowMessage:
          "当前窗口未激活，先点击 Lime 窗口后再复制安装路径。",
      });
      toast.success("安装路径已复制。");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "复制安装路径失败。",
      );
    }
  }, [installedStatus?.path]);

  const handleCloseProgress = useCallback(() => {
    navigateSubpage(operationState.returnSubpage);
  }, [navigateSubpage, operationState.returnSubpage]);

  const handleOpenRecentOperationLogsPage = useCallback(() => {
    if (!recentOperation) {
      toast.error("当前没有可查看的历史日志。");
      return;
    }

    setInstallLogs(recentOperation.logs);
    setOperationState({
      kind: recentOperation.kind,
      target: recentOperation.target,
      running: false,
      title: recentOperation.title,
      description: recentOperation.description,
      message: recentOperation.message,
      returnSubpage: "runtime",
    });
    navigateSubpage(progressSubpageByAction[recentOperation.kind]);
  }, [navigateSubpage, recentOperation]);

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
          runtime: currentRuntimeSummary,
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
      currentRuntimeSummary,
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
    () => buildOpenClawRawLogsText(installLogs),
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
            runtime: currentRuntimeSummary,
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
      currentRuntimeSummary,
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
      await copyTextToClipboard(openClawRepairPrompt, {
        fallbackErrorMessage: "复制 OpenClaw 修复提示词失败，请重试。",
        permissionDeniedMessage:
          "剪贴板权限被系统拒绝，请先点击 Lime 窗口后重试复制修复提示词。",
        inactiveWindowMessage:
          "当前窗口未激活，先点击 Lime 窗口后再复制修复提示词。",
      });
      toast.success("OpenClaw 修复提示词已复制。");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "复制修复提示词失败。",
      );
    }
  }, [openClawRepairPrompt]);

  const handleCopyOpenClawLogs = useCallback(async () => {
    if (!openClawRawLogsText.trim()) {
      toast.error("当前没有可复制的日志。");
      return;
    }

    try {
      await copyTextToClipboard(openClawRawLogsText, {
        fallbackErrorMessage: "复制 OpenClaw 日志失败，请重试。",
        permissionDeniedMessage:
          "剪贴板权限被系统拒绝，请先点击 Lime 窗口后重试复制日志。",
        inactiveWindowMessage: "当前窗口未激活，先点击 Lime 窗口后再复制日志。",
      });
      toast.success("OpenClaw 纯日志已复制。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制纯日志失败。");
    }
  }, [openClawRawLogsText]);

  const handleCopyOpenClawDiagnosticBundle = useCallback(async () => {
    try {
      await copyTextToClipboard(openClawDiagnosticBundleJson, {
        fallbackErrorMessage: "复制 OpenClaw JSON 诊断包失败，请重试。",
        permissionDeniedMessage:
          "剪贴板权限被系统拒绝，请先点击 Lime 窗口后重试复制诊断包。",
        inactiveWindowMessage:
          "当前窗口未激活，先点击 Lime 窗口后再复制诊断包。",
      });
      toast.success("OpenClaw JSON 诊断包已复制。");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "复制 JSON 诊断包失败。",
      );
    }
  }, [openClawDiagnosticBundleJson]);

  const handleCopyRecentOperationLogs = useCallback(async () => {
    const rawLogsText = recentOperation?.rawLogsText?.trim();
    if (!rawLogsText) {
      toast.error("当前没有可复制的历史日志。");
      return;
    }

    try {
      await copyTextToClipboard(rawLogsText, {
        fallbackErrorMessage: "复制历史日志失败，请重试。",
        permissionDeniedMessage:
          "剪贴板权限被系统拒绝，请先点击 Lime 窗口后重试复制历史日志。",
        inactiveWindowMessage:
          "当前窗口未激活，先点击 Lime 窗口后再复制历史日志。",
      });
      toast.success("历史日志已复制。");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "复制历史日志失败。",
      );
    }
  }, [recentOperation?.rawLogsText]);

  const handleCopyRecentOperationDiagnosticBundle = useCallback(async () => {
    const diagnosticBundleJson = recentOperation?.diagnosticBundleJson?.trim();
    if (!diagnosticBundleJson) {
      toast.error("当前没有可复制的历史诊断包。");
      return;
    }

    try {
      await copyTextToClipboard(diagnosticBundleJson, {
        fallbackErrorMessage: "复制历史诊断包失败，请重试。",
        permissionDeniedMessage:
          "剪贴板权限被系统拒绝，请先点击 Lime 窗口后重试复制历史诊断包。",
        inactiveWindowMessage:
          "当前窗口未激活，先点击 Lime 窗口后再复制历史诊断包。",
      });
      toast.success("历史诊断包已复制。");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "复制历史诊断包失败。",
      );
    }
  }, [recentOperation?.diagnosticBundleJson]);

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
          if (softInstalled) {
            return { label: "可继续", tone: "active" };
          }
          return { label: "待安装", tone: "idle" };
        case "sync":
          if (!openclawWorkflowReady) {
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
          if (!openclawWorkflowReady) {
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
      openclawWorkflowReady,
      lastSynced,
      operationState.kind,
      operationState.running,
      softInstalled,
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
        return softInstalled
          ? "当前运行中的 Gateway 或已识别到版本表明 OpenClaw 已可用，但命令解析仍未完全对齐。你可以继续下一步，后续再修正执行环境。"
          : environmentStatus?.summary ||
              "先确认 Node.js、Git 与 OpenClaw 本体状态，再决定是否执行一键修复。";
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
        if (versionMismatch) {
          return `新版本已经安装到 ${installedVersion || "当前环境"}，但 Gateway 仍在运行 ${runningVersion || "旧版本"}。重启 Gateway 后，桌面面板和 Dashboard 才会切到新版本。`;
        }
        if (updateRuntimeRequiresSwitch && recommendedUpdateRuntimeCandidate) {
          return `当前执行环境没有检测到 OpenClaw。智能升级时，Lime 会先切到 ${formatRuntimeCandidateOpenClawSummary(
            recommendedUpdateRuntimeCandidate,
          )}，再继续升级。`;
        }
        return gatewayRunning
          ? "Gateway 已准备就绪，可以直接打开桌面面板，或进入 Dashboard 访问页进一步检查地址与 token。"
          : "这里集中处理启动、停止、重启与健康检查。启动前如未同步模型，请先回到配置页。";
      case "dashboard":
        if (versionMismatch) {
          return `已安装 ${installedVersion || "新版本"}，但当前 Dashboard 仍连接到运行中的 ${runningVersion || "旧版本"}。先重启 Gateway，再重新打开桌面面板。`;
        }
        if (updateRuntimeRequiresSwitch && recommendedUpdateRuntimeCandidate) {
          return `已检测到更合适的执行环境 ${formatRuntimeCandidateOpenClawSummary(
            recommendedUpdateRuntimeCandidate,
          )}。智能升级时，Lime 会自动切换过去。`;
        }
        return "通过桌面面板或系统浏览器访问 OpenClaw Dashboard，并在这里确认地址、token 与面板状态。";
      default:
        return "统一管理 OpenClaw 的安装、模型同步、Gateway 运行与 Dashboard 访问。";
    }
  }, [
    currentSubpage,
    environmentStatus?.summary,
    gatewayRunning,
    installedVersion,
    operationState.description,
    operationState.running,
    recommendedUpdateRuntimeCandidate,
    runningVersion,
    softInstalled,
    statusResolved,
    updateRuntimeRequiresSwitch,
    versionMismatch,
  ]);

  const summaryCards = useMemo<
    Array<{
      key: string;
      title: string;
      value: string;
      description: string;
      descriptionTitle?: string;
      icon: LucideIcon;
      iconClassName: string;
      valueClassName?: string;
    }>
  >(
    () => [
      {
        key: "setup",
        title: "安装环境",
        value: installed
          ? "已安装"
          : softInstalled
            ? "可继续"
            : operationState.running
              ? "处理中"
              : "待安装",
        descriptionTitle:
          environmentStatus?.openclaw.path ||
          currentRuntimeCandidate?.openclawPath ||
          currentRuntimeCandidate?.openclawPackagePath ||
          undefined,
        description:
          environmentStatus?.openclaw.path ||
          currentRuntimeCandidate?.openclawPath ||
          currentRuntimeCandidate?.openclawPackagePath
            ? compactPathLabel(
                environmentStatus?.openclaw.path ||
                  currentRuntimeCandidate?.openclawPath ||
                  currentRuntimeCandidate?.openclawPackagePath,
                54,
              )
            : "等待检测安装路径",
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
        description: dashboardUrl
          ? "Dashboard 地址已生成"
          : "等待生成 Dashboard 地址",
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
      currentRuntimeCandidate?.openclawPackagePath,
      currentRuntimeCandidate?.openclawPath,
      selectedModelId,
      selectedProvider?.label,
      softInstalled,
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
        runtimeCandidates={runtimeCandidates}
        preferredRuntimeId={preferredRuntimeId}
        desktopPlatform={desktopPlatform}
        busy={operationState.running || switchingRuntime}
        switchingRuntime={switchingRuntime}
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
        onSelectPreferredRuntime={(runtimeId) =>
          void handleSelectPreferredRuntime(runtimeId)
        }
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
  } else if (!openclawWorkflowReady) {
    pageContent = (
      <OpenClawInstallPage
        environmentStatus={environmentStatus}
        runtimeCandidates={runtimeCandidates}
        preferredRuntimeId={preferredRuntimeId}
        desktopPlatform={desktopPlatform}
        busy={operationState.running || switchingRuntime}
        switchingRuntime={switchingRuntime}
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
        onSelectPreferredRuntime={(runtimeId) =>
          void handleSelectPreferredRuntime(runtimeId)
        }
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
        updateInfo={updateInfo}
        installedVersion={installedVersion}
        runningVersion={runningVersion}
        versionMismatch={versionMismatch}
        updateRuntimeNotice={updateRuntimeNotice}
        runtimeCandidates={runtimeCandidates}
        preferredRuntimeId={preferredRuntimeId}
        channelCount={channels.length}
        startReady={hasSelectedConfig || !!lastSynced}
        canStart={canStartGateway}
        canStop={canStopGateway}
        canRestart={canRestartGateway}
        starting={starting}
        stopping={stopping}
        restarting={operationState.running && operationState.kind === "restart"}
        checkingHealth={checkingHealth}
        checkingUpdate={checkingUpdate}
        switchingRuntime={switchingRuntime}
        updating={updating}
        dashboardWindowOpen={dashboardWindowOpen}
        dashboardWindowBusy={dashboardWindowBusy}
        recentOperationLabel={
          recentOperation ? openClawOperationLabel(recentOperation.kind) : null
        }
        recentOperationMessage={recentOperation?.message || null}
        recentOperationUpdatedAt={recentOperation?.updatedAt || null}
        recentOperationSucceeded={
          recentOperation ? recentOperation.success : null
        }
        recentLogCount={recentOperation?.logs.length || 0}
        onStart={() => void handleStart()}
        onStop={() => void handleStop()}
        onRestart={() => void handleRestart()}
        onOpenDashboard={() => void handleOpenDashboardWindow()}
        onOpenDashboardPage={() => navigateSubpage("dashboard")}
        onBackToConfigure={() => navigateSubpage("configure")}
        onCheckHealth={() => void handleCheckHealth()}
        onCheckUpdate={() => void handleCheckUpdate()}
        onUpdate={() => void handlePerformUpdate()}
        onUseRecommendedUpdateRuntime={() =>
          void handleUseRecommendedUpdateRuntime()
        }
        onSelectPreferredRuntime={(runtimeId) =>
          void handleSelectPreferredRuntime(runtimeId)
        }
        onOpenRecentLogs={() => void handleOpenRecentOperationLogsPage()}
        onCopyRecentLogs={() => void handleCopyRecentOperationLogs()}
        onCopyRecentDiagnosticBundle={() =>
          void handleCopyRecentOperationDiagnosticBundle()
        }
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
          hasUpdate={Boolean(updateInfo?.hasUpdate)}
          latestVersion={updateInfo?.latestVersion}
          updating={updating}
          onBack={() => navigateSubpage("runtime")}
          onOpenExternal={() => void handleOpenDashboardExternal()}
          onOpenWindow={() => void handleOpenDashboardWindow()}
          onUpdate={() => void handlePerformUpdate()}
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
            <div className="relative flex flex-col gap-6 p-6 lg:p-8">
              <div className="space-y-4">
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
                    {installed
                      ? "环境已安装"
                      : softInstalled
                        ? "环境可继续"
                        : "环境待安装"}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="rounded-full border-slate-200 bg-white/75 px-3 py-1 text-slate-600"
                  >
                    Gateway {gatewayRunning ? "运行中" : gatewayStatus}
                  </Badge>
                </div>

                <div className="rounded-[24px] border border-slate-200/80 bg-white/82 p-4 shadow-sm shadow-slate-950/5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-3xl">
                      <p className="text-[11px] font-semibold tracking-[0.16em] text-slate-500">
                        REMOTE COMPAT
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        当前 remote 主入口已收口到消息渠道与浏览器连接器
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        OpenClaw 继续负责本地
                        Gateway、安装修复和兼容接入，适合处理环境准备、 Gateway
                        运行和本地兼容链路，而不是替代当前 remote 主入口。
                      </p>
                    </div>
                    {onNavigate ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={openClawSecondaryButtonClassName}
                          onClick={() => onNavigate("channels")}
                        >
                          去消息渠道
                        </button>
                        <button
                          type="button"
                          className={openClawSecondaryButtonClassName}
                          onClick={() =>
                            onNavigate("settings", {
                              tab: SettingsTabs.ChromeRelay,
                            })
                          }
                        >
                          去浏览器连接器
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <Tabs defaultValue="overview" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="overview">概览</TabsTrigger>
                  <TabsTrigger value="actions">快捷操作</TabsTrigger>
                  <TabsTrigger value="version">版本状态</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {summaryCards.map((card) => {
                      const CardIcon = card.icon;
                      return (
                        <div
                          key={card.key}
                          className="rounded-[22px] border border-white/90 bg-white/85 p-4 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-slate-800">
                                {card.title}
                              </p>
                              <p
                                className="mt-1 truncate text-xs leading-5 text-slate-500"
                                title={
                                  card.descriptionTitle ?? card.description
                                }
                              >
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
                </TabsContent>

                <TabsContent value="actions" className="mt-4">
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (gatewayRunning) {
                          void handleOpenDashboardWindow();
                          return;
                        }

                        navigateSubpage(
                          openclawWorkflowReady ? "runtime" : "install",
                        );
                      }}
                      disabled={gatewayRunning ? dashboardWindowBusy : false}
                      className={cn(
                        openClawPrimaryButtonClassName,
                        "px-4 py-2.5 text-sm shadow-sm",
                      )}
                    >
                      {gatewayRunning && dashboardWindowBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MonitorSmartphone className="h-4 w-4" />
                      )}
                      {gatewayRunning
                        ? dashboardWindowOpen
                          ? "聚焦桌面面板"
                          : "打开桌面面板"
                        : openclawWorkflowReady
                          ? "前往运行页"
                          : "进入安装环境"}
                    </button>
                    {(environmentStatus?.openclaw.status === "needs_reload" ||
                      !installed) && (
                      <button
                        type="button"
                        onClick={() => {
                          navigateSubpage("install");
                          void refreshAll();
                        }}
                        disabled={operationState.running || switchingRuntime}
                        className={cn(
                          openClawSecondaryButtonClassName,
                          "px-4 py-2.5 text-sm",
                        )}
                      >
                        <RefreshCw className="h-4 w-4" />
                        重新检测环境
                      </button>
                    )}
                    {updateInfo?.hasUpdate ? (
                      <button
                        type="button"
                        onClick={() => void handlePerformUpdate()}
                        disabled={operationState.running || switchingRuntime}
                        className={cn(
                          openClawPrimaryButtonClassName,
                          "px-4 py-2.5 text-sm shadow-sm",
                        )}
                      >
                        {updating ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowUpCircle className="h-4 w-4" />
                        )}
                        智能升级
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void refreshAll()}
                      className={cn(
                        openClawSecondaryButtonClassName,
                        "px-4 py-2.5 text-sm",
                      )}
                    >
                      <Sparkles className="h-4 w-4" />
                      刷新状态
                    </button>
                    <button
                      type="button"
                      onClick={() => void openUrl(OPENCLAW_DOCS_URL)}
                      className={cn(
                        openClawSecondaryButtonClassName,
                        "px-4 py-2.5 text-sm",
                      )}
                    >
                      查看文档
                    </button>
                  </div>
                </TabsContent>

                <TabsContent value="version" className="mt-4">
                  <div className="rounded-[24px] border border-white/90 bg-white/85 p-5 shadow-sm">
                    <div className="rounded-[18px] border border-slate-200/80 bg-slate-50/80 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold tracking-[0.12em] text-slate-500">
                            VERSION STATUS
                          </p>
                          <p
                            className={cn(
                              "mt-1 text-sm font-semibold",
                              versionMismatch
                                ? "text-amber-700"
                                : "text-slate-800",
                            )}
                          >
                            {versionStatusSummary.label}
                          </p>
                        </div>
                        {versionMismatch && canRestartGateway ? (
                          <button
                            type="button"
                            onClick={() => void handleRestart()}
                            disabled={operationState.running}
                            className={cn(
                              openClawSecondaryButtonClassName,
                              "px-3 py-2 text-xs",
                            )}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            立即重启生效
                          </button>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        {versionStatusSummary.description}
                      </p>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {versionMismatch ? (
                        <Badge className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700 shadow-none hover:bg-amber-50">
                          需重启 Gateway 才会切到新版本
                        </Badge>
                      ) : null}
                      {updateInfo?.hasUpdate ? (
                        <Badge
                          variant="outline"
                          className="rounded-full border-amber-200 bg-amber-50 px-3 py-1 text-amber-700"
                        >
                          可升级至 {updateInfo.latestVersion || "新版本"}
                        </Badge>
                      ) : null}
                      {updateRuntimeRequiresSwitch &&
                      recommendedUpdateRuntimeCandidate ? (
                        <Badge
                          variant="outline"
                          className="rounded-full border-sky-200 bg-sky-50 px-3 py-1 text-sky-700"
                        >
                          升级将自动切到{" "}
                          {formatRuntimeCandidateLabel(
                            recommendedUpdateRuntimeCandidate,
                          )}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
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
                    <div
                      className="mt-2 truncate text-sm leading-6 text-slate-700"
                      title={installedStatus?.path || undefined}
                    >
                      {installedStatus?.path
                        ? compactPathLabel(installedStatus.path, 52)
                        : "尚未检测到安装路径"}
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
