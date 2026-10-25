import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
} from "@limecloud/agent-ui-contracts";

import {
  compactProjectionFields,
  definedString,
  readRecord,
  readStringField,
} from "./normalization.js";

export type AgentUiThreadReadPageIsomorphicIssueCode =
  | "missing_thread_id"
  | "read_page_missing"
  | "turns_list_missing"
  | "resume_page_missing"
  | "thread_id_mismatch"
  | "turn_page_order_drift"
  | "resume_page_order_drift"
  | "item_page_order_drift"
  | "live_read_model_mismatch"
  | "pagination_reordered_turns"
  | "legacy_paginated_history_used";

export interface AgentUiThreadReadPageIsomorphicIssue {
  code: AgentUiThreadReadPageIsomorphicIssueCode;
  path: string;
  message: string;
}

export interface AgentUiThreadReadPageIsomorphicProjectionInput {
  threadId?: string | null;
  liveContentParts?: unknown;
  threadRead?: unknown;
  turnsListPage?: unknown;
  resumeInitialTurnsPage?: unknown;
  paginationPages?: unknown;
  legacyPaginatedHistory?: unknown;
  observedSources?: unknown;
  timestamp?: string | null;
}

export interface AgentUiThreadReadTurnPageSnapshot {
  source: string;
  threadId?: string;
  turnIds: string[];
  itemIds: string[];
  itemsView?: string;
}

export interface AgentUiThreadReadLiveContentSnapshot {
  turnIds: string[];
  itemIds: string[];
}

export interface AgentUiThreadReadPaginationSnapshot {
  pageCount: number;
  turnIds: string[];
  duplicateTurnIds: string[];
}

export interface AgentUiThreadReadPageIsomorphicSnapshot {
  threadId?: string;
  readPage: AgentUiThreadReadTurnPageSnapshot;
  turnsListPage: AgentUiThreadReadTurnPageSnapshot;
  resumePage: AgentUiThreadReadTurnPageSnapshot;
  liveContent: AgentUiThreadReadLiveContentSnapshot;
  pagination: AgentUiThreadReadPaginationSnapshot;
  threadScopeStable: boolean;
  turnPageIsomorphic: boolean;
  itemPageIsomorphic: boolean;
  liveReadModelIsomorphic: boolean;
  paginationStable: boolean;
  legacyPaginatedHistoryClean: boolean;
  validationIssues: AgentUiThreadReadPageIsomorphicIssue[];
}

function issue(
  code: AgentUiThreadReadPageIsomorphicIssueCode,
  path: string,
  message: string,
): AgentUiThreadReadPageIsomorphicIssue {
  return { code, path, message };
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function recordsFromPage(value: unknown): Record<string, unknown>[] {
  const direct = recordArray(value);
  if (direct.length > 0) return direct;

  const record = readRecord(value);
  if (!record) return [];
  for (const key of ["turns", "thread_turns", "threadTurns", "data", "items"]) {
    const records = recordArray(record[key]);
    if (records.length > 0) return records;
  }

  const page =
    readRecord(record.page) ??
    readRecord(record.turnsPage ?? record.turns_page) ??
    readRecord(record.initialTurnsPage ?? record.initial_turns_page) ??
    readRecord(record.threadRead ?? record.thread_read);
  return page ? recordsFromPage(page) : [];
}

function readThreadId(value: unknown): string | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const thread = readRecord(record.thread) ?? readRecord(record.thread_read);
  return (
    readStringField(record, ["threadId", "thread_id", "id"]) ??
    readStringField(thread, ["threadId", "thread_id", "id"])
  );
}

function readItemId(value: unknown): string | undefined {
  if (typeof value === "string") return definedString(value);
  const record = readRecord(value);
  return readStringField(record, [
    "id",
    "itemId",
    "item_id",
    "partId",
    "part_id",
    "rawResponseItemId",
    "raw_response_item_id",
  ]);
}

function readTurnId(value: unknown): string | undefined {
  if (typeof value === "string") return definedString(value);
  const record = readRecord(value);
  return readStringField(record, ["turnId", "turn_id", "id"]);
}

function readItemIds(record: Record<string, unknown>): string[] {
  for (const key of [
    "items",
    "thread_items",
    "threadItems",
    "contentParts",
    "content_parts",
  ]) {
    const itemIds = (Array.isArray(record[key]) ? record[key] : [])
      .map(readItemId)
      .filter((id): id is string => Boolean(id));
    if (itemIds.length > 0) return itemIds;
  }

  const page =
    readRecord(record.itemsPage ?? record.items_page) ??
    readRecord(record.threadItemsPage ?? record.thread_items_page);
  return page
    ? recordsFromPage(page)
        .map(readItemId)
        .filter((id): id is string => Boolean(id))
    : [];
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function pageSnapshot(
  source: string,
  value: unknown,
): AgentUiThreadReadTurnPageSnapshot {
  const records = recordsFromPage(value);
  return compactProjectionFields({
    source,
    threadId: readThreadId(value),
    turnIds: records.map(readTurnId).filter((id): id is string => Boolean(id)),
    itemIds: records.flatMap(readItemIds),
    itemsView:
      readStringField(readRecord(value), ["itemsView", "items_view"]) ??
      readStringField(readRecord(value), [
        "requestedItemsView",
        "requested_items_view",
      ]),
  } satisfies AgentUiThreadReadTurnPageSnapshot);
}

function liveContentSnapshot(
  value: unknown,
): AgentUiThreadReadLiveContentSnapshot {
  const records = recordArray(value);
  return {
    turnIds: uniqueInOrder(
      records.map(readTurnId).filter((id): id is string => Boolean(id)),
    ),
    itemIds: records.map(readItemId).filter((id): id is string => Boolean(id)),
  };
}

function paginationSnapshot(
  value: unknown,
): AgentUiThreadReadPaginationSnapshot {
  const pages = recordArray(value);
  const turnIds = pages.flatMap(
    (page) => pageSnapshot("pagination", page).turnIds,
  );
  const seen = new Set<string>();
  const duplicateTurnIds = uniqueInOrder(
    turnIds.filter((turnId) => {
      if (seen.has(turnId)) return true;
      seen.add(turnId);
      return false;
    }),
  );
  return {
    pageCount: pages.length,
    turnIds,
    duplicateTurnIds,
  };
}

function hasLegacyPaginatedHistory(
  input: AgentUiThreadReadPageIsomorphicProjectionInput,
): boolean {
  if (input.legacyPaginatedHistory) return true;
  return recordArray(input.observedSources).some((record) => {
    const source = readStringField(record, ["source", "owner", "kind"]);
    return (
      source === "legacy_paginated_history" || source === "timeline_rebuild"
    );
  });
}

function sameOrder(
  expected: readonly string[],
  actual: readonly string[],
): boolean {
  if (expected.length === 0 || actual.length === 0) return false;
  if (expected.length !== actual.length) return false;
  return expected.every((value, index) => actual[index] === value);
}

function matchesPrefix(
  expected: readonly string[],
  actual: readonly string[],
): boolean {
  if (actual.length === 0) return true;
  if (expected.length < actual.length) return false;
  return actual.every((value, index) => expected[index] === value);
}

function validateSnapshot(
  input: AgentUiThreadReadPageIsomorphicProjectionInput,
  snapshot: Omit<AgentUiThreadReadPageIsomorphicSnapshot, "validationIssues">,
): AgentUiThreadReadPageIsomorphicIssue[] {
  const issues: AgentUiThreadReadPageIsomorphicIssue[] = [];
  const expectedThreadId = snapshot.threadId;

  if (!expectedThreadId) {
    issues.push(
      issue(
        "missing_thread_id",
        "$.threadId",
        "Thread read/list/resume page projection requires a source thread id.",
      ),
    );
  }
  if (snapshot.readPage.turnIds.length === 0) {
    issues.push(
      issue(
        "read_page_missing",
        "$.threadRead.turns",
        "Thread read must expose the same turn page used by hydrate.",
      ),
    );
  }
  if (snapshot.turnsListPage.turnIds.length === 0) {
    issues.push(
      issue(
        "turns_list_missing",
        "$.turnsListPage.turns",
        "Thread turns/list must expose a page comparable with thread read.",
      ),
    );
  }
  if (snapshot.resumePage.turnIds.length === 0) {
    issues.push(
      issue(
        "resume_page_missing",
        "$.resumeInitialTurnsPage.turns",
        "Thread resume must return the initial turns page shape.",
      ),
    );
  }

  for (const page of [
    snapshot.readPage,
    snapshot.turnsListPage,
    snapshot.resumePage,
  ]) {
    if (
      page.threadId &&
      expectedThreadId &&
      page.threadId !== expectedThreadId
    ) {
      issues.push(
        issue(
          "thread_id_mismatch",
          `$.${page.source}.threadId`,
          "Thread read/list/resume pages must stay scoped to the same thread.",
        ),
      );
    }
  }

  if (!sameOrder(snapshot.readPage.turnIds, snapshot.turnsListPage.turnIds)) {
    issues.push(
      issue(
        "turn_page_order_drift",
        "$.turnsListPage.turns",
        "Thread turns/list page must preserve thread read turn order.",
      ),
    );
  }
  if (!sameOrder(snapshot.readPage.turnIds, snapshot.resumePage.turnIds)) {
    issues.push(
      issue(
        "resume_page_order_drift",
        "$.resumeInitialTurnsPage.turns",
        "Thread resume initial turns page must match thread read turn order.",
      ),
    );
  }
  if (
    snapshot.readPage.itemIds.length > 0 &&
    snapshot.resumePage.itemIds.length > 0 &&
    !sameOrder(snapshot.readPage.itemIds, snapshot.resumePage.itemIds)
  ) {
    issues.push(
      issue(
        "item_page_order_drift",
        "$.resumeInitialTurnsPage.items",
        "Thread item order must stay stable between read and resume hydrate.",
      ),
    );
  }
  if (
    snapshot.readPage.itemIds.length > 0 &&
    !sameOrder(snapshot.readPage.itemIds, snapshot.liveContent.itemIds)
  ) {
    issues.push(
      issue(
        "live_read_model_mismatch",
        "$.liveContentParts",
        "Live content parts must hydrate to the same item ids as thread read.",
      ),
    );
  }
  if (
    snapshot.pagination.duplicateTurnIds.length > 0 ||
    !matchesPrefix(snapshot.readPage.turnIds, snapshot.pagination.turnIds)
  ) {
    issues.push(
      issue(
        "pagination_reordered_turns",
        "$.paginationPages",
        "Thread turns pagination must not duplicate or reorder turns.",
      ),
    );
  }
  if (hasLegacyPaginatedHistory(input)) {
    issues.push(
      issue(
        "legacy_paginated_history_used",
        "$.legacyPaginatedHistory",
        "Hydrate must consume current thread read/list pages, not legacy paginated history.",
      ),
    );
  }

  return issues;
}

export function extractThreadReadPageIsomorphicSnapshot(
  input: AgentUiThreadReadPageIsomorphicProjectionInput,
): AgentUiThreadReadPageIsomorphicSnapshot {
  const readPage = pageSnapshot("threadRead", input.threadRead);
  const turnsListPage = pageSnapshot("turnsListPage", input.turnsListPage);
  const resumePage = pageSnapshot(
    "resumeInitialTurnsPage",
    input.resumeInitialTurnsPage,
  );
  const liveContent = liveContentSnapshot(input.liveContentParts);
  const pagination = paginationSnapshot(input.paginationPages);
  const threadId =
    definedString(input.threadId ?? undefined) ??
    readPage.threadId ??
    turnsListPage.threadId ??
    resumePage.threadId;
  const base = {
    threadId,
    readPage,
    turnsListPage,
    resumePage,
    liveContent,
    pagination,
    threadScopeStable:
      Boolean(threadId) &&
      [readPage, turnsListPage, resumePage].every(
        (page) => !page.threadId || page.threadId === threadId,
      ),
    turnPageIsomorphic:
      sameOrder(readPage.turnIds, turnsListPage.turnIds) &&
      sameOrder(readPage.turnIds, resumePage.turnIds),
    itemPageIsomorphic:
      readPage.itemIds.length > 0 &&
      sameOrder(readPage.itemIds, resumePage.itemIds),
    liveReadModelIsomorphic:
      readPage.itemIds.length > 0 &&
      sameOrder(readPage.itemIds, liveContent.itemIds),
    paginationStable:
      pagination.duplicateTurnIds.length === 0 &&
      matchesPrefix(readPage.turnIds, pagination.turnIds),
    legacyPaginatedHistoryClean: !hasLegacyPaginatedHistory(input),
  };
  return {
    ...base,
    validationIssues: validateSnapshot(input, base),
  };
}

export function buildThreadReadPageIsomorphicProjectionEvent(
  input: AgentUiThreadReadPageIsomorphicProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractThreadReadPageIsomorphicSnapshot(input);
  const hasIssues = snapshot.validationIssues.length > 0;
  return compactProjectionFields({
    type: "context.changed",
    sourceType: "thread_read_page_isomorphic_projection",
    sequence: context.sequence,
    timestamp: definedString(input.timestamp ?? undefined) ?? context.timestamp,
    sessionId: definedString(context.sessionId ?? undefined),
    threadId: snapshot.threadId ?? definedString(context.threadId ?? undefined),
    runId: definedString(context.runId ?? undefined),
    turnId:
      snapshot.readPage.turnIds[0] ??
      definedString(context.turnId ?? undefined),
    owner: "context",
    scope: "thread",
    phase: hasIssues ? "failed" : "completed",
    surface: "timeline_evidence",
    persistence: "snapshot",
    control: "open_detail",
    runtimeEntity: "agent_turn",
    runtimeStatus: hasIssues ? "failed" : "completed",
    payload: {
      threadReadPageIsomorphicEvent: "thread_read_page_isomorphic",
      threadScopeStable: snapshot.threadScopeStable,
      turnPageIsomorphic: snapshot.turnPageIsomorphic,
      itemPageIsomorphic: snapshot.itemPageIsomorphic,
      liveReadModelIsomorphic: snapshot.liveReadModelIsomorphic,
      paginationStable: snapshot.paginationStable,
      legacyPaginatedHistoryClean: snapshot.legacyPaginatedHistoryClean,
      threadReadPageIsomorphic: snapshot,
      validationIssues: snapshot.validationIssues,
    },
  } satisfies AgentUiProjectionEvent);
}
