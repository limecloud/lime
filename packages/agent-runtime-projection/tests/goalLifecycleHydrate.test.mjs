import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGoalLifecycleHydrateProjectionEvent,
  extractGoalLifecycleHydrateSnapshot,
} from "../dist/index.js";

function goal(overrides = {}) {
  return {
    goalId: "goal-1",
    threadId: "thread-goal",
    objective: "keep polishing",
    status: "active",
    tokenBudget: 40,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    ...overrides,
  };
}

function goalResponse(overrides = {}) {
  return {
    goal: goal(overrides),
  };
}

function goalNotification(overrides = {}) {
  return {
    method: "thread/goal/updated",
    params: {
      threadId: "thread-goal",
      goal: goal(overrides),
    },
  };
}

function analytics(action, status, overrides = {}) {
  return {
    event_name: "goal",
    event_params: {
      action,
      goal_id: "goal-1",
      thread_id: "thread-goal",
      turn_id: action === "usage_accounted" ? "turn-usage" : null,
      goal_status: status,
      has_token_budget: true,
      ...overrides,
    },
  };
}

function surface(surfaceName, overrides = {}) {
  return {
    surface: surfaceName,
    presentationOwner: "goal-status-presenter",
    threadId: "thread-goal",
    facts: {
      goalId: "goal-1",
      status: "budgetLimited",
      tokenBudget: 40,
      tokensUsed: 50,
      timeUsedSeconds: 12,
    },
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    threadId: "thread-goal",
    expectedGoalId: "goal-1",
    expectedStoppedStatuses: ["blocked", "usageLimited"],
    goalSetResponses: [
      goalResponse(),
      goalResponse({
        objective: "keep polishing with clearer wording",
        status: "budgetLimited",
        tokensUsed: 50,
        timeUsedSeconds: 12,
        updatedAt: "2026-07-09T00:01:00.000Z",
      }),
      goalResponse({
        objective: "blocked checkpoint",
        status: "blocked",
        tokensUsed: 50,
        timeUsedSeconds: 12,
        updatedAt: "2026-07-09T00:02:00.000Z",
      }),
      goalResponse({
        objective: "usage limited checkpoint",
        status: "usageLimited",
        tokensUsed: 50,
        timeUsedSeconds: 12,
        updatedAt: "2026-07-09T00:03:00.000Z",
      }),
    ],
    goalUpdatedNotifications: [
      goalNotification({
        objective: "keep polishing with clearer wording",
        status: "budgetLimited",
        tokensUsed: 50,
        timeUsedSeconds: 12,
        updatedAt: "2026-07-09T00:01:00.000Z",
      }),
    ],
    goalClearedNotifications: [
      {
        method: "thread/goal/cleared",
        params: {
          threadId: "thread-goal",
          goalId: "goal-1",
        },
      },
    ],
    goalRead: {
      goal: null,
    },
    analyticsEvents: [
      analytics("created", "active"),
      analytics("usage_accounted", "budget_limited", {
        cumulative_tokens_accounted: 200,
        cumulative_time_accounted_seconds: 12,
      }),
      analytics("status_changed", "budget_limited"),
      analytics("cleared", "budget_limited"),
    ],
    statusSurfaces: [surface("header"), surface("footer"), surface("goal")],
    transcriptItems: [],
    readModelItems: [],
    ...overrides,
  };
}

test("goal lifecycle hydrate keeps goal status, budget, usage and clear state structured", () => {
  const event = buildGoalLifecycleHydrateProjectionEvent(baseInput(), {
    sequence: 411,
    sessionId: "session-goal",
    threadId: "thread-goal",
    turnId: "turn-usage",
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
      control: event.control,
      runtimeEntity: event.runtimeEntity,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "state.snapshot",
      sourceType: "goal_lifecycle_hydrate_projection",
      sequence: 411,
      sessionId: "session-goal",
      threadId: "thread-goal",
      turnId: "turn-usage",
      owner: "ui_projection",
      scope: "thread",
      phase: "completed",
      surface: "runtime_status",
      persistence: "snapshot",
      control: "open_detail",
      runtimeEntity: "agent_turn",
      runtimeStatus: "completed",
    },
  );
  assert.deepEqual(event.payload.validationIssues, []);
  assert.equal(event.payload.usagePreservedAcrossObjectiveEdit, true);
  assert.equal(event.payload.expectedStoppedStatusesHydrated, true);
  assert.equal(event.payload.readAfterClearIsNull, true);
  assert.equal(event.payload.analyticsSanitized, true);
  assert.equal(
    event.payload.goalLifecycleHydrate.latestGoal.status,
    "budget_limited",
  );
});

test("goal lifecycle maps stopped wire statuses", () => {
  const snapshot = extractGoalLifecycleHydrateSnapshot(baseInput());
  const statuses = new Set(
    snapshot.goalSnapshots.map((item) => item.status).filter(Boolean),
  );

  assert(statuses.has("blocked"));
  assert(statuses.has("usage_limited"));
  assert.equal(snapshot.expectedStoppedStatusesHydrated, true);
  assert.equal(snapshot.statusesMapped, true);
});

test("goal lifecycle fails closed when objective edit resets accounted usage", () => {
  const snapshot = extractGoalLifecycleHydrateSnapshot(
    baseInput({
      goalSetResponses: [
        goalResponse(),
        goalResponse({
          objective: "keep polishing with clearer wording",
          status: "budgetLimited",
          tokensUsed: 0,
          timeUsedSeconds: 0,
          updatedAt: "2026-07-09T00:01:00.000Z",
        }),
      ],
    }),
  );

  assert.equal(snapshot.usagePreservedAcrossObjectiveEdit, false);
  assert(
    snapshot.validationIssues.some(
      (item) => item.code === "goal_usage_reset_on_objective_edit",
    ),
  );
});

test("goal lifecycle requires clear notification and null read after clear", () => {
  const snapshot = extractGoalLifecycleHydrateSnapshot(
    baseInput({
      goalClearedNotifications: [],
      goalRead: {
        goal: goal({
          status: "budgetLimited",
          tokensUsed: 50,
          timeUsedSeconds: 12,
        }),
      },
    }),
  );

  assert.equal(snapshot.clearNotificationSeen, false);
  assert.equal(snapshot.readAfterClearIsNull, false);
  assert.deepEqual(
    snapshot.validationIssues
      .map((item) => item.code)
      .filter((code) => code.includes("clear")),
    ["goal_clear_missing", "goal_read_not_cleared"],
  );
});

test("goal lifecycle rejects analytics leakage and transcript/read-model item leaks", () => {
  const snapshot = extractGoalLifecycleHydrateSnapshot(
    baseInput({
      analyticsEvents: [
        analytics("created", "active", {
          objective: "do not serialize this objective",
          token_budget: 100,
        }),
      ],
      transcriptItems: [
        {
          type: "thread_goal",
          text: "Goal changed",
        },
      ],
      readModelItems: [
        {
          kind: "goal_lifecycle",
        },
      ],
    }),
  );

  assert.equal(snapshot.analyticsSanitized, false);
  assert.equal(snapshot.transcriptClean, false);
  assert.equal(snapshot.readModelClean, false);
  assert.deepEqual(
    snapshot.validationIssues
      .map((item) => item.code)
      .filter((code) => code.includes("analytics") || code.includes("goal_")),
    [
      "analytics_leaks_objective",
      "goal_rendered_as_transcript_item",
      "goal_persisted_as_read_model_item",
    ],
  );
});

test("goal lifecycle requires shared thread-scoped goal status surfaces", () => {
  const snapshot = extractGoalLifecycleHydrateSnapshot(
    baseInput({
      statusSurfaces: [
        surface("header"),
        surface("footer", {
          presentationOwner: "footer-local",
          threadId: "thread-other",
          localStateOnly: true,
        }),
      ],
    }),
  );

  assert.equal(snapshot.goalSurfacesHydrated, false);
  assert.equal(snapshot.surfaceThreadScoped, false);
  assert.equal(snapshot.sharedSurfaceOwner, false);
  assert(
    snapshot.validationIssues.some(
      (item) => item.code === "goal_surface_missing",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (item) => item.code === "goal_surface_thread_mismatch",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (item) => item.code === "goal_surface_local_state_only",
    ),
  );
});
