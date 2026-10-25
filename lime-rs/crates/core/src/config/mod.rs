//! 配置管理模块
//!
//! 提供 YAML 配置文件支持、热重载和配置导入导出功能
//! 同时保持与旧版 JSON 配置的向后兼容性

#![allow(unused_imports)]

mod application_requirements;
mod application_storage_requirements;
mod browser;
mod browser_computer_use_requirements;
mod browser_use;
mod browser_use_validation;
mod computer_use;
mod computer_use_validation;
mod desktop;
mod export;
mod features;
pub use features::FeaturesToml;
mod file_lock;
mod git;
mod hot_reload;
mod import;
mod in_app_browser_requirements;
pub mod managed;
mod output;
mod path_utils;
mod permissions;
mod shell_environment_policy;
mod persistence;
mod plugins;
mod tool_execution;
mod tools;
mod tui_keymap;
mod types;
mod worktrees;
mod yaml;

pub use application_requirements::{
    ApplicationNetworkRequirementsToml, ApplicationRequirementsToml,
};
pub use application_storage_requirements::ApplicationStorageRequirementsToml;
pub use browser::{
    BrowserAnnotationScreenshot, BrowserApprovalMode, BrowserConfig, BrowserHistoryAccess,
};
pub use browser_computer_use_requirements::{
    AllowDenyRequirementToml, BrowserUseAccessApprovalLifetimeToml,
    BrowserUseExtensionRequirementsToml, BrowserUseOriginPolicyToml, BrowserUseRequirementsToml,
    ComputerUseMacosRequirementsToml, ComputerUseRequirementsToml,
    ComputerUseWindowsExeRequirementToml, ComputerUseWindowsRequirementsToml,
    RequestHeaderToml,
};
pub use browser_use::{BrowserUseConfigToml, BrowserUseOriginPolicyConfigToml};
pub use computer_use::{
    ComputerUseConfigToml, ComputerUseMacosConfigToml, ComputerUseWindowsConfigToml,
    ComputerUseWindowsExeConfigToml,
};
pub use desktop::{
    ComposerEnterBehavior, DesktopConfig, ExternalBrowserLinkShortcut, LinkOpenTarget, ReasoningEffort,
};
pub use export::{ExportBundle, ExportOptions, ExportService, REDACTED_PLACEHOLDER};
pub use file_lock::config_file_lock;
pub use git::{GitConfig, PullRequestMergeMethod, ReviewDeliveryPreference};
pub use hot_reload::{
    ConfigChangeEvent as FileChangeEvent, ConfigChangeKind, FileWatcher, HotReloadManager,
    ReloadResult,
};
pub use import::{ImportOptions, ImportService, ValidationResult};
pub use in_app_browser_requirements::InAppBrowserRequirementsToml;
pub use output::{ModelVerbosity, ReasoningSummary};
pub use path_utils::{collapse_tilde, contains_tilde, expand_tilde};
pub use permissions::{ApprovalPolicy, SandboxMode, SandboxWorkspaceWrite};
pub use shell_environment_policy::ShellEnvironmentPolicyToml;
pub use plugins::{
    MarketplaceConfig, MarketplaceSourceType, PluginConfig, PluginsConfig, PluginsDefaultConfig,
};
pub use tool_execution::{
    ToolExecutionCommandRiskLevelConfig, ToolExecutionCommandRuleConfig,
    ToolExecutionCommandRuleMatchTypeConfig, ToolExecutionNetworkRuleConfig,
    ToolExecutionNetworkRuleTargetConfig, ToolExecutionOverrideConfig, ToolExecutionPolicyConfig,
    ToolExecutionRestrictionProfileConfig, ToolExecutionSandboxProfileConfig,
    ToolExecutionWarningPolicyConfig,
};
pub use tools::{ExperimentalRequestUserInput, ToolsConfig};
pub use tui_keymap::{
    KeybindingSpec, KeybindingsSpec, RightClickPaste, TuiAgentsKeymap, TuiConfig, TuiEditorKeymap,
    TuiGlobalKeymap, TuiKeymap, TuiListKeymap, TuiPagerKeymap, TuiVimNormalKeymap,
    TuiVimOperatorKeymap, TuiVimSearchKeymap, TuiVimTextObjectKeymap, MAX_FUNCTION_KEY,
};
pub use types::{
    generate_secure_api_key, AmpConfig, AmpModelMapping, ApiKeyEntry, AsrCredentialEntry,
    AsrProviderType, AutomationExecutionMode, AutomationSettings, BaiduConfig, ChannelsConfig,
    ChatAppearanceConfig, CloudflareTunnelConfig, Config, ConversationSettings,
    CrashReportingConfig, CredentialEntry, CredentialPoolConfig, CustomProviderConfig,
    DeliveryConfig, DiscordAccountConfig, DiscordActionsConfig, DiscordAgentComponentsConfig,
    DiscordAutoPresenceConfig, DiscordBotConfig, DiscordChannelConfig, DiscordExecApprovalsConfig,
    DiscordGuildConfig, DiscordIntentsConfig, DiscordThreadBindingsConfig,
    DiscordUiComponentsConfig, DiscordUiConfig, DiscordVoiceAutoJoinConfig, DiscordVoiceConfig,
    EndpointProvidersConfig, EnvironmentConfig, EnvironmentVariableOverride, ExperimentalFeatures,
    FeishuAccountConfig, FeishuBotConfig, FeishuGroupConfig, GatewayConfig, GatewayTunnelConfig,
    GeminiApiKeyEntry, HintRouteSettingsEntry, HintRouterSettings, ImageGenConfig,
    InjectionRuleConfig, InjectionSettings, LoggingConfig, MemoryAutoConfig, MemoryConfig,
    MemoryEmbeddingConfig, MemoryEmbeddingProvider, MemoryProfileConfig, MemoryResolveConfig,
    MemorySoulArtifactVoiceConfig, MemorySoulArtifactVoiceSource, MemorySoulConfig,
    MemorySoulImportSource, MemorySoulStyleProfileId, MemorySourcesConfig, ModelInfo, ModelsConfig,
    NativeAgentConfig, NavigationConfig, OpenAIAsrConfig, OrchestratorConfig,
    OrchestratorFeatureConfig, PairingSettings, PermissionFilesystemConfig,
    PermissionNetworkConfig, PermissionProfileConfig, ProviderConfig, ProviderModelsConfig,
    ProvidersConfig, QuotaExceededConfig, RateLimitSettings, RemoteManagementConfig,
    ResponseCacheSettings, RetrySettings, RolloutBudgetConfig, RoutingConfig,
    SenseVoiceLocalConfig, ServerConfig, ShellEnvironmentImportConfig, SkillConfig, SkillsConfig,
    TaskSchedule, TelegramAccountConfig, TelegramBotConfig, TelegramGroupConfig,
    TelegramTopicConfig, TlsConfig, UpdateCheckConfig, UserProfile, VertexApiKeyEntry,
    VertexModelAlias, VoiceInputConfig, VoiceInstruction, VoiceOutputConfig, VoiceOutputMode,
    VoiceProcessorConfig, WechatAccountConfig, WechatBotConfig, WechatGroupConfig,
    WhisperLocalConfig, WhisperModelSize, WindowsSandboxMode, WorkspacePreferencesConfig,
    WorkspaceSandboxConfig, XunfeiConfig, DEFAULT_API_KEY,
};
pub use worktrees::{UpstreamRefreshMode, WorktreeConfig};
pub use yaml::{load_config, save_config, ConfigError, ConfigManager, YamlService};

pub mod layers;
pub mod requirements;
