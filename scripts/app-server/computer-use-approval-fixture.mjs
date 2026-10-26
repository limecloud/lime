// Real consent and durable configuration only; no provider, CLI/TUI or full platform claim.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { prepareLocalComputerUseResources } from "../lib/electron-desktop-resources.mjs";
import {
  snapshotTerminalGateBinaries,
  terminalGateRuntimeEnvironment,
} from "./terminal-gate-binaries.mjs";

assert.equal(process.platform, "darwin", "real macOS consent fixture");
const evidence = path.resolve(
  process.argv[2] ??
    ".lime/qc/computer-use-integrations-20261025/persistent-approval.json",
);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "lime-approval-"));
const appID = "com.limecloud.lime.computer-use-fixture";
const document = "Lime Computer Use Fixture";
const receipt = {
  startedAt: new Date().toISOString(),
  claimBoundary:
    "Real macOS AppKit consent -> NativeAdapter -> stdio App Server -> current config owner; no provider actions, Desktop/CLI/TUI Host or full platform Gate B",
  checks: [],
};
const processes = new Set();
const digest = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
let server;
const config = path.join(root, "config.yaml");

function start(executable, args, options = {}) {
  const child = spawn(executable, args, {
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
  child.on("error", () => {});
  processes.add(child);
  child.once("exit", () => processes.delete(child));
  return child;
}
async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.stdin.end();
    child.kill();
  });
}
async function launch(binary) {
  const child = start(
    binary,
    [
      "--backend",
      "runtime",
      "--data-dir",
      path.join(root, "data"),
      "--app-data-dir",
      path.join(root, "app"),
    ],
    {
      env: {
        ...terminalGateRuntimeEnvironment({ appServerBinaryPath: binary }),
        LIME_CONFIG_PATH: config,
        LIME_AGENT_RUNTIME_ROOT: path.join(root, "runtime"),
      },
    },
  );
  let seq = 0;
  let stderr = "";
  const pending = new Map();
  child.stderr.on("data", (data) => {
    stderr = (stderr + data).slice(-6000);
  });
  const fail = (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.on("error", fail);
  child.once("exit", (code, signal) =>
    fail(new Error(`App Server exit ${code ?? signal}: ${stderr}`)),
  );
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const request = (method, params = {}, timeout = 30_000) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out: ${stderr}`));
      }, timeout);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  await request("initialize", {
    clientInfo: { name: "approval-fixture", version: "1" },
  });
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`,
  );
  return {
    child,
    request,
    lastRequestId: () => seq,
    notify: (method, params) =>
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
      ),
    close: async () => {
      await stop(child);
      lines.close();
    },
  };
}

try {
  const binaries = await snapshotTerminalGateBinaries({
    env: { ...process.env, APP_SERVER_BIN: "", LIME_CLI_BIN: "" },
    appServerBinaryPath: path.resolve("lime-rs/target/debug/app-server"),
    directory: path.join(root, "bin"),
  });
  const resources = prepareLocalComputerUseResources({
    binaryPath: binaries.appServerBinaryPath,
  });
  const manifest = JSON.parse(
    await fs.readFile(resources.manifestPath, "utf8"),
  );
  receipt.appServerSha256 = await digest(binaries.appServerBinaryPath);
  receipt.helper = manifest.resources.find(
    (entry) => entry.id === "macos-native-host",
  );
  receipt.sources = Object.fromEntries(
    await Promise.all(
      [
        "electron/native/macos/macos-computer-use.swift",
        "lime-rs/crates/tool-runtime/src/computer_use/state.rs",
        "lime-rs/crates/tool-runtime/src/computer_use/policy.rs",
        "lime-rs/crates/app-server/src/runtime/computer_use.rs",
      ].map(async (file) => [file, await digest(file)]),
    ),
  );
  // Reuse the same signed, isolated AppKit target used by the native input fixture.
  const swift = execFileSync(
    "python3",
    [
      "-c",
      "import runpy; print(runpy.run_path('lime-rs/crates/tool-runtime/tests/fixtures/macos_computer_use.py')['FIXTURE'])",
    ],
    { encoding: "utf8" },
  );
  const bundle = path.join(root, "Fixture.app");
  const executable = path.join(bundle, "Contents/MacOS/fixture");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(
    path.join(bundle, "Contents/Info.plist"),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${appID}</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleName</key><string>${document}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
  );
  const source = path.join(root, "fixture.swift");
  await fs.writeFile(source, swift);
  execFileSync("swiftc", [
    "-O",
    "-parse-as-library",
    "-framework",
    "AppKit",
    source,
    "-o",
    executable,
  ]);
  execFileSync("codesign", [
    "--force",
    "--sign",
    "-",
    "--identifier",
    appID,
    bundle,
  ]);
  start(executable, [path.join(root, "state.json")]);
  const consent = path.join(root, "consent");
  execFileSync("swiftc", [
    "-O",
    "lime-rs/crates/tool-runtime/tests/fixtures/computer_use_consent.swift",
    "-o",
    consent,
  ]);
  await fs.writeFile(
    config,
    "# isolated persistent approval fixture\nserver:\n  api_key: fixture-only\ndefault_provider: custom-provider\nfeatures:\n  computer_use: true\n",
  );
  server = await launch(binaries.appServerBinaryPath);
  let target;
  let latest;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    latest = (await server.request("computerUse/status", { adapter: "native" }))
      .adapters[0];
    target = latest.targets?.find(
      (entry) => entry.appId === appID && entry.title === document,
    );
    if (target && latest.readiness === "ready") break;
    await delay(100);
  }
  assert(
    target && latest.readiness === "ready",
    `fixture target unavailable: ${JSON.stringify({ readiness: latest?.readiness, reason: latest?.reason, targetCount: latest?.targets?.length })}`,
  );
  receipt.checks.push(
    "manifested helper discovered exact signed AppKit fixture",
  );

  async function confirm(scope) {
    const driver = start(consent, [
      String(server.child.pid),
      document,
      appID,
      scope,
    ]);
    const done = new Promise((resolve, reject) => {
      driver.on("error", reject);
      driver.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`consent driver exited ${code}`)),
      );
    });
    done.catch(() => {});
    const result = await server.request("computerUse/setup", {
      adapter: "native",
      target,
      grantScope: scope === "cancel" ? "session" : scope,
    });
    await done;
    return result;
  }
  const approved = await confirm("persistent");
  assert.equal(approved.grant?.scope, "persistent", JSON.stringify(approved));
  const stored = await server.request("config/read");
  assert.equal(stored.config.computer_use.macos.bundle_ids[appID], "allow");
  assert(stored.config.computer_use.default_app_access == null);
  assert.equal(stored.config.default_provider, "custom-provider");
  receipt.checks.push(
    "real Always allow consent saved only exact bundle identity without changing provider/default access",
  );
  await server.close();
  server = await launch(binaries.appServerBinaryPath);
  receipt.stage = "restarted-target-readback";
  const restartedStatus = (
    await server.request("computerUse/status", { adapter: "native" })
  ).adapters[0];
  const currentTarget = restartedStatus.targets?.find(
    (entry) => entry.appId === appID && entry.title === document,
  );
  assert(
    currentTarget && restartedStatus.readiness === "ready",
    "restarted helper must rediscover the exact fixture before setup",
  );
  target = currentTarget;
  receipt.stage = "reuse-persistent-rule";
  const resumed = await server.request(
    "computerUse/setup",
    { adapter: "native", target, grantScope: "session" },
    30_000,
  );
  assert.equal(resumed.grant?.scope, "session", JSON.stringify(resumed));
  receipt.checks.push(
    "restarted App Server reused durable approval without another consent driver",
  );
  receipt.stage = "remove-approval";
  await server.request("config/value/write", {
    keyPath: "computer_use.macos.bundle_ids",
    value: {},
    mergeStrategy: "replace",
  });
  const status = await server.request("computerUse/status", {
    adapter: "native",
  });
  assert.equal(status.grants?.length ?? 0, 0);
  const removed = await server.request("config/read");
  assert.equal(removed.config.computer_use.macos.bundle_ids[appID], undefined);
  receipt.checks.push(
    "public config removal deleted durable rule and invalidated connection grant",
  );
  const declined = await confirm("cancel");
  assert.equal(declined.accepted, false);
  assert.equal(declined.grant, undefined);
  receipt.checks.push(
    "after removal real Cancel consent refused a fresh session grant",
  );
  receipt.stage = "cancel-pending-persistent-setup";
  const gate = path.join(root, "cancel-gate");
  const driver = start(consent, [
    String(server.child.pid),
    document,
    appID,
    "persistent",
    gate,
  ]);
  const driverDone = new Promise((resolve, reject) => {
    driver.on("error", reject);
    driver.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`gated consent driver exited ${code}`)),
    );
  });
  driverDone.catch(() => {});
  const canceled = server.request("computerUse/setup", {
    adapter: "native",
    target,
    grantScope: "persistent",
  });
  canceled.catch(() => {});
  const requestId = server.lastRequestId();
  let ready = false;
  const readyDeadline = Date.now() + 15_000;
  while (Date.now() < readyDeadline) {
    ready = await fs.access(`${gate}.ready`).then(
      () => true,
      () => false,
    );
    if (ready) break;
    await delay(50);
  }
  assert(
    ready,
    "exact persistent consent must be visible before canceling its RPC",
  );
  server.notify("$/cancelRequest", { id: requestId });
  await server.request("thread/list");
  await fs.writeFile(`${gate}.continue`, "continue");
  await driverDone;
  await assert.rejects(canceled, /canceled/i);
  const afterCancel = await server.request("config/read");
  assert.equal(
    afterCancel.config.computer_use.macos.bundle_ids[appID],
    undefined,
  );
  receipt.checks.push(
    "canceling an in-flight persistent setup prevented saving even when its real native consent was subsequently accepted",
  );
  receipt.result = "pass";
} catch (error) {
  receipt.result = "fail";
  receipt.error = String(error.stack ?? error);
} finally {
  await server?.close();
  for (const child of [...processes]) await stop(child);
  receipt.completedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(evidence), { recursive: true });
  await fs.writeFile(evidence, `${JSON.stringify(receipt, null, 2)}\n`);
  await fs.rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(receipt, null, 2));
if (receipt.result !== "pass") process.exitCode = 1;
