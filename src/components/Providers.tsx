import { useState, useEffect } from "react";
import {
  Check,
  X,
  RefreshCw,
  FolderOpen,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Copy,
  FileText,
} from "lucide-react";
import {
  reloadCredentials,
  refreshKiroToken,
  getKiroCredentials,
  getEnvVariables,
  getTokenFileHash,
  checkAndReloadCredentials,
  // Gemini
  getGeminiCredentials,
  reloadGeminiCredentials,
  refreshGeminiToken,
  getGeminiEnvVariables,
  getGeminiTokenFileHash,
  checkAndReloadGeminiCredentials,
  // Qwen
  getQwenCredentials,
  reloadQwenCredentials,
  refreshQwenToken,
  getQwenEnvVariables,
  getQwenTokenFileHash,
  checkAndReloadQwenCredentials,
  // OpenAI/Claude Custom
  getOpenAICustomStatus,
  setOpenAICustomConfig,
  getClaudeCustomStatus,
  setClaudeCustomConfig,
  type ClaudeCustomStatus,
  type EnvVariable,
  type GeminiCredentialStatus,
  type KiroCredentialStatus,
  type OpenAICustomStatus,
  type QwenCredentialStatus,
} from "@/lib/api/providerRuntime";
import { getDefaultProvider, setDefaultProvider } from "@/lib/api/appConfig";
import { useProviderState } from "@/hooks/useProviderState";
import { useFileMonitoring } from "@/hooks/useFileMonitoring";

interface Provider {
  id: string;
  name: string;
  enabled: boolean;
  status: "connected" | "disconnected" | "error" | "loading";
  description: string;
}

const defaultProviders: Provider[] = [
  {
    id: "kiro",
    name: "Kiro Claude",
    enabled: true,
    status: "disconnected",
    description: "通过 Kiro OAuth 访问 Claude Sonnet 4.5",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    enabled: true,
    status: "disconnected",
    description: "通过 Gemini CLI OAuth 访问 Gemini 模型",
  },
  {
    id: "qwen",
    name: "通义千问",
    enabled: true,
    status: "disconnected",
    description: "通过 Qwen OAuth 访问通义千问",
  },
  {
    id: "openai",
    name: "OpenAI 自定义",
    enabled: false,
    status: "disconnected",
    description: "自定义 OpenAI 兼容 API",
  },
  {
    id: "claude",
    name: "Claude 自定义",
    enabled: false,
    status: "disconnected",
    description: "自定义 Claude API",
  },
];

export function Providers() {
  const [providers, setProviders] = useState<Provider[]>(defaultProviders);
  const [activeProvider, setActiveProvider] = useState<string>("kiro");

  // 使用 useProviderState hook 管理三个 OAuth providers
  const kiro = useProviderState<KiroCredentialStatus>("kiro", {
    getCredentials: getKiroCredentials,
    getEnvVars: getEnvVariables,
    getHash: getTokenFileHash,
    checkAndReload: checkAndReloadCredentials,
    reloadCredentials: reloadCredentials,
    refreshToken: refreshKiroToken,
  });

  const gemini = useProviderState<GeminiCredentialStatus>("gemini", {
    getCredentials: getGeminiCredentials,
    getEnvVars: getGeminiEnvVariables,
    getHash: getGeminiTokenFileHash,
    checkAndReload: checkAndReloadGeminiCredentials,
    reloadCredentials: reloadGeminiCredentials,
    refreshToken: refreshGeminiToken,
  });

  const qwen = useProviderState<QwenCredentialStatus>("qwen", {
    getCredentials: getQwenCredentials,
    getEnvVars: getQwenEnvVariables,
    getHash: getQwenTokenFileHash,
    checkAndReload: checkAndReloadQwenCredentials,
    reloadCredentials: reloadQwenCredentials,
    refreshToken: refreshQwenToken,
  });

  // OpenAI Custom state
  const [openaiStatus, setOpenaiStatus] = useState<OpenAICustomStatus | null>(
    null,
  );
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("");

  // Claude Custom state
  const [claudeStatus, setClaudeStatus] = useState<ClaudeCustomStatus | null>(
    null,
  );
  const [claudeApiKey, setClaudeApiKey] = useState("");
  const [claudeBaseUrl, setClaudeBaseUrl] = useState("");

  // Default provider state
  const [defaultProvider, setDefaultProviderState] = useState<string>("kiro");

  // Common state
  const [showEnv, setShowEnv] = useState(false);
  const [showValues, setShowValues] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // 使用 useFileMonitoring hook 自动监控文件变化
  useFileMonitoring({
    kiro: { checkFn: kiro.checkForChanges, interval: 5000 },
    gemini: { checkFn: gemini.checkForChanges, interval: 5000 },
    qwen: { checkFn: qwen.checkForChanges, interval: 5000 },
  });

  useEffect(() => {
    const init = async () => {
      // Load default provider
      try {
        const dp = await getDefaultProvider();
        setDefaultProviderState(dp);
      } catch (e) {
        console.error("Failed to get default provider:", e);
      }

      // 初始化加载所有 provider 状态
      await kiro.load();
      await gemini.load();
      await qwen.load();
      await loadOpenAICustomStatus();
      await loadClaudeCustomStatus();
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 更新 provider 列表状态
  useEffect(() => {
    if (kiro.status) {
      setProviders((prev) =>
        prev.map((p) =>
          p.id === "kiro"
            ? {
                ...p,
                status: kiro.status?.loaded ? "connected" : "disconnected",
              }
            : p,
        ),
      );
    }
  }, [kiro.status]);

  useEffect(() => {
    if (gemini.status) {
      setProviders((prev) =>
        prev.map((p) =>
          p.id === "gemini"
            ? {
                ...p,
                status: gemini.status?.loaded ? "connected" : "disconnected",
              }
            : p,
        ),
      );
    }
  }, [gemini.status]);

  useEffect(() => {
    if (qwen.status) {
      setProviders((prev) =>
        prev.map((p) =>
          p.id === "qwen"
            ? {
                ...p,
                status: qwen.status?.loaded ? "connected" : "disconnected",
              }
            : p,
        ),
      );
    }
  }, [qwen.status]);

  const loadOpenAICustomStatus = async () => {
    try {
      const status = await getOpenAICustomStatus();
      setOpenaiStatus(status);
      setOpenaiBaseUrl(status.base_url);
      setProviders((prev) =>
        prev.map((p) =>
          p.id === "openai"
            ? {
                ...p,
                status:
                  status.enabled && status.has_api_key
                    ? "connected"
                    : "disconnected",
                enabled: status.enabled,
              }
            : p,
        ),
      );
    } catch (e) {
      console.error("Failed to load OpenAI Custom status:", e);
    }
  };

  const loadClaudeCustomStatus = async () => {
    try {
      const status = await getClaudeCustomStatus();
      setClaudeStatus(status);
      setClaudeBaseUrl(status.base_url);
      setProviders((prev) =>
        prev.map((p) =>
          p.id === "claude"
            ? {
                ...p,
                status:
                  status.enabled && status.has_api_key
                    ? "connected"
                    : "disconnected",
                enabled: status.enabled,
              }
            : p,
        ),
      );
    } catch (e) {
      console.error("Failed to load Claude Custom status:", e);
    }
  };

  const handleLoadCredentials = async (provider: string) => {
    setMessage(null);
    try {
      if (provider === "kiro") {
        await kiro.reload();
        setMessage({ type: "success", text: "[Kiro] 凭证加载成功！" });
      } else if (provider === "gemini") {
        await gemini.reload();
        setMessage({ type: "success", text: "[Gemini] 凭证加载成功！" });
      } else if (provider === "qwen") {
        await qwen.reload();
        setMessage({ type: "success", text: "[Qwen] 凭证加载成功！" });
      }
    } catch (e: any) {
      setMessage({ type: "error", text: `加载失败: ${e.toString()}` });
    }
  };

  const handleRefreshToken = async (provider: string) => {
    setMessage(null);
    try {
      if (provider === "kiro") {
        await kiro.refresh();
        setMessage({ type: "success", text: "[Kiro] Token 刷新成功！" });
      } else if (provider === "gemini") {
        await gemini.refresh();
        setMessage({ type: "success", text: "[Gemini] Token 刷新成功！" });
      } else if (provider === "qwen") {
        await qwen.refresh();
        setMessage({ type: "success", text: "[Qwen] Token 刷新成功！" });
      }
    } catch (e: any) {
      setMessage({ type: "error", text: `刷新失败: ${e.toString()}` });
    }
  };

  const handleSaveOpenAIConfig = async () => {
    setLoading("save-openai");
    try {
      await setOpenAICustomConfig(
        openaiApiKey || null,
        openaiBaseUrl || null,
        true,
      );
      await loadOpenAICustomStatus();
      setMessage({ type: "success", text: "[OpenAI] 配置保存成功！" });
    } catch (e: any) {
      setMessage({ type: "error", text: `保存失败: ${e.toString()}` });
    }
    setLoading(null);
  };

  const handleSaveClaudeConfig = async () => {
    setLoading("save-claude");
    try {
      await setClaudeCustomConfig(
        claudeApiKey || null,
        claudeBaseUrl || null,
        true,
      );
      await loadClaudeCustomStatus();
      setMessage({ type: "success", text: "[Claude] 配置保存成功！" });
    } catch (e: any) {
      setMessage({ type: "error", text: `保存失败: ${e.toString()}` });
    }
    setLoading(null);
  };

  const toggleProvider = (id: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    );
  };

  const handleSetDefaultProvider = async (providerId: string) => {
    setLoading(`default-${providerId}`);
    try {
      await setDefaultProvider(providerId);
      setDefaultProviderState(providerId);
      setMessage({
        type: "success",
        text: `默认 Provider 已切换为: ${getProviderName(providerId)}`,
      });
    } catch (e: any) {
      setMessage({ type: "error", text: `切换失败: ${e.toString()}` });
    }
    setLoading(null);
  };

  const getProviderName = (id: string) => {
    switch (id) {
      case "kiro":
        return "Kiro Claude";
      case "gemini":
        return "Gemini CLI";
      case "qwen":
        return "通义千问";
      case "openai":
        return "OpenAI 自定义";
      case "claude":
        return "Claude 自定义";
      default:
        return id;
    }
  };

  const copyValue = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const copyAllEnv = (vars: EnvVariable[]) => {
    navigator.clipboard.writeText(
      vars.map((v) => `${v.key}=${v.value}`).join("\n"),
    );
    setCopied("all");
    setTimeout(() => setCopied(null), 2000);
  };

  const getStatusColor = (status: Provider["status"]) => {
    switch (status) {
      case "connected":
        return "bg-green-500";
      case "error":
        return "bg-red-500";
      case "loading":
        return "bg-yellow-500 animate-pulse";
      default:
        return "bg-gray-400";
    }
  };

  const formatTime = (date: Date | null) => {
    if (!date) return "从未同步";
    return date.toLocaleTimeString();
  };

  const currentEnvVars =
    activeProvider === "kiro"
      ? kiro.envVars
      : activeProvider === "gemini"
        ? gemini.envVars
        : qwen.envVars;

  const isAnyLoading = Boolean(
    kiro.loading || gemini.loading || qwen.loading || loading,
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Provider 管理</h2>
        <p className="text-muted-foreground">配置和管理 AI 模型提供商</p>
      </div>

      {message && (
        <div
          className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
            message.type === "success"
              ? "border-green-500 bg-green-50 text-green-700"
              : "border-red-500 bg-red-50 text-red-700"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {message.text}
        </div>
      )}

      {/* Provider Tabs */}
      <div className="flex gap-2 border-b overflow-x-auto">
        {["kiro", "gemini", "qwen", "openai", "claude"].map((id) => (
          <button
            key={id}
            onClick={() => setActiveProvider(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              activeProvider === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {id === "kiro"
              ? "Kiro Claude"
              : id === "gemini"
                ? "Gemini CLI"
                : id === "qwen"
                  ? "通义千问"
                  : id === "openai"
                    ? "OpenAI 自定义"
                    : "Claude 自定义"}
          </button>
        ))}
      </div>

      {/* Kiro Panel */}
      {activeProvider === "kiro" && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Kiro 凭证状态</h3>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                最后同步:{" "}
                <span className="text-foreground">
                  {formatTime(kiro.lastSync)}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                监测中
              </span>
            </div>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">凭证路径:</span>
              <code className="ml-2 rounded bg-muted px-2 py-0.5 text-xs break-all">
                {kiro.status?.creds_path ||
                  "~/.aws/sso/cache/kiro-auth-token.json"}
              </code>
            </div>
            <div>
              <span className="text-muted-foreground">区域:</span>
              <span className="ml-2">{kiro.status?.region || "未设置"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Access Token:</span>
              <span
                className={`ml-2 ${kiro.status?.has_access_token ? "text-green-600" : "text-red-500"}`}
              >
                {kiro.status?.has_access_token ? "✓ 已加载" : "✗ 未加载"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Refresh Token:</span>
              <span
                className={`ml-2 ${kiro.status?.has_refresh_token ? "text-green-600" : "text-red-500"}`}
              >
                {kiro.status?.has_refresh_token ? "✓ 已加载" : "✗ 未加载"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleLoadCredentials("kiro")}
              disabled={isAnyLoading}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <FolderOpen className="h-4 w-4" />
              {kiro.loading === "reload" ? "加载中..." : "一键读取凭证"}
            </button>
            <button
              onClick={() => handleRefreshToken("kiro")}
              disabled={isAnyLoading || !kiro.status?.has_refresh_token}
              className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${kiro.loading === "refresh" ? "animate-spin" : ""}`}
              />
              刷新 Token
            </button>
            <button
              onClick={() => setShowEnv(!showEnv)}
              className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              <FileText className="h-4 w-4" />
              {showEnv ? "隐藏" : "查看"} .env 变量
            </button>
          </div>
        </div>
      )}

      {/* Gemini Panel */}
      {activeProvider === "gemini" && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Gemini CLI 凭证状态</h3>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                最后同步:{" "}
                <span className="text-foreground">
                  {formatTime(gemini.lastSync)}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                监测中
              </span>
            </div>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">凭证路径:</span>
              <code className="ml-2 rounded bg-muted px-2 py-0.5 text-xs break-all">
                {gemini.status?.creds_path || "~/.gemini/oauth_creds.json"}
              </code>
            </div>
            <div>
              <span className="text-muted-foreground">Token 有效:</span>
              <span
                className={`ml-2 ${gemini.status?.is_valid ? "text-green-600" : "text-red-500"}`}
              >
                {gemini.status?.is_valid ? "✓ 有效" : "✗ 无效/过期"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Access Token:</span>
              <span
                className={`ml-2 ${gemini.status?.has_access_token ? "text-green-600" : "text-red-500"}`}
              >
                {gemini.status?.has_access_token ? "✓ 已加载" : "✗ 未加载"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Refresh Token:</span>
              <span
                className={`ml-2 ${gemini.status?.has_refresh_token ? "text-green-600" : "text-red-500"}`}
              >
                {gemini.status?.has_refresh_token ? "✓ 已加载" : "✗ 未加载"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleLoadCredentials("gemini")}
              disabled={isAnyLoading}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <FolderOpen className="h-4 w-4" />
              {gemini.loading === "reload" ? "加载中..." : "一键读取凭证"}
            </button>
            <button
              onClick={() => handleRefreshToken("gemini")}
              disabled={isAnyLoading || !gemini.status?.has_refresh_token}
              className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${gemini.loading === "refresh" ? "animate-spin" : ""}`}
              />
              刷新 Token
            </button>
            <button
              onClick={() => setShowEnv(!showEnv)}
              className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              <FileText className="h-4 w-4" />
              {showEnv ? "隐藏" : "查看"} .env 变量
            </button>
          </div>
        </div>
      )}

      {/* Qwen Panel */}
      {activeProvider === "qwen" && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">通义千问凭证状态</h3>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                最后同步:{" "}
                <span className="text-foreground">
                  {formatTime(qwen.lastSync)}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                监测中
              </span>
            </div>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">凭证路径:</span>
              <code className="ml-2 rounded bg-muted px-2 py-0.5 text-xs break-all">
                {qwen.status?.creds_path || "~/.qwen/oauth_creds.json"}
              </code>
            </div>
            <div>
              <span className="text-muted-foreground">Token 有效:</span>
              <span
                className={`ml-2 ${qwen.status?.is_valid ? "text-green-600" : "text-red-500"}`}
              >
                {qwen.status?.is_valid ? "✓ 有效" : "✗ 无效/过期"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Access Token:</span>
              <span
                className={`ml-2 ${qwen.status?.has_access_token ? "text-green-600" : "text-red-500"}`}
              >
                {qwen.status?.has_access_token ? "✓ 已加载" : "✗ 未加载"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Refresh Token:</span>
              <span
                className={`ml-2 ${qwen.status?.has_refresh_token ? "text-green-600" : "text-red-500"}`}
              >
                {qwen.status?.has_refresh_token ? "✓ 已加载" : "✗ 未加载"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleLoadCredentials("qwen")}
              disabled={isAnyLoading}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <FolderOpen className="h-4 w-4" />
              {qwen.loading === "reload" ? "加载中..." : "一键读取凭证"}
            </button>
            <button
              onClick={() => handleRefreshToken("qwen")}
              disabled={isAnyLoading || !qwen.status?.has_refresh_token}
              className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${qwen.loading === "refresh" ? "animate-spin" : ""}`}
              />
              刷新 Token
            </button>
            <button
              onClick={() => setShowEnv(!showEnv)}
              className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              <FileText className="h-4 w-4" />
              {showEnv ? "隐藏" : "查看"} .env 变量
            </button>
          </div>
        </div>
      )}

      {/* OpenAI Custom Panel */}
      {activeProvider === "openai" && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 font-semibold">OpenAI 自定义配置</h3>
          <div className="mb-4 space-y-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                API Key
              </label>
              <input
                type="password"
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                Base URL
              </label>
              <input
                type="text"
                value={openaiBaseUrl}
                onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">状态:</span>
              <span
                className={
                  openaiStatus?.has_api_key ? "text-green-600" : "text-red-500"
                }
              >
                {openaiStatus?.has_api_key ? "✓ 已配置" : "✗ 未配置"}
              </span>
            </div>
          </div>
          <button
            onClick={handleSaveOpenAIConfig}
            disabled={loading !== null}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading === "save-openai" ? "保存中..." : "保存配置"}
          </button>
        </div>
      )}

      {/* Claude Custom Panel */}
      {activeProvider === "claude" && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 font-semibold">Claude 自定义配置</h3>
          <div className="mb-4 space-y-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                API Key
              </label>
              <input
                type="password"
                value={claudeApiKey}
                onChange={(e) => setClaudeApiKey(e.target.value)}
                placeholder="sk-ant-..."
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                Base URL
              </label>
              <input
                type="text"
                value={claudeBaseUrl}
                onChange={(e) => setClaudeBaseUrl(e.target.value)}
                placeholder="https://api.anthropic.com"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">状态:</span>
              <span
                className={
                  claudeStatus?.has_api_key ? "text-green-600" : "text-red-500"
                }
              >
                {claudeStatus?.has_api_key ? "✓ 已配置" : "✗ 未配置"}
              </span>
            </div>
          </div>
          <button
            onClick={handleSaveClaudeConfig}
            disabled={loading !== null}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading === "save-claude" ? "保存中..." : "保存配置"}
          </button>
        </div>
      )}

      {/* .env 变量展示 */}
      {showEnv && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">.env 环境变量 ({activeProvider})</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowValues(!showValues)}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted"
              >
                {showValues ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
                {showValues ? "隐藏值" : "显示值"}
              </button>
              <button
                onClick={() => copyAllEnv(currentEnvVars)}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted"
              >
                {copied === "all" ? (
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                复制全部
              </button>
            </div>
          </div>
          {currentEnvVars.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              暂无环境变量，请先加载凭证
            </p>
          ) : (
            <div className="space-y-2 font-mono text-sm">
              {currentEnvVars.map((v) => (
                <div
                  key={v.key}
                  className="flex items-center gap-2 rounded bg-muted p-2"
                >
                  <span className="text-blue-600 shrink-0">{v.key}</span>
                  <span>=</span>
                  <span className="flex-1 truncate text-muted-foreground">
                    {showValues ? v.value : v.masked}
                  </span>
                  <button
                    onClick={() => copyValue(v.key, v.value)}
                    className="rounded p-1 hover:bg-background shrink-0"
                  >
                    {copied === v.key ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Provider 列表 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Provider 列表</h3>
          <span className="text-sm text-muted-foreground">
            当前默认:{" "}
            <span className="font-medium text-primary">
              {getProviderName(defaultProvider)}
            </span>
          </span>
        </div>
        {providers.map((provider) => (
          <div
            key={provider.id}
            className={`flex items-center justify-between rounded-lg border bg-card p-4 transition-all ${
              defaultProvider === provider.id
                ? "border-primary ring-1 ring-primary"
                : ""
            }`}
          >
            <div className="flex items-center gap-4">
              <div
                className={`h-3 w-3 rounded-full ${getStatusColor(provider.status)}`}
              />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{provider.name}</h3>
                  {defaultProvider === provider.id && (
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      默认
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {provider.description}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {defaultProvider !== provider.id && (
                <button
                  onClick={() => handleSetDefaultProvider(provider.id)}
                  disabled={isAnyLoading}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                  title="设为默认"
                >
                  {loading === `default-${provider.id}`
                    ? "切换中..."
                    : "设为默认"}
                </button>
              )}
              {(provider.id === "kiro" ||
                provider.id === "gemini" ||
                provider.id === "qwen") && (
                <button
                  onClick={() => handleRefreshToken(provider.id)}
                  disabled={isAnyLoading}
                  className="rounded p-2 hover:bg-muted"
                  title="刷新 Token"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${
                      (provider.id === "kiro" && kiro.loading === "refresh") ||
                      (provider.id === "gemini" &&
                        gemini.loading === "refresh") ||
                      (provider.id === "qwen" && qwen.loading === "refresh")
                        ? "animate-spin"
                        : ""
                    }`}
                  />
                </button>
              )}
              <button
                onClick={() => toggleProvider(provider.id)}
                className={`rounded-full p-1 ${provider.enabled ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"}`}
              >
                {provider.enabled ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <X className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        💡 提示：系统每 5
        秒自动检查凭证文件变化，如有更新会自动重新加载并记录日志
      </p>
    </div>
  );
}
