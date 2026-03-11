// 使用共享的 safeInvoke
import {
  ensureDefaultWorkspaceReady as ensureDefaultProjectWorkspaceReady,
  ensureWorkspaceReady as ensureProjectWorkspaceReady,
} from "@/lib/api/project";
import { revealPathInFinder } from "@/lib/api/fileSystem";
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
  CheckResult,
  ClaudeCustomStatus,
  CredentialEntry,
  EnvVariable,
  GeminiApiKeyEntry,
  GeminiCredentialStatus,
  KiroCredentialStatus,
  OpenAICustomStatus,
  QwenCredentialStatus,
  VertexApiKeyEntry,
  VertexModelAlias,
} from "@/lib/api/providerRuntime";
export type {
  ExperimentalFeatures,
  SmartInputConfig,
} from "@/lib/api/experimentalFeatures";
export type { ModelInfo } from "@/lib/api/modelCatalog";
export type {
  DailyUsage,
  ModelUsage,
  UsageStatsResponse,
} from "@/lib/api/usageStats";
export type {
  AutoMemoryIndexResponse,
  EffectiveMemorySourcesResponse,
  MemoryAutoConfig,
  MemoryAutoToggleResponse,
  MemoryConfig,
  MemoryOverviewResponse,
  MemoryProfileConfig,
  MemoryResolveConfig,
  MemorySourcesConfig,
} from "@/lib/api/memoryRuntime";
export type {
  ChannelsConfig,
  CloudflaredInstallResult,
  CloudflaredInstallStatus,
  DiscordBotConfig,
  DiscordProbeResult,
  FeishuBotConfig,
  FeishuProbeResult,
  GatewayChannelStatusResponse,
  GatewayConfig,
  GatewayTunnelCreateResponse,
  GatewayTunnelProbeResult,
  GatewayTunnelStatus,
  GatewayTunnelSyncWebhookResponse,
  TelegramBotConfig,
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

// TLS Configuration
export interface TlsConfig {
  enable: boolean;
  cert_path: string | null;
  key_path: string | null;
}

// Response Cache Configuration
export interface ResponseCacheConfig {
  enabled: boolean;
  ttl_secs: number;
  max_entries: number;
  max_body_bytes: number;
  cacheable_status_codes: number[];
}

// Remote Management Configuration
export interface RemoteManagementConfig {
  allow_remote: boolean;
  secret_key: string | null;
  disable_control_panel: boolean;
}

// Quota Exceeded Configuration
export interface QuotaExceededConfig {
  switch_project: boolean;
  switch_preview_model: boolean;
  cooldown_seconds: number;
}

// Amp Model Mapping
export interface AmpModelMapping {
  from: string;
  to: string;
}

// Amp CLI Configuration
export interface AmpConfig {
  upstream_url: string | null;
  model_mappings: AmpModelMapping[];
  restrict_management_to_localhost: boolean;
}

// Gemini API Key Entry
export interface GeminiApiKeyEntry {
  id: string;
  api_key: string;
  base_url: string | null;
  proxy_url: string | null;
  excluded_models: string[];
  disabled: boolean;
}

// Vertex Model Alias
export interface VertexModelAlias {
  name: string;
  alias: string;
}

// Vertex API Key Entry
export interface VertexApiKeyEntry {
  id: string;
  api_key: string;
  base_url: string | null;
  models: VertexModelAlias[];
  proxy_url: string | null;
  disabled: boolean;
}

// iFlow Credential Entry
export interface IFlowCredentialEntry {
  id: string;
  token_file: string | null;
  auth_type: string;
  cookies: string | null;
  proxy_url: string | null;
  disabled: boolean;
}

// Credential Entry (OAuth)
export interface CredentialEntry {
  id: string;
  token_file: string;
  disabled: boolean;
  proxy_url: string | null;
}

// Credential Pool Configuration
export interface CredentialPoolConfig {
  kiro: CredentialEntry[];
  gemini: CredentialEntry[];
  qwen: CredentialEntry[];
  openai: ApiKeyEntry[];
  claude: ApiKeyEntry[];
  gemini_api_keys: GeminiApiKeyEntry[];
  vertex_api_keys: VertexApiKeyEntry[];
  codex: CredentialEntry[];
  iflow: IFlowCredentialEntry[];
}

// API Key Entry
export interface ApiKeyEntry {
  id: string;
  api_key: string;
  base_url: string | null;
  disabled: boolean;
  proxy_url: string | null;
}

export interface MultiSearchEngineEntryConfig {
  name: string;
  url_template: string;
  enabled: boolean;
}

export interface MultiSearchConfig {
  priority?: string[];
  engines?: MultiSearchEngineEntryConfig[];
  max_results_per_engine?: number;
  max_total_results?: number;
  timeout_ms?: number;
}

// ============ 实验室功能配置 ============

/**
 * 截图对话功能配置
 */
export interface SmartInputConfig {
  /** 是否启用截图对话功能 */
  enabled: boolean;
  /** 触发截图的全局快捷键 */
  shortcut: string;
}

/**
 * 实验室功能配置
 */
export interface ExperimentalFeatures {
  /** 截图对话功能配置 */
  screenshot_chat: SmartInputConfig;
}

/**
 * Tool Calling 2.0 配置
 */
export interface ToolCallingConfig {
  /** 总开关 */
  enabled: boolean;
  /** 动态过滤（网页噪音过滤） */
  dynamic_filtering: boolean;
  /** 原生 input examples 透传 */
  native_input_examples: boolean;
}

/**
 * 内容创作配置
 */
export interface MediaGenerationPreferenceConfig {
  preferredProviderId?: string;
  preferredModelId?: string;
  allowFallback?: boolean;
}

export interface MediaGenerationDefaultsConfig {
  image?: MediaGenerationPreferenceConfig;
  video?: MediaGenerationPreferenceConfig;
  voice?: MediaGenerationPreferenceConfig;
}

export interface ContentCreatorConfig {
  /** 启用的主题列表 */
  enabled_themes: string[];
  /** 全局媒体生成默认设置 */
  media_defaults?: MediaGenerationDefaultsConfig;
}

/**
 * 导航栏配置
 */
export interface NavigationConfig {
  /** 启用的导航模块列表 */
  enabled_items: string[];
}

/**
 * 聊天外观配置
 */
export interface ChatAppearanceConfig {
  /** 字体大小 (12-18) */
  fontSize?: number;
  /** 消息过渡模式 */
  transitionMode?: "none" | "fadeIn" | "smooth";
  /** 气泡样式 */
  bubbleStyle?: "default" | "minimal" | "colorful";
  /** 显示头像 */
  showAvatar?: boolean;
  /** 显示时间戳 */
  showTimestamp?: boolean;
  /** 推荐点击时自动附带当前选中文本上下文 */
  append_selected_text_to_recommendation?: boolean;
}

/**
 * 记忆管理系统配置
 */
export interface MemoryProfileConfig {
  /** 当前学习/工作状态（单选） */
  current_status?: string;
  /** 擅长领域（多选） */
  strengths?: string[];
  /** 偏好的解释风格（多选） */
  explanation_style?: string[];
  /** 遇到难题时的偏好（多选） */
  challenge_preference?: string[];
}

/**
 * 记忆来源配置
 */
export interface MemorySourcesConfig {
  /** 组织级策略文件路径 */
  managed_policy_path?: string | null;
  /** 项目记忆文件（按目录层级向上发现） */
  project_memory_paths?: string[];
  /** 项目规则目录（按目录层级向上发现） */
  project_rule_dirs?: string[];
  /** 用户级记忆文件路径 */
  user_memory_path?: string | null;
  /** 项目本地记忆文件路径 */
  project_local_memory_path?: string | null;
}

/**
 * 自动记忆配置
 */
export interface MemoryAutoConfig {
  /** 是否启用自动记忆 */
  enabled?: boolean;
  /** 入口文件名 */
  entrypoint?: string;
  /** 启动时加载入口的最大行数 */
  max_loaded_lines?: number;
  /** 自动记忆根目录 */
  root_dir?: string | null;
}

/**
 * 记忆解析行为配置
 */
export interface MemoryResolveConfig {
  /** 额外目录（例如外部 workspace） */
  additional_dirs?: string[];
  /** 是否跟随 @import */
  follow_imports?: boolean;
  /** 最大导入深度 */
  import_max_depth?: number;
  /** 是否加载额外目录中的记忆来源 */
  load_additional_dirs_memory?: boolean;
}

/**
 * 记忆管理系统配置
 */
export interface MemoryConfig {
  /** 是否启用记忆功能 */
  enabled: boolean;
  /** 最大记忆条数 */
  max_entries?: number;
  /** 记忆保留天数 */
  retention_days?: number;
  /** 自动清理过期记忆 */
  auto_cleanup?: boolean;
  /** 记忆偏好画像 */
  profile?: MemoryProfileConfig;
  /** 记忆来源配置 */
  sources?: MemorySourcesConfig;
  /** 自动记忆配置 */
  auto?: MemoryAutoConfig;
  /** 记忆解析行为配置 */
  resolve?: MemoryResolveConfig;
}

/**
 * 语音服务配置
 */
export interface VoiceConfig {
  /** TTS 服务商 */
  tts_service?: "openai" | "azure" | "google" | "edge" | "macos";
  /** STT 服务商 */
  stt_service?: "openai" | "azure" | "google" | "whisper";
  /** TTS 语音 */
  tts_voice?: string;
  /** TTS 语速 (0.1-2.0) */
  tts_rate?: number;
  /** TTS 音调 (0.1-2.0) */
  tts_pitch?: number;
  /** TTS 音量 (0-1) */
  tts_volume?: number;
  /** STT 语言 */
  stt_language?: string;
  /** 自动停止录音 */
  stt_auto_stop?: boolean;
  /** 启用语音输入 */
  voice_input_enabled?: boolean;
  /** 启用语音输出 */
  voice_output_enabled?: boolean;
}

/**
 * 图像生成服务配置
 */
export interface ImageGenConfig {
  /** 默认图像生成服务 */
  default_service?: "dall_e" | "midjourney" | "stable_diffusion" | "flux";
  /** 默认图像数量 */
  default_count?: number;
  /** 默认图像尺寸 */
  default_size?:
    | "256x256"
    | "512x512"
    | "1024x1024"
    | "1792x1024"
    | "1024x1792";
  /** 默认图像质量 */
  default_quality?: "standard" | "hd";
  /** 默认图像风格 */
  default_style?: "vivid" | "natural";
  /** 启用图像增强 */
  enable_enhancement?: boolean;
  /** 自动下载生成的图像 */
  auto_download?: boolean;
  /** 图片搜索（Pexels）API Key */
  image_search_pexels_api_key?: string;
  /** 图片搜索（Pixabay）API Key */
  image_search_pixabay_api_key?: string;
}

/**
 * 助理配置
 */
export interface AssistantConfig {
  /** 默认助理 ID */
  default_assistant_id?: string;
  /** 自定义助理列表 */
  custom_assistants?: Array<{
    id: string;
    name: string;
    description?: string;
    model?: string;
    system_prompt?: string;
    temperature?: number;
    max_tokens?: number;
  }>;
  /** 启用助理自动选择 */
  auto_select?: boolean;
  /** 显示助理建议 */
  show_suggestions?: boolean;
}

/**
 * 用户资料配置
 */
export interface UserProfile {
  /** 用户头像 URL */
  avatar_url?: string;
  /** 昵称 */
  nickname?: string;
  /** 个人简介 */
  bio?: string;
  /** 邮箱 */
  email?: string;
  /** 偏好标签 */
  tags?: string[];
}

// ============ 渠道配置类型 ============

export interface TelegramBotConfig {
  enabled: boolean;
  bot_token: string;
  allowed_user_ids: string[];
  default_model?: string;
}

export interface DiscordBotConfig {
  enabled: boolean;
  bot_token: string;
  allowed_server_ids: string[];
  default_model?: string;
  default_account?: string;
  accounts?: Record<string, DiscordAccountConfig>;
  dm_policy?: string;
  allow_from?: string[];
  group_policy?: string;
  group_allow_from?: string[];
  groups?: Record<string, DiscordGuildConfig>;
  streaming?: string;
  reply_to_mode?: string;
  intents?: DiscordIntentsConfig;
  actions?: DiscordActionsConfig;
  thread_bindings?: DiscordThreadBindingsConfig;
  auto_presence?: DiscordAutoPresenceConfig;
  voice?: DiscordVoiceConfig;
  agent_components?: DiscordAgentComponentsConfig;
  ui?: DiscordUiConfig;
  exec_approvals?: DiscordExecApprovalsConfig;
  response_prefix?: string;
  ack_reaction?: string;
}

export interface DiscordAccountConfig {
  enabled?: boolean;
  name?: string;
  bot_token?: string;
  allowed_server_ids?: string[];
  default_model?: string;
  dm_policy?: string;
  allow_from?: string[];
  group_policy?: string;
  group_allow_from?: string[];
  groups?: Record<string, DiscordGuildConfig>;
  streaming?: string;
  reply_to_mode?: string;
  intents?: DiscordIntentsConfig;
  actions?: DiscordActionsConfig;
  thread_bindings?: DiscordThreadBindingsConfig;
  auto_presence?: DiscordAutoPresenceConfig;
  voice?: DiscordVoiceConfig;
  agent_components?: DiscordAgentComponentsConfig;
  ui?: DiscordUiConfig;
  exec_approvals?: DiscordExecApprovalsConfig;
  response_prefix?: string;
  ack_reaction?: string;
}

export interface DiscordGuildConfig {
  enabled?: boolean;
  require_mention?: boolean;
  group_policy?: string;
  allow_from?: string[];
  channels?: Record<string, DiscordChannelConfig>;
}

export interface DiscordChannelConfig {
  enabled?: boolean;
  require_mention?: boolean;
  group_policy?: string;
  allow_from?: string[];
}

export interface DiscordIntentsConfig {
  message_content?: boolean;
  guild_members?: boolean;
  presence?: boolean;
}

export interface DiscordActionsConfig {
  reactions?: boolean;
  messages?: boolean;
  threads?: boolean;
  moderation?: boolean;
  presence?: boolean;
}

export interface DiscordThreadBindingsConfig {
  enabled?: boolean;
  idle_hours?: number;
  max_age_hours?: number;
  spawn_subagent_sessions?: boolean;
  spawn_acp_sessions?: boolean;
}

export interface DiscordAutoPresenceConfig {
  enabled?: boolean;
  interval_ms?: number;
  min_update_interval_ms?: number;
  healthy_text?: string;
  degraded_text?: string;
  exhausted_text?: string;
}

export interface DiscordVoiceAutoJoinConfig {
  guild_id: string;
  channel_id: string;
}

export interface DiscordVoiceConfig {
  enabled?: boolean;
  auto_join?: DiscordVoiceAutoJoinConfig[];
  dave_encryption?: boolean;
  decryption_failure_tolerance?: number;
}

export interface DiscordAgentComponentsConfig {
  enabled?: boolean;
}

export interface DiscordUiComponentsConfig {
  accent_color?: string;
}

export interface DiscordUiConfig {
  components?: DiscordUiComponentsConfig;
}

export interface DiscordExecApprovalsConfig {
  enabled?: boolean;
  approvers?: string[];
  agent_filter?: string[];
  session_filter?: string[];
  cleanup_after_resolve?: boolean;
  target?: string;
}

export interface FeishuBotConfig {
  enabled: boolean;
  app_id: string;
  app_secret: string;
  verification_token?: string;
  encrypt_key?: string;
  default_model?: string;
  default_account?: string;
  accounts?: Record<string, FeishuAccountConfig>;
  domain?: string;
  connection_mode?: string;
  webhook_host?: string;
  webhook_port?: number;
  webhook_path?: string;
  dm_policy?: string;
  allow_from?: string[];
  group_policy?: string;
  group_allow_from?: string[];
  groups?: Record<string, FeishuGroupConfig>;
  streaming?: string;
  reply_to_mode?: string;
}

export interface FeishuGroupConfig {
  enabled?: boolean;
  require_mention?: boolean;
  group_policy?: string;
  allow_from?: string[];
}

export interface FeishuAccountConfig {
  enabled?: boolean;
  name?: string;
  app_id?: string;
  app_secret?: string;
  verification_token?: string;
  encrypt_key?: string;
  default_model?: string;
  domain?: string;
  connection_mode?: string;
  webhook_host?: string;
  webhook_port?: number;
  webhook_path?: string;
  dm_policy?: string;
  allow_from?: string[];
  group_policy?: string;
  group_allow_from?: string[];
  groups?: Record<string, FeishuGroupConfig>;
  streaming?: string;
  reply_to_mode?: string;
}

export interface CloudflareTunnelConfig {
  account_id?: string;
  tunnel_name?: string;
  tunnel_id?: string;
  run_token?: string;
  credentials_file?: string;
  dns_name?: string;
}

export interface GatewayTunnelConfig {
  enabled?: boolean;
  provider?: string;
  mode?: string;
  binary_path?: string;
  local_host?: string;
  local_port?: number;
  public_base_url?: string;
  cloudflare?: CloudflareTunnelConfig;
}

export interface GatewayConfig {
  tunnel?: GatewayTunnelConfig;
}

export interface ChannelsConfig {
  telegram: TelegramBotConfig;
  discord: DiscordBotConfig;
  feishu: FeishuBotConfig;
}

export interface CrashReportingConfig {
  enabled: boolean;
  dsn?: string | null;
  environment?: string;
  sample_rate?: number;
  send_pii?: boolean;
}

export interface ShellEnvironmentImportConfig {
  enabled: boolean;
  timeout_ms: number;
}

export interface EnvironmentVariableOverride {
  key: string;
  value: string;
  enabled: boolean;
}

export interface EnvironmentConfig {
  shell_import: ShellEnvironmentImportConfig;
  variables: EnvironmentVariableOverride[];
}

export interface EnvironmentPreviewEntry {
  key: string;
  value: string;
  maskedValue: string;
  source: string;
  sourceLabel: string;
  sensitive: boolean;
  overriddenSources: string[];
}

export interface ShellImportPreview {
  enabled: boolean;
  status: string;
  message: string;
  importedCount: number;
  durationMs?: number | null;
}

export interface EnvironmentPreview {
  shellImport: ShellImportPreview;
  entries: EnvironmentPreviewEntry[];
}

export interface Config {
  server: {
    host: string;
    port: number;
    api_key: string;
    tls: TlsConfig;
    response_cache: ResponseCacheConfig;
  };
  providers: {
    kiro: {
      enabled: boolean;
      credentials_path: string | null;
      region: string | null;
    };
    gemini: {
      enabled: boolean;
      credentials_path: string | null;
    };
    qwen: {
      enabled: boolean;
      credentials_path: string | null;
    };
    openai: {
      enabled: boolean;
      api_key: string | null;
      base_url: string | null;
    };
    claude: {
      enabled: boolean;
      api_key: string | null;
      base_url: string | null;
    };
  };
  default_provider: string;
  remote_management: RemoteManagementConfig;
  quota_exceeded: QuotaExceededConfig;
  ampcode: AmpConfig;
  credential_pool: CredentialPoolConfig;
  proxy_url: string | null;
  /** 关闭时最小化到托盘（而不是退出应用） */
  minimize_to_tray: boolean;
  /** 用户界面语言 ("zh" 或 "en") */
  language: string;
  /** 实验室功能配置 */
  experimental?: ExperimentalFeatures;
  /** Tool Calling 2.0 配置 */
  tool_calling?: ToolCallingConfig;
  /** 内容创作配置 */
  content_creator?: ContentCreatorConfig;
  /** 导航栏配置 */
  navigation?: NavigationConfig;
  /** 聊天外观配置 */
  chat_appearance?: ChatAppearanceConfig;
  /** 统一环境变量配置 */
  environment?: EnvironmentConfig;
  /** 网络搜索配置 */
  web_search?: {
    engine: "google" | "xiaohongshu";
    provider?:
      | "tavily"
      | "multi_search_engine"
      | "duckduckgo_instant"
      | "bing_search_api"
      | "google_custom_search";
    provider_priority?: Array<
      | "tavily"
      | "multi_search_engine"
      | "duckduckgo_instant"
      | "bing_search_api"
      | "google_custom_search"
    >;
    tavily_api_key?: string | null;
    bing_search_api_key?: string | null;
    google_search_api_key?: string | null;
    google_search_engine_id?: string | null;
    multi_search?: MultiSearchConfig;
  };
  /** 记忆管理配置 */
  memory?: MemoryConfig;
  /** 语音服务配置 */
  voice?: VoiceConfig;
  /** 图像生成服务配置 */
  image_gen?: ImageGenConfig;
  /** 助理配置 */
  assistant?: AssistantConfig;
  /** 用户资料 */
  user_profile?: UserProfile;
  /** Gateway 全局配置 */
  gateway?: GatewayConfig;
  /** 渠道配置（Telegram / Discord / 飞书 Bot） */
  channels?: ChannelsConfig;
  /** 崩溃上报配置（Sentry 协议兼容） */
  crash_reporting?: CrashReportingConfig;
}

export interface TelegramGatewayAccountStatus {
  account_id: string;
  running: boolean;
  bot_username?: string | null;
  started_at?: string | null;
  last_error?: string | null;
  last_update_id?: number | null;
  last_message_at?: string | null;
}

export interface TelegramGatewayStatus {
  running_accounts: number;
  accounts: TelegramGatewayAccountStatus[];
}

export interface FeishuGatewayAccountStatus {
  account_id: string;
  running: boolean;
  connection_mode: string;
  started_at?: string | null;
  last_error?: string | null;
  last_event_at?: string | null;
  last_message_at?: string | null;
  webhook_endpoint?: string | null;
}

export interface FeishuGatewayStatus {
  running_accounts: number;
  accounts: FeishuGatewayAccountStatus[];
}

export interface DiscordGatewayAccountStatus {
  account_id: string;
  running: boolean;
  connected: boolean;
  bot_id?: string | null;
  bot_username?: string | null;
  application_id?: string | null;
  message_content_intent?: string | null;
  started_at?: string | null;
  last_error?: string | null;
  last_event_at?: string | null;
  last_message_at?: string | null;
  last_disconnect?: string | null;
  reconnect_attempts?: number | null;
}

export interface DiscordGatewayStatus {
  running_accounts: number;
  accounts: DiscordGatewayAccountStatus[];
}

export interface GatewayChannelStatusResponse {
  channel: string;
  status: unknown;
}

export interface TelegramProbeResult {
  account_id: string;
  ok: boolean;
  bot_id?: number | null;
  username?: string | null;
  message: string;
}

export interface FeishuProbeResult {
  account_id: string;
  ok: boolean;
  app_id?: string | null;
  message: string;
}

export interface DiscordProbeResult {
  account_id: string;
  ok: boolean;
  bot_id?: string | null;
  username?: string | null;
  application_id?: string | null;
  message_content_intent?: string | null;
  message: string;
}

export interface GatewayTunnelStatus {
  running: boolean;
  provider: string;
  mode: string;
  binary: string;
  local_url: string;
  public_base_url?: string | null;
  pid?: number | null;
  started_at?: string | null;
  last_error?: string | null;
  last_exit?: string | null;
  command_preview?: string | null;
  connector_active?: boolean | null;
  connector_message?: string | null;
}

export interface GatewayTunnelProbeResult {
  ok: boolean;
  provider: string;
  mode: string;
  binary: string;
  version?: string | null;
  config_ready: boolean;
  message: string;
}

export interface CloudflaredInstallStatus {
  installed: boolean;
  binary: string;
  version?: string | null;
  platform: string;
  package_manager?: string | null;
  install_supported: boolean;
  install_command?: string | null;
  requires_privilege: boolean;
  message: string;
}

export interface CloudflaredInstallResult {
  ok: boolean;
  attempted: boolean;
  platform: string;
  package_manager?: string | null;
  command?: string | null;
  exit_code?: number | null;
  installed: boolean;
  version?: string | null;
  stdout: string;
  stderr: string;
  message: string;
}

export interface GatewayTunnelCreateResponse {
  result: {
    ok: boolean;
    tunnel_name: string;
    tunnel_id?: string | null;
    credentials_file?: string | null;
    dns_name?: string | null;
    public_base_url?: string | null;
    message: string;
  };
  status: GatewayTunnelStatus;
}

export interface GatewayTunnelSyncWebhookResponse {
  channel: string;
  account_id?: string | null;
  webhook_path: string;
  public_base_url: string;
  webhook_url: string;
  persisted: boolean;
}

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

export interface MemoryStatsResponse {
  total_entries: number;
  storage_used: number;
  memory_count: number;
}

export interface MemoryCategoryStat {
  category: "identity" | "context" | "preference" | "experience" | "activity";
  count: number;
}

export interface MemoryEntryPreview {
  id: string;
  session_id: string;
  file_type: string;
  category: "identity" | "context" | "preference" | "experience" | "activity";
  title: string;
  summary: string;
  updated_at: number;
  tags: string[];
}

export interface MemoryOverviewResponse {
  stats: MemoryStatsResponse;
  categories: MemoryCategoryStat[];
  entries: MemoryEntryPreview[];
}

export interface CleanupMemoryResult {
  cleaned_entries: number;
  freed_space: number;
}

export interface MemoryAnalysisResult {
  analyzed_sessions: number;
  analyzed_messages: number;
  generated_entries: number;
  deduplicated_entries: number;
}

export interface EffectiveMemorySource {
  kind: string;
  path: string;
  exists: boolean;
  loaded: boolean;
  line_count: number;
  import_count: number;
  warnings: string[];
  preview?: string | null;
}

export interface EffectiveMemorySourcesResponse {
  working_dir: string;
  total_sources: number;
  loaded_sources: number;
  follow_imports: boolean;
  import_max_depth: number;
  sources: EffectiveMemorySource[];
}

export interface AutoMemoryIndexItem {
  title: string;
  relative_path: string;
  exists: boolean;
  summary?: string | null;
}

export interface AutoMemoryIndexResponse {
  enabled: boolean;
  root_dir: string;
  entrypoint: string;
  max_loaded_lines: number;
  entry_exists: boolean;
  total_lines: number;
  preview_lines: string[];
  items: AutoMemoryIndexItem[];
}

export interface MemoryAutoToggleResponse {
  enabled: boolean;
}

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
