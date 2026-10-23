import { useCallback, useEffect, useRef, useState } from "react";
import { readStorage, type StorageState } from "@/lib/api/storage";

export function useStorageSettings() {
  const [state, setState] = useState<StorageState | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(true);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const load = useCallback(async (refresh = false) => {
    const request = ++generation.current;
    clearTimeout(timer.current);
    setPending(true);
    setFailed(false);
    try {
      const next = await readStorage(refresh);
      if (!alive.current || generation.current !== request) return;
      setState(next);
      if (next.status === "scanning")
        timer.current = setTimeout(() => void load(), 1000);
    } catch {
      if (alive.current && generation.current === request) setFailed(true);
    } finally {
      if (alive.current && generation.current === request) setPending(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      generation.current += 1;
      clearTimeout(timer.current);
    };
  }, [load]);
  return { state, failed, pending, refresh: () => load(true) };
}
