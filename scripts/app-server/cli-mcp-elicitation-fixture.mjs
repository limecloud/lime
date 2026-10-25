#!/usr/bin/env node

// Test-only runtime evidence: CLI consent response reaches the real MCP peer.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import {
  buildTerminalGateBinaries,
  snapshotTerminalGateBinaries,
  terminalGateRuntimeEnvironment,
} from "./terminal-gate-binaries.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const suffix = process.platform === "win32" ? ".exe" : "";
const env = { ...process.env, CARGO_BUILD_JOBS: "1" };
await buildTerminalGateBinaries({ env, repoRoot });
const temp = await mkdtemp(path.join(tmpdir(), "cli-mcp-elicitation-"));
const finalText = "CLI_MCP_CANCELED_AND_CONTINUED";
const peerName = "CliConsentFixture";
let connected, provider, child;

async function stopChild() {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const closed = once(child, "close");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  child.kill("SIGTERM");
  try {
    await closed;
  } finally {
    clearTimeout(timer);
  }
}

try {
  const { cliBinaryPath, appServerBinaryPath } =
    await snapshotTerminalGateBinaries({
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
  const runtimeEnv = terminalGateRuntimeEnvironment({
    env,
    appServerBinaryPath,
  });
  provider = await startOpenAiCompatibleFixtureServer({
    scriptedResponses: [
      {
        type: "tool_call",
        id: "cli-mcp-call",
        name: `mcp__${peerName}__form`,
        arguments: {},
      },
      { type: "text", content: finalText },
    ],
  });
  const serverArgs = [
    "--backend",
    "runtime",
    "--data-dir",
    path.join(temp, "data"),
    "--app-data-dir",
    path.join(temp, "app"),
  ];
  const ledgerPath = path.join(temp, "mcp.jsonl");
  const { connectAppServerSidecar, stdioSidecar, PROTOCOL_VERSION } =
    await import(
      pathToFileURL(
        path.join(repoRoot, "packages/app-server-client/dist/index.js"),
      ).href
    );
  const connect = () =>
    connectAppServerSidecar(
      stdioSidecar(appServerBinaryPath),
      { clientInfo: { name: "cli_mcp_fixture_setup", version: "1" } },
      {
        args: ["--stdio", ...serverArgs],
        env: runtimeEnv,
        expectedProtocolVersion: PROTOCOL_VERSION,
        initializeTimeoutMs: 30_000,
      },
    );
  connected = await connect();
  const call = async (method, params) => {
    const response = await connected.connection.request(
      connected.client.request(method, params),
    );
    return response.result;
  };
  const fixture = provider.provider;
  const created = await call("modelProvider/create", {
    name: "CLI consent fixture",
    providerType: fixture.providerName,
    apiHost: fixture.providerConfig.baseUrl,
  });
  const providerId = created.provider.id;
  await call("modelProvider/update", {
    providerId,
    enabled: true,
    models: [
      {
        id: fixture.modelPreference,
        capability: fixture.providerConfig.modelCapabilities,
      },
    ],
  });
  await call("modelProviderKey/create", {
    providerId,
    apiKey: fixture.providerConfig.apiKey,
    alias: "fixture",
    replaceExisting: true,
  });
  await call("mcpServer/create", {
    server: {
      id: peerName,
      name: peerName,
      description: "Test-only non-interactive consent",
      server_config: {
        command: process.execPath,
        args: [
          path.join(repoRoot, "scripts/app-server/mcp-elicitation-fixture.mjs"),
          ledgerPath,
        ],
        cwd: temp,
        timeout: 10,
        tool_timeout: 30,
      },
      enabled_lime: true,
      created_at: 1,
    },
  });
  await connected.sidecar.close();
  connected = undefined;

  // The existing executable relay wrapper is a Unix Gate B dependency.
  // Windows still runs the real CLI/peer assertions; its wire transcript needs a native launcher.
  const wireLedgerPath = path.join(temp, "wire.jsonl");
  const wireTranscriptSupported = process.platform !== "win32";
  let cliServerPath = appServerBinaryPath;
  if (wireTranscriptSupported) {
    cliServerPath = path.join(temp, "app-server-relay.mjs");
    await writeFile(
      cliServerPath,
      `#!${process.execPath}\nimport ${JSON.stringify(pathToFileURL(path.join(repoRoot, "scripts/app-server/mcp-elicitation-stdio-relay.mjs")).href)};\n`,
      { mode: 0o700 },
    );
  }
  child = spawn(
    cliBinaryPath,
    [
      "exec",
      "Run the form tool, then report its cancellation.",
      "--json",
      "--app-server",
      cliServerPath,
      ...serverArgs.map((arg) => `--app-server-arg=${arg}`),
      "--cd",
      temp,
      "--model",
      fixture.modelPreference,
      "--provider",
      providerId,
      "--dangerously-bypass-approvals-and-sandbox",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...runtimeEnv,
        LIME_TEST_APP_SERVER_BIN: appServerBinaryPath,
        LIME_TEST_MCP_RELAY_MODE: "passive",
        LIME_TEST_MCP_RELAY_LEDGER: wireLedgerPath,
      },
    },
  );
  await once(child, "spawn");
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
  let code, signal;
  try {
    [code, signal] = await once(child, "close");
  } finally {
    clearTimeout(timer);
  }
  assert.equal(
    code,
    0,
    `exec exit=${code} signal=${signal}: ${stderr}\n${stdout}`,
  );
  const events = stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  const threadId = events[0].thread_id;
  assert.equal(events[0].type, "thread.started");
  assert.equal(events.at(-1).type, "turn.completed");
  assert.ok(
    events.some(
      (event) =>
        event.item?.type === "agent_message" && event.item.text === finalText,
    ),
  );
  if (wireTranscriptSupported) {
    const wire = (await readFile(wireLedgerPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(
      wire.filter((entry) => entry.direction === "driver").length,
      0,
    );
    const requests = wire.filter(
      (entry) =>
        entry.direction === "server" &&
        entry.message.method === "mcpServer/elicitation/request",
    );
    assert.equal(
      requests.length,
      1,
      "the CLI receives an actual reverse request",
    );
    const request = requests[0].message;
    assert.equal(request.params.threadId, threadId);
    const responses = wire.filter(
      (entry) =>
        entry.direction === "client" && entry.message.id === request.id,
    );
    assert.equal(
      responses.length,
      1,
      "one response with the exact server request ID",
    );
    assert.deepEqual(responses[0].message.result, { action: "cancel" });
    assert.equal(responses[0].message.error, undefined);
    const resolved = wire.filter(
      (entry) =>
        entry.direction === "server" &&
        entry.message.method === "serverRequest/resolved" &&
        entry.message.params.requestId === request.id,
    );
    assert.equal(resolved.length, 1);
  }
  const ledger = (await readFile(ledgerPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const replies = ledger.filter((entry) => entry.kind === "elicitationResult");
  assert.equal(
    replies.length,
    1,
    "one elicitation settlement reaches the MCP peer",
  );
  assert.deepEqual(replies[0].result, { action: "cancel" });
  assert.equal(replies[0].error, undefined);
  assert.equal(ledger.filter((entry) => entry.kind === "toolCall").length, 1);
  connected = await connect();
  const read = await call("thread/read", { threadId, includeTurns: true });
  assert.equal(read.thread.id, threadId);
  assert.equal(read.thread.turns.length, 1);
  assert.equal(read.thread.turns[0].status, "completed");
  const sha256 = async (file) =>
    createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  console.log(
    JSON.stringify(
      {
        backend: "runtime",
        provider: "loopback-fixture",
        transport: "real-cli-stdio-app-server-mcp",
        threadId,
        turnId: read.thread.turns[0].id,
        appServerSha256: await sha256(appServerBinaryPath),
        cliSha256: await sha256(cliBinaryPath),
        mcpCancelExactlyOnce: true,
        wireTypedCancelVerified: wireTranscriptSupported,
        continuedToCanonicalCompletedTurn: true,
        attachedSubagentEvidence: false,
      },
      null,
      2,
    ),
  );
} finally {
  await stopChild();
  await connected?.sidecar.close();
  await provider?.close();
  await rm(temp, { recursive: true, force: true });
}
