import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Cloud,
  ExternalLink,
  KeyRound,
  Layers3,
  LoaderCircle,
  LogIn,
  RefreshCw,
} from "lucide-react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { ProviderPoolPage } from "@/components/provider-pool";
import { openUrl } from "@/components/openclaw/openUrl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatOemCloudAccessModeLabel,
  formatOemCloudConfigModeLabel,
  formatOemCloudDateTime,
  formatOemCloudModelsSourceLabel,
  formatOemCloudOfferStateLabel,
  useOemCloudAccess,
} from "@/hooks/useOemCloudAccess";
import type {
  OemCloudCurrentSession,
  OemCloudProviderOfferDetail,
  OemCloudProviderOfferState,
  OemCloudProviderOfferSummary,
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
import type { SettingsProviderView } from "@/types/page";
import { cn } from "@/lib/utils";
import { CompanionCapabilityPreferencesCard } from "./CompanionCapabilityPreferencesCard";

const SURFACE_CLASS_NAME =
  "rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5";
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
    <div className="rounded-[18px] border border-slate-200/80 bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
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
      <p className="mt-2 break-all text-sm font-semibold text-slate-900">
        {props.value}
      </p>
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

function RuntimeSummaryItem(props: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[18px] border border-slate-200/80 bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
        <span>{props.label}</span>
        {props.hint ? (
          <WorkbenchInfoTip
            ariaLabel={`${props.label}说明`}
            content={props.hint}
            tone="slate"
          />
        ) : null}
      </div>
      <p className="mt-1 text-sm font-semibold leading-6 text-slate-900">
        {props.value}
      </p>
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
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700">
              <Bot className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-900">
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

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
            className="inline-flex items-center justify-center gap-2 rounded-[16px] bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
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
  onOpenProfile?: () => void;
  initialView?: ProviderWorkspaceView;
}

export function CloudProviderSettings(props: CloudProviderSettingsProps) {
  const { initialView } = props;
  const {
    runtime,
    configuredTarget,
    hubProviderName,
    session,
    offers,
    preference,
    selectedOffer,
    selectedModels,
    defaultCloudOffer,
    activeCloudOffer,
    initializing,
    refreshing,
    loadingDetail,
    savingDefault,
    errorMessage,
    infoMessage,
    defaultProviderSummary,
    defaultProviderSourceLabel,
    activeAccessModeLabel,
    activeConfigModeLabel,
    activeModelsSourceLabel,
    activeDeveloperAccessEnabled,
    handleRefresh,
    openOfferDetail,
    handleSetDefault,
    openUserCenter,
  } = useOemCloudAccess();

  const isOemRuntime = Boolean(runtime);
  const isLimeBrand = isLimeBrandedHub(hubProviderName);
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

  const selectedOfferKey =
    selectedOffer?.providerKey ?? defaultCloudOffer?.providerKey;
  const displayedSelectedOfferState = resolveDisplayOfferState(
    session,
    selectedOffer,
  );

  const offerGridClassName = useMemo(
    () => cn("grid gap-4", offers.length > 1 && "lg:grid-cols-2"),
    [offers.length],
  );

  const cloudDirectoryContent = !runtime ? (
    <section className="space-y-4">
      <article className={SURFACE_CLASS_NAME}>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-slate-900">
            先配置 OEM 云端运行时
          </h3>
          <p className="text-sm leading-6 text-slate-600">
            当前没有可用的云端运行时配置。请先在
            <span className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
              public/oem-runtime-config.js
            </span>
            中配置域名、网关地址和租户信息，再继续接入云端服务。
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
    <section className="space-y-4">
      <article className={SURFACE_CLASS_NAME}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-slate-900">
              登录后查看云端目录
            </h3>
            <p className="text-sm leading-6 text-slate-600">
              当前还没有可用的个人中心会话。登录后，云端默认来源、模型目录和服务技能目录会自动同步到本地。
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => props.onOpenProfile?.()}
              className="inline-flex items-center justify-center gap-2 rounded-[16px] bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
              data-testid="open-profile-login"
            >
              <LogIn className="h-4 w-4" />
              去个人中心登录
            </button>
            <button
              type="button"
              onClick={() =>
                void openUserCenter(runtime?.loginPath || "/login")
              }
              className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <ExternalLink className="h-4 w-4" />
              在浏览器打开登录页
            </button>
          </div>
        </div>
      </article>

      <article className={SURFACE_CLASS_NAME}>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">
              云端页面承接什么
            </h3>
            <WorkbenchInfoTip
              ariaLabel="云端页面说明"
              content="这里保留 OEM 商业化相关的 Offer、套餐、模型目录、默认来源和会话状态，不再和本地 Provider 配置共用一个长页。"
              tone="slate"
            />
          </div>
        </div>
      </article>
    </section>
  ) : (
    <section className="space-y-4">
      <div
        className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]"
        data-testid="oem-cloud-session-summary"
      >
        <article className={SURFACE_CLASS_NAME}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700">
                  <Cloud className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-semibold text-slate-900">
                      {session.user.displayName ||
                        session.user.email ||
                        "已登录"}
                    </p>
                    <WorkbenchInfoTip
                      ariaLabel="当前云端会话说明"
                      content="当前云端会话将驱动 OEM Offer、模型目录和默认来源。商业化套餐、可用模型和是否开放开发者入口都以服务端治理结果为准。"
                      tone="slate"
                    />
                  </div>
                  <p className="text-sm text-slate-500">
                    {session.user.email ||
                      session.user.username ||
                      session.user.id}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <SessionValueCard
                  label="租户"
                  value={session.tenant.id}
                  hint="当前云端会话所属租户"
                />
                <SessionValueCard
                  label="到期时间"
                  value={formatOemCloudDateTime(session.session.expiresAt)}
                  hint="会话过期后需重新登录"
                />
                <SessionValueCard
                  label="当前云服务"
                  value={activeCloudOffer?.displayName || hubProviderName}
                  hint="当前聚焦的云端来源"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
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
                onClick={() => props.onOpenProfile?.()}
                className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <LogIn className="h-4 w-4" />
                前往个人中心管理会话
              </button>
              <button
                type="button"
                onClick={() => void openUserCenter("")}
                className="inline-flex items-center justify-center gap-2 rounded-[16px] bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                <ExternalLink className="h-4 w-4" />
                打开用户中心
              </button>
            </div>
          </div>
        </article>

        <article className={SURFACE_CLASS_NAME}>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-900">
                  当前云端摘要
                </h3>
                <WorkbenchInfoTip
                  ariaLabel="当前云端摘要说明"
                  content="这里只展示 OEM 云端的最终接入态，方便快速确认默认来源、模型目录和开发者入口是否符合当前租户策略。"
                  tone="slate"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <RuntimeSummaryItem
                label="默认来源"
                value={defaultProviderSummary || "未设定"}
                hint={`${defaultProviderSourceLabel} / ${activeModelsSourceLabel}`}
              />
              <RuntimeSummaryItem
                label="接入方式"
                value={activeAccessModeLabel}
                hint={`配置模式：${activeConfigModeLabel}`}
              />
              <RuntimeSummaryItem
                label="开发者入口"
                value={activeDeveloperAccessEnabled ? "已开放" : "未开放"}
                hint={
                  activeDeveloperAccessEnabled
                    ? "本地 Provider 可作为云端之外的补充能力"
                    : "云端默认只走会话与后台治理"
                }
              />
              <RuntimeSummaryItem
                label="控制面"
                value={configuredTarget?.baseUrl || "未配置"}
                hint="登录入口与控制面地址"
              />
            </div>
          </div>
        </article>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-900">云端服务目录</h3>
          <WorkbenchInfoTip
            ariaLabel="云端服务目录说明"
            content="卡片以服务端返回为主，并结合当前桌面会话做状态归一。是否允许 API Key 模式、当前模型来源、租户覆盖是否生效，都以服务端治理结果为准。"
            tone="slate"
          />
        </div>
      </div>

      {offers.length === 0 ? (
        <article className={SURFACE_CLASS_NAME}>
          <p className="text-sm leading-6 text-slate-600">
            当前租户还没有可用的云端服务来源。请先在后台发布可见 Offer。
          </p>
        </article>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
          <div
            className={offerGridClassName}
            data-testid="oem-cloud-offer-grid"
          >
            {offers.map((offer) => {
              const isDefaultCloudOffer =
                preference?.providerSource === "oem_cloud" &&
                preference.providerKey === offer.providerKey;
              const isFocused = selectedOfferKey === offer.providerKey;
              const displayedOfferState = resolveDisplayOfferState(
                session,
                offer,
              );
              const stateTone = resolveOfferTone(
                displayedOfferState ?? offer.state,
              );

              return (
                <article
                  key={offer.providerKey}
                  className={cn(
                    SURFACE_CLASS_NAME,
                    isFocused && "border-emerald-300 shadow-emerald-100",
                  )}
                >
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-base font-semibold text-slate-900">
                            {offer.displayName}
                          </h4>
                          {isDefaultCloudOffer ? (
                            <InfoPill label="云端默认" tone="emerald" />
                          ) : null}
                          {offer.tenantOverrideApplied ? (
                            <InfoPill label="租户覆盖已生效" tone="amber" />
                          ) : null}
                        </div>
                        <p className="text-sm leading-6 text-slate-600">
                          {offer.description || "当前来源暂无额外说明。"}
                        </p>
                      </div>
                      <InfoPill
                        label={formatOemCloudOfferStateLabel(
                          displayedOfferState ?? offer.state,
                        )}
                        tone={stateTone}
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <InfoPill
                        label={formatOemCloudAccessModeLabel(
                          offer.effectiveAccessMode,
                        )}
                      />
                      <InfoPill
                        label={formatOemCloudConfigModeLabel(offer.configMode)}
                      />
                      <InfoPill
                        label={formatOemCloudModelsSourceLabel(
                          offer.modelsSource,
                        )}
                      />
                      <InfoPill label={`${offer.availableModelCount} 个模型`} />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <SessionValueCard
                        label="套餐 / 状态"
                        value={offer.currentPlan || "未显示"}
                        hint={
                          offer.creditsSummary ||
                          offer.statusReason ||
                          "由控制面统一下发"
                        }
                      />
                      <SessionValueCard
                        label="开发者入口"
                        value={
                          offer.apiKeyModeEnabled
                            ? offer.developerAccessVisible
                              ? "可见"
                              : "已隐藏"
                            : "已关闭"
                        }
                        hint="同时受后台 API Key 模式与显示治理控制"
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void openOfferDetail(offer.providerKey)}
                        disabled={loadingDetail && isFocused}
                        className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {loadingDetail && isFocused ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <Layers3 className="h-4 w-4" />
                        )}
                        查看模型目录
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSetDefault(offer)}
                        disabled={savingDefault === offer.providerKey}
                        className="inline-flex items-center justify-center gap-2 rounded-[16px] bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        {savingDefault === offer.providerKey ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        {isDefaultCloudOffer ? "已是默认来源" : "设为默认来源"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <article className={SURFACE_CLASS_NAME}>
            {selectedOffer ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-semibold text-slate-900">
                      {selectedOffer.displayName}
                    </h4>
                    <InfoPill
                      label={formatOemCloudOfferStateLabel(
                        displayedSelectedOfferState ?? selectedOffer.state,
                      )}
                      tone={resolveOfferTone(
                        displayedSelectedOfferState ?? selectedOffer.state,
                      )}
                    />
                  </div>
                  <p className="text-sm leading-6 text-slate-600">
                    当前实际接入方式为
                    {formatOemCloudAccessModeLabel(
                      selectedOffer.access.accessMode,
                    )}
                    ，共下发 {selectedModels.length} 个模型目录项。
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <SessionValueCard
                    label="模型目录"
                    value={`${selectedModels.length} 项`}
                    hint="来自当前选中来源的服务端目录"
                  />
                  <SessionValueCard
                    label="模型来源"
                    value={formatOemCloudModelsSourceLabel(
                      selectedOffer.modelsSource,
                    )}
                    hint="决定模型列表来自云端目录还是手动编排"
                  />
                  <SessionValueCard
                    label="开发者入口"
                    value={
                      selectedOffer.apiKeyModeEnabled
                        ? selectedOffer.developerAccessVisible
                          ? "可见"
                          : "已隐藏"
                        : "已关闭"
                    }
                    hint="后台可按 Offer / 租户治理"
                  />
                </div>

                {displayedSelectedOfferState === "available_logged_out" &&
                selectedOffer.loginHint ? (
                  <p className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                    登录提示：{selectedOffer.loginHint}
                  </p>
                ) : null}
                {displayedSelectedOfferState ===
                  "available_subscribe_required" &&
                selectedOffer.subscribeHint ? (
                  <p className="rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
                    套餐提示：{selectedOffer.subscribeHint}
                  </p>
                ) : null}
                {(displayedSelectedOfferState === "blocked" ||
                  displayedSelectedOfferState === "unavailable") &&
                selectedOffer.unavailableHint ? (
                  <p className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
                    不可用提示：{selectedOffer.unavailableHint}
                  </p>
                ) : null}

                <div className="space-y-3">
                  <h5 className="text-sm font-semibold text-slate-900">
                    模型目录
                  </h5>
                  {loadingDetail ? (
                    <div className="flex items-center gap-3 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      正在加载模型目录...
                    </div>
                  ) : selectedModels.length > 0 ? (
                    <div className="space-y-2 rounded-[20px] border border-slate-200/80 bg-slate-50 p-3">
                      {selectedModels.map((model) => (
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
                          {model.description ? (
                            <p className="mt-2 text-xs leading-5 text-slate-500">
                              {model.description}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                      当前来源还没有下发模型目录。
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center rounded-[20px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
                <Layers3 className="h-8 w-8 text-slate-400" />
                <p className="mt-3 text-sm font-medium text-slate-700">
                  选择一个云端来源查看详情
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  这里会展示模型目录、实际接入方式和后台治理结果。
                </p>
              </div>
            )}
          </article>
        </div>
      )}
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
                    "data-[state=active]:border-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-sm",
                  )}
                  data-testid={`provider-workspace-tab-${item.value}`}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-2xl border border-current/15 bg-white/70 text-current data-[state=active]:border-white/15 data-[state=active]:bg-white/10">
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
