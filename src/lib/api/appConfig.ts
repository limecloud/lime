import { safeInvoke } from "@/lib/dev-bridge";
import {
  METHOD_CONFIG_BATCH_WRITE,
  METHOD_CONFIG_READ,
  METHOD_CONFIG_VALUE_WRITE,
  METHOD_MODEL_LIST,
  type ConfigBatchWriteParams,
  type ConfigLayer,
  type ConfigReadResponse,
  type ConfigWriteResponse,
  type ModelListResponse,
} from "@limecloud/app-server-client";
import {
  MODEL_REASONING_EFFORTS,
  type KnownModelReasoningEffort,
} from "@/lib/model/modelReasoningPolicy";
import { enabledReasoningEfforts } from "@/lib/model/reasoningEffortPreferences";
import {
  CURRENT_SIDEBAR_NAV_SCHEMA_VERSION,
  type Config,
} from "./appConfigTypes";
import { AppServerClient } from "./appServer";
import { assertNotDiagnosticFacade } from "./diagnosticFacade";
import { isManagedSource, managedConfigPaths } from "./configLayers";

const APP_CONFIG_CHANGE_STAMP_KEY = "lime.app-config.changed-at";
const APP_CONFIG_CHANGED_EVENT = "lime:app-config-changed";

interface CachedConfig {
  config: Config;
  layer: ConfigLayer;
  origins: ConfigReadResponse["origins"];
  layers: ConfigLayer[];
}

let configCache: CachedConfig | null = null;
let configLoadingPromise: Promise<CachedConfig> | null = null;
let configCacheStamp: string | null = null;
let configCacheGeneration = 0;
let configMutationTail: Promise<void> = Promise.resolve();
const projectWriteVersions = new Map<
  string,
  { current: string; ancestors: Set<string> }
>();

export type ConfigUpdater = (current: Config) => Config;

export interface AppConfigSnapshot {
  config: Config;
  layers?: ConfigLayer[];
  layer: ConfigLayer & {
    name: { type: "user"; file: string; profile?: string | null };
  };
  origins: ConfigReadResponse["origins"];
}

export type {
  Config,
  CrashReportingConfig,
  ChatAppearanceConfig,
  EnvironmentConfig,
  EnvironmentVariableOverride,
  ImageGenConfig,
  NavigationConfig,
  NativeAgentConfig,
  OrchestratorConfig,
  OrchestratorFeatureConfig,
  QuotaExceededConfig,
  RemoteManagementConfig,
  ResponseCacheConfig,
  RolloutBudgetConfig,
  ServiceModelPreferenceConfig,
  ServiceModelsConfig,
  TlsConfig,
  ToolExecutionCommandRiskLevelConfig,
  ToolExecutionCommandRuleConfig,
  ToolExecutionCommandRuleMatchTypeConfig,
  ToolExecutionNetworkRuleConfig,
  ToolExecutionNetworkRuleTargetConfig,
  ToolExecutionOverrideConfig,
  ToolExecutionPolicyConfig,
  ToolExecutionRestrictionProfileConfig,
  ToolExecutionSandboxProfileConfig,
  ToolExecutionWarningPolicyConfig,
  TuiConfig,
  UserProfile,
  WorkspacePreferencesConfig,
  WorkspaceSandboxConfig,
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

function normalizeConfig(config: Config): Config {
  const nextConfig = cloneConfig(config);
  const navigation = nextConfig.navigation;

  if (navigation) {
    nextConfig.navigation = {
      ...navigation,
      schema_version: CURRENT_SIDEBAR_NAV_SCHEMA_VERSION,
      enabled_items: [],
    };
  }

  return nextConfig;
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
  ++configCacheGeneration;
}

function assertNonEmptyString(
  command: string,
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${command} 未返回有效${label}`);
  }
}

function assertConfigShape(value: unknown): asserts value is Config {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("config/read 未返回有效配置");
  }

  const defaultProvider = (value as { default_provider?: unknown })
    .default_provider;
  if (
    typeof defaultProvider !== "string" ||
    defaultProvider.trim().length === 0
  ) {
    throw new Error("config/read 未返回有效配置");
  }
  for (const key of [
    "show_raw_agent_reasoning",
    "hide_agent_reasoning",
  ] as const) {
    const flag = (value as Record<string, unknown>)[key];
    if (flag !== undefined && typeof flag !== "boolean") {
      throw new Error(`config/read returned invalid ${key}`);
    }
  }
}

function readConfigVersion(response: ConfigReadResponse): string {
  const layers = response.layers;
  const users = layers?.filter((layer) => layer.name.type === "user");
  if (!users || users.length !== 1) {
    throw new Error("config/read 未返回唯一 Desktop 用户配置层");
  }
  const version = users[0]?.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("config/read 未返回有效配置版本");
  }
  return version;
}

function configValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildConfigEdits(
  current: Config,
  next: Config,
  origins: ConfigReadResponse["origins"],
): ConfigBatchWriteParams["edits"] {
  const paths = managedConfigPaths(origins);
  const edits: ConfigBatchWriteParams["edits"] = [];
  function append(
    keyPath: string,
    before: unknown,
    value: unknown,
    originPath = keyPath,
  ) {
    if (configValuesEqual(before, value)) return;
    if (
      paths.some((path) => path.startsWith(`${originPath}.`)) &&
      before &&
      value &&
      typeof before === "object" &&
      typeof value === "object" &&
      !Array.isArray(before) &&
      !Array.isArray(value)
    ) {
      // 混合受管理字段的表只提交变化子项，避免把 effective 值写回 User。
      const previous = before as Record<string, unknown>;
      const next = value as Record<string, unknown>;
      for (const key of new Set([
        ...Object.keys(previous),
        ...Object.keys(next),
      ])) {
        const childPath = `${originPath}.${key}`;
        const present = Object.hasOwn(next, key);
        if (
          !present &&
          paths.some(
            (path) => path === childPath || path.startsWith(`${childPath}.`),
          )
        )
          continue;
        append(
          `${keyPath}.${JSON.stringify(key)}`,
          previous[key],
          present ? next[key] : null,
          childPath,
        );
      }
    } else edits.push({ keyPath, value, mergeStrategy: "replace" });
  }
  Object.entries(next)
    .filter(([key, value]) => {
      return !configValuesEqual(
        (current as unknown as Record<string, unknown>)[key],
        value,
      );
    })
    .forEach(([key, value]) =>
      append(key, (current as unknown as Record<string, unknown>)[key], value),
    );
  return edits;
}

function assertConfigWriteResponse(
  value: unknown,
): asserts value is ConfigWriteResponse {
  const response = value as Partial<ConfigWriteResponse> | null;
  if (
    !response ||
    response.status !== "ok" ||
    typeof response.version !== "string" ||
    response.version.length === 0 ||
    typeof response.filePath !== "string" ||
    response.filePath.length === 0
  ) {
    throw new Error("config/batchWrite 未返回有效写入结果");
  }
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

async function readConfigCache(
  options: GetConfigOptions = {},
): Promise<CachedConfig> {
  if (options.forceRefresh) {
    invalidateConfigCache();
  }

  const currentStamp = readAppConfigChangeStamp();
  if (configCache && configCacheStamp !== currentStamp) {
    invalidateConfigCache();
  }

  if (configCache) {
    return configCache;
  }

  if (!configLoadingPromise) {
    const generation = configCacheGeneration;
    const pending = new AppServerClient()
      .request<ConfigReadResponse>(METHOD_CONFIG_READ, {
        includeLayers: true,
      })
      .then((response) => {
        assertConfigShape(response.result.config);
        readConfigVersion(response.result);
        const loaded = {
          config: normalizeConfig(response.result.config),
          layer: response.result.layers!.find(
            (layer) => layer.name.type === "user",
          )!,
          origins: response.result.origins ?? {},
          layers: response.result.layers!,
        };
        if (configCacheGeneration === generation) {
          configCache = loaded;
          configCacheStamp = readAppConfigChangeStamp();
        }
        return loaded;
      })
      .finally(() => {
        if (configLoadingPromise === pending) configLoadingPromise = null;
      });
    configLoadingPromise = pending;
  }

  return await configLoadingPromise;
}

export async function getConfig(
  options: GetConfigOptions = {},
): Promise<Config> {
  return cloneConfig((await readConfigCache(options)).config);
}

export function configLayerFile(layer: ConfigLayer): string | null {
  if (
    layer.name.type === "user" ||
    layer.name.type === "system" ||
    layer.name.type === "legacyManagedConfigTomlFromFile"
  )
    return layer.name.file;
  if (layer.name.type === "project")
    return `${layer.name.dotLimeFolder.replace(/[\\/]$/, "")}/config.toml`;
  return null;
}

export async function getConfigSnapshot(
  options: { cwd?: string } = {},
): Promise<AppConfigSnapshot> {
  const snapshot = options.cwd
    ? await (async () => {
        const { result } =
          await new AppServerClient().request<ConfigReadResponse>(
            METHOD_CONFIG_READ,
            {
              includeLayers: true,
              cwd: options.cwd,
            },
          );
        assertConfigShape(result.config);
        readConfigVersion(result);
        const layers = result.layers!;
        return {
          config: result.config as Config,
          layer: layers.find((layer) => layer.name.type === "user")!,
          origins: result.origins ?? {},
          layers,
        };
      })()
    : await readConfigCache({ forceRefresh: true });
  const { layer } = snapshot;
  if (!layer || layer.name?.type !== "user" || !layer.name.file?.trim()) {
    invalidateConfigCache();
    throw new Error("config/read 未返回有效用户配置来源");
  }
  return {
    config: cloneConfig(snapshot.config),
    layers: structuredClone(snapshot.layers),
    layer: structuredClone(layer) as AppConfigSnapshot["layer"],
    origins: structuredClone(snapshot.origins),
  };
}

export async function saveConfig(config: Config): Promise<void> {
  const normalizedConfig = normalizeConfig(config);
  const snapshot = await readConfigCache();
  const currentConfig = cloneConfig(snapshot.config);
  const expectedVersion = snapshot.layer.version;
  if (!expectedVersion) {
    invalidateConfigCache();
    throw new Error("config/read 未提供保存所需的配置版本");
  }
  const edits = buildConfigEdits(
    currentConfig,
    normalizedConfig,
    snapshot.origins,
  );
  if (edits.length === 0) {
    return;
  }

  let result: ConfigWriteResponse;
  try {
    const response = await new AppServerClient().request<ConfigWriteResponse>(
      METHOD_CONFIG_BATCH_WRITE,
      {
        edits,
        expectedVersion,
        reloadUserConfig: true,
      },
    );
    assertConfigWriteResponse(response.result);
    result = response.result;
  } catch (error) {
    invalidateConfigCache();
    throw error;
  }
  if (snapshot.layers.some((layer) => isManagedSource(layer.name))) {
    invalidateConfigCache();
    markAppConfigChanged();
    await readConfigCache();
    return;
  }
  const saved = cloneConfig({
    ...currentConfig,
    ...normalizedConfig,
  });
  invalidateConfigCache();
  configCache = {
    config: saved,
    layer: {
      ...snapshot.layer,
      config: cloneConfig(saved),
      version: result.version,
    },
    origins: snapshot.origins,
    layers: snapshot.layers.map((layer) =>
      layer === snapshot.layer
        ? { ...layer, config: cloneConfig(saved), version: result.version }
        : layer,
    ),
  };
  configCacheStamp = markAppConfigChanged();
}

function enqueueConfigMutation<T>(operation: () => Promise<T>): Promise<T> {
  const mutation = configMutationTail.then(operation);
  configMutationTail = mutation.then(
    () => undefined,
    () => undefined,
  );
  return mutation;
}

export function updateConfig(updater: ConfigUpdater): Promise<Config> {
  return enqueueConfigMutation(async () => {
    const currentConfig = await getConfig();
    await saveConfig(updater(currentConfig));
    return await getConfig();
  });
}

export function writeReasoningEffortPreferences(
  value: readonly KnownModelReasoningEffort[],
): Promise<AppConfigSnapshot> {
  return enqueueConfigMutation(async () => {
    // 默认值始终读取 User 层，不能使用当前选中的项目 scope。
    let snapshot = await getConfigSnapshot();
    const filePath = snapshot.layer.name.file;
    const current = snapshot.config.model_reasoning_effort;
    if (
      (current === "max" || current === "ultra") &&
      enabledReasoningEfforts(
        snapshot.config.desktop?.["enabled-reasoning-efforts"],
      ).includes(current) &&
      !value.includes(current)
    ) {
      const { result } = await new AppServerClient().request<ModelListResponse>(
        METHOD_MODEL_LIST,
        {},
      );
      const fallback = result.data.find(
        (model) => model.isDefault,
      )?.defaultReasoningEffort;
      if (MODEL_REASONING_EFFORTS.some((effort) => effort === fallback)) {
        snapshot = await writeConfigValueNow({
          keyPath: "model_reasoning_effort",
          value: fallback,
          filePath,
          expectedVersion: snapshot.layer.version,
        });
      }
    }
    return await writeConfigValueNow({
      keyPath: "desktop.enabled-reasoning-efforts",
      value,
      filePath,
      expectedVersion: snapshot.layer.version,
    });
  });
}

interface ConfigValueWriteOptions {
  keyPath: string;
  value: unknown;
  filePath: string;
  cwd?: string;
  expectedVersion?: string;
}

export function writeConfigValue(
  input: ConfigValueWriteOptions,
): Promise<AppConfigSnapshot> {
  return enqueueConfigMutation(() => writeConfigValueNow(input));
}

async function writeConfigValueNow({
  keyPath,
  value,
  filePath,
  cwd,
  expectedVersion,
}: ConfigValueWriteOptions): Promise<AppConfigSnapshot> {
  const snapshot = await getConfigSnapshot(cwd ? { cwd } : undefined);
  const layer = (snapshot.layers ?? [snapshot.layer]).find(
    (layer) => configLayerFile(layer) === filePath,
  );
  if (
    !layer ||
    !["user", "project"].includes(layer.name.type) ||
    layer.disabledReason
  ) {
    throw new Error("用户配置来源已变化或不可写，请重新加载");
  }
  const previous = projectWriteVersions.get(filePath);
  const projectVersion =
    expectedVersion &&
    previous?.current === layer.version &&
    previous.ancestors.has(expectedVersion)
      ? layer.version
      : (expectedVersion ?? layer.version);
  try {
    const response = await new AppServerClient().request<ConfigWriteResponse>(
      METHOD_CONFIG_VALUE_WRITE,
      {
        keyPath,
        value,
        mergeStrategy: value == null ? "replace" : "upsert",
        filePath,
        expectedVersion:
          layer.name.type === "project"
            ? projectVersion
            : (expectedVersion ?? layer.version),
      },
    );
    assertConfigWriteResponse(response.result);
    if (response.result.filePath !== filePath) {
      throw new Error("config/value/write 返回了不同的配置文件");
    }
    if (layer.name.type === "project") {
      const ancestors =
        previous?.current === projectVersion
          ? previous.ancestors
          : new Set<string>();
      ancestors.add(projectVersion);
      projectWriteVersions.set(filePath, {
        current: response.result.version,
        ancestors,
      });
    }
  } finally {
    invalidateConfigCache();
  }
  markAppConfigChanged();
  return await getConfigSnapshot(cwd ? { cwd } : undefined);
}

export async function getDefaultProvider(): Promise<string> {
  const result = await safeInvoke<unknown>("get_default_provider");
  assertNotDiagnosticFacade(
    "get_default_provider",
    result,
    "真实默认 Provider current 通道",
  );
  assertNonEmptyString("get_default_provider", result, "默认 Provider");
  return result;
}
