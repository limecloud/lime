import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Globe, RefreshCw } from "lucide-react";
import { getConfig } from "@/lib/api/appConfig";
import {
  browserExecuteAction,
  chromeBridgeExecuteCommand,
  closeChromeProfileSession,
  getBrowserBackendPolicy,
  getBrowserBackendsStatus,
  getChromeBridgeEndpointInfo,
  getChromeBridgeStatus,
  getChromeProfileSessions,
  openChromeProfileWindow,
  setBrowserBackendPolicy,
  type BrowserBackendPolicy,
  type BrowserBackendsStatusSnapshot,
  type BrowserBackendType,
  type ChromeBridgeEndpointInfo,
  type ChromeBridgeStatusSnapshot,
  type ChromeProfileSessionInfo,
} from "@/lib/webview-api";

type SearchEngine = "google" | "xiaohongshu";

const GOOGLE_SETTINGS_URL = "https://www.google.com/preferences?hl=zh-CN";
const XIAOHONGSHU_SETTINGS_URL = "https://www.xiaohongshu.com/explore";
const GOOGLE_PROFILE_KEY = "search_google";
const XIAOHONGSHU_PROFILE_KEY = "search_xiaohongshu";
const BACKEND_OPTIONS: BrowserBackendType[] = [
  "aster_compat",
  "proxycast_extension_bridge",
  "cdp_direct",
];

const BACKEND_LABELS: Record<BrowserBackendType, string> = {
  aster_compat: "Aster 协议适配",
  proxycast_extension_bridge: "Proxycast 扩展桥接",
  cdp_direct: "CDP 直连",
};

export function ChromeRelaySettings() {
  const [testEngine, setTestEngine] = useState<SearchEngine>("google");
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
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const normalizePriority = (priority: BrowserBackendType[]) => {
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
  };

  useEffect(() => {
    void getConfig()
      .then((config) => {
        const engine = (config.web_search?.engine || "google") as SearchEngine;
        setTestEngine(engine);
      })
      .catch(() => {
        // ignore
      });

    void refreshSessions(true);
    void refreshBridgeStatus(true);
    void refreshBackendStatus(true);

    const timer = window.setInterval(() => {
      void refreshSessions(true);
      void refreshBridgeStatus(true);
      void refreshBackendStatus(true);
    }, 15000);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasBackendPolicyChanges = useMemo(() => {
    if (!backendPolicy || !draftBackendPolicy) return false;
    if (backendPolicy.auto_fallback !== draftBackendPolicy.auto_fallback)
      return true;
    return (
      backendPolicy.priority.join(",") !== draftBackendPolicy.priority.join(",")
    );
  }, [backendPolicy, draftBackendPolicy]);

  const hasObserverConnected = (bridgeStatus?.observer_count ?? 0) > 0;

  const refreshSessions = async (silent: boolean) => {
    if (!silent) setRefreshingSessions(true);
    try {
      const next = await getChromeProfileSessions();
      setSessions(next);
    } catch (error) {
      if (!silent) {
        setMessage({
          type: "error",
          text: `刷新会话失败: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } finally {
      if (!silent) setRefreshingSessions(false);
    }
  };

  const refreshBridgeStatus = async (silent: boolean) => {
    if (!silent) setRefreshingBridge(true);
    try {
      const [endpoint, status] = await Promise.all([
        getChromeBridgeEndpointInfo(),
        getChromeBridgeStatus(),
      ]);
      setBridgeEndpoint(endpoint);
      setBridgeStatus(status);
    } catch (error) {
      if (!silent) {
        setMessage({
          type: "error",
          text: `刷新扩展连接状态失败: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } finally {
      if (!silent) setRefreshingBridge(false);
    }
  };

  const refreshBackendStatus = async (silent: boolean) => {
    if (!silent) setRefreshingBackends(true);
    try {
      const [policy, status] = await Promise.all([
        getBrowserBackendPolicy(),
        getBrowserBackendsStatus(),
      ]);
      const normalizedPolicy: BrowserBackendPolicy = {
        auto_fallback: policy.auto_fallback,
        priority: normalizePriority(policy.priority),
      };
      setBackendPolicy(normalizedPolicy);
      setDraftBackendPolicy(normalizedPolicy);
      setBackendsStatus(status);
    } catch (error) {
      if (!silent) {
        setMessage({
          type: "error",
          text: `刷新浏览器后端状态失败: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } finally {
      if (!silent) setRefreshingBackends(false);
    }
  };

  const getProfileKey = (engine: SearchEngine) =>
    engine === "google" ? GOOGLE_PROFILE_KEY : XIAOHONGSHU_PROFILE_KEY;

  const getSessionByEngine = (engine: SearchEngine) => {
    const key = getProfileKey(engine);
    return sessions.find((session) => session.profile_key === key);
  };

  const getObserverByEngine = (engine: SearchEngine) => {
    const key = getProfileKey(engine);
    const observers = bridgeStatus?.observers || [];
    return (
      observers.find((observer) => observer.profile_key === key) ||
      observers.at(0) ||
      null
    );
  };

  const openSearchSettingsWindow = async (engine: SearchEngine) => {
    const profileKey = getProfileKey(engine);
    const panelConfig =
      engine === "google"
        ? {
            url: GOOGLE_SETTINGS_URL,
            profile_key: profileKey,
          }
        : {
            url: XIAOHONGSHU_SETTINGS_URL,
            profile_key: profileKey,
          };

    try {
      setOpeningEngine(engine);
      const result = await openChromeProfileWindow({
        profile_key: panelConfig.profile_key,
        url: panelConfig.url,
      });
      if (!result.success) {
        throw new Error(result.error || "创建窗口失败");
      }
      setMessage({
        type: "success",
        text: result.reused
          ? `已复用 ${engine === "google" ? "Google" : "小红书"} 会话 (PID ${result.pid ?? "-"})`
          : `已启动 ${engine === "google" ? "Google" : "小红书"} 会话 (PID ${result.pid ?? "-"})`,
      });
      setTimeout(() => setMessage(null), 2500);
      await refreshSessions(true);
    } catch (error) {
      console.error("打开独立设置窗口失败:", error);
      setMessage({
        type: "error",
        text: `打开设置窗口失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setOpeningEngine(null);
    }
  };

  const closeSession = async (engine: SearchEngine) => {
    const profileKey = getProfileKey(engine);
    setClosingProfileKey(profileKey);
    try {
      const closed = await closeChromeProfileSession(profileKey);
      setMessage({
        type: closed ? "success" : "error",
        text: closed ? "会话已关闭" : "未找到运行中的会话",
      });
      setTimeout(() => setMessage(null), 2500);
      await refreshSessions(true);
    } catch (error) {
      setMessage({
        type: "error",
        text: `关闭会话失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setClosingProfileKey(null);
    }
  };

  const testBridgeCommand = async (engine: SearchEngine) => {
    if (!bridgeEndpoint?.server_running) {
      setMessage({
        type: "error",
        text: "服务未运行，无法执行扩展桥接测试",
      });
      return;
    }
    if (!hasObserverConnected) {
      setMessage({
        type: "error",
        text: "未检测到扩展 observer 连接，请先在目标 Chrome Profile 安装并连接扩展",
      });
      return;
    }

    const url =
      engine === "google"
        ? "https://www.google.com/search?q=proxycast"
        : "https://www.xiaohongshu.com/explore";
    try {
      setTestingBridgeEngine(engine);
      const result = await chromeBridgeExecuteCommand({
        profile_key: getProfileKey(engine),
        command: "open_url",
        url,
        wait_for_page_info: true,
        timeout_ms: 45000,
      });
      if (!result.success) {
        throw new Error(result.error || "命令执行失败");
      }
      const pageTitle = result.page_info?.title || "未知页面";
      setMessage({
        type: "success",
        text: `扩展桥接测试成功：${pageTitle}`,
      });
      setTimeout(() => setMessage(null), 3000);
      await refreshBridgeStatus(true);
    } catch (error) {
      setMessage({
        type: "error",
        text: `扩展桥接测试失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setTestingBridgeEngine(null);
    }
  };

  const updateBackendPriority = (
    index: number,
    backend: BrowserBackendType,
  ) => {
    setDraftBackendPolicy((prev) => {
      if (!prev) return prev;
      const next = [...prev.priority];
      next[index] = backend;
      return {
        ...prev,
        priority: normalizePriority(next),
      };
    });
  };

  const saveBackendPolicy = async () => {
    if (!draftBackendPolicy) return;
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
      setMessage({ type: "success", text: "浏览器后端策略已保存" });
      setTimeout(() => setMessage(null), 2500);
      await refreshBackendStatus(true);
    } catch (error) {
      setMessage({
        type: "error",
        text: `保存后端策略失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setSavingBackendPolicy(false);
    }
  };

  const testBackendAction = async (backend: BrowserBackendType) => {
    const backendStatus = backendsStatus?.backends?.find(
      (item) => item.backend === backend,
    );
    if (backendStatus && !backendStatus.available) {
      setMessage({
        type: "error",
        text: `${BACKEND_LABELS[backend]} 当前不可用: ${
          backendStatus.reason || "缺少可用连接"
        }`,
      });
      return;
    }

    const url =
      testEngine === "google"
        ? "https://www.google.com/search?q=proxycast+browser+backend"
        : "https://www.xiaohongshu.com/explore";
    try {
      setTestingBackend(backend);
      const result = await browserExecuteAction({
        backend,
        profile_key: getProfileKey(testEngine),
        action: "navigate",
        args: {
          action: "goto",
          url,
          wait_for_page_info: true,
        },
        timeout_ms: 45000,
      });
      if (!result.success) {
        throw new Error(result.error || "执行失败");
      }
      setMessage({
        type: "success",
        text: `${BACKEND_LABELS[backend]} 测试成功`,
      });
      setTimeout(() => setMessage(null), 2500);
      await Promise.all([
        refreshBridgeStatus(true),
        refreshBackendStatus(true),
      ]);
    } catch (error) {
      setMessage({
        type: "error",
        text: `${BACKEND_LABELS[backend]} 测试失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      setTestingBackend(null);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl pb-20">
      {message && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            message.type === "error"
              ? "border-destructive bg-destructive/10 text-destructive"
              : "border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="rounded-lg border p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Chrome Relay 运行状态</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Profile 会话 {backendsStatus?.running_profile_count ?? 0} | CDP 可用{" "}
          {backendsStatus?.cdp_alive_profile_count ?? 0} | 扩展 observer{" "}
          {bridgeStatus?.observer_count ?? 0} | control{" "}
          {bridgeStatus?.control_count ?? 0}
        </p>
        <button
          type="button"
          onClick={() => {
            void refreshSessions(false);
            void refreshBridgeStatus(false);
            void refreshBackendStatus(false);
          }}
          disabled={
            refreshingSessions || refreshingBridge || refreshingBackends
          }
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${
              refreshingSessions || refreshingBridge || refreshingBackends
                ? "animate-spin"
                : ""
            }`}
          />
          刷新状态
        </button>
      </div>

      <div className="rounded-lg border p-5 space-y-3">
        <h3 className="text-sm font-medium">Google 搜索设置窗口</h3>
        <p className="text-xs text-muted-foreground">
          打开独立 Chrome Profile 窗口，配置 Google 语言、地区与搜索偏好。
        </p>
        {(() => {
          const session = getSessionByEngine("google");
          return session ? (
            <p className="text-xs text-muted-foreground">
              会话运行中 | PID {session.pid} | 来源 {session.browser_source} |
              调试端口 {session.remote_debugging_port}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">当前无运行中的会话</p>
          );
        })()}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openSearchSettingsWindow("google")}
            disabled={openingEngine === "google"}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            {openingEngine === "google" ? "打开中..." : "打开 Google 设置"}
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => closeSession("google")}
            disabled={
              !getSessionByEngine("google") ||
              closingProfileKey === GOOGLE_PROFILE_KEY
            }
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            {closingProfileKey === GOOGLE_PROFILE_KEY
              ? "关闭中..."
              : "关闭会话"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border p-5 space-y-3">
        <h3 className="text-sm font-medium">小红书设置窗口</h3>
        <p className="text-xs text-muted-foreground">
          打开独立 Chrome Profile 窗口，登录并配置小红书账号。
        </p>
        {(() => {
          const session = getSessionByEngine("xiaohongshu");
          return session ? (
            <p className="text-xs text-muted-foreground">
              会话运行中 | PID {session.pid} | 来源 {session.browser_source} |
              调试端口 {session.remote_debugging_port}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">当前无运行中的会话</p>
          );
        })()}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openSearchSettingsWindow("xiaohongshu")}
            disabled={openingEngine === "xiaohongshu"}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            {openingEngine === "xiaohongshu" ? "打开中..." : "打开小红书设置"}
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => closeSession("xiaohongshu")}
            disabled={
              !getSessionByEngine("xiaohongshu") ||
              closingProfileKey === XIAOHONGSHU_PROFILE_KEY
            }
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            {closingProfileKey === XIAOHONGSHU_PROFILE_KEY
              ? "关闭中..."
              : "关闭会话"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border p-5 space-y-3">
        <h3 className="text-sm font-medium">浏览器后端编排策略</h3>
        <p className="text-xs text-muted-foreground">
          统一调度 Aster 协议适配、扩展桥接和 CDP
          直连。支持按优先级执行并在失败时自动回退。
        </p>

        <div className="space-y-2">
          <label
            htmlFor="relay-test-engine"
            className="text-xs text-muted-foreground"
          >
            后端测试默认引擎
          </label>
          <select
            id="relay-test-engine"
            value={testEngine}
            onChange={(e) => setTestEngine(e.target.value as SearchEngine)}
            className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="google">Google</option>
            <option value="xiaohongshu">小红书</option>
          </select>
        </div>

        <div className="space-y-2">
          {[0, 1, 2].map((idx) => (
            <div
              className="flex items-center gap-2"
              key={`backend-priority-${idx}`}
            >
              <label className="text-xs text-muted-foreground w-16">{`优先级 ${idx + 1}`}</label>
              <select
                value={
                  draftBackendPolicy?.priority[idx] || BACKEND_OPTIONS[idx]
                }
                onChange={(e) =>
                  updateBackendPriority(
                    idx,
                    e.target.value as BrowserBackendType,
                  )
                }
                className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              >
                {BACKEND_OPTIONS.map((option) => (
                  <option key={`backend-option-${option}`} value={option}>
                    {BACKEND_LABELS[option]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  void testBackendAction(
                    (draftBackendPolicy?.priority[idx] ||
                      BACKEND_OPTIONS[idx]) as BrowserBackendType,
                  )
                }
                disabled={
                  testingBackend ===
                  (draftBackendPolicy?.priority[idx] || BACKEND_OPTIONS[idx])
                }
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
              >
                {testingBackend ===
                (draftBackendPolicy?.priority[idx] || BACKEND_OPTIONS[idx])
                  ? "测试中..."
                  : "测试"}
              </button>
            </div>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draftBackendPolicy?.auto_fallback ?? true}
            onChange={(e) =>
              setDraftBackendPolicy((prev) =>
                prev
                  ? {
                      ...prev,
                      auto_fallback: e.target.checked,
                    }
                  : prev,
              )
            }
          />
          自动回退到下一后端
        </label>

        <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs">
          {(backendsStatus?.backends || []).map((item) => (
            <p key={`backend-status-${item.backend}`}>
              {BACKEND_LABELS[item.backend]}:{" "}
              {item.available ? "可用" : "不可用"}
              {item.reason ? ` | ${item.reason}` : ""}
            </p>
          ))}
          <p>
            Aster native-host:{" "}
            {backendsStatus?.aster_native_host_configured ? "已配置" : "未配置"}
            {" | "}
            平台支持:{" "}
            {backendsStatus?.aster_native_host_supported ? "是" : "否"}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void saveBackendPolicy()}
            disabled={!hasBackendPolicyChanges || savingBackendPolicy}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            {savingBackendPolicy ? "保存中..." : "保存后端策略"}
          </button>
          <button
            type="button"
            onClick={() => void refreshBackendStatus(false)}
            disabled={refreshingBackends}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshingBackends ? "animate-spin" : ""}`}
            />
            刷新后端状态
          </button>
        </div>
      </div>

      <div className="rounded-lg border p-5 space-y-3">
        <h3 className="text-sm font-medium">Chrome 扩展桥接</h3>
        <p className="text-xs text-muted-foreground">
          该能力用于让浏览器扩展回传页面信息并接收控制命令。请在对应 Chrome
          Profile 安装扩展并连接 observer 地址。
        </p>
        <p className="text-xs text-muted-foreground">
          服务状态: {bridgeEndpoint?.server_running ? "运行中" : "未运行"} |
          observer 连接: {bridgeStatus?.observer_count ?? 0} | control 连接:{" "}
          {bridgeStatus?.control_count ?? 0} | 待处理命令:{" "}
          {bridgeStatus?.pending_command_count ?? 0}
        </p>
        {bridgeEndpoint && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs">
            <p className="break-all">
              Observer WS: {bridgeEndpoint.observer_ws_url}
            </p>
            <p className="break-all">
              Control WS: {bridgeEndpoint.control_ws_url}
            </p>
            <p className="break-all">Bridge Key: {bridgeEndpoint.bridge_key}</p>
            <div className="pt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const config = {
                    serverUrl: `ws://${bridgeEndpoint.host}:${bridgeEndpoint.port}`,
                    bridgeKey: bridgeEndpoint.bridge_key,
                    profileKey: "search_google",
                  };
                  navigator.clipboard.writeText(
                    JSON.stringify(config, null, 2),
                  );
                  setMessage({
                    type: "success",
                    text: "Google 配置已复制到剪贴板",
                  });
                  setTimeout(() => setMessage(null), 2000);
                }}
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
              >
                复制 Google 配置
              </button>
              <button
                type="button"
                onClick={() => {
                  const config = {
                    serverUrl: `ws://${bridgeEndpoint.host}:${bridgeEndpoint.port}`,
                    bridgeKey: bridgeEndpoint.bridge_key,
                    profileKey: "search_xiaohongshu",
                  };
                  navigator.clipboard.writeText(
                    JSON.stringify(config, null, 2),
                  );
                  setMessage({
                    type: "success",
                    text: "小红书配置已复制到剪贴板",
                  });
                  setTimeout(() => setMessage(null), 2000);
                }}
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
              >
                复制小红书配置
              </button>
            </div>
          </div>
        )}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            Google observer:{" "}
            {(() => {
              const observer = getObserverByEngine("google");
              return observer
                ? `${observer.client_id} | 最近页面: ${observer.last_page_info?.title || "无"}`
                : "未连接";
            })()}
          </p>
          <p>
            小红书 observer:{" "}
            {(() => {
              const observer = getObserverByEngine("xiaohongshu");
              return observer
                ? `${observer.client_id} | 最近页面: ${observer.last_page_info?.title || "无"}`
                : "未连接";
            })()}
          </p>
        </div>
        {!hasObserverConnected && (
          <div className="rounded-md border border-amber-400/40 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            未检测到扩展 observer 连接。请在对应 Chrome Profile 安装并打开
            Proxycast Browser Bridge 扩展，在扩展弹窗填写 Observer WS 与 Bridge
            Key 后再测试。
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => testBridgeCommand("google")}
            disabled={testingBridgeEngine === "google"}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            {testingBridgeEngine === "google"
              ? "测试中..."
              : "测试 Google 扩展"}
          </button>
          <button
            type="button"
            onClick={() => testBridgeCommand("xiaohongshu")}
            disabled={testingBridgeEngine === "xiaohongshu"}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            {testingBridgeEngine === "xiaohongshu"
              ? "测试中..."
              : "测试小红书扩展"}
          </button>
          <button
            type="button"
            onClick={() => refreshBridgeStatus(false)}
            disabled={refreshingBridge}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshingBridge ? "animate-spin" : ""}`}
            />
            刷新扩展状态
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChromeRelaySettings;
