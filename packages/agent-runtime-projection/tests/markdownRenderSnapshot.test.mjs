import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMarkdownRenderSnapshotProjectionEvent,
  extractMarkdownRenderProjectionSnapshot,
} from "../dist/index.js";

const RENDERER_OWNER = "agent-markdown-renderer";

function richBlocks(...blocks) {
  return {
    blocks,
  };
}

function richFileLinkBlocks(...blocks) {
  return {
    blocks,
    fileLinks: [
      {
        path: "src/components/MessageList.tsx",
        line: 42,
        column: 7,
        label: "MessageList",
      },
    ],
  };
}

function surface(
  surfaceName,
  sourceMarkdown,
  renderedSnapshot,
  overrides = {},
) {
  return {
    surface: surfaceName,
    rendererOwner: RENDERER_OWNER,
    sourceMarkdown,
    renderedSnapshot,
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    commonRendererOwner: RENDERER_OWNER,
    surfaces: [
      surface(
        "assistant_final_text",
        [
          "# Result",
          "",
          "| file | status |",
          "| --- | --- |",
          "| src/components/MessageList.tsx | ok |",
          "",
          "混合 width wrap keeps ASCII and 中文 together.",
        ].join("\n"),
        richBlocks(
          { type: "heading", level: 1, text: "Result" },
          {
            type: "table",
            headers: ["file", "status"],
            rows: [["src/components/MessageList.tsx", "ok"]],
          },
          { type: "cjk_wrap", text: "混合 width wrap" },
          { type: "mixed_width_wrap", text: "ASCII 中文" },
        ),
        {
          wrapEvidence: {
            cjk: true,
            mixedWidth: true,
          },
        },
      ),
      surface(
        "tool_output",
        ["```ts", "export const ok = true;", "```"].join("\n"),
        richBlocks({
          type: "code_fence",
          language: "ts",
          text: "export const ok = true;",
        }),
      ),
      surface(
        "artifact_preview",
        "See [MessageList](src/components/MessageList.tsx:42:7) for the render owner.",
        richFileLinkBlocks({
          type: "file_link",
          path: "src/components/MessageList.tsx",
          line: 42,
        }),
      ),
    ],
    ...overrides,
  };
}

test("markdown snapshot uses one rich renderer across assistant, tool and artifact surfaces", () => {
  const event = buildMarkdownRenderSnapshotProjectionEvent(baseInput(), {
    sessionId: "session-markdown",
    threadId: "thread-markdown",
    turnId: "turn-markdown",
    sequence: 321,
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
      owner: event.owner,
      scope: event.scope,
      phase: event.phase,
      surface: event.surface,
      persistence: event.persistence,
      runtimeEntity: event.runtimeEntity,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "state.snapshot",
      sourceType: "markdown_render_snapshot_projection",
      sequence: 321,
      sessionId: "session-markdown",
      threadId: "thread-markdown",
      turnId: "turn-markdown",
      owner: "ui_projection",
      scope: "thread",
      phase: "completed",
      surface: "conversation",
      persistence: "snapshot",
      runtimeEntity: "agent_turn",
      runtimeStatus: "completed",
    },
  );

  assert.deepEqual(event.payload.validationIssues, []);
  assert.equal(event.payload.requiredSurfacesCovered, true);
  assert.equal(event.payload.commonRendererOwner, true);
  assert.deepEqual(event.payload.rendererOwners, [RENDERER_OWNER]);
  assert.deepEqual(event.payload.sourceFeaturesCovered, [
    "cjk_wrap",
    "code_fence",
    "file_link",
    "heading",
    "mixed_width_wrap",
    "table",
  ]);
  assert.deepEqual(event.payload.renderedFeaturesCovered, [
    "cjk_wrap",
    "code_fence",
    "file_link",
    "heading",
    "mixed_width_wrap",
    "table",
  ]);
  assert.equal(event.payload.fileLinksPreserved, true);
  assert.equal(event.payload.richSnapshotPresent, true);
  assert.deepEqual(event.refs.artifactPaths, [
    "src/components/MessageList.tsx",
  ]);
});

test("pageText-only markdown assertions fail closed", () => {
  const snapshot = extractMarkdownRenderProjectionSnapshot(
    baseInput({
      surfaces: [
        surface("assistant_final_text", "# Result", undefined, {
          pageText: "Result",
        }),
        ...baseInput().surfaces.slice(1),
      ],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "page_text_only_snapshot",
    ),
  );
  assert.equal(snapshot.pageTextOnlyRejected, false);
  assert.equal(snapshot.richSnapshotPresent, false);
});

test("raw markdown tables and code fences cannot replace rendered block snapshots", () => {
  const snapshot = extractMarkdownRenderProjectionSnapshot(
    baseInput({
      surfaces: [
        surface(
          "assistant_final_text",
          ["| file | status |", "| --- | --- |", "| a.ts | ok |"].join("\n"),
          {
            blocks: [{ type: "paragraph", text: "| file | status |" }],
          },
        ),
        surface(
          "tool_output",
          ["```ts", "const ok = true;", "```"].join("\n"),
          {
            blocks: [{ type: "paragraph", text: "```ts" }],
          },
        ),
        ...baseInput().surfaces.slice(2),
      ],
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues
      .filter((issue) => issue.code === "raw_markdown_only_snapshot")
      .map((issue) => issue.path),
    ["$.surfaces[0].renderedSnapshot", "$.surfaces[1].renderedSnapshot"],
  );
  assert.equal(snapshot.rawMarkdownOnlyRejected, false);
});

test("file links must preserve path and line metadata", () => {
  const artifact = surface(
    "artifact_preview",
    "See [MessageList](src/components/MessageList.tsx:42).",
    {
      blocks: [{ type: "file_link", text: "MessageList" }],
      fileLinks: [{ path: "src/components/MessageList.tsx" }],
    },
  );
  const snapshot = extractMarkdownRenderProjectionSnapshot(
    baseInput({
      surfaces: [...baseInput().surfaces.slice(0, 2), artifact],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "file_link_metadata_lost",
    ),
  );
  assert.equal(snapshot.fileLinksPreserved, false);
});

test("markdown renderer owner must be common across all surfaces", () => {
  const snapshot = extractMarkdownRenderProjectionSnapshot(
    baseInput({
      surfaces: [
        baseInput().surfaces[0],
        {
          ...baseInput().surfaces[1],
          rendererOwner: "tool-markdown-renderer",
        },
        baseInput().surfaces[2],
      ],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "common_renderer_owner_missing",
    ),
  );
  assert.equal(snapshot.commonRendererOwner, false);
});
