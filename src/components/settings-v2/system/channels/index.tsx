/**
 * 渠道管理设置页面
 *
 * Telegram / Discord / 飞书 三个 Bot 渠道的内联表单配置
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Eye,
  EyeOff,
  Plus,
  X,
  Loader2,
  Save,
  RotateCcw,
  AlertCircle,
  LayoutDashboard,
  SlidersHorizontal,
  Network,
  ScrollText,
} from "lucide-react";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import {
  discordChannelProbe,
  feishuChannelProbe,
  gatewayChannelStart,
  gatewayChannelStatus,
  gatewayChannelStop,
  gatewayTunnelCreate,
  gatewayTunnelDetectCloudflared,
  gatewayTunnelInstallCloudflared,
  gatewayTunnelProbe,
  gatewayTunnelRestart,
  gatewayTunnelStart,
  gatewayTunnelStatus,
  gatewayTunnelStop,
  gatewayTunnelSyncWebhookUrl,
  telegramChannelProbe,
  type ChannelsConfig,
  type DiscordBotConfig,
  type FeishuBotConfig,
  type GatewayConfig,
  type TelegramBotConfig,
} from "@/lib/api/channelsRuntime";
import { useConfiguredProviders } from "@/hooks/useConfiguredProviders";
import {
  filterProviderModelsByCompatibility,
  getProviderModelCompatibilityIssue,
} from "@/components/agent/chat/utils/providerModelCompatibility";
import { ChannelLogTailPanel } from "./ChannelLogTailPanel";

// ============================================================================
// 默认值
// ============================================================================

const DEFAULT_CHANNELS: ChannelsConfig = {
  telegram: {
    enabled: false,
    bot_token: "",
    allowed_user_ids: [],
    default_model: undefined,
  },
  discord: {
    enabled: false,
    bot_token: "",
    allowed_server_ids: [],
    default_model: undefined,
    default_account: "default",
    accounts: {},
    dm_policy: "pairing",
    allow_from: [],
    group_policy: "allowlist",
    group_allow_from: [],
    streaming: "partial",
    reply_to_mode: "off",
  },
  feishu: {
    enabled: false,
    app_id: "",
    app_secret: "",
    default_model: undefined,
    dm_policy: "open",
    allow_from: ["*"],
    group_policy: "allowlist",
    group_allow_from: [],
  },
};

const DEFAULT_GATEWAY: GatewayConfig = {
  tunnel: {
    enabled: false,
    provider: "cloudflare",
    mode: "managed",
    local_host: "127.0.0.1",
    local_port: 3000,
    cloudflare: {},
  },
};

type TabKey = "telegram" | "discord" | "feishu";
type ChannelSubPage = "overview" | "config" | "gateway" | "logs";
type DebugTabKey = "telegram" | "feishu" | "discord";

// ============================================================================
// 模型选择器子组件
// ============================================================================

function DefaultModelSelect({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const { providers, loading: providersLoading } = useConfiguredProviders();

  // 已保存的值如果不兼容，自动回退到 "未指定"
  useEffect(() => {
    if (!value || providersLoading) return;
    const slashIdx = value.indexOf("/");
    if (slashIdx < 0) return;
    const providerKey = value.slice(0, slashIdx);
    const modelName = value.slice(slashIdx + 1);
    const provider = providers.find((p) => p.key === providerKey);
    if (!provider) return;
    const issue = getProviderModelCompatibilityIssue({
      providerType: provider.type,
      configuredProviderType: provider.type,
      model: modelName,
    });
    if (issue) {
      onChange(undefined);
    }
  }, [value, providers, providersLoading, onChange]);

  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">默认模型</label>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
      >
        <option value="">未指定（使用全局默认）</option>
        {providersLoading && <option disabled>加载中...</option>}
        {providers.map((p) => {
          const models = p.customModels ?? [];
          const { compatibleModels } = filterProviderModelsByCompatibility(
            { providerType: p.type, configuredProviderType: p.type },
            models,
          );
          if (compatibleModels.length === 0) return null;
          return (
            <optgroup key={p.key} label={p.label}>
              {compatibleModels.map((m) => (
                <option key={`${p.key}/${m}`} value={`${p.key}/${m}`}>
                  {m}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      <p className="text-xs text-muted-foreground mt-1">
        为此渠道指定默认使用的 AI 模型
      </p>
    </div>
  );
}

// ============================================================================
// 密码输入组件
// ============================================================================

function PasswordInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: React.ReactNode;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 pr-10 rounded-lg border bg-background text-sm font-mono focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-muted"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

// ============================================================================
// 字符串列表输入组件
// ============================================================================

function StringListInput({
  label,
  values,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  hint?: string;
}) {
  const [draft, setDraft] = useState("");

  const addItem = () => {
    const trimmed = draft.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
      setDraft("");
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) =>
            e.key === "Enter" && (e.preventDefault(), addItem())
          }
          placeholder={placeholder}
          className="flex-1 px-3 py-2 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
        />
        <button
          type="button"
          onClick={addItem}
          className="px-3 py-2 rounded-lg border hover:bg-muted text-sm"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-sm"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function ConfigGuideCard({
  title,
  steps,
  note,
}: {
  title: string;
  steps: string[];
  note?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="mt-2 space-y-1">
        {steps.map((step, index) => (
          <p key={step} className="text-xs text-muted-foreground">
            {index + 1}. {step}
          </p>
        ))}
      </div>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function GatewayTunnelPanel({
  config,
  onChange,
  defaultFeishuAccountId,
  onReloadConfig,
}: {
  config: GatewayConfig;
  onChange: (c: GatewayConfig) => void;
  defaultFeishuAccountId?: string;
  onReloadConfig: () => Promise<void>;
}) {
  const tunnel = config.tunnel ?? DEFAULT_GATEWAY.tunnel!;
  const cloudflare = tunnel.cloudflare ?? {};
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [output, setOutput] = useState("");
  const [feishuAccountId, setFeishuAccountId] = useState(
    defaultFeishuAccountId ?? "default",
  );

  const busy = busyAction !== null;

  const patchTunnel = (
    patch: Partial<NonNullable<GatewayConfig["tunnel"]>>,
  ) => {
    onChange({
      ...config,
      tunnel: {
        ...tunnel,
        ...patch,
      },
    });
  };

  const patchCloudflare = (
    patch: Partial<
      NonNullable<NonNullable<GatewayConfig["tunnel"]>["cloudflare"]>
    >,
  ) => {
    patchTunnel({
      cloudflare: {
        ...cloudflare,
        ...patch,
      },
    });
  };

  const runAction = async (
    action: string,
    executor: () => Promise<unknown>,
  ) => {
    setBusyAction(action);
    try {
      const result = await executor();
      setOutput(JSON.stringify(result, null, 2));
      if (action === "create" || action === "sync") {
        await onReloadConfig();
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setOutput(JSON.stringify({ action, ok: false, error: text }, null, 2));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-4 p-4 rounded-lg border">
      <div>
        <h3 className="text-sm font-medium">Gateway 公共隧道</h3>
        <p className="text-xs text-muted-foreground">
          全局 webhook 公网入口配置（供 Feishu/Telegram 等渠道复用）
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">启用隧道</span>
          <button
            type="button"
            role="switch"
            aria-checked={tunnel.enabled ?? false}
            onClick={() => patchTunnel({ enabled: !(tunnel.enabled ?? false) })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              tunnel.enabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                tunnel.enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Provider</span>
          <select
            value={(tunnel.provider || "cloudflare").toLowerCase()}
            onChange={(event) => patchTunnel({ provider: event.target.value })}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="cloudflare">cloudflare</option>
            <option value="ngrok">ngrok（预留）</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">模式</span>
          <select
            value={(tunnel.mode || "managed").toLowerCase()}
            onChange={(event) => patchTunnel({ mode: event.target.value })}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="managed">managed</option>
            <option value="external">external</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">
            cloudflared 二进制（可选）
          </span>
          <input
            value={tunnel.binary_path || ""}
            onChange={(event) =>
              patchTunnel({ binary_path: event.target.value || undefined })
            }
            placeholder="默认使用 PATH 中 cloudflared"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">本地 Host</span>
          <input
            value={tunnel.local_host || "127.0.0.1"}
            onChange={(event) =>
              patchTunnel({ local_host: event.target.value })
            }
            placeholder="127.0.0.1"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">本地 Port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={String(tunnel.local_port ?? 3000)}
            onChange={(event) =>
              patchTunnel({
                local_port: Number.parseInt(event.target.value, 10) || 3000,
              })
            }
            placeholder="3000"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">
            公网基础 URL（可选）
          </span>
          <input
            value={tunnel.public_base_url || ""}
            onChange={(event) =>
              patchTunnel({
                public_base_url: event.target.value.trim() || undefined,
              })
            }
            placeholder="https://bot.example.com"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Tunnel Name</span>
          <input
            value={cloudflare.tunnel_name || ""}
            onChange={(event) =>
              patchCloudflare({ tunnel_name: event.target.value || undefined })
            }
            placeholder="proxycast-gateway"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Tunnel ID</span>
          <input
            value={cloudflare.tunnel_id || ""}
            onChange={(event) =>
              patchCloudflare({ tunnel_id: event.target.value || undefined })
            }
            placeholder="uuid"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">DNS Name</span>
          <input
            value={cloudflare.dns_name || ""}
            onChange={(event) =>
              patchCloudflare({ dns_name: event.target.value || undefined })
            }
            placeholder="bot.example.com"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </label>
      </div>

      <PasswordInput
        label="Run Token（可选，优先于 tunnel_id）"
        value={cloudflare.run_token || ""}
        onChange={(value) => patchCloudflare({ run_token: value || undefined })}
        placeholder="cloudflared tunnel run --token ..."
      />

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Credentials File（可选）
        </label>
        <input
          value={cloudflare.credentials_file || ""}
          onChange={(event) =>
            patchCloudflare({
              credentials_file: event.target.value || undefined,
            })
          }
          placeholder="~/.cloudflared/<tunnel-id>.json"
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">
            同步回调账号 ID（Feishu）
          </span>
          <input
            value={feishuAccountId}
            onChange={(event) => setFeishuAccountId(event.target.value)}
            placeholder="default"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void runAction("detect_cloudflared", async () =>
              gatewayTunnelDetectCloudflared(),
            )
          }
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
        >
          检测 cloudflared
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const confirmed = window.confirm(
              [
                "⚠️ 危险操作检测！",
                "操作类型：系统安装 cloudflared",
                "影响范围：将调用系统包管理器（brew/apt/winget 等）安装全局命令",
                "风险评估：可能触发管理员权限申请、网络下载失败或修改系统包状态",
                "",
                "请确认是否继续？",
              ].join("\n"),
            );
            if (!confirmed) {
              return;
            }
            void runAction("install_cloudflared", async () => {
              const install = await gatewayTunnelInstallCloudflared({
                confirm: true,
              });
              const detect = await gatewayTunnelDetectCloudflared();
              return { install, detect };
            });
          }}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
        >
          一键安装 cloudflared
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void runAction("probe", async () => gatewayTunnelProbe())
          }
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
        >
          探测
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void runAction("create", async () =>
              gatewayTunnelCreate({
                tunnelName: cloudflare.tunnel_name,
                dnsName: cloudflare.dns_name,
                persist: true,
              }),
            )
          }
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
        >
          创建隧道
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void runAction("start", async () => gatewayTunnelStart())
          }
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
        >
          启动
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void runAction("stop", async () => gatewayTunnelStop())
          }
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
        >
          停止
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void runAction("restart", async () => gatewayTunnelRestart())
          }
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
        >
          重启
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void runAction("status", async () => gatewayTunnelStatus())
          }
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
        >
          查询状态
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void runAction("sync", async () =>
              gatewayTunnelSyncWebhookUrl({
                channel: "feishu",
                accountId: feishuAccountId.trim() || "default",
                persist: true,
              }),
            )
          }
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
        >
          同步飞书回调 URL
        </button>
      </div>

      {busyAction && (
        <div className="text-xs text-muted-foreground">
          正在执行：{busyAction}
        </div>
      )}

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">最近结果</div>
        <pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-all">
          {output || "暂无结果"}
        </pre>
      </div>
    </div>
  );
}

// ============================================================================
// Telegram 表单
// ============================================================================

function TelegramForm({
  config,
  onChange,
}: {
  config: TelegramBotConfig;
  onChange: (c: TelegramBotConfig) => void;
}) {
  return (
    <div className="space-y-4 p-4 rounded-lg border">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">启用 Telegram Bot</h3>
          <p className="text-xs text-muted-foreground">
            开启后可通过 Telegram Bot 与 AI 对话
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          onClick={() => onChange({ ...config, enabled: !config.enabled })}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            config.enabled ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              config.enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <PasswordInput
        label="Bot Token"
        value={config.bot_token}
        onChange={(v) => onChange({ ...config, bot_token: v })}
        placeholder="123456:ABC-DEF..."
        hint={
          <>
            从{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              @BotFather
            </a>{" "}
            获取
          </>
        }
      />

      <StringListInput
        label="允许的用户 ID"
        values={config.allowed_user_ids}
        onChange={(v) => onChange({ ...config, allowed_user_ids: v })}
        placeholder="输入 Telegram User ID"
        hint="留空则允许所有用户"
      />

      <DefaultModelSelect
        value={config.default_model}
        onChange={(v) => onChange({ ...config, default_model: v })}
      />
    </div>
  );
}

function TelegramGatewayDebugPanel() {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("default");
  const [pollTimeoutSecs, setPollTimeoutSecs] = useState("25");
  const [output, setOutput] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const resolveAccountId = () => {
    const normalized = accountId.trim();
    return normalized.length > 0 ? normalized : undefined;
  };

  const resolvePollTimeoutSecs = () => {
    const parsed = Number.parseInt(pollTimeoutSecs.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return undefined;
    }
    return parsed;
  };

  const runAction = async (
    action: string,
    executor: () => Promise<unknown>,
    successText: string,
  ) => {
    setBusyAction(action);
    setMessage(null);
    try {
      const result = await executor();
      setOutput(JSON.stringify(result, null, 2));
      setMessage({ type: "success", text: successText });
      setTimeout(() => setMessage(null), 2500);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setOutput(JSON.stringify({ action, ok: false, error: text }, null, 2));
      setMessage({ type: "error", text: `执行失败: ${text}` });
    } finally {
      setBusyAction(null);
    }
  };

  const busy = busyAction !== null;

  return (
    <div className="space-y-4 p-4 rounded-lg border">
      <div>
        <h3 className="text-sm font-medium">Telegram Gateway 调试工具</h3>
        <p className="text-xs text-muted-foreground">
          用于快速执行启停、重启、状态查询和账号探测
        </p>
      </div>

      {message && (
        <div
          className={`rounded-md px-3 py-2 text-xs ${
            message.type === "success"
              ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">账号 ID</span>
          <input
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            placeholder="default"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">轮询超时（秒）</span>
          <input
            value={pollTimeoutSecs}
            onChange={(event) => setPollTimeoutSecs(event.target.value)}
            placeholder="25"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            void runAction(
              "status",
              async () => gatewayChannelStatus({ channel: "telegram" }),
              "Gateway 状态已刷新",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          查询状态
        </button>
        <button
          type="button"
          onClick={() =>
            void runAction(
              "probe",
              async () =>
                telegramChannelProbe({ accountId: resolveAccountId() }),
              "Telegram 探测完成",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          探测账号
        </button>
        <button
          type="button"
          onClick={() =>
            void runAction(
              "start",
              async () =>
                gatewayChannelStart({
                  channel: "telegram",
                  accountId: resolveAccountId(),
                  pollTimeoutSecs: resolvePollTimeoutSecs(),
                }),
              "Gateway 已启动",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          启动
        </button>
        <button
          type="button"
          onClick={() =>
            void runAction(
              "stop",
              async () =>
                gatewayChannelStop({
                  channel: "telegram",
                  accountId: resolveAccountId(),
                }),
              "Gateway 已停止",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          停止
        </button>
        <button
          type="button"
          onClick={() =>
            void runAction(
              "restart",
              async () => {
                let stopResult: unknown;
                try {
                  stopResult = await gatewayChannelStop({
                    channel: "telegram",
                    accountId: resolveAccountId(),
                  });
                } catch (error) {
                  stopResult = {
                    warning:
                      error instanceof Error
                        ? error.message
                        : `stop 失败: ${String(error)}`,
                  };
                }
                const startResult = await gatewayChannelStart({
                  channel: "telegram",
                  accountId: resolveAccountId(),
                  pollTimeoutSecs: resolvePollTimeoutSecs(),
                });
                const statusResult = await gatewayChannelStatus({
                  channel: "telegram",
                });
                return {
                  stop: stopResult,
                  start: startResult,
                  status: statusResult,
                };
              },
              "Gateway 已重启",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          重启
        </button>
      </div>

      {busyAction && (
        <div className="text-xs text-muted-foreground">
          正在执行：{busyAction}
        </div>
      )}

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">最近结果</div>
        <pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-all">
          {output || "暂无结果"}
        </pre>
      </div>
    </div>
  );
}

function FeishuGatewayDebugPanel() {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("default");
  const [output, setOutput] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const resolveAccountId = () => {
    const normalized = accountId.trim();
    return normalized.length > 0 ? normalized : undefined;
  };

  const runAction = async (
    action: string,
    executor: () => Promise<unknown>,
    successText: string,
  ) => {
    setBusyAction(action);
    setMessage(null);
    try {
      const result = await executor();
      setOutput(JSON.stringify(result, null, 2));
      setMessage({ type: "success", text: successText });
      setTimeout(() => setMessage(null), 2500);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setOutput(JSON.stringify({ action, ok: false, error: text }, null, 2));
      setMessage({ type: "error", text: `执行失败: ${text}` });
    } finally {
      setBusyAction(null);
    }
  };

  const busy = busyAction !== null;

  return (
    <div className="space-y-4 p-4 rounded-lg border">
      <div>
        <h3 className="text-sm font-medium">Feishu Gateway 调试工具</h3>
        <p className="text-xs text-muted-foreground">
          用于快速执行启停、重启、状态查询和账号探测
        </p>
      </div>

      {message && (
        <div
          className={`rounded-md px-3 py-2 text-xs ${
            message.type === "success"
              ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">账号 ID</span>
          <input
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            placeholder="default"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            void runAction(
              "status",
              async () => gatewayChannelStatus({ channel: "feishu" }),
              "Gateway 状态已刷新",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          查询状态
        </button>
        <button
          type="button"
          onClick={() =>
            void runAction(
              "probe",
              async () => feishuChannelProbe({ accountId: resolveAccountId() }),
              "Feishu 探测完成",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          探测账号
        </button>
        <button
          type="button"
          onClick={() =>
            void runAction(
              "start",
              async () =>
                gatewayChannelStart({
                  channel: "feishu",
                  accountId: resolveAccountId(),
                }),
              "Gateway 已启动",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          启动
        </button>
        <button
          type="button"
          onClick={() =>
            void runAction(
              "stop",
              async () =>
                gatewayChannelStop({
                  channel: "feishu",
                  accountId: resolveAccountId(),
                }),
              "Gateway 已停止",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          停止
        </button>
        <button
          type="button"
          onClick={() =>
            void runAction(
              "restart",
              async () => {
                let stopResult: unknown;
                try {
                  stopResult = await gatewayChannelStop({
                    channel: "feishu",
                    accountId: resolveAccountId(),
                  });
                } catch (error) {
                  stopResult = {
                    warning:
                      error instanceof Error
                        ? error.message
                        : `stop 失败: ${String(error)}`,
                  };
                }
                const startResult = await gatewayChannelStart({
                  channel: "feishu",
                  accountId: resolveAccountId(),
                });
                const statusResult = await gatewayChannelStatus({
                  channel: "feishu",
                });
                return {
                  stop: stopResult,
                  start: startResult,
                  status: statusResult,
                };
              },
              "Gateway 已重启",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          重启
        </button>
      </div>

      {busyAction && (
        <div className="text-xs text-muted-foreground">
          正在执行：{busyAction}
        </div>
      )}

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">最近结果</div>
        <pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-all">
          {output || "暂无结果"}
        </pre>
      </div>
    </div>
  );
}

function DiscordGatewayDebugPanel() {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("default");
  const [output, setOutput] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const resolveAccountId = () => {
    const normalized = accountId.trim();
    return normalized.length > 0 ? normalized : undefined;
  };

  const runAction = async (
    action: string,
    executor: () => Promise<unknown>,
    successText: string,
  ) => {
    setBusyAction(action);
    setMessage(null);
    try {
      const result = await executor();
      setOutput(JSON.stringify(result, null, 2));
      setMessage({ type: "success", text: successText });
      setTimeout(() => setMessage(null), 2500);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setOutput(JSON.stringify({ action, ok: false, error: text }, null, 2));
      setMessage({ type: "error", text: `执行失败: ${text}` });
    } finally {
      setBusyAction(null);
    }
  };

  const busy = busyAction !== null;

  return (
    <div className="space-y-4 p-4 rounded-lg border">
      <div>
        <h3 className="text-sm font-medium">Discord Gateway 调试工具</h3>
        <p className="text-xs text-muted-foreground">
          用于快速执行启停、重启、状态查询和账号探测
        </p>
      </div>

      {message && (
        <div
          className={`rounded-md px-3 py-2 text-xs ${
            message.type === "success"
              ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">账号 ID</span>
          <input
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            placeholder="default"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            void runAction(
              "status",
              async () => gatewayChannelStatus({ channel: "discord" }),
              "Gateway 状态已刷新",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          查询状态
        </button>
        <button
          type="button"
          onClick={() =>
            void runAction(
              "probe",
              async () =>
                discordChannelProbe({ accountId: resolveAccountId() }),
              "Discord 探测完成",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          探测账号
        </button>
        <button
          type="button"
          onClick={() =>
            void runAction(
              "start",
              async () =>
                gatewayChannelStart({
                  channel: "discord",
                  accountId: resolveAccountId(),
                }),
              "Gateway 已启动",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          启动
        </button>
        <button
          type="button"
          onClick={() =>
            void runAction(
              "stop",
              async () =>
                gatewayChannelStop({
                  channel: "discord",
                  accountId: resolveAccountId(),
                }),
              "Gateway 已停止",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          停止
        </button>
        <button
          type="button"
          onClick={() =>
            void runAction(
              "restart",
              async () => {
                let stopResult: unknown;
                try {
                  stopResult = await gatewayChannelStop({
                    channel: "discord",
                    accountId: resolveAccountId(),
                  });
                } catch (error) {
                  stopResult = {
                    warning:
                      error instanceof Error
                        ? error.message
                        : `stop 失败: ${String(error)}`,
                  };
                }
                const startResult = await gatewayChannelStart({
                  channel: "discord",
                  accountId: resolveAccountId(),
                });
                const statusResult = await gatewayChannelStatus({
                  channel: "discord",
                });
                return {
                  stop: stopResult,
                  start: startResult,
                  status: statusResult,
                };
              },
              "Gateway 已重启",
            )
          }
          disabled={busy}
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          重启
        </button>
      </div>

      {busyAction && (
        <div className="text-xs text-muted-foreground">
          正在执行：{busyAction}
        </div>
      )}

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">最近结果</div>
        <pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-all">
          {output || "暂无结果"}
        </pre>
      </div>
    </div>
  );
}

// ============================================================================
// Discord 表单
// ============================================================================

function DiscordForm({
  config,
  onChange,
}: {
  config: DiscordBotConfig;
  onChange: (c: DiscordBotConfig) => void;
}) {
  const accountIds = useMemo(
    () => Object.keys(config.accounts ?? {}),
    [config.accounts],
  );
  const [activeAccountId, setActiveAccountId] = useState(
    config.default_account || accountIds[0] || "default",
  );

  useEffect(() => {
    if (!accountIds.length) {
      setActiveAccountId(config.default_account || "default");
      return;
    }
    if (!accountIds.includes(activeAccountId)) {
      setActiveAccountId(config.default_account || accountIds[0]);
    }
  }, [accountIds, config.default_account, activeAccountId]);

  const patch = (next: Partial<DiscordBotConfig>) => {
    onChange({ ...config, ...next });
  };

  const patchAccount = (
    accountId: string,
    updater: (
      current: NonNullable<DiscordBotConfig["accounts"]>[string],
    ) => NonNullable<DiscordBotConfig["accounts"]>[string],
  ) => {
    const baseAccounts = config.accounts ?? {};
    const current = baseAccounts[accountId] ?? { enabled: true };
    patch({
      accounts: {
        ...baseAccounts,
        [accountId]: updater(current),
      },
    });
  };

  const addAccount = () => {
    const baseAccounts = config.accounts ?? {};
    let index = 1;
    let accountId = "account_1";
    while (baseAccounts[accountId]) {
      index += 1;
      accountId = `account_${index}`;
    }
    const nextAccounts = {
      ...baseAccounts,
      [accountId]: {
        enabled: true,
        name: `Discord ${index}`,
      },
    };
    patch({
      accounts: nextAccounts,
      default_account: config.default_account || accountId,
    });
    setActiveAccountId(accountId);
  };

  const removeAccount = (accountId: string) => {
    const baseAccounts = { ...(config.accounts ?? {}) };
    delete baseAccounts[accountId];
    const nextIds = Object.keys(baseAccounts);
    patch({
      accounts: baseAccounts,
      default_account:
        config.default_account === accountId
          ? nextIds[0] || "default"
          : config.default_account,
    });
    setActiveAccountId(nextIds[0] || "default");
  };

  const currentAccount = (config.accounts ?? {})[activeAccountId];
  const intents = config.intents ?? {};
  const actions = config.actions ?? {};
  const threadBindings = config.thread_bindings ?? {};
  const autoPresence = config.auto_presence ?? {};
  const dmPolicy = (config.dm_policy || "pairing").toLowerCase();
  const groupPolicy = (config.group_policy || "allowlist").toLowerCase();
  const streamingMode = (config.streaming || "partial").toLowerCase();
  const replyToMode = (config.reply_to_mode || "off").toLowerCase();

  return (
    <div className="space-y-4 p-4 rounded-lg border">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">启用 Discord Bot</h3>
          <p className="text-xs text-muted-foreground">
            开启后可通过 Discord Bot 与 AI 对话
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          onClick={() => onChange({ ...config, enabled: !config.enabled })}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            config.enabled ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              config.enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <PasswordInput
        label="全局 Bot Token（兼容旧配置）"
        value={config.bot_token}
        onChange={(v) => patch({ bot_token: v })}
        placeholder="MTIz..."
        hint={
          <>
            从{" "}
            <a
              href="https://discord.com/developers/applications"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Discord Developer Portal
            </a>{" "}
            获取
          </>
        }
      />

      <StringListInput
        label="允许的服务器 ID"
        values={config.allowed_server_ids}
        onChange={(v) => patch({ allowed_server_ids: v })}
        placeholder="输入 Discord Server ID"
        hint="留空则允许所有服务器"
      />

      <div>
        <label className="block text-sm font-medium mb-1.5">默认账号 ID</label>
        <input
          type="text"
          value={config.default_account || ""}
          onChange={(e) =>
            patch({ default_account: e.target.value || undefined })
          }
          placeholder="default"
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
        />
      </div>

      <div className="rounded-lg border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium">多账号配置</h4>
            <p className="text-xs text-muted-foreground">
              支持账号级 token/模型/服务器范围覆盖
            </p>
          </div>
          <button
            type="button"
            onClick={addAccount}
            className="px-3 py-1.5 rounded-md border text-xs hover:bg-muted"
          >
            新增账号
          </button>
        </div>

        {accountIds.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-2">
              {accountIds.map((accountId) => (
                <button
                  key={accountId}
                  type="button"
                  onClick={() => setActiveAccountId(accountId)}
                  className={`px-2.5 py-1 rounded-md text-xs border ${
                    activeAccountId === accountId
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  {accountId}
                </button>
              ))}
            </div>

            {currentAccount && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={currentAccount.enabled !== false}
                      onChange={(e) =>
                        patchAccount(activeAccountId, (item) => ({
                          ...item,
                          enabled: e.target.checked,
                        }))
                      }
                    />
                    启用该账号
                  </label>
                  <button
                    type="button"
                    onClick={() => removeAccount(activeAccountId)}
                    className="ml-auto px-2.5 py-1 rounded-md border text-xs text-destructive hover:bg-destructive/10"
                  >
                    删除账号
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1 text-muted-foreground">
                      账号名称
                    </label>
                    <input
                      type="text"
                      value={currentAccount.name || ""}
                      onChange={(e) =>
                        patchAccount(activeAccountId, (item) => ({
                          ...item,
                          name: e.target.value || undefined,
                        }))
                      }
                      placeholder="运营号 / 机器人 1"
                      className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1 text-muted-foreground">
                      账号默认模型
                    </label>
                    <DefaultModelSelect
                      value={currentAccount.default_model}
                      onChange={(v) =>
                        patchAccount(activeAccountId, (item) => ({
                          ...item,
                          default_model: v,
                        }))
                      }
                    />
                  </div>
                </div>

                <PasswordInput
                  label="账号 Bot Token"
                  value={currentAccount.bot_token || ""}
                  onChange={(v) =>
                    patchAccount(activeAccountId, (item) => ({
                      ...item,
                      bot_token: v || undefined,
                    }))
                  }
                  placeholder="MTIz..."
                />

                <StringListInput
                  label="账号允许服务器 ID"
                  values={currentAccount.allowed_server_ids || []}
                  onChange={(v) =>
                    patchAccount(activeAccountId, (item) => ({
                      ...item,
                      allowed_server_ids: v,
                    }))
                  }
                  placeholder="输入 Discord Server ID"
                />
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            未配置账号，将使用全局 Bot Token 运行。
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">DM 策略</label>
          <select
            value={dmPolicy}
            onChange={(e) => patch({ dm_policy: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          >
            <option value="pairing">pairing</option>
            <option value="allowlist">allowlist</option>
            <option value="open">open</option>
            <option value="disabled">disabled</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">群组策略</label>
          <select
            value={groupPolicy}
            onChange={(e) => patch({ group_policy: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          >
            <option value="allowlist">allowlist</option>
            <option value="open">open</option>
            <option value="disabled">disabled</option>
          </select>
        </div>
      </div>

      <StringListInput
        label="DM allow_from"
        values={config.allow_from || []}
        onChange={(v) => patch({ allow_from: v })}
        placeholder="用户 ID 或 *"
      />

      <StringListInput
        label="Group allow_from"
        values={config.group_allow_from || []}
        onChange={(v) => patch({ group_allow_from: v })}
        placeholder="用户 ID 或 *"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">Streaming</label>
          <select
            value={streamingMode}
            onChange={(e) => patch({ streaming: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          >
            <option value="off">off</option>
            <option value="partial">partial</option>
            <option value="block">block</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">
            Reply To Mode
          </label>
          <select
            value={replyToMode}
            onChange={(e) => patch({ reply_to_mode: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          >
            <option value="off">off</option>
            <option value="first">first</option>
            <option value="all">all</option>
          </select>
        </div>
      </div>

      <div className="rounded-lg border p-3 space-y-2">
        <h4 className="text-sm font-medium">高级能力开关</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={intents.message_content !== false}
              onChange={(e) =>
                patch({
                  intents: {
                    ...intents,
                    message_content: e.target.checked,
                  },
                })
              }
            />
            Message Content Intent
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={intents.guild_members === true}
              onChange={(e) =>
                patch({
                  intents: {
                    ...intents,
                    guild_members: e.target.checked,
                  },
                })
              }
            />
            Guild Members Intent
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={actions.messages !== false}
              onChange={(e) =>
                patch({
                  actions: {
                    ...actions,
                    messages: e.target.checked,
                  },
                })
              }
            />
            消息处理
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={actions.threads !== false}
              onChange={(e) =>
                patch({
                  actions: {
                    ...actions,
                    threads: e.target.checked,
                  },
                })
              }
            />
            线程能力
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={threadBindings.enabled === true}
              onChange={(e) =>
                patch({
                  thread_bindings: {
                    ...threadBindings,
                    enabled: e.target.checked,
                  },
                })
              }
            />
            Thread Bindings
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoPresence.enabled === true}
              onChange={(e) =>
                patch({
                  auto_presence: {
                    ...autoPresence,
                    enabled: e.target.checked,
                  },
                })
              }
            />
            Auto Presence
          </label>
        </div>
      </div>

      <DefaultModelSelect
        value={config.default_model}
        onChange={(v) => patch({ default_model: v })}
      />
    </div>
  );
}

// ============================================================================
// 飞书表单
// ============================================================================

function FeishuForm({
  config,
  onChange,
}: {
  config: FeishuBotConfig;
  onChange: (c: FeishuBotConfig) => void;
}) {
  const connectionMode =
    (config.connection_mode || "websocket").toLowerCase() === "webhook"
      ? "webhook"
      : "websocket";
  const dmPolicy = (() => {
    const value = (config.dm_policy || "open").toLowerCase();
    if (
      value === "open" ||
      value === "allowlist" ||
      value === "pairing" ||
      value === "disabled"
    ) {
      return value;
    }
    return "open";
  })();
  const streamingMode = (config.streaming || "partial").toLowerCase();
  const replyToMode = (config.reply_to_mode || "off").toLowerCase();

  return (
    <div className="space-y-4 p-4 rounded-lg border">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">启用飞书 Bot</h3>
          <p className="text-xs text-muted-foreground">
            开启后可通过飞书 Bot 与 AI 对话
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          onClick={() => onChange({ ...config, enabled: !config.enabled })}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            config.enabled ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              config.enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">App ID</label>
        <input
          type="text"
          value={config.app_id}
          onChange={(e) => onChange({ ...config, app_id: e.target.value })}
          placeholder="cli_xxxx"
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm font-mono focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
        />
      </div>

      <PasswordInput
        label="App Secret"
        value={config.app_secret}
        onChange={(v) => onChange({ ...config, app_secret: v })}
        placeholder="飞书应用的 App Secret"
      />

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Verification Token{" "}
          <span className="text-muted-foreground font-normal">（可选）</span>
        </label>
        <input
          type="text"
          value={config.verification_token || ""}
          onChange={(e) =>
            onChange({
              ...config,
              verification_token: e.target.value || undefined,
            })
          }
          placeholder="事件订阅验证 Token"
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
        />
      </div>

      <PasswordInput
        label="Encrypt Key（可选）"
        value={config.encrypt_key || ""}
        onChange={(v) => onChange({ ...config, encrypt_key: v || undefined })}
        placeholder="事件加密密钥"
      />

      <div>
        <label className="block text-sm font-medium mb-1.5">连接模式</label>
        <select
          value={connectionMode}
          onChange={(e) =>
            onChange({
              ...config,
              connection_mode: e.target.value,
            })
          }
          className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
        >
          <option value="webhook">Webhook（推荐）</option>
          <option value="websocket">WebSocket（开发中）</option>
        </select>
        {connectionMode === "websocket" && (
          <p className="text-xs text-amber-600 mt-1">
            当前版本 WebSocket 模式尚未实装，请使用 Webhook
            模式接入飞书事件回调。
          </p>
        )}
      </div>

      {connectionMode === "webhook" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Webhook Host
            </label>
            <input
              type="text"
              value={config.webhook_host || "127.0.0.1"}
              onChange={(e) =>
                onChange({
                  ...config,
                  webhook_host: e.target.value.trim() || undefined,
                })
              }
              placeholder="0.0.0.0"
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Webhook Port
            </label>
            <input
              type="number"
              min={1}
              max={65535}
              value={String(config.webhook_port ?? 3000)}
              onChange={(e) => {
                const value = Number.parseInt(e.target.value, 10);
                onChange({
                  ...config,
                  webhook_port:
                    Number.isFinite(value) && value > 0 ? value : undefined,
                });
              }}
              placeholder="3000"
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Webhook Path
            </label>
            <input
              type="text"
              value={config.webhook_path || "/feishu/default"}
              onChange={(e) =>
                onChange({
                  ...config,
                  webhook_path: e.target.value.trim() || undefined,
                })
              }
              placeholder="/feishu/default"
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm font-mono focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">DM 策略</label>
          <select
            value={dmPolicy}
            onChange={(e) => {
              const nextPolicy = e.target.value;
              const nextAllowFrom = [...(config.allow_from || [])];
              if (nextPolicy === "open" && nextAllowFrom.length === 0) {
                nextAllowFrom.push("*");
              }
              onChange({
                ...config,
                dm_policy: nextPolicy,
                allow_from: nextAllowFrom,
              });
            }}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
          >
            <option value="open">open（所有私聊用户）</option>
            <option value="allowlist">allowlist（白名单）</option>
            <option value="pairing">pairing（配对白名单）</option>
            <option value="disabled">disabled（禁用私聊）</option>
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            建议联调使用 open；生产可切换为 allowlist / pairing。
          </p>
        </div>
        <StringListInput
          label="DM 允许发送者 (allow_from)"
          values={config.allow_from || []}
          onChange={(v) => onChange({ ...config, allow_from: v })}
          placeholder="输入 open_id / user_id，或 *"
          hint="open 策略建议至少包含 *；allowlist/pairing 需填写具体用户。"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">流式模式</label>
          <select
            value={
              streamingMode === "off" || streamingMode === "block"
                ? streamingMode
                : "partial"
            }
            onChange={(e) =>
              onChange({
                ...config,
                streaming: e.target.value,
              })
            }
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
          >
            <option value="partial">partial</option>
            <option value="block">block</option>
            <option value="off">off</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">
            回复引用模式
          </label>
          <select
            value={
              replyToMode === "first" || replyToMode === "all"
                ? replyToMode
                : "off"
            }
            onChange={(e) =>
              onChange({
                ...config,
                reply_to_mode: e.target.value,
              })
            }
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
          >
            <option value="off">off</option>
            <option value="first">first</option>
            <option value="all">all</option>
          </select>
        </div>
      </div>

      <DefaultModelSelect
        value={config.default_model}
        onChange={(v) => onChange({ ...config, default_model: v })}
      />
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

export interface ChannelsSettingsProps {
  className?: string;
}

export function ChannelsSettings({ className }: ChannelsSettingsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("telegram");
  const [activeSubPage, setActiveSubPage] =
    useState<ChannelSubPage>("overview");
  const [activeDebugTab, setActiveDebugTab] = useState<DebugTabKey>("telegram");
  const [config, setConfig] = useState<Config | null>(null);
  const [channels, setChannels] = useState<ChannelsConfig>(DEFAULT_CHANNELS);
  const [gateway, setGateway] = useState<GatewayConfig>(DEFAULT_GATEWAY);
  const [initialJson, setInitialJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const isDirty = useMemo(
    () => JSON.stringify({ channels, gateway }) !== initialJson,
    [channels, gateway, initialJson],
  );

  const loadConfig = useCallback(async () => {
    try {
      const c = await getConfig();
      setConfig(c);
      const ch = c.channels ?? DEFAULT_CHANNELS;
      const gw = c.gateway ?? DEFAULT_GATEWAY;
      setChannels(ch);
      setGateway(gw);
      setInitialJson(
        JSON.stringify({
          channels: ch,
          gateway: gw,
        }),
      );
    } catch (e) {
      console.error("加载配置失败", e);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setMessage(null);
    try {
      await saveConfig({ ...config, channels, gateway });
      setInitialJson(
        JSON.stringify({
          channels,
          gateway,
        }),
      );
      setMessage({ type: "success", text: "渠道配置已保存" });
      setTimeout(() => setMessage(null), 3000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessage({ type: "error", text: `保存失败: ${msg}` });
    }
    setSaving(false);
  };

  const handleCancel = () => {
    if (initialJson) {
      const snapshot = JSON.parse(initialJson) as {
        channels: ChannelsConfig;
        gateway: GatewayConfig;
      };
      setChannels(snapshot.channels);
      setGateway(snapshot.gateway);
    }
  };

  if (!config) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const TAB_LABELS: Record<TabKey, string> = {
    telegram: "Telegram",
    discord: "Discord",
    feishu: "飞书",
  };
  const SUB_PAGE_LABELS: Record<ChannelSubPage, string> = {
    overview: "概览",
    config: "渠道配置",
    gateway: "网关与隧道",
    logs: "日志与调试",
  };

  const channelOverview = [
    {
      key: "telegram",
      label: "Telegram",
      enabled: channels.telegram.enabled,
      model: channels.telegram.default_model || "跟随全局默认",
    },
    {
      key: "discord",
      label: "Discord",
      enabled: channels.discord.enabled,
      model: channels.discord.default_model || "跟随全局默认",
    },
    {
      key: "feishu",
      label: "飞书",
      enabled: channels.feishu.enabled,
      model: channels.feishu.default_model || "跟随全局默认",
    },
  ];

  const subPages: Array<{
    key: ChannelSubPage;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      key: "overview",
      label: "概览",
      description: "查看渠道状态和默认模型",
      icon: LayoutDashboard,
    },
    {
      key: "config",
      label: "渠道配置",
      description: "维护 Telegram / Discord / 飞书基础参数",
      icon: SlidersHorizontal,
    },
    {
      key: "gateway",
      label: "网关与隧道",
      description: "管理公网入口与回调同步",
      icon: Network,
    },
    {
      key: "logs",
      label: "日志与调试",
      description: "tail 观察与渠道调试操作",
      icon: ScrollText,
    },
  ];

  const enabledCount = channelOverview.filter((item) => item.enabled).length;
  const currentScopeLabel =
    activeSubPage === "config"
      ? `${SUB_PAGE_LABELS[activeSubPage]} / ${TAB_LABELS[activeTab]}`
      : SUB_PAGE_LABELS[activeSubPage];

  return (
    <div className={`space-y-6 ${className || ""}`}>
      {message && (
        <div
          className={`rounded-lg border p-3 text-sm mb-4 ${
            message.type === "error"
              ? "border-destructive bg-destructive/10 text-destructive"
              : "border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="rounded-xl border bg-background/40 p-3">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
          {subPages.map((page) => {
            const Icon = page.icon;
            const isActive = activeSubPage === page.key;
            return (
              <button
                key={page.key}
                type="button"
                onClick={() => setActiveSubPage(page.key)}
                className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                  isActive
                    ? "border-primary bg-primary/10"
                    : "border-transparent hover:border-border hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{page.label}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {page.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {activeSubPage === "overview" && (
        <div className="space-y-6">
          <div className="rounded-xl border bg-background/40 p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">渠道总览</h2>
                <p className="text-xs text-muted-foreground">
                  已启用 {enabledCount} / {channelOverview.length} 个渠道
                </p>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
                建议流程：先完成「渠道配置」，再进入「网关与隧道」与「日志与调试」验证。
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              {channelOverview.map((item) => (
                <div
                  key={item.key}
                  className="rounded-lg border bg-muted/20 p-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">{item.label}</h3>
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        item.enabled
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                      }`}
                    >
                      {item.enabled ? "已启用" : "未启用"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground break-all">
                    默认模型：{item.model}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeSubPage === "config" && (
        <div className="rounded-xl border bg-background/40 p-4 md:p-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold">渠道配置</h2>
            <p className="text-xs text-muted-foreground">
              仅维护渠道基础参数，不包含运行调试操作。
            </p>
          </div>
          <div className="mb-4">
            <ConfigGuideCard
              title="配置说明（通用）"
              steps={[
                "先开启渠道开关，再填写密钥或 Token。",
                "建议先设置默认模型，避免走到全局默认导致行为不一致。",
                "点底部“保存”后，再切到“日志与调试”验证链路是否通畅。",
              ]}
              note="敏感凭证仅用于本地配置保存，排查问题时可在“日志与调试”查看网关行为。"
            />
          </div>
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as TabKey)}
            className="w-full"
          >
            <TabsList className="grid w-full max-w-md grid-cols-3">
              <TabsTrigger value="telegram">Telegram</TabsTrigger>
              <TabsTrigger value="discord">Discord</TabsTrigger>
              <TabsTrigger value="feishu">飞书</TabsTrigger>
            </TabsList>

            <TabsContent value="telegram" className="mt-5">
              <div className="space-y-4">
                <ConfigGuideCard
                  title="Telegram 配置说明"
                  steps={[
                    "在 @BotFather 创建机器人并复制 Bot Token。",
                    "如果要限制访问，填写允许的用户 ID 列表；留空表示不过滤。",
                    "建议先选默认模型，再保存并到日志页筛选 TelegramGateway 检查消息链路。",
                  ]}
                />
                <TelegramForm
                  config={channels.telegram}
                  onChange={(tg) => setChannels({ ...channels, telegram: tg })}
                />
              </div>
            </TabsContent>

            <TabsContent value="discord" className="mt-5">
              <div className="space-y-4">
                <ConfigGuideCard
                  title="Discord 配置说明"
                  steps={[
                    "在 Discord Developer Portal 创建应用并生成 Bot Token。",
                    "将 Bot 邀请到目标服务器后，按需填写允许的服务器 ID。",
                    "保存后通过日志页观察 RPC/渠道日志确认请求已进入代理链路。",
                  ]}
                />
                <DiscordForm
                  config={channels.discord}
                  onChange={(dc) => setChannels({ ...channels, discord: dc })}
                />
              </div>
            </TabsContent>

            <TabsContent value="feishu" className="mt-5">
              <div className="space-y-4">
                <ConfigGuideCard
                  title="飞书配置说明"
                  steps={[
                    "填写 App ID / App Secret，并按需设置 Verification Token 与 Encrypt Key。",
                    "连接模式优先使用 Webhook；Webhook Host/Port/Path 要与网关入口一致。",
                    "保存后建议在“网关与隧道”同步回调 URL，再到日志页筛选 FeishuGateway 验证。",
                  ]}
                />
                <FeishuForm
                  config={channels.feishu}
                  onChange={(fs) => setChannels({ ...channels, feishu: fs })}
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {activeSubPage === "gateway" && (
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-semibold">网关与隧道</h2>
            <p className="text-xs text-muted-foreground">
              统一管理公网隧道、回调同步与连通性探测。
            </p>
          </div>
          <ConfigGuideCard
            title="网关与隧道说明"
            steps={[
              "先确认本地网关地址（local host/port）可访问，再配置 tunnel 参数。",
              "Cloudflare 模式优先设置 tunnel_name 与 dns_name，再执行“创建隧道”。",
              "隧道启动后执行“同步飞书回调 URL”，确保飞书侧回调地址一致。",
            ]}
            note="建议每次变更后都先“查询状态”，再到日志页观察是否有连接异常。"
          />
          <GatewayTunnelPanel
            config={gateway}
            onChange={setGateway}
            defaultFeishuAccountId={
              channels.feishu.default_account || "default"
            }
            onReloadConfig={loadConfig}
          />
        </div>
      )}

      {activeSubPage === "logs" && (
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">渠道日志观察</h2>
              <p className="text-xs text-muted-foreground">
                支持实时 tail、过滤与清空，快速定位 TelegramGateway / RPC 问题。
              </p>
            </div>
            <ConfigGuideCard
              title="日志排查说明"
              steps={[
                "先选择过滤模式（如 TelegramGateway / RPC），缩小观察范围。",
                "遇到历史噪音可先“清空日志”，再复现问题获取干净样本。",
                "如果日志无输出，先去“运行调试”页执行状态查询确认服务已启动。",
              ]}
            />
            <ChannelLogTailPanel />
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">运行调试</h2>
              <p className="text-xs text-muted-foreground">
                用于执行渠道启停、重启、状态查询与账号探测。
              </p>
            </div>
            <div className="rounded-xl border bg-background/40 p-4">
              <Tabs
                value={activeDebugTab}
                onValueChange={(v) => setActiveDebugTab(v as DebugTabKey)}
                className="w-full"
              >
                <TabsList className="grid w-full max-w-md grid-cols-3">
                  <TabsTrigger value="telegram">Telegram</TabsTrigger>
                  <TabsTrigger value="feishu">飞书</TabsTrigger>
                  <TabsTrigger value="discord">Discord</TabsTrigger>
                </TabsList>

                <TabsContent value="telegram" className="mt-4">
                  <TelegramGatewayDebugPanel />
                </TabsContent>

                <TabsContent value="feishu" className="mt-4">
                  <FeishuGatewayDebugPanel />
                </TabsContent>

                <TabsContent value="discord" className="mt-4">
                  <DiscordGatewayDebugPanel />
                </TabsContent>
              </Tabs>
            </div>
          </section>
        </div>
      )}

      {/* 底部固定栏 */}
      {isDirty && (
        <div className="sticky bottom-0 mt-6 flex items-center justify-between rounded-lg border bg-background/95 backdrop-blur p-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 text-yellow-500" />
            <span>未保存的更改</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
              {currentScopeLabel}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm hover:bg-muted"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChannelsSettings;
