#!/usr/bin/env node

// Test-only: real stdio, provider steps, plugin cache, trust and command processes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import {
  buildToolExecutionThreadStartParams,
  provisionToolExecutionFixtureProvider,
} from "../agent-runtime/tool-execution-current-contract.mjs";
import { terminalGateRuntimeEnvironment } from "./terminal-gate-binaries.mjs";

assert.notEqual(
  process.platform,
  "win32",
  "POSIX command fixture; Windows needs its own run",
);
assert.ok(process.env.APP_SERVER_BIN, "supply a fixed App Server artifact");
const binary = path.resolve(process.env.APP_SERVER_BIN);
const binarySha256 = createHash("sha256")
  .update(await readFile(binary))
  .digest("hex");
const { connectAppServerSidecar, stdioSidecar } = await import(
  pathToFileURL(path.resolve("packages/app-server-client/dist/index.js")).href
);
const temp = await mkdtemp(path.join(tmpdir(), "plugin-hooks-"));
const codexHome = path.join(temp, "lime");
const market = path.join(temp, "market/.agents/plugins/marketplace.json");
const plugin = path.join(temp, "market/demo");
const journal = path.join(temp, "hooks.jsonl");
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const transcript = [];
const turns = [];
let connected;
let active;
let succeeded = false;

async function call(method, params) {
  return (
    await connected.connection.request(
      connected.client.request(method, params),
      method,
      { timeoutMs: 30_000 },
    )
  ).result;
}

async function start() {
  connected = await connectAppServerSidecar(
    {
      ...stdioSidecar(binary, undefined, path.join(temp, "data")),
      backendMode: "runtime",
    },
    {
      clientInfo: { name: "plugin-hooks-fixture", version: "1" },
      capabilities: { experimentalApi: true },
    },
    {
      args: [
        "--listen",
        "stdio://",
        "--backend",
        "runtime",
        "--data-dir",
        path.join(temp, "data"),
        "--app-data-dir",
        path.join(temp, "app"),
      ],
      env: {
        ...terminalGateRuntimeEnvironment({ appServerBinaryPath: binary }),
        LIME_HOME: codexHome,
      },
      initializeTimeoutMs: 30_000,
    },
  );
  connected.connection.setNotificationObserver((message) =>
    transcript.push(message),
  );
  connected.connection.setServerRequestHandler((message) => {
    connected.connection.respondServerRequest(message.id, {
      decision: "cancel",
    });
    throw new Error(`Unexpected approval/server request: ${message.method}`);
  });
}

async function pluginHooks() {
  const list = await call("hooks/list", { cwds: [temp] });
  assert.deepEqual(list.data[0].errors, []);
  assert.deepEqual(list.data[0].warnings, []);
  return list.data[0].hooks.filter((hook) => hook.pluginId === "demo@team");
}

async function trust() {
  const hooks = await pluginHooks();
  assert.equal(hooks.length, 2);
  await writeFile(
    path.join(codexHome, "config.toml"),
    hooks
      .map(
        (hook) =>
          `[hooks.state.${JSON.stringify(hook.key)}]\ntrusted_hash = ${JSON.stringify(hook.currentHash)}\n`,
      )
      .join("\n"),
  );
  assert.ok(
    (await pluginHooks()).every((hook) => hook.trustStatus === "trusted"),
  );
}

async function publish(version) {
  const command = `${quote(process.execPath)} "$PLUGIN_ROOT/record.mjs" ${quote(version)}`;
  await writeFile(
    path.join(plugin, ".lime-plugin/plugin.json"),
    JSON.stringify({
      name: "demo",
      version,
      hooks: {
        hooks: Object.fromEntries(
          ["PreToolUse", "PostToolUse"].map((event) => [
            event,
            [
              {
                matcher: "exec_command",
                hooks: [{ type: "command", command, timeout: 10 }],
              },
            ],
          ]),
        ),
      },
    }),
  );
  await call("plugin/install", { marketplacePath: market, pluginName: "demo" });
}

const fixture = await startOpenAiCompatibleFixtureServer({
  scriptedResponses: [
    async ({ body }) => {
      assert.ok(active);
      if (active.issued === active.count)
        return { type: "text", content: "PLUGIN_HOOKS_DONE" };
      const names = (body.tools ?? []).map(
        (tool) => tool.function?.name ?? tool.name,
      );
      if (!names.includes("exec_command")) {
        assert.ok(
          names.includes("tool_search"),
          `exec_command is not discoverable: ${names}`,
        );
        return {
          type: "tool_call",
          id: `search-${turns.length}-${active.issued}`,
          name: "tool_search",
          arguments: { query: "exec_command" },
        };
      }
      active.issued++;
      if (active.changeDuringStep && active.issued === 2) {
        await call("config/batchWrite", {
          edits: [
            {
              keyPath: 'plugins."demo@team".enabled',
              value: false,
              mergeStrategy: "replace",
            },
          ],
        });
        assert.equal((await pluginHooks()).length, 0);
      }
      if (active.changeDuringStep && active.issued === 3) {
        await publish("2.0.0");
        assert.ok(
          (await pluginHooks()).every(
            (hook) => hook.trustStatus === "modified",
          ),
        );
        await trust();
      }
      const value = `${active.label}-${active.issued}`;
      return {
        type: "tool_call",
        id: value,
        name: "exec_command",
        arguments: {
          cmd: `${quote(process.execPath)} ${quote(path.join(temp, "tool.mjs"))} ${quote(value)}`,
          yield_time_ms: 10_000,
        },
      };
    },
  ],
});

async function runTurn(threadId, label, count = 1, changeDuringStep = false) {
  active = { label, count, changeDuringStep, issued: 0 };
  const { turn } = await call("turn/start", {
    threadId,
    input: [
      { type: "text", text: `Run the controlled ${label} command sequence.` },
      ...(changeDuringStep
        ? [{ type: "mention", name: "other", path: "plugin://other@team" }]
        : []),
    ],
    approvalPolicy: "never",
    sandboxPolicy: "danger-full-access",
  });
  const deadline = Date.now() + 60_000;
  let canonical;
  let sessionId;
  while (Date.now() < deadline) {
    const read = await call("thread/read", { threadId, includeTurns: true });
    sessionId = read.thread.sessionId;
    canonical = read.thread.turns.find((entry) => entry.id === turn.id);
    if (
      canonical?.status === "completed" &&
      transcript.some(
        (message) =>
          message.method === "turn/completed" &&
          message.params.turn.id === turn.id,
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(canonical?.status, "completed", JSON.stringify(canonical));
  assert.equal(active.issued, count);
  const commands = canonical.items.filter(
    (item) => item.type === "commandExecution",
  );
  assert.equal(commands.length, count, JSON.stringify(canonical));
  for (const command of commands) {
    assert.equal(command.status, "completed", JSON.stringify(command));
    assert.equal(command.exitCode, 0, JSON.stringify(command));
    assert.match(command.aggregatedOutput, /HOOK_TOOL_DONE/u);
  }
  assert.equal(typeof sessionId, "string");
  turns.push({
    label,
    threadId,
    sessionId,
    turnId: turn.id,
    items: canonical.items,
  });
}

async function rows(file) {
  try {
    return (await readFile(file, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

try {
  await mkdir(path.dirname(market), { recursive: true });
  await mkdir(path.join(plugin, ".lime-plugin"), { recursive: true });
  await mkdir(path.join(temp, "market/other/.lime-plugin"), {
    recursive: true,
  });
  await writeFile(
    path.join(temp, "market/other/.lime-plugin/plugin.json"),
    JSON.stringify({ name: "other", version: "1.0.0" }),
  );
  await mkdir(codexHome, { recursive: true });
  await writeFile(
    market,
    JSON.stringify({
      name: "team",
      plugins: [
        { name: "demo", source: "./demo" },
        { name: "other", source: "./other" },
      ],
    }),
  );
  await writeFile(
    path.join(temp, "tool.mjs"),
    `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(path.join(temp, "commands.jsonl"))},JSON.stringify(process.argv[2])+'\\n'); console.log('HOOK_TOOL_DONE');`,
  );
  await writeFile(
    path.join(plugin, "record.mjs"),
    `import assert from 'node:assert/strict'; import {appendFileSync} from 'node:fs'; import path from 'node:path'; let input=''; for await(const chunk of process.stdin) input+=chunk; const value=JSON.parse(input); assert.equal(process.env.PLUGIN_ROOT,process.env.CLAUDE_PLUGIN_ROOT); assert.equal(process.env.PLUGIN_DATA,process.env.CLAUDE_PLUGIN_DATA); const record={version:process.argv[2],root:process.env.PLUGIN_ROOT,data:process.env.PLUGIN_DATA,...value}; appendFileSync(${JSON.stringify(journal)},JSON.stringify(record)+'\\n'); appendFileSync(path.join(process.env.PLUGIN_DATA,'persistent.jsonl'),JSON.stringify(record)+'\\n'); console.log('{}');`,
  );
  await start();
  const provider = await provisionToolExecutionFixtureProvider({
    fixture,
    invoke: (_, method, params) => call(method, params),
  });
  await publish("1.0.0");
  await call("plugin/install", {
    marketplacePath: market,
    pluginName: "other",
  });
  const declarations = (
    await call("plugin/read", { marketplacePath: market, pluginName: "demo" })
  ).plugin.hooks;
  assert.equal(declarations.length, 2);
  assert.deepEqual(
    declarations.map((entry) => entry.key),
    (await pluginHooks()).map((entry) => entry.key),
  );
  assert.ok(
    (await pluginHooks()).every((hook) => hook.trustStatus === "untrusted"),
  );
  const started = await call(
    "thread/start",
    buildToolExecutionThreadStartParams({
      provider,
      title: "Plugin Hooks fixture",
      workspaceRoot: temp,
    }),
  );
  const threadId = started.thread.id;
  await runTurn(threadId, "untrusted");
  assert.deepEqual(await rows(journal), []);
  await trust();
  await runTurn(threadId, "changing", 4, true);
  const changed = await rows(journal);
  assert.deepEqual(
    changed.map((entry) => [
      entry.version,
      entry.tool_use_id,
      entry.hook_event_name,
    ]),
    [
      ["1.0.0", "changing-1", "PreToolUse"],
      ["1.0.0", "changing-1", "PostToolUse"],
      ["1.0.0", "changing-2", "PreToolUse"],
      ["1.0.0", "changing-2", "PostToolUse"],
      ["2.0.0", "changing-4", "PreToolUse"],
      ["2.0.0", "changing-4", "PostToolUse"],
    ],
  );
  assert.ok(
    changed.every(
      (entry) =>
        entry.session_id === turns[1].sessionId &&
        entry.turn_id === turns[1].turnId,
    ),
  );
  assert.equal(new Set(changed.map((entry) => entry.data)).size, 1);
  assert.ok(
    changed.every((entry) => path.basename(entry.root) === entry.version),
  );
  await connected.sidecar.close();
  await start();
  await call("thread/resume", { threadId, excludeTurns: true });
  await runTurn(threadId, "cold");
  assert.equal((await rows(journal)).length, 8);
  await call("plugin/uninstall", { pluginId: "demo@team" });
  assert.equal((await pluginHooks()).length, 0);
  await runTurn(threadId, "uninstalled");
  const ledger = await rows(journal);
  assert.equal(ledger.length, 8);
  assert.deepEqual(
    await rows(path.join(ledger[0].data, "persistent.jsonl")),
    ledger,
  );
  assert.equal((await rows(path.join(temp, "commands.jsonl"))).length, 7);
  const lifecycle = transcript.filter((message) =>
    ["hook/started", "hook/completed"].includes(message.method),
  );
  assert.equal(lifecycle.length, 16);
  const startedRuns = lifecycle.filter(
    (message) => message.method === "hook/started",
  );
  const completedRuns = lifecycle.filter(
    (message) => message.method === "hook/completed",
  );
  assert.equal(startedRuns.length, 8);
  assert.equal(
    new Set(startedRuns.map((message) => message.params.run.id)).size,
    8,
  );
  assert.deepEqual(
    completedRuns.map((message) => message.params.run.id).sort(),
    startedRuns.map((message) => message.params.run.id).sort(),
  );
  assert.ok(
    completedRuns.every((message) => message.params.run.status === "completed"),
  );
  assert.ok(
    lifecycle.every((message) =>
      turns.some(
        (turn) =>
          message.params.threadId === turn.threadId &&
          message.params.turnId === turn.turnId,
      ),
    ),
  );
  const evidence = {
    checkedAt: new Date().toISOString(),
    result: "pass",
    scope:
      "typed native plugin Hooks sources, trust, provider-step refresh, environment and cold/uninstall",
    binary,
    binarySha256,
    provider: "controlled-loopback",
    turns,
    ledger,
    lifecycle,
    commands: await rows(path.join(temp, "commands.jsonl")),
    providerRequests: fixture.requests.length,
    coldRestarts: 1,
    temporaryRoot: temp,
    unverified: [
      "Windows/live/packaged",
      "non-tool lifecycle events",
      "MCP/executor/builtin hooks",
      "LimeCore remote contract",
    ],
  };
  const evidencePath = path.resolve(
    process.env.PLUGIN_HOOKS_EVIDENCE ||
      ".lime/qc/plugin-reconstruction/plugin-hooks-stdio.json",
  );
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  console.log(
    JSON.stringify({
      result: evidence.result,
      turns: turns.length,
      hookRuns: ledger.length,
      evidencePath,
    }),
  );
  succeeded = true;
} finally {
  await connected?.sidecar.close();
  await fixture.close();
  if (succeeded) await rm(temp, { recursive: true, force: true });
  else console.error(`Plugin Hooks fixture retained at ${temp}`);
}
