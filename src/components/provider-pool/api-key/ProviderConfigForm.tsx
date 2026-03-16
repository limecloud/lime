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
import {
  dedupeModelIds,
  getProviderTypeLabel,
  getLatestSelectableModel,
  parseCustomModelsValue,
  PROVIDER_TYPE_FIELDS,
  PROVIDER_TYPE_OPTIONS,
  serializeCustomModels,
} from "./ProviderConfigForm.utils";
import { Plus, Star, X } from "lucide-react";

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

/** 字段帮助文本映射 */
const FIELD_HELP_TEXT: Record<string, string> = {
  apiHost: "API 服务的基础 URL",
  apiVersion: "Azure OpenAI API 版本",
  project: "Google Cloud 项目 ID",
  location: "VertexAI 服务位置",
  region: "AWS Bedrock 区域",
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
        customModels: selectedModels,
      }),
      [formState.providerType, provider.id, provider.name, selectedModels],
    );

    const {
      models: localCandidateModels,
      loading: localModelsLoading,
      error: localModelsError,
    } = useProviderModels(configuredProvider, {
      returnFullMetadata: true,
    });

    const latestLocalModel = useMemo(() => {
      const localModelsWithMetadata = localCandidateModels.filter(
        hasRegistryBackedMetadata,
      );
      return getLatestSelectableModel(localModelsWithMetadata);
    }, [localCandidateModels]);

    const recommendedLatestModel = useMemo(() => {
      if (latestLocalModel) {
        return latestLocalModel;
      }

      if (localModelsLoading) {
        return null;
      }

      return getLatestSelectableModel(localCandidateModels);
    }, [latestLocalModel, localCandidateModels, localModelsLoading]);

    // 当 provider 变化时，重置表单状态
    useEffect(() => {
      setFormState({
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
            api_host: state.apiHost || undefined,
            api_version: state.apiVersion || undefined,
            project: state.project || undefined,
            location: state.location || undefined,
            region: state.region || undefined,
            custom_models: customModels.length > 0 ? customModels : undefined,
          };

          await onUpdate(provider.id, request);
          setLastSaved(new Date());
        } catch (e) {
          setSaveError(e instanceof Error ? e.message : "保存失败");
        } finally {
          setIsSaving(false);
        }
      },
      [provider.id, onUpdate],
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
      if (selectedModels.length > 0 || !recommendedLatestModel) {
        return;
      }

      applyCustomModels([recommendedLatestModel.id]);
    }, [applyCustomModels, recommendedLatestModel, selectedModels.length]);

    useEffect(() => {
      onModelsChange?.(selectedModels);
    }, [onModelsChange, selectedModels]);

    useEffect(() => {
      onRecommendedLatestModelChange?.(recommendedLatestModel?.id ?? null);
    }, [onRecommendedLatestModelChange, recommendedLatestModel]);

    // 获取当前 Provider 类型需要显示的额外字段
    // 使用 formState 中的 providerType，这样修改类型后会立即更新显示的字段
    const extraFields = PROVIDER_TYPE_FIELDS[formState.providerType] || [];

    // 格式化最后保存时间
    const formatLastSaved = (date: Date | null): string => {
      if (!date) return "";
      return `已保存于 ${date.toLocaleTimeString("zh-CN")}`;
    };

    return (
      <div
        className={cn("space-y-5", className)}
        data-testid="provider-config-form"
      >
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
            <SelectTrigger id="provider-type" data-testid="provider-type-select">
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
          <p className="text-xs text-muted-foreground">
            选择 API 协议类型，不同类型使用不同的请求格式
          </p>
        </div>

        {/* API Host 字段（所有 Provider 都有） */}
        <div className="space-y-1.5">
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
            data-testid="api-host-input"
          />
          <p className="text-xs text-muted-foreground">
            {FIELD_HELP_TEXT.apiHost}
          </p>
        </div>

        {/* Azure OpenAI: API Version */}
        {extraFields.includes("apiVersion") && (
          <div className="space-y-1.5">
            <Label htmlFor="api-version" className="text-sm font-medium">
              {FIELD_LABELS.apiVersion}
            </Label>
            <Input
              id="api-version"
              type="text"
              value={formState.apiVersion}
              onChange={(e) => handleFieldChange("apiVersion", e.target.value)}
              placeholder={FIELD_PLACEHOLDERS.apiVersion}
              disabled={loading || isSaving}
              data-testid="api-version-input"
            />
            <p className="text-xs text-muted-foreground">
              {FIELD_HELP_TEXT.apiVersion}
            </p>
          </div>
        )}

        {/* VertexAI: Project */}
        {extraFields.includes("project") && (
          <div className="space-y-1.5">
            <Label htmlFor="project" className="text-sm font-medium">
              {FIELD_LABELS.project}
            </Label>
            <Input
              id="project"
              type="text"
              value={formState.project}
              onChange={(e) => handleFieldChange("project", e.target.value)}
              placeholder={FIELD_PLACEHOLDERS.project}
              disabled={loading || isSaving}
              data-testid="project-input"
            />
            <p className="text-xs text-muted-foreground">
              {FIELD_HELP_TEXT.project}
            </p>
          </div>
        )}

        {/* VertexAI: Location */}
        {extraFields.includes("location") && (
          <div className="space-y-1.5">
            <Label htmlFor="location" className="text-sm font-medium">
              {FIELD_LABELS.location}
            </Label>
            <Input
              id="location"
              type="text"
              value={formState.location}
              onChange={(e) => handleFieldChange("location", e.target.value)}
              placeholder={FIELD_PLACEHOLDERS.location}
              disabled={loading || isSaving}
              data-testid="location-input"
            />
            <p className="text-xs text-muted-foreground">
              {FIELD_HELP_TEXT.location}
            </p>
          </div>
        )}

        {/* AWS Bedrock: Region */}
        {extraFields.includes("region") && (
          <div className="space-y-1.5">
            <Label htmlFor="region" className="text-sm font-medium">
              {FIELD_LABELS.region}
            </Label>
            <Input
              id="region"
              type="text"
              value={formState.region}
              onChange={(e) => handleFieldChange("region", e.target.value)}
              placeholder={FIELD_PLACEHOLDERS.region}
              disabled={loading || isSaving}
              data-testid="region-input"
            />
            <p className="text-xs text-muted-foreground">
              {FIELD_HELP_TEXT.region}
            </p>
          </div>
        )}

        {/* 自定义模型列表 */}
        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
          <div className="space-y-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-1">
                <Label
                  htmlFor="custom-model-draft"
                  className="text-sm font-medium"
                >
                  自定义模型
                </Label>
                <p className="text-xs text-muted-foreground">
                  手动添加模型后会保留在这里；默认模型请在右侧“模型能力”列表中点击选择。
                </p>
              </div>
            </div>

            <input
              id="custom-models"
              type="hidden"
              value={formState.customModels}
              readOnly
            />

            <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
              <div className="flex min-h-[56px] flex-wrap gap-2">
                {selectedModels.length > 0 ? (
                  selectedModels.map((modelId, index) => {
                    const isLatest = recommendedLatestModel?.id === modelId;
                    return (
                      <div
                        key={modelId}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-2 py-1 text-xs normal-case"
                      >
                        <span className="max-w-[220px] truncate normal-case">
                          {modelId}
                        </span>
                        {index === 0 ? (
                          <Badge variant="secondary">默认</Badge>
                        ) : null}
                        {isLatest ? (
                          <Badge variant="outline">最新</Badge>
                        ) : null}
                        {index > 0 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 rounded-full"
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
                          className="h-5 w-5 rounded-full"
                          onClick={() => handleRemoveModel(modelId)}
                          title="移除模型"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-muted-foreground">
                    尚未选择模型。检测到可用模型后，系统会默认填入最新模型。
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="custom-model-draft"
                type="text"
                className="normal-case bg-background"
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    handleAddModelDraft();
                  }
                }}
                placeholder="手动输入模型 ID，按 Enter 添加"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={loading || isSaving}
                data-testid="custom-models-input"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleAddModelDraft}
                disabled={loading || isSaving || !modelDraft.trim()}
                className="sm:min-w-[88px]"
              >
                <Plus className="mr-1 h-4 w-4" />
                添加
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                第一个模型会作为默认模型，用于测试与默认请求；若未显式选择，则自动使用最新模型。
              </span>
              {recommendedLatestModel ? (
                <span>
                  当前推荐最新模型：
                  <span className="font-medium normal-case">
                    {recommendedLatestModel.id}
                  </span>
                </span>
              ) : null}
            </div>
            {localModelsError ? (
              <p className="text-xs text-amber-600">{localModelsError}</p>
            ) : null}
            {localModelsLoading ? (
              <p className="text-xs text-muted-foreground">
                正在加载模型列表...
              </p>
            ) : null}
          </div>
        </div>

        {/* 保存状态指示 */}
        <div className="flex items-center justify-between text-xs">
          {isSaving ? (
            <span
              className="text-muted-foreground"
              data-testid="saving-indicator"
            >
              保存中...
            </span>
          ) : saveError ? (
            <span className="text-red-500" data-testid="save-error">
              {saveError}
            </span>
          ) : lastSaved ? (
            <span className="text-green-600" data-testid="save-success">
              {formatLastSaved(lastSaved)}
            </span>
          ) : (
            <span />
          )}
        </div>
      </div>
    );
  },
);

ProviderConfigForm.displayName = "ProviderConfigForm";

export default ProviderConfigForm;
