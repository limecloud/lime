import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { safeListen } from "@/lib/api/bridgeEvents";
import {
  APP_SNAPSHOT_TRIGGER_EVENT,
  DoubleCommandDetector,
  playSnapshotSound,
  startBareModifierMonitor,
  triggerAppSnapshot,
} from "@/lib/appSnapshot";
import { getAppSnapshotPreferences } from "@/lib/appSnapshotPreferences";

interface BareModifierEvent {
  modifier?: unknown;
  phase?: unknown;
  timestamp?: unknown;
}

export function AppSnapshotRuntime() {
  const { t } = useTranslation("navigation");
  useEffect(() => {
    if (typeof window === "undefined") return;
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

    void safeListen<BareModifierEvent>("bareModifier.changed", (event) => {
      if (disposed) return;
      if (detector.handle(event?.payload ?? {})) run();
    }).catch(() => undefined);
    void startBareModifierMonitor().catch(() => undefined);

    return () => {
      disposed = true;
      window.removeEventListener(APP_SNAPSHOT_TRIGGER_EVENT, onManualTrigger);
    };
  }, [t]);
  return null;
}
