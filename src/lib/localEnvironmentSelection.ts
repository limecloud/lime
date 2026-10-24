import type { LocalEnvironmentResult } from "../../packages/app-server-client/src/protocol";
import type { LocalEnvironmentSelections } from "./api/persistedAtomTypes";

function stripDevicePrefix(path: string): string {
  const unc = path.match(/^\\\\\?\\UNC\\(.*)$/i);
  if (unc) return `\\\\${unc[1]}`;
  return path.match(/^\\\\\?\\([a-zA-Z]:[\\/].*)$/)?.[1] ?? path;
}

function windowsComparablePath(path: string): string {
  const value = stripDevicePrefix(path).replaceAll("\\", "/").toLowerCase();
  const wsl = value.match(/^\/\/(?:wsl\$|wsl\.localhost)\/[^/]+(?:\/(.*))?$/);
  if (wsl) return wsl[1] ? `/${wsl[1]}` : "/";
  const drive = value.match(/^\/?([a-z]):(?:\/(.*))?$/);
  if (drive) return `/mnt/${drive[1]}${drive[2] ? `/${drive[2]}` : ""}`;
  return value;
}

/** Mirrors the shipped Desktop path comparison, including WSL mount aliases. */
export function normalizeLocalEnvironmentPath(path: string): string {
  const value = stripDevicePrefix(path).replaceAll("\\", "/");
  const drivePath = /^\/[a-z]:\//i.test(value) ? value.slice(1) : value;
  const wsl = value.match(
    /^\/\/(?:wsl\$|wsl\.localhost)\/([^/]+)(?:\/(.*))?$/i,
  );
  let normalized = value;
  if (wsl) {
    const directory = `/${wsl[2] ?? ""}`;
    normalized = /^\/mnt\/[a-z](?:\/|$)/i.test(directory)
      ? `win32:${windowsComparablePath(directory)}`
      : `wsl:${wsl[1].toLowerCase()}:${directory}`;
  } else if (
    /^[a-z]:[\\/]/i.test(drivePath) ||
    /^\/\/[^/]+\/[^/]+/.test(drivePath)
  ) {
    normalized = `win32:${windowsComparablePath(drivePath)}`;
  }
  return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
}

function windowsComparison(path: string) {
  if (path.startsWith("win32:")) return { path: path.slice(6), explicit: true };
  return /^\/mnt\/[a-z](?:\/|$)/i.test(path)
    ? { path: windowsComparablePath(path), explicit: false }
    : null;
}

export function areLocalEnvironmentPathsEqual(
  left: string,
  right: string,
): boolean {
  const a = normalizeLocalEnvironmentPath(left);
  const b = normalizeLocalEnvironmentPath(right);
  if (a === b) return true;
  const x = windowsComparison(a);
  const y = windowsComparison(b);
  return Boolean(x && y && (x.explicit || y.explicit) && x.path === y.path);
}

export function localEnvironmentWorkspaceKey(
  workspaceRoot: string | null | undefined,
  hostId = "local",
): string | null {
  if (!workspaceRoot || workspaceRoot === "/") return null;
  return `${hostId}:${normalizeLocalEnvironmentPath(workspaceRoot)}`;
}

export function areLocalEnvironmentWorkspaceKeysEqual(
  left: string,
  right: string,
): boolean {
  const separator = left.indexOf(":");
  if (separator <= 0 || right.indexOf(":") !== separator) return false;
  return (
    left.slice(0, separator) === right.slice(0, separator) &&
    areLocalEnvironmentPathsEqual(
      left.slice(separator + 1),
      right.slice(separator + 1),
    )
  );
}

export function getSavedLocalEnvironmentSelection(
  selections: LocalEnvironmentSelections,
  workspaceKey: string | null,
): string | null | undefined {
  if (workspaceKey === null) return undefined;
  if (Object.hasOwn(selections, workspaceKey))
    return selections[workspaceKey] ?? null;
  let saved: string | null | undefined;
  for (const [key, value] of Object.entries(selections)) {
    if (!areLocalEnvironmentWorkspaceKeysEqual(key, workspaceKey)) continue;
    if (saved === undefined) saved = value;
    else if (saved === null || value === null) {
      if (saved !== value) return null;
    } else if (!areLocalEnvironmentPathsEqual(saved, value)) return null;
  }
  return saved;
}

export function resolveLocalEnvironmentSelection({
  canValidateSelection,
  environments,
  hostId = "local",
  selectDefaultEnvironment = false,
  selectionsByWorkspace,
  workspaceRoot,
}: {
  canValidateSelection: boolean;
  environments: readonly LocalEnvironmentResult[];
  hostId?: string;
  selectDefaultEnvironment?: boolean;
  selectionsByWorkspace: LocalEnvironmentSelections;
  workspaceRoot: string | null | undefined;
}) {
  const workspaceKey = localEnvironmentWorkspaceKey(workspaceRoot, hostId);
  const successful = environments.filter((entry) => entry.type === "success");
  const defaultEnvironment =
    successful.find(
      (entry) =>
        stripDevicePrefix(entry.configPath)
          .replaceAll("\\", "/")
          .split("/")
          .at(-1) === "environment.toml",
    ) ??
    successful[0] ??
    null;
  const defaultEnvironmentNormalized = defaultEnvironment
    ? normalizeLocalEnvironmentPath(defaultEnvironment.configPath)
    : null;
  const savedConfigPath = getSavedLocalEnvironmentSelection(
    selectionsByWorkspace,
    workspaceKey,
  );
  const selected =
    savedConfigPath == null
      ? null
      : (environments.find((entry) =>
          areLocalEnvironmentPathsEqual(entry.configPath, savedConfigPath),
        ) ?? null);
  let resolvedConfigPath = savedConfigPath ?? null;
  if (savedConfigPath === undefined && selectDefaultEnvironment)
    resolvedConfigPath = defaultEnvironment?.configPath ?? null;
  if (selected?.type === "error") resolvedConfigPath = null;
  else if (canValidateSelection && savedConfigPath != null)
    resolvedConfigPath =
      selected?.configPath ?? defaultEnvironment?.configPath ?? null;
  const repairConfigPath =
    selected?.type === "error"
      ? selected.configPath
      : savedConfigPath === undefined && !defaultEnvironment
        ? (environments.find((entry) => entry.type === "error")?.configPath ??
          null)
        : null;
  return {
    workspaceKey,
    defaultEnvironment,
    defaultEnvironmentNormalized,
    availableEnvironments: successful.filter(
      (entry) =>
        normalizeLocalEnvironmentPath(entry.configPath) !==
        defaultEnvironmentNormalized,
    ),
    savedConfigPath,
    resolvedConfigPath,
    repairConfigPath,
    normalizedResolvedConfigPath: resolvedConfigPath
      ? normalizeLocalEnvironmentPath(resolvedConfigPath)
      : null,
  };
}
