import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { safeListen } from "@/lib/api/bridgeEvents";
import {
  APP_SNAPSHOT_TRIGGER_EVENT,
  DoubleCommandDetector,
  playSnapshotSound,
  startBareModifierMonitor,
  stopBareModifierMonitor,
  triggerAppSnapshot,
} from "@/lib/appSnapshot";
import {
  getAppSnapshotPreferences,
  useAppSnapshotPreferences,
} from "@/lib/appSnapshotPreferences";

interface BareModifierEvent {
  modifier?: unknown;
  phase?: unknown;
  timestamp?: unknown;
}

function supportsNativeAppSnapshots(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform || navigator.userAgent || "";
  return /mac/i.test(platform);
}

export function AppSnapshotRuntime() {
  const { t } = useTranslation("navigation");
  const preferences = useAppSnapshotPreferences();
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!supportsNativeAppSnapshots()) return;
    const detector = new DoubleCommandDetector();
    let disposed = false;
    let triggering = false;

    const run = () => {
      if (disposed || triggering) return;
      triggering = true;
      void triggerAppSnapshot()
        .then((delivered) => {
          if (delivered) {
            if (getAppSnapshotPreferences().soundEnabled) playSnapshotSound();
            toast.success(t("appSnapshots.added"));
          } else {
            toast.error(t("appSnapshots.failed"));
          }
        })
        .catch(() => undefined)
        .finally(() => {
          triggering = false;
        });
    };
    const onManualTrigger = () => run();
    window.addEventListener(APP_SNAPSHOT_TRIGGER_EVENT, onManualTrigger);

    if (preferences.hotkeyEnabled) {
      void safeListen<BareModifierEvent>("bareModifier.changed", (event) => {
        if (disposed) return;
        if (detector.handle(event?.payload ?? {})) run();
      }).catch(() => undefined);
      void startBareModifierMonitor().catch(() => undefined);
    }

    return () => {
      disposed = true;
      window.removeEventListener(APP_SNAPSHOT_TRIGGER_EVENT, onManualTrigger);
      if (preferences.hotkeyEnabled) {
        void stopBareModifierMonitor().catch(() => undefined);
      }
    };
  }, [preferences.hotkeyEnabled, t]);
  return null;
}
