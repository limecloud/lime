import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMcpInventoryStatusProjectionEvent,
  extractMcpInventoryStatusSnapshot,
} from "../dist/index.js";

test("MCP inventory status preserves raw server and raw tool names", () => {
  const snapshot = extractMcpInventoryStatusSnapshot({
    params: { detail: "full" },
    response: {
      data: [
        {
          name: "some-server",
          serverInfo: { title: "Lookup Server" },
          tools: {
            "look-up.raw": {
              name: "look-up.raw",
              description: "Lookup raw records",
            },
          },
          resources: [{ uri: "file:///resource.md" }],
          resourceTemplates: [{ uriTemplate: "file:///{name}" }],
          authStatus: "unsupported",
        },
      ],
    },
  });

  assert.equal(snapshot.detail, "full");
  assert.equal(snapshot.scopedToThread, false);
  assert.equal(snapshot.serverCount, 1);
  assert.equal(snapshot.toolCount, 1);
  assert.equal(snapshot.servers[0].rawName, "some-server");
  assert.equal(snapshot.servers[0].sanitizedName, "some_server");
  assert.equal(snapshot.servers[0].title, "Lookup Server");
  assert.equal(snapshot.servers[0].authStatus, "unsupported");
  assert.deepEqual(snapshot.servers[0].toolNames, ["look-up.raw"]);
  assert.equal(snapshot.servers[0].tools[0].rawName, "look-up.raw");
  assert.equal(snapshot.servers[0].tools[0].sanitizedName, "look_up_raw");
  assert.equal(snapshot.servers[0].resourceCount, 1);
  assert.equal(snapshot.servers[0].resourceTemplateCount, 1);
  assert.deepEqual(snapshot.validationIssues, []);
});

test("toolsAndAuthOnly inventory is thread-scoped and does not load resources", () => {
  const event = buildMcpInventoryStatusProjectionEvent(
    {
      params: {
        detail: "toolsAndAuthOnly",
        threadId: "thread-mcp",
      },
      response: {
        data: [
          {
            name: "project-server",
            serverInfo: null,
            tools: {
              project_lookup: {
                name: "project_lookup",
                description: "Project lookup",
              },
            },
            resources: [],
            resourceTemplates: [],
            authStatus: "bearerToken",
          },
        ],
      },
    },
    {
      sequence: 21,
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
      surface: event.surface,
      persistence: event.persistence,
      control: event.control,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "context.changed",
      sourceType: "mcp_inventory_status_projection",
      sequence: 21,
      sessionId: "session-mcp",
      threadId: "thread-mcp",
      owner: "context",
      scope: "thread",
      surface: "timeline_evidence",
      persistence: "snapshot",
      control: "open_detail",
      runtimeStatus: "completed",
    },
  );
  assert.equal(event.payload.detail, "toolsAndAuthOnly");
  assert.equal(event.payload.scopedToThread, true);
  assert.equal(event.payload.authOnly, true);
  assert.deepEqual(event.payload.serverNames, ["project-server"]);
  assert.deepEqual(event.payload.validationIssues, []);
});

test("MCP inventory status keeps sanitized server-name collisions distinct", () => {
  const snapshot = extractMcpInventoryStatusSnapshot({
    response: {
      data: [
        {
          name: "some-server",
          serverInfo: null,
          tools: {
            dash_lookup: { name: "dash_lookup" },
          },
          resources: [],
          resourceTemplates: [],
          authStatus: "unsupported",
        },
        {
          name: "some_server",
          serverInfo: null,
          tools: {
            underscore_lookup: { name: "underscore_lookup" },
          },
          resources: [],
          resourceTemplates: [],
          authStatus: "unsupported",
        },
      ],
    },
  });

  assert.equal(snapshot.hasNameCollisions, true);
  assert.deepEqual(snapshot.collisionGroups, {
    some_server: ["some-server", "some_server"],
  });
  assert.deepEqual(
    snapshot.servers.map((server) => [server.rawName, server.toolNames]),
    [
      ["some-server", ["dash_lookup"]],
      ["some_server", ["underscore_lookup"]],
    ],
  );
  assert.deepEqual(snapshot.validationIssues, []);
});

test("toolsAndAuthOnly fails closed if resource inventory was loaded", () => {
  const event = buildMcpInventoryStatusProjectionEvent({
    params: { detail: "toolsAndAuthOnly" },
    response: {
      data: [
        {
          name: "some-server",
          serverInfo: null,
          tools: { lookup: { name: "lookup" } },
          resources: [{ uri: "file:///slow-resource.md" }],
          resourceTemplates: [],
          authStatus: "unsupported",
        },
      ],
    },
  });

  assert.equal(event.phase, "failed");
  assert.equal(event.runtimeStatus, "failed");
  assert.deepEqual(
    event.payload.validationIssues.map((item) => item.code),
    ["tools_auth_only_loaded_resources"],
  );
});

test("MCP inventory status rejects naked sanitized server__tool names", () => {
  const event = buildMcpInventoryStatusProjectionEvent({
    response: {
      data: [
        {
          name: "some-server",
          serverInfo: null,
          tools: {
            some_server__lookup: { name: "some_server__lookup" },
          },
          resources: [],
          resourceTemplates: [],
          authStatus: "unsupported",
        },
      ],
    },
  });

  assert.equal(event.phase, "failed");
  assert.equal(event.runtimeStatus, "failed");
  assert.deepEqual(
    event.payload.validationIssues.map((item) => item.code),
    ["naked_sanitized_tool_name"],
  );
});
