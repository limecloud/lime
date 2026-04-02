/**
 * @file Provider 图标组件
 * @description 统一的 Provider 图标组件，支持所有 System Provider
 * @module icons/providers
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 10.1, 10.2, 10.4**
 */

import React, { useMemo, ComponentType, SVGProps } from "react";
import { cn } from "@/lib/utils";
import { providerTypeToIcon } from "./utils";

// ============================================================================
// SVG 图标导入 - 使用 SVGR
// ============================================================================

// 现有图标
import AwsIcon from "./aws.svg?react";
import GeminiIcon from "./gemini.svg?react";
import AnthropicIcon from "./anthropic.svg?react";
import abacusIconUrl from "./abacus.ico?url";
import Ai21Icon from "./ai21.svg?react";
import ClaudeIcon from "./claude.svg?react";
import basetenIconUrl from "./baseten.ico?url";
import CloudflareIcon from "./cloudflare.svg?react";
import chutesIconUrl from "./chutes.png?url";
import ComfyuiIcon from "./comfyui.svg?react";
import cortecsIconUrl from "./cortecs.ico?url";
import QwenIcon from "./qwen.svg?react";
import deepinfraIconUrl from "./deepinfra.png?url";
import GoogleIcon from "./google.svg?react";
import FalIcon from "./fal.svg?react";
import FastrouterIcon from "./fastrouter.svg?react";
import FriendliIcon from "./friendli.svg?react";
import HigressIcon from "./higress.svg?react";
import heliconeIconUrl from "./helicone.webp?url";
import InferenceIcon from "./inference.svg?react";
import inceptionIconUrl from "./inception.png?url";
import ioNetIconUrl from "./io-net.png?url";
import lucidqueryIconUrl from "./lucidquery.png?url";
import NebiusIcon from "./nebius.svg?react";
import nanoGptIconUrl from "./nano-gpt.png?url";
import MorphIcon from "./morph.svg?react";
import OpenaiIcon from "./openai.svg?react";
import opencodeIconUrl from "./opencode.png?url";
import OvhcloudIcon from "./ovhcloud.svg?react";
import AlibabaIcon from "./alibaba.svg?react";
import CopilotIcon from "./copilot.svg?react";
import requestyIconUrl from "./requesty.ico?url";
import SapAiCoreIcon from "./sap-ai-core.svg?react";
import ScalewayIcon from "./scaleway.svg?react";
import submodelIconUrl from "./submodel.ico?url";
import AmpIcon from "./amp.svg?react";
import KiroIcon from "./kiro.svg?react";
import DeepseekIcon from "./deepseek.svg?react";
import ZhipuIcon from "./zhipu.svg?react";
import KimiIcon from "./kimi.svg?react";
import MinimaxIcon from "./minimax.svg?react";
import DoubaoIcon from "./doubao.svg?react";
import AzureIcon from "./azure.svg?react";
import antigravityIconUrl from "./antigravity.svg?url";
import LimeIcon from "./lime.svg?react";
import LimeHubIcon from "./lime-hub.svg?react";
import MetaIcon from "./meta.svg?react";
import UpstageIcon from "./upstage.svg?react";
import V0Icon from "./v0.svg?react";
import ZaiIcon from "./zai.svg?react";

// 新增图标 - 主流 AI
import PerplexityIcon from "./perplexity.svg?react";
import MoonshotIcon from "./moonshot.svg?react";
import GrokIcon from "./grok.svg?react";
import MistralIcon from "./mistral.svg?react";
import CohereIcon from "./cohere.svg?react";
import groqIconUrl from "./groq.png?url";

// 新增图标 - 国内 AI
import BaiduIcon from "./baidu.svg?react";
import YiIcon from "./yi.svg?react";
import BaichuanIcon from "./baichuan.svg?react";
import HunyuanIcon from "./hunyuan.svg?react";
import StepfunIcon from "./stepfun.svg?react";
import TencentIcon from "./tencent.svg?react";
import InfiniIcon from "./infini.svg?react";
import XirangIcon from "./xirang.svg?react";
import MimoIcon from "./mimo.svg?react";
import ModelscopeIcon from "./modelscope.svg?react";
import ZhinaoIcon from "./zhinao.svg?react";
import dashscopeIconUrl from "./dashscope.png?url";

// 新增图标 - 云服务
import VertexaiIcon from "./vertexai.svg?react";
import BedrockIcon from "./bedrock.svg?react";
import GithubIcon from "./github.svg?react";

// 新增图标 - API 聚合
import SiliconIcon from "./silicon.svg?react";
import OpenrouterIcon from "./openrouter.svg?react";
import Ai302Icon from "./302ai.svg?react";
import AihubmixIcon from "./aihubmix.svg?react";
import TogetherIcon from "./together.svg?react";
import PpioIcon from "./ppio.svg?react";
import HyperbolicIcon from "./hyperbolic.svg?react";
import CerebrasIcon from "./cerebras.svg?react";
import NvidiaIcon from "./nvidia.svg?react";
import FireworksIcon from "./fireworks.svg?react";
import TokenfluxIcon from "./tokenflux.svg?react";
import CephalonIcon from "./cephalon.svg?react";
import Ph8Icon from "./ph8.svg?react";
import QiniuIcon from "./qiniu.svg?react";
import LanyunIcon from "./lanyun.svg?react";
import SophnetIcon from "./sophnet.svg?react";
import BurncloudIcon from "./burncloud.svg?react";
import DmxapiIcon from "./dmxapi.svg?react";
import LongcatIcon from "./longcat.svg?react";
import AlayanewIcon from "./alayanew.svg?react";
import AionlyIcon from "./aionly.svg?react";
import NovitaIcon from "./novita.svg?react";
import OcoolaiIcon from "./ocoolai.svg?react";
import ReplicateIcon from "./replicate.svg?react";
import VercelIcon from "./vercel.svg?react";
import ZenmuxIcon from "./zenmux.svg?react";
import PoeIcon from "./poe.svg?react";
import HuggingfaceIcon from "./huggingface.svg?react";
import SyntheticIcon from "./synthetic.svg?react";
import veniceIconUrl from "./venice.png?url";
import VultrIcon from "./vultr.svg?react";
import WandbIcon from "./wandb.svg?react";

// 新增图标 - 本地服务
import OllamaIcon from "./ollama.svg?react";
import LmstudioIcon from "./lmstudio.svg?react";
import GpustackIcon from "./gpustack.svg?react";
import OvmsIcon from "./ovms.svg?react";
import VllmIcon from "./vllm.svg?react";
import newapiIconUrl from "./newapi.png?url";

// 新增图标 - 专用服务
import JinaIcon from "./jina.svg?react";
import VoyageaiIcon from "./voyageai.svg?react";
import CherryinIcon from "./cherryin.svg?react";

// 自定义 Provider 图标
import CustomIcon from "./custom.svg?react";

const createImageIconComponent = (
  iconUrl: string,
  alt: string,
): React.FC<SVGProps<SVGSVGElement>> => {
  const ImageIcon: React.FC<SVGProps<SVGSVGElement>> = ({
    width = "1em",
    height = "1em",
    className,
    style,
  }) => {
    const widthValue = typeof width === "number" ? `${width}px` : width;
    const heightValue = typeof height === "number" ? `${height}px` : height;

    return (
      <img
        src={iconUrl}
        alt={alt}
        className={className}
        style={{
          width: widthValue,
          height: heightValue,
          display: "block",
          objectFit: "contain",
          ...(style as React.CSSProperties),
        }}
      />
    );
  };

  return ImageIcon;
};

const AntigravityIcon = createImageIconComponent(
  antigravityIconUrl,
  "Antigravity",
);
const AbacusIcon = createImageIconComponent(abacusIconUrl, "Abacus");
const BasetenIcon = createImageIconComponent(basetenIconUrl, "Baseten");
const ChutesIcon = createImageIconComponent(chutesIconUrl, "Chutes");
const CortecsIcon = createImageIconComponent(cortecsIconUrl, "Cortecs");
const DeepinfraIcon = createImageIconComponent(deepinfraIconUrl, "DeepInfra");
const GroqIcon = createImageIconComponent(groqIconUrl, "Groq");
const DashscopeIcon = createImageIconComponent(dashscopeIconUrl, "Dashscope");
const HeliconeIcon = createImageIconComponent(heliconeIconUrl, "Helicone");
const InceptionIcon = createImageIconComponent(inceptionIconUrl, "Inception");
const LucidqueryIcon = createImageIconComponent(
  lucidqueryIconUrl,
  "LucidQuery",
);
const IoNetIcon = createImageIconComponent(ioNetIconUrl, "IO.net");
const NanoGptIcon = createImageIconComponent(nanoGptIconUrl, "NanoGPT");
const NewapiIcon = createImageIconComponent(newapiIconUrl, "New API");
const OpencodeIcon = createImageIconComponent(opencodeIconUrl, "OpenCode");
const RequestyIcon = createImageIconComponent(requestyIconUrl, "Requesty");
const SubmodelIcon = createImageIconComponent(submodelIconUrl, "Submodel");
const VeniceIcon = createImageIconComponent(veniceIconUrl, "Venice");

// ============================================================================
// 图标组件映射
// ============================================================================

/**
 * 图标组件映射表
 * 将图标名称映射到对应的 SVG 组件
 */
const iconComponents: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  // 现有图标
  aws: AwsIcon,
  gemini: GeminiIcon,
  anthropic: AnthropicIcon,
  abacus: AbacusIcon,
  ai21: Ai21Icon,
  claude: ClaudeIcon,
  baseten: BasetenIcon,
  chutes: ChutesIcon,
  comfyui: ComfyuiIcon,
  cortecs: CortecsIcon,
  qwen: QwenIcon,
  deepinfra: DeepinfraIcon,
  google: GoogleIcon,
  fal: FalIcon,
  fastrouter: FastrouterIcon,
  friendli: FriendliIcon,
  higress: HigressIcon,
  helicone: HeliconeIcon,
  inference: InferenceIcon,
  inception: InceptionIcon,
  "io-net": IoNetIcon,
  lucidquery: LucidqueryIcon,
  morph: MorphIcon,
  nebius: NebiusIcon,
  "nano-gpt": NanoGptIcon,
  openai: OpenaiIcon,
  opencode: OpencodeIcon,
  ovhcloud: OvhcloudIcon,
  alibaba: AlibabaIcon,
  copilot: CopilotIcon,
  requesty: RequestyIcon,
  "sap-ai-core": SapAiCoreIcon,
  scaleway: ScalewayIcon,
  submodel: SubmodelIcon,
  amp: AmpIcon,
  kiro: KiroIcon,
  deepseek: DeepseekIcon,
  zhipu: ZhipuIcon,
  kimi: KimiIcon,
  minimax: MinimaxIcon,
  doubao: DoubaoIcon,
  azure: AzureIcon,
  cloudflare: CloudflareIcon,
  antigravity: AntigravityIcon,
  lime: LimeIcon,
  "lime-hub": LimeHubIcon,
  meta: MetaIcon,
  upstage: UpstageIcon,
  v0: V0Icon,
  zai: ZaiIcon,

  // 主流 AI
  perplexity: PerplexityIcon,
  moonshot: MoonshotIcon,
  grok: GrokIcon,
  groq: GroqIcon,
  mistral: MistralIcon,
  cohere: CohereIcon,

  // 国内 AI
  baidu: BaiduIcon,
  yi: YiIcon,
  baichuan: BaichuanIcon,
  hunyuan: HunyuanIcon,
  stepfun: StepfunIcon,
  tencent: TencentIcon,
  infini: InfiniIcon,
  xirang: XirangIcon,
  mimo: MimoIcon,
  modelscope: ModelscopeIcon,
  zhinao: ZhinaoIcon,
  dashscope: DashscopeIcon,

  // 云服务
  vertexai: VertexaiIcon,
  bedrock: BedrockIcon,
  github: GithubIcon,

  // API 聚合
  silicon: SiliconIcon,
  openrouter: OpenrouterIcon,
  "302ai": Ai302Icon,
  aihubmix: AihubmixIcon,
  together: TogetherIcon,
  ppio: PpioIcon,
  hyperbolic: HyperbolicIcon,
  cerebras: CerebrasIcon,
  nvidia: NvidiaIcon,
  fireworks: FireworksIcon,
  tokenflux: TokenfluxIcon,
  cephalon: CephalonIcon,
  ph8: Ph8Icon,
  qiniu: QiniuIcon,
  lanyun: LanyunIcon,
  sophnet: SophnetIcon,
  burncloud: BurncloudIcon,
  dmxapi: DmxapiIcon,
  longcat: LongcatIcon,
  alayanew: AlayanewIcon,
  aionly: AionlyIcon,
  novita: NovitaIcon,
  ocoolai: OcoolaiIcon,
  replicate: ReplicateIcon,
  vercel: VercelIcon,
  zenmux: ZenmuxIcon,
  poe: PoeIcon,
  huggingface: HuggingfaceIcon,
  synthetic: SyntheticIcon,
  venice: VeniceIcon,
  vultr: VultrIcon,
  wandb: WandbIcon,

  // 本地服务
  ollama: OllamaIcon,
  lmstudio: LmstudioIcon,
  newapi: NewapiIcon,
  gpustack: GpustackIcon,
  ovms: OvmsIcon,
  vllm: VllmIcon,

  // 专用服务
  jina: JinaIcon,
  voyageai: VoyageaiIcon,
  cherryin: CherryinIcon,

  // 自定义
  custom: CustomIcon,
};

// ============================================================================
// Fallback 色板
// ============================================================================

const FALLBACK_GRADIENTS: Array<[string, string]> = [
  ["#6366f1", "#8b5cf6"],
  ["#0ea5e9", "#2563eb"],
  ["#22c55e", "#16a34a"],
  ["#f59e0b", "#ea580c"],
  ["#ec4899", "#db2777"],
  ["#14b8a6", "#0d9488"],
  ["#a855f7", "#7e22ce"],
  ["#f43f5e", "#be123c"],
];

// ============================================================================
// ProviderIcon 组件
// ============================================================================

interface ProviderIconProps {
  /** Provider 类型或 ID */
  providerType: string;
  /** 回退文本（未命中图标时用于生成首字母） */
  fallbackText?: string;
  /** 图标大小，支持数字（px）或字符串 */
  size?: number | string;
  /** 额外的 CSS 类名 */
  className?: string;
  /** 是否显示 fallback（首字母缩写） */
  showFallback?: boolean;
}

/**
 * Provider 图标组件
 *
 * 根据 Provider 类型或 ID 显示对应的图标。
 * 如果没有对应图标且 showFallback 为 true，则显示首字母缩写。
 *
 * @example
 * ```tsx
 * <ProviderIcon providerType="openai" size={24} />
 * <ProviderIcon providerType="deepseek" size="1.5rem" />
 * <ProviderIcon providerType="custom-provider" showFallback />
 * ```
 */
export const ProviderIcon: React.FC<ProviderIconProps> = ({
  providerType,
  fallbackText,
  size = 24,
  className,
  showFallback = true,
}) => {
  const iconName = providerTypeToIcon[providerType] || providerType;
  const IconComponent =
    iconName === "custom" ? undefined : iconComponents[iconName];

  const sizeStyle = useMemo(() => {
    const sizeValue = typeof size === "number" ? `${size}px` : size;
    return {
      width: sizeValue,
      height: sizeValue,
      fontSize: sizeValue,
      lineHeight: 1,
    };
  }, [size]);

  if (IconComponent) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center flex-shrink-0",
          className,
        )}
        style={sizeStyle}
      >
        <IconComponent width="1em" height="1em" />
      </span>
    );
  }

  // Fallback：显示彩色首字母图标
  if (showFallback) {
    const source = fallbackText?.trim() || providerType;
    const words = source
      .split(/[\s-_]+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 0);

    const primaryWord = words[0] || source;
    const primaryChars = Array.from(primaryWord);
    const firstDigit = primaryChars.find((char) => /\d/.test(char));

    const initials =
      words.length >= 2
        ? words
            .slice(0, 2)
            .map((word) => Array.from(word)[0] || "")
            .join("")
            .toUpperCase()
        : firstDigit && primaryChars.length > 0
          ? `${primaryChars[0]}${firstDigit}`.toUpperCase()
          : primaryChars.slice(0, 2).join("").toUpperCase();

    const fallbackFontSize =
      typeof size === "number" ? `${Math.max(size * 0.5, 12)}px` : "0.5em";

    const hash = Array.from(source).reduce(
      (accumulator, char) => (accumulator * 31 + char.charCodeAt(0)) >>> 0,
      7,
    );
    const [startColor, endColor] =
      FALLBACK_GRADIENTS[hash % FALLBACK_GRADIENTS.length];

    return (
      <span
        className={cn(
          "inline-flex items-center justify-center flex-shrink-0 rounded-lg",
          "text-white font-semibold",
          className,
        )}
        style={{
          ...sizeStyle,
          background: `linear-gradient(135deg, ${startColor}, ${endColor})`,
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.22)",
        }}
      >
        <span style={{ fontSize: fallbackFontSize }}>{initials}</span>
      </span>
    );
  }

  return null;
};

// ============================================================================
// 导出
// ============================================================================

export { iconComponents };
export type { ProviderIconProps };
