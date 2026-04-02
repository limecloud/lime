import React, { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { useConfiguredProviders } from "@/hooks/useConfiguredProviders";
import { useProviderModels } from "@/hooks/useProviderModels";
import { resolveVisionModel } from "@/lib/model/visionModelResolver";
import { resolveProviderModelLoadOptions } from "@/lib/model/providerModelLoadOptions";

interface InputbarVisionCapabilityNoticeProps {
  providerType?: string;
  model?: string;
  hasPendingImages: boolean;
}

export const InputbarVisionCapabilityNotice: React.FC<
  InputbarVisionCapabilityNoticeProps
> = ({ providerType, model, hasPendingImages }) => {
  const shouldInspectCapability =
    hasPendingImages &&
    Boolean(providerType?.trim()) &&
    Boolean(model?.trim());

  const { providers, loading: providersLoading } = useConfiguredProviders({
    autoLoad: shouldInspectCapability,
  });

  const selectedProvider = useMemo(
    () => providers.find((item) => item.key === providerType),
    [providerType, providers],
  );
  const providerModelLoadOptions = useMemo(
    () =>
      resolveProviderModelLoadOptions({
        providerId: selectedProvider?.providerId,
        providerType: selectedProvider?.type,
        apiHost: selectedProvider?.apiHost,
      }),
    [selectedProvider?.apiHost, selectedProvider?.providerId, selectedProvider?.type],
  );

  const { models, loading: modelsLoading } = useProviderModels(
    selectedProvider,
    {
      returnFullMetadata: true,
      autoLoad: shouldInspectCapability && Boolean(selectedProvider),
      ...providerModelLoadOptions,
    },
  );

  const warningMessage = useMemo(() => {
    if (!shouldInspectCapability || !model?.trim()) {
      return null;
    }
    if (providersLoading || modelsLoading || !selectedProvider) {
      return null;
    }

    const visionResult = resolveVisionModel({
      currentModelId: model,
      models,
    });

    if (visionResult.reason === "already_vision") {
      return null;
    }

    if (visionResult.reason === "no_vision_model") {
      return "当前 Provider 暂无可用的多模态模型，请切换到支持多模态的 Provider 或模型后再发送图片";
    }

    const suggestedModel = visionResult.targetModelId.trim();
    return suggestedModel
      ? `当前模型 ${model} 不支持多模态图片理解，建议切换到 ${suggestedModel} 后再发送图片`
      : `当前模型 ${model} 不支持多模态图片理解，请切换到支持多模态的模型后再发送图片`;
  }, [
    model,
    models,
    modelsLoading,
    providersLoading,
    selectedProvider,
    shouldInspectCapability,
  ]);

  if (!warningMessage) {
    return null;
  }

  return (
    <div
      data-testid="inputbar-vision-warning"
      className="mx-3 mb-2 flex items-start gap-2 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-[11px] leading-5 text-amber-800"
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
      <span>{warningMessage}</span>
    </div>
  );
};
