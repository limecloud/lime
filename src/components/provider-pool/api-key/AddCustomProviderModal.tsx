/**
 * @file AddCustomProviderModal 组件
 * @description 添加自定义 Provider 的模态框组件
 * @module components/provider-pool/api-key/AddCustomProviderModal
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 6.1, 6.2**
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Globe,
  KeyRound,
  Layers3,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useModelRegistry } from "@/hooks/useModelRegistry";
import type { ProviderType } from "@/lib/types/provider";
import {
  apiKeyProviderApi,
  type AddCustomProviderRequest,
  type SystemProviderCatalogItem,
} from "@/lib/api/apiKeyProvider";
import {
  getProviderTypeLabel,
  getSpecialProtocolHint,
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

function dedupeKeywords(
  keywords: Array<string | undefined>,
): string[] | undefined {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const keyword of keywords) {
    const normalized = keyword?.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result.length > 0 ? result : undefined;
}

function normalizeKnownProvider(provider: KnownProvider): KnownProvider {
  return {
    ...provider,
    keywords: dedupeKeywords([provider.id, ...(provider.keywords ?? [])]),
  };
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
    apiHost: "https://open.bigmodel.cn/api/paas/v4/",
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

const SPECIAL_PROTOCOL_PROVIDER_SEEDS = [
  {
    id: "codex-cli",
    name: "Codex CLI",
    type: "codex",
    apiHost: "https://api.openai.com",
    keywords: ["codex", "openai", "codex-cli"],
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    type: "gemini",
    apiHost: "https://cloudcode-pa.googleapis.com",
    keywords: ["gemini", "google", "gemini-cli", "cloud code assist"],
  },
  {
    id: "claude-code",
    name: "Claude",
    type: "anthropic",
    apiHost: "https://api.anthropic.com",
    keywords: ["claude", "anthropic", "claude-code", "claude code"],
  },
] satisfies KnownProvider[];

const SPECIAL_PROTOCOL_KNOWN_PROVIDERS: KnownProvider[] =
  SPECIAL_PROTOCOL_PROVIDER_SEEDS.map(normalizeKnownProvider);

/** 将 Catalog 返回的 provider type 收敛到前端 ProviderType */
function normalizeCatalogProviderType(providerType: string): ProviderType {
  return isSupportedProviderType(providerType) ? providerType : "openai";
}

function buildKnownProvidersFromCatalog(
  catalog: SystemProviderCatalogItem[],
): KnownProvider[] {
  return catalog.map((item) =>
    normalizeKnownProvider({
      id: item.id,
      name: item.name,
      type: normalizeCatalogProviderType(item.type),
      apiHost: item.api_host,
      keywords: [item.id, item.type, ...item.legacy_ids],
    }),
  );
}

function mergeKnownProviders(...groups: KnownProvider[][]): KnownProvider[] {
  const providerMap = new Map<string, KnownProvider>();

  for (const group of groups) {
    for (const provider of group) {
      const normalized = normalizeKnownProvider(provider);
      const existing = providerMap.get(normalized.id);

      if (!existing) {
        providerMap.set(normalized.id, normalized);
        continue;
      }

      providerMap.set(normalized.id, {
        ...normalized,
        keywords: dedupeKeywords([
          ...(existing.keywords ?? []),
          ...(normalized.keywords ?? []),
        ]),
      });
    }
  }

  return Array.from(providerMap.values());
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
  const [selectedKnownProvider, setSelectedKnownProvider] =
    useState<KnownProvider | null>(null);

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
        : FALLBACK_KNOWN_PROVIDERS.map(normalizeKnownProvider);

    const registryProviders: KnownProvider[] = [];

    // 从 model_registry 添加额外的厂商
    groupedByProvider.forEach((models, providerId) => {
      if (models.length > 0) {
        const firstModel = models[0];
        registryProviders.push(
          normalizeKnownProvider({
            id: providerId,
            name: firstModel.provider_name,
            type: "openai" as ProviderType, // 默认使用 OpenAI 兼容
            keywords: [firstModel.provider_name],
          }),
        );
      }
    });

    return mergeKnownProviders(
      SPECIAL_PROTOCOL_KNOWN_PROVIDERS,
      baseProviders,
      registryProviders,
    );
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

  // 选择已知厂商
  const handleSelectKnownProvider = useCallback((provider: KnownProvider) => {
    setSelectedKnownProvider(provider);
    setProviderSearch(provider.name);

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

  const typeOption = useMemo(
    () => PROVIDER_TYPE_OPTIONS.find((item) => item.value === formState.type),
    [formState.type],
  );

  const specialProtocolHint = useMemo(
    () => getSpecialProtocolHint(formState.type),
    [formState.type],
  );

  const visibleProviders = useMemo(
    () => filteredProviders.slice(0, 18),
    [filteredProviders],
  );

  const summaryCards = [
    {
      icon: Globe,
      title: "接入地址",
      value: formState.apiHost || "待填写",
      hint: selectedKnownProvider?.apiHost
        ? "已根据模板预填"
        : "支持自定义 Base URL",
    },
    {
      icon: Layers3,
      title: "协议类型",
      value: getProviderTypeLabel(formState.type),
      hint: specialProtocolHint ? "包含专属协议兼容" : "普通兼容协议",
    },
    {
      icon: KeyRound,
      title: "鉴权状态",
      value: formState.apiKey.trim() ? "已填写" : "待填写",
      hint: "保存后会立即创建首个 API Key",
    },
  ];

  const extraFieldConfigs = extraFields.map((field) => {
    switch (field) {
      case "apiVersion":
        return {
          id: "api-version",
          field,
          label: "API Version",
          placeholder: "2024-02-15-preview",
          value: formState.apiVersion,
          testId: "api-version-input",
        };
      case "project":
        return {
          id: "project",
          field,
          label: "Project ID",
          placeholder: "your-project-id",
          value: formState.project,
          testId: "project-input",
        };
      case "location":
        return {
          id: "location",
          field,
          label: "Location",
          placeholder: "us-central1",
          value: formState.location,
          testId: "location-input",
        };
      case "region":
        return {
          id: "region",
          field,
          label: "Region",
          placeholder: "us-east-1",
          value: formState.region,
          testId: "region-input",
        };
      default:
        return null;
    }
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="max-w-6xl"
      className={cn("border border-slate-200/80 bg-white", className)}
    >
      <ModalHeader>新增服务商</ModalHeader>

      <ModalBody className="p-0">
        <div className="grid min-h-[680px] gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="border-b border-slate-200/80 bg-slate-50/80 lg:border-b-0 lg:border-r">
            <div className="space-y-5 p-5">
              <div className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      选择模板
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      先选厂商模板，再补充鉴权与协议细节。没有模板也可以完全手动创建。
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="border-slate-200 bg-slate-50 text-slate-600"
                  >
                    DeepChat 风格
                  </Badge>
                </div>

                <div className="relative mt-4">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="text"
                    value={providerSearch}
                    onChange={(e) => {
                      setProviderSearch(e.target.value);
                      if (
                        selectedKnownProvider &&
                        e.target.value !== selectedKnownProvider.name
                      ) {
                        setSelectedKnownProvider(null);
                      }
                    }}
                    placeholder="搜索厂商、别名或协议"
                    disabled={isSubmitting}
                    className="border-slate-200 bg-white pl-10 pr-9"
                    data-testid="provider-search-input"
                  />
                  {(providerSearch || selectedKnownProvider) && (
                    <button
                      type="button"
                      onClick={handleClearKnownProvider}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700"
                      aria-label="清空模板选择"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2" data-testid="provider-template-list">
                {visibleProviders.length > 0 ? (
                  visibleProviders.map((provider) => {
                    const isActive = selectedKnownProvider?.id === provider.id;
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => handleSelectKnownProvider(provider)}
                        className={cn(
                          "w-full rounded-[20px] border px-4 py-3 text-left transition-all",
                          isActive
                            ? "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-950/10"
                            : "border-slate-200/80 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-100/80",
                        )}
                        data-testid={`known-provider-item-${provider.id}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {provider.name}
                            </p>
                            <p
                              className={cn(
                                "mt-1 truncate text-xs",
                                isActive ? "text-slate-200" : "text-slate-500",
                              )}
                            >
                              {provider.apiHost || "手动填写 API Host"}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              "shrink-0 border-current/20 px-2 py-0.5 text-[11px]",
                              isActive
                                ? "bg-white/10 text-white"
                                : "bg-slate-50 text-slate-600",
                            )}
                          >
                            {getProviderTypeLabel(provider.type)}
                          </Badge>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-[20px] border border-dashed border-slate-200 bg-white px-4 py-8 text-center">
                    <p className="text-sm font-medium text-slate-900">
                      没有匹配的模板
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      继续在右侧手动填写，也可以换个关键词再搜。
                    </p>
                  </div>
                )}
              </div>
            </div>
          </aside>

          <div className="bg-white">
            <div className="space-y-6 p-5 lg:p-6">
              <section
                className="rounded-[28px] border border-slate-200/80 bg-slate-950 px-5 py-5 text-white shadow-lg shadow-slate-950/10"
                data-testid="selected-provider-card"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-sky-300" />
                      <p className="text-sm font-medium text-sky-100">
                        当前接入方案
                      </p>
                    </div>
                    <h3 className="text-2xl font-semibold tracking-tight">
                      {formState.name ||
                        selectedKnownProvider?.name ||
                        "手动创建新 Provider"}
                    </h3>
                    <p className="max-w-3xl text-sm leading-6 text-slate-300">
                      {selectedKnownProvider
                        ? "已按模板预填协议类型与接口地址，你只需要确认鉴权和附加参数。"
                        : "适合接入未内置的厂商、私有部署网关，或需要兼容 OpenAI / Anthropic / Gemini 协议的第三方服务。"}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge className="border border-white/10 bg-white/10 text-white hover:bg-white/10">
                      {typeOption?.label ??
                        getProviderTypeLabel(formState.type)}
                    </Badge>
                    {selectedKnownProvider ? (
                      <Badge className="border border-emerald-300/20 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/10">
                        已套用模板
                      </Badge>
                    ) : (
                      <Badge className="border border-amber-300/20 bg-amber-400/10 text-amber-100 hover:bg-amber-400/10">
                        手动配置
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {summaryCards.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.title}
                        className="rounded-[20px] border border-white/10 bg-white/5 p-4"
                      >
                        <div className="flex items-center gap-2 text-xs text-slate-300">
                          <Icon className="h-3.5 w-3.5" />
                          <span>{item.title}</span>
                        </div>
                        <p className="mt-3 break-all text-sm font-semibold text-white">
                          {item.value}
                        </p>
                        <p className="mt-2 text-xs leading-5 text-slate-300">
                          {item.hint}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
                <div className="mb-4">
                  <div className="flex items-center gap-2 text-slate-900">
                    <Globe className="h-4 w-4" />
                    <h3 className="text-base font-semibold">基础接入信息</h3>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    这里决定 Provider 的名称、接口地址和首个 API
                    Key，是最关键的一步。
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="provider-name"
                      className="text-sm font-medium"
                    >
                      Provider 名称 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="provider-name"
                      type="text"
                      value={formState.name}
                      onChange={(e) => updateField("name", e.target.value)}
                      placeholder="例如：My Custom API"
                      disabled={isSubmitting}
                      className={cn(
                        "border-slate-200 bg-white",
                        errors.name && "border-red-500",
                      )}
                      data-testid="provider-name-input"
                    />
                    {errors.name ? (
                      <p
                        className="text-xs text-red-500"
                        data-testid="name-error"
                      >
                        {errors.name}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500">
                        建议用厂商或网关名称，便于后续在左侧列表快速识别。
                      </p>
                    )}
                  </div>

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
                      className={cn(
                        "border-slate-200 bg-white",
                        errors.apiHost && "border-red-500",
                      )}
                      data-testid="api-host-input"
                    />
                    {errors.apiHost ? (
                      <p
                        className="text-xs text-red-500"
                        data-testid="api-host-error"
                      >
                        {errors.apiHost}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500">
                        可以填写官方接口、代理网关或企业内部统一中转地址。
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-1.5">
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
                    className={cn(
                      "border-slate-200 bg-white",
                      errors.apiKey && "border-red-500",
                    )}
                    data-testid="api-key-input"
                  />
                  {errors.apiKey ? (
                    <p
                      className="text-xs text-red-500"
                      data-testid="api-key-error"
                    >
                      {errors.apiKey}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      保存后会自动为新 Provider
                      创建第一把密钥，后续可在详情页继续追加多把 Key。
                    </p>
                  )}
                </div>
              </section>

              <section className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-5">
                <div className="mb-4">
                  <div className="flex items-center gap-2 text-slate-900">
                    <SlidersHorizontal className="h-4 w-4" />
                    <h3 className="text-base font-semibold">协议与附加参数</h3>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    普通第三方 Provider 推荐保持与 DeepChat
                    一致的兼容协议；Codex、Gemini、Anthropic 继续保留 Lime
                    的专属兼容语义。
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="provider-type"
                      className="text-sm font-medium"
                    >
                      Provider 类型
                    </Label>
                    <Select
                      value={formState.type}
                      onValueChange={(value) =>
                        updateField("type", value as ProviderType)
                      }
                      disabled={isSubmitting}
                    >
                      <SelectTrigger
                        id="provider-type"
                        className="border-slate-200 bg-white"
                        data-testid="provider-type-select"
                      >
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
                    <p className="text-xs text-slate-500">
                      大多数第三方服务使用 OpenAI
                      兼容格式；只有特例协议才需要切换。
                    </p>
                  </div>

                  <div className="rounded-[20px] border border-slate-200/80 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      接入提示
                    </p>
                    <p className="mt-2 text-xs leading-6 text-slate-500">
                      若你接入的是 OEM
                      或商业化统一网关，优先保持外部配置简单，把品牌、套餐和模型目录放在独立云端控制面管理。
                    </p>
                  </div>
                </div>

                {specialProtocolHint ? (
                  <div
                    className="mt-4 rounded-[20px] border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900"
                    data-testid="protocol-special-hint"
                  >
                    <p className="font-semibold">协议特例保留</p>
                    <p className="mt-1 leading-6">{specialProtocolHint}</p>
                  </div>
                ) : null}

                {extraFieldConfigs.some(Boolean) ? (
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    {extraFieldConfigs.map((config) => {
                      if (!config) {
                        return null;
                      }

                      return (
                        <div key={config.field} className="space-y-1.5">
                          <Label
                            htmlFor={config.id}
                            className="text-sm font-medium"
                          >
                            {config.label}
                          </Label>
                          <Input
                            id={config.id}
                            type="text"
                            value={config.value}
                            onChange={(e) =>
                              updateField(config.field, e.target.value)
                            }
                            placeholder={config.placeholder}
                            disabled={isSubmitting}
                            className="border-slate-200 bg-white"
                            data-testid={config.testId}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>

              {submitError && (
                <div
                  className="rounded-[20px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  data-testid="submit-error"
                >
                  {submitError}
                </div>
              )}
            </div>
          </div>
        </div>
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
