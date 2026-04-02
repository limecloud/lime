import { useEffect, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  COMPANION_OPEN_PROVIDER_SETTINGS_EVENT,
  COMPANION_PROVIDER_OVERVIEW_CAPABILITY,
  getCompanionPetStatus,
  listenCompanionPetStatus,
  sendCompanionPetCommand,
  type CompanionPetStatus,
} from "@/lib/api/companion";
import { safeListen } from "@/lib/dev-bridge";
import { providerPoolApi } from "@/lib/api/providerPool";
import { subscribeProviderDataChanged } from "@/lib/providerDataEvents";
import { buildCompanionProviderOverview } from "@/lib/provider/companionProviderOverview";
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
    let cancelled = false;
    let statusUnlisten: UnlistenFn | null = null;
    let openSettingsUnlisten: UnlistenFn | null = null;

    const syncProviderOverview = async (forceRefresh = false) => {
      if (!supportsProviderOverview(statusRef.current)) {
        return;
      }

      const requestId = ++syncRequestIdRef.current;

      try {
        const overview = await providerPoolApi.getOverview(
          forceRefresh ? { forceRefresh: true } : undefined,
        );
        if (cancelled || requestId !== syncRequestIdRef.current) {
          return;
        }

        const payload = buildCompanionProviderOverview(overview);
        const fingerprint = JSON.stringify(payload);
        if (fingerprint === lastFingerprintRef.current) {
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
        (!previousStatus?.connected || !supportsProviderOverview(previousStatus));

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
    };
  }, [onNavigate]);
}
