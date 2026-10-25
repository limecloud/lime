import { useCallback, useEffect, useRef, useState } from "react";
import {
  listenPersistedAtomUpdates,
  sendPersistedAtomState,
  updatePersistedAtomState,
} from "@/lib/api/persistedAtoms";
import { LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY as key } from "@/lib/api/persistedAtomTypes";

/** Renderer projection only; concurrent histories are merged by the existing Host atom. */
export function useLocalEnvironmentRecentActions(
  environmentKey: string | null,
) {
  const epoch = useRef(0);
  const revision = useRef(-1);
  const [state, setState] = useState<{
    key: string | null;
    names: readonly string[];
    error: boolean;
  }>({ key: null, names: [], error: false });
  useEffect(() => {
    const generation = ++epoch.current;
    revision.current = -1;
    if (!environmentKey) return;
    let unlisten: (() => void) | undefined;
    let sequence = 0;
    const read = async () => {
      const request = ++sequence;
      try {
        const result = await sendPersistedAtomState({
          key,
          query: { kind: "recent-actions" },
        });
        if (
          epoch.current !== generation ||
          sequence !== request ||
          result.storeRevision < revision.current
        )
          return;
        if (
          result.outcome !== "ready" ||
          result.data.queryKind !== "recent-actions"
        )
          throw new Error("Recent actions unavailable");
        revision.current = result.storeRevision;
        setState({
          key: environmentKey,
          names: result.data.recentActions[environmentKey] ?? [],
          error: result.persistence.state === "error",
        });
      } catch {
        if (epoch.current === generation && sequence === request)
          setState((previous) => ({ ...previous, error: true }));
      }
    };
    void listenPersistedAtomUpdates((event) => {
      if (event.key === key && event.storeRevision >= revision.current)
        void read();
    })
      .then((stop) => {
        if (epoch.current !== generation) stop();
        else {
          unlisten = stop;
          void read();
        }
      })
      .catch(() => {
        if (epoch.current === generation)
          setState((previous) => ({ ...previous, error: true }));
      });
    return () => {
      epoch.current += 1;
      unlisten?.();
    };
  }, [environmentKey]);

  const recordAction = useCallback(
    async (actionName: string) => {
      const name = actionName.trim();
      if (!environmentKey || !name) return;
      const generation = epoch.current;
      try {
        const result = await updatePersistedAtomState({
          key,
          mutation: { op: "record", environmentKey, actionName: name },
        });
        if (
          epoch.current !== generation ||
          result.storeRevision < revision.current
        )
          return;
        if (result.outcome !== "applied" || !result.recentActions)
          throw new Error("Recent action update failed");
        revision.current = result.storeRevision;
        setState({
          key: environmentKey,
          names: result.recentActions[environmentKey] ?? [],
          error: result.persistence.state === "error",
        });
      } catch {
        if (epoch.current === generation)
          setState((previous) => ({ ...previous, error: true }));
      }
    },
    [environmentKey],
  );
  return {
    recentNames: state.key === environmentKey ? state.names : [],
    recordAction,
    error: state.key === environmentKey && state.error,
  };
}
