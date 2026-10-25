import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDiffArtifactSnapshotProjectionEvent,
  extractDiffArtifactProjectionSnapshot,
} from "../dist/index.js";

const DIFF_ITEM_ID = "diff-item-1";

function line(sign, oldLine, newLine, text) {
  return {
    sign,
    oldLine,
    newLine,
    text,
  };
}

function fileChange(id, kind, path, lines, overrides = {}) {
  return {
    id,
    kind,
    path,
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        lines,
      },
    ],
    ...overrides,
  };
}

function diffSurface(surface, overrides = {}) {
  return {
    surface,
    diffItemId: DIFF_ITEM_ID,
    fileChangeIds: [
      "change-add",
      "change-delete",
      "change-update",
      "change-rename",
    ],
    structuredDiffItem: true,
    lineNumbersVisible: true,
    gutterSignsVisible: true,
    wrapEvidence: {
      longLine: true,
    },
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  const longLine = "const wrapped = " + JSON.stringify("x".repeat(130)) + ";";
  return {
    artifactId: "artifact-diff-1",
    diffItem: {
      id: DIFF_ITEM_ID,
    },
    fileChanges: [
      fileChange("change-add", "add", "src/new-file.ts", [
        line("+", undefined, 1, "export const created = true;"),
      ]),
      fileChange("change-delete", "delete", "src/old-file.ts", [
        line("-", 1, undefined, "export const removed = true;"),
      ]),
      fileChange(
        "change-update",
        "update",
        "src/update-file.ts",
        [
          line(" ", 10, 10, "export function render() {"),
          line("-", 11, undefined, "  return oldValue;"),
          line("+", undefined, 11, longLine),
        ],
        {
          wrapEvidence: {
            longLine: true,
          },
        },
      ),
      fileChange(
        "change-rename",
        "rename",
        "src/renamed-file.ts",
        [line(" ", 1, 1, "export const renamed = true;")],
        {
          oldPath: "src/original-file.ts",
        },
      ),
    ],
    renderedSurfaces: [
      diffSurface("artifact_diff"),
      diffSurface("workbench_diff"),
      diffSurface("review_diff"),
    ],
    ...overrides,
  };
}

test("diff artifact snapshot uses structured file changes across artifact, workbench and review", () => {
  const event = buildDiffArtifactSnapshotProjectionEvent(baseInput(), {
    sessionId: "session-diff",
    threadId: "thread-diff",
    turnId: "turn-diff",
    sequence: 331,
    timestamp: "2026-07-09T00:00:00.000Z",
  });

  assert.deepEqual(
    {
      type: event.type,
      sourceType: event.sourceType,
      sequence: event.sequence,
      sessionId: event.sessionId,
      threadId: event.threadId,
      turnId: event.turnId,
      artifactId: event.artifactId,
      owner: event.owner,
      scope: event.scope,
      phase: event.phase,
      surface: event.surface,
      persistence: event.persistence,
      runtimeEntity: event.runtimeEntity,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "artifact.diff.ready",
      sourceType: "diff_artifact_snapshot_projection",
      sequence: 331,
      sessionId: "session-diff",
      threadId: "thread-diff",
      turnId: "turn-diff",
      artifactId: "artifact-diff-1",
      owner: "artifact",
      scope: "artifact",
      phase: "completed",
      surface: "artifact_workspace",
      persistence: "snapshot",
      runtimeEntity: "agent_turn",
      runtimeStatus: "completed",
    },
  );

  assert.deepEqual(event.payload.validationIssues, []);
  assert.deepEqual(event.payload.changeKindsCovered, [
    "add",
    "delete",
    "rename",
    "update",
  ]);
  assert.equal(event.payload.requiredChangeKindsCovered, true);
  assert.equal(event.payload.multiFileCovered, true);
  assert.equal(event.payload.lineNumbersPreserved, true);
  assert.equal(event.payload.gutterSignsPreserved, true);
  assert.equal(event.payload.longLineWrapPreserved, true);
  assert.equal(event.payload.sharedStructuredDiffItem, true);
  assert.equal(event.payload.rawPatchRejected, true);
  assert.equal(event.payload.fakeArtifactCardRejected, true);
  assert.deepEqual(event.refs.artifactPaths, [
    "src/new-file.ts",
    "src/old-file.ts",
    "src/update-file.ts",
    "src/renamed-file.ts",
  ]);
});

test("raw patch string input is rejected as the diff artifact source", () => {
  const snapshot = extractDiffArtifactProjectionSnapshot({
    rawPatch: "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new",
    renderedSurfaces: [
      diffSurface("artifact_diff"),
      diffSurface("workbench_diff"),
      diffSurface("review_diff"),
    ],
  });

  assert.deepEqual(
    snapshot.validationIssues.map((issue) => issue.code).slice(0, 2),
    ["missing_structured_file_changes", "raw_patch_string_input"],
  );
  assert.equal(snapshot.rawPatchRejected, false);
});

test("fake artifact cards cannot replace structured diff surfaces", () => {
  const snapshot = extractDiffArtifactProjectionSnapshot(
    baseInput({
      renderedSurfaces: [
        diffSurface("artifact_diff", {
          fileChangeIds: [],
          structuredDiffItem: false,
          fakeArtifactCard: true,
        }),
        diffSurface("workbench_diff"),
        diffSurface("review_diff"),
      ],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "fake_artifact_card_rendered",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "shared_diff_item_missing",
    ),
  );
  assert.equal(snapshot.fakeArtifactCardRejected, false);
});

test("artifact, workbench and review surfaces must share the same diff item", () => {
  const snapshot = extractDiffArtifactProjectionSnapshot(
    baseInput({
      renderedSurfaces: [
        diffSurface("artifact_diff"),
        diffSurface("workbench_diff", { diffItemId: "workbench-local-diff" }),
        diffSurface("review_diff"),
      ],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "shared_diff_item_missing",
    ),
  );
  assert.equal(snapshot.sharedStructuredDiffItem, false);
});

test("line numbers, gutter signs and long-line wrapping are required evidence", () => {
  const snapshot = extractDiffArtifactProjectionSnapshot(
    baseInput({
      fileChanges: [
        fileChange("change-add", "add", "src/new-file.ts", [
          { text: "export const created = true;" },
        ]),
        ...baseInput().fileChanges.slice(1),
      ],
      renderedSurfaces: [
        diffSurface("artifact_diff", {
          lineNumbersVisible: false,
          gutterSignsVisible: false,
          wrapEvidence: {
            longLine: false,
          },
        }),
        diffSurface("workbench_diff", {
          wrapEvidence: {
            longLine: false,
          },
        }),
        diffSurface("review_diff", {
          wrapEvidence: {
            longLine: false,
          },
        }),
      ],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "line_numbers_missing",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "gutter_signs_missing",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "long_line_wrap_missing",
    ),
  );
});
