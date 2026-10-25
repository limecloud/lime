import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMcpThreadScopeProjectionEvent,
  extractMcpThreadScopeSnapshot,
} from "../dist/index.js";

const selectedRoot = {
  id: "executor-demo@1",
  location: {
    type: "environment",
    environmentId: "executor-1",
    path: "file:///plugins/executor-demo",
  },
};

const selectedPluginServers = [
  {
    kind: "SelectedPlugin",
    name: "executor_demo",
    pluginId: "executor-demo@1",
    pluginDisplayName: "Executor Demo",
    selectionOrder: 0,
    environmentId: "executor-1",
    enabled: true,
  },
  {
    kind: "SelectedPlugin",
    name: "executor_http",
    pluginId: "executor-demo@1",
    pluginDisplayName: "Executor Demo",
    selectionOrder: 0,
    environmentId: "local",
    enabled: true,
  },
  {
    kind: "SelectedPlugin",
    name: "executor_oauth",
    pluginId: "executor-demo@1",
    pluginDisplayName: "Executor Demo",
    selectionOrder: 0,
    environmentId: "local",
    enabled: true,
  },
];

function scopedInput(overrides = {}) {
  return {
    threads: [
      {
        threadId: "thread-selected",
        selectedCapabilityRoots: [selectedRoot],
        mcpServers: [
          "executor_demo",
          "executor_http",
          "executor_oauth",
          "refresh_probe",
        ],
      },
      {
        threadId: "thread-other",
        mcpServers: ["refresh_probe"],
      },
    ],
    mcpServerContributions: selectedPluginServers,
    toolCalls: [
      {
        threadId: "thread-selected",
        server: "executor_http",
        tool: "echo",
      },
    ],
    oauthNotifications: [
      {
        name: "executor_oauth",
        thread_id: "thread-selected",
        success: true,
      },
    ],
    ...overrides,
  };
}

test("MCP thread scope keeps selected executor plugin servers on the owning thread", () => {
  const event = buildMcpThreadScopeProjectionEvent(scopedInput(), {
    sequence: 31,
    sessionId: "session-mcp",
    timestamp: "2026-07-09T00:00:00.000Z",
  });

  assert.deepEqual(
    {
      type: event.type,
      sourceType: event.sourceType,
      sequence: event.sequence,
      sessionId: event.sessionId,
      threadId: event.threadId,
      owner: event.owner,
      scope: event.scope,
      surface: event.surface,
      persistence: event.persistence,
      control: event.control,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "context.changed",
      sourceType: "mcp_thread_scope_projection",
      sequence: 31,
      sessionId: "session-mcp",
      threadId: "thread-selected",
      owner: "context",
      scope: "thread",
      surface: "timeline_evidence",
      persistence: "snapshot",
      control: "open_detail",
      runtimeStatus: "completed",
    },
  );
  assert.equal(event.payload.scopeStable, true);
  assert.deepEqual(event.payload.selectedRootIds, ["executor-demo@1"]);
  assert.deepEqual(event.payload.selectedPluginServerNames, [
    "executor_demo",
    "executor_http",
    "executor_oauth",
  ]);
  assert.deepEqual(event.payload.globalServerNames, ["refresh_probe"]);
  assert.equal(event.payload.leakCount, 0);
  assert.deepEqual(event.payload.validationIssues, []);
});

test("MCP thread scope fails closed when selected plugin servers leak globally or to another thread", () => {
  const event = buildMcpThreadScopeProjectionEvent(
    scopedInput({
      threadInventories: [
        {
          threadId: "thread-selected",
          mcpServers: ["executor_demo", "refresh_probe"],
        },
        {
          mcpServers: ["executor_http"],
        },
        {
          threadId: "thread-other",
          mcpServers: ["executor_oauth"],
        },
      ],
    }),
  );

  assert.equal(event.phase, "failed");
  assert.equal(event.runtimeStatus, "failed");
  assert.deepEqual(
    event.payload.validationIssues.map((item) => item.code),
    [
      "selected_thread_missing_server",
      "selected_thread_missing_server",
      "selected_server_unscoped",
      "selected_server_leaked_to_thread",
    ],
  );
  assert.deepEqual(event.payload.mcpThreadScope.leaks, [
    {
      server: "executor_http",
      path: "$.threadInventories[1].serverNames",
    },
    {
      server: "executor_oauth",
      threadId: "thread-other",
      path: "$.threadInventories[2].serverNames",
    },
  ]);
});

test("MCP thread scope requires selected plugin tool calls and OAuth notifications to carry the owning thread", () => {
  const snapshot = extractMcpThreadScopeSnapshot(
    scopedInput({
      toolCalls: [
        {
          server: "executor_demo",
          tool: "echo",
        },
        {
          threadId: "thread-other",
          server: "executor_http",
          tool: "echo",
        },
      ],
      oauthNotifications: [
        {
          name: "executor_oauth",
          success: true,
        },
        {
          name: "executor_oauth",
          threadId: "thread-other",
          success: true,
        },
      ],
    }),
  );

  assert.equal(snapshot.scopeStable, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "tool_call_missing_thread_scope",
      "tool_call_wrong_thread",
      "oauth_notification_missing_thread_scope",
      "oauth_notification_wrong_thread",
    ],
  );
});

test("MCP thread scope requires selected roots and selected plugin server metadata", () => {
  const snapshot = extractMcpThreadScopeSnapshot({
    selectedThreadId: "thread-selected",
    threadInventories: [
      {
        threadId: "thread-selected",
        mcpServers: ["refresh_probe"],
      },
    ],
  });

  assert.equal(snapshot.scopeStable, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["missing_selected_root", "missing_plugin_server"],
  );
});
