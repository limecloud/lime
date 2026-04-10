import { useEffect, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  COMPANION_OPEN_PROVIDER_SETTINGS_EVENT,
  COMPANION_REQUEST_PROVIDER_SYNC_EVENT,
  COMPANION_PROVIDER_OVERVIEW_CAPABILITY,
  getCompanionPetStatus,
  listenCompanionPetStatus,
  sendCompanionPetCommand,
  type CompanionPetStatus,
} from "@/lib/api/companion";
import { safeListen } from "@/lib/dev-bridge";
import { subscribeProviderDataChanged } from "@/lib/providerDataEvents";
import { loadCompanionProviderOverview } from "@/lib/provider/companionProviderOverview";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";
import type { Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";

interface UseCompanionProviderBridgeOptions {
  onNavigate: (page: Page, params?: PageParams) => void;
}

function supportsProviderOverview(
  status: CompanionPetStatus | null | undefined,
): boolean {
  return Boolean(
    status?.connected &&
    status.capabilities.includes(COMPANION_PROVIDER_OVERVIEW_CAPABILITY),
  );
}

export function useCompanionProviderBridge({
  onNavigate,
}: UseCompanionProviderBridgeOptions): void {
  const statusRef = useRef<CompanionPetStatus | null>(null);
  const lastFingerprintRef = useRef<string | null>(null);
  const syncRequestIdRef = useRef(0);

  useEffect(() => {
    // 浏览器开发模式下 DevBridge 事件桥会占用有限的同源连接槽位，
    // companion 事件不属于聊天主链，优先跳过以避免阻塞 /invoke。
    if (!hasTauriInvokeCapability()) {
      return;
    }

    let cancelled = false;
    let statusUnlisten: UnlistenFn | null = null;
    let openSettingsUnlisten: UnlistenFn | null = null;
    let requestProviderSyncUnlisten: UnlistenFn | null = null;

    const syncProviderOverview = async (
      forceRefresh = false,
      forceDeliver = false,
    ) => {
      if (!supportsProviderOverview(statusRef.current)) {
        return;
      }

      const requestId = ++syncRequestIdRef.current;

      try {
        const payload = await loadCompanionProviderOverview({
          forceRefresh,
        });
        if (cancelled || requestId !== syncRequestIdRef.current) {
          return;
        }

        const fingerprint = JSON.stringify(payload);
        if (!forceDeliver && fingerprint === lastFingerprintRef.current) {
          return;
        }

        const result = await sendCompanionPetCommand({
          event: "pet.provider_overview",
          payload,
        });

        if (
          !cancelled &&
          requestId === syncRequestIdRef.current &&
          result.delivered
        ) {
          lastFingerprintRef.current = fingerprint;
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("[Companion] 同步桌宠 provider 摘要失败:", error);
        }
      }
    };

    const applyStatus = (status: CompanionPetStatus) => {
      const previousStatus = statusRef.current;
      statusRef.current = status;

      if (!status.connected) {
        lastFingerprintRef.current = null;
        return;
      }

      const becameProviderAware =
        supportsProviderOverview(status) &&
        (!previousStatus?.connected ||
          !supportsProviderOverview(previousStatus));

      if (becameProviderAware) {
        void syncProviderOverview(true);
      }
    };

    void getCompanionPetStatus()
      .then((status) => {
        if (!cancelled) {
          applyStatus(status);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[Companion] 读取桌宠状态失败:", error);
        }
      });

    void listenCompanionPetStatus(applyStatus)
      .then((unlisten) => {
        if (cancelled) {
          void unlisten();
          return;
        }
        statusUnlisten = unlisten;
      })
      .catch((error) => {
        console.warn("[Companion] 监听桌宠状态失败:", error);
      });

    const unsubscribeProviderData = subscribeProviderDataChanged(() => {
      void syncProviderOverview(true);
    });

    const handleWindowFocus = () => {
      void syncProviderOverview(true);
    };

    window.addEventListener("focus", handleWindowFocus);

    void safeListen(COMPANION_OPEN_PROVIDER_SETTINGS_EVENT, () => {
      onNavigate("settings", {
        tab: SettingsTabs.Providers,
      });
    })
      .then((unlisten) => {
        if (cancelled) {
          void unlisten();
          return;
        }
        openSettingsUnlisten = unlisten;
      })
      .catch((error) => {
        console.warn("[Companion] 监听桌宠设置跳转失败:", error);
      });

    void safeListen(COMPANION_REQUEST_PROVIDER_SYNC_EVENT, () => {
      void syncProviderOverview(true, true);
    })
      .then((unlisten) => {
        if (cancelled) {
          void unlisten();
          return;
        }
        requestProviderSyncUnlisten = unlisten;
      })
      .catch((error) => {
        console.warn("[Companion] 监听桌宠摘要同步请求失败:", error);
      });

    return () => {
      cancelled = true;
      unsubscribeProviderData();
      window.removeEventListener("focus", handleWindowFocus);
      if (statusUnlisten) {
        statusUnlisten();
      }
      if (openSettingsUnlisten) {
        openSettingsUnlisten();
      }
      if (requestProviderSyncUnlisten) {
        requestProviderSyncUnlisten();
      }
    };
  }, [onNavigate]);
}
