import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  findConfiguredProviderBySelection,
  useConfiguredProviders,
} from "@/hooks/useConfiguredProviders";
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

const DEFAULT_PREFERENCE: MediaGenerationPreference = {
  allowFallback: true,
};

export function VideoGenSettings() {
  const { providers, loading: providersLoading } = useConfiguredProviders();
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
          nextConfig.workspace_preferences?.media_defaults?.video ??
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
          isVideoProvider(provider.providerId ?? provider.key),
      ),
    [providers],
  );

  const selectedProvider = useMemo(
    () =>
      findConfiguredProviderBySelection(
        videoProviders,
        videoPreference.preferredProviderId,
      ),
    [videoPreference.preferredProviderId, videoProviders],
  );

  const availableModels = useMemo(() => {
    if (!selectedProvider) {
      return [];
    }
    return getVideoModelsForProvider(
      selectedProvider.providerId ?? selectedProvider.key,
      selectedProvider.customModels,
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
        workspace_preferences: {
          ...config.workspace_preferences,
          media_defaults: {
            ...config.workspace_preferences?.media_defaults,
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
    const preferredProviderId = value.trim() || undefined;
    const nextProvider = findConfiguredProviderBySelection(
      videoProviders,
      preferredProviderId,
    );
    const nextModels = nextProvider
      ? getVideoModelsForProvider(
          nextProvider.providerId ?? nextProvider.key,
          nextProvider.customModels,
        )
      : [];
    const preferredModelId = preferredProviderId
      ? nextModels.includes(videoPreference.preferredModelId || "")
        ? videoPreference.preferredModelId
        : undefined
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
      preferredModelId: value.trim() || undefined,
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

  const providerHint = providersLoading
    ? "仅展示当前已识别为视频能力的 Provider。"
    : videoProviders.length === 0
      ? "当前没有可用视频 Provider；请先在凭证管理中配置可生成视频的服务。"
      : "视频设置和图片、语音共用同一套服务模型骨架，后续新增来源时无需再做第二套页面。";

  return (
    <div className="max-w-[820px] space-y-4">
      <MediaPreferenceSection
        title="视频服务模型"
        description="这里配置视频任务的默认 Provider、模型与回退策略，保持和图片、语音一致的简洁设置结构。"
        selectorLabel="默认模型"
        selectorDescription="统一使用聊天页同款模型选择器；未指定时沿用自动匹配策略。"
        selectionWarningText={providerUnavailableLabel ?? modelUnavailableLabel}
        providerType={videoPreference.preferredProviderId ?? ""}
        setProviderType={handleProviderChange}
        model={videoPreference.preferredModelId ?? ""}
        setModel={handleModelChange}
        providerFilter={(provider) =>
          isVideoProvider(provider.providerId ?? provider.key)
        }
        modelFilter={(model, provider) =>
          getVideoModelsForProvider(
            provider.providerId ?? provider.key,
            provider.customModels,
          ).includes(model.id)
        }
        allowFallback={videoPreference.allowFallback ?? true}
        onAllowFallbackChange={handleFallbackChange}
        fallbackTitle="Provider 不可用时自动回退"
        fallbackDescription="关闭后，若当前默认视频服务缺失、被禁用或无可用 Key，将直接提示错误。"
        emptyStateTitle="暂无可用视频模型"
        emptyStateDescription={providerHint}
        disabled={!config}
        onReset={handleResetPreference}
        resetLabel="恢复默认"
        resetDisabled={!hasMediaGenerationPreferenceOverride(videoPreference)}
      />

      {message ? (
        <div
          className={cn(
            "flex items-center gap-2 rounded-[20px] border px-4 py-3",
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
