import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSelectedCapabilityStackProjectionEvent,
  extractSelectedCapabilityStackSnapshot,
} from "../dist/index.js";

const selectedRoot = {
  id: "executor-demo@1",
  location: {
    type: "environment",
    environmentId: "executor-1",
    path: "file:///plugins/executor-demo",
  },
};

const selectedCapabilities = {
  selectedSkills: ["executor-demo:deploy"],
  selectedMcpServers: ["executor_probe"],
  selectedPluginTools: [
    "mcp__executor_probe.echo",
    "app__calendar.create_event",
  ],
};

function stackInput(overrides = {}) {
  return {
    threadId: "thread-selected",
    turnId: "turn-1",
    selectedCapabilityRoots: [selectedRoot],
    ...overrides,
  };
}

test("selected capability stack suppresses selected tools while the environment is unavailable", () => {
  const event = buildSelectedCapabilityStackProjectionEvent(
    stackInput({
      environmentStates: [
        {
          environmentId: "executor-1",
          available: false,
          generation: "env-g1",
          source: "thread-start",
        },
      ],
      samples: [
        {
          sampleId: "initial-unavailable",
          turnId: "turn-1",
          environmentId: "executor-1",
          environmentGeneration: "env-g1",
          selectedRootIds: ["executor-demo@1"],
          unavailableMessage:
            "No selected-environment skills are currently available.",
        },
      ],
    }),
    {
      sequence: 91,
      sessionId: "session-capability",
      timestamp: "2026-07-09T00:00:00.000Z",
    },
  );

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
      surface: event.surface,
      persistence: event.persistence,
      control: event.control,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "context.changed",
      sourceType: "selected_capability_stack_projection",
      sequence: 91,
      sessionId: "session-capability",
      threadId: "thread-selected",
      turnId: "turn-1",
      owner: "context",
      scope: "thread",
      surface: "timeline_evidence",
      persistence: "snapshot",
      control: "open_detail",
      runtimeStatus: "completed",
    },
  );
  assert.deepEqual(event.payload.selectedRootIds, ["executor-demo@1"]);
  assert.deepEqual(event.payload.unavailableEnvironmentIds, ["executor-1"]);
  assert.equal(event.payload.injectionStable, true);
  assert.deepEqual(event.payload.validationIssues, []);
});

test("selected capability stack injects skills, MCP servers and plugin tools after attach", () => {
  const snapshot = extractSelectedCapabilityStackSnapshot(
    stackInput({
      environmentStates: [
        {
          environmentId: "executor-1",
          available: true,
          generation: "env-g2",
          source: "environment/add",
        },
      ],
      samples: [
        {
          sampleId: "attached-request",
          turnId: "turn-2",
          environmentId: "executor-1",
          environmentGeneration: "env-g2",
          selectedRootIds: ["executor-demo@1"],
          ...selectedCapabilities,
        },
      ],
    }),
  );

  assert.equal(snapshot.injectionStable, true);
  assert.deepEqual(snapshot.availableEnvironmentIds, ["executor-1"]);
  assert.deepEqual(snapshot.samples[0].selectedSkillNames, [
    "executor-demo:deploy",
  ]);
  assert.deepEqual(snapshot.samples[0].selectedMcpServerNames, [
    "executor_probe",
  ]);
  assert.deepEqual(snapshot.samples[0].selectedPluginToolNames, [
    "mcp__executor_probe.echo",
    "app__calendar.create_event",
  ]);
  assert.deepEqual(snapshot.validationIssues, []);
});

test("selected capability stack clears injected tools when resume sees the environment unavailable", () => {
  const snapshot = extractSelectedCapabilityStackSnapshot(
    stackInput({
      resumeSessionId: "resume-1",
      environmentStates: [
        {
          environmentId: "executor-1",
          available: true,
          generation: "env-g2",
          source: "before-restart",
        },
        {
          environmentId: "executor-1",
          available: false,
          generation: "env-g3",
          source: "resume",
        },
      ],
      samples: [
        {
          sampleId: "resume-unavailable",
          turnId: "turn-resume",
          resumed: true,
          environmentId: "executor-1",
          environmentGeneration: "env-g3",
          unavailableMessage:
            "No selected-environment skills are currently available.",
        },
      ],
    }),
  );

  assert.equal(snapshot.resumed, true);
  assert.equal(snapshot.injectionStable, true);
  assert.deepEqual(snapshot.samples[0].selectedSkillNames, []);
  assert.deepEqual(snapshot.validationIssues, []);
});

test("selected capability stack restores selected tools with a new generation after reattach", () => {
  const snapshot = extractSelectedCapabilityStackSnapshot(
    stackInput({
      resumeSessionId: "resume-1",
      environmentStates: [
        {
          environmentId: "executor-1",
          available: false,
          generation: "env-g3",
          source: "resume",
        },
        {
          environmentId: "executor-1",
          available: true,
          generation: "env-g4",
          source: "environment/add",
        },
      ],
      samples: [
        {
          sampleId: "reattached-request",
          turnId: "turn-reattached",
          resumed: true,
          environmentId: "executor-1",
          environmentGeneration: "env-g4",
          ...selectedCapabilities,
        },
      ],
    }),
  );

  assert.equal(snapshot.injectionStable, true);
  assert.equal(snapshot.samples[0].environmentGeneration, "env-g4");
  assert.deepEqual(snapshot.samples[0].selectedMcpServerNames, [
    "executor_probe",
  ]);
  assert.deepEqual(snapshot.validationIssues, []);
});

test("selected capability stack resamples in the same turn when capabilities become available", () => {
  const snapshot = extractSelectedCapabilityStackSnapshot(
    stackInput({
      environmentStates: [
        {
          environmentId: "executor-1",
          available: false,
          generation: "env-g1",
          source: "turn-start",
        },
        {
          environmentId: "executor-1",
          available: true,
          generation: "env-g2",
          source: "environment/add",
        },
      ],
      availabilityTimeline: [
        {
          environmentId: "executor-1",
          available: false,
          generation: "env-g1",
          turnId: "turn-1",
          sampleId: "sample-before-input",
        },
        {
          environmentId: "executor-1",
          available: true,
          generation: "env-g2",
          turnId: "turn-1",
          sampleId: "sample-after-input",
        },
      ],
      previousSamples: [
        {
          sampleId: "sample-before-input",
          environmentId: "executor-1",
          environmentGeneration: "env-g1",
          environmentAvailable: false,
        },
      ],
      samples: [
        {
          sampleId: "sample-before-input",
          turnId: "turn-1",
          environmentId: "executor-1",
          environmentGeneration: "env-g1",
          environmentAvailable: false,
        },
        {
          sampleId: "sample-after-input",
          turnId: "turn-1",
          environmentId: "executor-1",
          environmentGeneration: "env-g2",
          ...selectedCapabilities,
        },
      ],
    }),
  );

  assert.equal(snapshot.historyStable, true);
  assert.equal(snapshot.injectionStable, true);
  assert.equal(snapshot.samples[0].environmentAvailable, false);
  assert.equal(snapshot.samples[1].environmentAvailable, true);
  assert.deepEqual(snapshot.validationIssues, []);
});

test("selected capability stack fails closed when unavailable samples inject selected tools", () => {
  const snapshot = extractSelectedCapabilityStackSnapshot(
    stackInput({
      environmentStates: [
        {
          environmentId: "executor-1",
          available: false,
          generation: "env-g1",
        },
      ],
      samples: [
        {
          sampleId: "bad-unavailable",
          environmentId: "executor-1",
          environmentGeneration: "env-g1",
          selectedSkills: ["executor-demo:deploy"],
        },
      ],
    }),
  );

  assert.equal(snapshot.injectionStable, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["unavailable_sample_injected_capability"],
  );
});

test("selected capability stack fails closed when resume reuses an old available generation", () => {
  const snapshot = extractSelectedCapabilityStackSnapshot(
    stackInput({
      resumed: true,
      environmentStates: [
        {
          environmentId: "executor-1",
          available: true,
          generation: "env-g2",
        },
        {
          environmentId: "executor-1",
          available: false,
          generation: "env-g3",
        },
      ],
      samples: [
        {
          sampleId: "bad-resume",
          resumed: true,
          environmentId: "executor-1",
          environmentGeneration: "env-g2",
          environmentAvailable: false,
        },
      ],
    }),
  );

  assert.equal(snapshot.injectionStable, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["resume_reused_available_generation"],
  );
});

test("selected capability stack fails closed when same-turn availability is not resampled", () => {
  const snapshot = extractSelectedCapabilityStackSnapshot(
    stackInput({
      environmentStates: [
        {
          environmentId: "executor-1",
          available: false,
          generation: "env-g1",
        },
        {
          environmentId: "executor-1",
          available: true,
          generation: "env-g2",
        },
      ],
      availabilityTimeline: [
        {
          environmentId: "executor-1",
          available: false,
          generation: "env-g1",
          turnId: "turn-1",
        },
        {
          environmentId: "executor-1",
          available: true,
          generation: "env-g2",
          turnId: "turn-1",
        },
      ],
      samples: [
        {
          sampleId: "only-before-input",
          turnId: "turn-1",
          environmentId: "executor-1",
          environmentGeneration: "env-g1",
          environmentAvailable: false,
        },
      ],
    }),
  );

  assert.equal(snapshot.injectionStable, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["same_turn_availability_not_resampled"],
  );
});

test("selected capability stack fails closed when availability rewrites historical samples", () => {
  const snapshot = extractSelectedCapabilityStackSnapshot(
    stackInput({
      environmentStates: [
        {
          environmentId: "executor-1",
          available: true,
          generation: "env-g2",
        },
      ],
      previousSamples: [
        {
          sampleId: "first-request",
          environmentId: "executor-1",
          environmentGeneration: "env-g1",
          environmentAvailable: false,
        },
      ],
      samples: [
        {
          sampleId: "first-request",
          environmentId: "executor-1",
          environmentGeneration: "env-g2",
          ...selectedCapabilities,
        },
      ],
    }),
  );

  assert.equal(snapshot.historyStable, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["history_sample_rewritten"],
  );
});
