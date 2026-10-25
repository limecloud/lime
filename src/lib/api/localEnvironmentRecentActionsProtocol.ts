import type {
  LocalEnvironmentRecentActionMutation,
  LocalEnvironmentRecentActions,
} from "./persistedAtomTypes";

function reject(): never {
  throw new Error("invalid local environment recent actions");
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
  if (
    Object.getOwnPropertySymbols(value).length ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
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
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    reject();
  return value;
}

function environmentKey(value: unknown): string {
  const key = text(value);
  if (!/^(?:\/|[a-z]:[\\/]|\\\\)/iu.test(key)) reject();
  return key;
}

export function parseLocalEnvironmentRecentActions(
  value: unknown,
  maxEntries: number,
): LocalEnvironmentRecentActions {
  const entries = Object.entries(record(value));
  if (entries.length > maxEntries) reject();
  return Object.fromEntries(
    entries.map(([key, names]) => {
      environmentKey(key);
      if (
        !Array.isArray(names) ||
        names.length > maxEntries ||
        Object.keys(names).length !== names.length ||
        Object.getOwnPropertySymbols(names).length ||
        Object.entries(Object.getOwnPropertyDescriptors(names)).some(
          ([key, descriptor]) =>
            key !== "length" &&
            (!/^(?:0|[1-9]\d*)$/u.test(key) ||
              !descriptor.enumerable ||
              !("value" in descriptor)),
        )
      )
        reject();
      return [key, names.map(text)];
    }),
  );
}

export function parseLocalEnvironmentRecentActionMutation(
  value: unknown,
): LocalEnvironmentRecentActionMutation {
  const data = record(value);
  if (
    data.op !== "record" ||
    Object.keys(data).length !== 3 ||
    !Object.keys(data).every((key) =>
      ["op", "environmentKey", "actionName"].includes(key),
    )
  )
    reject();
  return {
    op: "record",
    environmentKey: environmentKey(data.environmentKey),
    actionName: text(data.actionName).trim(),
  };
}

/** Packaged Desktop Kx: prepend trimmed names, removing prior occurrences. */
export function recordLocalEnvironmentAction(
  recentActions: LocalEnvironmentRecentActions,
  { environmentKey, actionName }: LocalEnvironmentRecentActionMutation,
): LocalEnvironmentRecentActions {
  const name = actionName.trim();
  return {
    ...recentActions,
    [environmentKey]: [
      name,
      ...(recentActions[environmentKey] ?? []).filter(
        (previous) => previous !== name,
      ),
    ],
  };
}
