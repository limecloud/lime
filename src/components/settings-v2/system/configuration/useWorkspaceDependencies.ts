import { useCallback, useEffect, useRef, useState } from "react";
import {
  configLayerFile,
  writeConfigValue,
  type AppConfigSnapshot,
} from "@/lib/api/appConfig";
import { isConfigFieldManaged } from "@/lib/api/configLayers";
import {
  isInstallActive,
  primaryRuntime,
  type DiagnoseDependenciesResponse,
} from "@/lib/api/primaryRuntime";

const FIELD = "features.workspace_dependencies";
type Action = "save" | "diagnose" | "install" | "cancel";

export function useWorkspaceDependencies(config: AppConfigSnapshot | null) {
  const [diagnostics, setDiagnostics] =
    useState<DiagnoseDependenciesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<Action | null>(null);
  const [diagnosed, setDiagnosed] = useState<boolean | null>(null);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const busy = useRef(false);
  const failed = useRef<{
    action: Action;
    operation: () => Promise<void>;
  } | null>(null);

  const load = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const next = await primaryRuntime.diagnoseDependencies();
      if (!mounted.current || request !== sequence.current) return;
      setDiagnostics(next);
      setReadError(false);
    } catch {
      if (mounted.current && request === sequence.current) setReadError(true);
    } finally {
      if (mounted.current && request === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => { if (!busy.current) void load(); }, [config, load]);

  useEffect(() => {
    if (pending || readError || !isInstallActive(diagnostics?.update)) return;
    const timer = setTimeout(() => void load(), 500);
    return () => clearTimeout(timer);
  }, [diagnostics, pending, readError, load]);

  async function perform(action: Action, operation: () => Promise<void>) {
    if (busy.current || !mounted.current) return;
    busy.current = true;
    ++sequence.current;
    setPending(action);
    setError(null);
    failed.current = null;
    setDiagnosed(null);
    try {
      await operation();
    } catch {
      if (mounted.current) {
        failed.current = { action, operation };
        setError(action);
      }
    } finally {
      busy.current = false;
      if (mounted.current) {
        setPending(null);
        await load();
      }
    }
  }

  const file = config ? configLayerFile(config.layer) : null;
  const readonly =
    !file ||
    Boolean(config?.layer.disabledReason) ||
    Boolean(config && isConfigFieldManaged(config.origins, FIELD));

  return {
    diagnostics,
    loading,
    readError,
    readonly,
    pending,
    error,
    diagnosed,
    retry: () =>
      failed.current
        ? perform(failed.current.action, failed.current.operation)
        : load(),
    change: (enabled: boolean) =>
      perform("save", async () => {
        if (readonly || !file)
          throw new Error("Workspace dependency configuration is read-only");
        await writeConfigValue({
          keyPath: FIELD,
          value: enabled,
          filePath: file,
        });
        if (mounted.current && enabled) {
          try {
            await primaryRuntime.runUpdateNow();
          } catch {
            failed.current = {
              action: "install",
              operation: async () => {
                await primaryRuntime.runUpdateNow();
              },
            };
            setError("install");
          }
        }
      }),
    diagnose: () =>
      perform("diagnose", async () => {
        const result = await primaryRuntime.diagnoseDependencies({
          probeExecutables: true,
        });
        if (mounted.current) setDiagnosed(result.installed);
      }),
    reinstall: () =>
      perform("install", async () => {
        await primaryRuntime.resetDependencies();
      }),
    cancel: () => {
      const id = diagnostics?.update?.id;
      return perform("cancel", async () => {
        if (id) await primaryRuntime.cancelInstall({ id });
      });
    },
  };
}
