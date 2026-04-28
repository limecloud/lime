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
  ShieldCheck,
  Sparkles,
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
  OemCloudTopupPackage,
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

function CloudReadinessPanel(props: {
  readiness: ReturnType<typeof useOemCloudAccess>["cloudReadiness"];
  pendingPayment: ReturnType<typeof useOemCloudAccess>["pendingPayment"];
  paymentWatcher: ReturnType<typeof useOemCloudAccess>["paymentWatcher"];
  onRefresh: () => void;
  onCreateKey: () => void;
  onOpenPayment?: () => void;
  creatingKey: boolean;
}) {
  const { readiness, pendingPayment } = props;
  if (!readiness) {
    return null;
  }

  const ready = readiness.status === "ready";
  const warning =
    readiness.status === "quota_low" || readiness.status === "payment_pending";
  const primaryLabel =
    readiness.status === "no_api_key"
      ? "创建 API Key"
      : readiness.status === "payment_pending"
        ? "刷新支付状态"
        : readiness.nextAction || "刷新云端状态";
  const primaryAction =
    readiness.status === "no_api_key" ? props.onCreateKey : props.onRefresh;
  const canOpenPayment = Boolean(
    readiness.status === "payment_pending" &&
    pendingPayment?.paymentReference?.trim() &&
    /^https?:\/\//i.test(pendingPayment.paymentReference),
  );

  return (
    <article
      className={cn(
        SURFACE_CLASS_NAME,
        ready
          ? "border-emerald-200 bg-emerald-50/60"
          : warning
            ? "border-amber-200 bg-amber-50/70"
            : "border-slate-200 bg-white",
      )}
      data-testid="oem-cloud-activation-journey"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <InfoPill
              label={ready ? "READY" : warning ? "PENDING" : "SETUP"}
              tone={ready ? "emerald" : warning ? "amber" : "slate"}
            />
            <h3 className="text-lg font-semibold text-slate-900">
              {readiness.title}
            </h3>
          </div>
          {readiness.description ? (
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              {readiness.description}
            </p>
          ) : null}
          {pendingPayment ? (
            <div className="rounded-[18px] border border-amber-200 bg-white px-4 py-3 text-sm text-amber-800">
              待支付：{pendingPayment.title || pendingPayment.orderId} ·{" "}
              {formatMoneyCents(pendingPayment.amountCents)} ·{" "}
              {pendingPayment.paymentChannel || "未配置渠道"}
            </div>
          ) : null}
          {props.paymentWatcher ? (
            <div
              className={cn(
                "flex items-start gap-2 rounded-[18px] border bg-white px-4 py-3 text-sm leading-6",
                props.paymentWatcher.status === "confirmed"
                  ? "border-emerald-200 text-emerald-700"
                  : props.paymentWatcher.status === "stopped"
                    ? "border-amber-200 text-amber-800"
                    : "border-sky-200 text-sky-700",
              )}
            >
              {props.paymentWatcher.status === "waiting" ? (
                <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              ) : props.paymentWatcher.status === "confirmed" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>
                {props.paymentWatcher.title} ·{" "}
                {props.paymentWatcher.message || "正在确认支付状态"}
                {props.paymentWatcher.status === "waiting"
                  ? `（第 ${props.paymentWatcher.attempts} 次）`
                  : ""}
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
          {canOpenPayment ? (
            <button
              type="button"
              onClick={props.onOpenPayment}
              className={PRIMARY_ACTION_BUTTON_CLASS}
            >
              <ExternalLink className="h-4 w-4" />
              继续支付
            </button>
          ) : null}
          <button
            type="button"
            onClick={primaryAction}
            disabled={props.creatingKey}
            className={cn(
              ready || canOpenPayment
                ? "border-emerald-200 bg-white text-emerald-700"
                : PRIMARY_ACTION_BUTTON_CLASS,
              ready || canOpenPayment
                ? "inline-flex items-center justify-center gap-2 rounded-[16px] border px-4 py-2.5 text-sm font-medium transition hover:bg-emerald-50 disabled:opacity-60"
                : "",
            )}
          >
            {props.creatingKey ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : ready || canOpenPayment ? (
              <RefreshCw className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {ready ? "刷新状态" : primaryLabel}
          </button>
        </div>
      </div>

      {readiness.steps.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-5">
          {readiness.steps.map((step) => (
            <div
              key={step.key}
              className={cn(
                "rounded-[16px] border px-3 py-3",
                step.done
                  ? "border-emerald-200 bg-white text-emerald-700"
                  : "border-slate-200 bg-white text-slate-500",
              )}
            >
              <div className="flex items-center gap-2 text-xs font-medium">
                {step.done ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" />
                )}
                {step.label}
              </div>
              {step.description ? (
                <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">
                  {step.description}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
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

type CompactCommerceRecord = {
  id: string;
  kind: string;
  title: string;
  statusLabel: string;
  statusTone: "slate" | "emerald" | "amber";
  detail: string;
};

function resolvePaidCommerceTone(
  value?: string,
): CompactCommerceRecord["statusTone"] {
  return String(value).toLowerCase() === "paid" ? "emerald" : "amber";
}

function resolveActiveCommerceTone(
  value?: string,
): CompactCommerceRecord["statusTone"] {
  return String(value).toLowerCase() === "active" ? "emerald" : "slate";
}

function CommerceRecordRow(props: { record: CompactCommerceRecord }) {
  return (
    <div className="rounded-[16px] border border-slate-200/80 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            {props.record.kind}
          </span>
          <span className="truncate text-sm font-medium text-slate-900">
            {props.record.title}
          </span>
        </div>
        <InfoPill
          label={props.record.statusLabel}
          tone={props.record.statusTone}
        />
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        {props.record.detail}
      </p>
    </div>
  );
}

function resolveInitialPlanCycle(
  plan: OemCloudEntitlementPlan,
): OemCloudBillingCycle | undefined {
  return (
    plan.billingCycles.find((item) => item.key === "monthly") ??
    plan.billingCycles[0]
  )?.key;
}

function resolvePlanCycle(
  plan: OemCloudEntitlementPlan,
  selectedCycles: Record<string, OemCloudBillingCycle>,
) {
  const selected = selectedCycles[plan.id];
  return (
    plan.billingCycles.find((item) => item.key === selected) ??
    plan.billingCycles.find(
      (item) => item.key === resolveInitialPlanCycle(plan),
    )
  );
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
  const [selectedPlanCycles, setSelectedPlanCycles] = useState<
    Record<string, OemCloudBillingCycle>
  >({});
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
  const featuredPlan =
    plans.find((plan) => plan.recommended) ?? plans[0] ?? null;
  const featuredPlanCycle = featuredPlan
    ? resolvePlanCycle(featuredPlan, selectedPlanCycles)
    : undefined;
  const featuredPlanIsCurrent = Boolean(
    featuredPlan &&
    (subscription?.planId === featuredPlan.id ||
      subscription?.planKey === featuredPlan.key),
  );
  const featuredPlanActionLabel = featuredPlanIsCurrent
    ? "续费套餐"
    : subscription
      ? "升级套餐"
      : "购买套餐";
  const featuredTopupPackage =
    topupPackages.find((item) => item.recommended) ?? topupPackages[0] ?? null;
  const commerceRecords: CompactCommerceRecord[] = [
    ...displayedPlanOrders.map((order: OemCloudOrder) => ({
      id: `plan-${order.id}`,
      kind: "套餐",
      title: order.planName || order.planKey || "套餐订单",
      statusLabel: formatOrderStatusLabel(order.status),
      statusTone: resolvePaidCommerceTone(order.status),
      detail: `${formatMoneyCents(order.amountCents, billingCurrency)} · ${formatCreditAmount(order.creditsGranted)} credits · ${formatOemCloudDateTime(order.paidAt || order.createdAt)}`,
    })),
    ...displayedCreditOrders.map((order: OemCloudCreditTopupOrder) => ({
      id: `topup-${order.id}`,
      kind: "充值",
      title: order.packageName || "积分包",
      statusLabel: formatOrderStatusLabel(order.status),
      statusTone: resolvePaidCommerceTone(order.status),
      detail: `${formatMoneyCents(order.amountCents, billingCurrency)} · ${formatCreditAmount(order.creditsGranted)} credits · ${formatOemCloudDateTime(order.paidAt || order.createdAt)}`,
    })),
    ...displayedCreditWallets.map((wallet: OemCloudCreditWallet) => ({
      id: `wallet-${wallet.id}`,
      kind: "钱包",
      title: wallet.packageName || wallet.sourceType || "积分包",
      statusLabel: formatWalletStatusLabel(wallet.status),
      statusTone: resolveActiveCommerceTone(wallet.status),
      detail: `剩余 ${formatCreditAmount(wallet.remainingCredits)} / 共 ${formatCreditAmount(wallet.grantedCredits)} · 到期 ${formatOemCloudDateTime(wallet.expiresAt)}`,
    })),
  ].slice(0, 3);
  const recentUsageRecords = usageDashboard?.usageRecords.slice(0, 3) ?? [];
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
            本地功能可以继续使用；云端登录入口需要由品牌服务配置后才会显示。
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
              登录完成后会自动回到客户端，同步套餐、积分、API Key 和云端模型目录。
            </p>
          </div>
          <div className="flex flex-col gap-2">
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
        </div>
      </article>
    </section>
  ) : (
    <section className="space-y-4" data-testid="oem-cloud-commerce-page">
      {commerceErrorMessage ? (
        <NoticeBar tone="error" message={commerceErrorMessage} />
      ) : null}

      <article
        className={SURFACE_CLASS_NAME}
        data-testid="oem-cloud-session-summary"
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700">
                <Cloud className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-slate-900">
                    {session.user.displayName || session.user.email || "已登录"}
                  </h3>
                  <InfoPill
                    label={formatSubscriptionStatus(subscription?.status)}
                    tone={
                      subscription?.status === "active" ? "emerald" : "slate"
                    }
                  />
                  {loadingCommerce ? (
                    <InfoPill label="正在同步商业状态" tone="amber" />
                  ) : null}
                </div>
                <p className="text-sm text-slate-500">
                  {session.user.email ||
                    session.user.username ||
                    session.user.id}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
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
              刷新云端状态
            </button>
            <button
              type="button"
              onClick={() => void openUserCenter("")}
              className={PRIMARY_ACTION_BUTTON_CLASS}
            >
              <ExternalLink className="h-4 w-4" />
              打开用户中心
            </button>
          </div>
        </div>
      </article>

      <CloudReadinessPanel
        readiness={cloudReadiness}
        pendingPayment={pendingPayment}
        paymentWatcher={paymentWatcher}
        onRefresh={() => void handleRefresh()}
        onCreateKey={() => void handleCreateAccessToken()}
        onOpenPayment={() => {
          if (
            pendingPayment?.paymentReference &&
            /^https?:\/\//i.test(pendingPayment.paymentReference)
          ) {
            void openUrl(pendingPayment.paymentReference);
          }
        }}
        creatingKey={managingToken === "create"}
      />

      <article
        className={SURFACE_CLASS_NAME}
        data-testid="oem-cloud-commerce-compact-panel"
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-900">
                  云端额度
                </h3>
                {loadingCommerce ? (
                  <InfoPill label="同步中" tone="amber" />
                ) : null}
              </div>
              <p className="text-sm leading-6 text-slate-600">
                套餐、积分和账本记录统一收在这里。
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={
                  !featuredPlan ||
                  !selectedPaymentConfig ||
                  !featuredPlanCycle ||
                  orderingPlanId === featuredPlan.id
                }
                onClick={() =>
                  featuredPlan && featuredPlanCycle && selectedPaymentConfig
                    ? void handlePurchasePlan({
                        planId: featuredPlan.id,
                        billingCycle: featuredPlanCycle.key,
                        paymentChannel:
                          selectedPaymentOption?.provider ??
                          selectedPaymentConfig.provider,
                        paymentMethod: selectedPaymentOption?.method,
                      })
                    : undefined
                }
                className={PRIMARY_ACTION_BUTTON_CLASS}
              >
                {featuredPlan && orderingPlanId === featuredPlan.id ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4" />
                )}
                {featuredPlan
                  ? selectedPaymentConfig
                    ? featuredPlanActionLabel
                    : "等待支付配置"
                  : "暂无套餐"}
              </button>
              <button
                type="button"
                disabled={
                  !featuredTopupPackage ||
                  !selectedPaymentConfig ||
                  creatingTopupPackageId === featuredTopupPackage.id
                }
                onClick={() =>
                  featuredTopupPackage && selectedPaymentConfig
                    ? void handleTopupCredits({
                        packageId: featuredTopupPackage.id,
                        paymentChannel:
                          selectedPaymentOption?.provider ??
                          selectedPaymentConfig.provider,
                        paymentMethod: selectedPaymentOption?.method,
                      })
                    : undefined
                }
                className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
              >
                {featuredTopupPackage &&
                creatingTopupPackageId === featuredTopupPackage.id ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <WalletCards className="h-4 w-4" />
                )}
                {featuredTopupPackage
                  ? selectedPaymentConfig
                    ? "立即充值"
                    : "等待支付配置"
                  : "暂无积分包"}
              </button>
              {canOpenPendingPayment ? (
                <button
                  type="button"
                  onClick={() => {
                    if (pendingPaymentReference) {
                      void openUrl(pendingPaymentReference);
                    }
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700 transition hover:bg-amber-100"
                >
                  <ExternalLink className="h-4 w-4" />
                  继续支付
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw
                  className={cn("h-4 w-4", refreshing && "animate-spin")}
                />
                刷新
              </button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <SessionValueCard
              label="当前套餐"
              value={currentPlanName}
              hint="以 limecore 返回的订阅权益为准"
              icon={<Sparkles className="h-3.5 w-3.5" />}
            />
            <SessionValueCard
              label="Token 积分"
              value={formatCreditAmount(creditAccount?.balance)}
              hint="套餐赠送和充值积分进入统一账本"
              icon={<WalletCards className="h-3.5 w-3.5" />}
            />
            <SessionValueCard
              label="本月用量"
              value={
                monthlyLimitCredits > 0
                  ? `${formatCreditAmount(monthlyUsedCredits)} / ${formatCreditAmount(monthlyLimitCredits)}`
                  : formatCreditAmount(monthlyUsedCredits)
              }
              hint="本月已消耗的免费、套餐和充值积分合计"
              icon={<ReceiptText className="h-3.5 w-3.5" />}
            />
            <SessionValueCard
              label="支付渠道"
              value={selectedPaymentOption?.label ?? "未配置"}
              hint="由服务端支付配置决定"
              icon={<CreditCard className="h-3.5 w-3.5" />}
            />
          </div>

          <div className="flex flex-wrap gap-2">
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
              <InfoPill label="未配置支付渠道" tone="amber" />
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-900">套餐</h4>
                  {plans.length > 3 ? (
                    <span className="text-xs text-slate-500">
                      另有 {plans.length - 3} 个
                    </span>
                  ) : null}
                </div>
                {plans.length === 0 ? (
                  <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    暂无可购买套餐
                  </div>
                ) : (
                  <div
                    className="grid gap-3 lg:grid-cols-3"
                    data-testid="oem-cloud-plan-grid"
                  >
                    {plans.slice(0, 3).map((plan) => {
                      const selectedCycle = resolvePlanCycle(
                        plan,
                        selectedPlanCycles,
                      );
                      const isCurrentPlan =
                        subscription?.planId === plan.id ||
                        subscription?.planKey === plan.key;
                      const actionLabel = isCurrentPlan
                        ? "续费套餐"
                        : subscription
                          ? "升级套餐"
                          : "购买套餐";
                      const disabled =
                        !selectedPaymentConfig ||
                        !selectedCycle ||
                        orderingPlanId === plan.id;
                      const features = (
                        plan.quotaSummaries.length > 0
                          ? plan.quotaSummaries.map((item) => item.value)
                          : plan.features
                      ).slice(0, 2);

                      return (
                        <div
                          key={plan.id}
                          className={cn(
                            "rounded-[20px] border bg-slate-50 p-3.5",
                            plan.recommended || isCurrentPlan
                              ? "border-emerald-200 bg-emerald-50/60"
                              : "border-slate-200/80",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h5 className="truncate text-sm font-semibold text-slate-900">
                                  {plan.name}
                                </h5>
                                {plan.recommended ? (
                                  <InfoPill
                                    label={plan.badge || "推荐"}
                                    tone="emerald"
                                  />
                                ) : plan.badge ? (
                                  <InfoPill label={plan.badge} />
                                ) : null}
                                {isCurrentPlan ? (
                                  <InfoPill label="当前" tone="emerald" />
                                ) : null}
                              </div>
                              <p className="line-clamp-2 text-xs leading-5 text-slate-500">
                                {plan.tagline || plan.description || "套餐权益"}
                              </p>
                            </div>
                            <p className="whitespace-nowrap text-sm font-semibold text-slate-950">
                              {formatMoneyCents(
                                selectedCycle?.priceCents ?? plan.priceMonthly,
                                billingCurrency,
                              )}
                            </p>
                          </div>

                          <p className="mt-2 text-xs text-slate-600">
                            含{" "}
                            {formatCreditAmount(
                              selectedCycle?.credits ?? plan.creditsMonthly,
                            )}{" "}
                            Token 积分
                          </p>

                          {plan.billingCycles.length > 1 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {plan.billingCycles.map((cycle) => (
                                <button
                                  key={`${plan.id}-${cycle.key}`}
                                  type="button"
                                  onClick={() =>
                                    setSelectedPlanCycles((current) => ({
                                      ...current,
                                      [plan.id]: cycle.key,
                                    }))
                                  }
                                  className={cn(
                                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                                    selectedCycle?.key === cycle.key
                                      ? "border-slate-900 bg-slate-900 text-white"
                                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                                  )}
                                >
                                  {formatBillingCycleLabel(cycle.key)}
                                </button>
                              ))}
                            </div>
                          ) : null}

                          {features.length > 0 ? (
                            <div className="mt-3 space-y-1.5">
                              {features.map((item) => (
                                <div
                                  key={`${plan.id}-${item}`}
                                  className="flex items-center gap-2 text-xs text-slate-600"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                  <span className="line-clamp-1">{item}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          <button
                            type="button"
                            onClick={() =>
                              selectedCycle && selectedPaymentConfig
                                ? void handlePurchasePlan({
                                    planId: plan.id,
                                    billingCycle: selectedCycle.key,
                                    paymentChannel:
                                      selectedPaymentOption?.provider ??
                                      selectedPaymentConfig.provider,
                                    paymentMethod:
                                      selectedPaymentOption?.method,
                                  })
                                : undefined
                            }
                            disabled={disabled}
                            className={cn(
                              PRIMARY_ACTION_BUTTON_CLASS,
                              "mt-3 w-full px-3 py-2 text-xs",
                            )}
                          >
                            {orderingPlanId === plan.id ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <CreditCard className="h-4 w-4" />
                            )}
                            {selectedPaymentConfig
                              ? actionLabel
                              : "等待支付配置"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-900">
                    积分充值
                  </h4>
                  {topupPackages.length > 3 ? (
                    <span className="text-xs text-slate-500">
                      另有 {topupPackages.length - 3} 个
                    </span>
                  ) : null}
                </div>
                {topupPackages.length === 0 ? (
                  <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    暂无积分包
                  </div>
                ) : (
                  <div
                    className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                    data-testid="oem-cloud-topup-grid"
                  >
                    {topupPackages
                      .slice(0, 3)
                      .map((item: OemCloudTopupPackage) => {
                        const disabled =
                          !selectedPaymentConfig ||
                          creatingTopupPackageId === item.id;
                        const totalCredits =
                          item.credits + (item.bonusCredits ?? 0);

                        return (
                          <div
                            key={item.id}
                            className="rounded-[18px] border border-slate-200/80 bg-slate-50 px-3.5 py-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h5 className="truncate text-sm font-semibold text-slate-900">
                                    {item.name}
                                  </h5>
                                  {item.recommended ? (
                                    <InfoPill label="推荐" tone="emerald" />
                                  ) : null}
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                  {formatCreditAmount(totalCredits)} Token 积分
                                </p>
                              </div>
                              <p className="whitespace-nowrap text-sm font-semibold text-slate-950">
                                {formatMoneyCents(
                                  item.priceCents,
                                  billingCurrency,
                                )}
                              </p>
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
                                      paymentMethod:
                                        selectedPaymentOption?.method,
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
                              {selectedPaymentConfig
                                ? "立即充值"
                                : "等待支付配置"}
                            </button>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/80 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-900">
                    账本记录
                  </h4>
                  <InfoPill
                    label={formatMoneyCents(
                      billingDashboard?.billingSummary.totalSpentCents,
                      billingCurrency,
                    )}
                  />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
                  <SessionValueCard
                    label="本月消耗"
                    value={formatCreditAmount(monthlyUsedCredits)}
                    hint="本月消耗合计"
                  />
                  <SessionValueCard
                    label="下次付款"
                    value={formatMoneyCents(
                      billingDashboard?.billingSummary.nextPaymentAmountCents,
                      billingCurrency,
                    )}
                    hint="订阅账单摘要返回"
                  />
                  <SessionValueCard
                    label="累计支付"
                    value={formatMoneyCents(
                      billingDashboard?.billingSummary.totalSpentCents,
                      billingCurrency,
                    )}
                    hint="当前账号累计支出"
                  />
                </div>
                <div
                  className="mt-3 space-y-2"
                  data-testid="oem-cloud-commerce-records"
                >
                  {commerceRecords.length > 0 ? (
                    commerceRecords.map((record) => (
                      <CommerceRecordRow key={record.id} record={record} />
                    ))
                  ) : (
                    <div className="rounded-[16px] border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-500">
                      暂无订单记录
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/80 p-3.5">
                <h4 className="text-sm font-semibold text-slate-900">
                  最近用量
                </h4>
                <div
                  className="mt-3 space-y-2"
                  data-testid="oem-cloud-usage-list"
                >
                  {recentUsageRecords.length > 0 ? (
                    recentUsageRecords.map((record) => (
                      <div
                        key={record.id}
                        className="rounded-[16px] border border-slate-200 bg-white px-3 py-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="font-medium text-slate-900">
                            {record.model || "未知模型"}
                          </span>
                          <span className="text-xs text-slate-500">
                            {formatOemCloudDateTime(record.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatCreditAmount(record.tokens)} tokens ·{" "}
                          {formatCreditAmount(record.credits)} credits ·{" "}
                          {record.status}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[16px] border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-500">
                      暂无最近用量
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>

      <div className="grid gap-4">
        <article
          className={SURFACE_CLASS_NAME}
          data-testid="oem-cloud-api-key-section"
        >
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-slate-900">
                  API Key
                </h3>
                <p className="text-sm leading-6 text-slate-600">
                  用于 OpenAI-compatible / Anthropic-compatible
                  协议调用，密钥明文只显示一次。
                </p>
              </div>
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
            </div>

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
                    onClick={handleDismissIssuedToken}
                    className="inline-flex items-center gap-2 rounded-[14px] border border-emerald-200 bg-emerald-100 px-3 py-2 text-xs font-medium text-emerald-800"
                  >
                    我已保存
                  </button>
                </div>
              </div>
            ) : null}

            {activeAccessToken?.token ? (
              <div className="rounded-[18px] border border-slate-200/80 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {activeAccessToken.token.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {activeAccessToken.token.tokenMasked} · 到期{" "}
                      {formatOemCloudDateTime(
                        activeAccessToken.token.expiresAt,
                      )}
                    </p>
                  </div>
                  <InfoPill
                    label={
                      activeAccessToken.token.status === "active"
                        ? "可用"
                        : activeAccessToken.token.status
                    }
                    tone={
                      activeAccessToken.token.status === "active"
                        ? "emerald"
                        : "amber"
                    }
                  />
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
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
            ) : (
              <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-500">
                当前账号还没有活跃 API Key。创建后可复制到 SDK
                或兼容客户端中使用。
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <SessionValueCard
                label="Base URL"
                value={llmBaseUrl}
                hint="只通过 limecore 统一入口调用，不暴露内部供应层"
              />
              <SessionValueCard
                label="OpenAI URL"
                value={openAIBaseUrl || "未配置"}
                hint="OpenAI-compatible SDK 使用的 /v1 入口，来自 cloud-activation"
              />
              <SessionValueCard
                label="Anthropic URL"
                value={anthropicBaseUrl || "未配置"}
                hint="Anthropic-compatible SDK 使用的根入口，来自 cloud-activation"
              />
              <SessionValueCard
                label="Key 数量"
                value={`${accessTokens.length} 个`}
                hint="包含活跃和已撤销的历史 Key"
              />
            </div>

            {canRenderSdkSnippets ? (
              <div className="space-y-3" data-testid="oem-cloud-sdk-section">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">
                      SDK 调用
                    </h4>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      示例只使用服务端下发的 Base URL 和模型 ID；Key 请放到
                      LIME_API_KEY 环境变量，并随请求携带租户 Header。
                    </p>
                  </div>
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
                  description="测试区只保留最小请求，不再做复杂表单兜底。"
                  lines={buildCurlSmokeSnippet(
                    openAIBaseUrl,
                    sdkModelId,
                    gatewaySnippetOptions,
                  )}
                />
              </div>
            ) : (
              <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-500">
                服务端尚未下发可用于 SDK 示例的 Base URL
                或模型目录。客户端不会生成兜底模型。
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
        </article>
      </div>

      <div className="grid gap-4">
        <article
          className={SURFACE_CLASS_NAME}
          data-testid="oem-cloud-model-section"
        >
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-slate-900">
                  可用模型
                </h3>
                <p className="text-sm leading-6 text-slate-600">
                  模型和 Anthropic / coding
                  能力以服务端目录为准，这里只做查看和设默认。
                </p>
              </div>
              <InfoPill label={defaultProviderSummary || "未设默认来源"} />
            </div>

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
                                    实际映射：{model.modelId} →{" "}
                                    {upstreamMapping}
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
        </article>
      </div>
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
