import { useCallback, useEffect, useRef, useState } from "react";
import { listProjects } from "@/lib/api/project";
import {
  listHooks,
  updateHookState,
  type HookStateUpdate,
  type HooksListEntry,
} from "@/lib/api/hooks";

export function useHooks() {
  const [data, setData] = useState<HooksListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [mutationError, setMutationError] = useState<
    "save" | "overridden" | "refresh" | null
  >(null);
  const [hasProjects, setHasProjects] = useState(false);
  const current = useRef(0);
  const busy = useRef(false);
  const roots = useRef<string[]>([]);

  const reload = useCallback(async () => {
    if (busy.current) return;
    const revision = ++current.current;
    busy.current = true;
    setLoading(true);
    setLoadError(false);
    setMutationError(null);
    try {
      const projects = await listProjects();
      if (current.current !== revision) return;
      const cwds = [
        ...new Set(
          projects
            .filter((project) => !project.isArchived)
            .map((project) => project.rootPath)
            .filter(Boolean),
        ),
      ];
      const response = cwds.length ? await listHooks({ cwds }) : { data: [] };
      if (current.current !== revision) return;
      roots.current = cwds;
      setHasProjects(cwds.length > 0);
      setData(response.data);
    } catch {
      if (current.current === revision) setLoadError(true);
    } finally {
      if (current.current === revision) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, []);

  const invalidate = useCallback(() => {
    ++current.current;
    busy.current = false;
  }, []);
  useEffect(() => {
    void reload();
    return invalidate;
  }, [reload, invalidate]);

  const update = async (updates: HookStateUpdate[]) => {
    if (busy.current || updates.length === 0) return;
    const revision = current.current;
    busy.current = true;
    setPending(true);
    setMutationError(null);
    let saved = false;
    try {
      const response = await updateHookState(updates);
      saved = true;
      if (current.current !== revision) return;
      const latest = await listHooks({ cwds: roots.current });
      if (current.current !== revision) return;
      setData(latest.data);
      const overridden =
        response.status === "okOverridden" ||
        updates.some((update) => {
          const hooks = latest.data.flatMap((entry) =>
            entry.hooks.filter((hook) => hook.key === update.key),
          );
          return (
            hooks.length === 0 ||
            hooks.some(
              (hook) =>
                (update.enabled != null && hook.enabled !== update.enabled) ||
                (update.trustedHash != null &&
                  (hook.currentHash !== update.trustedHash ||
                    !["trusted", "managed"].includes(hook.trustStatus))),
            )
          );
        });
      if (overridden) setMutationError("overridden");
    } catch {
      if (current.current === revision)
        setMutationError(saved ? "refresh" : "save");
    } finally {
      if (current.current === revision) {
        busy.current = false;
        setPending(false);
      }
    }
  };
  return {
    data,
    loading,
    pending,
    loadError,
    mutationError,
    hasProjects,
    reload,
    update,
  };
}
