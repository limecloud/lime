/**
 * @file 语音组件类型定义
 * @description 导出所有语音相关的类型，供组件使用
 * @module components/voice/types
 */

// 从 API 模块重新导出类型
export type {
  AsrProviderType,
  WhisperModelSize,
  WhisperLocalConfig,
  SenseVoiceLocalConfig,
  XunfeiConfig,
  BaiduConfig,
  OpenAIAsrConfig,
  AsrCredentialEntry,
  VoiceOutputMode,
  VoiceProcessorConfig,
  VoiceOutputConfig,
  VoiceInstruction,
  VoiceInputConfig,
} from "@/lib/api/asrProvider";

// 导出 API 函数
export {
  getAsrCredentials,
  addAsrCredential,
  updateAsrCredential,
  deleteAsrCredential,
  setDefaultAsrCredential,
  testAsrCredential,
  getVoiceInputConfig,
  saveVoiceInputConfig,
  getVoiceInstructions,
  saveVoiceInstruction,
  deleteVoiceInstruction,
} from "@/lib/api/asrProvider";

/** ASR Provider 显示信息 */
export interface AsrProviderInfo {
  type: import("@/lib/api/asrProvider").AsrProviderType;
  label: string;
  description: string;
  icon: string;
  requiresCredentials: boolean;
}

/** ASR Provider 列表 */
export const ASR_PROVIDERS: AsrProviderInfo[] = [
  {
    type: "whisper_local",
    label: "本地 Whisper",
    description: "离线语音识别，无需网络",
    icon: "cpu",
    requiresCredentials: false,
  },
  {
    type: "sensevoice_local",
    label: "SenseVoice Small 本地",
    description: "按需下载的离线语音识别模型",
    icon: "cpu",
    requiresCredentials: false,
  },
  {
    type: "xunfei",
    label: "讯飞语音",
    description: "讯飞开放平台语音识别",
    icon: "cloud",
    requiresCredentials: true,
  },
  {
    type: "baidu",
    label: "百度语音",
    description: "百度 AI 开放平台语音识别",
    icon: "cloud",
    requiresCredentials: true,
  },
  {
    type: "openai",
    label: "OpenAI Whisper",
    description: "OpenAI Whisper API",
    icon: "sparkles",
    requiresCredentials: true,
  },
];

/** Whisper 模型选项 */
export const WHISPER_MODELS = [
  { value: "tiny", label: "Tiny", size: "~75MB", speed: "最快" },
  { value: "base", label: "Base", size: "~142MB", speed: "快" },
  { value: "small", label: "Small", size: "~466MB", speed: "中等" },
  { value: "medium", label: "Medium", size: "~1.5GB", speed: "较慢" },
] as const;
