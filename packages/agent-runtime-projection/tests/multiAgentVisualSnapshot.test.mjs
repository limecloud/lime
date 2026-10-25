import test from "node:test";
import assert from "node:assert/strict";

import { extractMultiAgentVisualSnapshot } from "../dist/index.js";

function spawnItem(overrides = {}) {
  return {
    type: "collabToolCall",
    id: "spawn-1",
    tool: "spawn_agent",
    status: "completed",
    sender_thread_id: "thread-root",
    receiver_thread_ids: ["thread-research"],
    prompt: "Explore the repo and return the important files.",
    model: "gpt-5",
    reasoning_effort: "high",
    agents_states: {
      "thread-research": {
        status: "pending_init",
      },
    },
    ...overrides,
  };
}

function waitItem(overrides = {}) {
  return {
    type: "collabToolCall",
    id: "wait-1",
    tool: "wait_agent",
    status: "completed",
    senderThreadId: "thread-root",
    receiverThreadIds: ["thread-research", "thread-review"],
    agentsStates: {
      "thread-research": {
        status: "completed",
        message: "Done with source links.",
      },
      "thread-review": {
        status: "running",
      },
    },
    ...overrides,
  };
}

function observedSnapshot() {
  return {
    teamTranscriptRows: [
      {
        itemId: "spawn-1",
        title: "Spawned Robie [explorer] (gpt-5 high)",
      },
      {
        itemId: "wait-1",
        title: "Finished waiting",
      },
    ],
    teamRosterCards: [
      {
        threadId: "thread-research",
        label: "Robie [explorer]",
      },
      {
        threadId: "thread-review",
        label: "Ada [reviewer]",
      },
    ],
    delegationEdges: [
      {
        itemId: "spawn-1",
        fromThreadId: "thread-root",
        toThreadId: "thread-research",
      },
      {
        itemId: "wait-1",
        fromThreadId: "thread-root",
        toThreadId: "thread-review",
      },
    ],
    workerNotifications: [
      {
        threadId: "thread-research",
        status: "completed",
      },
    ],
  };
}

function baseInput(overrides = {}) {
  return {
    threadId: "thread-root",
    collabToolCallItems: [spawnItem(), waitItem()],
    observedSnapshot: observedSnapshot(),
    agentMetadata: {
      "thread-research": {
        agent_nickname: "Robie",
        agent_role: "explorer",
      },
      "thread-review": {
        agent_nickname: "Ada",
        agent_role: "reviewer",
      },
    },
    ...overrides,
  };
}

test("multi-agent visual snapshot is derived from collabToolCall items", () => {
  const snapshot = extractMultiAgentVisualSnapshot(baseInput());

  assert.deepEqual(snapshot.validationIssues, []);
  assert.equal(snapshot.collabItemCount, 2);
  assert.deepEqual(snapshot.visualSurfaces, {
    teamTranscript: true,
    teamRoster: true,
    delegationGraph: true,
    workerNotifications: true,
  });
  assert.deepEqual(snapshot.teamTranscriptRows[0], {
    itemId: "spawn-1",
    tool: "spawn_agent",
    status: "completed",
    senderThreadId: "thread-root",
    receiverThreadIds: ["thread-research"],
    promptPreview: "Explore the repo and return the important files.",
    requestedModel: "gpt-5",
    reasoningEffort: "high",
  });
  assert.deepEqual(snapshot.teamRosterCards[0], {
    threadId: "thread-research",
    status: "completed",
    sourceStatus: "completed",
    sourceItemId: "wait-1",
    nickname: "Robie",
    role: "explorer",
    messagePreview: "Done with source links.",
  });
  assert.deepEqual(snapshot.workerNotifications, [
    {
      notificationId: "thread-research:completed",
      itemId: "wait-1",
      threadId: "thread-research",
      status: "completed",
      messagePreview: "Done with source links.",
    },
  ]);
});

test("legacy plain transcript rows fail closed as visual evidence", () => {
  const snapshot = extractMultiAgentVisualSnapshot({
    threadId: "thread-root",
    legacyTranscriptRows: ["Spawned Robie with gpt-5 high", "Finished waiting"],
  });

  assert.equal(snapshot.legacyTranscriptOnly, true);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["missing_collab_tool_call_item", "legacy_plain_transcript_only"],
  );
});

test("collab item lineage requires sender and receiver thread ids", () => {
  const snapshot = extractMultiAgentVisualSnapshot(
    baseInput({
      collabToolCallItems: [
        spawnItem({
          sender_thread_id: undefined,
          receiver_thread_ids: [],
          agents_states: {},
        }),
      ],
      observedSnapshot: {
        teamTranscriptRows: [],
        teamRosterCards: [],
        delegationEdges: [],
        workerNotifications: [],
      },
    }),
  );

  assert.equal(snapshot.lineageStable, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["missing_sender_thread_id", "spawn_missing_new_thread_id"],
  );
});

test("wait and list snapshots do not require receiver thread lineage", () => {
  const snapshot = extractMultiAgentVisualSnapshot({
    threadId: "thread-root",
    collabToolCallItems: [
      {
        type: "collabToolCall",
        id: "wait-1",
        tool: "wait_agent",
        status: "completed",
        senderThreadId: "thread-root",
      },
      {
        type: "collabToolCall",
        id: "list-1",
        tool: "list_agents",
        status: "completed",
        senderThreadId: "thread-root",
      },
    ],
    observedSnapshot: {
      teamTranscriptRows: [{ itemId: "wait-1" }, { itemId: "list-1" }],
      teamRosterCards: [],
      delegationEdges: [],
      workerNotifications: [],
    },
  });

  assert.equal(snapshot.lineageStable, true);
  assert.deepEqual(
    snapshot.teamTranscriptRows.map((row) => row.tool),
    ["wait_agent", "list_agents"],
  );
  assert.deepEqual(snapshot.validationIssues, []);
});

test("followup and interrupt keep current v2 names in visual snapshots", () => {
  const snapshot = extractMultiAgentVisualSnapshot({
    threadId: "thread-root",
    collabToolCallItems: [
      {
        type: "collabToolCall",
        id: "followup-1",
        tool: "followup_task",
        status: "completed",
        senderThreadId: "thread-root",
        receiverThreadIds: ["thread-research"],
      },
      {
        type: "collabToolCall",
        id: "interrupt-1",
        tool: "interrupt_agent",
        status: "completed",
        senderThreadId: "thread-root",
        receiverThreadIds: ["thread-research"],
      },
    ],
    observedSnapshot: {
      teamTranscriptRows: [{ itemId: "followup-1" }, { itemId: "interrupt-1" }],
      teamRosterCards: [],
      delegationEdges: [{ itemId: "followup-1" }, { itemId: "interrupt-1" }],
      workerNotifications: [],
    },
  });

  assert.deepEqual(
    snapshot.teamTranscriptRows.map((row) => row.tool),
    ["followup_task", "interrupt_agent"],
  );
  assert.deepEqual(snapshot.validationIssues, []);
});

test("observed GUI snapshot must preserve transcript, roster, graph and worker ids", () => {
  const snapshot = extractMultiAgentVisualSnapshot(
    baseInput({
      observedSnapshot: {
        teamTranscriptRows: [{ itemId: "spawn-1", title: "Spawned Robie" }],
        teamRosterCards: [{ threadId: "thread-research" }],
        delegationEdges: [{ itemId: "spawn-1" }],
        workerNotifications: [],
      },
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "missing_team_transcript_snapshot",
      "missing_team_roster_snapshot",
      "missing_delegation_graph_snapshot",
      "missing_worker_notification_snapshot",
      "missing_requested_model_effort",
    ],
  );
});

test("legacy Lime/Agent team tool names are rejected before visual projection", () => {
  const snapshot = extractMultiAgentVisualSnapshot(
    baseInput({
      collabToolCallItems: [
        {
          type: "collabToolCall",
          id: "legacy-1",
          tool: "TeamCreate",
          status: "completed",
          senderThreadId: "thread-root",
        },
      ],
      observedSnapshot: {
        teamTranscriptRows: [],
        teamRosterCards: [],
        delegationEdges: [],
        workerNotifications: [],
      },
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["legacy_tool_name"],
  );
});
