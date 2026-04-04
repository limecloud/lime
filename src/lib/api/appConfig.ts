import { safeInvoke } from "@/lib/dev-bridge";
import type { Config, EnvironmentPreview } from "./appConfigTypes";

const APP_CONFIG_CHANGE_STAMP_KEY = "lime.app-config.changed-at";
const APP_CONFIG_CHANGED_EVENT = "lime:app-config-changed";

let configCache: Config | null = null;
let configLoadingPromise: Promise<Config> | null = null;
let configCacheStamp: string | null = null;

export type {
  CompanionDefaultsConfig,
  Config,
  CrashReportingConfig,
  ChatAppearanceConfig,
  DeveloperConfig,
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
  WorkspacePreferencesConfig,
} from "./appConfigTypes";

interface GetConfigOptions {
  forceRefresh?: boolean;
}

function cloneConfig(config: Config): Config {
  if (typeof structuredClone === "function") {
    return structuredClone(config);
  }
  return JSON.parse(JSON.stringify(config)) as Config;
}

function readAppConfigChangeStamp(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(APP_CONFIG_CHANGE_STAMP_KEY);
  } catch {
    return null;
  }
}

function markAppConfigChanged(): string | null {
  const nextStamp = String(Date.now());

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(APP_CONFIG_CHANGE_STAMP_KEY, nextStamp);
    } catch {
      // ignore
    }

    try {
      window.dispatchEvent(new CustomEvent(APP_CONFIG_CHANGED_EVENT));
    } catch {
      // ignore
    }
  }

  return nextStamp;
}

function invalidateConfigCache(): void {
  configCache = null;
  configLoadingPromise = null;
  configCacheStamp = null;
}

export function invalidateAppConfigCache(): void {
  invalidateConfigCache();
}

export function subscribeAppConfigChanged(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleCustomChange = () => {
    listener();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === APP_CONFIG_CHANGE_STAMP_KEY) {
      listener();
    }
  };

  window.addEventListener(APP_CONFIG_CHANGED_EVENT, handleCustomChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(APP_CONFIG_CHANGED_EVENT, handleCustomChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export async function getConfig(
  options: GetConfigOptions = {},
): Promise<Config> {
  if (options.forceRefresh) {
    invalidateConfigCache();
  }

  const currentStamp = readAppConfigChangeStamp();
  if (configCache && configCacheStamp !== currentStamp) {
    invalidateConfigCache();
  }

  if (configCache) {
    return cloneConfig(configCache);
  }

  if (!configLoadingPromise) {
    configLoadingPromise = safeInvoke<Config>("get_config")
      .then((config) => {
        configCache = cloneConfig(config);
        configCacheStamp = readAppConfigChangeStamp();
        return configCache;
      })
      .finally(() => {
        configLoadingPromise = null;
      });
  }

  return cloneConfig(await configLoadingPromise);
}

export async function saveConfig(config: Config): Promise<void> {
  await safeInvoke("save_config", { config });
  configCache = cloneConfig(config);
  configCacheStamp = markAppConfigChanged();
}

export async function getEnvironmentPreview(): Promise<EnvironmentPreview> {
  return safeInvoke("get_environment_preview");
}

export async function getDefaultProvider(): Promise<string> {
  return safeInvoke("get_default_provider");
}

export async function setDefaultProvider(provider: string): Promise<string> {
  const nextProvider = await safeInvoke<string>("set_default_provider", {
    provider,
  });

  if (configCache) {
    configCache = {
      ...cloneConfig(configCache),
      default_provider: nextProvider,
    };
  }
  configCacheStamp = markAppConfigChanged();
  return nextProvider;
}

export async function updateProviderEnvVars(
  providerType: string,
  apiHost: string,
  apiKey?: string,
): Promise<void> {
  await safeInvoke("update_provider_env_vars", {
    providerType,
    apiHost,
    apiKey: apiKey || null,
  });
  invalidateConfigCache();
  configCacheStamp = markAppConfigChanged();
}
