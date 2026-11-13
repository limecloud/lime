import { useEffect } from "react";
import { archiveInactiveSessions } from "@/lib/autoArchiveService";

const DAY_MS = 24 * 60 * 60 * 1000;
import {
  getAutoArchivePreference,
  setAutoArchivePreference,
  subscribeAutoArchivePreference,
} from "@/lib/autoArchivePreference";

export function AutoArchiveRuntime() {
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      const preference = getAutoArchivePreference();
      if (preference.days <= 0) return;
      const now = Date.now();
      if (
        preference.lastRunAt &&
        now - preference.lastRunAt < DAY_MS
      ) {
        return;
      }
      void archiveInactiveSessions({ days: preference.days, now })
        .then(() => {
          if (!cancelled) {
            setAutoArchivePreference({ lastRunAt: now });
          }
        })
        .catch(() => undefined);
    };
    run();
    const unsubscribe = subscribeAutoArchivePreference(run);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return null;
}
