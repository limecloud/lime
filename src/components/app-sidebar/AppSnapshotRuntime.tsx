import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
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
  setAppSnapshotPreferences,
  useAppSnapshotPreferences,
} from "@/lib/appSnapshotPreferences";
import { requestNewConversationTab } from "@/lib/conversationTabs";

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
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!supportsNativeAppSnapshots()) return;
    const detector = new DoubleCommandDetector();
    let disposed = false;
    let triggering = false;

    const run = () => {
      if (disposed || triggering) return;
      if (!getAppSnapshotPreferences().enabled) {
        setOnboardingOpen(true);
        return;
      }
      triggering = true;
      void (async () => {
        if (getAppSnapshotPreferences().destination === "newChat") {
          requestNewConversationTab();
          await new Promise((resolve) => globalThis.setTimeout(resolve, 180));
        }
        return triggerAppSnapshot();
      })()
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
    const onCurrentChat = () => {
      if (disposed || triggering) return;
      if (!getAppSnapshotPreferences().enabled) {
        setOnboardingOpen(true);
        return;
      }
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
    window.addEventListener(APP_SNAPSHOT_TRIGGER_EVENT, onManualTrigger);
    const onNewChat = () => {
      if (disposed || triggering) return;
      if (!getAppSnapshotPreferences().enabled) {
        setOnboardingOpen(true);
        return;
      }
      triggering = true;
      void (async () => {
        requestNewConversationTab();
        await new Promise((resolve) => globalThis.setTimeout(resolve, 180));
        return triggerAppSnapshot();
      })()
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
    window.addEventListener("lime:snapshot-current-chat", onCurrentChat);
    window.addEventListener("lime:snapshot-new-chat", onNewChat);

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
      window.removeEventListener("lime:snapshot-current-chat", onCurrentChat);
      window.removeEventListener("lime:snapshot-new-chat", onNewChat);
      if (preferences.hotkeyEnabled) {
        void stopBareModifierMonitor().catch(() => undefined);
      }
    };
  }, [preferences.hotkeyEnabled, t]);
  return (
    <Dialog.Root open={onboardingOpen} onOpenChange={setOnboardingOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl">
          <Dialog.Title className="text-lg font-semibold">
            {t("appSnapshots.enableTitle")}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            {t("appSnapshots.enableDescription")}
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 text-sm"
              onClick={() => setOnboardingOpen(false)}
            >
              {t("appSnapshots.enableCancel")}
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 text-sm"
              onClick={() => {
                setAppSnapshotPreferences({ enabled: true });
                setOnboardingOpen(false);
                window.dispatchEvent(
                  new CustomEvent(APP_SNAPSHOT_TRIGGER_EVENT),
                );
              }}
            >
              {t("appSnapshots.enableContinue")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
