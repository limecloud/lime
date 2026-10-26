// Real macOS helper and canonical stdio turn; only the model is a loopback fixture.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startChromeHost } from "./computer-use-chrome-host.mjs";
import { snapshotTerminalGateBinaries } from "./terminal-gate-binaries.mjs";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import {
  buildToolExecutionThreadStartParams,
  provisionToolExecutionFixtureProvider,
} from "../agent-runtime/tool-execution-current-contract.mjs";

assert.equal(process.platform, "darwin");
const [helperSource, evidenceArgument, mode] = process.argv.slice(2);
const cursorLifecycle = mode === "--cursor-lifecycle";
assert(
  helperSource && evidenceArgument,
  "helper path and evidence directory required",
);
const evidenceDir = path.resolve(evidenceArgument);
await fs.mkdir(evidenceDir, { recursive: true });
const root = await fs.mkdtemp(path.join(os.tmpdir(), "lime-intervention-"));
const appId = "com.limecloud.lime.intervention-fixture";
const title = "Lime Computer Use Intervention Fixture";
const receipt = {
  startedAt: new Date().toISOString(),
  claimBoundary:
    "Real macOS stdio App Server -> shared runtime -> manifested native helper -> disposable AppKit window; separate-process OS event injection and loopback model; not physical hardware, Desktop/CLI/TUI, live or signed release acceptance",
  checks: [],
};
const processes = new Set();
let productHost, model;
const digest = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
function start(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
  processes.add(child);
  child.on("error", () => {});
  child.once("exit", () => processes.delete(child));
  child.done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  void child.done.catch(() => {});
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end();
  child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
  try {
    await child.done;
  } finally {
    clearTimeout(timer);
  }
}
async function waitFor(read, predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    try {
      value = await read();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (value !== undefined && predicate(value)) return value;
    await delay(30);
  }
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
try {
  const product = path.join(root, "product");
  const binaries = await snapshotTerminalGateBinaries({
    env: { ...process.env, APP_SERVER_BIN: "" },
    appServerBinaryPath: path.resolve(
      process.env.APP_SERVER_BIN || "lime-rs/target/debug/app-server",
    ),
    directory: path.join(product, "bin"),
  });
  const helper = path.join(product, "native/macos-native-host");
  await fs.mkdir(path.dirname(helper), { recursive: true });
  await fs.copyFile(path.resolve(helperSource), helper);
  const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
  receipt.manifest = {
    schemaVersion: 1,
    applicationId: "com.limecloud.lime",
    version,
    platform: process.platform,
    arch: process.arch,
    resources: [
      {
        id: "app-server",
        path: "bin/app-server",
        sha256: await digest(binaries.appServerBinaryPath),
      },
      {
        id: "macos-native-host",
        path: "native/macos-native-host",
        sha256: await digest(helper),
      },
    ],
  };
  await fs.writeFile(
    path.join(product, "desktop-resources.manifest.json"),
    JSON.stringify(receipt.manifest),
  );
  await fs.writeFile(
    path.join(root, "config.yaml"),
    JSON.stringify({
      server: { api_key: "fixture-only" },
      features: { computer_use: true, chrome_use: false, office_use: false },
    }),
  );
  const bundle = path.join(evidenceDir, "Intervention Fixture.app");
  const executable = path.join(bundle, "Contents/MacOS/intervention-fixture");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(
    path.join(bundle, "Contents/Info.plist"),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${appId}</string><key>CFBundleExecutable</key><string>intervention-fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
  );
  execFileSync("swiftc", [
    "-parse-as-library",
    "scripts/electron/macos-computer-use-intervention-fixture.swift",
    "-framework",
    "AppKit",
    "-o",
    executable,
  ]);
  execFileSync("codesign", [
    "--force",
    "--sign",
    "-",
    "--identifier",
    appId,
    bundle,
  ]);
  const injector = path.join(evidenceDir, "input-injector");
  await fs.copyFile(executable, injector);
  receipt.injectorPermissions = JSON.parse(
    execFileSync(injector, ["--permissions"], { encoding: "utf8" }),
  );
  assert(Object.values(receipt.injectorPermissions).every((v) => v === true));
  await waitFor(
    () => Number(execFileSync(injector, ["--idle"], { encoding: "utf8" })),
    (v) => v >= 3,
    "desktop idle",
    30000,
  );
  const inputFile = path.join(evidenceDir, "input.json");
  const stateFile = path.join(evidenceDir, "window.json");
  const readState = async () =>
    JSON.parse(await fs.readFile(stateFile, "utf8"));
  const readInput = async () => {
    const value = JSON.parse(await fs.readFile(inputFile, "utf8"));
    assert.equal(value.ready, true, "independent observer must remain healthy");
    return value;
  };
  start(injector, ["--listen", inputFile]);
  await waitFor(readInput, (v) => v.ready, "input observer");
  const window = start(executable, [stateFile]);
  await waitFor(
    readState,
    (v) => v.pid === window.pid && v.text === "ready",
    "dedicated window",
  );
  receipt.fixtureSha256 = await digest(executable);
  // The existing host's app-server mode is transport-only and uses this native config.
  productHost = await startChromeHost({
    host: "app-server",
    root,
    binaries,
    receipt,
    evidenceDir,
  });
  const request = productHost.request;
  function readCursor() {
    const state = JSON.parse(
      execFileSync(injector, ["--cursor-state", "-1"], { encoding: "utf8" }),
    );
    const children = execFileSync("/bin/ps", ["-axo", "pid=,ppid="], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter(
        ([, parent]) => parent === receipt.hostProcess.controlAppServerPid,
      )
      .map(([pid]) => pid);
    const windows = state.pointerWindows.filter((window) =>
      children.includes(window.kCGWindowOwnerPID),
    );
    (receipt.cursorObservations ??= []).push({
      at: new Date().toISOString(),
      foregroundPID: state.foregroundPID,
      targetPID: receipt.target?.processId,
      windows,
      input: JSON.parse(readFileSync(inputFile, "utf8")),
    });
    return windows;
  }
  const waitCursor = (visible) =>
    waitFor(
      readCursor,
      (windows) => Boolean(windows.length) === visible,
      `canonical native pointer visible=${visible}`,
      5000,
    );
  const status = await request("computerUse/status", { adapter: "native" });
  assert.equal(status.adapters[0].readiness, "ready");
  const targets = status.adapters[0].targets.filter(
    (t) =>
      t.type === "native" &&
      t.appId === appId &&
      t.processId === window.pid &&
      t.title === title,
  );
  assert.equal(targets.length, 1, "exact signed fixture target");
  const target = targets[0];
  receipt.target = target;
  const consentBinary = path.join(root, "consent");
  execFileSync("swiftc", [
    "-O",
    "-framework",
    "AppKit",
    "lime-rs/crates/tool-runtime/tests/fixtures/computer_use_consent.swift",
    "-o",
    consentBinary,
  ]);
  async function grant() {
    const consent = start(consentBinary, [
      String(receipt.hostProcess.controlAppServerPid),
      title,
      appId,
    ]);
    let consentOutput = "";
    consent.stdout.on("data", (bytes) => {
      consentOutput += bytes;
    });
    consent.stderr.on("data", (bytes) => {
      consentOutput += bytes;
    });
    const approved = await request("computerUse/setup", {
      adapter: "native",
      target,
      grantScope: "session",
    });
    const consentExit = await consent.done;
    (receipt.grantAttempts ??= []).push({
      approved,
      consentExit,
      consentOutput,
    });
    assert.equal(
      consentExit.code,
      0,
      JSON.stringify(receipt.grantAttempts.at(-1)),
    );
    assert.equal(approved.accepted, true);
    return approved;
  }
  receipt.initialGrant = await grant();
  let phase = "interrupt",
    count = 0;
  let modelFailure;
  const marker = `explicit-resume-中文🚀-${randomUUID()}`;
  model = await startOpenAiCompatibleFixtureServer({
    modelToolMode: "direct",
    scriptedResponses: [
      async () => {
        try {
          count++;
          let operation;
          if (phase === "interrupt") {
            assert(count <= 2, "model resampled after manual intervention");
            if (count === 1)
              operation = { action: "observe", max_depth: 3, max_nodes: 64 };
            else {
              if (cursorLifecycle) {
                await waitCursor(true);
                const started = Date.now();
                const samples = [];
                do {
                  const windows = readCursor();
                  assert.equal(
                    windows.length,
                    1,
                    "pointer disappeared while the model was waiting",
                  );
                  samples.push({ elapsedMs: Date.now() - started, windows });
                  await delay(250);
                } while (Date.now() - started <= 11000);
                receipt.waitingCursorSamples = samples;
                receipt.checks.push(
                  "Agent pointer remains visible for more than 10 seconds between real canonical tool calls and model sampling",
                );
              }
              const before = (await readInput()).externalInputs;
              const point = (await readState()).screenPoint;
              const injection = start(injector, [
                "--inject",
                "mouse",
                String(point.x),
                String(point.y),
              ]);
              try {
                await waitFor(
                  readInput,
                  (v) => v.externalInputs > before,
                  "external input delivered",
                );
              } finally {
                injection.stdin.end("\n");
                await injection.done;
              }
              if (cursorLifecycle) await waitCursor(false);
              operation = { action: "type", text: "MUST_NOT_APPEAR" };
            }
          } else {
            const operations = [
              { action: "observe", max_depth: 3, max_nodes: 64 },
              {
                action: "click",
                ...(await readState()).click,
                button: "left",
                count: 1,
              },
              { action: "key", key: "a", modifiers: ["command"] },
              { action: "type", text: marker },
            ];
            operation = operations[count - 1];
            if (cursorLifecycle && !operation) {
              receipt.cursorBeforeCompletion = await waitCursor(true);
            }
          }
          return operation
            ? {
                type: "tool_call",
                id: `${phase}-${count}`,
                name: "computer_use",
                arguments: { target, operation },
              }
            : { type: "text", content: "EXPLICIT_RESUME_COMPLETE" };
        } catch (error) {
          modelFailure = String(error);
          return { type: "text", content: "INTERVENTION_FIXTURE_FAILED" };
        }
      },
    ],
  });
  const provider = await provisionToolExecutionFixtureProvider({
    fixture: model,
    invoke: (_, method, params) => request(method, params),
  });
  await request("modelProvider/fetchModels", {
    providerId: provider.providerPreference,
  });
  const { thread } = await request(
    "thread/start",
    buildToolExecutionThreadStartParams({
      provider,
      title: "Native intervention and explicit resume",
      workspaceRoot: root,
    }),
  );
  async function turn(prompt) {
    const started = await request("turn/start", {
      threadId: thread.id,
      input: [{ type: "text", text: prompt }],
      approvalPolicy: "never",
    });
    return waitFor(
      async () =>
        (
          await request("thread/read", {
            threadId: thread.id,
            includeTurns: true,
          })
        ).thread.turns.find((t) => t.id === started.turn.id),
      (t) => t.status !== "inProgress",
      "canonical turn terminal",
      60000,
    );
  }
  const interrupted = await turn(
    "Observe only the dedicated test window, then attempt the test input.",
  );
  receipt.interruptedTurn = interrupted;
  receipt.requestsBeforeResume = model.requests.length;
  assert.equal(modelFailure, undefined, modelFailure);
  assert.equal(interrupted.status, "interrupted", JSON.stringify(interrupted));
  assert.equal(
    model.requests.length,
    2,
    "no provider request after rejected second action",
  );
  const tools = interrupted.items.filter((i) => i.type === "dynamicToolCall");
  assert.equal(tools.length, 2);
  assert.equal(new Set(tools.map((i) => i.id)).size, 2);
  assert.equal(tools[0].status, "completed");
  assert.notEqual(tools[1].status, "completed");
  assert.equal(
    (await readState()).text,
    "ready",
    "interrupted input never reached the field",
  );
  if (cursorLifecycle) await waitCursor(false);
  receipt.checks.push(
    "real native intervention cancels the canonical turn before resampling or further input",
  );
  await request("computerUse/status", { adapter: "native" });
  receipt.resumedGrant = await grant();
  assert.notEqual(receipt.initialGrant.grant.id, receipt.resumedGrant.grant.id);
  phase = "resume";
  count = 0;
  const resumed = await turn(
    "Explicitly resume in a new turn: observe again and write the new test marker only.",
  );
  receipt.resumedTurn = resumed;
  assert.equal(modelFailure, undefined, modelFailure);
  assert.equal(resumed.status, "completed", JSON.stringify(resumed));
  assert.notEqual(resumed.id, interrupted.id);
  await waitFor(
    readState,
    (v) => v.text === marker,
    "independent exact resumed text",
  );
  assert(
    resumed.items
      .filter((i) => i.type === "dynamicToolCall")
      .every((i) => i.status === "completed"),
  );
  if (cursorLifecycle) {
    receipt.cursorAfterCompletion = await waitCursor(false);
    receipt.checks.push(
      "canonical interrupted/completed turns remove the pointer through the shared terminal hook",
    );
  }
  receipt.checks.push(
    "new consent and explicit new canonical turn observe first and independently read back fresh Unicode input",
  );
  receipt.result = "pass";
} catch (error) {
  receipt.result = "failed";
  receipt.error = error.stack || String(error);
  receipt.stderr = productHost?.stderr;
} finally {
  await productHost?.close();
  for (const child of [...processes]) await stop(child);
  await model?.close();
  receipt.completedAt = new Date().toISOString();
  await fs.writeFile(
    path.join(evidenceDir, "intervention.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  await fs.rm(root, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    result: receipt.result,
    checks: receipt.checks,
    error: receipt.error,
  }),
);
if (receipt.result !== "pass") process.exitCode = 1;
