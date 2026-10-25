import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import { buildAgentUiProjectionBase } from "./envelope.js";
import type {
  AgentUiHistoryReplayVisualIssue,
  AgentUiHistoryReplayVisualIssueCode,
  AgentUiHistoryReplayVisualItemKind,
  AgentUiHistoryReplayVisualItemSnapshot,
  AgentUiHistoryReplayVisualItemStatus,
  AgentUiHistoryReplayVisualProjectionInput,
  AgentUiHistoryReplayVisualRowSnapshot,
  AgentUiHistoryReplayVisualSnapshot,
} from "./historyReplayVisualTypes.js";
import {
  compactProjectionFields,
  definedString,
  readBooleanField,
  readNumberField,
  readRecord,
  readStringField,
  truncateText,
} from "./normalization.js";

export type * from "./historyReplayVisualTypes.js";

const IMAGE_PLACEHOLDER_PATTERN = /\[Image #\d+\]/;

function issue(
  code: AgentUiHistoryReplayVisualIssueCode,
  path: string,
  message: string,
): AgentUiHistoryReplayVisualIssue {
  return { code, path, message };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordArray(value: unknown): Record<string, unknown>[] {
  const direct = readArray(value)
    .map((item) => readRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  if (direct.length > 0) return direct;

  const record = readRecord(value);
  if (!record) return [];
  for (const key of [
    "items",
    "threadItems",
    "thread_items",
    "contentParts",
    "content_parts",
    "data",
    "rows",
  ]) {
    const nested = recordArray(record[key]);
    if (nested.length > 0) return nested;
  }
  return [];
}

function normalizeToken(value: string | undefined): string | undefined {
  return value
    ?.trim()
    .replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)
    .replace(/[-\s.]+/g, "_")
    .replace(/^_+/, "")
    .toLowerCase();
}

function normalizeKind(
  value: string | undefined,
): AgentUiHistoryReplayVisualItemKind {
  switch (normalizeToken(value)) {
    case "user":
    case "user_message":
      return "user";
    case "assistant":
    case "agent_message":
    case "assistant_message":
      return "assistant";
    case "reasoning":
    case "reasoning_summary":
      return "reasoning";
    case "mcp":
    case "mcp_tool":
    case "mcp_tool_call":
      return "mcp_tool_call";
    case "tool":
    case "tool_call":
    case "dynamic_tool_call":
      return "tool_call";
    default:
      return "unknown";
  }
}

function normalizeStatus(
  value: string | undefined,
): AgentUiHistoryReplayVisualItemStatus {
  switch (normalizeToken(value)) {
    case "queued":
    case "pending":
      return "queued";
    case "running":
    case "active":
    case "in_progress":
    case "streaming":
    case "calling":
      return "running";
    case "completed":
    case "complete":
    case "done":
    case "finished":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "canceled":
    case "cancelled":
    case "aborted":
    case "interrupted":
      return "canceled";
    default:
      return "unknown";
  }
}

function idOf(
  record: Record<string, unknown> | undefined,
  keys: string[] = ["id", "itemId", "item_id"],
): string | undefined {
  return readStringField(record, keys);
}

function contentRecords(
  record: Record<string, unknown>,
): Record<string, unknown>[] {
  return [
    ...recordArray(record.content),
    ...recordArray(record.input),
    ...recordArray(record.inputs),
    ...recordArray(record.parts),
    ...recordArray(record.contentParts ?? record.content_parts),
  ];
}

function readStringListFromFields(
  record: Record<string, unknown> | undefined,
  keys: string[],
): string[] {
  if (!record) return [];
  const values: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      values.push(value.trim());
    } else if (Array.isArray(value)) {
      values.push(
        ...value.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        ),
      );
    }
  }
  return values;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function localImageRefs(record: Record<string, unknown>): string[] {
  const nested = contentRecords(record).flatMap((item) =>
    readStringListFromFields(item, ["path", "localImage", "local_image"]),
  );
  return uniqueStrings([
    ...readStringListFromFields(record, [
      "localImagePaths",
      "local_image_paths",
      "localImages",
      "local_images",
    ]),
    ...nested,
  ]);
}

function remoteImageRefs(record: Record<string, unknown>): string[] {
  const nested = contentRecords(record).flatMap((item) =>
    readStringListFromFields(item, ["url", "imageUrl", "image_url"]),
  );
  return uniqueStrings([
    ...readStringListFromFields(record, [
      "remoteImageUrls",
      "remote_image_urls",
      "remoteImages",
      "remote_images",
    ]),
    ...nested.filter((value) => /^https?:\/\//i.test(value)),
  ]);
}

function textElementCount(record: Record<string, unknown>): number {
  const countArray = (value: unknown): number => readArray(value).length;
  return [
    countArray(record.textElements),
    countArray(record.text_elements),
    ...contentRecords(record).map(
      (item) => countArray(item.textElements) + countArray(item.text_elements),
    ),
  ].reduce((sum, count) => sum + count, 0);
}

function summaryTexts(record: Record<string, unknown>): string[] {
  return uniqueStrings([
    ...readStringListFromFields(record, [
      "summary",
      "summaries",
      "summaryText",
      "summary_text",
    ]),
    ...contentRecords(record).flatMap((item) =>
      readStringListFromFields(item, [
        "summary",
        "summaryText",
        "summary_text",
      ]),
    ),
  ]);
}

function textPreview(record: Record<string, unknown>): string | undefined {
  return truncateText(
    readStringField(record, ["text", "message", "content", "preview"]) ??
      contentRecords(record)
        .map((item) => readStringField(item, ["text", "message", "content"]))
        .find(Boolean),
  );
}

function itemSnapshot(
  source: "replayed" | "hydrated",
  value: unknown,
  index: number,
): AgentUiHistoryReplayVisualItemSnapshot | undefined {
  const record = readRecord(value);
  const id = idOf(record);
  if (!record || !id) return undefined;
  return {
    source,
    index,
    id,
    turnId: readStringField(record, ["turnId", "turn_id"]),
    kind: normalizeKind(
      readStringField(record, ["kind", "type", "itemKind", "item_type"]),
    ),
    status: normalizeStatus(
      readStringField(record, ["status", "runtimeStatus", "runtime_status"]),
    ),
    sequence: readNumberField(record, ["sequence", "seq", "index"]),
    textPreview: textPreview(record),
    textElementCount: textElementCount(record),
    localImageRefs: localImageRefs(record),
    remoteImageRefs: remoteImageRefs(record),
    summaryTexts: summaryTexts(record),
  };
}

function rowSnapshot(
  value: unknown,
  index: number,
): AgentUiHistoryReplayVisualRowSnapshot | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const itemId = idOf(record, [
    "itemId",
    "item_id",
    "sourceItemId",
    "source_item_id",
    "id",
  ]);
  if (!itemId) return undefined;
  const status = normalizeStatus(
    readStringField(record, ["status", "runtimeStatus", "runtime_status"]),
  );
  const active =
    readBooleanField(record, ["active", "isActive", "is_active"]) ??
    status === "running";
  return {
    index,
    rowId: readStringField(record, ["rowId", "row_id", "id"]),
    itemId,
    turnId: readStringField(record, ["turnId", "turn_id"]),
    kind: normalizeKind(
      readStringField(record, ["kind", "type", "itemKind", "item_type"]),
    ),
    status,
    active,
    rendererOwner: readStringField(record, [
      "rendererOwner",
      "renderer_owner",
      "owner",
    ]),
    textPreview: textPreview(record),
    textElementCount: textElementCount(record),
    localImageRefs: localImageRefs(record),
    remoteImageRefs: remoteImageRefs(record),
    summaryRenderCount:
      readNumberField(record, [
        "summaryRenderCount",
        "summary_render_count",
        "renderCount",
        "render_count",
      ]) ?? 0,
    pageTextOnly:
      readBooleanField(record, ["pageTextOnly", "page_text_only"]) ??
      Boolean(record.pageText && !record.richSnapshot && !record.blocks),
  };
}

function sameStringList(
  expected: readonly string[],
  actual: readonly string[],
): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every((value, index) => actual[index] === value);
}

function sameOrderedIds(
  expected: readonly string[],
  actual: readonly string[],
): boolean {
  return expected.length > 0 && sameStringList(expected, actual);
}

function fieldMatches(
  expected: string | undefined,
  actual: string | undefined,
): boolean {
  return expected === undefined || expected === actual;
}

function itemIdentityMatches(
  replayed: AgentUiHistoryReplayVisualItemSnapshot,
  hydrated: AgentUiHistoryReplayVisualItemSnapshot,
): boolean {
  return (
    replayed.id === hydrated.id &&
    fieldMatches(replayed.turnId, hydrated.turnId) &&
    replayed.kind === hydrated.kind &&
    replayed.status === hydrated.status
  );
}

function rowIdentityMatches(
  replayed: AgentUiHistoryReplayVisualItemSnapshot,
  row: AgentUiHistoryReplayVisualRowSnapshot,
): boolean {
  return (
    replayed.id === row.itemId &&
    fieldMatches(replayed.turnId, row.turnId) &&
    replayed.kind === row.kind &&
    (replayed.status === row.status ||
      (replayed.status === "running" && row.active))
  );
}

function rendererOwnerList(
  input: AgentUiHistoryReplayVisualProjectionInput,
  rows: readonly AgentUiHistoryReplayVisualRowSnapshot[],
): string[] {
  const ownerRecords = recordArray(input.rendererOwners);
  const ownerRecord = readRecord(input.rendererOwners);
  return uniqueStrings(
    [
      definedString(input.rendererOwner ?? undefined),
      definedString(input.liveRendererOwner ?? undefined),
      definedString(input.hydrateRendererOwner ?? undefined),
      readStringField(ownerRecord, ["common", "owner", "rendererOwner"]),
      readStringField(ownerRecord, ["live", "liveRendererOwner"]),
      readStringField(ownerRecord, ["hydrate", "hydrateRendererOwner"]),
      ...ownerRecords.flatMap((record) => [
        readStringField(record, ["owner", "rendererOwner", "renderer_owner"]),
        readStringField(record, ["live", "liveRendererOwner"]),
        readStringField(record, ["hydrate", "hydrateRendererOwner"]),
      ]),
      ...rows.map((row) => row.rendererOwner),
    ].filter((owner): owner is string => Boolean(owner)),
  );
}

function validateSnapshot(
  input: AgentUiHistoryReplayVisualProjectionInput,
  snapshot: Omit<AgentUiHistoryReplayVisualSnapshot, "validationIssues">,
): AgentUiHistoryReplayVisualIssue[] {
  const issues: AgentUiHistoryReplayVisualIssue[] = [];
  const hydratedById = new Map(
    snapshot.hydratedItems.map((item) => [item.id, item]),
  );
  const rowsByItemId = new Map(
    snapshot.visualRows.map((row) => [row.itemId, row]),
  );

  if (snapshot.replayedItems.length === 0) {
    issues.push(
      issue(
        "missing_replayed_items",
        "$.replayedItems",
        "History replay visual guard requires replayed source items.",
      ),
    );
  }
  if (snapshot.hydratedItems.length === 0) {
    issues.push(
      issue(
        "missing_hydrated_items",
        "$.hydratedItems",
        "History hydrate must expose current read-model items.",
      ),
    );
  }
  if (snapshot.visualRows.length === 0) {
    issues.push(
      issue(
        "missing_visual_rows",
        "$.visualRows",
        "History replay must produce structured visual rows.",
      ),
    );
  }
  if (
    snapshot.replayedItemIds.length > 0 &&
    (!sameOrderedIds(snapshot.replayedItemIds, snapshot.hydratedItemIds) ||
      !sameOrderedIds(snapshot.replayedItemIds, snapshot.visualItemIds))
  ) {
    issues.push(
      issue(
        "item_order_drift",
        "$.visualRows",
        "History replay must preserve read-model item order.",
      ),
    );
  }

  for (const replayed of snapshot.replayedItems) {
    const hydrated = hydratedById.get(replayed.id);
    const row = rowsByItemId.get(replayed.id);
    if (!hydrated) {
      issues.push(
        issue(
          "hydrate_item_missing",
          `$.hydratedItems[${replayed.id}]`,
          "Every replayed item must be present in the hydrated read model.",
        ),
      );
    } else if (!itemIdentityMatches(replayed, hydrated)) {
      issues.push(
        issue(
          "item_identity_drift",
          `$.hydratedItems[${replayed.id}]`,
          "Hydrate must preserve replayed item id, turn id, type and status.",
        ),
      );
    }

    if (!row) {
      issues.push(
        issue(
          "visual_row_missing",
          `$.visualRows[${replayed.id}]`,
          "Every replayed item must have a structured visual row.",
        ),
      );
      continue;
    }
    if (!rowIdentityMatches(replayed, row)) {
      issues.push(
        issue(
          "item_identity_drift",
          `$.visualRows[${row.index}]`,
          "Visual rows must stay bound to the original item id, turn id, type and status.",
        ),
      );
    }

    if (replayed.kind === "user") {
      if (
        replayed.textElementCount > 0 &&
        row.textElementCount < replayed.textElementCount
      ) {
        issues.push(
          issue(
            "user_text_elements_lost",
            `$.visualRows[${row.index}].textElements`,
            "Replayed user text elements must not collapse into plain text.",
          ),
        );
      }
      if (
        !sameStringList(replayed.localImageRefs, row.localImageRefs) ||
        !sameStringList(replayed.remoteImageRefs, row.remoteImageRefs)
      ) {
        issues.push(
          issue(
            "user_image_refs_lost",
            `$.visualRows[${row.index}].images`,
            "Replayed local and remote image refs must survive visual hydrate.",
          ),
        );
      }
      if (
        IMAGE_PLACEHOLDER_PATTERN.test(row.textPreview ?? "") &&
        row.localImageRefs.length + row.remoteImageRefs.length === 0
      ) {
        issues.push(
          issue(
            "legacy_image_placeholder_only",
            `$.visualRows[${row.index}].textPreview`,
            "Image placeholders are not enough; the row must keep structured image refs.",
          ),
        );
      }
    }

    if (replayed.kind === "mcp_tool_call" && replayed.status === "running") {
      if (
        hydrated?.status !== "running" ||
        row.status !== "running" ||
        !row.active
      ) {
        issues.push(
          issue(
            "mcp_in_progress_not_active",
            `$.visualRows[${row.index}]`,
            "Replayed in-progress MCP tool calls must remain active after hydrate.",
          ),
        );
      }
      if (row.status === "completed") {
        issues.push(
          issue(
            "mcp_active_rendered_as_completed_history",
            `$.visualRows[${row.index}].status`,
            "In-progress MCP calls must not render as completed history rows.",
          ),
        );
      }
    }

    if (replayed.kind === "reasoning") {
      const reasoningRows = snapshot.visualRows.filter(
        (candidate) =>
          candidate.itemId === replayed.id && candidate.kind === "reasoning",
      );
      const renderedSummaryCount = reasoningRows.reduce(
        (sum, candidate) => sum + Math.max(1, candidate.summaryRenderCount),
        0,
      );
      const sourceSummaryCount = Math.max(1, replayed.summaryTexts.length);
      if (
        reasoningRows.length > 1 ||
        renderedSummaryCount > sourceSummaryCount
      ) {
        issues.push(
          issue(
            "reasoning_summary_duplicated",
            `$.visualRows[${row.index}]`,
            "Live reasoning summary completion must not render a duplicate history summary.",
          ),
        );
      }
    }
  }

  if (snapshot.rendererOwners.length === 0) {
    issues.push(
      issue(
        "common_renderer_owner_missing",
        "$.rendererOwners",
        "History replay requires one shared renderer owner for live and hydrate.",
      ),
    );
  } else if (snapshot.rendererOwners.length > 1) {
    issues.push(
      issue(
        "live_hydrate_renderer_split",
        "$.rendererOwners",
        "Live and hydrate rows must not use separate renderers.",
      ),
    );
  }

  const explicitLiveOwner = definedString(input.liveRendererOwner ?? undefined);
  const explicitHydrateOwner = definedString(
    input.hydrateRendererOwner ?? undefined,
  );
  if (
    explicitLiveOwner &&
    explicitHydrateOwner &&
    explicitLiveOwner !== explicitHydrateOwner
  ) {
    issues.push(
      issue(
        "live_hydrate_renderer_split",
        "$.liveRendererOwner",
        "Live renderer owner must match hydrate renderer owner.",
      ),
    );
  }

  if (
    snapshot.visualRows.some((row) => row.pageTextOnly) ||
    input.pageTextOracle
  ) {
    issues.push(
      issue(
        "page_text_only_oracle",
        "$.visualRows",
        "History replay visual correctness cannot be proven by pageText-only assertions.",
      ),
    );
  }

  return issues;
}

function issueFree(
  issues: readonly AgentUiHistoryReplayVisualIssue[],
  codes: readonly AgentUiHistoryReplayVisualIssueCode[],
): boolean {
  return !issues.some((entry) => codes.includes(entry.code));
}

export function extractHistoryReplayVisualSnapshot(
  input: AgentUiHistoryReplayVisualProjectionInput,
): AgentUiHistoryReplayVisualSnapshot {
  const replayedItems = recordArray(input.replayedItems)
    .map((item, index) => itemSnapshot("replayed", item, index))
    .filter((item): item is AgentUiHistoryReplayVisualItemSnapshot =>
      Boolean(item),
    );
  const hydratedItems = recordArray(
    input.hydratedItems ?? input.readModelItems ?? input.threadItems,
  )
    .map((item, index) => itemSnapshot("hydrated", item, index))
    .filter((item): item is AgentUiHistoryReplayVisualItemSnapshot =>
      Boolean(item),
    );
  const visualRows = recordArray(
    input.visualRows ?? input.renderedRows ?? input.transcriptRows,
  )
    .map(rowSnapshot)
    .filter((row): row is AgentUiHistoryReplayVisualRowSnapshot =>
      Boolean(row),
    );
  const replayedItemIds = replayedItems.map((item) => item.id);
  const hydratedItemIds = hydratedItems.map((item) => item.id);
  const visualItemIds = visualRows.map((row) => row.itemId);
  const base = {
    threadId: definedString(input.threadId ?? undefined),
    turnId:
      definedString(input.turnId ?? undefined) ??
      replayedItems.find((item) => item.turnId)?.turnId,
    replayedItems,
    hydratedItems,
    visualRows,
    rendererOwners: rendererOwnerList(input, visualRows),
    replayedItemIds,
    hydratedItemIds,
    visualItemIds,
    itemIdentityStable: true,
    itemOrderStable:
      sameOrderedIds(replayedItemIds, hydratedItemIds) &&
      sameOrderedIds(replayedItemIds, visualItemIds),
    userRichContentPreserved: true,
    mcpActivePreserved: true,
    reasoningSummaryDeduped: true,
    rendererSingleOwner: false,
    pageTextOnlyRejected: true,
  };
  const validationIssues = validateSnapshot(input, base);
  return {
    ...base,
    itemIdentityStable: issueFree(validationIssues, [
      "hydrate_item_missing",
      "visual_row_missing",
      "item_identity_drift",
    ]),
    userRichContentPreserved: issueFree(validationIssues, [
      "user_text_elements_lost",
      "user_image_refs_lost",
      "legacy_image_placeholder_only",
    ]),
    mcpActivePreserved: issueFree(validationIssues, [
      "mcp_in_progress_not_active",
      "mcp_active_rendered_as_completed_history",
    ]),
    reasoningSummaryDeduped: issueFree(validationIssues, [
      "reasoning_summary_duplicated",
    ]),
    rendererSingleOwner: issueFree(validationIssues, [
      "common_renderer_owner_missing",
      "live_hydrate_renderer_split",
    ]),
    pageTextOnlyRejected: issueFree(validationIssues, [
      "page_text_only_oracle",
    ]),
    validationIssues,
  };
}

function runtimeStatus(
  issues: readonly AgentUiHistoryReplayVisualIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function buildHistoryReplayVisualProjectionEvent(
  input: AgentUiHistoryReplayVisualProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractHistoryReplayVisualSnapshot(input);
  const status = runtimeStatus(snapshot.validationIssues);
  return compactProjectionFields({
    type: "state.snapshot",
    ...buildAgentUiProjectionBase(
      {
        sourceType: "history_replay_visual_projection",
        itemType: "history_replay_visual",
      },
      {
        ...context,
        threadId: snapshot.threadId ?? context.threadId,
        turnId: snapshot.turnId ?? context.turnId,
      },
    ),
    sequence: context.sequence,
    timestamp: definedString(input.timestamp ?? undefined) ?? context.timestamp,
    owner: "ui_projection",
    scope: "thread",
    phase: status === "failed" ? "failed" : "completed",
    surface: "conversation",
    persistence: "snapshot",
    control: "open_detail",
    runtimeStatus: status,
    payload: {
      historyReplayVisualEvent: "history_replay_visual",
      itemIdentityStable: snapshot.itemIdentityStable,
      itemOrderStable: snapshot.itemOrderStable,
      userRichContentPreserved: snapshot.userRichContentPreserved,
      mcpActivePreserved: snapshot.mcpActivePreserved,
      reasoningSummaryDeduped: snapshot.reasoningSummaryDeduped,
      rendererSingleOwner: snapshot.rendererSingleOwner,
      pageTextOnlyRejected: snapshot.pageTextOnlyRejected,
      historyReplayVisual: snapshot,
      validationIssues: snapshot.validationIssues,
    },
    refs: {
      artifactPaths: uniqueStrings(
        snapshot.replayedItems.flatMap((item) => item.localImageRefs),
      ),
    },
  } satisfies AgentUiProjectionEvent);
}
