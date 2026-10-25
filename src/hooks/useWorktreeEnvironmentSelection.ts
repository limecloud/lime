import { useEffect, useRef, useState } from "react";
import type { LocalEnvironmentResult } from "../../packages/app-server-client/src/protocol";
import { localEnvironments } from "@/lib/api/localEnvironments";
import {
  setProjectGitWorktreeEnvironment,
  type ProjectGitStatus,
} from "@/lib/api/projectGit";
import {
  areLocalEnvironmentPathsEqual,
  resolveLocalEnvironmentSelection,
} from "@/lib/localEnvironmentSelection";
import type { LocalEnvironmentSelection } from "./useLocalEnvironmentSelection";

/** A projection of Git's per-worktree selection; never writes Host source preferences. */
export function useWorktreeEnvironmentSelection({
  workspaceRoot,
  status,
  enabled,
  refresh,
}: {
  workspaceRoot: string;
  status: ProjectGitStatus | null;
  enabled: boolean;
  refresh: number;
}): LocalEnvironmentSelection {
  const key = enabled && status?.isWorktree ? workspaceRoot : null;
  const generation = useRef(0);
  const writing = useRef<object | null>(null);
  const [reload, setReload] = useState(0);
  const [list, setList] = useState<{
    key: string | null;
    environments: LocalEnvironmentResult[];
    ready: boolean;
    error: boolean;
  }>({ key: null, environments: [], ready: false, error: false });
  const [mutation, setMutation] = useState<{
    key: string;
    source: ProjectGitStatus;
    result: ProjectGitStatus;
  } | null>(null);
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    generation.current += 1;
    writing.current = null;
    setUpdating(false);
    return () => {
      generation.current += 1;
    };
  }, [key]);
  useEffect(() => {
    let current = true;
    setList((previous) => ({
      key,
      environments: previous.key === key ? previous.environments : [],
      ready: false,
      error: false,
    }));
    if (key)
      void localEnvironments.list(key).then(
        (response) => {
          if (current)
            setList({
              key,
              environments: response.environments,
              ready: true,
              error: false,
            });
        },
        () => {
          if (current)
            setList({ key, environments: [], ready: false, error: true });
        },
      );
    return () => {
      current = false;
    };
  }, [key, refresh, reload]);
  const environments = list.key === key ? list.environments : [];
  const ready = Boolean(key && list.key === key && list.ready);
  const error = list.key === key && list.error;
  const currentStatus =
    mutation?.key === key && mutation.source === status
      ? mutation.result
      : status;
  const configPath = key
    ? (currentStatus?.localEnvironmentConfigPath ?? null)
    : null;
  const resolved = resolveLocalEnvironmentSelection({
    workspaceRoot,
    environments,
    canValidateSelection: false,
    selectionsByWorkspace: {},
  });
  const damaged =
    configPath &&
    environments.some(
      (entry) =>
        entry.type === "error" &&
        areLocalEnvironmentPathsEqual(entry.configPath, configPath),
    );
  const updateSelection = async (path: string | null) => {
    if (!key || !status || !ready || error || writing.current) return false;
    const token = {},
      epoch = generation.current;
    writing.current = token;
    setUpdating(true);
    try {
      const result = await setProjectGitWorktreeEnvironment(key, path);
      if (generation.current !== epoch || writing.current !== token)
        return false;
      setMutation({ key, source: status, result });
      return true;
    } catch {
      return false;
    } finally {
      if (writing.current === token) {
        writing.current = null;
        setUpdating(false);
      }
    }
  };
  return {
    ...resolved,
    environments,
    ready,
    error,
    updating,
    isLoading: Boolean(key && !ready && !error),
    savedConfigPath: undefined,
    resolvedConfigPath: damaged ? null : configPath,
    repairConfigPath: damaged ? configPath : null,
    updateSelection,
    reload: () => setReload((value) => value + 1),
  };
}
