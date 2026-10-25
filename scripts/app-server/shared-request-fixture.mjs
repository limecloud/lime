#!/usr/bin/env node

// Test-only runtime evidence for shared reverse requests and reconnect replay.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import {
  buildToolExecutionThreadStartParams,
  buildToolExecutionTurnStartParams,
  provisionToolExecutionFixtureProvider,
} from "../agent-runtime/tool-execution-current-contract.mjs";
import {
  buildTerminalGateBinaries,
  snapshotTerminalGateBinaries,
  terminalGateRuntimeEnvironment,
} from "./terminal-gate-binaries.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const env = { ...process.env, CARGO_BUILD_JOBS: "1" };
await buildTerminalGateBinaries({ env, repoRoot });
const temp = await mkdtemp(path.join(tmpdir(), "shared-request-fixture-"));
const clients = [];
const peerName = "SharedConsentFixture";
const method = "mcpServer/elicitation/request";
const resolvedMethod = "serverRequest/resolved";
let server, fixture;
let stderr = "";

async function until(predicate, description, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    assert.equal(
      server?.exitCode ?? null,
      null,
      `App Server exited: ${stderr}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${description} timeout: ${stderr}`);
}

async function call(client, name, params) {
  return (
    await client.connection.request(client.client.request(name, params), name, {
      timeoutMs: 30_000,
    })
  ).result;
}

function requests(client, turnId) {
  return client.transcript.filter(
    (message) => message.method === method && message.params.turnId === turnId,
  );
}

function resolutions(client, requestId) {
  return client.transcript.filter(
    (message) =>
      message.method === resolvedMethod &&
      message.params.requestId === requestId,
  );
}

async function completed(client, turnId) {
  await until(
    () =>
      client.transcript.some(
        (message) =>
          message.method === "turn/completed" &&
          message.params.turn.id === turnId,
      ),
    `turn ${turnId} completion`,
  );
}

async function ledger() {
  return (await readFile(path.join(temp, "mcp.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

try {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const { appServerBinaryPath } = await snapshotTerminalGateBinaries({
    env,
    cliBinaryPath: path.resolve(
      env.LIME_CLI_BIN ||
        path.join(repoRoot, "lime-rs/target/debug", `lime${suffix}`),
    ),
    appServerBinaryPath: path.resolve(
      env.APP_SERVER_BIN ||
        path.join(repoRoot, "lime-rs/target/debug", `app-server${suffix}`),
    ),
    directory: path.join(temp, "binaries"),
  });
  fixture = await startOpenAiCompatibleFixtureServer({
    scriptedResponses: [0, 1, 2].flatMap((index) => [
      {
        type: "tool_call",
        id: `shared-form-${index}`,
        name: `mcp__${peerName}__form`,
        arguments: {},
      },
      { type: "text", content: `SHARED_FORM_COMPLETED_${index}` },
    ]),
  });
  const reserve = createServer();
  reserve.listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const websocketUrl = `ws://127.0.0.1:${port}`;
  server = spawn(
    appServerBinaryPath,
    [
      "--listen",
      websocketUrl,
      "--backend",
      "runtime",
      "--data-dir",
      path.join(temp, "data"),
      "--app-data-dir",
      path.join(temp, "app"),
    ],
    {
      stdio: ["ignore", "ignore", "pipe"],
      env: terminalGateRuntimeEnvironment({ env, appServerBinaryPath }),
    },
  );
  await once(server, "spawn");
  server.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-12_000);
  });
  await until(async () => {
    try {
      return (
        await fetch(`http://127.0.0.1:${port}/readyz`, {
          signal: AbortSignal.timeout(1_000),
        })
      ).ok;
    } catch {
      return false;
    }
  }, "App Server readiness");

  const { connectRemoteAppServer } = await import(
    pathToFileURL(
      path.join(repoRoot, "packages/app-server-client/dist/index.js"),
    ).href
  );
  async function connect(name) {
    const connected = await connectRemoteAppServer(
      { websocketUrl },
      { clientInfo: { name, version: "1" } },
    );
    connected.transcript = [];
    connected.connection.setNotificationObserver((message) =>
      connected.transcript.push(message),
    );
    connected.connection.setServerRequestHandler((message) => {
      connected.transcript.push(message);
      return true;
    });
    clients.push(connected);
    return connected;
  }

  const a = await connect("shared-request-a");
  const b = await connect("shared-request-b");
  const unrelated = await connect("shared-request-unrelated");
  const provider = await provisionToolExecutionFixtureProvider({
    fixture,
    invoke: (_options, name, params) => call(a, name, params),
  });
  await call(a, "mcpServer/create", {
    server: {
      id: peerName,
      name: peerName,
      description: "Test-only shared form",
      server_config: {
        command: process.execPath,
        args: [
          path.join(repoRoot, "scripts/app-server/mcp-elicitation-fixture.mjs"),
          path.join(temp, "mcp.jsonl"),
        ],
        cwd: temp,
        timeout: 10,
        tool_timeout: 90,
      },
      enabled_lime: true,
      created_at: 1,
    },
  });
  const started = await call(
    a,
    "thread/start",
    buildToolExecutionThreadStartParams({
      provider,
      workspaceRoot: temp,
      title: "Shared request fixture",
    }),
  );
  const threadId = started.thread.id;
  await call(b, "thread/resume", { threadId, excludeTurns: true });
  async function startTurn(client, message) {
    const result = await call(
      client,
      "turn/start",
      buildToolExecutionTurnStartParams({
        threadId,
        workspaceRoot: temp,
        model: provider.modelPreference,
        message,
      }),
    );
    return result.turn.id;
  }

  const firstTurn = await startTurn(
    a,
    "Run the form tool and report the outcome.",
  );
  await until(
    () =>
      (requests(a, firstTurn).length === 1 &&
        requests(b, firstTurn).length === 1) ||
      a.transcript.some(
        (message) =>
          message.method === "turn/completed" &&
          message.params.turn.id === firstTurn,
      ),
    "shared first delivery",
  );
  assert.equal(
    requests(a, firstTurn).length,
    1,
    JSON.stringify({
      failure: "Turn must wait for a real client response to the shared form",
      requestCounts: [
        requests(a, firstTurn).length,
        requests(b, firstTurn).length,
      ],
      mcpResults: (await ledger())
        .filter((entry) => entry.kind === "elicitationResult")
        .map((entry) => entry.result),
    }),
  );
  assert.equal(requests(b, firstTurn).length, 1);
  const first = requests(a, firstTurn)[0];
  assert.deepEqual(first, requests(b, firstTurn)[0]);
  assert.equal(requests(unrelated, firstTurn).length, 0);
  // Deliberately bypass the client ownership guard to test the server boundary.
  unrelated.transport.send({
    jsonrpc: "2.0",
    id: first.id,
    result: { action: "decline" },
  });
  await call(unrelated, "thread/read", { threadId, includeTurns: true });
  assert.equal(resolutions(a, first.id).length, 0);
  b.connection.respondServerRequest(first.id, { action: "cancel" });
  await completed(b, firstTurn);
  await until(
    () =>
      resolutions(a, first.id).length === 1 &&
      resolutions(b, first.id).length === 1,
    "shared form resolution",
  );
  a.transport.send({
    jsonrpc: "2.0",
    id: first.id,
    result: { action: "decline" },
  });
  await call(a, "thread/read", { threadId, includeTurns: true });
  assert.equal(
    (await ledger()).filter((entry) => entry.kind === "elicitationResult")
      .length,
    1,
  );

  const secondTurn = await startTurn(a, "Run the form tool again.");
  await until(
    () =>
      requests(a, secondTurn).length === 1 &&
      requests(b, secondTurn).length === 1,
    "second shared form",
  );
  const second = requests(a, secondTurn)[0];
  await Promise.all([a.transport.close(), b.transport.close()]);
  const reconnected = await connect("shared-request-reconnected");
  await call(reconnected, "thread/resume", { threadId, excludeTurns: true });
  await until(
    () => requests(reconnected, secondTurn).length === 1,
    "resume request replay",
  );
  assert.deepEqual(requests(reconnected, secondTurn)[0], second);
  reconnected.connection.respondServerRequest(second.id, { action: "cancel" });
  await completed(reconnected, secondTurn);
  assert.equal(resolutions(reconnected, second.id).length, 1);
  const replies = (await ledger()).filter(
    (entry) => entry.kind === "elicitationResult",
  );
  assert.equal(replies.length, 2);
  for (const reply of replies) {
    assert.deepEqual(reply.result, { action: "cancel" });
    assert.equal(reply.error, undefined);
  }

  const observer = await connect("shared-request-interrupt-observer");
  await call(observer, "thread/resume", { threadId, excludeTurns: true });
  const thirdTurn = await startTurn(
    reconnected,
    "Run the form and wait for input.",
  );
  await until(
    () =>
      requests(reconnected, thirdTurn).length === 1 &&
      requests(observer, thirdTurn).length === 1,
    "interrupt form",
  );
  const third = requests(reconnected, thirdTurn)[0];
  await call(reconnected, "turn/interrupt", { threadId, turnId: thirdTurn });
  await completed(observer, thirdTurn);
  for (const client of [reconnected, observer]) {
    assert.equal(resolutions(client, third.id).length, 1);
    const resolvedIndex = client.transcript.findIndex(
      (message) =>
        message.method === resolvedMethod &&
        message.params.requestId === third.id,
    );
    const terminalIndex = client.transcript.findIndex(
      (message) =>
        message.method === "turn/completed" &&
        message.params.turn.id === thirdTurn,
    );
    assert.ok(
      resolvedIndex >= 0 && resolvedIndex < terminalIndex,
      "resolved precedes turn terminal",
    );
  }
  const cold = await call(unrelated, "thread/read", {
    threadId,
    includeTurns: true,
  });
  assert.deepEqual(
    cold.thread.turns.map((turn) => turn.status),
    ["completed", "completed", "interrupted"],
  );
  assert.equal(
    unrelated.transcript.filter(
      (message) =>
        message.method === method || message.method === resolvedMethod,
    ).length,
    0,
  );
  const entries = await ledger();
  assert.equal(entries.filter((entry) => entry.kind === "toolCall").length, 3);
  assert.ok(
    entries.filter((entry) => entry.kind === "elicitationResult").length <= 3,
  );
  console.log(
    JSON.stringify(
      {
        backend: "runtime",
        provider: "loopback-fixture",
        transport: "real-websocket-app-server-stdio-mcp",
        appServerSha256: createHash("sha256")
          .update(await readFile(appServerBinaryPath))
          .digest("hex"),
        threadId,
        turnIds: [firstTurn, secondTurn, thirdTurn],
        sharedFirstDelivery: true,
        unrelatedResponseRejected: true,
        lateResponseIgnored: true,
        oneMcpSettlementPerCompletedTurn: true,
        zeroOwnerResumeReplay: true,
        resolvedBeforeInterruptedTurn: true,
        surfaceEvidence: "App Server clients; no Electron or PTY interaction",
      },
      null,
      2,
    ),
  );
} finally {
  await Promise.allSettled(clients.map((client) => client.transport.close()));
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, "close");
    const timer = setTimeout(() => server.kill("SIGKILL"), 5_000);
    server.kill("SIGTERM");
    try {
      await stopped;
    } finally {
      clearTimeout(timer);
    }
  }
  await fixture?.close();
  await rm(temp, { recursive: true, force: true });
}
