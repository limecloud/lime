#!/usr/bin/env node

// Test-only MCP peer and localhost provider; policy, tools and storage are production.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import { writeMcpFixture } from "../mcp/lib/current-smoke-fixture.mjs";
import {
  provisionToolExecutionFixtureProvider,
  buildToolExecutionThreadStartParams,
} from "../agent-runtime/tool-execution-current-contract.mjs";
import { terminalGateRuntimeEnvironment } from "./terminal-gate-binaries.mjs";

assert.ok(process.env.APP_SERVER_BIN, "supply a fixed App Server artifact");
const binary = path.resolve(process.env.APP_SERVER_BIN);
const binarySha256 = createHash("sha256")
  .update(fs.readFileSync(binary))
  .digest("hex");
const temp = await mkdtemp(path.join(tmpdir(), "memory-source-policy-"));
const data = path.join(temp, "data"),
  app = path.join(temp, "app"),
  workspace = path.join(temp, "workspace"),
  instructions = path.join(temp, "instructions");
await Promise.all(
  [data, app, workspace, instructions].map((value) => mkdir(value)),
);
const peer = await writeMcpFixture();
const peerName = "memory_source";
const { connectAppServerSidecar, stdioSidecar } = await import(
  pathToFileURL(path.resolve("packages/app-server-client/dist/index.js")).href
);
let connected;
let normalSamples = 0,
  extractionSamples = 0;
let consolidationSamples = 0;
let consolidationStep = 0;
const summary =
  "v1\n\n## User Profile\n\n## User preferences\n\n## General Tips\n\n## What's in Memory\n\n";
let sourceThreadId;
const fixture = await startOpenAiCompatibleFixtureServer({
  scriptedResponses: [
    async ({ body }) => {
      const text = JSON.stringify(body);
      if (text.includes("Read this immutable rollout record")) {
        extractionSamples++;
        assert.ok(
          text.includes(sourceThreadId),
          "extraction retains the actual source thread",
        );
        return {
          type: "text",
          content: JSON.stringify({ rollout_summary: "", rollout_slug: "" }),
        };
      }
      if (text.includes("Consolidate the supplied rollout summaries")) {
        consolidationSamples++;
        if (consolidationStep++ % 2 === 0) {
          return {
            type: "tool_call",
            id: `summary-${consolidationSamples}`,
            name: "apply_patch",
            arguments: {
              patch: `*** Begin Patch\n*** Add File: memory_summary.md\n${summary
                .trimEnd()
                .split("\n")
                .map((line) => `+${line}`)
                .join("\n")}\n*** End Patch`,
            },
          };
        }
        return { type: "text", content: "No memory update needed." };
      }
      normalSamples++;
      return normalSamples === 1
        ? {
            type: "tool_call",
            id: "source-echo",
            name: `mcp__${peerName}__echo`,
            arguments: { message: "fixture source" },
          }
        : { type: "text", content: "Source tool completed." };
    },
  ],
});
async function connect() {
  connected = await connectAppServerSidecar(
    { ...stdioSidecar(binary, undefined, data), backendMode: "runtime" },
    {
      clientInfo: { name: "memory-source-policy-fixture", version: "1" },
      capabilities: { experimentalApi: true },
    },
    {
      args: [
        "--listen",
        "stdio://",
        "--backend",
        "runtime",
        "--data-dir",
        data,
        "--app-data-dir",
        app,
      ],
      env: {
        ...terminalGateRuntimeEnvironment({ appServerBinaryPath: binary }),
        LIME_HOME: instructions,
      },
      initializeTimeoutMs: 60000,
    },
  );
}
async function call(method, params = {}) {
  return (
    await connected.connection.request(
      connected.client.request(method, params),
      method,
      { timeoutMs: 60000 },
    )
  ).result;
}
async function configure(keyPath, value) {
  return call("config/batchWrite", {
    edits: [{ keyPath, value, mergeStrategy: "replace" }],
  });
}
async function waitFor(label, read) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error(`timed out: ${label}`);
}
function state() {
  const file = path.join(data, "memory_state.sqlite");
  if (!fs.existsSync(file)) return {};
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return {
      phase2: db
        .prepare(
          "SELECT status, last_error, last_success_at FROM memory_phase2_jobs",
        )
        .all(),
      sources: db
        .prepare(
          "SELECT source_thread_id, status, last_error FROM memory_rollout_jobs",
        )
        .all(),
    };
  } finally {
    db.close();
  }
}
try {
  await connect();
  const provider = await provisionToolExecutionFixtureProvider({
    fixture,
    invoke: (_, method, params) => call(method, params),
  });
  await call("modelProvider/update", {
    providerId: provider.providerPreference,
    providerType: "openai-response",
  });
  await configure("memory", {
    enabled: true,
    auto: { enabled: false },
    disable_on_external_context: true,
  });
  await call("mcpServer/create", {
    server: {
      id: peerName,
      name: peerName,
      description: "Test-only memory source",
      server_config: {
        command: process.execPath,
        args: [peer.serverPath],
        cwd: temp,
        timeout: 10,
        tool_timeout: 30,
      },
      enabled_lime: true,
      created_at: 1,
    },
  });
  await connected.sidecar.close();
  await connect();
  const start = (title) =>
    call(
      "thread/start",
      buildToolExecutionThreadStartParams({
        provider,
        title,
        workspaceRoot: workspace,
      }),
    );
  sourceThreadId = (await start("External source")).thread.id;
  const turn = (
    await call("turn/start", {
      threadId: sourceThreadId,
      input: [{ type: "text", text: "Call the echo tool." }],
      approvalPolicy: "never",
      sandboxPolicy: "danger-full-access",
    })
  ).turn;
  let source;
  await waitFor("MCP source turn completion", async () => {
    source = (
      await call("thread/read", {
        threadId: sourceThreadId,
        includeTurns: true,
      })
    ).thread.turns.find((value) => value.id === turn.id);
    if (!source || source.status === "inProgress") return false;
    assert.equal(source.status, "completed");
    return true;
  });
  assert.ok(
    source.items.some(
      (item) =>
        item.type === "mcpToolCall" &&
        item.server === peerName &&
        item.status === "completed",
    ),
    "canonical source contains the real completed MCP item",
  );
  assert.equal(normalSamples, 2);
  await call("memoryStore/addNote", {
    scope: "global",
    slug: "external-source",
    content: `threadId: ${sourceThreadId}\nFixture preference from the MCP conversation.`,
  });
  await configure("memory.auto.enabled", true);
  await start("Excluded extraction worker");
  await waitFor("excluded startup extraction and phase-2 completion", () =>
    state().phase2?.some((job) => job.status === "succeeded"),
  );
  assert.equal(
    extractionSamples,
    0,
    "excluded source must not reach the extraction provider",
  );
  assert.ok(
    state().sources.some(
      (row) =>
        row.source_thread_id === sourceThreadId && row.status === "pending",
    ),
    "excluded source remains unclaimed",
  );
  await configure("memory.disable_on_external_context", false);
  await start("Allowed extraction worker");
  await waitFor("allowed source extraction commit", () =>
    state().sources?.some(
      (row) =>
        row.source_thread_id === sourceThreadId &&
        row.status === "review" &&
        row.last_error === "no_output",
    ),
  );
  assert.equal(extractionSamples, 1);
  await waitFor("allowed startup phase-2 completion", () =>
    state().phase2?.some((job) => job.status === "succeeded"),
  );
  console.log(
    JSON.stringify({
      ok: true,
      binarySha256,
      transport: "stdio",
      backend: "runtime",
      liveProviderUsed: false,
      sourceThreadId,
      sourceTurnId: turn.id,
      canonicalMcpItem: true,
      excludedBeforeClaim: true,
      excludedProviderSamples: 0,
      allowedProviderSamples: extractionSamples,
      normalSamples,
      consolidationSamples,
      noPromptStored: true,
      noProviderRequestStored: true,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      failed: true,
      binarySha256,
      normalSamples,
      extractionSamples,
      storage: state(),
      providerErrors: fixture.requests
        .map((request) => request.responseError)
        .filter(Boolean),
      stderr: connected?.sidecar.stderrLines,
    }),
  );
  throw error;
} finally {
  await connected?.sidecar.close();
  await fixture.close();
  await rm(peer.root, { recursive: true, force: true });
  await rm(temp, { recursive: true, force: true });
}
