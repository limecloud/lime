import { safeInvoke } from "@/lib/dev-bridge";
import type { Config, EnvironmentPreview } from "./appConfigTypes";

export type {
  Config,
  CrashReportingConfig,
  ChatAppearanceConfig,
  ContentCreatorConfig,
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
  ToolCallingConfig,
  UserProfile,
  VoiceConfig,
  AssistantConfig,
} from "./appConfigTypes";

export async function getConfig(): Promise<Config> {
  return safeInvoke("get_config");
}

export async function saveConfig(config: Config): Promise<void> {
  return safeInvoke("save_config", { config });
}

export async function getEnvironmentPreview(): Promise<EnvironmentPreview> {
  return safeInvoke("get_environment_preview");
}

export async function getDefaultProvider(): Promise<string> {
  return safeInvoke("get_default_provider");
}

export async function setDefaultProvider(provider: string): Promise<string> {
  return safeInvoke("set_default_provider", { provider });
}

export async function updateProviderEnvVars(
  providerType: string,
  apiHost: string,
  apiKey?: string,
): Promise<void> {
  return safeInvoke("update_provider_env_vars", {
    providerType,
    apiHost,
    apiKey: apiKey || null,
  });
}
