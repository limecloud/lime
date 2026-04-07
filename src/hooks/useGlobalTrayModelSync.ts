import { useEffect, useRef } from "react";
import { safeListen } from "@/lib/dev-bridge";
import { subscribeProviderDataChanged } from "@/lib/providerDataEvents";
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_AGENT_PROVIDER,
  GLOBAL_MODEL_PREF_KEY,
  GLOBAL_PROVIDER_PREF_KEY,
  getAgentPreferenceKeys,
  loadPersistedString,
  savePersisted,
} from "@/components/agent/chat/hooks/agentChatStorage";
import {
  invalidateTrayPayloadCache,
  syncTrayModelShortcutsState,
} from "@/components/agent/chat/hooks/useTrayModelShortcuts";
import {
  TRAY_MODEL_SELECTED_EVENT,
  type TrayModelSelectedPayload,
} from "@/lib/api/tray";
import {
  type AgentPageParams,
  type Page,
  type PageParams,
} from "@/types/page";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";

const LAST_PROJECT_ID_KEY = "agent_last_project_id";

function normalizeProjectId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function loadPersistedProjectId(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) {
      return null;
    }

    try {
      const parsed = JSON.parse(stored);
      return normalizeProjectId(typeof parsed === "string" ? parsed : stored);
    } catch {
      return normalizeProjectId(stored);
    }
  } catch {
    return null;
  }
}

function savePersistedProjectId(projectId: string): void {
  const normalized = normalizeProjectId(projectId);
  if (!normalized || typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      LAST_PROJECT_ID_KEY,
      JSON.stringify(normalized),
    );
  } catch {
    // ignore write errors
  }
}

function resolveActiveProjectId(page: Page, pageParams?: PageParams): string | null {
  return page === "agent"
    ? normalizeProjectId((pageParams as AgentPageParams | undefined)?.projectId)
    : null;
}

function resolveActiveTheme(page: Page, pageParams?: PageParams): string | undefined {
  if (page !== "agent") {
    return undefined;
  }

  const theme = (pageParams as AgentPageParams | undefined)?.theme;
  return typeof theme === "string" && theme.trim() ? theme : undefined;
}

function resolvePersistedModelPreference(projectId: string | null): {
  providerType: string;
  model: string;
} {
  const { providerKey, modelKey } = getAgentPreferenceKeys(projectId);
  const providerType =
    loadPersistedString(providerKey) ||
    loadPersistedString(GLOBAL_PROVIDER_PREF_KEY) ||
    DEFAULT_AGENT_PROVIDER;
  const model =
    loadPersistedString(modelKey) ||
    loadPersistedString(GLOBAL_MODEL_PREF_KEY) ||
    DEFAULT_AGENT_MODEL;

  return {
    providerType,
    model,
  };
}

function resolveTrayProjectId(page: Page, pageParams?: PageParams): string | null {
  return (
    loadPersistedProjectId(LAST_PROJECT_ID_KEY) ||
    resolveActiveProjectId(page, pageParams)
  );
}

interface UseGlobalTrayModelSyncOptions {
  currentPage: Page;
  pageParams?: PageParams;
}

export function useGlobalTrayModelSync({
  currentPage,
  pageParams,
}: UseGlobalTrayModelSyncOptions) {
  const traySyncEnabled = hasTauriInvokeCapability();
  const currentPageRef = useRef(currentPage);
  const pageParamsRef = useRef<PageParams | undefined>(pageParams);

  currentPageRef.current = currentPage;
  pageParamsRef.current = pageParams;

  useEffect(() => {
    if (!traySyncEnabled) {
      return;
    }

    let cancelled = false;
    const retryTimerIds: number[] = [];
    const idleCallbackIds: number[] = [];

    const scheduleInitialSync = (task: () => void) => {
      if (import.meta.env.DEV) {
        if (typeof window.requestIdleCallback === "function") {
          idleCallbackIds.push(
            window.requestIdleCallback(
              () => {
                if (!cancelled) {
                  task();
                }
              },
              { timeout: 1500 },
            ),
          );
          return;
        }

        retryTimerIds.push(
          window.setTimeout(() => {
            if (!cancelled) {
              task();
            }
          }, 120),
        );
        return;
      }

      task();
    };

    const sync = async (
      override?: {
        projectId?: string | null;
        providerType?: string;
        model?: string;
        theme?: string;
      },
      options?: {
        forceRefresh?: boolean;
      },
    ) => {
      const projectId =
        override?.projectId ??
        resolveTrayProjectId(currentPageRef.current, pageParamsRef.current);
      const theme =
        override?.theme ??
        resolveActiveTheme(currentPageRef.current, pageParamsRef.current);
      const preference = resolvePersistedModelPreference(projectId);
      const providerType = override?.providerType || preference.providerType;
      const model = override?.model || preference.model;

      if (projectId) {
        savePersistedProjectId(projectId);
      }

      try {
        await syncTrayModelShortcutsState(providerType, model, theme, options);
      } catch (error) {
        if (!cancelled) {
          console.warn("[GlobalTrayModelSync] 同步托盘模型状态失败:", error);
        }
      }
    };

    scheduleInitialSync(() => {
      void sync();
    });
    retryTimerIds.push(window.setTimeout(() => void sync(), 900));
    retryTimerIds.push(window.setTimeout(() => void sync(), 2600));

    const unsubscribe = subscribeProviderDataChanged(() => {
      invalidateTrayPayloadCache();
      void sync(undefined, { forceRefresh: true });
    });

    const handleFocus = () => {
      invalidateTrayPayloadCache();
      void sync(undefined, { forceRefresh: true });
    };

    window.addEventListener("focus", handleFocus);

    let dispose: (() => void) | null = null;

    safeListen<TrayModelSelectedPayload>(
      TRAY_MODEL_SELECTED_EVENT,
      (event) => {
        if (cancelled) {
          return;
        }

        const providerType = event.payload?.providerType?.trim() || "";
        const model = event.payload?.model?.trim() || "";
        if (!providerType || !model) {
          return;
        }

        const projectId =
          resolveTrayProjectId(currentPageRef.current, pageParamsRef.current);
        const { providerKey, modelKey } = getAgentPreferenceKeys(projectId);

        savePersisted(providerKey, providerType);
        savePersisted(modelKey, model);

        if (projectId) {
          savePersistedProjectId(projectId);
        }

        void sync({
          projectId,
          providerType,
          model,
        });
      },
    )
      .then((unlisten) => {
        if (cancelled) {
          void unlisten();
          return;
        }
        dispose = unlisten;
      })
      .catch((error) => {
        console.warn("[GlobalTrayModelSync] 监听托盘模型切换失败:", error);
      });

    return () => {
      cancelled = true;
      retryTimerIds.forEach((timerId) => window.clearTimeout(timerId));
      idleCallbackIds.forEach((callbackId) => {
        if (typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(callbackId);
        }
      });
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
      if (dispose) {
        dispose();
      }
    };
  }, [currentPage, traySyncEnabled]);
}
