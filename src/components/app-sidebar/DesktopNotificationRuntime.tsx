import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { subscribeAppServerNotifications } from "@/lib/api/appServerEventBus";
import { showDesktopNotification } from "@/lib/api/desktopNotification";
import { getNotificationPreferences } from "@/lib/notificationPreferences";
import {
  playClassicNotificationSound,
  playCustomNotificationSound,
  resolveNotificationSound,
} from "@/lib/notificationSound";

function readTurnCompletion(params: unknown) {
  if (!params || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  const threadId = typeof record.threadId === "string" ? record.threadId : "";
  const turn =
    record.turn && typeof record.turn === "object"
      ? (record.turn as Record<string, unknown>)
      : null;
  const turnId = typeof turn?.id === "string" ? turn.id : "";
  const status = typeof turn?.status === "string" ? turn.status : "";
  if (!threadId || !turnId || status !== "completed") return null;
  return `${threadId}:${turnId}`;
}

export function DesktopNotificationRuntime() {
  const { t } = useTranslation("navigation");
  useEffect(() => {
    const onServerRequest = (event: Event) => {
      const method = (event as CustomEvent<{ method?: string }>).detail?.method;
      if (!method) return;
      if (typeof document !== "undefined" && document.hasFocus()) return;
      const preferences = getNotificationPreferences();
      const sound = resolveNotificationSound(preferences.sound);
      const playCustom = () => {
        if (sound.playCustom) playCustomNotificationSound();
        if (sound.playClassic) playClassicNotificationSound();
      };
      if (method.endsWith("requestApproval") && preferences.permissions) {
        playCustom();
        void showDesktopNotification({
          title: t("notifications.permission.title", {
            defaultValue: "Lime",
          }),
          body: t("notifications.permission.body", {
            defaultValue: "需要你的批准",
          }),
          ...sound.request,
          tag: `lime-permission:${method}`,
        }).catch(() => undefined);
      } else if (
        method === "item/tool/requestUserInput" &&
        preferences.questions
      ) {
        playCustom();
        void showDesktopNotification({
          title: t("notifications.question.title", {
            defaultValue: "Lime",
          }),
          body: t("notifications.question.body", {
            defaultValue: "需要你的回答",
          }),
          ...sound.request,
          tag: "lime-question",
        }).catch(() => undefined);
      }
    };
    window.addEventListener("lime:server-request", onServerRequest);
    const seen = new Set<string>();
    const unsubscribe = subscribeAppServerNotifications({
      onNotifications: (notifications) => {
        for (const notification of notifications) {
          if (notification.method !== "turn/completed") continue;
          const identity = readTurnCompletion(notification.params);
          if (!identity || seen.has(identity)) continue;
          seen.add(identity);
          if (seen.size > 100) {
            const oldest = seen.values().next().value;
            if (oldest) seen.delete(oldest);
          }
          const preferences = getNotificationPreferences();
          if (preferences.turnComplete === "never") continue;
          if (
            preferences.turnComplete === "unfocused" &&
            typeof document !== "undefined" &&
            document.hasFocus()
          ) {
            continue;
          }
          const sound = resolveNotificationSound(preferences.sound);
          if (sound.playCustom) playCustomNotificationSound();
          if (sound.playClassic) playClassicNotificationSound();
          void showDesktopNotification({
            title: t("notifications.turnComplete.title", {
              defaultValue: "Lime",
            }),
            body: t("notifications.turnComplete.body", {
              defaultValue: "任务已完成",
            }),
            ...sound.request,
            tag: `lime-turn:${identity}`,
          }).catch(() => undefined);
        }
      },
    });
    return () => {
      window.removeEventListener("lime:server-request", onServerRequest);
      unsubscribe();
    };
  }, [t]);
  return null;
}
