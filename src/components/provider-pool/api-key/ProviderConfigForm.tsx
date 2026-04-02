/**
 * @file ProviderConfigForm 组件
 * @description Provider 配置表单组件，显示 API Host 和根据 Provider Type 显示额外字段
 * @module components/provider-pool/api-key/ProviderConfigForm
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 4.1, 4.2, 5.3-5.5**
 */

import React, {
  forwardRef,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useImperativeHandle,
} from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import type {
  ProviderWithKeysDisplay,
  UpdateProviderRequest,
} from "@/lib/api/apiKeyProvider";
import type { ProviderType } from "@/lib/types/provider";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";
import type { ConfiguredProvider } from "@/hooks/useConfiguredProviders";
import { useProviderModels } from "@/hooks/useProviderModels";
import { resolveRegistryProviderId } from "./providerTypeMapping";
import { getProviderModelAutoFetchCapability } from "@/lib/model/providerModelFetchSupport";
import {
  dedupeModelIds,
  getSpecialProtocolHint,
  getLatestSelectableModel,
  getProviderTypeLabel,
  parseCustomModelsValue,
  PROVIDER_TYPE_FIELDS,
  PROVIDER_TYPE_OPTIONS,
  serializeCustomModels,
} from "./ProviderConfigForm.utils";
import { Plus, Save, Star, X } from "lucide-react";
import { SectionInfoButton } from "./SectionInfoButton";

// ============================================================================
// 常量
// ============================================================================

/** 防抖延迟时间（毫秒） */
const DEBOUNCE_DELAY = 500;

/** 字段标签映射 */
const FIELD_LABELS: Record<string, string> = {
  apiHost: "API Host",
  apiVersion: "API Version",
  project: "Project ID",
  location: "Location",
  region: "Region",
};

/** 字段占位符映射 */
const FIELD_PLACEHOLDERS: Record<string, string> = {
  apiHost: "https://api.example.com",
  apiVersion: "2024-02-15-preview",
  project: "your-project-id",
  location: "us-central1",
  region: "us-east-1",
};

// ============================================================================
// 类型定义
// ============================================================================

export interface ProviderConfigFormProps {
  /** Provider 数据 */
  provider: ProviderWithKeysDisplay;
  /** 更新回调 */
  onUpdate?: (id: string, request: UpdateProviderRequest) => Promise<void>;
  /** 当前模型列表变化回调 */
  onModelsChange?: (models: string[]) => void;
  /** 推荐最新模型变化回调 */
  onRecommendedLatestModelChange?: (modelId: string | null) => void;
  /** 是否正在加载 */
  loading?: boolean;
  /** 额外的 CSS 类名 */
  className?: string;
}

export interface ProviderConfigFormRef {
  /** 将模型设为默认模型（置顶） */
  setDefaultModel: (modelId: string) => void;
  /** 追加模型到列表 */
  addModels: (modelIds: string[]) => void;
}

interface FormState {
  providerName: string;
  providerType: ProviderType;
  apiHost: string;
  apiVersion: string;
  project: string;
  location: string;
  region: string;
  customModels: string;
}

function hasRegistryBackedMetadata(model: EnhancedModelMetadata): boolean {
  return Boolean(model.is_latest || model.release_date);
}

// ============================================================================
// 组件实现
// ============================================================================

/**
 * Provider 配置表单组件
 *
 * 显示 Provider 的配置字段，包括：
 * - API Host（所有 Provider 都有）
 * - 根据 Provider Type 显示额外字段：
 *   - Azure OpenAI: API Version
 *   - VertexAI: Project, Location
 *   - AWS Bedrock: Region
 *
 * 支持自动保存（防抖）。
 *
 * @example
 * ```tsx
 * <ProviderConfigForm
 *   provider={provider}
 *   onUpdate={updateProvider}
 * />
 * ```
 */
export const ProviderConfigForm = forwardRef<
  ProviderConfigFormRef,
  ProviderConfigFormProps
>(
  (
    {
      provider,
      onUpdate,
      onModelsChange,
      onRecommendedLatestModelChange,
      loading = false,
      className,
    },
    ref,
  ) => {
    // 表单状态
    const [formState, setFormState] = useState<FormState>({
      providerName: provider.name || "",
      providerType: (provider.type as ProviderType) || "openai",
      apiHost: provider.api_host || "",
      apiVersion: provider.api_version || "",
      project: provider.project || "",
      location: provider.location || "",
      region: provider.region || "",
      customModels: (provider.custom_models || []).join(", "),
    });

    // 保存状态
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [modelDraft, setModelDraft] = useState("");

    // 防抖定时器
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const selectedModels = useMemo(
      () => parseCustomModelsValue(formState.customModels),
      [formState.customModels],
    );
    const enabledApiKeyCount = useMemo(
      () => provider.api_keys.filter((apiKey) => apiKey.enabled).length,
      [provider.api_keys],
    );

    const configuredProvider = useMemo<ConfiguredProvider>(
      () => ({
        key: provider.id,
        label: provider.name,
        registryId: provider.id,
        fallbackRegistryId: resolveRegistryProviderId(provider.id, {
          providerType: formState.providerType,
        }),
        type: formState.providerType,
        providerId: provider.id,
        apiHost: formState.apiHost,
        customModels: selectedModels,
      }),
      [
        formState.apiHost,
        formState.providerType,
        provider.id,
        provider.name,
        selectedModels,
      ],
    );
    const modelAutoFetchCapability = useMemo(
      () =>
        getProviderModelAutoFetchCapability({
          providerId: provider.id,
          providerType: formState.providerType,
          apiHost: formState.apiHost,
        }),
      [formState.apiHost, formState.providerType, provider.id],
    );
    const requiresLiveModelTruth = modelAutoFetchCapability.supported;
    const canReadLiveModels =
      !requiresLiveModelTruth ||
      !modelAutoFetchCapability.requiresApiKey ||
      enabledApiKeyCount > 0;

    const {
      models: localCandidateModels,
      loading: localModelsLoading,
      error: localModelsError,
    } = useProviderModels(configuredProvider, {
      returnFullMetadata: true,
      liveFetchOnly: requiresLiveModelTruth,
      hasApiKey: enabledApiKeyCount > 0,
    });
    const hasResolvedLiveModelDirectory =
      !requiresLiveModelTruth || localCandidateModels.length > 0;
    const shouldHideSavedModels =
      requiresLiveModelTruth && !hasResolvedLiveModelDirectory;
    const hiddenSelectedModelCount = shouldHideSavedModels
      ? selectedModels.length
      : 0;
    const visibleSelectedModels = shouldHideSavedModels ? [] : selectedModels;
    const shouldLockModelEditor =
      requiresLiveModelTruth &&
      (!canReadLiveModels || localModelsLoading || localCandidateModels.length === 0);

    const latestLocalModel = useMemo(() => {
      const localModelsWithMetadata = localCandidateModels.filter(
        hasRegistryBackedMetadata,
      );
      return getLatestSelectableModel(localModelsWithMetadata);
    }, [localCandidateModels]);

    const recommendedLatestModel = useMemo(() => {
      if (!hasResolvedLiveModelDirectory) {
        return null;
      }

      if (latestLocalModel) {
        return latestLocalModel;
      }

      if (localModelsLoading) {
        return null;
      }

      return getLatestSelectableModel(localCandidateModels);
    }, [
      hasResolvedLiveModelDirectory,
      latestLocalModel,
      localCandidateModels,
      localModelsLoading,
    ]);
    const modelTruthNotice = useMemo(() => {
      if (!requiresLiveModelTruth) {
        return null;
      }

      if (!canReadLiveModels) {
        return {
          tone: "amber" as const,
          title: "先补一把可用 API Key",
          description:
            "当前渠道会直接读取真实模型目录。为了避免继续展示旧缓存或错误模型，未配置可用 API Key 前暂不展示已选模型，也不开放手动输入。",
        };
      }

      if (localModelsLoading) {
        return {
          tone: "slate" as const,
          title: "正在读取真实模型目录",
          description:
            "读取完成前先不展示旧模型配置与推荐最新模型，避免把历史缓存误认为当前可用模型。",
        };
      }

      if (localCandidateModels.length === 0) {
        return {
          tone: "amber" as const,
          title: "当前未读取到真实模型目录",
          description:
            "这次没有拿到最新模型列表。为避免错误模型输出，页面不会继续展示旧模型或推荐模型，请先检查鉴权、Base URL 或接口兼容性。",
        };
      }

      return null;
    }, [
      canReadLiveModels,
      localCandidateModels.length,
      localModelsLoading,
      requiresLiveModelTruth,
    ]);

    // 当 provider 变化时，重置表单状态
    useEffect(() => {
      setFormState({
        providerName: provider.name || "",
        providerType: (provider.type as ProviderType) || "openai",
        apiHost: provider.api_host || "",
        apiVersion: provider.api_version || "",
        project: provider.project || "",
        location: provider.location || "",
        region: provider.region || "",
        customModels: (provider.custom_models || []).join(", "),
      });
      setSaveError(null);
      setModelDraft("");
    }, [
      provider.id,
      provider.name,
      provider.type,
      provider.api_host,
      provider.api_version,
      provider.project,
      provider.location,
      provider.region,
      provider.custom_models,
    ]);

    // 保存配置
    const saveConfig = useCallback(
      async (state: FormState) => {
        if (!onUpdate) return;

        setIsSaving(true);
        setSaveError(null);

        try {
          // 解析自定义模型列表（逗号分隔）
          const customModels = state.customModels
            .split(",")
            .map((m) => m.trim())
            .filter((m) => m.length > 0);

          const request: UpdateProviderRequest = {
            type: state.providerType,
            api_host: state.apiHost,
            api_version: state.apiVersion,
            project: state.project,
            location: state.location,
            region: state.region,
            custom_models: customModels,
          };

          const trimmedName = state.providerName.trim();
          if (
            !provider.is_system &&
            trimmedName &&
            trimmedName !== provider.name
          ) {
            request.name = trimmedName;
          }

          await onUpdate(provider.id, request);
          setLastSaved(new Date());
        } catch (e) {
          setSaveError(e instanceof Error ? e.message : "保存失败");
        } finally {
          setIsSaving(false);
        }
      },
      [onUpdate, provider.id, provider.is_system, provider.name],
    );

    // 防抖保存
    const debouncedSave = useCallback(
      (state: FormState) => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }

        debounceTimerRef.current = setTimeout(() => {
          saveConfig(state);
        }, DEBOUNCE_DELAY);
      },
      [saveConfig],
    );

    // 清理定时器
    useEffect(() => {
      return () => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
      };
    }, []);

    // 处理字段变化
    const handleFieldChange = useCallback(
      (field: keyof FormState, value: string) => {
        setFormState((previousState) => {
          const newState = { ...previousState, [field]: value };
          debouncedSave(newState);
          return newState;
        });
      },
      [debouncedSave],
    );

    const applyCustomModels = useCallback(
      (models: string[]) => {
        handleFieldChange("customModels", serializeCustomModels(models));
      },
      [handleFieldChange],
    );

    const setDefaultModel = useCallback(
      (modelId: string) => {
        const nextModels = selectedModels.filter(
          (currentModel) =>
            currentModel.toLowerCase() !== modelId.toLowerCase(),
        );
        applyCustomModels([modelId, ...nextModels]);
      },
      [applyCustomModels, selectedModels],
    );

    const addModels = useCallback(
      (modelIds: string[]) => {
        const normalizedModels = dedupeModelIds(modelIds);
        if (normalizedModels.length === 0) {
          return;
        }

        applyCustomModels([...selectedModels, ...normalizedModels]);
      },
      [applyCustomModels, selectedModels],
    );

    useImperativeHandle(
      ref,
      () => ({
        setDefaultModel,
        addModels,
      }),
      [addModels, setDefaultModel],
    );

    const handleAddModelDraft = useCallback(() => {
      const draftModels = dedupeModelIds(
        modelDraft
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      );

      if (draftModels.length === 0) {
        return;
      }

      addModels(draftModels);
      setModelDraft("");
    }, [addModels, modelDraft]);

    const handleRemoveModel = useCallback(
      (modelId: string) => {
        applyCustomModels(
          selectedModels.filter(
            (currentModel) =>
              currentModel.toLowerCase() !== modelId.toLowerCase(),
          ),
        );
      },
      [applyCustomModels, selectedModels],
    );

    useEffect(() => {
      if (
        selectedModels.length > 0 ||
        !recommendedLatestModel ||
        shouldLockModelEditor
      ) {
        return;
      }

      applyCustomModels([recommendedLatestModel.id]);
    }, [
      applyCustomModels,
      recommendedLatestModel,
      selectedModels.length,
      shouldLockModelEditor,
    ]);

    useEffect(() => {
      onModelsChange?.(selectedModels);
    }, [onModelsChange, selectedModels]);

    useEffect(() => {
      onRecommendedLatestModelChange?.(recommendedLatestModel?.id ?? null);
    }, [onRecommendedLatestModelChange, recommendedLatestModel]);

    const extraFields = PROVIDER_TYPE_FIELDS[formState.providerType] || [];
    const specialProtocolHint = getSpecialProtocolHint(formState.providerType);
    const defaultModelId =
      visibleSelectedModels[0] ?? recommendedLatestModel?.id ?? null;
    const extraFieldConfigs = extraFields.map((field) => {
      switch (field) {
        case "apiVersion":
          return {
            field,
            id: "api-version",
            label: FIELD_LABELS.apiVersion,
            placeholder: FIELD_PLACEHOLDERS.apiVersion,
            value: formState.apiVersion,
            testId: "api-version-input",
          };
        case "project":
          return {
            field,
            id: "project",
            label: FIELD_LABELS.project,
            placeholder: FIELD_PLACEHOLDERS.project,
            value: formState.project,
            testId: "project-input",
          };
        case "location":
          return {
            field,
            id: "location",
            label: FIELD_LABELS.location,
            placeholder: FIELD_PLACEHOLDERS.location,
            value: formState.location,
            testId: "location-input",
          };
        case "region":
          return {
            field,
            id: "region",
            label: FIELD_LABELS.region,
            placeholder: FIELD_PLACEHOLDERS.region,
            value: formState.region,
            testId: "region-input",
          };
        default:
          return null;
      }
    });

    const formatLastSaved = (date: Date | null): string => {
      if (!date) return "";
      return `已保存于 ${date.toLocaleTimeString("zh-CN")}`;
    };

    return (
      <div
        className={cn(
          "rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5",
          className,
        )}
        data-testid="provider-config-form"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold text-slate-900">
              协议与默认模型
            </p>
            <SectionInfoButton
              label="查看协议与默认模型说明"
              triggerTestId="provider-config-info-button"
            >
              <p>
                这里维护服务商名称、接口地址、协议类型和默认模型，保存会自动防抖提交。
              </p>
              <p className="mt-2">
                {provider.is_system
                  ? "官方供应商固定使用原生协议。"
                  : "兼容协议主要用于自定义接入；官方供应商继续保持各自原生协议。"}
              </p>
              {specialProtocolHint ? (
                <p className="mt-2" data-testid="protocol-special-hint">
                  {specialProtocolHint}
                </p>
              ) : null}
            </SectionInfoButton>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
            <Save className="h-3.5 w-3.5" />
            <span>
              {isSaving
                ? "保存中..."
                : saveError
                  ? "保存失败"
                  : lastSaved
                    ? formatLastSaved(lastSaved)
                    : "修改后自动保存"}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {!provider.is_system ? (
            <div className="space-y-1.5">
              <Label htmlFor="provider-name" className="text-sm font-medium">
                Provider 名称
              </Label>
              <Input
                id="provider-name"
                value={formState.providerName}
                onChange={(e) =>
                  handleFieldChange("providerName", e.target.value)
                }
                placeholder="输入服务商名称"
                disabled={loading || isSaving}
                className="border-slate-200 bg-white"
                data-testid="provider-name-input"
              />
            </div>
          ) : null}

          {!provider.is_system ? (
            <div className="space-y-1.5">
              <Label htmlFor="provider-type" className="text-sm font-medium">
                Provider 类型
              </Label>
              <Select
                value={formState.providerType}
                onValueChange={(value) =>
                  handleFieldChange("providerType", value as ProviderType)
                }
                disabled={loading || isSaving}
              >
                <SelectTrigger
                  id="provider-type"
                  className="border-slate-200 bg-white"
                  data-testid="provider-type-select"
                >
                  <span>{getProviderTypeLabel(formState.providerType)}</span>
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_TYPE_OPTIONS.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Provider 类型</Label>
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {getProviderTypeLabel(formState.providerType)}
              </div>
            </div>
          )}

          <div
            className={cn(
              "space-y-1.5",
              provider.is_system ? "lg:col-span-2" : "",
            )}
          >
            <Label htmlFor="api-host" className="text-sm font-medium">
              {FIELD_LABELS.apiHost}
            </Label>
            <Input
              id="api-host"
              type="text"
              value={formState.apiHost}
              onChange={(e) => handleFieldChange("apiHost", e.target.value)}
              placeholder={FIELD_PLACEHOLDERS.apiHost}
              disabled={loading || isSaving}
              className="border-slate-200 bg-white"
              data-testid="api-host-input"
            />
          </div>

          {extraFieldConfigs.map((config) => {
            if (!config) {
              return null;
            }

            return (
              <div key={config.field} className="space-y-1.5">
                <Label htmlFor={config.id} className="text-sm font-medium">
                  {config.label}
                </Label>
                <Input
                  id={config.id}
                  type="text"
                  value={config.value}
                  onChange={(e) =>
                    handleFieldChange(config.field, e.target.value)
                  }
                  placeholder={config.placeholder}
                  disabled={loading || isSaving}
                  className="border-slate-200 bg-white"
                  data-testid={config.testId}
                />
              </div>
            );
          })}
        </div>

        <div className="mt-5 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">默认模型</p>
              <SectionInfoButton
                label="查看默认模型说明"
                triggerTestId="provider-default-model-info-button"
              >
                <p>
                  第一个模型会被视为默认模型。支持实时拉取的渠道，只有在拿到真实模型目录后才会展示当前模型与推荐最新模型。
                </p>
              </SectionInfoButton>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className="border-slate-200 bg-slate-50 text-slate-600"
              >
                当前：
                {defaultModelId ??
                  (requiresLiveModelTruth ? "待读取真实目录" : "待指定")}
              </Badge>
              {recommendedLatestModel ? (
                <Badge
                  variant="outline"
                  className="border-sky-200 bg-sky-50 text-sky-700"
                >
                  推荐最新：{recommendedLatestModel.id}
                </Badge>
              ) : null}
            </div>
          </div>

          <input
            id="custom-models"
            type="hidden"
            value={formState.customModels}
            readOnly
          />

          {modelTruthNotice ? (
            <div
              className={cn(
                "mt-4 rounded-[18px] border px-4 py-3 text-sm leading-6",
                modelTruthNotice.tone === "amber"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-slate-200 bg-slate-50 text-slate-700",
              )}
              data-testid="provider-model-truth-notice"
            >
              <p className="font-semibold">{modelTruthNotice.title}</p>
              <p className="mt-1">{modelTruthNotice.description}</p>
            </div>
          ) : null}

          <div className="mt-4 flex min-h-[64px] flex-wrap gap-2">
            {visibleSelectedModels.length > 0 ? (
              visibleSelectedModels.map((modelId, index) => {
                const isLatest = recommendedLatestModel?.id === modelId;
                return (
                  <div
                    key={modelId}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
                  >
                    <span className="max-w-[220px] truncate normal-case text-slate-900">
                      {modelId}
                    </span>
                    {index === 0 ? (
                      <Badge className="bg-slate-900 text-white hover:bg-slate-900">
                        默认
                      </Badge>
                    ) : null}
                    {isLatest ? <Badge variant="outline">最新</Badge> : null}
                    {index > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 rounded-full text-slate-500 hover:text-slate-900"
                        onClick={() => setDefaultModel(modelId)}
                        title="设为默认模型"
                      >
                        <Star className="h-3 w-3" />
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 rounded-full text-slate-500 hover:text-slate-900"
                      onClick={() => handleRemoveModel(modelId)}
                      title="移除模型"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })
            ) : (
              <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                {hiddenSelectedModelCount > 0
                  ? `已保存 ${hiddenSelectedModelCount} 个模型配置，待读取真实模型目录后再展示。`
                  : requiresLiveModelTruth
                    ? "读取到真实模型目录后，才会展示当前模型与推荐最新模型。"
                    : "尚未指定模型。读取到模型目录后会自动填入推荐最新模型。"}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Input
              id="custom-model-draft"
              type="text"
              className="normal-case border-slate-200 bg-white"
              value={modelDraft}
              onChange={(e) => setModelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  handleAddModelDraft();
                }
              }}
              placeholder={
                shouldLockModelEditor
                  ? "先读取真实模型目录，再补充模型 ID"
                  : "手动输入模型 ID，按 Enter 添加"
              }
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={loading || isSaving || shouldLockModelEditor}
              data-testid="custom-models-input"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleAddModelDraft}
              disabled={
                loading ||
                isSaving ||
                shouldLockModelEditor ||
                !modelDraft.trim()
              }
              className="border-slate-200 bg-white sm:min-w-[112px]"
            >
              <Plus className="mr-1 h-4 w-4" />
              添加模型
            </Button>
          </div>

          {localModelsError ? (
            <p className="mt-3 text-xs text-amber-600">{localModelsError}</p>
          ) : null}
          {localModelsLoading ? (
            <p className="mt-3 text-xs text-slate-500">正在加载模型列表...</p>
          ) : null}
          {saveError ? (
            <p className="mt-3 text-xs text-red-500" data-testid="save-error">
              {saveError}
            </p>
          ) : null}
          {lastSaved && !isSaving && !saveError ? (
            <p
              className="mt-3 text-xs text-emerald-600"
              data-testid="save-success"
            >
              {formatLastSaved(lastSaved)}
            </p>
          ) : null}
          {isSaving ? (
            <p
              className="mt-3 text-xs text-slate-500"
              data-testid="saving-indicator"
            >
              保存中...
            </p>
          ) : null}
        </div>
      </div>
    );
  },
);

ProviderConfigForm.displayName = "ProviderConfigForm";

export default ProviderConfigForm;
