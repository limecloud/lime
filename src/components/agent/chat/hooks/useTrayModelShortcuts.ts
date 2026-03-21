import { useEffect, useRef } from "react";
import { safeListen } from "@/lib/dev-bridge";
import {
  TRAY_MODEL_SELECTED_EVENT,
  type SyncTrayModelShortcutsPayload,
  type TrayModelSelectedPayload,
  type TrayQuickModelGroup,
} from "@/lib/api/tray";
import { modelRegistryApi } from "@/lib/api/modelRegistry";
import { trayApi } from "@/lib/api/tray";
import {
  getAliasConfigKey,
  getProviderLabel,
} from "@/lib/constants/providerMappings";
import type {
  EnhancedModelMetadata,
  ProviderAliasConfig,
} from "@/lib/types/modelRegistry";
import {
  loadConfiguredProviders,
  type ConfiguredProvider,
} from "@/hooks/useConfiguredProviders";
import { buildProviderModelsFromRegistry } from "@/hooks/useProviderModels";
import { filterModelsByTheme } from "../utils/modelThemePolicy";
import { getProviderModelCompatibilityIssue } from "../utils/providerModelCompatibility";

interface UseTrayModelShortcutsOptions {
  providerType: string;
  setProviderType: (type: string) => void;
  model: string;
  setModel: (model: string) => void;
  activeTheme?: string;
  deferInitialSync?: boolean;
}

const MAX_TRAY_MODELS_PER_PROVIDER = 8;
const TRAY_PAYLOAD_CACHE_TTL_MS = 3_000;
const TRAY_SYNC_IDLE_TIMEOUT_MS = 1_500;
const TRAY_SYNC_FALLBACK_DELAY_MS = 180;

interface TrayPayloadCacheEntry {
  signature: string;
  expiresAt: number;
  payload: SyncTrayModelShortcutsPayload;
}

interface TrayPayloadInFlight {
  signature: string;
  promise: Promise<SyncTrayModelShortcutsPayload>;
}

let trayPayloadCache: TrayPayloadCacheEntry | null = null;
let trayPayloadInFlight: TrayPayloadInFlight | null = null;
let lastSyncedTrayPayloadFingerprint: string | null = null;

const THEME_LABEL_MAP: Record<string, string> = {
  general: "通用对话",
  "social-media": "社媒内容",
  poster: "图文海报",
  knowledge: "知识探索",
  planning: "计划规划",
  document: "办公文档",
  video: "短视频",
  music: "歌词曲谱",
  novel: "小说创作",
};

function getTrayPayloadSignature(
  providerType: string,
  model: string,
  activeTheme?: string,
): string {
  return [providerType.trim(), model.trim(), activeTheme?.trim() || ""].join(
    "|",
  );
}

export function invalidateTrayPayloadCache(): void {
  trayPayloadCache = null;
  trayPayloadInFlight = null;
  lastSyncedTrayPayloadFingerprint = null;
}

function getTrayPayloadFingerprint(
  payload: SyncTrayModelShortcutsPayload,
): string {
  return JSON.stringify(payload);
}

function scheduleTrayModelSync(task: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(() => task(), {
      timeout: TRAY_SYNC_IDLE_TIMEOUT_MS,
    });
    return () => {
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
    };
  }

  const timeoutId = window.setTimeout(task, TRAY_SYNC_FALLBACK_DELAY_MS);
  return () => {
    window.clearTimeout(timeoutId);
  };
}

function resolveProviderModels(
  provider: ConfiguredProvider,
  registryModels: Parameters<typeof buildProviderModelsFromRegistry>[1],
  aliasConfigs: Record<string, ProviderAliasConfig>,
) {
  return buildProviderModelsFromRegistry(
    provider,
    registryModels,
    aliasConfigs[getAliasConfigKey(provider.key)] ?? null,
  ).models;
}

function resolveThemeLabel(theme?: string): string {
  const normalizedTheme = theme?.trim().toLowerCase() || "";
  return THEME_LABEL_MAP[normalizedTheme] || "";
}

function buildQuickModelGroups(
  providers: ConfiguredProvider[],
  registryModels: EnhancedModelMetadata[],
  aliasConfigs: Record<string, ProviderAliasConfig>,
  providerType: string,
  model: string,
  activeTheme?: string,
): TrayQuickModelGroup[] {
  const groups: TrayQuickModelGroup[] = [];
  const currentProviderKey = providerType.trim();
  const currentModel = model.trim();

  providers.forEach((provider) => {
    const resolvedModels = resolveProviderModels(
      provider,
      registryModels,
      aliasConfigs,
    );
    const filteredModels = filterModelsByTheme(
      activeTheme,
      resolvedModels,
    ).models;

    const compatibleModels = filteredModels
      .filter(
        (item) =>
          !getProviderModelCompatibilityIssue({
            providerType: provider.key,
            configuredProviderType: provider.type,
            model: item.id,
          }),
      )
      .map((item) => item.id);

    const prioritizedModels = compatibleModels.filter(Boolean);
    if (
      provider.key === currentProviderKey &&
      currentModel &&
      !prioritizedModels.includes(currentModel)
    ) {
      prioritizedModels.unshift(currentModel);
    }

    const uniqueModels = Array.from(new Set(prioritizedModels)).slice(
      0,
      MAX_TRAY_MODELS_PER_PROVIDER,
    );

    if (uniqueModels.length === 0) {
      return;
    }

    groups.push({
      provider_type: provider.key,
      provider_label: provider.label,
      models: uniqueModels.map((item) => ({
        provider_type: provider.key,
        provider_label: provider.label,
        model: item,
      })),
    });
  });

  if (
    currentProviderKey &&
    currentModel &&
    !groups.some((group) => group.provider_type === currentProviderKey)
  ) {
    groups.unshift({
      provider_type: currentProviderKey,
      provider_label: getProviderLabel(currentProviderKey),
      models: [
        {
          provider_type: currentProviderKey,
          provider_label: getProviderLabel(currentProviderKey),
          model: currentModel,
        },
      ],
    });
  }

  return groups;
}

async function loadTraySource<T>(
  loader: () => Promise<T>,
  fallbackValue: T,
  label: string,
): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    console.warn(`[TrayModelShortcuts] 加载${label}失败:`, error);
    return fallbackValue;
  }
}

export async function buildTrayPayload(
  providerType: string,
  model: string,
  activeTheme?: string,
  options?: {
    forceRefresh?: boolean;
  },
): Promise<SyncTrayModelShortcutsPayload> {
  const signature = getTrayPayloadSignature(providerType, model, activeTheme);
  const now = Date.now();
  const forceRefresh = options?.forceRefresh ?? false;

  if (
    !forceRefresh &&
    trayPayloadCache &&
    trayPayloadCache.signature === signature &&
    trayPayloadCache.expiresAt > now
  ) {
    return trayPayloadCache.payload;
  }

  if (
    !forceRefresh &&
    trayPayloadInFlight &&
    trayPayloadInFlight.signature === signature
  ) {
    return trayPayloadInFlight.promise;
  }

  const payloadPromise = (async () => {
    const sourceOptions = forceRefresh ? { forceRefresh: true } : undefined;
    const [providers, registryModels, aliasConfigs] = await Promise.all([
      loadTraySource(
        () => loadConfiguredProviders({ forceRefresh }),
        [] as ConfiguredProvider[],
        "已配置 Provider 列表",
      ),
      loadTraySource(
        () => modelRegistryApi.getModelRegistry(sourceOptions),
        [] as EnhancedModelMetadata[],
        "模型注册表",
      ),
      loadTraySource(
        () => modelRegistryApi.getAllAliasConfigs(sourceOptions),
        {} as Record<string, ProviderAliasConfig>,
        "别名模型配置",
      ),
    ]);
    const currentProvider =
      providers.find((item) => item.key === providerType) || null;

    return {
      current_model_provider_type: providerType,
      current_model_provider_label:
        currentProvider?.label || getProviderLabel(providerType),
      current_model: model,
      current_theme_label: resolveThemeLabel(activeTheme),
      quick_model_groups: buildQuickModelGroups(
        providers,
        registryModels,
        aliasConfigs,
        providerType,
        model,
        activeTheme,
      ),
    };
  })();

  trayPayloadInFlight = {
    signature,
    promise: payloadPromise,
  };

  try {
    const payload = await payloadPromise;

    if (trayPayloadInFlight?.promise === payloadPromise) {
      trayPayloadCache = {
        signature,
        expiresAt: Date.now() + TRAY_PAYLOAD_CACHE_TTL_MS,
        payload,
      };
    }

    return payload;
  } finally {
    if (trayPayloadInFlight?.promise === payloadPromise) {
      trayPayloadInFlight = null;
    }
  }
}

export async function syncTrayModelShortcutsState(
  providerType: string,
  model: string,
  activeTheme?: string,
  options?: {
    forceRefresh?: boolean;
  },
): Promise<void> {
  const payload = await buildTrayPayload(
    providerType,
    model,
    activeTheme,
    options,
  );
  const fingerprint = getTrayPayloadFingerprint(payload);

  if (
    !options?.forceRefresh &&
    fingerprint === lastSyncedTrayPayloadFingerprint
  ) {
    return;
  }

  await trayApi.syncTrayModelShortcuts(payload);
  lastSyncedTrayPayloadFingerprint = fingerprint;
}

export function useTrayModelShortcuts({
  providerType,
  setProviderType,
  model,
  setModel,
  activeTheme,
  deferInitialSync = false,
}: UseTrayModelShortcutsOptions) {
  const lastSyncedSignatureRef = useRef<string>("");
  const initialSyncHandledRef = useRef(false);
  const latestSelectionRef = useRef({
    providerType,
    model,
  });
  const latestMutatorsRef = useRef({
    setProviderType,
    setModel,
  });

  useEffect(() => {
    latestSelectionRef.current = {
      providerType,
      model,
    };
    latestMutatorsRef.current = {
      setProviderType,
      setModel,
    };
  }, [model, providerType, setModel, setProviderType]);

  useEffect(() => {
    const normalizedProviderType = providerType.trim();
    const normalizedModel = model.trim();
    const normalizedTheme = activeTheme?.trim() || "";

    if (!normalizedProviderType || !normalizedModel) {
      return;
    }

    const signature = [
      normalizedProviderType,
      normalizedModel,
      normalizedTheme,
    ].join("|");
    if (signature === lastSyncedSignatureRef.current) {
      return;
    }
    lastSyncedSignatureRef.current = signature;

    let cancelled = false;
    const runSync = () => {
      void syncTrayModelShortcutsState(
        normalizedProviderType,
        normalizedModel,
        normalizedTheme || undefined,
      ).catch((error) => {
        if (!cancelled) {
          console.warn("[TrayModelShortcuts] 同步托盘模型状态失败:", error);
        }
      });
    };
    let cleanupScheduledTask: (() => void) | null = null;

    if (!initialSyncHandledRef.current && deferInitialSync) {
      initialSyncHandledRef.current = true;
      cleanupScheduledTask = scheduleTrayModelSync(() => {
        if (!cancelled) {
          runSync();
        }
      });
    } else {
      initialSyncHandledRef.current = true;
      runSync();
    }

    return () => {
      cancelled = true;
      cleanupScheduledTask?.();
    };
  }, [activeTheme, deferInitialSync, model, providerType]);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | null = null;

    safeListen<TrayModelSelectedPayload>(TRAY_MODEL_SELECTED_EVENT, (event) => {
      if (cancelled) {
        return;
      }

      const nextProviderType = event.payload?.providerType?.trim() || "";
      const nextModel = event.payload?.model?.trim() || "";
      const currentSelection = latestSelectionRef.current;
      const currentMutators = latestMutatorsRef.current;

      if (!nextModel) {
        return;
      }

      if (
        nextProviderType &&
        nextProviderType !== currentSelection.providerType
      ) {
        currentMutators.setProviderType(nextProviderType);
      }

      if (nextModel !== currentSelection.model) {
        currentMutators.setModel(nextModel);
      }
    })
      .then((unlisten) => {
        if (cancelled) {
          void unlisten();
          return;
        }
        dispose = unlisten;
      })
      .catch((error) => {
        console.warn("[TrayModelShortcuts] 监听托盘模型切换失败:", error);
      });

    return () => {
      cancelled = true;
      if (dispose) {
        dispose();
      }
    };
  }, []);
}
