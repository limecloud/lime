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
} from "./normalization.js";

export type AgentUiResizeReflowPhase = "before" | "after" | "unknown";

export type AgentUiResizeReflowIssueCode =
  | "missing_resize_pair"
  | "thread_turn_binding_lost"
  | "message_anchor_lost"
  | "inputbar_anchor_lost"
  | "right_surface_anchor_lost"
  | "item_sequence_drift"
  | "layout_state_written_to_item"
  | "page_text_only_layout_oracle";

export interface AgentUiResizeReflowIssue {
  code: AgentUiResizeReflowIssueCode;
  path: string;
  message: string;
}

export interface AgentUiResizeViewportSnapshot {
  width: number;
  height: number;
}

export interface AgentUiResizeMessageListSnapshot {
  anchorItemId?: string;
  topItemId?: string;
  bottomItemId?: string;
  scrollTop?: number;
}

export interface AgentUiResizeInputbarSnapshot {
  visible: boolean;
  row?: number;
  bottomPx?: number;
}

export interface AgentUiResizeRightSurfaceSnapshot {
  visible: boolean;
  owner?: string;
  requestId?: string;
  width?: number;
}

export interface AgentUiResizeReflowFrameSnapshot {
  phase: AgentUiResizeReflowPhase;
  viewport: AgentUiResizeViewportSnapshot;
  threadId?: string;
  turnId?: string;
  messageList: AgentUiResizeMessageListSnapshot;
  inputbar: AgentUiResizeInputbarSnapshot;
  rightSurface: AgentUiResizeRightSurfaceSnapshot;
  itemSequence: string[];
  pageTextOnly: boolean;
  layoutStateWrittenToItem: boolean;
}

export interface AgentUiResizeReflowSnapshotInput {
  threadId?: string;
  turnId?: string;
  activeThreadId?: string;
  activeTurnId?: string;
  snapshots?: readonly unknown[];
  frames?: readonly unknown[];
}

export interface AgentUiResizeReflowProjectionSnapshot {
  frames: AgentUiResizeReflowFrameSnapshot[];
  viewportSizes: string[];
  resizePairCovered: boolean;
  threadTurnBindingPreserved: boolean;
  messageAnchorStable: boolean;
  inputbarAnchorStable: boolean;
  rightSurfaceAnchorStable: boolean;
  itemSequenceStable: boolean;
  layoutStateKeptOutOfItems: boolean;
  pageTextOnlyRejected: boolean;
  validationIssues: AgentUiResizeReflowIssue[];
}

function issue(
  code: AgentUiResizeReflowIssueCode,
  path: string,
  message: string,
): AgentUiResizeReflowIssue {
  return { code, path, message };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizePhase(value: string | undefined): AgentUiResizeReflowPhase {
  switch (value) {
    case "before":
    case "initial":
    case "pre":
      return "before";
    case "after":
    case "resized":
    case "post":
      return "after";
    default:
      return "unknown";
  }
}

function viewportFromRecord(
  record: Record<string, unknown>,
): AgentUiResizeViewportSnapshot {
  const viewport = readRecord(record.viewport);
  return {
    width:
      readNumberField(viewport, ["width", "w"]) ??
      readNumberField(record, ["width", "viewportWidth"]) ??
      0,
    height:
      readNumberField(viewport, ["height", "h"]) ??
      readNumberField(record, ["height", "viewportHeight"]) ??
      0,
  };
}

function messageListFromRecord(
  record: Record<string, unknown>,
): AgentUiResizeMessageListSnapshot {
  const messageList =
    readRecord(record.messageList) ??
    readRecord(record.message_list) ??
    readRecord(record.transcript);
  return compactProjectionFields({
    anchorItemId: readStringField(messageList, [
      "anchorItemId",
      "anchor_item_id",
      "visibleAnchorItemId",
      "visible_anchor_item_id",
    ]),
    topItemId: readStringField(messageList, ["topItemId", "top_item_id"]),
    bottomItemId: readStringField(messageList, [
      "bottomItemId",
      "bottom_item_id",
    ]),
    scrollTop: readNumberField(messageList, ["scrollTop", "scroll_top"]),
  } satisfies AgentUiResizeMessageListSnapshot);
}

function inputbarFromRecord(
  record: Record<string, unknown>,
): AgentUiResizeInputbarSnapshot {
  const inputbar =
    readRecord(record.inputbar) ??
    readRecord(record.inputBar) ??
    readRecord(record.composer);
  return compactProjectionFields({
    visible: readBooleanField(inputbar, ["visible", "isVisible"]) !== false,
    row: readNumberField(inputbar, ["row", "gridRow", "grid_row"]),
    bottomPx: readNumberField(inputbar, ["bottomPx", "bottom_px", "bottom"]),
  } satisfies AgentUiResizeInputbarSnapshot);
}

function rightSurfaceFromRecord(
  record: Record<string, unknown>,
): AgentUiResizeRightSurfaceSnapshot {
  const rightSurface =
    readRecord(record.rightSurface) ??
    readRecord(record.right_surface) ??
    readRecord(record.sidePanel);
  return compactProjectionFields({
    visible: readBooleanField(rightSurface, ["visible", "isVisible"]) !== false,
    owner: readStringField(rightSurface, [
      "owner",
      "activeOwner",
      "active_owner",
    ]),
    requestId: readStringField(rightSurface, [
      "requestId",
      "request_id",
      "workspaceRequestId",
      "workspace_request_id",
    ]),
    width: readNumberField(rightSurface, ["width", "w"]),
  } satisfies AgentUiResizeRightSurfaceSnapshot);
}

function itemSequenceFromRecord(record: Record<string, unknown>): string[] {
  const values = readArray(record.itemSequence ?? record.item_sequence);
  return values.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0,
  );
}

function parseFrame(
  value: unknown,
  index: number,
): AgentUiResizeReflowFrameSnapshot | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const messageList = messageListFromRecord(record);
  const itemSequence = itemSequenceFromRecord(record);
  const pageText = readStringField(record, [
    "pageText",
    "page_text",
    "textContent",
    "text_content",
  ]);
  return {
    phase: normalizePhase(readStringField(record, ["phase", "kind", "step"])),
    viewport: viewportFromRecord(record),
    threadId: readStringField(record, ["threadId", "thread_id"]),
    turnId: readStringField(record, ["turnId", "turn_id"]),
    messageList,
    inputbar: inputbarFromRecord(record),
    rightSurface: rightSurfaceFromRecord(record),
    itemSequence,
    pageTextOnly:
      Boolean(pageText) &&
      !messageList.anchorItemId &&
      itemSequence.length === 0 &&
      index >= 0,
    layoutStateWrittenToItem:
      readBooleanField(record, [
        "layoutStateWrittenToItem",
        "layout_state_written_to_item",
      ]) === true,
  };
}

function uniqueDefined(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

function sameNonEmpty(values: Array<string | undefined>): boolean {
  const unique = uniqueDefined(values);
  return unique.length === 1;
}

function sameSequence(
  frames: readonly AgentUiResizeReflowFrameSnapshot[],
): boolean {
  const sequences = frames
    .map((frame) => frame.itemSequence)
    .filter((sequence) => sequence.length > 0)
    .map((sequence) => sequence.join("\u0000"));
  if (sequences.length === 0) return true;
  return new Set(sequences).size === 1;
}

function maxDelta(values: Array<number | undefined>): number {
  const numbers = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (numbers.length <= 1) return 0;
  return Math.max(...numbers) - Math.min(...numbers);
}

function validateResizeReflow(
  snapshot: Omit<AgentUiResizeReflowProjectionSnapshot, "validationIssues">,
): AgentUiResizeReflowIssue[] {
  const issues: AgentUiResizeReflowIssue[] = [];
  if (!snapshot.resizePairCovered) {
    issues.push(
      issue(
        "missing_resize_pair",
        "$.frames",
        "Resize/reflow guard needs before and after frames.",
      ),
    );
  }
  if (!snapshot.threadTurnBindingPreserved) {
    issues.push(
      issue(
        "thread_turn_binding_lost",
        "$.frames[].threadId",
        "Resize snapshots must stay bound to the same active thread and turn.",
      ),
    );
  }
  if (!snapshot.messageAnchorStable) {
    issues.push(
      issue(
        "message_anchor_lost",
        "$.frames[].messageList.anchorItemId",
        "MessageList must keep a stable visible anchor across resize.",
      ),
    );
  }
  if (!snapshot.inputbarAnchorStable) {
    issues.push(
      issue(
        "inputbar_anchor_lost",
        "$.frames[].inputbar",
        "Inputbar must remain visible and anchored after resize.",
      ),
    );
  }
  if (!snapshot.rightSurfaceAnchorStable) {
    issues.push(
      issue(
        "right_surface_anchor_lost",
        "$.frames[].rightSurface",
        "Right surface owner/request must remain stable across resize.",
      ),
    );
  }
  if (!snapshot.itemSequenceStable) {
    issues.push(
      issue(
        "item_sequence_drift",
        "$.frames[].itemSequence",
        "Resize must not reorder or rewrite projected item sequence.",
      ),
    );
  }
  if (!snapshot.layoutStateKeptOutOfItems) {
    issues.push(
      issue(
        "layout_state_written_to_item",
        "$.frames[].layoutStateWrittenToItem",
        "Layout-only state must not be written into thread items.",
      ),
    );
  }
  if (!snapshot.pageTextOnlyRejected) {
    issues.push(
      issue(
        "page_text_only_layout_oracle",
        "$.frames[].pageText",
        "pageText-only checks cannot prove resize/reflow layout stability.",
      ),
    );
  }
  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiResizeReflowIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractResizeReflowProjectionSnapshot(
  input: AgentUiResizeReflowSnapshotInput,
): AgentUiResizeReflowProjectionSnapshot {
  const frames = (input.frames ?? input.snapshots ?? [])
    .map(parseFrame)
    .filter((frame): frame is AgentUiResizeReflowFrameSnapshot =>
      Boolean(frame),
    );
  const expectedThreadId = input.activeThreadId ?? input.threadId;
  const expectedTurnId = input.activeTurnId ?? input.turnId;
  const visibleRightSurfaces = frames.filter(
    (frame) => frame.rightSurface.visible,
  );
  const partialSnapshot = {
    frames,
    viewportSizes: Array.from(
      new Set(
        frames.map(
          (frame) => `${frame.viewport.width}x${frame.viewport.height}`,
        ),
      ),
    ),
    resizePairCovered:
      frames.some((frame) => frame.phase === "before") &&
      frames.some((frame) => frame.phase === "after") &&
      new Set(
        frames.map(
          (frame) => `${frame.viewport.width}x${frame.viewport.height}`,
        ),
      ).size > 1,
    threadTurnBindingPreserved:
      frames.length > 0 &&
      (!expectedThreadId ||
        frames.every((frame) => frame.threadId === expectedThreadId)) &&
      (!expectedTurnId ||
        frames.every((frame) => frame.turnId === expectedTurnId)),
    messageAnchorStable:
      frames.length > 0 &&
      frames.every((frame) => Boolean(frame.messageList.anchorItemId)) &&
      sameNonEmpty(frames.map((frame) => frame.messageList.anchorItemId)),
    inputbarAnchorStable:
      frames.length > 0 &&
      frames.every((frame) => frame.inputbar.visible) &&
      maxDelta(frames.map((frame) => frame.inputbar.row)) <= 1 &&
      maxDelta(frames.map((frame) => frame.inputbar.bottomPx)) <= 8,
    rightSurfaceAnchorStable:
      visibleRightSurfaces.length === 0 ||
      (sameNonEmpty(
        visibleRightSurfaces.map((frame) => frame.rightSurface.owner),
      ) &&
        sameNonEmpty(
          visibleRightSurfaces.map((frame) => frame.rightSurface.requestId),
        ) &&
        visibleRightSurfaces.every(
          (frame) => (frame.rightSurface.width ?? 1) > 0,
        )),
    itemSequenceStable: sameSequence(frames),
    layoutStateKeptOutOfItems: !frames.some(
      (frame) => frame.layoutStateWrittenToItem,
    ),
    pageTextOnlyRejected: !frames.some((frame) => frame.pageTextOnly),
  };
  return {
    ...partialSnapshot,
    validationIssues: validateResizeReflow(partialSnapshot),
  };
}

export function buildResizeReflowSnapshotProjectionEvent(
  input: AgentUiResizeReflowSnapshotInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractResizeReflowProjectionSnapshot(input);
  return {
    ...buildAgentUiProjectionBase(
      { sourceType: "resize_reflow_snapshot_projection" },
      context,
    ),
    type: "state.snapshot",
    sequence: context.sequence,
    owner: "ui_projection",
    scope: "thread",
    phase: snapshot.validationIssues.length > 0 ? "failed" : "completed",
    surface: "conversation",
    persistence: "snapshot",
    runtimeEntity: "agent_turn",
    runtimeStatus: runtimeStatus(snapshot.validationIssues),
    payload: {
      frames: snapshot.frames,
      viewportSizes: snapshot.viewportSizes,
      resizePairCovered: snapshot.resizePairCovered,
      threadTurnBindingPreserved: snapshot.threadTurnBindingPreserved,
      messageAnchorStable: snapshot.messageAnchorStable,
      inputbarAnchorStable: snapshot.inputbarAnchorStable,
      rightSurfaceAnchorStable: snapshot.rightSurfaceAnchorStable,
      itemSequenceStable: snapshot.itemSequenceStable,
      layoutStateKeptOutOfItems: snapshot.layoutStateKeptOutOfItems,
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
