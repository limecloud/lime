import { t } from "i18next";
import { useTranslation } from "react-i18next";
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
  Bot,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  ScanQrCode,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import QRCode from "qrcode";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/Modal";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useConfiguredProviders } from "@/hooks/useConfiguredProviders";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import {
  feishuChannelProbe,
  gatewayChannelStart,
  telegramChannelProbe,
  wechatChannelListAccounts,
  wechatChannelLoginStart,
  wechatChannelLoginWait,
  wechatChannelProbe,
  type ChannelsConfig,
  type FeishuBotConfig,
  type TelegramBotConfig,
  type WechatBotConfig,
  type WechatConfiguredAccount,
  type WechatLoginWaitResult,
} from "@/lib/api/channelsRuntime";
import {
  filterProviderModelsByCompatibility,
  getProviderModelCompatibilityIssue,
} from "@/components/agent/chat/utils/providerModelCompatibility";
import { cn } from "@/lib/utils";

const ChannelsDebugWorkbench = lazy(() =>
  import("@/components/settings-v2/system/channels/ChannelsDebugWorkbench").then(
    (module) => ({
      default: module.ChannelsDebugWorkbench,
    }),
  ),
);

type FlashMessage = {
  type: "success" | "error";
  text: string;
} | null;

type ManagedChannel = "telegram" | "feishu" | "wechat";

const DEFAULT_WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_WECHAT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const DEFAULT_WECHAT_BOT_TYPE = "3";

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

function normalizeChannelsConfig(
  input?: Partial<ChannelsConfig>,
): ChannelsConfig {
  return {
    telegram: {
      ...DEFAULT_CHANNELS.telegram,
      ...(input?.telegram ?? {}),
      allowed_user_ids:
        input?.telegram?.allowed_user_ids ??
        DEFAULT_CHANNELS.telegram.allowed_user_ids,
    },
    discord: {
      ...DEFAULT_CHANNELS.discord,
      ...(input?.discord ?? {}),
      accounts: input?.discord?.accounts ?? DEFAULT_CHANNELS.discord.accounts,
      allow_from:
        input?.discord?.allow_from ?? DEFAULT_CHANNELS.discord.allow_from,
      group_allow_from:
        input?.discord?.group_allow_from ??
        DEFAULT_CHANNELS.discord.group_allow_from,
    },
    feishu: {
      ...DEFAULT_CHANNELS.feishu,
      ...(input?.feishu ?? {}),
      allow_from:
        input?.feishu?.allow_from ?? DEFAULT_CHANNELS.feishu.allow_from,
      group_allow_from:
        input?.feishu?.group_allow_from ??
        DEFAULT_CHANNELS.feishu.group_allow_from,
      groups: input?.feishu?.groups ?? DEFAULT_CHANNELS.feishu.groups,
    },
    wechat: {
      ...DEFAULT_CHANNELS.wechat,
      ...(input?.wechat ?? {}),
      accounts: input?.wechat?.accounts ?? DEFAULT_CHANNELS.wechat.accounts,
      allow_from:
        input?.wechat?.allow_from ?? DEFAULT_CHANNELS.wechat.allow_from,
      group_allow_from:
        input?.wechat?.group_allow_from ??
        DEFAULT_CHANNELS.wechat.group_allow_from,
      groups: input?.wechat?.groups ?? DEFAULT_CHANNELS.wechat.groups,
    },
  };
}

function describeDmPolicy(policy?: string): string {
  switch ((policy || "").trim().toLowerCase()) {
    case "open":
      return t("settings:settings.channels.config.open");
    case "allowlist":
      return t("settings:settings.channels.config.allowlist");
    case "pairing":
      return t("settings:settings.channels.config.pairing");
    case "disabled":
      return t("settings:settings.computerUse.status.disabled");
    default:
      return t("settings:settings.channels.config.unset");
  }
}

function describeTelegramScope(config: TelegramBotConfig): string {
  return config.allowed_user_ids.length === 0
    ? t("settings:settings.channels.config.anyUser")
    : t("settings:settings.channels.config.limitedUsers", {
        count: config.allowed_user_ids.length,
      });
}

function describeWechatStatus(config: WechatBotConfig): string {
  const accountCount = Object.keys(config.accounts ?? {}).length;
  if (!config.enabled) {
    return t("settings:settings.channels.config.notEnabled");
  }
  if (accountCount === 0) {
    return t("settings:settings.channels.config.awaitingScan");
  }
  return t("settings:settings.channels.config.accountCount", {
    count: accountCount,
  });
}

function describeWechatAccountModel(account: {
  default_model?: string;
}): string {
  return (
    account.default_model?.trim() ||
    t("settings:settings.channels.config.globalModel")
  );
}

function describeWechatAccountRoute(
  account: {
    base_url?: string;
  },
  fallbackBaseUrl?: string,
): string {
  const accountBaseUrl = account.base_url?.trim();
  const normalizedFallback = fallbackBaseUrl?.trim();
  if (!accountBaseUrl || accountBaseUrl === normalizedFallback) {
    return t("settings:settings.channels.config.defaultAddress");
  }
  return t("settings:settings.channels.config.customAddress");
}

function normalizeConnectionMode(value?: string): "webhook" | "websocket" {
  return (value || "").trim().toLowerCase() === "websocket"
    ? "websocket"
    : "webhook";
}

function normalizeStreamingMode(value?: string): "partial" | "block" | "off" {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "block" || normalized === "off") {
    return normalized;
  }
  return "partial";
}

function normalizeReplyToMode(value?: string): "off" | "first" | "all" {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "first" || normalized === "all") {
    return normalized;
  }
  return "off";
}

function normalizeWechatGroupPolicy(
  value?: string,
): "allowlist" | "open" | "disabled" {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "open" || normalized === "disabled") {
    return normalized;
  }
  return "allowlist";
}

function maskMiddle(value: string, keep = 4): string {
  const trimmed = value.trim();
  if (trimmed.length <= keep * 2) {
    return trimmed || t("settings:settings.channels.config.empty");
  }
  return `${trimmed.slice(0, keep)}...${trimmed.slice(-keep)}`;
}

function buildNextConfig(
  currentConfig: Config | null,
  channels: ChannelsConfig,
): Config {
  return {
    ...(currentConfig ?? ({} as Config)),
    channels,
  } as Config;
}

function SectionMessage({ message }: { message: FlashMessage }) {
  if (!message) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        message.type === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-rose-200 bg-rose-50 text-rose-700",
      )}
    >
      {message.text}
    </div>
  );
}

function StatusBadge({
  tone,
  children,
}: {
  tone: "success" | "warning" | "neutral";
  children: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        tone === "success" &&
          "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200",
        tone === "warning" &&
          "bg-amber-100 text-amber-700 ring-1 ring-amber-200",
        tone === "neutral" &&
          "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
      )}
    >
      {children}
    </span>
  );
}

function ActionButton({
  kind = "secondary",
  onClick,
  children,
  disabled,
  type = "button",
  ariaLabel,
  dataTestId,
}: {
  kind?: "primary" | "secondary";
  onClick?: () => void;
  children: string;
  disabled?: boolean;
  type?: "button" | "submit";
  ariaLabel?: string;
  dataTestId?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={dataTestId}
      className={cn(
        "inline-flex items-center justify-center rounded-xl px-3.5 py-2 text-sm font-medium transition",
        kind === "primary"
          ? "border border-emerald-200 bg-[color:var(--lime-primary-gradient)] text-white shadow-sm shadow-emerald-950/15 hover:opacity-95"
          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {children}
    </button>
  );
}

function SwitchField({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="space-y-1">
        <div className="text-sm font-medium text-slate-900">{title}</div>
        <p className="text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-emerald-500" : "bg-slate-300",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 rounded-full bg-white transition-transform",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
    </div>
  );
}

function FieldLabel({
  label,
  optional,
}: {
  label: string;
  optional?: boolean;
}) {
  return (
    <label className="mb-1.5 block text-sm font-medium text-slate-700">
      {label}
      {optional ? (
        <span className="ml-1 text-xs font-normal text-slate-400">
          {t("settings:settings.channels.config.optional")}
        </span>
      ) : null}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  optional,
  mono,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  optional?: boolean;
  mono?: boolean;
  type?: "text" | "number";
}) {
  return (
    <div>
      <FieldLabel label={label} optional={optional} />
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200",
          mono && "font-mono",
        )}
      />
    </div>
  );
}

function SecretField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
  }, [label]);

  return (
    <div>
      <FieldLabel label={label} />
      <div className="flex items-center gap-2">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
        />
        <ActionButton onClick={() => setVisible((current) => !current)}>
          {visible
            ? t("settings:settings.channels.config.hide")
            : t("settings:settings.channels.config.show")}
        </ActionButton>
      </div>
    </div>
  );
}

function StringListEditor({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    setInputValue("");
  }, [label]);

  const addItems = (raw: string) => {
    const candidates = raw
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (candidates.length === 0) {
      return;
    }
    const nextValues = Array.from(new Set([...values, ...candidates]));
    onChange(nextValues);
    setInputValue("");
  };

  const removeValue = (target: string) => {
    onChange(values.filter((item) => item !== target));
  };

  return (
    <div>
      <FieldLabel label={label} />
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        {values.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {values.map((value) => (
              <span
                key={value}
                className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700"
              >
                {value}
                <button
                  type="button"
                  onClick={() => removeValue(value)}
                  className="text-slate-400 hover:text-slate-700"
                  aria-label={t(
                    "settings:settings.channels.config.removeValue",
                    { value },
                  )}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <input
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addItems(inputValue);
              }
            }}
            placeholder={placeholder}
            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          />
          <ActionButton onClick={() => addItems(inputValue)}>
            {t("settings:browserSiteSettings.add")}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function ModelSelect({
  value,
  onChange,
}: {
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const { providers, loading } = useConfiguredProviders();

  useEffect(() => {
    if (!value || loading) {
      return;
    }

    const separatorIndex = value.indexOf("/");
    if (separatorIndex < 0) {
      return;
    }

    const providerKey = value.slice(0, separatorIndex);
    const modelName = value.slice(separatorIndex + 1);
    const provider = providers.find((item) => item.key === providerKey);
    if (!provider) {
      return;
    }

    const issue = getProviderModelCompatibilityIssue({
      providerType: provider.type,
      configuredProviderType: provider.type,
      model: modelName,
    });
    if (issue) {
      onChange(undefined);
    }
  }, [loading, onChange, providers, value]);

  return (
    <div>
      <FieldLabel
        label={t("settings:settings.mediaGeneration.selector.label")}
        optional
      />
      <select
        value={value || ""}
        onChange={(event) => onChange(event.target.value || undefined)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
      >
        <option value="">
          {t("settings:settings.channels.config.globalDefault")}
        </option>
        {loading ? (
          <option disabled>
            {t("settings:settings.channels.logTail.state.loading")}
          </option>
        ) : null}
        {providers.map((provider) => {
          const models = provider.models ?? [];
          const { compatibleModels } = filterProviderModelsByCompatibility(
            {
              providerType: provider.type,
              configuredProviderType: provider.type,
            },
            models,
          );

          if (compatibleModels.length === 0) {
            return null;
          }

          return (
            <optgroup key={provider.key} label={provider.label}>
              {compatibleModels.map((model) => (
                <option
                  key={`${provider.key}/${model}`}
                  value={`${provider.key}/${model}`}
                >
                  {model}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}

function InlineMessage({ message }: { message: FlashMessage }) {
  if (!message) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-2xl px-4 py-3 text-sm",
        message.type === "success"
          ? "bg-emerald-50 text-emerald-700"
          : "bg-rose-50 text-rose-700",
      )}
    >
      {message.text}
    </div>
  );
}

function ProbePanel({
  description,
  message,
  busy,
  onProbe,
  onOpenAdvanced,
}: {
  description: string;
  message: FlashMessage;
  busy: boolean;
  onProbe: () => void | Promise<void>;
  onOpenAdvanced?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium text-slate-900">
            {t("settings:settings.channels.config.connectionCheck")}
          </div>
          <p className="text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={() => void onProbe()} disabled={busy}>
            {busy
              ? t("settings:settings.channels.config.checking")
              : t("settings:settings.channels.config.checkConnection")}
          </ActionButton>
          {onOpenAdvanced ? (
            <ActionButton onClick={onOpenAdvanced}>
              {t("settings:settings.channels.config.openDiagnostics")}
            </ActionButton>
          ) : null}
        </div>
      </div>
      {message ? (
        <div className="mt-3">
          <InlineMessage message={message} />
        </div>
      ) : null}
    </div>
  );
}

function QrCodePreview({ value }: { value: string }) {
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
      .then((nextValue) => {
        if (!cancelled) {
          setDataUrl(nextValue);
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
      <div className="flex h-[260px] items-center justify-center rounded-[24px] border border-rose-200 bg-rose-50 px-6 text-center text-sm text-rose-700">
        {t("settings:settings.channels.config.qrFailed")}
        {error}
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-[24px] border border-slate-200 bg-slate-50 text-sm text-slate-500">
        {t("settings:settings.channels.wechatRuntime.qr.generating")}
      </div>
    );
  }

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4">
      <img
        src={dataUrl}
        alt={t("settings:settings.channels.wechatRuntime.qr.alt")}
        className="mx-auto h-[228px] w-[228px]"
      />
    </div>
  );
}

function ChannelCard({
  icon,
  title,
  subtitle,
  status,
  statusTone,
  details,
  actions,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  status: string;
  statusTone: "success" | "warning" | "neutral";
  details: Array<{ label: string; value: string }>;
  actions: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm shadow-slate-950/5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-4">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            {icon}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                {title}
              </h2>
              <StatusBadge tone={statusTone}>{status}</StatusBadge>
            </div>
            <p className="text-sm leading-6 text-slate-500">{subtitle}</p>
          </div>
        </div>
      </div>
      <dl className="mt-6 space-y-3">
        {details.map((detail) => (
          <div
            key={`${title}-${detail.label}`}
            className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3 text-sm last:border-b-0 last:pb-0"
          >
            <dt className="text-slate-500">{detail.label}</dt>
            <dd className="text-right font-medium text-slate-800">
              {detail.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 flex flex-wrap gap-3">{actions}</div>
    </section>
  );
}

interface TelegramConfigDialogProps {
  isOpen: boolean;
  config: TelegramBotConfig;
  onClose: () => void;
  onSave: (config: TelegramBotConfig, successText: string) => Promise<void>;
  onOpenAdvanced?: () => void;
}

function TelegramConfigDialog({
  isOpen,
  config,
  onClose,
  onSave,
  onOpenAdvanced,
}: TelegramConfigDialogProps) {
  const [draft, setDraft] = useState(config);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<FlashMessage>(null);

  useEffect(() => {
    if (isOpen) {
      setDraft(config);
      setBusy(false);
      setMessage(null);
    }
  }, [config, isOpen]);

  const handleProbe = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await telegramChannelProbe();
      setMessage({
        type: result.ok ? "success" : "error",
        text:
          result.message ||
          (result.ok
            ? t("settings:settings.channels.config.telegramConnected")
            : t("settings:settings.channels.config.telegramFailed")),
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (draft.enabled && !draft.bot_token.trim()) {
      setMessage({
        type: "error",
        text: t("settings:settings.channels.config.telegramTokenRequired"),
      });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      await onSave(
        {
          ...draft,
          bot_token: draft.bot_token.trim(),
          allowed_user_ids: draft.allowed_user_ids
            .map((item) => item.trim())
            .filter(Boolean),
        },
        t("settings:settings.channels.config.telegramSaved"),
      );
      onClose();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-2xl"
      className="lime-workbench-theme-scope border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] text-[color:var(--lime-text)]"
    >
      <ModalHeader>
        {t("settings:settings.channels.config.telegramConfig")}
      </ModalHeader>
      <ModalBody className="space-y-5">
        <SwitchField
          checked={draft.enabled}
          onChange={(checked) =>
            setDraft((current) => ({ ...current, enabled: checked }))
          }
          title={t("settings:settings.channels.config.telegramEnable")}
          description={t("settings:settings.channels.config.telegramIntro")}
        />
        <SecretField
          label={t("settings:settings.channels.config.botToken")}
          value={draft.bot_token}
          onChange={(value) =>
            setDraft((current) => ({ ...current, bot_token: value }))
          }
          placeholder={t(
            "settings:settings.channels.config.example.telegramToken",
          )}
        />
        <StringListEditor
          label={t("settings:settings.channels.config.allowedUsers")}
          values={draft.allowed_user_ids}
          onChange={(values) =>
            setDraft((current) => ({ ...current, allowed_user_ids: values }))
          }
          placeholder={t(
            "settings:settings.channels.config.telegramUserPlaceholder",
          )}
        />
        <ModelSelect
          value={draft.default_model}
          onChange={(value) =>
            setDraft((current) => ({ ...current, default_model: value }))
          }
        />
        <ProbePanel
          description={t("settings:settings.channels.config.telegramCheckHint")}
          message={message}
          busy={busy}
          onProbe={handleProbe}
          onOpenAdvanced={onOpenAdvanced}
        />
      </ModalBody>
      <ModalFooter>
        <ActionButton onClick={onClose}>
          {t("settings:settings.storage.cancel")}
        </ActionButton>
        <ActionButton
          kind="primary"
          onClick={() => void handleSave()}
          disabled={busy}
        >
          {t("settings:settings.channels.workbench.action.save")}
        </ActionButton>
      </ModalFooter>
    </Modal>
  );
}

interface FeishuConfigDialogProps {
  isOpen: boolean;
  config: FeishuBotConfig;
  onClose: () => void;
  onSave: (config: FeishuBotConfig, successText: string) => Promise<void>;
  onOpenAdvanced?: () => void;
}

function FeishuConfigDialog({
  isOpen,
  config,
  onClose,
  onSave,
  onOpenAdvanced,
}: FeishuConfigDialogProps) {
  const [draft, setDraft] = useState(config);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<FlashMessage>(null);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const connectionMode = normalizeConnectionMode(draft.connection_mode);
  const streamingMode = normalizeStreamingMode(draft.streaming);
  const replyToMode = normalizeReplyToMode(draft.reply_to_mode);
  const dmPolicy = draft.dm_policy || "open";
  const hasCredentials =
    draft.app_id.trim().length > 0 && draft.app_secret.trim().length > 0;
  const allowListLabel =
    dmPolicy === "allowlist"
      ? t("settings:settings.channels.config.allowlistUsers")
      : t("settings:settings.channels.config.approvedUsers");
  const showAllowListEditor =
    dmPolicy === "pairing" || dmPolicy === "allowlist";
  const statusTone = hasCredentials
    ? draft.enabled
      ? "success"
      : "neutral"
    : "warning";
  const statusText = hasCredentials
    ? draft.enabled
      ? t("settings:settings.channels.wechatRuntime.state.enabled")
      : t("settings:settings.providers.setting.body.apiKey.configured")
    : t("settings:settings.channels.config.credentialsNeeded");
  const policyOptions = [
    {
      value: "pairing",
      title: t("settings:settings.channels.config.pairing"),
      description: t("settings:settings.channels.config.pairedHint"),
    },
    {
      value: "open",
      title: t("settings:settings.channels.config.open"),
      description: t("settings:settings.channels.config.openHint"),
    },
    {
      value: "allowlist",
      title: t("settings:settings.channels.config.allowlist"),
      description: t("settings:settings.channels.config.allowlistHint"),
    },
    {
      value: "disabled",
      title: t("settings:settings.channels.config.disableDm"),
      description: t("settings:settings.channels.config.disabledDmHint"),
    },
  ] as const;

  useEffect(() => {
    if (isOpen) {
      setDraft(config);
      setBusy(false);
      setMessage(null);
      setCredentialsOpen(
        !(
          config.app_id?.trim().length > 0 &&
          config.app_secret?.trim().length > 0
        ),
      );
      setAdvancedOpen(false);
    }
  }, [config, isOpen]);

  const handleProbe = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await feishuChannelProbe({
        accountId: draft.default_account?.trim() || undefined,
      });
      setMessage({
        type: result.ok ? "success" : "error",
        text:
          result.message ||
          (result.ok
            ? t("settings:settings.channels.config.feishuConnected")
            : t("settings:settings.channels.config.feishuFailed")),
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (draft.enabled && (!draft.app_id.trim() || !draft.app_secret.trim())) {
      setMessage({
        type: "error",
        text: t("settings:settings.channels.config.feishuCredentialsRequired"),
      });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const nextAllowFrom =
        draft.dm_policy === "open" && (draft.allow_from ?? []).length === 0
          ? ["*"]
          : (draft.allow_from ?? []);
      await onSave(
        {
          ...draft,
          app_id: draft.app_id.trim(),
          app_secret: draft.app_secret.trim(),
          verification_token: draft.verification_token?.trim() || undefined,
          encrypt_key: draft.encrypt_key?.trim() || undefined,
          connection_mode: connectionMode,
          webhook_host: draft.webhook_host?.trim() || undefined,
          webhook_port:
            typeof draft.webhook_port === "number" && draft.webhook_port > 0
              ? draft.webhook_port
              : undefined,
          webhook_path: draft.webhook_path?.trim() || undefined,
          allow_from: nextAllowFrom,
        },
        t("settings:settings.channels.config.feishuSaved"),
      );
      onClose();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-2xl"
      className="lime-workbench-theme-scope border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] text-[color:var(--lime-text)]"
    >
      <ModalHeader>
        {t("settings:settings.channels.config.feishuConfig")}
      </ModalHeader>
      <ModalBody className="space-y-4">
        <div
          className={cn(
            "rounded-2xl border px-4 py-4",
            hasCredentials
              ? "border-emerald-200 bg-emerald-50"
              : "border-amber-200 bg-amber-50",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-slate-900">
                  {t("settings:settings.channels.config.configurationStatus")}
                </div>
                <StatusBadge tone={statusTone}>{statusText}</StatusBadge>
              </div>
              <p className="text-sm leading-6 text-slate-600">
                {hasCredentials
                  ? t("settings:settings.channels.config.credentialsReadyHint")
                  : t(
                      "settings:settings.channels.config.credentialsMissingHint",
                    )}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.enabled}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  enabled: !current.enabled,
                }))
              }
              className={cn(
                "relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                draft.enabled ? "bg-emerald-500" : "bg-slate-300",
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                  draft.enabled ? "translate-x-6" : "translate-x-1",
                )}
              />
            </button>
          </div>
        </div>

        <Collapsible open={credentialsOpen} onOpenChange={setCredentialsOpen}>
          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="space-y-3 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-slate-900">
                    {t("settings:settings.channels.config.currentBot")}
                  </div>
                  <p className="text-xs text-slate-500">
                    {t("settings:settings.channels.config.summaryHint")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCredentialsOpen((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  {credentialsOpen
                    ? t("settings:settings.channels.config.collapseCredentials")
                    : hasCredentials
                      ? t("settings:settings.channels.config.editCredentials")
                      : t("settings:settings.channels.config.enterCredentials")}
                  {credentialsOpen ? (
                    <ChevronDown className="h-4 w-4 text-slate-500" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-500" />
                  )}
                </button>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <div className="text-xs text-slate-500">
                      {t("settings:settings.channels.config.appId")}
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      {maskMiddle(draft.app_id, 5)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">
                      {t("settings:settings.channels.config.appSecret")}
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      {maskMiddle(draft.app_secret, 6)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">
                      {t("settings:settings.mediaGeneration.selector.label")}
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      {draft.default_model ||
                        t("settings:settings.channels.config.globalDefault")}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <CollapsibleContent className="space-y-4 border-t border-slate-100 px-4 py-4">
              <div className="grid gap-4 md:grid-cols-2">
                <TextField
                  label={t("settings:settings.channels.config.appId")}
                  value={draft.app_id}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, app_id: value }))
                  }
                  placeholder={t(
                    "settings:settings.channels.config.example.appId",
                  )}
                  mono
                />
                <SecretField
                  label={t("settings:settings.channels.config.appSecret")}
                  value={draft.app_secret}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, app_secret: value }))
                  }
                  placeholder={t(
                    "settings:settings.channels.config.feishuAppSecret",
                  )}
                />
              </div>
              <ModelSelect
                value={draft.default_model}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, default_model: value }))
                }
              />
            </CollapsibleContent>
          </div>
        </Collapsible>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
          <div className="space-y-1">
            <div className="text-sm font-medium text-slate-900">
              {t("settings:settings.channels.config.accessPolicy")}
            </div>
            <p className="text-xs text-slate-500">
              {t("settings:settings.channels.config.dmPolicyHint")}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {policyOptions.map((option) => {
              const selected = dmPolicy === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      dm_policy: option.value,
                      allow_from:
                        option.value === "open"
                          ? current.allow_from
                          : current.allow_from?.length === 1 &&
                              current.allow_from[0] === "*"
                            ? []
                            : current.allow_from,
                    }))
                  }
                  className={cn(
                    "rounded-2xl border px-4 py-4 text-left transition",
                    selected
                      ? "border-emerald-200 bg-[color:var(--lime-surface-soft)] text-slate-800 shadow-sm shadow-emerald-950/10"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">{option.title}</div>
                    <span
                      className={cn(
                        "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px]",
                        selected
                          ? "border-emerald-200 bg-white/90 text-emerald-700"
                          : "border-slate-300 text-slate-400",
                      )}
                    >
                      {selected ? "✓" : ""}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "mt-2 text-xs leading-5",
                      selected ? "text-slate-600" : "text-slate-500",
                    )}
                  >
                    {option.description}
                  </p>
                </button>
              );
            })}
          </div>
          {showAllowListEditor ? (
            <StringListEditor
              label={allowListLabel}
              values={(draft.allow_from ?? []).filter(
                (item) => item.trim() !== "*",
              )}
              onChange={(values) =>
                setDraft((current) => ({ ...current, allow_from: values }))
              }
              placeholder={t(
                "settings:settings.channels.config.feishuUserPlaceholder",
              )}
            />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
              {dmPolicy === "open"
                ? t("settings:settings.channels.config.openNoAllowlist")
                : t("settings:settings.channels.config.feishuDmDisabled")}
            </div>
          )}
        </div>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <div className="rounded-2xl border border-slate-200 bg-white">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    {t("settings:settings.channels.config.advancedConfig")}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("settings:settings.channels.config.callbackHint")}
                  </p>
                </div>
                {advancedOpen ? (
                  <ChevronDown className="h-4 w-4 text-slate-500" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-slate-500" />
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 border-t border-slate-100 px-4 py-4">
              <div className="grid gap-4 md:grid-cols-2">
                <TextField
                  label={t(
                    "settings:settings.channels.config.verificationToken",
                  )}
                  value={draft.verification_token || ""}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      verification_token: value || undefined,
                    }))
                  }
                  placeholder={t(
                    "settings:settings.channels.config.eventVerificationToken",
                  )}
                />
                <SecretField
                  label={t("settings:settings.channels.config.encryptionKey")}
                  value={draft.encrypt_key || ""}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      encrypt_key: value || undefined,
                    }))
                  }
                  placeholder={t(
                    "settings:settings.channels.config.eventEncryptionKey",
                  )}
                />
              </div>
              <div>
                <FieldLabel
                  label={t("settings:settings.channels.config.connectionMode")}
                />
                <select
                  value={connectionMode}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      connection_mode: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                >
                  <option value="webhook">
                    {t("settings:settings.channels.config.webhook")}
                  </option>
                  <option value="websocket">
                    {t("settings:settings.channels.config.example.websocket")}
                  </option>
                </select>
                {connectionMode === "websocket" ? (
                  <p className="mt-2 text-xs text-amber-600">
                    {t("settings:settings.channels.config.webhookRecommended")}
                  </p>
                ) : null}
              </div>
              {connectionMode === "webhook" ? (
                <div className="grid gap-4 md:grid-cols-3">
                  <TextField
                    label={t("settings:settings.channels.config.callbackHost")}
                    value={draft.webhook_host || ""}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        webhook_host: value || undefined,
                      }))
                    }
                    placeholder={t(
                      "settings:settings.channels.config.example.host",
                    )}
                  />
                  <TextField
                    label={t("settings:settings.channels.config.callbackPort")}
                    value={draft.webhook_port ? String(draft.webhook_port) : ""}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        webhook_port:
                          Number.isFinite(Number(value)) && Number(value) > 0
                            ? Number(value)
                            : undefined,
                      }))
                    }
                    placeholder={t(
                      "settings:settings.channels.config.example.port",
                    )}
                    type="number"
                  />
                  <TextField
                    label={t("settings:settings.channels.config.callbackPath")}
                    value={draft.webhook_path || ""}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        webhook_path: value || undefined,
                      }))
                    }
                    placeholder={t(
                      "settings:settings.channels.config.example.webhookPath",
                    )}
                    mono
                  />
                </div>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel
                    label={t("settings:settings.channels.config.streaming")}
                  />
                  <select
                    value={streamingMode}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        streaming: event.target.value,
                      }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="partial">
                      {t("settings:settings.channels.config.partial")}
                    </option>
                    <option value="block">
                      {t("settings:settings.channels.config.block")}
                    </option>
                    <option value="off">
                      {t(
                        "settings:settings.providers.importExport.action.close",
                      )}
                    </option>
                  </select>
                </div>
                <div>
                  <FieldLabel
                    label={t("settings:settings.channels.config.replyMode")}
                  />
                  <select
                    value={replyToMode}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        reply_to_mode: event.target.value,
                      }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="off">
                      {t(
                        "settings:settings.providers.importExport.action.close",
                      )}
                    </option>
                    <option value="first">
                      {t("settings:settings.channels.config.first")}
                    </option>
                    <option value="all">
                      {t(
                        "settings:settings.channels.logTail.filter.option.all",
                      )}
                    </option>
                  </select>
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
        <ProbePanel
          description={t("settings:settings.channels.config.checkHint")}
          message={message}
          busy={busy}
          onProbe={handleProbe}
          onOpenAdvanced={onOpenAdvanced}
        />
      </ModalBody>
      <ModalFooter>
        <ActionButton onClick={onClose}>
          {t("settings:settings.storage.cancel")}
        </ActionButton>
        <ActionButton
          kind="primary"
          onClick={() => void handleSave()}
          disabled={busy}
        >
          {t("settings:settings.channels.workbench.action.save")}
        </ActionButton>
      </ModalFooter>
    </Modal>
  );
}

interface WechatConfigDialogProps {
  isOpen: boolean;
  config: WechatBotConfig;
  onClose: () => void;
  onSave: (config: WechatBotConfig, successText: string) => Promise<void>;
  onOpenAdvanced?: () => void;
}

function WechatConfigDialog({
  isOpen,
  config,
  onClose,
  onSave,
  onOpenAdvanced,
}: WechatConfigDialogProps) {
  const [draft, setDraft] = useState(config);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<FlashMessage>(null);
  const [qrValue, setQrValue] = useState("");
  const [runtimeAccounts, setRuntimeAccounts] = useState<
    WechatConfiguredAccount[]
  >([]);
  const [loginResult, setLoginResult] = useState<WechatLoginWaitResult | null>(
    null,
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [accountEditorOpen, setAccountEditorOpen] = useState(false);
  const [activeAccountId, setActiveAccountId] = useState("");
  const scanRequestIdRef = useRef(0);
  const accountIds = useMemo(
    () => Object.keys(draft.accounts ?? {}),
    [draft.accounts],
  );
  const activeAccount = activeAccountId
    ? draft.accounts?.[activeAccountId]
    : undefined;
  const groupPolicy = normalizeWechatGroupPolicy(draft.group_policy);
  const streamingMode = normalizeStreamingMode(draft.streaming);
  const replyToMode = normalizeReplyToMode(draft.reply_to_mode);

  useEffect(() => {
    if (!isOpen) {
      scanRequestIdRef.current += 1;
      return;
    }

    setDraft(config);
    setBusy(false);
    setMessage(null);
    setQrValue("");
    setLoginResult(null);
    setAdvancedOpen(false);
    setAccountsOpen(false);
    setAccountEditorOpen(false);
    setActiveAccountId(
      config.default_account?.trim() ||
        Object.keys(config.accounts ?? {})[0] ||
        "",
    );

    const requestId = scanRequestIdRef.current + 1;
    scanRequestIdRef.current = requestId;

    void wechatChannelListAccounts()
      .then((accounts) => {
        if (scanRequestIdRef.current === requestId) {
          setRuntimeAccounts(accounts);
        }
      })
      .catch(() => {
        if (scanRequestIdRef.current === requestId) {
          setRuntimeAccounts([]);
        }
      });

    return () => {
      scanRequestIdRef.current += 1;
    };
  }, [config, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const preferredAccountId =
      draft.default_account?.trim() || accountIds[0] || "";
    if (!preferredAccountId) {
      if (activeAccountId) {
        setActiveAccountId("");
      }
      if (accountEditorOpen) {
        setAccountEditorOpen(false);
      }
      return;
    }

    if (!activeAccountId || !accountIds.includes(activeAccountId)) {
      setActiveAccountId(preferredAccountId);
    }
  }, [
    accountEditorOpen,
    accountIds,
    activeAccountId,
    draft.default_account,
    isOpen,
  ]);

  const patchAccount = useCallback(
    (
      accountId: string,
      updater: (
        current: NonNullable<WechatBotConfig["accounts"]>[string],
      ) => NonNullable<WechatBotConfig["accounts"]>[string],
    ) => {
      setDraft((current) => {
        const baseAccounts = current.accounts ?? {};
        const currentAccountDraft = baseAccounts[accountId] ?? {
          enabled: true,
        };
        return {
          ...current,
          accounts: {
            ...baseAccounts,
            [accountId]: updater(currentAccountDraft),
          },
        };
      });
    },
    [],
  );

  const addAccountDraft = () => {
    const baseAccounts = draft.accounts ?? {};
    let index = 1;
    let nextAccountId = "wechat_1";
    while (baseAccounts[nextAccountId]) {
      index += 1;
      nextAccountId = `wechat_${index}`;
    }

    setDraft((current) => ({
      ...current,
      default_account: current.default_account || nextAccountId,
      accounts: {
        ...(current.accounts ?? {}),
        [nextAccountId]: {
          enabled: true,
          name: t("settings:settings.channels.config.wechatAccountName", {
            index,
          }),
        },
      },
    }));
    setAccountsOpen(true);
    setAccountEditorOpen(true);
    setActiveAccountId(nextAccountId);
  };

  const removeAccountDraft = (accountId: string) => {
    const baseAccounts = { ...(draft.accounts ?? {}) };
    delete baseAccounts[accountId];
    const nextAccountIds = Object.keys(baseAccounts);
    const nextDefaultAccount =
      draft.default_account === accountId
        ? nextAccountIds[0] || undefined
        : draft.default_account;

    setDraft((current) => ({
      ...current,
      default_account: nextDefaultAccount,
      accounts: baseAccounts,
    }));
    if (nextAccountIds.length === 0) {
      setAccountEditorOpen(false);
    }
    setActiveAccountId(nextAccountIds[0] || "");
  };

  const handleOpenAccountEditor = (accountId: string) => {
    setActiveAccountId(accountId);
    setAccountEditorOpen(true);
  };

  const handleStartScan = async (baseUrlOverride?: string) => {
    const requestId = scanRequestIdRef.current + 1;
    scanRequestIdRef.current = requestId;
    const baseUrl =
      (baseUrlOverride ?? draft.base_url).trim() || DEFAULT_WECHAT_BASE_URL;

    setBusy(true);
    setMessage(null);
    setQrValue("");
    setLoginResult(null);

    try {
      const result = await wechatChannelLoginStart({
        baseUrl,
        botType: DEFAULT_WECHAT_BOT_TYPE,
      });
      if (scanRequestIdRef.current !== requestId) {
        return;
      }
      setQrValue(result.qrcodeUrl);
      setMessage({
        type: "success",
        text: t("settings:settings.channels.config.qrReady"),
      });

      const waitResult = await wechatChannelLoginWait({
        sessionKey: result.sessionKey,
        baseUrl,
        botType: DEFAULT_WECHAT_BOT_TYPE,
        timeoutMs: 60_000,
      });
      if (scanRequestIdRef.current !== requestId) {
        return;
      }

      setLoginResult(waitResult);
      if (waitResult.connected) {
        const nextAccountId = waitResult.accountId?.trim() || "default";
        setDraft((current) => ({
          ...current,
          enabled: true,
          bot_token: waitResult.botToken?.trim() || current.bot_token,
          base_url:
            waitResult.baseUrl?.trim() ||
            current.base_url ||
            DEFAULT_WECHAT_BASE_URL,
          cdn_base_url: current.cdn_base_url || DEFAULT_WECHAT_CDN_BASE_URL,
          scanner_user_id: waitResult.userId?.trim() || current.scanner_user_id,
          default_account: nextAccountId,
          accounts: {
            ...(current.accounts ?? {}),
            [nextAccountId]: {
              ...(current.accounts?.[nextAccountId] ?? {}),
              enabled: true,
              bot_token:
                waitResult.botToken?.trim() ||
                current.accounts?.[nextAccountId]?.bot_token,
              scanner_user_id:
                waitResult.userId?.trim() ||
                current.accounts?.[nextAccountId]?.scanner_user_id,
              base_url:
                waitResult.baseUrl?.trim() ||
                current.accounts?.[nextAccountId]?.base_url ||
                current.base_url ||
                DEFAULT_WECHAT_BASE_URL,
              cdn_base_url:
                current.accounts?.[nextAccountId]?.cdn_base_url ||
                current.cdn_base_url ||
                DEFAULT_WECHAT_CDN_BASE_URL,
            },
          },
        }));
        setMessage({
          type: "success",
          text: t("settings:settings.channels.config.wechatLoginReady"),
        });
        const accounts = await wechatChannelListAccounts();
        if (scanRequestIdRef.current === requestId) {
          setRuntimeAccounts(accounts);
        }
      } else {
        setMessage({
          type: "error",
          text:
            waitResult.message ||
            t("settings:settings.channels.config.wechatLoginMissing"),
        });
      }
    } catch (error) {
      if (scanRequestIdRef.current !== requestId) {
        return;
      }
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (scanRequestIdRef.current === requestId) {
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void handleStartScan(config.base_url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.base_url, isOpen]);

  const handleProbe = async () => {
    const accountId =
      draft.default_account?.trim() ||
      loginResult?.accountId?.trim() ||
      runtimeAccounts[0]?.accountId;
    if (!accountId) {
      setMessage({
        type: "error",
        text: t("settings:settings.channels.config.wechatAccountRequired"),
      });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const result = await wechatChannelProbe({ accountId });
      setMessage({
        type: result.ok ? "success" : "error",
        text:
          result.message ||
          (result.ok
            ? t("settings:settings.channels.config.wechatConnected")
            : t("settings:settings.channels.config.wechatFailed")),
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    const nextAccounts = Object.entries(draft.accounts ?? {}).reduce<
      NonNullable<WechatBotConfig["accounts"]>
    >((result, [accountId, account]) => {
      const normalizedAccountId = accountId.trim();
      if (!normalizedAccountId) {
        return result;
      }

      result[normalizedAccountId] = {
        ...account,
        enabled: account.enabled !== false,
        name: account.name?.trim() || undefined,
        bot_token: account.bot_token?.trim() || undefined,
        scanner_user_id: account.scanner_user_id?.trim() || undefined,
        base_url: account.base_url?.trim() || undefined,
        cdn_base_url: account.cdn_base_url?.trim() || undefined,
      };
      return result;
    }, {});
    const nextConfig: WechatBotConfig = {
      ...draft,
      enabled: draft.enabled || Object.keys(nextAccounts).length > 0,
      bot_token: draft.bot_token.trim(),
      base_url: draft.base_url.trim() || DEFAULT_WECHAT_BASE_URL,
      cdn_base_url: draft.cdn_base_url.trim() || DEFAULT_WECHAT_CDN_BASE_URL,
      scanner_user_id: draft.scanner_user_id?.trim() || undefined,
      default_account: draft.default_account?.trim() || undefined,
      group_allow_from: (draft.group_allow_from ?? [])
        .map((item) => item.trim())
        .filter(Boolean),
      allow_from:
        draft.dm_policy === "open" && (draft.allow_from ?? []).length === 0
          ? ["*"]
          : (draft.allow_from ?? []).map((item) => item.trim()).filter(Boolean),
      accounts: nextAccounts,
    };

    setBusy(true);
    setMessage(null);
    try {
      await onSave(
        nextConfig,
        t("settings:settings.channels.config.wechatSaved"),
      );
      const accountId =
        nextConfig.default_account?.trim() ||
        loginResult?.accountId?.trim() ||
        runtimeAccounts[0]?.accountId;
      if (accountId) {
        await gatewayChannelStart({ channel: "wechat", accountId });
      }
      onClose();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-4xl"
      className="lime-workbench-theme-scope border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] text-[color:var(--lime-text)]"
    >
      <ModalHeader>
        {t("settings:settings.channels.config.wechatConfig")}
      </ModalHeader>
      <ModalBody className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3">
            <QrCodePreview value={qrValue} />
            <div className="text-center text-xs leading-5 text-slate-500">
              {t("settings:settings.channels.config.wechatQrHint")}
            </div>
            <ActionButton
              onClick={() => void handleStartScan()}
              disabled={busy}
            >
              {t("settings:settings.channels.config.regenerateQr")}
            </ActionButton>
          </div>

          <div className="space-y-5">
            <SwitchField
              checked={draft.enabled}
              onChange={(checked) =>
                setDraft((current) => ({ ...current, enabled: checked }))
              }
              title={t("settings:settings.channels.config.wechatEnable")}
              description={t(
                "settings:settings.channels.config.wechatSaveHint",
              )}
            />
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-900">
                  {t("settings:settings.channels.config.currentAccount")}
                </span>
                <StatusBadge
                  tone={draft.default_account?.trim() ? "success" : "warning"}
                >
                  {draft.default_account?.trim() ||
                    t("settings:settings.channels.config.awaitingScan")}
                </StatusBadge>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {t("settings:settings.channels.config.wechatDefaultHint")}
              </p>
            </div>
            <ProbePanel
              description={t(
                "settings:settings.channels.config.wechatCheckHint",
              )}
              message={message}
              busy={busy}
              onProbe={handleProbe}
              onOpenAdvanced={onOpenAdvanced}
            />
            <div>
              <FieldLabel
                label={t("settings:settings.channels.config.dmPolicy")}
              />
              <select
                value={draft.dm_policy || "pairing"}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    dm_policy: event.target.value,
                  }))
                }
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                <option value="pairing">
                  {t("settings:settings.channels.config.pairing")}
                </option>
                <option value="allowlist">
                  {t("settings:settings.channels.config.allowlist")}
                </option>
                <option value="open">
                  {t("settings:settings.channels.config.open")}
                </option>
                <option value="disabled">
                  {t("settings:settings.channels.config.disableDm")}
                </option>
              </select>
            </div>
            {runtimeAccounts.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-sm font-medium text-slate-900">
                  {t("settings:settings.channels.config.connectedAccounts")}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {runtimeAccounts.map((account) => (
                    <button
                      key={account.accountId}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          default_account: account.accountId,
                        }))
                      }
                      className={cn(
                        "inline-flex items-center rounded-full bg-white px-3 py-1 text-xs ring-1 transition",
                        draft.default_account === account.accountId
                          ? "text-slate-900 ring-slate-400"
                          : "text-slate-600 ring-slate-200 hover:ring-slate-300",
                      )}
                    >
                      {account.name || account.accountId}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <div className="rounded-2xl border border-slate-200 bg-white">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        {t(
                          "settings:settings.channels.config.advancedParameters",
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {t("settings:settings.channels.config.accountsHint")}
                      </p>
                    </div>
                    {advancedOpen ? (
                      <ChevronDown className="h-4 w-4 text-slate-500" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-slate-500" />
                    )}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 border-t border-slate-100 px-4 py-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField
                      label={t("settings:settings.channels.config.scanUserId")}
                      value={draft.scanner_user_id || ""}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          scanner_user_id: value || undefined,
                        }))
                      }
                      placeholder={t(
                        "settings:settings.channels.config.scanUserPlaceholder",
                      )}
                      mono
                    />
                    <TextField
                      label={t(
                        "settings:settings.channels.config.defaultAccountId",
                      )}
                      value={draft.default_account || ""}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          default_account: value,
                        }))
                      }
                      placeholder={t(
                        "settings:settings.channels.config.defaultAccountId",
                      )}
                    />
                    <ModelSelect
                      value={draft.default_model}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          default_model: value,
                        }))
                      }
                    />
                    <div>
                      <FieldLabel
                        label={t(
                          "settings:settings.channels.config.groupPolicy",
                        )}
                      />
                      <select
                        value={groupPolicy}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            group_policy: event.target.value,
                          }))
                        }
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      >
                        <option value="allowlist">
                          {t("settings:settings.channels.config.allowlist")}
                        </option>
                        <option value="open">
                          {t("settings:settings.channels.config.open")}
                        </option>
                        <option value="disabled">
                          {t("settings:settings.computerUse.status.disabled")}
                        </option>
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField
                      label={t("settings:settings.channels.config.serviceUrl")}
                      value={draft.base_url}
                      onChange={(value) =>
                        setDraft((current) => ({ ...current, base_url: value }))
                      }
                      placeholder={DEFAULT_WECHAT_BASE_URL}
                      mono
                    />
                    <TextField
                      label={t("settings:settings.channels.config.resourceUrl")}
                      value={draft.cdn_base_url}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          cdn_base_url: value,
                        }))
                      }
                      placeholder={DEFAULT_WECHAT_CDN_BASE_URL}
                      mono
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <FieldLabel
                        label={t("settings:settings.channels.config.streaming")}
                      />
                      <select
                        value={streamingMode}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            streaming: event.target.value,
                          }))
                        }
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      >
                        <option value="off">
                          {t(
                            "settings:settings.providers.importExport.action.close",
                          )}
                        </option>
                        <option value="partial">
                          {t("settings:settings.channels.config.partial")}
                        </option>
                        <option value="block">
                          {t("settings:settings.channels.config.block")}
                        </option>
                      </select>
                    </div>
                    <div>
                      <FieldLabel
                        label={t("settings:settings.channels.config.replyMode")}
                      />
                      <select
                        value={replyToMode}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            reply_to_mode: event.target.value,
                          }))
                        }
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      >
                        <option value="off">
                          {t(
                            "settings:settings.providers.importExport.action.close",
                          )}
                        </option>
                        <option value="first">
                          {t("settings:settings.channels.config.first")}
                        </option>
                        <option value="all">
                          {t(
                            "settings:settings.channels.logTail.filter.option.all",
                          )}
                        </option>
                      </select>
                    </div>
                  </div>
                  <StringListEditor
                    label={t("settings:settings.channels.config.approvedUsers")}
                    values={draft.allow_from ?? []}
                    onChange={(values) =>
                      setDraft((current) => ({
                        ...current,
                        allow_from: values,
                      }))
                    }
                    placeholder={t(
                      "settings:settings.channels.config.userPlaceholder",
                    )}
                  />
                  <StringListEditor
                    label={t(
                      "settings:settings.channels.config.groupAllowedUsers",
                    )}
                    values={draft.group_allow_from ?? []}
                    onChange={(values) =>
                      setDraft((current) => ({
                        ...current,
                        group_allow_from: values,
                      }))
                    }
                    placeholder={t(
                      "settings:settings.channels.config.userPlaceholder",
                    )}
                  />
                  <Collapsible
                    open={accountsOpen}
                    onOpenChange={setAccountsOpen}
                  >
                    <div className="rounded-2xl border border-slate-200 bg-slate-50">
                      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium text-slate-900">
                              {t(
                                "settings:settings.channels.config.accountParameters",
                              )}
                            </div>
                            <StatusBadge
                              tone={
                                accountIds.length > 0 ? "success" : "neutral"
                              }
                            >
                              {accountIds.length > 0
                                ? t(
                                    "settings:settings.channels.config.accountsCount",
                                    { count: accountIds.length },
                                  )
                                : t(
                                    "settings:settings.channels.config.noAccounts",
                                  )}
                            </StatusBadge>
                            {draft.default_account?.trim() ? (
                              <StatusBadge tone="neutral">
                                {t(
                                  "settings:settings.channels.config.defaultAccountValue",
                                  { account: draft.default_account.trim() },
                                )}
                              </StatusBadge>
                            ) : null}
                          </div>
                          <p className="text-xs text-slate-500">
                            {t(
                              "settings:settings.channels.config.autoAccountHint",
                            )}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <ActionButton onClick={addAccountDraft}>
                            {t(
                              "settings:settings.channels.config.addAccountDraft",
                            )}
                          </ActionButton>
                          <button
                            type="button"
                            onClick={() =>
                              setAccountsOpen((current) => !current)
                            }
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                          >
                            {accountsOpen
                              ? t(
                                  "settings:settings.channels.config.collapseAccounts",
                                )
                              : t(
                                  "settings:settings.channels.config.expandAccounts",
                                )}
                            {accountsOpen ? (
                              <ChevronDown className="h-4 w-4 text-slate-500" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-slate-500" />
                            )}
                          </button>
                        </div>
                      </div>
                      <CollapsibleContent className="space-y-4 border-t border-slate-100 px-4 py-4">
                        {accountIds.length > 0 ? (
                          <>
                            <div className="grid gap-3">
                              {accountIds.map((accountId) => {
                                const account = draft.accounts?.[accountId];
                                if (!account) {
                                  return null;
                                }

                                const selected = activeAccountId === accountId;
                                return (
                                  <button
                                    key={accountId}
                                    type="button"
                                    onClick={() =>
                                      handleOpenAccountEditor(accountId)
                                    }
                                    data-testid={`wechat-account-summary-${accountId}`}
                                    className={cn(
                                      "rounded-2xl border bg-white px-4 py-3 text-left transition",
                                      selected
                                        ? "border-slate-300 shadow-sm shadow-slate-950/5"
                                        : "border-slate-200 hover:border-slate-300",
                                    )}
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="space-y-1">
                                        <div className="text-sm font-medium text-slate-900">
                                          {account.name?.trim() || accountId}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                          {account.name?.trim()
                                            ? accountId
                                            : t(
                                                "settings:settings.channels.config.unnamedAccount",
                                              )}
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        {draft.default_account === accountId ? (
                                          <StatusBadge tone="success">
                                            {t(
                                              "settings:settings.channels.config.defaultAccount",
                                            )}
                                          </StatusBadge>
                                        ) : null}
                                        <StatusBadge
                                          tone={
                                            account.enabled !== false
                                              ? "success"
                                              : "warning"
                                          }
                                        >
                                          {account.enabled !== false
                                            ? t(
                                                "settings:settings.channels.wechatRuntime.state.enabled",
                                              )
                                            : t(
                                                "settings:settings.channels.config.disabled",
                                              )}
                                        </StatusBadge>
                                      </div>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                                      <span>
                                        {t(
                                          "settings:settings.channels.config.modelPrefix",
                                        )}
                                        {describeWechatAccountModel(account)}
                                      </span>
                                      <span>
                                        {t(
                                          "settings:settings.channels.config.addressPrefix",
                                        )}
                                        {describeWechatAccountRoute(
                                          account,
                                          draft.base_url ||
                                            DEFAULT_WECHAT_BASE_URL,
                                        )}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                            {activeAccount ? (
                              <Collapsible
                                open={accountEditorOpen}
                                onOpenChange={setAccountEditorOpen}
                              >
                                <div className="rounded-2xl border border-slate-200 bg-white">
                                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
                                    <div className="space-y-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <div className="text-sm font-medium text-slate-900">
                                          {t(
                                            "settings:settings.channels.config.editAccount",
                                          )}
                                        </div>
                                        <StatusBadge
                                          tone={
                                            draft.default_account ===
                                            activeAccountId
                                              ? "success"
                                              : "neutral"
                                          }
                                        >
                                          {activeAccount.name?.trim() ||
                                            activeAccountId}
                                        </StatusBadge>
                                      </div>
                                      <p className="text-xs text-slate-500">
                                        {t(
                                          "settings:settings.channels.config.accountDetailsHint",
                                        )}
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setAccountEditorOpen(
                                          (current) => !current,
                                        )
                                      }
                                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                                    >
                                      {accountEditorOpen
                                        ? t(
                                            "settings:settings.channels.config.collapseDetails",
                                          )
                                        : t(
                                            "settings:settings.channels.config.expandDetails",
                                          )}
                                      {accountEditorOpen ? (
                                        <ChevronDown className="h-4 w-4 text-slate-500" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4 text-slate-500" />
                                      )}
                                    </button>
                                  </div>
                                  <CollapsibleContent className="space-y-4 border-t border-slate-100 px-4 py-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <div className="flex flex-wrap items-center gap-3">
                                        <div className="text-sm font-medium text-slate-900">
                                          {t(
                                            "settings:settings.channels.config.currentAccount",
                                          )}
                                        </div>
                                        <StatusBadge
                                          tone={
                                            draft.default_account ===
                                            activeAccountId
                                              ? "success"
                                              : "neutral"
                                          }
                                        >
                                          {draft.default_account ===
                                          activeAccountId
                                            ? t(
                                                "settings:settings.channels.config.defaultAccount",
                                              )
                                            : t(
                                                "settings:settings.channels.config.accountDraft",
                                              )}
                                        </StatusBadge>
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        <ActionButton
                                          onClick={() =>
                                            setDraft((current) => ({
                                              ...current,
                                              default_account: activeAccountId,
                                            }))
                                          }
                                        >
                                          {t(
                                            "settings:settings.voice.model.action.setDefault",
                                          )}
                                        </ActionButton>
                                        <ActionButton
                                          onClick={() =>
                                            removeAccountDraft(activeAccountId)
                                          }
                                        >
                                          {t(
                                            "settings:settings.archivedConversations.action.delete",
                                          )}
                                        </ActionButton>
                                      </div>
                                    </div>
                                    <SwitchField
                                      checked={activeAccount.enabled !== false}
                                      onChange={(checked) =>
                                        patchAccount(
                                          activeAccountId,
                                          (current) => ({
                                            ...current,
                                            enabled: checked,
                                          }),
                                        )
                                      }
                                      title={t(
                                        "settings:settings.channels.config.enableAccount",
                                      )}
                                      description={t(
                                        "settings:settings.channels.config.disableAccountHint",
                                      )}
                                    />
                                    <div className="grid gap-4 md:grid-cols-2">
                                      <TextField
                                        label={t(
                                          "settings:settings.channels.config.accountName",
                                        )}
                                        value={activeAccount.name || ""}
                                        onChange={(value) =>
                                          patchAccount(
                                            activeAccountId,
                                            (current) => ({
                                              ...current,
                                              name: value || undefined,
                                            }),
                                          )
                                        }
                                        placeholder={t(
                                          "settings:settings.channels.config.accountNamePlaceholder",
                                        )}
                                      />
                                      <ModelSelect
                                        value={activeAccount.default_model}
                                        onChange={(value) =>
                                          patchAccount(
                                            activeAccountId,
                                            (current) => ({
                                              ...current,
                                              default_model: value,
                                            }),
                                          )
                                        }
                                      />
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                      <TextField
                                        label={t(
                                          "settings:settings.channels.config.accountServiceUrl",
                                        )}
                                        value={activeAccount.base_url || ""}
                                        onChange={(value) =>
                                          patchAccount(
                                            activeAccountId,
                                            (current) => ({
                                              ...current,
                                              base_url: value || undefined,
                                            }),
                                          )
                                        }
                                        placeholder={DEFAULT_WECHAT_BASE_URL}
                                        mono
                                      />
                                      <TextField
                                        label={t(
                                          "settings:settings.channels.config.accountResourceUrl",
                                        )}
                                        value={activeAccount.cdn_base_url || ""}
                                        onChange={(value) =>
                                          patchAccount(
                                            activeAccountId,
                                            (current) => ({
                                              ...current,
                                              cdn_base_url: value || undefined,
                                            }),
                                          )
                                        }
                                        placeholder={
                                          DEFAULT_WECHAT_CDN_BASE_URL
                                        }
                                        mono
                                      />
                                    </div>
                                    <SecretField
                                      label={t(
                                        "settings:settings.channels.config.accountBotToken",
                                      )}
                                      value={activeAccount.bot_token || ""}
                                      onChange={(value) =>
                                        patchAccount(
                                          activeAccountId,
                                          (current) => ({
                                            ...current,
                                            bot_token: value || undefined,
                                          }),
                                        )
                                      }
                                      placeholder={t(
                                        "settings:settings.channels.config.scannedToken",
                                      )}
                                    />
                                    <TextField
                                      label={t(
                                        "settings:settings.channels.config.accountScanUserId",
                                      )}
                                      value={
                                        activeAccount.scanner_user_id || ""
                                      }
                                      onChange={(value) =>
                                        patchAccount(
                                          activeAccountId,
                                          (current) => ({
                                            ...current,
                                            scanner_user_id: value || undefined,
                                          }),
                                        )
                                      }
                                      placeholder={t(
                                        "settings:settings.channels.config.wechatUserId",
                                      )}
                                      mono
                                    />
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                            ) : null}
                          </>
                        ) : (
                          <div className="text-xs text-slate-500">
                            {t(
                              "settings:settings.channels.config.noAccountsHint",
                            )}
                          </div>
                        )}
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <ActionButton onClick={onClose}>
          {t("settings:settings.storage.cancel")}
        </ActionButton>
        <ActionButton
          kind="primary"
          onClick={() => void handleSave()}
          disabled={busy}
        >
          {t("settings:settings.channels.config.saveEnable")}
        </ActionButton>
      </ModalFooter>
    </Modal>
  );
}

export function ImConfigPage() {
  useTranslation("settings");
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<FlashMessage>(null);
  const [activeDialog, setActiveDialog] = useState<ManagedChannel | null>(null);
  const [debugToolsOpen, setDebugToolsOpen] = useState(false);
  const [debugChannel, setDebugChannel] = useState<ManagedChannel>("telegram");
  const advancedToolsRef = useRef<HTMLElement | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const nextConfig = await getConfig();
      setConfig(nextConfig);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!message) {
      return;
    }

    const timeoutId = window.setTimeout(() => setMessage(null), 2500);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  const channels = useMemo(
    () => normalizeChannelsConfig(config?.channels),
    [config?.channels],
  );
  const enabledChannelCount = [
    channels.telegram.enabled,
    channels.feishu.enabled,
    channels.wechat.enabled,
  ].filter(Boolean).length;
  const wechatAccountCount = Object.keys(channels.wechat.accounts ?? {}).length;

  const persistChannel = async <K extends keyof ChannelsConfig>(
    channel: K,
    nextChannelConfig: ChannelsConfig[K],
    successText: string,
  ) => {
    const nextChannels = {
      ...channels,
      [channel]: nextChannelConfig,
    } as ChannelsConfig;
    const nextConfig = buildNextConfig(config, nextChannels);
    await saveConfig(nextConfig);
    setConfig(nextConfig);
    setMessage({ type: "success", text: successText });
  };

  const revealAdvancedTools = (channel: ManagedChannel) => {
    setActiveDialog(null);
    setDebugChannel(channel);
    setDebugToolsOpen(true);
    window.setTimeout(() => {
      const section = advancedToolsRef.current;
      if (section && typeof section.scrollIntoView === "function") {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 0);
  };

  if (loading) {
    return (
      <div
        data-testid="im-config-page"
        className="lime-workbench-theme-scope mx-auto flex w-full max-w-[1260px] flex-col gap-6 pb-10"
      >
        <div className="h-36 animate-pulse rounded-[30px] border border-slate-200 bg-[color:var(--lime-card-subtle)]" />
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="h-[280px] animate-pulse rounded-[28px] border border-slate-200 bg-white" />
          <div className="h-[280px] animate-pulse rounded-[28px] border border-slate-200 bg-white" />
          <div className="h-[280px] animate-pulse rounded-[28px] border border-slate-200 bg-white" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="lime-workbench-theme-scope mx-auto flex w-full max-w-[1260px] flex-col gap-6 pb-10">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-[color:var(--lime-card-subtle)] px-7 py-7 shadow-sm shadow-slate-950/5">
          <div className="max-w-3xl space-y-4">
            <div className="max-w-2xl space-y-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                <Sparkles className="h-3.5 w-3.5" />
                {t("settings:settings.channels.config.systemEntry")}
              </span>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                    {t("settings:settings.channels.config.channels")}
                  </h1>
                  <WorkbenchInfoTip
                    ariaLabel={t(
                      "settings:settings.channels.config.channelsInfo",
                    )}
                    content={t(
                      "settings:settings.channels.config.channelsIntroFull",
                    )}
                    tone="mint"
                  />
                </div>
                <p className="max-w-3xl text-sm leading-7 text-slate-600">
                  {t("settings:settings.channels.config.channelsIntro")}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
                {t("settings:settings.channels.config.channelCount")}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
                {t("settings:settings.channels.config.enabledCount", {
                  count: enabledChannelCount,
                })}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
                {t("settings:settings.channels.config.wechatAccountCount", {
                  count: wechatAccountCount,
                })}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
                {t("settings:settings.channels.config.diagnosticsHint")}
              </span>
            </div>
          </div>
        </section>

        <SectionMessage message={message} />

        <div className="grid gap-5 lg:grid-cols-3">
          <ChannelCard
            icon={<Send className="h-5 w-5" />}
            title={t("settings:settings.channels.config.example.telegram")}
            subtitle={t("settings:settings.channels.config.tokenSetup")}
            status={
              channels.telegram.enabled
                ? t("settings:settings.channels.wechatRuntime.state.enabled")
                : t("settings:settings.channels.config.notEnabled")
            }
            statusTone={channels.telegram.enabled ? "success" : "neutral"}
            details={[
              {
                label: t("settings:settings.channels.config.botToken"),
                value: channels.telegram.bot_token.trim()
                  ? t("settings:settings.channels.config.filled")
                  : t("settings:settings.channels.config.empty"),
              },
              {
                label: t("settings:settings.channels.config.accessScope"),
                value: describeTelegramScope(channels.telegram),
              },
            ]}
            actions={
              <>
                <ActionButton
                  kind="primary"
                  onClick={() => setActiveDialog("telegram")}
                  ariaLabel={t(
                    "settings:settings.channels.config.openTelegram",
                  )}
                  dataTestId="telegram-config-button"
                >
                  {t("settings:settings.configuration.title")}
                </ActionButton>
              </>
            }
          />

          <ChannelCard
            icon={<Bot className="h-5 w-5" />}
            title={t("settings:settings.channels.workbench.runtime.tab.feishu")}
            subtitle={t("settings:settings.channels.config.appCredentials")}
            status={
              channels.feishu.enabled
                ? t("settings:settings.channels.wechatRuntime.state.enabled")
                : t("settings:settings.channels.config.notEnabled")
            }
            statusTone={channels.feishu.enabled ? "success" : "neutral"}
            details={[
              {
                label: t("settings:settings.channels.config.appId"),
                value: maskMiddle(channels.feishu.app_id, 5),
              },
              {
                label: t("settings:settings.channels.config.accessPolicy"),
                value: describeDmPolicy(channels.feishu.dm_policy),
              },
            ]}
            actions={
              <>
                <ActionButton
                  kind="primary"
                  onClick={() => setActiveDialog("feishu")}
                  ariaLabel={t("settings:settings.channels.config.openFeishu")}
                  dataTestId="feishu-config-button"
                >
                  {t("settings:settings.configuration.title")}
                </ActionButton>
              </>
            }
          />

          <ChannelCard
            icon={<ScanQrCode className="h-5 w-5" />}
            title={t("settings:settings.channels.workbench.runtime.tab.wechat")}
            subtitle={t("settings:settings.channels.config.qrSetup")}
            status={describeWechatStatus(channels.wechat)}
            statusTone={
              channels.wechat.enabled
                ? Object.keys(channels.wechat.accounts ?? {}).length > 0
                  ? "success"
                  : "warning"
                : "neutral"
            }
            details={[
              {
                label: t("settings:settings.channels.config.defaultAccount"),
                value:
                  channels.wechat.default_account ||
                  t("settings:settings.channels.config.unset"),
              },
              {
                label: t("settings:settings.channels.config.dmAccess"),
                value: describeDmPolicy(channels.wechat.dm_policy),
              },
            ]}
            actions={
              <>
                <ActionButton
                  kind="primary"
                  onClick={() => setActiveDialog("wechat")}
                  ariaLabel={t("settings:settings.channels.config.openWechat")}
                  dataTestId="wechat-config-button"
                >
                  {t("settings:settings.configuration.title")}
                </ActionButton>
              </>
            }
          />
        </div>

        <section className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700">
                <span>{t("settings:settings.channels.config.comingSoon")}</span>
                <WorkbenchInfoTip
                  ariaLabel={t(
                    "settings:settings.channels.config.comingSoonInfo",
                  )}
                  content={t(
                    "settings:settings.channels.config.comingSoonHint",
                  )}
                  tone="slate"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <div
                aria-disabled="true"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {t("settings:settings.channels.config.example.discord")}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-400">
                  {t("settings:settings.channels.config.comingSoon")}
                </span>
              </div>
              <div
                aria-disabled="true"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {t("settings:settings.channels.config.dingtalk")}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-400">
                  {t("settings:settings.channels.config.comingSoon")}
                </span>
              </div>
            </div>
          </div>
        </section>

        <Collapsible open={debugToolsOpen} onOpenChange={setDebugToolsOpen}>
          <section
            ref={advancedToolsRef}
            className="rounded-[28px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5"
          >
            <div className="flex items-start gap-3 px-6 py-5">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center justify-between text-left"
                >
                  <div className="space-y-1">
                    <div className="text-lg font-semibold tracking-tight text-slate-900">
                      {t("settings:settings.channels.workbench.title")}
                    </div>
                  </div>
                  {debugToolsOpen ? (
                    <ChevronDown className="h-5 w-5 text-slate-500" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-slate-500" />
                  )}
                </button>
              </CollapsibleTrigger>
              <WorkbenchInfoTip
                ariaLabel={t(
                  "settings:settings.channels.config.diagnosticsInfo",
                )}
                content={t(
                  "settings:settings.channels.config.diagnosticsIntro",
                )}
                tone="slate"
              />
            </div>
            <CollapsibleContent className="border-t border-slate-100 px-6 py-5">
              <Suspense
                fallback={
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
                    {t("settings:settings.channels.config.loadingDiagnostics")}
                  </div>
                }
              >
                <ChannelsDebugWorkbench
                  key={debugChannel}
                  initialTab={debugChannel}
                  initialSubPage="logs"
                  initialDebugTab={debugChannel}
                  onConfigSaved={() => {
                    void loadConfig();
                  }}
                />
              </Suspense>
            </CollapsibleContent>
          </section>
        </Collapsible>
      </div>

      <TelegramConfigDialog
        isOpen={activeDialog === "telegram"}
        config={channels.telegram}
        onClose={() => setActiveDialog(null)}
        onSave={(nextConfig, successText) =>
          persistChannel("telegram", nextConfig, successText)
        }
        onOpenAdvanced={() => revealAdvancedTools("telegram")}
      />

      <FeishuConfigDialog
        isOpen={activeDialog === "feishu"}
        config={channels.feishu}
        onClose={() => setActiveDialog(null)}
        onSave={(nextConfig, successText) =>
          persistChannel("feishu", nextConfig, successText)
        }
        onOpenAdvanced={() => revealAdvancedTools("feishu")}
      />

      <WechatConfigDialog
        isOpen={activeDialog === "wechat"}
        config={channels.wechat}
        onClose={() => setActiveDialog(null)}
        onSave={(nextConfig, successText) =>
          persistChannel("wechat", nextConfig, successText)
        }
        onOpenAdvanced={() => revealAdvancedTools("wechat")}
      />
    </>
  );
}
