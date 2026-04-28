import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Cloud,
  Copy,
  CreditCard,
  ExternalLink,
  KeyRound,
  Layers3,
  LoaderCircle,
  LogIn,
  ReceiptText,
  RefreshCw,
  Search,
  WalletCards,
} from "lucide-react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { ProviderPoolPage } from "@/components/provider-pool";
import { openUrl } from "@/components/openclaw/openUrl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatOemCloudAccessModeLabel,
  formatOemCloudDateTime,
  formatOemCloudModelsSourceLabel,
  formatOemCloudOfferStateLabel,
  useOemCloudAccess,
} from "@/hooks/useOemCloudAccess";
import type {
  OemCloudBillingCycle,
  OemCloudCreditTopupOrder,
  OemCloudCreditWallet,
  OemCloudEntitlementPlan,
  OemCloudCurrentSession,
  OemCloudOrder,
  OemCloudProviderOfferDetail,
  OemCloudProviderModelItem,
  OemCloudProviderOfferState,
  OemCloudProviderOfferSummary,
  OemCloudPaymentConfig,
  OemCloudUsageRecord,
} from "@/lib/api/oemCloudControlPlane";
import {
  getCompanionPetStatus,
  launchCompanionPet,
  listenCompanionPetStatus,
  sendCompanionPetCommand,
  type CompanionLaunchPetResult,
  type CompanionPetStatus,
} from "@/lib/api/companion";
import { subscribeProviderDataChanged } from "@/lib/providerDataEvents";
import {
  loadCompanionProviderOverview,
  type CompanionProviderOverviewPayload,
} from "@/lib/provider/companionProviderOverview";
import { createOemCloudModelMetadata } from "@/lib/model/oemCloudModelMetadata";
import type { SettingsProviderView } from "@/types/page";
import { cn } from "@/lib/utils";
import { CompanionCapabilityPreferencesCard } from "./CompanionCapabilityPreferencesCard";

const SURFACE_CLASS_NAME =
  "rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5";
const PRIMARY_ACTION_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-[16px] border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-emerald-950/15 transition hover:opacity-95 disabled:opacity-60";
const ACTIVE_WORKSPACE_TRIGGER_CLASS =
  "data-[state=active]:border-emerald-200 data-[state=active]:bg-[linear-gradient(135deg,rgba(240,253,250,0.98)_0%,rgba(236,253,245,0.96)_56%,rgba(224,242,254,0.95)_100%)] data-[state=active]:text-slate-800 data-[state=active]:shadow-sm data-[state=active]:shadow-emerald-950/10";
const DEFAULT_COMPANION_ENDPOINT = "ws://127.0.0.1:45554/companion/pet";
const LIME_PET_RELEASES_URL =
  "https://github.com/limecloud/lime-pet/releases/latest";

function SessionValueCard(props: {
  label: string;
  value: string;
  hint: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-[16px] border border-slate-200/80 bg-slate-50/80 px-3.5 py-3">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-500">
          {props.icon ? (
            <span className="text-slate-400">{props.icon}</span>
          ) : null}
          <span>{props.label}</span>
          <WorkbenchInfoTip
            ariaLabel={`${props.label}说明`}
            content={props.hint}
            tone="slate"
          />
        </div>
        <p className="break-all text-sm font-medium text-slate-900 sm:text-right">
          {props.value}
        </p>
      </div>
    </div>
  );
}

function NoticeBar(props: { tone: "error" | "success"; message: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[18px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
        props.tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-rose-200 bg-rose-50 text-rose-700",
      )}
    >
      {props.tone === "success" ? (
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
      )}
      <span>{props.message}</span>
    </div>
  );
}

function CloudCommerceStatusBar(props: {
  readiness: ReturnType<typeof useOemCloudAccess>["cloudReadiness"];
  pendingPayment: ReturnType<typeof useOemCloudAccess>["pendingPayment"];
  paymentWatcher: ReturnType<typeof useOemCloudAccess>["paymentWatcher"];
  onRefresh: () => void;
  onCreateKey: () => void;
  onOpenPayment?: () => void;
  creatingKey: boolean;
  refreshing: boolean;
}) {
  const { readiness, pendingPayment, paymentWatcher } = props;
  const needsAttention = Boolean(
    readiness &&
    (readiness.status !== "ready" || pendingPayment || paymentWatcher),
  );

  if (!needsAttention) {
    return null;
  }

  const isPendingPayment = readiness?.status === "payment_pending";
  const isMissingKey = readiness?.status === "no_api_key";
  const canOpenPayment = Boolean(
    pendingPayment?.paymentReference?.trim() &&
    /^https?:\/\//i.test(pendingPayment.paymentReference),
  );
  const title = pendingPayment
    ? `待支付：${pendingPayment.title || pendingPayment.orderId}`
    : readiness?.title || "云端状态需要处理";
  const description = pendingPayment
    ? `${formatMoneyCents(pendingPayment.amountCents)} · ${pendingPayment.paymentChannel || "支付渠道"}`
    : readiness?.description || readiness?.nextAction || "刷新后同步最新状态。";
  const actionLabel = canOpenPayment
    ? "继续支付"
    : isMissingKey
      ? "创建 API Key"
      : isPendingPayment
        ? "刷新支付状态"
        : "刷新状态";
  const action = canOpenPayment
    ? props.onOpenPayment
    : isMissingKey
      ? props.onCreateKey
      : props.onRefresh;

  return (
    <article
      className={cn(
        "rounded-[22px] border px-4 py-3 shadow-sm shadow-slate-950/5",
        isPendingPayment || pendingPayment
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-slate-200 bg-white text-slate-700",
      )}
      data-testid="cloud-commerce-status-bar"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <InfoPill
              label={isPendingPayment || pendingPayment ? "待确认" : "需要处理"}
              tone={isPendingPayment || pendingPayment ? "amber" : "slate"}
            />
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {paymentWatcher
              ? `${paymentWatcher.title} · ${paymentWatcher.message || "正在确认支付状态"}`
              : description}
          </p>
        </div>
        <button
          type="button"
          onClick={action}
          disabled={props.creatingKey || props.refreshing || !action}
          className={cn(
            canOpenPayment || isMissingKey
              ? PRIMARY_ACTION_BUTTON_CLASS
              : "inline-flex items-center justify-center gap-2 rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60",
          )}
        >
          {props.creatingKey || props.refreshing ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : canOpenPayment ? (
            <ExternalLink className="h-4 w-4" />
          ) : isMissingKey ? (
            <KeyRound className="h-4 w-4" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {actionLabel}
        </button>
      </div>
    </article>
  );
}

function SdkSnippetCard(props: {
  title: string;
  description?: string;
  lines: string[];
}) {
  const snippet = props.lines.join("\n");

  return (
    <div className="rounded-[18px] border border-slate-200/80 bg-slate-950 p-4 text-slate-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-200">{props.title}</p>
          {props.description ? (
            <p className="mt-1 text-[11px] leading-5 text-slate-400">
              {props.description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => copyTextToClipboard(snippet)}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
        >
          <Copy className="h-3 w-3" />
          复制
        </button>
      </div>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all text-xs leading-5 text-slate-100">
        {snippet}
      </pre>
    </div>
  );
}

function InfoPill(props: {
  label: string;
  tone?: "slate" | "emerald" | "amber";
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
        props.tone === "emerald"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : props.tone === "amber"
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-slate-200 bg-slate-50 text-slate-600",
      )}
    >
      {props.label}
    </span>
  );
}

function formatCreditAmount(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "未配置";
  }

  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatMoneyCents(value?: number | null, currency = "CNY"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "未配置";
  }

  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: value % 100 === 0 ? 0 : 2,
  }).format(value / 100);
}

type CloudPaymentOption = {
  id: string;
  provider: string;
  method?: string;
  label: string;
  config: OemCloudPaymentConfig;
};

function buildPaymentOptions(
  configs: OemCloudPaymentConfig[],
): CloudPaymentOption[] {
  return configs.flatMap((config) => {
    const enabledMethods = config.methods.filter((method) => method.enabled);
    if (enabledMethods.length === 0) {
      return [
        {
          id: config.provider,
          provider: config.provider,
          label: config.displayName,
          config,
        },
      ];
    }
    return enabledMethods.map((method) => ({
      id: `${config.provider}:${method.key}`,
      provider: config.provider,
      method: method.key,
      label: `${config.displayName} · ${method.displayName}`,
      config,
    }));
  });
}

function formatBillingCycleLabel(value?: OemCloudBillingCycle): string {
  switch (value) {
    case "monthly":
      return "月付";
    case "yearly":
      return "年付";
    case "one_time":
      return "一次性";
    default:
      return value || "未配置";
  }
}

function formatSubscriptionStatus(value?: string): string {
  switch (value) {
    case "trial":
      return "试用中";
    case "active":
      return "生效中";
    case "past_due":
      return "待续费";
    case "canceled":
      return "已取消";
    default:
      return value || "未开通";
  }
}

function formatOrderStatusLabel(value?: string): string {
  switch (String(value || "").toLowerCase()) {
    case "paid":
    case "completed":
    case "succeeded":
      return "已支付";
    case "pending":
      return "待支付";
    case "failed":
      return "支付失败";
    case "cancelled":
    case "canceled":
      return "已取消";
    case "refunded":
      return "已退款";
    default:
      return value || "未知";
  }
}

function formatWalletStatusLabel(value?: string): string {
  switch (String(value || "").toLowerCase()) {
    case "active":
      return "可用";
    case "expired":
      return "已过期";
    case "depleted":
      return "已用尽";
    case "pending":
      return "待生效";
    default:
      return value || "未知";
  }
}

type CommerceTone = "slate" | "emerald" | "amber";

function resolvePaidCommerceTone(value?: string): CommerceTone {
  return String(value).toLowerCase() === "paid" ? "emerald" : "amber";
}

function resolveActiveCommerceTone(value?: string): CommerceTone {
  return String(value).toLowerCase() === "active" ? "emerald" : "slate";
}

function resolveInitialPlanCycle(
  plan: OemCloudEntitlementPlan,
): OemCloudBillingCycle | undefined {
  return (
    plan.billingCycles.find((item) => item.key === "monthly") ??
    plan.billingCycles[0]
  )?.key;
}

function resolvePlanCycleByKey(
  plan: OemCloudEntitlementPlan,
  selectedCycle: OemCloudBillingCycle,
) {
  return (
    plan.billingCycles.find((item) => item.key === selectedCycle) ??
    plan.billingCycles.find(
      (item) => item.key === resolveInitialPlanCycle(plan),
    ) ??
    plan.billingCycles[0]
  );
}

function buildUsagePercent(used: number, limit: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

function formatUsageRatio(used: number, limit: number): string {
  if (limit <= 0) {
    return formatCreditAmount(used);
  }

  return `${formatCreditAmount(used)} / ${formatCreditAmount(limit)}`;
}

type DailyUsageBucket = {
  key: string;
  label: string;
  credits: number;
  tokens: number;
  count: number;
};

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(dateKey: string): string {
  const [, month = "", day = ""] = dateKey.split("-");
  if (!month || !day) {
    return dateKey;
  }

  return `${Number(month)}/${Number(day)}`;
}

function buildDailyUsageBuckets(
  records: OemCloudUsageRecord[],
  days = 14,
): DailyUsageBucket[] {
  const parsedDates = records
    .map((record) => new Date(record.createdAt))
    .filter((date) => Number.isFinite(date.getTime()));
  const endDate = parsedDates.length
    ? new Date(Math.max(...parsedDates.map((date) => date.getTime())))
    : new Date();
  endDate.setHours(0, 0, 0, 0);

  const buckets = new Map<string, DailyUsageBucket>();
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(endDate);
    date.setDate(endDate.getDate() - index);
    const key = formatDateKey(date);
    buckets.set(key, {
      key,
      label: formatDayLabel(key),
      credits: 0,
      tokens: 0,
      count: 0,
    });
  }

  records.forEach((record) => {
    const date = new Date(record.createdAt);
    if (!Number.isFinite(date.getTime())) {
      return;
    }
    date.setHours(0, 0, 0, 0);
    const key = formatDateKey(date);
    const bucket = buckets.get(key);
    if (!bucket) {
      return;
    }
    bucket.credits += record.credits;
    bucket.tokens += record.tokens;
    bucket.count += 1;
  });

  return Array.from(buckets.values());
}

function formatUsageStatusLabel(value?: string): string {
  switch (String(value || "").toLowerCase()) {
    case "charged":
    case "success":
    case "succeeded":
      return "已结算";
    case "reserved":
      return "预占中";
    case "released":
      return "已释放";
    case "failed":
      return "失败";
    default:
      return value || "未知";
  }
}

function formatSubscriptionPeriod(
  start?: string,
  end?: string,
  fallback?: string,
): string {
  if (start && end) {
    return `${formatOemCloudDateTime(start)} - ${formatOemCloudDateTime(end)}`;
  }
  if (end) {
    return `有效至 ${formatOemCloudDateTime(end)}`;
  }
  if (fallback) {
    return fallback;
  }
  return "以服务端权益为准";
}

function copyTextToClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }

  void navigator.clipboard.writeText(value);
}

function formatOemModelTaskFamilyLabel(value: string): string {
  switch (value) {
    case "chat":
      return "对话";
    case "reasoning":
      return "思考";
    case "vision_understanding":
      return "视觉理解";
    case "image_generation":
      return "图片生成";
    case "image_edit":
      return "图片编辑";
    case "speech_to_text":
      return "语音转写";
    case "text_to_speech":
      return "语音合成";
    case "embedding":
      return "Embedding";
    case "rerank":
      return "检索重排";
    case "moderation":
      return "审核";
    default:
      return value;
  }
}

function formatOemModelDeploymentLabel(value?: string | null): string {
  switch (value) {
    case "local":
      return "本地";
    case "user_cloud":
      return "云端";
    case "oem_cloud":
    default:
      return "Lime 云端";
  }
}

function resolveSdkModelId(models: OemCloudProviderModelItem[]) {
  const explicitAnthropicModel = models.find((model) => {
    const searchableText = [
      model.modelId,
      model.displayName,
      model.description,
      ...(model.abilities ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      searchableText.includes("anthropic") ||
      searchableText.includes("claude") ||
      searchableText.includes("coding plan")
    );
  });

  return (
    explicitAnthropicModel?.modelId ||
    models.find((model) => model.recommended)?.modelId ||
    models[0]?.modelId ||
    ""
  );
}

type GatewaySnippetOptions = {
  tenantId: string;
  authorizationHeader?: string;
  authorizationScheme?: string;
  tenantHeader?: string;
};

function resolveGatewaySnippetOptions(
  options: GatewaySnippetOptions,
): Required<GatewaySnippetOptions> {
  return {
    tenantId: options.tenantId || "<tenant-id>",
    authorizationHeader: options.authorizationHeader || "Authorization",
    authorizationScheme: options.authorizationScheme || "Bearer",
    tenantHeader: options.tenantHeader || "X-Lime-Tenant-ID",
  };
}

function buildSdkDefaultHeaders(options: GatewaySnippetOptions) {
  const resolved = resolveGatewaySnippetOptions(options);
  const lines = [
    "  defaultHeaders: {",
    `    ${JSON.stringify(resolved.tenantHeader)}: ${JSON.stringify(resolved.tenantId)},`,
  ];
  if (
    resolved.authorizationHeader !== "Authorization" ||
    resolved.authorizationScheme !== "Bearer"
  ) {
    lines.push(
      `    ${JSON.stringify(resolved.authorizationHeader)}: \`${resolved.authorizationScheme} ${"${process.env.LIME_API_KEY}"}\`,`,
    );
  }
  lines.push("  },");
  return lines;
}

function buildOpenAISdkSnippet(
  baseUrl: string,
  modelId: string,
  options: GatewaySnippetOptions,
) {
  return [
    'import OpenAI from "openai";',
    "",
    "const client = new OpenAI({",
    "  apiKey: process.env.LIME_API_KEY,",
    `  baseURL: "${baseUrl}",`,
    ...buildSdkDefaultHeaders(options),
    "});",
    "",
    "const completion = await client.chat.completions.create({",
    `  model: "${modelId}",`,
    '  messages: [{ role: "user", content: "用一句话介绍 Lime Cloud" }],',
    "});",
  ];
}

function buildAnthropicSdkSnippet(
  baseUrl: string,
  modelId: string,
  options: GatewaySnippetOptions,
) {
  return [
    'import Anthropic from "@anthropic-ai/sdk";',
    "",
    "const anthropic = new Anthropic({",
    "  apiKey: process.env.LIME_API_KEY,",
    `  baseURL: "${baseUrl}",`,
    ...buildSdkDefaultHeaders(options),
    "});",
    "",
    "const message = await anthropic.messages.create({",
    `  model: "${modelId}",`,
    "  max_tokens: 1024,",
    '  messages: [{ role: "user", content: "帮我规划一个小功能实现步骤" }],',
    "});",
  ];
}

function buildCurlSmokeSnippet(
  baseUrl: string,
  modelId: string,
  options: GatewaySnippetOptions,
) {
  const resolved = resolveGatewaySnippetOptions(options);
  return [
    `curl "${baseUrl.replace(/\/$/, "")}/chat/completions" \\`,
    `  -H "${resolved.authorizationHeader}: ${resolved.authorizationScheme} $LIME_API_KEY" \\`,
    `  -H "${resolved.tenantHeader}: ${resolved.tenantId}" \\`,
    '  -H "Content-Type: application/json" \\',
    "  -d '{",
    `    "model": "${modelId}",`,
    '    "messages": [{"role": "user", "content": "ping"}]',
    "  }'",
  ];
}

function RuntimeSummaryItem(props: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[16px] border border-slate-200/80 bg-slate-50/80 px-3.5 py-3">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-500">
          <span>{props.label}</span>
          {props.hint ? (
            <WorkbenchInfoTip
              ariaLabel={`${props.label}说明`}
              content={props.hint}
              tone="slate"
            />
          ) : null}
        </div>
        <p className="text-sm font-medium leading-6 text-slate-900 sm:text-right">
          {props.value}
        </p>
      </div>
    </div>
  );
}

function formatCompanionError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "未知错误";
}

function shouldShowCompanionInstallGuide(
  result: CompanionLaunchPetResult,
): boolean {
  if (result.launched || result.resolved_path) {
    return false;
  }

  const message = result.message?.trim() ?? "";
  if (!message) {
    return false;
  }

  return (
    message.includes("未找到 Lime Pet 可执行产物") ||
    message.includes("请先安装桌宠应用") ||
    message.includes("未安装桌宠应用")
  );
}

function formatCompanionCapabilityLabel(capability: string): string {
  switch (capability) {
    case "provider-overview":
      return "Provider 概览";
    case "provider-sync-request":
      return "主动请求同步";
    default:
      return capability;
  }
}

function formatCompanionVisualStateLabel(
  state: CompanionPetStatus["last_state"],
): string {
  switch (state) {
    case "hidden":
      return "隐藏";
    case "walking":
      return "游走";
    case "thinking":
      return "思考中";
    case "done":
      return "完成";
    case "idle":
    default:
      return "待命";
  }
}

function formatCompanionPlatformLabel(
  platform: string | null | undefined,
): string {
  switch (platform) {
    case "macos":
      return "macOS";
    case "windows":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return platform?.trim() || "未上报平台";
  }
}

function formatCompanionDateTime(value: Date | null): string {
  if (!value) {
    return "尚未同步";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

function CompanionProviderBridgeCard() {
  const [status, setStatus] = useState<CompanionPetStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [launchingPet, setLaunchingPet] = useState(false);
  const [installPromptVisible, setInstallPromptVisible] = useState(false);
  const [syncingPreview, setSyncingPreview] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [providerOverviewPreview, setProviderOverviewPreview] =
    useState<CompanionProviderOverviewPayload | null>(null);
  const [lastManualSyncAt, setLastManualSyncAt] = useState<Date | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let statusUnlisten: (() => void) | null = null;
    let unsubscribeProviderData: (() => void) | null = null;

    const applyStatus = (nextStatus: CompanionPetStatus) => {
      if (cancelled) {
        return;
      }
      setStatus(nextStatus);
    };

    const loadProviderPreview = async (forceRefresh = false) => {
      if (!cancelled) {
        setPreviewLoading(true);
        setPreviewError(null);
      }

      try {
        const payload = await loadCompanionProviderOverview({
          forceRefresh,
        });
        if (cancelled) {
          return;
        }
        setProviderOverviewPreview(payload);
      } catch (error) {
        if (!cancelled) {
          setPreviewError(
            `读取桌宠摘要预览失败：${formatCompanionError(error)}`,
          );
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    };

    const loadStatus = async (initial = false) => {
      if (initial) {
        setLoadingStatus(true);
      } else {
        setRefreshingStatus(true);
      }

      try {
        const nextStatus = await getCompanionPetStatus();
        applyStatus(nextStatus);
      } catch (error) {
        if (!cancelled) {
          setActionFeedback({
            tone: "error",
            message: `读取桌宠状态失败：${formatCompanionError(error)}`,
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingStatus(false);
          setRefreshingStatus(false);
        }
      }
    };

    void loadStatus(true);
    void loadProviderPreview();

    void listenCompanionPetStatus((nextStatus) => {
      applyStatus(nextStatus);
    })
      .then((unlisten) => {
        if (cancelled) {
          void unlisten();
          return;
        }
        statusUnlisten = unlisten;
      })
      .catch((error) => {
        if (!cancelled) {
          setActionFeedback({
            tone: "error",
            message: `监听桌宠状态失败：${formatCompanionError(error)}`,
          });
        }
      });

    unsubscribeProviderData = subscribeProviderDataChanged(() => {
      void loadProviderPreview(true);
    });

    return () => {
      cancelled = true;
      if (statusUnlisten) {
        statusUnlisten();
      }
      if (unsubscribeProviderData) {
        unsubscribeProviderData();
      }
    };
  }, []);

  useEffect(() => {
    if (status?.connected) {
      setInstallPromptVisible(false);
    }
  }, [status?.connected]);

  const refreshStatus = async () => {
    setActionFeedback(null);
    setRefreshingStatus(true);
    setPreviewLoading(true);
    try {
      const [nextStatus] = await Promise.all([
        getCompanionPetStatus(),
        loadCompanionProviderOverview({ forceRefresh: true })
          .then((payload) => {
            setProviderOverviewPreview(payload);
            setPreviewError(null);
          })
          .catch((error) => {
            setPreviewError(
              `读取桌宠摘要预览失败：${formatCompanionError(error)}`,
            );
          })
          .finally(() => {
            setPreviewLoading(false);
          }),
      ]);
      setStatus(nextStatus);
    } catch (error) {
      setActionFeedback({
        tone: "error",
        message: `刷新桌宠状态失败：${formatCompanionError(error)}`,
      });
    } finally {
      setRefreshingStatus(false);
    }
  };

  const handleLaunchPet = async () => {
    setActionFeedback(null);
    setLaunchingPet(true);
    try {
      const result = await launchCompanionPet();
      const shouldPromptInstall = shouldShowCompanionInstallGuide(result);
      setInstallPromptVisible(shouldPromptInstall);

      if (result.launched) {
        setActionFeedback({
          tone: "success",
          message:
            result.message || "已请求开启桌宠，请等待 Lime Pet 建立连接。",
        });
      } else {
        setActionFeedback({
          tone: "error",
          message: shouldPromptInstall
            ? "当前设备还没有安装 Lime Pet，请先安装桌宠应用后再开启。"
            : result.message ||
              "当前没有可用的 Lime Pet 可执行产物，请先安装桌宠应用。",
        });
      }

      const nextStatus = await getCompanionPetStatus();
      setStatus(nextStatus);
    } catch (error) {
      setActionFeedback({
        tone: "error",
        message: `启动桌宠失败：${formatCompanionError(error)}`,
      });
    } finally {
      setLaunchingPet(false);
    }
  };

  const handleSyncPreview = async () => {
    setActionFeedback(null);

    if (!providerOverviewPreview) {
      setActionFeedback({
        tone: "error",
        message: "桌宠摘要预览尚未准备完成，请稍后再试。",
      });
      return;
    }

    if (!connected) {
      setActionFeedback({
        tone: "error",
        message: "桌宠尚未连接，暂时无法同步摘要。",
      });
      return;
    }

    if (!supportsProviderOverview) {
      setActionFeedback({
        tone: "error",
        message: "当前桌宠未声明 Provider 概览能力，暂时无法接收摘要。",
      });
      return;
    }

    setSyncingPreview(true);
    try {
      const result = await sendCompanionPetCommand({
        event: "pet.provider_overview",
        payload: providerOverviewPreview,
      });

      if (!result.delivered) {
        setActionFeedback({
          tone: "error",
          message: "桌宠连接存在但本次摘要未送达，请检查 Companion 连接状态。",
        });
        return;
      }

      setActionFeedback({
        tone: "success",
        message: `已同步 ${providerOverviewPreview.total_provider_count} 个服务商摘要到桌宠。`,
      });
      setLastManualSyncAt(new Date());
    } catch (error) {
      setActionFeedback({
        tone: "error",
        message: `同步桌宠摘要失败：${formatCompanionError(error)}`,
      });
    } finally {
      setSyncingPreview(false);
    }
  };

  const connected = Boolean(status?.connected);
  const serverListening = Boolean(status?.server_listening);
  const supportsProviderOverview = Boolean(
    status?.capabilities.includes("provider-overview"),
  );
  const endpoint = status?.endpoint || DEFAULT_COMPANION_ENDPOINT;
  const lastState = formatCompanionVisualStateLabel(
    status?.last_state || "idle",
  );
  const capabilityText =
    status && status.capabilities.length > 0
      ? status.capabilities.map(formatCompanionCapabilityLabel).join(" / ")
      : "未声明";
  const previewProviders = providerOverviewPreview?.providers || [];
  const petIdentity = status?.client_id?.trim() || "等待桌宠上报";
  const syncDiagnostic = (() => {
    if (previewLoading) {
      return {
        label: "整理摘要中",
        hint: "正在从当前服务商配置与凭证池整理桌宠预览。",
      };
    }
    if (previewError) {
      return {
        label: "预览异常",
        hint: previewError,
      };
    }
    if (!serverListening) {
      return {
        label: "宿主未监听",
        hint: "Companion 服务尚未监听，本地桌宠暂时无法接入。",
      };
    }
    if (!connected) {
      return {
        label: "等待桌宠连接",
        hint: "Companion 已监听，可点击“开启桌宠”或检查桌宠是否已连上本地入口。",
      };
    }
    if (!supportsProviderOverview) {
      return {
        label: "能力未声明",
        hint: "当前桌宠已连接，但尚未声明 Provider 概览能力，Lime 不会强行下发摘要。",
      };
    }
    if (syncingPreview) {
      return {
        label: "同步中",
        hint: "正在把当前脱敏摘要发送给桌宠。",
      };
    }
    return {
      label: "可立即同步",
      hint: "桌宠已连接且已声明 Provider 概览能力，可以手动下发当前摘要。",
    };
  })();
  const readinessChecks = [
    {
      key: "host",
      label: "Companion 宿主已监听",
      done: serverListening,
      pending: false,
      detail: serverListening
        ? "Lime 已监听本地桌宠入口。"
        : "当前还没有可用的本地桌宠入口。",
    },
    {
      key: "connection",
      label: "桌宠已建立连接",
      done: connected,
      pending: false,
      detail: connected
        ? "桌宠已经接入 Lime Companion。"
        : "需要启动桌宠，或检查它是否连到了本地入口。",
    },
    {
      key: "capability",
      label: "桌宠声明 Provider 概览能力",
      done: supportsProviderOverview,
      pending: connected && !supportsProviderOverview,
      detail: supportsProviderOverview
        ? "桌宠已声明可接收 provider-overview 摘要。"
        : connected
          ? "当前桌宠已连接，但尚未声明 Provider 概览能力。"
          : "桌宠连接建立后，Lime 会等待能力声明。",
    },
    {
      key: "preview",
      label: "脱敏摘要已准备完成",
      done:
        !previewLoading &&
        !previewError &&
        providerOverviewPreview !== null &&
        previewProviders.length >= 0,
      pending: previewLoading,
      detail: previewLoading
        ? "正在从当前服务商配置与凭证池整理脱敏摘要。"
        : previewError
          ? previewError
          : `当前已准备 ${providerOverviewPreview?.total_provider_count ?? 0} 个服务商摘要。`,
    },
  ] as const;
  const nextAction = (() => {
    if (!serverListening) {
      return "先让 Lime 完整启动 Companion 宿主，再连接桌宠。";
    }
    if (!connected) {
      return "点击“开启桌宠”，或检查桌宠是否已连接到本地 Companion 地址。";
    }
    if (!supportsProviderOverview) {
      return "先让桌宠在 ready 事件里声明 Provider 概览能力，再尝试同步摘要。";
    }
    if (previewLoading) {
      return "等待 Lime 整理完当前 Provider 脱敏摘要。";
    }
    if (previewError) {
      return "先修复摘要预览异常，再把脱敏摘要发送给桌宠。";
    }
    return "当前链路已就绪，可以直接点击“立即同步到桌宠”。";
  })();

  return (
    <article
      className={SURFACE_CLASS_NAME}
      data-testid="companion-provider-card"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700">
              <Bot className="h-5 w-5" />
            </div>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900">
                  Lime Pet Companion
                </h3>
                <InfoPill
                  label={
                    connected
                      ? "桌宠已连接"
                      : serverListening
                        ? "等待桌宠连接"
                        : "本地 Companion 未监听"
                  }
                  tone={
                    connected ? "emerald" : serverListening ? "amber" : "slate"
                  }
                />
                <InfoPill
                  label={
                    supportsProviderOverview
                      ? "自动同步 Provider 概览"
                      : "未声明 Provider 概览"
                  }
                  tone={supportsProviderOverview ? "emerald" : "slate"}
                />
                <WorkbenchInfoTip
                  ariaLabel="桌宠 Companion 说明"
                  content="桌宠通过本地 Companion 通道复用 Lime 的 AI 服务商状态，只接收脱敏后的可用性摘要，不会直接读取 API Key、OAuth 凭证或本地凭证文件。"
                  tone="mint"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <RuntimeSummaryItem
              label="桥接状态"
              value={
                connected ? "已接通" : serverListening ? "等待连接" : "未监听"
              }
              hint="Lime 负责本地 Companion 宿主，桌宠作为独立原生壳接入。"
            />
            <RuntimeSummaryItem
              label="最近状态"
              value={lastState}
              hint={
                status?.last_event
                  ? `最近事件：${status.last_event}`
                  : "尚未收到桌宠事件"
              }
            />
            <RuntimeSummaryItem
              label="能力"
              value={capabilityText}
              hint="能力由桌宠在 ready 事件里声明，Lime 只按声明下发脱敏数据。"
            />
            <RuntimeSummaryItem
              label="桌宠身份"
              value={petIdentity}
              hint={`平台：${formatCompanionPlatformLabel(status?.platform)}`}
            />
            <RuntimeSummaryItem
              label="同步诊断"
              value={syncDiagnostic.label}
              hint={syncDiagnostic.hint}
            />
          </div>

          <div className="rounded-[18px] border border-slate-200/80 bg-slate-50 px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                  <span>接入检查</span>
                  <WorkbenchInfoTip
                    ariaLabel="桌宠接入检查说明"
                    content="按“宿主监听、桌宠连接、能力声明、摘要准备”这四步排查桌宠接入状态。"
                    tone="slate"
                  />
                </div>
              </div>
              <div className="rounded-[14px] border border-slate-200/80 bg-white px-3 py-2 text-xs text-slate-600">
                当前建议：
                <span className="font-medium text-slate-800">{nextAction}</span>
              </div>
            </div>

            <div
              className="mt-4 grid gap-3 md:grid-cols-2"
              data-testid="companion-readiness-grid"
            >
              {readinessChecks.map((item) => (
                <div
                  key={item.key}
                  className="rounded-[16px] border border-white bg-white px-4 py-3 shadow-sm shadow-slate-950/5"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border",
                        item.done
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : item.pending
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-slate-200 bg-slate-50 text-slate-500",
                      )}
                    >
                      {item.done ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : item.pending ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-900">
                        {item.label}
                      </p>
                      <p className="text-xs leading-5 text-slate-500">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[18px] border border-slate-200/80 bg-slate-50 px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                  <span>桌宠视角预览</span>
                  <WorkbenchInfoTip
                    ariaLabel="桌宠视角预览说明"
                    content="这里展示 Lime 准备发给桌宠的服务商脱敏摘要，会合并当前 AI 服务商配置与凭证池状态，但不会带出原始凭证。"
                    tone="slate"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <InfoPill
                  label={`服务商 ${providerOverviewPreview?.total_provider_count ?? 0}`}
                />
                <InfoPill
                  label={`可用 ${providerOverviewPreview?.available_provider_count ?? 0}`}
                  tone="emerald"
                />
                <InfoPill
                  label={`需关注 ${providerOverviewPreview?.needs_attention_provider_count ?? 0}`}
                  tone="amber"
                />
                <InfoPill
                  label={`最近同步 ${formatCompanionDateTime(lastManualSyncAt)}`}
                />
                <button
                  type="button"
                  onClick={() => void handleSyncPreview()}
                  disabled={
                    previewLoading ||
                    syncingPreview ||
                    !providerOverviewPreview ||
                    !connected ||
                    !supportsProviderOverview
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-[14px] border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="companion-sync-preview"
                >
                  {syncingPreview ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  立即同步到桌宠
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-[14px] border border-slate-200/80 bg-white px-3 py-2 text-xs text-slate-500">
              Companion 地址：
              <span className="font-medium text-slate-700">{endpoint}</span>
            </div>

            {previewLoading ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                正在整理桌宠摘要预览...
              </div>
            ) : previewProviders.length > 0 ? (
              <div
                className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3"
                data-testid="companion-provider-preview-grid"
              >
                {previewProviders.map((provider) => (
                  <div
                    key={provider.provider_type}
                    className="rounded-[16px] border border-white bg-white px-4 py-3 shadow-sm shadow-slate-950/5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {provider.display_name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {provider.provider_type}
                        </p>
                      </div>
                      <InfoPill
                        label={provider.available ? "可用" : "不可用"}
                        tone={provider.available ? "emerald" : "amber"}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                      <span>配置 {provider.total_count}</span>
                      <span>健康 {provider.healthy_count}</span>
                      {provider.needs_attention ? (
                        <span className="text-amber-700">需要关注</span>
                      ) : (
                        <span className="text-emerald-700">状态稳定</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-[16px] border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500">
                当前还没有可供桌宠消费的服务商摘要。配置任一服务商后，这里会显示脱敏后的可用性信息。
              </div>
            )}
          </div>

          {status?.last_error ? (
            <NoticeBar
              tone="error"
              message={`桌宠最近一次错误：${status.last_error}`}
            />
          ) : null}

          {previewError ? (
            <NoticeBar tone="error" message={previewError} />
          ) : null}

          {installPromptVisible ? (
            <div
              className="rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-4 shadow-sm shadow-slate-950/5"
              data-testid="companion-install-guide"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-amber-900">
                    还没有安装 Lime Pet
                  </p>
                  <p className="text-sm leading-6 text-amber-800">
                    先安装桌宠客户端，再回到这里点击“开启桌宠”，Lime
                    会继续负责本地 Companion 宿主与状态同步。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void openUrl(LIME_PET_RELEASES_URL)}
                  className="inline-flex items-center justify-center gap-2 rounded-[14px] border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900 transition hover:border-amber-400 hover:bg-amber-100/40"
                  data-testid="companion-install-button"
                >
                  <ExternalLink className="h-4 w-4" />
                  下载安装 Lime Pet
                </button>
              </div>
            </div>
          ) : null}

          {actionFeedback ? (
            <NoticeBar
              tone={actionFeedback.tone}
              message={actionFeedback.message}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-2 xl:min-w-[220px]">
          <button
            type="button"
            onClick={() => void refreshStatus()}
            disabled={loadingStatus || refreshingStatus}
            className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
            data-testid="companion-refresh"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                (loadingStatus || refreshingStatus) && "animate-spin",
              )}
            />
            {loadingStatus ? "读取状态中" : "刷新桌宠状态"}
          </button>
          <button
            type="button"
            onClick={() => void handleLaunchPet()}
            disabled={launchingPet}
            className={PRIMARY_ACTION_BUTTON_CLASS}
            data-testid="companion-launch"
          >
            {launchingPet ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Bot className="h-4 w-4" />
            )}
            {connected ? "重新打开桌宠" : "开启桌宠"}
          </button>
        </div>
      </div>
    </article>
  );
}

function resolveOfferTone(state: string): "slate" | "emerald" | "amber" {
  switch (state) {
    case "available_ready":
      return "emerald";
    case "available_quota_low":
    case "available_subscribe_required":
      return "amber";
    default:
      return "slate";
  }
}

type DisplayableOffer =
  | OemCloudProviderOfferSummary
  | OemCloudProviderOfferDetail;

function resolveDisplayOfferState(
  session: OemCloudCurrentSession | null,
  offer?: DisplayableOffer | null,
): OemCloudProviderOfferState | undefined {
  if (!offer) {
    return undefined;
  }

  if (!session || offer.state !== "available_logged_out") {
    return offer.state;
  }

  const accessMode =
    "access" in offer ? offer.access.accessMode : offer.effectiveAccessMode;
  const hasSessionBackedAccess =
    accessMode === "session" || accessMode === "hub_token";
  const hasLoggedInEvidence =
    offer.loggedIn ||
    offer.accountStatus === "logged_in" ||
    ("access" in offer && Boolean(offer.access.sessionTokenRef));

  if (!hasSessionBackedAccess || !hasLoggedInEvidence) {
    return offer.state;
  }

  if (offer.accountStatus === "blocked") {
    return "blocked";
  }
  if (
    offer.subscriptionStatus === "none" ||
    offer.subscriptionStatus === "expired"
  ) {
    return "available_subscribe_required";
  }
  if (offer.canInvoke) {
    if (offer.quotaStatus === "low") {
      return "available_quota_low";
    }
    return "available_ready";
  }
  if (offer.quotaStatus === "exhausted") {
    return "blocked";
  }
  return "available_subscribe_required";
}

type ProviderWorkspaceView = SettingsProviderView;

const PROVIDER_WORKSPACE_VIEW_META: Array<{
  value: ProviderWorkspaceView;
  label: string;
  summary: string;
  icon: typeof KeyRound;
}> = [
  {
    value: "settings",
    label: "服务商设置",
    summary: "Provider / API Key / 模型",
    icon: KeyRound,
  },
  {
    value: "cloud",
    label: "云端服务",
    summary: "Offer / 目录 / 会话",
    icon: Cloud,
  },
  {
    value: "companion",
    label: "桌宠管理",
    summary: "Companion / 同步 / 诊断",
    icon: Bot,
  },
];

function isLimeBrandedHub(hubProviderName: string | null | undefined): boolean {
  if (typeof hubProviderName !== "string") {
    return false;
  }

  return hubProviderName.trim().toLowerCase().includes("lime");
}

export interface CloudProviderSettingsProps {
  initialView?: ProviderWorkspaceView;
}

export function CloudProviderSettings(props: CloudProviderSettingsProps) {
  const { initialView } = props;
  const {
    runtime,
    hubProviderName,
    session,
    offers,
    preference,
    cloudActivation,
    cloudReadiness,
    pendingPayment,
    paymentConfigs,
    plans,
    subscription,
    creditAccount,
    creditsDashboard,
    topupPackages,
    usageDashboard,
    billingDashboard,
    orders,
    creditTopupOrders,
    accessTokens,
    activeAccessToken,
    lastIssuedRawToken,
    paymentWatcher,
    commerceErrorMessage,
    selectedOffer,
    selectedModels,
    defaultCloudOffer,
    activeCloudOffer,
    initializing,
    refreshing,
    loadingCommerce,
    loadingDetail,
    openingGoogleLogin,
    savingDefault,
    orderingPlanId,
    creatingTopupPackageId,
    managingToken,
    errorMessage,
    infoMessage,
    defaultProviderSummary,
    activeDeveloperAccessEnabled,
    handleRefresh,
    handleGoogleLogin,
    openOfferDetail,
    handleSetDefault,
    handlePurchasePlan,
    handleTopupCredits,
    handleCreateAccessToken,
    handleRotateAccessToken,
    handleRevokeAccessToken,
    handleDismissIssuedToken,
    openUserCenter,
  } = useOemCloudAccess();

  const isOemRuntime = Boolean(runtime);
  const isLimeBrand = isLimeBrandedHub(hubProviderName);
  const cloudBrandLabel = hubProviderName?.trim() || "Lime 云端";
  const showProviderSettingsEntry =
    !isOemRuntime || isLimeBrand || activeDeveloperAccessEnabled;
  const workspaceViews = useMemo(() => {
    const orderedViews: ProviderWorkspaceView[] = [];

    if (isOemRuntime && !isLimeBrand) {
      orderedViews.push("cloud");
    }

    if (showProviderSettingsEntry) {
      orderedViews.push("settings");
    }

    if (!orderedViews.includes("cloud")) {
      orderedViews.push("cloud");
    }

    if (!orderedViews.includes("companion")) {
      orderedViews.push("companion");
    }

    return orderedViews.map(
      (view) =>
        PROVIDER_WORKSPACE_VIEW_META.find((item) => item.value === view)!,
    );
  }, [isLimeBrand, isOemRuntime, showProviderSettingsEntry]);
  const defaultView =
    initialView && workspaceViews.some((item) => item.value === initialView)
      ? initialView
      : (workspaceViews[0]?.value ?? "cloud");
  const [activeView, setActiveView] =
    useState<ProviderWorkspaceView>(defaultView);
  const [selectedPaymentOptionId, setSelectedPaymentOptionId] =
    useState<string>("");
  const [selectedPlanBillingCycle, setSelectedPlanBillingCycle] =
    useState<OemCloudBillingCycle>("monthly");
  const [cloudCommerceView, setCloudCommerceView] = useState<
    "usage" | "billing" | "plans"
  >("usage");
  const [modelSearch, setModelSearch] = useState("");
  const cloudLoginAutoOpenKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceViews.some((item) => item.value === activeView)) {
      setActiveView(defaultView);
    }
  }, [activeView, defaultView, workspaceViews]);

  useEffect(() => {
    if (!initialView) {
      return;
    }

    if (workspaceViews.some((item) => item.value === initialView)) {
      setActiveView(initialView);
    }
  }, [initialView, workspaceViews]);

  useEffect(() => {
    if (
      activeView !== "cloud" ||
      !runtime ||
      session ||
      initializing ||
      openingGoogleLogin
    ) {
      return;
    }

    const autoOpenKey = `${runtime.baseUrl}::${runtime.tenantId}`;
    if (cloudLoginAutoOpenKeyRef.current === autoOpenKey) {
      return;
    }

    cloudLoginAutoOpenKeyRef.current = autoOpenKey;
    void handleGoogleLogin();
  }, [
    activeView,
    handleGoogleLogin,
    initializing,
    openingGoogleLogin,
    runtime,
    session,
  ]);

  useEffect(() => {
    const firstPaymentOption = buildPaymentOptions(paymentConfigs)[0]?.id ?? "";
    if (!firstPaymentOption) {
      setSelectedPaymentOptionId("");
      return;
    }

    setSelectedPaymentOptionId((current) => current || firstPaymentOption);
  }, [paymentConfigs]);

  useEffect(() => {
    if (!session || selectedOffer || loadingDetail || offers.length === 0) {
      return;
    }

    const initialOffer = defaultCloudOffer ?? offers[0];
    if (initialOffer) {
      void openOfferDetail(initialOffer.providerKey);
    }
  }, [
    defaultCloudOffer,
    loadingDetail,
    offers,
    openOfferDetail,
    selectedOffer,
    session,
  ]);

  useEffect(() => {
    setModelSearch("");
  }, [selectedOffer?.providerKey]);

  const selectedOfferKey =
    selectedOffer?.providerKey ?? defaultCloudOffer?.providerKey;
  const paymentOptions = useMemo(
    () => buildPaymentOptions(paymentConfigs),
    [paymentConfigs],
  );
  const selectedPaymentOption = useMemo(
    () =>
      paymentOptions.find((item) => item.id === selectedPaymentOptionId) ??
      paymentOptions[0] ??
      null,
    [paymentOptions, selectedPaymentOptionId],
  );
  const selectedPaymentConfig = selectedPaymentOption?.config ?? null;
  const availablePlanBillingCycles = useMemo(() => {
    const cycleMap = new Map<OemCloudBillingCycle, string>();
    plans.forEach((plan) => {
      plan.billingCycles.forEach((cycle) => {
        if (!cycleMap.has(cycle.key)) {
          cycleMap.set(
            cycle.key,
            cycle.label || formatBillingCycleLabel(cycle.key),
          );
        }
      });
    });

    const order = ["monthly", "yearly", "one_time"];
    return Array.from(cycleMap.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((left, right) => {
        const leftIndex = order.indexOf(left.key);
        const rightIndex = order.indexOf(right.key);
        if (leftIndex === -1 && rightIndex === -1) {
          return left.label.localeCompare(right.label, "zh-CN");
        }
        if (leftIndex === -1) {
          return 1;
        }
        if (rightIndex === -1) {
          return -1;
        }
        return leftIndex - rightIndex;
      });
  }, [plans]);

  useEffect(() => {
    if (availablePlanBillingCycles.length === 0) {
      return;
    }
    if (
      !availablePlanBillingCycles.some(
        (cycle) => cycle.key === selectedPlanBillingCycle,
      )
    ) {
      setSelectedPlanBillingCycle(availablePlanBillingCycles[0].key);
    }
  }, [availablePlanBillingCycles, selectedPlanBillingCycle]);

  const rawBillingCurrency = billingDashboard?.billingSummary.currency ?? "";
  const billingCurrency = /^[A-Z]{3}$/.test(rawBillingCurrency)
    ? rawBillingCurrency
    : "CNY";
  const currentPlanName =
    subscription?.planName ||
    billingDashboard?.currentPlan?.name ||
    activeCloudOffer?.currentPlan ||
    "未开通";
  const monthlyUsageSummary = usageDashboard?.monthlySummary;
  const monthlyUsedCredits =
    (monthlyUsageSummary?.freeCreditsUsed ?? 0) +
    (monthlyUsageSummary?.topupCreditsUsed ?? 0) +
    (monthlyUsageSummary?.subscriptionCreditsUsed ?? 0);
  const monthlyLimitCredits =
    (monthlyUsageSummary?.freeCreditsLimit ?? 0) +
    (monthlyUsageSummary?.topupCreditsLimit ?? 0) +
    (monthlyUsageSummary?.subscriptionCreditsLimit ?? 0);
  const llmBaseUrl =
    cloudActivation?.llmBaseUrl ||
    cloudActivation?.gateway.llmBaseUrl ||
    cloudActivation?.gateway.basePath ||
    (loadingCommerce ? "同步中" : "未配置");
  const openAIBaseUrl =
    cloudActivation?.openAIBaseUrl ||
    cloudActivation?.gateway.openAIBaseUrl ||
    "";
  const anthropicBaseUrl =
    cloudActivation?.anthropicBaseUrl ||
    cloudActivation?.gateway.anthropicBaseUrl ||
    "";
  const gatewaySnippetOptions = useMemo<GatewaySnippetOptions>(
    () => ({
      tenantId: session?.tenant.id ?? runtime?.tenantId ?? "",
      authorizationHeader: cloudActivation?.gateway.authorizationHeader,
      authorizationScheme: cloudActivation?.gateway.authorizationScheme,
      tenantHeader: cloudActivation?.gateway.tenantHeader,
    }),
    [
      cloudActivation?.gateway.authorizationHeader,
      cloudActivation?.gateway.authorizationScheme,
      cloudActivation?.gateway.tenantHeader,
      runtime?.tenantId,
      session?.tenant.id,
    ],
  );
  const displayedPlanOrders =
    billingDashboard?.orders && billingDashboard.orders.length > 0
      ? billingDashboard.orders
      : orders;
  const displayedCreditOrders =
    creditsDashboard?.creditOrders && creditsDashboard.creditOrders.length > 0
      ? creditsDashboard.creditOrders
      : creditTopupOrders;
  const displayedCreditWallets = creditsDashboard?.creditWallets ?? [];
  const creditBreakdownItems = [
    {
      key: "free",
      label: "每日基础积分",
      used: monthlyUsageSummary?.freeCreditsUsed ?? 0,
      limit: monthlyUsageSummary?.freeCreditsLimit ?? 0,
      tone: "sky",
    },
    {
      key: "subscription",
      label: "套餐积分",
      used: monthlyUsageSummary?.subscriptionCreditsUsed ?? 0,
      limit: monthlyUsageSummary?.subscriptionCreditsLimit ?? 0,
      tone: "emerald",
    },
    {
      key: "topup",
      label: "补充积分",
      used: monthlyUsageSummary?.topupCreditsUsed ?? 0,
      limit: monthlyUsageSummary?.topupCreditsLimit ?? 0,
      tone: "amber",
    },
  ];
  const monthlyUsagePercent = buildUsagePercent(
    monthlyUsedCredits,
    monthlyLimitCredits,
  );
  const dailyUsageBuckets = useMemo(
    () => buildDailyUsageBuckets(usageDashboard?.usageRecords ?? [], 14),
    [usageDashboard?.usageRecords],
  );
  const maxDailyUsageCredits = Math.max(
    1,
    ...dailyUsageBuckets.map((item) => item.credits),
  );
  const recentUsageRecords = usageDashboard?.usageRecords.slice(0, 8) ?? [];
  const recentPlanOrders = displayedPlanOrders.slice(0, 8);
  const recentCreditOrders = displayedCreditOrders.slice(0, 8);
  const subscriptionPeriodLabel = formatSubscriptionPeriod(
    subscription?.currentPeriodStart ||
      billingDashboard?.billingSummary.currentPeriodStart,
    subscription?.currentPeriodEnd ||
      billingDashboard?.billingSummary.currentPeriodEnd,
    billingDashboard?.billingSummary.renewalAt
      ? `下次续费 ${formatOemCloudDateTime(billingDashboard.billingSummary.renewalAt)}`
      : undefined,
  );
  const accountIdentityLabel =
    session?.user.displayName ||
    session?.user.email ||
    session?.user.username ||
    session?.user.id ||
    "已登录";
  const pendingPaymentReference = pendingPayment?.paymentReference;
  const canOpenPendingPayment = Boolean(
    pendingPaymentReference && /^https?:\/\//i.test(pendingPaymentReference),
  );
  const sdkModelId = resolveSdkModelId(selectedModels);
  const canRenderSdkSnippets = Boolean(sdkModelId && openAIBaseUrl);
  const canRenderAnthropicSnippet = Boolean(sdkModelId && anthropicBaseUrl);
  const filteredSelectedModels = useMemo(() => {
    const keyword = modelSearch.trim().toLowerCase();
    if (!keyword) {
      return selectedModels;
    }

    return selectedModels.filter((model) =>
      [
        model.displayName,
        model.modelId,
        model.description,
        ...(model.abilities ?? []),
        ...(model.task_families ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [modelSearch, selectedModels]);

  const cloudDirectoryContent = !runtime ? (
    <section className="space-y-4">
      <article className={SURFACE_CLASS_NAME}>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-slate-900">
            当前版本未配置云端服务
          </h3>
          <p className="text-sm leading-6 text-slate-600">
            本地功能可直接使用；连接入口由品牌服务下发后显示。
          </p>
        </div>
      </article>
    </section>
  ) : initializing ? (
    <article className={SURFACE_CLASS_NAME}>
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        正在恢复个人中心会话...
      </div>
    </article>
  ) : !session ? (
    <section className="space-y-4" data-testid="cloud-login-redirect-state">
      <article className={SURFACE_CLASS_NAME}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-slate-900">
              正在打开 {cloudBrandLabel} 登录
            </h3>
            <p className="text-sm leading-6 text-slate-600">
              登录完成后自动同步套餐、积分、API Key 和模型目录。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleGoogleLogin()}
            disabled={openingGoogleLogin}
            className={PRIMARY_ACTION_BUTTON_CLASS}
            data-testid="open-cloud-login"
          >
            <LogIn className="h-4 w-4" />
            {openingGoogleLogin ? "正在打开登录页..." : "重新打开登录页"}
          </button>
        </div>
      </article>
    </section>
  ) : (
    <section className="space-y-4" data-testid="oem-cloud-commerce-page">
      {commerceErrorMessage ? (
        <NoticeBar tone="error" message={commerceErrorMessage} />
      ) : null}

      <article
        className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-sm shadow-slate-950/5"
        data-testid="cloud-plan-summary-card"
      >
        <div className="bg-[linear-gradient(135deg,rgba(255,255,255,0.98)_0%,rgba(248,252,249,0.96)_48%,rgba(241,246,255,0.94)_100%)] p-5">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <InfoPill label={cloudBrandLabel} tone="emerald" />
                {loadingCommerce ? (
                  <InfoPill label="同步中" tone="amber" />
                ) : null}
                <InfoPill
                  label={formatSubscriptionStatus(subscription?.status)}
                  tone={subscription?.status === "active" ? "emerald" : "slate"}
                />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">当前套餐</p>
                <h3 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                  {currentPlanName}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {subscriptionPeriodLabel} · {accountIdentityLabel}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                data-testid="oem-cloud-refresh"
              >
                <RefreshCw
                  className={cn("h-4 w-4", refreshing && "animate-spin")}
                />
                刷新
              </button>
              <button
                type="button"
                onClick={() => void openUserCenter("")}
                className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <ExternalLink className="h-4 w-4" />
                用户中心
              </button>
              <button
                type="button"
                onClick={() => setCloudCommerceView("plans")}
                className={PRIMARY_ACTION_BUTTON_CLASS}
              >
                <CreditCard className="h-4 w-4" />
                升级
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,0.8fr))]">
            <div className="rounded-[20px] border border-white bg-white px-4 py-3 shadow-sm shadow-slate-950/5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-slate-600">本月已用</span>
                <span className="font-semibold text-slate-950">
                  {monthlyUsagePercent}%
                </span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${monthlyUsagePercent}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {formatUsageRatio(monthlyUsedCredits, monthlyLimitCredits)} 积分
              </p>
            </div>
            <SessionValueCard
              label="可用积分"
              value={formatCreditAmount(creditAccount?.balance)}
              hint="来自服务端积分账户余额"
              icon={<WalletCards className="h-3.5 w-3.5" />}
            />
            <SessionValueCard
              label="支付方式"
              value={selectedPaymentOption?.label ?? "暂不可购买"}
              hint="只显示服务端启用的支付配置"
              icon={<CreditCard className="h-3.5 w-3.5" />}
            />
          </div>
        </div>
      </article>

      <CloudCommerceStatusBar
        readiness={cloudReadiness}
        pendingPayment={pendingPayment}
        paymentWatcher={paymentWatcher}
        onRefresh={() => void handleRefresh()}
        onCreateKey={() => void handleCreateAccessToken()}
        onOpenPayment={() => {
          if (pendingPaymentReference) {
            void openUrl(pendingPaymentReference);
          }
        }}
        creatingKey={managingToken === "create"}
        refreshing={refreshing}
      />

      {cloudCommerceView === "plans" ? (
        <article
          className={SURFACE_CLASS_NAME}
          data-testid="cloud-plan-upgrade-page"
        >
          <div className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setCloudCommerceView("usage")}
                  className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900"
                >
                  ← 返回使用详情
                </button>
                <div>
                  <h3 className="text-xl font-semibold text-slate-950">
                    选择适合你的套餐
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    套餐、价格和权益全部来自服务端配置；购买后通过真实支付回调同步权益。
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {availablePlanBillingCycles.map((cycle) => (
                  <button
                    key={cycle.key}
                    type="button"
                    onClick={() => setSelectedPlanBillingCycle(cycle.key)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm font-medium transition",
                      selectedPlanBillingCycle === cycle.key
                        ? "border-slate-950 bg-slate-950 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {cycle.label || formatBillingCycleLabel(cycle.key)}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="flex flex-wrap gap-2"
              data-testid="cloud-payment-options"
            >
              {paymentOptions.length > 0 ? (
                paymentOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSelectedPaymentOptionId(option.id)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      selectedPaymentOption?.id === option.id
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    {option.label}
                  </button>
                ))
              ) : (
                <InfoPill label="服务端未启用支付渠道" tone="amber" />
              )}
              {canOpenPendingPayment ? (
                <button
                  type="button"
                  onClick={() =>
                    pendingPaymentReference &&
                    void openUrl(pendingPaymentReference)
                  }
                  className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-100"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  继续支付
                </button>
              ) : null}
            </div>

            {plans.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
                服务端暂未发布可购买套餐。
              </div>
            ) : (
              <div
                className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4"
                data-testid="cloud-plan-grid"
              >
                {plans.map((plan) => {
                  const selectedCycle = resolvePlanCycleByKey(
                    plan,
                    selectedPlanBillingCycle,
                  );
                  const lowerPlanKey = plan.key.toLowerCase();
                  const isFreePlan =
                    lowerPlanKey.includes("free") ||
                    (selectedCycle?.priceCents ?? plan.priceMonthly) <= 0;
                  const isCurrentPlan =
                    subscription?.planId === plan.id ||
                    subscription?.planKey === plan.key ||
                    (!subscription && isFreePlan);
                  const disabled =
                    isCurrentPlan ||
                    !selectedPaymentConfig ||
                    !selectedCycle ||
                    orderingPlanId === plan.id;
                  const featureItems = (
                    plan.featureSections.length > 0
                      ? plan.featureSections.flatMap((section) => section.items)
                      : plan.quotaSummaries.length > 0
                        ? plan.quotaSummaries.map((item) => item.value)
                        : plan.features
                  ).slice(0, 5);
                  const priceLabel = formatMoneyCents(
                    selectedCycle?.priceCents ?? plan.priceMonthly,
                    billingCurrency,
                  );
                  const actionLabel = isCurrentPlan
                    ? "当前套餐"
                    : orderingPlanId === plan.id
                      ? "正在打开支付..."
                      : selectedPaymentConfig
                        ? subscription
                          ? "升级"
                          : "选择套餐"
                        : "暂不可购买";

                  return (
                    <div
                      key={plan.id}
                      className={cn(
                        "flex min-h-[320px] flex-col rounded-[24px] border bg-white p-5 shadow-sm shadow-slate-950/5",
                        plan.recommended || isCurrentPlan
                          ? "border-emerald-200 ring-1 ring-emerald-100"
                          : "border-slate-200/80",
                      )}
                    >
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {isCurrentPlan ? (
                            <InfoPill label="当前" tone="emerald" />
                          ) : plan.recommended ? (
                            <InfoPill
                              label={plan.badge || "推荐"}
                              tone="emerald"
                            />
                          ) : plan.badge ? (
                            <InfoPill label={plan.badge} />
                          ) : null}
                        </div>
                        <div>
                          <h4 className="text-xl font-semibold text-slate-950">
                            {plan.name}
                          </h4>
                          <p className="mt-2 min-h-[44px] text-sm leading-6 text-slate-600">
                            {plan.tagline ||
                              plan.description ||
                              "服务端配置的套餐权益"}
                          </p>
                        </div>
                        <div>
                          <span className="text-3xl font-semibold tracking-tight text-slate-950">
                            {priceLabel}
                          </span>
                          <span className="ml-2 text-sm text-slate-500">
                            / {formatBillingCycleLabel(selectedCycle?.key)}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600">
                          含{" "}
                          {formatCreditAmount(
                            selectedCycle?.credits ?? plan.creditsMonthly,
                          )}{" "}
                          积分
                        </p>
                      </div>

                      <div className="mt-5 flex-1 space-y-2">
                        {featureItems.length > 0 ? (
                          featureItems.map((item) => (
                            <div
                              key={`${plan.id}-${item}`}
                              className="flex items-start gap-2 text-sm leading-6 text-slate-600"
                            >
                              <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-500" />
                              <span>{item}</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm leading-6 text-slate-500">
                            具体权益以服务端套餐配置为准。
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                          selectedCycle && selectedPaymentConfig
                            ? void handlePurchasePlan({
                                planId: plan.id,
                                billingCycle: selectedCycle.key,
                                paymentChannel:
                                  selectedPaymentOption?.provider ??
                                  selectedPaymentConfig.provider,
                                paymentMethod: selectedPaymentOption?.method,
                              })
                            : undefined
                        }
                        className={cn(
                          isCurrentPlan
                            ? "mt-5 inline-flex items-center justify-center rounded-[16px] border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-500"
                            : cn(PRIMARY_ACTION_BUTTON_CLASS, "mt-5 w-full"),
                        )}
                      >
                        {orderingPlanId === plan.id ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : isCurrentPlan ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <CreditCard className="h-4 w-4" />
                        )}
                        {actionLabel}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">
                    补充积分
                  </h4>
                  <p className="mt-1 text-sm text-slate-500">
                    余额不足时可按服务端积分包充值；没有积分包时不显示兜底套餐。
                  </p>
                </div>
                {topupPackages.length === 0 ? (
                  <InfoPill label="暂无积分包" />
                ) : null}
              </div>
              {topupPackages.length > 0 ? (
                <div
                  className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3"
                  data-testid="cloud-topup-grid"
                >
                  {topupPackages.map((item) => {
                    const totalCredits =
                      item.credits + (item.bonusCredits ?? 0);
                    const disabled =
                      !selectedPaymentConfig ||
                      creatingTopupPackageId === item.id;
                    return (
                      <div
                        key={item.id}
                        className="rounded-[18px] border border-slate-200 bg-white px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {item.name}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatCreditAmount(totalCredits)} 积分 · 有效{" "}
                              {item.validDays} 天
                            </p>
                          </div>
                          <span className="text-sm font-semibold text-slate-950">
                            {formatMoneyCents(item.priceCents, billingCurrency)}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            selectedPaymentConfig
                              ? void handleTopupCredits({
                                  packageId: item.id,
                                  paymentChannel:
                                    selectedPaymentOption?.provider ??
                                    selectedPaymentConfig.provider,
                                  paymentMethod: selectedPaymentOption?.method,
                                })
                              : undefined
                          }
                          className={cn(
                            PRIMARY_ACTION_BUTTON_CLASS,
                            "mt-3 w-full px-3 py-2 text-xs",
                          )}
                        >
                          {creatingTopupPackageId === item.id ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <WalletCards className="h-4 w-4" />
                          )}
                          {selectedPaymentConfig ? "充值" : "暂不可购买"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </article>
      ) : (
        <article
          className={SURFACE_CLASS_NAME}
          data-testid="cloud-commerce-dashboard"
        >
          <div className="space-y-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-100 p-1">
                {[
                  ["usage", "使用详情"],
                  ["billing", "账单"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      setCloudCommerceView(value as "usage" | "billing")
                    }
                    className={cn(
                      "rounded-full px-4 py-2 text-sm font-medium transition",
                      cloudCommerceView === value
                        ? "bg-white text-slate-950 shadow-sm shadow-slate-950/5"
                        : "text-slate-500 hover:text-slate-800",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setCloudCommerceView("plans")}
                className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <CreditCard className="h-4 w-4" />
                查看套餐
              </button>
            </div>

            {cloudCommerceView === "usage" ? (
              <div className="space-y-5" data-testid="cloud-usage-details">
                <div className="grid gap-3 md:grid-cols-3">
                  {creditBreakdownItems.map((item) => (
                    <div
                      key={item.key}
                      className="rounded-[20px] border border-slate-200/80 bg-slate-50 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-600">
                          {item.label}
                        </p>
                        <span className="text-xs font-medium text-slate-400">
                          {buildUsagePercent(item.used, item.limit)}%
                        </span>
                      </div>
                      <p className="mt-3 text-xl font-semibold text-slate-950">
                        {formatUsageRatio(item.used, item.limit)}
                      </p>
                      <div className="mt-3 h-1.5 rounded-full bg-white">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            item.tone === "emerald"
                              ? "bg-emerald-500"
                              : item.tone === "amber"
                                ? "bg-amber-500"
                                : "bg-sky-500",
                          )}
                          style={{
                            width: `${buildUsagePercent(item.used, item.limit)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">
                        近 14 天消耗
                      </h4>
                      <p className="mt-1 text-sm text-slate-500">
                        从服务端用量记录聚合，不生成兜底数据。
                      </p>
                    </div>
                    <InfoPill label={`${recentUsageRecords.length} 条记录`} />
                  </div>
                  <div className="mt-4 flex h-44 items-end gap-2 rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                    {dailyUsageBuckets.map((bucket) => {
                      const height =
                        bucket.credits > 0
                          ? Math.max(
                              8,
                              Math.round(
                                (bucket.credits / maxDailyUsageCredits) * 100,
                              ),
                            )
                          : 2;
                      return (
                        <div
                          key={bucket.key}
                          className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                          title={`${bucket.key} · ${formatCreditAmount(bucket.credits)} 积分`}
                        >
                          <div className="flex h-full w-full items-end justify-center rounded-full bg-slate-100">
                            <div
                              className={cn(
                                "w-full max-w-[18px] rounded-full transition-all",
                                bucket.credits > 0
                                  ? "bg-slate-950"
                                  : "bg-slate-200",
                              )}
                              style={{ height: `${height}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-400">
                            {bucket.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200/80 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-3">
                    <h4 className="text-sm font-semibold text-slate-900">
                      用量记录
                    </h4>
                    <InfoPill label="真实账本" tone="emerald" />
                  </div>
                  {recentUsageRecords.length > 0 ? (
                    <div
                      className="divide-y divide-slate-100"
                      data-testid="cloud-usage-records"
                    >
                      {recentUsageRecords.map((record) => (
                        <div
                          key={record.id}
                          className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1.2fr_1fr_0.8fr_0.8fr] md:items-center"
                        >
                          <div>
                            <p className="font-medium text-slate-900">
                              {record.model || "未知模型"}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatOemCloudDateTime(record.createdAt)}
                            </p>
                          </div>
                          <span className="text-slate-600">
                            {formatCreditAmount(record.tokens)} tokens
                          </span>
                          <span className="font-medium text-slate-900">
                            {formatCreditAmount(record.credits)} 积分
                          </span>
                          <InfoPill
                            label={formatUsageStatusLabel(record.status)}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-8 text-center text-sm text-slate-500">
                      暂无用量记录。
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-5" data-testid="cloud-billing-details">
                <div className="grid gap-3 md:grid-cols-3">
                  <SessionValueCard
                    label="累计支付"
                    value={formatMoneyCents(
                      billingDashboard?.billingSummary.totalSpentCents,
                      billingCurrency,
                    )}
                    hint="服务端账单摘要返回"
                    icon={<ReceiptText className="h-3.5 w-3.5" />}
                  />
                  <SessionValueCard
                    label="下次付款"
                    value={formatMoneyCents(
                      billingDashboard?.billingSummary.nextPaymentAmountCents,
                      billingCurrency,
                    )}
                    hint="自动续费套餐才会返回下次金额"
                    icon={<CreditCard className="h-3.5 w-3.5" />}
                  />
                  <SessionValueCard
                    label="最近支付"
                    value={formatOemCloudDateTime(
                      billingDashboard?.billingSummary.lastPaidAt,
                    )}
                    hint="最近一笔已支付订单"
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  />
                </div>

                <div className="rounded-[24px] border border-slate-200/80 bg-white">
                  <div className="border-b border-slate-200/80 px-4 py-3">
                    <h4 className="text-sm font-semibold text-slate-900">
                      套餐订单
                    </h4>
                  </div>
                  {recentPlanOrders.length > 0 ? (
                    <div
                      className="divide-y divide-slate-100"
                      data-testid="cloud-plan-orders"
                    >
                      {recentPlanOrders.map((order: OemCloudOrder) => (
                        <div
                          key={order.id}
                          className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr] md:items-center"
                        >
                          <div>
                            <p className="font-medium text-slate-900">
                              {order.planName || order.planKey}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatOemCloudDateTime(
                                order.paidAt || order.createdAt,
                              )}
                            </p>
                          </div>
                          <span className="text-slate-600">
                            {formatBillingCycleLabel(order.billingCycle)}
                          </span>
                          <span className="font-medium text-slate-900">
                            {formatMoneyCents(
                              order.amountCents,
                              billingCurrency,
                            )}
                          </span>
                          <InfoPill
                            label={formatOrderStatusLabel(order.status)}
                            tone={resolvePaidCommerceTone(order.status)}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-8 text-center text-sm text-slate-500">
                      暂无套餐订单。
                    </div>
                  )}
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-[24px] border border-slate-200/80 bg-white">
                    <div className="border-b border-slate-200/80 px-4 py-3">
                      <h4 className="text-sm font-semibold text-slate-900">
                        充值订单
                      </h4>
                    </div>
                    {recentCreditOrders.length > 0 ? (
                      <div className="divide-y divide-slate-100">
                        {recentCreditOrders.map(
                          (order: OemCloudCreditTopupOrder) => (
                            <div key={order.id} className="px-4 py-3 text-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium text-slate-900">
                                  {order.packageName}
                                </span>
                                <InfoPill
                                  label={formatOrderStatusLabel(order.status)}
                                  tone={resolvePaidCommerceTone(order.status)}
                                />
                              </div>
                              <p className="mt-1 text-xs text-slate-500">
                                {formatMoneyCents(
                                  order.amountCents,
                                  billingCurrency,
                                )}{" "}
                                · {formatCreditAmount(order.creditsGranted)}{" "}
                                积分 ·{" "}
                                {formatOemCloudDateTime(
                                  order.paidAt || order.createdAt,
                                )}
                              </p>
                            </div>
                          ),
                        )}
                      </div>
                    ) : (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">
                        暂无充值订单。
                      </div>
                    )}
                  </div>

                  <div className="rounded-[24px] border border-slate-200/80 bg-white">
                    <div className="border-b border-slate-200/80 px-4 py-3">
                      <h4 className="text-sm font-semibold text-slate-900">
                        积分来源
                      </h4>
                    </div>
                    {displayedCreditWallets.length > 0 ? (
                      <div className="divide-y divide-slate-100">
                        {displayedCreditWallets
                          .slice(0, 6)
                          .map((wallet: OemCloudCreditWallet) => (
                            <div key={wallet.id} className="px-4 py-3 text-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium text-slate-900">
                                  {wallet.packageName || wallet.sourceType}
                                </span>
                                <InfoPill
                                  label={formatWalletStatusLabel(wallet.status)}
                                  tone={resolveActiveCommerceTone(
                                    wallet.status,
                                  )}
                                />
                              </div>
                              <p className="mt-1 text-xs text-slate-500">
                                剩余{" "}
                                {formatCreditAmount(wallet.remainingCredits)} /
                                共 {formatCreditAmount(wallet.grantedCredits)} ·
                                到期 {formatOemCloudDateTime(wallet.expiresAt)}
                              </p>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">
                        暂无积分来源。
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </article>
      )}

      <details
        className={SURFACE_CLASS_NAME}
        data-testid="oem-cloud-api-key-section"
      >
        <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900">
          API Key 与 SDK
          <span className="ml-2 text-xs font-normal text-slate-500">
            {activeAccessToken?.hasActive ? "已就绪" : "未创建"}
          </span>
        </summary>
        <div className="mt-4 space-y-4">
          {lastIssuedRawToken ? (
            <div className="rounded-[18px] border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-medium text-emerald-700">
                请立即保存，刷新后不会再次显示
              </p>
              <code className="mt-2 block break-all rounded-[14px] border border-emerald-200 bg-white px-3 py-2 text-xs text-slate-800">
                {lastIssuedRawToken}
              </code>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyTextToClipboard(lastIssuedRawToken)}
                  className="inline-flex items-center gap-2 rounded-[14px] border border-emerald-200 bg-white px-3 py-2 text-xs font-medium text-emerald-700"
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制 API Key
                </button>
                <button
                  type="button"
                  onClick={() => handleDismissIssuedToken()}
                  className="inline-flex items-center gap-2 rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600"
                >
                  我已保存
                </button>
              </div>
            </div>
          ) : null}

          {activeAccessToken?.hasActive && activeAccessToken.token ? (
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {activeAccessToken.token.name || "Desktop Key"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {activeAccessToken.token.tokenMasked ||
                      activeAccessToken.token.tokenPrefix}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={managingToken === activeAccessToken.token.id}
                    onClick={() =>
                      void handleRotateAccessToken(activeAccessToken.token!.id)
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {managingToken === activeAccessToken.token.id ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
                    轮换 Key
                  </button>
                  <button
                    type="button"
                    disabled={managingToken === activeAccessToken.token.id}
                    onClick={() =>
                      void handleRevokeAccessToken(activeAccessToken.token!.id)
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                  >
                    撤销 Key
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <SessionValueCard
              label="Base URL"
              value={llmBaseUrl}
              hint="只通过 limecore 统一入口调用，不暴露内部供应层"
            />
            <SessionValueCard
              label="OpenAI URL"
              value={openAIBaseUrl || "未配置"}
              hint="OpenAI-compatible SDK 使用的 /v1 入口"
            />
            <SessionValueCard
              label="Anthropic URL"
              value={anthropicBaseUrl || "未配置"}
              hint="Anthropic-compatible SDK 使用的根入口"
            />
            <SessionValueCard
              label="Key 数量"
              value={`${accessTokens.length} 个`}
              hint="包含活跃和历史 Key"
            />
          </div>

          {canRenderSdkSnippets ? (
            <div className="space-y-3" data-testid="oem-cloud-sdk-section">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-slate-900">
                  SDK 调用
                </h4>
                {activeAccessToken?.hasActive ? (
                  <InfoPill label="API Key 已就绪" tone="emerald" />
                ) : (
                  <InfoPill label="先创建 API Key" tone="amber" />
                )}
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                <SdkSnippetCard
                  title="OpenAI SDK"
                  description="用于 chat.completions 与 OpenAI-compatible 客户端。"
                  lines={buildOpenAISdkSnippet(
                    openAIBaseUrl,
                    sdkModelId,
                    gatewaySnippetOptions,
                  )}
                />
                {canRenderAnthropicSnippet ? (
                  <SdkSnippetCard
                    title="Anthropic SDK"
                    description="用于 Kimi / GLM / MiniMax / Mimo 等服务端下发的 Anthropic-compatible coding plan。"
                    lines={buildAnthropicSdkSnippet(
                      anthropicBaseUrl,
                      sdkModelId,
                      gatewaySnippetOptions,
                    )}
                  />
                ) : null}
              </div>
              <SdkSnippetCard
                title="最小 curl 测试"
                description="只保留最小请求，不生成兜底模型。"
                lines={buildCurlSmokeSnippet(
                  openAIBaseUrl,
                  sdkModelId,
                  gatewaySnippetOptions,
                )}
              />
            </div>
          ) : (
            <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-500">
              服务端尚未下发可用于 SDK 示例的 Base URL 或模型目录。
            </div>
          )}

          <button
            type="button"
            disabled={managingToken === "create"}
            onClick={() => void handleCreateAccessToken()}
            className={cn(PRIMARY_ACTION_BUTTON_CLASS, "w-full")}
          >
            {managingToken === "create" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            创建 API Key
          </button>
        </div>
      </details>

      <details
        className={SURFACE_CLASS_NAME}
        data-testid="oem-cloud-model-section"
      >
        <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900">
          可用模型
          <span className="ml-2 text-xs font-normal text-slate-500">
            {defaultProviderSummary || "未设默认来源"}
          </span>
        </summary>
        <div className="mt-4 space-y-4">
          {offers.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-500">
              当前租户还没有可用云端来源。请先在后台发布 Offer。
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-2" data-testid="oem-cloud-offer-grid">
                {offers.map((offer) => {
                  const isDefaultCloudOffer =
                    preference?.providerSource === "oem_cloud" &&
                    preference.providerKey === offer.providerKey;
                  const isFocused = selectedOfferKey === offer.providerKey;
                  const displayedOfferState = resolveDisplayOfferState(
                    session,
                    offer,
                  );
                  return (
                    <button
                      key={offer.providerKey}
                      type="button"
                      onClick={() => void openOfferDetail(offer.providerKey)}
                      className={cn(
                        "w-full rounded-[18px] border px-4 py-3 text-left transition",
                        isFocused
                          ? "border-emerald-300 bg-emerald-50/70 shadow-sm shadow-emerald-950/10"
                          : "border-slate-200 bg-slate-50 hover:bg-white",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {offer.displayName}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {offer.availableModelCount} 个模型 ·{" "}
                            {formatOemCloudModelsSourceLabel(
                              offer.modelsSource,
                            )}
                          </p>
                        </div>
                        <InfoPill
                          label={formatOemCloudOfferStateLabel(
                            displayedOfferState ?? offer.state,
                          )}
                          tone={resolveOfferTone(
                            displayedOfferState ?? offer.state,
                          )}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {isDefaultCloudOffer ? (
                          <InfoPill label="默认" tone="emerald" />
                        ) : null}
                        <InfoPill
                          label={formatOemCloudAccessModeLabel(
                            offer.effectiveAccessMode,
                          )}
                        />
                        {offer.tags?.slice(0, 2).map((tag) => (
                          <InfoPill
                            key={`${offer.providerKey}-${tag}`}
                            label={tag}
                          />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-[20px] border border-slate-200/80 bg-slate-50 p-4">
                {selectedOffer ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-base font-semibold text-slate-900">
                          {selectedOffer.displayName}
                        </h4>
                        <p className="mt-1 text-sm text-slate-500">
                          {formatOemCloudAccessModeLabel(
                            selectedOffer.access.accessMode,
                          )}{" "}
                          · {selectedModels.length} 个模型
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleSetDefault(selectedOffer)}
                        disabled={savingDefault === selectedOffer.providerKey}
                        className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                      >
                        {savingDefault === selectedOffer.providerKey ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        设为默认
                      </button>
                    </div>

                    {selectedModels.length > 0 ? (
                      <label className="flex items-center gap-2 rounded-[16px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                        <Search className="h-4 w-4 text-slate-400" />
                        <input
                          value={modelSearch}
                          onChange={(event) =>
                            setModelSearch(event.currentTarget.value)
                          }
                          placeholder="筛选模型、协议或能力"
                          className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                        />
                        <span className="text-xs text-slate-400">
                          {filteredSelectedModels.length}/
                          {selectedModels.length}
                        </span>
                      </label>
                    ) : null}

                    {loadingDetail ? (
                      <div className="flex items-center gap-3 rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        正在加载模型目录...
                      </div>
                    ) : filteredSelectedModels.length > 0 ? (
                      <div className="space-y-2">
                        {filteredSelectedModels.map((model) => {
                          const metadata = createOemCloudModelMetadata(model);
                          const abilityTags = (
                            metadata.task_families ?? []
                          ).map(formatOemModelTaskFamilyLabel);
                          const upstreamMapping =
                            metadata.alias_source === "oem"
                              ? metadata.canonical_model_id
                              : null;
                          return (
                            <div
                              key={model.id}
                              className="rounded-[16px] border border-slate-200/80 bg-white px-3 py-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">
                                    {model.displayName}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {model.modelId}
                                  </p>
                                </div>
                                {model.recommended ? (
                                  <InfoPill label="推荐" tone="emerald" />
                                ) : null}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <InfoPill
                                  label={formatOemModelDeploymentLabel(
                                    metadata.deployment_source,
                                  )}
                                />
                                {abilityTags.map((tag) => (
                                  <InfoPill
                                    key={`${model.id}-${tag}`}
                                    label={tag}
                                  />
                                ))}
                              </div>
                              {model.description ? (
                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                  {model.description}
                                </p>
                              ) : null}
                              {upstreamMapping ? (
                                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                                  实际映射：{model.modelId} → {upstreamMapping}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">
                        {selectedModels.length > 0
                          ? "没有匹配当前筛选条件的模型。"
                          : "当前来源还没有下发模型目录。"}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
                    <Layers3 className="h-8 w-8 text-slate-400" />
                    <p className="mt-3 text-sm font-medium text-slate-700">
                      选择云端来源查看模型
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      点击左侧来源后会展开模型、协议能力和默认来源操作。
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </details>
    </section>
  );

  const localProviderContent = <ProviderPoolPage hideHeader />;
  const companionContent = (
    <div className="space-y-5">
      <CompanionProviderBridgeCard />
      <CompanionCapabilityPreferencesCard />
    </div>
  );

  return (
    <div className="space-y-4">
      {errorMessage ? <NoticeBar tone="error" message={errorMessage} /> : null}
      {infoMessage ? <NoticeBar tone="success" message={infoMessage} /> : null}

      <Tabs
        value={activeView}
        onValueChange={(value) => setActiveView(value as ProviderWorkspaceView)}
        className="space-y-4"
      >
        {workspaceViews.length > 1 ? (
          <TabsList
            className={cn(
              "grid h-auto w-full gap-2 rounded-[22px] border border-slate-200/80 bg-slate-100 p-1.5 shadow-sm",
              workspaceViews.length === 3
                ? "md:max-w-[680px]"
                : "md:max-w-[460px]",
              workspaceViews.length === 1
                ? "grid-cols-1"
                : workspaceViews.length === 2
                  ? "grid-cols-2"
                  : "grid-cols-3",
            )}
            data-testid="provider-workspace-switcher"
          >
            {workspaceViews.map((item) => {
              const ItemIcon = item.icon;

              return (
                <TabsTrigger
                  key={item.value}
                  value={item.value}
                  className={cn(
                    "h-auto min-h-[60px] items-center justify-start gap-2 rounded-[18px] border border-transparent bg-transparent px-4 py-3 text-left text-slate-600 shadow-none",
                    ACTIVE_WORKSPACE_TRIGGER_CLASS,
                  )}
                  data-testid={`provider-workspace-tab-${item.value}`}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-2xl border border-current/15 bg-white/80 text-current">
                    <ItemIcon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-semibold">{item.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        ) : null}

        {showProviderSettingsEntry ? (
          <TabsContent value="settings" className="mt-0">
            {localProviderContent}
          </TabsContent>
        ) : null}

        <TabsContent value="cloud" className="mt-0">
          {cloudDirectoryContent}
        </TabsContent>

        <TabsContent value="companion" className="mt-0">
          {companionContent}
        </TabsContent>
      </Tabs>
    </div>
  );
}
