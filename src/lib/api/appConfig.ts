import { safeInvoke } from "@/lib/dev-bridge";
import type {
  Config,
  EnvironmentPreview,
} from "@/hooks/useTauri";

export type {
  Config,
  CrashReportingConfig,
  EnvironmentConfig,
  EnvironmentPreview,
  EnvironmentPreviewEntry,
  EnvironmentVariableOverride,
  ShellImportPreview,
  ToolCallingConfig,
} from "@/hooks/useTauri";

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
