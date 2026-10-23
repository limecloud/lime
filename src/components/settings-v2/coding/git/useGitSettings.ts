import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeAppConfigChanged } from "@/lib/api/appConfig";
import {
  getGitPreferences,
  updateGitPreference,
  type GitPreferences,
} from "@/lib/api/gitPreferences";

export function useGitSettings() {
  const [preferences, setPreferences] = useState<GitPreferences | null>(null);
  const [error, setError] = useState<"load" | "save" | null>(null);
  const [pending, setPending] = useState(0);
  const alive = useRef(false);
  const writes = useRef(0);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++revision.current;
    try {
      const value = await getGitPreferences({ forceRefresh: true });
      if (alive.current && version === revision.current) {
        setPreferences(value);
        setError(null);
      }
    } catch {
      if (alive.current && version === revision.current) setError("load");
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const unsubscribe = subscribeAppConfigChanged(() => {
      if (!writes.current) void refresh();
    });
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [refresh]);
  const save = useCallback(
    async <K extends keyof GitPreferences>(
      key: K,
      value: GitPreferences[K],
    ) => {
      writes.current++;
      revision.current++;
      if (alive.current) {
        setPending(writes.current);
        setError(null);
      }
      try {
        const result = await updateGitPreference(key, value);
        if (alive.current) setPreferences(result);
      } catch (error) {
        if (alive.current) setError("save");
        throw error;
      } finally {
        writes.current--;
        if (alive.current) setPending(writes.current);
      }
    },
    [],
  );
  return { preferences, error, pending: pending > 0, refresh, save };
}
