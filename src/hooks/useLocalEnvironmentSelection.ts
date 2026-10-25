import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalEnvironmentResult } from "../../packages/app-server-client/src/protocol";
import { localEnvironments } from "@/lib/api/localEnvironments";
import {
  listenPersistedAtomUpdates,
  sendPersistedAtomState,
  updatePersistedAtomState,
} from "@/lib/api/persistedAtoms";
import {
  LOCAL_ENV_SELECTIONS_ATOM_KEY,
  type LocalEnvironmentSelections,
} from "@/lib/api/persistedAtomTypes";
import {
  localEnvironmentWorkspaceKey,
  resolveLocalEnvironmentSelection,
} from "@/lib/localEnvironmentSelection";

/** A projection of Host UI preferences and the current App Server list. */
export function useLocalEnvironmentSelection({
  workspaceRoot,
  selectDefaultEnvironment = false,
  enabled = true,
}: {
  workspaceRoot: string | null | undefined;
  selectDefaultEnvironment?: boolean;
  enabled?: boolean;
}) {
  const workspaceKey = enabled
    ? localEnvironmentWorkspaceKey(workspaceRoot)
    : null;
  const generation = useRef(0);
  const revisionKey = useRef<string | null>(null);
  const revision = useRef(-1);
  const reading = useRef(0);
  const writing = useRef<object | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{
    key: string | null;
    selections: LocalEnvironmentSelections;
    ready: boolean;
    error: boolean;
  }>({ key: null, selections: {}, ready: false, error: false });
  const [list, setList] = useState<{
    key: string | null;
    environments: LocalEnvironmentResult[];
    loading: boolean;
    error: boolean;
  }>({ key: null, environments: [], loading: false, error: false });
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const epoch = ++generation.current;
    if (revisionKey.current !== workspaceKey) {
      revision.current = -1;
      revisionKey.current = workspaceKey;
    }
    reading.current = 0;
    writing.current = null;
    setUpdating(false);
    setState((current) =>
      current.key === workspaceKey
        ? { ...current, error: false }
        : { key: workspaceKey, selections: {}, ready: false, error: false },
    );
    if (!workspaceKey) return;
    let unlisten: (() => void) | undefined;
    const read = async () => {
      const sequence = ++reading.current;
      try {
        const result = await sendPersistedAtomState({
          key: LOCAL_ENV_SELECTIONS_ATOM_KEY,
          query: { kind: "selections" },
        });
        if (
          generation.current !== epoch ||
          reading.current !== sequence ||
          result.storeRevision < revision.current
        )
          return;
        revision.current = result.storeRevision;
        if (
          result.outcome === "ready" &&
          result.data.queryKind === "selections"
        )
          setState({
            key: workspaceKey,
            selections: result.data.selections,
            ready: true,
            error: result.persistence.state === "error",
          });
        else
          setState((current) => ({
            ...current,
            error: result.persistence.state !== "loading",
          }));
      } catch {
        if (generation.current === epoch && reading.current === sequence)
          setState((current) => ({ ...current, error: true }));
      }
    };
    void listenPersistedAtomUpdates((event) => {
      if (
        event.key === LOCAL_ENV_SELECTIONS_ATOM_KEY &&
        event.storeRevision >= revision.current
      )
        void read();
    })
      .then((stop) => {
        if (generation.current !== epoch) stop();
        else {
          unlisten = stop;
          void read();
        }
      })
      .catch(() => {
        if (generation.current === epoch)
          setState((current) => ({ ...current, error: true }));
      });
    return () => {
      generation.current += 1;
      writing.current = null;
      unlisten?.();
    };
  }, [workspaceKey, refresh]);

  useEffect(() => {
    let current = true;
    setList((current) => ({
      key: workspaceKey,
      environments: current.key === workspaceKey ? current.environments : [],
      loading: Boolean(workspaceKey),
      error: false,
    }));
    if (!workspaceKey || !workspaceRoot) return;
    void localEnvironments
      .list(workspaceRoot)
      .then((result) => {
        if (current)
          setList({
            key: workspaceKey,
            environments: result.environments,
            loading: false,
            error: false,
          });
      })
      .catch(() => {
        if (current)
          setList((previous) => ({ ...previous, loading: false, error: true }));
      });
    return () => {
      current = false;
    };
  }, [workspaceKey, workspaceRoot, refresh]);

  const ready = Boolean(
    workspaceKey && state.key === workspaceKey && state.ready,
  );
  const environments = list.key === workspaceKey ? list.environments : [];
  const isLoading = Boolean(
    workspaceKey &&
    ((!ready && !state.error) || list.key !== workspaceKey || list.loading),
  );
  const error =
    (state.key === workspaceKey && state.error) ||
    (list.key === workspaceKey && list.error);
  const resolved = resolveLocalEnvironmentSelection({
    workspaceRoot,
    environments,
    selectDefaultEnvironment,
    selectionsByWorkspace: ready ? state.selections : {},
    canValidateSelection: !isLoading && !error,
  });
  const mutate = useCallback(
    async (configPath: string | null | undefined) => {
      if (!workspaceKey || !ready || writing.current) return false;
      const epoch = generation.current,
        token = {};
      writing.current = token;
      setUpdating(true);
      try {
        const result = await updatePersistedAtomState({
          key: LOCAL_ENV_SELECTIONS_ATOM_KEY,
          mutation:
            configPath === undefined
              ? { op: "delete", workspaceKey }
              : { op: "set", workspaceKey, configPath },
        });
        if (generation.current !== epoch) return false;
        if (result.outcome !== "applied" || !result.selections)
          throw Error("Selection update failed");
        if (result.storeRevision >= revision.current) {
          revision.current = result.storeRevision;
          setState({
            key: workspaceKey,
            selections: result.selections,
            ready: true,
            error: result.persistence.state === "error",
          });
        }
        return result.persistence.state !== "error";
      } catch {
        if (generation.current === epoch)
          setState((previous) => ({ ...previous, error: true }));
        return false;
      } finally {
        if (writing.current === token) {
          writing.current = null;
          setUpdating(false);
        }
      }
    },
    [workspaceKey, ready],
  );
  const updateSelection = useCallback(
    (configPath: string | null) => mutate(configPath),
    [mutate],
  );
  const resetSelection = useCallback(() => mutate(undefined), [mutate]);
  const reload = useCallback(() => setRefresh((value) => value + 1), []);
  return {
    ...resolved,
    environments,
    isLoading,
    error,
    updating,
    ready,
    resolvedConfigPath: ready ? resolved.resolvedConfigPath : null,
    updateSelection,
    resetSelection,
    reload,
  };
}

export type LocalEnvironmentSelection = Pick<
  ReturnType<typeof useLocalEnvironmentSelection>,
  | "ready"
  | "isLoading"
  | "error"
  | "updating"
  | "environments"
  | "resolvedConfigPath"
  | "repairConfigPath"
  | "savedConfigPath"
  | "defaultEnvironment"
  | "availableEnvironments"
  | "updateSelection"
  | "reload"
> & { resetSelection?: () => Promise<boolean> };
