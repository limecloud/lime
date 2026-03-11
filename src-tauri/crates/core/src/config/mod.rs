//! 配置管理模块
//!
//! 提供 YAML 配置文件支持、热重载和配置导入导出功能
//! 同时保持与旧版 JSON 配置的向后兼容性

#![allow(unused_imports)]

mod export;
mod hot_reload;
mod import;
mod path_utils;
mod types;
mod yaml;

pub use export::{ExportBundle, ExportOptions, ExportService, REDACTED_PLACEHOLDER};
pub use hot_reload::{
    ConfigChangeEvent as FileChangeEvent, ConfigChangeKind, FileWatcher, HotReloadManager,
    ReloadResult,
};
pub use import::{ImportOptions, ImportService, ValidationResult};
pub use path_utils::{collapse_tilde, contains_tilde, expand_tilde};
pub use types::{
    generate_secure_api_key, AmpConfig, AmpModelMapping, ApiKeyEntry, AsrCredentialEntry,
    AsrProviderType, AssistantConfig, AssistantProfile, BaiduConfig, ChannelsConfig,
    ChatAppearanceConfig, CloudflareTunnelConfig, Config, ContentCreatorConfig,
    ConversationSettings, CrashReportingConfig, CredentialEntry, CredentialPoolConfig,
    CustomProviderConfig, DeliveryConfig, DiscordAccountConfig, DiscordActionsConfig,
    DiscordAgentComponentsConfig, DiscordAutoPresenceConfig, DiscordBotConfig,
    DiscordChannelConfig, DiscordExecApprovalsConfig, DiscordGuildConfig, DiscordIntentsConfig,
    DiscordThreadBindingsConfig, DiscordUiComponentsConfig, DiscordUiConfig,
    DiscordVoiceAutoJoinConfig, DiscordVoiceConfig, EndpointProvidersConfig, EnvironmentConfig,
    EnvironmentVariableOverride, ExperimentalFeatures, FeishuAccountConfig, FeishuBotConfig,
    FeishuGroupConfig, GatewayConfig, GatewayTunnelConfig, GeminiApiKeyEntry,
    HeartbeatExecutionMode, HeartbeatSecurityConfig, HeartbeatSettings, HintRouteSettingsEntry,
    HintRouterSettings, ImageGenConfig, InjectionRuleConfig, InjectionSettings, LoggingConfig,
    MemoryAutoConfig, MemoryConfig, MemoryProfileConfig, MemoryResolveConfig, MemorySourcesConfig,
    ModelInfo, ModelsConfig, MultiSearchConfig, MultiSearchEngineEntryConfig, NativeAgentConfig,
    NavigationConfig, OpenAIAsrConfig, PairingSettings, ProviderConfig, ProviderModelsConfig,
    ProvidersConfig, QuotaExceededConfig, RateLimitSettings, RemoteManagementConfig,
    ResponseCacheSettings, RetrySettings, RoutingConfig, ScreenshotChatConfig, SearchEngine,
    ServerConfig, ShellEnvironmentImportConfig, TaskSchedule, TelegramAccountConfig,
    TelegramBotConfig, TelegramGroupConfig, TelegramTopicConfig, TlsConfig, ToolCallingConfig,
    UpdateCheckConfig, UserProfile, VertexApiKeyEntry, VertexModelAlias, VoiceConfig,
    VoiceInputConfig, VoiceInstruction, VoiceOutputConfig, VoiceOutputMode, VoiceProcessorConfig,
    WebSearchConfig, WebSearchProvider, WhisperLocalConfig, WhisperModelSize,
    WorkspaceSandboxConfig, XunfeiConfig, DEFAULT_API_KEY,
};
pub use yaml::{load_config, save_config, ConfigError, ConfigManager, YamlService};
