import { useEffect, useMemo, useState } from "react";
import { Film, CheckCircle2, AlertCircle } from "lucide-react";
import { useApiKeyProvider } from "@/hooks/useApiKeyProvider";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import { cn } from "@/lib/utils";
import {
  buildPersistedMediaGenerationPreference,
  getVideoModelsForProvider,
  hasMediaGenerationPreferenceOverride,
  isVideoProvider,
  type MediaGenerationPreference,
} from "@/lib/mediaGeneration";
import { MediaPreferenceSection } from "../shared/MediaPreferenceSection";

const AUTO_VALUE = "__auto__";
const DEFAULT_PREFERENCE: MediaGenerationPreference = {
  allowFallback: true,
};
const NOTICE_CARD_CLASS =
  "flex items-start gap-2 rounded-[22px] border border-sky-200/70 bg-sky-50/70 p-4 text-xs leading-6 text-slate-600";

export function VideoGenSettings() {
  const { providers, loading: providersLoading } = useApiKeyProvider();
  const [config, setConfig] = useState<Config | null>(null);
  const [videoPreference, setVideoPreference] =
    useState<MediaGenerationPreference>(DEFAULT_PREFERENCE);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const nextConfig = await getConfig();
        setConfig(nextConfig);
        setVideoPreference(
          nextConfig.content_creator?.media_defaults?.video ??
            DEFAULT_PREFERENCE,
        );
      } catch (error) {
        console.error("加载视频服务配置失败:", error);
      }
    })();
  }, []);

  const videoProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.enabled &&
          provider.api_key_count > 0 &&
          isVideoProvider(provider.id),
      ),
    [providers],
  );

  const selectedProvider = useMemo(
    () =>
      videoProviders.find(
        (provider) => provider.id === videoPreference.preferredProviderId,
      ) ?? null,
    [videoPreference.preferredProviderId, videoProviders],
  );

  const availableModels = useMemo(() => {
    if (!selectedProvider) {
      return [];
    }
    return getVideoModelsForProvider(
      selectedProvider.id,
      selectedProvider.custom_models,
    );
  }, [selectedProvider]);

  const providerUnavailableLabel =
    videoPreference.preferredProviderId && !selectedProvider
      ? `当前配置不可用：${videoPreference.preferredProviderId}`
      : undefined;

  const modelUnavailableLabel =
    videoPreference.preferredModelId &&
    !availableModels.includes(videoPreference.preferredModelId)
      ? `当前配置不可用：${videoPreference.preferredModelId}`
      : undefined;

  const savePreference = async (nextPreference: MediaGenerationPreference) => {
    if (!config) {
      return;
    }

    try {
      const persistedPreference =
        buildPersistedMediaGenerationPreference(nextPreference);
      const updatedConfig: Config = {
        ...config,
        content_creator: {
          ...config.content_creator,
          media_defaults: {
            ...config.content_creator?.media_defaults,
            video: persistedPreference,
          },
        },
      };
      await saveConfig(updatedConfig);
      setConfig(updatedConfig);
      setVideoPreference(nextPreference);
      setMessage({ type: "success", text: "设置已保存" });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error("保存视频服务配置失败:", error);
      setMessage({ type: "error", text: "保存失败" });
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleProviderChange = (value: string) => {
    const preferredProviderId = value === AUTO_VALUE ? undefined : value;
    const nextProvider = videoProviders.find(
      (provider) => provider.id === preferredProviderId,
    );
    const nextModels = nextProvider
      ? getVideoModelsForProvider(nextProvider.id, nextProvider.custom_models)
      : [];
    const preferredModelId = preferredProviderId
      ? nextModels.includes(videoPreference.preferredModelId || "")
        ? videoPreference.preferredModelId
        : nextModels[0]
      : undefined;

    void savePreference({
      preferredProviderId,
      preferredModelId,
      allowFallback: videoPreference.allowFallback ?? true,
    });
  };

  const handleModelChange = (value: string) => {
    void savePreference({
      ...videoPreference,
      preferredModelId: value === AUTO_VALUE ? undefined : value,
      allowFallback: videoPreference.allowFallback ?? true,
    });
  };

  const handleFallbackChange = (value: boolean) => {
    void savePreference({
      ...videoPreference,
      allowFallback: value,
    });
  };

  const handleResetPreference = () => {
    void savePreference(DEFAULT_PREFERENCE);
  };

  return (
    <div className="space-y-5 max-w-[980px]">
      <div className={NOTICE_CARD_CLASS}>
        <Film className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <p>
          这里配置的是全局默认视频服务。未在项目中单独覆盖时，视频素材与 AI
          视频任务都会优先使用这里的 Provider / 模型。
        </p>
      </div>

      <MediaPreferenceSection
        title="全局默认视频服务"
        description="新项目默认继承这里的设置；项目里留空时会继续跟随这里。"
        providerLabel="默认视频 Provider"
        providerValue={videoPreference.preferredProviderId ?? AUTO_VALUE}
        providerAutoLabel="自动选择"
        onProviderChange={handleProviderChange}
        providers={videoProviders.map((provider) => ({
          value: provider.id,
          label: provider.name,
        }))}
        providerUnavailableLabel={providerUnavailableLabel}
        modelLabel="默认视频模型"
        modelValue={videoPreference.preferredModelId ?? AUTO_VALUE}
        modelAutoLabel="自动选择"
        onModelChange={handleModelChange}
        models={availableModels.map((model) => ({
          value: model,
          label: model,
        }))}
        modelUnavailableLabel={modelUnavailableLabel}
        modelHint="仅在指定全局默认视频 Provider 时生效；未指定模型时沿用自动匹配策略。"
        allowFallback={videoPreference.allowFallback ?? true}
        onAllowFallbackChange={handleFallbackChange}
        fallbackTitle="默认视频服务不可用时自动回退"
        fallbackDescription="关闭后，若全局默认视频服务缺失、被禁用或无可用 Key，将直接提示错误。"
        emptyHint={
          providersLoading
            ? "正在加载视频 Provider..."
            : videoProviders.length === 0
              ? "暂无可用视频 Provider，请先到凭证管理中配置可生成视频的服务。"
              : "未指定时将沿用现有自动匹配规则。"
        }
        disabled={!config}
        modelDisabled={
          providersLoading ||
          !videoPreference.preferredProviderId ||
          availableModels.length === 0
        }
        onReset={handleResetPreference}
        resetLabel="恢复默认"
        resetDisabled={!hasMediaGenerationPreferenceOverride(videoPreference)}
      />

      {message ? (
        <div
          className={cn(
            "flex items-center gap-2 rounded-[20px] border p-3",
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700",
          )}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <span className="text-sm">{message.text}</span>
        </div>
      ) : null}
    </div>
  );
}

export default VideoGenSettings;
