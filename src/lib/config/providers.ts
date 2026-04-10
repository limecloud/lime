/**
 * @file System Provider 配置
 * @description 所有系统预设 Provider 的配置定义
 * @module lib/config/providers
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 3.1-3.6**
 */

import type {
  ProviderConfig,
  ProviderGroup,
  ProviderGroupConfig,
  SystemProviderId,
} from "../types/provider";

// ============================================================================
// Provider 分组配置
// ============================================================================

/**
 * Provider 分组配置
 * 定义各分组的显示标签和排序顺序
 */
export const PROVIDER_GROUPS: Record<ProviderGroup, ProviderGroupConfig> = {
  mainstream: { label: "主流 AI", order: 1 },
  chinese: { label: "国内 AI", order: 2 },
  cloud: { label: "云服务", order: 3 },
  aggregator: { label: "API 聚合", order: 4 },
  local: { label: "本地服务", order: 5 },
  specialized: { label: "专用服务", order: 6 },
  custom: { label: "自定义", order: 7 },
};

// ============================================================================
// System Provider 预设配置
// ============================================================================

/**
 * System Provider 预设配置
 * 包含所有 60+ 系统预设 Provider 的完整配置
 */
export const SYSTEM_PROVIDERS: Record<SystemProviderId, ProviderConfig> = {
  // =========================================================================
  // 主流 AI (10个) - Requirements 3.1
  // =========================================================================
  openai: {
    id: "openai",
    name: "OpenAI",
    type: "openai-response",
    apiHost: "https://api.openai.com",
    isSystem: true,
    group: "mainstream",
    enabled: false,
    sortOrder: 1,
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    type: "anthropic",
    apiHost: "https://api.anthropic.com",
    isSystem: true,
    group: "mainstream",
    enabled: false,
    sortOrder: 2,
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    type: "gemini",
    apiHost: "https://generativelanguage.googleapis.com",
    isSystem: true,
    group: "mainstream",
    enabled: false,
    sortOrder: 3,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai",
    apiHost: "https://api.deepseek.com",
    isSystem: true,
    group: "mainstream",
    enabled: false,
    sortOrder: 4,
  },
  moonshot: {
    id: "moonshot",
    name: "Moonshot",
    type: "openai",
    apiHost: "https://api.moonshot.cn",
    isSystem: true,
    group: "mainstream",
    enabled: false,
    sortOrder: 5,
  },
  groq: {
    id: "groq",
    name: "Groq",
    type: "openai",
    apiHost: "https://api.groq.com/openai",
    isSystem: true,
    group: "mainstream",
    enabled: false,
    sortOrder: 6,
  },
  grok: {
    id: "grok",
    name: "Grok (xAI)",
    type: "openai",
    apiHost: "https://api.x.ai",
    isSystem: true,
    group: "mainstream",
    enabled: false,
    sortOrder: 7,
  },
  mistral: {
    id: "mistral",
    name: "Mistral",
    type: "openai",
    apiHost: "https://api.mistral.ai",
    isSystem: true,
    group: "mainstream",
    enabled: false,
    sortOrder: 8,
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    type: "openai",
    apiHost: "https://api.perplexity.ai/",
    isSystem: true,
    group: "mainstream",
    enabled: false,
    sortOrder: 9,
  },
  cohere: {
    id: "cohere",
    name: "Cohere",
    type: "openai",
    apiHost: "https://api.cohere.ai",
    isSystem: true,
    group: "mainstream",
    enabled: false,
    sortOrder: 10,
  },

  // =========================================================================
  // 国内 AI (15个) - Requirements 3.2
  // =========================================================================
  zhipu: {
    id: "zhipu",
    name: "智谱 (ZhiPu)",
    type: "openai",
    apiHost: "https://open.bigmodel.cn/api/paas/v4/",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 11,
  },
  baichuan: {
    id: "baichuan",
    name: "百川 (Baichuan)",
    type: "openai",
    apiHost: "https://api.baichuan-ai.com",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 12,
  },
  dashscope: {
    id: "dashscope",
    name: "百炼/通义千问 (Dashscope)",
    type: "openai",
    apiHost: "https://dashscope.aliyuncs.com/compatible-mode/v1/",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 13,
  },
  stepfun: {
    id: "stepfun",
    name: "阶跃星辰 (StepFun)",
    type: "openai",
    apiHost: "https://api.stepfun.com",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 14,
  },
  doubao: {
    id: "doubao",
    name: "豆包 (Doubao)",
    type: "openai",
    apiHost: "https://ark.cn-beijing.volces.com/api/v3/",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 15,
  },
  minimax: {
    id: "minimax",
    name: "MiniMax",
    type: "openai",
    apiHost: "https://api.minimaxi.com/v1",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 16,
  },
  yi: {
    id: "yi",
    name: "零一万物 (Yi)",
    type: "openai",
    apiHost: "https://api.lingyiwanwu.com",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 17,
  },
  hunyuan: {
    id: "hunyuan",
    name: "腾讯混元 (Hunyuan)",
    type: "openai",
    apiHost: "https://api.hunyuan.cloud.tencent.com",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 18,
  },
  "tencent-cloud-ti": {
    id: "tencent-cloud-ti",
    name: "腾讯云 TI",
    type: "openai",
    apiHost: "https://api.lkeap.cloud.tencent.com",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 19,
  },
  "baidu-cloud": {
    id: "baidu-cloud",
    name: "百度云 (Baidu Cloud)",
    type: "openai",
    apiHost: "https://qianfan.baidubce.com/v2/",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 20,
  },
  infini: {
    id: "infini",
    name: "无问芯穹 (Infini)",
    type: "openai",
    apiHost: "https://cloud.infini-ai.com/maas",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 21,
  },
  modelscope: {
    id: "modelscope",
    name: "魔搭 (ModelScope)",
    type: "openai",
    apiHost: "https://api-inference.modelscope.cn/v1/",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 22,
  },
  xirang: {
    id: "xirang",
    name: "息壤 (Xirang)",
    type: "openai",
    apiHost: "https://wishub-x1.ctyun.cn",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 23,
  },
  mimo: {
    id: "mimo",
    name: "小米 MiMo",
    type: "openai",
    apiHost: "https://api.xiaomimimo.com",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 24,
  },
  zhinao: {
    id: "zhinao",
    name: "360 智脑 (Zhinao)",
    type: "openai",
    apiHost: "https://api.360.cn",
    isSystem: true,
    group: "chinese",
    enabled: false,
    sortOrder: 25,
  },

  // =========================================================================
  // 云服务 (5个) - Requirements 3.3
  // =========================================================================
  "azure-openai": {
    id: "azure-openai",
    name: "Azure OpenAI",
    type: "azure-openai",
    apiHost: "", // 用户自定义
    isSystem: true,
    group: "cloud",
    enabled: false,
    sortOrder: 26,
    apiVersion: "2024-02-15-preview",
  },
  vertexai: {
    id: "vertexai",
    name: "VertexAI",
    type: "vertexai",
    apiHost: "", // 用户自定义
    isSystem: true,
    group: "cloud",
    enabled: false,
    sortOrder: 27,
  },
  "aws-bedrock": {
    id: "aws-bedrock",
    name: "AWS Bedrock",
    type: "aws-bedrock",
    apiHost: "", // 用户自定义
    isSystem: true,
    group: "cloud",
    enabled: false,
    sortOrder: 28,
  },
  github: {
    id: "github",
    name: "Github Models",
    type: "openai",
    apiHost: "https://models.github.ai/inference",
    isSystem: true,
    group: "cloud",
    enabled: false,
    sortOrder: 29,
  },
  copilot: {
    id: "copilot",
    name: "Github Copilot",
    type: "openai",
    apiHost: "https://api.githubcopilot.com/",
    isSystem: true,
    group: "cloud",
    enabled: false,
    sortOrder: 30,
  },

  // =========================================================================
  // API 聚合/中转服务 (25个) - Requirements 3.4
  // =========================================================================
  silicon: {
    id: "silicon",
    name: "Silicon Flow",
    type: "openai",
    apiHost: "https://api.siliconflow.cn",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 31,
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    type: "openai",
    apiHost: "https://openrouter.ai/api/v1/",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 32,
  },
  aihubmix: {
    id: "aihubmix",
    name: "AiHubMix",
    type: "openai",
    apiHost: "https://aihubmix.com",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 33,
  },
  "302ai": {
    id: "302ai",
    name: "302.AI",
    type: "openai",
    apiHost: "https://api.302.ai",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 34,
  },
  together: {
    id: "together",
    name: "Together",
    type: "openai",
    apiHost: "https://api.together.xyz",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 35,
  },
  fireworks: {
    id: "fireworks",
    name: "Fireworks",
    type: "openai",
    apiHost: "https://api.fireworks.ai/inference",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 36,
  },
  nvidia: {
    id: "nvidia",
    name: "NVIDIA",
    type: "openai",
    apiHost: "https://integrate.api.nvidia.com",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 37,
  },
  hyperbolic: {
    id: "hyperbolic",
    name: "Hyperbolic",
    type: "openai",
    apiHost: "https://api.hyperbolic.xyz",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 38,
  },
  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    type: "openai",
    apiHost: "https://api.cerebras.ai/v1",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 39,
  },
  ppio: {
    id: "ppio",
    name: "PPIO",
    type: "openai",
    apiHost: "https://api.ppinfra.com/v3/openai/",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 40,
  },
  qiniu: {
    id: "qiniu",
    name: "七牛 (Qiniu)",
    type: "openai",
    apiHost: "https://api.qnaigc.com",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 41,
  },
  tokenflux: {
    id: "tokenflux",
    name: "TokenFlux",
    type: "openai",
    apiHost: "https://api.tokenflux.ai/openai/v1",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 42,
  },
  cephalon: {
    id: "cephalon",
    name: "Cephalon",
    type: "openai",
    apiHost: "https://cephalon.cloud/user-center/v1/model",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 43,
  },
  lanyun: {
    id: "lanyun",
    name: "蓝云 (Lanyun)",
    type: "openai",
    apiHost: "https://maas-api.lanyun.net",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 44,
  },
  ph8: {
    id: "ph8",
    name: "PH8",
    type: "openai",
    apiHost: "https://ph8.co",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 45,
  },
  sophnet: {
    id: "sophnet",
    name: "SophNet",
    type: "openai",
    apiHost: "https://www.sophnet.com/api/open-apis/v1",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 46,
  },
  ocoolai: {
    id: "ocoolai",
    name: "ocoolAI",
    type: "openai",
    apiHost: "https://api.ocoolai.com",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 47,
  },
  dmxapi: {
    id: "dmxapi",
    name: "DMXAPI",
    type: "openai",
    apiHost: "https://www.dmxapi.cn",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 48,
  },
  aionly: {
    id: "aionly",
    name: "AIOnly",
    type: "openai",
    apiHost: "https://api.aiionly.com",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 49,
  },
  burncloud: {
    id: "burncloud",
    name: "BurnCloud",
    type: "openai",
    apiHost: "https://ai.burncloud.com",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 50,
  },
  alayanew: {
    id: "alayanew",
    name: "AlayaNew",
    type: "openai",
    apiHost: "https://deepseek.alayanew.com",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 51,
  },
  longcat: {
    id: "longcat",
    name: "LongCat",
    type: "openai",
    apiHost: "https://api.longcat.chat/openai",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 52,
  },
  poe: {
    id: "poe",
    name: "Poe",
    type: "openai",
    apiHost: "https://api.poe.com/v1/",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 53,
  },
  huggingface: {
    id: "huggingface",
    name: "Hugging Face",
    type: "openai-response",
    apiHost: "https://router.huggingface.co/v1/",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 54,
  },
  "vercel-gateway": {
    id: "vercel-gateway",
    name: "Vercel AI Gateway",
    type: "gateway",
    apiHost: "https://ai-gateway.vercel.sh/v1/ai",
    isSystem: true,
    group: "aggregator",
    enabled: false,
    sortOrder: 55,
  },

  // =========================================================================
  // 本地/自托管服务 (5个) - Requirements 3.5
  // =========================================================================
  ollama: {
    id: "ollama",
    name: "Ollama",
    type: "ollama",
    apiHost: "http://127.0.0.1:11434",
    isSystem: true,
    group: "local",
    enabled: false,
    sortOrder: 56,
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio",
    type: "openai",
    apiHost: "http://localhost:1234",
    isSystem: true,
    group: "local",
    enabled: false,
    sortOrder: 57,
  },
  "new-api": {
    id: "new-api",
    name: "New API",
    type: "new-api",
    apiHost: "http://localhost:3000",
    isSystem: true,
    group: "local",
    enabled: false,
    sortOrder: 58,
  },
  gpustack: {
    id: "gpustack",
    name: "GPUStack",
    type: "openai",
    apiHost: "", // 用户自定义
    isSystem: true,
    group: "local",
    enabled: false,
    sortOrder: 59,
  },
  ovms: {
    id: "ovms",
    name: "OpenVINO Model Server",
    type: "openai",
    apiHost: "http://localhost:8000/v3/",
    isSystem: true,
    group: "local",
    enabled: false,
    sortOrder: 60,
  },

  // =========================================================================
  // 专用服务 (3个) - Requirements 3.6
  // =========================================================================
  jina: {
    id: "jina",
    name: "Jina (Embedding/Rerank)",
    type: "openai",
    apiHost: "https://api.jina.ai",
    isSystem: true,
    group: "specialized",
    enabled: false,
    sortOrder: 61,
  },
  voyageai: {
    id: "voyageai",
    name: "VoyageAI (Embedding)",
    type: "openai",
    apiHost: "https://api.voyageai.com",
    isSystem: true,
    group: "specialized",
    enabled: false,
    sortOrder: 62,
  },
  cherryin: {
    id: "cherryin",
    name: "CherryIN",
    type: "openai",
    apiHost: "https://open.cherryin.net",
    isSystem: true,
    group: "specialized",
    enabled: false,
    sortOrder: 63,
  },
};

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取所有 System Provider ID 列表
 */
export function getSystemProviderIds(): SystemProviderId[] {
  return Object.keys(SYSTEM_PROVIDERS) as SystemProviderId[];
}

/**
 * 获取指定分组的 Provider 列表
 */
export function getProvidersByGroup(group: ProviderGroup): ProviderConfig[] {
  return Object.values(SYSTEM_PROVIDERS).filter((p) => p.group === group);
}

/**
 * 获取按分组排序的所有 Provider
 */
export function getProvidersGrouped(): Record<ProviderGroup, ProviderConfig[]> {
  const grouped: Record<ProviderGroup, ProviderConfig[]> = {
    mainstream: [],
    chinese: [],
    cloud: [],
    aggregator: [],
    local: [],
    specialized: [],
    custom: [],
  };

  for (const provider of Object.values(SYSTEM_PROVIDERS)) {
    grouped[provider.group].push(provider);
  }

  // 按 sortOrder 排序
  for (const group of Object.keys(grouped) as ProviderGroup[]) {
    grouped[group].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  return grouped;
}

/**
 * 检查是否为有效的 System Provider ID
 */
export function isSystemProviderId(id: string): id is SystemProviderId {
  return id in SYSTEM_PROVIDERS;
}

/**
 * 获取 System Provider 配置
 */
export function getSystemProvider(id: SystemProviderId): ProviderConfig {
  return SYSTEM_PROVIDERS[id];
}

/**
 * 获取 System Provider 总数
 */
export function getSystemProviderCount(): number {
  return Object.keys(SYSTEM_PROVIDERS).length;
}
