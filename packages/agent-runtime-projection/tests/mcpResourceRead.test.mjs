import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMcpResourceReadProjectionEvent,
  extractMcpResourceReadSnapshot,
  getMcpResourceToolContract,
  isMcpResourceToolName,
  isLegacyMcpResourceToolName,
  listMcpResourceToolContracts,
  validateMcpResourceToolSchema,
} from "../dist/index.js";

test("Current MCP resource contracts expose current tool names only", () => {
  assert.deepEqual(
    listMcpResourceToolContracts().map((contract) => contract.name),
    ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"],
  );

  assert.equal(isMcpResourceToolName("read_mcp_resource"), true);
  assert.equal(isMcpResourceToolName("ReadMcpResourceTool"), false);
  assert.equal(isLegacyMcpResourceToolName("ReadMcpResourceTool"), true);
  assert.equal(isLegacyMcpResourceToolName("ListMcpResourcesTool"), true);
});

test("read_mcp_resource requires server and uri and rejects legacy input fields", () => {
  const contract = getMcpResourceToolContract("read_mcp_resource");
  assert.deepEqual(contract?.requiredInputFields, ["server", "uri"]);
  assert.deepEqual(contract?.outputRequiredFields, ["contents"]);

  assert.deepEqual(
    validateMcpResourceToolSchema({
      toolName: "read_mcp_resource",
      input: {
        server: "docs",
        uri: "file:///workspace/README.md",
      },
    }),
    [],
  );

  assert.deepEqual(
    validateMcpResourceToolSchema({
      toolName: "read_mcp_resource",
      input: {
        server_name: "docs",
        resource_name: "README",
        output: "legacy output text",
      },
    }).map((item) => [item.code, item.path]),
    [
      ["missing_required_field", "$.input.server"],
      ["missing_required_field", "$.input.uri"],
      ["forbidden_field", "$.input.server_name"],
      ["forbidden_field", "$.input.resource_name"],
      ["forbidden_field", "$.input.output"],
    ],
  );
});

test("legacy Lime/Agent MCP resource names fail closed before projection", () => {
  assert.deepEqual(
    validateMcpResourceToolSchema({
      toolName: "ReadMcpResourceTool",
      input: { server: "docs", uri: "file:///workspace/README.md" },
    }).map((item) => item.code),
    ["legacy_tool_name"],
  );
  assert.equal(
    buildMcpResourceReadProjectionEvent({
      toolName: "ReadMcpResourceTool",
      input: { server: "docs", uri: "file:///workspace/README.md" },
      result: { contents: [] },
    }),
    undefined,
  );
});

test("resource read snapshot preserves server uri mime content truncation and thread scope", () => {
  const longText = `${"Resource line ".repeat(32)}tail`;
  const snapshot = extractMcpResourceReadSnapshot(
    {
      toolName: "read_mcp_resource",
      toolCallId: "tool-resource-1",
      input: {
        server: "docs",
        uri: "file:///workspace/README.md",
        thread_id: "thread-resource",
      },
      result: {
        contents: [
          {
            uri: "file:///workspace/README.md",
            mime_type: "text/markdown",
            text: longText,
          },
          {
            uri: "file:///workspace/logo.png",
            mimeType: "image/png",
            blob: "aGVsbG8=".repeat(80),
          },
        ],
      },
      metadata: {
        evidenceRefs: ["evidence-resource"],
      },
      artifactRefs: ["artifact-resource"],
    },
    {
      sessionId: "session-resource",
      threadId: "thread-context",
      turnId: "turn-resource",
    },
  );

  assert.equal(snapshot?.server, "docs");
  assert.equal(snapshot?.uri, "file:///workspace/README.md");
  assert.equal(snapshot?.threadId, "thread-resource");
  assert.equal(snapshot?.contextThreadId, "thread-context");
  assert.equal(snapshot?.scopedToThread, true);
  assert.equal(snapshot?.contents.length, 2);
  assert.equal(snapshot?.contents[0].mimeType, "text/markdown");
  assert.equal(snapshot?.contents[0].contentKind, "text");
  assert.equal(snapshot?.contents[0].truncated, true);
  assert.equal(snapshot?.contents[0].preview?.endsWith("..."), true);
  assert.equal(snapshot?.contents[1].contentKind, "blob");
  assert.deepEqual(snapshot?.artifactRefs, ["artifact-resource"]);
  assert.deepEqual(snapshot?.evidenceRefs, ["evidence-resource"]);
});

test("projection event binds resource read to timeline evidence instead of ordinary tool text", () => {
  const event = buildMcpResourceReadProjectionEvent(
    {
      toolName: "read_mcp_resource",
      toolCallId: "tool-resource-1",
      evidenceId: "evidence-resource",
      input: {
        server: "docs",
        uri: "file:///workspace/README.md",
      },
      result: {
        contents: [
          {
            uri: "file:///workspace/README.md",
            mime_type: "text/markdown",
            text: "# README\nCurrent resource content",
          },
        ],
      },
      evidenceRefs: ["evidence-resource"],
    },
    {
      sequence: 42,
      sessionId: "session-resource",
      threadId: "thread-resource",
      turnId: "turn-resource",
      timestamp: "2026-07-09T00:00:00.000Z",
    },
  );

  assert.deepEqual(
    {
      type: event?.type,
      sourceType: event?.sourceType,
      sequence: event?.sequence,
      sessionId: event?.sessionId,
      threadId: event?.threadId,
      turnId: event?.turnId,
      toolCallId: event?.toolCallId,
      evidenceId: event?.evidenceId,
      owner: event?.owner,
      scope: event?.scope,
      surface: event?.surface,
      persistence: event?.persistence,
      control: event?.control,
      runtimeStatus: event?.runtimeStatus,
    },
    {
      type: "evidence.changed",
      sourceType: "mcp_resource_read_projection",
      sequence: 42,
      sessionId: "session-resource",
      threadId: "thread-resource",
      turnId: "turn-resource",
      toolCallId: "tool-resource-1",
      evidenceId: "evidence-resource",
      owner: "evidence",
      scope: "tool_call",
      surface: "timeline_evidence",
      persistence: "evidence_pack",
      control: "open_detail",
      runtimeStatus: "completed",
    },
  );
  assert.equal(event?.payload?.toolName, "read_mcp_resource");
  assert.equal(event?.payload?.server, "docs");
  assert.equal(event?.payload?.uri, "file:///workspace/README.md");
  assert.equal(event?.payload?.contentCount, 1);
  assert.equal(
    event?.payload?.mcpResourceRead.contents[0].mimeType,
    "text/markdown",
  );
  assert.deepEqual(event?.payload?.validationIssues, []);
});

test("string-only tool output cannot masquerade as MCP resource contents", () => {
  const event = buildMcpResourceReadProjectionEvent({
    toolName: "read_mcp_resource",
    toolCallId: "tool-resource-plain-output",
    input: {
      server: "docs",
      uri: "file:///workspace/README.md",
    },
    result: {
      output: "# README\nordinary tool text",
    },
  });

  assert.equal(event?.phase, "failed");
  assert.equal(event?.runtimeStatus, "failed");
  assert.equal(event?.payload?.contentPreview, undefined);
  assert.equal(event?.payload?.mcpResourceRead.contents.length, 0);
  assert.deepEqual(
    event?.payload?.validationIssues.map((item) => item.code),
    ["missing_resource_content"],
  );
});
