import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStatusSurfaceMatrixProjectionEvent,
  extractStatusSurfaceMatrixProjectionSnapshot,
} from "../dist/index.js";

const OWNER = "agent-status-surface-presenter";

function surface(surfaceName, facts = {}, overrides = {}) {
  return {
    surface: surfaceName,
    presentationOwner: OWNER,
    threadId: "thread-status",
    sessionId: "session-status",
    previewText: `${surfaceName} preview`,
    facts,
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    threadId: "thread-status",
    sessionId: "session-status",
    surfaces: [
      surface("footer", { runtimeStatus: "running", model: "gpt-5" }),
      surface("header", { runtimeStatus: "running", title: "Renamed thread" }),
      surface("title", { title: "Renamed thread" }),
      surface("rate_limit", {
        rateLimit: {
          remaining: 42,
          resetAt: "2026-07-09T04:00:00.000Z",
        },
      }),
      surface("model", { model: "gpt-5" }),
      surface("reasoning", { reasoningEffort: "high" }),
      surface("goal", { goalId: "goal-clawstream" }),
      surface("status_preview", { runtimeStatus: "running" }),
    ],
    ...overrides,
  };
}

test("status surface matrix uses one structured presentation owner", () => {
  const event = buildStatusSurfaceMatrixProjectionEvent(baseInput(), {
    sessionId: "session-status",
    threadId: "thread-status",
    turnId: "turn-status",
    sequence: 361,
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
      sourceType: "status_surface_matrix_projection",
      sequence: 361,
      sessionId: "session-status",
      threadId: "thread-status",
      turnId: "turn-status",
      owner: "ui_projection",
      scope: "thread",
      phase: "completed",
      surface: "runtime_status",
      persistence: "snapshot",
      runtimeEntity: "agent_turn",
      runtimeStatus: "completed",
    },
  );

  assert.deepEqual(event.payload.validationIssues, []);
  assert.deepEqual(event.payload.coveredSurfaces, [
    "footer",
    "goal",
    "header",
    "model",
    "rate_limit",
    "reasoning",
    "status_preview",
    "title",
  ]);
  assert.equal(event.payload.requiredSurfacesCovered, true);
  assert.equal(event.payload.threadSessionBindingPreserved, true);
  assert.equal(event.payload.sharedPresentationOwner, true);
  assert.equal(event.payload.metadataFactsPresent, true);
  assert.equal(event.payload.runtimeStatusPresent, true);
  assert.equal(event.payload.rateLimitFactsPresent, true);
});

test("status matrix requires every expected status surface", () => {
  const snapshot = extractStatusSurfaceMatrixProjectionSnapshot(
    baseInput({
      surfaces: baseInput().surfaces.filter(
        (entry) => entry.surface !== "goal",
      ),
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "missing_status_surface",
    ),
  );
  assert.equal(snapshot.requiredSurfacesCovered, false);
});

test("status surfaces reject split presentation owners and thread drift", () => {
  const snapshot = extractStatusSurfaceMatrixProjectionSnapshot(
    baseInput({
      surfaces: [
        ...baseInput().surfaces.slice(0, 2),
        {
          ...baseInput().surfaces[2],
          presentationOwner: "title-local-presenter",
          threadId: "thread-other",
        },
        ...baseInput().surfaces.slice(3),
      ],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "presentation_owner_split",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "thread_session_binding_lost",
    ),
  );
  assert.equal(snapshot.sharedPresentationOwner, false);
  assert.equal(snapshot.threadSessionBindingPreserved, false);
});

test("status matrix requires model, reasoning, goal, title, runtime and rate limit facts", () => {
  const snapshot = extractStatusSurfaceMatrixProjectionSnapshot(
    baseInput({
      surfaces: [
        surface("footer", {}),
        surface("header", {}),
        surface("title", {}),
        surface("rate_limit", { rateLimit: { remaining: 42 } }),
        surface("model", {}),
        surface("reasoning", {}),
        surface("goal", {}),
        surface("status_preview", {}),
      ],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "metadata_fact_missing",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "runtime_status_missing",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "rate_limit_fact_missing",
    ),
  );
  assert.equal(snapshot.metadataFactsPresent, false);
  assert.equal(snapshot.runtimeStatusPresent, false);
  assert.equal(snapshot.rateLimitFactsPresent, false);
});

test("natural language status inference and local component naming fail closed", () => {
  const snapshot = extractStatusSurfaceMatrixProjectionSnapshot(
    baseInput({
      surfaces: [
        {
          ...baseInput().surfaces[0],
          naturalLanguageInferred: true,
        },
        {
          ...baseInput().surfaces[1],
          duplicateComponentNaming: true,
        },
        ...baseInput().surfaces.slice(2),
      ],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "natural_language_status_inference",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "duplicate_component_naming",
    ),
  );
  assert.equal(snapshot.naturalLanguageInferenceRejected, false);
  assert.equal(snapshot.duplicateNamingRejected, false);
});
