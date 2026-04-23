import type { ChannelsConfig, GatewayConfig } from "./channelsRuntimeTypes";
import type {
  ExperimentalFeatures,
  ToolCallingConfig,
} from "./experimentalFeatureTypes";
import type { MemoryConfig } from "./memoryRuntimeTypes";
import type { AmpConfig, CredentialPoolConfig } from "./providerRuntimeTypes";

export type { ToolCallingConfig } from "./experimentalFeatureTypes";

export interface TlsConfig {
  enable: boolean;
  cert_path: string | null;
  key_path: string | null;
}

export interface ResponseCacheConfig {
  enabled: boolean;
  ttl_secs: number;
  max_entries: number;
  max_body_bytes: number;
  cacheable_status_codes: number[];
}

export interface RemoteManagementConfig {
  allow_remote: boolean;
  secret_key: string | null;
  disable_control_panel: boolean;
}

export interface QuotaExceededConfig {
  switch_project: boolean;
  switch_preview_model: boolean;
  cooldown_seconds: number;
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

export interface ServiceModelPreferenceConfig {
  preferredProviderId?: string;
  preferredModelId?: string;
  enabled?: boolean;
  customPrompt?: string;
}

export interface ServiceModelsConfig {
  topic?: ServiceModelPreferenceConfig;
  generation_topic?: ServiceModelPreferenceConfig;
  translation?: ServiceModelPreferenceConfig;
  history_compress?: ServiceModelPreferenceConfig;
  agent_meta?: ServiceModelPreferenceConfig;
  input_completion?: ServiceModelPreferenceConfig;
  prompt_rewrite?: ServiceModelPreferenceConfig;
  resource_prompt_rewrite?: ServiceModelPreferenceConfig;
}

export interface CompanionDefaultsConfig {
  general?: MediaGenerationPreferenceConfig;
  tts?: MediaGenerationPreferenceConfig;
}

export interface WorkspacePreferencesConfig {
  schema_version?: number;
  media_defaults?: MediaGenerationDefaultsConfig;
  companion_defaults?: CompanionDefaultsConfig;
  service_models?: ServiceModelsConfig;
}

export type NavigationEnabledItemId = "plugins" | "openclaw" | "companion";

export interface NavigationConfig {
  schema_version?: number;
  enabled_items: NavigationEnabledItemId[];
}

export interface ChatAppearanceConfig {
  fontSize?: number;
  transitionMode?: "none" | "fadeIn" | "smooth";
  bubbleStyle?: "default" | "minimal" | "colorful";
  showAvatar?: boolean;
  showTimestamp?: boolean;
  append_selected_text_to_recommendation?: boolean;
}

export interface DeveloperConfig {
  workspace_harness_enabled?: boolean;
}

export interface ImageGenConfig {
  default_service?: "dall_e" | "midjourney" | "stable_diffusion" | "flux";
  default_count?: number;
  default_size?:
    | "256x256"
    | "512x512"
    | "1024x1024"
    | "1792x1024"
    | "1024x1792";
  default_quality?: "standard" | "hd";
  default_style?: "vivid" | "natural";
  enable_enhancement?: boolean;
  auto_download?: boolean;
  image_search_pexels_api_key?: string;
  image_search_pixabay_api_key?: string;
}

export interface UserProfile {
  avatar_url?: string;
  nickname?: string;
  bio?: string;
  email?: string;
  tags?: string[];
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
  minimize_to_tray: boolean;
  language: string;
  experimental?: ExperimentalFeatures;
  tool_calling?: ToolCallingConfig;
  workspace_preferences?: WorkspacePreferencesConfig;
  navigation?: NavigationConfig;
  chat_appearance?: ChatAppearanceConfig;
  environment?: EnvironmentConfig;
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
  memory?: MemoryConfig;
  image_gen?: ImageGenConfig;
  user_profile?: UserProfile;
  developer?: DeveloperConfig;
  gateway?: GatewayConfig;
  channels?: ChannelsConfig;
  crash_reporting?: CrashReportingConfig;
}
