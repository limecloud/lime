/**
 * @file ModelAddPanel 组件
 * @description 模型添加流程，负责服务商分类筛选与最小配置表单。
 * @module components/api-key-provider/ModelAddPanel
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProviderIcon } from "@/icons/providers";
import { cn } from "@/lib/utils";
import {
  apiKeyProviderApi,
  type AddCustomProviderRequest,
  type ProviderDisplay,
  type ProviderWithKeysDisplay,
  type SystemProviderCatalogItem,
  type UpdateProviderRequest,
} from "@/lib/api/apiKeyProvider";
import type {
  ProviderDeclaredPromptCacheMode,
  ProviderType,
} from "@/lib/types/provider";
import { useModelRegistry } from "@/hooks/useModelRegistry";
import {
  dedupeModelIds,
  getProviderTypeLabel,
  isSupportedProviderType,
  resolvePromptCacheModeRequestValue,
} from "./providerConfigUtils";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Eye,
  Globe2,
  Plus,
  ServerCog,
  SlidersHorizontal,
  Zap,
} from "lucide-react";

export type ModelAddView = "catalog" | "configure";
export type ModelCatalogCategory =
  | "recommended"
  | "cn"
  | "aggregator"
  | "overseas"
  | "local";
type ProviderRegion = "cn" | "global";
type ProviderBillingMode = "payg" | "coding_plan" | "subscription";

interface ProviderTemplate {
  id: string;
  name: string;
  description: string;
  category: ModelCatalogCategory;
  type: ProviderType;
  apiHost: string;
  recommended?: boolean;
  apiKeyUrl?: string;
  defaultModels: string[];
  iconProviderId?: string;
  systemProviderId?: string;
  providerResourceId?: string;
  isCustom?: boolean;
  region?: ProviderRegion;
  billingMode?: ProviderBillingMode;
}

interface FormState {
  name: string;
  type: ProviderType;
  promptCacheMode: ProviderDeclaredPromptCacheMode;
  apiHost: string;
  apiKey: string;
  models: string[];
}

interface ModelAddPanelProps {
  providers: ProviderWithKeysDisplay[];
  onAddProvider: (request: AddCustomProviderRequest) => Promise<ProviderDisplay>;
  onUpdateProvider: (id: string, request: UpdateProviderRequest) => Promise<ProviderDisplay>;
  onAddApiKey: (providerId: string, apiKey: string, alias?: string) => Promise<unknown>;
  onActivated: (providerId: string) => void;
  onCancel: () => void;
  className?: string;
}

const CATEGORY_OPTIONS: Array<{ value: ModelCatalogCategory; label: string }> = [
  { value: "recommended", label: "推荐服务" },
  { value: "cn", label: "国内服务" },
  { value: "aggregator", label: "聚合平台" },
  { value: "overseas", label: "海外平台" },
  { value: "local", label: "本地模型" },
];

const FEATURED_TEMPLATES: ProviderTemplate[] = [
  {
    id: "kimi-code-subscription",
    name: "Kimi Code 会员（订阅）",
    description: "Kimi Code 官方订阅入口，Anthropic 协议，适合 Claude Code / OpenClaw",
    category: "overseas",
    type: "anthropic-compatible",
    apiHost: "https://api.kimi.com/coding/",
    recommended: true,
    apiKeyUrl: "https://www.kimi.com/code",
    defaultModels: ["k2p5"],
    iconProviderId: "moonshotai",
    providerResourceId: "kimi-for-coding",
    region: "global",
    billingMode: "subscription",
  },
  {
    id: "kimi-api-cn",
    name: "Kimi API（国内按量）",
    description: "Moonshot 中国区 Anthropic 协议 API，适合按量接入 Kimi 模型",
    category: "cn",
    type: "anthropic-compatible",
    apiHost: "https://api.moonshot.cn/anthropic",
    recommended: true,
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    defaultModels: ["kimi-k2.5"],
    iconProviderId: "moonshotai",
    providerResourceId: "moonshotai-cn",
    region: "cn",
    billingMode: "payg",
  },
  {
    id: "kimi-api-global",
    name: "Kimi API（海外按量）",
    description: "Moonshot 国际区 Anthropic 协议 API，适合海外账号按量接入",
    category: "overseas",
    type: "anthropic-compatible",
    apiHost: "https://api.moonshot.ai/anthropic",
    recommended: true,
    apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
    defaultModels: ["kimi-k2.5"],
    iconProviderId: "moonshotai",
    providerResourceId: "moonshotai",
    region: "global",
    billingMode: "payg",
  },
  {
    id: "minimax-coding-plan",
    name: "MiniMax Coding Plan（国内）",
    description: "MiniMax 中国区 Anthropic 协议编码套餐，默认使用 MiniMax-M2.7",
    category: "cn",
    type: "anthropic-compatible",
    apiHost: "https://api.minimaxi.com/anthropic",
    recommended: true,
    apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    defaultModels: ["MiniMax-M2.7"],
    iconProviderId: "minimax-cn",
    providerResourceId: "minimax-cn",
    region: "cn",
    billingMode: "coding_plan",
  },
  {
    id: "minimax-coding-plan-global",
    name: "MiniMax Coding Plan（海外）",
    description: "MiniMax 国际区 Anthropic 协议编码套餐，使用海外订阅入口",
    category: "overseas",
    type: "anthropic-compatible",
    apiHost: "https://api.minimax.io/anthropic",
    recommended: true,
    apiKeyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
    defaultModels: ["MiniMax-M2.7"],
    iconProviderId: "minimax",
    providerResourceId: "minimax",
    region: "global",
    billingMode: "coding_plan",
  },
  {
    id: "glm-cn-coding-plan",
    name: "GLM Coding Plan（国内）",
    description: "智谱 BigModel 中国区 Anthropic/Claude API 兼容编码入口",
    category: "cn",
    type: "anthropic-compatible",
    apiHost: "https://open.bigmodel.cn/api/anthropic",
    recommended: true,
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    defaultModels: ["glm-4.7"],
    iconProviderId: "zhipuai",
    providerResourceId: "zhipuai-coding-plan",
    region: "cn",
    billingMode: "coding_plan",
  },
  {
    id: "zai-coding-plan",
    name: "Z.AI Coding Plan（海外）",
    description: "Z.AI 国际区 Anthropic/Claude API 兼容编码入口",
    category: "overseas",
    type: "anthropic-compatible",
    apiHost: "https://api.z.ai/api/anthropic",
    recommended: true,
    apiKeyUrl: "https://z.ai/manage-apikey/apikey-list",
    defaultModels: ["glm-4.7"],
    iconProviderId: "zai",
    providerResourceId: "zai-coding-plan",
    region: "global",
    billingMode: "coding_plan",
  },
  {
    id: "mimo-coding-plan",
    name: "MiMo Coding Plan",
    description: "小米 MiMo Token Plan，兼容 Claude Code 的 Anthropic 协议",
    category: "cn",
    type: "anthropic-compatible",
    apiHost: "https://token-plan-cn.xiaomimimo.com/anthropic",
    recommended: true,
    apiKeyUrl: "https://mimo.mi.com/",
    defaultModels: ["mimo-v2.5-pro"],
    iconProviderId: "xiaomi",
    providerResourceId: "xiaomi",
    region: "cn",
    billingMode: "subscription",
  },
  {
    id: "alibaba-coding-plan-cn",
    name: "Alibaba Coding Plan（国内）",
    description: "阿里云百炼中国区 Claude Code Coding Plan 专用 Anthropic 入口",
    category: "cn",
    type: "anthropic-compatible",
    apiHost: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    recommended: true,
    apiKeyUrl: "https://bailian.console.aliyun.com/",
    defaultModels: ["qwen3-coder-plus"],
    iconProviderId: "alibaba-cn",
    providerResourceId: "alibaba-cn",
    region: "cn",
    billingMode: "coding_plan",
  },
  {
    id: "alibaba-coding-plan-global",
    name: "Alibaba Coding Plan（海外）",
    description: "阿里云 Model Studio 国际区 Claude Code Coding Plan 专用 Anthropic 入口",
    category: "overseas",
    type: "anthropic-compatible",
    apiHost: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic",
    recommended: true,
    apiKeyUrl: "https://modelstudio.console.alibabacloud.com/",
    defaultModels: ["qwen3-coder-plus"],
    iconProviderId: "alibaba",
    providerResourceId: "alibaba",
    region: "global",
    billingMode: "coding_plan",
  },
  {
    id: "aihubmix-recommended",
    name: "AiHubMix",
    description: "聚合 Claude、OpenAI、Gemini 的常用中转服务",
    category: "aggregator",
    type: "openai",
    apiHost: "https://aihubmix.com",
    recommended: true,
    defaultModels: ["claude-sonnet-4-5"],
    iconProviderId: "aihubmix",
    systemProviderId: "aihubmix",
  },
  {
    id: "openrouter-recommended",
    name: "OpenRouter",
    description: "海外模型聚合平台，可按模型 ID 灵活接入",
    category: "overseas",
    type: "openai",
    apiHost: "https://openrouter.ai/api/v1/",
    recommended: true,
    apiKeyUrl: "https://openrouter.ai/keys",
    defaultModels: ["anthropic/claude-sonnet-4.5"],
    iconProviderId: "openrouter",
    systemProviderId: "openrouter",
  },
];

const CUSTOM_TEMPLATE: ProviderTemplate = {
  id: "custom-provider",
  name: "自定义供应商",
  description: "配置自定义 API 兼容的供应商",
  category: "recommended",
  type: "openai",
  apiHost: "",
  defaultModels: [],
  isCustom: true,
};

const CN_PROVIDER_IDS = new Set([
  "alibaba-cn",
  "bailing",
  "baidu-cloud",
  "deepseek",
  "doubao",
  "giteeai",
  "hunyuan",
  "iflowcn",
  "infini",
  "internlm",
  "kimi-for-coding",
  "minimax-cn",
  "modelscope",
  "moonshotai-cn",
  "sensenova",
  "spark",
  "stepfun",
  "taichu",
  "tencent-cloud-ti",
  "tencentcloud",
  "xiaomi",
  "xirang",
  "yi",
  "zhipuai",
  "zhipuai-coding-plan",
  "zhinao",
  "ai360",
]);

const AGGREGATOR_PROVIDER_IDS = new Set([
  "302ai",
  "abacus",
  "aihubmix",
  "baseten",
  "chutes",
  "cloudflare-ai-gateway",
  "cloudflare-workers-ai",
  "deepinfra",
  "fastrouter",
  "fireworks-ai",
  "helicone",
  "huggingface",
  "inference",
  "io-net",
  "lucidquery",
  "nano-gpt",
  "nebius",
  "novita",
  "openrouter",
  "poe",
  "requesty",
  "siliconflow",
  "siliconflow-cn",
  "submodel",
  "synthetic",
  "togetherai",
  "upstage",
  "v0",
  "venice",
  "vercel",
  "vultr",
  "zenmux",
]);

const LOCAL_PROVIDER_IDS = new Set([
  "llama",
  "lmstudio",
  "ollama",
  "ollama-cloud",
  "opencode",
]);

const RESOURCE_PROVIDER_API_HOSTS: Record<string, string> = {
  aihubmix: "https://aihubmix.com",
  alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/",
  "alibaba-cn": "https://dashscope.aliyuncs.com/compatible-mode/v1/",
  anthropic: "https://api.anthropic.com",
  deepseek: "https://api.deepseek.com",
  "kimi-for-coding": "https://api.kimi.com/coding/",
  lmstudio: "http://localhost:1234",
  minimax: "https://api.minimax.io/anthropic",
  "minimax-cn": "https://api.minimaxi.com/anthropic",
  moonshotai: "https://api.moonshot.ai",
  "moonshotai-cn": "https://api.moonshot.cn",
  openai: "https://api.openai.com",
  openrouter: "https://openrouter.ai/api/v1/",
  siliconflow: "https://api.siliconflow.cn",
  "siliconflow-cn": "https://api.siliconflow.cn",
  xiaomi: "https://token-plan-cn.xiaomimimo.com/anthropic",
  "zai-coding-plan": "https://api.z.ai/api/anthropic",
  "zhipuai-coding-plan": "https://open.bigmodel.cn/api/anthropic",
};

const ANTHROPIC_COMPATIBLE_REGISTRY_PROVIDER_IDS = new Set([
  "kimi-for-coding",
  "minimax",
  "minimax-cn",
  "xiaomi",
  "zai-coding-plan",
  "zhipuai-coding-plan",
]);

function normalizeCatalogProviderType(providerType: string): ProviderType {
  return isSupportedProviderType(providerType) ? providerType : "openai";
}

function resolveProviderCategory(
  providerId: string,
  group?: string,
): ModelCatalogCategory {
  if (CN_PROVIDER_IDS.has(providerId)) {
    return "cn";
  }
  if (AGGREGATOR_PROVIDER_IDS.has(providerId)) {
    return "aggregator";
  }
  if (LOCAL_PROVIDER_IDS.has(providerId)) {
    return "local";
  }

  switch (group) {
    case "chinese":
      return "cn";
    case "aggregator":
      return "aggregator";
    case "local":
      return "local";
    default:
      return "overseas";
  }
}

function buildCatalogTemplates(catalog: SystemProviderCatalogItem[]): ProviderTemplate[] {
  return catalog.map((item) => {
    const providerType = normalizeCatalogProviderType(item.type);
    return {
      id: `catalog-${item.id}`,
      name: item.name,
      description: `${getProviderTypeLabel(providerType)} · ${item.api_host || "按本地配置填写地址"}`,
      category: resolveProviderCategory(item.id, item.group),
      type: providerType,
      apiHost: item.api_host,
      defaultModels: [],
      iconProviderId: item.id,
      systemProviderId: item.id,
    };
  });
}

function buildRegistryTemplates(
  groupedByProvider: Map<string, Array<{ id: string; provider_name: string }>>,
  catalogTemplates: ProviderTemplate[],
): ProviderTemplate[] {
  const catalogIds = new Set(
    catalogTemplates
      .map((template) => template.systemProviderId)
      .filter((id): id is string => Boolean(id)),
  );

  const templates: ProviderTemplate[] = [];

  groupedByProvider.forEach((models, providerId) => {
    if (catalogIds.has(providerId) || models.length === 0) {
      return;
    }

    const firstModel = models[0];
    const apiHost = RESOURCE_PROVIDER_API_HOSTS[providerId] ?? "";
    templates.push({
      id: `registry-${providerId}`,
      name: firstModel.provider_name || providerId,
      description: apiHost
        ? `模型目录 · ${apiHost}`
        : "模型目录供应商，按服务文档补充 API Base URL",
      category: resolveProviderCategory(providerId),
      type: ANTHROPIC_COMPATIBLE_REGISTRY_PROVIDER_IDS.has(providerId)
        ? "anthropic-compatible"
        : "openai",
      apiHost,
      defaultModels: [],
      iconProviderId: providerId,
      providerResourceId: providerId,
    });
  });

  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

function dedupeTemplates(templates: ProviderTemplate[]): ProviderTemplate[] {
  const seen = new Set<string>();
  const result: ProviderTemplate[] = [];

  for (const template of templates) {
    const key = template.providerResourceId
      ? `provider:${template.providerResourceId}:${template.apiHost}`
      : template.systemProviderId ?? template.id;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(template);
  }

  return result;
}

function createInitialFormState(template: ProviderTemplate): FormState {
  return {
    name: template.isCustom ? "" : template.name,
    type: template.type,
    promptCacheMode: "explicit_only",
    apiHost: template.apiHost,
    apiKey: "",
    models: template.defaultModels,
  };
}

function isApiKeyRequired(type: ProviderType): boolean {
  return type !== "ollama";
}

function validateForm(state: FormState): string | null {
  if (!state.name.trim()) {
    return "请填写供应商名称。";
  }
  if (!state.apiHost.trim()) {
    return "请填写 API Base URL。";
  }
  try {
    new URL(state.apiHost.trim());
  } catch {
    return "请输入有效的 API Base URL。";
  }
  if (isApiKeyRequired(state.type) && !state.apiKey.trim()) {
    return "请填写 API 密钥。";
  }
  if (state.models.length === 0) {
    return "请手动添加至少一个模型；保存后也可以在配置页从接口获取模型。";
  }
  return null;
}

function renderTemplateIcon(template: ProviderTemplate) {
  if (template.isCustom) {
    return <SlidersHorizontal className="h-5 w-5 text-slate-500" />;
  }

  return (
    <ProviderIcon
      providerType={template.iconProviderId ?? template.systemProviderId ?? template.id}
      fallbackText={template.name}
      size={24}
    />
  );
}

function getRegionLabel(region?: ProviderRegion): string | null {
  switch (region) {
    case "cn":
      return "国内";
    case "global":
      return "海外";
    default:
      return null;
  }
}

function getBillingModeLabel(mode?: ProviderBillingMode): string | null {
  switch (mode) {
    case "payg":
      return "按量 API";
    case "coding_plan":
      return "Coding Plan";
    case "subscription":
      return "订阅套餐";
    default:
      return null;
  }
}

function renderTemplateBadges(template: ProviderTemplate) {
  const badges = [
    template.recommended ? "推荐" : null,
    getRegionLabel(template.region),
    getBillingModeLabel(template.billingMode),
  ].filter((item): item is string => Boolean(item));

  if (badges.length === 0) {
    return null;
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {badges.map((badge) => (
        <Badge
          key={badge}
          className="border border-slate-200 bg-slate-50 px-2 py-0 text-[11px] text-slate-600 hover:bg-slate-50"
        >
          {badge}
        </Badge>
      ))}
    </span>
  );
}

export const ModelAddPanel: React.FC<ModelAddPanelProps> = ({
  providers,
  onAddProvider,
  onUpdateProvider,
  onAddApiKey,
  onActivated,
  onCancel,
  className,
}) => {
  const [catalog, setCatalog] = useState<SystemProviderCatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [category, setCategory] = useState<ModelCatalogCategory>("recommended");
  const [view, setView] = useState<ModelAddView>("catalog");
  const [selectedTemplate, setSelectedTemplate] = useState<ProviderTemplate | null>(null);
  const [formState, setFormState] = useState<FormState>(createInitialFormState(CUSTOM_TEMPLATE));
  const [modelDraft, setModelDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const { groupedByProvider } = useModelRegistry({ autoLoad: true });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const items = await apiKeyProviderApi.getSystemProviderCatalog();
        if (!cancelled) {
          setCatalog(items);
          setCatalogError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setCatalog([]);
          setCatalogError(
            error instanceof Error ? error.message : "读取服务商目录失败",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const templates = useMemo(() => {
    const catalogTemplates = buildCatalogTemplates(catalog);
    const registryTemplates = buildRegistryTemplates(
      groupedByProvider,
      catalogTemplates,
    );

    return dedupeTemplates([
      ...FEATURED_TEMPLATES,
      ...catalogTemplates,
      ...registryTemplates,
    ]);
  }, [catalog, groupedByProvider]);

  const visibleTemplates = useMemo(() => {
    if (category === "recommended") {
      return templates.filter((template) => template.recommended);
    }
    return templates.filter((template) => template.category === category);
  }, [category, templates]);

  const existingProviderById = useMemo(() => {
    const map = new Map<string, ProviderWithKeysDisplay>();
    providers.forEach((provider) => map.set(provider.id, provider));
    return map;
  }, [providers]);

  const selectTemplate = useCallback((template: ProviderTemplate) => {
    setSelectedTemplate(template);
    setFormState(createInitialFormState(template));
    setModelDraft("");
    setSubmitError(null);
    setView("configure");
  }, []);

  const addModelDraft = useCallback(() => {
    const nextModels = dedupeModelIds(
      modelDraft
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );

    if (nextModels.length === 0) {
      return;
    }

    setFormState((previous) => ({
      ...previous,
      models: dedupeModelIds([...previous.models, ...nextModels]),
    }));
    setModelDraft("");
  }, [modelDraft]);

  const removeModel = useCallback((modelId: string) => {
    setFormState((previous) => ({
      ...previous,
      models: previous.models.filter(
        (item) => item.toLowerCase() !== modelId.toLowerCase(),
      ),
    }));
  }, []);

  const setMainModel = useCallback((modelId: string) => {
    setFormState((previous) => ({
      ...previous,
      models: [
        modelId,
        ...previous.models.filter(
          (item) => item.toLowerCase() !== modelId.toLowerCase(),
        ),
      ],
    }));
  }, []);

  const activateProvider = useCallback(async () => {
    const validationError = validateForm(formState);
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    const template = selectedTemplate ?? CUSTOM_TEMPLATE;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const request: AddCustomProviderRequest = {
        name: formState.name.trim(),
        type: formState.type,
        api_host: formState.apiHost.trim(),
        prompt_cache_mode: resolvePromptCacheModeRequestValue(
          formState.type,
          formState.promptCacheMode,
          formState.apiHost,
        ),
      };

      const existingProvider = template.systemProviderId
        ? existingProviderById.get(template.systemProviderId)
        : null;
      let providerId = existingProvider?.id ?? null;

      if (providerId) {
        await onUpdateProvider(providerId, {
          type: request.type,
          api_host: request.api_host,
          enabled: true,
          prompt_cache_mode: request.prompt_cache_mode,
          custom_models: formState.models,
        });
      } else {
        const created = await onAddProvider(request);
        providerId = created.id;
        await onUpdateProvider(providerId, {
          enabled: true,
          custom_models: formState.models,
        });
      }

      if (formState.apiKey.trim()) {
        await onAddApiKey(providerId, formState.apiKey.trim());
      }

      const testResult = await apiKeyProviderApi.testConnection(
        providerId,
        formState.models[0],
      );

      if (!testResult.success) {
        throw new Error(
          testResult.error || "已保存配置，但连接测试未通过，请检查密钥或模型 ID。",
        );
      }

      onActivated(providerId);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "测试连接并激活失败",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    existingProviderById,
    formState,
    onActivated,
    onAddApiKey,
    onAddProvider,
    onUpdateProvider,
    selectedTemplate,
  ]);

  if (view === "catalog") {
    return (
      <div
        className={cn(
          "flex h-full flex-col overflow-y-auto bg-white px-4 py-4 lg:px-5",
          className,
        )}
        data-testid="model-add-catalog"
      >
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-[18px] bg-slate-100 p-1 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:rounded-full">
          {CATEGORY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setCategory(option.value)}
              className={cn(
                "min-w-0 rounded-[14px] px-3 py-2 text-sm font-semibold transition sm:min-w-[118px] sm:rounded-full sm:px-4",
                category === option.value
                  ? "bg-white text-slate-900 shadow-sm shadow-slate-950/5"
                  : "text-slate-500 hover:text-slate-800",
              )}
              data-testid={`model-catalog-category-${option.value}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {catalogError ? (
          <div className="mb-4 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {catalogError}，已先展示内置推荐服务。
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2" data-testid="model-template-grid">
          {visibleTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => selectTemplate(template)}
              className="group rounded-[22px] border border-slate-200/80 bg-white px-4 py-4 text-left shadow-sm shadow-slate-950/5 transition hover:border-slate-300 hover:bg-slate-50"
              data-testid="model-template-card"
              data-template-id={template.id}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-slate-50">
                  {renderTemplateIcon(template)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
                      {template.name}
                    </span>
                    {renderTemplateBadges(template)}
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-slate-500">
                    {template.description}
                  </span>
                </span>
              </div>
            </button>
          ))}

          <button
            type="button"
            onClick={() => selectTemplate(CUSTOM_TEMPLATE)}
            className="rounded-[22px] border border-slate-200/80 bg-slate-100/80 px-4 py-4 text-left transition hover:bg-slate-100"
            data-testid="custom-provider-template-card"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white text-slate-500">
                <SlidersHorizontal className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-slate-900">
                  自定义供应商
                </span>
                <span className="mt-1 block text-sm leading-5 text-slate-500">
                  配置自定义 API 兼容的供应商
                </span>
              </span>
            </div>
          </button>
        </div>
      </div>
    );
  }

  const template = selectedTemplate ?? CUSTOM_TEMPLATE;
  const apiKeyRequired = isApiKeyRequired(formState.type);

  return (
    <div
      className={cn("flex h-full flex-col overflow-y-auto bg-white px-4 py-4 lg:px-5", className)}
      data-testid="model-add-configure"
    >
      <div className="mb-3">
        <button
          type="button"
          onClick={() => {
            setView("catalog");
            setSubmitError(null);
          }}
          className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-200 hover:text-slate-900"
          data-testid="model-add-back-button"
        >
          <ArrowLeft className="h-4 w-4" />
          返回列表
        </button>
      </div>

      <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-slate-50">
              {renderTemplateIcon(template)}
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                <h3 className="min-w-0 truncate text-lg font-semibold text-slate-900">
                  {template.isCustom ? "自定义供应商" : `配置 ${template.name}`}
                </h3>
                {renderTemplateBadges(template)}
              </div>
              <p className="mt-1 text-sm text-slate-500">{template.description}</p>
            </div>
          </div>
          {template.apiKeyUrl ? (
            <a
              href={template.apiKeyUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800"
              data-testid="provider-api-key-link"
            >
              去获取 API 密钥
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>

        <div className="space-y-4">
          {template.isCustom ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="model-provider-name" className="text-sm text-slate-600">
                  供应商名称
                </Label>
                <Input
                  id="model-provider-name"
                  value={formState.name}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }))
                  }
                  placeholder="例如：My API Provider"
                  className="h-12 rounded-[18px] border-slate-200 bg-white px-4"
                  disabled={submitting}
                  data-testid="model-provider-name-input"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="model-api-host" className="text-sm text-slate-600">
                  API Base URL
                </Label>
                <Input
                  id="model-api-host"
                  value={formState.apiHost}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      apiHost: event.target.value,
                    }))
                  }
                  placeholder="https://api.example.com/v1"
                  className="h-12 rounded-[18px] border-slate-200 bg-white px-4"
                  disabled={submitting}
                  data-testid="model-api-host-input"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm text-slate-600">API 格式</Label>
                <div className="grid rounded-full bg-slate-100 p-1 sm:grid-cols-2">
                  {[
                    { type: "openai" as ProviderType, label: "OpenAI 格式" },
                    {
                      type: "anthropic-compatible" as ProviderType,
                      label: "Anthropic 格式",
                    },
                  ].map((option) => (
                    <button
                      key={option.type}
                      type="button"
                      onClick={() =>
                        setFormState((previous) => ({
                          ...previous,
                          type: option.type,
                        }))
                      }
                      className={cn(
                        "rounded-full px-4 py-2.5 text-sm font-semibold transition",
                        formState.type === option.type
                          ? "bg-white text-slate-900 shadow-sm shadow-slate-950/5"
                          : "text-slate-500 hover:text-slate-800",
                      )}
                      disabled={submitting}
                      data-testid={`model-api-format-${option.type}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {template.apiHost ? (
                <div className="rounded-[18px] border border-slate-200/80 bg-slate-50 px-4 py-3">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Globe2 className="h-3.5 w-3.5" />
                    API Base URL
                  </div>
                  <p className="mt-2 break-all text-sm font-medium text-slate-900">
                    {formState.apiHost}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label
                    htmlFor="template-api-host"
                    className="text-sm text-slate-600"
                  >
                    API Base URL
                  </Label>
                  <Input
                    id="template-api-host"
                    value={formState.apiHost}
                    onChange={(event) =>
                      setFormState((previous) => ({
                        ...previous,
                        apiHost: event.target.value,
                      }))
                    }
                    placeholder="https://api.example.com/v1"
                    className="h-12 rounded-[18px] border-slate-200 bg-white px-4"
                    disabled={submitting}
                    data-testid="template-api-host-input"
                  />
                </div>
              )}
              <div className="rounded-[18px] border border-slate-200/80 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <ServerCog className="h-3.5 w-3.5" />
                  API 格式
                </div>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  {getProviderTypeLabel(formState.type)}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="model-api-key" className="text-sm text-slate-600">
              API 密钥{apiKeyRequired ? "" : "（可选）"}
            </Label>
            <div className="relative">
              <Input
                id="model-api-key"
                type={showApiKey ? "text" : "password"}
                value={formState.apiKey}
                onChange={(event) =>
                  setFormState((previous) => ({
                    ...previous,
                    apiKey: event.target.value,
                  }))
                }
                placeholder={apiKeyRequired ? "输入 API 密钥" : "本地模型可留空"}
                className="h-12 rounded-[18px] border-slate-200 bg-white px-4 pr-11"
                disabled={submitting}
                data-testid="model-api-key-input"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((previous) => !previous)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700"
                aria-label="显示或隐藏 API 密钥"
              >
                <Eye className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-slate-600">模型优先级（至少添加一个）</Label>
            <p className="text-xs leading-5 text-slate-500">
              这里不再预填本地兜底模型；请输入你确认可用的模型 ID，或保存后到配置页从接口获取。
            </p>
            <div className="rounded-[22px] bg-slate-100 p-3" data-testid="model-priority-list">
              {formState.models.length > 0 ? (
                <div className="space-y-2">
                  {formState.models.map((model, index) => (
                    <div
                      key={model}
                      className="flex items-center gap-3 rounded-[16px] bg-white px-3 py-2 text-sm text-slate-800"
                    >
                      <span className="text-slate-400">::</span>
                      {index === 0 ? (
                        <Badge className="border border-amber-200 bg-amber-50 px-2 py-0 text-[11px] text-amber-700 hover:bg-amber-50">
                          主模型
                        </Badge>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate normal-case">{model}</span>
                      {index > 0 ? (
                        <button
                          type="button"
                          onClick={() => setMainModel(model)}
                          className="text-xs font-medium text-slate-500 hover:text-slate-900"
                        >
                          设为主模型
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removeModel(model)}
                        className="text-xs font-medium text-slate-400 hover:text-rose-600"
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input
                  value={modelDraft}
                  onChange={(event) => setModelDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      addModelDraft();
                    }
                  }}
                  placeholder="输入模型 ID，按 Enter 添加"
                  className="h-11 rounded-[16px] border-slate-200 bg-white px-4 normal-case"
                  disabled={submitting}
                  data-testid="model-draft-input"
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 rounded-[16px] px-4"
                  onClick={addModelDraft}
                  disabled={submitting || !modelDraft.trim()}
                  data-testid="model-draft-add-button"
                >
                  <Plus className="mr-1 h-4 w-4" />
                  添加模型
                </Button>
              </div>
            </div>
          </div>

          {submitError ? (
            <div
              className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
              data-testid="model-add-error"
            >
              {submitError}
            </div>
          ) : null}

          <Button
            type="button"
            onClick={() => {
              void activateProvider();
            }}
            disabled={submitting}
            className="h-12 w-full rounded-full border border-emerald-900/15 bg-white text-sm font-semibold text-slate-500 shadow-sm shadow-slate-950/5 hover:bg-emerald-50 hover:text-emerald-800"
            data-testid="model-activate-button"
          >
            {submitting ? (
              "正在测试连接..."
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                测试连接并激活
              </>
            )}
          </Button>
        </div>
      </section>

      <button
        type="button"
        onClick={onCancel}
        className="mt-4 inline-flex items-center gap-2 self-start rounded-full px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        data-testid="model-add-cancel-button"
      >
        <Check className="h-4 w-4" />
        完成添加
      </button>
    </div>
  );
};

export default ModelAddPanel;
