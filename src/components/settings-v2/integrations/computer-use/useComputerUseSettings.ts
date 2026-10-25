import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeAppConfigChanged } from "@/lib/api/appConfig";
import {
  getComputerUseSettings,
  removeAllowedComputerApp,
  setComputerUseEnabled,
  setupComputerUseAdapter,
  type AllowedComputerApp,
  type ComputerUseSettingsSnapshot,
} from "@/lib/api/computerUseSettings";
import type {
  ComputerUseAdapterKind,
  ComputerUseTargetIdentity,
} from "@limecloud/app-server-client";

export function useComputerUseSettings() {
  const [snapshot, setSnapshot] = useState<ComputerUseSettingsSnapshot | null>(
    null,
  );
  const [error, setError] = useState<
    "load" | "save" | "setup" | "reload" | null
  >(null);
  const [pending, setPending] = useState(false);
  const alive = useRef(false);
  const saving = useRef(false);
  const revision = useRef(0);
  const invalidate = useCallback(() => {
    revision.current++;
  }, []);
  const refresh = useCallback(async () => {
    if (saving.current) return;
    const version = ++revision.current;
    try {
      const result = await getComputerUseSettings();
      if (alive.current && revision.current === version) {
        setSnapshot(result);
        setError(null);
      }
    } catch {
      if (alive.current && revision.current === version) setError("load");
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const unsubscribe = subscribeAppConfigChanged(() => void refresh());
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      alive.current = false;
      invalidate();
      unsubscribe();
      window.removeEventListener("focus", focus);
    };
  }, [refresh, invalidate]);

  const mutate = async (
    operation: () => Promise<void>,
    kind: "save" | "setup",
  ) => {
    if (saving.current || !snapshot || error === "load" || error === "reload")
      return false;
    const version = ++revision.current;
    saving.current = true;
    setPending(true);
    setError(null);
    let completed = false;
    try {
      await operation();
      completed = true;
      const result = await getComputerUseSettings();
      if (alive.current && revision.current === version) setSnapshot(result);
      return true;
    } catch {
      // An uncertain write must be read back before another permission change.
      try {
        const confirmed = await getComputerUseSettings();
        if (alive.current && revision.current === version) {
          setSnapshot(confirmed);
          setError(completed ? null : kind);
        }
        return completed;
      } catch {
        if (alive.current && revision.current === version) setError("reload");
      }
      return false;
    } finally {
      saving.current = false;
      if (alive.current) setPending(false);
    }
  };
  return {
    snapshot,
    pending,
    error,
    refresh,
    toggle: (adapter: ComputerUseAdapterKind, value: boolean) =>
      snapshot && !snapshot.managed[adapter]
        ? mutate(
            () =>
              setComputerUseEnabled(value, snapshot.enabled[adapter], adapter),
            "save",
          )
        : Promise.resolve(false),
    remove: (app: AllowedComputerApp) =>
      mutate(() => removeAllowedComputerApp(app), "save"),
    setup: (
      adapter: ComputerUseAdapterKind,
      target?: ComputerUseTargetIdentity,
    ) => mutate(() => setupComputerUseAdapter(adapter, target), "setup"),
  };
}
