import test from "node:test";
import assert from "node:assert/strict";

import * as publicProjection from "../dist/index.js";
import { extractMcpElicitationSnapshot } from "../dist/mcpElicitation.js";

function standardFormParams() {
  return {
    threadId: "thread-mcp",
    turnId: "turn-mcp",
    serverName: "lime_apps",
    message: "Allow this request?",
    requestedSchema: {
      type: "object",
      properties: {
        confirmed: {
          type: "boolean",
          title: "Confirm",
        },
      },
      required: ["confirmed"],
    },
  };
}

test("MCP form elicitation request binds request id, server, thread, turn and schema", () => {
  const snapshot = extractMcpElicitationSnapshot({
    requestId: "request-mcp-1",
    params: standardFormParams(),
  });

  assert.deepEqual(
    {
      requestId: snapshot?.request.requestId,
      serverName: snapshot?.request.serverName,
      threadId: snapshot?.request.threadId,
      turnId: snapshot?.request.turnId,
      mode: snapshot?.request.mode,
      schemaPropertyNames: snapshot?.request.schemaPropertyNames,
      requiredFields: snapshot?.request.requiredFields,
      correlatedToTurn: snapshot?.request.correlatedToTurn,
    },
    {
      requestId: "request-mcp-1",
      serverName: "lime_apps",
      threadId: "thread-mcp",
      turnId: "turn-mcp",
      mode: "form",
      schemaPropertyNames: ["confirmed"],
      requiredFields: ["confirmed"],
      correlatedToTurn: true,
    },
  );
  assert.deepEqual(snapshot?.validationIssues, []);
});

test("MCP elicitation snapshot is not a public action projection surface", () => {
  assert.equal("extractMcpElicitationSnapshot" in publicProjection, false);
  assert.equal(
    "buildCodexMcpElicitationRequiredEvent" in publicProjection,
    false,
  );
  assert.equal(
    "buildCodexMcpElicitationResolvedEvent" in publicProjection,
    false,
  );
});

test("request id is accepted only from the outer App Server request envelope", () => {
  const snapshot = extractMcpElicitationSnapshot({
    params: {
      ...standardFormParams(),
      requestId: "forged-request-id",
      request_id: "forged-snake-case-request-id",
      id: "forged-generic-id",
    },
  });

  assert.equal(snapshot, undefined);
});

test("request without canonical thread scope fails closed", () => {
  const snapshot = extractMcpElicitationSnapshot({
    requestId: "request-unscoped",
    params: {
      ...standardFormParams(),
      threadId: undefined,
    },
  });

  assert.deepEqual(
    snapshot?.validationIssues.map((item) => item.code),
    ["missing_thread_scope"],
  );
});

test("request allows nullable turn correlation", () => {
  const snapshot = extractMcpElicitationSnapshot({
    requestId: "request-no-turn",
    params: {
      ...standardFormParams(),
      turnId: null,
    },
  });

  assert.equal(snapshot?.request.turnId, undefined);
  assert.deepEqual(snapshot?.validationIssues, []);
});

test("standard form accepted response records structured content and metadata keys", () => {
  const snapshot = extractMcpElicitationSnapshot({
    requestId: "request-standard-form",
    params: standardFormParams(),
    response: {
      action: "accept",
      content: {
        confirmed: true,
      },
      _meta: {
        source: "gui",
      },
    },
  });

  assert.deepEqual(
    {
      action: snapshot?.response?.action,
      accepted: snapshot?.response?.accepted,
      contentKeys: snapshot?.response?.contentKeys,
      metaKeys: snapshot?.response?.metaKeys,
      validationIssues: snapshot?.validationIssues,
    },
    {
      action: "accept",
      accepted: true,
      contentKeys: ["confirmed"],
      metaKeys: ["source"],
      validationIssues: [],
    },
  );
});

test("accepted MCP elicitation response without structured content fails closed", () => {
  const snapshot = extractMcpElicitationSnapshot({
    requestId: "request-empty-accept",
    params: standardFormParams(),
    response: {
      action: "accept",
      content: null,
      _meta: null,
    },
  });

  assert.deepEqual(
    snapshot?.validationIssues.map((item) => item.code),
    ["missing_accept_content"],
  );
});
