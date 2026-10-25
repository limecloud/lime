import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMcpStartupStatusProjectionEvent,
  extractMcpStartupStatusSnapshot,
} from "../dist/index.js";

test("MCP startup status update is thread-scoped and ignores other-thread updates", () => {
  const snapshot = extractMcpStartupStatusSnapshot({
    activeThreadId: "thread-1",
    expectedServers: ["sentry"],
    activeTurnRunning: true,
    events: [
      {
        type: "mcp_startup_update",
        threadId: "thread-child",
        server: "sentry",
        status: "starting",
        roundId: "round-child",
      },
      {
        type: "mcp_startup_update",
        threadId: "thread-child",
        server: "sentry",
        status: "failed",
        error: "sentry is not logged in",
        roundId: "round-child",
      },
    ],
  });

  assert.equal(snapshot.startupActive, false);
  assert.equal(snapshot.activeTurnRunning, true);
  assert.equal(snapshot.taskRunning, true);
  assert.equal(snapshot.statusHeader, "Working");
  assert.deepEqual(
    snapshot.ignoredUpdates.map((update) => update.reason),
    ["other_thread", "other_thread"],
  );
  assert.deepEqual(snapshot.validationIssues, []);
});

test("MCP startup status projects an active runtime header instead of assistant output", () => {
  const event = buildMcpStartupStatusProjectionEvent(
    {
      activeThreadId: "thread-1",
      expectedServers: ["alpha"],
      events: [
        {
          type: "mcp_startup_update",
          threadId: "thread-1",
          server: "alpha",
          status: "starting",
          roundId: "round-1",
        },
      ],
    },
    {
      sequence: 41,
      sessionId: "session-mcp",
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
      owner: event.owner,
      scope: event.scope,
      phase: event.phase,
      surface: event.surface,
      persistence: event.persistence,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "context.changed",
      sourceType: "mcp_startup_status_projection",
      sequence: 41,
      sessionId: "session-mcp",
      threadId: "thread-1",
      owner: "runtime",
      scope: "thread",
      phase: "preparing",
      surface: "runtime_status",
      persistence: "ephemeral_live",
      runtimeStatus: "running",
    },
  );
  assert.equal(event.payload.startupActive, true);
  assert.equal(event.payload.statusHeader, "Booting MCP server: alpha");
  assert.equal(event.payload.mcpStartupStatus.assistantItemCount, 0);
  assert.deepEqual(event.payload.validationIssues, []);
});

test("MCP startup completion does not clear the running turn and restores the running header", () => {
  const snapshot = extractMcpStartupStatusSnapshot({
    activeThreadId: "thread-1",
    expectedServers: ["alpha", "beta"],
    activeTurnRunning: true,
    observed: {
      taskRunningAfterStartup: true,
      statusHeader: "Working",
    },
    events: [
      {
        type: "mcp_startup_update",
        threadId: "thread-1",
        server: "alpha",
        status: "starting",
        roundId: "round-1",
      },
      {
        type: "mcp_startup_update",
        threadId: "thread-1",
        server: "beta",
        status: "starting",
        roundId: "round-1",
      },
      {
        type: "mcp_startup_update",
        threadId: "thread-1",
        server: "alpha",
        status: "failed",
        error: "MCP client for `alpha` failed to start: handshake failed",
        roundId: "round-1",
      },
      {
        type: "mcp_startup_update",
        threadId: "thread-1",
        server: "beta",
        status: "ready",
        roundId: "round-1",
      },
    ],
  });

  assert.equal(snapshot.startupActive, false);
  assert.equal(snapshot.activeTurnRunning, true);
  assert.equal(snapshot.taskRunning, true);
  assert.equal(snapshot.statusHeader, "Working");
  assert.deepEqual(
    snapshot.warnings.map((warning) => warning.message),
    [
      "MCP client for `alpha` failed to start: handshake failed",
      "MCP startup incomplete (failed: alpha)",
    ],
  );
  assert.deepEqual(snapshot.validationIssues, []);
});

test("MCP startup completion clearing a running turn fails closed", () => {
  const event = buildMcpStartupStatusProjectionEvent({
    activeThreadId: "thread-1",
    expectedServers: ["schaltwerk"],
    activeTurnRunning: true,
    observed: {
      taskRunningAfterStartup: false,
    },
    events: [
      {
        type: "mcp_startup_update",
        threadId: "thread-1",
        server: "schaltwerk",
        status: "starting",
        roundId: "round-1",
      },
      {
        type: "mcp_startup_update",
        threadId: "thread-1",
        server: "schaltwerk",
        status: "ready",
        roundId: "round-1",
      },
    ],
  });

  assert.equal(event.phase, "failed");
  assert.equal(event.runtimeStatus, "failed");
  assert.deepEqual(
    event.payload.validationIssues.map((item) => item.code),
    ["startup_complete_cleared_running_task"],
  );
});

test("MCP startup ignores late updates from a completed round and fails if they reopen startup", () => {
  const snapshot = extractMcpStartupStatusSnapshot({
    activeThreadId: "thread-1",
    expectedServers: ["alpha", "beta"],
    observed: {
      reopenedFromStaleUpdate: true,
    },
    events: [
      {
        type: "mcp_startup_update",
        threadId: "thread-1",
        server: "alpha",
        status: "starting",
        roundId: "round-1",
      },
      {
        type: "mcp_startup_update",
        threadId: "thread-1",
        server: "alpha",
        status: "failed",
        error: "MCP client for `alpha` failed to start: handshake failed",
        roundId: "round-1",
      },
      {
        type: "mcp_startup_update",
        threadId: "thread-1",
        server: "beta",
        status: "starting",
        roundId: "round-1",
      },
      {
        type: "lag_elapsed",
        roundId: "round-1",
      },
      {
        type: "mcp_startup_update",
        threadId: "thread-1",
        server: "beta",
        status: "starting",
        roundId: "round-1",
      },
      {
        type: "mcp_startup_update",
        threadId: "thread-1",
        server: "beta",
        status: "ready",
        roundId: "round-1",
      },
    ],
  });

  assert.equal(snapshot.startupActive, false);
  assert.deepEqual(
    snapshot.ignoredUpdates.map((update) => [
      update.server,
      update.state,
      update.reason,
    ]),
    [
      ["beta", "starting", "stale_completed_round"],
      ["beta", "ready", "stale_completed_round"],
    ],
  );
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["stale_update_reopened_startup"],
  );
});

test("MCP startup status requires thread scope and must not become assistant text", () => {
  const snapshot = extractMcpStartupStatusSnapshot({
    activeThreadId: "thread-1",
    expectedServers: ["alpha"],
    assistantItems: [{ text: "Booting MCP server: alpha" }],
    events: [
      {
        type: "mcp_startup_update",
        server: "alpha",
        status: "starting",
        roundId: "round-1",
      },
    ],
  });

  assert.equal(snapshot.startupActive, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["missing_update_thread_scope", "startup_rendered_as_assistant_item"],
  );
});
