import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import { buildAgentUiProjectionBase } from "./envelope.js";
import {
  compactProjectionFields,
  definedString,
  readBooleanField,
  readNumberField,
  readRecord,
  readStringField,
  truncateText,
} from "./normalization.js";

export type AgentUiDiffChangeKind =
  | "add"
  | "delete"
  | "update"
  | "rename"
  | "unknown";

export type AgentUiDiffSurface =
  | "artifact_diff"
  | "workbench_diff"
  | "review_diff"
  | "unknown";

export type AgentUiDiffArtifactIssueCode =
  | "missing_structured_file_changes"
  | "raw_patch_string_input"
  | "missing_change_kind"
  | "multi_file_diff_missing"
  | "line_numbers_missing"
  | "gutter_signs_missing"
  | "long_line_wrap_missing"
  | "missing_diff_surface"
  | "shared_diff_item_missing"
  | "raw_patch_string_rendered"
  | "fake_artifact_card_rendered";

export interface AgentUiDiffArtifactIssue {
  code: AgentUiDiffArtifactIssueCode;
  path: string;
  message: string;
}

export interface AgentUiDiffLineSnapshot {
  oldLine?: number;
  newLine?: number;
  sign?: "+" | "-" | " ";
  textPreview?: string;
}

export interface AgentUiFileChangeSnapshot {
  id: string;
  path: string;
  oldPath?: string;
  kind: AgentUiDiffChangeKind;
  lineCount: number;
  hasLineNumbers: boolean;
  hasGutterSigns: boolean;
  hasLongLineWrap: boolean;
}

export interface AgentUiDiffSurfaceSnapshot {
  surface: AgentUiDiffSurface;
  diffItemId?: string;
  fileChangeIds: string[];
  structuredDiffItem: boolean;
  lineNumbersVisible: boolean;
  gutterSignsVisible: boolean;
  longLineWrapVisible: boolean;
  rawPatchRendered: boolean;
  fakeArtifactCardRendered: boolean;
}

export interface AgentUiDiffArtifactSnapshotInput {
  artifactId?: string;
  diffItem?: unknown;
  sharedDiffItem?: unknown;
  fileChanges?: readonly unknown[];
  changes?: readonly unknown[];
  renderedSurfaces?: readonly unknown[];
  surfaces?: readonly unknown[];
  artifactDiff?: unknown;
  workbenchDiff?: unknown;
  reviewDiff?: unknown;
  rawPatch?: unknown;
  patch?: unknown;
}

export interface AgentUiDiffArtifactProjectionSnapshot {
  diffItemId?: string;
  fileChanges: AgentUiFileChangeSnapshot[];
  surfaces: AgentUiDiffSurfaceSnapshot[];
  changeKindsCovered: AgentUiDiffChangeKind[];
  requiredChangeKindsCovered: boolean;
  multiFileCovered: boolean;
  lineNumbersPreserved: boolean;
  gutterSignsPreserved: boolean;
  longLineWrapPreserved: boolean;
  sharedStructuredDiffItem: boolean;
  rawPatchRejected: boolean;
  fakeArtifactCardRejected: boolean;
  validationIssues: AgentUiDiffArtifactIssue[];
}

const REQUIRED_CHANGE_KINDS: AgentUiDiffChangeKind[] = [
  "add",
  "delete",
  "update",
  "rename",
];

const REQUIRED_SURFACES: AgentUiDiffSurface[] = [
  "artifact_diff",
  "workbench_diff",
  "review_diff",
];

function issue(
  code: AgentUiDiffArtifactIssueCode,
  path: string,
  message: string,
): AgentUiDiffArtifactIssue {
  return { code, path, message };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function uniqSorted<T extends string>(values: readonly T[]): T[] {
  return Array.from(new Set(values)).sort();
}

function normalizeChangeKind(value: string | undefined): AgentUiDiffChangeKind {
  switch (value) {
    case "add":
    case "added":
    case "create":
    case "created":
    case "new":
      return "add";
    case "delete":
    case "deleted":
    case "remove":
    case "removed":
      return "delete";
    case "update":
    case "updated":
    case "modify":
    case "modified":
    case "change":
    case "changed":
      return "update";
    case "rename":
    case "renamed":
    case "move":
    case "moved":
      return "rename";
    default:
      return "unknown";
  }
}

function normalizeSurface(value: string | undefined): AgentUiDiffSurface {
  switch (value) {
    case "artifact_diff":
    case "artifactDiff":
    case "artifact":
      return "artifact_diff";
    case "workbench_diff":
    case "workbenchDiff":
    case "workbench":
      return "workbench_diff";
    case "review_diff":
    case "reviewDiff":
    case "review":
      return "review_diff";
    default:
      return "unknown";
  }
}

function lineFromRecord(value: unknown): AgentUiDiffLineSnapshot | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const oldLine = readNumberField(record, ["oldLine", "old_line"]);
  const newLine = readNumberField(record, ["newLine", "new_line", "line"]);
  const sign =
    typeof record.sign === "string"
      ? record.sign
      : typeof record.gutter === "string"
        ? record.gutter
        : undefined;
  const normalizedSign =
    sign === "+" || sign === "-" || sign === " " ? sign : undefined;
  const text = readStringField(record, ["text", "content"]);
  if (
    oldLine === undefined &&
    newLine === undefined &&
    !normalizedSign &&
    !text
  ) {
    return undefined;
  }
  return compactProjectionFields({
    oldLine,
    newLine,
    sign: normalizedSign,
    textPreview: truncateText(text, 120),
  } satisfies AgentUiDiffLineSnapshot);
}

function collectLines(value: unknown): AgentUiDiffLineSnapshot[] {
  const record = readRecord(value);
  if (!record) return [];
  const hunks = readArray(record.hunks);
  const directLines = readArray(record.lines);
  const hunkLines = hunks.flatMap((hunk) => readArray(readRecord(hunk)?.lines));
  return [...directLines, ...hunkLines]
    .map(lineFromRecord)
    .filter((entry): entry is AgentUiDiffLineSnapshot => Boolean(entry));
}

function hasLongLineWrap(
  value: unknown,
  lines: readonly AgentUiDiffLineSnapshot[],
): boolean {
  const record = readRecord(value);
  const wrap =
    readRecord(record?.wrapEvidence) ??
    readRecord(record?.wrap_evidence) ??
    record;
  return (
    readBooleanField(wrap, [
      "longLine",
      "long_line",
      "longLineWrap",
      "long_line_wrap",
      "longLineWrapVisible",
    ]) === true || lines.some((line) => (line.textPreview?.length ?? 0) >= 100)
  );
}

function parseFileChange(
  value: unknown,
  index: number,
): AgentUiFileChangeSnapshot | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const path = readStringField(record, [
    "path",
    "filePath",
    "file_path",
    "newPath",
  ]);
  if (!path) return undefined;
  const oldPath = readStringField(record, [
    "oldPath",
    "old_path",
    "previousPath",
  ]);
  const kind = normalizeChangeKind(
    readStringField(record, ["kind", "changeKind", "change_kind", "status"]),
  );
  const inferredKind =
    kind !== "unknown"
      ? kind
      : oldPath && oldPath !== path
        ? "rename"
        : "unknown";
  const lines = collectLines(record);
  const hasLineNumbers = lines.some(
    (line) => line.oldLine !== undefined || line.newLine !== undefined,
  );
  const hasGutterSigns = lines.some((line) => line.sign !== undefined);
  return compactProjectionFields({
    id:
      readStringField(record, ["id", "changeId", "change_id"]) ??
      `file-change-${index + 1}`,
    path,
    oldPath,
    kind: inferredKind,
    lineCount: lines.length,
    hasLineNumbers,
    hasGutterSigns,
    hasLongLineWrap: hasLongLineWrap(record, lines),
  } satisfies AgentUiFileChangeSnapshot);
}

function diffItemRecord(
  input: AgentUiDiffArtifactSnapshotInput,
): Record<string, unknown> | undefined {
  return readRecord(input.diffItem) ?? readRecord(input.sharedDiffItem);
}

function fileChangesFromInput(
  input: AgentUiDiffArtifactSnapshotInput,
): unknown[] {
  const item = diffItemRecord(input);
  const direct = input.fileChanges ?? input.changes;
  if (direct) return [...direct];
  return [
    ...readArray(item?.fileChanges),
    ...readArray(item?.file_changes),
    ...readArray(item?.changes),
    ...readArray(item?.files),
  ];
}

function surfaceRawPatchRendered(record: Record<string, unknown>): boolean {
  if (
    typeof record.rawPatch === "string" ||
    typeof record.raw_patch === "string"
  ) {
    return true;
  }
  const text = readStringField(record, [
    "text",
    "content",
    "pageText",
    "page_text",
  ]);
  return Boolean(text?.includes("@@ ") || text?.includes("diff --git"));
}

function parseSurface(
  value: unknown,
  fallbackSurface: AgentUiDiffSurface | undefined,
  defaultDiffItemId: string | undefined,
): AgentUiDiffSurfaceSnapshot | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const surface = normalizeSurface(
    readStringField(record, ["surface", "kind", "target"]) ?? fallbackSurface,
  );
  const fileChangeIds = readArray(
    record.fileChangeIds ?? record.file_change_ids,
  ).filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0,
  );
  const wrap =
    readRecord(record.wrapEvidence) ??
    readRecord(record.wrap_evidence) ??
    record;
  const fakeArtifactCardRendered =
    readBooleanField(record, ["fakeArtifactCard", "fake_artifact_card"]) ===
      true ||
    (normalizeSurface(readStringField(record, ["type"])) === "artifact_diff" &&
      fileChangeIds.length === 0 &&
      readBooleanField(record, [
        "structuredDiffItem",
        "structured_diff_item",
      ]) !== true);

  return {
    surface,
    diffItemId:
      readStringField(record, ["diffItemId", "diff_item_id", "id"]) ??
      defaultDiffItemId,
    fileChangeIds,
    structuredDiffItem:
      readBooleanField(record, [
        "structuredDiffItem",
        "structured_diff_item",
        "hasStructuredDiffItem",
      ]) !== false && fileChangeIds.length > 0,
    lineNumbersVisible:
      readBooleanField(record, [
        "lineNumbersVisible",
        "line_numbers_visible",
        "lineNumbers",
      ]) === true,
    gutterSignsVisible:
      readBooleanField(record, [
        "gutterSignsVisible",
        "gutter_signs_visible",
        "gutterSigns",
      ]) === true,
    longLineWrapVisible:
      readBooleanField(wrap, [
        "longLine",
        "long_line",
        "longLineWrap",
        "long_line_wrap",
        "longLineWrapVisible",
      ]) === true,
    rawPatchRendered: surfaceRawPatchRendered(record),
    fakeArtifactCardRendered,
  };
}

function renderedSurfacesFromInput(
  input: AgentUiDiffArtifactSnapshotInput,
  defaultDiffItemId: string | undefined,
): AgentUiDiffSurfaceSnapshot[] {
  const explicit = input.renderedSurfaces ?? input.surfaces;
  const values =
    explicit && explicit.length > 0
      ? explicit.map((entry) => ({ value: entry, fallback: undefined }))
      : [
          { value: input.artifactDiff, fallback: "artifact_diff" as const },
          { value: input.workbenchDiff, fallback: "workbench_diff" as const },
          { value: input.reviewDiff, fallback: "review_diff" as const },
        ];
  return values
    .map((entry) =>
      parseSurface(entry.value, entry.fallback, defaultDiffItemId),
    )
    .filter((entry): entry is AgentUiDiffSurfaceSnapshot => Boolean(entry));
}

function validateDiffSnapshot(
  snapshot: Omit<AgentUiDiffArtifactProjectionSnapshot, "validationIssues">,
  rawPatchInputPresent: boolean,
): AgentUiDiffArtifactIssue[] {
  const issues: AgentUiDiffArtifactIssue[] = [];
  if (snapshot.fileChanges.length === 0) {
    issues.push(
      issue(
        "missing_structured_file_changes",
        "$.fileChanges",
        "Diff artifact snapshots must use structured FileChange items.",
      ),
    );
  }
  if (rawPatchInputPresent) {
    issues.push(
      issue(
        "raw_patch_string_input",
        "$.rawPatch",
        "Raw patch strings are not a valid diff artifact fact source.",
      ),
    );
  }
  for (const kind of REQUIRED_CHANGE_KINDS) {
    if (!snapshot.changeKindsCovered.includes(kind)) {
      issues.push(
        issue(
          "missing_change_kind",
          `$.changeKinds.${kind}`,
          "Diff snapshots must cover add, delete, update and rename changes.",
        ),
      );
    }
  }
  if (!snapshot.multiFileCovered) {
    issues.push(
      issue(
        "multi_file_diff_missing",
        "$.fileChanges",
        "source-derived diff snapshots must cover multiple files.",
      ),
    );
  }
  if (!snapshot.lineNumbersPreserved) {
    issues.push(
      issue(
        "line_numbers_missing",
        "$.lines",
        "Diff rendering must preserve line numbers.",
      ),
    );
  }
  if (!snapshot.gutterSignsPreserved) {
    issues.push(
      issue(
        "gutter_signs_missing",
        "$.gutter",
        "Diff rendering must preserve add/delete/context gutter signs.",
      ),
    );
  }
  if (!snapshot.longLineWrapPreserved) {
    issues.push(
      issue(
        "long_line_wrap_missing",
        "$.wrapEvidence",
        "Long-line diff rendering needs explicit wrap evidence.",
      ),
    );
  }
  const surfaceSet = new Set(
    snapshot.surfaces.map((surface) => surface.surface),
  );
  for (const surface of REQUIRED_SURFACES) {
    if (!surfaceSet.has(surface)) {
      issues.push(
        issue(
          "missing_diff_surface",
          `$.surfaces.${surface}`,
          "Artifact, workbench and review surfaces must share the diff item.",
        ),
      );
    }
  }
  if (!snapshot.sharedStructuredDiffItem) {
    issues.push(
      issue(
        "shared_diff_item_missing",
        "$.surfaces",
        "Artifact, workbench and review diff rendering must point to the same structured diff item.",
      ),
    );
  }
  for (const [index, surface] of snapshot.surfaces.entries()) {
    if (surface.rawPatchRendered) {
      issues.push(
        issue(
          "raw_patch_string_rendered",
          `$.surfaces[${index}]`,
          "Rendering raw patch text is not a stable artifact diff oracle.",
        ),
      );
    }
    if (surface.fakeArtifactCardRendered) {
      issues.push(
        issue(
          "fake_artifact_card_rendered",
          `$.surfaces[${index}]`,
          "Fake artifact cards cannot replace structured diff rendering.",
        ),
      );
    }
  }
  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiDiffArtifactIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractDiffArtifactProjectionSnapshot(
  input: AgentUiDiffArtifactSnapshotInput,
): AgentUiDiffArtifactProjectionSnapshot {
  const diffItem = diffItemRecord(input);
  const diffItemId = readStringField(diffItem, [
    "id",
    "diffItemId",
    "diff_item_id",
  ]);
  const fileChanges = fileChangesFromInput(input)
    .map(parseFileChange)
    .filter((entry): entry is AgentUiFileChangeSnapshot => Boolean(entry));
  const surfaces = renderedSurfacesFromInput(input, diffItemId);
  const surfaceDiffIds = uniqSorted(
    surfaces
      .map((surface) => surface.diffItemId)
      .filter((entry): entry is string => Boolean(entry)),
  );
  const changeKindsCovered = uniqSorted(
    fileChanges
      .map((change) => change.kind)
      .filter((kind): kind is AgentUiDiffChangeKind => kind !== "unknown"),
  );
  const rawPatchInputPresent =
    typeof input.rawPatch === "string" || typeof input.patch === "string";
  const partialSnapshot = {
    diffItemId,
    fileChanges,
    surfaces,
    changeKindsCovered,
    requiredChangeKindsCovered: REQUIRED_CHANGE_KINDS.every((kind) =>
      changeKindsCovered.includes(kind),
    ),
    multiFileCovered:
      new Set(fileChanges.map((change) => change.path)).size > 1,
    lineNumbersPreserved:
      fileChanges.length > 0 &&
      fileChanges.every((change) => change.hasLineNumbers) &&
      surfaces.every((surface) => surface.lineNumbersVisible),
    gutterSignsPreserved:
      fileChanges.length > 0 &&
      fileChanges.every((change) => change.hasGutterSigns) &&
      surfaces.every((surface) => surface.gutterSignsVisible),
    longLineWrapPreserved:
      fileChanges.some((change) => change.hasLongLineWrap) &&
      surfaces.some((surface) => surface.longLineWrapVisible),
    sharedStructuredDiffItem:
      surfaces.length >= REQUIRED_SURFACES.length &&
      surfaceDiffIds.length === 1 &&
      Boolean(surfaceDiffIds[0]) &&
      (!diffItemId || surfaceDiffIds[0] === diffItemId) &&
      surfaces.every((surface) => surface.structuredDiffItem),
    rawPatchRejected:
      !rawPatchInputPresent &&
      !surfaces.some((surface) => surface.rawPatchRendered),
    fakeArtifactCardRejected: !surfaces.some(
      (surface) => surface.fakeArtifactCardRendered,
    ),
  };

  return {
    ...partialSnapshot,
    validationIssues: validateDiffSnapshot(
      partialSnapshot,
      rawPatchInputPresent,
    ),
  };
}

export function buildDiffArtifactSnapshotProjectionEvent(
  input: AgentUiDiffArtifactSnapshotInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractDiffArtifactProjectionSnapshot(input);
  return {
    ...buildAgentUiProjectionBase(
      { sourceType: "diff_artifact_snapshot_projection" },
      context,
    ),
    type: "artifact.diff.ready",
    sequence: context.sequence,
    artifactId: definedString(input.artifactId),
    owner: "artifact",
    scope: "artifact",
    phase: snapshot.validationIssues.length > 0 ? "failed" : "completed",
    surface: "artifact_workspace",
    persistence: "snapshot",
    runtimeEntity: "agent_turn",
    runtimeStatus: runtimeStatus(snapshot.validationIssues),
    payload: {
      diffItemId: snapshot.diffItemId,
      fileChanges: snapshot.fileChanges,
      surfaces: snapshot.surfaces,
      changeKindsCovered: snapshot.changeKindsCovered,
      requiredChangeKindsCovered: snapshot.requiredChangeKindsCovered,
      multiFileCovered: snapshot.multiFileCovered,
      lineNumbersPreserved: snapshot.lineNumbersPreserved,
      gutterSignsPreserved: snapshot.gutterSignsPreserved,
      longLineWrapPreserved: snapshot.longLineWrapPreserved,
      sharedStructuredDiffItem: snapshot.sharedStructuredDiffItem,
      rawPatchRejected: snapshot.rawPatchRejected,
      fakeArtifactCardRejected: snapshot.fakeArtifactCardRejected,
      validationIssues: snapshot.validationIssues,
    },
    refs:
      snapshot.validationIssues.length > 0
        ? {
            diagnosticKeys: snapshot.validationIssues.map(
              (entry) => entry.code,
            ),
          }
        : {
            artifactPaths: snapshot.fileChanges.map((change) => change.path),
          },
  };
}
