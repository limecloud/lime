import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Bot, CheckCircle2, Volume2 } from "lucide-react";
import {
  apiKeyProviderApi,
  type ProviderWithKeysDisplay,
} from "@/lib/api/apiKeyProvider";
import {
  getConfig,
  saveConfig,
  type Config,
} from "@/lib/api/appConfig";
import {
  canUseCompanionQuickActionProvider,
  getCompanionDefaultsFromConfig,
} from "@/lib/companion/preferences";
import {
  buildPersistedMediaGenerationPreference,
  hasMediaGenerationPreferenceOverride,
  type MediaGenerationPreference,
} from "@/lib/mediaGeneration";
import { subscribeProviderDataChanged } from "@/lib/providerDataEvents";
import { cn } from "@/lib/utils";
import { MediaPreferenceSection } from "../shared/MediaPreferenceSection";

const CARD_CLASS_NAME =
  "rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5";
const DEFAULT_MEDIA_PREFERENCE: MediaGenerationPreference = {
  allowFallback: true,
};

function PreferenceMessage(props: {
  tone: "success" | "error";
  message: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-[18px] border px-4 py-3 text-sm shadow-sm shadow-slate-950/5",
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

function buildUpdatedCompanionDefaults(
  currentConfig: Config,
  nextPreference: MediaGenerationPreference,
) {
  const persistedPreference =
    buildPersistedMediaGenerationPreference(nextPreference);
  const nextCompanionDefaults = {
    general: persistedPreference,
  };

  if (!nextCompanionDefaults.general) {
    delete nextCompanionDefaults.general;
  }

  return {
    ...currentConfig,
    workspace_preferences: {
      ...currentConfig.workspace_preferences,
      companion_defaults: nextCompanionDefaults,
    },
  };
}

function findProviderById(
  providers: ProviderWithKeysDisplay[],
  providerId?: string,
): ProviderWithKeysDisplay | null {
  const normalizedProviderId = providerId?.trim().toLowerCase();
  if (!normalizedProviderId) {
    return null;
  }

  return (
    providers.find(
      (provider) => provider.id.trim().toLowerCase() === normalizedProviderId,
    ) ?? null
  );
}

function normalizeProviderSelection(value?: string | null): string {
  return value?.trim().toLowerCase() || "";
}

export function CompanionCapabilityPreferencesCard() {
  const [config, setConfig] = useState<Config | null>(null);
  const [providers, setProviders] = useState<ProviderWithKeysDisplay[]>([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [generalPreference, setGeneralPreference] =
    useState<MediaGenerationPreference>(DEFAULT_MEDIA_PREFERENCE);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const messageTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (messageTimerRef.current !== null) {
        window.clearTimeout(messageTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const showMessage = (tone: "success" | "error", text: string) => {
      if (messageTimerRef.current !== null) {
        window.clearTimeout(messageTimerRef.current);
      }
      setMessage({ tone, text });
      messageTimerRef.current = window.setTimeout(() => {
        setMessage(null);
        messageTimerRef.current = null;
      }, 3200);
    };

    const loadConfigState = async () => {
      setConfigLoading(true);
      try {
        const nextConfig = await getConfig();
        if (cancelled) {
          return;
        }
        const defaults = getCompanionDefaultsFromConfig(nextConfig);
        setConfig(nextConfig);
        setGeneralPreference(defaults.general ?? DEFAULT_MEDIA_PREFERENCE);
      } catch (error) {
        if (!cancelled) {
          showMessage(
            "error",
            `读取桌宠偏好失败：${error instanceof Error ? error.message : "未知错误"}`,
          );
        }
      } finally {
        if (!cancelled) {
          setConfigLoading(false);
        }
      }
    };

    const loadProvidersState = async (forceRefresh = false) => {
      if (!cancelled) {
        setProvidersLoading(true);
      }
      try {
        const nextProviders = await apiKeyProviderApi.getProviders(
          forceRefresh ? { forceRefresh: true } : undefined,
        );
        if (!cancelled) {
          setProviders(nextProviders);
        }
      } catch (error) {
        if (!cancelled) {
          showMessage(
            "error",
            `读取桌宠可用服务失败：${error instanceof Error ? error.message : "未知错误"}`,
          );
        }
      } finally {
        if (!cancelled) {
          setProvidersLoading(false);
        }
      }
    };

    void loadConfigState();
    void loadProvidersState();

    const unsubscribeProviderData = subscribeProviderDataChanged(() => {
      void loadProvidersState(true);
    });

    return () => {
      cancelled = true;
      unsubscribeProviderData();
    };
  }, []);

  const showMessage = (tone: "success" | "error", text: string) => {
    if (messageTimerRef.current !== null) {
      window.clearTimeout(messageTimerRef.current);
    }
    setMessage({ tone, text });
    messageTimerRef.current = window.setTimeout(() => {
      setMessage(null);
      messageTimerRef.current = null;
    }, 3200);
  };

  const savePreference = async (nextPreference: MediaGenerationPreference) => {
    if (!config) {
      return;
    }

    setSaving(true);
    try {
      const nextConfig = buildUpdatedCompanionDefaults(config, nextPreference);
      await saveConfig(nextConfig);
      setConfig(nextConfig);
      setGeneralPreference(nextPreference);
      showMessage("success", "桌宠能力偏好已保存");
    } catch (error) {
      showMessage(
        "error",
        `保存桌宠偏好失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const generalProviders = useMemo(
    () =>
      providers.filter((provider) =>
        canUseCompanionQuickActionProvider(provider),
      ),
    [providers],
  );

  const selectedGeneralProvider = useMemo(
    () =>
      findProviderById(generalProviders, generalPreference.preferredProviderId),
    [generalPreference.preferredProviderId, generalProviders],
  );
  const generalProviderIds = useMemo(
    () =>
      new Set(
        generalProviders.map((provider) =>
          normalizeProviderSelection(provider.id),
        ),
      ),
    [generalProviders],
  );

  const generalProviderUnavailableLabel =
    generalPreference.preferredProviderId && !selectedGeneralProvider
      ? `当前配置不可用：${generalPreference.preferredProviderId}`
      : undefined;

  const handleGeneralProviderChange = (value: string) => {
    const preferredProviderId = value.trim() || undefined;
    const preferredModelId =
      preferredProviderId === generalPreference.preferredProviderId
        ? generalPreference.preferredModelId
        : undefined;

    void savePreference({
      preferredProviderId,
      preferredModelId,
      allowFallback: generalPreference.allowFallback ?? true,
    });
  };

  return (
    <article
      className={CARD_CLASS_NAME}
      data-testid="companion-capability-preferences-card"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700">
              <Bot className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-slate-900">
                桌宠能力偏好
              </h3>
              <p className="text-sm leading-6 text-slate-600">
                用与聊天页相同的模型选择器，为 Lime 青柠精灵单独指定当前已接入主链的通用模型。
                本地、自管云端与品牌云端继续复用同一套筛选口径。
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-[18px] border border-slate-200/80 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
          <p className="font-medium text-slate-800">当前主链</p>
          <p>当前只暴露已接入双击鼓励、三击下一步建议等 quick action 的通用模型设置。</p>
        </div>
      </div>

      {message ? (
        <div className="mt-5">
          <PreferenceMessage tone={message.tone} message={message.text} />
        </div>
      ) : null}

      <div className="mt-5">
        <MediaPreferenceSection
          title="桌宠通用模型"
          description="用于双击鼓励、三击下一步建议等桌宠动作。留空时会先跟随最近当前 provider/model，再回退自动可用服务。"
          selectorLabel="默认模型"
          selectorDescription="统一复用聊天页同款模型选择器，只展示当前桌宠 quick action 真正可消费的 Provider。"
          selectionWarningText={generalProviderUnavailableLabel}
          activeTheme="general"
          providerType={generalPreference.preferredProviderId ?? ""}
          setProviderType={handleGeneralProviderChange}
          model={generalPreference.preferredModelId ?? ""}
          setModel={(value) =>
            void savePreference({
              ...generalPreference,
              preferredModelId: value.trim() || undefined,
              allowFallback: generalPreference.allowFallback ?? true,
            })
          }
          providerFilter={(provider) =>
            generalProviderIds.has(normalizeProviderSelection(provider.providerId))
          }
          allowFallback={generalPreference.allowFallback ?? true}
          onAllowFallbackChange={(value) =>
            void savePreference({
              ...generalPreference,
              allowFallback: value,
            })
          }
          fallbackTitle="桌宠通用模型不可用时自动回退"
          fallbackDescription="关闭后，若桌宠专用 Provider 缺失、被禁用或没有可用 Key，将直接提示错误，不再回退当前 provider 或自动可用服务。"
          emptyStateTitle="暂无可用桌宠通用模型"
          emptyStateDescription={
            providersLoading
              ? "正在加载桌宠可聊天服务..."
              : generalProviders.length === 0
                ? "暂无可聊天 Provider，请先到服务商设置里配置至少一个可用聊天服务。"
                : "留空时会先跟随当前对话的 provider/model，再回退自动选择可用服务。"
          }
          disabled={!config || configLoading || saving}
          onReset={() => void savePreference(DEFAULT_MEDIA_PREFERENCE)}
          resetLabel="恢复通用默认"
          resetDisabled={
            !hasMediaGenerationPreferenceOverride(generalPreference)
          }
        />
      </div>

      <div className="mt-5 rounded-[18px] border border-slate-200/80 bg-slate-50 px-4 py-4 text-xs leading-6 text-slate-600">
        <div className="flex items-center gap-2 text-slate-800">
          <Volume2 className="h-4 w-4 text-slate-500" />
          <span className="font-medium">回退说明</span>
        </div>
        <p className="mt-2">
          通用模型优先级：桌宠专用配置 &gt; 最近当前 provider/model &gt;
          自动可用 Provider。
        </p>
      </div>
    </article>
  );
}
