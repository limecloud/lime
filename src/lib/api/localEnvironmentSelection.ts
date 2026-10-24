import { localEnvironments } from "./localEnvironments";
import {
  sendPersistedAtomState,
  updatePersistedAtomState,
} from "./persistedAtoms";
import { LOCAL_ENV_SELECTIONS_ATOM_KEY } from "./persistedAtomTypes";
import {
  getSavedLocalEnvironmentSelection,
  localEnvironmentWorkspaceKey,
  resolveLocalEnvironmentSelection,
} from "../localEnvironmentSelection";

export class LocalEnvironmentSelectionError extends Error {
  constructor(
    readonly reason: "unavailable" | "invalid",
    readonly configPath?: string,
  ) {
    super(
      reason === "invalid"
        ? "Selected environment needs repair"
        : "Environment selection unavailable",
    );
    this.name = "LocalEnvironmentSelectionError";
  }
}

/** Resolve the current preference before a resource is created, never default on behalf of the caller. */
export async function readLocalEnvironmentSelection(
  workspaceRoot: string,
): Promise<string | null> {
  const workspaceKey = localEnvironmentWorkspaceKey(workspaceRoot);
  if (!workspaceKey) return null;
  const result = await sendPersistedAtomState({
    key: LOCAL_ENV_SELECTIONS_ATOM_KEY,
    query: { kind: "selections" },
  });
  if (result.outcome !== "ready" || result.data.queryKind !== "selections")
    throw new LocalEnvironmentSelectionError("unavailable");
  const saved = getSavedLocalEnvironmentSelection(
    result.data.selections,
    workspaceKey,
  );
  if (saved == null) return null;
  const list = await localEnvironments.list(workspaceRoot);
  const resolved = resolveLocalEnvironmentSelection({
    workspaceRoot,
    environments: list.environments,
    canValidateSelection: true,
    selectionsByWorkspace: result.data.selections,
  });
  if (resolved.repairConfigPath)
    throw new LocalEnvironmentSelectionError(
      "invalid",
      resolved.repairConfigPath,
    );
  return resolved.resolvedConfigPath;
}

export async function selectLocalEnvironment(
  workspaceRoot: string,
  configPath: string,
): Promise<boolean> {
  const workspaceKey = localEnvironmentWorkspaceKey(workspaceRoot);
  if (!workspaceKey) return false;
  const result = await updatePersistedAtomState({
    key: LOCAL_ENV_SELECTIONS_ATOM_KEY,
    mutation: { op: "set", workspaceKey, configPath },
  });
  return result.outcome === "applied" && result.persistence.state !== "error";
}
