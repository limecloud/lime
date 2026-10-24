import type {
  LocalEnvironmentSelectionMutation,
  LocalEnvironmentSelections,
} from "./persistedAtomTypes";

function reject(): never {
  throw new Error("invalid local environment selection");
}

function record(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    reject();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.getOwnPropertySymbols(value).length ||
    Object.values(descriptors).some(
      (descriptor) => !descriptor.enumerable || !("value" in descriptor),
    )
  )
    reject();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 16_384 ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    reject();
  return value;
}

function absolutePath(value: unknown): string {
  const path = text(value);
  if (!/^(?:\/|[a-z]:[\\/]|\\\\)/iu.test(path)) reject();
  return path;
}

function workspaceKey(value: unknown): string {
  const key = text(value);
  if (!/^.+:(?:\/|[a-z]:[\\/]|\\\\)/iu.test(key)) reject();
  return key;
}

export function parseLocalEnvironmentSelections(
  value: unknown,
  maxEntries: number,
): LocalEnvironmentSelections {
  const entries = Object.entries(record(value));
  if (entries.length > maxEntries) reject();
  return Object.fromEntries(
    entries.map(([key, path]) => [
      workspaceKey(key),
      path === null ? null : absolutePath(path),
    ]),
  );
}

export function parseLocalEnvironmentSelectionMutation(
  value: unknown,
): LocalEnvironmentSelectionMutation {
  const mutation = record(value);
  const key = workspaceKey(mutation.workspaceKey);
  const keys = Object.keys(mutation);
  if (
    mutation.op === "delete" &&
    keys.length === 2 &&
    keys.every((key) => ["op", "workspaceKey"].includes(key))
  )
    return { op: "delete", workspaceKey: key };
  if (
    mutation.op !== "set" ||
    keys.length !== 3 ||
    !keys.every((key) => ["op", "workspaceKey", "configPath"].includes(key))
  )
    reject();
  return {
    op: "set",
    workspaceKey: key,
    configPath:
      mutation.configPath === null ? null : absolutePath(mutation.configPath),
  };
}
