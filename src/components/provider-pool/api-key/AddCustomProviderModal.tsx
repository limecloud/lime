/**
 * @file AddCustomProviderModal 组件
 * @description 添加自定义 Provider 的模态框组件
 * @module components/provider-pool/api-key/AddCustomProviderModal
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 6.1, 6.2**
 */

import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import { cn } from "@/lib/utils";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Search, X } from "lucide-react";
import { useModelRegistry } from "@/hooks/useModelRegistry";
import type { ProviderType } from "@/lib/types/provider";
import {
  apiKeyProviderApi,
  type AddCustomProviderRequest,
  type SystemProviderCatalogItem,
} from "@/lib/api/apiKeyProvider";
import {
  getProviderTypeLabel,
  isSupportedProviderType,
  PROVIDER_TYPE_FIELDS,
  PROVIDER_TYPE_OPTIONS,
} from "./ProviderConfigForm.utils";

// ============================================================================
// 常量
// ============================================================================

/** 已知厂商配置 */
interface KnownProvider {
  id: string;
  name: string;
  type: ProviderType;
  apiHost?: string;
  keywords?: string[];
}

/** 已知厂商列表（用于快速填充） */
const FALLBACK_KNOWN_PROVIDERS: KnownProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    type: "anthropic",
    apiHost: "https://api.anthropic.com",
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "openai",
    apiHost: "https://api.openai.com",
  },
  {
    id: "google",
    name: "Google (Gemini)",
    type: "gemini",
    apiHost: "https://generativelanguage.googleapis.com",
  },
  {
    id: "alibaba",
    name: "阿里云 (通义千问)",
    type: "openai",
    apiHost: "https://dashscope.aliyuncs.com/compatible-mode",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai",
    apiHost: "https://api.deepseek.com",
  },
  {
    id: "moonshot",
    name: "Moonshot (月之暗面)",
    type: "openai",
    apiHost: "https://api.moonshot.cn",
  },
  {
    id: "zhipu",
    name: "智谱 AI",
    type: "openai",
    apiHost: "https://open.bigmodel.cn/api/paas",
  },
  {
    id: "baichuan",
    name: "百川智能",
    type: "openai",
    apiHost: "https://api.baichuan-ai.com",
  },
  {
    id: "minimax",
    name: "MiniMax",
    type: "openai",
    apiHost: "https://api.minimax.chat",
  },
  {
    id: "groq",
    name: "Groq",
    type: "openai",
    apiHost: "https://api.groq.com/openai",
  },
  {
    id: "together",
    name: "Together AI",
    type: "openai",
    apiHost: "https://api.together.xyz",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    type: "openai",
    apiHost: "https://api.fireworks.ai/inference",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    type: "openai",
    apiHost: "https://api.perplexity.ai",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    type: "openai",
    apiHost: "https://api.mistral.ai",
  },
  {
    id: "cohere",
    name: "Cohere",
    type: "openai",
    apiHost: "https://api.cohere.ai",
  },
  {
    id: "ollama",
    name: "Ollama (本地)",
    type: "ollama",
    apiHost: "http://localhost:11434",
  },
  {
    id: "fal",
    name: "Fal",
    type: "fal",
    apiHost: "https://fal.run",
  },
];

/** 将 Catalog 返回的 provider type 收敛到前端 ProviderType */
function normalizeCatalogProviderType(providerType: string): ProviderType {
  return isSupportedProviderType(providerType) ? providerType : "openai";
}

function buildKnownProvidersFromCatalog(
  catalog: SystemProviderCatalogItem[],
): KnownProvider[] {
  const providers: KnownProvider[] = [];

  for (const item of catalog) {
    const normalizedType = normalizeCatalogProviderType(item.type);

    providers.push({
      id: item.id,
      name: item.name,
      type: normalizedType,
      apiHost: item.api_host,
      keywords: item.legacy_ids,
    });

    for (const legacyId of item.legacy_ids) {
      providers.push({
        id: legacyId,
        name: item.name,
        type: normalizedType,
        apiHost: item.api_host,
        keywords: [item.id, ...item.legacy_ids.filter((id) => id !== legacyId)],
      });
    }
  }

  return providers;
}

// ============================================================================
// 类型定义
// ============================================================================

export interface AddCustomProviderModalProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 添加成功回调，返回新创建的 Provider ID */
  onAdd: (request: AddCustomProviderRequest) => Promise<{ id: string }>;
  /** 添加 API Key 回调 */
  onAddApiKey?: (providerId: string, apiKey: string) => Promise<void>;
  /** 额外的 CSS 类名 */
  className?: string;
}

/** 表单状态 */
interface FormState {
  name: string;
  type: ProviderType;
  apiHost: string;
  apiKey: string;
  apiVersion: string;
  project: string;
  location: string;
  region: string;
}

/** 表单错误 */
interface FormErrors {
  name?: string;
  apiHost?: string;
  apiKey?: string;
  apiVersion?: string;
  project?: string;
  location?: string;
  region?: string;
}

/** 初始表单状态 */
const INITIAL_FORM_STATE: FormState = {
  name: "",
  type: "openai",
  apiHost: "",
  apiKey: "",
  apiVersion: "",
  project: "",
  location: "",
  region: "",
};

// ============================================================================
// 验证函数（导出用于测试）
// ============================================================================

/**
 * 验证自定义 Provider 表单
 * 用于属性测试验证 Requirements 6.2
 *
 * @param formState 表单状态
 * @returns 验证错误对象，如果没有错误则为空对象
 */
export function validateCustomProviderForm(formState: FormState): FormErrors {
  const errors: FormErrors = {};

  // 验证名称（必填）
  if (!formState.name.trim()) {
    errors.name = "Provider 名称不能为空";
  } else if (formState.name.trim().length > 50) {
    errors.name = "Provider 名称不能超过 50 个字符";
  }

  // 验证 API Host（必填）
  if (!formState.apiHost.trim()) {
    errors.apiHost = "API Host 不能为空";
  } else {
    // 验证 URL 格式
    try {
      new URL(formState.apiHost.trim());
    } catch {
      errors.apiHost = "请输入有效的 URL";
    }
  }

  // 验证 API Key（必填）
  if (!formState.apiKey.trim()) {
    errors.apiKey = "API Key 不能为空";
  }

  // 额外字段验证（可选字段，不强制验证格式）
  // Azure OpenAI 的 API Version、VertexAI 的 Project/Location、AWS Bedrock 的 Region
  // 都是可选字段，用户可以自由填写

  return errors;
}

/**
 * 检查表单是否有效
 */
export function isFormValid(formState: FormState): boolean {
  const errors = validateCustomProviderForm(formState);
  return Object.keys(errors).length === 0;
}

/**
 * 检查必填字段是否已填写
 */
export function hasRequiredFields(formState: FormState): boolean {
  return (
    formState.name.trim() !== "" &&
    formState.apiHost.trim() !== "" &&
    formState.apiKey.trim() !== ""
  );
}

// ============================================================================
// 组件实现
// ============================================================================

/**
 * 添加自定义 Provider 模态框组件
 *
 * 允许用户添加自定义 OpenAI 兼容 Provider，包含：
 * - Provider 名称（必填）
 * - API Key（必填）
 * - API Host（必填）
 * - Provider Type（默认 openai）
 * - 根据类型显示额外字段
 *
 * @example
 * ```tsx
 * <AddCustomProviderModal
 *   isOpen={showModal}
 *   onClose={() => setShowModal(false)}
 *   onAdd={handleAddProvider}
 * />
 * ```
 */
export const AddCustomProviderModal: React.FC<AddCustomProviderModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  onAddApiKey,
  className,
}) => {
  // 表单状态
  const [formState, setFormState] = useState<FormState>(INITIAL_FORM_STATE);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [catalogKnownProviders, setCatalogKnownProviders] = useState<
    KnownProvider[] | null
  >(null);

  // 厂商搜索状态
  const [providerSearch, setProviderSearch] = useState("");
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);
  const [selectedKnownProvider, setSelectedKnownProvider] =
    useState<KnownProvider | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 从 model_registry 获取额外的 Provider 信息
  const { groupedByProvider } = useModelRegistry({ autoLoad: true });

  // 优先从后端系统 Catalog 加载已知厂商
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;

    const loadSystemCatalog = async () => {
      try {
        const catalog = await apiKeyProviderApi.getSystemProviderCatalog();
        if (cancelled) {
          return;
        }

        const providers = buildKnownProvidersFromCatalog(catalog);
        setCatalogKnownProviders(
          providers.length > 0 ? providers : FALLBACK_KNOWN_PROVIDERS,
        );
      } catch {
        if (cancelled) {
          return;
        }
        setCatalogKnownProviders(FALLBACK_KNOWN_PROVIDERS);
      }
    };

    loadSystemCatalog();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // 合并已知厂商和 model_registry 中的厂商
  const allProviders = useMemo(() => {
    const baseProviders =
      catalogKnownProviders && catalogKnownProviders.length > 0
        ? catalogKnownProviders
        : FALLBACK_KNOWN_PROVIDERS;

    const providerMap = new Map<string, KnownProvider>();

    for (const provider of baseProviders) {
      if (!providerMap.has(provider.id)) {
        providerMap.set(provider.id, provider);
      }
    }

    // 从 model_registry 添加额外的厂商
    groupedByProvider.forEach((models, providerId) => {
      if (!providerMap.has(providerId) && models.length > 0) {
        const firstModel = models[0];
        providerMap.set(providerId, {
          id: providerId,
          name: firstModel.provider_name,
          type: "openai" as ProviderType, // 默认使用 OpenAI 兼容
        });
      }
    });

    return Array.from(providerMap.values());
  }, [catalogKnownProviders, groupedByProvider]);

  // 过滤厂商列表
  const filteredProviders = useMemo(() => {
    if (!providerSearch.trim()) {
      return allProviders;
    }
    const query = providerSearch.toLowerCase();
    return allProviders.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query) ||
        (p.keywords?.some((keyword) => keyword.toLowerCase().includes(query)) ??
          false),
    );
  }, [allProviders, providerSearch]);

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setShowProviderDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 选择已知厂商
  const handleSelectKnownProvider = useCallback((provider: KnownProvider) => {
    setSelectedKnownProvider(provider);
    setProviderSearch(provider.name);
    setShowProviderDropdown(false);

    // 自动填充表单
    setFormState((prev) => ({
      ...prev,
      name: provider.name,
      type: provider.type,
      apiHost: provider.apiHost || "",
    }));
  }, []);

  // 清除选中的厂商
  const handleClearKnownProvider = useCallback(() => {
    setSelectedKnownProvider(null);
    setProviderSearch("");
  }, []);

  // 获取当前类型需要的额外字段
  const extraFields = useMemo(
    () => PROVIDER_TYPE_FIELDS[formState.type] || [],
    [formState.type],
  );

  // 重置表单
  const resetForm = useCallback(() => {
    setFormState(INITIAL_FORM_STATE);
    setErrors({});
    setSubmitError(null);
    setProviderSearch("");
    setSelectedKnownProvider(null);
    setShowProviderDropdown(false);
  }, []);

  // 关闭模态框
  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  // 更新字段
  const updateField = useCallback(
    <K extends keyof FormState>(field: K, value: FormState[K]) => {
      setFormState((prev) => ({ ...prev, [field]: value }));
      // 清除该字段的错误
      if (errors[field as keyof FormErrors]) {
        setErrors((prev) => {
          const newErrors = { ...prev };
          delete newErrors[field as keyof FormErrors];
          return newErrors;
        });
      }
    },
    [errors],
  );

  // 提交表单
  const handleSubmit = useCallback(async () => {
    // 验证表单
    const validationErrors = validateCustomProviderForm(formState);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const request: AddCustomProviderRequest = {
        name: formState.name.trim(),
        type: formState.type,
        api_host: formState.apiHost.trim(),
      };

      // 添加额外字段
      if (formState.apiVersion.trim()) {
        request.api_version = formState.apiVersion.trim();
      }
      if (formState.project.trim()) {
        request.project = formState.project.trim();
      }
      if (formState.location.trim()) {
        request.location = formState.location.trim();
      }
      if (formState.region.trim()) {
        request.region = formState.region.trim();
      }

      // 1. 创建 Provider
      const result = await onAdd(request);

      // 2. 如果有 API Key，添加到新创建的 Provider
      if (formState.apiKey.trim() && onAddApiKey && result?.id) {
        try {
          await onAddApiKey(result.id, formState.apiKey.trim());
        } catch (apiKeyError) {
          // API Key 添加失败，但 Provider 已创建成功
          console.error("添加 API Key 失败:", apiKeyError);
          setSubmitError(
            `Provider 已创建，但 API Key 添加失败: ${apiKeyError instanceof Error ? apiKeyError.message : String(apiKeyError)}`,
          );
          // 不关闭模态框，让用户看到错误
          setIsSubmitting(false);
          return;
        }
      }

      handleClose();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "添加失败");
    } finally {
      setIsSubmitting(false);
    }
  }, [formState, onAdd, onAddApiKey, handleClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="max-w-md"
      className={className}
    >
      <ModalHeader>添加自定义 Provider</ModalHeader>

      <ModalBody className="space-y-4">
        {/* 搜索厂商（可选） */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">
            快速选择厂商{" "}
            <span className="text-muted-foreground text-xs">(可选)</span>
          </Label>
          <div className="relative">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                type="text"
                value={providerSearch}
                onChange={(e) => {
                  setProviderSearch(e.target.value);
                  setShowProviderDropdown(true);
                  if (selectedKnownProvider) {
                    setSelectedKnownProvider(null);
                  }
                }}
                onFocus={() => setShowProviderDropdown(true)}
                placeholder="搜索厂商名称..."
                disabled={isSubmitting}
                className="pl-10 pr-8"
                data-testid="provider-search-input"
              />
              {(providerSearch || selectedKnownProvider) && (
                <button
                  type="button"
                  onClick={handleClearKnownProvider}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* 下拉列表 */}
            {showProviderDropdown && filteredProviders.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute left-0 right-0 top-full z-[9999] mt-1 max-h-48 overflow-y-auto rounded-md border bg-background shadow-lg"
                data-testid="provider-dropdown"
              >
                {filteredProviders.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => handleSelectKnownProvider(provider)}
                    className={cn(
                      "w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors",
                      selectedKnownProvider?.id === provider.id && "bg-muted",
                    )}
                  >
                    <div className="font-medium">{provider.name}</div>
                    {provider.apiHost && (
                      <div className="text-xs text-muted-foreground truncate">
                        {provider.apiHost}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            选择已知厂商可自动填充配置，或直接手动填写下方表单
          </p>
        </div>

        <div className="border-t border-border" />

        {/* Provider 名称 */}
        <div className="space-y-1.5">
          <Label htmlFor="provider-name" className="text-sm font-medium">
            Provider 名称 <span className="text-red-500">*</span>
          </Label>
          <Input
            id="provider-name"
            type="text"
            value={formState.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="例如：My Custom API"
            disabled={isSubmitting}
            className={cn(errors.name && "border-red-500")}
            data-testid="provider-name-input"
          />
          {errors.name && (
            <p className="text-xs text-red-500" data-testid="name-error">
              {errors.name}
            </p>
          )}
        </div>

        {/* Provider 类型 */}
        <div className="space-y-1.5">
          <Label htmlFor="provider-type" className="text-sm font-medium">
            Provider 类型
          </Label>
          <Select
            value={formState.type}
            onValueChange={(value) =>
              updateField("type", value as ProviderType)
            }
            disabled={isSubmitting}
          >
            <SelectTrigger id="provider-type" data-testid="provider-type-select">
              <span>{getProviderTypeLabel(formState.type)}</span>
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
            大多数第三方 API 服务使用 OpenAI 兼容格式
          </p>
        </div>

        {/* API Host */}
        <div className="space-y-1.5">
          <Label htmlFor="api-host" className="text-sm font-medium">
            API Host <span className="text-red-500">*</span>
          </Label>
          <Input
            id="api-host"
            type="text"
            value={formState.apiHost}
            onChange={(e) => updateField("apiHost", e.target.value)}
            placeholder="https://api.example.com"
            disabled={isSubmitting}
            className={cn(errors.apiHost && "border-red-500")}
            data-testid="api-host-input"
          />
          {errors.apiHost && (
            <p className="text-xs text-red-500" data-testid="api-host-error">
              {errors.apiHost}
            </p>
          )}
        </div>

        {/* API Key */}
        <div className="space-y-1.5">
          <Label htmlFor="api-key" className="text-sm font-medium">
            API Key <span className="text-red-500">*</span>
          </Label>
          <Input
            id="api-key"
            type="password"
            value={formState.apiKey}
            onChange={(e) => updateField("apiKey", e.target.value)}
            placeholder="sk-..."
            disabled={isSubmitting}
            className={cn(errors.apiKey && "border-red-500")}
            data-testid="api-key-input"
          />
          {errors.apiKey && (
            <p className="text-xs text-red-500" data-testid="api-key-error">
              {errors.apiKey}
            </p>
          )}
        </div>

        {/* Azure OpenAI: API Version */}
        {extraFields.includes("apiVersion") && (
          <div className="space-y-1.5">
            <Label htmlFor="api-version" className="text-sm font-medium">
              API Version
            </Label>
            <Input
              id="api-version"
              type="text"
              value={formState.apiVersion}
              onChange={(e) => updateField("apiVersion", e.target.value)}
              placeholder="2024-02-15-preview"
              disabled={isSubmitting}
              className={cn(errors.apiVersion && "border-red-500")}
              data-testid="api-version-input"
            />
            {errors.apiVersion && (
              <p
                className="text-xs text-red-500"
                data-testid="api-version-error"
              >
                {errors.apiVersion}
              </p>
            )}
          </div>
        )}

        {/* VertexAI: Project */}
        {extraFields.includes("project") && (
          <div className="space-y-1.5">
            <Label htmlFor="project" className="text-sm font-medium">
              Project ID
            </Label>
            <Input
              id="project"
              type="text"
              value={formState.project}
              onChange={(e) => updateField("project", e.target.value)}
              placeholder="your-project-id"
              disabled={isSubmitting}
              data-testid="project-input"
            />
          </div>
        )}

        {/* VertexAI: Location */}
        {extraFields.includes("location") && (
          <div className="space-y-1.5">
            <Label htmlFor="location" className="text-sm font-medium">
              Location
            </Label>
            <Input
              id="location"
              type="text"
              value={formState.location}
              onChange={(e) => updateField("location", e.target.value)}
              placeholder="us-central1"
              disabled={isSubmitting}
              data-testid="location-input"
            />
          </div>
        )}

        {/* AWS Bedrock: Region */}
        {extraFields.includes("region") && (
          <div className="space-y-1.5">
            <Label htmlFor="region" className="text-sm font-medium">
              Region
            </Label>
            <Input
              id="region"
              type="text"
              value={formState.region}
              onChange={(e) => updateField("region", e.target.value)}
              placeholder="us-east-1"
              disabled={isSubmitting}
              data-testid="region-input"
            />
          </div>
        )}

        {/* 提交错误 */}
        {submitError && (
          <div
            className="p-3 rounded-lg bg-red-50 text-red-600 text-sm"
            data-testid="submit-error"
          >
            {submitError}
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button
          variant="outline"
          onClick={handleClose}
          disabled={isSubmitting}
          data-testid="cancel-button"
        >
          取消
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || !hasRequiredFields(formState)}
          data-testid="submit-button"
        >
          {isSubmitting ? "添加中..." : "添加"}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default AddCustomProviderModal;
