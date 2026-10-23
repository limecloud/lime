import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getConfig, type Config } from "@/lib/api/appConfig";
import {
  getVoiceInputConfig,
  saveVoiceInputConfig,
  type VoiceInputConfig,
} from "@/lib/api/asrProvider";
import { normalizeDictationDictionary } from "@/lib/dictationDictionary";
import {
  getTtsModelsForProvider,
  isTtsProvider,
  type MediaGenerationPreference,
} from "@/lib/mediaGeneration";
import {
  findConfiguredProviderBySelection,
  useConfiguredProviders,
} from "@/hooks/useConfiguredProviders";
import { updateMediaPreference } from "../shared/mediaPreferencePersistence";
import { useAutoDismissMessage } from "../shared/useAutoDismissMessage";
const DEFAULT_MEDIA_PREFERENCE: MediaGenerationPreference = {
  allowFallback: true,
};

function normalizeOptionalText(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function useVoiceSettings() {
  const { t } = useTranslation("settings");
  const [config, setConfig] = useState<Config | null>(null);
  const [voiceConfig, setVoiceConfig] = useState<VoiceInputConfig | null>(null);
  const [globalVoicePreference, setGlobalVoicePreference] =
    useState<MediaGenerationPreference>(DEFAULT_MEDIA_PREFERENCE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const { message, showMessage } = useAutoDismissMessage();
  const { providers, loading: providersLoading } = useConfiguredProviders();
  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [nextConfig, nextVoiceConfig] = await Promise.all([
        getConfig(),
        getVoiceInputConfig(),
      ]);
      setConfig(nextConfig);
      setVoiceConfig(nextVoiceConfig);
      setGlobalVoicePreference(
        nextConfig.workspace_preferences?.media_defaults?.voice ??
          DEFAULT_MEDIA_PREFERENCE,
      );
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const persistVoiceConfig = useCallback(
    async (
      updater: (current: VoiceInputConfig) => VoiceInputConfig,
      notify = true,
    ): Promise<boolean> => {
      if (!voiceConfig || savingRef.current) {
        return false;
      }

      savingRef.current = true;
      setSaving(true);
      try {
        const latest = await getVoiceInputConfig();
        const nextVoiceConfig = updater(latest);
        await saveVoiceInputConfig(nextVoiceConfig);
        setVoiceConfig(nextVoiceConfig);
        if (notify) showMessage("success", t("settings.voice.message.saved"));
        return true;
      } catch (error) {
        console.error("保存语音设置失败:", error);
        if (notify)
          showMessage("error", t("settings.voice.message.saveFailed"));
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [showMessage, t, voiceConfig],
  );

  const persistGlobalVoicePreference = useCallback(
    async (
      updater: (
        current: MediaGenerationPreference,
      ) => MediaGenerationPreference,
    ) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      try {
        const { config: nextConfig, preference: nextPreference } =
          await updateMediaPreference("voice", updater);
        setConfig(nextConfig);
        setGlobalVoicePreference(nextPreference);
        showMessage(
          "success",
          t("settings.voice.message.mediaPreferenceSaved"),
        );
      } catch (error) {
        console.error("保存语音生成偏好失败:", error);
        showMessage(
          "error",
          t("settings.voice.message.mediaPreferenceSaveFailed"),
        );
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [showMessage, t],
  );

  const voiceProviders = useMemo(
    () =>
      providers.filter((provider) =>
        isTtsProvider(provider.providerId ?? provider.key, provider.type),
      ),
    [providers],
  );

  const polishProvider = useMemo(
    () =>
      voiceConfig
        ? findConfiguredProviderBySelection(
            providers,
            voiceConfig.processor.polish_provider,
          )
        : null,
    [providers, voiceConfig],
  );

  const polishProviderWarning = voiceConfig?.processor.polish_provider
    ? !polishProvider
      ? t("settings.voice.processing.warning.providerUnavailable", {
          provider: voiceConfig.processor.polish_provider,
        })
      : undefined
    : undefined;

  const polishModelWarning =
    voiceConfig?.processor.polish_model &&
    polishProvider?.models?.length &&
    !polishProvider.models.includes(voiceConfig.processor.polish_model)
      ? t("settings.voice.processing.warning.modelUnavailable", {
          provider: polishProvider.label,
          model: voiceConfig.processor.polish_model,
        })
      : undefined;

  const providerHint = providersLoading
    ? t("settings.voice.media.providerHint.loading")
    : voiceProviders.length === 0
      ? t("settings.voice.media.providerHint.empty")
      : t("settings.voice.media.providerHint.ready");

  const llmModelHint = providersLoading
    ? t("settings.voice.processing.modelHint.loading")
    : providers.length === 0
      ? t("settings.voice.processing.modelHint.empty")
      : t("settings.voice.processing.modelHint.ready");

  const handlePolishProviderChange = (value: string) => {
    const nextProviderId = normalizeOptionalText(value);

    void persistVoiceConfig((current) => ({
      ...current,
      processor: {
        ...current.processor,
        polish_provider: nextProviderId,
        polish_model:
          nextProviderId === current.processor.polish_provider
            ? current.processor.polish_model
            : undefined,
      },
    }));
  };

  const handlePolishModelChange = (value: string) => {
    void persistVoiceConfig((current) => ({
      ...current,
      processor: {
        ...current.processor,
        polish_model: normalizeOptionalText(value),
      },
    }));
  };

  const handleMediaProviderChange = (value: string) => {
    const preferredProviderId = normalizeOptionalText(value);
    const nextProvider = findConfiguredProviderBySelection(
      voiceProviders,
      preferredProviderId,
    );
    const nextModels = nextProvider
      ? getTtsModelsForProvider(nextProvider.models)
      : [];
    void persistGlobalVoicePreference((current) => ({
      preferredProviderId,
      preferredModelId: preferredProviderId
        ? nextModels.includes(current.preferredModelId || "")
          ? current.preferredModelId
          : undefined
        : undefined,
      allowFallback: current.allowFallback ?? true,
    }));
  };

  const handleMediaModelChange = (value: string) => {
    void persistGlobalVoicePreference((current) => ({
      ...current,
      preferredModelId: normalizeOptionalText(value),
      allowFallback: current.allowFallback ?? true,
    }));
  };

  const handleMediaProviderAndModelChange = (
    providerValue: string,
    modelValue: string,
  ) => {
    void persistGlobalVoicePreference((current) => ({
      preferredProviderId: normalizeOptionalText(providerValue),
      preferredModelId:
        normalizeOptionalText(providerValue) &&
        normalizeOptionalText(modelValue)
          ? normalizeOptionalText(modelValue)
          : undefined,
      allowFallback: current.allowFallback ?? true,
    }));
  };

  const handleFallbackChange = (value: boolean) => {
    void persistGlobalVoicePreference((current) => ({
      ...current,
      allowFallback: value,
    }));
  };

  const handleResetPreference = () => {
    void persistGlobalVoicePreference(() => DEFAULT_MEDIA_PREFERENCE);
  };

  const handleSoundsEnabledChange = (enabled: boolean) => {
    void persistVoiceConfig((current) => ({
      ...current,
      sound_enabled: enabled,
    }));
  };
  const handleMicrophoneChange = (deviceId: string) => {
    void persistVoiceConfig((current) => ({
      ...current,
      selected_device_id: deviceId || undefined,
    }));
  };
  const handleDictionarySave = (entries: string[]) =>
    persistVoiceConfig(
      (current) => ({
        ...current,
        dictation_dictionary: normalizeDictationDictionary(entries),
      }),
      false,
    );
  return {
    config,
    voiceConfig,
    loading,
    loadError,
    reload,
    saving,
    message,
    showMessage,
    globalVoicePreference,
    providerHint,
    llmModelHint,
    polishProviderWarning,
    polishModelWarning,
    handlePolishProviderChange,
    handlePolishModelChange,
    handleSoundsEnabledChange,
    handleMediaProviderChange,
    handleMediaModelChange,
    handleMediaProviderAndModelChange,
    handleFallbackChange,
    handleResetPreference,
    handleMicrophoneChange,
    handleDictionarySave,
  };
}
