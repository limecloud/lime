import { Buffer } from "node:buffer";
import {
  assertPersistedDraftPayload,
  type PersistedAtomLimits,
} from "../src/lib/api/persistedAtomProtocol";
import type {
  DraftIdentity,
  DraftScope,
  JsonObject,
  PersistedAtomEnvelope,
  PersistedAtomMutation,
  PersistedAtomReason,
  PersistedDraftEntry,
  PersistedDraftIndexItem,
} from "../src/lib/api/persistedAtomTypes";
import {
  LOCAL_ENV_SELECTIONS_ATOM_KEY,
  LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY,
  PERSISTED_BOOLEAN_ATOM_KEYS,
  type PersistedBooleanAtomKey,
} from "../src/lib/api/persistedAtomTypes";
import { parseLocalEnvironmentSelections } from "../src/lib/api/localEnvironmentSelectionProtocol";
import { parseLocalEnvironmentRecentActions } from "../src/lib/api/localEnvironmentRecentActionsProtocol";

export const COMPOSER_ATOM_KEY = "composer-drafts-v1" as const;

export class AtomValidationError extends Error {
  constructor(readonly reason: PersistedAtomReason) {
    super(reason);
  }
}

export function invalid(reason: PersistedAtomReason): never {
  throw new AtomValidationError(reason);
}

function record(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    invalid("invalid_request");
  if (
    Object.getOwnPropertySymbols(value).length ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (descriptor) => !descriptor.enumerable || !("value" in descriptor),
    )
  )
    invalid("invalid_request");
  return value as Record<string, unknown>;
}

export function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const object = record(value);
  const descriptors = Object.getOwnPropertyDescriptors(object);
  if (
    Object.getOwnPropertySymbols(object).length ||
    required.some((key) => !Object.hasOwn(object, key)) ||
    Object.keys(descriptors).some(
      (key) =>
        (!required.includes(key) && !optional.includes(key)) ||
        !descriptors[key].enumerable ||
        !("value" in descriptors[key]),
    )
  )
    invalid("invalid_request");
  return object;
}

export function identifier(value: unknown, maxLength = 256): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    invalid("invalid_request");
  return value;
}

export function parseScope(value: unknown): DraftScope {
  try {
    const scope = exactRecord(value, ["workspaceId", "kind", "id"]);
    if (
      typeof scope.kind !== "string" ||
      !["home", "draft", "local"].includes(scope.kind)
    )
      invalid("invalid_scope");
    const id = identifier(scope.id, 8_192);
    if (scope.kind === "home" && id !== "new-conversation")
      invalid("invalid_scope");
    return {
      workspaceId:
        scope.workspaceId === null
          ? null
          : identifier(scope.workspaceId, 4_096),
      kind: scope.kind as DraftScope["kind"],
      id,
    };
  } catch {
    return invalid("invalid_scope");
  }
}

export function scopeKey(scope: DraftScope): string {
  return JSON.stringify([scope.workspaceId, scope.kind, scope.id]);
}

function compareScopeKeys(left: string, right: string): number {
  let a = 0,
    b = 0;
  while (a < left.length && b < right.length) {
    const x = left.codePointAt(a)!,
      y = right.codePointAt(b)!;
    if (x !== y) return x - y;
    a += x > 0xffff ? 2 : 1;
    b += y > 0xffff ? 2 : 1;
  }
  return a < left.length ? 1 : b < right.length ? -1 : 0;
}

/** Read-only projection from the store owner; no parallel index or cache. */
export function projectWorkspaceDraftIndex(
  bindings: ReadonlyMap<string, string>,
  entries: ReadonlyMap<string, PersistedDraftEntry>,
  workspaceId: string | null,
): readonly PersistedDraftIndexItem[] {
  const items: PersistedDraftIndexItem[] = [];
  for (const [key, draftId] of bindings) {
    const entry = entries.get(draftId);
    if (!entry || entry.state !== "draft" || entry.draftId !== draftId)
      continue;
    let scope: DraftScope;
    try {
      const parts: unknown = JSON.parse(key);
      if (!Array.isArray(parts) || parts.length !== 3) continue;
      scope = parseScope({
        workspaceId: parts[0],
        kind: parts[1],
        id: parts[2],
      });
    } catch {
      continue;
    }
    if (
      scopeKey(scope) !== key ||
      scope.workspaceId !== workspaceId ||
      (scope.kind === "local" && entry.sessionId !== scope.id)
    )
      continue;
    items.push({
      scope,
      identity: { draftId: entry.draftId, scopeVersion: entry.scopeVersion },
      updatedAt: entry.updatedAt,
      ...(entry.sessionId !== undefined ? { sessionId: entry.sessionId } : {}),
      ...(entry.threadId !== undefined ? { threadId: entry.threadId } : {}),
    });
  }
  return items.sort((left, right) => {
    if (left.updatedAt !== right.updatedAt)
      return right.updatedAt - left.updatedAt;
    return compareScopeKeys(scopeKey(left.scope), scopeKey(right.scope));
  });
}

export function parseIdentity(value: unknown): DraftIdentity {
  const identity = exactRecord(value, ["draftId", "scopeVersion"]);
  return {
    draftId: identifier(identity.draftId),
    scopeVersion: identifier(identity.scopeVersion),
  };
}

/** Reject lossy JSON values, accessors and cycles before serialization. */
export function cloneDraft(value: unknown, maxBytes: number): JsonObject {
  try {
    assertPersistedDraftPayload(value);
  } catch {
    return invalid("invalid_payload");
  }
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > maxBytes) invalid("capacity_exceeded");
  return JSON.parse(json) as JsonObject;
}

export function parseMutation(
  value: unknown,
  limits: PersistedAtomLimits,
): PersistedAtomMutation {
  const op = record(value).op;
  if (op === "put") {
    const update = exactRecord(value, [
      "op",
      "scope",
      "draftId",
      "expectedVersion",
      "nextVersion",
      "draft",
    ]);
    const expectedVersion =
      update.expectedVersion === null
        ? null
        : identifier(update.expectedVersion);
    const nextVersion = identifier(update.nextVersion);
    if (expectedVersion === nextVersion) invalid("version_conflict");
    return {
      op,
      scope: parseScope(update.scope),
      draftId: identifier(update.draftId),
      expectedVersion,
      nextVersion,
      draft: cloneDraft(update.draft, limits.maxDraftBytes),
    };
  }
  if (op === "promote") {
    const update = exactRecord(
      value,
      ["op", "source", "target", "identity", "expectedTarget"],
      ["sessionId", "threadId"],
    );
    return {
      op,
      source: parseScope(update.source),
      target: parseScope(update.target),
      identity: parseIdentity(update.identity),
      expectedTarget:
        update.expectedTarget === null
          ? null
          : parseIdentity(update.expectedTarget),
      ...(update.sessionId === undefined
        ? {}
        : { sessionId: identifier(update.sessionId) }),
      ...(update.threadId === undefined
        ? {}
        : { threadId: identifier(update.threadId) }),
    };
  }
  if (op === "consume" || op === "clear") {
    const update = exactRecord(value, ["op", "identity"]);
    return { op, identity: parseIdentity(update.identity) };
  }
  return invalid("invalid_request");
}

function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    invalid("invalid_request");
  return value;
}

function parseEntry(
  value: unknown,
  limits: PersistedAtomLimits,
): PersistedDraftEntry {
  const state = record(value).state;
  const base = [
    "draftId",
    "scopeVersion",
    "originScopeKey",
    "state",
    "updatedAt",
  ];
  const entry = exactRecord(
    value,
    [
      ...base,
      ...(state === "draft" ? ["draft"] : ["consumption", "consumedAt"]),
    ],
    ["sessionId", "threadId"],
  );
  let origin: unknown;
  try {
    origin = JSON.parse(identifier(entry.originScopeKey, 16_384));
  } catch {
    return invalid("invalid_request");
  }
  if (!Array.isArray(origin) || origin.length !== 3) invalid("invalid_request");
  const originScope = parseScope({
    workspaceId: origin[0],
    kind: origin[1],
    id: origin[2],
  });
  if (scopeKey(originScope) !== entry.originScopeKey)
    invalid("invalid_request");
  const metadata = {
    draftId: identifier(entry.draftId),
    scopeVersion: identifier(entry.scopeVersion),
    originScopeKey: entry.originScopeKey as string,
    updatedAt: timestamp(entry.updatedAt),
    ...(entry.sessionId === undefined
      ? {}
      : { sessionId: identifier(entry.sessionId) }),
    ...(entry.threadId === undefined
      ? {}
      : { threadId: identifier(entry.threadId) }),
  };
  if (state === "draft")
    return {
      ...metadata,
      state,
      draft: cloneDraft(entry.draft, limits.maxDraftBytes),
    };
  if (
    state !== "consumed" ||
    typeof entry.consumption !== "string" ||
    !["accepted", "clear"].includes(entry.consumption)
  )
    invalid("invalid_request");
  return {
    ...metadata,
    state,
    consumption: entry.consumption as "accepted" | "clear",
    consumedAt: timestamp(entry.consumedAt),
  };
}

export function parseEnvelope(
  value: unknown,
  limits: PersistedAtomLimits,
): PersistedAtomEnvelope {
  const envelope = exactRecord(value, [
    "format",
    "version",
    "storeRevision",
    "atoms",
  ]);
  if (
    envelope.format !== "electron-persisted-atom-state" ||
    envelope.version !== 1
  )
    invalid("invalid_request");
  const atoms = exactRecord(
    envelope.atoms,
    [COMPOSER_ATOM_KEY],
    [
      ...PERSISTED_BOOLEAN_ATOM_KEYS,
      LOCAL_ENV_SELECTIONS_ATOM_KEY,
      LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY,
    ],
  );
  const booleans: Partial<Record<PersistedBooleanAtomKey, boolean>> = {};
  for (const key of PERSISTED_BOOLEAN_ATOM_KEYS) {
    if (!Object.hasOwn(atoms, key)) continue;
    const value = atoms[key];
    if (typeof value !== "boolean") invalid("invalid_request");
    booleans[key] = value;
  }
  const atom = exactRecord(atoms[COMPOSER_ATOM_KEY], ["bindings", "entries"]);
  const rawEntries = record(atom.entries);
  const rawBindings = record(atom.bindings);
  if (
    Object.keys(rawEntries).length > limits.maxEntries ||
    Object.keys(rawBindings).length > limits.maxBindings
  )
    invalid("capacity_exceeded");
  const entries = Object.fromEntries(
    Object.entries(rawEntries).map(([id, item]) => {
      const entry = parseEntry(item, limits);
      if (id !== entry.draftId) invalid("invalid_request");
      return [id, entry];
    }),
  );
  const seen = new Set<string>();
  const bindings = Object.fromEntries(
    Object.entries(rawBindings).map(([key, id]) => {
      let parts: unknown;
      try {
        parts = JSON.parse(key);
      } catch {
        return invalid("invalid_request");
      }
      if (!Array.isArray(parts) || parts.length !== 3)
        invalid("invalid_request");
      const scope = parseScope({
        workspaceId: parts[0],
        kind: parts[1],
        id: parts[2],
      });
      const identity = identifier(id);
      if (
        scopeKey(scope) !== key ||
        !Object.hasOwn(entries, identity) ||
        entries[identity].state !== "draft" ||
        seen.has(identity)
      )
        invalid("invalid_request");
      if (scope.kind === "local" && entries[identity].sessionId !== scope.id)
        invalid("invalid_request");
      seen.add(identity);
      return [key, identity];
    }),
  );
  if (
    Object.values(entries).some(
      (entry) => entry.state === "draft" && !seen.has(entry.draftId),
    )
  )
    invalid("invalid_request");
  return {
    format: "electron-persisted-atom-state",
    version: 1,
    storeRevision: timestamp(envelope.storeRevision),
    atoms: {
      [COMPOSER_ATOM_KEY]: { entries, bindings },
      ...booleans,
      ...(Object.hasOwn(atoms, LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY)
        ? {
            [LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY]:
              parseLocalEnvironmentRecentActions(
                atoms[LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY],
                limits.maxBindings,
              ),
          }
        : {}),
      ...(Object.hasOwn(atoms, LOCAL_ENV_SELECTIONS_ATOM_KEY)
        ? {
            [LOCAL_ENV_SELECTIONS_ATOM_KEY]: parseLocalEnvironmentSelections(
              atoms[LOCAL_ENV_SELECTIONS_ATOM_KEY],
              limits.maxBindings,
            ),
          }
        : {}),
    },
  };
}
