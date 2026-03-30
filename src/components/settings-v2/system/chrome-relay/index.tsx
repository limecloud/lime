import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Bug,
  Copy,
  ExternalLink,
  FolderOpen,
  Globe,
  Layers3,
  Link2,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getConfig } from "@/lib/api/appConfig";
import { openPathWithDefaultApp } from "@/lib/api/fileSystem";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  browserExecuteAction,
  chromeBridgeExecuteCommand,
  disconnectBrowserConnectorSession,
  getBrowserConnectorInstallStatus,
  getBrowserConnectorSettings,
  closeChromeProfileSession,
  getBrowserBackendPolicy,
  getBrowserBackendsStatus,
  getChromeBridgeEndpointInfo,
  getChromeBridgeStatus,
  getChromeProfileSessions,
  installBrowserConnectorExtension,
  launchBrowserSession,
  openBrowserExtensionsPage,
  openBrowserRemoteDebuggingPage,
  openBrowserRuntimeDebuggerWindow,
  openChromeProfileWindow,
  setBrowserActionCapabilityEnabled,
  setBrowserConnectorEnabled,
  setBrowserConnectorInstallRoot,
  setBrowserBackendPolicy,
  setSystemConnectorEnabled,
  type BrowserActionCapabilitySnapshot,
  type BrowserConnectorInstallStatus,
  type BrowserConnectorSettingsSnapshot,
  type BrowserBackendPolicy,
  type BrowserBackendsStatusSnapshot,
  type BrowserBackendStatusItem,
  type BrowserBackendType,
  type ChromeBridgeEndpointInfo,
  type ChromeBridgeStatusSnapshot,
  type ChromeProfileSessionInfo,
  type SystemConnectorSnapshot,
} from "@/lib/webview-api";

type SearchEngine = "google" | "xiaohongshu";
type RelayPrimaryTab = "core" | "advanced";
type RelaySectionTab = "overview" | "profile" | "bridge" | "backend" | "debug";

interface SurfacePanelProps {
  icon: LucideIcon;
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
}

interface EngineDefinition {
  id: SearchEngine;
  label: string;
  description: string;
  settingsUrl: string;
  assistUrl: string;
  bridgeTestUrl: string;
  backendTestUrl: string;
  profileKey: string;
  settingsButtonLabel: string;
}

const SECONDARY_BUTTON_CLASS_NAME =
  "inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BUTTON_CLASS_NAME =
  "inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";
const SELECT_CLASS_NAME =
  "h-11 w-full rounded-[16px] border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200 sm:w-auto";
const PRIMARY_TABS_CLASS_NAME =
  "grid h-auto w-full grid-cols-2 gap-2 rounded-[20px] bg-slate-100/90 p-1";
const PRIMARY_TAB_TRIGGER_CLASS_NAME =
  "rounded-[16px] border border-transparent px-4 py-2.5 text-sm font-medium";
const SECTION_TABS_CLASS_NAME =
  "flex h-auto w-full flex-wrap justify-start gap-2 rounded-[20px] border border-slate-200/80 bg-slate-100/90 p-2 shadow-sm shadow-slate-950/5";
const SECTION_TAB_TRIGGER_CLASS_NAME =
  "rounded-full border px-4 py-2 text-sm font-medium";
const SECTION_TAB_BADGE_CLASS_NAME =
  "inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold";
const REMOTE_DEBUGGING_URL = "chrome://inspect/#remote-debugging";

const BrowserRuntimeDebugPanel = lazy(() =>
  import("@/features/browser-runtime").then((module) => ({
    default: module.BrowserRuntimeDebugPanel,
  })),
);

const ENGINE_ORDER: SearchEngine[] = ["google", "xiaohongshu"];
const ENGINE_DEFINITIONS: Record<SearchEngine, EngineDefinition> = {
  google: {
    id: "google",
    label: "Google",
    description: "独立 Profile 用于搜索偏好、语言和地区设置。",
    settingsUrl: "https://www.google.com/preferences?hl=zh-CN",
    assistUrl: "https://www.google.com/search?q=lime+browser+assist",
    bridgeTestUrl: "https://www.google.com/search?q=lime",
    backendTestUrl: "https://www.google.com/search?q=lime+browser+backend",
    profileKey: "search_google",
    settingsButtonLabel: "打开 Google 设置",
  },
  xiaohongshu: {
    id: "xiaohongshu",
    label: "小红书",
    description: "独立 Profile 用于账号登录、内容浏览和扩展桥接。",
    settingsUrl: "https://www.xiaohongshu.com/explore",
    assistUrl: "https://www.xiaohongshu.com/explore",
    bridgeTestUrl: "https://www.xiaohongshu.com/explore",
    backendTestUrl: "https://www.xiaohongshu.com/explore",
    profileKey: "search_xiaohongshu",
    settingsButtonLabel: "打开小红书设置",
  },
};

const BACKEND_OPTIONS: BrowserBackendType[] = [
  "aster_compat",
  "lime_extension_bridge",
  "cdp_direct",
];

const BACKEND_LABELS: Record<BrowserBackendType, string> = {
  aster_compat: "Aster 协议适配",
  lime_extension_bridge: "Lime 扩展桥接",
  cdp_direct: "CDP 直连",
};

const BACKEND_DESCRIPTIONS: Record<BrowserBackendType, string> = {
  aster_compat: "优先复用现有 Aster 兼容链路，适合需要兼容旧协议接入的场景。",
  lime_extension_bridge:
    "通过浏览器扩展回传页面信息并执行命令，适合人工观察和轻量控制。",
  cdp_direct: "直接走 Chrome DevTools Protocol，适合实时调试与会话接管。",
};

function createPolicyKey(policy: BrowserBackendPolicy | null) {
  if (!policy) {
    return "";
  }
  return `${policy.auto_fallback}:${policy.priority.join(",")}`;
}

function normalizePriority(priority: BrowserBackendType[]) {
  const merged: BrowserBackendType[] = [];
  for (const backend of priority) {
    if (BACKEND_OPTIONS.includes(backend) && !merged.includes(backend)) {
      merged.push(backend);
    }
  }

  for (const backend of BACKEND_OPTIONS) {
    if (!merged.includes(backend)) {
      merged.push(backend);
    }
  }

  return merged.slice(0, BACKEND_OPTIONS.length);
}

function SurfacePanel({
  icon: Icon,
  title,
  description,
  aside,
  children,
}: SurfacePanelProps) {
  return (
    <article className="min-w-0 rounded-[26px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Icon className="h-4 w-4 text-sky-600" />
            {title}
          </div>
          <p className="text-sm leading-6 text-slate-500">{description}</p>
        </div>
        {aside ? (
          <div className="flex flex-wrap items-center gap-2">{aside}</div>
        ) : null}
      </div>

      <div className="mt-5 min-w-0">{children}</div>
    </article>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "neutral" | "success" | "warning";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium",
        tone === "success" &&
          "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "neutral" && "border-slate-200 bg-white text-slate-500",
      )}
    >
      {children}
    </span>
  );
}

function DeferredPanelFallback({ label }: { label: string }) {
  return (
    <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm leading-6 text-slate-500">
      正在准备{label}...
    </div>
  );
}

function resolveBackendTone(item?: BrowserBackendStatusItem | null) {
  if (!item) {
    return "neutral" as const;
  }
  return item.available ? ("success" as const) : ("warning" as const);
}

function getSystemConnectorStatusTone(
  connector: Pick<SystemConnectorSnapshot, "available" | "authorization_status">,
) {
  if (!connector.available) {
    return "neutral" as const;
  }
  if (connector.authorization_status === "authorized") {
    return "success" as const;
  }
  return "warning" as const;
}

function getSystemConnectorStatusLabel(
  connector: Pick<SystemConnectorSnapshot, "available" | "authorization_status" | "enabled">,
) {
  if (!connector.available) {
    return "当前平台不支持";
  }
  if (connector.enabled && connector.authorization_status === "authorized") {
    return "已启用";
  }
  switch (connector.authorization_status) {
    case "authorized":
      return "已授权";
    case "denied":
      return "授权被拒绝";
    case "error":
      return "授权异常";
    default:
      return "等待授权";
  }
}

export function ChromeRelaySettings() {
  const [activeEngine, setActiveEngine] = useState<SearchEngine>("google");
  const [activePrimaryTab, setActivePrimaryTab] =
    useState<RelayPrimaryTab>("core");
  const [activeSectionTab, setActiveSectionTab] =
    useState<RelaySectionTab>("overview");
  const [openingEngine, setOpeningEngine] = useState<SearchEngine | null>(null);
  const [closingProfileKey, setClosingProfileKey] = useState<string | null>(
    null,
  );
  const [refreshingSessions, setRefreshingSessions] = useState(false);
  const [refreshingBridge, setRefreshingBridge] = useState(false);
  const [refreshingBackends, setRefreshingBackends] = useState(false);
  const [savingBackendPolicy, setSavingBackendPolicy] = useState(false);
  const [testingBackend, setTestingBackend] =
    useState<BrowserBackendType | null>(null);
  const [testingBridgeEngine, setTestingBridgeEngine] =
    useState<SearchEngine | null>(null);
  const [launchingAssist, setLaunchingAssist] = useState(false);
  const [openingDebugger, setOpeningDebugger] = useState(false);
  const [sessions, setSessions] = useState<ChromeProfileSessionInfo[]>([]);
  const [bridgeEndpoint, setBridgeEndpoint] =
    useState<ChromeBridgeEndpointInfo | null>(null);
  const [bridgeStatus, setBridgeStatus] =
    useState<ChromeBridgeStatusSnapshot | null>(null);
  const [backendPolicy, setBackendPolicy] =
    useState<BrowserBackendPolicy | null>(null);
  const [draftBackendPolicy, setDraftBackendPolicy] =
    useState<BrowserBackendPolicy | null>(null);
  const [backendsStatus, setBackendsStatus] =
    useState<BrowserBackendsStatusSnapshot | null>(null);
  const [runtimeSessionId, setRuntimeSessionId] = useState<string | null>(null);
  const [browserConnectorSettings, setBrowserConnectorSettings] =
    useState<BrowserConnectorSettingsSnapshot | null>(null);
  const [browserConnectorInstallStatus, setBrowserConnectorInstallStatus] =
    useState<BrowserConnectorInstallStatus | null>(null);
  const [refreshingConnectorSettings, setRefreshingConnectorSettings] =
    useState(false);
  const [refreshingConnectorInstallStatus, setRefreshingConnectorInstallStatus] =
    useState(false);
  const [installingConnector, setInstallingConnector] = useState(false);
  const [savingConnectorEnabled, setSavingConnectorEnabled] = useState(false);
  const [openingExtensionsPage, setOpeningExtensionsPage] = useState(false);
  const [openingRemoteDebuggingPage, setOpeningRemoteDebuggingPage] =
    useState(false);
  const [openingInstallDirectory, setOpeningInstallDirectory] = useState(false);
  const [disconnectingConnector, setDisconnectingConnector] = useState(false);
  const [updatingSystemConnectorId, setUpdatingSystemConnectorId] = useState<
    string | null
  >(null);
  const [
    updatingBrowserActionCapabilityKey,
    setUpdatingBrowserActionCapabilityKey,
  ] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const backendPolicyRef = useRef<BrowserBackendPolicy | null>(null);
  const draftBackendPolicyRef = useRef<BrowserBackendPolicy | null>(null);

  useEffect(() => {
    backendPolicyRef.current = backendPolicy;
  }, [backendPolicy]);

  useEffect(() => {
    draftBackendPolicyRef.current = draftBackendPolicy;
  }, [draftBackendPolicy]);

  const pushMessage = useCallback(
    (
      nextMessage: { type: "success" | "error"; text: string },
      timeout = 2500,
    ) => {
      setMessage(nextMessage);
      if (timeout > 0) {
        window.setTimeout(() => setMessage(null), timeout);
      }
    },
    [],
  );

  const refreshConnectorSettings = useCallback(
    async (silent: boolean) => {
      if (!silent) {
        setRefreshingConnectorSettings(true);
      }
      try {
        const next = await getBrowserConnectorSettings();
        setBrowserConnectorSettings(next);
      } catch (error) {
        if (!silent) {
          pushMessage({
            type: "error",
            text: `刷新连接器设置失败: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      } finally {
        if (!silent) {
          setRefreshingConnectorSettings(false);
        }
      }
    },
    [pushMessage],
  );

  const refreshConnectorInstallStatus = useCallback(
    async (silent: boolean) => {
      if (!silent) {
        setRefreshingConnectorInstallStatus(true);
      }
      try {
        const next = await getBrowserConnectorInstallStatus();
        setBrowserConnectorInstallStatus(next);
      } catch (error) {
        if (!silent) {
          pushMessage({
            type: "error",
            text: `刷新浏览器连接器安装状态失败: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      } finally {
        if (!silent) {
          setRefreshingConnectorInstallStatus(false);
        }
      }
    },
    [pushMessage],
  );

  const refreshSessions = useCallback(
    async (silent: boolean) => {
      if (!silent) {
        setRefreshingSessions(true);
      }
      try {
        const next = await getChromeProfileSessions();
        setSessions(next);
      } catch (error) {
        if (!silent) {
          pushMessage({
            type: "error",
            text: `刷新会话失败: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      } finally {
        if (!silent) {
          setRefreshingSessions(false);
        }
      }
    },
    [pushMessage],
  );

  const refreshBridgeStatus = useCallback(
    async (silent: boolean) => {
      if (!silent) {
        setRefreshingBridge(true);
      }
      try {
        const [endpoint, status] = await Promise.all([
          getChromeBridgeEndpointInfo(),
          getChromeBridgeStatus(),
        ]);
        setBridgeEndpoint(endpoint);
        setBridgeStatus(status);
      } catch (error) {
        if (!silent) {
          pushMessage({
            type: "error",
            text: `刷新扩展连接状态失败: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      } finally {
        if (!silent) {
          setRefreshingBridge(false);
        }
      }
    },
    [pushMessage],
  );

  const refreshBackendStatus = useCallback(
    async (silent: boolean) => {
      if (!silent) {
        setRefreshingBackends(true);
      }
      try {
        const [policy, status] = await Promise.all([
          getBrowserBackendPolicy(),
          getBrowserBackendsStatus(),
        ]);
        const normalizedPolicy: BrowserBackendPolicy = {
          auto_fallback: policy.auto_fallback,
          priority: normalizePriority(policy.priority),
        };
        const shouldSyncDraft =
          !draftBackendPolicyRef.current ||
          !backendPolicyRef.current ||
          createPolicyKey(draftBackendPolicyRef.current) ===
            createPolicyKey(backendPolicyRef.current);

        setBackendPolicy(normalizedPolicy);
        backendPolicyRef.current = normalizedPolicy;
        if (shouldSyncDraft) {
          setDraftBackendPolicy(normalizedPolicy);
          draftBackendPolicyRef.current = normalizedPolicy;
        }
        setBackendsStatus(status);
      } catch (error) {
        if (!silent) {
          pushMessage({
            type: "error",
            text: `刷新浏览器后端状态失败: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      } finally {
        if (!silent) {
          setRefreshingBackends(false);
        }
      }
    },
    [pushMessage],
  );

  const refreshAll = useCallback(
    async (silent: boolean) => {
      await Promise.all([
        refreshConnectorSettings(silent),
        refreshConnectorInstallStatus(silent),
        refreshSessions(silent),
        refreshBridgeStatus(silent),
        refreshBackendStatus(silent),
      ]);
    },
    [
      refreshBackendStatus,
      refreshBridgeStatus,
      refreshConnectorInstallStatus,
      refreshConnectorSettings,
      refreshSessions,
    ],
  );

  useEffect(() => {
    void getConfig()
      .then((config) => {
        const nextEngine = config.web_search?.engine;
        if (
          nextEngine === ENGINE_DEFINITIONS.google.id ||
          nextEngine === ENGINE_DEFINITIONS.xiaohongshu.id
        ) {
          setActiveEngine(nextEngine);
        }
      })
      .catch(() => {
        // ignore
      });

    void refreshAll(true);
    const timer = window.setInterval(() => {
      void refreshAll(true);
    }, 15000);

    return () => window.clearInterval(timer);
  }, [refreshAll]);

  const selectedEngine = ENGINE_DEFINITIONS[activeEngine];
  const sessionsByProfile = useMemo(
    () => new Map(sessions.map((session) => [session.profile_key, session])),
    [sessions],
  );
  const observersByProfile = useMemo(
    () =>
      new Map(
        (bridgeStatus?.observers ?? []).map((observer) => [
          observer.profile_key,
          observer,
        ]),
      ),
    [bridgeStatus?.observers],
  );
  const selectedSession =
    sessionsByProfile.get(selectedEngine.profileKey) ?? null;
  const hasObserverConnected = (bridgeStatus?.observer_count ?? 0) > 0;
  const hasBackendPolicyChanges =
    createPolicyKey(backendPolicy) !== createPolicyKey(draftBackendPolicy);
  const backendStatusList =
    backendsStatus?.backends ??
    BACKEND_OPTIONS.map((backend) => ({
      backend,
      available: false,
      reason: "等待状态拉取",
      capabilities: [],
    }));

  const openSearchSettingsWindow = useCallback(
    async (engine: SearchEngine) => {
      const target = ENGINE_DEFINITIONS[engine];
      try {
        setOpeningEngine(engine);
        const result = await openChromeProfileWindow({
          profile_key: target.profileKey,
          url: target.settingsUrl,
        });
        if (!result.success) {
          throw new Error(result.error || "创建窗口失败");
        }
        pushMessage({
          type: "success",
          text: result.reused
            ? `已复用 ${target.label} 会话 (PID ${result.pid ?? "-"})`
            : `已启动 ${target.label} 会话 (PID ${result.pid ?? "-"})`,
        });
        await refreshSessions(true);
      } catch (error) {
        pushMessage({
          type: "error",
          text: `打开设置窗口失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        setOpeningEngine(null);
      }
    },
    [pushMessage, refreshSessions],
  );

  const closeSession = useCallback(
    async (engine: SearchEngine) => {
      const target = ENGINE_DEFINITIONS[engine];
      setClosingProfileKey(target.profileKey);
      try {
        const closed = await closeChromeProfileSession(target.profileKey);
        pushMessage({
          type: closed ? "success" : "error",
          text: closed ? "会话已关闭" : "未找到运行中的会话",
        });
        await refreshSessions(true);
      } catch (error) {
        pushMessage({
          type: "error",
          text: `关闭会话失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        setClosingProfileKey(null);
      }
    },
    [pushMessage, refreshSessions],
  );

  const handleLaunchBrowserAssist = useCallback(async () => {
    try {
      setLaunchingAssist(true);
      const result = await launchBrowserSession({
        profile_key: selectedEngine.profileKey,
        url: selectedEngine.assistUrl,
        open_window: true,
        stream_mode: "both",
      });
      setRuntimeSessionId(result.session.session_id);
      pushMessage({
        type: "success",
        text: `浏览器协助已启动：${
          result.session.target_title ||
          result.session.target_url ||
          selectedEngine.assistUrl
        }`,
      });
      await refreshAll(true);
    } catch (error) {
      pushMessage({
        type: "error",
        text: `启动浏览器协助失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      setLaunchingAssist(false);
    }
  }, [pushMessage, refreshAll, selectedEngine]);

  const handleOpenDebuggerWindow = useCallback(async () => {
    try {
      setOpeningDebugger(true);
      await openBrowserRuntimeDebuggerWindow(
        runtimeSessionId
          ? { session_id: runtimeSessionId }
          : { profile_key: selectedEngine.profileKey },
      );
      pushMessage({
        type: "success",
        text: "已打开独立浏览器调试窗口",
      });
    } catch (error) {
      pushMessage({
        type: "error",
        text: `打开独立调试窗口失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      setOpeningDebugger(false);
    }
  }, [pushMessage, runtimeSessionId, selectedEngine.profileKey]);

  const chooseConnectorInstallRoot = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: browserConnectorSettings?.install_root_dir ?? undefined,
    });

    if (!selected || Array.isArray(selected)) {
      return null;
    }

    const next = await setBrowserConnectorInstallRoot(selected);
    setBrowserConnectorSettings(next);
    return selected;
  }, [browserConnectorSettings?.install_root_dir]);

  const handleInstallConnector = useCallback(
    async (forceChooseDirectory = false) => {
      try {
        setInstallingConnector(true);
        const installRootDir =
          forceChooseDirectory || !browserConnectorSettings?.install_root_dir
            ? await chooseConnectorInstallRoot()
            : browserConnectorSettings.install_root_dir;

        if (!installRootDir) {
          return;
        }

        const result = await installBrowserConnectorExtension({
          install_root_dir: installRootDir,
          profile_key: "default",
        });
        pushMessage({
          type: "success",
          text: `浏览器连接器已同步到 ${result.install_dir}`,
        });
        await Promise.all([
          refreshConnectorSettings(true),
          refreshConnectorInstallStatus(true),
          refreshBridgeStatus(true),
        ]);
      } catch (error) {
        pushMessage({
          type: "error",
          text: `安装浏览器连接器失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        setInstallingConnector(false);
      }
    },
    [
      browserConnectorSettings?.install_root_dir,
      chooseConnectorInstallRoot,
      pushMessage,
      refreshConnectorInstallStatus,
      refreshConnectorSettings,
      refreshBridgeStatus,
    ],
  );

  const handleSetConnectorEnabled = useCallback(
    async (checked: boolean) => {
      try {
        setSavingConnectorEnabled(true);
        const next = await setBrowserConnectorEnabled(checked);
        setBrowserConnectorSettings(next);
        await refreshConnectorInstallStatus(true);
        pushMessage({
          type: "success",
          text: checked
            ? "浏览器连接器已开启"
            : "浏览器连接器已关闭",
        });
      } catch (error) {
        pushMessage({
          type: "error",
          text: `更新浏览器连接器开关失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        setSavingConnectorEnabled(false);
      }
    },
    [pushMessage, refreshConnectorInstallStatus],
  );

  const handleOpenConnectorInstallDirectory = useCallback(async () => {
    const installDir = browserConnectorInstallStatus?.install_dir;
    if (!installDir) {
      pushMessage({
        type: "error",
        text: "尚未检测到已安装的浏览器连接器目录",
      });
      return;
    }

    try {
      setOpeningInstallDirectory(true);
      await openPathWithDefaultApp(installDir);
    } catch (error) {
      pushMessage({
        type: "error",
        text: `打开安装目录失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      setOpeningInstallDirectory(false);
    }
  }, [browserConnectorInstallStatus?.install_dir, pushMessage]);

  const handleOpenBrowserExtensionsPage = useCallback(async () => {
    try {
      setOpeningExtensionsPage(true);
      await openBrowserExtensionsPage();
    } catch (error) {
      pushMessage({
        type: "error",
        text: `打开 Chrome 扩展页面失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      setOpeningExtensionsPage(false);
    }
  }, [pushMessage]);

  const copyPlainText = useCallback(
    async (text: string, label: string) => {
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("当前环境不支持剪贴板写入");
        }
        await navigator.clipboard.writeText(text);
        pushMessage({
          type: "success",
          text: `${label} 已复制到剪贴板`,
        });
      } catch (error) {
        pushMessage({
          type: "error",
          text: `复制 ${label} 失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    },
    [pushMessage],
  );

  const handleOpenRemoteDebuggingPage = useCallback(async () => {
    try {
      setOpeningRemoteDebuggingPage(true);
      await openBrowserRemoteDebuggingPage();
    } catch (error) {
      pushMessage({
        type: "error",
        text: `打开 Chrome 远程调试页失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      setOpeningRemoteDebuggingPage(false);
    }
  }, [pushMessage]);

  const handleDisconnectBrowserConnector = useCallback(async () => {
    try {
      setDisconnectingConnector(true);
      const result = await disconnectBrowserConnectorSession();
      setBridgeStatus(result.status);
      pushMessage({
        type: "success",
        text:
          result.disconnected_observer_count > 0 ||
          result.disconnected_control_count > 0
            ? `已断开 ${result.disconnected_observer_count} 个扩展观察连接和 ${result.disconnected_control_count} 个控制连接`
            : "当前没有可断开的扩展连接",
      });
    } catch (error) {
      pushMessage({
        type: "error",
        text: `断开扩展连接失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      setDisconnectingConnector(false);
    }
  }, [pushMessage]);

  const handleSetSystemConnectorEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        setUpdatingSystemConnectorId(id);
        const next = await setSystemConnectorEnabled({ id, enabled });
        setBrowserConnectorSettings(next);
        const updatedConnector = next.system_connectors.find(
          (connector) => connector.id === id,
        );
        if (!updatedConnector) {
          return;
        }
        if (!enabled) {
          pushMessage({
            type: "success",
            text: `${updatedConnector.label} 已关闭`,
          });
          return;
        }
        if (
          updatedConnector.enabled &&
          updatedConnector.authorization_status === "authorized"
        ) {
          pushMessage({
            type: "success",
            text: `${updatedConnector.label} 已授权并启用`,
          });
          return;
        }
        pushMessage({
          type: "error",
          text:
            updatedConnector.last_error ||
            `${updatedConnector.label} 当前未获得系统授权`,
        });
      } catch (error) {
        pushMessage({
          type: "error",
          text: `更新系统连接器失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        setUpdatingSystemConnectorId(null);
      }
    },
    [pushMessage],
  );

  const handleSetBrowserActionCapabilityEnabled = useCallback(
    async (key: string, enabled: boolean) => {
      try {
        setUpdatingBrowserActionCapabilityKey(key);
        const next = await setBrowserActionCapabilityEnabled({ key, enabled });
        setBrowserConnectorSettings(next);
        await refreshBackendStatus(true);
        const updatedCapability = next.browser_action_capabilities?.find(
          (capability) => capability.key === key,
        );
        pushMessage({
          type: "success",
          text: updatedCapability
            ? `${updatedCapability.label} 已${enabled ? "开启" : "关闭"}`
            : `浏览器动作已${enabled ? "开启" : "关闭"}`,
        });
      } catch (error) {
        pushMessage({
          type: "error",
          text: `更新浏览器动作配置失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        setUpdatingBrowserActionCapabilityKey(null);
      }
    },
    [pushMessage, refreshBackendStatus],
  );

  const copyBridgeConfig = useCallback(
    async (profileKey: string, label: string) => {
      if (!bridgeEndpoint) {
        pushMessage({
          type: "error",
          text: "桥接端点尚未加载，无法复制配置",
        });
        return;
      }

      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("当前环境不支持剪贴板写入");
        }
        await navigator.clipboard.writeText(
          JSON.stringify(
            {
              serverUrl: `ws://${bridgeEndpoint.host}:${bridgeEndpoint.port}`,
              bridgeKey: bridgeEndpoint.bridge_key,
              profileKey,
            },
            null,
            2,
          ),
        );
        pushMessage({
          type: "success",
          text: `${label} 配置已复制到剪贴板`,
        });
      } catch (error) {
        pushMessage({
          type: "error",
          text: `复制扩展配置失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    },
    [bridgeEndpoint, pushMessage],
  );

  const testBridgeCommand = useCallback(
    async (engine: SearchEngine) => {
      if (!bridgeEndpoint?.server_running) {
        pushMessage({
          type: "error",
          text: "服务未运行，无法执行扩展桥接测试",
        });
        return;
      }
      if (!hasObserverConnected) {
        pushMessage({
          type: "error",
          text: "未检测到扩展 observer 连接，请先完成扩展接入",
        });
        return;
      }

      const target = ENGINE_DEFINITIONS[engine];
      try {
        setTestingBridgeEngine(engine);
        const result = await chromeBridgeExecuteCommand({
          profile_key: target.profileKey,
          command: "open_url",
          url: target.bridgeTestUrl,
          wait_for_page_info: true,
          timeout_ms: 45000,
        });
        if (!result.success) {
          throw new Error(result.error || "命令执行失败");
        }
        pushMessage({
          type: "success",
          text: `扩展桥接测试成功：${result.page_info?.title || "已打开目标页面"}`,
        });
        await refreshBridgeStatus(true);
      } catch (error) {
        pushMessage({
          type: "error",
          text: `扩展桥接测试失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        setTestingBridgeEngine(null);
      }
    },
    [
      bridgeEndpoint?.server_running,
      hasObserverConnected,
      pushMessage,
      refreshBridgeStatus,
    ],
  );

  const updateBackendPriority = useCallback(
    (index: number, backend: BrowserBackendType) => {
      setDraftBackendPolicy((prev) => {
        if (!prev) {
          return prev;
        }
        const next = [...prev.priority];
        next[index] = backend;
        return {
          ...prev,
          priority: normalizePriority(next),
        };
      });
    },
    [],
  );

  const saveBackendPolicy = useCallback(async () => {
    if (!draftBackendPolicy) {
      return;
    }

    setSavingBackendPolicy(true);
    try {
      const normalizedPolicy: BrowserBackendPolicy = {
        auto_fallback: draftBackendPolicy.auto_fallback,
        priority: normalizePriority(draftBackendPolicy.priority),
      };
      const saved = await setBrowserBackendPolicy(normalizedPolicy);
      const finalPolicy = {
        auto_fallback: saved.auto_fallback,
        priority: normalizePriority(saved.priority),
      };
      setBackendPolicy(finalPolicy);
      setDraftBackendPolicy(finalPolicy);
      pushMessage({
        type: "success",
        text: "浏览器后端策略已保存",
      });
      await refreshBackendStatus(true);
    } catch (error) {
      pushMessage({
        type: "error",
        text: `保存后端策略失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      setSavingBackendPolicy(false);
    }
  }, [draftBackendPolicy, pushMessage, refreshBackendStatus]);

  const testBackendAction = useCallback(
    async (backend: BrowserBackendType) => {
      const backendStatus = backendsStatus?.backends.find(
        (item) => item.backend === backend,
      );
      if (backendStatus && !backendStatus.available) {
        pushMessage({
          type: "error",
          text: `${BACKEND_LABELS[backend]} 当前不可用: ${
            backendStatus.reason || "缺少可用连接"
          }`,
        });
        return;
      }

      try {
        setTestingBackend(backend);
        const result = await browserExecuteAction({
          backend,
          profile_key: selectedEngine.profileKey,
          action: "navigate",
          args: {
            action: "goto",
            url: selectedEngine.backendTestUrl,
            wait_for_page_info: true,
          },
          timeout_ms: 45000,
        });
        if (!result.success) {
          throw new Error(result.error || "执行失败");
        }
        pushMessage({
          type: "success",
          text: `${BACKEND_LABELS[backend]} 测试成功`,
        });
        await Promise.all([
          refreshBridgeStatus(true),
          refreshBackendStatus(true),
        ]);
      } catch (error) {
        pushMessage({
          type: "error",
          text: `${BACKEND_LABELS[backend]} 测试失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        setTestingBackend(null);
      }
    },
    [
      backendsStatus?.backends,
      pushMessage,
      refreshBackendStatus,
      refreshBridgeStatus,
      selectedEngine,
    ],
  );

  const runtimeSummary = useMemo(
    () => ({
      runningProfiles: backendsStatus?.running_profile_count ?? 0,
      cdpAliveProfiles: backendsStatus?.cdp_alive_profile_count ?? 0,
      observerCount: bridgeStatus?.observer_count ?? 0,
      controlCount: bridgeStatus?.control_count ?? 0,
      pendingCommands: bridgeStatus?.pending_command_count ?? 0,
    }),
    [backendsStatus, bridgeStatus],
  );
  const browserActionCapabilityGroups = useMemo(() => {
    const items = browserConnectorSettings?.browser_action_capabilities ?? [];
    return {
      read: items.filter((item) => item.group === "read"),
      write: items.filter((item) => item.group === "write"),
    };
  }, [browserConnectorSettings?.browser_action_capabilities]);
  const connectedObserverProfiles = useMemo(() => {
    const labels = (bridgeStatus?.observers ?? [])
      .map((observer) => observer.profile_key?.trim() || "")
      .filter(Boolean);
    return Array.from(new Set(labels));
  }, [bridgeStatus?.observers]);

  const renderProfilePanel = (keyPrefix = "") => (
    <SurfacePanel
      icon={Globe}
      title="Profile 会话"
      description="为搜索和桥接准备独立浏览器 Profile。每个会话都可以单独打开、关闭，并观察当前调试端口。"
      aside={
        <StatusPill tone={selectedSession ? "success" : "neutral"}>
          当前查看 {selectedEngine.label}
        </StatusPill>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {ENGINE_ORDER.map((engine) => {
          const target = ENGINE_DEFINITIONS[engine];
          const session = sessionsByProfile.get(target.profileKey) ?? null;

          return (
            <div
              key={`${keyPrefix}${engine}`}
              className="flex h-full flex-col justify-between gap-5 rounded-[24px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_100%)] p-5"
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-slate-900">
                      {target.label}
                    </p>
                    <p className="text-sm leading-6 text-slate-500">
                      {target.description}
                    </p>
                  </div>
                  <StatusPill tone={session ? "success" : "warning"}>
                    {session ? "会话运行中" : "尚未启动"}
                  </StatusPill>
                </div>

                {session ? (
                  <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                    <div className="rounded-[18px] border border-slate-200/80 bg-white/90 p-3">
                      <p className="text-xs font-medium text-slate-500">
                        进程 / 来源
                      </p>
                      <p className="mt-2 font-medium text-slate-900">
                        PID {session.pid}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {session.browser_source}
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-slate-200/80 bg-white/90 p-3">
                      <p className="text-xs font-medium text-slate-500">
                        调试端口
                      </p>
                      <p className="mt-2 font-medium text-slate-900">
                        {session.remote_debugging_port}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Profile {session.profile_key}
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-slate-200/80 bg-white/90 p-3 sm:col-span-2">
                      <p className="text-xs font-medium text-slate-500">
                        最近页面
                      </p>
                      <p className="mt-2 break-all text-sm text-slate-700">
                        {session.last_url}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm leading-6 text-slate-500">
                    当前还没有运行中的独立会话。先打开设置窗口，或直接使用上方的一键浏览器协助。
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void openSearchSettingsWindow(engine)}
                  disabled={openingEngine === engine}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  <ExternalLink className="h-4 w-4" />
                  {openingEngine === engine
                    ? "打开中..."
                    : target.settingsButtonLabel}
                </button>
                <button
                  type="button"
                  onClick={() => void closeSession(engine)}
                  disabled={!session || closingProfileKey === target.profileKey}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  {closingProfileKey === target.profileKey
                    ? "关闭中..."
                    : "关闭会话"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </SurfacePanel>
  );

  const renderBackendPanel = () => (
    <SurfacePanel
      icon={Layers3}
      title="浏览器后端策略"
      description="统一编排 Aster 协议适配、扩展桥接与 CDP 直连，并决定失败时是否自动回退。"
    >
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">
                  默认测试目标
                </p>
                <p className="text-sm leading-6 text-slate-500">
                  该目标会用于后端测试和一键浏览器协助，减少多处切换。
                </p>
              </div>
              <select
                value={activeEngine}
                onChange={(event) =>
                  setActiveEngine(event.target.value as SearchEngine)
                }
                className={cn(SELECT_CLASS_NAME, "sm:min-w-[180px]")}
              >
                {ENGINE_ORDER.map((engine) => (
                  <option key={`relay-engine-${engine}`} value={engine}>
                    {ENGINE_DEFINITIONS[engine].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 flex flex-col gap-3 rounded-[20px] border border-slate-200/80 bg-white/85 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">自动回退</p>
                <p className="text-sm leading-6 text-slate-500">
                  当前后端失败时，自动切换到下一个优先级继续执行。
                </p>
              </div>
              <Switch
                aria-label="自动回退到下一后端"
                checked={draftBackendPolicy?.auto_fallback ?? true}
                onCheckedChange={(checked) =>
                  setDraftBackendPolicy((prev) =>
                    prev
                      ? {
                          ...prev,
                          auto_fallback: checked,
                        }
                      : prev,
                  )
                }
              />
            </div>
          </div>

          <div className="space-y-3">
            {[0, 1, 2].map((index) => {
              const selectedBackend =
                draftBackendPolicy?.priority[index] || BACKEND_OPTIONS[index];
              return (
                <div
                  key={`backend-priority-${index}`}
                  className="rounded-[22px] border border-slate-200/80 bg-white p-4"
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {`优先级 ${index + 1}`}
                      </p>
                      <p className="text-sm leading-6 text-slate-500">
                        {BACKEND_DESCRIPTIONS[selectedBackend]}
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <select
                        value={selectedBackend}
                        onChange={(event) =>
                          updateBackendPriority(
                            index,
                            event.target.value as BrowserBackendType,
                          )
                        }
                        className={cn(SELECT_CLASS_NAME, "sm:min-w-[220px]")}
                      >
                        {BACKEND_OPTIONS.map((option) => (
                          <option
                            key={`backend-option-${index}-${option}`}
                            value={option}
                          >
                            {BACKEND_LABELS[option]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void testBackendAction(selectedBackend)}
                        disabled={testingBackend === selectedBackend}
                        className={SECONDARY_BUTTON_CLASS_NAME}
                      >
                        {testingBackend === selectedBackend
                          ? "测试中..."
                          : "测试"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">当前可用性</p>
            <p className="text-sm leading-6 text-slate-500">
              后端状态来自运行时即时快照，用于判断当前是否具备可执行链路。
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {backendStatusList.map((item) => (
              <div
                key={`backend-status-${item.backend}`}
                className="rounded-[20px] border border-slate-200/80 bg-white/90 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">
                    {BACKEND_LABELS[item.backend]}
                  </p>
                  <StatusPill tone={resolveBackendTone(item)}>
                    {item.available ? "可用" : item.reason || "待检查"}
                  </StatusPill>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {item.reason || BACKEND_DESCRIPTIONS[item.backend]}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  能力:{" "}
                  {item.capabilities.length > 0
                    ? item.capabilities.join(" / ")
                    : "等待运行时返回"}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-[20px] border border-slate-200/80 bg-white/90 p-4 text-sm leading-6 text-slate-600">
            <p>
              Aster native-host:{" "}
              {backendsStatus?.aster_native_host_configured
                ? "已配置"
                : "未配置"}
            </p>
            <p>
              平台支持:{" "}
              {backendsStatus?.aster_native_host_supported ? "是" : "否"}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void saveBackendPolicy()}
              disabled={!hasBackendPolicyChanges || savingBackendPolicy}
              className={PRIMARY_BUTTON_CLASS_NAME}
            >
              {savingBackendPolicy ? "保存中..." : "保存后端策略"}
            </button>
            <button
              type="button"
              onClick={() => void refreshBackendStatus(false)}
              disabled={refreshingBackends}
              className={SECONDARY_BUTTON_CLASS_NAME}
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4",
                  refreshingBackends ? "animate-spin" : "",
                )}
              />
              刷新后端状态
            </button>
          </div>
        </div>
      </div>
    </SurfacePanel>
  );

  const renderBridgePanel = () => (
    <SurfacePanel
      icon={Sparkles}
      title="Chrome 扩展桥接"
      description="该桥接负责让浏览器扩展回传页面信息并接收控制命令，适合在独立 Profile 中补充观察与辅助执行。"
      aside={
        <StatusPill
          tone={bridgeEndpoint?.server_running ? "success" : "warning"}
        >
          {bridgeEndpoint?.server_running ? "桥接服务运行中" : "桥接服务未运行"}
        </StatusPill>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
            <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
              OBSERVER
            </p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
              {runtimeSummary.observerCount}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              扩展侧页面观察连接数，用于回传页面信息和心跳。
            </p>
          </div>
          <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
            <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
              CONTROL
            </p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
              {runtimeSummary.controlCount}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              控制通道连接数，用于命令转发与桥接调试。
            </p>
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">扩展接入信息</p>
            <p className="text-sm leading-6 text-slate-500">
              在目标 Chrome Profile 的扩展弹窗里填写以下 WebSocket 端点与 Bridge
              Key。
            </p>
          </div>

          {bridgeEndpoint ? (
            <div className="mt-4 rounded-[20px] border border-slate-200/80 bg-white/90 p-4">
              <div className="space-y-2 text-sm text-slate-600">
                <p className="break-all">
                  Observer WS: {bridgeEndpoint.observer_ws_url}
                </p>
                <p className="break-all">
                  Control WS: {bridgeEndpoint.control_ws_url}
                </p>
                <p className="break-all">
                  Bridge Key: {bridgeEndpoint.bridge_key}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {ENGINE_ORDER.map((engine) => (
                  <button
                    key={`copy-config-${engine}`}
                    type="button"
                    onClick={() =>
                      void copyBridgeConfig(
                        ENGINE_DEFINITIONS[engine].profileKey,
                        ENGINE_DEFINITIONS[engine].label,
                      )
                    }
                    className={SECONDARY_BUTTON_CLASS_NAME}
                  >
                    <Copy className="h-4 w-4" />
                    {`复制 ${ENGINE_DEFINITIONS[engine].label} 配置`}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-[20px] border border-dashed border-slate-200 bg-white/70 p-4 text-sm leading-6 text-slate-500">
              尚未获取到桥接端点信息，请先刷新状态或确认后端服务已经启动。
            </div>
          )}
        </div>

        <div className="space-y-3">
          {ENGINE_ORDER.map((engine) => {
            const observer =
              observersByProfile.get(ENGINE_DEFINITIONS[engine].profileKey) ??
              null;
            return (
              <div
                key={`observer-status-${engine}`}
                className="rounded-[20px] border border-slate-200/80 bg-white p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">
                    {ENGINE_DEFINITIONS[engine].label} observer
                  </p>
                  <StatusPill tone={observer ? "success" : "warning"}>
                    {observer ? observer.client_id : "未连接"}
                  </StatusPill>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {observer?.last_page_info?.title
                    ? `最近页面：${observer.last_page_info.title}`
                    : "尚未收到最近页面信息"}
                </p>
              </div>
            );
          })}
        </div>

        {!hasObserverConnected ? (
          <div className="rounded-[20px] border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm leading-6 text-amber-800">
            未检测到扩展 observer 连接。请在对应 Chrome Profile 安装并打开
            Lime Browser Bridge 扩展，然后填入上面的 Observer WS 与 Bridge
            Key。
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {ENGINE_ORDER.map((engine) => (
            <button
              key={`bridge-test-${engine}`}
              type="button"
              onClick={() => void testBridgeCommand(engine)}
              disabled={testingBridgeEngine === engine}
              className={SECONDARY_BUTTON_CLASS_NAME}
            >
              {testingBridgeEngine === engine
                ? "测试中..."
                : `测试 ${ENGINE_DEFINITIONS[engine].label} 扩展`}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void refreshBridgeStatus(false)}
            disabled={refreshingBridge}
            className={SECONDARY_BUTTON_CLASS_NAME}
          >
            <RefreshCw
              className={cn("h-4 w-4", refreshingBridge ? "animate-spin" : "")}
            />
            刷新扩展状态
          </button>
        </div>
      </div>
    </SurfacePanel>
  );

  const renderOverviewPanel = () => (
    <SurfacePanel
      icon={Sparkles}
      title="当前概览"
      description="把最常用的观察点和入口压缩在一屏内，详情再进入对应页签查看。"
    >
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <div className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.92)_100%)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Profile 会话
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                当前目标 {selectedEngine.label}
                ，可快速检查独立浏览器是否已启动。
              </p>
            </div>
            <StatusPill tone={selectedSession ? "success" : "warning"}>
              {selectedSession ? "已启动" : "未启动"}
            </StatusPill>
          </div>
          <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
            {runtimeSummary.runningProfiles}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            运行中的独立 Profile 数量
          </p>
          <button
            type="button"
            onClick={() => setActiveSectionTab("profile")}
            className={cn(SECONDARY_BUTTON_CLASS_NAME, "mt-4 w-full")}
          >
            查看 Profile 详情
          </button>
        </div>

        <div className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.92)_100%)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">扩展桥接</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                observer / control 连接情况决定扩展侧链路是否可用。
              </p>
            </div>
            <StatusPill tone={hasObserverConnected ? "success" : "warning"}>
              {hasObserverConnected ? "已连通" : "待接入"}
            </StatusPill>
          </div>
          <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
            {runtimeSummary.observerCount}/{runtimeSummary.controlCount}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            observer / control 当前连接数
          </p>
          <button
            type="button"
            onClick={() => setActiveSectionTab("bridge")}
            className={cn(SECONDARY_BUTTON_CLASS_NAME, "mt-4 w-full")}
          >
            查看桥接详情
          </button>
        </div>

        <div className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.92)_100%)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">后端策略</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                默认优先级与自动回退开关决定动作链路如何降级。
              </p>
            </div>
            <StatusPill
              tone={
                (draftBackendPolicy?.auto_fallback ?? true)
                  ? "success"
                  : "neutral"
              }
            >
              {(draftBackendPolicy?.auto_fallback ?? true)
                ? "自动回退开"
                : "自动回退关"}
            </StatusPill>
          </div>
          <p className="mt-4 text-sm font-medium text-slate-900">
            {(draftBackendPolicy?.priority ?? BACKEND_OPTIONS)
              .map((backend) => BACKEND_LABELS[backend])
              .join(" / ")}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            当前优先级顺序
          </p>
          <button
            type="button"
            onClick={() => setActiveSectionTab("backend")}
            className={cn(SECONDARY_BUTTON_CLASS_NAME, "mt-4 w-full")}
          >
            查看后端详情
          </button>
        </div>

        <div className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.92)_100%)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">实时调试</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                需要观察页面、接管输入或排查事件流时再进入调试页签。
              </p>
            </div>
            <StatusPill tone={runtimeSessionId ? "success" : "neutral"}>
              {runtimeSessionId ? "已有会话" : "按需进入"}
            </StatusPill>
          </div>
          <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
            {runtimeSummary.cdpAliveProfiles}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            当前可复用的 CDP 会话
          </p>
          <button
            type="button"
            onClick={() => setActiveSectionTab("debug")}
            className={cn(SECONDARY_BUTTON_CLASS_NAME, "mt-4 w-full")}
          >
            打开实时调试
          </button>
        </div>
      </div>
    </SurfacePanel>
  );

  const renderUsagePanel = () => (
    <SurfacePanel
      icon={Sparkles}
      title="使用建议"
      description="按这个顺序处理，页面状态会更稳定，也更容易复用到浏览器协助和实时调试。"
    >
      <div className="space-y-3">
        <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
          <p className="text-sm font-semibold text-slate-900">
            1. 先准备独立 Profile
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            先为 Google
            或小红书打开独立设置窗口，确认账号、语言与内容偏好已经稳定。
          </p>
        </div>
        <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
          <p className="text-sm font-semibold text-slate-900">
            2. 再接通扩展桥接
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            observer
            连上以后，扩展才会持续回传页面信息。这样排查桥接链路会更直观。
          </p>
        </div>
        <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
          <p className="text-sm font-semibold text-slate-900">
            3. 需要人工介入时再开调试窗口
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            顶部的独立调试窗口和底部实时调试面板都能复用当前目标 Profile，
            适合需要观察页面变化或临时接管输入的时刻。
          </p>
        </div>
      </div>
    </SurfacePanel>
  );

  const renderDebugPanel = () => (
    <SurfacePanel
      icon={Bug}
      title="浏览器实时调试"
      description="底部直接复用浏览器实时会话面板。适合观察事件流、查看画面并在必要时接管当前页面。"
    >
      <Suspense fallback={<DeferredPanelFallback label="浏览器实时调试" />}>
        <div className="min-w-0 overflow-x-auto">
          <BrowserRuntimeDebugPanel
            sessions={sessions}
            onMessage={(nextMessage) => setMessage(nextMessage)}
            showStandaloneWindowButton={false}
            initialProfileKey={selectedEngine.profileKey}
            initialSessionId={runtimeSessionId ?? undefined}
          />
        </div>
      </Suspense>
    </SurfacePanel>
  );

  const availableBackendCount = backendStatusList.filter(
    (item) => item.available,
  ).length;
  const connectorInstallStatusTone =
    browserConnectorInstallStatus?.status === "installed"
      ? "success"
      : browserConnectorInstallStatus?.status === "update_available"
        ? "warning"
        : "neutral";
  const connectorInstallStatusLabel =
    browserConnectorInstallStatus?.status === "installed"
      ? "已安装"
      : browserConnectorInstallStatus?.status === "update_available"
        ? "可更新"
        : browserConnectorInstallStatus?.status === "broken"
          ? "安装异常"
          : "未安装";
  const connectorEnabled = browserConnectorSettings?.enabled ?? true;
  const hasControlConnected = runtimeSummary.controlCount > 0;
  const hasCdpDirectAvailable = runtimeSummary.cdpAliveProfiles > 0;
  const visibleSystemConnectors = (browserConnectorSettings?.system_connectors ?? [])
    .filter((item) => item.visible !== false);
  const shouldShowSystemConnectors = visibleSystemConnectors.length > 0;
  const systemConnectorCount = visibleSystemConnectors.length;
  const enabledSystemConnectorCount =
    visibleSystemConnectors.filter((item) => item.enabled).length;
  const systemConnectorTitle = /mac/i.test(window.navigator.platform)
    ? "macOS 连接器"
    : "系统连接器";
  const connectorPrimaryActionLabel =
    browserConnectorInstallStatus?.status === "update_available"
      ? "同步更新扩展"
      : browserConnectorInstallStatus?.status === "installed"
        ? "重新同步扩展"
        : "选择目录并安装";

  const getSectionTabClassName = (tab: RelaySectionTab) =>
    cn(
      SECTION_TAB_TRIGGER_CLASS_NAME,
      activeSectionTab === tab
        ? "border-slate-900 bg-slate-900 text-white shadow-sm shadow-slate-950/15"
        : "border-transparent bg-white/70 text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-900",
    );

  const renderSectionTabLabel = (
    tab: RelaySectionTab,
    label: string,
    icon: LucideIcon,
    badge: string | number,
  ) => {
    const Icon = icon;
    const active = activeSectionTab === tab;

    return (
      <span className="inline-flex items-center gap-2">
        <Icon
          className={cn("h-4 w-4", active ? "text-white" : "text-slate-500")}
        />
        <span>{label}</span>
        <span
          className={cn(
            SECTION_TAB_BADGE_CLASS_NAME,
            active ? "bg-white/15 text-white" : "bg-slate-200 text-slate-600",
          )}
        >
          {badge}
        </span>
      </span>
    );
  };

  const getPrimaryTabClassName = (tab: RelayPrimaryTab) =>
    cn(
      PRIMARY_TAB_TRIGGER_CLASS_NAME,
      activePrimaryTab === tab
        ? "border-slate-900 bg-slate-900 text-white shadow-sm shadow-slate-950/15"
        : "bg-white text-slate-600 hover:border-slate-200 hover:text-slate-900",
    );

  return (
    <div className="min-w-0 space-y-6 pb-8">
      {message ? (
        <div
          className={cn(
            "flex items-center justify-between gap-4 rounded-[20px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50/90 text-emerald-700"
              : "border-rose-200 bg-rose-50/90 text-rose-700",
          )}
        >
          <span>{message.text}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="rounded-full border border-current/20 bg-white px-3 py-1.5 text-xs font-medium transition hover:bg-white/90"
          >
            关闭
          </button>
        </div>
      ) : null}

      <Tabs
        value={activePrimaryTab}
        onValueChange={(value) => setActivePrimaryTab(value as RelayPrimaryTab)}
        className="w-full"
      >
        <section className="rounded-[24px] border border-slate-200/80 bg-white p-2 shadow-sm shadow-slate-950/5">
          <TabsList className={PRIMARY_TABS_CLASS_NAME}>
            <TabsTrigger value="core" className={getPrimaryTabClassName("core")}>
              核心设置
            </TabsTrigger>
            <TabsTrigger
              value="advanced"
              className={getPrimaryTabClassName("advanced")}
            >
              高级工具
            </TabsTrigger>
          </TabsList>
        </section>

        <TabsContent value="core" className="mt-6 space-y-6">
          {activePrimaryTab === "core" ? (
            <>
          <section className="relative overflow-hidden rounded-[30px] border border-sky-200/70 bg-[linear-gradient(135deg,rgba(247,251,255,0.98)_0%,rgba(255,255,255,0.98)_48%,rgba(246,250,248,0.96)_100%)] shadow-sm shadow-slate-950/5">
            <div className="pointer-events-none absolute -left-16 top-[-48px] h-48 w-48 rounded-full bg-sky-200/25 blur-3xl" />
            <div className="pointer-events-none absolute right-[-52px] top-[-24px] h-52 w-52 rounded-full bg-emerald-200/25 blur-3xl" />

            <div className="relative flex flex-col gap-4 p-5 sm:p-6 lg:p-7">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                  连接器
                </h2>
                <p className="max-w-3xl text-sm leading-7 text-slate-600">
                  先安装扩展，再开启连接器。
                </p>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                <div className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-base font-semibold text-slate-900">
                        安装 Lime Browser Bridge
                      </p>
                      <p className="text-sm leading-6 text-slate-500">
                        选择安装目录，同步扩展文件，然后去 Chrome 扩展页加载已解压目录。
                      </p>
                    </div>
                    <StatusPill tone={connectorInstallStatusTone}>
                      {connectorInstallStatusLabel}
                    </StatusPill>
                  </div>

                  <div className="mt-4 rounded-[18px] border border-slate-200/80 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
                      安装目录
                    </p>
                    <p className="mt-2 break-all text-sm leading-6 text-slate-700">
                      {browserConnectorSettings?.install_dir ||
                        browserConnectorSettings?.install_root_dir ||
                        "尚未选择安装目录"}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      内置版本 {browserConnectorInstallStatus?.bundled_version ?? "-"}
                      {browserConnectorInstallStatus?.installed_version
                        ? `，已安装 ${browserConnectorInstallStatus.installed_version}`
                        : ""}
                    </p>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleInstallConnector(false)}
                      disabled={installingConnector}
                      className={PRIMARY_BUTTON_CLASS_NAME}
                    >
                      <FolderOpen className="h-4 w-4" />
                      {installingConnector ? "同步中..." : connectorPrimaryActionLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleInstallConnector(true)}
                      disabled={installingConnector}
                      className={SECONDARY_BUTTON_CLASS_NAME}
                    >
                      重新选择目录
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenConnectorInstallDirectory()}
                      disabled={
                        !browserConnectorInstallStatus?.install_dir ||
                        openingInstallDirectory
                      }
                      className={SECONDARY_BUTTON_CLASS_NAME}
                    >
                      <FolderOpen className="h-4 w-4" />
                      {openingInstallDirectory ? "打开中..." : "打开安装目录"}
                    </button>
                  </div>
                </div>

                <div className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-slate-900">
                      在 Chrome 中加载
                    </p>
                    <p className="text-sm leading-6 text-slate-500">
                      安装后打开 Chrome 扩展页，开启开发者模式，再加载已解压目录。
                    </p>
                  </div>

                  <div className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
                    <p>1. 打开 `chrome://extensions`。</p>
                    <p>2. 开启右上角“开发者模式”。</p>
                    <p>3. 选择刚同步出来的 `Lime Browser Connector` 目录。</p>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleOpenBrowserExtensionsPage()}
                      disabled={openingExtensionsPage}
                      className={SECONDARY_BUTTON_CLASS_NAME}
                    >
                      <Link2 className="h-4 w-4" />
                      {openingExtensionsPage ? "打开中..." : "打开 Chrome 扩展页"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void copyPlainText(
                          "chrome://extensions",
                          "chrome://extensions",
                        )
                      }
                      className={SECONDARY_BUTTON_CLASS_NAME}
                    >
                      <Copy className="h-4 w-4" />
                      复制扩展页地址
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-1">
            <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5 sm:p-6">
              <div className="flex flex-col gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold text-slate-900">
                      我的浏览器
                    </h3>
                    <p className="text-sm leading-6 text-slate-500">
                      开启后，Lime 可以复用当前浏览器做页面观察和基础操作。
                    </p>
                  </div>
                  <Switch
                    aria-label="开启浏览器连接器"
                    checked={connectorEnabled}
                    disabled={savingConnectorEnabled}
                    onCheckedChange={(checked) =>
                      void handleSetConnectorEnabled(checked)
                    }
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={connectorInstallStatusTone}>
                    {connectorInstallStatusLabel}
                  </StatusPill>
                  <StatusPill tone={connectorEnabled ? "success" : "neutral"}>
                    {connectorEnabled ? "连接器已开启" : "连接器已关闭"}
                  </StatusPill>
                </div>
              </div>

              <div className="space-y-4 pt-4">
                <div className="rounded-[22px] border border-slate-200/80 bg-slate-50 p-4">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-900">
                          当前 Chrome 扩展桥接
                        </p>
                        <p className="text-sm leading-6 text-slate-500">
                          {hasObserverConnected
                            ? `Lime 已连接当前 Chrome。当前共有 ${runtimeSummary.observerCount} 个观察连接、${runtimeSummary.controlCount} 个控制连接。`
                            : browserConnectorInstallStatus?.message ||
                              "先导出浏览器连接器到用户目录，再在 Chrome 扩展页加载已解压目录。"}
                        </p>
                        {hasObserverConnected ? (
                          <p className="text-xs leading-5 text-slate-500">
                            当前资料：
                            {connectedObserverProfiles.length > 0
                              ? connectedObserverProfiles.join("、")
                              : "当前 Chrome"}
                          </p>
                        ) : null}
                      </div>
                      <StatusPill
                        tone={hasObserverConnected ? "success" : "warning"}
                      >
                        {hasObserverConnected ? "已连接" : "待连接"}
                      </StatusPill>
                    </div>
                  </div>
                </div>

                {browserActionCapabilityGroups.read.length > 0 ||
                browserActionCapabilityGroups.write.length > 0 ? (
                  <div className="rounded-[22px] border border-slate-200/80 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">
                        动作配置
                      </p>
                      <p className="text-xs leading-5 text-slate-500">
                        关闭后不再分发到浏览器。
                      </p>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      {[
                        {
                          title: "读取权限",
                          items: browserActionCapabilityGroups.read,
                        },
                        {
                          title: "写入权限",
                          items: browserActionCapabilityGroups.write,
                        },
                      ]
                        .filter((section) => section.items.length > 0)
                        .map((section) => (
                        <div
                          key={section.title}
                          className="rounded-[18px] border border-slate-200/80 bg-slate-50 p-3"
                        >
                          <p className="text-xs font-semibold tracking-[0.12em] text-slate-500">
                            {section.title}
                          </p>
                          <div className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-[16px] border border-slate-200/80 bg-white">
                            {section.items.map(
                              (capability: BrowserActionCapabilitySnapshot) => (
                                <div
                                  key={capability.key}
                                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                                >
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-slate-900">
                                      {capability.label}
                                    </p>
                                  </div>
                                  <Switch
                                    aria-label={`切换${capability.label}`}
                                    checked={capability.enabled}
                                    disabled={
                                      updatingBrowserActionCapabilityKey ===
                                      capability.key
                                    }
                                    onCheckedChange={(checked) =>
                                      void handleSetBrowserActionCapabilityEnabled(
                                        capability.key,
                                        checked,
                                      )
                                    }
                                  />
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          </section>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="advanced" className="mt-6 space-y-6">
          {activePrimaryTab === "advanced" ? (
            <>
          <section
            className={cn(
              "grid gap-5",
              shouldShowSystemConnectors
                ? "xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]"
                : "xl:grid-cols-1",
            )}
          >
            <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-slate-900">
                  连接方式
                </h3>
                <p className="text-xs leading-5 text-slate-500">
                  常用优先扩展，调试再用 CDP。
                </p>
              </div>

              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                <div className="rounded-[20px] border border-emerald-200 bg-emerald-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        浏览器扩展
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        安装一次，长期自动连接。
                      </p>
                    </div>
                    <StatusPill
                      tone={hasObserverConnected && hasControlConnected ? "success" : "warning"}
                    >
                      {hasObserverConnected && hasControlConnected
                        ? "推荐"
                        : "待完成"}
                    </StatusPill>
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-slate-600">
                    <p>1. 打开 `chrome://extensions` 并开启开发者模式。</p>
                    <p>2. 加载 `Lime Browser Connector` 目录。</p>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleOpenBrowserExtensionsPage()}
                      disabled={openingExtensionsPage}
                      className={SECONDARY_BUTTON_CLASS_NAME}
                    >
                      <Link2 className="h-4 w-4" />
                      {openingExtensionsPage ? "打开中..." : "打开扩展页"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void copyPlainText(
                          "chrome://extensions",
                          "chrome://extensions",
                        )
                      }
                      className={SECONDARY_BUTTON_CLASS_NAME}
                    >
                      <Copy className="h-4 w-4" />
                      复制扩展页地址
                    </button>
                  </div>
                </div>

                <div className="rounded-[20px] border border-sky-200 bg-sky-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        CDP 直连
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        零扩展，适合临时调试和人工接管。
                      </p>
                    </div>
                    <StatusPill
                      tone={hasCdpDirectAvailable ? "success" : "warning"}
                    >
                      {hasCdpDirectAvailable ? "已就绪" : "待接入"}
                    </StatusPill>
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-slate-600">
                    <p>1. 打开 `chrome://inspect/#remote-debugging`。</p>
                    <p>2. 按需开启远程调试并允许本地连接。</p>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleOpenRemoteDebuggingPage()}
                      disabled={openingRemoteDebuggingPage}
                      className={SECONDARY_BUTTON_CLASS_NAME}
                    >
                      <ExternalLink className="h-4 w-4" />
                      {openingRemoteDebuggingPage ? "打开中..." : "打开远程调试页"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void copyPlainText(
                          REMOTE_DEBUGGING_URL,
                          "chrome://inspect/#remote-debugging",
                        )
                      }
                      className={SECONDARY_BUTTON_CLASS_NAME}
                    >
                      <Copy className="h-4 w-4" />
                      复制远程调试地址
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void copyBridgeConfig("default", "默认浏览器连接器")
                  }
                  disabled={!bridgeEndpoint}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  <Copy className="h-4 w-4" />
                  复制配置
                </button>
                <button
                  type="button"
                  onClick={() => void handleDisconnectBrowserConnector()}
                  disabled={!hasObserverConnected || disconnectingConnector}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  {disconnectingConnector ? "断开中..." : "断开已连接扩展"}
                </button>
              </div>
            </article>

            {shouldShowSystemConnectors ? (
              <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5 sm:p-6">
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold text-slate-900">
                      {systemConnectorTitle}
                    </h3>
                    <p className="text-sm leading-6 text-slate-500">
                      按需开启系统能力，把授权和系统访问集中放在这里。
                    </p>
                  </div>
                  <span className="text-sm font-medium text-slate-500">
                    {enabledSystemConnectorCount} / {systemConnectorCount} 已启用
                  </span>
                </div>

                <div className="divide-y divide-slate-100">
                  {visibleSystemConnectors.map((connector) => (
                    <div
                      key={connector.id}
                      className="flex items-center justify-between gap-4 py-4"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">
                            {connector.label}
                          </p>
                          <StatusPill tone={getSystemConnectorStatusTone(connector)}>
                            {getSystemConnectorStatusLabel(connector)}
                          </StatusPill>
                        </div>
                        <p className="text-sm leading-6 text-slate-500">
                          {connector.description}
                        </p>
                        {connector.capabilities.length > 0 ? (
                          <p className="text-xs leading-5 text-slate-500">
                            能力：{connector.capabilities.join(" / ")}
                          </p>
                        ) : null}
                        {connector.last_error ? (
                          <p className="text-xs text-rose-600">
                            {connector.last_error}
                          </p>
                        ) : null}
                      </div>
                      <Switch
                        aria-label={`切换${connector.label}`}
                        checked={connector.enabled}
                        disabled={
                          !connector.available ||
                          updatingSystemConnectorId === connector.id
                        }
                        onCheckedChange={(checked) =>
                          void handleSetSystemConnectorEnabled(
                            connector.id,
                            checked,
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              </article>
            ) : null}
          </section>

          <section className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-slate-900">
                  高级控制
                </h3>
                <p className="text-sm leading-6 text-slate-500">
                  这里集中放 Profile 会话、扩展桥接、后端策略和实时调试。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleLaunchBrowserAssist()}
                  disabled={launchingAssist}
                  className={PRIMARY_BUTTON_CLASS_NAME}
                >
                  <ExternalLink className="h-4 w-4" />
                  {launchingAssist ? "启动中..." : "一键启动浏览器协助"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleOpenDebuggerWindow()}
                  disabled={openingDebugger}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  <Bug className="h-4 w-4" />
                  {openingDebugger ? "打开中..." : "打开独立调试窗口"}
                </button>
                <button
                  type="button"
                  onClick={() => void refreshAll(false)}
                  disabled={
                    refreshingConnectorSettings ||
                    refreshingConnectorInstallStatus ||
                    refreshingSessions ||
                    refreshingBridge ||
                    refreshingBackends
                  }
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  <RefreshCw
                    className={cn(
                      "h-4 w-4",
                      refreshingConnectorSettings ||
                        refreshingConnectorInstallStatus ||
                        refreshingSessions ||
                        refreshingBridge ||
                        refreshingBackends
                        ? "animate-spin"
                        : "",
                    )}
                  />
                  刷新状态
                </button>
              </div>
            </div>

            <div className="mt-5">
              <Tabs
                value={activeSectionTab}
                onValueChange={(value) =>
                  setActiveSectionTab(value as RelaySectionTab)
                }
                className="w-full"
              >
                <TabsList className={SECTION_TABS_CLASS_NAME}>
                  <TabsTrigger
                    value="overview"
                    className={getSectionTabClassName("overview")}
                  >
                    {renderSectionTabLabel(
                      "overview",
                      "总览",
                      Sparkles,
                      runtimeSummary.pendingCommands,
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="profile"
                    className={getSectionTabClassName("profile")}
                  >
                    {renderSectionTabLabel(
                      "profile",
                      "Profile",
                      Globe,
                      runtimeSummary.runningProfiles,
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="bridge"
                    className={getSectionTabClassName("bridge")}
                  >
                    {renderSectionTabLabel(
                      "bridge",
                      "桥接",
                      Copy,
                      runtimeSummary.observerCount,
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="backend"
                    className={getSectionTabClassName("backend")}
                  >
                    {renderSectionTabLabel(
                      "backend",
                      "后端",
                      Layers3,
                      availableBackendCount,
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="debug"
                    className={getSectionTabClassName("debug")}
                  >
                    {renderSectionTabLabel(
                      "debug",
                      "调试",
                      Bug,
                      runtimeSummary.cdpAliveProfiles,
                    )}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-5 space-y-6">
                  {activeSectionTab === "overview" ? (
                    <>
                      {renderOverviewPanel()}
                      {renderUsagePanel()}
                    </>
                  ) : null}
                </TabsContent>

                <TabsContent value="profile" className="mt-5">
                  {activeSectionTab === "profile"
                    ? renderProfilePanel("profile-")
                    : null}
                </TabsContent>

                <TabsContent value="bridge" className="mt-5">
                  {activeSectionTab === "bridge" ? renderBridgePanel() : null}
                </TabsContent>

                <TabsContent value="backend" className="mt-5">
                  {activeSectionTab === "backend" ? renderBackendPanel() : null}
                </TabsContent>

                <TabsContent value="debug" className="mt-5">
                  {activeSectionTab === "debug" ? renderDebugPanel() : null}
                </TabsContent>
              </Tabs>
            </div>
          </section>
            </>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ChromeRelaySettings;
