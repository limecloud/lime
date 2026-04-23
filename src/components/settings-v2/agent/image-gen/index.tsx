import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import {
  findConfiguredProviderBySelection,
  useConfiguredProviders,
} from "@/hooks/useConfiguredProviders";
import { cn } from "@/lib/utils";
import {
  buildPersistedMediaGenerationPreference,
  hasMediaGenerationPreferenceOverride,
  type MediaGenerationPreference,
} from "@/lib/mediaGeneration";
import {
  getImageModelIdsForProvider,
  isImageProvider,
} from "@/lib/imageGeneration";
import { MediaPreferenceSection } from "../shared/MediaPreferenceSection";

const DEFAULT_MEDIA_PREFERENCE: MediaGenerationPreference = {
  allowFallback: true,
};

export function ImageGenSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [globalImagePreference, setGlobalImagePreference] =
    useState<MediaGenerationPreference>(DEFAULT_MEDIA_PREFERENCE);
  const { providers, loading: providersLoading } = useConfiguredProviders();

  useEffect(() => {
    void (async () => {
      try {
        const nextConfig = await getConfig();
        setConfig(nextConfig);
        setGlobalImagePreference(
          nextConfig.workspace_preferences?.media_defaults?.image ??
            DEFAULT_MEDIA_PREFERENCE,
        );
      } catch (error) {
        console.error("加载图片服务配置失败:", error);
      }
    })();
  }, []);

  const imageProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          isImageProvider(
            provider.providerId ?? provider.key,
            provider.type,
            provider.customModels,
          ),
      ),
    [providers],
  );

  const selectedProvider = useMemo(
    () =>
      findConfiguredProviderBySelection(
        imageProviders,
        globalImagePreference.preferredProviderId,
      ),
    [globalImagePreference.preferredProviderId, imageProviders],
  );

  const availableModelIds = useMemo(() => {
    if (!selectedProvider) {
      return [];
    }

    return getImageModelIdsForProvider(
      selectedProvider.providerId ?? selectedProvider.key,
      selectedProvider.type,
      selectedProvider.customModels,
      selectedProvider.apiHost,
    );
  }, [selectedProvider]);

  const providerUnavailableLabel =
    globalImagePreference.preferredProviderId && !selectedProvider
      ? `当前配置不可用：${globalImagePreference.preferredProviderId}`
      : undefined;

  const modelUnavailableLabel =
    globalImagePreference.preferredModelId &&
    !availableModelIds.includes(globalImagePreference.preferredModelId)
      ? `当前配置不可用：${globalImagePreference.preferredModelId}`
      : undefined;

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

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
            image: persistedPreference,
          },
        },
      };
      await saveConfig(updatedConfig);
      setConfig(updatedConfig);
      setGlobalImagePreference(nextPreference);
      showMessage("success", "设置已保存");
    } catch (error) {
      console.error("保存图片服务配置失败:", error);
      showMessage("error", "保存失败");
    }
  };

  const handleProviderChange = (value: string) => {
    const preferredProviderId = value.trim() || undefined;
    const nextProvider = findConfiguredProviderBySelection(
      imageProviders,
      preferredProviderId,
    );
    const nextModelIds = nextProvider
      ? getImageModelIdsForProvider(
          nextProvider.providerId ?? nextProvider.key,
          nextProvider.type,
          nextProvider.customModels,
          nextProvider.apiHost,
        )
      : [];
    const preferredModelId = preferredProviderId
      ? nextModelIds.includes(globalImagePreference.preferredModelId || "")
        ? globalImagePreference.preferredModelId
        : undefined
      : undefined;

    void savePreference({
      preferredProviderId,
      preferredModelId,
      allowFallback: globalImagePreference.allowFallback ?? true,
    });
  };

  const handleModelChange = (value: string) => {
    void savePreference({
      ...globalImagePreference,
      preferredModelId: value.trim() || undefined,
      allowFallback: globalImagePreference.allowFallback ?? true,
    });
  };

  const handleFallbackChange = (value: boolean) => {
    void savePreference({
      ...globalImagePreference,
      allowFallback: value,
    });
  };

  const handleResetPreference = () => {
    void savePreference(DEFAULT_MEDIA_PREFERENCE);
  };

  const providerHint = providersLoading
    ? "只展示已声明图片生成能力的 Provider。"
    : imageProviders.length === 0
      ? "当前没有可用图片 Provider；请先在凭证管理中为可出图服务配置模型或自定义模型。"
      : "只展示已声明图片生成能力的 Provider；后续接入 OEM 云端目录时也会复用同一筛选口径。";

  return (
    <div className="max-w-[820px] space-y-4">
      <MediaPreferenceSection
        title="图片服务模型"
        description="这里只配置图片生成任务的默认 Provider、模型与回退策略；默认图片数量等全局参数统一收口到同页下方的 AI 图片设置。"
        selectorLabel="默认模型"
        selectorDescription="统一使用聊天页同款模型选择器；未指定时沿用自动匹配策略。"
        selectionWarningText={providerUnavailableLabel ?? modelUnavailableLabel}
        providerType={globalImagePreference.preferredProviderId ?? ""}
        setProviderType={handleProviderChange}
        model={globalImagePreference.preferredModelId ?? ""}
        setModel={handleModelChange}
        providerFilter={(provider) =>
          isImageProvider(
            provider.providerId ?? provider.key,
            provider.type,
            provider.customModels,
          )
        }
        modelFilter={(model, provider) =>
          getImageModelIdsForProvider(
            provider.providerId ?? provider.key,
            provider.type,
            provider.customModels,
            provider.apiHost,
          ).includes(model.id)
        }
        allowFallback={globalImagePreference.allowFallback ?? true}
        onAllowFallbackChange={handleFallbackChange}
        fallbackTitle="Provider 不可用时自动回退"
        fallbackDescription="关闭后，若当前默认图片服务缺失、被禁用或无可用 Key，将直接提示错误。"
        emptyStateTitle="暂无可用图片模型"
        emptyStateDescription={providerHint}
        disabled={!config}
        onReset={handleResetPreference}
        resetLabel="恢复默认"
        resetDisabled={
          !hasMediaGenerationPreferenceOverride(globalImagePreference)
        }
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
