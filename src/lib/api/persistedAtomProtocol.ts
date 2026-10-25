import type {
  DraftIdentity,
  DraftScope,
  JsonObject,
  PersistedAtomDiagnostic,
  PersistedAtomMetadata,
  PersistedAtomPersistence,
  PersistedAtomReadResult,
  PersistedAtomReadQuery,
  PersistedDraftIndexItem,
  PersistedAtomReadRequest,
  PersistedAtomReason,
  PersistedAtomUpdateEvent,
  PersistedAtomUpdateResult,
  PersistedAtomUpdateRequest,
  PersistedDraftEntry,
} from "./persistedAtomTypes";
import {
  LOCAL_ENV_SELECTIONS_ATOM_KEY,
  LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY,
  PERSISTED_BOOLEAN_ATOM_KEYS,
  isPersistedBooleanAtomKey,
} from "./persistedAtomTypes";
import {
  parseLocalEnvironmentSelectionMutation,
  parseLocalEnvironmentSelections,
} from "./localEnvironmentSelectionProtocol";
import {
  parseLocalEnvironmentRecentActions,
  parseLocalEnvironmentRecentActionMutation,
} from "./localEnvironmentRecentActionsProtocol";

export interface PersistedAtomLimits {
  readonly maxDraftBytes: number;
  readonly maxFileBytes: number;
  readonly maxEntries: number;
  readonly maxBindings: number;
}

// Current composer: 20 * 3,932,160 decoded bytes = 100 MiB base64.
export const PERSISTED_ATOM_LIMITS: PersistedAtomLimits = Object.freeze({
  maxDraftBytes: 128 * 1024 * 1024,
  maxFileBytes: 256 * 1024 * 1024,
  maxEntries: 10_000,
  maxBindings: 10_000,
});

function reject(): never {
  throw new Error("invalid persisted atom transport");
}
function object(value: unknown): Record<string, unknown> {
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
function exact(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const result = object(value);
  if (
    required.some((key) => !Object.hasOwn(result, key)) ||
    Object.keys(result).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    reject();
  return result;
}
function id(value: unknown, max = 256): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    reject();
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    reject();
  return value;
}
function member<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) reject();
  return value as T;
}

export function parsePersistedDraftScope(value: unknown): DraftScope {
  const scope = exact(value, ["workspaceId", "kind", "id"]);
  const kind = member(scope.kind, ["home", "draft", "local"]);
  const scopeId = id(scope.id, 8_192);
  if (kind === "home" && scopeId !== "new-conversation") reject();
  return {
    workspaceId:
      scope.workspaceId === null ? null : id(scope.workspaceId, 4_096),
    kind,
    id: scopeId,
  };
}

export function parsePersistedAtomReadQuery(
  value: unknown,
): PersistedAtomReadQuery {
  const kind = member(object(value).kind, ["scope", "workspace-index"]);
  if (kind === "scope") {
    const query = exact(value, ["kind", "scope"]);
    return { kind, scope: parsePersistedDraftScope(query.scope) };
  }
  const query = exact(value, ["kind", "workspaceId"]);
  return {
    kind,
    workspaceId:
      query.workspaceId === null ? null : id(query.workspaceId, 4_096),
  };
}

export function parsePersistedAtomReadRequest(
  value: unknown,
): PersistedAtomReadRequest {
  const request = exact(value, ["key", "query"]);
  if (request.key === LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY) {
    const query = exact(request.query, ["kind"]);
    if (query.kind !== "recent-actions") reject();
    return { key: request.key, query: { kind: "recent-actions" } };
  }
  if (request.key === LOCAL_ENV_SELECTIONS_ATOM_KEY) {
    const query = exact(request.query, ["kind"]);
    if (query.kind !== "selections") reject();
    return { key: request.key, query: { kind: "selections" } };
  }
  if (isPersistedBooleanAtomKey(request.key)) {
    const query = exact(request.query, ["kind"]);
    if (query.kind !== "value") reject();
    return { key: request.key, query: { kind: "value" } };
  }
  if (request.key !== "composer-drafts-v1") reject();
  return {
    key: "composer-drafts-v1",
    query: parsePersistedAtomReadQuery(request.query),
  };
}

export function parsePersistedDraftIdentity(value: unknown): DraftIdentity {
  const identity = exact(value, ["draftId", "scopeVersion"]);
  return {
    draftId: id(identity.draftId),
    scopeVersion: id(identity.scopeVersion),
  };
}

/** One JSON shape validator shared by the Host and transport consumers. */
export function assertPersistedDraftPayload(
  value: unknown,
): asserts value is JsonObject {
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (item: unknown, depth: number): void => {
    nodes += 1;
    if (depth > 64 || nodes > 1_000_000) reject();
    if (
      item === null ||
      typeof item === "boolean" ||
      typeof item === "string" ||
      (typeof item === "number" && Number.isFinite(item))
    )
      return;
    if (!item || typeof item !== "object" || ancestors.has(item)) reject();
    const array = Array.isArray(item);
    if (
      (Object.getPrototypeOf(item) !==
        (array ? Array.prototype : Object.prototype) &&
        Object.getPrototypeOf(item) !== null) ||
      Object.getOwnPropertySymbols(item).length
    )
      reject();
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Object.keys(descriptors).filter(
      (key) => !(array && key === "length"),
    );
    if (
      keys.some(
        (key) => !descriptors[key].enumerable || !("value" in descriptors[key]),
      ) ||
      (array &&
        (keys.length !== item.length ||
          keys.some((key, index) => key !== String(index))))
    )
      reject();
    ancestors.add(item);
    for (const key of keys) visit(descriptors[key].value, depth + 1);
    ancestors.delete(item);
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) reject();
  visit(value, 0);
}

const diagnosticCodes = [
  "ENOENT",
  "EACCES",
  "EPERM",
  "EBUSY",
  "ENOSPC",
  "EIO",
  "EEXIST",
  "ETIMEDOUT",
  "IO_ERROR",
  "INVALID_STATE",
  "INVALID_JSON",
  "CAPACITY_EXCEEDED",
] as const;
function diagnostic(value: unknown): PersistedAtomDiagnostic {
  const data = exact(value, ["phase", "code"]);
  return {
    phase: member(data.phase, ["load", "serialize", "primary", "backup"]),
    code: member(data.code, diagnosticCodes),
  };
}
function persistence(
  value: unknown,
  revision: number,
): PersistedAtomPersistence {
  const data = exact(value, ["state", "savedRevision"], ["diagnostic"]);
  const state = member(data.state, [
    "loading",
    "saved",
    "pending",
    "error",
    "unavailable",
  ]);
  const savedRevision =
    data.savedRevision === null ? null : integer(data.savedRevision);
  if (
    (savedRevision !== null && savedRevision > revision) ||
    (state === "saved" && savedRevision !== revision) ||
    ((state === "loading" || state === "unavailable") &&
      savedRevision !== null) ||
    ((state === "saved" || state === "pending") && savedRevision === null)
  )
    reject();
  if (
    (state === "error" || state === "unavailable") !==
    Object.hasOwn(data, "diagnostic")
  )
    reject();
  return {
    state,
    savedRevision,
    ...(Object.hasOwn(data, "diagnostic")
      ? { diagnostic: diagnostic(data.diagnostic) }
      : {}),
  };
}
function metadata(value: Record<string, unknown>): PersistedAtomMetadata {
  const key = member(value.key, [
    "composer-drafts-v1",
    LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY,
    LOCAL_ENV_SELECTIONS_ATOM_KEY,
    ...PERSISTED_BOOLEAN_ATOM_KEYS,
  ]);
  const storeRevision = integer(value.storeRevision);
  return {
    key,
    storeRevision,
    persistence: persistence(value.persistence, storeRevision),
  };
}
function entry(value: unknown): PersistedDraftEntry {
  const state = member(object(value).state, ["draft", "consumed"]);
  const data = exact(
    value,
    [
      "draftId",
      "scopeVersion",
      "originScopeKey",
      "updatedAt",
      "state",
      ...(state === "draft" ? ["draft"] : ["consumption", "consumedAt"]),
    ],
    ["sessionId", "threadId"],
  );
  const originScopeKey = id(data.originScopeKey, 16_384);
  let origin: unknown;
  try {
    origin = JSON.parse(originScopeKey);
  } catch {
    return reject();
  }
  if (!Array.isArray(origin) || origin.length !== 3) reject();
  const originScope = parsePersistedDraftScope({
    workspaceId: origin[0],
    kind: origin[1],
    id: origin[2],
  });
  if (
    JSON.stringify([
      originScope.workspaceId,
      originScope.kind,
      originScope.id,
    ]) !== originScopeKey
  )
    reject();
  const base = {
    draftId: id(data.draftId),
    scopeVersion: id(data.scopeVersion),
    originScopeKey,
    updatedAt: integer(data.updatedAt),
    ...(Object.hasOwn(data, "sessionId")
      ? { sessionId: id(data.sessionId) }
      : {}),
    ...(Object.hasOwn(data, "threadId") ? { threadId: id(data.threadId) } : {}),
  };
  if (state === "consumed")
    return {
      ...base,
      state,
      consumption: member(data.consumption, ["accepted", "clear"]),
      consumedAt: integer(data.consumedAt),
    };
  assertPersistedDraftPayload(data.draft);
  if (
    new TextEncoder().encode(JSON.stringify(data.draft)).byteLength >
    PERSISTED_ATOM_LIMITS.maxDraftBytes
  )
    reject();
  return { ...base, state, draft: data.draft };
}
const reasons: readonly PersistedAtomReason[] = [
  "invalid_request",
  "invalid_scope",
  "invalid_payload",
  "capacity_exceeded",
  "identity_mismatch",
  "version_conflict",
  "target_conflict",
  "retired_draft",
  "closed",
];
function optionalReason(data: Record<string, unknown>): {
  reason?: PersistedAtomReason;
} {
  return Object.hasOwn(data, "reason")
    ? { reason: member(data.reason, reasons) }
    : {};
}

function indexItem(value: unknown): PersistedDraftIndexItem {
  const item = exact(
    value,
    ["scope", "identity", "updatedAt"],
    ["sessionId", "threadId"],
  );
  const scope = parsePersistedDraftScope(item.scope);
  const sessionId = Object.hasOwn(item, "sessionId")
    ? id(item.sessionId)
    : undefined;
  if (scope.kind === "local" && sessionId !== scope.id) reject();
  return {
    scope,
    identity: parsePersistedDraftIdentity(item.identity),
    updatedAt: integer(item.updatedAt),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(Object.hasOwn(item, "threadId") ? { threadId: id(item.threadId) } : {}),
  };
}

function indexItems(value: unknown): readonly PersistedDraftIndexItem[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > PERSISTED_ATOM_LIMITS.maxBindings
  )
    reject();
  // Validate descriptors before reading any item; never execute accessors.
  assertPersistedDraftPayload({ items: value });
  const scopes = new Set<string>(),
    identities = new Set<string>();
  return value.map((raw) => {
    const item = indexItem(raw);
    const key = JSON.stringify([
      item.scope.workspaceId,
      item.scope.kind,
      item.scope.id,
    ]);
    if (scopes.has(key) || identities.has(item.identity.draftId)) reject();
    scopes.add(key);
    identities.add(item.identity.draftId);
    return item;
  });
}

export function parsePersistedAtomReadResult(
  value: unknown,
  request?: PersistedAtomReadRequest,
): PersistedAtomReadResult {
  const expected =
    request === undefined
      ? undefined
      : parsePersistedAtomReadRequest(request).query;
  const response = exact(
    value,
    ["key", "storeRevision", "persistence", "outcome", "data"],
    ["reason"],
  );
  const meta = metadata(response),
    outcome = member(response.outcome, ["ready", "invalid", "unavailable"]);
  if (request && meta.key !== request.key) reject();
  const reason = optionalReason(response);
  if (outcome !== "ready") {
    if (response.data !== null || (outcome === "invalid" && !reason.reason))
      reject();
    return { ...meta, outcome, ...reason, data: null };
  }
  if (
    reason.reason ||
    meta.persistence.state === "loading" ||
    meta.persistence.state === "unavailable"
  )
    reject();
  const queryKind = member(object(response.data).queryKind, [
    "scope",
    "workspace-index",
    "value",
    "selections",
    "recent-actions",
  ]);
  if (expected && queryKind !== expected.kind) reject();
  if (meta.key === LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY) {
    const data = exact(response.data, ["queryKind", "recentActions"]);
    if (queryKind !== "recent-actions") reject();
    return {
      ...meta,
      outcome,
      data: {
        queryKind,
        recentActions: parseLocalEnvironmentRecentActions(
          data.recentActions,
          PERSISTED_ATOM_LIMITS.maxBindings,
        ),
      },
    };
  }
  if (meta.key === LOCAL_ENV_SELECTIONS_ATOM_KEY) {
    const data = exact(response.data, ["queryKind", "selections"]);
    if (queryKind !== "selections") reject();
    return {
      ...meta,
      outcome,
      data: {
        queryKind,
        selections: parseLocalEnvironmentSelections(
          data.selections,
          PERSISTED_ATOM_LIMITS.maxBindings,
        ),
      },
    };
  }
  if (isPersistedBooleanAtomKey(meta.key)) {
    const data = exact(response.data, ["queryKind", "value"]);
    if (queryKind !== "value" || typeof data.value !== "boolean") reject();
    return { ...meta, outcome, data: { queryKind, value: data.value } };
  }
  if (
    queryKind === "value" ||
    queryKind === "selections" ||
    queryKind === "recent-actions"
  )
    reject();
  if (queryKind === "workspace-index") {
    const data = exact(response.data, ["queryKind", "workspaceId", "items"]);
    const workspaceId =
      data.workspaceId === null ? null : id(data.workspaceId, 4_096);
    if (
      expected?.kind === "workspace-index" &&
      workspaceId !== expected.workspaceId
    )
      reject();
    const items = indexItems(data.items);
    if (items.some((item) => item.scope.workspaceId !== workspaceId)) reject();
    return { ...meta, outcome, data: { queryKind, workspaceId, items } };
  }
  const data = exact(response.data, ["queryKind", "view"]);
  const view = exact(data.view, ["scope", "entry"]);
  const scope = parsePersistedDraftScope(view.scope),
    draft = view.entry === null ? null : entry(view.entry);
  if (
    expected?.kind === "scope" &&
    (scope.workspaceId !== expected.scope.workspaceId ||
      scope.kind !== expected.scope.kind ||
      scope.id !== expected.scope.id)
  )
    reject();
  if (
    draft?.state === "consumed" ||
    (draft && scope.kind === "local" && draft.sessionId !== scope.id)
  )
    reject();
  return {
    ...meta,
    outcome,
    data: { queryKind, view: { scope, entry: draft } },
  };
}

export function parsePersistedAtomUpdateResult(
  value: unknown,
  request?: PersistedAtomUpdateRequest,
): PersistedAtomUpdateResult {
  const context = request ? exact(request, ["key", "mutation"]) : undefined;
  if (
    context &&
    context.key !== "composer-drafts-v1" &&
    context.key !== LOCAL_ENV_SELECTIONS_ATOM_KEY &&
    context.key !== LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY &&
    !isPersistedBooleanAtomKey(context.key)
  )
    reject();
  const requestedMutation = context ? object(context.mutation) : undefined;
  const data = exact(
    value,
    ["key", "storeRevision", "persistence", "outcome", "changed", "entry"],
    ["reason", "value", "selections", "recentActions"],
  );
  const meta = metadata(data),
    outcome = member(data.outcome, [
      "applied",
      "conflict",
      "invalid",
      "unavailable",
    ]);
  const reason = optionalReason(data);
  if (context && meta.key !== context.key) reject();
  if (meta.key === LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY) {
    if (
      typeof data.changed !== "boolean" ||
      data.entry !== null ||
      Object.hasOwn(data, "value") ||
      Object.hasOwn(data, "selections") ||
      (outcome !== "applied" && data.changed) ||
      ((outcome === "invalid" || outcome === "conflict") && !reason.reason) ||
      (outcome === "applied" &&
        (reason.reason ||
          !Object.hasOwn(data, "recentActions") ||
          meta.persistence.state === "loading" ||
          meta.persistence.state === "unavailable"))
    )
      reject();
    const recentActions = Object.hasOwn(data, "recentActions")
      ? parseLocalEnvironmentRecentActions(
          data.recentActions,
          PERSISTED_ATOM_LIMITS.maxBindings,
        )
      : undefined;
    if (requestedMutation) {
      const mutation =
        parseLocalEnvironmentRecentActionMutation(requestedMutation);
      if (
        outcome === "applied" &&
        recentActions?.[mutation.environmentKey]?.[0] !== mutation.actionName
      )
        reject();
    }
    return {
      ...meta,
      outcome,
      changed: data.changed,
      ...reason,
      entry: null,
      ...(recentActions ? { recentActions } : {}),
    };
  }
  if (Object.hasOwn(data, "recentActions")) reject();
  if (meta.key === LOCAL_ENV_SELECTIONS_ATOM_KEY) {
    if (
      typeof data.changed !== "boolean" ||
      data.entry !== null ||
      Object.hasOwn(data, "value") ||
      (outcome !== "applied" && data.changed) ||
      ((outcome === "invalid" || outcome === "conflict") && !reason.reason) ||
      (outcome === "applied" &&
        (reason.reason ||
          !Object.hasOwn(data, "selections") ||
          meta.persistence.state === "loading" ||
          meta.persistence.state === "unavailable"))
    )
      reject();
    const selections = Object.hasOwn(data, "selections")
      ? parseLocalEnvironmentSelections(
          data.selections,
          PERSISTED_ATOM_LIMITS.maxBindings,
        )
      : undefined;
    if (requestedMutation) {
      const mutation =
        parseLocalEnvironmentSelectionMutation(requestedMutation);
      if (
        outcome === "applied" &&
        (!selections ||
          (mutation.op === "set"
            ? !Object.hasOwn(selections, mutation.workspaceKey) ||
              selections[mutation.workspaceKey] !== mutation.configPath
            : Object.hasOwn(selections, mutation.workspaceKey)))
      )
        reject();
    }
    return {
      ...meta,
      outcome,
      changed: data.changed,
      ...reason,
      entry: null,
      ...(selections ? { selections } : {}),
    };
  }
  if (Object.hasOwn(data, "selections")) reject();
  if (isPersistedBooleanAtomKey(meta.key)) {
    if (
      typeof data.changed !== "boolean" ||
      data.entry !== null ||
      (outcome !== "applied" && data.changed) ||
      ((outcome === "invalid" || outcome === "conflict") && !reason.reason) ||
      (Object.hasOwn(data, "value") && typeof data.value !== "boolean") ||
      (outcome === "applied" &&
        (reason.reason ||
          typeof data.value !== "boolean" ||
          meta.persistence.state === "loading" ||
          meta.persistence.state === "unavailable"))
    )
      reject();
    if (requestedMutation) {
      const mutation = exact(requestedMutation, ["op", "value"]);
      if (mutation.op !== "set" || typeof mutation.value !== "boolean")
        reject();
      if (outcome === "applied" && data.value !== mutation.value) reject();
    }
    return {
      ...meta,
      outcome,
      changed: data.changed,
      ...reason,
      entry: null,
      ...(typeof data.value === "boolean" ? { value: data.value } : {}),
    };
  }
  if (Object.hasOwn(data, "value")) reject();
  if (
    typeof data.changed !== "boolean" ||
    (outcome !== "applied" && data.changed) ||
    ((outcome === "invalid" || outcome === "conflict") && !reason.reason) ||
    (outcome === "applied" &&
      (reason.reason ||
        data.entry === null ||
        meta.persistence.state === "loading" ||
        meta.persistence.state === "unavailable"))
  )
    reject();
  const result = {
    ...meta,
    outcome,
    changed: data.changed,
    ...reason,
    entry: data.entry === null ? null : entry(data.entry),
  };
  if (requestedMutation && result.outcome === "applied") {
    if (!result.entry) reject();
    const op = member(requestedMutation.op, [
      "put",
      "promote",
      "consume",
      "clear",
    ]);
    const mutation = requestedMutation;
    const expected =
      op === "put"
        ? {
            draftId: id(mutation.draftId),
            scopeVersion: id(mutation.nextVersion),
          }
        : parsePersistedDraftIdentity(mutation.identity);
    if (
      result.entry.draftId !== expected.draftId ||
      result.entry.scopeVersion !== expected.scopeVersion ||
      result.entry.state !==
        (op === "consume" || op === "clear" ? "consumed" : "draft")
    )
      reject();
    const target =
      op === "put"
        ? parsePersistedDraftScope(mutation.scope)
        : op === "promote"
          ? parsePersistedDraftScope(mutation.target)
          : undefined;
    if (target?.kind === "local" && result.entry.sessionId !== target.id)
      reject();
    if (
      op === "promote" &&
      mutation.threadId &&
      result.entry.threadId !== id(mutation.threadId)
    )
      reject();
  }
  return result;
}

export function parsePersistedAtomUpdateEvent(
  value: unknown,
): PersistedAtomUpdateEvent {
  const data = exact(value, ["key", "storeRevision", "persistence", "event"]);
  if (data.event !== "persisted-atom-update") reject();
  return { ...metadata(data), event: "persisted-atom-update" };
}
