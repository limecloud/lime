import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeAppConfigChanged } from "@/lib/api/appConfig";
import {
  getBrowserSettings,
  BrowserSettingsConflictError,
  updateBrowserSetting,
  type BrowserSettings,
} from "@/lib/api/browserSettings";

export function useBrowserSettings() {
  const [configured, setConfigured] = useState<BrowserSettings | null>(null);
  const [error, setError] = useState<
    "load" | "save" | "conflict" | "reload" | null
  >(null);
  const [pending, setPending] = useState(false);
  const alive = useRef(false);
  const saving = useRef(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    if (saving.current) return;
    const current = ++revision.current;
    try {
      const value = await getBrowserSettings();
      if (alive.current && revision.current === current) {
        setConfigured(value);
        setError(null);
      }
    } catch {
      if (alive.current && revision.current === current)
        setError((previous) => (previous === "reload" ? "reload" : "load"));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const unsubscribe = subscribeAppConfigChanged(() => {
      if (!saving.current) void refresh();
    });
    return () => {
      alive.current = false;
      revision.current += 1;
      unsubscribe();
    };
  }, [refresh]);

  const save = async <K extends keyof BrowserSettings>(
    key: K,
    value: BrowserSettings[K],
    expectedValue?: BrowserSettings[K],
  ) => {
    if (!configured || saving.current || error === "reload" || error === "load")
      return false;
    const previous = configured;
    const current = ++revision.current;
    saving.current = true;
    setPending(true);
    setError(null);
    setConfigured({ ...previous, [key]: value });
    try {
      const saved = await updateBrowserSetting(
        key,
        value,
        expectedValue === undefined ? previous[key] : expectedValue,
      );
      if (alive.current && revision.current === current) setConfigured(saved);
      return true;
    } catch (failure) {
      let restored = previous;
      let reloaded = true;
      try {
        restored = await getBrowserSettings({ forceRefresh: true });
      } catch {
        reloaded = false;
        // 保留最后已知配置，不把未知保存结果当作成功。
      }
      if (alive.current && revision.current === current) {
        setConfigured(restored);
        setError(
          !reloaded
            ? "reload"
            : failure instanceof BrowserSettingsConflictError
              ? "conflict"
              : "save",
        );
      }
      return false;
    } finally {
      saving.current = false;
      if (alive.current) setPending(false);
    }
  };
  return { configured, error, pending, refresh, save };
}
