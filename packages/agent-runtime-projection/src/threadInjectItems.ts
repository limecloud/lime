import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import {
  compactProjectionFields,
  definedString,
  metadataKeys,
  readBooleanField,
  readRecord,
  readStringField,
  truncateText,
} from "./normalization.js";

const METADATA_SIGNATURE_KEYS = new Set([
  "metadata",
  "internal_chat_message_metadata_passthrough",
  "internalChatMessageMetadataPassthrough",
]);

export type AgentUiThreadInjectItemsIssueCode =
  | "missing_thread_id"
  | "empty_injected_items"
  | "injected_item_missing_turn_linkage"
  | "invalid_response_item"
  | "remote_image_url_allowed"
  | "persisted_history_missing_item"
  | "next_model_input_missing_item"
  | "previous_model_input_contains_injected_item"
  | "insertion_order_changed"
  | "raw_metadata_dropped"
  | "injected_item_rendered_as_user_input"
  | "injected_item_rendered_as_assistant_final_tail";

export interface AgentUiThreadInjectItemsIssue {
  code: AgentUiThreadInjectItemsIssueCode;
  path: string;
  message: string;
}

export interface AgentUiThreadInjectItemsProjectionInput {
  threadId?: string | null;
  turnId?: string | null;
  injectionTurnId?: string | null;
  injectRequest?: unknown;
  injectResponse?: unknown;
  items?: unknown;
  persistedHistory?: unknown;
  nextModelRequestInput?: unknown;
  previousModelRequestInput?: unknown;
  hydratedItems?: unknown;
  timestamp?: string | null;
}

export interface AgentUiInjectedResponseItemSnapshot {
  index: number;
  itemId?: string;
  itemType?: string;
  role?: string;
  textPreview?: string;
  contentKinds: string[];
  rawFieldKeys: string[];
  rawMetadataKeys: string[];
  rawSignature: string;
}

export interface AgentUiThreadInjectItemsSnapshot {
  threadId?: string;
  injectionTurnId?: string;
  injectedItems: AgentUiInjectedResponseItemSnapshot[];
  itemCount: number;
  persistedHistoryMatches: boolean;
  nextModelInputMatches: boolean;
  previousModelInputClean: boolean;
  insertionOrderStable: boolean;
  rawMetadataPreserved: boolean;
  remoteImageUrlsBlocked: boolean;
  hydratedAsContextOnly: boolean;
  validationIssues: AgentUiThreadInjectItemsIssue[];
}

function issue(
  code: AgentUiThreadInjectItemsIssueCode,
  path: string,
  message: string,
): AgentUiThreadInjectItemsIssue {
  return { code, path, message };
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function rawArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stableValue(value: unknown, ignoreMetadata = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item, ignoreMetadata));
  }
  const record = readRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, entry]) => entry !== undefined)
      .filter(([key]) => !(ignoreMetadata && METADATA_SIGNATURE_KEYS.has(key)))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry, ignoreMetadata)]),
  );
}

function stableSignature(value: unknown, ignoreMetadata = false): string {
  return JSON.stringify(stableValue(value, ignoreMetadata));
}

function responseItemRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const direct =
    readRecord(record.responseItem) ??
    readRecord(record.response_item) ??
    readRecord(record.rawResponseItem) ??
    readRecord(record.raw_response_item);
  if (direct) return direct;
  const item = readRecord(record.item);
  if (
    item &&
    (record.kind === "ResponseItem" ||
      record.type === "response_item" ||
      record.type === "raw_response_item")
  ) {
    return item;
  }
  return record;
}

function responseItemRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value
      .map(responseItemRecord)
      .filter((record): record is Record<string, unknown> => Boolean(record));
  }
  const record = readRecord(value);
  if (!record) return [];
  for (const key of ["history", "items", "input", "data"] as const) {
    const records = responseItemRecords(record[key]);
    if (records.length > 0) return records;
  }
  const direct = responseItemRecord(record);
  return direct && isValidResponseItem(direct) ? [direct] : [];
}

function requestItems(
  input: AgentUiThreadInjectItemsProjectionInput,
): unknown[] {
  const request = readRecord(input.injectRequest);
  const requestItems = rawArray(request?.items);
  return requestItems.length > 0 ? requestItems : rawArray(input.items);
}

function readThreadId(
  input: AgentUiThreadInjectItemsProjectionInput,
): string | undefined {
  const request = readRecord(input.injectRequest);
  const response = readRecord(input.injectResponse);
  return definedString(
    input.threadId ??
      readStringField(request, ["threadId", "thread_id"]) ??
      readStringField(response, ["threadId", "thread_id"]),
  );
}

function readInjectionTurnId(
  input: AgentUiThreadInjectItemsProjectionInput,
): string | undefined {
  const request = readRecord(input.injectRequest);
  const response = readRecord(input.injectResponse);
  return definedString(
    input.injectionTurnId ??
      input.turnId ??
      readStringField(response, ["turnId", "turn_id", "injectionTurnId"]) ??
      readStringField(request, ["turnId", "turn_id", "injectionTurnId"]),
  );
}

function itemType(record: Record<string, unknown>): string | undefined {
  return readStringField(record, ["type", "itemType", "item_type"]);
}

function itemRole(record: Record<string, unknown>): string | undefined {
  return readStringField(record, ["role"]);
}

function itemId(record: Record<string, unknown>): string | undefined {
  return readStringField(record, [
    "id",
    "itemId",
    "item_id",
    "callId",
    "call_id",
  ]);
}

function contentRecords(
  record: Record<string, unknown>,
): Record<string, unknown>[] {
  return recordArray(record.content).concat(recordArray(record.output));
}

function textFragments(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textFragments);
  const record = readRecord(value);
  if (!record) return [];
  const directText = readStringField(record, [
    "text",
    "inputText",
    "outputText",
  ]);
  return [
    directText,
    ...textFragments(record.content),
    ...textFragments(record.output),
  ].filter((item): item is string => Boolean(item));
}

function contentKinds(record: Record<string, unknown>): string[] {
  const kinds = contentRecords(record)
    .map((item) => readStringField(item, ["type", "kind"]))
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(kinds));
}

function metadataKeyList(record: Record<string, unknown>): string[] {
  const metadata = readRecord(record.metadata);
  const passthrough = readRecord(
    record.internal_chat_message_metadata_passthrough,
  );
  const camelPassthrough = readRecord(
    record.internalChatMessageMetadataPassthrough,
  );
  return Array.from(
    new Set([
      ...metadataKeys(metadata),
      ...metadataKeys(passthrough),
      ...metadataKeys(camelPassthrough),
    ]),
  ).sort();
}

function isValidResponseItem(
  record: Record<string, unknown> | undefined,
): boolean {
  if (!record) return false;
  return Boolean(
    itemType(record) ||
    itemRole(record) ||
    Array.isArray(record.content) ||
    readStringField(record, ["callId", "call_id", "name", "arguments"]),
  );
}

function hasRemoteImageUrl(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasRemoteImageUrl);
  const record = readRecord(value);
  if (!record) return false;
  const imageUrl = readStringField(record, ["image_url", "imageUrl"]);
  if (imageUrl && /^https?:\/\//i.test(imageUrl)) return true;
  return Object.values(record).some(hasRemoteImageUrl);
}

function buildItemSnapshot(
  value: unknown,
  index: number,
): AgentUiInjectedResponseItemSnapshot | undefined {
  const record = responseItemRecord(value);
  if (!record) return undefined;
  return compactProjectionFields({
    index,
    itemId: itemId(record),
    itemType: itemType(record),
    role: itemRole(record),
    textPreview: truncateText(textFragments(record).join("\n")),
    contentKinds: contentKinds(record),
    rawFieldKeys: metadataKeys(record),
    rawMetadataKeys: metadataKeyList(record),
    rawSignature: stableSignature(record),
  } satisfies AgentUiInjectedResponseItemSnapshot);
}

function exactSignatures(
  records: readonly Record<string, unknown>[],
): string[] {
  return records.map((record) => stableSignature(record));
}

function containsAllExact(
  container: readonly Record<string, unknown>[],
  expected: readonly Record<string, unknown>[],
): boolean {
  const containerSignatures = new Set(exactSignatures(container));
  return expected.every((record) =>
    containerSignatures.has(stableSignature(record)),
  );
}

function containsAnyExact(
  container: readonly Record<string, unknown>[],
  expected: readonly Record<string, unknown>[],
): boolean {
  const containerSignatures = new Set(exactSignatures(container));
  return expected.some((record) =>
    containerSignatures.has(stableSignature(record)),
  );
}

function orderIsStable(
  container: readonly Record<string, unknown>[],
  expected: readonly Record<string, unknown>[],
): boolean {
  const signatures = exactSignatures(container);
  let cursor = -1;
  for (const record of expected) {
    const index = signatures.indexOf(stableSignature(record), cursor + 1);
    if (index < 0) return false;
    cursor = index;
  }
  return true;
}

function metadataPreserved(
  container: readonly Record<string, unknown>[],
  expected: readonly Record<string, unknown>[],
): boolean {
  const exact = new Set(exactSignatures(container));
  const withoutMetadata = new Set(
    container.map((record) => stableSignature(record, true)),
  );
  return expected.every((record) => {
    const metadataKeysForRecord = metadataKeyList(record);
    if (metadataKeysForRecord.length === 0) return true;
    if (exact.has(stableSignature(record))) return true;
    return !withoutMetadata.has(stableSignature(record, true));
  });
}

function hydrationViolations(
  hydratedItems: readonly Record<string, unknown>[],
  injectedItems: readonly AgentUiInjectedResponseItemSnapshot[],
): AgentUiThreadInjectItemsIssue[] {
  const issues: AgentUiThreadInjectItemsIssue[] = [];
  const itemIds = new Set(
    injectedItems
      .map((item) => item.itemId)
      .filter((item): item is string => Boolean(item)),
  );
  hydratedItems.forEach((item, index) => {
    const sourceItemId = readStringField(item, [
      "rawResponseItemId",
      "raw_response_item_id",
      "sourceItemId",
      "source_item_id",
      "itemId",
      "item_id",
    ]);
    const sourceMatches = sourceItemId ? itemIds.has(sourceItemId) : true;
    if (!sourceMatches) return;
    const role = readStringField(item, [
      "role",
      "projectionRole",
      "projection_role",
    ]);
    const type = readStringField(item, ["type", "kind"]);
    const surface = readStringField(item, ["surface"]);
    const finalLike =
      readBooleanField(item, ["final", "isFinal", "is_final"]) === true ||
      surface === "conversation" ||
      type === "assistant_message" ||
      type === "message";
    if (role === "user" || type === "user_message" || type === "user_input") {
      issues.push(
        issue(
          "injected_item_rendered_as_user_input",
          `$.hydratedItems[${index}]`,
          "Injected raw response items must not hydrate as user input.",
        ),
      );
    }
    if (role === "assistant" && finalLike) {
      issues.push(
        issue(
          "injected_item_rendered_as_assistant_final_tail",
          `$.hydratedItems[${index}]`,
          "Injected raw response items must not hydrate as assistant final transcript tail.",
        ),
      );
    }
  });
  return issues;
}

function validateSnapshot(
  input: AgentUiThreadInjectItemsProjectionInput,
  snapshot: Omit<AgentUiThreadInjectItemsSnapshot, "validationIssues">,
  validRequestItems: readonly Record<string, unknown>[],
): AgentUiThreadInjectItemsIssue[] {
  const issues: AgentUiThreadInjectItemsIssue[] = [];
  const rawItems = requestItems(input);

  if (!snapshot.threadId) {
    issues.push(
      issue(
        "missing_thread_id",
        "$.injectRequest.threadId",
        "thread/inject_items must target a loaded thread id.",
      ),
    );
  }
  if (rawItems.length === 0) {
    issues.push(
      issue(
        "empty_injected_items",
        "$.injectRequest.items",
        "thread/inject_items requires at least one raw Responses API item.",
      ),
    );
  }
  if (!snapshot.injectionTurnId) {
    issues.push(
      issue(
        "injected_item_missing_turn_linkage",
        "$.turnId",
        "Injected raw response items must keep a turn linkage for hydrate/evidence.",
      ),
    );
  }

  rawItems.forEach((item, index) => {
    const record = responseItemRecord(item);
    if (!isValidResponseItem(record)) {
      issues.push(
        issue(
          "invalid_response_item",
          `$.injectRequest.items[${index}]`,
          "Injected item must be a raw Responses API item object.",
        ),
      );
    }
    if (hasRemoteImageUrl(item)) {
      issues.push(
        issue(
          "remote_image_url_allowed",
          `$.injectRequest.items[${index}]`,
          "Injected image items must use inline data URLs, not remote HTTP(S) URLs.",
        ),
      );
    }
  });

  if (!snapshot.persistedHistoryMatches) {
    issues.push(
      issue(
        snapshot.rawMetadataPreserved
          ? "persisted_history_missing_item"
          : "raw_metadata_dropped",
        "$.persistedHistory",
        snapshot.rawMetadataPreserved
          ? "Injected raw response items must be persisted into rollout history."
          : "Persisted injected items must preserve raw response metadata.",
      ),
    );
  }
  if (!snapshot.nextModelInputMatches) {
    issues.push(
      issue(
        "next_model_input_missing_item",
        "$.nextModelRequestInput",
        "Injected raw response items must be sent in the next model request.",
      ),
    );
  }
  if (!snapshot.previousModelInputClean) {
    issues.push(
      issue(
        "previous_model_input_contains_injected_item",
        "$.previousModelRequestInput",
        "Injected raw response items must not appear before the inject call.",
      ),
    );
  }
  if (!snapshot.insertionOrderStable && validRequestItems.length > 1) {
    issues.push(
      issue(
        "insertion_order_changed",
        "$.nextModelRequestInput",
        "Injected raw response items must keep request insertion order.",
      ),
    );
  }

  issues.push(
    ...hydrationViolations(
      recordArray(input.hydratedItems),
      snapshot.injectedItems,
    ),
  );
  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiThreadInjectItemsIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractThreadInjectItemsSnapshot(
  input: AgentUiThreadInjectItemsProjectionInput,
): AgentUiThreadInjectItemsSnapshot {
  const rawItems = requestItems(input);
  const validRequestItems = rawItems
    .map(responseItemRecord)
    .filter((record): record is Record<string, unknown> =>
      isValidResponseItem(record),
    );
  const persistedHistory = responseItemRecords(input.persistedHistory);
  const nextModelInput = responseItemRecords(input.nextModelRequestInput);
  const previousModelInput = responseItemRecords(
    input.previousModelRequestInput,
  );
  const injectedItems = rawItems
    .map(buildItemSnapshot)
    .filter((item): item is AgentUiInjectedResponseItemSnapshot =>
      Boolean(item),
    );

  const persistedHistoryMatches = containsAllExact(
    persistedHistory,
    validRequestItems,
  );
  const nextModelInputMatches = containsAllExact(
    nextModelInput,
    validRequestItems,
  );
  const previousModelInputClean = !containsAnyExact(
    previousModelInput,
    validRequestItems,
  );
  const persistedOrderStable = orderIsStable(
    persistedHistory,
    validRequestItems,
  );
  const modelInputOrderStable = orderIsStable(
    nextModelInput,
    validRequestItems,
  );
  const rawMetadataPreserved = metadataPreserved(
    persistedHistory,
    validRequestItems,
  );
  const base = {
    threadId: readThreadId(input),
    injectionTurnId: readInjectionTurnId(input),
    injectedItems,
    itemCount: rawItems.length,
    persistedHistoryMatches,
    nextModelInputMatches,
    previousModelInputClean,
    insertionOrderStable:
      (!persistedHistoryMatches || persistedOrderStable) &&
      (!nextModelInputMatches || modelInputOrderStable),
    rawMetadataPreserved,
    remoteImageUrlsBlocked: !rawItems.some(hasRemoteImageUrl),
    hydratedAsContextOnly:
      hydrationViolations(recordArray(input.hydratedItems), injectedItems)
        .length === 0,
  };
  return {
    ...base,
    validationIssues: validateSnapshot(input, base, validRequestItems),
  };
}

export function buildThreadInjectItemsProjectionEvent(
  input: AgentUiThreadInjectItemsProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractThreadInjectItemsSnapshot(input);
  const status = runtimeStatus(snapshot.validationIssues);
  return compactProjectionFields({
    type: "context.changed",
    sourceType: "thread_inject_items_projection",
    sequence: context.sequence,
    timestamp: definedString(input.timestamp ?? undefined) ?? context.timestamp,
    sessionId: definedString(context.sessionId ?? undefined),
    threadId: snapshot.threadId ?? definedString(context.threadId ?? undefined),
    runId: definedString(context.runId ?? undefined),
    turnId:
      snapshot.injectionTurnId ?? definedString(context.turnId ?? undefined),
    owner: "context",
    scope: "thread",
    phase: status === "failed" ? "failed" : "completed",
    surface: "timeline_evidence",
    persistence: "snapshot",
    control: "open_detail",
    runtimeEntity: "agent_turn",
    runtimeStatus: status,
    latestTurnStatus: status,
    payload: {
      threadInjectItemsEvent: "raw_response_items_injected",
      itemCount: snapshot.itemCount,
      persistedHistoryMatches: snapshot.persistedHistoryMatches,
      nextModelInputMatches: snapshot.nextModelInputMatches,
      previousModelInputClean: snapshot.previousModelInputClean,
      insertionOrderStable: snapshot.insertionOrderStable,
      rawMetadataPreserved: snapshot.rawMetadataPreserved,
      hydratedAsContextOnly: snapshot.hydratedAsContextOnly,
      threadInjectItems: snapshot,
      validationIssues: snapshot.validationIssues,
    },
  } satisfies AgentUiProjectionEvent);
}
