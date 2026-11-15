import { useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { register, unregister } from "@/lib/desktop-host/global-shortcut";
import { captureScreenRegion } from "@/lib/screenCapture";
import { deliverAppSnapshot } from "@/lib/appSnapshot";
import { requestNewConversationTab } from "@/lib/conversationTabs";

const CURRENT_CHAT_SHORTCUT = "Control+Shift+4";
const NEW_CHAT_SHORTCUT = "Control+Alt+Shift+4";

export function ScreenCaptureRuntime() {
  const { t } = useTranslation("navigation");

  useEffect(() => {
    let registeredCurrent = false;
    let registeredNew = false;

    const capture = async (newChat: boolean) => {
      const file = await captureScreenRegion().catch(() => null);
      if (!file) return;
      if (newChat) {
        requestNewConversationTab();
        await new Promise((resolve) => globalThis.setTimeout(resolve, 450));
      }
      if (deliverAppSnapshot(file)) {
        toast.success(t("screenCapture.added"));
      } else {
        toast.error(t("screenCapture.failed"));
      }
    };

    const current = () => void capture(false);
    const newChat = () => void capture(true);
    window.addEventListener("lime:screenshot-current-chat", current);
    window.addEventListener("lime:screenshot-new-chat", newChat);
    void register(CURRENT_CHAT_SHORTCUT, current)
      .then(() => {
        registeredCurrent = true;
      })
      .catch(() => undefined);
    void register(NEW_CHAT_SHORTCUT, newChat)
      .then(() => {
        registeredNew = true;
      })
      .catch(() => undefined);

    return () => {
      window.removeEventListener("lime:screenshot-current-chat", current);
      window.removeEventListener("lime:screenshot-new-chat", newChat);
      if (registeredCurrent) {
        void unregister(CURRENT_CHAT_SHORTCUT).catch(() => undefined);
      }
      if (registeredNew) {
        void unregister(NEW_CHAT_SHORTCUT).catch(() => undefined);
      }
    };
  }, [t]);

  return null;
}
