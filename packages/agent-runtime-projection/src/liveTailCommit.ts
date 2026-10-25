import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import { buildAgentUiProjectionBase } from "./envelope.js";
import {
  compactProjectionFields,
  readBooleanField,
  readNumberField,
  readRecord,
  readStringField,
  truncateText,
} from "./normalization.js";

export type AgentUiLiveTailPhase =
  | "first_visible"
  | "streaming"
  | "overflow_commit"
  | "completed"
  | "unknown";

export type AgentUiLiveTailIssueCode =
  | "first_output_not_visible"
  | "first_output_after_commit"
  | "live_tail_history_not_separated"
  | "overflow_commit_sequence_drift"
  | "scroll_anchor_lost"
  | "table_tail_reflow_missing"
  | "overlay_buffer_used"
  | "page_text_only_live_tail_oracle";

export interface AgentUiLiveTailIssue {
  code: AgentUiLiveTailIssueCode;
  path: string;
  message: string;
}

export interface AgentUiLiveTailFrameSnapshot {
  phase: AgentUiLiveTailPhase;
  sequence: number;
  turnId?: string;
  messageId?: string;
  liveTailItemId?: string;
  historyItemId?: string;
  scrollAnchorItemId?: string;
  outputPreview?: string;
  itemSequence: string[];
  firstOutputVisible: boolean;
  overflowCommitted: boolean;
  tableTailReflowed: boolean;
  overlayBufferUsed: boolean;
  pageTextOnly: boolean;
}

export interface AgentUiLiveTailCommitSnapshotInput {
  turnId?: string;
  messageId?: string;
  frames?: readonly unknown[];
  snapshots?: readonly unknown[];
}

export interface AgentUiLiveTailCommitProjectionSnapshot {
  frames: AgentUiLiveTailFrameSnapshot[];
  firstOutputVisible: boolean;
  firstOutputBeforeCommit: boolean;
  liveTailHistorySeparated: boolean;
  overflowCommitPreservesSequence: boolean;
  scrollAnchorStable: boolean;
  tableTailReflowStable: boolean;
  overlayBufferRejected: boolean;
  pageTextOnlyRejected: boolean;
  validationIssues: AgentUiLiveTailIssue[];
}

function issue(
  code: AgentUiLiveTailIssueCode,
  path: string,
  message: string,
): AgentUiLiveTailIssue {
  return { code, path, message };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizePhase(value: string | undefined): AgentUiLiveTailPhase {
  switch (value) {
    case "first_visible":
    case "firstVisible":
    case "first_token":
      return "first_visible";
    case "streaming":
    case "live":
      return "streaming";
    case "overflow_commit":
    case "overflowCommit":
    case "commit":
      return "overflow_commit";
    case "completed":
    case "final":
      return "completed";
    default:
      return "unknown";
  }
}

function itemSequenceFromRecord(record: Record<string, unknown>): string[] {
  return readArray(record.itemSequence ?? record.item_sequence).filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0,
  );
}

function tableTailReflowed(record: Record<string, unknown>): boolean {
  const table =
    readRecord(record.tableTail) ??
    readRecord(record.table_tail) ??
    readRecord(record.table);
  return (
    readBooleanField(table, [
      "reflowed",
      "tailReflowed",
      "tail_reflowed",
      "stableAfterCommit",
      "stable_after_commit",
    ]) === true &&
    (readNumberField(table, ["rowCount", "row_count", "rows"]) ?? 0) > 0 &&
    (readNumberField(table, ["columnCount", "column_count", "columns"]) ?? 0) >
      0
  );
}

function parseFrame(
  value: unknown,
  index: number,
): AgentUiLiveTailFrameSnapshot | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const output = readStringField(record, [
    "output",
    "text",
    "delta",
    "outputText",
    "output_text",
  ]);
  const pageText = readStringField(record, [
    "pageText",
    "page_text",
    "textContent",
    "text_content",
  ]);
  const itemSequence = itemSequenceFromRecord(record);
  const phase = normalizePhase(
    readStringField(record, ["phase", "kind", "step"]),
  );
  const firstOutputVisible =
    readBooleanField(record, [
      "firstOutputVisible",
      "first_output_visible",
      "firstTokenVisible",
      "first_token_visible",
    ]) === true || phase === "first_visible";
  const overflowCommitted =
    readBooleanField(record, [
      "overflowCommitted",
      "overflow_committed",
      "committed",
    ]) === true || phase === "overflow_commit";
  return compactProjectionFields({
    phase,
    sequence: readNumberField(record, ["sequence", "seq"]) ?? index,
    turnId: readStringField(record, ["turnId", "turn_id"]),
    messageId: readStringField(record, ["messageId", "message_id"]),
    liveTailItemId: readStringField(record, [
      "liveTailItemId",
      "live_tail_item_id",
      "liveItemId",
      "live_item_id",
    ]),
    historyItemId: readStringField(record, [
      "historyItemId",
      "history_item_id",
      "committedItemId",
      "committed_item_id",
    ]),
    scrollAnchorItemId: readStringField(record, [
      "scrollAnchorItemId",
      "scroll_anchor_item_id",
      "anchorItemId",
      "anchor_item_id",
    ]),
    outputPreview: truncateText(output, 160),
    itemSequence,
    firstOutputVisible,
    overflowCommitted,
    tableTailReflowed: tableTailReflowed(record),
    overlayBufferUsed:
      readBooleanField(record, [
        "overlayBufferUsed",
        "overlay_buffer_used",
        "globalAssistantBuffer",
        "global_assistant_buffer",
      ]) === true,
    pageTextOnly:
      Boolean(pageText) &&
      !output &&
      !readStringField(record, ["liveTailItemId", "live_tail_item_id"]),
  } satisfies AgentUiLiveTailFrameSnapshot);
}

function sameNonEmpty(values: Array<string | undefined>): boolean {
  const unique = Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
  return unique.length === 1;
}

function stableSequence(
  frames: readonly AgentUiLiveTailFrameSnapshot[],
): boolean {
  const sequences = frames
    .map((frame) => frame.itemSequence)
    .filter((sequence) => sequence.length > 0)
    .map((sequence) => sequence.join("\u0000"));
  return sequences.length === 0 || new Set(sequences).size === 1;
}

function firstSequence(
  frames: readonly AgentUiLiveTailFrameSnapshot[],
  predicate: (frame: AgentUiLiveTailFrameSnapshot) => boolean,
): number | undefined {
  const frame = frames
    .filter(predicate)
    .sort((left, right) => left.sequence - right.sequence)[0];
  return frame?.sequence;
}

function validateLiveTail(
  snapshot: Omit<AgentUiLiveTailCommitProjectionSnapshot, "validationIssues">,
): AgentUiLiveTailIssue[] {
  const issues: AgentUiLiveTailIssue[] = [];
  if (!snapshot.firstOutputVisible) {
    issues.push(
      issue(
        "first_output_not_visible",
        "$.frames",
        "Long output must expose the first visible output before completion.",
      ),
    );
  }
  if (!snapshot.firstOutputBeforeCommit) {
    issues.push(
      issue(
        "first_output_after_commit",
        "$.frames",
        "First output must be visible before overflow commit or terminal completion.",
      ),
    );
  }
  if (!snapshot.liveTailHistorySeparated) {
    issues.push(
      issue(
        "live_tail_history_not_separated",
        "$.frames[].liveTailItemId",
        "Live tail and committed history item ids must remain distinct but linked.",
      ),
    );
  }
  if (!snapshot.overflowCommitPreservesSequence) {
    issues.push(
      issue(
        "overflow_commit_sequence_drift",
        "$.frames[].itemSequence",
        "Overflow commit must not rewrite or reorder item sequence.",
      ),
    );
  }
  if (!snapshot.scrollAnchorStable) {
    issues.push(
      issue(
        "scroll_anchor_lost",
        "$.frames[].scrollAnchorItemId",
        "Live tail commit must keep scroll anchor stable.",
      ),
    );
  }
  if (!snapshot.tableTailReflowStable) {
    issues.push(
      issue(
        "table_tail_reflow_missing",
        "$.frames[].tableTail",
        "Markdown table tail needs explicit reflow evidence after live commit.",
      ),
    );
  }
  if (!snapshot.overlayBufferRejected) {
    issues.push(
      issue(
        "overlay_buffer_used",
        "$.frames[].overlayBufferUsed",
        "Global overlay assistant text buffers cannot be the live tail source.",
      ),
    );
  }
  if (!snapshot.pageTextOnlyRejected) {
    issues.push(
      issue(
        "page_text_only_live_tail_oracle",
        "$.frames[].pageText",
        "pageText-only checks cannot prove live tail commit stability.",
      ),
    );
  }
  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiLiveTailIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractLiveTailCommitProjectionSnapshot(
  input: AgentUiLiveTailCommitSnapshotInput,
): AgentUiLiveTailCommitProjectionSnapshot {
  const frames = (input.frames ?? input.snapshots ?? [])
    .map(parseFrame)
    .filter((frame): frame is AgentUiLiveTailFrameSnapshot => Boolean(frame));
  const firstVisibleSequence = firstSequence(
    frames,
    (frame) => frame.firstOutputVisible,
  );
  const commitSequence = firstSequence(
    frames,
    (frame) => frame.overflowCommitted || frame.phase === "completed",
  );
  const liveFrames = frames.filter((frame) => frame.liveTailItemId);
  const commitFrames = frames.filter((frame) => frame.historyItemId);
  const partialSnapshot = {
    frames,
    firstOutputVisible: frames.some((frame) => frame.firstOutputVisible),
    firstOutputBeforeCommit:
      firstVisibleSequence !== undefined &&
      (commitSequence === undefined || firstVisibleSequence < commitSequence),
    liveTailHistorySeparated:
      liveFrames.length > 0 &&
      commitFrames.length > 0 &&
      sameNonEmpty(liveFrames.map((frame) => frame.liveTailItemId)) &&
      sameNonEmpty(commitFrames.map((frame) => frame.historyItemId)) &&
      liveFrames[0].liveTailItemId !== commitFrames[0].historyItemId,
    overflowCommitPreservesSequence:
      frames.some((frame) => frame.overflowCommitted) && stableSequence(frames),
    scrollAnchorStable: sameNonEmpty(
      frames.map((frame) => frame.scrollAnchorItemId),
    ),
    tableTailReflowStable: frames.some((frame) => frame.tableTailReflowed),
    overlayBufferRejected: !frames.some((frame) => frame.overlayBufferUsed),
    pageTextOnlyRejected: !frames.some((frame) => frame.pageTextOnly),
  };
  return {
    ...partialSnapshot,
    validationIssues: validateLiveTail(partialSnapshot),
  };
}

export function buildLiveTailCommitProjectionEvent(
  input: AgentUiLiveTailCommitSnapshotInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractLiveTailCommitProjectionSnapshot(input);
  return {
    ...buildAgentUiProjectionBase(
      { sourceType: "live_tail_commit_projection" },
      context,
    ),
    type: "state.snapshot",
    sequence: context.sequence,
    messageId: input.messageId,
    owner: "ui_projection",
    scope: "message",
    phase: snapshot.validationIssues.length > 0 ? "failed" : "completed",
    surface: "conversation",
    persistence: "snapshot",
    runtimeEntity: "agent_turn",
    runtimeStatus: runtimeStatus(snapshot.validationIssues),
    payload: {
      frames: snapshot.frames,
      firstOutputVisible: snapshot.firstOutputVisible,
      firstOutputBeforeCommit: snapshot.firstOutputBeforeCommit,
      liveTailHistorySeparated: snapshot.liveTailHistorySeparated,
      overflowCommitPreservesSequence: snapshot.overflowCommitPreservesSequence,
      scrollAnchorStable: snapshot.scrollAnchorStable,
      tableTailReflowStable: snapshot.tableTailReflowStable,
      overlayBufferRejected: snapshot.overlayBufferRejected,
      pageTextOnlyRejected: snapshot.pageTextOnlyRejected,
      validationIssues: snapshot.validationIssues,
    },
    refs:
      snapshot.validationIssues.length > 0
        ? {
            diagnosticKeys: snapshot.validationIssues.map(
              (entry) => entry.code,
            ),
          }
        : undefined,
  };
}
