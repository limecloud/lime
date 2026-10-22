import { useEffect, useState } from "react";
import { subscribeAppConfigChanged } from "@/lib/api/appConfig";
import { getBrowserSettings, type BrowserSettings } from "@/lib/api/browserSettings";

/** Read projection only; writes and permissions remain at the config owner. */
export function useBrowserPreferences() {
  const [settings, setSettings] = useState<BrowserSettings | null>(null);
  useEffect(() => {
    let version = 0;
    let disposed = false;
    const refresh = async () => {
      const current = ++version;
      try {
        const value = await getBrowserSettings();
        if (!disposed && current === version) setSettings(value);
      } catch {
        // Keep the last read preference. Host independently requires a fresh
        // authoritative policy before every Agent operation.
      }
    };
    void refresh();
    const stop = subscribeAppConfigChanged(() => void refresh());
    return () => { disposed = true; version += 1; stop(); };
  }, []);
  return settings;
}
