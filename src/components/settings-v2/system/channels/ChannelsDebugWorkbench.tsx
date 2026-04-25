/**
 * 渠道管理设置页面
 *
 * Telegram / Discord / 飞书 / 微信 Bot 渠道的内联表单配置
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Eye,
  EyeOff,
  Loader2,
  Save,
  RotateCcw,
  AlertCircle,
  LayoutDashboard,
  Network,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import {
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
  wechatChannelListAccounts,
  wechatChannelLoginStart,
  wechatChannelLoginWait,
  wechatChannelRemoveAccount,
  type ChannelsConfig,
  type GatewayConfig,
  type WechatBotConfig,
  type WechatConfiguredAccount,
  type WechatGatewayAccountStatus,
  type WechatGatewayStatus,
} from "@/lib/api/channelsRuntime";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { ChannelLogTailPanel } from "./ChannelLogTailPanel";
import { cn } from "@/lib/utils";
import QRCode from "qrcode";

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
  wechat: {
    enabled: false,
    bot_token: "",
    base_url: "",
    cdn_base_url: "",
    default_model: undefined,
    default_account: "default",
    accounts: {},
    dm_policy: "pairing",
    allow_from: [],
    group_policy: "allowlist",
    group_allow_from: [],
    streaming: "off",
    reply_to_mode: "off",
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

const DEFAULT_WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_WECHAT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const DEFAULT_WECHAT_BOT_TYPE = "3";
const WECHAT_RUNTIME_POLL_INTERVAL_MS = 2000;

function formatRuntimeTimestamp(timestamp?: string | null): string {
  if (!timestamp) {
    return "暂无";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString();
}

type WechatLoginWaitResultLike = {
  connected?: boolean | string | null;
  accountId?: string | null;
  account_id?: string | null;
  message?: string | null;
};

function normalizeWechatLoginWaitResult(result: unknown): {
  connected: boolean;
  accountId?: string;
  message: string;
} {
  if (!result || typeof result !== "object") {
    return {
      connected: false,
      message: "",
    };
  }

  const payload = result as WechatLoginWaitResultLike;
  const connected = payload.connected === true || payload.connected === "true";
  const accountId =
    (typeof payload.accountId === "string" && payload.accountId.trim()) ||
    (typeof payload.account_id === "string" && payload.account_id.trim()) ||
    undefined;
  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";

  return {
    connected,
    accountId,
    message,
  };
}

function normalizeChannelsConfig(
  value?: Partial<ChannelsConfig> | null,
): ChannelsConfig {
  const telegram = value?.telegram;
  const discord = value?.discord;
  const feishu = value?.feishu;
  const wechat = value?.wechat;

  return {
    telegram: {
      ...DEFAULT_CHANNELS.telegram,
      ...telegram,
      allowed_user_ids:
        telegram?.allowed_user_ids ??
        DEFAULT_CHANNELS.telegram.allowed_user_ids,
    },
    discord: {
      ...DEFAULT_CHANNELS.discord,
      ...discord,
      allowed_server_ids:
        discord?.allowed_server_ids ??
        DEFAULT_CHANNELS.discord.allowed_server_ids,
      accounts: discord?.accounts ?? DEFAULT_CHANNELS.discord.accounts,
      allow_from: discord?.allow_from ?? DEFAULT_CHANNELS.discord.allow_from,
      group_allow_from:
        discord?.group_allow_from ?? DEFAULT_CHANNELS.discord.group_allow_from,
    },
    feishu: {
      ...DEFAULT_CHANNELS.feishu,
      ...feishu,
      allow_from: feishu?.allow_from ?? DEFAULT_CHANNELS.feishu.allow_from,
      group_allow_from:
        feishu?.group_allow_from ?? DEFAULT_CHANNELS.feishu.group_allow_from,
    },
    wechat: {
      ...DEFAULT_CHANNELS.wechat,
      ...wechat,
      accounts: wechat?.accounts ?? DEFAULT_CHANNELS.wechat.accounts,
      allow_from: wechat?.allow_from ?? DEFAULT_CHANNELS.wechat.allow_from,
      group_allow_from:
        wechat?.group_allow_from ?? DEFAULT_CHANNELS.wechat.group_allow_from,
    },
  };
}

function normalizeGatewayConfig(value?: GatewayConfig | null): GatewayConfig {
  const tunnel = value?.tunnel;
  const defaultTunnel = DEFAULT_GATEWAY.tunnel ?? {};

  return {
    ...DEFAULT_GATEWAY,
    ...value,
    tunnel: {
      ...defaultTunnel,
      ...tunnel,
      cloudflare: {
        ...(defaultTunnel.cloudflare ?? {}),
        ...(tunnel?.cloudflare ?? {}),
      },
    },
  };
}

type ChannelSubPage = "gateway" | "logs";
type DebugTabKey = "telegram" | "feishu" | "discord" | "wechat";
type VisibleDebugTabKey = "telegram" | "feishu" | "wechat";

const INPUT_CLASS_NAME =
  "w-full rounded-[16px] border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-2 focus:ring-slate-200";
const MONO_INPUT_CLASS_NAME = `${INPUT_CLASS_NAME} font-mono`;
const PANEL_CLASS_NAME =
  "space-y-4 rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5";
const SOFT_CARD_CLASS_NAME =
  "rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4";
const SECTION_TABS_CLASS_NAME =
  "grid w-full max-w-2xl grid-cols-4 rounded-[18px] border border-slate-200 bg-slate-50 p-1";
const SECTION_TAB_TRIGGER_CLASS_NAME =
  "rounded-[14px] px-3 py-2 text-sm font-medium text-slate-600 transition data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm";
const ACTIVE_SUBPAGE_BUTTON_CLASS =
  "border-emerald-200 bg-[linear-gradient(135deg,rgba(240,253,250,0.98)_0%,rgba(236,253,245,0.96)_52%,rgba(224,242,254,0.95)_100%)] text-slate-800 shadow-sm shadow-emerald-950/10";
const PRIMARY_ACTION_BUTTON_CLASS =
  "flex items-center gap-1.5 rounded-full border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-4 py-2 text-sm font-medium text-white shadow-sm shadow-emerald-950/15 transition hover:opacity-95 disabled:opacity-50";

interface SurfacePanelProps {
  icon: LucideIcon;
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

function SurfacePanel({
  icon: Icon,
  title,
  description,
  aside,
  children,
  className,
}: SurfacePanelProps) {
  return (
    <article
      className={cn(
        "rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5",
        className,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
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

      <div className="mt-5">{children}</div>
    </article>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 pb-8">
      <div className="h-[108px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.16fr)_minmax(320px,0.84fr)]">
        <div className="space-y-6">
          <div className="h-[320px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
          <div className="h-[420px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        </div>
        <div className="space-y-6">
          <div className="h-[240px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
          <div className="h-[240px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        </div>
      </div>
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
      <label className="mb-1.5 block text-sm font-medium text-slate-900">
        {label}
      </label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${MONO_INPUT_CLASS_NAME} pr-10`}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint ? (
        <p className="mt-1 text-xs leading-5 text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

function GuideTipContent({
  steps,
  note,
}: {
  steps: string[];
  note?: string;
}) {
  return (
    <div className="space-y-2.5 text-sm leading-6 text-slate-600">
      <div className="space-y-2">
        {steps.map((step, index) => (
          <div
            key={step}
            className="flex gap-2"
          >
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-semibold text-slate-600">
              {index + 1}
            </span>
            <p>{step}</p>
          </div>
        ))}
      </div>
      {note ? (
        <p className="text-xs leading-5 text-slate-500">{note}</p>
      ) : null}
    </div>
  );
}

function CompactSummaryRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[18px] border border-slate-200/80 bg-slate-50/70 px-3.5 py-3">
      <p className="text-sm text-slate-500">{label}</p>
      <p
        className={cn(
          "text-right text-sm font-medium text-slate-900",
          mono && "font-mono",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function QrCodePreview({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [dataUrl, setDataUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const trimmed = value.trim();

    if (!trimmed) {
      setDataUrl("");
      setError(null);
      return;
    }

    setError(null);
    void QRCode.toDataURL(trimmed, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then((next: string) => {
        if (!cancelled) {
          setDataUrl(next);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setDataUrl("");
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  if (error) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center rounded-[16px] border border-rose-200 bg-rose-50 px-4 text-center text-xs leading-5 text-rose-700",
          className,
        )}
      >
        二维码生成失败：{error}
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center rounded-[16px] border border-slate-200 bg-slate-50 px-4 text-center text-xs leading-5 text-slate-500",
          className,
        )}
      >
        正在生成二维码...
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt="微信扫码二维码"
      className={cn("h-full w-full object-contain", className)}
    />
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
    <div className={PANEL_CLASS_NAME}>
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
            placeholder="lime-gateway"
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
    <div className={PANEL_CLASS_NAME}>
      <div>
        <h3 className="text-sm font-medium">Telegram Gateway 运行控制</h3>
        <p className="text-xs text-muted-foreground">
          用于状态查询、启停和重启；连通性检测已并入上方 IM 配置弹窗。
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
    <div className={PANEL_CLASS_NAME}>
      <div>
        <h3 className="text-sm font-medium">Feishu Gateway 运行控制</h3>
        <p className="text-xs text-muted-foreground">
          用于状态查询、启停和重启；连通性检测已并入上方 IM 配置弹窗。
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

function WechatGatewayDebugPanel({
  config,
  onReloadConfig,
}: {
  config: WechatBotConfig;
  onReloadConfig: () => Promise<void>;
}) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(
    config.default_account || "default",
  );
  const [pollTimeoutSecs, setPollTimeoutSecs] = useState("25");
  const [baseUrl, setBaseUrl] = useState(
    config.base_url || DEFAULT_WECHAT_BASE_URL,
  );
  const [botType, setBotType] = useState(DEFAULT_WECHAT_BOT_TYPE);
  const [loginSessionKey, setLoginSessionKey] = useState("");
  const [loginTimeoutMs, setLoginTimeoutMs] = useState("480000");
  const [accountName, setAccountName] = useState("");
  const [purgeDataOnRemove, setPurgeDataOnRemove] = useState(false);
  const [accounts, setAccounts] = useState<WechatConfiguredAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [runtimeStatus, setRuntimeStatus] =
    useState<WechatGatewayStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [output, setOutput] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const autoWaitSessionKeyRef = useRef<string | null>(null);
  const loginAttemptStartedAtRef = useRef<number | null>(null);
  const loginAttemptAccountIdsRef = useRef<Set<string>>(new Set());

  const runtimeAccountsById = useMemo(() => {
    const map = new Map<string, WechatGatewayAccountStatus>();
    for (const item of runtimeStatus?.accounts ?? []) {
      map.set(item.accountId, item);
    }
    return map;
  }, [runtimeStatus]);

  useEffect(() => {
    const configuredIds = accounts.map((item) => item.accountId);
    const normalized = accountId.trim();

    if (!configuredIds.length) {
      if (!normalized) {
        setAccountId(config.default_account || "default");
      }
      return;
    }

    const preferred =
      (config.default_account && configuredIds.includes(config.default_account)
        ? config.default_account
        : configuredIds[0]) || "default";

    if (
      !normalized ||
      normalized === "default" ||
      !configuredIds.includes(normalized)
    ) {
      setAccountId(preferred);
    }
  }, [accounts, config.default_account, accountId]);

  useEffect(() => {
    if (!baseUrl.trim()) {
      setBaseUrl(config.base_url || DEFAULT_WECHAT_BASE_URL);
    }
  }, [config.base_url, baseUrl]);

  const loadAccounts = useCallback(async (writeOutput = false) => {
    const result = await wechatChannelListAccounts();
    setAccounts(result);
    setAccountsLoaded(true);
    if (writeOutput) {
      setOutput(JSON.stringify(result, null, 2));
    }
    return result;
  }, []);

  const loadRuntimeStatus = useCallback(async (writeOutput = false) => {
    const result = await gatewayChannelStatus({ channel: "wechat" });
    const nextStatus = (result.status ?? null) as WechatGatewayStatus | null;
    setRuntimeStatus(nextStatus);
    setRuntimeError(null);
    if (writeOutput) {
      setOutput(JSON.stringify(result, null, 2));
    }
    return result;
  }, []);

  useEffect(() => {
    void loadAccounts(false);
  }, [loadAccounts]);

  useEffect(() => {
    void loadRuntimeStatus(false);
  }, [loadRuntimeStatus]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const [nextAccounts, nextStatus] = await Promise.all([
          wechatChannelListAccounts(),
          gatewayChannelStatus({ channel: "wechat" }),
        ]);
        if (cancelled) {
          return;
        }
        setAccounts(nextAccounts);
        setAccountsLoaded(true);
        setRuntimeStatus(
          (nextStatus.status ?? null) as WechatGatewayStatus | null,
        );
        setRuntimeError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const text = error instanceof Error ? error.message : String(error);
        setRuntimeError(text);
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, WECHAT_RUNTIME_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const resolveAccountId = () => {
    const normalized = accountId.trim();
    return normalized.length > 0 ? normalized : undefined;
  };

  const resolvePollTimeoutSecs = useCallback(() => {
    const parsed = Number.parseInt(pollTimeoutSecs.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return undefined;
    }
    return parsed;
  }, [pollTimeoutSecs]);

  const resolveBaseUrl = useCallback(() => {
    const normalized = baseUrl.trim();
    return normalized.length > 0 ? normalized : undefined;
  }, [baseUrl]);

  const resolveBotType = useCallback(() => {
    const normalized = botType.trim();
    return normalized.length > 0 ? normalized : undefined;
  }, [botType]);

  const resolveLoginTimeoutMs = useCallback(() => {
    const parsed = Number.parseInt(loginTimeoutMs.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return undefined;
    }
    return parsed;
  }, [loginTimeoutMs]);

  const clearPendingLoginState = useCallback((nextAccountId?: string) => {
    setQrCodeUrl("");
    setLoginSessionKey("");
    autoWaitSessionKeyRef.current = null;
    loginAttemptStartedAtRef.current = null;
    loginAttemptAccountIdsRef.current = new Set();
    if (nextAccountId?.trim()) {
      setAccountId(nextAccountId.trim());
    }
  }, []);

  const startLogin = useCallback(async () => {
    loginAttemptStartedAtRef.current = Date.now();
    loginAttemptAccountIdsRef.current = new Set(
      accounts.map((item) => item.accountId),
    );
    const result = await wechatChannelLoginStart({
      baseUrl: resolveBaseUrl(),
      botType: resolveBotType(),
      sessionKey: loginSessionKey.trim() || undefined,
    });
    const qrPayload = result.qrcodeUrl?.trim();
    if (!qrPayload) {
      throw new Error(result.message || "微信接口未返回可用二维码");
    }
    setLoginSessionKey(result.sessionKey);
    setQrCodeUrl(qrPayload);
    return result;
  }, [accounts, loginSessionKey, resolveBaseUrl, resolveBotType]);

  const finalizeLoginSuccess = useCallback(
    async (rawResult: unknown) => {
      const result = normalizeWechatLoginWaitResult(rawResult);
      if (!result.connected) {
        return;
      }

      const nextAccountId = result.accountId || accountId.trim() || "default";
      clearPendingLoginState(nextAccountId);
      await loadAccounts(false);
      await onReloadConfig();
      const startResult = await gatewayChannelStart({
        channel: "wechat",
        accountId: nextAccountId,
        pollTimeoutSecs: resolvePollTimeoutSecs(),
      });
      setOutput(
        JSON.stringify(
          {
            login: rawResult,
            start: startResult,
          },
          null,
          2,
        ),
      );
    },
    [
      accountId,
      clearPendingLoginState,
      loadAccounts,
      onReloadConfig,
      resolvePollTimeoutSecs,
    ],
  );

  const waitForLoginResult = useCallback(
    async (sessionKeyOverride?: string) => {
      const sessionKey = (sessionKeyOverride || loginSessionKey).trim();
      if (!sessionKey) {
        throw new Error("请先生成二维码，或填写已有 session_key");
      }

      return wechatChannelLoginWait({
        sessionKey,
        baseUrl: resolveBaseUrl(),
        botType: resolveBotType(),
        timeoutMs: resolveLoginTimeoutMs(),
        accountName: accountName.trim() || undefined,
      });
    },
    [
      accountName,
      loginSessionKey,
      resolveBaseUrl,
      resolveBotType,
      resolveLoginTimeoutMs,
    ],
  );

  const runAction = async (
    action: string,
    executor: () => Promise<unknown>,
    successText: string,
    afterSuccess?: (result: unknown) => Promise<void>,
  ) => {
    setBusyAction(action);
    setMessage(null);
    try {
      const result = await executor();
      setOutput(JSON.stringify(result, null, 2));
      if (afterSuccess) {
        await afterSuccess(result);
      }
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

  useEffect(() => {
    if (!accountsLoaded || accounts.length > 0 || qrCodeUrl || busyAction) {
      return;
    }

    let cancelled = false;

    const bootstrap = async () => {
      setBusyAction("login_start");
      setMessage(null);
      try {
        const result = await startLogin();
        if (cancelled) {
          return;
        }
        setOutput(JSON.stringify(result, null, 2));
        setMessage({
          type: "success",
          text: "已自动生成首张二维码，可直接扫码登录",
        });
        setTimeout(() => setMessage(null), 2500);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const text = error instanceof Error ? error.message : String(error);
        setOutput(
          JSON.stringify(
            { action: "login_start", ok: false, error: text },
            null,
            2,
          ),
        );
        setMessage({ type: "error", text: `二维码生成失败: ${text}` });
      } finally {
        if (!cancelled) {
          setBusyAction(null);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [accounts.length, accountsLoaded, busyAction, qrCodeUrl, startLogin]);

  useEffect(() => {
    const sessionKey = loginSessionKey.trim();
    if (!qrCodeUrl || !sessionKey) {
      return;
    }
    if (autoWaitSessionKeyRef.current === sessionKey) {
      return;
    }

    autoWaitSessionKeyRef.current = sessionKey;
    let cancelled = false;

    const autoWait = async () => {
      setBusyAction("login_wait");
      setMessage({
        type: "success",
        text: "二维码已生成，正在后台等待扫码确认",
      });
      try {
        const result = await waitForLoginResult(sessionKey);
        if (cancelled) {
          return;
        }
        setOutput(JSON.stringify(result, null, 2));
        await finalizeLoginSuccess(result);
        const normalizedResult = normalizeWechatLoginWaitResult(result);
        if (normalizedResult.connected) {
          setMessage({
            type: "success",
            text: "微信登录成功，网关已自动启动",
          });
          setTimeout(() => setMessage(null), 2500);
        } else {
          setMessage({
            type: "error",
            text: normalizedResult.message || "微信登录未完成",
          });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const text = error instanceof Error ? error.message : String(error);
        setOutput(
          JSON.stringify(
            { action: "login_wait", ok: false, error: text },
            null,
            2,
          ),
        );
        setMessage({ type: "error", text: `等待登录失败: ${text}` });
      } finally {
        if (!cancelled) {
          setBusyAction(null);
        }
        if (autoWaitSessionKeyRef.current === sessionKey) {
          autoWaitSessionKeyRef.current = null;
        }
      }
    };

    void autoWait();

    return () => {
      cancelled = true;
    };
  }, [finalizeLoginSuccess, loginSessionKey, qrCodeUrl, waitForLoginResult]);

  useEffect(() => {
    const sessionKey = loginSessionKey.trim();
    const loginAttemptStartedAt = loginAttemptStartedAtRef.current;
    if (!qrCodeUrl || !sessionKey || !loginAttemptStartedAt) {
      return;
    }

    const knownAccountIds = loginAttemptAccountIdsRef.current;
    const detectedAccountId = accounts.find(
      (item) => !knownAccountIds.has(item.accountId),
    )?.accountId;
    const normalizedTargetAccountId = accountId.trim();
    const hasFreshRuntimeAccount = (runtimeStatus?.accounts ?? []).some(
      (item) => {
        if (!item.running) {
          return false;
        }
        if (
          normalizedTargetAccountId &&
          normalizedTargetAccountId !== "default" &&
          item.accountId !== normalizedTargetAccountId
        ) {
          return false;
        }
        if (!item.startedAt) {
          return false;
        }
        const startedAt = Date.parse(item.startedAt);
        return (
          Number.isFinite(startedAt) &&
          startedAt >= loginAttemptStartedAt - 5_000
        );
      },
    );

    if (!detectedAccountId && !hasFreshRuntimeAccount) {
      return;
    }

    clearPendingLoginState(detectedAccountId);
    void onReloadConfig();
  }, [
    accountId,
    accounts,
    clearPendingLoginState,
    loginSessionKey,
    onReloadConfig,
    qrCodeUrl,
    runtimeStatus,
  ]);

  const handleRemoveAccount = async (targetAccountId: string) => {
    const normalized = targetAccountId.trim();
    if (!normalized) {
      return;
    }

    const confirmed = window.confirm(
      [
        "⚠️ 危险操作检测！",
        `操作类型：删除微信账号 ${normalized}${purgeDataOnRemove ? " 并清理本地数据" : ""}`,
        `影响范围：将停止该账号的微信网关实例，并从渠道配置中移除该账号${purgeDataOnRemove ? "，同时删除本地缓存与同步状态" : ""}`,
        `风险评估：删除后需要重新扫码或手动恢复配置${purgeDataOnRemove ? "，本地数据不可恢复" : ""}`,
        "",
        "请确认是否继续？",
      ].join("\n"),
    );
    if (!confirmed) {
      return;
    }

    await runAction(
      "remove_account",
      async () => {
        await wechatChannelRemoveAccount({
          accountId: normalized,
          purgeData: purgeDataOnRemove,
        });
        return {
          ok: true,
          accountId: normalized,
          purgeData: purgeDataOnRemove,
        };
      },
      "微信账号已删除",
      async () => {
        await loadAccounts(true);
        await onReloadConfig();
        setAccountId((current) =>
          current.trim() === normalized
            ? config.default_account || "default"
            : current,
        );
      },
    );
  };

  const busy = busyAction !== null;

  return (
    <div className={PANEL_CLASS_NAME}>
      <div>
        <h3 className="text-sm font-medium">微信 Gateway 运行控制</h3>
        <p className="text-xs text-muted-foreground">
          默认保留状态查询、启停与账号清理；扫码和连通性检测已并入上方 IM
          配置弹窗。
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

      <div className={`${SOFT_CARD_CLASS_NAME} space-y-3`}>
        <div>
          <h4 className="text-sm font-medium text-slate-900">运行控制</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            账号 ID 留空时按默认配置解析；多账号场景建议显式指定。
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
            <span className="text-xs text-muted-foreground">
              轮询超时（秒）
            </span>
            <input
              value={pollTimeoutSecs}
              onChange={(event) => setPollTimeoutSecs(event.target.value)}
              placeholder="25"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Base URL</span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={DEFAULT_WECHAT_BASE_URL}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm font-mono"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              void runAction(
                "status",
                async () => gatewayChannelStatus({ channel: "wechat" }),
                "Gateway 状态已刷新",
              )
            }
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            查询状态
          </button>
          <button
            type="button"
            onClick={() =>
              void runAction(
                "list_accounts",
                async () => loadAccounts(false),
                "微信账号列表已刷新",
              )
            }
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            列出账号
          </button>
          <button
            type="button"
            onClick={() =>
              void runAction(
                "start",
                async () =>
                  gatewayChannelStart({
                    channel: "wechat",
                    accountId: resolveAccountId(),
                    pollTimeoutSecs: resolvePollTimeoutSecs(),
                  }),
                "Gateway 已启动",
              )
            }
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
                    channel: "wechat",
                    accountId: resolveAccountId(),
                  }),
                "Gateway 已停止",
              )
            }
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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
                      channel: "wechat",
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
                    channel: "wechat",
                    accountId: resolveAccountId(),
                    pollTimeoutSecs: resolvePollTimeoutSecs(),
                  });
                  const statusResult = await gatewayChannelStatus({
                    channel: "wechat",
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
            className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            重启
          </button>
        </div>
      </div>

      <details className={`${SOFT_CARD_CLASS_NAME} group`}>
        <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-medium text-slate-900">兼容扫码排障</h4>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              只有当上方 IM 配置里的扫码流程异常时，再展开这里做兼容排查。
            </p>
          </div>
          <span className="text-xs text-slate-400 transition group-open:rotate-90">
            ›
          </span>
        </summary>

        <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Bot Type</span>
              <input
                value={botType}
                onChange={(event) => setBotType(event.target.value)}
                placeholder={DEFAULT_WECHAT_BOT_TYPE}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">
                登录超时（毫秒）
              </span>
              <input
                value={loginTimeoutMs}
                onChange={(event) => setLoginTimeoutMs(event.target.value)}
                placeholder="480000"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-muted-foreground">
                Session Key（可选，留空自动生成）
              </span>
              <input
                value={loginSessionKey}
                onChange={(event) => setLoginSessionKey(event.target.value)}
                placeholder="自动生成"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm font-mono"
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-muted-foreground">
                登录后保存的账号名称（可选）
              </span>
              <input
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                placeholder="运营微信 / 小助手"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void runAction("login_start", startLogin, "二维码已生成")
              }
              disabled={busy}
              className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              生成二维码
            </button>
            <button
              type="button"
              onClick={() =>
                void runAction(
                  "login_wait",
                  waitForLoginResult,
                  "登录结果已返回",
                  finalizeLoginSuccess,
                )
              }
              disabled={busy}
              className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              等待登录结果
            </button>
          </div>

          {qrCodeUrl ? (
            <div className="rounded-[18px] border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start">
                <div className="flex h-48 w-48 shrink-0 items-center justify-center rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                  <QrCodePreview value={qrCodeUrl} />
                </div>
                <div className="space-y-2 text-sm text-slate-500">
                  <p className="font-medium text-slate-900">当前二维码已就绪</p>
                  <p className="leading-6">
                    请使用微信扫码并在手机上确认连接。当前页面会自动等待登录完成并写回配置。
                  </p>
                  <p className="text-xs leading-5 text-slate-500">
                    当前页面会把微信返回的二维码内容本地转码显示，不依赖远程图片加载。
                  </p>
                  <p className="text-xs leading-5 text-slate-500">
                    session_key：{loginSessionKey || "未生成"}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[18px] border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
              <p className="font-medium text-slate-900">
                当前还没有可扫码二维码
              </p>
              <p className="mt-2 leading-6">
                请先点击“生成二维码”。如果接口没有返回二维码内容，下面的“最近结果”会直接显示错误原因。
              </p>
            </div>
          )}
        </div>
      </details>

      <div className={`${SOFT_CARD_CLASS_NAME} space-y-3`}>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h4 className="text-sm font-medium text-slate-900">已配置账号</h4>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              这里展示扫码写入或手工配置后实际可见的微信账号目录。
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={purgeDataOnRemove}
              onChange={(event) => setPurgeDataOnRemove(event.target.checked)}
            />
            删除时清理本地缓存数据
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">
            运行中账号：{runtimeStatus?.running_accounts ?? 0}
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">
            已配置账号：{accounts.length}
          </span>
          {runtimeError ? (
            <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-rose-700">
              状态轮询失败：{runtimeError}
            </span>
          ) : null}
        </div>

        {accounts.length > 0 ? (
          <div className="grid gap-3">
            {accounts.map((item) => {
              const runtime = runtimeAccountsById.get(item.accountId);
              return (
                <div
                  key={item.accountId}
                  className="rounded-[18px] border border-slate-200 bg-white p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          {item.name || item.accountId}
                        </p>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                          {item.accountId}
                        </span>
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                            item.enabled
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-slate-50 text-slate-500",
                          )}
                        >
                          {item.enabled ? "已启用" : "已禁用"}
                        </span>
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                            runtime?.running
                              ? "border-sky-200 bg-sky-50 text-sky-700"
                              : "border-slate-200 bg-slate-50 text-slate-500",
                          )}
                        >
                          {runtime?.running ? "运行中" : "未运行"}
                        </span>
                      </div>
                      <div className="grid gap-1 text-xs leading-5 text-slate-500">
                        <p>Token：{item.hasToken ? "已保存" : "未保存"}</p>
                        <p>
                          Base URL：
                          {item.baseUrl ||
                            config.base_url ||
                            DEFAULT_WECHAT_BASE_URL}
                        </p>
                        <p>
                          CDN URL：
                          {item.cdnBaseUrl ||
                            config.cdn_base_url ||
                            DEFAULT_WECHAT_CDN_BASE_URL}
                        </p>
                        <p>扫码用户 ID：{item.scannerUserId || "未记录"}</p>
                        <p>
                          最近轮询：
                          {formatRuntimeTimestamp(runtime?.lastUpdateAt)}
                        </p>
                        <p>
                          最近消息：
                          {formatRuntimeTimestamp(runtime?.lastMessageAt)}
                        </p>
                        <p>
                          Sync Buf：
                          {runtime?.syncBufPresent ? "已存在" : "暂无"}
                        </p>
                        {runtime?.lastError ? (
                          <p className="text-rose-600">
                            最近错误：{runtime.lastError}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAccountId(item.accountId)}
                        className="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-slate-50"
                      >
                        设为当前账号
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemoveAccount(item.accountId)}
                        disabled={busy}
                        className="rounded-md border border-rose-200 px-3 py-1.5 text-xs text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        删除账号
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            还没有微信账号。可以先去上方微信配置扫码接入；只有主流程异常时再用这里的兼容扫码排障。
          </p>
        )}
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
// 主组件
// ============================================================================

export interface ChannelsDebugWorkbenchProps {
  className?: string;
  onConfigSaved?: () => void;
  initialTab?: "telegram" | "discord" | "feishu" | "wechat";
  initialSubPage?: "overview" | "config" | ChannelSubPage;
  initialDebugTab?: "telegram" | "discord" | "feishu" | "wechat";
}

function normalizeVisibleDebugTab(tab?: DebugTabKey): VisibleDebugTabKey {
  if (tab === "feishu" || tab === "wechat") {
    return tab;
  }
  return "telegram";
}

export function ChannelsDebugWorkbench({
  className,
  onConfigSaved,
  initialSubPage = "logs",
  initialDebugTab = "telegram",
}: ChannelsDebugWorkbenchProps) {
  const normalizedInitialSubPage: ChannelSubPage =
    initialSubPage === "overview" || initialSubPage === "config"
      ? "logs"
      : initialSubPage;
  const [activeSubPage, setActiveSubPage] = useState<ChannelSubPage>(
    normalizedInitialSubPage,
  );
  const [activeDebugTab, setActiveDebugTab] = useState<VisibleDebugTabKey>(
    normalizeVisibleDebugTab(initialDebugTab),
  );
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
      const normalizedChannels = normalizeChannelsConfig(c.channels);
      const normalizedGateway = normalizeGatewayConfig(c.gateway);
      setConfig(c);
      setChannels(normalizedChannels);
      setGateway(normalizedGateway);
      setInitialJson(
        JSON.stringify({
          channels: normalizedChannels,
          gateway: normalizedGateway,
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
      setMessage({ type: "success", text: "日志与检查配置已保存" });
      onConfigSaved?.();
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
      setChannels(normalizeChannelsConfig(snapshot.channels));
      setGateway(normalizeGatewayConfig(snapshot.gateway));
    }
  };

  if (!config) {
    return <LoadingSkeleton />;
  }

  const SUB_PAGE_LABELS: Record<ChannelSubPage, string> = {
    gateway: "网关",
    logs: "日志",
  };

  const subPages: Array<{
    key: ChannelSubPage;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      key: "gateway",
      label: "网关",
      description: "公网入口与回调同步",
      icon: Network,
    },
    {
      key: "logs",
      label: "日志",
      description: "日志与运行排障",
      icon: ScrollText,
    },
  ];

  const tunnelEnabled = gateway.tunnel?.enabled === true;
  const currentScopeLabel = SUB_PAGE_LABELS[activeSubPage];

  return (
    <div className={cn("space-y-6 pb-8", className)}>
      {message && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-[20px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
            message.type === "error"
              ? "border-rose-200 bg-rose-50/90 text-rose-700"
              : "border-emerald-200 bg-emerald-50/90 text-emerald-700",
          )}
        >
          <AlertCircle className="h-4 w-4" />
          {message.text}
        </div>
      )}

      <SurfacePanel
        icon={LayoutDashboard}
        title="日志与检查"
        description="这里只保留网关、日志和运行检查。"
        aside={
          <>
            <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
              当前查看：{currentScopeLabel}
            </span>
            <WorkbenchInfoTip
              ariaLabel="日志与检查范围说明"
              label="收口说明"
              tone="slate"
              variant="pill"
              align="end"
              content={
                <GuideTipContent
                  steps={[
                    "旧的概览与配置入口已统一收口到这里，避免在多个子页重复暴露同类入口。",
                    "网关页用于处理公网入口、隧道与回调同步；日志页用于观察日志、启停与状态查询。",
                    "配置表单不再作为主入口展示，排障时优先在这里完成状态确认与问题复现。",
                  ]}
                />
              }
            />
          </>
        }
      >
        <div className="flex flex-wrap gap-2.5">
          {subPages.map((page) => {
            const Icon = page.icon;
            const isActive = activeSubPage === page.key;
            return (
              <button
                key={page.key}
                type="button"
                onClick={() => setActiveSubPage(page.key)}
                className={cn(
                  "group flex min-w-[220px] flex-1 items-center gap-3 rounded-[18px] border px-3.5 py-3 text-left transition",
                  isActive
                    ? ACTIVE_SUBPAGE_BUTTON_CLASS
                    : "border-slate-200/80 bg-slate-50/60 text-slate-700 hover:border-slate-300 hover:bg-white",
                )}
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border",
                    isActive
                      ? "border-emerald-200 bg-white/85 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-700",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      isActive ? "text-slate-900" : "text-slate-900",
                    )}
                  >
                    {page.label}
                  </p>
                  <p
                    className={cn(
                      "text-xs leading-5",
                      isActive ? "text-slate-600" : "text-slate-500",
                    )}
                  >
                    {page.description}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    isActive
                      ? "border-emerald-200 bg-white/90 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-500",
                  )}
                >
                  {isActive ? "当前" : "切换"}
                </span>
              </button>
            );
          })}
        </div>
      </SurfacePanel>

      {activeSubPage === "gateway" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)]">
          <SurfacePanel
            icon={Network}
            title="网关与隧道"
            description="统一管理公网隧道、回调同步与连通性探测。"
            aside={
              <>
                <span
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium",
                    tunnelEnabled
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-100 text-slate-500",
                  )}
                >
                  {tunnelEnabled ? "隧道已启用" : "隧道未启用"}
                </span>
                <WorkbenchInfoTip
                  ariaLabel="网关与隧道配置步骤"
                  label="配置步骤"
                  tone="slate"
                  variant="pill"
                  align="end"
                  content={
                    <GuideTipContent
                      steps={[
                        "先确认本地网关地址（local host/port）可访问，再配置 tunnel 参数。",
                        "Cloudflare 模式优先设置 tunnel_name 与 dns_name，再执行“创建隧道”。",
                        "隧道启动后执行“同步飞书回调 URL”，确保飞书侧回调地址一致。",
                      ]}
                      note="建议每次变更后都先“查询状态”，再到日志页观察是否有连接异常。"
                    />
                  }
                />
              </>
            }
          >
            <GatewayTunnelPanel
              config={gateway}
              onChange={setGateway}
              defaultFeishuAccountId={
                channels.feishu.default_account || "default"
              }
              onReloadConfig={loadConfig}
            />
          </SurfacePanel>

          <SurfacePanel
            icon={LayoutDashboard}
            title="当前摘要"
            description="快速核对当前 tunnel 关键参数。"
          >
            <div className="space-y-2.5">
              <CompactSummaryRow
                label="本地入口"
                value={`${gateway.tunnel?.local_host || "127.0.0.1"}:${gateway.tunnel?.local_port ?? 3000}`}
                mono
              />
              <CompactSummaryRow
                label="Tunnel 模式"
                value={`${gateway.tunnel?.provider || "cloudflare"} / ${gateway.tunnel?.mode || "managed"}`}
              />
              <CompactSummaryRow
                label="飞书默认账号"
                value={channels.feishu.default_account || "default"}
                mono
              />
            </div>
          </SurfacePanel>
        </div>
      )}

      {activeSubPage === "logs" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)]">
          <SurfacePanel
            icon={ScrollText}
            title="日志"
            description="观察渠道网关 / RPC 日志。"
            aside={
              <WorkbenchInfoTip
                ariaLabel="日志排查说明"
                label="排查说明"
                tone="slate"
                variant="pill"
                align="end"
                content={
                  <GuideTipContent
                    steps={[
                      "先选择过滤模式（如 TelegramGateway / WechatGateway / RPC），缩小观察范围。",
                      "遇到历史噪音可先“清空日志”，再复现问题获取干净样本。",
                      "如果日志无输出，先去“运行”页执行状态查询确认服务已启动。",
                    ]}
                  />
                }
              />
            }
          >
            <ChannelLogTailPanel />
          </SurfacePanel>

          <SurfacePanel
            icon={Network}
            title="运行"
            description="启停、状态与兼容排障。"
          >
            <Tabs
              value={activeDebugTab}
              onValueChange={(v) => setActiveDebugTab(v as VisibleDebugTabKey)}
              className="w-full"
            >
              <TabsList className={SECTION_TABS_CLASS_NAME}>
                <TabsTrigger
                  value="telegram"
                  className={SECTION_TAB_TRIGGER_CLASS_NAME}
                >
                  Telegram
                </TabsTrigger>
                <TabsTrigger
                  value="feishu"
                  className={SECTION_TAB_TRIGGER_CLASS_NAME}
                >
                  飞书
                </TabsTrigger>
                <TabsTrigger
                  value="wechat"
                  className={SECTION_TAB_TRIGGER_CLASS_NAME}
                >
                  微信
                </TabsTrigger>
              </TabsList>

              <TabsContent value="telegram" className="mt-4">
                <TelegramGatewayDebugPanel />
              </TabsContent>

              <TabsContent value="feishu" className="mt-4">
                <FeishuGatewayDebugPanel />
              </TabsContent>

              <TabsContent value="wechat" className="mt-4">
                <WechatGatewayDebugPanel
                  config={channels.wechat}
                  onReloadConfig={loadConfig}
                />
              </TabsContent>
            </Tabs>
          </SurfacePanel>
        </div>
      )}

      {/* 底部固定栏 */}
      {isDirty && (
        <div className="sticky bottom-0 mt-6 flex flex-col gap-3 rounded-[22px] border border-slate-200/80 bg-white/95 p-4 shadow-lg shadow-slate-950/10 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 text-yellow-500" />
            <span>未保存的更改</span>
            <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
              {currentScopeLabel}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={PRIMARY_ACTION_BUTTON_CLASS}
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
