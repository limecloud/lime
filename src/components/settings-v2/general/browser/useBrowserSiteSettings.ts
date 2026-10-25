import { useCallback, useEffect, useRef, useState } from "react";
import {
  getBrowserSiteSettings,
  removeBrowserSiteSettings,
  updateBrowserSiteSetting,
} from "@/lib/api/browserSiteSettings";
import type {
  BrowserSiteSettingsUpdate,
  BrowserSiteSettingsSnapshot,
} from "@/lib/api/browserSiteSettingsTypes";

export function useBrowserSiteSettings() {
  const [snapshot, setSnapshot] = useState<BrowserSiteSettingsSnapshot | null>(
    null,
  );
  const [error, setError] = useState<"load" | "save" | null>(null);
  const [pending, setPending] = useState(false);
  const alive = useRef(false);
  const request = useRef(0);
  const saving = useRef(false);

  const refresh = useCallback(async () => {
    if (saving.current) return;
    const current = ++request.current;
    try {
      const value = await getBrowserSiteSettings();
      if (alive.current && request.current === current) {
        setSnapshot(value);
        setError(null);
      }
    } catch {
      if (alive.current && request.current === current) setError("load");
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      request.current += 1;
    };
  }, [refresh]);

  const mutate = async (
    operation: () => Promise<BrowserSiteSettingsSnapshot>,
  ) => {
    if (!alive.current || saving.current || error === "load") return false;
    const current = ++request.current;
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      const value = await operation();
      if (alive.current && request.current === current) setSnapshot(value);
      return alive.current && request.current === current;
    } catch {
      if (alive.current && request.current === current) setError("save");
      return false;
    } finally {
      saving.current = false;
      if (alive.current) setPending(false);
    }
  };

  const save = (update: BrowserSiteSettingsUpdate) =>
    mutate(() => updateBrowserSiteSetting(update));

  const remove = (origin: string) =>
    mutate(() => removeBrowserSiteSettings(origin));

  return { snapshot, error, pending, refresh, save, remove };
}
