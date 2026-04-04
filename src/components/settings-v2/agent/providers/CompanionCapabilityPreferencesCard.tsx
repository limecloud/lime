import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Bot, CheckCircle2, Volume2 } from "lucide-react";
import {
  apiKeyProviderApi,
  type ProviderWithKeysDisplay,
} from "@/lib/api/apiKeyProvider";
import {
  getConfig,
  saveConfig,
  type CompanionDefaultsConfig,
  type Config,
} from "@/lib/api/appConfig";
import {
  canUseCompanionQuickActionProvider,
  getCompanionDefaultsFromConfig,
} from "@/lib/companion/preferences";
import {
  buildPersistedMediaGenerationPreference,
  getTtsModelsForProvider,
  hasMediaGenerationPreferenceOverride,
  isTtsProvider,
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
const AUTO_VALUE = "__auto__";

type CompanionPreferenceKind = keyof CompanionDefaultsConfig;

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
  kind: CompanionPreferenceKind,
  nextPreference: MediaGenerationPreference,
) {
  const persistedPreference =
    buildPersistedMediaGenerationPreference(nextPreference);
  const nextCompanionDefaults: CompanionDefaultsConfig = {
    ...getCompanionDefaultsFromConfig(currentConfig),
    [kind]: persistedPreference,
  };

  if (!nextCompanionDefaults.general) {
    delete nextCompanionDefaults.general;
  }
  if (!nextCompanionDefaults.tts) {
    delete nextCompanionDefaults.tts;
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

export function CompanionCapabilityPreferencesCard() {
  const [config, setConfig] = useState<Config | null>(null);
  const [providers, setProviders] = useState<ProviderWithKeysDisplay[]>([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [generalPreference, setGeneralPreference] =
    useState<MediaGenerationPreference>(DEFAULT_MEDIA_PREFERENCE);
  const [ttsPreference, setTtsPreference] = useState<MediaGenerationPreference>(
    DEFAULT_MEDIA_PREFERENCE,
  );
  const [savingKind, setSavingKind] = useState<CompanionPreferenceKind | null>(
    null,
  );
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
        setTtsPreference(defaults.tts ?? DEFAULT_MEDIA_PREFERENCE);
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

  const savePreference = async (
    kind: CompanionPreferenceKind,
    nextPreference: MediaGenerationPreference,
  ) => {
    if (!config) {
      return;
    }

    setSavingKind(kind);
    try {
      const nextConfig = buildUpdatedCompanionDefaults(
        config,
        kind,
        nextPreference,
      );
      await saveConfig(nextConfig);
      setConfig(nextConfig);

      if (kind === "general") {
        setGeneralPreference(nextPreference);
      } else {
        setTtsPreference(nextPreference);
      }

      showMessage("success", "桌宠能力偏好已保存");
    } catch (error) {
      showMessage(
        "error",
        `保存桌宠偏好失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    } finally {
      setSavingKind(null);
    }
  };

  const generalProviders = useMemo(
    () =>
      providers.filter((provider) =>
        canUseCompanionQuickActionProvider(provider),
      ),
    [providers],
  );
  const ttsProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.enabled &&
          provider.api_key_count > 0 &&
          isTtsProvider(provider.id, provider.type),
      ),
    [providers],
  );

  const selectedGeneralProvider = useMemo(
    () =>
      findProviderById(generalProviders, generalPreference.preferredProviderId),
    [generalPreference.preferredProviderId, generalProviders],
  );
  const selectedTtsProvider = useMemo(
    () => findProviderById(ttsProviders, ttsPreference.preferredProviderId),
    [ttsPreference.preferredProviderId, ttsProviders],
  );

  const availableGeneralModels = useMemo(
    () => selectedGeneralProvider?.custom_models ?? [],
    [selectedGeneralProvider],
  );
  const availableTtsModels = useMemo(
    () => getTtsModelsForProvider(selectedTtsProvider?.custom_models),
    [selectedTtsProvider],
  );

  const generalProviderUnavailableLabel =
    generalPreference.preferredProviderId && !selectedGeneralProvider
      ? `当前配置不可用：${generalPreference.preferredProviderId}`
      : undefined;
  const generalModelUnavailableLabel =
    generalPreference.preferredModelId &&
    !availableGeneralModels.includes(generalPreference.preferredModelId)
      ? `当前配置不可用：${generalPreference.preferredModelId}`
      : undefined;

  const ttsProviderUnavailableLabel =
    ttsPreference.preferredProviderId && !selectedTtsProvider
      ? `当前配置不可用：${ttsPreference.preferredProviderId}`
      : undefined;
  const ttsModelUnavailableLabel =
    ttsPreference.preferredModelId &&
    !availableTtsModels.includes(ttsPreference.preferredModelId)
      ? `当前配置不可用：${ttsPreference.preferredModelId}`
      : undefined;

  const handleGeneralProviderChange = (value: string) => {
    const preferredProviderId = value === AUTO_VALUE ? undefined : value;
    const nextProvider = findProviderById(
      generalProviders,
      preferredProviderId,
    );
    const nextModels = nextProvider?.custom_models ?? [];
    const preferredModelId = preferredProviderId
      ? nextModels.includes(generalPreference.preferredModelId || "")
        ? generalPreference.preferredModelId
        : nextModels[0]
      : undefined;

    void savePreference("general", {
      preferredProviderId,
      preferredModelId,
      allowFallback: generalPreference.allowFallback ?? true,
    });
  };

  const handleTtsProviderChange = (value: string) => {
    const preferredProviderId = value === AUTO_VALUE ? undefined : value;
    const nextProvider = findProviderById(ttsProviders, preferredProviderId);
    const nextModels = getTtsModelsForProvider(nextProvider?.custom_models);
    const preferredModelId = preferredProviderId
      ? nextModels.includes(ttsPreference.preferredModelId || "")
        ? ttsPreference.preferredModelId
        : nextModels[0]
      : undefined;

    void savePreference("tts", {
      preferredProviderId,
      preferredModelId,
      allowFallback: ttsPreference.allowFallback ?? true,
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
                为 Lime 青柠精灵单独指定通用模型与 TTS
                服务。未设置桌宠专用通用模型时，双击鼓励、三击下一步建议会先回退最近当前
                provider/model，再回退自动可用服务商。
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-[18px] border border-slate-200/80 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
          <p className="font-medium text-slate-800">当前范围</p>
          <p>通用模型已接入桌宠 quick action。</p>
          <p>TTS 先落配置底座，后续用于桌宠朗读与语音播报。</p>
        </div>
      </div>

      {message ? (
        <div className="mt-5">
          <PreferenceMessage tone={message.tone} message={message.text} />
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <MediaPreferenceSection
          title="桌宠通用模型"
          description="用于双击鼓励、三击下一步建议等桌宠动作。留空时会先跟随当前 provider/model，再回退自动可用服务。"
          providerLabel="桌宠通用 Provider"
          providerValue={generalPreference.preferredProviderId ?? AUTO_VALUE}
          providerAutoLabel="跟随当前 provider / 自动选择"
          onProviderChange={handleGeneralProviderChange}
          providers={generalProviders.map((provider) => ({
            value: provider.id,
            label: provider.name,
          }))}
          providerUnavailableLabel={generalProviderUnavailableLabel}
          modelLabel="桌宠通用模型"
          modelValue={generalPreference.preferredModelId ?? AUTO_VALUE}
          modelAutoLabel="跟随当前模型"
          onModelChange={(value) =>
            void savePreference("general", {
              ...generalPreference,
              preferredModelId: value === AUTO_VALUE ? undefined : value,
              allowFallback: generalPreference.allowFallback ?? true,
            })
          }
          models={availableGeneralModels.map((model) => ({
            value: model,
            label: model,
          }))}
          modelUnavailableLabel={generalModelUnavailableLabel}
          modelHint="如果当前 Provider 没有维护支持的模型列表，可以先留空，让桌宠沿用当前会话模型。"
          allowFallback={generalPreference.allowFallback ?? true}
          onAllowFallbackChange={(value) =>
            void savePreference("general", {
              ...generalPreference,
              allowFallback: value,
            })
          }
          fallbackTitle="桌宠通用模型不可用时自动回退"
          fallbackDescription="关闭后，若桌宠专用 Provider 缺失、被禁用或没有可用 Key，将直接提示错误，不再回退当前 provider 或自动可用服务。"
          emptyHint={
            providersLoading
              ? "正在加载桌宠可聊天服务..."
              : generalProviders.length === 0
                ? "暂无可聊天 Provider，请先到服务商设置里配置至少一个可用聊天服务。"
                : "留空时会先跟随当前对话的 provider/model，再回退自动选择可用服务。"
          }
          disabled={!config || configLoading || savingKind === "general"}
          modelDisabled={
            providersLoading ||
            !generalPreference.preferredProviderId ||
            availableGeneralModels.length === 0
          }
          onReset={() =>
            void savePreference("general", DEFAULT_MEDIA_PREFERENCE)
          }
          resetLabel="恢复通用默认"
          resetDisabled={
            !hasMediaGenerationPreferenceOverride(generalPreference)
          }
        />

        <MediaPreferenceSection
          title="桌宠语音播报"
          description="预留给后续桌宠朗读、语音播报与轻量陪伴语音。当前先保存 Provider / 模型选择，后续直接复用。"
          providerLabel="桌宠 TTS Provider"
          providerValue={ttsPreference.preferredProviderId ?? AUTO_VALUE}
          providerAutoLabel="自动选择"
          onProviderChange={handleTtsProviderChange}
          providers={ttsProviders.map((provider) => ({
            value: provider.id,
            label: provider.name,
          }))}
          providerUnavailableLabel={ttsProviderUnavailableLabel}
          modelLabel="桌宠 TTS 模型"
          modelValue={ttsPreference.preferredModelId ?? AUTO_VALUE}
          modelAutoLabel="自动选择"
          onModelChange={(value) =>
            void savePreference("tts", {
              ...ttsPreference,
              preferredModelId: value === AUTO_VALUE ? undefined : value,
              allowFallback: ttsPreference.allowFallback ?? true,
            })
          }
          models={availableTtsModels.map((model) => ({
            value: model,
            label: model,
          }))}
          modelUnavailableLabel={ttsModelUnavailableLabel}
          modelHint="桌宠后续做语音播报时会优先用这里的 Provider / 模型；未指定时自动匹配可用 TTS 服务。"
          allowFallback={ttsPreference.allowFallback ?? true}
          onAllowFallbackChange={(value) =>
            void savePreference("tts", {
              ...ttsPreference,
              allowFallback: value,
            })
          }
          fallbackTitle="桌宠 TTS 不可用时自动回退"
          fallbackDescription="关闭后，若桌宠专用 TTS Provider 缺失或不可用，将直接提示错误，不再尝试其他语音服务。"
          emptyHint={
            providersLoading
              ? "正在加载桌宠语音服务..."
              : ttsProviders.length === 0
                ? "暂无可用 TTS Provider，请先到服务商设置里配置语音 / TTS 服务。"
                : "未指定时，桌宠会自动选择可用的 TTS Provider。"
          }
          disabled={!config || configLoading || savingKind === "tts"}
          modelDisabled={providersLoading || !ttsPreference.preferredProviderId}
          onReset={() => void savePreference("tts", DEFAULT_MEDIA_PREFERENCE)}
          resetLabel="恢复 TTS 默认"
          resetDisabled={!hasMediaGenerationPreferenceOverride(ttsPreference)}
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
        <p>
          TTS 优先级：桌宠专用配置 &gt; 自动可用 TTS
          Provider。这样能先把桌宠专属能力和 Lime 主聊天链路拆开管理。
        </p>
      </div>
    </article>
  );
}

export default CompanionCapabilityPreferencesCard;
