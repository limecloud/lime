import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeAppConfigChanged } from "@/lib/api/appConfig";
import {
  getWorktreePreferences,
  updateWorktreePreference,
  type WorktreePreferences,
} from "@/lib/api/worktreePreferences";

export function useWorktreeSettings() {
  const [preferences, setPreferences] = useState<WorktreePreferences | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const alive = useRef(false);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    const version = ++revision.current;
    try {
      const value = await getWorktreePreferences();
      if (alive.current && revision.current === version) {
        setPreferences(value);
        setError(false);
      }
    } catch {
      if (alive.current && revision.current === version) setError(true);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const unsubscribe = subscribeAppConfigChanged(() => {
      if (!pending.current) void refresh();
    });
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [refresh]);
  const save = useCallback(
    async <K extends keyof WorktreePreferences>(
      key: K,
      value: WorktreePreferences[K],
    ) => {
      if (pending.current) return false;
      pending.current = true;
      revision.current++;
      setSaving(true);
      setError(false);
      try {
        const result = await updateWorktreePreference(key, value);
        if (alive.current) setPreferences(result);
        return true;
      } catch {
        if (alive.current) setError(true);
        return false;
      } finally {
        pending.current = false;
        if (alive.current) setSaving(false);
      }
    },
    [],
  );
  return { preferences, error, saving, save, refresh };
}
