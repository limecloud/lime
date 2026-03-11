// 使用共享的 safeInvoke
import {
  ensureDefaultWorkspaceReady as ensureDefaultProjectWorkspaceReady,
  ensureWorkspaceReady as ensureProjectWorkspaceReady,
} from "@/lib/api/project";
import { revealPathInFinder } from "@/lib/api/fileSystem";
import type {
  AssistantConfig,
  ChatAppearanceConfig,
  Config,
  ContentCreatorConfig,
  CrashReportingConfig,
  EnvironmentConfig,
  EnvironmentPreview,
  EnvironmentPreviewEntry,
  EnvironmentVariableOverride,
  ImageGenConfig,
  MultiSearchConfig,
  MultiSearchEngineEntryConfig,
  NavigationConfig,
  QuotaExceededConfig,
  RemoteManagementConfig,
  ResponseCacheConfig,
  ShellImportPreview,
  TlsConfig,
  UserProfile,
  VoiceConfig,
} from "@/lib/api/appConfig";
import type {
  ChannelsConfig,
  CloudflaredInstallResult,
  CloudflaredInstallStatus,
  CloudflareTunnelConfig,
  DiscordAccountConfig,
  DiscordActionsConfig,
  DiscordAgentComponentsConfig,
  DiscordAutoPresenceConfig,
  DiscordBotConfig,
  DiscordChannelConfig,
  DiscordExecApprovalsConfig,
  DiscordGatewayAccountStatus,
  DiscordGatewayStatus,
  DiscordGuildConfig,
  DiscordIntentsConfig,
  DiscordProbeResult,
  DiscordThreadBindingsConfig,
  DiscordUiComponentsConfig,
  DiscordUiConfig,
  DiscordVoiceAutoJoinConfig,
  DiscordVoiceConfig,
  FeishuAccountConfig,
  FeishuBotConfig,
  FeishuGatewayAccountStatus,
  FeishuGatewayStatus,
  FeishuGroupConfig,
  FeishuProbeResult,
  GatewayChannelStatusResponse,
  GatewayConfig,
  GatewayTunnelConfig,
  GatewayTunnelCreateResponse,
  GatewayTunnelProbeResult,
  GatewayTunnelStatus,
  GatewayTunnelSyncWebhookResponse,
  TelegramBotConfig,
  TelegramGatewayAccountStatus,
  TelegramGatewayStatus,
  TelegramProbeResult,
} from "@/lib/api/channelsRuntime";
import type {
  ExperimentalFeatures,
  SmartInputConfig,
  ToolCallingConfig,
} from "@/lib/api/experimentalFeatures";
import type {
  AutoMemoryIndexItem,
  AutoMemoryIndexResponse,
  CleanupMemoryResult,
  EffectiveMemorySource,
  EffectiveMemorySourcesResponse,
  MemoryAnalysisResult,
  MemoryAutoConfig,
  MemoryAutoToggleResponse,
  MemoryCategoryStat,
  MemoryConfig,
  MemoryEntryPreview,
  MemoryOverviewResponse,
  MemoryProfileConfig,
  MemoryResolveConfig,
  MemorySourcesConfig,
  MemoryStatsResponse,
} from "@/lib/api/memoryRuntime";
import type {
  AmpConfig,
  AmpModelMapping,
  ApiKeyEntry,
  CheckResult,
  ClaudeCustomStatus,
  CredentialEntry,
  CredentialPoolConfig,
  EnvVariable,
  GeminiApiKeyEntry,
  GeminiCredentialStatus,
  IFlowCredentialEntry,
  KiroCredentialStatus,
  OpenAICustomStatus,
  QwenCredentialStatus,
  VertexApiKeyEntry,
  VertexModelAlias,
} from "@/lib/api/providerRuntime";
export {
  checkAndReloadCredentials,
  checkAndReloadGeminiCredentials,
  checkAndReloadQwenCredentials,
  getClaudeCustomStatus,
  getEnvVariables,
  getGeminiCredentials,
  getGeminiEnvVariables,
  getGeminiTokenFileHash,
  getKiroCredentials,
  getOpenAICustomStatus,
  getQwenCredentials,
  getQwenEnvVariables,
  getQwenTokenFileHash,
  getTokenFileHash,
  refreshGeminiToken,
  refreshKiroToken,
  refreshQwenToken,
  reloadCredentials,
  reloadGeminiCredentials,
  reloadQwenCredentials,
  setClaudeCustomConfig,
  setOpenAICustomConfig,
} from "@/lib/api/providerRuntime";
export { getNetworkInfo, testApi } from "@/lib/api/serverTools";
export {
  discordChannelProbe,
  feishuChannelProbe,
  gatewayChannelStart,
  gatewayChannelStatus,
  gatewayChannelStop,
  gatewayTunnelCreate,
  gatewayTunnelDetectCloudflared,
  gatewayTunnelInstallCloudflared,
  gatewayTunnelProbe,
  gatewayTunnelRestart,
  gatewayTunnelStart,
  gatewayTunnelStatus,
  gatewayTunnelStop,
  gatewayTunnelSyncWebhookUrl,
  telegramChannelProbe,
} from "@/lib/api/channelsRuntime";
export { getAvailableModels } from "@/lib/api/modelCatalog";
export {
  getExperimentalConfig,
  saveExperimentalConfig,
  updateScreenshotShortcut,
  validateShortcut,
} from "@/lib/api/experimentalFeatures";
export {
  getDailyUsageTrends,
  getModelUsageRanking,
  getUsageStats,
} from "@/lib/api/usageStats";
export {
  exportSupportBundle,
  getLogStorageDiagnostics,
  getServerDiagnostics,
  getServerStatus,
  getWindowsStartupDiagnostics,
  startServer,
  stopServer,
} from "@/lib/api/serverRuntime";
export {
  getConfig,
  getDefaultProvider,
  getEnvironmentPreview,
  saveConfig,
  setDefaultProvider,
  updateProviderEnvVars,
} from "@/lib/api/appConfig";
export type {
  AssistantConfig,
  ChatAppearanceConfig,
  Config,
  ContentCreatorConfig,
  CrashReportingConfig,
  EnvironmentConfig,
  EnvironmentPreview,
  EnvironmentPreviewEntry,
  EnvironmentVariableOverride,
  ImageGenConfig,
  MultiSearchConfig,
  MultiSearchEngineEntryConfig,
  NavigationConfig,
  QuotaExceededConfig,
  RemoteManagementConfig,
  ResponseCacheConfig,
  ShellImportPreview,
  TlsConfig,
  UserProfile,
  VoiceConfig,
} from "@/lib/api/appConfig";
export {
  clearDiagnosticLogHistory,
  clearLogs,
  getLogs,
  getPersistedLogsTail,
} from "@/lib/api/logs";
export {
  getMemoryAutoIndex,
  getMemoryEffectiveSources,
  getMemoryOverview,
  toggleMemoryAuto,
  updateMemoryAutoNote,
} from "@/lib/api/memoryRuntime";
export type { NetworkInfo, TestResult } from "@/lib/api/serverTools";
export type {
  AmpConfig,
  AmpModelMapping,
  ApiKeyEntry,
  CheckResult,
  ClaudeCustomStatus,
  CredentialEntry,
  CredentialPoolConfig,
  EnvVariable,
  GeminiApiKeyEntry,
  GeminiCredentialStatus,
  IFlowCredentialEntry,
  KiroCredentialStatus,
  OpenAICustomStatus,
  QwenCredentialStatus,
  VertexApiKeyEntry,
  VertexModelAlias,
} from "@/lib/api/providerRuntime";
export type {
  ExperimentalFeatures,
  SmartInputConfig,
  ToolCallingConfig,
} from "@/lib/api/experimentalFeatures";
export type { ModelInfo } from "@/lib/api/modelCatalog";
export type {
  DailyUsage,
  ModelUsage,
  UsageStatsResponse,
} from "@/lib/api/usageStats";
export type {
  AutoMemoryIndexResponse,
  CleanupMemoryResult,
  EffectiveMemorySourcesResponse,
  EffectiveMemorySource,
  MemoryAnalysisResult,
  MemoryAutoConfig,
  MemoryAutoToggleResponse,
  MemoryCategoryStat,
  MemoryConfig,
  MemoryEntryPreview,
  MemoryOverviewResponse,
  MemoryProfileConfig,
  MemoryResolveConfig,
  MemorySourcesConfig,
  MemoryStatsResponse,
} from "@/lib/api/memoryRuntime";
export type {
  ChannelsConfig,
  CloudflaredInstallResult,
  CloudflaredInstallStatus,
  CloudflareTunnelConfig,
  DiscordAccountConfig,
  DiscordActionsConfig,
  DiscordAgentComponentsConfig,
  DiscordAutoPresenceConfig,
  DiscordBotConfig,
  DiscordChannelConfig,
  DiscordExecApprovalsConfig,
  DiscordGatewayAccountStatus,
  DiscordGatewayStatus,
  DiscordGuildConfig,
  DiscordIntentsConfig,
  DiscordProbeResult,
  DiscordThreadBindingsConfig,
  DiscordUiComponentsConfig,
  DiscordUiConfig,
  DiscordVoiceAutoJoinConfig,
  DiscordVoiceConfig,
  FeishuAccountConfig,
  FeishuBotConfig,
  FeishuGatewayAccountStatus,
  FeishuGatewayStatus,
  FeishuGroupConfig,
  FeishuProbeResult,
  GatewayChannelStatusResponse,
  GatewayConfig,
  GatewayTunnelConfig,
  GatewayTunnelCreateResponse,
  GatewayTunnelProbeResult,
  GatewayTunnelStatus,
  GatewayTunnelSyncWebhookResponse,
  TelegramBotConfig,
  TelegramGatewayAccountStatus,
  TelegramGatewayStatus,
  TelegramProbeResult,
} from "@/lib/api/channelsRuntime";
export type {
  CapabilityRoutingMetricsSnapshot,
  IdempotencyConfig,
  IdempotencyDiagnostics,
  IdempotencyStats,
  LogArtifactEntry,
  LogStorageDiagnostics,
  RequestDedupConfig,
  RequestDedupDiagnostics,
  RequestDedupStats,
  ResponseCacheDiagnostics,
  ResponseCacheStats,
  ServerDiagnostics,
  ServerStatus,
  SupportBundleExportResult,
  TelemetrySummary,
  WindowsStartupCheck,
  WindowsStartupDiagnostics,
} from "@/lib/api/serverRuntime";
export type { LogEntry } from "@/lib/api/logs";
import { safeInvoke } from "@/lib/dev-bridge";

export async function revealInFinder(path: string): Promise<void> {
  return revealPathInFinder(path);
}

export interface WorkspaceEnsureResult {
  workspaceId: string;
  rootPath: string;
  existed: boolean;
  created: boolean;
  repaired: boolean;
  relocated?: boolean;
  previousRootPath?: string | null;
  warning?: string | null;
}

export async function workspaceEnsureReady(
  id: string,
): Promise<WorkspaceEnsureResult> {
  return ensureProjectWorkspaceReady(id);
}

export async function workspaceEnsureDefaultReady(): Promise<WorkspaceEnsureResult | null> {
  return ensureDefaultProjectWorkspaceReady();
}

/**
 * 更新 Provider 的环境变量
 *
 * 当用户在团队共享网关页面选择一个 API Key Provider 时调用
 * 会更新 ~/.claude/settings.json 和 shell 配置文件中的环境变量
 *
 * @param providerType Provider 类型（如 "anthropic", "openai", "gemini"）
 * @param apiHost Provider 的 API Host
 * @param apiKey 可选的 API Key
 */
// ============ API Compatibility Check ============

export interface ApiCheckResult {
  model: string;
  available: boolean;
  status: number;
  error_type: string | null;
  error_message: string | null;
  time_ms: number;
}

export interface ApiCompatibilityResult {
  provider: string;
  overall_status: string;
  checked_at: string;
  results: ApiCheckResult[];
  warnings: string[];
}

export async function checkApiCompatibility(
  provider: string,
): Promise<ApiCompatibilityResult> {
  return safeInvoke("check_api_compatibility", { provider });
}

// ============ Endpoint Provider Configuration ============

/**
 * 端点 Provider 配置
 * 为不同客户端类型配置不同的 LLM Provider
 */
export interface EndpointProvidersConfig {
  /** Cursor 客户端使用的 Provider */
  cursor?: string | null;
  /** Claude Code 客户端使用的 Provider */
  claude_code?: string | null;
  /** Codex 客户端使用的 Provider */
  codex?: string | null;
  /** Windsurf 客户端使用的 Provider */
  windsurf?: string | null;
  /** Kiro 客户端使用的 Provider */
  kiro?: string | null;
  /** 其他客户端使用的 Provider */
  other?: string | null;
}

/**
 * 获取端点 Provider 配置
 * @returns 端点 Provider 配置对象
 */
export async function getEndpointProviders(): Promise<EndpointProvidersConfig> {
  return safeInvoke("get_endpoint_providers");
}

/**
 * 设置端点 Provider 配置
 * @param clientType 客户端类型 (cursor, claude_code, codex, windsurf, kiro, other)
 * @param provider Provider 名称，传 null 表示使用默认 Provider
 * @returns 设置后的 Provider 名称
 */
export async function setEndpointProvider(
  clientType: string,
  provider: string | null,
): Promise<string> {
  return safeInvoke("set_endpoint_provider", {
    endpoint: clientType,
    provider,
  });
}

// Network Info
// ============ 实验室功能 API ============

/**
 * 获取实验室功能配置
 * @returns 实验室功能配置对象
 */
// ============ 记忆管理 API ============

/**
 * 获取记忆统计信息
 */
export async function getMemoryStats(): Promise<MemoryStatsResponse> {
  return safeInvoke("get_conversation_memory_stats");
}

/**
 * 获取记忆总览（含分类与条目）
 */
export async function requestMemoryAnalysis(
  fromTimestamp?: number,
  toTimestamp?: number,
): Promise<MemoryAnalysisResult> {
  return safeInvoke("request_conversation_memory_analysis", {
    fromTimestamp,
    toTimestamp,
  });
}

/**
 * 清理过期记忆
 */
export async function cleanupMemory(): Promise<CleanupMemoryResult> {
  return safeInvoke("cleanup_conversation_memory");
}

/**
 * 获取记忆来源解析结果
 */
// ============ 语音测试 API ============

export interface TtsTestResult {
  success: boolean;
  error: string | null;
  audio_path: string | null;
}

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
}

/**
 * 测试 TTS 语音合成
 * @param service TTS 服务名称
 * @param voice 语音 ID
 */
export async function testTts(
  service: string,
  voice: string,
): Promise<TtsTestResult> {
  return safeInvoke("test_tts", { service, voice });
}

/**
 * 获取可用的语音列表
 * @param service TTS 服务名称
 */
export async function getAvailableVoices(
  service: string,
): Promise<VoiceOption[]> {
  return safeInvoke("get_available_voices", { service });
}

// ============ 文件上传 API ============

export interface UploadResult {
  url: string;
  size: number;
}

/**
 * 上传用户头像
 * @param filePath 文件路径
 */
export async function uploadAvatar(filePath: string): Promise<UploadResult> {
  return safeInvoke("upload_avatar", { filePath });
}

/**
 * 删除用户头像
 * @param url 头像 URL
 */
export async function deleteAvatar(url: string): Promise<void> {
  return safeInvoke("delete_avatar", { url });
}
