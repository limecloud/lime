// Real stdio/helper discovery and a canonical no-grant turn; no platform Gate B claim.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import {
  snapshotTerminalGateBinaries,
  terminalGateRuntimeEnvironment,
} from "./terminal-gate-binaries.mjs";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import {
  buildToolExecutionThreadStartParams,
  provisionToolExecutionFixtureProvider,
} from "../agent-runtime/tool-execution-current-contract.mjs";

const args = process.argv.slice(2);
const argument = (name) => args[args.indexOf(name) + 1];
assert(args.includes("--helper") && args.includes("--evidence"), "--helper and --evidence required");
const helperSource = path.resolve(argument("--helper"));
const evidence = path.resolve(argument("--evidence"));
const suffix = process.platform === "win32" ? ".exe" : "";
const appServerSource = path.resolve(
  args.includes("--app-server") ? argument("--app-server") : `lime-rs/target/debug/app-server${suffix}`,
);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "lime-native-stdio-"));
const product = path.join(root, "product");
const bin = path.join(product, "bin");
const helper = path.join(product, "native", path.basename(helperSource));
const receipt = {
  startedAt: new Date().toISOString(),
  claimBoundary: "Real runtime stdio App Server -> manifested native helper status, canonical Thread/Turn/Item and loopback HTTP provider missing-grant rejection; no authorized OS action, CLI/TUI or platform Gate B claim",
  checks: [],
};
let child;
let lines;
let fixture;
let stderr = "";
const pending = new Map();
try {
  await fs.mkdir(path.dirname(helper), { recursive: true });
  // Reuse the current terminal fixture's loader/sibling closure, not a bare binary.
  const binaries = await snapshotTerminalGateBinaries({
    env: { ...process.env, APP_SERVER_BIN: "", LIME_CLI_BIN: "" },
    appServerBinaryPath: appServerSource,
    cliBinaryPath: path.resolve(`lime-rs/target/debug/lime${suffix}`),
    directory: bin,
  });
  await fs.copyFile(helperSource, helper);
  const digest = async (file) => createHash("sha256").update(await fs.readFile(file)).digest("hex");
  const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
  receipt.manifest = {
    schemaVersion: 1, applicationId: "com.limecloud.lime", version,
    platform: process.platform, arch: process.arch,
    resources: [
      { id: "app-server", path: `bin/app-server${suffix}`, sha256: await digest(binaries.appServerBinaryPath) },
      { id: process.platform === "win32" ? "windows-native-host" : "macos-native-host", path: `native/${path.basename(helper)}`, sha256: await digest(helper) },
    ],
  };
  await fs.writeFile(path.join(product, "desktop-resources.manifest.json"), JSON.stringify(receipt.manifest));
  const config = path.join(root, "config.yaml");
  await fs.writeFile(config, "server:\n  api_key: fixture-only\nfeatures:\n  computer_use: true\ncomputer_use:\n  default_app_access: allow\n");
  child = spawn(binaries.appServerBinaryPath, [
    "--backend", "runtime", "--data-dir", path.join(root, "data"), "--app-data-dir", path.join(root, "app"),
  ], { stdio: ["pipe", "pipe", "pipe"], env: {
    ...terminalGateRuntimeEnvironment({ appServerBinaryPath: binaries.appServerBinaryPath }),
    LIME_CONFIG_PATH: config, LIME_AGENT_RUNTIME_ROOT: path.join(root, "runtime"),
  } });
  child.stderr.on("data", (bytes) => { stderr = (stderr + bytes).slice(-6000); });
  const rejectPending = (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.on("error", rejectPending);
  child.on("exit", (code, signal) => rejectPending(new Error(`App Server exited ${code ?? signal}: ${stderr}`)));
  lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const value = JSON.parse(line);
      const request = pending.get(value.id);
      if (!request) return;
      pending.delete(value.id);
      if (value.error) request.reject(new Error(JSON.stringify(value.error)));
      else request.resolve(value.result);
    } catch {}
  });
  let nextId = 0;
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out: ${stderr}`));
    }, 30_000);
    pending.set(id, {
      resolve(value) { clearTimeout(timer); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  await request("initialize", { clientInfo: { name: "native-stdio-fixture", version: "1" } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`);
  const result = await request("computerUse/status", { adapter: "native" });
  const native = result.adapters.find((adapter) => adapter.adapter === "native");
  assert(native);
  // permission_required/blocked are valid real platform states, never synthesized ready.
  assert(["ready", "permission_required", "blocked", "unavailable"].includes(native.readiness), JSON.stringify(native));
  assert.notEqual(native.readiness, "unavailable", "the manifested helper must be admitted, not a missing backend");
  const targets = native.targets ?? [];
  receipt.status = { ...native, targets: targets.length };
  receipt.checks.push("initialized real stdio RPC and OS-observed native readiness");
  const office = await request("computerUse/status", { adapter: "office" });
  assert.equal(office.adapters[0].readiness, "disabled");
  receipt.checks.push("Office remains disabled when its independent switch is off");

  // No setup request is sent: the model cannot create its own authority.
  const target = targets[0] ?? {
    type: "native", appId: "com.limecloud.UngrantedFixture", processId: 1, windowId: "1",
  };
  fixture = await startOpenAiCompatibleFixtureServer({
    modelToolMode: "direct",
    scriptedResponses: [
      { type: "tool_call", id: "native-discover", name: "computer_use", arguments: { operation: { action: "status" } } },
      { type: "tool_call", id: "native-denied", name: "computer_use", arguments: { target, operation: { action: "observe", max_depth: 2, max_nodes: 32 } } },
      { type: "text", content: "NATIVE_DENIAL_READBACK_OK" },
    ],
  });
  const provider = await provisionToolExecutionFixtureProvider({
    fixture,
    invoke: (_, method, params) => request(method, params),
  });
  await request("modelProvider/fetchModels", { providerId: provider.providerPreference });
  const { thread } = await request("thread/start", buildToolExecutionThreadStartParams({
    provider, title: "Native authorization boundary fixture", workspaceRoot: root,
  }));
  const { turn } = await request("turn/start", {
    threadId: thread.id,
    input: [{ type: "text", text: "Discover native status and report the missing authorization. Do not request setup or change any application." }],
    approvalPolicy: "never",
  });
  const deadline = Date.now() + 45_000;
  let canonical;
  while (Date.now() < deadline) {
    const read = await request("thread/read", { threadId: thread.id, includeTurns: true });
    canonical = read.thread.turns.find((entry) => entry.id === turn.id);
    if (canonical && canonical.status !== "inProgress") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(canonical?.status, "completed", JSON.stringify(canonical));
  assert.equal(fixture.requests.length, 3, "discovery, denied observation and provider readback");
  const readback = fixture.requests.at(-1).body.messages.filter((message) => message.role === "tool");
  const tools = canonical.items.filter((item) => item.type === "dynamicToolCall" && item.tool === "computer_use");
  receipt.turn = {
    threadId: thread.id, sessionId: thread.sessionId, turnId: turn.id,
    providerRequests: fixture.requests.length, liveProviderUsed: false,
    helperDiscoveredTargets: targets.length, fallbackTargetUsed: targets.length === 0,
    toolItems: tools.map(({ id, status }) => ({ id, status })),
    providerToolCallIds: readback.map((item) => item.tool_call_id),
    missingGrantRejected: false,
  };
  const discovery = readback.find((message) => message.tool_call_id === "native-discover");
  const denial = readback.find((message) => message.tool_call_id === "native-denied");
  assert(discovery && denial, "provider must receive the original tool call identities");
  assert.match(discovery.content, /native/);
  assert.match(denial.content, /existing target grant/);
  assert.equal(tools.length, 2);
  assert.equal(tools.find((item) => item.id === `item_${discovery.tool_call_id}`)?.status, "completed");
  assert.equal(tools.find((item) => item.id === `item_${denial.tool_call_id}`)?.status, "failed");
  receipt.turn.missingGrantRejected = true;
  receipt.checks.push("real runtime canonical discovery and missing-grant denial reached provider readback with matching tool identities");
  receipt.result = "pass";
} catch (error) {
  receipt.result = "fail";
  receipt.error = String(error);
  receipt.stderr = stderr;
} finally {
  lines?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    child.stdin.end();
    child.kill();
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); }, 3000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  await fixture?.close();
  receipt.completedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(evidence), { recursive: true });
  await fs.writeFile(evidence, `${JSON.stringify(receipt, null, 2)}\n`);
  await fs.rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(receipt, null, 2));
if (receipt.result !== "pass") process.exitCode = 1;
