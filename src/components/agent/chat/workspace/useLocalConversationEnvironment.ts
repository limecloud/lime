import { useEffect, useState } from "react";
import type { LocalEnvironmentResult } from "../../../../../packages/app-server-client/src/protocol";
import { useLocalEnvironmentSelection } from "@/hooks/useLocalEnvironmentSelection";
import { useWorktreeEnvironmentSelection } from "@/hooks/useWorktreeEnvironmentSelection";
import { localEnvironments } from "@/lib/api/localEnvironments";
import type { ProjectGitStatus } from "@/lib/api/projectGit";

/** Git scope owns linked checkout selection; Host preferences own the source checkout. */
export function useLocalConversationEnvironment({
  workspaceRoot,
  status,
  loading,
  failed,
  refresh,
}: {
  workspaceRoot: string;
  status: ProjectGitStatus | null;
  loading: boolean;
  failed: boolean;
  refresh: number;
}) {
  const sourceSelection = useLocalEnvironmentSelection({
    workspaceRoot,
    selectDefaultEnvironment: true,
    enabled: !loading && !failed && Boolean(status) && !status?.isWorktree,
  });
  const worktreeSelection = useWorktreeEnvironmentSelection({
    workspaceRoot,
    status,
    enabled: !loading && !failed,
    refresh,
  });
  const selection = status?.isWorktree ? worktreeSelection : sourceSelection;
  const configPath = selection.repairConfigPath ?? selection.resolvedConfigPath;
  const key = JSON.stringify([workspaceRoot, configPath, refresh]);
  const [config, setConfig] = useState<{
    key: string;
    result: LocalEnvironmentResult | null;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    let current = true;
    if (!configPath || loading || failed) return;
    void localEnvironments.readConfig(configPath).then(
      (response) => {
        if (current)
          setConfig({
            key,
            result: response.environment ?? null,
            error: !response.exists || response.environment?.type !== "success",
          });
      },
      () => {
        if (current) setConfig({ key, result: null, error: true });
      },
    );
    return () => {
      current = false;
    };
  }, [key, configPath, loading, failed]);
  const active = config?.key === key ? config : null;
  const error = failed || selection.error || Boolean(active?.error);
  const isLoading =
    loading || selection.isLoading || Boolean(configPath && !active && !error);
  return {
    configPath,
    environment:
      !isLoading && !error && active?.result?.type === "success"
        ? active.result
        : null,
    loading: isLoading,
    error,
    reload: selection.reload,
    selection,
    canChangeEnvironment:
      !failed &&
      !loading &&
      Boolean(status) &&
      (!status?.isWorktree || Boolean(status.repositoryRoot)),
  };
}
