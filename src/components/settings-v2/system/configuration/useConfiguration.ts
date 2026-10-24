import { useCallback, useEffect, useRef, useState } from "react";
import {
  getConfigSnapshot,
  configLayerFile,
  subscribeAppConfigChanged,
  writeConfigValue,
  writeReasoningEffortPreferences,
  type AppConfigSnapshot,
} from "@/lib/api/appConfig";
import {
  getConfigRequirements,
  type ConfigRequirements,
} from "@/lib/api/configRequirements";
import { getDefaultProject } from "@/lib/api/project";
import type { KnownModelReasoningEffort } from "@/lib/model/modelReasoningPolicy";
import {
  configLayerScope,
  isConfigFieldManaged,
  isManagedSource,
} from "@/lib/api/configLayers";

export type ConfigurationField =
  | "approval_policy"
  | "sandbox_mode"
  | "sandbox_workspace_write.network_access"
  | "web_search"
  | "model_verbosity"
  | "model_reasoning_summary"
  | "desktop.enabled-reasoning-efforts";
type FieldValue = string | boolean | KnownModelReasoningEffort[] | null;
interface FailedWrite {
  field: ConfigurationField;
  value: FieldValue;
  filePath: string;
}

export function useConfiguration() {
  const [scope, setScope] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AppConfigSnapshot | null>(null);
  const [requirements, setRequirements] = useState<ConfigRequirements | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(false);
  const [pendingWrites, setPendingWrites] = useState<FailedWrite[]>([]);
  const [failedWrites, setFailedWrites] = useState<
    Record<string, FailedWrite | undefined>
  >({});
  const generation = useRef(0);
  const request = useRef(0);
  const active = useRef(false);
  const writes = useRef(new Map<string, FailedWrite>());
  const workspace = useRef<Promise<string | undefined> | null>(null);
  const cwd = useRef<string | undefined>(undefined);
  const refreshAfterWrites = useRef(false);

  const load = useCallback(async () => {
    const view = generation.current;
    const sequence = ++request.current;
    try {
      workspace.current ??= getDefaultProject()
        .then((project) => project?.rootPath || undefined)
        .catch((error: unknown) => {
          workspace.current = null;
          throw error;
        });
      cwd.current = await workspace.current;
      const [next, nextRequirements] = await Promise.all([
        getConfigSnapshot(cwd.current ? { cwd: cwd.current } : undefined),
        getConfigRequirements(),
      ]);
      if (
        active.current &&
        generation.current === view &&
        request.current === sequence
      ) {
        setSnapshot(next);
        setRequirements(nextRequirements);
        setReadError(false);
      }
    } catch {
      if (
        active.current &&
        generation.current === view &&
        request.current === sequence
      )
        setReadError(true);
    } finally {
      if (
        active.current &&
        generation.current === view &&
        request.current === sequence
      )
        setLoading(false);
    }
  }, []);

  useEffect(() => {
    active.current = true;
    const view = ++generation.current;
    void load();
    const stop = subscribeAppConfigChanged(() => {
      if (writes.current.size) refreshAfterWrites.current = true;
      else void load();
    });
    return () => {
      active.current = false;
      generation.current = view + 1;
      stop();
    };
  }, [load]);

  const layers = snapshot?.layers ?? (snapshot ? [snapshot.layer] : []);
  useEffect(() => {
    if (
      scope &&
      snapshot &&
      !(snapshot.layers ?? [snapshot.layer]).some(
        (layer) => configLayerScope(layer) === scope,
      )
    )
      setScope(null);
  }, [scope, snapshot]);
  const selectedLayer =
    layers.find((layer) => configLayerScope(layer) === scope) ??
    [...layers].reverse().find((layer) => layer.name.type === "project") ??
    snapshot?.layer;
  const selectedFile = selectedLayer ? configLayerFile(selectedLayer) : null;
  const fieldFile = (field: ConfigurationField) =>
    field === "desktop.enabled-reasoning-efforts"
      ? snapshot?.layer.name.file
      : selectedFile;
  const errors: Partial<Record<ConfigurationField, FailedWrite>> = {};
  for (const failure of Object.values(failedWrites)) {
    if (failure && failure.filePath === fieldFile(failure.field))
      errors[failure.field] = failure;
  }
  const pending = pendingWrites
    .filter((write) => write.filePath === fieldFile(write.field))
    .map((write) => write.field);

  async function change(
    field: ConfigurationField,
    value: FieldValue,
    filePath = fieldFile(field),
  ) {
    const key = `${filePath}:${field}`;
    if (
      !filePath ||
      writes.current.has(key) ||
      !active.current ||
      readError ||
      (field !== "desktop.enabled-reasoning-efforts" &&
        selectedLayer &&
        (isManagedSource(selectedLayer.name) ||
          selectedLayer.disabledReason)) ||
      (snapshot && isConfigFieldManaged(snapshot.origins, field))
    )
      return;
    const view = generation.current;
    writes.current.set(key, { field, value, filePath });
    ++request.current;
    setPendingWrites([...writes.current.values()]);
    setFailedWrites((current) => ({ ...current, [key]: undefined }));
    try {
      const layer = layers.find((layer) => configLayerFile(layer) === filePath);
      const next =
        field === "desktop.enabled-reasoning-efforts"
          ? await writeReasoningEffortPreferences(
              value as KnownModelReasoningEffort[],
            ).then((user) =>
              cwd.current ? getConfigSnapshot({ cwd: cwd.current }) : user,
            )
          : await writeConfigValue({
              keyPath: field,
              value,
              filePath,
              ...(cwd.current ? { cwd: cwd.current } : {}),
              ...(layer?.name.type === "project"
                ? { expectedVersion: layer.version }
                : {}),
            });
      if (active.current && generation.current === view) {
        setSnapshot(next);
        setReadError(false);
      }
    } catch {
      if (active.current && generation.current === view) {
        setFailedWrites((current) => ({
          ...current,
          [key]: { field, value, filePath },
        }));
        refreshAfterWrites.current = true;
      }
    } finally {
      writes.current.delete(key);
      if (active.current && generation.current === view) {
        setPendingWrites([...writes.current.values()]);
        if (!writes.current.size && refreshAfterWrites.current) {
          refreshAfterWrites.current = false;
          void load();
        }
      }
    }
  }

  return {
    snapshot,
    requirements,
    selectedLayer,
    selectedFile,
    selectedScope: selectedLayer ? configLayerScope(selectedLayer) : "",
    layers,
    selectScope: setScope,
    cwd: cwd.current,
    loading,
    readError,
    pending,
    errors,
    load,
    change,
    retry: (field: ConfigurationField) => {
      const failure = errors[field];
      if (failure) void change(field, failure.value, failure.filePath);
    },
  };
}
