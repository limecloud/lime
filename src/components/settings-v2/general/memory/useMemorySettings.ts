import { useCallback, useEffect, useRef, useState } from "react";
import {
  getConfig,
  subscribeAppConfigChanged,
  updateConfig,
} from "@/lib/api/appConfig";
import type { MemoryConfig } from "@/lib/api/memoryConfigTypes";

export function useMemorySettings() {
  const [memory, setMemory] = useState<MemoryConfig | null>(null);
  const [error, setError] = useState<"load" | "save" | null>(null);
  const [pending, setPending] = useState(false);
  const alive = useRef(false);
  const saving = useRef(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const config = await getConfig({ forceRefresh: true });
      if (alive.current && revision.current === request) {
        setMemory(config.memory ?? { enabled: false });
        setError(null);
      }
    } catch {
      if (alive.current && revision.current === request) setError("load");
    }
  }, []);
  useEffect(() => {
    const activeRevision = revision;
    alive.current = true;
    void refresh();
    const unsubscribe = subscribeAppConfigChanged(() => {
      if (!saving.current) void refresh();
    });
    return () => {
      alive.current = false;
      activeRevision.current++;
      unsubscribe();
    };
  }, [refresh]);
  const save = async (change: "enabled" | "tools", value: boolean) => {
    if (!memory || saving.current) return;
    saving.current = true;
    revision.current++;
    setPending(true);
    setError(null);
    try {
      const config = await updateConfig((current) => ({
        ...current,
        memory: {
          ...current.memory,
          ...(change === "enabled"
            ? {
                enabled: value,
                auto: { ...current.memory?.auto, enabled: value },
              }
            : {
                enabled: current.memory?.enabled ?? false,
                disable_on_external_context: !value,
              }),
        },
      }));
      if (alive.current) setMemory(config.memory ?? { enabled: false });
    } catch {
      if (alive.current) setError("save");
    } finally {
      saving.current = false;
      if (alive.current) setPending(false);
    }
  };
  return { memory, error, pending, refresh, save };
}
